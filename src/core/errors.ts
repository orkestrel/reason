import type { ReasonErrorCode } from './types.js'

// AGENTS §12: misuse of the reasons layer `throw`s a `ReasonError` carrying a
// machine-readable `code`, so a `catch` branches on `error.code`.

/**
 * An error thrown by the reasons layer.
 *
 * @remarks
 * Thrown for: dispatching a definition no registered reasoner handles
 * (`MISSING`), a pre-run validation failure when the orchestrator's `validate`
 * option is on (`INVALID`), handing a reasoner a definition of a different
 * reasoning (`MISMATCH`), any use of a destroyed orchestrator (`DESTROYED`),
 * and an `appendById` / `prependById` (or per-kind `append*` / `prepend*`)
 * `target` id naming no existing element (`TARGET`). `context`, when present,
 * carries the definition id and the reasoning involved (or, for `TARGET`, the
 * offending `id` / `target`).
 */
export class ReasonError extends Error {
	readonly code: ReasonErrorCode
	readonly context?: Readonly<Record<string, unknown>>

	constructor(code: ReasonErrorCode, message: string, context?: Readonly<Record<string, unknown>>) {
		super(message)
		this.name = 'ReasonError'
		this.code = code
		this.context = context
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
