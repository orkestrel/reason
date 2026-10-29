import type { ReasonErrorCode } from './types.js'
import { holds, INTRINSICS, isFunction, isInstance, isObject, isString } from '@orkestrel/contract'

// Misuse of the reasons layer `throw`s a `ReasonError` carrying a
// machine-readable `code`, so a `catch` branches on `error.code`.

/**
 * Represents an error thrown by the reasons layer.
 *
 * @remarks
 * Thrown for: dispatching a definition no registered reasoner handles
 * (`MISSING`); a pre-run validation failure when the orchestrator's `validate`
 * option is on (`INVALID`); a cross-reasoning definition handed to a reasoner
 * or to a `DefinitionBuilder`'s `merge`, a `clear` key that is not clearable
 * for the builder's reasoning, or a write to a `SubjectBuilder`'s immutable
 * `id` (`MISMATCH`); any use of a destroyed orchestrator, builder, or manager
 * (`DESTROYED`); a locator id naming no existing element — an `appendById` /
 * `prependById` (or per-kind `append*` / `prepend*`) `target`, or the required
 * `groupId` a `FactorManager` verb threads (`TARGET`); and a math operator
 * outside the accepted vocabulary (`OPERATOR`). `context`, when present,
 * carries the definition id and the reasoning involved, or the offending
 * `id` / `target` / `groupId` for `TARGET`, the `key` for a non-clearable
 * `clear`, and the `operator` for `OPERATOR`.
 */
export class ReasonError extends Error {
	readonly code: ReasonErrorCode
	readonly context?: Readonly<Record<string, unknown>>

	constructor(code: ReasonErrorCode, message: string, context?: Readonly<Record<string, unknown>>) {
		super(message)
		Object.defineProperty(this, Symbol.for('@orkestrel/reason.ReasonError'), { value: this })
		this.name = 'ReasonError'
		this.code = code
		if (context !== undefined) this.context = context
	}
}

/**
 * Narrows an unknown caught value to a {@link ReasonError}.
 *
 * @remarks
 * Accepts errors from another installed copy and subclasses regardless of `name`.
 * Requires the own self-valued `Symbol.for('@orkestrel/reason.ReasonError')`
 * brand, a non-base global `Error` prototype, and valid declared members.
 * Plain objects, unbranded look-alikes, and transparent proxies are rejected.
 * Hostile reads return false through the contract intrinsics inside `holds`.
 *
 * @param value - The value to test (typically a `catch` binding)
 * @returns True if `value` is a {@link ReasonError}; false otherwise
 *
 * @example
 * ```ts
 * try {
 * 	reason.reason(subject, definition)
 * } catch (error) {
 * 	if (isReasonError(error) && error.code === 'MISSING') registerFallback()
 * }
 * ```
 */
export function isReasonError(value: unknown): value is ReasonError {
	return holds(() => {
		if (!isInstance(value, Error) || INTRINSICS.prototype(value) === Error.prototype) return false
		const brand = INTRINSICS.describe(value, Symbol.for('@orkestrel/reason.ReasonError'))
		if (brand?.value !== value) return false
		const code: unknown = INTRINSICS.reflect.read(value, 'code')
		const context: unknown = INTRINSICS.reflect.read(value, 'context')
		return (
			(code === 'MISSING' ||
				code === 'INVALID' ||
				code === 'MISMATCH' ||
				code === 'DESTROYED' ||
				code === 'TARGET' ||
				code === 'OPERATOR') &&
			isString(INTRINSICS.reflect.read(value, 'message')) &&
			(context === undefined || isObject(context) || isFunction(context))
		)
	})
}
