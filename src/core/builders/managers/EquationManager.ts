import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Equation,
	EquationManagerEventMap,
	EquationManagerInterface,
	EquationManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { Collection } from './Collection.js'

/**
 * The {@link EquationManagerInterface} implementation — a self-owning,
 * kind-free manager over a symbolic definition's `equations`.
 *
 * @remarks
 * OWNS its `equations` as a private {@link Collection} — copy-on-write state
 * shared by composition with the other list managers — plus its own
 * {@link Emitter} over {@link EquationManagerEventMap}. Equation order is
 * STRONGLY load-bearing — equations solve strictly in order and each rounded
 * solution feeds forward. The write-only `collection` setter is the owning
 * builder's silent bulk re-seat channel (used by `merge`). `destroy()` is
 * idempotent and tears the emitter down LAST; any other call after it throws
 * `ReasonError('DESTROYED', …)`.
 */
export class EquationManager implements EquationManagerInterface {
	readonly #equations: Collection<Equation>
	readonly #emitter: Emitter<EquationManagerEventMap>

	constructor(options?: EquationManagerOptions) {
		this.#equations = new Collection('EquationManager', options?.equations ?? [])
		this.#emitter = new Emitter<EquationManagerEventMap>(options)
	}

	get emitter(): EmitterInterface<EquationManagerEventMap> {
		return this.#emitter
	}

	set collection(value: readonly Equation[]) {
		this.#equations.seat(value)
	}

	equation(id: string): Equation | undefined {
		return this.#equations.item(id)
	}

	equations(): readonly Equation[] {
		return this.#equations.items()
	}

	append(equation: Equation, target?: string): void {
		this.#equations.append(equation, target)
		this.#emitter.emit('append', equation.id)
	}

	prepend(equation: Equation, target?: string): void {
		this.#equations.prepend(equation, target)
		this.#emitter.emit('prepend', equation.id)
	}

	replace(equation: Equation): void {
		this.#equations.replace(equation)
		this.#emitter.emit('replace', equation.id)
	}

	remove(id: string): void {
		this.#equations.remove(id)
		this.#emitter.emit('remove', id)
	}

	destroy(): void {
		// Idempotent: a second call re-flags an already-destroyed collection and
		// emits into an already-destroyed emitter (a no-op).
		this.#equations.destroy()
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}
}
