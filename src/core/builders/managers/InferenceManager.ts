import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Inference,
	InferenceManagerEventMap,
	InferenceManagerInterface,
	InferenceManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { Collection } from './Collection.js'

/**
 * The {@link InferenceManagerInterface} implementation — a self-owning,
 * kind-free manager over an inferential definition's `inferences`.
 *
 * @remarks
 * OWNS its `inferences` as a private {@link Collection} — copy-on-write state
 * shared by composition with the other list managers — plus its own
 * {@link Emitter} over {@link InferenceManagerEventMap}. Inference order is
 * LOAD-BEARING — backward proving iterates in declaration order and returns on
 * first success. `seat` is the owning builder's silent bulk re-seat channel
 * (used by `merge`). `destroy()` is idempotent and tears the emitter down LAST;
 * any other call after it throws `ReasonError('DESTROYED', …)`.
 */
export class InferenceManager implements InferenceManagerInterface {
	readonly #inferences: Collection<Inference>
	readonly #emitter: Emitter<InferenceManagerEventMap>

	constructor(options?: InferenceManagerOptions) {
		this.#inferences = new Collection('InferenceManager', options?.inferences ?? [])
		this.#emitter = new Emitter<InferenceManagerEventMap>(options)
	}

	get emitter(): EmitterInterface<InferenceManagerEventMap> {
		return this.#emitter
	}

	inference(id: string): Inference | undefined {
		return this.#inferences.item(id)
	}

	inferences(): readonly Inference[] {
		return this.#inferences.items()
	}

	append(inference: Inference, target?: string): void {
		this.#inferences.append(inference, target)
		this.#emitter.emit('append', inference.id)
	}

	prepend(inference: Inference, target?: string): void {
		this.#inferences.prepend(inference, target)
		this.#emitter.emit('prepend', inference.id)
	}

	replace(inference: Inference): void {
		this.#inferences.replace(inference)
		this.#emitter.emit('replace', inference.id)
	}

	remove(id: string): void {
		this.#inferences.remove(id)
		this.#emitter.emit('remove', id)
	}

	// The owning builder's bulk re-seat channel — replaces the whole collection
	// in one silent call (no per-element events); used by `merge`.
	seat(items: readonly Inference[]): void {
		this.#inferences.seat(items)
	}

	destroy(): void {
		// Idempotent: a second call re-flags an already-destroyed collection and
		// emits into an already-destroyed emitter (a no-op).
		this.#inferences.destroy()
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}
}
