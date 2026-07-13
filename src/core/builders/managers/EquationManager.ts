import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Equation,
	EquationManagerEventMap,
	EquationManagerInterface,
	EquationManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { appendById, prependById, removeById, replaceById } from '../../helpers.js'
import { ReasonError } from '../../errors.js'

/**
 * The {@link EquationManagerInterface} implementation — a self-owning,
 * kind-free manager over a symbolic definition's `equations`.
 *
 * @remarks
 * OWNS its `#equations` collection as private copy-on-write state and its own
 * {@link Emitter} over {@link EquationManagerEventMap}. Equation order is
 * STRONGLY load-bearing — equations solve strictly in order and each rounded
 * solution feeds forward. The write-only `collection` setter is the owning
 * builder's silent bulk re-seat channel (used by `merge`). `destroy()` is
 * idempotent and tears the emitter down LAST; any other call after it throws
 * `ReasonError('DESTROYED', …)`.
 */
export class EquationManager implements EquationManagerInterface {
	#equations: readonly Equation[]
	readonly #emitter: Emitter<EquationManagerEventMap>
	#destroyed = false

	constructor(options?: EquationManagerOptions) {
		this.#equations = options?.equations ?? []
		this.#emitter = new Emitter<EquationManagerEventMap>({
			on: options?.on,
			error: options?.error,
		})
	}

	get emitter(): EmitterInterface<EquationManagerEventMap> {
		return this.#emitter
	}

	set collection(value: readonly Equation[]) {
		this.#ensureAlive()
		this.#equations = value
	}

	equation(id: string): Equation | undefined {
		this.#ensureAlive()
		return this.#equations.find((equation) => equation.id === id)
	}

	equations(): readonly Equation[] {
		this.#ensureAlive()
		return this.#equations
	}

	append(equation: Equation, target?: string): void {
		this.#ensureAlive()
		this.#equations = appendById(this.#equations, equation, target)
		this.#emitter.emit('append', equation.id)
	}

	prepend(equation: Equation, target?: string): void {
		this.#ensureAlive()
		this.#equations = prependById(this.#equations, equation, target)
		this.#emitter.emit('prepend', equation.id)
	}

	replace(equation: Equation): void {
		this.#ensureAlive()
		this.#equations = replaceById(this.#equations, equation)
		this.#emitter.emit('replace', equation.id)
	}

	remove(id: string): void {
		this.#ensureAlive()
		this.#equations = removeById(this.#equations, id)
		this.#emitter.emit('remove', id)
	}

	destroy(): void {
		this.#destroyed = true
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	#ensureAlive(): void {
		if (this.#destroyed) {
			throw new ReasonError('DESTROYED', 'EquationManager has been destroyed')
		}
	}
}
