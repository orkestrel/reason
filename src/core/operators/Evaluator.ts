import type { Check, CheckResult, EvaluatorInterface, EvaluatorOptions, Subject } from '../types.js'
import { isArray, isNumber, resolveField } from '@orkestrel/contract'
import { EVALUATOR_ID } from '../constants.js'

/**
 * Evaluates {@link Check}s against subjects — the shared predicate engine of the
 * quantitative and logical reasoners.
 *
 * @remarks
 * TOTAL and strict: `evaluate` never throws (an unknown operator is caught and
 * surfaced as `CheckResult.error` with `met: false`) and never coerces —
 * `equals` / `not` are raw `===` / `!==`, the ordering operators demand numbers
 * on BOTH sides, `any` / `none` demand an array expected value (a non-array is
 * not met for either — `none` is NOT the raw complement of `any` on malformed
 * input), while `outside` IS the pure negation of `between` (so a malformed
 * range is `outside`). Fields resolve through the core `resolveField` — a string
 * is ONE key, an array descends. Stateless and deterministic.
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
			const met = this.#compare(actual, check.operator, check.value)
			return { field: check.field, met, actual }
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			return { field: check.field, met: false, actual, error: message }
		}
	}

	batch(checks: readonly Check[], subject: Subject): readonly CheckResult[] {
		return checks.map((check) => this.evaluate(check, subject))
	}

	// The one throwing path is the unknown-operator default — caught by `evaluate`.
	// `operator` is typed `string` because untrusted definitions reach here unchecked.
	#compare(actual: unknown, operator: string, expected: unknown): boolean {
		switch (operator) {
			case 'equals':
				return actual === expected
			case 'not':
				return actual !== expected
			case 'above':
				return isNumber(actual) && isNumber(expected) && actual > expected
			case 'below':
				return isNumber(actual) && isNumber(expected) && actual < expected
			case 'from':
				return isNumber(actual) && isNumber(expected) && actual >= expected
			case 'to':
				return isNumber(actual) && isNumber(expected) && actual <= expected
			case 'any':
				return isArray(expected) && expected.includes(actual)
			case 'none':
				return isArray(expected) && !expected.includes(actual)
			case 'between':
				return this.#isBetween(actual, expected)
			case 'outside':
				return !this.#isBetween(actual, expected)
			default:
				throw new Error(`Unknown comparison operator: ${operator}`)
		}
	}

	// Inclusive on both ends; only the first two array elements are read.
	#isBetween(actual: unknown, expected: unknown): boolean {
		if (!isNumber(actual)) return false
		if (!isArray(expected) || expected.length < 2) return false
		const minimum = expected[0]
		const maximum = expected[1]
		if (!isNumber(minimum) || !isNumber(maximum)) return false
		return actual >= minimum && actual <= maximum
	}
}
