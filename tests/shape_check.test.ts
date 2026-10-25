import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { readSource } from '../src/game_data/read_source';
import { checkShapes, ShapeFile } from '../src/game_data/shape';

/* The shape check behind `npm run validate-data` */

const example = path.join(import.meta.dirname, '../examples/full');

async function files(): Promise<Array<ShapeFile>> {
    const [set] = (await readSource(example)).provided;
    return [
        { ...set.game, kind: 'GameSystem' },
        ...set.factions.map((f) => ({ ...f, kind: 'Faction' as const })),
        ...set.subFactions.map((f) => ({ ...f, kind: 'SubFaction' as const })),
    ];
}

describe('checkShapes', () => {
    it('accepts the example source', async () => {
        assert.deepEqual(checkShapes(await files()), []);
    });

    /* breaks one unit of the example faction and returns what the check says */
    async function issuesAfter(
        unit: string,
        change: (record: Record<string, unknown>) => void
    ) {
        const all = await files();
        const faction = all.find((f) => f.kind === 'Faction')!;
        change(
            (faction.data as { units: Record<string, Record<string, unknown>> })
                .units[unit]
        );
        return checkShapes(all).map((i) => `${i.path}: ${i.message}`);
    }

    it('reports a wrong type with its path', async () => {
        const issues = await issuesAfter(
            'carrier',
            (u) => (u.profiles = 'nope')
        );
        assert.ok(issues.some((i) => i.startsWith('units/carrier/profiles: ')));
    });

    it('reports an unknown key', async () => {
        const issues = await issuesAfter(
            'squad',
            (u) => (u.cst = { points: 1 })
        );
        assert.ok(issues.some((i) => i.startsWith('units/squad/cst: ')));
    });

    it('reports a missing field', async () => {
        const issues = await issuesAfter('carrier', (u) => delete u.modelCount);
        assert.deepEqual(issues, [
            "units/carrier: missing required property 'modelCount'",
        ]);
    });

    it('checks sub-faction groups', async () => {
        const all = await files();
        const faction = all.find((f) => f.kind === 'Faction')!;
        const groups = (
            faction.data as { subFactionGroups: Record<string, object> }
        ).subFactionGroups;
        groups['doctrine'] = { ...groups['doctrine'], maxx: 2 };
        const sub = all.find(
            (f) => (f.data as { id: string }).id === 'coastal-heritage'
        )!;
        (sub.data as Record<string, unknown>).group = 3;
        const issues = checkShapes(all).map((i) => `${i.path}: ${i.message}`);
        assert.ok(
            issues.some((i) => i.startsWith('subFactionGroups/doctrine/maxx: '))
        );
        assert.ok(issues.some((i) => i.startsWith('group: ')));
    });
});
