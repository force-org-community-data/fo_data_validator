import {
    Diagnostic,
    didYouMean,
    ExpressionSyntaxError,
    Severity,
} from './diagnostics';
import { Argument, Expr, parseExpression } from './parser';

/*
 * Load-time checker for expressions (spec §7–§13): names, scopes allowed for
 * the field, verbs on their scopes, references against the game's data,
 * types, and lint. It keeps going after a problem so one pass reports
 * everything; a sub-expression with an error has no type, which silences
 * follow-on errors about it.
 */

export const BUILT_IN_SCOPES = [
    /** a special rule on the unit, for its `grants` */
    'rule',
    'option',
    'profile',
    'unit',
    'slot',
    'group',
    'contingent',
    'root',
    /** the list's main contingent (its root group's type has `source: main`) */
    'main',
    'list',
] as const;

export type BuiltInScope = (typeof BUILT_IN_SCOPES)[number];

/** Scopes each kind of field may use (spec §8.2) */
export const FIELD_SCOPES = {
    /** a detachment's `when`: whether it can be added */
    detachmentWhen: ['contingent', 'root', 'main', 'list'],
    /** a detachment's `min` / `max`, checked once it's in the list */
    detachmentLimit: ['group', 'contingent', 'root', 'main', 'list'],
    slot: ['slot', 'group', 'contingent', 'root', 'main', 'list'],
    unit: ['unit', 'slot', 'group', 'contingent', 'root', 'main', 'list'],
    /** add `profile` when the upgrade has a `profileId` */
    upgrade: ['unit', 'slot', 'group', 'contingent', 'root', 'main', 'list'],
    /** add `profile` when the option's upgrade has a `profileId` */
    option: [
        'option',
        'unit',
        'slot',
        'group',
        'contingent',
        'root',
        'main',
        'list',
    ],
    effect: [
        'profile',
        'unit',
        'slot',
        'group',
        'contingent',
        'root',
        'main',
        'list',
    ],
    /** a special rule's `grants` */
    ruleGrant: [
        'rule',
        'unit',
        'slot',
        'group',
        'contingent',
        'root',
        'main',
        'list',
    ],
    list: ['main', 'list'],
    /** a list rule checked once for each group */
    groupRule: ['group', 'contingent', 'root', 'main', 'list'],
    /** a sub-faction's `when` and its group's `min` / `max`, for the contingent it's taken for */
    subFaction: ['contingent', 'root', 'main', 'list'],
} satisfies Record<string, ReadonlyArray<BuiltInScope>>;

/** What a game (and the faction an expression sits in) defines */
export type ExpressionVocabulary = {
    /** the game's words for built-in scopes, e.g. `{ detachment: 'group', primary: 'root' }` */
    scopeWords?: Record<string, BuiltInScope>;
    units: ReadonlyArray<string>;
    roles: ReadonlyArray<string>;
    unitTypes: ReadonlyArray<string>;
    groupTypes: ReadonlyArray<string>;
    /** detachment record ids */
    groups: ReadonlyArray<string>;
    weapons: ReadonlyArray<string>;
    equipment: ReadonlyArray<string>;
    factions: ReadonlyArray<string>;
    subFactions: ReadonlyArray<string>;
    selectors: ReadonlyArray<string>;
    slotTags: ReadonlyArray<string>;
    /** tags used on units and profiles; tags are free text, so an unknown one is only a warning */
    tags: ReadonlyArray<string>;
    /** traits units have or effects give, in any faction of the game; free text, so an unknown one is only a warning */
    traits?: ReadonlyArray<string>;
    /** resource id → where it's spent */
    resources: Record<string, 'list' | 'unit' | 'contingent'>;
    /** list choice id → its value ids */
    choices: Record<string, ReadonlyArray<string>>;
    /** sub-choice id → its value ids */
    subChoices: Record<string, ReadonlyArray<string>>;
};

export type ExpressionField = {
    scopes: ReadonlyArray<BuiltInScope>;
    result: 'number' | 'boolean';
    /** turns on the "use the typed rule" lint patterns for this kind of field (spec §13) */
    lint?: 'option-when' | 'upgrade-when' | 'list-rule';
};

export type ExpressionType =
    | { kind: 'number' }
    | { kind: 'boolean' }
    /** a list choice's or sub-choice's value */
    | { kind: 'enum'; name: string; values: ReadonlyArray<string> };

/** What a reference means on the scope it was asked about (spec §9.2) */
export type ReferenceKind =
    | 'unit'
    | 'role'
    | 'unitType'
    | 'unitTag'
    /** a unit trait, in `tagId` form */
    | 'trait'
    | 'selector'
    | 'weapon'
    | 'equipment'
    /** a group type or a specific detachment record */
    | 'group'
    | 'groupType'
    | 'slotTag'
    | 'faction'
    | 'subfaction';

export type ResolvedReference = { kind: ReferenceKind; id: string };

/** A checked expression with every scope and reference resolved, ready to evaluate */
export type CompiledExpression = {
    source: string;
    ast: Expr;
    type: ExpressionType;
    /** the built-in scope of each scoped call (game words already translated) */
    scopes: ReadonlyMap<Call, BuiltInScope>;
    references: ReadonlyMap<Argument, ResolvedReference>;
};

export type CheckResult = {
    /** no errors (warnings allowed) */
    ok: boolean;
    diagnostics: Array<Diagnostic>;
    /** undefined when the expression didn't parse or had type errors */
    type?: ExpressionType;
    ast?: Expr;
    /** set when `ok` */
    compiled?: CompiledExpression;
};

const NUMBER: ExpressionType = { kind: 'number' };
const BOOLEAN: ExpressionType = { kind: 'boolean' };

const GLOBAL_FUNCTIONS = ['choice', 'floor', 'ceil', 'min', 'max'];
const UNIT_KINDS = ['unit', 'role', 'type', 'tag', 'trait'];
const WARGEAR_KINDS = ['weapon', 'equipment'];
const REFERENCE_KINDS = [
    ...UNIT_KINDS,
    ...WARGEAR_KINDS,
    'group',
    'faction',
    'subfaction',
];
/** verbs whose results are never negative, for the always-true lint */
const NON_NEGATIVE = ['count', 'sum', 'limit', 'models', 'picks'];

/** Which reference kinds `is()` accepts on each scope */
const IS_KINDS: Partial<Record<BuiltInScope, Array<string>>> = {
    unit: [...UNIT_KINDS, 'selector'],
    profile: ['type', 'tag', 'trait'],
    slot: ['tag', 'role'],
    group: ['type', 'group'],
    root: ['type', 'group'],
    contingent: ['faction', 'subfaction'],
    main: ['faction', 'subfaction'],
    list: ['faction', 'subfaction'],
};

const VERBS: Record<string, ReadonlyArray<BuiltInScope>> = {
    count: ['profile', 'unit', 'group', 'contingent', 'root', 'main', 'list'],
    has: ['profile', 'unit', 'group', 'contingent', 'root', 'main', 'list'],
    is: [
        'profile',
        'unit',
        'slot',
        'group',
        'root',
        'contingent',
        'main',
        'list',
    ],
    sum: ['unit', 'group', 'contingent', 'root', 'main', 'list'],
    limit: ['list', 'unit'],
    models: ['unit'],
    picks: ['option'],
    choice: ['option'],
    value: ['rule'],
};

type Reference = Extract<Argument, { type: 'reference' | 'selector' }>;
export type Call = Extract<Expr, { type: 'call' }>;

/**
 * The id a free-text unit or profile tag is written as in a `tag:` reference:
 * lowercase, with runs of other characters as hyphens (`Heavy Assault` →
 * `heavy-assault`). Tags match case-insensitively, like profile filters.
 */
export const tagId = (tag: string) =>
    tag
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

const isReference = (arg: Argument): arg is Reference =>
    arg.type === 'reference' || arg.type === 'selector';

const describe = (type: ExpressionType) =>
    type.kind === 'enum' ? `a ${type.name} value` : `a ${type.kind}`;

class Checker {
    readonly diagnostics: Array<Diagnostic> = [];
    readonly scopes = new Map<Call, BuiltInScope>();
    readonly references = new Map<Argument, ResolvedReference>();
    private readonly scopeWords: Record<string, BuiltInScope>;

    constructor(
        private readonly vocabulary: ExpressionVocabulary,
        private readonly field: ExpressionField
    ) {
        this.scopeWords = vocabulary.scopeWords ?? {};
    }

    report(
        severity: Severity,
        message: string,
        span: { start: number; end: number }
    ) {
        this.diagnostics.push({ severity, message, ...span });
    }

    /** The built-in scope a written scope name means, if any */
    resolveScope(name: string): BuiltInScope | undefined {
        if ((BUILT_IN_SCOPES as ReadonlyArray<string>).includes(name)) {
            return name as BuiltInScope;
        }
        return this.scopeWords[name];
    }

    /** A reference kind as written, with the game's word for groups accepted */
    private resolveKind(kind: string) {
        return this.scopeWords[kind] === 'group' ? 'group' : kind;
    }

    check(node: Expr): ExpressionType | undefined {
        switch (node.type) {
            case 'number':
                return NUMBER;
            case 'boolean':
                return BOOLEAN;
            case 'name':
                this.unknownName(node);
                return undefined;
            case 'negate':
                return this.expect(node.operand, NUMBER) ? NUMBER : undefined;
            case 'not':
                return this.expect(node.operand, BOOLEAN) ? BOOLEAN : undefined;
            case 'arithmetic': {
                const left = this.expect(node.left, NUMBER);
                const right = this.expect(node.right, NUMBER);
                return left && right ? NUMBER : undefined;
            }
            case 'logical': {
                const left = this.expect(node.left, BOOLEAN);
                const right = this.expect(node.right, BOOLEAN);
                return left && right ? BOOLEAN : undefined;
            }
            case 'compare':
                return this.compare(node);
            case 'conditional': {
                this.expect(node.condition, BOOLEAN);
                const then = this.check(node.then);
                const otherwise = this.check(node.otherwise);
                if (!then || !otherwise) return undefined;
                if (!sameType(then, otherwise)) {
                    this.report(
                        'error',
                        `both branches of a conditional must have the same type (got ${describe(then)} and ${describe(otherwise)})`,
                        node
                    );
                    return undefined;
                }
                return then;
            }
            case 'call':
                return this.call(node);
        }
    }

    /* Checks the node and that it has the wanted type; true when it does */
    private expect(node: Expr, wanted: ExpressionType): boolean {
        const type = this.check(node);
        if (!type) return false;
        if (!sameType(type, wanted)) {
            this.report(
                'error',
                `expected ${describe(wanted)} but this is ${describe(type)}`,
                node
            );
            return false;
        }
        return true;
    }

    private unknownName(node: Extract<Expr, { type: 'name' }>) {
        const hint = node.name.includes('-')
            ? ` (for subtraction, put spaces around '-': ${node.name.split('-').join(' - ')})`
            : didYouMean(node.name, [
                  ...BUILT_IN_SCOPES,
                  ...Object.keys(this.scopeWords),
                  ...GLOBAL_FUNCTIONS,
              ]);
        this.report('error', `unknown name '${node.name}'${hint}`, node);
    }

    private compare(node: Extract<Expr, { type: 'compare' }>) {
        const { left, right, operator } = node;

        // choice(x) == value: the bare name is a value of that choice
        const enumSide = [left, right].find(
            (side) =>
                side.type === 'call' &&
                side.name === 'choice' &&
                (!side.scope || this.resolveScope(side.scope.name) === 'option')
        );
        const nameSide = [left, right].find((side) => side.type === 'name');
        if (enumSide && nameSide?.type === 'name') {
            const type = this.check(enumSide);
            if (type?.kind !== 'enum') return undefined;
            if (operator !== '==' && operator !== '!=') {
                this.report(
                    'error',
                    `choices can only be compared with '==' or '!='`,
                    node
                );
                return undefined;
            }
            if (!type.values.includes(nameSide.name)) {
                this.report(
                    'error',
                    `'${nameSide.name}' isn't a value of ${type.name}${didYouMean(nameSide.name, type.values)}`,
                    nameSide
                );
                return undefined;
            }
            return BOOLEAN;
        }

        const leftType = this.check(left);
        const rightType = this.check(right);
        if (!leftType || !rightType) return undefined;

        if (!sameType(leftType, rightType)) {
            this.report(
                'error',
                `can't compare ${describe(leftType)} with ${describe(rightType)}`,
                node
            );
            return undefined;
        }
        if (
            operator !== '==' &&
            operator !== '!=' &&
            leftType.kind !== 'number'
        ) {
            this.report(
                'error',
                `'${operator}' compares numbers, not ${describe(leftType)}s`,
                node
            );
            return undefined;
        }
        return BOOLEAN;
    }

    private call(node: Call): ExpressionType | undefined {
        if (!node.scope) return this.globalCall(node);

        const scope = this.resolveScope(node.scope.name);
        if (!scope) {
            this.report(
                'error',
                `unknown scope '${node.scope.name}'${didYouMean(node.scope.name, [...BUILT_IN_SCOPES, ...Object.keys(this.scopeWords)])}`,
                node.scope
            );
            return undefined;
        }
        if (!this.field.scopes.includes(scope)) {
            this.report(
                'error',
                `'${node.scope.name}' isn't available here (allowed: ${[...this.field.scopes].sort().join(', ')})`,
                node.scope
            );
            return undefined;
        }

        const verbScopes = VERBS[node.name];
        if (!verbScopes || !verbScopes.includes(scope)) {
            const valid = Object.keys(VERBS).filter((verb) =>
                VERBS[verb].includes(scope)
            );
            this.report(
                'error',
                verbScopes
                    ? `${node.scope.name}.${node.name}() isn't available (on ${node.scope.name}: ${valid.join(', ')})`
                    : `unknown function '${node.name}'${didYouMean(node.name, valid)}`,
                node.nameSpan
            );
            return undefined;
        }

        this.scopes.set(node, scope);
        switch (node.name) {
            case 'count':
            case 'has':
                return this.countOrHas(node, scope);
            case 'is':
                return this.is(node, scope);
            case 'sum':
                return this.sum(node, scope);
            case 'limit':
                return this.limit(node, scope);
            case 'models':
            case 'picks':
            case 'value':
                return this.arity(node, 0) ? NUMBER : undefined;
            case 'choice':
                return this.subChoice(node);
        }
        return undefined;
    }

    /* Reports a wrong argument count; true when it's right */
    private arity(node: Call, count: number, most = count) {
        if (node.args.length >= count && node.args.length <= most) return true;

        const wanted =
            count === most
                ? `${count} argument${count === 1 ? '' : 's'}`
                : `${count} or ${most} arguments`;
        this.report('error', `${node.name}() takes ${wanted}`, node);
        return false;
    }

    private globalCall(node: Call): ExpressionType | undefined {
        switch (node.name) {
            case 'choice': {
                const arg = node.args[0];
                if (!this.arity(node, 1)) return undefined;
                if (arg.type !== 'name') {
                    this.report(
                        'error',
                        'choice() takes the name of a list choice, e.g. choice(stance)',
                        arg
                    );
                    return undefined;
                }
                const values = this.vocabulary.choices[arg.name];
                if (!values) {
                    this.report(
                        'error',
                        `unknown list choice '${arg.name}'${didYouMean(arg.name, Object.keys(this.vocabulary.choices))}`,
                        arg
                    );
                    return undefined;
                }
                return { kind: 'enum', name: arg.name, values };
            }
            case 'floor':
            case 'ceil':
                return this.arity(node, 1) && this.numbers(node.args)
                    ? NUMBER
                    : undefined;
            case 'min':
            case 'max':
                if (node.args.length < 2) {
                    this.report(
                        'error',
                        `${node.name}() takes two or more numbers`,
                        node
                    );
                    return undefined;
                }
                return this.numbers(node.args) ? NUMBER : undefined;
        }

        const scope = this.resolveScope(node.name);
        this.report(
            'error',
            scope
                ? `'${node.name}' is a scope; call a function on it, e.g. ${node.name}.count(…)`
                : `unknown function '${node.name}'${didYouMean(node.name, GLOBAL_FUNCTIONS)}`,
            node.nameSpan
        );
        return undefined;
    }

    /* Checks every argument is a number expression; true when they all are */
    private numbers(args: Array<Argument>) {
        let ok = true;
        for (const arg of args) {
            if (isReference(arg)) {
                this.report('error', 'expected a number, not a reference', arg);
                ok = false;
            } else if (!this.expect(arg, NUMBER)) {
                ok = false;
            }
        }
        return ok;
    }

    private countOrHas(node: Call, scope: BuiltInScope) {
        if (!this.arity(node, 1)) return undefined;

        const arg = node.args[0];
        const result = node.name === 'count' ? NUMBER : BOOLEAN;
        const kinds: Array<string> = [];
        if (scope !== 'profile' && scope !== 'unit')
            kinds.push(...UNIT_KINDS, 'selector');
        kinds.push(...WARGEAR_KINDS);
        if (scope === 'contingent' || scope === 'main' || scope === 'list')
            kinds.push('group');

        const kind = isReference(arg)
            ? arg.type === 'selector'
                ? 'selector'
                : this.resolveKind(arg.kind)
            : undefined;
        if (
            scope === 'unit' &&
            kind &&
            (kind === 'selector' || UNIT_KINDS.includes(kind))
        ) {
            this.report(
                'error',
                `use unit.is(…) to test the unit itself; unit.${node.name}() only counts wargear`,
                node
            );
            return undefined;
        }

        return this.reference(node, arg, kinds, scope) ? result : undefined;
    }

    private is(node: Call, scope: BuiltInScope) {
        if (!this.arity(node, 1)) return undefined;
        return this.reference(node, node.args[0], IS_KINDS[scope] ?? [], scope)
            ? BOOLEAN
            : undefined;
    }

    private sum(node: Call, scope: BuiltInScope) {
        if (!this.arity(node, 1, scope === 'unit' ? 1 : 2)) return undefined;
        if (!this.resource(node.args[0])) return undefined;
        if (node.args[1]) {
            return this.reference(
                node,
                node.args[1],
                [...UNIT_KINDS, 'selector'],
                scope
            )
                ? NUMBER
                : undefined;
        }
        return NUMBER;
    }

    private limit(node: Call, scope: BuiltInScope) {
        if (!this.arity(node, 1)) return undefined;
        const resource = this.resource(node.args[0]);
        if (!resource) return undefined;

        const where = this.vocabulary.resources[resource];
        if (where !== scope) {
            this.report(
                'error',
                `'${resource}' is a ${where} resource; use ${where}.limit(${resource})`,
                node
            );
            return undefined;
        }
        return NUMBER;
    }

    /* A resource id argument; returns it when known */
    private resource(arg: Argument): string | undefined {
        const ids = Object.keys(this.vocabulary.resources);
        if (arg.type !== 'name') {
            this.report(
                'error',
                `expected a resource id (${ids.join(', ')})`,
                arg
            );
            return undefined;
        }
        if (!ids.includes(arg.name)) {
            this.report(
                'error',
                `unknown resource '${arg.name}'${didYouMean(arg.name, ids)}`,
                arg
            );
            return undefined;
        }
        return arg.name;
    }

    private subChoice(node: Call): ExpressionType | undefined {
        if (!this.arity(node, 1)) return undefined;
        const arg = node.args[0];
        const ids = Object.keys(this.vocabulary.subChoices);
        if (arg.type !== 'name') {
            this.report(
                'error',
                'option.choice() takes the name of a sub-choice, e.g. option.choice(facing)',
                arg
            );
            return undefined;
        }
        const values = this.vocabulary.subChoices[arg.name];
        if (!values) {
            this.report(
                'error',
                `unknown sub-choice '${arg.name}'${didYouMean(arg.name, ids)}`,
                arg
            );
            return undefined;
        }
        return { kind: 'enum', name: arg.name, values };
    }

    /*
     * Checks a reference argument: its kind is allowed for the call and its id
     * exists, looked up against the scope it's asked about (spec §9.2).
     */
    private reference(
        node: Call,
        arg: Argument,
        kinds: Array<string>,
        scope: BuiltInScope
    ) {
        const allowed = kinds
            .map((kind) => (kind === 'selector' ? '@selector' : `${kind}:`))
            .join(', ');
        const call = `${node.scope ? `${node.scope.name}.` : ''}${node.name}()`;

        if (!isReference(arg)) {
            this.report('error', `${call} takes a reference (${allowed})`, arg);
            return false;
        }

        if (arg.type === 'selector') {
            if (!kinds.includes('selector')) {
                this.report(
                    'error',
                    `${call} doesn't take a selector (expected ${allowed})`,
                    arg
                );
                return false;
            }
            return this.resolved(
                arg,
                'selector',
                this.known(arg, 'selector', arg.id, this.vocabulary.selectors)
            );
        }

        const kind = this.resolveKind(arg.kind);
        if (!REFERENCE_KINDS.includes(kind)) {
            this.report(
                'error',
                `unknown reference kind '${arg.kind}:'${didYouMean(arg.kind, REFERENCE_KINDS)}`,
                arg.kindSpan
            );
            return false;
        }
        if (!kinds.includes(kind)) {
            this.report(
                'error',
                `${call} doesn't take '${arg.kind}:' (expected ${allowed})`,
                arg.kindSpan
            );
            return false;
        }

        const v = this.vocabulary;
        const groupScope = scope === 'group' || scope === 'root';
        switch (kind) {
            case 'unit':
                return this.resolved(
                    arg,
                    'unit',
                    this.known(arg, 'unit', arg.id, v.units)
                );
            case 'role':
                return this.resolved(
                    arg,
                    'role',
                    this.known(arg, 'role', arg.id, v.roles)
                );
            case 'type':
                return groupScope
                    ? this.resolved(
                          arg,
                          'groupType',
                          this.known(arg, 'group type', arg.id, v.groupTypes)
                      )
                    : this.resolved(
                          arg,
                          'unitType',
                          this.known(arg, 'unit type', arg.id, v.unitTypes)
                      );
            case 'tag':
                if (scope === 'slot') {
                    return this.resolved(
                        arg,
                        'slotTag',
                        this.known(arg, 'slot tag', arg.id, v.slotTags)
                    );
                }
                if (!v.tags.map(tagId).includes(arg.id)) {
                    this.report(
                        'warning',
                        `no unit or profile has the tag '${arg.id}'${didYouMean(arg.id, v.tags.map(tagId))}`,
                        arg
                    );
                }
                return this.resolved(arg, 'unitTag', true);
            case 'trait': {
                const traits = (v.traits ?? []).map(tagId);
                if (!traits.includes(arg.id)) {
                    this.report(
                        'warning',
                        `no unit has or is given the trait '${arg.id}'${didYouMean(arg.id, traits)}`,
                        arg
                    );
                }
                return this.resolved(arg, 'trait', true);
            }
            case 'weapon':
                return this.resolved(
                    arg,
                    'weapon',
                    this.known(arg, 'weapon', arg.id, v.weapons)
                );
            case 'equipment':
                return this.resolved(
                    arg,
                    'equipment',
                    this.known(arg, 'equipment', arg.id, v.equipment)
                );
            case 'group':
                return this.resolved(
                    arg,
                    'group',
                    this.known(arg, 'group type or detachment', arg.id, [
                        ...v.groupTypes,
                        ...v.groups,
                    ])
                );
            case 'faction':
                return this.resolved(
                    arg,
                    'faction',
                    this.known(arg, 'faction', arg.id, v.factions)
                );
            case 'subfaction':
                return this.resolved(
                    arg,
                    'subfaction',
                    this.known(arg, 'sub-faction', arg.id, v.subFactions)
                );
        }
        return false;
    }

    /* records what a valid reference resolved to; passes `ok` through */
    private resolved(arg: Reference, kind: ReferenceKind, ok: boolean) {
        if (ok) this.references.set(arg, { kind, id: arg.id });
        return ok;
    }

    private known(
        span: { start: number; end: number },
        what: string,
        id: string,
        ids: ReadonlyArray<string>
    ) {
        if (ids.includes(id)) return true;
        this.report(
            'error',
            `unknown ${what} '${id}'${didYouMean(id, ids)}`,
            span
        );
        return false;
    }
}

function sameType(a: ExpressionType, b: ExpressionType) {
    if (a.kind !== b.kind) return false;
    return a.kind !== 'enum' || (b.kind === 'enum' && a.name === b.name);
}

/* ------------------------------------------------------------------ */
/* Lint (spec §13)                                                     */
/* ------------------------------------------------------------------ */

function* walk(node: Argument): Generator<Argument> {
    yield node;
    switch (node.type) {
        case 'negate':
        case 'not':
            yield* walk(node.operand);
            break;
        case 'arithmetic':
        case 'compare':
        case 'logical':
            yield* walk(node.left);
            yield* walk(node.right);
            break;
        case 'conditional':
            yield* walk(node.condition);
            yield* walk(node.then);
            yield* walk(node.otherwise);
            break;
        case 'call':
            for (const arg of node.args) yield* walk(arg);
            break;
    }
}

function lint(checker: Checker, ast: Expr, field: ExpressionField) {
    const scopeOf = (node: Argument) =>
        node.type === 'call' && node.scope
            ? checker.resolveScope(node.scope.name)
            : undefined;
    const isCall = (
        node: Argument,
        scope: BuiltInScope,
        name: string
    ): node is Call =>
        node.type === 'call' && node.name === name && scopeOf(node) === scope;
    const reads = [...walk(ast)].some(
        (node) => node.type === 'call' && (node.scope || node.name === 'choice')
    );

    if (!reads) {
        checker.report(
            'warning',
            "this expression can't change; write the value directly",
            ast
        );
    }

    // comparisons that are always true or false: a count can't be negative
    for (const node of walk(ast)) {
        if (node.type !== 'compare') continue;
        const flipped = {
            '<': '>',
            '<=': '>=',
            '>': '<',
            '>=': '<=',
            '==': '==',
            '!=': '!=',
        } as const;
        const [call, literal, operator] =
            node.right.type === 'number'
                ? [node.left, node.right.value, node.operator]
                : [
                      node.right,
                      node.left.type === 'number' ? node.left.value : NaN,
                      flipped[node.operator],
                  ];
        if (
            call.type !== 'call' ||
            !call.scope ||
            !NON_NEGATIVE.includes(call.name) ||
            Number.isNaN(literal)
        ) {
            continue;
        }
        const always =
            (operator === '>=' && literal <= 0) ||
            (operator === '>' && literal < 0)
                ? 'true'
                : (operator === '<' && literal <= 0) ||
                    (operator === '<=' && literal < 0)
                  ? 'false'
                  : undefined;
        if (always) {
            checker.report(
                'warning',
                `this comparison is always ${always} (${call.name}() is never negative)`,
                node
            );
        }
    }

    // typed rules written as expressions
    const wargear = (node: Argument) =>
        isCall(node, 'unit', 'has') &&
        node.args[0]?.type === 'reference' &&
        WARGEAR_KINDS.includes(node.args[0].kind);
    if (field.lint === 'option-when' || field.lint === 'upgrade-when') {
        if (ast.type === 'not' && wargear(ast.operand)) {
            checker.report(
                'warning',
                'this is an exclusion: use restrictions.exclusions (works both ways and fixes picks)',
                ast
            );
        } else if (wargear(ast)) {
            checker.report(
                'warning',
                'this is a requirement: use restrictions.required',
                ast
            );
        }
    }

    for (const node of walk(ast)) {
        if (
            node.type !== 'compare' ||
            (node.operator !== '<=' && node.operator !== '<')
        )
            continue;
        const { left, right } = node;
        const limitSide =
            right.type === 'arithmetic' &&
            (right.operator === '*' || right.operator === '/')
                ? [right.left, right.right]
                : [];
        const limitCall = limitSide.find((side) =>
            isCall(side, 'list', 'limit')
        );
        const factor = limitSide.find((side) => side.type === 'number');
        if (isCall(left, 'list', 'sum') && limitCall && factor) {
            checker.report(
                'warning',
                'this is a percentage cap: use a resourceCap list rule',
                node
            );
        }
    }

    if (
        field.lint === 'list-rule' &&
        ast.type === 'compare' &&
        (ast.operator === '<=' || ast.operator === '<') &&
        isCall(ast.left, 'list', 'count') &&
        ast.right.type === 'number'
    ) {
        checker.report(
            'warning',
            'this is a count limit: use a count list rule',
            ast
        );
    }
}

/* ------------------------------------------------------------------ */

/** Parses and checks an expression for a field (spec §12) */
export function checkExpression(
    source: string,
    field: ExpressionField,
    vocabulary: ExpressionVocabulary
): CheckResult {
    let ast: Expr;
    try {
        ast = parseExpression(source);
    } catch (error) {
        if (error instanceof ExpressionSyntaxError) {
            return { ok: false, diagnostics: [error.toDiagnostic()] };
        }
        throw error;
    }

    const checker = new Checker(vocabulary, field);
    let type = checker.check(ast);

    if (type && type.kind !== field.result) {
        checker.report(
            'error',
            `this field needs a ${field.result} but the expression is ${describe(type)}`,
            ast
        );
        type = undefined;
    }

    const hasErrors = () =>
        checker.diagnostics.some((d) => d.severity === 'error');
    if (!hasErrors()) lint(checker, ast, field);

    const ok = !hasErrors();
    return {
        ok,
        diagnostics: checker.diagnostics.sort((a, b) => a.start - b.start),
        type,
        ast,
        ...(ok &&
            type && {
                compiled: {
                    source,
                    ast,
                    type,
                    scopes: checker.scopes,
                    references: checker.references,
                },
            }),
    };
}
