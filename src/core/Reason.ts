import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Definition,
	ReasonEventMap,
	ReasonInterface,
	ReasonOptions,
	Reasoning,
	ReasonResult,
	ReasonValidationResult,
	ReasonerInterface,
	Subject,
} from './types.js'
import { Emitter } from '@orkestrel/emitter'
import { isArray } from '@orkestrel/contract'
import { buildErrorResult } from './helpers.js'
import { DEFAULT_REASON_BAIL, DEFAULT_VALIDATE } from './constants.js'
import { ReasonError } from './errors.js'

/**
 * The reasoning orchestrator — a thin router over registered
 * {@link ReasonerInterface}s.
 *
 * @remarks
 * Holds NO strategy-specific logic: dispatch is purely a registry lookup by
 * `definition.reasoning` (one reasoner per reasoning; re-registration
 * replaces). A missing reasoner throws `MISSING` and a pre-run validation
 * failure (when the `validate` option is on) throws `INVALID` — both BYPASS
 * `bail` and emit nothing. A reasoner throw emits `error` with the raw thrown
 * value, then rethrows under `bail: true` (the default) or converts to a
 * type-shaped failure result under `bail: false`; only SUCCESSFUL results emit
 * `reason` (synchronously, before returning). The batch overload maps subjects
 * in order (validation, when on, repeats per subject). `destroy()` clears the
 * registry, emits `destroy`, then destroys the emitter LAST (AGENTS §13) and is
 * idempotent; every other method afterwards throws `DESTROYED` — only the
 * {@link emitter} getter keeps working.
 */
export class Reason implements ReasonInterface {
	readonly #reasoners = new Map<Reasoning, ReasonerInterface>()
	readonly #bail: boolean
	readonly #validate: boolean
	readonly #emitter: Emitter<ReasonEventMap>
	#destroyed = false

	constructor(options?: ReasonOptions) {
		this.#bail = options?.bail ?? DEFAULT_REASON_BAIL
		this.#validate = options?.validate ?? DEFAULT_VALIDATE
		this.#emitter = new Emitter<ReasonEventMap>({ on: options?.on, error: options?.error })
		// A later entry of the same reasoning replaces an earlier one.
		for (const reasoner of options?.reasoners ?? []) {
			this.#reasoners.set(reasoner.reasoning, reasoner)
		}
	}

	get emitter(): EmitterInterface<ReasonEventMap> {
		return this.#emitter
	}

	// Array overload first (AGENTS §9) so a list resolves to the batch form.
	reason(subjects: readonly Subject[], definition: Definition): readonly ReasonResult[]
	reason(subject: Subject, definition: Definition): ReasonResult
	reason(
		subject: Subject | readonly Subject[],
		definition: Definition,
	): ReasonResult | readonly ReasonResult[] {
		this.#ensureAlive()
		if (isArray<Subject>(subject)) {
			return subject.map((entry) => this.#reasonOne(entry, definition))
		}
		return this.#reasonOne(subject, definition)
	}

	register(reasoner: ReasonerInterface): void {
		this.#ensureAlive()
		this.#reasoners.set(reasoner.reasoning, reasoner)
		this.#emitter.emit('register', reasoner.reasoning)
	}

	reasoner(reasoning: Reasoning): ReasonerInterface | undefined {
		this.#ensureAlive()
		return this.#reasoners.get(reasoning)
	}

	reasoners(): readonly ReasonerInterface[] {
		this.#ensureAlive()
		return [...this.#reasoners.values()]
	}

	supports(reasoning: Reasoning): boolean {
		this.#ensureAlive()
		return this.#reasoners.has(reasoning)
	}

	validate(definition: Definition): ReasonValidationResult {
		this.#ensureAlive()
		const reasoner = this.#reasoners.get(definition.reasoning)
		// A missing reasoner is an invalid RESULT here (reason() is where it throws).
		if (!reasoner) {
			return {
				valid: false,
				errors: [`No reasoner registered for reasoning "${definition.reasoning}"`],
				warnings: [],
			}
		}
		return reasoner.validate(definition)
	}

	destroy(): void {
		// Idempotent by construction: a second call clears an empty registry and
		// emits into an already-destroyed emitter (a no-op).
		this.#reasoners.clear()
		this.#destroyed = true
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	// Dispatch one subject: registry lookup → optional validation → run, with
	// the bail policy deciding whether a reasoner throw escapes.
	#reasonOne(subject: Subject, definition: Definition): ReasonResult {
		const reasoner = this.#reasoners.get(definition.reasoning)
		if (!reasoner) {
			// Bypasses bail and emits nothing — a registry miss is caller misuse (§12).
			throw new ReasonError(
				'MISSING',
				`No reasoner registered for reasoning "${definition.reasoning}"`,
				{ definition: definition.id, reasoning: definition.reasoning },
			)
		}

		if (this.#validate) {
			const validation = reasoner.validate(definition)
			if (!validation.valid) {
				// Also bypasses bail and emits nothing — pre-run, not a reasoner fault.
				throw new ReasonError('INVALID', `Validation failed: ${validation.errors.join(', ')}`, {
					definition: definition.id,
					reasoning: definition.reasoning,
				})
			}
		}

		try {
			const result = reasoner.reason(subject, definition)
			this.#emitter.emit('reason', result)
			return result
		} catch (error) {
			this.#emitter.emit('error', error)
			if (this.#bail) throw error
			// bail: false converts the throw into a type-shaped failure result —
			// which does NOT emit 'reason'.
			const message = error instanceof Error ? error.message : String(error)
			return buildErrorResult(definition, message)
		}
	}

	#ensureAlive(): void {
		if (this.#destroyed) {
			throw new ReasonError('DESTROYED', 'Reason has been destroyed')
		}
	}
}
