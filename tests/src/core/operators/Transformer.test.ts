import { createTransformer, createTransform, Transformer } from '@src/core'
import { describe, expect, it } from 'vitest'
import { invokeUnchecked } from '@orkestrel/test'
import { EXTREME_NUMBERS, repeatValue } from '../../../setup.js'

// `Transformer` behavior — the quantitative per-factor math stage: every
// operation with its default operand (identity-preserving 1 for multiply /
// divide / power, 0 for the other binaries; the unaries ignore the operand),
// divide-by-zero → NaN (deliberately not JS's Infinity), `Math.round`'s
// half-toward-+∞ rounding, NaN / Infinity propagation, the unknown-operation
// no-op, and `chain` as a strict left fold. Ports the full scsr Transformer
// catalog; the options-object constructor replaces scsr's positional id
// (DESIGN §2). No mocks — the real stateless instance throughout (AGENTS §16).

const transformer = createTransformer()

describe('Transformer — identity', () => {
	it('defaults its id to "transformer"', () => {
		expect(transformer.id).toBe('transformer')
		expect(new Transformer().id).toBe('transformer')
	})

	it('takes a custom id through the options object', () => {
		expect(new Transformer({ id: 'custom' }).id).toBe('custom')
	})
})

describe('Transformer — apply (binary operations)', () => {
	it('add adds; its default operand 0 is the identity', () => {
		expect(transformer.apply(10, createTransform('add', 5))).toBe(15)
		expect(transformer.apply(10, createTransform('add'))).toBe(10)
	})

	it('subtract subtracts, can go negative; default operand 0 is the identity', () => {
		expect(transformer.apply(10, createTransform('subtract', 3))).toBe(7)
		expect(transformer.apply(3, createTransform('subtract', 10))).toBe(-7)
		expect(transformer.apply(10, createTransform('subtract'))).toBe(10)
	})

	it('multiply multiplies; its default operand is 1 (identity)', () => {
		expect(transformer.apply(10, createTransform('multiply', 3))).toBe(30)
		expect(transformer.apply(10, createTransform('multiply'))).toBe(10)
		expect(transformer.apply(10, createTransform('multiply', 0))).toBe(0)
		expect(transformer.apply(10, createTransform('multiply', -3))).toBe(-30)
		expect(transformer.apply(10, createTransform('multiply', Number.POSITIVE_INFINITY))).toBe(
			Number.POSITIVE_INFINITY,
		)
	})

	it('divide divides; its default operand is 1 (identity)', () => {
		expect(transformer.apply(10, createTransform('divide', 4))).toBe(2.5)
		expect(transformer.apply(10, createTransform('divide'))).toBe(10)
		expect(transformer.apply(10, createTransform('divide', -2))).toBe(-5)
		expect(transformer.apply(10, createTransform('divide', Number.POSITIVE_INFINITY))).toBe(0)
	})

	it('divide by zero yields NaN (even 0 / 0), never Infinity', () => {
		expect(transformer.apply(10, createTransform('divide', 0))).toBeNaN()
		expect(transformer.apply(0, createTransform('divide', 0))).toBeNaN()
	})

	it('power with a negative base and fractional exponent propagates NaN (Math.pow semantics)', () => {
		expect(transformer.apply(-8, createTransform('power', 0.5))).toBeNaN()
	})

	it('percentage takes value × (operand / 100); default operand 0 zeroes', () => {
		expect(transformer.apply(200, createTransform('percentage', 15))).toBe(30)
		expect(transformer.apply(200, createTransform('percentage', 0))).toBe(0)
		expect(transformer.apply(200, createTransform('percentage'))).toBe(0)
		expect(transformer.apply(200, createTransform('percentage', 100))).toBe(200)
		expect(transformer.apply(200, createTransform('percentage', -50))).toBe(-100)
	})

	it('minimum clamps to the smaller of value and operand; default operand 0', () => {
		expect(transformer.apply(10, createTransform('minimum', 5))).toBe(5)
		expect(transformer.apply(3, createTransform('minimum', 5))).toBe(3)
		expect(transformer.apply(10, createTransform('minimum'))).toBe(0)
		expect(transformer.apply(-5, createTransform('minimum'))).toBe(-5)
		expect(transformer.apply(10, createTransform('minimum', Number.NaN))).toBeNaN()
		expect(transformer.apply(10, createTransform('minimum', Number.POSITIVE_INFINITY))).toBe(10)
	})

	it('maximum clamps to the larger of value and operand; default operand 0', () => {
		expect(transformer.apply(10, createTransform('maximum', 5))).toBe(10)
		expect(transformer.apply(3, createTransform('maximum', 5))).toBe(5)
		expect(transformer.apply(-5, createTransform('maximum'))).toBe(0)
		expect(transformer.apply(10, createTransform('maximum', Number.NEGATIVE_INFINITY))).toBe(10)
	})

	it('average averages value with the operand; default operand 0 halves', () => {
		expect(transformer.apply(10, createTransform('average', 20))).toBe(15)
		expect(transformer.apply(10, createTransform('average'))).toBe(5)
		expect(transformer.apply(10, createTransform('average', 10))).toBe(10)
	})

	it('power raises to the operand; its default 1 is the identity', () => {
		expect(transformer.apply(2, createTransform('power', 3))).toBe(8)
		expect(transformer.apply(2, createTransform('power'))).toBe(2)
		expect(transformer.apply(2, createTransform('power', 0))).toBe(1)
		expect(transformer.apply(2, createTransform('power', -1))).toBe(0.5)
		expect(transformer.apply(9, createTransform('power', 0.5))).toBe(3)
		expect(transformer.apply(2, createTransform('power', Number.NaN))).toBeNaN()
	})
})

describe('Transformer — apply (unary operations)', () => {
	it('round uses Math.round semantics — halves round toward +∞', () => {
		expect(transformer.apply(3.7, createTransform('round'))).toBe(4)
		expect(transformer.apply(3.2, createTransform('round'))).toBe(3)
		expect(transformer.apply(2.5, createTransform('round'))).toBe(3)
		expect(transformer.apply(-3.4, createTransform('round'))).toBe(-3)
		expect(transformer.apply(-3.6, createTransform('round'))).toBe(-4)
		expect(transformer.apply(-2.5, createTransform('round'))).toBe(-2)
		expect(transformer.apply(4, createTransform('round'))).toBe(4)
	})

	it('ceil rounds up', () => {
		expect(transformer.apply(3.1, createTransform('ceil'))).toBe(4)
		expect(transformer.apply(-3.1, createTransform('ceil'))).toBe(-3)
		expect(transformer.apply(4, createTransform('ceil'))).toBe(4)
		expect(transformer.apply(0.0001, createTransform('ceil'))).toBe(1)
	})

	it('floor rounds down', () => {
		expect(transformer.apply(3.9, createTransform('floor'))).toBe(3)
		expect(transformer.apply(-3.1, createTransform('floor'))).toBe(-4)
		expect(transformer.apply(4, createTransform('floor'))).toBe(4)
		expect(transformer.apply(-0.0001, createTransform('floor'))).toBe(-1)
	})

	it('abs strips the sign; abs(-0) is +0; NaN stays NaN', () => {
		expect(transformer.apply(-5, createTransform('abs'))).toBe(5)
		expect(transformer.apply(5, createTransform('abs'))).toBe(5)
		expect(transformer.apply(0, createTransform('abs'))).toBe(0)
		expect(transformer.apply(Number.NEGATIVE_INFINITY, createTransform('abs'))).toBe(
			Number.POSITIVE_INFINITY,
		)
		expect(transformer.apply(Number.NaN, createTransform('abs'))).toBeNaN()
		expect(Object.is(transformer.apply(-0, createTransform('abs')), 0)).toBe(true)
	})
})

describe('Transformer — apply (propagation & unknown operation)', () => {
	it('NaN and Infinity inputs propagate', () => {
		expect(transformer.apply(Number.NaN, createTransform('add', 5))).toBeNaN()
		expect(transformer.apply(Number.POSITIVE_INFINITY, createTransform('add', 5))).toBe(
			Number.POSITIVE_INFINITY,
		)
	})

	it('an unknown operation returns the value unchanged (never throws)', () => {
		expect(
			invokeUnchecked<number>(transformer, transformer.apply, [
				42,
				{ operation: 'unknown', operand: 7 },
			]),
		).toBe(42)
	})
})

describe('Transformer — chain', () => {
	it('folds transforms left to right', () => {
		expect(
			transformer.chain(10, [
				createTransform('multiply', 2),
				createTransform('add', 5),
				createTransform('round'),
			]),
		).toBe(25)
	})

	it('an empty chain returns the value unchanged', () => {
		expect(transformer.chain(10, [])).toBe(10)
	})

	it('a single transform works', () => {
		expect(transformer.chain(10, [createTransform('add', 1)])).toBe(11)
	})

	it('preserves raw floating-point precision (no hidden rounding)', () => {
		expect(transformer.chain(0.1, [createTransform('add', 0.2)])).toBe(0.30000000000000004)
	})

	it('clamps mid-chain', () => {
		expect(
			transformer.chain(100, [createTransform('multiply', 10), createTransform('minimum', 500)]),
		).toBe(500)
	})

	it('folds a long six-operation chain', () => {
		expect(
			transformer.chain(1, [
				createTransform('add', 9),
				createTransform('multiply', 5),
				createTransform('subtract', 10),
				createTransform('divide', 4),
				createTransform('power', 2),
				createTransform('round'),
			]),
		).toBe(100)
	})

	it('NaN produced mid-chain propagates to the end', () => {
		expect(
			transformer.chain(0, [createTransform('divide', 0), createTransform('add', 5)]),
		).toBeNaN()
		// Division by zero yields NaN (not Infinity), so × 0 stays NaN too.
		expect(
			transformer.chain(10, [createTransform('divide', 0), createTransform('multiply', 0)]),
		).toBeNaN()
	})

	it('folds an all-unary chain', () => {
		expect(
			transformer.chain(-3.7, [
				createTransform('abs'),
				createTransform('ceil'),
				createTransform('floor'),
				createTransform('round'),
			]),
		).toBe(4)
	})

	it('abs of a negative intermediate', () => {
		expect(
			transformer.chain(5, [
				createTransform('add', 3),
				createTransform('subtract', 20),
				createTransform('abs'),
			]),
		).toBe(12)
	})

	it('percentage composes with round and add', () => {
		expect(
			transformer.chain(33, [createTransform('percentage', 33), createTransform('round')]),
		).toBe(11)
		expect(
			transformer.chain(100, [createTransform('percentage', 10), createTransform('add', 5)]),
		).toBe(15)
	})
})

describe('Transformer — overflow to Infinity', () => {
	it('repeated multiply past Number.MAX_VALUE overflows to +Infinity', () => {
		// 1e300 × 1e300 = 1e600, beyond MAX_VALUE (~1.8e308) — IEEE overflows, not throws.
		expect(
			transformer.chain(1, [
				createTransform('multiply', 1e300),
				createTransform('multiply', 1e300),
			]),
		).toBe(Number.POSITIVE_INFINITY)
	})

	it('a single multiply can tip a near-max magnitude over the edge', () => {
		expect(transformer.apply(1e308, createTransform('multiply', 10))).toBe(Number.POSITIVE_INFINITY)
		expect(transformer.apply(-1e308, createTransform('multiply', 10))).toBe(
			Number.NEGATIVE_INFINITY,
		)
	})

	it('percentage over 100% of a near-max value overflows to +Infinity', () => {
		expect(transformer.apply(1e308, createTransform('percentage', 200))).toBe(
			Number.POSITIVE_INFINITY,
		)
		// Exactly 100% is the value itself — no overflow.
		expect(transformer.apply(1e308, createTransform('percentage', 100))).toBe(1e308)
	})
})

describe('Transformer — signed zero', () => {
	it('add with +0 (the default operand) washes -0 to +0', () => {
		// IEEE: -0 + (+0) = +0, so the default-operand add loses the negative sign.
		expect(Object.is(transformer.apply(-0, createTransform('add')), 0)).toBe(true)
		expect(Object.is(transformer.apply(-0, createTransform('add', 0)), -0)).toBe(false)
	})

	it('multiply preserves -0 against a positive operand and flips it against a negative', () => {
		expect(Object.is(transformer.apply(-0, createTransform('multiply')), -0)).toBe(true)
		expect(Object.is(transformer.apply(-0, createTransform('multiply', 5)), -0)).toBe(true)
		expect(Object.is(transformer.apply(-0, createTransform('multiply', -1)), 0)).toBe(true)
	})

	it('subtract of +0 (the default operand) keeps -0 negative', () => {
		// IEEE: -0 - (+0) = -0 (unlike addition).
		expect(Object.is(transformer.apply(-0, createTransform('subtract')), -0)).toBe(true)
	})

	it('multiply by the default operand 1 preserves every extreme value, sign included', () => {
		for (const value of EXTREME_NUMBERS) {
			expect(Object.is(transformer.apply(value, createTransform('multiply')), value)).toBe(true)
		}
	})

	it('a chain of identity multiplies carries -0 through to the end', () => {
		expect(
			Object.is(
				transformer.chain(-0, [createTransform('multiply', 1), createTransform('multiply', 1)]),
				-0,
			),
		).toBe(true)
	})
})

describe('Transformer — power edge cases', () => {
	it('an infinite exponent follows Math.pow limits', () => {
		expect(transformer.apply(2, createTransform('power', Number.POSITIVE_INFINITY))).toBe(
			Number.POSITIVE_INFINITY,
		)
		expect(transformer.apply(0.5, createTransform('power', Number.POSITIVE_INFINITY))).toBe(0)
		expect(transformer.apply(2, createTransform('power', Number.NEGATIVE_INFINITY))).toBe(0)
		// A base of exactly 1 with an infinite exponent is the classic NaN indeterminate.
		expect(transformer.apply(1, createTransform('power', Number.POSITIVE_INFINITY))).toBeNaN()
	})

	it('0 to the 0 power is 1 (Math.pow convention)', () => {
		expect(transformer.apply(0, createTransform('power', 0))).toBe(1)
	})

	it('a negative base with a non-integer exponent is NaN', () => {
		expect(transformer.apply(-8, createTransform('power', 0.5))).toBeNaN()
		expect(transformer.apply(-2, createTransform('power', 1.5))).toBeNaN()
	})
})

describe('Transformer — NaN operands', () => {
	it('every binary operation with a NaN operand yields NaN', () => {
		expect(transformer.apply(5, createTransform('add', Number.NaN))).toBeNaN()
		expect(transformer.apply(5, createTransform('subtract', Number.NaN))).toBeNaN()
		expect(transformer.apply(5, createTransform('multiply', Number.NaN))).toBeNaN()
		expect(transformer.apply(5, createTransform('divide', Number.NaN))).toBeNaN()
		expect(transformer.apply(5, createTransform('percentage', Number.NaN))).toBeNaN()
		expect(transformer.apply(5, createTransform('average', Number.NaN))).toBeNaN()
		expect(transformer.apply(5, createTransform('power', Number.NaN))).toBeNaN()
	})

	it('minimum and maximum with a NaN operand propagate NaN (Math.min/max semantics)', () => {
		expect(transformer.apply(5, createTransform('minimum', Number.NaN))).toBeNaN()
		expect(transformer.apply(5, createTransform('maximum', Number.NaN))).toBeNaN()
	})
})

describe('Transformer — precision & safe-integer crossing', () => {
	it('adding 1 to MAX_SAFE_INTEGER reaches 2^53 exactly, but +2 loses precision', () => {
		expect(transformer.apply(Number.MAX_SAFE_INTEGER, createTransform('add', 1))).toBe(
			9007199254740992,
		)
		// 2^53 + 1 is unrepresentable, so +2 rounds back to 2^53 — the real IEEE result.
		expect(transformer.apply(Number.MAX_SAFE_INTEGER, createTransform('add', 2))).toBe(
			9007199254740992,
		)
	})

	it('subnormal add stays representable; subnormal multiply can underflow to +0', () => {
		expect(transformer.apply(Number.MIN_VALUE, createTransform('add', Number.MIN_VALUE))).toBe(
			2 * Number.MIN_VALUE,
		)
		// Half of the smallest subnormal underflows to +0 (round-to-even), not to MIN_VALUE.
		expect(
			Object.is(transformer.apply(Number.MIN_VALUE, createTransform('multiply', 0.5)), 0),
		).toBe(true)
	})

	it('average with infinite operands follows IEEE — matching signs finite-collapse, opposite signs NaN', () => {
		expect(
			transformer.apply(
				Number.POSITIVE_INFINITY,
				createTransform('average', Number.POSITIVE_INFINITY),
			),
		).toBe(Number.POSITIVE_INFINITY)
		expect(
			transformer.apply(
				Number.POSITIVE_INFINITY,
				createTransform('average', Number.NEGATIVE_INFINITY),
			),
		).toBeNaN()
	})
})

describe('Transformer — long chains at scale', () => {
	it('folds 1000 add-1 transforms to an exact total', () => {
		expect(transformer.chain(0, repeatValue(1000, createTransform('add', 1)))).toBe(1000)
	})

	it('folds 1000 identity multiplies without drift', () => {
		expect(transformer.chain(7, repeatValue(1000, createTransform('multiply', 1)))).toBe(7)
	})

	it('a NaN produced early in a long chain propagates through every later step', () => {
		const transforms = [
			createTransform('divide', 0),
			...repeatValue(999, createTransform('add', 1)),
		]
		expect(transformer.chain(10, transforms)).toBeNaN()
	})

	it('a 1000-step alternating add/subtract chain nets to the exact expected value', () => {
		const transforms = repeatValue(500, [
			createTransform('add', 3),
			createTransform('subtract', 1),
		]).flat()
		// 500 × (+3 then −1) = 500 × (+2) = +1000, on top of the seed 5.
		expect(transformer.chain(5, transforms)).toBe(1005)
	})
})
