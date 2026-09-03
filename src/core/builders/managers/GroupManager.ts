import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	FactorGroup,
	GroupManagerEventMap,
	GroupManagerInterface,
	GroupManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { isArray } from '@orkestrel/contract'
import { Collection } from './Collection.js'

/**
 * Implements the {@link GroupManagerInterface} — a self-owning, kind-free
 * manager over a quantitative definition's `groups`.
 *
 * @remarks
 * OWNS its `groups` as a private {@link Collection} — copy-on-write state
 * shared by composition with the other list managers — plus its own
 * {@link Emitter} over {@link GroupManagerEventMap}. Every write verb delegates
 * to the collection, then emits (the affected group id) AFTER the mutation.
 * `remove` is the batch family (array form declared FIRST): no argument removes
 * every group, one id removes that group, an id list removes those groups and
 * returns true only when every named id existed. It emits one `remove` per
 * group actually removed.
 * `seat` is the owning builder's silent bulk re-seat channel (used by `merge`).
 * `destroy()` is idempotent and tears the emitter down LAST; any other call
 * after it throws `ReasonError('DESTROYED', …)`.
 *
 * @example
 * ```ts
 * import { createFactorGroup, createGroupManager, createStaticFactor } from '@orkestrel/reason'
 *
 * const groups = createGroupManager()
 * groups.append(createFactorGroup('drivers', 'sum', [createStaticFactor('floor', 10)]))
 * groups.prepend(createFactorGroup('base', 'sum', []))
 * groups.replace(createFactorGroup('base', 'product', []))
 * groups.group('drivers')?.aggregation // 'sum'
 * groups.groups().map((group) => group.id) // ['base', 'drivers']
 * groups.remove('base') // true — it was there
 * groups.seat([createFactorGroup('only', 'sum', [])]) // silent bulk re-seat
 * groups.destroy()
 * ```
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

	// Array overload first so a list resolves to the batch form.
	remove(ids: readonly string[]): boolean
	remove(id: string): boolean
	remove(): void
	remove(idOrIds?: readonly string[] | string): boolean | void {
		if (idOrIds === undefined) {
			// The snapshot is taken before the first removal, so the loop walks the
			// collection as it stood when the call began.
			for (const group of this.#groups.items()) this.#removeOne(group.id)
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
	seat(groups: readonly FactorGroup[]): void {
		this.#groups.seat(groups)
	}

	destroy(): void {
		// Idempotent: a second call re-flags an already-destroyed collection and
		// emits into an already-destroyed emitter (a no-op).
		this.#groups.destroy()
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	// One removal, reported: a group that was never there is neither removed nor
	// announced, so each batch form emits exactly what it changed.
	#removeOne(id: string): boolean {
		if (!this.#groups.remove(id)) return false
		this.#emitter.emit('remove', id)
		return true
	}
}
