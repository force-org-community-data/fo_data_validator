import { ExpressionSyntaxError } from './diagnostics';

/*
 * Lexer for the expression language (spec §4). Names may contain single
 * hyphens between name characters (`heavy-support`), so `a-b` is one name and
 * subtraction needs a space or a non-name token before the `-`. A name
 * followed directly by `:` and an id is a reference (`role:troop`).
 */

export type TokenType =
    | 'number'
    | 'name'
    | 'keyword'
    | 'reference'
    | 'selector'
    | 'operator'
    | 'end';

export type Token = {
    type: TokenType;
    /** the source text; for references `kind:id`, for selectors the id without `@` */
    text: string;
    start: number;
    end: number;
    /** references only */
    kind?: string;
    id?: string;
};

export const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);

const NAME = /[a-z][a-z0-9]*(?:-[a-z0-9]+)*/y;
const ID = /[a-z0-9]+(?:-[a-z0-9]+)*/y;
const NUMBER = /[0-9]+(?:\.[0-9]+)?/y;
const OPERATORS = ['==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/'];
const PUNCTUATION = ['(', ')', ',', '.', '?', ':'];

/* Matches a sticky pattern at `at`, returning the text or undefined */
function matchAt(pattern: RegExp, source: string, at: number) {
    pattern.lastIndex = at;
    return pattern.exec(source)?.[0];
}

export function tokenize(source: string): Array<Token> {
    const tokens: Array<Token> = [];
    let at = 0;

    while (at < source.length) {
        const char = source[at];

        if (/\s/.test(char)) {
            at++;
            continue;
        }

        const number = matchAt(NUMBER, source, at);
        if (number) {
            tokens.push({
                type: 'number',
                text: number,
                start: at,
                end: at + number.length,
            });
            at += number.length;
            continue;
        }

        if (char === '@') {
            const id = matchAt(ID, source, at + 1);
            if (!id) {
                throw new ExpressionSyntaxError(
                    "expected a selector id after '@'",
                    at
                );
            }
            tokens.push({
                type: 'selector',
                text: id,
                start: at,
                end: at + 1 + id.length,
            });
            at += 1 + id.length;
            continue;
        }

        const name = matchAt(NAME, source, at);
        if (name) {
            const afterName = at + name.length;
            const id =
                source[afterName] === ':'
                    ? matchAt(ID, source, afterName + 1)
                    : undefined;

            if (id) {
                tokens.push({
                    type: 'reference',
                    text: `${name}:${id}`,
                    kind: name,
                    id,
                    start: at,
                    end: afterName + 1 + id.length,
                });
                at = afterName + 1 + id.length;
            } else {
                tokens.push({
                    type: KEYWORDS.has(name) ? 'keyword' : 'name',
                    text: name,
                    start: at,
                    end: afterName,
                });
                at = afterName;
            }
            continue;
        }

        const operator =
            OPERATORS.find((op) => source.startsWith(op, at)) ??
            PUNCTUATION.find((p) => p === char);
        if (operator) {
            tokens.push({
                type: 'operator',
                text: operator,
                start: at,
                end: at + operator.length,
            });
            at += operator.length;
            continue;
        }

        throw new ExpressionSyntaxError(
            /[A-Z]/.test(char)
                ? `unexpected '${char}': names are lowercase`
                : `unexpected character '${char}'`,
            at
        );
    }

    tokens.push({ type: 'end', text: '', start: at, end: at });
    return tokens;
}
