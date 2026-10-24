import type { Faction, GameSystem, SourceManifest, SubFaction } from '../types';
import type { DataFile, GameDataSet } from './validate';

/*
 * A data source read into memory: its manifest and the files the manifest
 * lists. Free of Node imports; `readSource` fills it from disk and `loadSource`
 * from URLs.
 */

export const MANIFEST_FILE = 'forceorg.json';

/** what a source's manifest says about it */
export type SourceInfo = Pick<
    SourceManifest,
    'name' | 'description' | 'disclaimer'
>;

export type SourceOnDisk = {
    manifest: SourceManifest;
    /** each game the source provides, with its factions and sub-factions */
    provided: Array<GameDataSet>;
    /** files for games the source extends */
    extensions: Array<{
        game: string;
        versions: string;
        factions: Array<DataFile<Faction>>;
        subFactions: Array<DataFile<SubFaction>>;
    }>;
};

/* Builds the source from a manifest and a way to read each listed file */
export function assembleSource(
    manifest: SourceManifest,
    read: <T>(file: string) => DataFile<T>
): SourceOnDisk {
    const readAll = <T>(files: Array<string> = []) =>
        files.map((f) => read<T>(f));

    return {
        manifest,
        provided: (manifest.provides ?? []).map((p) => ({
            game: read<GameSystem>(p.game),
            factions: readAll<Faction>(p.factions),
            subFactions: readAll<SubFaction>(p.subFactions),
        })),
        extensions: (manifest.extends ?? []).map((e) => ({
            game: e.game,
            versions: e.versions,
            factions: readAll<Faction>(e.factions),
            subFactions: readAll<SubFaction>(e.subFactions),
        })),
    };
}

/* Every file the manifest lists, once each, in manifest order */
export function listedFiles(manifest: SourceManifest): Array<string> {
    return [
        ...new Set([
            ...(manifest.provides ?? []).flatMap((p) => [
                p.game,
                ...p.factions,
                ...(p.subFactions ?? []),
            ]),
            ...(manifest.extends ?? []).flatMap((e) => [
                ...(e.factions ?? []),
                ...(e.subFactions ?? []),
            ]),
        ]),
    ];
}
