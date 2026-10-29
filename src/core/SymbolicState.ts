/**
 * Stores numeric bindings for one symbolic reasoning call.
 */
export class SymbolicState {
	readonly #values: Record<string, number>

	constructor(values?: Readonly<Record<string, number>>) {
		this.#values = { ...values }
	}

	get values(): Readonly<Record<string, number>> {
		return this.#values
	}

	set(name: string, value: number): void {
		this.#values[name] = value
	}
}
