import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Fact,
	FactManagerEventMap,
	FactManagerInterface,
	FactManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { appendById, prependById, removeById, replaceById } from '../../helpers.js'
import { ReasonError } from '../../errors.js'

/**
 * The {@link FactManagerInterface} implementation — a self-owning, kind-free
 * manager over an inferential definition's `facts`.
 *
 * @remarks
 * OWNS its `#facts` collection as private copy-on-write state and its own
 * {@link Emitter} over {@link FactManagerEventMap}. `Fact.id` is an AUTHORING
 * label — the runtime content-dedups facts by predicate+arity+terms,
 * independently of this manager's id-keyed dedup. The write-only `collection`
 * setter is the owning builder's silent bulk re-seat channel (used by `merge`).
 * `destroy()` is idempotent and tears the emitter down LAST; any other call
 * after it throws `ReasonError('DESTROYED', …)`.
 */
export class FactManager implements FactManagerInterface {
	#facts: readonly Fact[]
	readonly #emitter: Emitter<FactManagerEventMap>
	#destroyed = false

	constructor(options?: FactManagerOptions) {
		this.#facts = options?.facts ?? []
		this.#emitter = new Emitter<FactManagerEventMap>({ on: options?.on, error: options?.error })
	}

	get emitter(): EmitterInterface<FactManagerEventMap> {
		return this.#emitter
	}

	set collection(value: readonly Fact[]) {
		this.#ensureAlive()
		this.#facts = value
	}

	fact(id: string): Fact | undefined {
		this.#ensureAlive()
		return this.#facts.find((fact) => fact.id === id)
	}

	facts(): readonly Fact[] {
		this.#ensureAlive()
		return this.#facts
	}

	append(fact: Fact, target?: string): void {
		this.#ensureAlive()
		this.#facts = appendById(this.#facts, fact, target)
		this.#emitter.emit('append', fact.id)
	}

	prepend(fact: Fact, target?: string): void {
		this.#ensureAlive()
		this.#facts = prependById(this.#facts, fact, target)
		this.#emitter.emit('prepend', fact.id)
	}

	replace(fact: Fact): void {
		this.#ensureAlive()
		this.#facts = replaceById(this.#facts, fact)
		this.#emitter.emit('replace', fact.id)
	}

	remove(id: string): void {
		this.#ensureAlive()
		this.#facts = removeById(this.#facts, id)
		this.#emitter.emit('remove', id)
	}

	destroy(): void {
		this.#destroyed = true
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	#ensureAlive(): void {
		if (this.#destroyed) {
			throw new ReasonError('DESTROYED', 'FactManager has been destroyed')
		}
	}
}
