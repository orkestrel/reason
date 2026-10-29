import type { Fact } from './types.js'
import { factToArityKey, instantiateFact, matchFacts } from './helpers.js'

/**
 * Joins premise bindings against a predicate-and-arity fact index.
 */
export class InferenceJoin {
	readonly #index: ReadonlyMap<string, readonly Fact[]>
	#bindings: ReadonlyArray<Record<string, unknown>> = [{}]

	constructor(index: ReadonlyMap<string, readonly Fact[]>) {
		this.#index = index
	}

	resolve(premises: readonly Fact[]): ReadonlyArray<Record<string, unknown>> {
		this.#bindings = [{}]
		if (premises.length === 0) return this.#bindings
		for (const premise of premises) {
			const candidates = this.#index.get(factToArityKey(premise)) ?? []
			this.#bindings = this.#bindings.flatMap((existing) => {
				const instantiated = instantiateFact(premise, existing)
				return Iterator.from(candidates)
					.flatMap((fact) => {
						const match = matchFacts(instantiated, fact)
						return match ? [{ ...existing, ...match }] : []
					})
					.toArray()
			})
			if (this.#bindings.length === 0) break
		}
		return this.#bindings
	}
}
