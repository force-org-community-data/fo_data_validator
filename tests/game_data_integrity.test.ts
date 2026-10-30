import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { formatDiagnostic } from '../src/expressions/diagnostics';
import { readSource } from '../src/game_data/read_source';
import {
    DataIssue,
    GameDataSet,
    validateGameData,
} from '../src/game_data/validate';

/*
 * Integrity of the example sources in examples/. Run it after hand-editing
 * them.
 */

const root = path.join(import.meta.dirname, '..');
const examples = path.join(root, 'examples');

const describeIssue = (i: DataIssue) =>
    `${i.severity} ${i.file} ${i.path}: ${i.message}` +
    (i.expression
        ? `\n${formatDiagnostic(i.expression.source, { ...i, ...i.expression })}`
        : '');

/* a source's games, with any extension sources' files added to the game they extend */
async function sets(dir: string, ...extensionDirs: Array<string>) {
    const source = await readSource(dir);
    const extensions = await Promise.all(
        extensionDirs.map((d) => readSource(d))
    );

    return source.provided.map((set): GameDataSet => {
        for (const ext of extensions.flatMap((e) => e.extensions)) {
            if (ext.game !== set.game.data.id) continue;
            set.factions.push(...ext.factions);
            set.subFactions.push(...ext.subFactions);
        }
        return set;
    });
}

async function assertClean(dir: string, ...extensionDirs: Array<string>) {
    const issues = (await sets(dir, ...extensionDirs)).flatMap(
        validateGameData
    );
    assert.deepEqual(issues.map(describeIssue), []);
}

describe('example sources', () => {
    it('full coverage source with the extension source', () =>
        assertClean(
            path.join(examples, 'full'),
            path.join(examples, 'extension')
        ));

    for (const name of ['full', 'starter']) {
        it(name, () => assertClean(path.join(examples, name)));
    }
});

describe('validator', () => {
    it('reports broken references, stats and expressions', async () => {
        const [set] = await sets(path.join(examples, 'full'));
        const faction = structuredClone(set.factions[0]);
        const squad = faction.data.units['squad'];
        squad.role = 'trop';
        squad.profiles[0].stats = { move: '6' };
        squad.upgrades!['squad-options'].options['grenades'] = {
            id: 'grenades',
            name: 'Grenades',
            cost: { points: 5 },
            when: {
                if: 'choice(stance) == offensiv',
                message: 'Offensive only',
            },
        };
        faction.data.units['carrier'].id = 'not-carrier';

        const issues = validateGameData({ ...set, factions: [faction] });
        const messages = issues.map((i) => `${i.path}: ${i.message}`);

        assert.ok(messages.includes("units/squad: unknown role 'trop'"));
        assert.ok(
            messages.some((m) =>
                m.startsWith('units/squad/profiles/trooper: missing stats')
            )
        );
        assert.ok(
            messages.some((m) =>
                m.includes(
                    "'offensiv' isn't a value of stance (did you mean 'offensive'?)"
                )
            )
        );
        assert.ok(
            messages.includes(
                "units/carrier: id is 'not-carrier', but the key is 'carrier'"
            )
        );
        const expression = issues.find((i) => i.expression);
        assert.equal(
            expression?.expression?.source,
            'choice(stance) == offensiv'
        );
    });

    it('requires declared overrides for sub-faction collisions', async () => {
        const [set] = await sets(
            path.join(examples, 'full'),
            path.join(examples, 'extension')
        );
        const sub = set.subFactions.find((s) => s.data.id === 'irregulars')!;
        const withoutOverride = structuredClone(sub);
        delete withoutOverride.data.overrides;

        const issues = validateGameData({
            ...set,
            subFactions: set.subFactions.map((s) =>
                s === sub ? withoutOverride : s
            ),
        });
        assert.ok(
            issues.some((i) =>
                i.message.startsWith(
                    "collides with the parent's specialRules 'disciplined'"
                )
            )
        );
    });
});

/* the full source with the extension, changed by `change`, and what the validator says */
async function issuesAfter(change: (set: GameDataSet) => void) {
    const [set] = structuredClone(
        await sets(
            path.join(examples, 'full'),
            path.join(examples, 'extension')
        )
    );
    change(set);
    return validateGameData(set).map(
        (i) => `${i.severity} ${i.file} ${i.path}: ${i.message}`
    );
}
const sub = (set: GameDataSet, id: string) =>
    set.subFactions.find((s) => s.data.id === id)!.data;

describe('grouped sub-factions', () => {
    it('reports an unknown group, with a hint', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'coastal-heritage').group = 'heritag';
        });
        assert.deepEqual(issues, [
            "error sub-factions/coastal-heritage.json group: 'field-army' has no sub-faction group 'heritag' (did you mean 'heritage'?)",
        ]);
    });

    it('checks group limits and sub-faction conditions', async () => {
        const issues = await issuesAfter((set) => {
            const groups = set.factions[0].data.subFactionGroups!;
            groups['heritage'].max = 'list.has(unit:walkr)';
            groups['doctrine'].min = 2;
            sub(set, 'coastal-heritage').when!.if = 'list.count(unit:walker)';
            sub(set, 'highland-heritage').when = {
                if: 'unit.has(unit:walker)',
                message: 'Never',
            };
        });
        assert.deepEqual(issues, [
            'error factions/field-army.json subFactionGroups/doctrine: min 2 is more than max 1',
            "error factions/field-army.json subFactionGroups/heritage/max: unknown unit 'walkr' (did you mean 'walker'?)",
            "error sub-factions/highland-heritage.json when: 'unit' isn't available here (allowed: contingent, list, main, root)",
            'error sub-factions/coastal-heritage.json when: this field needs a boolean but the expression is a number',
        ]);
    });

    it('allows identical records in sub-factions taken together', async () => {
        // both heritages define the same local-knowledge rule (see the example)
        assert.deepEqual(await issuesAfter(() => {}), []);
    });

    it('reports different records in sub-factions taken together', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'coastal-heritage').specialRules!['local-knowledge'].text =
                'Something else.';
            sub(set, 'siege-doctrine').unitModifiers = {
                tough: {
                    id: 'tough',
                    name: 'Tough',
                    selector: {},
                    actions: [],
                },
            };
            sub(set, 'highland-heritage').unitModifiers = {
                tough: {
                    id: 'tough',
                    name: 'Tougher',
                    selector: {},
                    actions: [],
                },
            };
        });
        assert.deepEqual(issues, [
            "error sub-factions/highland-heritage.json unitModifiers/tough: sub-faction 'siege-doctrine' (sub-factions/siege-doctrine.json) also defines unitModifiers 'tough', differently, and both can be taken together (they're in groups 'doctrine' and 'heritage'); make them identical or rename one",
            "error sub-factions/coastal-heritage.json specialRules/local-knowledge: sub-faction 'highland-heritage' (sub-factions/highland-heritage.json) also defines specialRules 'local-knowledge', differently, and both can be taken together (group 'heritage' allows more than one); make them identical or rename one",
        ]);
    });

    it('allows the same ids in a group of one', async () => {
        // the doctrines both define `drill`, differently, but only one can be taken
        const issues = await issuesAfter(() => {});
        assert.ok(!issues.some((i) => i.includes('drill')));
    });

    it('reports two overrides of one parent record taken together', async () => {
        // veterans and irregulars (no group) both override `disciplined`
        const issues = await issuesAfter((set) => {
            set.factions[0].data.subFactionGroups!['default'] = {
                id: 'default',
                name: 'Regiment',
                max: 2,
            };
        });
        assert.deepEqual(issues, [
            "error sub-factions/irregulars.json specialRules/disciplined: sub-faction 'veterans' (sub-factions/veterans.json) also overrides the parent's specialRules 'disciplined', differently, and both can be taken together (group 'default' allows more than one); make the replacements identical, or keep the two from being taken together",
        ]);
    });

    it('still accepts sub-factions without groups', async () => {
        const issues = await issuesAfter((set) => {
            delete set.factions[0].data.subFactionGroups;
            for (const s of set.subFactions) {
                delete s.data.group;
                delete s.data.when;
            }
        });
        assert.deepEqual(issues, []);
    });
});

describe('unit composition', () => {
    const gunTeam = (set: GameDataSet) =>
        set.factions[0].data.units['gun-team'];

    it('checks blocks against the profiles and the model count', async () => {
        const issues = await issuesAfter((set) => {
            const unit = gunTeam(set);
            unit.composition![0].profiles = { gunner: 1, loadr: 1.5 };
            unit.composition!.push({
                id: 'spotter',
                profiles: { gunner: 1 },
                min: 2,
                max: 1,
            });
            unit.additionalModels = { max: 1, cost: { points: 5 } };
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json units/gun-team/additionalModels: a unit with a composition grows through its blocks' max and cost, not additionalModels",
            "error factions/field-army.json units/gun-team/composition/gun-crew: unknown profile 'loadr'",
            'error factions/field-army.json units/gun-team/composition/gun-crew/profiles/loadr: a block holds a whole number of models of each profile, at least 1 (got 1.5)',
            "error factions/field-army.json units/gun-team/composition/spotter: profile 'gunner' is also in block 'gun-crew'; a profile may be in only one block",
            'error factions/field-army.json units/gun-team/composition/spotter: min 2 is more than max 1',
            "error factions/field-army.json units/gun-team/modelCount: modelCount is 2, but the composition's blocks at their min hold 4.5 models",
            "warning factions/field-army.json units/gun-team/composition: profile 'loader' is in no block, so no model uses it",
        ]);
    });

    it('needs a cost where the unit can grow', async () => {
        const issues = await issuesAfter((set) => {
            delete gunTeam(set).composition![0].cost;
        });
        assert.deepEqual(issues, [
            'error factions/field-army.json units/gun-team/composition/gun-crew: a block the unit can add copies of needs a cost per copy',
        ]);
    });

    it('accepts fixed blocks and optional blocks', async () => {
        const issues = await issuesAfter((set) => {
            const unit = gunTeam(set);
            unit.composition = [
                { id: 'gunner', profiles: { gunner: 1 } },
                {
                    id: 'loaders',
                    profiles: { loader: 1 },
                    min: 0,
                    max: 2,
                    cost: { points: 10 },
                },
            ];
            unit.modelCount = 1;
        });
        assert.deepEqual(issues, []);
    });
});

describe('traits', () => {
    it('checks trait effects, with no profile scope in their conditions', async () => {
        const issues = await issuesAfter((set) => {
            const gunLine = set.factions[0].data.detachments['gun-line'];
            gunLine.effects = [
                { kind: 'trait' },
                {
                    kind: 'trait',
                    add: ['Gun Line'],
                    remove: ['gun line'],
                    when: {
                        if: 'profile.is(tag:sergeant)',
                        message: 'Sergeants only',
                    },
                },
                { kind: 'trait', replace: { from: [], to: 'Gun Line' } },
            ];
        });
        assert.deepEqual(issues, [
            'error factions/field-army.json detachments/gun-line/effects/0: a trait effect needs add, remove or replace',
            "warning factions/field-army.json detachments/gun-line/effects/1: 'Gun Line' is both given and taken away",
            "error factions/field-army.json detachments/gun-line/effects/1/when: 'profile' isn't available here (allowed: contingent, group, list, main, root, slot, unit)",
            'error factions/field-army.json detachments/gun-line/effects/2: replace needs at least one trait in from',
        ]);
    });

    it('checks the rest of a detachment effect like any effect', async () => {
        const issues = await issuesAfter((set) => {
            const gunLine = set.factions[0].data.detachments['gun-line'];
            gunLine.effects!.push({
                kind: 'specialRule',
                rule: { id: 'stubborn' },
            });
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json detachments/gun-line/effects/2: unknown special rule 'stubborn'",
        ]);
    });

    it('warns on selector traits no unit has or is given', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'veterans').unitModifiers!['veteran-corps'].selector = {
                traits: ['Disiplined'],
            };
        });
        assert.deepEqual(issues, [
            "warning sub-factions/veterans.json unitModifiers/veteran-corps: no unit has or is given the trait 'Disiplined' (did you mean 'disciplined'?)",
        ]);
    });

    it('knows traits given by effects in other factions', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'irregulars').when = {
                if: 'main.has(trait:veteran-corps) or main.has(trait:gun-line)',
                message: 'Only alongside veterans or a gun line',
            };
        });
        assert.deepEqual(issues, []);
    });
});

describe('slots filled from another faction', () => {
    const fieldArmy = (set: GameDataSet) => set.factions[0].data;
    const handlerSlot = (set: GameDataSet) =>
        fieldArmy(set).specialRules['automata-handler'].slots![0];
    const borrowedSlot = (set: GameDataSet) => {
        const effect = sub(set, 'veterans').slotOptions!['borrowed-specialists']
            .effects![0];
        assert.equal(effect.kind, 'slot');
        return effect;
    };

    it("resolves unitIds against the source's units, sub-factions included", async () => {
        const issues = await issuesAfter((set) => {
            // the faction's own `squad` isn't a Machine Cult unit
            handlerSlot(set).units = { unitIds: ['battle-automata', 'squad'] };
            // `any` brings in every sub-faction's units, wherever it's loaded from
            borrowedSlot(set).units = {
                unitIds: ['squad', 'veteran-squad', 'militia', 'automata'],
            };
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json specialRules/automata-handler/slots/0: unknown unit 'squad'",
            "error sub-factions/veterans.json slotOptions/borrowed-specialists/effects/0: unknown unit 'automata'",
        ]);
    });

    it('reports unknown factions and sub-factions, with hints', async () => {
        const issues = await issuesAfter((set) => {
            handlerSlot(set).source = { faction: 'machine-cul' };
            borrowedSlot(set).source = {
                faction: 'field-army',
                subFactions: ['veterans', 'irregular'],
            };
            fieldArmy(set).detachments['armoured-spearhead'].slots[1].source = {
                faction: 'field-army',
                subFactions: ['veterans'],
            };
        });
        assert.deepEqual(issues, [
            // the spearhead's slot still names a Machine Cult unit
            "error factions/field-army.json detachments/armoured-spearhead/slots/1: unknown unit 'battle-automata'",
            "error factions/field-army.json specialRules/automata-handler/slots/0/source: unknown faction 'machine-cul' (did you mean 'machine-cult'?)",
            "error sub-factions/veterans.json slotOptions/borrowed-specialists/effects/0/source: 'field-army' has no sub-faction 'irregular' (did you mean 'irregulars'?)",
        ]);
    });

    it("checks a slot's roles, exclusions and effects", async () => {
        const issues = await issuesAfter((set) => {
            const slot = handlerSlot(set);
            slot.roleChoices = [];
            slot.effects!.push({
                kind: 'specialRule',
                rule: { id: 'stubborn' },
            });
            borrowedSlot(set).units = {
                exclude: [{ unitIds: ['general'], traits: ['Veteranz'] }],
            };
        });
        assert.deepEqual(issues, [
            'error factions/field-army.json specialRules/automata-handler/slots/0: a slot needs at least one role',
            "error factions/field-army.json specialRules/automata-handler/slots/0/effects/1: unknown special rule 'stubborn'",
            "warning sub-factions/veterans.json slotOptions/borrowed-specialists/effects/0/exclude/0: no unit has or is given the trait 'Veteranz' (did you mean 'veterans'?)",
        ]);
    });

    it('knows traits given to units in sourced slots', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'irregulars').when = {
                if: 'main.has(trait:bonded-automata) or main.has(trait:spearhead)',
                message: 'Only alongside bonded automata',
            };
        });
        assert.deepEqual(issues, []);
    });
});

describe('composition blocks that replace models', () => {
    const sapperTeam = (set: GameDataSet) =>
        set.factions[0].data.units['sapper-team'];

    it('accepts a replacement that keeps the unit its size', async () => {
        assert.deepEqual(await issuesAfter(() => {}), []);
    });

    it('checks the target block and profile', async () => {
        const issues = await issuesAfter((set) => {
            const [sapper, foreman] = sapperTeam(set).composition!;
            foreman.replaces = { block: 'sappers', profile: 'sapper' };
            sapper.id = 'sapper';
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json units/sapper-team/composition/foreman/replaces: unknown block 'sappers'",
        ]);

        const profile = await issuesAfter((set) => {
            sapperTeam(set).composition![1].replaces!.profile = 'foreman';
        });
        assert.deepEqual(profile, [
            "error factions/field-army.json units/sapper-team/composition/foreman/replaces: block 'sapper' has no profile 'foreman'",
        ]);
    });

    it('does not let blocks replace more models than the target holds', async () => {
        const issues = await issuesAfter((set) => {
            sapperTeam(set).composition![1].max = 5;
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json units/sapper-team/composition/sapper: blocks replacing 'sapper' can take 5 models, but 'sapper' holds only 4 at its min",
        ]);
    });

    it('counts a compulsory replacement in the model count', async () => {
        const issues = await issuesAfter((set) => {
            const unit = sapperTeam(set);
            unit.composition![1].min = 1;
        });
        assert.deepEqual(issues, []);

        const wrong = await issuesAfter((set) => {
            const unit = sapperTeam(set);
            unit.composition![1].min = 1;
            unit.modelCount = 5;
        });
        assert.deepEqual(wrong, [
            "error factions/field-army.json units/sapper-team/modelCount: modelCount is 5, but the composition's blocks at their min hold 4 models",
        ]);
    });

    it('does not chain replacements', async () => {
        const issues = await issuesAfter((set) => {
            const unit = sapperTeam(set);
            unit.composition!.push({
                id: 'champion',
                profiles: { sapper: 1 },
                min: 0,
                max: 1,
                cost: { points: 5 },
                replaces: { block: 'foreman', profile: 'foreman' },
            });
        });
        assert.ok(
            issues.some((i) =>
                i.includes(
                    "block 'foreman' itself replaces another block's models"
                )
            )
        );
    });
});

describe('slot option units', () => {
    it('checks the selector', async () => {
        const issues = await issuesAfter((set) => {
            set.game.data.slotOptions!['veteran-officer'].units = {
                roles: ['offcer'],
            };
        });
        assert.deepEqual(issues, [
            "error game.json slotOptions/veteran-officer/units: unknown role 'offcer'",
        ]);
    });
});

describe('faction and sub-faction list rules', () => {
    const rules = (set: GameDataSet) => set.factions[0].data.listRules!;

    it('checks a group-scope condition with the group scope available', async () => {
        const issues = await issuesAfter((set) => {
            const rule = rules(set)['vehicles-in-reserve'];
            if (rule.kind === 'expression') rule.groupTypes = ['reserv'];
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json listRules/vehicles-in-reserve: unknown group type 'reserv'",
        ]);
    });

    it('does not allow the group scope in a list-scope rule', async () => {
        const issues = await issuesAfter((set) => {
            const rule = rules(set)['vehicles-in-reserve'];
            if (rule.kind === 'expression') delete rule.scope;
        });
        assert.deepEqual(
            [
                ...new Set(
                    issues.map((i) => i.split(': ').slice(1).join(': '))
                ),
            ].sort(),
            [
                "'group' isn't available here (allowed: list, main)",
                'groupTypes only applies to a rule with scope "group"',
            ]
        );
    });

    it('warns when a faction rule hides the game rule of the same id', async () => {
        const issues = await issuesAfter((set) => {
            rules(set)['heavy-cap'] = set.game.data.listRules!['heavy-cap'];
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json listRules/heavy-cap: hides the game's listRules 'heavy-cap'",
        ]);
    });

    it('needs a declared override to replace a faction rule', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'veterans').listRules = {
                'vehicles-in-reserve': rules(set)['vehicles-in-reserve'],
            };
        });
        assert.deepEqual(issues, [
            "error sub-factions/veterans.json listRules/vehicles-in-reserve: collides with the parent's listRules 'vehicles-in-reserve'; list it in overrides if that's intended",
        ]);

        const allowed = await issuesAfter((set) => {
            const veterans = sub(set, 'veterans');
            veterans.listRules = {
                'vehicles-in-reserve': rules(set)['vehicles-in-reserve'],
            };
            veterans.overrides!.push({
                kind: 'listRules',
                id: 'vehicles-in-reserve',
            });
        });
        assert.deepEqual(allowed, []);
    });
});

describe('upgrade swapFrom', () => {
    const sidearm = (set: GameDataSet) =>
        set.factions[0].data.units['squad'].upgrades!['trooper-sidearm'];

    it('accepts the example, which swaps the trooper rifle for a shared list', async () => {
        assert.deepEqual(await issuesAfter(() => {}), []);
    });

    it('reports unknown wargear and a non-positive count', async () => {
        const issues = await issuesAfter((set) => {
            sidearm(set).swapFrom = { kind: 'weapon', id: 'rifel', count: 0 };
        });
        assert.ok(
            issues.some((i) => i.endsWith("swapFrom: unknown weapon 'rifel'"))
        );
        assert.ok(
            issues.some((i) =>
                i.endsWith('swapFrom: count must be a positive number')
            )
        );
    });

    it('warns when the unit does not hold the wargear', async () => {
        const issues = await issuesAfter((set) => {
            sidearm(set).swapFrom = { kind: 'weapon', id: 'cannon' };
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json units/squad/upgrades/trooper-sidearm/swapFrom: the unit doesn't hold weapon 'cannon' by default on 'trooper', so there is nothing to take off",
        ]);
    });

    it('warns when the only option is the default', async () => {
        const issues = await issuesAfter((set) => {
            sidearm(set).options = { none: sidearm(set).options['none'] };
        });
        assert.deepEqual(issues, [
            'warning factions/field-army.json units/squad/upgrades/trooper-sidearm/swapFrom: every option is the default, so nothing is ever swapped',
        ]);
    });
});
