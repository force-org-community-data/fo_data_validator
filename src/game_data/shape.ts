import { z } from 'zod';

import { FILE_SCHEMAS } from './schema';
import type { SourceOnDisk } from './source';

/*
 * Checks that data files have the shape the schemas in ./schema.ts describe:
 * missing fields, wrong types, misspelt keys and bad enum values, which the
 * data checker (validateGameData) assumes are already right. Free of Node
 * imports so it can check sources fetched in the browser as well as the CLI.
 */

export type ShapeKind = keyof typeof FILE_SCHEMAS;

export type ShapeFile = { file: string; kind: ShapeKind; data: unknown };

export type ShapeIssue = {
    file: string;
    /** where in the file, e.g. `units/carrier/profiles/0` */
    path: string;
    message: string;
};

type Issue = z.core.$ZodIssue;

const MAX_ISSUES_PER_FILE = 50;

const join = (path: ReadonlyArray<PropertyKey>) =>
    path.map((part) => String(part)).join('/');

/* The issues of a union's best branch: the one that got furthest, i.e. has the fewest problems */
function bestBranch(issue: Issue & { code: 'invalid_union' }): Array<Issue> {
    const branches = issue.errors as unknown as Array<Array<Issue>>;
    if (!branches?.length) return [issue];
    return branches.reduce((best, branch) =>
        branch.length < best.length ? branch : best
    );
}

/* Turns zod's issues into path + message pairs, flattening unions and listing unknown keys singly */
function describe(
    issue: Issue,
    prefix: ReadonlyArray<PropertyKey> = []
): Array<{ path: string; message: string }> {
    const path = [...prefix, ...issue.path];
    switch (issue.code) {
        case 'invalid_union':
            return bestBranch(issue).flatMap((inner) => describe(inner, path));
        case 'unrecognized_keys':
            return issue.keys.map((key) => ({
                path: join([...path, key]),
                message: `unknown property '${key}'`,
            }));
        case 'invalid_type':
            return [
                {
                    path: join(path),
                    // zod words a missing value as 'received undefined'
                    message: issue.message.endsWith('received undefined')
                        ? `missing required property '${String(path.at(-1))}'`
                        : issue.message,
                },
            ];
        default:
            return [{ path: join(path), message: issue.message }];
    }
}

/* A missing property is reported on the object that lacks it */
const missing = /^missing required property '(.*)'$/;

export function checkShape(file: ShapeFile): Array<ShapeIssue> {
    const result = FILE_SCHEMAS[file.kind].safeParse(file.data);
    if (result.success) return [];
    return result.error.issues
        .flatMap((issue) => describe(issue))
        .map(({ path, message }) => {
            const key = missing.exec(message)?.[1];
            return key !== undefined && path.endsWith(key)
                ? {
                      file: file.file,
                      path: path.slice(
                          0,
                          Math.max(0, path.length - key.length - 1)
                      ),
                      message,
                  }
                : { file: file.file, path, message };
        })
        .slice(0, MAX_ISSUES_PER_FILE);
}

export const checkShapes = (files: Array<ShapeFile>): Array<ShapeIssue> =>
    files.flatMap(checkShape);

/** The files of a loaded source as `checkShapes` takes them; `label` names the manifest's file */
export function sourceShapeFiles(
    source: SourceOnDisk,
    label = 'forceorg.json'
): Array<ShapeFile> {
    return [
        { file: label, kind: 'SourceManifest', data: source.manifest },
        ...source.provided.flatMap((set) => [
            { ...set.game, kind: 'GameSystem' as const },
            ...set.factions.map((f) => ({ ...f, kind: 'Faction' as const })),
            ...set.subFactions.map((f) => ({
                ...f,
                kind: 'SubFaction' as const,
            })),
        ]),
        ...source.extensions.flatMap((extension) => [
            ...extension.factions.map((f) => ({
                ...f,
                kind: 'Faction' as const,
            })),
            ...extension.subFactions.map((f) => ({
                ...f,
                kind: 'SubFaction' as const,
            })),
        ]),
    ];
}
