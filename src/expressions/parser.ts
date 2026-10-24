import { ExpressionSyntaxError } from './diagnostics';
import { Token, tokenize } from './lexer';

/*
 * Recursive-descent parser for the expression language (spec §5). Every node
 * keeps its source span so the checker can point at the problem.
 */

type Span = { start: number; end: number };

export type CompareOperator = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type ArithmeticOperator = '+' | '-' | '*' | '/';

export type Expr =
    | (Span & { type: 'number'; value: number })
    | (Span & { type: 'boolean'; value: boolean })
    /** a bare name: a choice name or value, or a resource id */
    | (Span & { type: 'name'; name: string })
    | (Span & { type: 'negate'; operand: Expr })
    | (Span & { type: 'not'; operand: Expr })
    | (Span & {
          type: 'arithmetic';
          operator: ArithmeticOperator;
          left: Expr;
          right: Expr;
      })
    | (Span & {
          type: 'compare';
          operator: CompareOperator;
          left: Expr;
          right: Expr;
      })
    | (Span & {
          type: 'logical';
          operator: 'and' | 'or';
          left: Expr;
          right: Expr;
      })
    | (Span & {
          type: 'conditional';
          condition: Expr;
          then: Expr;
          otherwise: Expr;
      })
    | (Span & {
          type: 'call';
          /** the scope as written (a built-in name or the game's word); left out for global functions */
          scope?: { name: string } & Span;
          name: string;
          nameSpan: Span;
          args: Array<Argument>;
      });

/** References and selectors only exist as call arguments */
export type Argument =
    | Expr
    | (Span & { type: 'reference'; kind: string; id: string; kindSpan: Span })
    | (Span & { type: 'selector'; id: string });

const COMPARE_OPERATORS = ['==', '!=', '<', '<=', '>', '>='];

class Parser {
    private index = 0;

    constructor(private readonly tokens: Array<Token>) {}

    private get current() {
        return this.tokens[this.index];
    }

    private is(text: string) {
        const { type } = this.current;
        return (
            (type === 'operator' || type === 'keyword') &&
            this.current.text === text
        );
    }

    private next() {
        return this.tokens[this.index++];
    }

    private expect(text: string) {
        if (!this.is(text)) {
            const found = this.current.text || 'the end';
            throw new ExpressionSyntaxError(
                `expected '${text}' but found '${found}'`,
                this.current.start,
                Math.max(this.current.end, this.current.start + 1)
            );
        }
        return this.next();
    }

    parse(): Expr {
        const expr = this.conditional();
        if (this.current.type !== 'end') {
            throw new ExpressionSyntaxError(
                `unexpected '${this.current.text}'`,
                this.current.start,
                this.current.end
            );
        }
        return expr;
    }

    private conditional(): Expr {
        const condition = this.or();
        if (!this.is('?')) return condition;

        this.next();
        const then = this.conditional();
        this.expect(':');
        const otherwise = this.conditional();

        return {
            type: 'conditional',
            condition,
            then,
            otherwise,
            start: condition.start,
            end: otherwise.end,
        };
    }

    private or(): Expr {
        let left = this.and();
        while (this.is('or')) {
            this.next();
            const right = this.and();
            left = {
                type: 'logical',
                operator: 'or',
                left,
                right,
                start: left.start,
                end: right.end,
            };
        }
        return left;
    }

    private and(): Expr {
        let left = this.not();
        while (this.is('and')) {
            this.next();
            const right = this.not();
            left = {
                type: 'logical',
                operator: 'and',
                left,
                right,
                start: left.start,
                end: right.end,
            };
        }
        return left;
    }

    private not(): Expr {
        if (!this.is('not')) return this.comparison();

        const { start } = this.next();
        const operand = this.not();
        return { type: 'not', operand, start, end: operand.end };
    }

    private comparison(): Expr {
        const left = this.additive();
        if (!COMPARE_OPERATORS.some((op) => this.is(op))) return left;

        const operator = this.next().text as CompareOperator;
        const right = this.additive();

        if (COMPARE_OPERATORS.some((op) => this.is(op))) {
            throw new ExpressionSyntaxError(
                "comparisons can't be chained; use 'and'",
                this.current.start,
                this.current.end
            );
        }

        return {
            type: 'compare',
            operator,
            left,
            right,
            start: left.start,
            end: right.end,
        };
    }

    private additive(): Expr {
        let left = this.multiplicative();
        while (this.is('+') || this.is('-')) {
            const operator = this.next().text as ArithmeticOperator;
            const right = this.multiplicative();
            left = {
                type: 'arithmetic',
                operator,
                left,
                right,
                start: left.start,
                end: right.end,
            };
        }
        return left;
    }

    private multiplicative(): Expr {
        let left = this.unary();
        while (this.is('*') || this.is('/')) {
            const operator = this.next().text as ArithmeticOperator;
            const right = this.unary();
            left = {
                type: 'arithmetic',
                operator,
                left,
                right,
                start: left.start,
                end: right.end,
            };
        }
        return left;
    }

    private unary(): Expr {
        if (!this.is('-')) return this.primary();

        const { start } = this.next();
        const operand = this.unary();
        return { type: 'negate', operand, start, end: operand.end };
    }

    private primary(): Expr {
        const token = this.next();
        const { start, end } = token;

        switch (token.type) {
            case 'number':
                return {
                    type: 'number',
                    value: Number(token.text),
                    start,
                    end,
                };
            case 'keyword':
                if (token.text === 'true' || token.text === 'false') {
                    return {
                        type: 'boolean',
                        value: token.text === 'true',
                        start,
                        end,
                    };
                }
                break;
            case 'reference':
                throw new ExpressionSyntaxError(
                    `'${token.text}' is a reference and can only be a call argument (for a conditional, put spaces around ':')`,
                    start,
                    end
                );
            case 'selector':
                throw new ExpressionSyntaxError(
                    `'@${token.text}' is a selector and can only be a call argument`,
                    start,
                    end
                );
            case 'operator':
                if (token.text === '(') {
                    const inner = this.conditional();
                    this.expect(')');
                    return inner;
                }
                break;
            case 'name':
                return this.nameOrCall(token);
        }

        throw new ExpressionSyntaxError(
            token.type === 'end'
                ? 'the expression ends too early'
                : `unexpected '${token.text}'`,
            start,
            Math.max(end, start + 1)
        );
    }

    private nameOrCall(token: Token): Expr {
        if (this.is('.')) {
            this.next();
            const fn = this.next();
            if (fn.type !== 'name') {
                throw new ExpressionSyntaxError(
                    `expected a function name after '${token.text}.'`,
                    fn.start,
                    Math.max(fn.end, fn.start + 1)
                );
            }
            if (!this.is('(')) {
                throw new ExpressionSyntaxError(
                    `'${token.text}.${fn.text}' must be called, e.g. ${token.text}.${fn.text}(…)`,
                    token.start,
                    fn.end
                );
            }
            return this.call(fn, {
                name: token.text,
                start: token.start,
                end: token.end,
            });
        }

        if (this.is('(')) return this.call(token);

        return {
            type: 'name',
            name: token.text,
            start: token.start,
            end: token.end,
        };
    }

    private call(fn: Token, scope?: { name: string } & Span): Expr {
        this.expect('(');
        const args: Array<Argument> = [];

        if (!this.is(')')) {
            do {
                if (args.length) this.next();
                args.push(this.argument());
            } while (this.is(','));
        }
        const close = this.expect(')');

        return {
            type: 'call',
            scope,
            name: fn.text,
            nameSpan: { start: fn.start, end: fn.end },
            args,
            start: scope?.start ?? fn.start,
            end: close.end,
        };
    }

    private argument(): Argument {
        const token = this.current;

        if (token.type === 'reference') {
            this.next();
            return {
                type: 'reference',
                kind: token.kind!,
                id: token.id!,
                kindSpan: {
                    start: token.start,
                    end: token.start + token.kind!.length,
                },
                start: token.start,
                end: token.end,
            };
        }
        if (token.type === 'selector') {
            this.next();
            return {
                type: 'selector',
                id: token.text,
                start: token.start,
                end: token.end,
            };
        }

        return this.conditional();
    }
}

/** Parses an expression, throwing `ExpressionSyntaxError` at the first problem */
export function parseExpression(source: string): Expr {
    return new Parser(tokenize(source)).parse();
}
