import type { Transform, TransformerInterface, TransformerOptions } from '../types.js'
import { applyOperation, resolveOperand } from '../helpers.js'
import { isMathOperation } from '../validators.js'
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
 *
 * @example
 * ```ts
 * import { createTransform, createTransformer } from '@orkestrel/reason'
 *
 * const transformer = createTransformer()
 * transformer.apply(10, createTransform('multiply', 2)) // 20 — one math step
 * transformer.chain(10, [createTransform('add', 5), createTransform('multiply', 2)]) // 30 — left-folded
 * ```
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
		// An unknown operation from an untrusted definition is a silent no-op, and
		// the guard is what keeps `applyOperation`'s throwing default unreachable.
		if (!isMathOperation(transform.operation)) return value
		return applyOperation(
			transform.operation,
			value,
			resolveOperand(transform.operation, transform.operand),
		)
	}

	chain(value: number, transforms: readonly Transform[]): number {
		return transforms.reduce((result, transform) => this.apply(result, transform), value)
	}
}
