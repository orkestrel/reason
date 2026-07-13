import { Aggregator, createAggregator } from '@src/core'
import { describe, expect, it } from 'vitest'
import { invokeRaw, repeatValue, sequence } from '../../../../setup.js'

// `Aggregator` behavior — the quantitative combiner: per-aggregation reduction
// (sum / product / average / minimum / maximum), the empty-input identities
// (sum / average → 0, product → 1, minimum / maximum → NaN), the weighted forms
// (a weight multiplies into a sum, is an EXPONENT for a product, a weighted mean
// for an average with zero-total-weight → 0), the silent unweighted fallback on
// a weight-length mismatch, and the total never-throw posture (an unknown
// aggregation → 0). Ports the full scsr Aggregator catalog; the options-object
// constructor replaces scsr's positional id (DESIGN §2). No mocks — the real
// stateless instance throughout (AGENTS §16).

const aggregator = createAggregator()

describe('Aggregator — identity', () => {
	it('defaults its id to "aggregator"', () => {
		expect(aggregator.id).toBe('aggregator')
		expect(new Aggregator().id).toBe('aggregator')
	})

	it('takes a custom id through the options object', () => {
		expect(new Aggregator({ id: 'custom' }).id).toBe('custom')
	})
})

describe('Aggregator — sum', () => {
	it('sums values', () => {
		expect(aggregator.aggregate([1, 2, 3, 4], 'sum')).toBe(10)
	})

	it('returns 0 for an empty array (additive identity)', () => {
		expect(aggregator.aggregate([], 'sum')).toBe(0)
	})

	it('returns the single value for a one-element array', () => {
		expect(aggregator.aggregate([42], 'sum')).toBe(42)
	})

	it('sums negatives and cancelling pairs', () => {
		expect(aggregator.aggregate([-1, 2, -3], 'sum')).toBe(-2)
		expect(aggregator.aggregate([5, -5], 'sum')).toBe(0)
	})

	it('sums large values without loss at this magnitude', () => {
		expect(aggregator.aggregate([1e15, 1e15], 'sum')).toBe(2e15)
	})

	it('propagates NaN and Infinity', () => {
		expect(aggregator.aggregate([1, Number.NaN, 3], 'sum')).toBeNaN()
		expect(aggregator.aggregate([1, Number.POSITIVE_INFINITY, 3], 'sum')).toBe(
			Number.POSITIVE_INFINITY,
		)
	})

	it('sums 100 ones to 100', () => {
		expect(
			aggregator.aggregate(
				Array.from({ length: 100 }, () => 1),
				'sum',
			),
		).toBe(100)
	})

	it('returns the raw floating-point sum (no rounding)', () => {
		expect(aggregator.aggregate([0.1, 0.2], 'sum')).toBe(0.30000000000000004)
	})

	it('multiplies each value by its weight (Σ value × weight)', () => {
		expect(aggregator.aggregate([1, 2, 3], 'sum', [2, 3, 1])).toBe(11)
	})

	it('ignores weights of mismatched length (silently unweighted)', () => {
		expect(aggregator.aggregate([1, 2, 3], 'sum', [2, 3])).toBe(6)
	})

	it('treats an empty weights array as unweighted', () => {
		expect(aggregator.aggregate([1, 2, 3], 'sum', [])).toBe(6)
	})
})

describe('Aggregator — product', () => {
	it('multiplies values', () => {
		expect(aggregator.aggregate([2, 3, 4], 'product')).toBe(24)
	})

	it('returns 1 for an empty array (multiplicative identity)', () => {
		expect(aggregator.aggregate([], 'product')).toBe(1)
	})

	it('zeroes out on a zero factor', () => {
		expect(aggregator.aggregate([2, 0, 4], 'product')).toBe(0)
	})

	it('returns the single value for a one-element array', () => {
		expect(aggregator.aggregate([7], 'product')).toBe(7)
	})

	it('tracks sign across negative factors', () => {
		expect(aggregator.aggregate([-2, 3], 'product')).toBe(-6)
		expect(aggregator.aggregate([-2, -3], 'product')).toBe(6)
		expect(aggregator.aggregate([42, -1], 'product')).toBe(-42)
	})

	it('propagates NaN and Infinity', () => {
		expect(aggregator.aggregate([2, Number.NaN], 'product')).toBeNaN()
		expect(aggregator.aggregate([2, Number.POSITIVE_INFINITY], 'product')).toBe(
			Number.POSITIVE_INFINITY,
		)
	})

	it('multiplies ten 2s to 1024', () => {
		expect(
			aggregator.aggregate(
				Array.from({ length: 10 }, () => 2),
				'product',
			),
		).toBe(1024)
	})

	it('uses weights as EXPONENTS (Π value ^ weight)', () => {
		expect(aggregator.aggregate([2, 3], 'product', [10, 20])).toBe(
			Math.pow(2, 10) * Math.pow(3, 20),
		)
	})
})

describe('Aggregator — average', () => {
	it('averages values', () => {
		expect(aggregator.aggregate([10, 20, 30], 'average')).toBe(20)
	})

	it('returns 0 for an empty array', () => {
		expect(aggregator.aggregate([], 'average')).toBe(0)
	})

	it('returns the single value for a one-element array', () => {
		expect(aggregator.aggregate([42], 'average')).toBe(42)
	})

	it('yields fractional means', () => {
		expect(aggregator.aggregate([1, 2], 'average')).toBe(1.5)
	})

	it('computes the weighted mean (Σ v·w / Σ w)', () => {
		expect(aggregator.aggregate([10, 20], 'average', [1, 3])).toBe(17.5)
	})

	it('equal weights reduce to the plain mean', () => {
		expect(aggregator.aggregate([10, 20, 30], 'average', [1, 1, 1])).toBe(20)
	})

	it('returns 0 on a zero total weight (never a division blow-up)', () => {
		expect(aggregator.aggregate([10, 20], 'average', [0, 0])).toBe(0)
	})

	it('ignores weights of mismatched length (silently unweighted)', () => {
		expect(aggregator.aggregate([10, 20, 30], 'average', [1, 2])).toBe(20)
	})

	it('a dominant weight pulls the mean to its value (exact FP)', () => {
		expect(aggregator.aggregate([100, 0], 'average', [100, 1])).toBe(10000 / 101)
	})

	it('a huge weight approaches its value (exact FP)', () => {
		expect(aggregator.aggregate([100, 0], 'average', [1000000, 1])).toBe(100000000 / 1000001)
	})

	it('uses negative weights arithmetically', () => {
		expect(aggregator.aggregate([10, 20], 'average', [-1, 2])).toBe(30)
	})

	it('identical values average to that value; all-zero values weight to 0', () => {
		expect(aggregator.aggregate([5, 5, 5], 'average')).toBe(5)
		expect(aggregator.aggregate([0, 0], 'average', [3, 7])).toBe(0)
	})

	it('propagates NaN', () => {
		expect(aggregator.aggregate([10, Number.NaN], 'average')).toBeNaN()
	})

	it('averages 1000 fives to 5', () => {
		expect(
			aggregator.aggregate(
				Array.from({ length: 1000 }, () => 5),
				'average',
			),
		).toBe(5)
	})
})

describe('Aggregator — minimum', () => {
	it('picks the smallest value', () => {
		expect(aggregator.aggregate([5, 2, 8, 1], 'minimum')).toBe(1)
	})

	it('returns NaN for an empty array (the "no data" signal)', () => {
		expect(aggregator.aggregate([], 'minimum')).toBeNaN()
	})

	it('handles negatives, singles, and identical values', () => {
		expect(aggregator.aggregate([-3, -1, -5], 'minimum')).toBe(-5)
		expect(aggregator.aggregate([42], 'minimum')).toBe(42)
		expect(aggregator.aggregate([5, 5, 5], 'minimum')).toBe(5)
	})

	it('propagates NaN and resolves infinities', () => {
		expect(aggregator.aggregate([5, Number.NaN, 1], 'minimum')).toBeNaN()
		expect(
			aggregator.aggregate([Number.POSITIVE_INFINITY, 0, Number.NEGATIVE_INFINITY], 'minimum'),
		).toBe(Number.NEGATIVE_INFINITY)
	})

	it('ignores weights entirely', () => {
		expect(aggregator.aggregate([5, 2, 8], 'minimum', [100, 1, 1])).toBe(2)
	})

	it('finds 0 across 0..999', () => {
		expect(
			aggregator.aggregate(
				Array.from({ length: 1000 }, (_, index) => index),
				'minimum',
			),
		).toBe(0)
	})
})

describe('Aggregator — maximum', () => {
	it('picks the largest value', () => {
		expect(aggregator.aggregate([5, 2, 8, 1], 'maximum')).toBe(8)
	})

	it('returns NaN for an empty array (the "no data" signal)', () => {
		expect(aggregator.aggregate([], 'maximum')).toBeNaN()
	})

	it('handles negatives, singles, and identical values', () => {
		expect(aggregator.aggregate([-3, -1, -5], 'maximum')).toBe(-1)
		expect(aggregator.aggregate([42], 'maximum')).toBe(42)
		expect(aggregator.aggregate([5, 5, 5], 'maximum')).toBe(5)
	})

	it('propagates NaN and resolves infinities', () => {
		expect(aggregator.aggregate([5, Number.NaN, 8], 'maximum')).toBeNaN()
		expect(
			aggregator.aggregate([Number.POSITIVE_INFINITY, 0, Number.NEGATIVE_INFINITY], 'maximum'),
		).toBe(Number.POSITIVE_INFINITY)
	})

	it('ignores weights entirely', () => {
		expect(aggregator.aggregate([5, 2, 8], 'maximum', [100, 100, 1])).toBe(8)
	})

	it('finds 999 across 0..999', () => {
		expect(
			aggregator.aggregate(
				Array.from({ length: 1000 }, (_, index) => index),
				'maximum',
			),
		).toBe(999)
	})
})

describe('Aggregator — edge cases', () => {
	it('an unknown aggregation returns 0 for empty and populated arrays alike (never throws)', () => {
		expect(invokeRaw<number>(aggregator, aggregator.aggregate, [[], 'unknown'])).toBe(0)
		expect(invokeRaw<number>(aggregator, aggregator.aggregate, [[1, 2, 3], 'unknown'])).toBe(0)
	})

	it('handles 10000 ones across every aggregation', () => {
		const ones = Array.from({ length: 10000 }, () => 1)
		expect(aggregator.aggregate(ones, 'sum')).toBe(10000)
		expect(aggregator.aggregate(ones, 'product')).toBe(1)
		expect(aggregator.aggregate(ones, 'average')).toBe(1)
		expect(aggregator.aggregate(ones, 'minimum')).toBe(1)
		expect(aggregator.aggregate(ones, 'maximum')).toBe(1)
	})
})

describe('Aggregator — scale (100k elements)', () => {
	const SCALE = 100000

	it('sums and averages 100k ones to exact values', () => {
		const ones = repeatValue(SCALE, 1)
		expect(aggregator.aggregate(ones, 'sum')).toBe(100000)
		expect(aggregator.aggregate(ones, 'average')).toBe(1)
	})

	it('products 100k ones down to the multiplicative identity 1', () => {
		expect(aggregator.aggregate(repeatValue(SCALE, 1), 'product')).toBe(1)
	})

	it('finds the min and max across a 100k contiguous range', () => {
		const range = sequence(SCALE)
		expect(aggregator.aggregate(range, 'minimum')).toBe(0)
		expect(aggregator.aggregate(range, 'maximum')).toBe(99999)
	})

	it('sums a 100k range to its exact closed-form total', () => {
		// Σ 0..99999 = 99999 × 100000 / 2 = 4999950000, well under 2^53 so exact.
		expect(aggregator.aggregate(sequence(SCALE), 'sum')).toBe(4999950000)
	})
})

describe('Aggregator — pairwise-reduce min/max (no spread RangeError)', () => {
	it('finds the min and max across a 200k range without spreading past the arg limit', () => {
		// A 200k array (well over the ~130k `Math.min(...values)` argument-count ceiling)
		// reduces pairwise, so the seedless fold returns the exact extrema without throwing.
		const range = sequence(200000)
		expect(aggregator.aggregate(range, 'minimum')).toBe(0)
		expect(aggregator.aggregate(range, 'maximum')).toBe(199999)
	})
})

describe('Aggregator — safe-integer accumulation', () => {
	it('a running sum that crosses 2^53 yields the real lossy IEEE result', () => {
		// MAX_SAFE + 1 = 2^53; each further +1 rounds back to 2^53 (round-to-even).
		expect(aggregator.aggregate([Number.MAX_SAFE_INTEGER, 1, 1], 'sum')).toBe(9007199254740992)
		expect(aggregator.aggregate([Number.MAX_SAFE_INTEGER, 1, 1, 1, 1], 'sum')).toBe(
			9007199254740992,
		)
	})

	it('sums exactly-representable powers of two without loss', () => {
		expect(aggregator.aggregate([2 ** 52, 2 ** 52], 'sum')).toBe(2 ** 53)
	})
})

describe('Aggregator — signed zero', () => {
	it('a product with a lone -0 factor stays -0; a negative factor flips it to +0', () => {
		expect(Object.is(aggregator.aggregate([-0, 5], 'product'), -0)).toBe(true)
		expect(Object.is(aggregator.aggregate([-1, -0], 'product'), 0)).toBe(true)
	})

	it('minimum keeps -0 below +0, maximum keeps +0 above -0 (Math.min/max sign rules)', () => {
		expect(Object.is(aggregator.aggregate([-0, 0], 'minimum'), -0)).toBe(true)
		expect(Object.is(aggregator.aggregate([-0, 0], 'maximum'), 0)).toBe(true)
		expect(Object.is(aggregator.aggregate([-0, -0], 'minimum'), -0)).toBe(true)
		expect(Object.is(aggregator.aggregate([0, -0], 'maximum'), 0)).toBe(true)
	})
})

describe('Aggregator — weighted product exponent edge cases', () => {
	it('a -1 weight inverts its value (v^-1)', () => {
		expect(aggregator.aggregate([2], 'product', [-1])).toBe(0.5)
		expect(aggregator.aggregate([2, 4], 'product', [-1, -1])).toBe(0.125)
	})

	it('a fractional weight over a negative value is NaN (Math.pow of a negative base)', () => {
		expect(aggregator.aggregate([-4], 'product', [0.5])).toBeNaN()
	})

	it('a 0 weight neutralizes its value to 1 (v^0)', () => {
		expect(aggregator.aggregate([5, 7], 'product', [0, 0])).toBe(1)
		expect(aggregator.aggregate([5, 7], 'product', [0, 1])).toBe(7)
	})
})

describe('Aggregator — extreme weights', () => {
	it('a NaN weight poisons a weighted sum', () => {
		expect(aggregator.aggregate([1, 2], 'sum', [Number.NaN, 1])).toBeNaN()
	})

	it('an infinite weight drives a weighted sum to Infinity', () => {
		expect(aggregator.aggregate([1, 2], 'sum', [Number.POSITIVE_INFINITY, 1])).toBe(
			Number.POSITIVE_INFINITY,
		)
	})

	it('a -0 exponent weight neutralizes a product factor to 1 (v^-0 = 1)', () => {
		expect(aggregator.aggregate([5], 'product', [-0])).toBe(1)
	})

	it('a -0 sum weight is washed to +0 by the additive-identity accumulator seed', () => {
		// 5 × -0 = -0, but the reduce seed 0 makes 0 + (-0) = +0 — the sign is lost.
		expect(Object.is(aggregator.aggregate([5], 'sum', [-0]), 0)).toBe(true)
	})
})

describe('Aggregator — weighted average sign & negative totals', () => {
	it('a single negative weight preserves the value (weightedSum / weight)', () => {
		expect(aggregator.aggregate([5], 'average', [-1])).toBe(5)
		expect(aggregator.aggregate([-10], 'average', [-2])).toBe(-10)
	})

	it('uniformly negative weights reduce to the plain mean', () => {
		expect(aggregator.aggregate([10, 20], 'average', [-1, -1])).toBe(15)
	})
})

describe('Aggregator — catastrophic cancellation & precision', () => {
	it('a large-then-cancel sum loses the small addend (real IEEE cancellation)', () => {
		// (1e16 + 1) rounds to 1e16 (ulp = 2 there), then + (-1e16) = 0 — the 1 vanishes.
		expect(aggregator.aggregate([1e16, 1, -1e16], 'sum')).toBe(0)
	})

	it('an EPSILON-scale addend survives at 1 but a half-EPSILON one rounds away', () => {
		expect(aggregator.aggregate([1, Number.EPSILON], 'sum')).toBe(1 + Number.EPSILON)
		// EPSILON / 2 is below one ulp at 1.0, so it rounds off entirely.
		expect(aggregator.aggregate([1, Number.EPSILON / 2], 'sum')).toBe(1)
	})

	it('duplicate extrema return the correct value regardless of position', () => {
		expect(aggregator.aggregate([3, 1, 1, 5], 'minimum')).toBe(1)
		expect(aggregator.aggregate([5, 9, 9, 2], 'maximum')).toBe(9)
	})
})
