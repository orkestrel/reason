import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	FactorGroup,
	GroupManagerEventMap,
	GroupManagerInterface,
	GroupManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { appendById, prependById, removeById, replaceById } from '../../helpers.js'
import { ReasonError } from '../../errors.js'

/**
 * The {@link GroupManagerInterface} implementation — a self-owning, kind-free
 * manager over a quantitative definition's `groups`.
 *
 * @remarks
 * OWNS its `#groups` collection as private copy-on-write state and its own
 * {@link Emitter} over {@link GroupManagerEventMap}. Every write verb delegates
 * to the matching collection-level pure helper ({@link appendById} etc.),
 * reassigns the fresh array, then emits (the affected group id) AFTER the
 * mutation. The write-only `collection` setter is the owning builder's silent
 * bulk re-seat channel (used by `merge`). `destroy()` is idempotent and tears
 * the emitter down LAST; any other call after it throws
 * `ReasonError('DESTROYED', …)`.
 */
export class GroupManager implements GroupManagerInterface {
	#groups: readonly FactorGroup[]
	readonly #emitter: Emitter<GroupManagerEventMap>
	#destroyed = false

	constructor(options?: GroupManagerOptions) {
		this.#groups = options?.groups ?? []
		this.#emitter = new Emitter<GroupManagerEventMap>({ on: options?.on, error: options?.error })
	}

	get emitter(): EmitterInterface<GroupManagerEventMap> {
		return this.#emitter
	}

	// The owning builder's bulk re-seat channel — replaces the whole collection
	// in one silent assignment (no per-element events); used by `merge`.
	set collection(value: readonly FactorGroup[]) {
		this.#ensureAlive()
		this.#groups = value
	}

	group(id: string): FactorGroup | undefined {
		this.#ensureAlive()
		return this.#groups.find((group) => group.id === id)
	}

	groups(): readonly FactorGroup[] {
		this.#ensureAlive()
		return this.#groups
	}

	append(group: FactorGroup, target?: string): void {
		this.#ensureAlive()
		this.#groups = appendById(this.#groups, group, target)
		this.#emitter.emit('append', group.id)
	}

	prepend(group: FactorGroup, target?: string): void {
		this.#ensureAlive()
		this.#groups = prependById(this.#groups, group, target)
		this.#emitter.emit('prepend', group.id)
	}

	replace(group: FactorGroup): void {
		this.#ensureAlive()
		this.#groups = replaceById(this.#groups, group)
		this.#emitter.emit('replace', group.id)
	}

	remove(id: string): void {
		this.#ensureAlive()
		this.#groups = removeById(this.#groups, id)
		this.#emitter.emit('remove', id)
	}

	destroy(): void {
		// Idempotent: a second call re-flags an already-destroyed manager and
		// emits into an already-destroyed emitter (a no-op).
		this.#destroyed = true
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	#ensureAlive(): void {
		if (this.#destroyed) {
			throw new ReasonError('DESTROYED', 'GroupManager has been destroyed')
		}
	}
}
