import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	Rule,
	RuleManagerEventMap,
	RuleManagerInterface,
	RuleManagerOptions,
} from '../../types.js'
import { Emitter } from '@orkestrel/emitter'
import { isArray } from '@orkestrel/contract'
import { Collection } from './Collection.js'

/**
 * Implements the {@link RuleManagerInterface} — a self-owning, kind-free
 * manager over a logical definition's `rules`.
 *
 * @remarks
 * OWNS its `rules` as a private {@link Collection} — copy-on-write state shared
 * by composition with the other list managers — plus its own {@link Emitter}
 * over {@link RuleManagerEventMap}. Rule order is LOAD-BEARING — the forward
 * conclusion is the LAST declared non-disabled rule, so `append` without a
 * `target` makes the new rule the conclusion. `remove` is the batch family
 * (array form declared FIRST): no argument removes every rule, one id removes
 * that rule, an id list removes those rules and returns true only when every
 * named id existed. It emits one `remove` per rule actually removed. `seat` is
 * the owning builder's
 * silent bulk re-seat channel (used by `merge`). `destroy()` is idempotent and
 * tears the emitter down LAST; any other call after it throws
 * `ReasonError('DESTROYED', …)`.
 *
 * @example
 * ```ts
 * import { createAtom, createRule, createRuleManager } from '@orkestrel/reason'
 *
 * const rules = createRuleManager()
 * rules.append(
 * 	createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
 * )
 * rules.prepend(createRule('seed', [], createAtom('seed', 'equals', true)))
 * rules.replace(createRule('seed', [], createAtom('seed', 'equals', false)))
 * rules.rule('adult')?.name // 'adult'
 * rules.rules().map((rule) => rule.id) // ['seed', 'adult']
 * rules.remove('seed') // true — it was there
 * rules.seat([]) // silent bulk re-seat
 * rules.destroy()
 * ```
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

	// Array overload first so a list resolves to the batch form.
	remove(ids: readonly string[]): boolean
	remove(id: string): boolean
	remove(): void
	remove(idOrIds?: readonly string[] | string): boolean | void {
		if (idOrIds === undefined) {
			// The snapshot is taken before the first removal, so the loop walks the
			// collection as it stood when the call began.
			for (const rule of this.#rules.items()) this.#removeOne(rule.id)
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
	seat(rules: readonly Rule[]): void {
		this.#rules.seat(rules)
	}

	destroy(): void {
		// Idempotent: a second call re-flags an already-destroyed collection and
		// emits into an already-destroyed emitter (a no-op).
		this.#rules.destroy()
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	// One removal, reported: a rule that was never there is neither removed nor
	// announced, so each batch form emits exactly what it changed.
	#removeOne(id: string): boolean {
		if (!this.#rules.remove(id)) return false
		this.#emitter.emit('remove', id)
		return true
	}
}
