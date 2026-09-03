import type { MathOperation, Subject } from '@src/core'
import {
	addVariable,
	appendById,
	appendEquation,
	appendFact,
	appendFactor,
	appendGroup,
	appendInference,
	appendRule,
	applyOperation,
	assignField,
	buildErrorResult,
	clamp,
	clearInferentialDefinition,
	clearLogicalDefinition,
	clearQuantitativeDefinition,
	clearSymbolicDefinition,
	computePremiseConfidence,
	containsVariable,
	createAtom,
	createBounds,
	createCompound,
	createConstant,
	createEquation,
	createFact,
	createFactorGroup,
	createFieldSource,
	createInference,
	createInferentialDefinition,
	createLogicalDefinition,
	createLookupSource,
	createOperation,
	createQuantitativeDefinition,
	createRangeSource,
	createRule,
	createStaticFactor,
	createStaticSource,
	createSymbolicDefinition,
	createVariable,
	definitionToEnvelope,
	emptyAggregate,
	equalValues,
	extractAtoms,
	extractConclusions,
	factToArityKey,
	factToKey,
	findDuplicates,
	findOverlayMismatches,
	findUnboundVariables,
	formatField,
	indexByArity,
	instantiateFact,
	invertLeft,
	invertRight,
	isMathOperation,
	isReasonError,
	matchesBounds,
	matchFacts,
	mergeById,
	mergeInferentialDefinition,
	mergeLogicalDefinition,
	mergeQuantitativeDefinition,
	mergeSubjects,
	mergeSymbolicDefinition,
	parseDefinition,
	prependById,
	prependEquation,
	prependFact,
	prependFactor,
	prependGroup,
	prependInference,
	prependRule,
	removeById,
	removeEquation,
	removeFact,
	removeFactor,
	removeField,
	removeGroup,
	removeInference,
	removeRule,
	removeVariable,
	repeatSubject,
	replaceById,
	replaceEquation,
	replaceFact,
	replaceFactor,
	replaceGroup,
	replaceInference,
	replaceRule,
	resolveOperand,
	resolveSource,
	roundTo,
	sortByPriority,
	subjectToFacts,
	termToKey,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError, invokeUnchecked } from '@orkestrel/test'
import {
	ADVERSARIAL_VALUE_SUBJECT,
	EXTREME_NUMBERS,
	INTEGER_KEY_SUBJECT,
	TRICKY_KEYS,
	deepAddition,
	deepCompound,
	deepFreeze,
	sequence,
	sparse,
} from '../../setup.js'

// The reasons helpers — `formatField`'s display form, the `clamp` / `roundTo`
// numerics (inverted bounds, negative and overflowing precisions included), the
// shared reasoner machinery — `equalValues` (SameValueZero derivation
// equality), `sortByPriority` (stable ascending copy sort), `findDuplicates`
// (the validate uniqueness scan) — the inferential fact and symbolic algebra
// leaves, the id-keyed collection primitives, and the copy-on-write change /
// extend / merge / clear family over definitions and subjects. Every helper
// returns a fresh value and leaves its input untouched. The value factories
// those helpers compose are proven in factories.test.ts.

describe('formatField — display form of a FieldPath', () => {
	it('returns a string key as itself', () => {
		expect(formatField('age')).toBe('age')
	})

	it('joins array segments with a dot', () => {
		expect(formatField(['address', 'city'])).toBe('address.city')
	})

	it('a dotted string passes through untouched (never re-split)', () => {
		expect(formatField('a.b')).toBe('a.b')
	})

	it('an empty array joins to the empty string', () => {
		expect(formatField([])).toBe('')
	})
})

describe('clamp — inclusive bounds', () => {
	it('clamps below the minimum and above the maximum', () => {
		expect(clamp(150, { minimum: 0, maximum: 100 })).toBe(100)
		expect(clamp(-5, { minimum: 0, maximum: 100 })).toBe(0)
	})

	it('leaves in-range values unchanged; boundary values are inclusive', () => {
		expect(clamp(50, { minimum: 0, maximum: 100 })).toBe(50)
		expect(clamp(0, { minimum: 0, maximum: 100 })).toBe(0)
		expect(clamp(100, { minimum: 0, maximum: 100 })).toBe(100)
	})

	it('an absent side (or absent bounds) never constrains', () => {
		expect(clamp(150)).toBe(150)
		expect(clamp(150, {})).toBe(150)
		expect(clamp(150, { minimum: 0 })).toBe(150)
		expect(clamp(-150, { maximum: 100 })).toBe(-150)
	})

	it('NaN flows through unchanged (every comparison with NaN is false)', () => {
		expect(clamp(Number.NaN, { minimum: 0, maximum: 100 })).toBeNaN()
	})

	it('inverted bounds (minimum > maximum): the maximum WINS (applied last)', () => {
		expect(clamp(5, { minimum: 10, maximum: 0 })).toBe(0)
		expect(clamp(50, { minimum: 10, maximum: 0 })).toBe(0)
		expect(clamp(-5, { minimum: 10, maximum: 0 })).toBe(0)
	})
})

describe('roundTo — fixed decimal places', () => {
	it('rounds to the requested precision', () => {
		expect(roundTo(3.14159, 2)).toBe(3.14)
		expect(roundTo(3.14159, 4)).toBe(3.1416)
	})

	it('defaults to 0 decimal places', () => {
		expect(roundTo(3.7)).toBe(4)
	})

	it('halves round toward +∞ (Math.round semantics)', () => {
		expect(roundTo(2.5)).toBe(3)
		expect(roundTo(-2.5)).toBe(-2)
	})

	it('integers survive any precision', () => {
		expect(roundTo(42, 4)).toBe(42)
	})

	it('a negative precision rounds at whole-number scales (tens / hundreds)', () => {
		expect(roundTo(1234, -2)).toBe(1200)
		// Halves still round toward +∞, now at the hundreds scale.
		expect(roundTo(1250, -2)).toBe(1300)
		expect(roundTo(15, -1)).toBe(20)
		expect(roundTo(-25, -1)).toBe(-20)
	})

	it('an EXTREME precision passes the value through unchanged (overflowed scale factor)', () => {
		expect(roundTo(1.5, 400)).toBe(1.5) // 10^400 → Infinity
		expect(roundTo(1.5, 100)).toBe(1.5) // finite factor, sub-ULP precision — value keeps its bits
		expect(roundTo(1234, -400)).toBe(1234) // 10^-400 → 0
	})
})

describe('equalValues — SameValueZero equality', () => {
	it('NaN equals NaN (unlike ===, which is always false for NaN)', () => {
		expect(equalValues(Number.NaN, Number.NaN)).toBe(true)
	})

	it('+0 equals -0 (unlike Object.is)', () => {
		expect(equalValues(0, -0)).toBe(true)
		expect(equalValues(-0, 0)).toBe(true)
	})

	it('matches strict equality everywhere else — no coercion', () => {
		expect(equalValues(1, 1)).toBe(true)
		expect(equalValues('a', 'a')).toBe(true)
		expect(equalValues(true, true)).toBe(true)
		expect(equalValues(null, null)).toBe(true)
		expect(equalValues(undefined, undefined)).toBe(true)
		expect(equalValues(1, '1')).toBe(false)
		expect(equalValues(null, undefined)).toBe(false)
		expect(equalValues(Number.NaN, 0)).toBe(false)
	})

	it('compares objects by reference', () => {
		const shared = { nested: true }
		expect(equalValues(shared, shared)).toBe(true)
		expect(equalValues(shared, { nested: true })).toBe(false)
	})
})

describe('sortByPriority — stable ascending copy sort', () => {
	it('orders ascending with an absent priority defaulting to 0', () => {
		const items = [{ id: 'high', priority: 5 }, { id: 'default' }, { id: 'neg', priority: -1 }]
		expect(sortByPriority(items).map((item) => item.id)).toEqual(['neg', 'default', 'high'])
	})

	it('a negative priority sorts BEFORE the default-0 item', () => {
		const sorted = sortByPriority([{ id: 'default' }, { id: 'neg', priority: -5 }])
		expect(sorted.map((item) => item.id)).toEqual(['neg', 'default'])
	})

	it('is STABLE — equal priorities keep declaration order', () => {
		const items = [
			{ id: 'a', priority: 1 },
			{ id: 'b', priority: 1 },
			{ id: 'c' },
			{ id: 'd' },
			{ id: 'e', priority: 1 },
		]
		expect(sortByPriority(items).map((item) => item.id)).toEqual(['c', 'd', 'a', 'b', 'e'])
	})

	it('returns a FRESH array and never mutates the input', () => {
		const items = [
			{ id: 'z', priority: 9 },
			{ id: 'a', priority: 1 },
		]
		const sorted = sortByPriority(items)
		expect(sorted).not.toBe(items)
		expect(items.map((item) => item.id)).toEqual(['z', 'a'])
		expect(sorted.map((item) => item.id)).toEqual(['a', 'z'])
	})

	it('handles empty and single-item lists', () => {
		expect(sortByPriority([])).toEqual([])
		const only: ReadonlyArray<{ readonly id: string; readonly priority?: number }> = [
			{ id: 'only' },
		]
		expect(sortByPriority(only)).toEqual([{ id: 'only' }])
	})

	it('a dense, fully-valid input sorts unchanged in length and order', () => {
		const items = [
			{ id: 'z', priority: 9 },
			{ id: 'a', priority: 1 },
			{ id: 'm', priority: 1 },
		]
		const sorted = sortByPriority(items)
		expect(sorted).toHaveLength(items.length)
		expect(sorted.map((item) => item.id)).toEqual(['a', 'm', 'z'])
	})
})

describe('sortByPriority — hole & junk tolerance (total, not throwing)', () => {
	it('drops array holes before sorting — only present entries appear, in priority order', () => {
		const items = sparse<{ readonly id: string; readonly priority?: number }>(4, [
			[0, { id: 'a', priority: 2 }],
			[2, { id: 'b', priority: 1 }],
		])
		expect(sortByPriority(items).map((item) => item.id)).toEqual(['b', 'a'])
	})

	it('drops a null element (ill-typed) without throwing — priority order preserved', () => {
		const items = [{ id: 'a', priority: 2 }, null, { id: 'b', priority: 1 }]
		const sortByPriorityRaw = (
			...args: never[]
		): ReadonlyArray<{ readonly id: string; readonly priority?: number }> => {
			const value = args[0]
			if (value === undefined) throw new Error('expected items')
			return sortByPriority<{ readonly id: string; readonly priority?: number }>(value)
		}
		const sorted = invokeUnchecked<ReadonlyArray<{ readonly id: string }>>(
			undefined,
			sortByPriorityRaw,
			[items],
		)
		expect(sorted.map((item) => item.id)).toEqual(['b', 'a'])
	})
})

describe('findDuplicates — the validate uniqueness scan', () => {
	it('returns [] for empty and all-unique lists', () => {
		expect(findDuplicates([])).toEqual([])
		expect(findDuplicates([{ id: 'a' }, { id: 'b' }])).toEqual([])
	})

	it('reports a duplicated id ONCE, however often it repeats', () => {
		expect(findDuplicates([{ id: 'a' }, { id: 'b' }, { id: 'a' }])).toEqual(['a'])
		expect(findDuplicates([{ id: 'a' }, { id: 'a' }, { id: 'a' }])).toEqual(['a'])
	})

	it('reports multiple duplicated ids in first-occurrence order', () => {
		expect(findDuplicates([{ id: 'b' }, { id: 'a' }, { id: 'b' }, { id: 'a' }])).toEqual(['b', 'a'])
	})
})

// ── Numeric-extreme, signed-zero & unicode boundary sweeps ────────────────────
// Adversarial hardening of the pure numeric / ordering / uniqueness helpers:
// signed-zero sign preservation (asserted through Object.is, since `.toBe`/`===`
// conflate ±0), the curated JavaScript numeric extremes (EXTREME_NUMBERS), the
// roundTo overflow-passthrough boundaries (scale factor Infinity at p≈309, 0 at
// p≈-324), and NFC-labile / prototype-name string ids. Every expectation pins the
// REAL observed behavior.

describe('roundTo — signed zero, numeric extremes & overflow boundaries', () => {
	it('preserves a negative-zero result (sign asserted through Object.is)', () => {
		// Math.round(-0.4) is -0; dividing by the 10^0 factor keeps the sign.
		expect(Object.is(roundTo(-0.4), -0)).toBe(true)
		expect(Object.is(roundTo(-0.5), -0)).toBe(true)
		expect(Object.is(roundTo(-0, 0), -0)).toBe(true)
		expect(Object.is(roundTo(-0, 4), -0)).toBe(true)
		// A positive tiny value rounds to +0, never -0.
		expect(Object.is(roundTo(0.4), 0)).toBe(true)
	})

	it('rounds every curated extreme at precision 0 to an exact value', () => {
		expect(roundTo(0, 0)).toBe(0)
		expect(Object.is(roundTo(-0, 0), -0)).toBe(true)
		expect(roundTo(1, 0)).toBe(1)
		expect(roundTo(-1, 0)).toBe(-1)
		expect(roundTo(Number.MAX_SAFE_INTEGER, 0)).toBe(Number.MAX_SAFE_INTEGER)
		expect(roundTo(Number.MIN_SAFE_INTEGER, 0)).toBe(Number.MIN_SAFE_INTEGER)
		expect(roundTo(Number.MAX_VALUE, 0)).toBe(Number.MAX_VALUE)
		expect(roundTo(Number.MIN_VALUE, 0)).toBe(0) // smallest subnormal → 0
		expect(roundTo(Number.EPSILON, 0)).toBe(0)
		expect(roundTo(1e308, 0)).toBe(1e308)
		expect(roundTo(-1e308, 0)).toBe(-1e308)
		expect(roundTo(0.1, 0)).toBe(0)
		expect(roundTo(0.2, 0)).toBe(0)
		expect(roundTo(0.3, 0)).toBe(0)
	})

	it('rounds curated extremes at precision 4 — MAX_SAFE loses its last digit', () => {
		expect(roundTo(1, 4)).toBe(1)
		expect(roundTo(-1, 4)).toBe(-1)
		// value * 10^4 exceeds the safe-integer range: the round-trip drops the low digit.
		expect(roundTo(Number.MAX_SAFE_INTEGER, 4)).toBe(9007199254740990)
		expect(roundTo(Number.MIN_SAFE_INTEGER, 4)).toBe(-9007199254740990)
		// value * 10^4 overflows to ±Infinity even though the 10^4 factor is finite —
		// the passthrough guard checks the FACTOR, not value*factor, so NO passthrough.
		expect(roundTo(Number.MAX_VALUE, 4)).toBe(Number.POSITIVE_INFINITY)
		expect(roundTo(1e308, 4)).toBe(Number.POSITIVE_INFINITY)
		expect(roundTo(-1e308, 4)).toBe(Number.NEGATIVE_INFINITY)
		expect(roundTo(0.1, 4)).toBe(0.1)
		expect(roundTo(0.2, 4)).toBe(0.2)
		expect(roundTo(0.3, 4)).toBe(0.3)
	})

	it('never yields NaN across the curated extremes (precision 0 and 4)', () => {
		for (const value of EXTREME_NUMBERS) {
			expect(Number.isNaN(roundTo(value, 0))).toBe(false)
			expect(Number.isNaN(roundTo(value, 4))).toBe(false)
		}
	})

	it('negative precision rounds at tens / hundreds / thousands (exact)', () => {
		expect(roundTo(1234, -1)).toBe(1230)
		expect(roundTo(1234, -2)).toBe(1200)
		expect(roundTo(1234, -3)).toBe(1000)
		expect(roundTo(1250, -2)).toBe(1300) // halves toward +∞
		expect(roundTo(-1250, -2)).toBe(-1200) // -12.5 → -12 at the hundreds scale
	})

	it('pins the positive overflow boundary — passthrough begins where 10^p is Infinity', () => {
		// 10^308 is finite, 10^309 is Infinity. At p=308 a value that overflows on
		// multiply yields Infinity; at p=309 the Infinity factor triggers passthrough.
		expect(roundTo(1e308, 308)).toBe(Number.POSITIVE_INFINITY)
		expect(roundTo(1e308, 309)).toBe(1e308)
		expect(roundTo(1.5, 309)).toBe(1.5)
		expect(roundTo(1.5, 400)).toBe(1.5)
	})

	it('pins the negative overflow boundary — passthrough begins where 10^p is 0', () => {
		// 10^-323 is a nonzero subnormal, 10^-324 flushes to 0. At p=-323 the value
		// rounds to 0; at p=-324 the zero factor triggers passthrough (value unchanged).
		expect(roundTo(1234, -323)).toBe(0)
		expect(roundTo(1234, -324)).toBe(1234)
	})
})

describe('clamp — signed zero, extreme bounds & NaN bounds', () => {
	it('clamps against MAX_SAFE_INTEGER / MIN_VALUE bounds exactly', () => {
		expect(clamp(Number.MAX_SAFE_INTEGER, { maximum: 0 })).toBe(0)
		expect(clamp(1e50, { maximum: Number.MAX_SAFE_INTEGER })).toBe(Number.MAX_SAFE_INTEGER)
		expect(clamp(-5, { minimum: Number.MIN_VALUE })).toBe(Number.MIN_VALUE)
	})

	it('yields -0 only when the -0 minimum wins (sign asserted through Object.is)', () => {
		// Any negative is < -0, so the result becomes the -0 minimum; the +0 maximum
		// does not push it back (−0 > 0 is false).
		expect(Object.is(clamp(-5, { minimum: -0, maximum: 0 }), -0)).toBe(true)
		// A value above the +0 maximum clamps to +0, never -0.
		expect(Object.is(clamp(5, { minimum: -0, maximum: 0 }), 0)).toBe(true)
		// An in-range +0 keeps its own +0 sign (no comparison fires).
		expect(Object.is(clamp(0, { minimum: -0, maximum: 0 }), 0)).toBe(true)
	})

	it('passes through unchanged when a bound is NaN (every comparison false)', () => {
		expect(clamp(5, { minimum: Number.NaN, maximum: Number.NaN })).toBe(5)
		expect(clamp(-5, { minimum: Number.NaN })).toBe(-5)
		expect(clamp(5, { maximum: Number.NaN })).toBe(5)
	})

	it('inverted extreme bounds: the maximum wins (applied last)', () => {
		expect(clamp(50, { minimum: Number.MAX_SAFE_INTEGER, maximum: 0 })).toBe(0)
	})
})

describe('equalValues — bigint, symbol & safe-integer boundary', () => {
	it('does NOT coerce a bigint to a number (10n vs 10 → false)', () => {
		expect(equalValues(10n, 10)).toBe(false)
		expect(equalValues(10n, 10n)).toBe(true)
	})

	it('distinguishes MAX_SAFE_INTEGER from its representable successor', () => {
		// MAX_SAFE_INTEGER + 1 IS exactly representable (2^53), so the two differ.
		expect(Number.MAX_SAFE_INTEGER + 1).not.toBe(Number.MAX_SAFE_INTEGER)
		expect(equalValues(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1)).toBe(false)
		// + 2 is NOT representable — it collapses onto + 1, so THOSE compare equal.
		expect(equalValues(Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 2)).toBe(true)
	})

	it('compares symbols by identity (no coercion)', () => {
		const shared = Symbol('x')
		expect(equalValues(shared, shared)).toBe(true)
		expect(equalValues(Symbol('x'), Symbol('x'))).toBe(false)
	})

	it('equates the subnormal / signed-zero / NaN edges (SameValueZero)', () => {
		expect(equalValues(Number.MIN_VALUE, Number.MIN_VALUE)).toBe(true)
		expect(equalValues(-0, 0)).toBe(true)
		expect(equalValues(Number.NaN, Number.NaN)).toBe(true)
	})
})

describe('sortByPriority — NaN, infinite & fractional priorities, at scale', () => {
	it('leaves a NaN-priority item in place (comparator NaN coerced to +0 → stable)', () => {
		const items = [
			{ id: 'a', priority: 1 },
			{ id: 'nan', priority: Number.NaN },
			{ id: 'b', priority: 2 },
		]
		expect(sortByPriority(items).map((item) => item.id)).toEqual(['a', 'nan', 'b'])
	})

	it('orders ±Infinity priorities to the extremes', () => {
		const items = [
			{ id: 'a', priority: 1 },
			{ id: 'inf', priority: Number.POSITIVE_INFINITY },
			{ id: 'ninf', priority: Number.NEGATIVE_INFINITY },
			{ id: 'b', priority: 2 },
		]
		expect(sortByPriority(items).map((item) => item.id)).toEqual(['ninf', 'a', 'b', 'inf'])
	})

	it('orders fractional priorities', () => {
		const items = [
			{ id: 'a', priority: 0.2 },
			{ id: 'b', priority: 0.1 },
			{ id: 'c', priority: 0.15 },
		]
		expect(sortByPriority(items).map((item) => item.id)).toEqual(['b', 'c', 'a'])
	})

	it('is stable, correct, and non-mutating on a 10,000-item list', () => {
		// Two priority bands interleaved by index: even index → band 1, odd → band 0.
		// Stability must keep each band in original (index) order (NO timing assertion).
		const items = sequence(10000).map((index) => ({ id: index, priority: index % 2 === 0 ? 1 : 0 }))
		const sorted = sortByPriority(items)
		expect(sorted).not.toBe(items) // fresh copy
		expect(sorted).toHaveLength(10000)
		expect(items.map((item) => item.id)).toEqual(sequence(10000)) // input unmutated
		// Band 0 (odd ids) first in ascending order, then band 1 (even ids).
		const odds = sequence(10000).filter((index) => index % 2 === 1)
		const evens = sequence(10000).filter((index) => index % 2 === 0)
		expect(sorted.map((item) => item.id)).toEqual([...odds, ...evens])
	})
})

describe('findDuplicates — empty-string, prototype-name & unicode ids, at scale', () => {
	it('treats an empty-string id like any other', () => {
		expect(findDuplicates([{ id: '' }, { id: '' }, { id: 'a' }])).toEqual([''])
	})

	it('does not pollute on prototype-name ids (Map-keyed, not object-keyed)', () => {
		expect(findDuplicates([{ id: '__proto__' }, { id: '__proto__' }])).toEqual(['__proto__'])
		expect(
			findDuplicates([{ id: 'constructor' }, { id: 'constructor' }, { id: 'toString' }]),
		).toEqual(['constructor'])
		// A single prototype-name id is not a duplicate.
		expect(findDuplicates([{ id: 'hasOwnProperty' }])).toEqual([])
	})

	it('NFC-labile ids are distinct — string identity, no normalization (Å vs Å)', () => {
		// U+212B ANGSTROM SIGN vs U+00C5 LATIN CAPITAL A WITH RING — NFC-equal but !==.
		const angstrom: string = 'Å'
		const aRing: string = 'Å'
		expect(angstrom === aRing).toBe(false)
		expect(findDuplicates([{ id: angstrom }, { id: aRing }])).toEqual([])
		expect(findDuplicates([{ id: angstrom }, { id: angstrom }])).toEqual([angstrom])
	})

	it('reports every adversarial/unicode key as a duplicate when each id repeats', () => {
		const doubled = [...TRICKY_KEYS, ...TRICKY_KEYS].map((id) => ({ id }))
		expect(findDuplicates(doubled)).toEqual([...TRICKY_KEYS])
	})

	it('scans a large list, reporting each duplicate once in first-occurrence order', () => {
		// 5,000 unique ids, then re-append k100 / k50 / k100 — k50 first appears before
		// k100, so first-occurrence order lists k50 ahead of k100.
		const base = sequence(5000).map((index) => ({ id: `k${index}` }))
		const withDupes = [...base, { id: 'k100' }, { id: 'k50' }, { id: 'k100' }]
		expect(findDuplicates(withDupes)).toEqual(['k50', 'k100'])
	})
})

// ── Extracted reasoner helpers ───────────────────────────────────────────────
// The pure-leaf functional core lifted out of the four reasoners' `#private`
// methods: the inferential fact machinery (indexing, term /
// fact keying, unification, instantiation, subject projection), the symbolic
// algebra (variable presence, left / right inversion, operation application),
// the logical conclusion flattening, and the orchestrator's failure-result
// builder. Behavior is byte-identical to the in-class versions except
// `factToKey`'s length-prefixed framing, which closes an injectivity hole where
// an adversarial NUL / delimiter-shaped string term could forge the key.

describe('factToArityKey — predicate+arity bucket key', () => {
	it('gives the same predicate + same arity the same key', () => {
		expect(factToArityKey(createFact('a', 'rel', ['x', 'y']))).toBe(
			factToArityKey(createFact('b', 'rel', [1, 2])),
		)
	})

	it('distinguishes different arities under the same predicate', () => {
		expect(factToArityKey(createFact('a', 'rel', ['x', 'y']))).not.toBe(
			factToArityKey(createFact('b', 'rel', ['x', 'y', 'z'])),
		)
	})

	it('distinguishes different predicates at the same arity', () => {
		expect(factToArityKey(createFact('a', 'human', ['x']))).not.toBe(
			factToArityKey(createFact('b', 'robot', ['x'])),
		)
	})

	it('is INJECTIVE against a forged delimiter — a predicate embedding a space never collides', () => {
		// Under a naive `${predicate} ${arity}` join, predicate "p 2" (arity 2)
		// and predicate "p" (impossible arity "2 2") would both flatten toward
		// "p 2 2" — length-prefixing the predicate keeps them distinct.
		const forged = factToArityKey(createFact('a', 'p 2', ['x', 'y']))
		const other = factToArityKey(createFact('b', 'p', ['x', 'y']))
		expect(forged).not.toBe(other)
		expect(forged).toBe('3:p 2 2')
		expect(other).toBe('1:p 2')
	})
})

describe('indexByArity — buckets facts by predicate+arity', () => {
	it('groups facts under their predicate+arity, preserving append order', () => {
		const facts = [
			createFact('a', 'rel', ['x', 'y']),
			createFact('b', 'rel', ['x', 'y', 'z']),
			createFact('c', 'rel', ['p', 'q']),
		]
		const index = indexByArity(facts)
		expect(
			index.get(factToArityKey(createFact('probe', 'rel', ['?x', '?y'])))?.map((entry) => entry.id),
		).toEqual(['a', 'c'])
		expect(
			index
				.get(factToArityKey(createFact('probe', 'rel', ['?x', '?y', '?z'])))
				?.map((entry) => entry.id),
		).toEqual(['b'])
	})

	it('returns an empty Map for empty input', () => {
		const index = indexByArity([])
		expect(index.size).toBe(0)
	})
})

describe('termToKey — one term dedup key', () => {
	it('typeof-prefixes so a number never collides with its string', () => {
		const identities = new Map<object, number>()
		expect(termToKey(1, identities)).toBe('number:1')
		expect(termToKey('1', identities)).toBe('string:1')
		expect(termToKey(1, identities)).not.toBe(termToKey('1', identities))
	})

	it('folds -0 and +0 to the same key', () => {
		const identities = new Map<object, number>()
		expect(termToKey(-0, identities)).toBe('number:0')
		expect(termToKey(0, identities)).toBe('number:0')
	})

	it('keys NaN self-consistently', () => {
		const identities = new Map<object, number>()
		expect(termToKey(Number.NaN, identities)).toBe('number:NaN')
		expect(termToKey(Number.NaN, identities)).toBe(termToKey(Number.NaN, identities))
	})

	it('keys objects by reference — distinct objects differ, same reference repeats', () => {
		const identities = new Map<object, number>()
		const first = { a: 1 }
		const second = { a: 1 }
		expect(termToKey(first, identities)).toBe('object:#0')
		expect(termToKey(second, identities)).toBe('object:#1')
		expect(termToKey(first, identities)).toBe('object:#0')
	})
})

describe('factToKey — canonical fact dedup key', () => {
	it('equal facts (SameValueZero terms) share a key; confidence is NOT in it', () => {
		const identities = new Map<object, number>()
		expect(factToKey(createFact('a', 'p', ['x'], 1), identities)).toBe(
			factToKey(createFact('b', 'p', ['x'], 0.5), identities),
		)
	})

	it('collapses ±0 and matches NaN terms across facts', () => {
		const identities = new Map<object, number>()
		expect(factToKey(createFact('a', 'p', [-0], 1), identities)).toBe(
			factToKey(createFact('b', 'p', [0], 1), identities),
		)
		expect(factToKey(createFact('a', 'p', [Number.NaN], 1), identities)).toBe(
			factToKey(createFact('b', 'p', [Number.NaN], 1), identities),
		)
	})

	it('distinguishes predicate and arity', () => {
		const identities = new Map<object, number>()
		expect(factToKey(createFact('a', 'p', ['x'], 1), identities)).not.toBe(
			factToKey(createFact('b', 'q', ['x'], 1), identities),
		)
		expect(factToKey(createFact('a', 'p', ['x'], 1), identities)).not.toBe(
			factToKey(createFact('b', 'p', ['x', 'y'], 1), identities),
		)
	})

	it('is INJECTIVE against a forged delimiter — two distinct facts never collide', () => {
		// Under a naive join these two arity-2 facts collide: term keys
		// ['string:a string:b', 'string:c'] and ['string:a', 'string:b string:c']
		// both flatten to 'string:a string:b string:c'. Length-prefixing frames each
		// part so the delimiter cannot be forged.
		const identities = new Map<object, number>()
		const forged = factToKey(createFact('f1', 'likes', ['a string:b', 'c'], 1), identities)
		const other = factToKey(createFact('f2', 'likes', ['a', 'b string:c'], 1), identities)
		expect(forged).not.toBe(other)
	})
})

describe('matchFacts — positional unification', () => {
	it('binds a pattern variable to the candidate term', () => {
		expect(
			matchFacts(
				createFact('p', 'parent', ['?x', 'bob']),
				createFact('f', 'parent', ['alice', 'bob']),
			),
		).toEqual({
			'?x': 'alice',
		})
	})

	it("a '?'-variable binds from EITHER side", () => {
		expect(
			matchFacts(createFact('p', 'parent', ['alice']), createFact('f', 'parent', ['?y'])),
		).toEqual({
			'?y': 'alice',
		})
	})

	it('a constant mismatch fails to unify', () => {
		expect(
			matchFacts(createFact('p', 'parent', ['a']), createFact('f', 'parent', ['b'])),
		).toBeUndefined()
	})

	it('a predicate or arity mismatch fails to unify', () => {
		expect(
			matchFacts(createFact('p', 'parent', ['?x']), createFact('f', 'human', ['x'])),
		).toBeUndefined()
		expect(
			matchFacts(createFact('p', 'parent', ['?x']), createFact('f', 'parent', ['a', 'b'])),
		).toBeUndefined()
	})

	it('enforces binding consistency for a repeated variable', () => {
		expect(
			matchFacts(createFact('p', 'r', ['?x', '?x']), createFact('f', 'r', ['a', 'a'])),
		).toEqual({
			'?x': 'a',
		})
		expect(
			matchFacts(createFact('p', 'r', ['?x', '?x']), createFact('f', 'r', ['a', 'b'])),
		).toBeUndefined()
	})
})

describe('instantiateFact — substitute bound variables', () => {
	it('substitutes bound variables and leaves unbound ones untouched', () => {
		expect(instantiateFact(createFact('c', 'mortal', ['?x']), { '?x': 'socrates' }).terms).toEqual([
			'socrates',
		])
		expect(instantiateFact(createFact('c', 'p', ['?x', '?y']), { '?x': 1 }).terms).toEqual([
			1,
			'?y',
		])
	})

	it('returns a fresh fact and never mutates the input', () => {
		const input = createFact('c', 'p', ['?x'])
		const output = instantiateFact(input, { '?x': 9 })
		expect(output).not.toBe(input)
		expect(input.terms).toEqual(['?x'])
		expect(output.terms).toEqual([9])
	})
})

describe('subjectToFacts — subject field injection', () => {
	it('projects scalar fields into has(k, v) facts, skipping id / null / objects / arrays', () => {
		const injected = subjectToFacts({
			id: 'p1',
			age: 42,
			name: 'bob',
			tags: ['a'],
			addr: {},
			nil: null,
			und: undefined,
		})
		expect(injected.facts).toEqual([
			{ id: 'subject:age', predicate: 'has', terms: ['age', 42], confidence: 1 },
			{ id: 'subject:name', predicate: 'has', terms: ['name', 'bob'], confidence: 1 },
		])
	})

	it('returns the trace lines — a line per field plus a summary count', () => {
		expect(subjectToFacts({ age: 42 }).trace).toEqual([
			'Subject field "age" → has(age, 42)',
			'Injected 1 fact(s) from subject',
		])
	})

	it('injects nothing and traces nothing for an id-only subject', () => {
		const injected = subjectToFacts({ id: 'p1' })
		expect(injected.facts).toEqual([])
		expect(injected.trace).toEqual([])
	})

	it('takes no caller-owned accumulator, so a frozen subject reasons without a mutable input', () => {
		const injected = subjectToFacts(Object.freeze({ id: 'p1', age: 42 }))
		expect(injected.facts).toHaveLength(1)
		expect(injected.trace).toHaveLength(2)
	})
})

describe('findUnboundVariables — conclusion variables absent from every premise', () => {
	it('returns the conclusion variable no premise binds', () => {
		const conclusionFootgun = createInference(
			'i1',
			[createFact('p1', 'human', ['?x'])],
			createFact('c1', 'mortal', ['?x', '?y']),
		)
		expect(findUnboundVariables(conclusionFootgun)).toEqual(['?y'])
		expect(findUnboundVariables(conclusionFootgun)).toEqual(['?y'])
	})

	it('returns empty when every conclusion variable is premise-bound', () => {
		const clean = createInference(
			'i2',
			[createFact('p1', 'human', ['?x'])],
			createFact('c1', 'mortal', ['?x']),
		)
		expect(findUnboundVariables(clean)).toEqual([])
		expect(findUnboundVariables(clean)).toEqual([])
	})

	it('returns empty when the conclusion is fully ground', () => {
		const ground = createInference(
			'i3',
			[createFact('p1', 'human', ['?x'])],
			createFact('c1', 'mortal', ['socrates']),
		)
		expect(findUnboundVariables(ground)).toEqual([])
		expect(findUnboundVariables(ground)).toEqual([])
	})

	it('reports each unbound variable once, in authored order, ignoring non-string terms', () => {
		const multi = createInference(
			'i4',
			[createFact('p1', 'human', ['?x'])],
			createFact('c1', 'triple', ['?y', '?z', '?y', 42, '?z']),
		)
		expect(findUnboundVariables(multi)).toEqual(['?y', '?z'])
		expect(findUnboundVariables(multi)).toEqual(['?y', '?z'])
	})
})

describe('containsVariable — unbound variable presence', () => {
	it('finds the target variable', () => {
		expect(containsVariable(createVariable('x'), 'x', {})).toBe(true)
		expect(containsVariable(createVariable('y'), 'x', {})).toBe(false)
	})

	it('does NOT count a pre-bound target', () => {
		expect(containsVariable(createVariable('x'), 'x', { x: 5 })).toBe(false)
	})

	it('recurses into nested operations (constants never match)', () => {
		const expression = createOperation(
			'add',
			createOperation('multiply', createConstant(2), createVariable('x')),
			createConstant(1),
		)
		expect(containsVariable(expression, 'x', {})).toBe(true)
		expect(containsVariable(expression, 'y', {})).toBe(false)
		expect(containsVariable(createConstant(3), 'x', {})).toBe(false)
	})
})

describe('invertLeft — solve x op right = value for x', () => {
	it('inverts each invertible operation', () => {
		expect(invertLeft('add', 10, 3)).toBe(7)
		expect(invertLeft('subtract', 7, 3)).toBe(10)
		expect(invertLeft('multiply', 10, 2)).toBe(5)
		expect(invertLeft('divide', 5, 2)).toBe(10)
	})

	it('yields NaN on a zero-division inverse', () => {
		expect(invertLeft('multiply', 10, 0)).toBeNaN()
		expect(invertLeft('divide', 5, 0)).toBeNaN()
	})

	it('throws ReasonError("OPERATOR") on a non-invertible operation', () => {
		const error = captureError(() => invertLeft('power', 8, 3))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('OPERATOR')
		expect(error.context).toEqual({ operator: 'power' })
	})
})

describe('invertRight — solve left op x = value for x', () => {
	it('inverts each invertible operation', () => {
		expect(invertRight('add', 10, 3)).toBe(7)
		expect(invertRight('subtract', 4, 10)).toBe(6)
		expect(invertRight('multiply', 10, 2)).toBe(5)
		expect(invertRight('divide', 5, 10)).toBe(2)
	})

	it('yields NaN on a zero-division inverse', () => {
		expect(invertRight('multiply', 10, 0)).toBeNaN()
		// `left / x = 0` (value 0) has no finite solution — NaN.
		expect(invertRight('divide', 0, 10)).toBeNaN()
	})

	it('throws ReasonError("OPERATOR") on a non-invertible operation', () => {
		const error = captureError(() => invertRight('abs', 8, 3))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('OPERATOR')
		expect(error.context).toEqual({ operator: 'abs' })
	})
})

describe('applyOperation — evaluated-operand arithmetic', () => {
	it('applies each operation exactly', () => {
		expect(applyOperation('add', 2, 3)).toBe(5)
		expect(applyOperation('subtract', 5, 2)).toBe(3)
		expect(applyOperation('multiply', 2, 3)).toBe(6)
		expect(applyOperation('divide', 6, 2)).toBe(3)
		expect(applyOperation('power', 2, 3)).toBe(8)
		expect(applyOperation('minimum', 2, 3)).toBe(2)
		expect(applyOperation('maximum', 2, 3)).toBe(3)
		expect(applyOperation('average', 2, 4)).toBe(3)
		expect(applyOperation('percentage', 200, 10)).toBe(20)
		expect(applyOperation('round', 2.5, 0)).toBe(3)
		expect(applyOperation('ceil', 2.1, 0)).toBe(3)
		expect(applyOperation('floor', 2.9, 0)).toBe(2)
		expect(applyOperation('abs', -5, 0)).toBe(5)
	})

	it('divide-by-zero is NaN', () => {
		expect(applyOperation('divide', 1, 0)).toBeNaN()
	})

	it('an unknown operator throws ReasonError("OPERATOR")', () => {
		const error = captureError(() => applyOperation('bogus', 1, 2))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('OPERATOR')
		expect(error.context).toEqual({ operator: 'bogus' })
	})
})

describe('resolveOperand — the absent-operand default per operation', () => {
	const IDENTITY_ONE: readonly MathOperation[] = ['multiply', 'divide', 'power']
	const IDENTITY_ZERO: readonly MathOperation[] = [
		'add',
		'subtract',
		'percentage',
		'minimum',
		'maximum',
		'average',
		'round',
		'ceil',
		'floor',
		'abs',
	]

	it('defaults multiply / divide / power to the multiplicative identity', () => {
		for (const operation of IDENTITY_ONE) expect(resolveOperand(operation)).toBe(1)
	})

	it('defaults every other operation to the additive identity', () => {
		for (const operation of IDENTITY_ZERO) expect(resolveOperand(operation)).toBe(0)
	})

	it('returns the supplied operand for every operation, defaults never consulted', () => {
		for (const operation of [...IDENTITY_ONE, ...IDENTITY_ZERO]) {
			expect(resolveOperand(operation, 7)).toBe(7)
			expect(resolveOperand(operation, 0)).toBe(0)
			expect(resolveOperand(operation, -3.5)).toBe(-3.5)
		}
	})

	it('names only operations the MathOperation guard accepts', () => {
		expect(
			[...IDENTITY_ONE, ...IDENTITY_ZERO].filter((operation) => !isMathOperation(operation)),
		).toEqual([])
	})
})

describe('matchesBounds — the between / outside range test', () => {
	it('is inclusive on both ends', () => {
		expect(matchesBounds(1, [1, 10])).toBe(true)
		expect(matchesBounds(10, [1, 10])).toBe(true)
		expect(matchesBounds(5, [1, 10])).toBe(true)
		expect(matchesBounds(11, [1, 10])).toBe(false)
	})

	it('reads only the first two range elements', () => {
		expect(matchesBounds(5, [1, 10, 0])).toBe(true)
	})

	it('reports false for a non-numeric value or a malformed range', () => {
		expect(matchesBounds('5', [1, 10])).toBe(false)
		expect(matchesBounds(5, [1])).toBe(false)
		expect(matchesBounds(5, 'range')).toBe(false)
		expect(matchesBounds(5, ['1', '10'])).toBe(false)
	})
})

describe('emptyAggregate — the empty-input identity per aggregation', () => {
	it('yields the additive, multiplicative, and no-data identities', () => {
		expect(emptyAggregate('sum')).toBe(0)
		expect(emptyAggregate('average')).toBe(0)
		expect(emptyAggregate('product')).toBe(1)
		expect(emptyAggregate('minimum')).toBeNaN()
		expect(emptyAggregate('maximum')).toBeNaN()
	})

	it('yields 0 for an unknown aggregation from an untrusted definition', () => {
		expect(invokeUnchecked<number>(undefined, emptyAggregate, ['median'])).toBe(0)
	})
})

describe('resolveSource — one factor source against a subject', () => {
	it('passes a static value through', () => {
		expect(resolveSource(createStaticSource(42), {})).toBe(42)
	})

	it('coerces a field source and falls back when unresolvable', () => {
		expect(resolveSource(createFieldSource('age'), { age: 30 })).toBe(30)
		expect(resolveSource(createFieldSource('age'), { age: 'old' }, 7)).toBe(7)
		expect(resolveSource(createFieldSource('age'), {})).toBeUndefined()
	})

	it('reads only OWN lookup table keys, and falls back on a missing field', () => {
		const source = createLookupSource('state', { CA: 5 })
		expect(resolveSource(source, { state: 'CA' })).toBe(5)
		expect(resolveSource(source, { state: 'NY' }, 1)).toBe(1)
		expect(resolveSource(source, { state: null }, 1)).toBe(1)
		expect(resolveSource(source, { state: 'toString' }, 1)).toBe(1)
	})

	it('scans range bands in order and takes the first match', () => {
		const source = createRangeSource('age', [
			{ bounds: createBounds(undefined, 24), value: 30 },
			{ bounds: createBounds(25, 64), value: 15 },
			{ value: 1 },
		])
		expect(resolveSource(source, { age: 20 })).toBe(30)
		expect(resolveSource(source, { age: 40 })).toBe(15)
		expect(resolveSource(source, { age: 90 })).toBe(1)
		expect(resolveSource(source, {}, 0)).toBe(0)
	})

	it('takes the fallback for a factor carrying no source at all', () => {
		expect(invokeUnchecked<number | undefined>(undefined, resolveSource, [undefined, {}, 3])).toBe(
			3,
		)
	})
})

describe("computePremiseConfidence — the matched premises' confidence product", () => {
	it("multiplies the FIRST matching fact's confidence per premise", () => {
		const index = indexByArity([
			createFact('f1', 'human', ['socrates'], 0.5),
			createFact('f2', 'wise', ['socrates'], 0.4),
		])
		const premises = [createFact('p1', 'human', ['?x']), createFact('p2', 'wise', ['?x'])]
		expect(computePremiseConfidence(premises, index, {})).toBeCloseTo(0.2, 10)
	})

	it('contributes nothing for a premise with no match, and yields 1 for none', () => {
		const index = indexByArity([createFact('f1', 'human', ['socrates'], 0.5)])
		expect(computePremiseConfidence([createFact('p1', 'alive', ['?x'])], index, {})).toBe(1)
		expect(computePremiseConfidence([], index, {})).toBe(1)
	})

	it('instantiates each premise under the supplied bindings', () => {
		const index = indexByArity([
			createFact('f1', 'human', ['socrates'], 0.5),
			createFact('f2', 'human', ['plato'], 0.25),
		])
		const premises = [createFact('p1', 'human', ['?x'])]
		expect(computePremiseConfidence(premises, index, { '?x': 'plato' })).toBe(0.25)
	})
})

describe('definitionToEnvelope — the scalar projection of a definition', () => {
	it("drops each kind's collections and keeps its scalars", () => {
		const quantitative = definitionToEnvelope(createQuantitativeDefinition('risk', 'Risk', []))
		expect('groups' in quantitative).toBe(false)
		expect(quantitative).toEqual({
			reasoning: 'quantitative',
			id: 'risk',
			name: 'Risk',
			aggregation: 'sum',
		})

		expect('rules' in definitionToEnvelope(createLogicalDefinition('e', 'E', []))).toBe(false)

		const symbolic = definitionToEnvelope(createSymbolicDefinition('s', 'S', []))
		expect('equations' in symbolic).toBe(false)
		expect('variables' in symbolic).toBe(false)

		const inferential = definitionToEnvelope(createInferentialDefinition('m', 'M', [], []))
		expect('facts' in inferential).toBe(false)
		expect('inferences' in inferential).toBe(false)
	})

	it('never mutates its input', () => {
		const definition = deepFreeze(createLogicalDefinition('e', 'E', []))
		definitionToEnvelope(definition)
		expect(definition.rules).toEqual([])
	})
})

describe('extractAtoms — atom leaves of an expression tree', () => {
	it('returns the atom itself for an atom leaf', () => {
		const leaf = createAtom('adult', 'equals', true)
		expect(extractAtoms(leaf)).toEqual([leaf])
	})

	it('flattens a compound into its operands depth-first, left-to-right', () => {
		const first = createAtom('a', 'equals', 1)
		const second = createAtom('b', 'equals', 2)
		expect(extractAtoms(createCompound('and', [first, second]))).toEqual([first, second])
	})

	it('recurses through nested compounds preserving authored order', () => {
		const a = createAtom('a', 'equals', 1)
		const b = createAtom('b', 'equals', 2)
		const c = createAtom('c', 'equals', 3)
		expect(extractAtoms(createCompound('or', [createCompound('and', [a, b]), c]))).toEqual([
			a,
			b,
			c,
		])
	})

	it('flattens a 500-deep single-operand compound to its one leaf', () => {
		let expression = createAtom('leaf', 'equals', true)
		for (let depth = 0; depth < 500; depth += 1) expression = createCompound('and', [expression])
		expect(extractAtoms(expression)).toEqual([createAtom('leaf', 'equals', true)])
	})

	it('returns no atoms for a compound with empty operands', () => {
		expect(extractAtoms(createCompound('and', []))).toEqual([])
	})
})

describe('extractConclusions — flatten a logical conclusion', () => {
	it('asserts an atom as its formatField(field) = value pair', () => {
		expect(extractConclusions(createAtom('adult', 'equals', true))).toEqual({
			[formatField('adult')]: true,
		})
	})

	it('asserts EVERY atom even under not / or', () => {
		expect(
			extractConclusions(
				createCompound('or', [createAtom('a', 'equals', 1), createAtom('b', 'equals', 2)]),
			),
		).toEqual({
			a: 1,
			b: 2,
		})
		expect(extractConclusions(createCompound('not', [createAtom('x', 'equals', 5)]))).toEqual({
			x: 5,
		})
	})

	it('a later operand WINS a key clash', () => {
		expect(
			extractConclusions(
				createCompound('and', [createAtom('k', 'equals', 1), createAtom('k', 'equals', 2)]),
			),
		).toEqual({ k: 2 })
	})

	it('an array field path flattens to its dot-joined key', () => {
		expect(extractConclusions(createAtom(['a', 'b'], 'equals', 7))).toEqual({
			[formatField(['a', 'b'])]: 7,
		})
	})
})

describe('findOverlayMismatches — cross-rule array-path overlay-key collision', () => {
	it('flags an array-path conclusion whose key is also read through an array-path premise', () => {
		const mismatched = [
			createRule('a', [], createAtom(['address', 'city'], 'equals', 'NYC')),
			createRule(
				'b',
				[createAtom(['address', 'city'], 'equals', 'NYC')],
				createAtom('eligible', 'equals', true),
			),
		]
		expect(findOverlayMismatches(mismatched)).toEqual(['address.city'])
		expect(findOverlayMismatches(mismatched)).toEqual(['address.city'])
	})

	it('stays silent when the reading premise uses the dotted-string form instead', () => {
		const safe = [
			createRule('a', [], createAtom(['address', 'city'], 'equals', 'NYC')),
			createRule(
				'b',
				[createAtom('address.city', 'equals', 'NYC')],
				createAtom('eligible', 'equals', true),
			),
		]
		expect(findOverlayMismatches(safe)).toEqual([])
		expect(findOverlayMismatches(safe)).toEqual([])
	})

	it('stays silent when every field is a plain string (no array paths anywhere)', () => {
		const allString = [
			createRule('a', [], createAtom('adult', 'equals', true)),
			createRule(
				'b',
				[createAtom('adult', 'equals', true)],
				createAtom('eligible', 'equals', true),
			),
		]
		expect(findOverlayMismatches(allString)).toEqual([])
		expect(findOverlayMismatches(allString)).toEqual([])
	})

	it('stays silent when the array-path conclusion key is never read by any premise', () => {
		const unread = [
			createRule('a', [], createAtom(['address', 'city'], 'equals', 'NYC')),
			createRule(
				'b',
				[createAtom('unrelated', 'equals', true)],
				createAtom('eligible', 'equals', true),
			),
		]
		expect(findOverlayMismatches(unread)).toEqual([])
	})

	it('returns each mismatched key once, in authored order, across many rules', () => {
		const rules = [
			createRule('a', [], createAtom(['x', 'y'], 'equals', 1)),
			createRule('b', [], createAtom(['p', 'q'], 'equals', 2)),
			createRule('c', [createAtom(['x', 'y'], 'equals', 1)], createAtom('c1', 'equals', true)),
			createRule('d', [createAtom(['x', 'y'], 'equals', 1)], createAtom('c2', 'equals', true)),
			createRule('e', [createAtom(['p', 'q'], 'equals', 2)], createAtom('c3', 'equals', true)),
		]
		expect(findOverlayMismatches(rules)).toEqual(['x.y', 'p.q'])
	})
})

describe('buildErrorResult — empty type-shaped failure result', () => {
	it('builds the quantitative failure shape', () => {
		expect(buildErrorResult(createQuantitativeDefinition('q', 'Q', []), 'boom')).toEqual({
			reasoning: 'quantitative',
			value: 0,
			groups: [],
			count: 0,
			success: false,
			trace: [],
			errors: ['boom'],
		})
	})

	it('builds the logical failure shape', () => {
		expect(buildErrorResult(createLogicalDefinition('l', 'L', []), 'boom')).toEqual({
			reasoning: 'logical',
			conclusion: false,
			rules: [],
			count: 0,
			success: false,
			trace: [],
			errors: ['boom'],
		})
	})

	it('builds the symbolic failure shape', () => {
		expect(buildErrorResult(createSymbolicDefinition('s', 'S', []), 'boom')).toEqual({
			reasoning: 'symbolic',
			solutions: {},
			success: false,
			trace: [],
			errors: ['boom'],
		})
	})

	it('builds the inferential failure shape', () => {
		expect(buildErrorResult(createInferentialDefinition('i', 'I', [], []), 'boom')).toEqual({
			reasoning: 'inferential',
			derived: [],
			success: false,
			trace: [],
			errors: ['boom'],
		})
	})
})

// ── Sparse terms, enumeration order & totality at depth ─────────────────────
// Sparse fact terms densify (a hole keys/unifies identically to an explicit
// `undefined` element, never throwing), the `Object.keys` integer-index-first
// enumeration order surfaces through `subjectToFacts` while `findDuplicates`
// stays pure Map-insertion order, and the iterative walks (`extractAtoms` /
// `containsVariable`) stay total across 10,000-deep expression trees.

describe('matchFacts / instantiateFact — sparse fact terms', () => {
	it('hole-vs-hole positions unify (both read undefined), never throwing', () => {
		const pattern = createFact('p', 'r', sparse(3, [[0, 'a']]))
		const candidate = createFact('f', 'r', sparse(3, [[0, 'a']]))
		expect(() => matchFacts(pattern, candidate)).not.toThrow()
		expect(matchFacts(pattern, candidate)).toEqual({})
	})

	it('hole-vs-value fails to unify (never throws)', () => {
		const pattern = createFact('p', 'r', sparse(2, [[0, 'a']]))
		const candidate = createFact(
			'f',
			'r',
			sparse(2, [
				[0, 'a'],
				[1, 'x'],
			]),
		)
		expect(() => matchFacts(pattern, candidate)).not.toThrow()
		expect(matchFacts(pattern, candidate)).toBeUndefined()
	})

	it('instantiateFact preserves holes and returns a fresh, unmutated fact', () => {
		const terms = sparse(3, [
			[0, 'a'],
			[2, 'c'],
		])
		const input = createFact('c', 'p', terms)
		const output = instantiateFact(input, {})
		expect(output).not.toBe(input)
		expect(output.terms).not.toBe(input.terms)
		expect(1 in output.terms).toBe(false)
		expect(output.terms[0]).toBe('a')
		expect(output.terms[2]).toBe('c')
		expect(1 in input.terms).toBe(false)
	})
})

describe('factToKey — sparse fact terms densify', () => {
	it('a sparse term keys IDENTICALLY to an explicit undefined element', () => {
		const identities = new Map<object, number>()
		const sparseKey = factToKey(
			createFact(
				'a',
				'p',
				sparse(3, [
					[0, 'x'],
					[2, 'z'],
				]),
			),
			identities,
		)
		const denseKey = factToKey(createFact('b', 'p', ['x', undefined, 'z']), identities)
		expect(sparseKey).toBe(denseKey)
	})

	it('arity/length still counts holes toward the key', () => {
		const identities = new Map<object, number>()
		const twoHoles = factToKey(createFact('a', 'p', sparse(2, [[0, 'x']])), identities)
		const threeHoles = factToKey(createFact('b', 'p', sparse(3, [[0, 'x']])), identities)
		expect(twoHoles).not.toBe(threeHoles)
	})

	it('same-shape sparse terms dedupe to the same key', () => {
		const identities = new Map<object, number>()
		const first = factToKey(
			createFact(
				'a',
				'p',
				sparse(3, [
					[0, 'x'],
					[2, 'y'],
				]),
			),
			identities,
		)
		const second = factToKey(
			createFact(
				'b',
				'p',
				sparse(3, [
					[0, 'x'],
					[2, 'y'],
				]),
			),
			identities,
		)
		expect(first).toBe(second)
	})
})

describe('extractAtoms — sparse compound operands', () => {
	it('skips holes in a sparse operands array, pinning the exact atom list', () => {
		const first = createAtom('a', 'equals', 1)
		const second = createAtom('c', 'equals', 3)
		const operands = sparse(3, [
			[0, first],
			[2, second],
		])
		expect(extractAtoms(createCompound('and', operands))).toEqual([first, second])
	})
})

describe('subjectToFacts — enumeration order (integer-like keys first)', () => {
	it('orders integer-like keys ascending, then string keys insertion-ordered, id skipped', () => {
		const run = () => subjectToFacts(INTEGER_KEY_SUBJECT).facts
		const expected = [
			{ id: 'subject:1', predicate: 'has', terms: ['1', 1], confidence: 1 },
			{ id: 'subject:2', predicate: 'has', terms: ['2', 2], confidence: 1 },
			{ id: 'subject:10', predicate: 'has', terms: ['10', 10], confidence: 1 },
			{ id: 'subject:zeta', predicate: 'has', terms: ['zeta', 26], confidence: 1 },
			{ id: 'subject:alpha', predicate: 'has', terms: ['alpha', 1], confidence: 1 },
		]
		const first = run()
		const second = run()
		expect(first).toEqual(expected)
		expect(second).toEqual(expected)
		expect(first).toEqual(second)
	})
})

describe('subjectToFacts — ADVERSARIAL_VALUE_SUBJECT (symbol key, bigint/symbol/function values)', () => {
	it('silently skips the symbol KEY, keeping bigint/symbol/function VALUES', () => {
		const facts = subjectToFacts(ADVERSARIAL_VALUE_SUBJECT).facts
		expect(facts).toHaveLength(3)

		expect(facts[0]).toEqual({
			id: 'subject:big',
			predicate: 'has',
			terms: ['big', 9007199254740993n],
			confidence: 1,
		})

		expect(facts[1]?.id).toBe('subject:sym')
		expect(facts[1]?.terms[0]).toBe('sym')
		expect(facts[1]?.terms[1]).toBe(ADVERSARIAL_VALUE_SUBJECT.sym)

		expect(facts[2]?.id).toBe('subject:fn')
		expect(facts[2]?.terms[0]).toBe('fn')
		expect(facts[2]?.terms[1]).toBe(ADVERSARIAL_VALUE_SUBJECT.fn)
		expect(typeof facts[2]?.terms[1]).toBe('function')
	})
})

describe('findDuplicates — integer-like strings mixed with TRICKY_KEYS (Map insertion order)', () => {
	it('pins first-occurrence order — no numeric reordering (unlike Object.keys)', () => {
		const run = () =>
			findDuplicates(
				['10', '__proto__', '2', '10', 'constructor', '__proto__', '1'].map((id) => ({ id })),
			)
		const expected = ['10', '__proto__']
		expect(run()).toEqual(expected)
		expect(run()).toEqual(expected)
	})

	it('mixes every TRICKY_KEYS value with integer-like ids, first-occurrence order preserved', () => {
		const ids = [...TRICKY_KEYS, '9', '3', ...TRICKY_KEYS]
		const run = () => findDuplicates(ids.map((id) => ({ id })))
		const expected = [...TRICKY_KEYS]
		expect(run()).toEqual(expected)
		expect(run()).toEqual(expected)
	})
})

describe('extractConclusions — Object.entries-derived order (integer-like keys reorder)', () => {
	it('final object surfaces integer-like keys ascending first, then string insertion order', () => {
		const expression = createCompound('and', [
			createAtom('b', 'equals', 1),
			createAtom('10', 'equals', 10),
			createAtom('2', 'equals', 2),
			createAtom('a', 'equals', 9),
		])
		const result = extractConclusions(expression)
		expect(Object.entries(result)).toEqual([
			['2', 2],
			['10', 10],
			['b', 1],
			['a', 9],
		])
	})
})

describe('roundTo — additional unit pins', () => {
	it('roundTo(-2.5, 0) is -2 (Math.round half toward +∞)', () => {
		expect(roundTo(-2.5, 0)).toBe(-2)
	})

	it('a negative precision rounds a half at the hundreds scale toward +∞', () => {
		expect(roundTo(-450, -2)).toBe(-400)
	})

	it('-0 in gives -0 out at a negative precision (Object.is)', () => {
		expect(Object.is(roundTo(-0, -1), -0)).toBe(true)
	})

	it('Infinity and NaN pass through unchanged', () => {
		expect(roundTo(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY)
		expect(roundTo(Number.NEGATIVE_INFINITY, 2)).toBe(Number.NEGATIVE_INFINITY)
		expect(roundTo(Number.NaN, 2)).toBeNaN()
	})

	it('extreme precision (400 / -400) passes the value through unchanged', () => {
		expect(roundTo(7, 400)).toBe(7)
		expect(roundTo(99, -400)).toBe(99)
	})

	it('a huge finite value whose value*factor overflows resolves to the ACTUAL observed result', () => {
		// factor = 10^10 is finite (no passthrough), but 1e300 * 1e10 overflows to
		// Infinity before the divide — the guard checks the FACTOR, not the product.
		expect(roundTo(1e300, 10)).toBe(Number.POSITIVE_INFINITY)
	})
})

describe('extractAtoms / containsVariable — totality at 10,000-deep nesting', () => {
	it('extractAtoms(deepCompound(10000, atom)) returns exactly that one atom, twice', () => {
		const leaf = createAtom('leaf', 'equals', true)
		const expression = deepCompound(10000, leaf)
		expect(() => extractAtoms(expression)).not.toThrow()
		const first = extractAtoms(expression)
		const second = extractAtoms(expression)
		expect(first).toEqual([leaf])
		expect(second).toEqual([leaf])
		expect(first).toEqual(second)
	})

	it('containsVariable over a 10,000-deep addition finds a present name, misses an absent one, twice', () => {
		const expression = deepAddition(10000, createVariable('x'), createConstant(1))
		const run = () => ({
			present: containsVariable(expression, 'x', {}),
			absent: containsVariable(expression, 'y', {}),
		})
		const first = run()
		const second = run()
		expect(first).toEqual({ present: true, absent: false })
		expect(second).toEqual({ present: true, absent: false })
		expect(first).toEqual(second)
	})
})

// === Definitions & subjects capability layer ================================

interface Item {
	readonly id: string
	readonly v?: number
}

describe('appendById / prependById — dedup-then-insert primitives', () => {
	it('appendById dedups an existing id and inserts at the end', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }, { id: 'b' }])
		const run = () => appendById(items, { id: 'a', v: 9 })
		const expected = [{ id: 'b' }, { id: 'a', v: 9 }]
		expect(run()).toEqual(expected)
		expect(run()).toEqual(expected)
		expect(items).toEqual([{ id: 'a' }, { id: 'b' }]) // input untouched
	})

	it('appendById with a target inserts immediately after it', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }, { id: 'b' }])
		const run = () => appendById(items, { id: 'c' }, 'a').map((item) => item.id)
		const expected = ['a', 'c', 'b']
		expect(run()).toEqual(expected)
		expect(run()).toEqual(expected)
	})

	it('appendById throws ReasonError("TARGET") when target names no element', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }])
		const error = captureError(() => appendById(items, { id: 'b' }, 'missing'))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
		expect(error.context).toEqual({ id: 'b', target: 'missing', collection: 'items' })
	})

	it('prependById dedups an existing id and inserts at the start', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }, { id: 'b' }])
		const run = () => prependById(items, { id: 'b', v: 9 }).map((item) => item.id)
		const expected = ['b', 'a']
		expect(run()).toEqual(expected)
		expect(run()).toEqual(expected)
	})

	it('prependById with a target inserts immediately before it', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }, { id: 'b' }])
		const run = () => prependById(items, { id: 'c' }, 'b').map((item) => item.id)
		const expected = ['a', 'c', 'b']
		expect(run()).toEqual(expected)
		expect(run()).toEqual(expected)
	})

	it('prependById throws ReasonError("TARGET") when target names no element', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }])
		const error = captureError(() => prependById(items, { id: 'b' }, 'missing'))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})

	it('appendById over a sparse array skips holes (hostile input)', () => {
		const items = sparse<Item>(3, [[1, { id: 'a' }]])
		const appendByIdRaw = (...args: never[]): readonly Item[] => {
			const existing = args[0]
			const item = args[1]
			if (existing === undefined || item === undefined) throw new Error('expected items')
			return appendById<Item>(existing, item)
		}
		const result = invokeUnchecked<readonly Item[]>(undefined, appendByIdRaw, [items, { id: 'z' }])
		expect(result.map((item) => item.id)).toEqual(['a', 'z'])
	})
})

describe('replaceById / removeById — position-preserving swap & filter', () => {
	it('replaceById swaps the same-id element in place, preserving position', () => {
		const items = deepFreeze<readonly Item[]>([
			{ id: 'a', v: 1 },
			{ id: 'b', v: 2 },
		])
		const run = () => replaceById(items, { id: 'a', v: 9 })
		const expected = [
			{ id: 'a', v: 9 },
			{ id: 'b', v: 2 },
		]
		expect(run()).toEqual(expected)
		expect(run()).toEqual(expected)
	})

	it('replaceById appends when no same-id element exists', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }])
		expect(replaceById(items, { id: 'z' })).toEqual([{ id: 'a' }, { id: 'z' }])
	})

	it('removeById filters out every same-id element, never throwing', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }, { id: 'b' }])
		const run = () => removeById(items, 'a')
		expect(run()).toEqual([{ id: 'b' }])
		expect(run()).toEqual([{ id: 'b' }])
	})

	it('removeById is a same-length no-op copy when the id is absent', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }])
		const result = removeById(items, 'missing')
		expect(result).toEqual([{ id: 'a' }])
		expect(result).not.toBe(items)
	})

	it('removeById over a sparse array with adversarial ids never throws', () => {
		const items = sparse<Item>(4, [
			[1, { id: TRICKY_KEYS[0] ?? '__proto__' }],
			[3, { id: 'b' }],
		])
		const removeByIdRaw = (...args: never[]): readonly Item[] => {
			const existing = args[0]
			const id = args[1]
			if (existing === undefined || id === undefined) throw new Error('expected items and id')
			return removeById<Item>(existing, id)
		}
		expect(() => invokeUnchecked(undefined, removeByIdRaw, [items, 'nope'])).not.toThrow()
	})
})

describe('mergeById — incoming-order-first upsert with base-only survivors', () => {
	it('matched ids resolve through the default (incoming-wins-wholesale), unmatched incoming leads', () => {
		const base = deepFreeze<readonly Item[]>([
			{ id: 'a', v: 1 },
			{ id: 'b', v: 2 },
		])
		const incoming = deepFreeze<readonly Item[]>([
			{ id: 'c', v: 3 },
			{ id: 'a', v: 9 },
		])
		const run = () => mergeById(base, incoming)
		const expected = [
			{ id: 'c', v: 3 },
			{ id: 'a', v: 9 },
			{ id: 'b', v: 2 },
		]
		expect(run()).toEqual(expected)
		expect(run()).toEqual(expected)
	})

	it('a resolve callback reconciles a matched pair instead of incoming-wins-wholesale', () => {
		const base = deepFreeze<readonly Item[]>([{ id: 'a', v: 1 }])
		const incoming = deepFreeze<readonly Item[]>([{ id: 'a', v: 2 }])
		const merged = mergeById(base, incoming, (left, right) => ({
			id: left.id,
			v: (left.v ?? 0) + (right.v ?? 0),
		}))
		expect(merged).toEqual([{ id: 'a', v: 3 }])
	})

	it('dedups same-id twins within either input to their first occurrence', () => {
		const base = deepFreeze<readonly Item[]>([
			{ id: 'a', v: 1 },
			{ id: 'a', v: 99 },
		])
		const incoming = deepFreeze<readonly Item[]>([
			{ id: 'b', v: 1 },
			{ id: 'b', v: 99 },
		])
		expect(mergeById(base, incoming)).toEqual([
			{ id: 'b', v: 1 },
			{ id: 'a', v: 1 },
		])
	})
})

describe('quantitative change/extend helpers — appendGroup / prependGroup / replaceGroup / removeGroup / appendFactor / prependFactor / replaceFactor / removeFactor', () => {
	it('appendGroup / prependGroup / replaceGroup / removeGroup round-trip on a QuantitativeDefinition', () => {
		const definition = deepFreeze(
			createQuantitativeDefinition('risk', 'Risk', [createFactorGroup('g1', 'sum', [])]),
		)
		const appended = appendGroup(definition, createFactorGroup('g2', 'sum', []))
		expect(appended.groups.map((g) => g.id)).toEqual(['g1', 'g2'])

		const prepended = prependGroup(definition, createFactorGroup('g0', 'sum', []))
		expect(prepended.groups.map((g) => g.id)).toEqual(['g0', 'g1'])

		const replaced = replaceGroup(definition, createFactorGroup('g1', 'product', []))
		expect(replaced.groups).toEqual([createFactorGroup('g1', 'product', [])])

		expect(removeGroup(definition, 'g1').groups).toEqual([])
		expect(definition.groups).toEqual([createFactorGroup('g1', 'sum', [])]) // input untouched
	})

	it('appendGroup with a missing target throws ReasonError("TARGET")', () => {
		const definition = deepFreeze(createQuantitativeDefinition('risk', 'Risk', []))
		const error = captureError(() =>
			appendGroup(definition, createFactorGroup('g1', 'sum', []), 'missing'),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})

	it('appendFactor / prependFactor / replaceFactor / removeFactor round-trip on a FactorGroup, and compose with appendGroup', () => {
		const group = deepFreeze(createFactorGroup('g1', 'sum', [createStaticFactor('f1', 10)]))
		const appended = appendFactor(group, createStaticFactor('f2', 20))
		expect(appended.factors.map((f) => f.id)).toEqual(['f1', 'f2'])

		const prepended = prependFactor(group, createStaticFactor('f0', 5))
		expect(prepended.factors.map((f) => f.id)).toEqual(['f0', 'f1'])

		const replaced = replaceFactor(group, createStaticFactor('f1', 99))
		expect(replaced.factors).toEqual([createStaticFactor('f1', 99)])

		expect(removeFactor(group, 'f1').factors).toEqual([])

		const definition = createQuantitativeDefinition('risk', 'Risk', [])
		const composed = appendGroup(
			definition,
			appendFactor(createFactorGroup('g1', 'sum', []), createStaticFactor('f1', 1)),
		)
		expect(composed.groups[0]?.factors.map((f) => f.id)).toEqual(['f1'])
	})

	it('appendFactor with a missing target throws ReasonError("TARGET")', () => {
		const group = deepFreeze(createFactorGroup('g1', 'sum', []))
		const error = captureError(() => appendFactor(group, createStaticFactor('f1', 1), 'missing'))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})
})

describe('logical change/extend helpers — appendRule / prependRule / replaceRule / removeRule', () => {
	const r1 = createRule('r1', [], createAtom('a', 'equals', true))

	it('round-trips on a LogicalDefinition, and appendRule without a target becomes the new last rule', () => {
		const definition = deepFreeze(createLogicalDefinition('e', 'E', [r1]))
		const r2 = createRule('r2', [], createAtom('b', 'equals', true))

		const appended = appendRule(definition, r2)
		expect(appended.rules.map((rr) => rr.id)).toEqual(['r1', 'r2']) // r2 is now the forward conclusion

		const prepended = prependRule(definition, r2)
		expect(prepended.rules.map((rr) => rr.id)).toEqual(['r2', 'r1'])

		const replaced = replaceRule(definition, createRule('r1', [], createAtom('a', 'equals', false)))
		expect(replaced.rules).toEqual([createRule('r1', [], createAtom('a', 'equals', false))])

		expect(removeRule(definition, 'r1').rules).toEqual([])
		expect(definition.rules).toEqual([r1]) // input untouched
	})

	it('appendRule with a missing target throws ReasonError("TARGET")', () => {
		const definition = deepFreeze(createLogicalDefinition('e', 'E', [r1]))
		const error = captureError(() =>
			appendRule(definition, createRule('r2', [], createAtom('b', 'equals', true)), 'missing'),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})
})

describe('symbolic change/extend helpers — appendEquation / prependEquation / replaceEquation / removeEquation / addVariable / removeVariable', () => {
	const e1 = createEquation('e1', createVariable('x'), createConstant(1), 'x')

	it('round-trips on a SymbolicDefinition', () => {
		const definition = deepFreeze(createSymbolicDefinition('s', 'S', [e1]))
		const e2 = createEquation('e2', createVariable('y'), createConstant(2), 'y')

		const appended = appendEquation(definition, e2)
		expect(appended.equations.map((eq) => eq.id)).toEqual(['e1', 'e2'])

		const prepended = prependEquation(definition, e2)
		expect(prepended.equations.map((eq) => eq.id)).toEqual(['e2', 'e1'])

		const replaced = replaceEquation(
			definition,
			createEquation('e1', createVariable('x'), createConstant(9), 'x'),
		)
		expect(replaced.equations).toEqual([
			createEquation('e1', createVariable('x'), createConstant(9), 'x'),
		])

		expect(removeEquation(definition, 'e1').equations).toEqual([])
		expect(definition.equations).toEqual([e1]) // input untouched
	})

	it('appendEquation with a missing target throws ReasonError("TARGET")', () => {
		const definition = deepFreeze(createSymbolicDefinition('s', 'S', [e1]))
		const error = captureError(() =>
			appendEquation(
				definition,
				createEquation('e2', createVariable('y'), createConstant(2), 'y'),
				'missing',
			),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})

	it('addVariable upserts, removeVariable omits the key entirely (never undefined)', () => {
		const definition = deepFreeze(createSymbolicDefinition('s', 'S', [], { variables: { x: 1 } }))
		const run = () => addVariable(definition, 'y', 2)
		expect(run().variables).toEqual({ x: 1, y: 2 })
		expect(run().variables).toEqual({ x: 1, y: 2 })

		const cleared = removeVariable(definition, 'x')
		expect(cleared.variables).toEqual({})
		expect(Object.hasOwn(cleared.variables, 'x')).toBe(false)
		expect(definition.variables).toEqual({ x: 1 }) // input untouched
	})

	it('removeVariable over a TRICKY_KEYS-named variable is total and never throws', () => {
		const key = TRICKY_KEYS[0] ?? '__proto__'
		const definition = createSymbolicDefinition('s', 'S', [], { variables: { [key]: 1 } })
		expect(() => removeVariable(definition, key)).not.toThrow()
		expect(Object.hasOwn(removeVariable(definition, key).variables, key)).toBe(false)
	})
})

describe('inferential change/extend helpers — appendFact / prependFact / replaceFact / removeFact / appendInference / prependInference / replaceInference / removeInference', () => {
	const f1 = createFact('f1', 'human', ['socrates'])
	const i1 = createInference(
		'i1',
		[createFact('p', 'human', ['?x'])],
		createFact('c', 'mortal', ['?x']),
	)

	it('facts round-trip on an InferentialDefinition', () => {
		const definition = deepFreeze(createInferentialDefinition('m', 'M', [f1], []))
		const f2 = createFact('f2', 'human', ['plato'])

		expect(appendFact(definition, f2).facts.map((f) => f.id)).toEqual(['f1', 'f2'])
		expect(prependFact(definition, f2).facts.map((f) => f.id)).toEqual(['f2', 'f1'])
		expect(replaceFact(definition, createFact('f1', 'human', ['plato'])).facts).toEqual([
			createFact('f1', 'human', ['plato']),
		])
		expect(removeFact(definition, 'f1').facts).toEqual([])
		expect(definition.facts).toEqual([f1]) // input untouched
	})

	it('appendFact with a missing target throws ReasonError("TARGET")', () => {
		const definition = deepFreeze(createInferentialDefinition('m', 'M', [f1], []))
		const error = captureError(() =>
			appendFact(definition, createFact('f2', 'human', ['plato']), 'missing'),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})

	it('inferences round-trip on an InferentialDefinition, order load-bearing (appendInference is the new last)', () => {
		const definition = deepFreeze(createInferentialDefinition('m', 'M', [], [i1]))
		const i2 = createInference(
			'i2',
			[createFact('p2', 'parent', ['?x', '?y'])],
			createFact('c2', 'ancestor', ['?x', '?y']),
		)

		expect(appendInference(definition, i2).inferences.map((i) => i.id)).toEqual(['i1', 'i2'])
		expect(prependInference(definition, i2).inferences.map((i) => i.id)).toEqual(['i2', 'i1'])
		const replaced = replaceInference(
			definition,
			createInference('i1', [], createFact('c', 'mortal', ['?x'])),
		)
		expect(replaced.inferences).toEqual([
			createInference('i1', [], createFact('c', 'mortal', ['?x'])),
		])
		expect(removeInference(definition, 'i1').inferences).toEqual([])
		expect(definition.inferences).toEqual([i1]) // input untouched
	})

	it('appendInference with a missing target throws ReasonError("TARGET")', () => {
		const definition = deepFreeze(createInferentialDefinition('m', 'M', [], [i1]))
		const error = captureError(() =>
			appendInference(
				definition,
				createInference('i2', [createFact('p', 'x', ['?a'])], createFact('c', 'y', ['?a'])),
				'missing',
			),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})
})

describe('merge helpers — whole-definition reconciliation', () => {
	it('mergeQuantitativeDefinition preserves base.id, recurses factors on a matched group, incoming order first', () => {
		const base = deepFreeze(
			createQuantitativeDefinition('risk', 'Risk', [
				createFactorGroup('g1', 'sum', [createStaticFactor('f1', 1)]),
				createFactorGroup('g2', 'sum', []),
			]),
		)
		const incoming = deepFreeze(
			createQuantitativeDefinition('ignored-id', 'Risk v2', [
				createFactorGroup('g1', 'sum', [createStaticFactor('f2', 2)]),
				createFactorGroup('g3', 'sum', []),
			]),
		)
		const run = () => mergeQuantitativeDefinition(base, incoming)
		const merged = run()
		expect(merged.id).toBe('risk') // base id preserved
		expect(merged.name).toBe('Risk v2') // incoming-wins scalar
		expect(merged.groups.map((g) => g.id)).toEqual(['g1', 'g3', 'g2']) // incoming order, then base survivor
		expect(merged.groups[0]?.factors.map((f) => f.id)).toEqual(['f2', 'f1']) // recursed factor merge, incoming first
		expect(run()).toEqual(merged)
		expect(base.groups).toEqual([
			createFactorGroup('g1', 'sum', [createStaticFactor('f1', 1)]),
			createFactorGroup('g2', 'sum', []),
		]) // input untouched
	})

	it('mergeQuantitativeDefinition keeps base optional fields when incoming omits them (merge never clears)', () => {
		const base = deepFreeze(
			createQuantitativeDefinition('risk', 'Risk', [], { precision: 2, base: 5 }),
		)
		const incoming = createQuantitativeDefinition('risk', 'Risk', [])
		expect(mergeQuantitativeDefinition(base, incoming).precision).toBe(2)
		expect(mergeQuantitativeDefinition(base, incoming).base).toBe(5)
	})

	it('mergeLogicalDefinition preserves base.id and merges rules incoming-order-first', () => {
		const base = deepFreeze(
			createLogicalDefinition('e', 'E', [createRule('r1', [], createAtom('a', 'equals', true))]),
		)
		const incoming = deepFreeze(
			createLogicalDefinition('ignored', 'E2', [
				createRule('r2', [], createAtom('b', 'equals', true)),
			]),
		)
		const merged = mergeLogicalDefinition(base, incoming)
		expect(merged.id).toBe('e')
		expect(merged.rules.map((r) => r.id)).toEqual(['r2', 'r1'])
	})

	it('mergeSymbolicDefinition preserves base.id, spread-merges variables, incoming-wins on overlap', () => {
		const base = deepFreeze(createSymbolicDefinition('s', 'S', [], { variables: { x: 1, y: 1 } }))
		const incoming = deepFreeze(
			createSymbolicDefinition('ignored', 'S2', [], { variables: { y: 2, z: 3 } }),
		)
		const merged = mergeSymbolicDefinition(base, incoming)
		expect(merged.id).toBe('s')
		expect(merged.variables).toEqual({ x: 1, y: 2, z: 3 })
	})

	it('mergeInferentialDefinition preserves base.id and merges facts/inferences incoming-order-first', () => {
		const base = deepFreeze(
			createInferentialDefinition('m', 'M', [createFact('f1', 'human', ['a'])], []),
		)
		const incoming = deepFreeze(
			createInferentialDefinition('ignored', 'M2', [createFact('f2', 'human', ['b'])], []),
		)
		const merged = mergeInferentialDefinition(base, incoming)
		expect(merged.id).toBe('m')
		expect(merged.facts.map((f) => f.id)).toEqual(['f2', 'f1'])
	})
})

describe('clear helpers — optional-field key-deletion', () => {
	it('clearQuantitativeDefinition omits the key entirely (never sets undefined)', () => {
		const definition = deepFreeze(
			createQuantitativeDefinition('risk', 'Risk', [], { precision: 2 }),
		)
		const cleared = clearQuantitativeDefinition(definition, 'precision')
		expect(Object.hasOwn(cleared, 'precision')).toBe(false)
		expect(definition.precision).toBe(2) // input untouched
	})

	it('clearLogicalDefinition omits the key entirely', () => {
		const definition = deepFreeze(createLogicalDefinition('e', 'E', [], { depth: 5 }))
		expect(Object.hasOwn(clearLogicalDefinition(definition, 'depth'), 'depth')).toBe(false)
	})

	it('clearSymbolicDefinition omits the key entirely', () => {
		const definition = deepFreeze(createSymbolicDefinition('s', 'S', [], { precision: 2 }))
		expect(Object.hasOwn(clearSymbolicDefinition(definition, 'precision'), 'precision')).toBe(false)
	})

	it('clearInferentialDefinition omits the key entirely', () => {
		const definition = deepFreeze(createInferentialDefinition('m', 'M', [], [], { depth: 5 }))
		expect(Object.hasOwn(clearInferentialDefinition(definition, 'depth'), 'depth')).toBe(false)
	})

	it('clearing an already-absent key is a total no-op fresh copy', () => {
		const definition = deepFreeze(createQuantitativeDefinition('risk', 'Risk', []))
		const run = () => clearQuantitativeDefinition(definition, 'precision')
		expect(run()).toEqual(definition)
		expect(run()).not.toBe(definition)
	})

	it('clearQuantitativeDefinition with a hostile non-listed key is total (invokeUnchecked)', () => {
		const definition = deepFreeze(createQuantitativeDefinition('risk', 'Risk', []))
		const clearRaw = (...args: never[]) => {
			const current = args[0]
			const key = args[1]
			if (current === undefined || key === undefined) {
				throw new Error('expected definition and key')
			}
			return clearQuantitativeDefinition(current, key)
		}
		expect(() => invokeUnchecked(undefined, clearRaw, [definition, '__proto__'])).not.toThrow()
	})
})

describe('parseDefinition — safe JSON round-trip', () => {
	it('round-trips a definition through JSON.stringify', () => {
		const definition = createLogicalDefinition('e', 'E', [
			createRule('r1', [], createAtom('a', 'equals', true)),
		])
		const run = () => parseDefinition(JSON.stringify(definition))
		expect(run()).toEqual(definition)
		expect(run()).toEqual(definition)
	})

	it('fails safe to undefined on malformed JSON or a non-definition shape', () => {
		expect(parseDefinition('not json')).toBeUndefined()
		expect(parseDefinition('{}')).toBeUndefined()
		expect(parseDefinition(JSON.stringify({ reasoning: 'quantum' }))).toBeUndefined()
	})
})

describe('subject engine — assignField / removeField / mergeSubjects / repeatSubject', () => {
	it('assignField upserts a key through a copy-on-write spread, id-agnostic', () => {
		const subject = deepFreeze({ id: 's1', age: 30 })
		const run = () => assignField(subject, 'age', 31)
		expect(run()).toEqual({ id: 's1', age: 31 })
		expect(run()).toEqual({ id: 's1', age: 31 })
		expect(assignField(subject, 'id', 'changed')).toEqual({ id: 'changed', age: 30 }) // id-agnostic
		expect(subject).toEqual({ id: 's1', age: 30 }) // input untouched
	})

	it('removeField omits the key entirely, never setting it to undefined', () => {
		const subject = deepFreeze({ id: 's1', age: 30 })
		const cleared = removeField(subject, 'age')
		expect(Object.hasOwn(cleared, 'age')).toBe(false)
		expect(cleared).toEqual({ id: 's1' })
	})

	it('removeField over TRICKY_KEYS values is total and never throws (invokeUnchecked)', () => {
		const key = TRICKY_KEYS[0] ?? '__proto__'
		const subject = { id: 's1', [key]: 'x' }
		const removeFieldRaw = (...args: never[]) => {
			const current = args[0]
			const field = args[1]
			if (current === undefined || field === undefined) throw new Error('expected subject and key')
			return removeField(current, field)
		}
		expect(() => invokeUnchecked(undefined, removeFieldRaw, [subject, key])).not.toThrow()
		expect(
			Object.hasOwn(invokeUnchecked<Subject>(undefined, removeFieldRaw, [subject, key]), key),
		).toBe(false)
	})

	it('mergeSubjects is incoming-wins per key, base id preserved when present', () => {
		const base = deepFreeze({ id: 's1', age: 30 })
		const incoming = deepFreeze({ id: 's2', age: 31, name: 'Alice' })
		const run = () => mergeSubjects(base, incoming)
		const expected = { id: 's1', age: 31, name: 'Alice' }
		expect(run()).toEqual(expected)
		expect(run()).toEqual(expected)
	})

	it('mergeSubjects with no base id lets incoming id (if any) through unpreserved', () => {
		const base = deepFreeze({ age: 30 })
		const incoming = deepFreeze({ id: 's2', age: 31 })
		expect(mergeSubjects(base, incoming)).toEqual({ id: 's2', age: 31 })
	})

	it('repeatSubject mints deterministic baseId-index ids, run-twice equal', () => {
		const subject = deepFreeze({ id: 's1', age: 30 })
		const run = () => repeatSubject(subject, 3)
		const expected = [
			{ id: 's1-0', age: 30 },
			{ id: 's1-1', age: 30 },
			{ id: 's1-2', age: 30 },
		]
		expect(run()).toEqual(expected)
		expect(run()).toEqual(expected)
	})

	it('repeatSubject with no string id passes clones through unchanged', () => {
		const subject = deepFreeze({ age: 30 })
		expect(repeatSubject(subject, 2)).toEqual([{ age: 30 }, { age: 30 }])
	})

	it('repeatSubject with count <= 0 returns an empty array', () => {
		const subject = deepFreeze({ id: 's1' })
		expect(repeatSubject(subject, 0)).toEqual([])
		expect(repeatSubject(subject, -3)).toEqual([])
	})
})
