import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Fact,
	FactManagerEventMap,
	FactManagerInterface,
	FactManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { Collection } from './Collection.js'

/**
 * Implements the {@link FactManagerInterface} — a self-owning, kind-free
 * manager over an inferential definition's `facts`.
 *
 * @remarks
 * OWNS its `facts` as a private {@link Collection} — copy-on-write state shared
 * by composition with the other list managers — plus its own {@link Emitter}
 * over {@link FactManagerEventMap}. `Fact.id` is an AUTHORING label — the
 * runtime content-dedups facts by predicate+arity+terms, independently of this
 * manager's id-keyed dedup. `seat` is the owning builder's silent bulk re-seat
 * channel (used by `merge`). `destroy()` is idempotent and tears the emitter
 * down LAST; any other call after it throws `ReasonError('DESTROYED', …)`.
 */
export class FactManager implements FactManagerInterface {
	readonly #facts: Collection<Fact>
	readonly #emitter: Emitter<FactManagerEventMap>

	constructor(options?: FactManagerOptions) {
		this.#facts = new Collection('FactManager', options?.facts ?? [])
		this.#emitter = new Emitter<FactManagerEventMap>(options)
	}

	get emitter(): EmitterInterface<FactManagerEventMap> {
		return this.#emitter
	}

	fact(id: string): Fact | undefined {
		return this.#facts.item(id)
	}

	facts(): readonly Fact[] {
		return this.#facts.items()
	}

	append(fact: Fact, target?: string): void {
		this.#facts.append(fact, target)
		this.#emitter.emit('append', fact.id)
	}

	prepend(fact: Fact, target?: string): void {
		this.#facts.prepend(fact, target)
		this.#emitter.emit('prepend', fact.id)
	}

	replace(fact: Fact): void {
		this.#facts.replace(fact)
		this.#emitter.emit('replace', fact.id)
	}

	remove(id: string): void {
		this.#facts.remove(id)
		this.#emitter.emit('remove', id)
	}

	// The owning builder's bulk re-seat channel — replaces the whole collection
	// in one silent call (no per-element events); used by `merge`.
	seat(items: readonly Fact[]): void {
		this.#facts.seat(items)
	}

	destroy(): void {
		// Idempotent: a second call re-flags an already-destroyed collection and
		// emits into an already-destroyed emitter (a no-op).
		this.#facts.destroy()
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}
}
