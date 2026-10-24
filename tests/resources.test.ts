import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { GameSystem } from '../src/types';
import {
    resourcesFor,
    shownResources,
    usedFor,
} from '../src/game_data/resources';

/*
 * Which resources each kind of cost field offers and shows
 * (src/game_data/resources.ts).
 */

const game: Pick<GameSystem, 'resources'> = {
    resources: {
        points: { id: 'points', name: 'Points', scope: 'list' },
        slots: {
            id: 'slots',
            name: 'Slots',
            scope: 'unit',
        },
        reserve: { id: 'reserve', name: 'Reserve', scope: 'contingent' },
    },
};
const ids = (list: Array<{ id: string }>) => list.map(({ id }) => id);

describe('resourcesFor', () => {
    it('falls back to what each scope is used for', () => {
        assert.deepEqual(ids(resourcesFor(game, 'unit')), ['points']);
        assert.deepEqual(ids(resourcesFor(game, 'option')), [
            'points',
            'slots',
        ]);
        assert.deepEqual(ids(resourcesFor(game, 'group')), [
            'points',
            'reserve',
        ]);
        assert.deepEqual(ids(resourcesFor(game, 'grant')), ['reserve']);
    });

    it("follows a resource's own usedFor", () => {
        const custom = {
            resources: {
                ...game.resources,
                points: {
                    ...game.resources.points,
                    usedFor: ['unit' as const],
                },
            },
        };
        assert.deepEqual(ids(resourcesFor(custom, 'option')), ['slots']);
        assert.deepEqual(usedFor(custom.resources.points), ['unit']);
    });
});

describe('shownResources', () => {
    const option = resourcesFor(game, 'option');

    it('shows the resources with an amount or just added, in the game order', () => {
        assert.deepEqual(
            ids(shownResources(option, { slots: 1 }, [], 'option')),
            ['points', 'slots']
        );
    });

    it('always shows the main resource of a spending cost, and nothing extra for others', () => {
        assert.deepEqual(ids(shownResources(option, {}, [], 'option')), [
            'points',
        ]);
        assert.deepEqual(ids(shownResources(option, {}, ['slots'], 'option')), [
            'points',
            'slots',
        ]);
        assert.deepEqual(
            ids(shownResources(resourcesFor(game, 'grant'), {}, [], 'grant')),
            []
        );
    });
});
