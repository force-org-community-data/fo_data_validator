import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import { jsonSchemas, schemaId } from '../src/game_data/json_schema';
import { packageMajor } from '../scripts/package_major';
import { readSource } from '../src/game_data/read_source';
import {
    checkShape,
    checkShapes,
    sourceShapeFiles,
} from '../src/game_data/shape';

const root = path.join(import.meta.dirname, '..');

describe('generated JSON Schema', () => {
    it('has a stable $id on the major-version URL', () => {
        for (const { file, json } of jsonSchemas(packageMajor())) {
            assert.equal(
                (json as { $id: string }).$id,
                schemaId(packageMajor(), file)
            );
            assert.match(
                (json as { $id: string }).$id,
                /^https:\/\/cdn\.jsdelivr\.net\/gh\/force-org-data-team\/fo_data_validator@\d+\/schema\/[a-z-]+\.schema\.json$/
            );
        }
    });

    it('matches the zod schemas (run `npm run generate-schema` when this fails)', async () => {
        for (const { file, json } of jsonSchemas(packageMajor())) {
            const current = await fs.readFile(
                path.join(root, 'schema', file),
                'utf8'
            );
            assert.equal(
                current,
                JSON.stringify(json, null, 4) + '\n',
                `schema/${file} is out of date`
            );
        }
    });
});

describe('shape check of whole sources', () => {
    it('accepts every example source', async () => {
        const entries = await fs.readdir(path.join(root, 'examples'), {
            withFileTypes: true,
        });
        const dirs = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(root, 'examples', entry.name));
        for (const dir of dirs) {
            const source = await readSource(dir);
            assert.deepEqual(
                checkShapes(sourceShapeFiles(source, dir)),
                [],
                dir
            );
        }
    });

    it('reports what is wrong inside a union', () => {
        const issues = checkShape({
            file: 'f',
            kind: 'Faction',
            data: {
                id: 'x',
                name: 'X',
                version: '1',
                game: { id: 'g', versions: '*' },
                units: {
                    u: {
                        id: 'u',
                        name: 'U',
                        role: 'r',
                        type: 't',
                        cost: {},
                        modelCount: 1,
                        profiles: [],
                        upgrades: {
                            up: {
                                id: 'up',
                                name: 'Up',
                                perModel: { type: 'single' },
                                options: { o: { id: 'o', target: 5 } },
                            },
                        },
                    },
                },
                weapons: {},
                equipment: {},
                upgrades: {},
                specialRules: {},
                detachments: {},
            },
        });
        assert.deepEqual(
            issues.map((issue) => issue.path),
            ['units/u/upgrades/up/options/o/target']
        );
    });

    it('rejects an unknown key in a manifest', () => {
        const issues = checkShape({
            file: 'forceorg.json',
            kind: 'SourceManifest',
            data: { schemaVersion: 1, name: 'x', provide: [] },
        });
        assert.deepEqual(
            issues.map((issue) => `${issue.path}: ${issue.message}`),
            ["provide: unknown property 'provide'"]
        );
    });
});
