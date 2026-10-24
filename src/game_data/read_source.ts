import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { SourceManifest } from '../types';
import {
    assembleSource,
    listedFiles,
    MANIFEST_FILE,
    type SourceOnDisk,
} from './source';
import type { DataFile } from './validate';

export type { SourceOnDisk } from './source';

/*
 * Reads a data source (a folder with a `forceorg.json` manifest) from disk.
 * Server, script and test use only; sources on the web will be fetched by URL.
 */

export { MANIFEST_FILE };

/* Parses a source file, naming it when the JSON is broken */
function parseJson(file: string, text: string) {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(
            `${file} isn't valid JSON: ${error instanceof Error ? error.message : error}`
        );
    }
}

export function readSourceSync(dir: string): SourceOnDisk {
    const read = <T>(file: string): DataFile<T> => ({
        file,
        data: parseJson(
            file,
            fsSync.readFileSync(path.join(dir, file), 'utf8')
        ),
    });
    return assembleSource(read<SourceManifest>(MANIFEST_FILE).data, read);
}

export async function readSource(dir: string): Promise<SourceOnDisk> {
    // read every file up front, then assemble synchronously from memory
    const manifest: SourceManifest = parseJson(
        MANIFEST_FILE,
        await fs.readFile(path.join(dir, MANIFEST_FILE), 'utf8')
    );
    const listed = listedFiles(manifest);
    const contents = new Map(
        await Promise.all(
            listed.map(
                async (file) =>
                    [
                        file,
                        parseJson(
                            file,
                            await fs.readFile(path.join(dir, file), 'utf8')
                        ),
                    ] as const
            )
        )
    );

    return assembleSource(manifest, <T>(file: string) => ({
        file,
        data: contents.get(file) as T,
    }));
}
