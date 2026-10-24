import type { SourceManifest } from '../types';
import type { DataIssue } from './validate';

/*
 * The versions of the data format and of the expression language this build of
 * the app understands. Both are whole numbers that only go up when a change
 * would break data written for the version before: a new function or scope
 * doesn't count, a changed meaning or removed syntax does.
 *
 * A source declares them in its manifest (`schemaVersion`, `expressionVersion`).
 * A source newer than the app is refused; one older than the oldest still
 * supported is refused with a message to update it. Raise the current version
 * here, and keep the previous language's behaviour behind it, when the
 * language changes incompatibly (docs/specs/expression_language_spec_2026-10-17.md §14).
 */

export const SCHEMA_VERSION = 1;
export const OLDEST_SCHEMA_VERSION = 1;

export const EXPRESSION_VERSION = 1;
export const OLDEST_EXPRESSION_VERSION = 1;

/** The expression version a manifest without one is read as */
export const DEFAULT_EXPRESSION_VERSION = 1;

/** The expression language version a source's expressions are written for */
export const expressionVersionOf = (
    manifest: Pick<SourceManifest, 'expressionVersion'>
) => manifest.expressionVersion ?? DEFAULT_EXPRESSION_VERSION;

function checkVersion(
    what: string,
    value: unknown,
    field: string,
    current: number,
    oldest: number,
    file: string
): Array<DataIssue> {
    const issue = (message: string): DataIssue => ({
        severity: 'error',
        file,
        path: field,
        message,
    });

    if (!Number.isInteger(value) || (value as number) < 1) {
        return [issue(`${field} must be a whole number, 1 or more`)];
    }
    const version = value as number;
    if (version > current) {
        return [
            issue(
                `this source is written for ${what} version ${version}, but this version of Force Org only understands up to ${current}; update Force Org to use it`
            ),
        ];
    }
    if (version < oldest) {
        return [
            issue(
                `this source is written for ${what} version ${version}, which Force Org no longer supports (oldest supported: ${oldest}); the source needs updating`
            ),
        ];
    }
    return [];
}

/**
 * Checks a manifest's declared versions. Errors mean the source (its games
 * included) can't be loaded; a missing `expressionVersion` is only a warning.
 */
export function checkManifestVersions(
    manifest: Pick<SourceManifest, 'schemaVersion' | 'expressionVersion'>,
    file = 'forceorg.json'
): Array<DataIssue> {
    const issues = checkVersion(
        'data format',
        manifest.schemaVersion,
        'schemaVersion',
        SCHEMA_VERSION,
        OLDEST_SCHEMA_VERSION,
        file
    );
    if (manifest.expressionVersion === undefined) {
        issues.push({
            severity: 'warning',
            file,
            path: 'expressionVersion',
            message: `no expressionVersion: read as version ${DEFAULT_EXPRESSION_VERSION}; add "expressionVersion": ${EXPRESSION_VERSION} so the source keeps working if the expression language changes`,
        });
    } else {
        issues.push(
            ...checkVersion(
                'expression language',
                manifest.expressionVersion,
                'expressionVersion',
                EXPRESSION_VERSION,
                OLDEST_EXPRESSION_VERSION,
                file
            )
        );
    }
    return issues;
}
