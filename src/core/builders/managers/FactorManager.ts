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
import { appendFactor, prependFactor, removeFactor, replaceFactor } from '../../helpers.js'
import { ReasonError } from '../../errors.js'

/**
 * The {@link FactorManagerInterface} implementation — the sole DIVERGENT
 * manager: factors nest inside groups, so it holds NO collection state of its
 * own and threads a required `groupId` locator.
 *
 * @remarks
 * Constructor-injected with the sibling {@link GroupManagerInterface}: each
 * write verb reads the located group (`groups.group(groupId)`), applies the
 * factor-level pure helper ({@link appendFactor} etc.), and writes the updated
 * group back via `groups.replace(…)`. A `groupId` naming no existing group
 * throws `ReasonError('TARGET', …, { groupId })`. It still owns its OWN
 * {@link Emitter} over {@link FactorManagerEventMap} (factor-id payloads).
 * `destroy()` is idempotent and tears the emitter down LAST; any other call
 * after it throws `ReasonError('DESTROYED', …)`.
 */
export class FactorManager implements FactorManagerInterface {
	readonly #groups: GroupManagerInterface
	readonly #emitter: Emitter<FactorManagerEventMap>
	#destroyed = false

	constructor(groups: GroupManagerInterface, options?: FactorManagerOptions) {
		this.#groups = groups
		this.#emitter = new Emitter<FactorManagerEventMap>({ on: options?.on, error: options?.error })
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

	remove(groupId: string, id: string): void {
		this.#ensureAlive()
		this.#groups.replace(removeFactor(this.#locate(groupId), id))
		this.#emitter.emit('remove', id)
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
