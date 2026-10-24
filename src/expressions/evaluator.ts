import type {
    BuiltInScope,
    Call,
    CompiledExpression,
    ResolvedReference,
} from './checker';
import type { Argument, Expr } from './parser';

/*
 * Evaluates compiled expressions (spec §11) against an evaluation context:
 * the list as seen from where the rule sits. The evaluator knows nothing about
 * lists; each scope answers the verbs the spec defines for it.
 */

/**
 * One scope of the list (the unit, its group, the whole list, …). `unitTag`
 * references hold `tagId` forms, so compare tags with `tagId(tag)`.
 */
export type ScopeView = {
    count?(ref: ResolvedReference): number;
    is?(ref: ResolvedReference): boolean;
    sum?(resource: string, ref?: ResolvedReference): number;
    limit?(resource: string): number;
    models?(): number;
    picks?(): number;
    /** a configurable rule's value (its default when the unit gives none) */
    value?(): number;
    /** the option's sub-choice value */
    choice?(subChoice: string): string;
};

export type EvaluationContext = {
    /** the view for a built-in scope; undefined when it doesn't exist here (e.g. no slot yet) */
    scope(scope: BuiltInScope): ScopeView | undefined;
    /** the list's value for a list choice */
    choice(name: string): string | undefined;
};

export type Value = number | boolean | string;

/** A rule couldn't be evaluated (division by zero, a missing scope, a negative cost) */
export class EvaluationError extends Error {
    constructor(
        message: string,
        readonly start: number,
        readonly end: number
    ) {
        super(message);
        this.name = 'EvaluationError';
    }
}

class Evaluator {
    constructor(
        private readonly compiled: CompiledExpression,
        private readonly context: EvaluationContext
    ) {}

    private fail(message: string, node: { start: number; end: number }): never {
        throw new EvaluationError(message, node.start, node.end);
    }

    number(node: Expr): number {
        return this.value(node) as number;
    }

    boolean(node: Expr): boolean {
        return this.value(node) as boolean;
    }

    value(node: Expr): Value {
        switch (node.type) {
            case 'number':
            case 'boolean':
                return node.value;
            case 'name':
                // only reached as a choice value, compared by `compare`
                return node.name;
            case 'negate':
                return -this.number(node.operand);
            case 'not':
                return !this.boolean(node.operand);
            case 'arithmetic': {
                const left = this.number(node.left);
                const right = this.number(node.right);
                switch (node.operator) {
                    case '+':
                        return left + right;
                    case '-':
                        return left - right;
                    case '*':
                        return left * right;
                    case '/':
                        if (right === 0) this.fail('division by zero', node);
                        return left / right;
                }
                break;
            }
            case 'logical':
                return node.operator === 'and'
                    ? this.boolean(node.left) && this.boolean(node.right)
                    : this.boolean(node.left) || this.boolean(node.right);
            case 'compare': {
                const left = this.value(node.left);
                const right = this.value(node.right);
                switch (node.operator) {
                    case '==':
                        return left === right;
                    case '!=':
                        return left !== right;
                    case '<':
                        return left < right;
                    case '<=':
                        return left <= right;
                    case '>':
                        return left > right;
                    case '>=':
                        return left >= right;
                }
                break;
            }
            case 'conditional':
                return this.boolean(node.condition)
                    ? this.value(node.then)
                    : this.value(node.otherwise);
            case 'call':
                return this.call(node);
        }
        return this.fail('unknown expression', node);
    }

    private reference(arg: Argument): ResolvedReference {
        const ref = this.compiled.references.get(arg);
        if (!ref) this.fail('reference was not resolved', arg);
        return ref;
    }

    private call(node: Call): Value {
        if (!node.scope) return this.global(node);

        const scope = this.compiled.scopes.get(node);
        if (!scope) this.fail('scope was not resolved', node);
        const view = this.context.scope(scope);
        if (!view) this.fail(`there is no ${scope} here`, node.scope);

        const missing = (): never =>
            this.fail(`${scope}.${node.name}() isn't available here`, node);
        const name = (arg: Argument) => (arg.type === 'name' ? arg.name : '');
        const ref = (i: number) => this.reference(node.args[i]);

        switch (node.name) {
            case 'count':
                return view.count ? view.count(ref(0)) : missing();
            case 'has':
                return view.count ? view.count(ref(0)) > 0 : missing();
            case 'is':
                return view.is ? view.is(ref(0)) : missing();
            case 'sum':
                return view.sum
                    ? view.sum(
                          name(node.args[0]),
                          node.args[1] ? ref(1) : undefined
                      )
                    : missing();
            case 'limit':
                return view.limit ? view.limit(name(node.args[0])) : missing();
            case 'models':
                return view.models ? view.models() : missing();
            case 'picks':
                return view.picks ? view.picks() : missing();
            case 'value':
                return view.value ? view.value() : missing();
            case 'choice':
                return view.choice
                    ? view.choice(name(node.args[0]))
                    : missing();
        }
        return this.fail(`unknown function '${node.name}'`, node);
    }

    private global(node: Call): Value {
        const numbers = () => node.args.map((arg) => this.number(arg as Expr));
        switch (node.name) {
            case 'choice': {
                const arg = node.args[0];
                const choice = arg.type === 'name' ? arg.name : '';
                const value = this.context.choice(choice);
                if (value === undefined)
                    this.fail(`the list has no ${choice} set`, node);
                return value;
            }
            case 'floor':
                return Math.floor(numbers()[0]);
            case 'ceil':
                return Math.ceil(numbers()[0]);
            case 'min':
                return Math.min(...numbers());
            case 'max':
                return Math.max(...numbers());
        }
        return this.fail(`unknown function '${node.name}'`, node);
    }
}

/** Evaluates a compiled expression; throws `EvaluationError` when it can't */
export function evaluate(
    compiled: CompiledExpression,
    context: EvaluationContext
): Value {
    return new Evaluator(compiled, context).value(compiled.ast);
}

export type ConditionResult =
    | { met: true }
    /** `error` is set when the condition couldn't be evaluated, which counts as not met */
    | { met: false; error?: EvaluationError };

/** A `when`: met or not; an evaluation error counts as not met (spec §11) */
export function evaluateCondition(
    compiled: CompiledExpression,
    context: EvaluationContext
): ConditionResult {
    try {
        return evaluate(compiled, context) === true
            ? { met: true }
            : { met: false };
    } catch (error) {
        if (error instanceof EvaluationError) return { met: false, error };
        throw error;
    }
}

/**
 * A numeric field: `min` / `max` round down to a whole number, `cost` must not
 * be negative. Throws `EvaluationError`; callers treat the rule as not met.
 */
export function evaluateNumber(
    compiled: CompiledExpression,
    context: EvaluationContext,
    field: 'min' | 'max' | 'cost'
): number {
    const value = evaluate(compiled, context) as number;
    if (!Number.isFinite(value)) {
        throw new EvaluationError(
            'the result is not a number',
            0,
            compiled.source.length
        );
    }
    if (field === 'cost') {
        if (value < 0) {
            throw new EvaluationError(
                `a cost can't be negative (${value})`,
                0,
                compiled.source.length
            );
        }
        return value;
    }
    return Math.floor(value);
}
