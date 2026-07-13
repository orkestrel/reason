import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Inference,
	InferenceManagerEventMap,
	InferenceManagerInterface,
	InferenceManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { appendById, prependById, removeById, replaceById } from '../../helpers.js'
import { ReasonError } from '../../errors.js'

/**
 * The {@link InferenceManagerInterface} implementation — a self-owning,
 * kind-free manager over an inferential definition's `inferences`.
 *
 * @remarks
 * OWNS its `#inferences` collection as private copy-on-write state and its own
 * {@link Emitter} over {@link InferenceManagerEventMap}. Inference order is
 * LOAD-BEARING — backward proving iterates in declaration order and returns on
 * first success. The write-only `collection` setter is the owning builder's
 * silent bulk re-seat channel (used by `merge`). `destroy()` is idempotent and
 * tears the emitter down LAST; any other call after it throws
 * `ReasonError('DESTROYED', …)`.
 */
export class InferenceManager implements InferenceManagerInterface {
	#inferences: readonly Inference[]
	readonly #emitter: Emitter<InferenceManagerEventMap>
	#destroyed = false

	constructor(options?: InferenceManagerOptions) {
		this.#inferences = options?.inferences ?? []
		this.#emitter = new Emitter<InferenceManagerEventMap>({
			on: options?.on,
			error: options?.error,
		})
	}

	get emitter(): EmitterInterface<InferenceManagerEventMap> {
		return this.#emitter
	}

	set collection(value: readonly Inference[]) {
		this.#ensureAlive()
		this.#inferences = value
	}

	inference(id: string): Inference | undefined {
		this.#ensureAlive()
		return this.#inferences.find((inference) => inference.id === id)
	}

	inferences(): readonly Inference[] {
		this.#ensureAlive()
		return this.#inferences
	}

	append(inference: Inference, target?: string): void {
		this.#ensureAlive()
		this.#inferences = appendById(this.#inferences, inference, target)
		this.#emitter.emit('append', inference.id)
	}

	prepend(inference: Inference, target?: string): void {
		this.#ensureAlive()
		this.#inferences = prependById(this.#inferences, inference, target)
		this.#emitter.emit('prepend', inference.id)
	}

	replace(inference: Inference): void {
		this.#ensureAlive()
		this.#inferences = replaceById(this.#inferences, inference)
		this.#emitter.emit('replace', inference.id)
	}

	remove(id: string): void {
		this.#ensureAlive()
		this.#inferences = removeById(this.#inferences, id)
		this.#emitter.emit('remove', id)
	}

	destroy(): void {
		this.#destroyed = true
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	#ensureAlive(): void {
		if (this.#destroyed) {
			throw new ReasonError('DESTROYED', 'InferenceManager has been destroyed')
		}
	}
}
