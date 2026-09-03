import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Factor,
	FactorGroup,
	FactorManagerEventMap,
	FactorManagerInterface,
	FactorManagerOptions,
	GroupManagerInterface,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { isArray } from '@orkestrel/contract'
import { appendFactor, prependFactor, removeFactor, replaceFactor } from '../../helpers.js'
import { ReasonError } from '../../errors.js'

/**
 * Implements the {@link FactorManagerInterface} — the sole DIVERGENT
 * manager: factors nest inside groups, so it holds NO collection state of its
 * own and threads a required `groupId` locator.
 *
 * @remarks
 * Constructor-injected with the sibling {@link GroupManagerInterface}: each
 * write verb reads the located group (`groups.group(groupId)`), applies the
 * factor-level pure helper ({@link appendFactor} etc.), and writes the updated
 * group back through `groups.replace(…)`. A `groupId` naming no existing group
 * throws `ReasonError('TARGET', …, { groupId })`. It still owns its OWN
 * {@link Emitter} over {@link FactorManagerEventMap} (factor-id payloads).
 * `remove` is the batch family behind the leading `groupId` locator (array form
 * declared FIRST): the locator alone removes every factor of that group, a
 * further id removes that factor, a further id list removes those factors and
 * returns true only when every named id existed. It emits one `remove` per
 * factor actually removed, each paired with a `replace` on the sibling
 * `GroupManagerInterface` for the containing group.
 * `destroy()` is idempotent and tears the emitter down LAST; any other call
 * after it throws `ReasonError('DESTROYED', …)`.
 *
 * @example
 * ```ts
 * import {
 * 	createFactorGroup,
 * 	createFactorManager,
 * 	createFieldFactor,
 * 	createGroupManager,
 * 	createStaticFactor,
 * } from '@orkestrel/reason'
 *
 * const groups = createGroupManager({ groups: [createFactorGroup('drivers', 'sum', [])] })
 * const factors = createFactorManager(groups)
 * factors.append('drivers', createFieldFactor('age', 'age'))
 * factors.prepend('drivers', createStaticFactor('floor', 10))
 * factors.replace('drivers', createStaticFactor('floor', 20))
 * factors.factor('drivers', 'age')?.id // 'age'
 * factors.factors('drivers').map((factor) => factor.id) // ['floor', 'age']
 * factors.remove('drivers', 'floor') // true — it was there
 * factors.destroy()
 * ```
 */
export class FactorManager implements FactorManagerInterface {
	readonly #groups: GroupManagerInterface
	readonly #emitter: Emitter<FactorManagerEventMap>
	#destroyed = false

	constructor(groups: GroupManagerInterface, options?: FactorManagerOptions) {
		this.#groups = groups
		this.#emitter = new Emitter<FactorManagerEventMap>(options)
	}

	get emitter(): EmitterInterface<FactorManagerEventMap> {
		return this.#emitter
	}

	factor(groupId: string, id: string): Factor | undefined {
		this.#ensureAlive()
		return this.#locate(groupId).factors.find((factor) => factor.id === id)
	}

	factors(groupId: string): readonly Factor[] {
		this.#ensureAlive()
		return this.#locate(groupId).factors
	}

	append(groupId: string, factor: Factor, target?: string): void {
		this.#ensureAlive()
		this.#groups.replace(appendFactor(this.#locate(groupId), factor, target))
		this.#emitter.emit('append', factor.id)
	}

	prepend(groupId: string, factor: Factor, target?: string): void {
		this.#ensureAlive()
		this.#groups.replace(prependFactor(this.#locate(groupId), factor, target))
		this.#emitter.emit('prepend', factor.id)
	}

	replace(groupId: string, factor: Factor): void {
		this.#ensureAlive()
		this.#groups.replace(replaceFactor(this.#locate(groupId), factor))
		this.#emitter.emit('replace', factor.id)
	}

	// Array overload first so a list resolves to the batch form.
	remove(groupId: string, ids: readonly string[]): boolean
	remove(groupId: string, id: string): boolean
	remove(groupId: string): void
	remove(groupId: string, idOrIds?: readonly string[] | string): boolean | void {
		this.#ensureAlive()
		if (idOrIds === undefined) {
			// The snapshot is taken before the first removal, so the loop walks the
			// group's factors as they stood when the call began.
			for (const factor of this.#locate(groupId).factors) this.#removeOne(groupId, factor.id)
			return
		}
		if (isArray<string>(idOrIds)) {
			let all = true
			for (const id of idOrIds) {
				if (!this.#removeOne(groupId, id)) all = false
			}
			return all
		}
		return this.#removeOne(groupId, idOrIds)
	}

	destroy(): void {
		this.#destroyed = true
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	#ensureAlive(): void {
		if (this.#destroyed) {
			throw new ReasonError('DESTROYED', 'FactorManager has been destroyed')
		}
	}

	// One removal, reported: a factor the group never held is neither written
	// back nor announced, so neither this emitter nor the sibling group emitter
	// reports a change that did not happen.
	#removeOne(groupId: string, id: string): boolean {
		const group = this.#locate(groupId)
		if (!group.factors.some((factor) => factor.id === id)) return false
		this.#groups.replace(removeFactor(group, id))
		this.#emitter.emit('remove', id)
		return true
	}

	// A `groupId` naming no existing group is an unresolved locator — the same
	// `TARGET` code the optional `target` id uses.
	#locate(groupId: string): FactorGroup {
		const group = this.#groups.group(groupId)
		if (group === undefined) {
			throw new ReasonError('TARGET', `Target group id "${groupId}" not found`, { groupId })
		}
		return group
	}
}
