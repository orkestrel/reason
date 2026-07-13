import type { EmitterInterface } from '../../../emitters/index.js'
import type {
	Rule,
	RuleManagerEventMap,
	RuleManagerInterface,
	RuleManagerOptions,
} from '../../types.js'
import { Emitter } from '../../../emitters/index.js'
import { appendById, prependById, removeById, replaceById } from '../../helpers.js'
import { ReasonError } from '../../errors.js'

/**
 * The {@link RuleManagerInterface} implementation — a self-owning, kind-free
 * manager over a logical definition's `rules`.
 *
 * @remarks
 * OWNS its `#rules` collection as private copy-on-write state and its own
 * {@link Emitter} over {@link RuleManagerEventMap}. Rule order is LOAD-BEARING —
 * the forward conclusion is the LAST declared non-disabled rule, so `append`
 * without a `target` makes the new rule the conclusion. The write-only
 * `collection` setter is the owning builder's silent bulk re-seat channel
 * (used by `merge`). `destroy()` is idempotent and tears the emitter down LAST;
 * any other call after it throws `ReasonError('DESTROYED', …)`.
 */
export class RuleManager implements RuleManagerInterface {
	#rules: readonly Rule[]
	readonly #emitter: Emitter<RuleManagerEventMap>
	#destroyed = false

	constructor(options?: RuleManagerOptions) {
		this.#rules = options?.rules ?? []
		this.#emitter = new Emitter<RuleManagerEventMap>({ on: options?.on, error: options?.error })
	}

	get emitter(): EmitterInterface<RuleManagerEventMap> {
		return this.#emitter
	}

	set collection(value: readonly Rule[]) {
		this.#ensureAlive()
		this.#rules = value
	}

	rule(id: string): Rule | undefined {
		this.#ensureAlive()
		return this.#rules.find((rule) => rule.id === id)
	}

	rules(): readonly Rule[] {
		this.#ensureAlive()
		return this.#rules
	}

	append(rule: Rule, target?: string): void {
		this.#ensureAlive()
		this.#rules = appendById(this.#rules, rule, target)
		this.#emitter.emit('append', rule.id)
	}

	prepend(rule: Rule, target?: string): void {
		this.#ensureAlive()
		this.#rules = prependById(this.#rules, rule, target)
		this.#emitter.emit('prepend', rule.id)
	}

	replace(rule: Rule): void {
		this.#ensureAlive()
		this.#rules = replaceById(this.#rules, rule)
		this.#emitter.emit('replace', rule.id)
	}

	remove(id: string): void {
		this.#ensureAlive()
		this.#rules = removeById(this.#rules, id)
		this.#emitter.emit('remove', id)
	}

	destroy(): void {
		this.#destroyed = true
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	#ensureAlive(): void {
		if (this.#destroyed) {
			throw new ReasonError('DESTROYED', 'RuleManager has been destroyed')
		}
	}
}
