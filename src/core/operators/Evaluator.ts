import type { Check, CheckResult, EvaluatorInterface, EvaluatorOptions, Subject } from '../types.js'
import { isError, resolveField } from '@orkestrel/contract'
import { settleComparison } from '../helpers.js'
import { EVALUATOR_ID } from '../constants.js'

/**
 * Evaluates field predicates against subjects.
 *
 * @remarks
 * Every comparison reads `unread` when it cannot read a side, which {@link Comparison}
 * spells out, and a settled answer stays `met` or `unmet`. Fields resolve through the core
 * `resolveField` — a string `field` is one key (never dot-split), an array descends. An
 * unknown operator is caught into `state: 'unread'` with an `error` naming it, so
 * `evaluate` and `batch` are total.
 *
 * @example
 * ```ts
 * import { createCheck, createEvaluator } from '@orkestrel/reason'
 *
 * const evaluator = createEvaluator()
 * evaluator.evaluate(createCheck('age', 'above', 18), { age: 25 }) // { field: 'age', state: 'met', actual: 25 }
 * evaluator.evaluate(createCheck('age', 'above', 18), {}).state    // 'unread'
 * evaluator.batch([createCheck('age', 'above', 18)], { age: 25 })  // one CheckResult per check, positionally
 * ```
 */
export class Evaluator implements EvaluatorInterface {
	readonly #id: string

	constructor(options?: EvaluatorOptions) {
		this.#id = options?.id ?? EVALUATOR_ID
	}

	get id(): string {
		return this.#id
	}

	evaluate(check: Check, subject: Subject): CheckResult {
		const actual = resolveField(subject, check.field)
		try {
			return {
				field: check.field,
				state: settleComparison(actual, check.operator, check.value),
				actual,
			}
		} catch (error) {
			const message = isError(error) ? error.message : String(error)
			return { field: check.field, state: 'unread', actual, error: message }
		}
	}

	batch(checks: readonly Check[], subject: Subject): readonly CheckResult[] {
		return checks.map((check) => this.evaluate(check, subject))
	}
}
