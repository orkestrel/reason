import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Equation,
	EquationManagerEventMap,
	EquationManagerInterface,
	EquationManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { isArray } from '@orkestrel/contract'
import { Collection } from './Collection.js'

/**
 * Implements the {@link EquationManagerInterface} — a self-owning,
 * kind-free manager over a symbolic definition's `equations`.
 *
 * @remarks
 * OWNS its `equations` as a private {@link Collection} — copy-on-write state
 * shared by composition with the other list managers — plus its own
 * {@link Emitter} over {@link EquationManagerEventMap}. Equation order is
 * STRONGLY load-bearing — equations solve strictly in order and each rounded
 * solution feeds forward. `remove` is the batch family (array form declared
 * FIRST): no argument removes every equation, one id removes that equation, an
 * id list removes those equations and returns true only when every named id
 * existed. It emits one `remove` per equation actually removed.
 * `seat` is the owning builder's silent bulk re-seat
 * channel (used by `merge`). `destroy()` is idempotent and tears the emitter
 * down LAST; any other call after it throws `ReasonError('DESTROYED', …)`.
 *
 * @example
 * ```ts
 * import {
 * 	createConstant,
 * 	createEquation,
 * 	createEquationManager,
 * 	createVariable,
 * } from '@orkestrel/reason'
 *
 * const equations = createEquationManager()
 * equations.append(createEquation('e1', createVariable('x'), createConstant(42), 'x'))
 * equations.prepend(createEquation('e0', createVariable('y'), createConstant(1), 'y'))
 * equations.replace(createEquation('e0', createVariable('y'), createConstant(2), 'y'))
 * equations.equation('e1')?.target // 'x'
 * equations.equations().map((equation) => equation.id) // ['e0', 'e1']
 * equations.remove('e0') // true — it was there
 * equations.seat([]) // silent bulk re-seat
 * equations.destroy()
 * ```
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

	// Array overload first so a list resolves to the batch form.
	remove(ids: readonly string[]): boolean
	remove(id: string): boolean
	remove(): void
	remove(idOrIds?: readonly string[] | string): boolean | void {
		if (idOrIds === undefined) {
			// The snapshot is taken before the first removal, so the loop walks the
			// collection as it stood when the call began.
			for (const equation of this.#equations.items()) this.#removeOne(equation.id)
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
	seat(equations: readonly Equation[]): void {
		this.#equations.seat(equations)
	}

	destroy(): void {
		// Idempotent: a second call re-flags an already-destroyed collection and
		// emits into an already-destroyed emitter (a no-op).
		this.#equations.destroy()
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	// One removal, reported: an equation that was never there is neither removed
	// nor announced, so each batch form emits exactly what it changed.
	#removeOne(id: string): boolean {
		if (!this.#equations.remove(id)) return false
		this.#emitter.emit('remove', id)
		return true
	}
}
