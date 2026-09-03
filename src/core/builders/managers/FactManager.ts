import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Fact,
	FactManagerEventMap,
	FactManagerInterface,
	FactManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { isArray } from '@orkestrel/contract'
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
 * manager's id-keyed dedup. `remove` is the batch family (array form declared
 * FIRST): no argument removes every fact, one id removes that fact, an id list
 * removes those facts and returns true only when every named id existed. It
 * emits one `remove` per fact actually removed.
 * `seat` is the owning builder's silent bulk re-seat
 * channel (used by `merge`). `destroy()` is idempotent and tears the emitter
 * down LAST; any other call after it throws `ReasonError('DESTROYED', …)`.
 *
 * @example
 * ```ts
 * import { createFact, createFactManager } from '@orkestrel/reason'
 *
 * const facts = createFactManager()
 * facts.append(createFact('f1', 'human', ['socrates']))
 * facts.prepend(createFact('f0', 'human', ['plato']))
 * facts.replace(createFact('f0', 'human', ['plato'], 0.9))
 * facts.fact('f1')?.predicate // 'human'
 * facts.facts().map((fact) => fact.id) // ['f0', 'f1']
 * facts.remove('f0') // true — it was there
 * facts.seat([]) // silent bulk re-seat
 * facts.destroy()
 * ```
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

	// Array overload first so a list resolves to the batch form.
	remove(ids: readonly string[]): boolean
	remove(id: string): boolean
	remove(): void
	remove(idOrIds?: readonly string[] | string): boolean | void {
		if (idOrIds === undefined) {
			// The snapshot is taken before the first removal, so the loop walks the
			// collection as it stood when the call began.
			for (const fact of this.#facts.items()) this.#removeOne(fact.id)
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
	seat(facts: readonly Fact[]): void {
		this.#facts.seat(facts)
	}

	destroy(): void {
		// Idempotent: a second call re-flags an already-destroyed collection and
		// emits into an already-destroyed emitter (a no-op).
		this.#facts.destroy()
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	// One removal, reported: a fact that was never there is neither removed nor
	// announced, so each batch form emits exactly what it changed.
	#removeOne(id: string): boolean {
		if (!this.#facts.remove(id)) return false
		this.#emitter.emit('remove', id)
		return true
	}
}
