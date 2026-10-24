import {
    ExpressionSyntaxError,
    type Diagnostic,
    type Severity,
} from './diagnostics';
import { tokenize, type TokenType } from './lexer';

/*
 * Syntax highlighting for expression inputs: the source split into runs that
 * share a token kind and problem, covering every character (whitespace
 * included) so the runs laid end to end give back the source. Uses the
 * expression lexer, so the colours always agree with what the checker reads.
 */

export type HighlightKind = Exclude<TokenType, 'end'> | 'invalid' | 'plain';

export type Segment = {
    text: string;
    start: number;
    end: number;
    kind: HighlightKind;
    /** the worst checker problem on this run, for an underline */
    problem?: Severity;
};

/*
 * Token kinds by character. Unlike `tokenize` this never stops: a character
 * the lexer rejects is marked invalid and lexing goes on after it.
 */
function kindsOf(source: string): Array<HighlightKind> {
    const kinds: Array<HighlightKind> = Array(source.length).fill('plain');
    let at = 0;
    while (at < source.length) {
        const rest = source.slice(at);
        let lexed = rest;
        let invalid: number | undefined;
        try {
            tokenize(rest);
        } catch (error) {
            if (!(error instanceof ExpressionSyntaxError)) throw error;
            invalid = error.start;
            lexed = rest.slice(0, invalid);
        }
        for (const { type, start, end } of tokenize(lexed)) {
            if (type === 'end') continue;
            kinds.fill(type, at + start, at + end);
        }
        if (invalid === undefined) break;
        kinds[at + invalid] = 'invalid';
        at += invalid + 1;
    }
    return kinds;
}

const WORSE: Record<Severity, number> = { warning: 1, error: 2 };

/* The worst problem on each character; an empty span marks the one before it */
function problemsOf(
    source: string,
    diagnostics: ReadonlyArray<Diagnostic>
): Array<Severity | undefined> {
    const problems: Array<Severity | undefined> = Array(source.length).fill(
        undefined
    );
    for (const { severity, start, end } of diagnostics) {
        const from = Math.min(start, Math.max(source.length - 1, 0));
        const to = Math.min(Math.max(end, from + 1), source.length);
        for (let i = from; i < to; i++) {
            const current = problems[i];
            if (!current || WORSE[severity] > WORSE[current])
                problems[i] = severity;
        }
    }
    return problems;
}

export function highlight(
    source: string,
    diagnostics: ReadonlyArray<Diagnostic> = []
): Array<Segment> {
    const kinds = kindsOf(source);
    const problems = problemsOf(source, diagnostics);

    const segments: Array<Segment> = [];
    for (let i = 0; i < source.length; i++) {
        const last = segments[segments.length - 1];
        if (last && last.kind === kinds[i] && last.problem === problems[i]) {
            last.text += source[i];
            last.end = i + 1;
        } else {
            segments.push({
                text: source[i],
                start: i,
                end: i + 1,
                kind: kinds[i],
                ...(problems[i] && { problem: problems[i] }),
            });
        }
    }
    return segments;
}
