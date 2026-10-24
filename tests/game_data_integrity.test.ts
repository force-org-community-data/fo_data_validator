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
