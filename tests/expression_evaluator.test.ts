import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    BuiltInScope,
    checkExpression,
    CompiledExpression,
    ExpressionField,
    ExpressionVocabulary,
    FIELD_SCOPES,
    ResolvedReference,
    tagId,
} from '../src/expressions/checker';
import {
    evaluate,
    evaluateCondition,
    evaluateNumber,
    EvaluationContext,
    EvaluationError,
    ScopeView,
} from '../src/expressions/evaluator';

const vocabulary: ExpressionVocabulary = {
    scopeWords: { formation: 'group', core: 'root' },
    units: ['squad', 'carrier', 'general'],
    roles: ['officer', 'troop', 'transport'],
    unitTypes: ['infantry', 'vehicle'],
    groupTypes: ['core', 'reserve'],
    groups: ['standard-core'],
    weapons: ['rifle', 'axe'],
    equipment: ['pack'],
    factions: ['field-army'],
    subFactions: ['veterans'],
    selectors: ['line-troops'],
    slotTags: ['prime'],
    tags: ['Sergeant'],
    resources: { points: 'list', slots: 'unit' },
    choices: { stance: ['offensive', 'defensive'] },
    subChoices: { mount: ['front', 'turret'] },
};

/* ------------------------------------------------------------------ */
/* A tiny list behind the context interface                             */
/* ------------------------------------------------------------------ */

type FakeUnit = {
    id: string;
    role: string;
    type: string;
    tags?: Array<string>;
    points: number;
    models: number;
    wargear?: Record<string, number>;
};

const squad = (points = 100): FakeUnit => ({
    id: 'squad',
    role: 'troop',
    type: 'infantry',
    tags: ['Sergeant'],
    points,
    models: 10,
    wargear: { rifle: 9, axe: 1 },
});
const carrier: FakeUnit = {
    id: 'carrier',
    role: 'transport',
    type: 'vehicle',
    points: 35,
    models: 1,
};
const general: FakeUnit = {
    id: 'general',
    role: 'officer',
    type: 'infantry',
    points: 125,
    models: 1,
};

const matches = (unit: FakeUnit, ref: ResolvedReference) => {
    switch (ref.kind) {
        case 'unit':
            return unit.id === ref.id;
        case 'role':
            return unit.role === ref.id;
        case 'unitType':
            return unit.type === ref.id;
        case 'unitTag':
            return !!unit.tags?.map(tagId).includes(ref.id);
        case 'selector':
            return (
                ref.id === 'line-troops' &&
                unit.role === 'troop' &&
                unit.type === 'infantry'
            );
        default:
            return false;
    }
};

function container(
    units: Array<FakeUnit>,
    groups: Array<string> = []
): ScopeView {
    return {
        count: (ref) =>
            ref.kind === 'weapon' || ref.kind === 'equipment'
                ? units.reduce((n, u) => n + (u.wargear?.[ref.id] ?? 0), 0)
                : ref.kind === 'group'
                  ? groups.filter((g) => g === ref.id).length
                  : units.filter((u) => matches(u, ref)).length,
        sum: (_resource, ref) =>
            units
                .filter((u) => !ref || matches(u, ref))
                .reduce((n, u) => n + u.points, 0),
    };
}

/** a list with one core formation holding `units`, seen from its first unit */
function context(
    units: Array<FakeUnit>,
    options: {
        stance?: string;
        picks?: number;
        mount?: string;
        limit?: number;
    } = {}
): EvaluationContext {
    const self = units[0];
    const views: Partial<Record<BuiltInScope, ScopeView>> = {
        unit: {
            is: (ref) => matches(self, ref),
            count: (ref) => self.wargear?.[ref.id] ?? 0,
            models: () => self.models,
            limit: () => 5,
            sum: () => self.points,
        },
        group: {
            ...container(units),
            is: (ref) =>
                ref.kind === 'groupType'
                    ? ref.id === 'core'
                    : ref.id === 'standard-core',
        },
        root: container(units),
        contingent: {
            ...container(units),
            is: (ref) => ref.kind === 'subfaction' && ref.id === 'veterans',
        },
        list: {
            ...container(units, ['core', 'standard-core']),
            limit: () => options.limit ?? 3000,
            is: (ref) => ref.kind === 'faction' && ref.id === 'field-army',
        },
        option: {
            picks: () => options.picks ?? 0,
            choice: () => options.mount ?? 'front',
        },
        slot: { is: (ref) => ref.kind === 'slotTag' && ref.id === 'prime' },
    };

    return {
        scope: (scope) => views[scope],
        choice: (name) =>
            name === 'stance' ? (options.stance ?? 'offensive') : undefined,
    };
}

/* ------------------------------------------------------------------ */

const ALL: ExpressionField['scopes'] = [
    'option',
    'profile',
    'unit',
    'slot',
    'group',
    'contingent',
    'root',
    'list',
];

function compile(
    source: string,
    result: ExpressionField['result'] = 'number',
    scopes = ALL
): CompiledExpression {
    const checked = checkExpression(source, { scopes, result }, vocabulary);
    assert.ok(
        checked.compiled,
        `${source}: ${checked.diagnostics.map((d) => d.message).join('; ')}`
    );
    return checked.compiled;
}

const run = (
    source: string,
    ctx: EvaluationContext,
    result: ExpressionField['result'] = 'number'
) => evaluate(compile(source, result), ctx);

const list = [squad(), squad(120), carrier, general];

describe('evaluator: spec examples', () => {
    it('evaluates formation and unit limits', () => {
        // two Troops in the core → 1 + floor(2 / 2)
        assert.equal(
            run('1 + floor(root.count(role:troop) / 2)', context(list)),
            2
        );
        assert.equal(
            run('1 + floor(contingent.count(unit:squad) / 2)', context(list)),
            2
        );
        assert.equal(
            run('1 + floor(root.count(role:troop) / 2)', context([squad()])),
            1
        );
    });

    it('reads list choices', () => {
        assert.equal(
            run('choice(stance) == defensive', context(list), 'boolean'),
            false
        );
        assert.equal(
            run(
                'choice(stance) == defensive',
                context(list, { stance: 'defensive' }),
                'boolean'
            ),
            true
        );
        assert.equal(
            run('choice(stance) != defensive', context(list), 'boolean'),
            true
        );
    });

    it('counts named selectors and wargear', () => {
        assert.equal(
            run(
                'contingent.count(@line-troops) >= 3',
                context(list),
                'boolean'
            ),
            false
        );
        assert.equal(
            run(
                'contingent.count(@line-troops) >= 2',
                context(list),
                'boolean'
            ),
            true
        );
        assert.equal(run('group.count(weapon:rifle)', context(list)), 18);
        assert.equal(
            run('unit.has(weapon:axe)', context(list), 'boolean'),
            true
        );
        assert.equal(
            run('unit.has(equipment:pack)', context(list), 'boolean'),
            false
        );
    });

    it('reads limits, sums and models', () => {
        assert.equal(
            run('list.limit(points) >= 3000', context(list), 'boolean'),
            true
        );
        assert.equal(
            run(
                'list.limit(points) >= 3000',
                context(list, { limit: 2000 }),
                'boolean'
            ),
            false
        );
        assert.equal(run('list.sum(points)', context(list)), 380);
        assert.equal(run('list.sum(points, role:troop)', context(list)), 220);
        assert.equal(run('unit.models() >= 5 ? 200 : 150', context(list)), 200);
        assert.equal(run('unit.limit(slots) - 1', context(list)), 4);
    });

    it('answers is() on every scope', () => {
        const ctx = context(list);
        assert.equal(
            run(
                'unit.is(role:troop) and unit.is(type:infantry) and unit.is(tag:sergeant)',
                ctx,
                'boolean'
            ),
            true
        );
        assert.equal(run('unit.is(@line-troops)', ctx, 'boolean'), true);
        assert.equal(run('slot.is(tag:prime)', ctx, 'boolean'), true);
        assert.equal(
            run(
                'group.is(type:core) and group.is(group:standard-core)',
                ctx,
                'boolean'
            ),
            true
        );
        assert.equal(
            run(
                'contingent.is(subfaction:veterans) and list.is(faction:field-army)',
                ctx,
                'boolean'
            ),
            true
        );
        assert.equal(run('list.count(group:core)', ctx), 1);
    });

    it('evaluates option picks and sub-choices', () => {
        assert.equal(
            run(
                'option.choice(mount) == turret',
                context(list, { mount: 'turret' }),
                'boolean'
            ),
            true
        );
        assert.equal(
            run('option.picks() <= 2', context(list, { picks: 3 }), 'boolean'),
            false
        );
    });

    it("uses the game's words for scopes", () => {
        assert.equal(run('core.count(role:troop)', context(list)), 2);
        assert.equal(
            run('formation.is(type:core)', context(list), 'boolean'),
            true
        );
    });
});

describe('evaluator: arithmetic and logic', () => {
    it('follows precedence and functions', () => {
        const ctx = context(list);
        assert.equal(run('1 + 2 * 3', ctx), 7);
        assert.equal(run('-2 * -3', ctx), 6);
        assert.equal(run('7 / 2', ctx), 3.5);
        assert.equal(
            run('min(4, 2, 3) + max(1, 5) + ceil(1.2) + floor(1.8)', ctx),
            10
        );
        assert.equal(
            run('not (1 > 2) and (true or false)', ctx, 'boolean'),
            true
        );
    });

    it('short-circuits and, or and conditionals', () => {
        const ctx = context(list);
        // the right-hand sides would divide by zero if evaluated
        assert.equal(run('1 > 2 and 1 / 0 > 0', ctx, 'boolean'), false);
        assert.equal(run('1 < 2 or 1 / 0 > 0', ctx, 'boolean'), true);
        assert.equal(run('true ? 1 : 1 / 0', ctx), 1);
    });
});

describe('evaluator: errors (spec §11)', () => {
    it('reports division by zero as an evaluation error', () => {
        assert.throws(
            () => run('unit.models() / (unit.models() - 10)', context(list)),
            EvaluationError
        );
    });

    it('treats a condition it cannot evaluate as not met, with the error', () => {
        const result = evaluateCondition(
            compile('1 / 0 > 1', 'boolean'),
            context(list)
        );
        assert.equal(result.met, false);
        assert.ok(!result.met && result.error instanceof EvaluationError);
        assert.deepEqual(
            evaluateCondition(compile('1 < 2', 'boolean'), context(list)),
            { met: true }
        );
        assert.deepEqual(
            evaluateCondition(compile('1 > 2', 'boolean'), context(list)),
            { met: false }
        );
    });

    it('reports scopes the context does not have', () => {
        const noSlot: EvaluationContext = {
            scope: () => undefined,
            choice: () => undefined,
        };
        assert.throws(
            () => run('slot.is(tag:prime)', noSlot, 'boolean'),
            /there is no slot here/
        );
        assert.throws(
            () => run('choice(stance) == offensive', noSlot, 'boolean'),
            /no stance set/
        );
    });

    it('rounds min and max down and rejects negative costs', () => {
        const ctx = context(list);
        assert.equal(
            evaluateNumber(
                compile('7 / 2', 'number', FIELD_SCOPES.unit),
                ctx,
                'max'
            ),
            3
        );
        assert.equal(
            evaluateNumber(
                compile('7 / 2', 'number', FIELD_SCOPES.unit),
                ctx,
                'cost'
            ),
            3.5
        );
        assert.throws(
            () =>
                evaluateNumber(
                    compile('10 - 20', 'number', FIELD_SCOPES.unit),
                    ctx,
                    'cost'
                ),
            /can't be negative/
        );
    });
});
