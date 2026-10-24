import { z } from 'zod';

import { FILE_SCHEMAS, type ShapeKindName } from './schema';

/*
 * JSON Schema for the four kinds of data file, generated from the zod schemas.
 * Data authors point their editor at these (`"$schema"` in a file, or a
 * settings mapping) for completion and inline errors; they are the same shape
 * check `checkShapes` runs. Written to schema/ by `npm run generate-schema`, which passes the package's major version.
 */

export const SCHEMA_FILES: Record<ShapeKindName, string> = {
    SourceManifest: 'source-manifest.schema.json',
    GameSystem: 'game.schema.json',
    Faction: 'faction.schema.json',
    SubFaction: 'sub-faction.schema.json',
};

/*
 * Where the schemas are served from (jsDelivr reads git tags). `@<major>`
 * resolves to the newest tag of that major version, so the `$id` stays valid
 * across minor and patch releases and changes only when the data format or
 * expression language does. Authors wanting a frozen schema use an exact tag
 * (`@1.2.3`) in place of the major.
 */
export const SCHEMA_ID_BASE =
    'https://cdn.jsdelivr.net/gh/force-org-data-team/fo_data_validator';

export const schemaId = (major: number, file: string) =>
    `${SCHEMA_ID_BASE}@${major}/schema/${file}`;

/** @param major the package's semver major, which sets each schema's `$id` */
export function jsonSchemas(
    major: number
): Array<{ file: string; json: unknown }> {
    return (Object.keys(SCHEMA_FILES) as Array<ShapeKindName>).map((kind) => ({
        file: SCHEMA_FILES[kind],
        json: {
            $id: schemaId(major, SCHEMA_FILES[kind]),
            ...z.toJSONSchema(FILE_SCHEMAS[kind], {
                target: 'draft-7',
                reused: 'ref',
            }),
            title: kind,
        },
    }));
}
