import type {
    ExpressionVocabulary,
    BuiltInScope,
} from '../expressions/checker';
import { BUILT_IN_SCOPES } from '../expressions/checker';
import type {
    Faction,
    FactionRecords,
    GameSystem,
    SubFaction,
    TraitEffect,
} from '../types';

const keys = (record?: object) => Object.keys(record ?? {});

/* The game's words for built-in scopes, e.g. `{ detachment: 'group', primary: 'root' }` */
export function scopeWords(game: GameSystem): Record<string, BuiltInScope> {
    const words: Record<string, BuiltInScope> = {};
    for (const [key, term] of Object.entries(game.terms ?? {})) {
        if (
            term?.word &&
            (BUILT_IN_SCOPES as ReadonlyArray<string>).includes(key)
        ) {
            words[term.word] = key as BuiltInScope;
        }
    }
    return words;
}

/* Unit and profile tags used anywhere in the records */
function tagsOf(records: Array<Partial<FactionRecords>>) {
    const tags = new Set<string>();
    for (const r of records) {
        for (const unit of Object.values(r.units ?? {})) {
            unit.tags?.forEach((t) => tags.add(t));
            for (const profile of unit.profiles)
                profile.tags?.forEach((t) => tags.add(t));
        }
    }
    return [...tags];
}

/* Records that may name traits: units, and every effect that can give one */
type TraitSource = Partial<
    Pick<FactionRecords, 'units' | 'upgrades' | 'detachments' | 'slotOptions'>
> &
    Partial<Pick<SubFaction, 'unitModifiers'>>;

/* Traits units have or trait effects give, anywhere in the sources */
function traitsOf(sources: Array<TraitSource>) {
    const traits = new Set<string>();
    const fromEffect = (effect: { kind: string }) => {
        if (effect.kind !== 'trait') return;
        const { add, replace } = effect as TraitEffect;
        add?.forEach((t) => traits.add(t));
        if (replace) traits.add(replace.to);
    };
    const fromOptions = (options: Record<string, object>) => {
        for (const option of Object.values(options))
            if ('effects' in option)
                (option.effects as Array<{ kind: string }>).forEach(fromEffect);
    };
    for (const s of sources) {
        for (const unit of Object.values(s.units ?? {})) {
            unit.traits?.forEach((t) => traits.add(t));
            for (const upgrade of Object.values(unit.upgrades ?? {}))
                fromOptions(upgrade.options);
        }
        for (const upgrade of Object.values(s.upgrades ?? {}))
            fromOptions(upgrade.options);
        for (const d of Object.values(s.detachments ?? {}))
            d.effects?.forEach(fromEffect);
        for (const o of Object.values(s.slotOptions ?? {}))
            o.effects?.forEach(fromEffect);
        for (const m of Object.values(s.unitModifiers ?? {}))
            m.actions.forEach(fromEffect);
    }
    return [...traits];
}

/**
 * What expressions in a faction (optionally with one of its sub-factions
 * merged in) may refer to: its own records, then the game's. `factions` and
 * `subFactions` are every one available, for `faction:` / `subfaction:`
 * references; the traits they name (when given whole) are known to `trait:`
 * references everywhere, since `main` and `list` see other factions' units.
 */
export function buildVocabulary(
    game: GameSystem,
    records: Array<Partial<FactionRecords>>,
    factions: Array<Pick<Faction, 'id'> & TraitSource>,
    subFactions: Array<Pick<SubFaction, 'id'> & TraitSource>
): ExpressionVocabulary {
    const all = (key: keyof FactionRecords) =>
        records.flatMap((r) => keys(r[key]));
    const subChoices = [game.subChoices, ...records.map((r) => r.subChoices)];

    return {
        scopeWords: scopeWords(game),
        units: all('units'),
        roles: keys(game.roles),
        unitTypes: keys(game.unitTypes),
        groupTypes: keys(game.groupTypes),
        groups: [...keys(game.detachments), ...all('detachments')],
        weapons: all('weapons'),
        equipment: all('equipment'),
        factions: factions.map((f) => f.id),
        subFactions: subFactions.map((s) => s.id),
        selectors: [...keys(game.selectors), ...all('selectors')],
        slotTags: keys(game.slotTags),
        tags: tagsOf(records),
        traits: traitsOf([game, ...records, ...factions, ...subFactions]),
        resources: Object.fromEntries(
            Object.values(game.resources).map((r) => [r.id, r.scope])
        ),
        choices: Object.fromEntries(
            Object.values(game.choices ?? {}).map((c) => [c.id, keys(c.values)])
        ),
        subChoices: Object.fromEntries(
            subChoices
                .flatMap((s) => Object.values(s ?? {}))
                .map((c) => [c.id, keys(c.values)])
        ),
    };
}
