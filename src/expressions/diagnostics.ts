/*
 * Errors and warnings from lexing, parsing and checking expressions
 * (docs/specs/expression_language_spec_2026-10-17.md §12).
 */

export type Severity = 'error' | 'warning';

export type Diagnostic = {
    severity: Severity;
    message: string;
    /** offsets into the source, end exclusive */
    start: number;
    end: number;
};

/** Thrown by the lexer and parser, which stop at the first problem */
export class ExpressionSyntaxError extends Error {
    constructor(
        message: string,
        readonly start: number,
        readonly end: number = start + 1
    ) {
        super(message);
        this.name = 'ExpressionSyntaxError';
    }

    toDiagnostic(): Diagnostic {
        return {
            severity: 'error',
            message: this.message,
            start: this.start,
            end: this.end,
        };
    }
}

/*
 * The source with a caret under the problem, e.g.
 *   choice(stance) == defensiv
 *                     ^^^^^^^^ 'defensiv' isn't a value of stance (did you mean 'defensive'?)
 */
export function formatDiagnostic(source: string, diagnostic: Diagnostic) {
    const width = Math.max(1, diagnostic.end - diagnostic.start);
    const caret = ' '.repeat(diagnostic.start) + '^'.repeat(width);

    return `  ${source}\n  ${caret} ${diagnostic.message}`;
}

/*
 * Edit distance between two names for "did you mean" suggestions, counting a
 * swap of two neighbouring letters as one edit (`cuont` → `count`)
 */
function distance(a: string, b: string): number {
    const d = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) =>
            i === 0 ? j : j === 0 ? i : 0
        )
    );

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + cost
            );
            if (
                i > 1 &&
                j > 1 &&
                a[i - 1] === b[j - 2] &&
                a[i - 2] === b[j - 1]
            ) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }

    return d[a.length][b.length];
}

/** The closest candidate, if it's close enough to be a likely typo */
export function closest(
    name: string,
    candidates: Iterable<string>
): string | undefined {
    let best: string | undefined;
    let bestDistance = Infinity;

    for (const candidate of candidates) {
        const d = distance(name, candidate);
        if (d < bestDistance) {
            best = candidate;
            bestDistance = d;
        }
    }

    const limit = Math.max(1, Math.floor(name.length / 3));
    return bestDistance <= limit ? best : undefined;
}

/** " (did you mean 'x'?)" when a close candidate exists, else '' */
export function didYouMean(name: string, candidates: Iterable<string>) {
    const match = closest(name, candidates);
    return match ? ` (did you mean '${match}'?)` : '';
}
