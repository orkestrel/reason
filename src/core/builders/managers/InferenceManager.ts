import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Inference,
	InferenceManagerEventMap,
	InferenceManagerInterface,
	InferenceManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { isArray } from '@orkestrel/contract'
import { Collection } from './Collection.js'

/**
 * Implements the {@link InferenceManagerInterface} — a self-owning,
 * kind-free manager over an inferential definition's `inferences`.
 *
 * @remarks
 * OWNS its `inferences` as a private {@link Collection} — copy-on-write state
 * shared by composition with the other list managers — plus its own
 * {@link Emitter} over {@link InferenceManagerEventMap}. Inference order is
 * LOAD-BEARING — backward proving iterates in declaration order and returns on
 * first success. `remove` is the batch family (array form declared FIRST): no
 * argument removes every inference, one id removes that inference, an id list
 * removes those inferences and returns true only when every named id existed.
 * It emits one `remove` per inference actually removed.
 * `seat` is the owning builder's silent bulk re-seat channel
 * (used by `merge`). `destroy()` is idempotent and tears the emitter down LAST;
 * any other call after it throws `ReasonError('DESTROYED', …)`.
 *
 * @example
 * ```ts
 * import { createFact, createInference, createInferenceManager } from '@orkestrel/reason'
 *
 * const inferences = createInferenceManager()
 * inferences.append(
 * 	createInference(
 * 		'mortal',
 * 		[createFact('p1', 'human', ['?x'])],
 * 		createFact('c1', 'mortal', ['?x']),
 * 	),
 * )
 * inferences.prepend(
 * 	createInference('wise', [createFact('p2', 'human', ['?x'])], createFact('c2', 'wise', ['?x'])),
 * )
 * inferences.replace(
 * 	createInference('wise', [createFact('p2', 'human', ['?x'])], createFact('c2', 'sage', ['?x'])),
 * )
 * inferences.inference('mortal')?.name // 'mortal'
 * inferences.inferences().map((inference) => inference.id) // ['wise', 'mortal']
 * inferences.remove('wise') // true — it was there
 * inferences.seat([]) // silent bulk re-seat
 * inferences.destroy()
 * ```
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

	// Array overload first so a list resolves to the batch form.
	remove(ids: readonly string[]): boolean
	remove(id: string): boolean
	remove(): void
	remove(idOrIds?: readonly string[] | string): boolean | void {
		if (idOrIds === undefined) {
			// The snapshot is taken before the first removal, so the loop walks the
			// collection as it stood when the call began.
			for (const inference of this.#inferences.items()) this.#removeOne(inference.id)
			return
		}
		if (isArray<string>(idOrIds)) {
			let all = true
			for (const id of idOrIds) {
				if (!this.#removeOne(id)) all = false
			}
			return all
		}
		return this.#removeOne(idOrIds)
	}

	// The owning builder's bulk re-seat channel — replaces the whole collection
	// in one silent call (no per-element events); used by `merge`.
	seat(inferences: readonly Inference[]): void {
		this.#inferences.seat(inferences)
	}

	destroy(): void {
		// Idempotent: a second call re-flags an already-destroyed collection and
		// emits into an already-destroyed emitter (a no-op).
		this.#inferences.destroy()
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	// One removal, reported: an inference that was never there is neither removed
	// nor announced, so each batch form emits exactly what it changed.
	#removeOne(id: string): boolean {
		if (!this.#inferences.remove(id)) return false
		this.#emitter.emit('remove', id)
		return true
	}
}
