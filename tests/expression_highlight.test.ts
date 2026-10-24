import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Diagnostic } from '../src/expressions/diagnostics';
import { highlight } from '../src/expressions/highlight';

/*
 * Syntax highlighting runs (src/expressions/highlight.ts): they cover the
 * whole source, follow the lexer's token kinds, carry on past characters the
 * lexer rejects and pick up the checker's problems.
 */

const runs = (source: string, diagnostics?: Array<Diagnostic>) =>
    highlight(source, diagnostics).map(({ text, kind, problem }) =>
        problem ? [text, kind, problem] : [text, kind]
    );

describe('highlight', () => {
    it('splits an expression into token kinds, whitespace included', () => {
        assert.deepEqual(runs('unit.count(role:troop) >= 2 and not @heavy'), [
            ['unit', 'name'],
            ['.', 'operator'],
            ['count', 'name'],
            ['(', 'operator'],
            ['role:troop', 'reference'],
            [')', 'operator'],
            [' ', 'plain'],
            ['>=', 'operator'],
            [' ', 'plain'],
            ['2', 'number'],
            [' ', 'plain'],
            ['and', 'keyword'],
            [' ', 'plain'],
            ['not', 'keyword'],
            [' ', 'plain'],
            ['@heavy', 'selector'],
        ]);
    });

    it('gives back the source when the runs are joined', () => {
        const source = 'rule.value() - 1  +  list.units()';
        assert.equal(
            highlight(source)
                .map(({ text }) => text)
                .join(''),
            source
        );
    });

    it('marks characters the lexer rejects and carries on', () => {
        assert.deepEqual(runs('1 # 2'), [
            ['1', 'number'],
            [' ', 'plain'],
            ['#', 'invalid'],
            [' ', 'plain'],
            ['2', 'number'],
        ]);
    });

    it("underlines the checker's problems, errors over warnings", () => {
        assert.deepEqual(
            runs('foo + 1', [
                { severity: 'warning', message: 'w', start: 0, end: 7 },
                { severity: 'error', message: 'e', start: 0, end: 3 },
            ]),
            [
                ['foo', 'name', 'error'],
                [' ', 'plain', 'warning'],
                ['+', 'operator', 'warning'],
                [' ', 'plain', 'warning'],
                ['1', 'number', 'warning'],
            ]
        );
    });

    it('marks the last character for a problem at the very end', () => {
        assert.deepEqual(
            runs('1 +', [
                { severity: 'error', message: 'e', start: 3, end: 3 },
            ]),
            [
                ['1', 'number'],
                [' ', 'plain'],
                ['+', 'operator', 'error'],
            ]
        );
    });

    it('has nothing to show for an empty expression', () => {
        assert.deepEqual(highlight(''), []);
    });
});
