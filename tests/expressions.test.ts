import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    checkExpression,
    ExpressionField,
    ExpressionVocabulary,
    FIELD_SCOPES,
} from '../src/expressions/checker';
import {
    closest,
    ExpressionSyntaxError,
    formatDiagnostic,
} from '../src/expressions/diagnostics';
import { tokenize } from '../src/expressions/lexer';
import { Expr, parseExpression } from '../src/expressions/parser';

/** a small generic game with a sub-choice, enough for every rule */
const vocabulary: ExpressionVocabulary = {
    scopeWords: { formation: 'group', core: 'root' },
    units: ['squad', 'carrier'],
    roles: ['officer', 'troop', 'transport', 'heavy'],
    unitTypes: ['infantry', 'vehicle'],
    groupTypes: ['core', 'allied', 'reserve', 'elite'],
    groups: ['standard-core', 'armoured-spearhead'],
    weapons: ['rifle', 'axe', 'twin-blades'],
    equipment: ['banner', 'pack'],
    factions: ['field-army'],
    subFactions: ['veterans'],
    selectors: ['line-troops'],
    slotTags: ['prime'],
    tags: ['Sergeant'],
    traits: ['Field Army', 'Veteran Corps'],
    resources: { points: 'list', slots: 'unit' },
    choices: { stance: ['offensive', 'defensive'] },
    subChoices: { mount: ['front', 'rear', 'turret'] },
};

const field = (
    scopes: ExpressionField['scopes'],
    result: ExpressionField['result'],
    lint?: ExpressionField['lint']
): ExpressionField => ({ scopes, result, lint });

const unitWhen = field(FIELD_SCOPES.unit, 'boolean');
const unitMax = field(FIELD_SCOPES.unit, 'number');
const optionWhen = field(FIELD_SCOPES.option, 'boolean', 'option-when');

const check = (source: string, f: ExpressionField = unitWhen) =>
    checkExpression(source, f, vocabulary);

const errors = (source: string, f?: ExpressionField) =>
    check(source, f)
        .diagnostics.filter((d) => d.severity === 'error')
        .map((d) => d.message);

const warnings = (source: string, f?: ExpressionField) =>
    check(source, f)
        .diagnostics.filter((d) => d.severity === 'warning')
        .map((d) => d.message);

/** a compact rendering of the tree, to assert precedence */
function show(node: Expr): string {
    switch (node.type) {
        case 'number':
            return String(node.value);
        case 'boolean':
            return String(node.value);
        case 'name':
            return node.name;
        case 'negate':
            return `(-${show(node.operand)})`;
        case 'not':
            return `(not ${show(node.operand)})`;
        case 'arithmetic':
        case 'compare':
        case 'logical':
            return `(${show(node.left)} ${node.operator} ${show(node.right)})`;
        case 'conditional':
            return `(${show(node.condition)} ? ${show(node.then)} : ${show(node.otherwise)})`;
        case 'call':
            return `${node.scope ? `${node.scope.name}.` : ''}${node.name}(${node.args
                .map((arg) =>
                    arg.type === 'reference'
                        ? `${arg.kind}:${arg.id}`
                        : arg.type === 'selector'
                          ? `@${arg.id}`
                          : show(arg)
                )
                .join(', ')})`;
    }
}

const syntaxError = (source: string) =>
    assert.throws(() => parseExpression(source), ExpressionSyntaxError);

describe('lexer', () => {
    const types = (source: string) =>
        tokenize(source)
            .slice(0, -1)
            .map((t) => `${t.type}:${t.text}`);

    it('keeps hyphens inside names', () => {
        assert.deepEqual(types('heavy'), ['name:heavy']);
        assert.deepEqual(types('a-b'), ['name:a-b']);
    });

    it('reads a spaced or post-token minus as subtraction', () => {
        assert.deepEqual(types('a - b'), ['name:a', 'operator:-', 'name:b']);
        assert.deepEqual(types('f()-1'), [
            'name:f',
            'operator:(',
            'operator:)',
            'operator:-',
            'number:1',
        ]);
        assert.deepEqual(types('3-1'), ['number:3', 'operator:-', 'number:1']);
    });

    it('reads references, selectors and keywords', () => {
        assert.deepEqual(types('role:troop @line-troops and'), [
            'reference:role:troop',
            'selector:line-troops',
            'keyword:and',
        ]);
        const [ref] = tokenize('unit:squad');
        assert.equal(ref.kind, 'unit');
        assert.equal(ref.id, 'squad');
    });

    it('treats a spaced colon as punctuation', () => {
        assert.deepEqual(types('a : b'), ['name:a', 'operator::', 'name:b']);
    });

    it('rejects capitals and unknown characters', () => {
        assert.throws(() => tokenize('Troop'), /names are lowercase/);
        assert.throws(() => tokenize('a % b'), /unexpected character '%'/);
        assert.throws(() => tokenize('@'), /selector id/);
    });
});

describe('parser', () => {
    const tree = (source: string) => show(parseExpression(source));

    it('follows the precedence table', () => {
        assert.equal(tree('1 + 2 * 3'), '(1 + (2 * 3))');
        assert.equal(tree('-2 * 3'), '((-2) * 3)');
        assert.equal(
            tree('not a == b and c or d'),
            '(((not (a == b)) and c) or d)'
        );
        assert.equal(tree('(1 + 2) * 3'), '((1 + 2) * 3)');
    });

    it('nests conditionals to the right', () => {
        assert.equal(tree('a ? 1 : b ? 2 : 3'), '(a ? 1 : (b ? 2 : 3))');
        assert.equal(tree('a ? 1:0'), '(a ? 1 : 0)');
    });

    it('parses scoped and global calls with references', () => {
        assert.equal(
            tree('1 + floor(group.count(role:troop) / 2)'),
            '(1 + floor((group.count(role:troop) / 2)))'
        );
        assert.equal(
            tree('contingent.count(@line-troops) >= 3'),
            '(contingent.count(@line-troops) >= 3)'
        );
        assert.equal(tree('max(1, 2, 3)'), 'max(1, 2, 3)');
    });

    it('keeps source spans', () => {
        const node = parseExpression('1 + unit.models()');
        assert.equal(node.start, 0);
        assert.equal(node.end, 17);
    });

    it('rejects chained comparisons', () => {
        assert.throws(() => parseExpression('1 < 2 < 3'), /can't be chained/);
    });

    it('rejects references outside call arguments, with the conditional hint', () => {
        assert.throws(
            () => parseExpression('x ? a:b'),
            /reference and can only be a call argument.*spaces around ':'/
        );
        assert.throws(() => parseExpression('@x'), /only be a call argument/);
    });

    it('rejects incomplete and malformed input', () => {
        syntaxError('');
        syntaxError('1 +');
        syntaxError('floor(1');
        syntaxError('1 2');
        syntaxError('group.count');
        assert.throws(() => parseExpression('(1'), /expected '\)'/);
    });
});

describe('checker: spec examples', () => {
    const ok = (source: string, f: ExpressionField) => {
        const result = check(source, f);
        assert.deepEqual(result.diagnostics, [], source);
        assert.equal(result.ok, true);
        return result;
    };

    it('accepts every example from the spec', () => {
        ok(
            '1 + floor(root.count(role:troop) / 2)',
            field(FIELD_SCOPES.detachmentLimit, 'number')
        );
        ok('choice(stance) == defensive', optionWhen);
        ok(
            'contingent.count(@line-troops) >= 3',
            field(FIELD_SCOPES.effect, 'boolean')
        );
        ok(
            'list.limit(points) >= 3000',
            field(FIELD_SCOPES.detachmentWhen, 'boolean')
        );
        ok('1 + floor(contingent.count(unit:squad) / 2)', unitMax);
        ok('unit.has(equipment:pack) ? 15 : 10', unitMax);
    });

    it("accepts the game's words for scopes and the group kind", () => {
        ok('core.count(role:troop) >= 2', unitWhen);
        ok('formation.is(type:core)', unitWhen);
        ok('list.count(formation:reserve) <= 2', unitWhen);
    });

    it('accepts option, slot, group and faction checks', () => {
        ok(
            'option.choice(mount) == turret and option.picks() <= 2',
            optionWhen
        );
        ok('slot.is(tag:prime)', field(FIELD_SCOPES.slot, 'boolean'));
        ok('slot.is(role:troop)', field(FIELD_SCOPES.slot, 'boolean'));
        ok('group.is(type:reserve) or group.is(group:standard-core)', unitWhen);
        ok(
            'contingent.is(subfaction:veterans) and list.is(faction:field-army)',
            unitWhen
        );
        ok('unit.is(@line-troops) and unit.is(type:infantry)', unitWhen);
        ok('list.sum(points, role:heavy) > 500', unitWhen);
        ok('unit.limit(slots) - unit.sum(slots) >= 1', unitWhen);
        ok('unit.models() >= 5', unitWhen);
        ok('min(unit.models(), 3) == max(1, 2)', unitWhen);
        ok('choice(stance) != offensive', unitWhen);
    });

    it("reads the list's main contingent", () => {
        const subFaction = field(FIELD_SCOPES.subFaction, 'boolean');
        ok(
            'not main.is(faction:field-army) or main.is(subfaction:veterans)',
            subFaction
        );
        ok('main.count(role:troop) >= 2 and main.has(group:core)', unitWhen);
        ok('main.sum(points) > 500', field(FIELD_SCOPES.list, 'boolean'));
    });

    it('matches traits on units and profiles', () => {
        ok('unit.is(trait:field-army)', unitWhen);
        ok(
            'profile.is(trait:veteran-corps)',
            field(FIELD_SCOPES.effect, 'boolean')
        );
        ok('group.count(trait:veteran-corps) >= 1', unitWhen);
        ok('main.count(trait:field-army) == main.count(role:troop)', unitWhen);
        ok('list.sum(points, trait:field-army) > 100', unitWhen);
    });

    it('returns the type', () => {
        assert.deepEqual(check('unit.models() + 1', unitMax).type, {
            kind: 'number',
        });
    });

    it("reads a rule's value only in a rule's grants", () => {
        const ruleGrant = field(FIELD_SCOPES.ruleGrant, 'number');
        assert.deepEqual(check('rule.value() - 1', ruleGrant).type, {
            kind: 'number',
        });
        assert.equal(check('-rule.value()', ruleGrant).ok, true);
        assert.equal(check('rule.value()', unitMax).ok, false);
        assert.equal(check('unit.value()', ruleGrant).ok, false);
    });
});

describe('checker: errors', () => {
    it('rejects scopes the field may not use', () => {
        assert.deepEqual(
            errors(
                'unit.has(weapon:rifle)',
                field(FIELD_SCOPES.detachmentWhen, 'boolean')
            ),
            ["'unit' isn't available here (allowed: contingent, list, main, root)"]
        );
    });

    it('suggests close names', () => {
        assert.deepEqual(errors('group.count(role:trop) > 1'), [
            "unknown role 'trop' (did you mean 'troop'?)",
        ]);
        assert.deepEqual(errors('grup.count(role:troop) > 1'), [
            "unknown scope 'grup' (did you mean 'group'?)",
        ]);
        assert.deepEqual(errors('choice(stance) == defensiv'), [
            "'defensiv' isn't a value of stance (did you mean 'defensive'?)",
        ]);
        assert.deepEqual(errors('choice(stanc) == defensive'), [
            "unknown list choice 'stanc' (did you mean 'stance'?)",
        ]);
        assert.deepEqual(errors('group.cuont(role:troop) > 1'), [
            "unknown function 'cuont' (did you mean 'count'?)",
        ]);
    });

    it('hints at subtraction for hyphenated unknown names', () => {
        assert.deepEqual(errors('unit.models() > a-b', unitWhen), [
            "unknown name 'a-b' (for subtraction, put spaces around '-': a - b)",
        ]);
    });

    it('requires is() to test the unit itself', () => {
        assert.match(
            errors('unit.count(role:troop) > 0')[0],
            /use unit\.is\(…\) to test the unit itself/
        );
        assert.match(errors('unit.has(@line-troops)')[0], /use unit\.is\(…\)/);
        assert.deepEqual(errors('unit.has(weapon:rifle)'), []);
    });

    it('looks references up against the scope they are asked about', () => {
        // type: on a group means group type, on a unit unit type
        assert.deepEqual(errors('group.is(type:core)'), []);
        assert.match(errors('unit.is(type:core)')[0], /unknown unit type/);
        // tag: on a slot means slot tags
        assert.match(
            errors(
                'slot.is(tag:sergeant)',
                field(FIELD_SCOPES.slot, 'boolean')
            )[0],
            /unknown slot tag 'sergeant'/
        );
        assert.match(
            errors('group.is(role:troop)')[0],
            /doesn't take 'role:' \(expected type:, group:\)/
        );
        assert.match(
            errors('group.count(spell:x) > 1')[0],
            /unknown reference kind/
        );
    });

    it('warns (not errors) on unknown unit tags', () => {
        assert.deepEqual(errors('unit.is(tag:veteran)'), []);
        assert.match(
            warnings('unit.is(tag:veteran)')[0],
            /no unit or profile has the tag/
        );
        // tags match case-insensitively: `tag:sergeant` finds the `Sergeant` tag
        assert.deepEqual(check('unit.is(tag:sergeant)').diagnostics, []);
        assert.match(errors('unit.is(tag:Sergeant)')[0], /names are lowercase/);
    });

    it('warns (not errors) on unknown traits, and keeps unit.count to wargear', () => {
        assert.deepEqual(errors('unit.is(trait:iron-tercio)'), []);
        assert.deepEqual(warnings('unit.is(trait:veteran-corp)'), [
            "no unit has or is given the trait 'veteran-corp' (did you mean 'veteran-corps'?)",
        ]);
        assert.match(
            errors('unit.count(trait:field-army) > 0')[0],
            /use unit.is/
        );
        assert.deepEqual(errors('main.limit(points) > 0'), [
            "main.limit() isn't available (on main: count, has, is, sum)",
        ]);
        assert.match(
            errors('main.is(type:core)')[0],
            /main.is\(\) doesn't take 'type:'/
        );
    });

    it('checks types', () => {
        assert.deepEqual(errors('contingent.is(subfaction:veterans) + 1'), [
            'expected a number but this is a boolean',
        ]);
        assert.match(errors('unit.models() == true')[0], /can't compare/);
        assert.match(errors('true > false')[0], /compares numbers/);
        assert.match(
            errors('unit.models() > 1 ? 1 : false', unitMax)[0],
            /same type/
        );
        assert.match(errors('choice(stance) < defensive')[0], /'==' or '!='/);
    });

    it("checks the field's result type", () => {
        assert.match(
            errors('unit.models()', unitWhen)[0],
            /needs a boolean but the expression is a number/
        );
        assert.match(errors('choice(stance)', unitWhen)[0], /stance value/);
    });

    it('checks resources, arities and verbs on scopes', () => {
        assert.match(
            errors('list.limit(slots) > 1')[0],
            /unit resource; use unit\.limit/
        );
        assert.match(
            errors('list.sum(credits) > 1')[0],
            /unknown resource 'credits'/
        );
        assert.match(errors('unit.models(1) > 1')[0], /takes 0 arguments/);
        assert.match(errors('min(1) > 0')[0], /two or more/);
        assert.match(
            errors('slot.models() > 1', field(FIELD_SCOPES.slot, 'boolean'))[0],
            /slot\.models\(\) isn't available/
        );
        assert.match(
            errors('group(1) > 0')[0],
            /is a scope; call a function on it/
        );
        assert.match(
            errors('floor(role:troop) > 0')[0],
            /expected a number, not a reference/
        );
    });

    it('reports every problem in one pass', () => {
        const result = check(
            'group.count(role:trop) > 1 and grup.is(type:elite)'
        );
        assert.equal(result.ok, false);
        assert.equal(result.diagnostics.length, 2);
        assert.ok(result.diagnostics[0].start < result.diagnostics[1].start);
    });

    it('turns syntax errors into diagnostics', () => {
        const result = check('x ? a:b');
        assert.equal(result.ok, false);
        assert.equal(result.ast, undefined);
        assert.equal(result.diagnostics[0].start, 4);
    });
});

describe('checker: lint', () => {
    it('flags expressions that never change', () => {
        assert.match(warnings('1 + 1', unitMax)[0], /can't change/);
        assert.deepEqual(warnings('choice(stance) == defensive'), []);
    });

    it('flags comparisons that are always true or false', () => {
        assert.match(
            warnings('group.count(role:troop) >= 0')[0],
            /always true/
        );
        assert.match(warnings('0 > unit.models()')[0], /always false/);
        assert.deepEqual(warnings('group.count(role:troop) >= 1'), []);
    });

    it('points typed rules written as expressions at the typed form', () => {
        assert.match(
            warnings('not unit.has(weapon:twin-blades)', optionWhen)[0],
            /use restrictions\.exclusions/
        );
        assert.match(
            warnings('unit.has(equipment:pack)', optionWhen)[0],
            /use restrictions\.required/
        );
        // the same check elsewhere isn't a restriction
        assert.deepEqual(warnings('unit.has(equipment:pack)', unitWhen), []);
        assert.match(
            warnings(
                'list.sum(points, role:heavy) <= list.limit(points) * 0.25'
            )[0],
            /resourceCap/
        );
        assert.match(
            warnings(
                'list.count(role:heavy) <= 1',
                field(FIELD_SCOPES.list, 'boolean', 'list-rule')
            )[0],
            /count list rule/
        );
    });

    it('skips lint when there are errors', () => {
        const result = check('1 + 1 + group.count(role:trop)', unitMax);
        assert.deepEqual(
            result.diagnostics.map((d) => d.severity),
            ['error']
        );
    });
});

describe('diagnostics', () => {
    it('formats a caret under the problem', () => {
        const source = 'choice(stance) == defensiv';
        const [diagnostic] = check(source).diagnostics;
        assert.equal(
            formatDiagnostic(source, diagnostic),
            [
                '  choice(stance) == defensiv',
                "                    ^^^^^^^^ 'defensiv' isn't a value of stance (did you mean 'defensive'?)",
            ].join('\n')
        );
    });

    it('only suggests close matches', () => {
        assert.equal(closest('troop', ['troops', 'officer']), 'troops');
        assert.equal(closest('xyz', ['troop', 'officer']), undefined);
    });
});
