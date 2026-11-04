import type { Rule, Subject } from './types.js'
import { collectConcluders } from './helpers.js'

/**
 * Stores the conclusion keys, derived fields, and closed keys of one logical reasoning call.
 *
 * @remarks
 * A conclusion key is one an enabled rule of the definition concludes. It holds a derived
 * value, or it is closed once every rule that could have concluded it settled without
 * firing, or it is still open and reads `unread`. A closed key a fired rule read is marked:
 * deriving it afterwards would retract what that rule stood on.
 */
export class LogicalState {
	// Null-prototype, so a conclusion key literally named `__proto__` lands as own data.
	readonly #fields: Record<string, unknown> = Object.create(null)
	readonly #concluders: ReadonlyMap<string, readonly Rule[]>
	readonly #closed = new Set<string>()
	readonly #marked = new Set<string>()

	constructor(rules: readonly Rule[]) {
		this.#concluders = collectConcluders(rules)
	}

	get fields(): Subject {
		return this.#fields
	}

	get keys(): readonly string[] {
		return [...this.#concluders.keys()]
	}

	concluders(key: string): readonly Rule[] {
		return this.#concluders.get(key) ?? []
	}

	concludes(key: string): boolean {
		return this.#concluders.has(key)
	}

	has(key: string): boolean {
		return Object.hasOwn(this.#fields, key)
	}

	field(key: string): unknown {
		return this.#fields[key]
	}

	set(key: string, value: unknown): void {
		this.#closed.delete(key)
		this.#fields[key] = value
	}

	closed(key: string): boolean {
		return this.#closed.has(key)
	}

	close(key: string): void {
		this.#closed.add(key)
	}

	marked(key: string): boolean {
		return this.#marked.has(key)
	}

	mark(key: string): void {
		this.#marked.add(key)
	}
}
