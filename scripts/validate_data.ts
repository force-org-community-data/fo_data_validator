import path from 'node:path';

import { formatDiagnostic } from '../src/expressions/diagnostics';
import { readSource } from '../src/game_data/read_source';
import { checkManifestVersions } from '../src/game_data/versions';
import { DataIssue, validateGameData } from '../src/game_data/validate';
import { checkShapes, ShapeFile } from '../src/game_data/shape';

/*
 * Checks data sources from the command line, with the same checker the app
 * and the integrity test use:
 *
 *   fo-validate <source dir> [<extension source dir> ...] [--json]
 *
 * Each file's shape is checked against the zod schemas first; the data
 * checker (ids, references, stats, expressions) runs once the shapes are right.
 * The first directory (any, in fact) provides the game; the others may extend
 * it. Exits 1 when there are errors. `--json` prints the issues as JSON.
 */

const args = process.argv.slice(2);
const json = args.includes('--json');
const dirs = args.filter((arg) => !arg.startsWith('--'));

const describe = (issue: DataIssue) =>
    `${issue.severity.toUpperCase()} ${issue.file} ${issue.path || '(file)'}: ${issue.message}` +
    (issue.expression
        ? `\n${formatDiagnostic(issue.expression.source, { ...issue, ...issue.expression })}`
        : '');

async function main() {
    if (dirs.length === 0) {
        console.error(
            'usage: npm run validate-data -- <source dir> [<extension source dir> ...] [--json]'
        );
        return 2;
    }

    const sources = await Promise.all(dirs.map((dir) => readSource(dir)));
    const sets = sources.flatMap((source) => source.provided);
    if (sets.length === 0) {
        console.error(
            'None of the sources provide a game: add a "provides" entry to a forceorg.json.'
        );
        return 2;
    }

    // extension sources add their files to the game they extend
    for (const extension of sources.flatMap((source) => source.extensions)) {
        const set = sets.find(({ game }) => game.data.id === extension.game);
        if (!set) {
            console.error(
                `A source extends the game '${extension.game}', but no source provides it.`
            );
            return 2;
        }
        set.factions.push(...extension.factions);
        set.subFactions.push(...extension.subFactions);
    }

    // files with the wrong shape would crash the data checker, so they go first
    const shapes: Array<ShapeFile> = [
        ...sources.map(({ manifest }, index) => ({
            file: `${path.basename(dirs[index])}/forceorg.json`,
            kind: 'SourceManifest' as const,
            data: manifest,
        })),
        ...sets.flatMap((set) => [
            { ...set.game, kind: 'GameSystem' as const },
            ...set.factions.map((f) => ({ ...f, kind: 'Faction' as const })),
            ...set.subFactions.map((f) => ({
                ...f,
                kind: 'SubFaction' as const,
            })),
        ]),
    ];
    const shapeIssues = checkShapes(shapes).map((issue): DataIssue => ({
        severity: 'error',
        ...issue,
    }));

    const versionIssues = sources.flatMap(({ manifest }, index) =>
        checkManifestVersions(
            manifest,
            `${path.basename(dirs[index])}/forceorg.json`
        )
    );
    const issues =
        shapeIssues.length > 0
            ? shapeIssues
            : [...versionIssues, ...sets.flatMap(validateGameData)];
    const errors = issues.filter((issue) => issue.severity === 'error');

    if (json) {
        console.log(JSON.stringify(issues, null, 2));
    } else {
        issues.forEach((issue) => console.log(describe(issue) + '\n'));
        const counts = [
            `${errors.length} error${errors.length === 1 ? '' : 's'}`,
            `${issues.length - errors.length} warning${issues.length - errors.length === 1 ? '' : 's'}`,
        ];
        console.log(
            `${sets.length} game${sets.length === 1 ? '' : 's'} checked (${dirs.map((dir) => path.basename(dir)).join(', ')}): ${counts.join(', ')}`
        );
    }
    return errors.length > 0 ? 1 : 0;
}

main().then(
    (code) => process.exit(code),
    (error) => {
        // a file with the wrong shape (a missing "options", a string where an
        // object goes) can crash the checker, which assumes the right shape
        console.error(
            `Could not check the data: ${error instanceof Error ? error.message : error}\n` +
                'If this is not a JSON or file-path problem, a file probably has the wrong shape: compare it with the schema (schema/*.schema.json).'
        );
        process.exit(2);
    }
);
