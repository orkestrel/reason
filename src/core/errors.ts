import type { ReasonErrorCode } from './types.js'

// Misuse of the reasons layer `throw`s a `ReasonError` carrying a
// machine-readable `code`, so a `catch` branches on `error.code`.

/**
 * An error thrown by the reasons layer.
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
		this.name = 'ReasonError'
		this.code = code
		if (context !== undefined) this.context = context
	}
}

/**
 * Narrow an unknown caught value to a {@link ReasonError}.
 *
 * @param value - The value to test (typically a `catch` binding)
 * @returns `true` when `value` is a {@link ReasonError}
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
	return value instanceof ReasonError
}
