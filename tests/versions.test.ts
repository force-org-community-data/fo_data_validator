import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    checkManifestVersions,
    EXPRESSION_VERSION,
    expressionVersionOf,
    SCHEMA_VERSION,
} from '../src/game_data/versions';

const current = {
    schemaVersion: SCHEMA_VERSION,
    expressionVersion: EXPRESSION_VERSION,
};

describe('manifest versions', () => {
    it('accepts the current versions', () => {
        assert.deepEqual(checkManifestVersions(current), []);
    });

    it('reads a missing expressionVersion as 1, with a warning', () => {
        const issues = checkManifestVersions({ schemaVersion: SCHEMA_VERSION });
        assert.equal(issues.length, 1);
        assert.equal(issues[0].severity, 'warning');
        assert.equal(issues[0].path, 'expressionVersion');
        assert.equal(expressionVersionOf({}), 1);
    });

    it('refuses an expression language newer than the app', () => {
        const [issue] = checkManifestVersions({
            ...current,
            expressionVersion: EXPRESSION_VERSION + 1,
        });
        assert.equal(issue.severity, 'error');
        assert.match(issue.message, /update Force Org/);
    });

    it('refuses a data format newer than the app', () => {
        const [issue] = checkManifestVersions({
            ...current,
            schemaVersion: SCHEMA_VERSION + 1,
        });
        assert.equal(issue.severity, 'error');
        assert.equal(issue.path, 'schemaVersion');
    });

    it('refuses versions that are not whole numbers of 1 or more', () => {
        for (const bad of [0, -1, 1.5, '1' as unknown as number]) {
            const issues = checkManifestVersions({
                ...current,
                expressionVersion: bad,
            });
            assert.equal(issues[0]?.severity, 'error', String(bad));
        }
    });
});
