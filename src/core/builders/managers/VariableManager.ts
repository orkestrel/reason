import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	VariableManagerEventMap,
	VariableManagerInterface,
	VariableManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { isArray } from '@orkestrel/contract'
import { ReasonError } from '../../errors.js'

/**
 * Implements the {@link VariableManagerInterface} — a self-owning,
 * kind-free manager over a symbolic definition's `variables`, a name-keyed
 * unordered record.
 *
 * @remarks
 * OWNS its `#variables` record as private copy-on-write state and its own
 * {@link Emitter} over {@link VariableManagerEventMap}. The record has no
 * placement, so only `add` / `remove` exist (no `append` / `prepend`): `add`
 * upserts and emits `add(name)`, `remove` omits the key entirely (never sets
 * `undefined`) and emits `remove(name)`. `remove` is the batch family over
 * NAMES (array form declared FIRST): no argument removes every variable, one
 * name removes that variable, a name list removes those variables and returns
 * true only when every named variable existed. It emits one `remove` per
 * variable actually removed. `seat` is the owning builder's silent
 * bulk re-seat channel (used by `merge`). `destroy()` is idempotent and tears
 * the emitter down LAST; any other call after it throws
 * `ReasonError('DESTROYED', …)`.
 *
 * @example
 * ```ts
 * import { createVariableManager } from '@orkestrel/reason'
 *
 * const variables = createVariableManager()
 * variables.add('x', 42)
 * variables.add('y', 7)
 * variables.variable('x') // 42
 * variables.variables() // { x: 42, y: 7 }
 * variables.remove('y') // true — it was there
 * variables.seat({ z: 1 }) // silent bulk re-seat
 * variables.destroy()
 * ```
 */
export class VariableManager implements VariableManagerInterface {
	#variables: Readonly<Record<string, number>>
	readonly #emitter: Emitter<VariableManagerEventMap>
	#destroyed = false

	constructor(options?: VariableManagerOptions) {
		this.#variables = options?.variables ?? {}
		this.#emitter = new Emitter<VariableManagerEventMap>(options)
	}

	get emitter(): EmitterInterface<VariableManagerEventMap> {
		return this.#emitter
	}

	variable(name: string): number | undefined {
		this.#ensureAlive()
		return this.#variables[name]
	}

	variables(): Readonly<Record<string, number>> {
		this.#ensureAlive()
		return this.#variables
	}

	add(name: string, value: number): void {
		this.#ensureAlive()
		this.#variables = { ...this.#variables, [name]: value }
		this.#emitter.emit('add', name)
	}

	// Array overload first so a list resolves to the batch form.
	remove(names: readonly string[]): boolean
	remove(name: string): boolean
	remove(): void
	remove(nameOrNames?: readonly string[] | string): boolean | void {
		this.#ensureAlive()
		if (nameOrNames === undefined) {
			// The snapshot is taken before the first removal, so the loop walks the
			// record as it stood when the call began.
			for (const name of Object.keys(this.#variables)) this.#removeOne(name)
			return
		}
		if (isArray<string>(nameOrNames)) {
			let all = true
			for (const name of nameOrNames) {
				if (!this.#removeOne(name)) all = false
			}
			return all
		}
		return this.#removeOne(nameOrNames)
	}

	// The owning builder's bulk re-seat channel — replaces the whole record in
	// one silent call (no per-entry events); used by `merge`.
	seat(variables: Readonly<Record<string, number>>): void {
		this.#ensureAlive()
		this.#variables = variables
	}

	destroy(): void {
		this.#destroyed = true
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	#ensureAlive(): void {
		if (this.#destroyed) {
			throw new ReasonError('DESTROYED', 'VariableManager has been destroyed')
		}
	}

	// One removal, reported: a name the record never carried is neither removed
	// nor announced, so each batch form emits exactly what it changed.
	#removeOne(name: string): boolean {
		if (!Object.hasOwn(this.#variables, name)) return false
		// Destructure-rest OMITS the key entirely, keeping the record exact.
		const { [name]: _drop, ...rest } = this.#variables
		this.#variables = rest
		this.#emitter.emit('remove', name)
		return true
	}
}
