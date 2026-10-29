import type { RuleResult, Subject } from './types.js'

/**
 * Stores the derived fields and rule results of one logical reasoning call.
 */
export class LogicalState {
	readonly #fields: Record<string, unknown> = {}
	readonly #rules = new Map<string, RuleResult>()

	get fields(): Subject {
		return this.#fields
	}

	field(key: string): unknown {
		return this.#fields[key]
	}

	set(key: string, value: unknown): void {
		this.#fields[key] = value
	}

	rule(id: string): RuleResult | undefined {
		return this.#rules.get(id)
	}

	record(result: RuleResult): void {
		this.#rules.set(result.id, result)
	}
}
