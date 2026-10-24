import { z } from 'zod';

import { FILE_SCHEMAS, type ShapeKindName } from './schema';

/*
 * JSON Schema for the four kinds of data file, generated from the zod schemas.
 * Data authors point their editor at these (`"$schema"` in a file, or a
 * settings mapping) for completion and inline errors; they are the same shape
 * check `checkShapes` runs. Written to schema/ by `npm run generate-schema`.
 */

export const SCHEMA_FILES: Record<ShapeKindName, string> = {
    SourceManifest: 'source-manifest.schema.json',
    GameSystem: 'game.schema.json',
    Faction: 'faction.schema.json',
    SubFaction: 'sub-faction.schema.json',
};

export function jsonSchemas(): Array<{ file: string; json: unknown }> {
    return (Object.keys(SCHEMA_FILES) as Array<ShapeKindName>).map((kind) => ({
        file: SCHEMA_FILES[kind],
        json: {
            ...z.toJSONSchema(FILE_SCHEMAS[kind], {
                target: 'draft-7',
                reused: 'ref',
            }),
            title: kind,
        },
    }));
}
