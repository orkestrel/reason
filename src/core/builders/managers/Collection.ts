import { appendById, prependById, removeById, replaceById } from '../../helpers.js'
import { ReasonError } from '../../errors.js'

/**
 * Holds the id-keyed collection state five of the `DefinitionBuilder`'s managers
 * share — the array, the four placement verbs, the silent re-seat, and the
 * destroyed flag.
 *
 * @remarks
 * Held by composition, never inherited: each manager keeps one in a `#` field
 * and exposes only the members its own interface declares, so this class adds
 * nothing to a published surface. It owns the collection as copy-on-write
 * state — every write verb delegates to the matching collection-level pure
 * helper ({@link appendById} and its siblings) and reassigns the fresh array,
 * emitting nothing (the owning manager emits, after the mutation). `seat`
 * replaces the whole collection in one silent assignment, which is the owning
 * builder's bulk re-seat channel. `destroy()` is idempotent; every other call
 * after it throws `ReasonError('DESTROYED', …)` naming the owner.
 *
 * @typeParam T - An id-carrying element type
 */
export class Collection<T extends { readonly id: string }> {
	readonly #owner: string
	#items: readonly T[]
	#destroyed = false

	constructor(owner: string, items: readonly T[]) {
		this.#owner = owner
		this.#items = items
	}

	item(id: string): T | undefined {
		this.#ensureAlive()
		return this.#items.find((candidate) => candidate.id === id)
	}

	items(): readonly T[] {
		this.#ensureAlive()
		return this.#items
	}

	seat(items: readonly T[]): void {
		this.#ensureAlive()
		this.#items = items
	}

	append(item: T, target?: string): void {
		this.#ensureAlive()
		this.#items = appendById(this.#items, item, target)
	}

	prepend(item: T, target?: string): void {
		this.#ensureAlive()
		this.#items = prependById(this.#items, item, target)
	}

	replace(item: T): void {
		this.#ensureAlive()
		this.#items = replaceById(this.#items, item)
	}

	remove(id: string): void {
		this.#ensureAlive()
		this.#items = removeById(this.#items, id)
	}

	destroy(): void {
		// Idempotent: a second call re-flags an already-destroyed collection.
		this.#destroyed = true
	}

	#ensureAlive(): void {
		if (this.#destroyed) {
			throw new ReasonError('DESTROYED', `${this.#owner} has been destroyed`)
		}
	}
}
