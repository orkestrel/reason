import type { EmitterInterface } from '../../../emitters/index.js'
import type {
	VariableManagerEventMap,
	VariableManagerInterface,
	VariableManagerOptions,
} from '../../types.js'
import { Emitter } from '../../../emitters/index.js'
import { ReasonError } from '../../errors.js'

/**
 * The {@link VariableManagerInterface} implementation — a self-owning,
 * kind-free manager over a symbolic definition's `variables`, a name-keyed
 * unordered record.
 *
 * @remarks
 * OWNS its `#variables` record as private copy-on-write state and its own
 * {@link Emitter} over {@link VariableManagerEventMap}. The record has no
 * placement, so only `add` / `remove` exist (no `append` / `prepend`): `add`
 * upserts and emits `add(name)`, `remove` omits the key entirely (never sets
 * `undefined`) and emits `remove(name)`. The write-only `collection` setter is
 * the owning builder's silent bulk re-seat channel (used by `merge`).
 * `destroy()` is idempotent and tears the emitter down LAST; any other call
 * after it throws `ReasonError('DESTROYED', …)`.
 */
export class VariableManager implements VariableManagerInterface {
	#variables: Readonly<Record<string, number>>
	readonly #emitter: Emitter<VariableManagerEventMap>
	#destroyed = false

	constructor(options?: VariableManagerOptions) {
		this.#variables = options?.variables ?? {}
		this.#emitter = new Emitter<VariableManagerEventMap>({
			on: options?.on,
			error: options?.error,
		})
	}

	get emitter(): EmitterInterface<VariableManagerEventMap> {
		return this.#emitter
	}

	set collection(value: Readonly<Record<string, number>>) {
		this.#ensureAlive()
		this.#variables = value
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

	remove(name: string): void {
		this.#ensureAlive()
		// Destructure-rest OMITS the key entirely, keeping the record exact.
		const { [name]: _drop, ...rest } = this.#variables
		this.#variables = rest
		this.#emitter.emit('remove', name)
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
}
