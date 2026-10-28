import { usedFor } from './resources';
import {
    checkExpression,
    ExpressionField,
    ExpressionVocabulary,
    FIELD_SCOPES,
    BuiltInScope,
    BUILT_IN_SCOPES,
    tagId,
} from '../expressions/checker';
import { didYouMean } from '../expressions/diagnostics';
import { DEFAULT_SUB_FACTION_GROUP } from './schema';
import type {
    AddedSlot,
    Condition,
    Detachment,
    Faction,
    FactionRecords,
    GameSystem,
    NumberOrExpr,
    Option,
    CostTarget,
    SlotOption,
    SlotSource,
    SlotUnitEffect,
    SpecialRule,
    SubChoice,
    SpecialRuleEffect,
    SpecialRuleSelection,
    StatEffect,
    SubFaction,
    TraitEffect,
    SubFactionGroup,
    Unit,
    UnitExclusion,
    UnitSelectorOrRef,
    Upgrade,
    UpgradeReference,
    WargearRef,
} from '../types';
import { buildVocabulary } from './vocabulary';

/*
 * Integrity checks for game data in the new schema (data schema spec §11): ids
 * equal keys, every reference resolves, stats match their templates, and every
 * expression checks for its field. Runs on load in the app and in the
 * integrity test. Assumes the files already have the right shape.
 */

export type DataIssue = {
    severity: 'error' | 'warning';
    /** the file, as listed in the manifest */
    file: string;
    /** where in the file, e.g. `units/infantry-squad/upgrades/sgt-pistol` */
    path: string;
    message: string;
    /** expressions only: the source and the problem's span in it */
    expression?: { source: string; start: number; end: number };
};

export type DataFile<T> = { file: string; data: T };

export type GameDataSet = {
    game: DataFile<GameSystem>;
    factions: Array<DataFile<Faction>>;
    subFactions: Array<DataFile<SubFaction>>;
};

const RECORD_KINDS = [
    'units',
    'weapons',
    'equipment',
    'upgrades',
    'specialRules',
    'detachments',
    'selectors',
    'slotOptions',
    'subChoices',
] as const satisfies ReadonlyArray<keyof FactionRecords>;

const keys = (record?: object) => Object.keys(record ?? {});

/* Structural equality of JSON data */
function sameData(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b)
        return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return (
        ak.length === bk.length &&
        ak.every(
            (k) =>
                k in b &&
                sameData(
                    (a as Record<string, unknown>)[k],
                    (b as Record<string, unknown>)[k]
                )
        )
    );
}

const TARGET_NAMES: Record<CostTarget, string> = {
    unit: 'unit costs',
    additionalModels: 'additional model costs',
    option: 'option costs',
    slotOption: 'slot option costs',
    group: 'group costs',
    grant: 'grants',
};

/** Records a faction (with a sub-faction merged in, if any) and its game define */
type Scope = {
    game: GameSystem;
    records: Partial<FactionRecords>;
    vocabulary: ExpressionVocabulary;
    unitStats: Set<string>;
};

class Validator {
    readonly issues: Array<DataIssue> = [];

    constructor(private readonly set: GameDataSet) {}

    private file = '';

    private report(
        path: string,
        message: string,
        severity: DataIssue['severity'] = 'error'
    ) {
        this.issues.push({ severity, file: this.file, path, message });
    }

    /* ids equal keys in a record map */
    private ids(
        path: string,
        record: Record<string, { id: string }> | undefined
    ) {
        for (const [key, value] of Object.entries(record ?? {})) {
            if (value?.id !== key)
                this.report(
                    `${path}/${key}`,
                    `id is '${value?.id}', but the key is '${key}'`
                );
        }
    }

    private known(
        path: string,
        what: string,
        id: string,
        ids: Iterable<string>
    ) {
        if (![...ids].includes(id))
            this.report(path, `unknown ${what} '${id}'`);
    }

    private expression(
        path: string,
        source: string,
        scopes: ReadonlyArray<BuiltInScope>,
        result: ExpressionField['result'],
        vocabulary: ExpressionVocabulary,
        lint?: ExpressionField['lint']
    ) {
        const { diagnostics } = checkExpression(
            source,
            { scopes, result, lint },
            vocabulary
        );
        for (const d of diagnostics) {
            this.issues.push({
                severity: d.severity,
                file: this.file,
                path,
                message: d.message,
                expression: { source, start: d.start, end: d.end },
            });
        }
    }

    private numberOrExpr(
        path: string,
        value: NumberOrExpr | undefined,
        scopes: ReadonlyArray<BuiltInScope>,
        vocabulary: ExpressionVocabulary
    ) {
        if (typeof value === 'string')
            this.expression(path, value, scopes, 'number', vocabulary);
    }

    private condition(
        path: string,
        condition: Condition | undefined,
        scopes: ReadonlyArray<BuiltInScope>,
        vocabulary: ExpressionVocabulary,
        lint?: ExpressionField['lint']
    ) {
        if (!condition) return;
        const at = path ? `${path}/when` : 'when';
        if (!condition.message?.trim())
            this.report(at, 'a condition needs a message for players');
        this.expression(
            at,
            condition.if,
            scopes,
            'boolean',
            vocabulary,
            lint
        );
    }

    /* ---------------------------------------------------------------- */

    run() {
        const { game, factions, subFactions } = this.set;
        this.file = game.file;
        this.gameSystem(game.data);

        for (const faction of factions) {
            this.file = faction.file;
            this.faction(faction.data);
        }
        for (const sub of subFactions) {
            this.file = sub.file;
            this.subFaction(sub.data);
        }
        for (const faction of factions) this.combinedSubFactions(faction.data);
        return this.issues;
    }

    private scopeFor(records: Array<Partial<FactionRecords>>): Scope {
        const game = this.set.game.data;
        const merged: Partial<FactionRecords> = {};
        for (const kind of RECORD_KINDS) {
            (merged as Record<string, object>)[kind] = Object.assign(
                {},
                ...records.map((r) => r[kind] ?? {})
            );
        }
        return {
            game,
            records: merged,
            vocabulary: buildVocabulary(
                game,
                records,
                this.set.factions.map((f) => f.data),
                this.set.subFactions.map((s) => s.data)
            ),
            unitStats: new Set(
                Object.values(game.stats.unit).flatMap((t) =>
                    t.stats.map((s) => s.id)
                )
            ),
        };
    }

    private gameSystem(game: GameSystem) {
        for (const kind of [
            'roles',
            'unitTypes',
            'groupTypes',
            'slotTags',
            'resources',
            'choices',
            'listRules',
            'detachments',
            'specialRules',
            'selectors',
            'slotOptions',
            'subChoices',
        ] as const) {
            this.ids(
                kind,
                game[kind] as Record<string, { id: string }> | undefined
            );
        }
        for (const kind of ['unit', 'weapon'] as const) {
            this.ids(`stats/${kind}`, game.stats[kind]);
            for (const template of Object.values(game.stats[kind])) {
                const ids = template.stats.map((s) => s.id);
                if (new Set(ids).size !== ids.length)
                    this.report(
                        `stats/${kind}/${template.id}`,
                        'stat ids repeat'
                    );
            }
        }
        for (const choice of Object.values(game.choices ?? {})) {
            this.ids(`choices/${choice.id}/values`, choice.values);
            if (choice.default && !(choice.default in choice.values)) {
                this.report(
                    `choices/${choice.id}`,
                    `default '${choice.default}' isn't one of its values`
                );
            }
        }
        // words in terms must not hijack a different built-in scope
        const words = new Map<string, string>();
        for (const [key, term] of Object.entries(game.terms ?? {})) {
            if (!term?.word) continue;
            const builtIn = (BUILT_IN_SCOPES as ReadonlyArray<string>).includes(
                term.word
            );
            if (builtIn && term.word !== key)
                this.report(
                    `terms/${key}`,
                    `'${term.word}' is already a built-in scope`
                );
            if (words.has(term.word) && words.get(term.word) !== key) {
                this.report(
                    `terms/${key}`,
                    `'${term.word}' is also the word for ${words.get(term.word)}`
                );
            }
            words.set(term.word, key);
        }

        const groupTypes = keys(game.groupTypes);
        for (const type of Object.values(game.groupTypes)) {
            if (typeof type.contingent === 'object') {
                for (const t of type.contingent.linksTo)
                    this.known(
                        `groupTypes/${type.id}`,
                        'group type',
                        t,
                        groupTypes
                    );
            }
        }
        for (const id of keys(game.detachments)) {
            if (groupTypes.includes(id))
                this.report(
                    `detachments/${id}`,
                    'a detachment id may not equal a group type id'
                );
        }

        const unitStats = Object.values(game.stats.unit).flatMap((t) =>
            t.stats.map((s) => s.id)
        );
        for (const resource of Object.values(game.resources)) {
            if (resource.scope === 'unit') {
                if (!resource.capacityStat)
                    this.report(
                        `resources/${resource.id}`,
                        'a unit resource needs a capacityStat'
                    );
                else
                    this.known(
                        `resources/${resource.id}`,
                        'stat',
                        resource.capacityStat,
                        unitStats
                    );
            }
        }

        const scope = this.scopeFor([]);
        const vocabulary = scope.vocabulary;
        for (const type of Object.values(game.groupTypes)) {
            this.numberOrExpr(
                `groupTypes/${type.id}/min`,
                type.min,
                FIELD_SCOPES.list,
                vocabulary
            );
            this.numberOrExpr(
                `groupTypes/${type.id}/max`,
                type.max,
                FIELD_SCOPES.list,
                vocabulary
            );
        }

        for (const rule of Object.values(game.listRules ?? {})) {
            const path = `listRules/${rule.id}`;
            switch (rule.kind) {
                case 'resourceCap':
                    this.known(
                        path,
                        'resource',
                        rule.resource,
                        keys(game.resources)
                    );
                    this.selector(path, rule.units, scope);
                    for (const t of rule.contingentTypes ?? [])
                        this.known(path, 'group type', t, groupTypes);
                    if ('value' in rule.max)
                        this.numberOrExpr(
                            `${path}/max`,
                            rule.max.value,
                            FIELD_SCOPES.list,
                            vocabulary
                        );
                    break;
                case 'count': {
                    this.selector(path, rule.units, scope);
                    for (const t of rule.groupTypes ?? [])
                        this.known(path, 'group type', t, groupTypes);
                    const scopes: Array<BuiltInScope> =
                        rule.scope === 'list'
                            ? ['main', 'list']
                            : [rule.scope, 'root', 'main', 'list'];
                    this.numberOrExpr(
                        `${path}/min`,
                        rule.min,
                        scopes,
                        vocabulary
                    );
                    this.numberOrExpr(
                        `${path}/max`,
                        rule.max,
                        scopes,
                        vocabulary
                    );
                    break;
                }
                case 'expression':
                    this.condition(
                        path,
                        rule.when,
                        FIELD_SCOPES.list,
                        vocabulary,
                        'list-rule'
                    );
                    break;
            }
        }

        // contingent resources: roles grant them, group types cost them
        for (const role of Object.values(game.roles))
            if (role.grants)
                this.costs(
                    `roles/${role.id}/grants`,
                    role.grants,
                    scope,
                    FIELD_SCOPES.slot,
                    'grant'
                );
        for (const type of Object.values(game.groupTypes))
            if (type.cost)
                this.costs(
                    `groupTypes/${type.id}/cost`,
                    type.cost,
                    scope,
                    FIELD_SCOPES.detachmentLimit,
                    'group'
                );

        this.detachments('detachments', game.detachments, scope);
        this.specialRules('specialRules', game.specialRules, scope);
        this.subChoices(game.subChoices, scope);
        this.slotOptions('slotOptions', game.slotOptions, scope);
        for (const selector of Object.values(game.selectors ?? {}))
            this.selector(`selectors/${selector.id}`, selector.match, scope);
    }

    /* ---------------------------------------------------------------- */

    private faction(faction: Faction) {
        const game = this.set.game.data;
        if (faction.game.id !== game.id)
            this.report(
                'game',
                `this faction is for '${faction.game.id}', not '${game.id}'`
            );
        for (const kind of RECORD_KINDS)
            this.ids(
                kind,
                faction[kind] as Record<string, { id: string }> | undefined
            );
        if (faction.defaultDetachment) {
            const id = faction.defaultDetachment;
            const detachment =
                faction.detachments?.[id] ?? game.detachments?.[id];
            const type = detachment && game.groupTypes[detachment.type];
            if (!detachment)
                this.report('defaultDetachment', `unknown detachment '${id}'`);
            else if (
                type?.contingent !== 'root' ||
                (type.source ?? 'main') !== 'main'
            )
                this.report(
                    'defaultDetachment',
                    `'${id}' isn't a detachment a list starts with (a root group type from the main faction)`
                );
        }

        // a faction's record with the same id as the game's hides it; almost always a mistake
        for (const kind of [
            'specialRules',
            'detachments',
            'selectors',
            'slotOptions',
            'subChoices',
        ] as const) {
            for (const id of keys(faction[kind])) {
                if (id in (game[kind] ?? {}))
                    this.report(
                        `${kind}/${id}`,
                        `hides the game's ${kind} '${id}'`,
                        'warning'
                    );
            }
        }
        for (const id of keys(faction.detachments)) {
            if (id in game.groupTypes)
                this.report(
                    `detachments/${id}`,
                    'a detachment id may not equal a group type id'
                );
        }

        const scope = this.scopeFor([faction]);
        this.records(faction, scope);

        this.ids('subFactionGroups', faction.subFactionGroups);
        for (const group of Object.values(faction.subFactionGroups ?? {})) {
            const at = `subFactionGroups/${group.id}`;
            this.numberOrExpr(
                `${at}/min`,
                group.min,
                FIELD_SCOPES.subFaction,
                scope.vocabulary
            );
            this.numberOrExpr(
                `${at}/max`,
                group.max,
                FIELD_SCOPES.subFaction,
                scope.vocabulary
            );
            const min = group.min ?? 0;
            const max = group.max ?? 1;
            if (typeof min === 'number' && typeof max === 'number' && min > max)
                this.report(at, `min ${min} is more than max ${max}`);
        }
    }

    /* The group a sub-faction is in, or undefined when it names an unknown one */
    private groupOf(
        sub: SubFaction,
        parent: Faction
    ): { id: string; group?: SubFactionGroup } | undefined {
        const id = sub.group ?? DEFAULT_SUB_FACTION_GROUP;
        const group = parent.subFactionGroups?.[id];
        if (!group && id !== DEFAULT_SUB_FACTION_GROUP) return undefined;
        return { id, group };
    }

    /*
     * Sub-factions of the same parent that a contingent can take together (in
     * different groups, or in one group whose max may exceed 1) are merged into
     * one set of records, so they must not define the same record or unit
     * modifier differently. Identical copies are fine. Reported in the later
     * file. Each sub-faction was already checked against its parent alone.
     */
    private combinedSubFactions(parent: Faction) {
        const subs = this.set.subFactions.filter(
            (s) => s.data.parent.faction === parent.id
        );
        const multiple = (group?: SubFactionGroup) => {
            const max = group?.max ?? 1;
            return typeof max === 'string' || max > 1;
        };
        subs.forEach((b, j) => {
            const bGroup = this.groupOf(b.data, parent);
            if (!bGroup) return;
            for (const a of subs.slice(0, j)) {
                const aGroup = this.groupOf(a.data, parent);
                if (!aGroup) continue;
                if (aGroup.id === bGroup.id && !multiple(aGroup.group))
                    continue;
                this.file = b.file;
                const other = `sub-faction '${a.data.id}' (${a.file})`;
                const why =
                    aGroup.id === bGroup.id
                        ? `group '${aGroup.id}' allows more than one`
                        : `they're in groups '${aGroup.id}' and '${bGroup.id}'`;
                for (const kind of [...RECORD_KINDS, 'unitModifiers'] as const) {
                    const mine = (b.data[kind] ?? {}) as Record<string, unknown>;
                    const theirs = (a.data[kind] ?? {}) as Record<
                        string,
                        unknown
                    >;
                    for (const id of keys(mine)) {
                        if (!(id in theirs) || sameData(mine[id], theirs[id]))
                            continue;
                        const overridden =
                            kind !== 'unitModifiers' &&
                            id in ((parent[kind] as object) ?? {});
                        this.report(
                            `${kind}/${id}`,
                            overridden
                                ? `${other} also overrides the parent's ${kind} '${id}', differently, and both can be taken together (${why}); make the replacements identical, or keep the two from being taken together`
                                : `${other} also defines ${kind} '${id}', differently, and both can be taken together (${why}); make them identical or rename one`
                        );
                    }
                }
            }
        });
    }

    private subFaction(sub: SubFaction) {
        const parent = this.set.factions.find(
            (f) => f.data.id === sub.parent.faction
        )?.data;
        if (!parent) {
            this.report(
                'parent',
                `parent faction '${sub.parent.faction}' isn't loaded`
            );
            return;
        }
        for (const kind of RECORD_KINDS)
            this.ids(
                kind,
                sub[kind] as Record<string, { id: string }> | undefined
            );

        const overrides = sub.overrides ?? [];
        for (const kind of RECORD_KINDS) {
            for (const id of keys(sub[kind])) {
                if (
                    id in (parent[kind] ?? {}) &&
                    !overrides.some((o) => o.kind === kind && o.id === id)
                ) {
                    this.report(
                        `${kind}/${id}`,
                        `collides with the parent's ${kind} '${id}'; list it in overrides if that's intended`
                    );
                }
            }
        }
        for (const o of overrides) {
            if (!(o.id in ((parent[o.kind] as object) ?? {})))
                this.report(
                    `overrides`,
                    `the parent has no ${o.kind} '${o.id}' to override`
                );
        }

        const scope = this.scopeFor([parent, sub]);
        this.records(sub, scope);

        if (!this.groupOf(sub, parent)) {
            const groups = [
                DEFAULT_SUB_FACTION_GROUP,
                ...keys(parent.subFactionGroups),
            ];
            this.report(
                'group',
                `'${parent.id}' has no sub-faction group '${sub.group}'${didYouMean(sub.group!, groups)}`
            );
        }
        this.condition('', sub.when, FIELD_SCOPES.subFaction, scope.vocabulary);

        for (const modifier of Object.values(sub.unitModifiers ?? {})) {
            const path = `unitModifiers/${modifier.id}`;
            this.selector(path, modifier.selector, scope);
            modifier.actions.forEach((action, i) => {
                const at = `${path}/actions/${i}`;
                if (action.kind === 'addUpgrade')
                    this.known(
                        at,
                        'faction upgrade',
                        action.upgradeId,
                        keys(scope.records.upgrades)
                    );
                else if (action.kind === 'unavailable') {
                    if (!action.message?.trim())
                        this.report(at, 'needs a message for players');
                } else this.effect(at, action, scope, FIELD_SCOPES.effect);
            });
        }
        this.ids('unitModifiers', sub.unitModifiers);
    }

    /* ---------------------------------------------------------------- */

    /* checks the records a faction or sub-faction defines, resolving against `scope` */
    private records(r: Partial<FactionRecords>, scope: Scope) {
        const { game } = scope;
        for (const weapon of Object.values(r.weapons ?? {})) {
            const template = game.stats.weapon[weapon.template];
            if (!template) {
                this.report(
                    `weapons/${weapon.id}`,
                    `unknown weapon template '${weapon.template}'`
                );
                continue;
            }
            weapon.profiles.forEach((p, i) =>
                this.stats(
                    `weapons/${weapon.id}/profiles/${i}`,
                    p.stats,
                    template.stats.map((s) => s.id)
                )
            );
            weapon.profiles.forEach((p, i) =>
                p.specialRules?.forEach((s) =>
                    this.rule(`weapons/${weapon.id}/profiles/${i}`, s, scope)
                )
            );
        }
        for (const upgrade of Object.values(r.upgrades ?? {}))
            this.upgrade(
                `upgrades/${upgrade.id}`,
                upgrade,
                scope,
                FIELD_SCOPES.upgrade
            );
        for (const unit of Object.values(r.units ?? {})) this.unit(unit, scope);
        this.detachments('detachments', r.detachments, scope);
        this.specialRules('specialRules', r.specialRules, scope);
        this.slotOptions('slotOptions', r.slotOptions, scope);
        for (const selector of Object.values(r.selectors ?? {}))
            this.selector(`selectors/${selector.id}`, selector.match, scope);
        this.subChoices(r.subChoices, scope);
    }

    private stats(
        path: string,
        stats: Record<string, string>,
        wanted: Array<string>
    ) {
        const missing = wanted.filter((k) => !(k in stats));
        const extra = keys(stats).filter((k) => !wanted.includes(k));
        if (missing.length)
            this.report(path, `missing stats: ${missing.join(', ')}`);
        if (extra.length)
            this.report(path, `stats not in the template: ${extra.join(', ')}`);
    }

    /* Amounts given at a target (a unit's cost, a grant, …) in resources used for it */
    private costs(
        path: string,
        costs: Record<string, NumberOrExpr>,
        scope: Scope,
        scopes: ReadonlyArray<BuiltInScope>,
        target: CostTarget
    ) {
        for (const [resource, value] of Object.entries(costs)) {
            const found = scope.game.resources[resource];
            if (!found) this.known(path, 'resource', resource, []);
            else if (!usedFor(found).includes(target))
                this.report(
                    path,
                    `'${resource}' isn't used for ${TARGET_NAMES[target]}`
                );
            else if (target === 'grant' && found.scope !== 'contingent')
                this.report(
                    path,
                    `'${resource}' isn't a contingent resource, so it can't be granted`
                );
            this.numberOrExpr(
                `${path}/${resource}`,
                value,
                scopes,
                scope.vocabulary
            );
        }
    }

    private rule(path: string, selection: SpecialRuleSelection, scope: Scope) {
        if (
            !(selection.id in (scope.records.specialRules ?? {})) &&
            !(selection.id in (scope.game.specialRules ?? {}))
        ) {
            this.report(path, `unknown special rule '${selection.id}'`);
        }
    }

    private wargear(path: string, ref: WargearRef, scope: Scope) {
        const pool =
            ref.kind === 'weapon'
                ? scope.records.weapons
                : scope.records.equipment;
        if (!(ref.id in (pool ?? {})))
            this.report(path, `unknown ${ref.kind} '${ref.id}'`);
    }

    private unit(unit: Unit, scope: Scope) {
        const path = `units/${unit.id}`;
        const { game } = scope;
        this.known(path, 'role', unit.role, keys(game.roles));
        this.known(path, 'unit type', unit.type, keys(game.unitTypes));
        this.costs(`${path}/cost`, unit.cost, scope, FIELD_SCOPES.unit, 'unit');
        if (unit.additionalModels)
            this.costs(
                `${path}/additionalModels/cost`,
                unit.additionalModels.cost,
                scope,
                FIELD_SCOPES.unit,
                'additionalModels'
            );

        const profileIds = unit.profiles.map((p) => p.id);
        if (new Set(profileIds).size !== profileIds.length)
            this.report(path, 'profile ids repeat');
        if (unit.composition) this.composition(unit, profileIds, scope);
        unit.profiles.forEach((profile) => {
            const at = `${path}/profiles/${profile.id}`;
            const template = game.stats.unit[profile.template];
            if (!template)
                this.report(at, `unknown unit template '${profile.template}'`);
            else
                this.stats(
                    at,
                    profile.stats,
                    template.stats.map((s) => s.id)
                );
            if (profile.type)
                this.known(at, 'unit type', profile.type, keys(game.unitTypes));
            profile.specialRules?.forEach((s) => this.rule(at, s, scope));
        });

        for (const gear of unit.defaultWargear ?? []) {
            this.wargear(`${path}/defaultWargear`, gear, scope);
            if (gear.profileId)
                this.known(
                    `${path}/defaultWargear`,
                    'profile',
                    gear.profileId,
                    profileIds
                );
        }

        const upgradeIds = keys(unit.upgrades);
        for (const upgrade of Object.values(unit.upgrades ?? {})) {
            const at = `${path}/upgrades/${upgrade.id}`;
            if (upgrade.profileId)
                this.known(at, 'profile', upgrade.profileId, profileIds);
            for (const r of upgrade.replaces ?? [])
                this.known(at, 'sibling upgrade', r, upgradeIds);
            const scopes: Array<BuiltInScope> = upgrade.profileId
                ? ['profile', ...FIELD_SCOPES.upgrade]
                : [...FIELD_SCOPES.upgrade];
            this.upgrade(at, upgrade, scope, scopes);
        }
        this.ids(`${path}/upgrades`, unit.upgrades);

        this.condition(path, unit.when, FIELD_SCOPES.unit, scope.vocabulary);
        if (unit.limit)
            this.numberOrExpr(
                `${path}/limit/max`,
                unit.limit.max,
                FIELD_SCOPES.unit,
                scope.vocabulary
            );
    }

    /*
     * A unit's composition blocks: profiles in at most one block, whole
     * numbers, a cost wherever the unit can grow, and a `modelCount` that
     * matches the blocks at their minimum.
     */
    private composition(unit: Unit, profileIds: Array<string>, scope: Scope) {
        const path = `units/${unit.id}/composition`;
        const blocks = unit.composition ?? [];
        const whole = (n: number, least: number) =>
            Number.isInteger(n) && n >= least;
        if (unit.additionalModels)
            this.report(
                `units/${unit.id}/additionalModels`,
                "a unit with a composition grows through its blocks' max and cost, not additionalModels"
            );

        const blockIds = blocks.map((b) => b.id);
        if (new Set(blockIds).size !== blockIds.length)
            this.report(path, 'block ids repeat');
        const blockOf = new Map<string, string>();
        let baseModels = 0;
        for (const block of blocks) {
            const at = `${path}/${block.id}`;
            const counts = Object.entries(block.profiles);
            if (!counts.length)
                this.report(at, 'a block needs at least one profile');
            for (const [profile, count] of counts) {
                this.known(at, 'profile', profile, profileIds);
                if (!whole(count, 1))
                    this.report(
                        `${at}/profiles/${profile}`,
                        `a block holds a whole number of models of each profile, at least 1 (got ${count})`
                    );
                const other = blockOf.get(profile);
                if (other !== undefined && other !== block.id)
                    this.report(
                        at,
                        `profile '${profile}' is also in block '${other}'; a profile may be in only one block`
                    );
                blockOf.set(profile, block.id);
            }
            const min = block.min ?? 1;
            const max = block.max ?? min;
            if (!whole(min, 0))
                this.report(at, `min must be a whole number (got ${min})`);
            if (!whole(max, 0))
                this.report(at, `max must be a whole number (got ${max})`);
            if (max < min) this.report(at, `min ${min} is more than max ${max}`);
            if (max > min && !block.cost)
                this.report(
                    at,
                    'a block the unit can add copies of needs a cost per copy'
                );
            if (block.cost)
                this.costs(
                    `${at}/cost`,
                    block.cost,
                    scope,
                    FIELD_SCOPES.unit,
                    'additionalModels'
                );
            baseModels +=
                min * counts.reduce((sum, [, count]) => sum + count, 0);
        }
        if (baseModels !== unit.modelCount)
            this.report(
                `units/${unit.id}/modelCount`,
                `modelCount is ${unit.modelCount}, but the composition's blocks at their min hold ${baseModels} models`
            );
        if (baseModels === 0)
            this.report(path, 'the unit has no models at its minimum');
        for (const profile of profileIds)
            if (!blockOf.has(profile))
                this.report(
                    path,
                    `profile '${profile}' is in no block, so no model uses it`,
                    'warning'
                );
    }

    /*
     * The option ids an upgrade offers once references are pulled in (its own
     * options win over shared ones, the first shared upgrade over later ones;
     * see getAllOptions), and clashes between shared upgrades.
     */
    private resolveOptions(upgrade: Upgrade, scope: Scope) {
        const own = Object.values(upgrade.options)
            .filter((o) => !('target' in o))
            .map((o) => o.id);
        const offered = [...own];
        const sharedFrom = new Map<string, string>();
        const sharedClashes: Array<{
            option: string;
            kept: string;
            hidden: string;
        }> = [];

        for (const option of Object.values(upgrade.options)) {
            if (!('target' in option)) continue;
            const shared = scope.records.upgrades?.[option.target];
            if (!shared) continue;
            for (const id of Object.keys(shared.options)) {
                if (own.includes(id)) continue;
                const kept = sharedFrom.get(id);
                if (kept) {
                    sharedClashes.push({
                        option: id,
                        kept,
                        hidden: shared.name,
                    });
                    continue;
                }
                sharedFrom.set(id, shared.name);
                offered.push(id);
            }
        }
        return { offered, sharedClashes };
    }

    private upgrade(
        path: string,
        upgrade: Upgrade,
        scope: Scope,
        scopes: ReadonlyArray<BuiltInScope>
    ) {
        this.ids(`${path}/options`, upgrade.options);

        // an upgrade's own options hide same-id options from the shared upgrades it
        // references (intended); between shared upgrades the first referenced wins,
        // which is probably a mistake, so warn
        const { offered, sharedClashes } = this.resolveOptions(upgrade, scope);
        for (const clash of sharedClashes) {
            this.report(
                path,
                `'${clash.option}' comes from both ${clash.kept} and ${clash.hidden}; using ${clash.kept}'s (listed first)`,
                'warning'
            );
        }
        const expanded = offered;
        if (upgrade.default && !expanded.includes(upgrade.default)) {
            this.report(
                path,
                `default '${upgrade.default}' isn't one of its options`
            );
        }
        if (upgrade.perModel.type === 'one-in-x' && !upgrade.perModel.everyX)
            this.report(path, "a 'one-in-x' upgrade needs everyX");

        upgrade.restrictions?.exclusions.forEach((e) =>
            this.wargear(`${path}/restrictions`, e, scope)
        );
        upgrade.restrictions?.required.forEach((e) =>
            this.wargear(`${path}/restrictions`, e, scope)
        );
        upgrade.limitBy?.forEach((l) =>
            this.wargear(`${path}/limitBy`, l, scope)
        );

        this.condition(
            path,
            upgrade.when,
            scopes,
            scope.vocabulary,
            'upgrade-when'
        );
        this.numberOrExpr(`${path}/min`, upgrade.min, scopes, scope.vocabulary);
        this.numberOrExpr(`${path}/max`, upgrade.max, scopes, scope.vocabulary);

        const optionScopes: Array<BuiltInScope> = ['option', ...scopes];
        for (const option of Object.values(upgrade.options) as Array<
            Option | UpgradeReference
        >) {
            const at = `${path}/options/${option.id}`;
            if ('target' in option) {
                this.known(
                    at,
                    'faction upgrade',
                    option.target,
                    keys(scope.records.upgrades)
                );
                option.restrictions?.exclusions.forEach((e) =>
                    this.wargear(at, e, scope)
                );
                option.restrictions?.required.forEach((e) =>
                    this.wargear(at, e, scope)
                );
                continue;
            }
            this.costs(
                `${at}/cost`,
                option.cost,
                scope,
                optionScopes,
                'option'
            );
            option.weaponRefs?.forEach((w) =>
                this.known(at, 'weapon', w, keys(scope.records.weapons))
            );
            option.equipmentRefs?.forEach((e) =>
                this.known(at, 'equipment', e, keys(scope.records.equipment))
            );
            option.swaps?.forEach((s) => {
                this.wargear(`${at}/swaps`, s.from, scope);
                this.wargear(`${at}/swaps`, s.to, scope);
            });
            option.subChoices?.forEach((s) =>
                this.known(
                    at,
                    'sub-choice',
                    s,
                    keys(scope.vocabulary.subChoices)
                )
            );
            option.effects?.forEach((e, i) =>
                this.effect(`${at}/effects/${i}`, e, scope, optionScopes)
            );
            this.condition(
                at,
                option.when,
                optionScopes,
                scope.vocabulary,
                'option-when'
            );
            this.numberOrExpr(
                `${at}/max`,
                option.max,
                optionScopes,
                scope.vocabulary
            );
        }
    }

    private effect(
        path: string,
        effect: StatEffect | SpecialRuleEffect | TraitEffect,
        scope: Scope,
        scopes: ReadonlyArray<BuiltInScope>
    ) {
        if (effect.kind === 'stat') {
            for (const change of effect.changes) {
                if (!scope.unitStats.has(change.stat))
                    this.report(path, `unknown stat '${change.stat}'`);
            }
        } else if (effect.kind === 'specialRule') {
            this.rule(path, effect.rule, scope);
        } else {
            this.traitEffect(path, effect);
            // traits belong to the whole unit: no profile to look at
            scopes = scopes.filter((s) => s !== 'profile');
        }
        this.condition(path, effect.when, scopes, scope.vocabulary);
    }

    private traitEffect(path: string, effect: TraitEffect) {
        const { add = [], remove = [], replace } = effect;
        if (!add.length && !remove.length && !replace)
            this.report(path, 'a trait effect needs add, remove or replace');
        if (replace && !replace.from.length)
            this.report(path, 'replace needs at least one trait in from');
        const removed = [...remove, ...(replace?.from ?? [])].map(tagId);
        for (const trait of [...add, ...(replace ? [replace.to] : [])]) {
            if (!trait.trim()) this.report(path, 'a trait needs a name');
            else if (removed.includes(tagId(trait)))
                this.report(
                    path,
                    `'${trait}' is both given and taken away`,
                    'warning'
                );
        }
    }

    /*
     * `units` are the ids `unitIds` may name: the scope's own, a slot source's,
     * or `unchecked` when the source is unknown (already reported)
     */
    private selector(
        path: string,
        selector: UnitSelectorOrRef | undefined,
        scope: Scope,
        units: ReadonlyArray<string> | 'unchecked' = keys(scope.records.units)
    ) {
        if (!selector) return;
        if (typeof selector === 'string') {
            this.known(
                path,
                'selector',
                selector.slice(1),
                scope.vocabulary.selectors
            );
            if (!selector.startsWith('@'))
                this.report(path, `a selector reference starts with '@'`);
            return;
        }
        const traits = (scope.vocabulary.traits ?? []).map(tagId);
        const match = (at: string, m: UnitExclusion) => {
            if (units !== 'unchecked')
                m.unitIds?.forEach((id) => this.known(at, 'unit', id, units));
            m.roles?.forEach((r) =>
                this.known(at, 'role', r, keys(scope.game.roles))
            );
            for (const trait of m.traits ?? []) {
                if (!traits.includes(tagId(trait)))
                    this.report(
                        at,
                        `no unit has or is given the trait '${trait}'${didYouMean(tagId(trait), traits)}`,
                        'warning'
                    );
            }
        };
        match(path, selector);
        selector.exclude?.forEach((e, i) => match(`${path}/exclude/${i}`, e));
    }

    /*
     * The units a slot source offers (the faction's, plus the sub-factions'
     * it names), or `unchecked` when the source names something not loaded
     */
    private sourceUnits(
        path: string,
        source: SlotSource
    ): ReadonlyArray<string> | 'unchecked' {
        const factions = this.set.factions.map((f) => f.data);
        const faction = factions.find((f) => f.id === source.faction);
        if (!faction) {
            this.report(
                path,
                `unknown faction '${source.faction}'${didYouMean(
                    source.faction,
                    factions.map((f) => f.id)
                )}`
            );
            return 'unchecked';
        }
        const subs = this.set.subFactions
            .map((s) => s.data)
            .filter((s) => s.parent.faction === faction.id);
        let picked = subs;
        if (source.subFactions !== 'any') {
            picked = [];
            for (const id of source.subFactions ?? []) {
                const sub = subs.find((s) => s.id === id);
                if (sub) picked.push(sub);
                else
                    this.report(
                        path,
                        `'${faction.id}' has no sub-faction '${id}'${didYouMean(
                            id,
                            subs.map((s) => s.id)
                        )}`
                    );
            }
        }
        return [faction, ...picked].flatMap((r) => keys(r.units));
    }

    /* A slot's units (from its source, if any) and the effects on them */
    private slotUnits(
        path: string,
        slot: {
            units?: UnitSelectorOrRef;
            source?: SlotSource;
            effects?: Array<SlotUnitEffect>;
        },
        scope: Scope
    ) {
        if (slot.source)
            this.selector(
                path,
                slot.units,
                scope,
                this.sourceUnits(`${path}/source`, slot.source)
            );
        else this.selector(path, slot.units, scope);
        slot.effects?.forEach((effect, i) =>
            this.effect(
                `${path}/effects/${i}`,
                effect,
                scope,
                FIELD_SCOPES.effect
            )
        );
    }

    /* A slot a mechanic (a slot option, a special rule) adds to a group */
    private addedSlot(path: string, slot: AddedSlot, scope: Scope) {
        if (!slot.roleChoices.length)
            this.report(path, 'a slot needs at least one role');
        slot.roleChoices.forEach((r) =>
            this.known(path, 'role', r, keys(scope.game.roles))
        );
        this.slotUnits(path, slot, scope);
    }

    private detachments(
        path: string,
        detachments: Record<string, Detachment> | undefined,
        scope: Scope
    ) {
        const { game } = scope;
        for (const detachment of Object.values(detachments ?? {})) {
            const at = `${path}/${detachment.id}`;
            this.known(
                at,
                'group type',
                detachment.type,
                keys(game.groupTypes)
            );
            this.selector(at, detachment.units, scope);
            detachment.slots.forEach((slot, i) => {
                const s = `${at}/slots/${i}`;
                if (!slot.roles.length)
                    this.report(s, 'a slot needs at least one role');
                slot.roles.forEach((r) =>
                    this.known(s, 'role', r, keys(game.roles))
                );
                slot.tags?.forEach((t) =>
                    this.known(s, 'slot tag', t, keys(game.slotTags))
                );
                this.slotUnits(s, slot, scope);
                this.condition(
                    s,
                    slot.when,
                    FIELD_SCOPES.slot,
                    scope.vocabulary
                );
                if (slot.repeat)
                    this.numberOrExpr(
                        `${s}/repeat/max`,
                        slot.repeat.max,
                        FIELD_SCOPES.slot,
                        scope.vocabulary
                    );
            });
            detachment.requires?.forEach((r, i) =>
                this.selector(`${at}/requires/${i}`, r.units, scope)
            );
            this.condition(
                at,
                detachment.when,
                FIELD_SCOPES.detachmentWhen,
                scope.vocabulary
            );
            this.numberOrExpr(
                `${at}/min`,
                detachment.min,
                FIELD_SCOPES.detachmentLimit,
                scope.vocabulary
            );
            this.numberOrExpr(
                `${at}/max`,
                detachment.max,
                FIELD_SCOPES.detachmentLimit,
                scope.vocabulary
            );
            if (detachment.cost)
                this.costs(
                    `${at}/cost`,
                    detachment.cost,
                    scope,
                    FIELD_SCOPES.detachmentLimit,
                    'group'
                );
            detachment.effects?.forEach((effect, i) =>
                this.effect(
                    `${at}/effects/${i}`,
                    effect,
                    scope,
                    FIELD_SCOPES.effect
                )
            );
        }
    }

    /* Sub-choices: their values, and what each adds to or multiplies an option's cost by */
    private subChoices(
        subs: Record<string, SubChoice> | undefined,
        scope: Scope
    ) {
        for (const sub of Object.values(subs ?? {})) {
            const at = `subChoices/${sub.id}`;
            this.ids(`${at}/values`, sub.values);
            if (!(sub.default in sub.values))
                this.report(
                    at,
                    `default '${sub.default}' isn't one of its values`
                );
            for (const value of Object.values(sub.values)) {
                const v = `${at}/values/${value.id}`;
                if (value.cost)
                    this.costs(
                        `${v}/cost`,
                        value.cost,
                        scope,
                        FIELD_SCOPES.option,
                        'option'
                    );
                if (value.costMultiplier)
                    this.costs(
                        `${v}/costMultiplier`,
                        value.costMultiplier,
                        scope,
                        [],
                        'option'
                    );
            }
        }
    }

    private specialRules(
        path: string,
        rules: Record<string, SpecialRule> | undefined,
        scope: Scope
    ) {
        for (const rule of Object.values(rules ?? {})) {
            const at = `${path}/${rule.id}`;
            if (rule.grants)
                this.costs(
                    `${at}/grants`,
                    rule.grants,
                    scope,
                    FIELD_SCOPES.ruleGrant,
                    'grant'
                );
            rule.slots?.forEach((slot, i) =>
                this.addedSlot(`${at}/slots/${i}`, slot, scope)
            );
            if (rule.defaultValue !== undefined && !rule.configurable)
                this.report(
                    at,
                    'has a default value but takes no value',
                    'warning'
                );
        }
    }

    private slotOptions(
        path: string,
        options: Record<string, SlotOption> | undefined,
        scope: Scope
    ) {
        const roles = keys(scope.game.roles);
        for (const option of Object.values(options ?? {})) {
            const at = `${path}/${option.id}`;
            this.known(
                at,
                'slot tag',
                option.slotTag,
                keys(scope.game.slotTags)
            );
            option.slotRoles?.forEach((r) => this.known(at, 'role', r, roles));
            if (option.cost)
                this.costs(
                    `${at}/cost`,
                    option.cost,
                    scope,
                    FIELD_SCOPES.slot,
                    'slotOption'
                );
            option.effects?.forEach((effect, i) => {
                const e = `${at}/effects/${i}`;
                if (effect.kind === 'slot') this.addedSlot(e, effect, scope);
                else if (effect.kind === 'allowedRoles')
                    effect.roles.forEach((r) =>
                        this.known(e, 'role', r, roles)
                    );
                else this.effect(e, effect, scope, FIELD_SCOPES.effect);
            });
        }
    }
}

/** Every integrity problem in a game and the factions and sub-factions loaded for it */
export function validateGameData(set: GameDataSet): Array<DataIssue> {
    return new Validator(set).run();
}
