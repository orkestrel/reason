import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	FactorGroup,
	GroupManagerEventMap,
	GroupManagerInterface,
	GroupManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { Collection } from './Collection.js'

/**
 * The {@link GroupManagerInterface} implementation — a self-owning, kind-free
 * manager over a quantitative definition's `groups`.
 *
 * @remarks
 * OWNS its `groups` as a private {@link Collection} — copy-on-write state
 * shared by composition with the other list managers — plus its own
 * {@link Emitter} over {@link GroupManagerEventMap}. Every write verb delegates
 * to the collection, then emits (the affected group id) AFTER the mutation. The
 * write-only `collection` setter is the owning builder's silent bulk re-seat
 * channel (used by `merge`). `destroy()` is idempotent and tears the emitter
 * down LAST; any other call after it throws `ReasonError('DESTROYED', …)`.
 */
export class GroupManager implements GroupManagerInterface {
	readonly #groups: Collection<FactorGroup>
	readonly #emitter: Emitter<GroupManagerEventMap>

	constructor(options?: GroupManagerOptions) {
		this.#groups = new Collection('GroupManager', options?.groups ?? [])
		this.#emitter = new Emitter<GroupManagerEventMap>(options)
	}

	get emitter(): EmitterInterface<GroupManagerEventMap> {
		return this.#emitter
	}

	// The owning builder's bulk re-seat channel — replaces the whole collection
	// in one silent assignment (no per-element events); used by `merge`.
	set collection(value: readonly FactorGroup[]) {
		this.#groups.seat(value)
	}

	group(id: string): FactorGroup | undefined {
		return this.#groups.item(id)
	}

	groups(): readonly FactorGroup[] {
		return this.#groups.items()
	}

	append(group: FactorGroup, target?: string): void {
		this.#groups.append(group, target)
		this.#emitter.emit('append', group.id)
	}

	prepend(group: FactorGroup, target?: string): void {
		this.#groups.prepend(group, target)
		this.#emitter.emit('prepend', group.id)
	}

	replace(group: FactorGroup): void {
		this.#groups.replace(group)
		this.#emitter.emit('replace', group.id)
	}

	remove(id: string): void {
		this.#groups.remove(id)
		this.#emitter.emit('remove', id)
	}

	destroy(): void {
		// Idempotent: a second call re-flags an already-destroyed collection and
		// emits into an already-destroyed emitter (a no-op).
		this.#groups.destroy()
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}
}
