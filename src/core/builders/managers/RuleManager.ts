import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Rule,
	RuleManagerEventMap,
	RuleManagerInterface,
	RuleManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { Collection } from './Collection.js'

/**
 * The {@link RuleManagerInterface} implementation — a self-owning, kind-free
 * manager over a logical definition's `rules`.
 *
 * @remarks
 * OWNS its `rules` as a private {@link Collection} — copy-on-write state shared
 * by composition with the other list managers — plus its own {@link Emitter}
 * over {@link RuleManagerEventMap}. Rule order is LOAD-BEARING — the forward
 * conclusion is the LAST declared non-disabled rule, so `append` without a
 * `target` makes the new rule the conclusion. `seat` is the owning builder's
 * silent bulk re-seat channel (used by `merge`). `destroy()` is idempotent and
 * tears the emitter down LAST; any other call after it throws
 * `ReasonError('DESTROYED', …)`.
 */
export class RuleManager implements RuleManagerInterface {
	readonly #rules: Collection<Rule>
	readonly #emitter: Emitter<RuleManagerEventMap>

	constructor(options?: RuleManagerOptions) {
		this.#rules = new Collection('RuleManager', options?.rules ?? [])
		this.#emitter = new Emitter<RuleManagerEventMap>(options)
	}

	get emitter(): EmitterInterface<RuleManagerEventMap> {
		return this.#emitter
	}

	rule(id: string): Rule | undefined {
		return this.#rules.item(id)
	}

	rules(): readonly Rule[] {
		return this.#rules.items()
	}

	append(rule: Rule, target?: string): void {
		this.#rules.append(rule, target)
		this.#emitter.emit('append', rule.id)
	}

	prepend(rule: Rule, target?: string): void {
		this.#rules.prepend(rule, target)
		this.#emitter.emit('prepend', rule.id)
	}

	replace(rule: Rule): void {
		this.#rules.replace(rule)
		this.#emitter.emit('replace', rule.id)
	}

	remove(id: string): void {
		this.#rules.remove(id)
		this.#emitter.emit('remove', id)
	}

	// The owning builder's bulk re-seat channel — replaces the whole collection
	// in one silent call (no per-element events); used by `merge`.
	seat(items: readonly Rule[]): void {
		this.#rules.seat(items)
	}

	destroy(): void {
		// Idempotent: a second call re-flags an already-destroyed collection and
		// emits into an already-destroyed emitter (a no-op).
		this.#rules.destroy()
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}
}
