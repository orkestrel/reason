import type { Transform, TransformerInterface, TransformerOptions } from '../types.js'
import { TRANSFORMER_ID } from '../constants.js'

/**
 * Applies math {@link Transform}s to numbers — the quantitative reasoner's
 * per-factor pipeline stage.
 *
 * @remarks
 * TOTAL: never throws. Absent-`operand` defaults are operation-specific —
 * identity-preserving `1` for `multiply` / `divide` / `power`, `0` for every
 * other binary operation; `round` / `ceil` / `floor` / `abs` are unary and
 * ignore the operand. `divide` by zero yields `NaN` (deliberately not JS's
 * `Infinity`), an unknown operation returns the value unchanged, and `chain` is
 * a strict left fold — `NaN` flows through untouched. Stateless and
 * deterministic.
 */
export class Transformer implements TransformerInterface {
	readonly #id: string

	constructor(options?: TransformerOptions) {
		this.#id = options?.id ?? TRANSFORMER_ID
	}

	get id(): string {
		return this.#id
	}

	apply(value: number, transform: Transform): number {
		switch (transform.operation) {
			case 'add':
				return value + (transform.operand ?? 0)
			case 'subtract':
				return value - (transform.operand ?? 0)
			case 'multiply':
				return value * (transform.operand ?? 1)
			case 'divide': {
				const divisor = transform.operand ?? 1
				return divisor === 0 ? Number.NaN : value / divisor
			}
			case 'percentage':
				return value * ((transform.operand ?? 0) / 100)
			case 'minimum':
				return Math.min(value, transform.operand ?? 0)
			case 'maximum':
				return Math.max(value, transform.operand ?? 0)
			case 'average':
				return (value + (transform.operand ?? 0)) / 2
			case 'power':
				return Math.pow(value, transform.operand ?? 1)
			case 'round':
				return Math.round(value)
			case 'ceil':
				return Math.ceil(value)
			case 'floor':
				return Math.floor(value)
			case 'abs':
				return Math.abs(value)
			default:
				// An unknown operation from an untrusted definition is a silent no-op.
				return value
		}
	}

	chain(value: number, transforms: readonly Transform[]): number {
		return transforms.reduce((result, transform) => this.apply(result, transform), value)
	}
}
