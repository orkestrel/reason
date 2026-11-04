import {
	readVariablePresence,
	type Item,
	ADVERSARIAL_VALUE_SUBJECT,
	HOSTILE_PROXY,
	HOSTILE_VALUE,
	buildSharedNest,
	createCycleThrough,
	createFlagAtom,
	createFlagRule,
	createNegatedFlag,
	EXTREME_NUMBERS,
	INTEGER_KEY_SUBJECT,
	TRICKY_KEYS,
	deepAddition,
	deepCompound,
	deepFreeze,
	sequence,
	sparse,
} from '../../setup.js'
import type { CheckState, Comparison, MathOperation, Subject } from '@src/core'
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
	collectConcluders,
	collectPolarReads,
	collectReachable,
	collectVariables,
	combineStates,
	settleComparison,
	clearInferentialDefinition,
	clearLogicalDefinition,
	clearQuantitativeDefinition,
	clearSymbolicDefinition,
	computePremiseConfidence,
	containsVariable,
	createAtom,
	createBounds,
	createCheck,
	createCompound,
	createConstant,
	createEquation,
	createFact,
	createFactorGroup,
	createFieldFactor,
	createFieldSource,
	createInference,
	createInferentialDefinition,
	createLogicalDefinition,
	createLookupFactor,
	createLookupSource,
	createOperation,
	createQuantitativeDefinition,
	createRangeFactor,
	createRangeSource,
	createRule,
	createStaticFactor,
	createStaticSource,
	createSymbolicDefinition,
	createVariable,
	definitionToEnvelope,
	describeFault,
	describeMismatch,
	describeTerms,
	emptyAggregate,
	equalValues,
	extractAtoms,
	extractConclusions,
	factToArityKey,
	factToKey,
	admitsLiteral,
	buildRefusedResult,
	filterUniqueFaults,
	findFieldShape,
	findFilledPaths,
	isLosslessRepair,
	isUntypedShape,
	readExpectedKind,
	scanCheckExpected,
	scanShape,
	scanShapeConclusions,
	scanShapeReads,
	valueToFault,
	valueToKind,
	findDuplicates,
	findNegativeCycles,
	findSuppliedConclusions,
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
	projectValue,
	readClosedState,
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
	scanCheck,
	scanConclusion,
	scanConclusionValues,
	scanExpression,
	scanFactor,
	scanSymbolicExpression,
	sortByPriority,
	subjectToFacts,
	termToKey,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	arrayShape,
	booleanShape,
	jsonShape,
	literalShape,
	nullableShape,
	numberShape,
	objectShape,
	optionalShape,
	rawShape,
	stringShape,
	unionShape,
} from '@orkestrel/contract'
import { captureError, invokeUnchecked } from '@orkestrel/test'

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
		const sorted = invokeUnchecked<ReadonlyArray<{ readonly id: string }>>(
			undefined,
			sortByPriority<{ readonly id: string; readonly priority?: number }>,
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

	it('retains base duplicate order when repeat order differs from first occurrence order', () => {
		// Base: 836efee:src/core/helpers.ts:357.
		const base = sequence(5000).map((index) => ({ id: `k${index}` }))
		expect(findDuplicates([...base, { id: 'k100' }, { id: 'k50' }, { id: 'k100' }])).toEqual([
			'k50',
			'k100',
		])
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

	it('has no answer for an unknown aggregation from an untrusted definition', () => {
		expect(invokeUnchecked<number>(undefined, emptyAggregate, ['median'])).toBeNaN()
	})
})

describe('resolveSource — one factor source against a subject', () => {
	it('passes a static value through', () => {
		expect(resolveSource(createStaticSource(42), {})).toEqual({ value: 42, fallback: false })
	})

	it('reads a field source as a finite number and nothing else, whatever the fallback', () => {
		const unread = { fallback: false }
		expect(resolveSource(createFieldSource('age'), { age: 30 })).toEqual({
			value: 30,
			fallback: false,
		})
		expect(resolveSource(createFieldSource('age'), { age: 'old' }, 7)).toEqual(unread)
		expect(resolveSource(createFieldSource('age'), { age: '30' }, 7)).toEqual(unread)
		expect(resolveSource(createFieldSource('age'), { age: Number.NaN }, 7)).toEqual(unread)
		expect(resolveSource(createFieldSource('age'), {}, 7)).toEqual(unread)
	})

	it('reads only OWN lookup table keys, and takes the fallback only on a readable miss', () => {
		const source = createLookupSource('state', { CA: 5 })
		const unread = { fallback: false }
		expect(resolveSource(source, { state: 'CA' })).toEqual({ value: 5, fallback: false })
		expect(resolveSource(source, { state: 'NY' }, 1)).toEqual({ value: 1, fallback: true })
		expect(resolveSource(source, { state: 'NY' })).toEqual(unread)
		expect(resolveSource(source, { state: 'toString' }, 1)).toEqual({ value: 1, fallback: true })
		expect(resolveSource(source, { state: null }, 1)).toEqual(unread)
		expect(resolveSource(source, {}, 1)).toEqual(unread)
		expect(resolveSource(source, { state: ['CA'] }, 1)).toEqual(unread)
		expect(resolveSource(source, { state: {} }, 1)).toEqual(unread)
		expect(resolveSource(source, { state: Number.NaN }, 1)).toEqual(unread)
	})

	it('scans range bands in order and takes the first match', () => {
		const source = createRangeSource('age', [
			{ bounds: createBounds(undefined, 24), value: 30 },
			{ bounds: createBounds(25, 64), value: 15 },
			{ value: 1 },
		])
		expect(resolveSource(source, { age: 20 })).toEqual({ value: 30, fallback: false })
		expect(resolveSource(source, { age: 40 })).toEqual({ value: 15, fallback: false })
		expect(resolveSource(source, { age: 90 })).toEqual({ value: 1, fallback: false })
		expect(resolveSource(source, {}, 0)).toEqual({ fallback: false })
		expect(resolveSource(source, { age: '20' }, 0)).toEqual({ fallback: false })
		const gapped = createRangeSource('age', [{ bounds: createBounds(0, 10), value: 2 }])
		expect(resolveSource(gapped, { age: 50 }, 9)).toEqual({ value: 9, fallback: true })
		expect(resolveSource(gapped, { age: 50 })).toEqual({ fallback: false })
	})

	it('reads a factor carrying no source at all as unread', () => {
		expect(invokeUnchecked<unknown>(undefined, resolveSource, [undefined, {}, 3])).toEqual({
			fallback: false,
		})
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
		const expression = deepCompound(500, createAtom('leaf', 'equals', true))
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
			faults: [],
			repairs: [],
			defaulted: [],
		})
	})

	it('builds the logical failure shape', () => {
		expect(buildErrorResult(createLogicalDefinition('l', 'L', []), 'boom')).toEqual({
			reasoning: 'logical',
			conclusion: 'unread',
			rules: [],
			count: 0,
			success: false,
			trace: [],
			errors: ['boom'],
			faults: [],
			repairs: [],
			defaulted: [],
		})
	})

	it('builds the symbolic failure shape', () => {
		expect(buildErrorResult(createSymbolicDefinition('s', 'S', []), 'boom')).toEqual({
			reasoning: 'symbolic',
			solutions: {},
			success: false,
			trace: [],
			errors: ['boom'],
			faults: [],
			repairs: [],
			defaulted: [],
		})
	})

	it('builds the inferential failure shape', () => {
		expect(buildErrorResult(createInferentialDefinition('i', 'I', [], []), 'boom')).toEqual({
			reasoning: 'inferential',
			derived: [],
			success: false,
			trace: [],
			errors: ['boom'],
			faults: [],
			repairs: [],
			defaulted: [],
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
		const expected = [
			{ id: 'subject:1', predicate: 'has', terms: ['1', 1], confidence: 1 },
			{ id: 'subject:2', predicate: 'has', terms: ['2', 2], confidence: 1 },
			{ id: 'subject:10', predicate: 'has', terms: ['10', 10], confidence: 1 },
			{ id: 'subject:zeta', predicate: 'has', terms: ['zeta', 26], confidence: 1 },
			{ id: 'subject:alpha', predicate: 'has', terms: ['alpha', 1], confidence: 1 },
		]
		const first = subjectToFacts(INTEGER_KEY_SUBJECT).facts
		const second = subjectToFacts(INTEGER_KEY_SUBJECT).facts
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
		const expected = ['10', '__proto__']
		expect(
			findDuplicates(
				['10', '__proto__', '2', '10', 'constructor', '__proto__', '1'].map((id) => ({ id })),
			),
		).toEqual(expected)
		expect(
			findDuplicates(
				['10', '__proto__', '2', '10', 'constructor', '__proto__', '1'].map((id) => ({ id })),
			),
		).toEqual(expected)
	})

	it('mixes every TRICKY_KEYS value with integer-like ids, first-occurrence order preserved', () => {
		const ids = [...TRICKY_KEYS, '9', '3', ...TRICKY_KEYS]
		const expected = [...TRICKY_KEYS]
		expect(findDuplicates(ids.map((id) => ({ id })))).toEqual(expected)
		expect(findDuplicates(ids.map((id) => ({ id })))).toEqual(expected)
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
		const first = readVariablePresence(expression)
		const second = readVariablePresence(expression)
		expect(first).toEqual({ present: true, absent: false })
		expect(second).toEqual({ present: true, absent: false })
		expect(first).toEqual(second)
	})
})

// === Definitions & subjects capability layer ================================

describe('appendById / prependById — dedup-then-insert primitives', () => {
	it('appendById dedups an existing id and inserts at the end', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }, { id: 'b' }])
		const expected = [{ id: 'b' }, { id: 'a', v: 9 }]
		expect(appendById(items, { id: 'a', v: 9 })).toEqual(expected)
		expect(appendById(items, { id: 'a', v: 9 })).toEqual(expected)
		expect(items).toEqual([{ id: 'a' }, { id: 'b' }]) // input untouched
	})

	it('appendById with a target inserts immediately after it', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }, { id: 'b' }])
		const expected = ['a', 'c', 'b']
		expect(appendById(items, { id: 'c' }, 'a').map((item) => item.id)).toEqual(expected)
		expect(appendById(items, { id: 'c' }, 'a').map((item) => item.id)).toEqual(expected)
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
		const expected = ['b', 'a']
		expect(prependById(items, { id: 'b', v: 9 }).map((item) => item.id)).toEqual(expected)
		expect(prependById(items, { id: 'b', v: 9 }).map((item) => item.id)).toEqual(expected)
	})

	it('prependById with a target inserts immediately before it', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }, { id: 'b' }])
		const expected = ['a', 'c', 'b']
		expect(prependById(items, { id: 'c' }, 'b').map((item) => item.id)).toEqual(expected)
		expect(prependById(items, { id: 'c' }, 'b').map((item) => item.id)).toEqual(expected)
	})

	it('prependById throws ReasonError("TARGET") when target names no element', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }])
		const error = captureError(() => prependById(items, { id: 'b' }, 'missing'))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})

	it('appendById over a sparse array skips holes (hostile input)', () => {
		const items = sparse<Item>(3, [[1, { id: 'a' }]])
		const result = invokeUnchecked<readonly Item[]>(undefined, appendById<Item>, [
			items,
			{ id: 'z' },
		])
		expect(result.map((item) => item.id)).toEqual(['a', 'z'])
	})
})

describe('replaceById / removeById — position-preserving swap & filter', () => {
	it('replaceById swaps the same-id element in place, preserving position', () => {
		const items = deepFreeze<readonly Item[]>([
			{ id: 'a', v: 1 },
			{ id: 'b', v: 2 },
		])
		const expected = [
			{ id: 'a', v: 9 },
			{ id: 'b', v: 2 },
		]
		expect(replaceById(items, { id: 'a', v: 9 })).toEqual(expected)
		expect(replaceById(items, { id: 'a', v: 9 })).toEqual(expected)
	})

	it('replaceById appends when no same-id element exists', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }])
		expect(replaceById(items, { id: 'z' })).toEqual([{ id: 'a' }, { id: 'z' }])
	})

	it('removeById filters out every same-id element, never throwing', () => {
		const items = deepFreeze<readonly Item[]>([{ id: 'a' }, { id: 'b' }])
		expect(removeById(items, 'a')).toEqual([{ id: 'b' }])
		expect(removeById(items, 'a')).toEqual([{ id: 'b' }])
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
		expect(() => invokeUnchecked(undefined, removeById<Item>, [items, 'nope'])).not.toThrow()
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
		const expected = [
			{ id: 'c', v: 3 },
			{ id: 'a', v: 9 },
			{ id: 'b', v: 2 },
		]
		expect(mergeById(base, incoming)).toEqual(expected)
		expect(mergeById(base, incoming)).toEqual(expected)
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

	it('retains incoming winners and base survivors across wide duplicate lists', () => {
		// Base: 836efee:src/core/helpers.ts:1390.
		const base = sequence(5000).map((index) => ({ id: `k${index}`, value: index }))
		const incoming = [
			{ id: 'k100', value: -100 },
			{ id: 'k50', value: -50 },
		]
		const merged = mergeById([...base, ...base], [...incoming, ...incoming])
		expect(merged).toEqual([
			...incoming,
			...base.filter((item) => item.id !== 'k100' && item.id !== 'k50'),
		])
		expect(merged[0]).toBe(incoming[0])
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
		expect(addVariable(definition, 'y', 2).variables).toEqual({ x: 1, y: 2 })
		expect(addVariable(definition, 'y', 2).variables).toEqual({ x: 1, y: 2 })

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
		const merged = mergeQuantitativeDefinition(base, incoming)
		expect(merged.id).toBe('risk') // base id preserved
		expect(merged.name).toBe('Risk v2') // incoming-wins scalar
		expect(merged.groups.map((g) => g.id)).toEqual(['g1', 'g3', 'g2']) // incoming order, then base survivor
		expect(merged.groups[0]?.factors.map((f) => f.id)).toEqual(['f2', 'f1']) // recursed factor merge, incoming first
		expect(mergeQuantitativeDefinition(base, incoming)).toEqual(merged)
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
		expect(clearQuantitativeDefinition(definition, 'precision')).toEqual(definition)
		expect(clearQuantitativeDefinition(definition, 'precision')).not.toBe(definition)
	})

	it('clearQuantitativeDefinition with a hostile non-listed key is total (invokeUnchecked)', () => {
		const definition = deepFreeze(createQuantitativeDefinition('risk', 'Risk', []))
		expect(() =>
			invokeUnchecked(undefined, clearQuantitativeDefinition, [definition, '__proto__']),
		).not.toThrow()
	})
})

describe('parseDefinition — safe JSON round-trip', () => {
	it('round-trips a definition through JSON.stringify', () => {
		const definition = createLogicalDefinition('e', 'E', [
			createRule('r1', [], createAtom('a', 'equals', true)),
		])
		expect(parseDefinition(JSON.stringify(definition))).toEqual(definition)
		expect(parseDefinition(JSON.stringify(definition))).toEqual(definition)
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
		expect(assignField(subject, 'age', 31)).toEqual({ id: 's1', age: 31 })
		expect(assignField(subject, 'age', 31)).toEqual({ id: 's1', age: 31 })
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
		expect(() => invokeUnchecked(undefined, removeField, [subject, key])).not.toThrow()
		expect(
			Object.hasOwn(invokeUnchecked<Subject>(undefined, removeField, [subject, key]), key),
		).toBe(false)
	})

	it('mergeSubjects is incoming-wins per key, base id preserved when present', () => {
		const base = deepFreeze({ id: 's1', age: 30 })
		const incoming = deepFreeze({ id: 's2', age: 31, name: 'Alice' })
		const expected = { id: 's1', age: 31, name: 'Alice' }
		expect(mergeSubjects(base, incoming)).toEqual(expected)
		expect(mergeSubjects(base, incoming)).toEqual(expected)
	})

	it('mergeSubjects with no base id lets incoming id (if any) through unpreserved', () => {
		const base = deepFreeze({ age: 30 })
		const incoming = deepFreeze({ id: 's2', age: 31 })
		expect(mergeSubjects(base, incoming)).toEqual({ id: 's2', age: 31 })
	})

	it('repeatSubject mints deterministic baseId-index ids, run-twice equal', () => {
		const subject = deepFreeze({ id: 's1', age: 30 })
		const expected = [
			{ id: 's1-0', age: 30 },
			{ id: 's1-1', age: 30 },
			{ id: 's1-2', age: 30 },
		]
		expect(repeatSubject(subject, 3)).toEqual(expected)
		expect(repeatSubject(subject, 3)).toEqual(expected)
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

// The three-valued logic, written out rather than derived, so a table cannot agree with
// the implementation by sharing its reasoning.
const m: CheckState = 'met'
const u: CheckState = 'unmet'
const r: CheckState = 'unread'

describe('combineStates — strong Kleene truth tables', () => {
	it.each<[CheckState, CheckState, CheckState, CheckState, CheckState, CheckState]>([
		[m, m, m, m, m, u],
		[m, u, u, m, u, m],
		[m, r, r, m, r, r],
		[u, m, u, m, m, m],
		[u, u, u, u, m, u],
		[u, r, u, r, m, r],
		[r, m, r, m, m, r],
		[r, u, u, r, r, r],
		[r, r, r, r, r, r],
	])('%s, %s: and %s, or %s, implies %s, xor %s', (left, right, and, or, implies, xor) => {
		expect(combineStates('and', [left, right])).toBe(and)
		expect(combineStates('or', [left, right])).toBe(or)
		expect(combineStates('implies', [left, right])).toBe(implies)
		expect(combineStates('xor', [left, right])).toBe(xor)
	})

	it('not flips met and unmet and leaves unread alone', () => {
		expect(combineStates('not', [m])).toBe(u)
		expect(combineStates('not', [u])).toBe(m)
		expect(combineStates('not', [r])).toBe(r)
	})

	it('and and or read any number of operands', () => {
		expect(combineStates('and', [m])).toBe(m)
		expect(combineStates('and', [m, m, r])).toBe(r)
		expect(combineStates('and', [m, r, u])).toBe(u)
		expect(combineStates('or', [u])).toBe(u)
		expect(combineStates('or', [u, u, r])).toBe(r)
		expect(combineStates('or', [u, r, m])).toBe(m)
	})

	it('a wrong arity reads unread, in both directions', () => {
		expect(combineStates('and', [])).toBe(r)
		expect(combineStates('or', [])).toBe(r)
		expect(combineStates('not', [])).toBe(r)
		expect(combineStates('not', [m, m])).toBe(r)
		expect(combineStates('implies', [m])).toBe(r)
		expect(combineStates('implies', [u, m, m])).toBe(r)
		expect(combineStates('xor', [m])).toBe(r)
		expect(combineStates('xor', [m, u, m])).toBe(r)
	})

	it('an operand that is no state reads unread, so an evaluator returning none cannot read met', () => {
		for (const operand of [undefined, 'maybe', true, null]) {
			expect(invokeUnchecked<CheckState>(undefined, combineStates, ['and', [operand]])).toBe(r)
			expect(invokeUnchecked<CheckState>(undefined, combineStates, ['or', [operand]])).toBe(r)
			expect(invokeUnchecked<CheckState>(undefined, combineStates, ['not', [operand]])).toBe(r)
		}
	})

	it('an unknown connective and a hole both read unread', () => {
		expect(combineStates('nand', [m, m])).toBe(r)
		expect(combineStates('and', sparse<CheckState>(2, [[0, u]]))).toBe(r)
		expect(combineStates('or', sparse<CheckState>(2, [[0, m]]))).toBe(r)
	})
})

describe('settleComparison', () => {
	it.each<[unknown, string, unknown, CheckState]>([
		// One primitive type settles by ===.
		[1, 'equals', 1, m],
		[1, 'equals', 2, u],
		['a', 'equals', 'a', m],
		['a', 'equals', 'b', u],
		[true, 'equals', true, m],
		[false, 'equals', true, u],
		[1, 'not', 2, m],
		[1, 'not', 1, u],
		// null is a value: as the expected value it settles on any present field.
		[null, 'equals', null, m],
		[5, 'equals', null, u],
		[null, 'not', null, u],
		[5, 'not', null, m],
		['a', 'not', null, m],
		[false, 'not', null, m],
		// Any other difference of type never settles, in either direction.
		[90, 'equals', 'none', r],
		[90, 'not', 'none', r],
		['abc', 'equals', 1, r],
		['yes', 'equals', true, r],
		[1, 'equals', true, r],
		[true, 'equals', 1, r],
		['1', 'equals', 1, r],
		['1', 'not', 1, r],
		['2', 'equals', 1, r],
		[1, 'equals', '1', r],
		[1, 'not', '1.0', r],
		[true, 'equals', 'true', r],
		[true, 'not', 'true', r],
		['no', 'equals', false, r],
		['off', 'not', false, r],
		['False', 'equals', false, r],
		[null, 'equals', 1, r],
		[null, 'not', 'a', r],
		// A blank or padded string reads unread, whatever it is compared with.
		['', 'equals', '', r],
		[' ', 'equals', ' ', r],
		[' a', 'equals', ' a', r],
		['a ', 'not', 'b', r],
		['', 'equals', false, r],
		[' true ', 'equals', true, r],
		['', 'not', null, r],
		// Either side unreadable.
		[undefined, 'equals', 1, r],
		[undefined, 'equals', null, r],
		[undefined, 'not', null, r],
		[Number.NaN, 'equals', 1, r],
		[Number.POSITIVE_INFINITY, 'not', 1, r],
		[{}, 'equals', 1, r],
		[[1], 'not', 1, r],
		[1n, 'equals', 1, r],
		[1, 'equals', Number.NaN, r],
		[1, 'not', {}, r],
	])('%o %s %o is %s', (actual, operator, expected, state) => {
		expect(settleComparison(actual, operator, expected)).toBe(state)
	})

	it.each<[unknown, string, unknown, CheckState]>([
		[30, 'above', 18, m],
		[18, 'above', 18, u],
		[17, 'below', 18, m],
		[18, 'below', 18, u],
		[18, 'from', 18, m],
		[17, 'from', 18, u],
		[18, 'to', 18, m],
		[19, 'to', 18, u],
		['30', 'above', 18, r],
		[undefined, 'below', 18, r],
		[null, 'from', 18, r],
		[Number.NaN, 'to', 18, r],
		[Number.POSITIVE_INFINITY, 'above', 18, r],
		[true, 'above', 0, r],
		[30, 'above', '18', r],
		[30, 'below', Number.NaN, r],
		[30, 'from', undefined, r],
	])('ordering: %o %s %o is %s', (actual, operator, expected, state) => {
		expect(settleComparison(actual, operator, expected)).toBe(state)
	})

	it.each<[unknown, string, unknown, CheckState]>([
		['a', 'any', ['a', 'b'], m],
		['c', 'any', ['a', 'b'], u],
		['a', 'none', ['a', 'b'], u],
		['c', 'none', ['a', 'b'], m],
		[1, 'any', [1, 2], m],
		[3, 'any', [1, 2], u],
		// An exact hit settles, whatever else the list holds.
		['1', 'any', ['1', 1], m],
		['1', 'none', ['1', 1], u],
		[1, 'any', ['1', 1], m],
		[null, 'any', [null, 'a'], m],
		[null, 'none', [null], u],
		// No hit, and an element of another type: unread.
		['x', 'any', [1, 2], r],
		['1', 'any', [1, 2], r],
		['1', 'none', [1, 2], r],
		['1', 'any', [2, 'x'], r],
		[1, 'any', ['1'], r],
		[true, 'none', ['true'], r],
		[5, 'none', [null], r],
		[null, 'any', ['a'], r],
		// Unreadable.
		[undefined, 'any', ['a'], r],
		[undefined, 'none', ['a'], r],
		['a', 'any', [], r],
		['a', 'none', 'a', r],
		[1, 'any', [Number.NaN], r],
		[{}, 'any', ['a'], r],
		// A blank or padded string reads unread, unless the list holds it exactly.
		[' CA ', 'any', ['CA'], r],
		[' CA ', 'none', ['CA'], r],
		[' CA ', 'any', [' CA '], m],
		[' CA ', 'none', [' CA '], u],
		['', 'any', [''], m],
		['', 'none', [''], u],
		['  ', 'none', ['a'], r],
	])('membership: %o %s %o is %s', (actual, operator, expected, state) => {
		expect(settleComparison(actual, operator, expected)).toBe(state)
	})

	it.each<[unknown, string, unknown, CheckState]>([
		[5, 'between', [1, 10], m],
		[1, 'between', [1, 10], m],
		[10, 'between', [1, 10], m],
		[11, 'between', [1, 10], u],
		[11, 'outside', [1, 10], m],
		[5, 'outside', [1, 10], u],
		['5', 'between', [1, 10], r],
		[undefined, 'outside', [1, 10], r],
		[5, 'between', [10, 1], r],
		[5, 'outside', [1], r],
		[5, 'between', [1, Number.NaN], r],
	])('range: %o %s %o is %s', (actual, operator, expected, state) => {
		expect(settleComparison(actual, operator, expected)).toBe(state)
	})

	it('throws OPERATOR on a comparison it does not know', () => {
		const error = captureError(() => settleComparison(1, 'nearly', 1))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('OPERATOR')
	})
})

describe('readClosedState', () => {
	it('membership reads as absent, and every comparison needing a number is unread', () => {
		expect(readClosedState('equals')).toBe(u)
		expect(readClosedState('any')).toBe(u)
		expect(readClosedState('not')).toBe(m)
		expect(readClosedState('none')).toBe(m)
		for (const operator of ['above', 'below', 'from', 'to', 'between', 'outside', 'nearly']) {
			expect(readClosedState(operator)).toBe(r)
		}
	})
})

describe('collectConcluders', () => {
	it('maps each key to its concluding rules, in authored order', () => {
		const first = createFlagRule('first', 'a')
		const second = createFlagRule('second', 'b')
		const third = createFlagRule('third', 'a')
		const concluders = collectConcluders([first, second, third])
		expect([...concluders.keys()]).toEqual(['a', 'b'])
		expect(concluders.get('a')).toEqual([first, third])
		expect(concluders.get('b')).toEqual([second])
		expect(concluders.get('x')).toBeUndefined()
	})

	it('reads every asserted key of a joined conclusion, and flattens a path', () => {
		const rule = createRule(
			'r',
			[createAtom('x', 'equals', 1)],
			createCompound('and', [
				createAtom('a', 'equals', true),
				createAtom(['b', 'c'], 'equals', true),
			]),
		)
		expect([...collectConcluders([rule]).keys()]).toEqual(['a', 'b.c'])
	})
})

describe('findSuppliedConclusions', () => {
	const a = createFlagRule('r', 'a')
	const path = createFlagRule('r', ['f', 'ok'])

	it('finds a key the subject holds, once each, and ignores the rest', () => {
		expect(findSuppliedConclusions([a], { a: true })).toEqual(['a'])
		expect(findSuppliedConclusions([a], { a: false })).toEqual(['a'])
		expect(findSuppliedConclusions([a], { a: undefined })).toEqual(['a'])
		expect(findSuppliedConclusions([a, a], { a: true })).toEqual(['a'])
		expect(findSuppliedConclusions([a], { b: true })).toEqual([])
	})

	it('counts every spelling of the key the rules read it through', () => {
		const dotted = createFlagRule('w', 'a.b')
		const reader = createFlagRule('r', 'ok', [createFlagAtom(['a', 'b'])])
		expect(findSuppliedConclusions([dotted, reader], { a: { b: 1 } })).toEqual(['a.b'])
		expect(findSuppliedConclusions([dotted, reader], { 'a.b': 1 })).toEqual(['a.b'])
		expect(findSuppliedConclusions([dotted, reader], { a: {} })).toEqual([])
	})

	it('reads a path nested and flat, and never through the prototype', () => {
		expect(findSuppliedConclusions([path], { f: { ok: true } })).toEqual(['f.ok'])
		expect(findSuppliedConclusions([path], { 'f.ok': true })).toEqual(['f.ok'])
		expect(findSuppliedConclusions([createFlagRule('r', 'toString')], {})).toEqual([])
	})
})

describe('findNegativeCycles', () => {
	const key = createFlagAtom
	const not = createNegatedFlag

	it('names both keys of a cycle through negation, and one key of a self-negation', () => {
		const rules = [createRule('a', [not('b')], key('a')), createRule('b', [not('a')], key('b'))]
		expect(findNegativeCycles(rules)).toEqual(['a', 'b'])
		expect(findNegativeCycles([createRule('a', [not('a')], key('a'))])).toEqual(['a'])
	})

	it('names every key of a longer cycle with one negative edge, in authored order', () => {
		const rules = [
			createRule('a', [not('c')], key('a')),
			createRule('b', [key('a')], key('b')),
			createRule('c', [key('b')], key('c')),
		]
		expect(findNegativeCycles(rules)).toEqual(['a', 'b', 'c'])
	})

	it('names only the keys on the cycle, not the keys it reaches', () => {
		const rules = [
			createRule('a', [not('b')], key('a')),
			createRule('b', [not('a')], key('b')),
			createRule('c', [key('a')], key('c')),
		]
		expect(findNegativeCycles(rules)).toEqual(['a', 'b'])
	})

	it('leaves a positive cycle alone', () => {
		const rules = [createRule('a', [key('b')], key('a')), createRule('b', [key('a')], key('b'))]
		expect(findNegativeCycles(rules)).toEqual([])
	})

	it('leaves a negation off any cycle alone, and one over an input', () => {
		const rules = [
			createRule('nb', [not('a')], key('nb')),
			createRule('a', [createAtom('x', 'above', 1)], key('a')),
			createRule('nc', [key('nb')], key('nc')),
			createRule('d', [not('input')], key('d')),
		]
		expect(findNegativeCycles(rules)).toEqual([])
	})

	it('reads each way a premise can negate', () => {
		const through = createCycleThrough
		expect(findNegativeCycles(through(createAtom('b', 'not', true)))).toEqual(['a', 'b'])
		expect(findNegativeCycles(through(createAtom('b', 'none', [true])))).toEqual(['a', 'b'])
		expect(findNegativeCycles(through(createCompound('implies', [key('b'), key('x')])))).toEqual([
			'a',
			'b',
		])
		expect(findNegativeCycles(through(createCompound('xor', [key('b'), key('x')])))).toEqual([
			'a',
			'b',
		])
		// The consequent of `implies` reads positively, and so does a double negation.
		expect(findNegativeCycles(through(createCompound('implies', [key('x'), key('b')])))).toEqual([])
		expect(findNegativeCycles(through(createCompound('not', [not('b')])))).toEqual([])
	})
})

describe('collectReachable', () => {
	it('walks the edges from the start, the start included', () => {
		const edges: ReadonlyArray<readonly [string, string]> = [
			['a', 'b'],
			['b', 'c'],
			['x', 'a'],
		]
		expect([...collectReachable('a', edges)]).toEqual(['a', 'b', 'c'])
		expect([...collectReachable('c', edges)]).toEqual(['c'])
		expect([...collectReachable('none', edges)]).toEqual(['none'])
	})

	it('terminates on a cycle', () => {
		const edges: ReadonlyArray<readonly [string, string]> = [
			['a', 'b'],
			['b', 'a'],
		]
		expect([...collectReachable('a', edges)]).toEqual(['a', 'b'])
	})
})

describe('collectPolarReads', () => {
	const key = createFlagAtom

	it('reads an atom at the polarity it was given, flipped by a negating comparison', () => {
		expect(collectPolarReads(key('a'), false)).toEqual([{ key: 'a', negated: false }])
		expect(collectPolarReads(key('a'), true)).toEqual([{ key: 'a', negated: true }])
		expect(collectPolarReads(createAtom('a', 'not', true), false)).toEqual([
			{ key: 'a', negated: true },
		])
		expect(collectPolarReads(createAtom('a', 'none', [true]), true)).toEqual([
			{ key: 'a', negated: false },
		])
	})

	it('reads the connectives', () => {
		expect(collectPolarReads(createCompound('and', [key('a'), key('b')]), false)).toEqual([
			{ key: 'a', negated: false },
			{ key: 'b', negated: false },
		])
		expect(collectPolarReads(createCompound('not', [key('a')]), false)).toEqual([
			{ key: 'a', negated: true },
		])
		expect(
			collectPolarReads(createCompound('not', [createCompound('not', [key('a')])]), false),
		).toEqual([{ key: 'a', negated: false }])
		expect(collectPolarReads(createCompound('implies', [key('a'), key('b')]), false)).toEqual([
			{ key: 'a', negated: true },
			{ key: 'b', negated: false },
		])
		expect(collectPolarReads(createCompound('xor', [key('a'), key('b')]), false)).toEqual([
			{ key: 'a', negated: false },
			{ key: 'a', negated: true },
			{ key: 'b', negated: false },
			{ key: 'b', negated: true },
		])
	})
})

describe('scanCheck', () => {
	it.each<[Comparison, unknown]>([
		['equals', 1],
		['not', 'a'],
		['equals', false],
		['equals', null],
		['above', 18],
		['below', 18],
		['from', 18],
		['to', 18],
		['any', ['a', 1]],
		['none', [true]],
		['between', [1, 2]],
		['outside', [2, 2]],
	])('%s %j is well formed', (operator, value) => {
		expect(scanCheck(createCheck('a', operator, value))).toEqual([])
	})

	it.each<[Comparison, unknown, string]>([
		['equals', [1], 'needs a finite number, a string, a boolean, or null'],
		['not', Number.NaN, 'needs a finite number, a string, a boolean, or null'],
		['equals', {}, 'needs a finite number, a string, a boolean, or null'],
		['above', '18', 'needs a finite number'],
		['below', Number.POSITIVE_INFINITY, 'needs a finite number'],
		['from', null, 'needs a finite number'],
		['to', [1], 'needs a finite number'],
		['any', [], 'needs a non-empty list of comparable values'],
		['none', 'a', 'needs a non-empty list of comparable values'],
		['any', [{}], 'needs a non-empty list of comparable values'],
		['between', [2, 1], 'needs [minimum, maximum] of finite numbers in order'],
		['outside', [1], 'needs [minimum, maximum] of finite numbers in order'],
		['between', 1, 'needs [minimum, maximum] of finite numbers in order'],
	])('%s %j %s', (operator, value, fault) => {
		expect(scanCheck(createCheck('a', operator, value))).toEqual([
			`Check on "a": "${operator}" ${fault}`,
		])
	})
})

describe('scanExpression', () => {
	const atom = createAtom('a', 'equals', 1)

	it('accepts each connective at its arity', () => {
		expect(scanExpression(atom)).toEqual([])
		expect(scanExpression(createCompound('and', [atom]))).toEqual([])
		expect(scanExpression(createCompound('or', [atom, atom, atom]))).toEqual([])
		expect(scanExpression(createCompound('not', [atom]))).toEqual([])
		expect(scanExpression(createCompound('implies', [atom, atom]))).toEqual([])
		expect(scanExpression(createCompound('xor', [atom, atom]))).toEqual([])
	})

	it('refuses a wrong arity in both directions', () => {
		expect(scanExpression(createCompound('and', []))).toEqual(['Connective "and" has 0 operands'])
		expect(scanExpression(createCompound('or', []))).toEqual(['Connective "or" has 0 operands'])
		expect(scanExpression(createCompound('not', []))).toEqual(['Connective "not" has 0 operands'])
		expect(scanExpression(createCompound('not', [atom, atom]))).toEqual([
			'Connective "not" has 2 operands',
		])
		expect(scanExpression(createCompound('implies', [atom]))).toEqual([
			'Connective "implies" has 1 operands',
		])
		expect(scanExpression(createCompound('xor', [atom, atom, atom]))).toEqual([
			'Connective "xor" has 3 operands',
		])
	})

	it('finds a fault at any depth', () => {
		const nested = createCompound('and', [
			createCompound('not', []),
			createCompound('or', [createAtom('a', 'above', 'x')]),
		])
		expect(scanExpression(nested)).toEqual([
			'Connective "not" has 0 operands',
			'Check on "a": "above" needs a finite number',
		])
	})
})

describe('scanConclusion', () => {
	const okay = createAtom('ok', 'equals', true)

	it('accepts an assertion, and assertions joined with "and"', () => {
		expect(scanConclusion(okay)).toEqual([])
		expect(scanConclusion(createAtom('tier', 'equals', 'gold'))).toEqual([])
		expect(scanConclusion(createAtom('score', 'equals', 0))).toEqual([])
		expect(scanConclusion(createCompound('and', [okay, createAtom('x', 'equals', 1)]))).toEqual([])
	})

	it('refuses any other connective, and an empty "and"', () => {
		expect(scanConclusion(createCompound('not', [okay]))).toEqual([
			'A conclusion may only join atoms with "and", not "not"',
		])
		expect(scanConclusion(createCompound('or', [okay]))).toEqual([
			'A conclusion may only join atoms with "and", not "or"',
		])
		expect(scanConclusion(createCompound('and', []))).toEqual([
			'A conclusion may only join atoms with "and", not "and"',
		])
	})

	it('refuses a comparison that is not "equals", false, and an incomparable value', () => {
		expect(scanConclusion(createAtom('ok', 'not', true))).toEqual([
			'Conclusion on "ok" must use "equals", not "not"',
		])
		expect(scanConclusion(createAtom('ok', 'equals', false))).toEqual([
			'Conclusion on "ok" may not assert false',
		])
		expect(scanConclusion(createAtom('ok', 'equals', {}))).toEqual([
			'Conclusion on "ok" must assert a comparable value',
		])
	})

	it('finds a fault under "and"', () => {
		expect(scanConclusion(createCompound('and', [createAtom('ok', 'equals', false)]))).toEqual([
			'Conclusion on "ok" may not assert false',
		])
	})
})

describe('scanFactor', () => {
	it('a fallback belongs to a source that can miss', () => {
		expect(scanFactor(createFieldFactor('f', 'x'))).toEqual([])
		expect(scanFactor(createStaticFactor('f', 1))).toEqual([])
		expect(scanFactor(createLookupFactor('f', 'x', { a: 1 }, { fallback: 0 }))).toEqual([])
		expect(scanFactor(createRangeFactor('f', 'x', [{ value: 1 }], { fallback: 0 }))).toEqual([])
		expect(scanFactor(createFieldFactor('f', 'x', { fallback: 0 }))).toEqual([
			'Factor "f": a "field" source cannot use a fallback',
		])
		expect(scanFactor(createStaticFactor('f', 1, { fallback: 0 }))).toEqual([
			'Factor "f": a "static" source cannot use a fallback',
		])
	})

	it('reads the checks gating the factor', () => {
		expect(
			scanFactor(createStaticFactor('f', 1, { checks: [createCheck('a', 'above', 'x')] })),
		).toEqual(['Check on "a": "above" needs a finite number'])
	})
})

describe('scanSymbolicExpression', () => {
	it('a leaf and a unary operation need no right side', () => {
		expect(scanSymbolicExpression(createConstant(1))).toEqual([])
		expect(scanSymbolicExpression(createVariable('x'))).toEqual([])
		for (const operator of ['round', 'ceil', 'floor', 'abs'] as const) {
			expect(scanSymbolicExpression(createOperation(operator, createConstant(1)))).toEqual([])
		}
	})

	it('a binary operation does, at any depth', () => {
		expect(
			scanSymbolicExpression(createOperation('add', createConstant(1), createConstant(2))),
		).toEqual([])
		expect(scanSymbolicExpression(createOperation('add', createConstant(1)))).toEqual([
			'Operation "add" has no right side',
		])
		expect(
			scanSymbolicExpression(
				createOperation(
					'add',
					createOperation('multiply', createConstant(1)),
					createOperation('abs', createOperation('divide', createConstant(1))),
				),
			),
		).toEqual(['Operation "multiply" has no right side', 'Operation "divide" has no right side'])
	})
})

describe('collectVariables', () => {
	it('reads every variable, repeats kept, and no constants', () => {
		expect(collectVariables(createConstant(1))).toEqual([])
		expect(collectVariables(createVariable('x'))).toEqual(['x'])
		expect(
			collectVariables(
				createOperation(
					'add',
					createVariable('x'),
					createOperation('multiply', createVariable('y'), createVariable('x')),
				),
			),
		).toEqual(['x', 'y', 'x'])
		expect(collectVariables(createOperation('abs', createVariable('x')))).toEqual(['x'])
	})
})

describe('describeFault', () => {
	it('names each reason', () => {
		expect(describeFault({ reason: 'missing', path: 'age', expected: 'number' })).toBe(
			'Field "age" is missing',
		)
		expect(
			describeFault({ reason: 'type', path: ['a', 'b'], expected: 'number', received: '"x"' }),
		).toBe('Field "a.b" expected number, received "x"')
		expect(
			describeFault({
				reason: 'constraint',
				path: 'a',
				expected: 'number',
				constraint: 'min',
				received: '1',
			}),
		).toBe('Field "a" breaks its min constraint, received 1')
		expect(describeFault({ reason: 'variant', path: 'a', variants: 2 })).toBe(
			'Field "a" matches none of its 2 variants',
		)
		expect(describeFault({ reason: 'oneOf', path: 'a', matched: 0 })).toBe(
			'Field "a" matches 0 of its variants, not exactly one',
		)
		expect(describeFault({ reason: 'extra', path: ['a'] })).toBe('Field "a" is not declared')
	})
})

describe('valueToFault, valueToKind, and readExpectedKind', () => {
	it('an absent field is missing and anything else is the wrong type', () => {
		expect(valueToFault('a', 'number', undefined)).toEqual({
			reason: 'missing',
			path: 'a',
			expected: 'number',
		})
		expect(valueToFault('a', 'number', 'x')).toEqual({
			reason: 'type',
			path: 'a',
			expected: 'number',
			received: '"x"',
		})
		expect(valueToFault('a', 'number', null)).toEqual({
			reason: 'type',
			path: 'a',
			expected: 'number',
			received: 'null',
		})
	})

	it('names a value', () => {
		expect(valueToKind(null)).toBe('null')
		expect(valueToKind('a')).toBe('string')
		expect(valueToKind(false)).toBe('boolean')
		expect(valueToKind(1)).toBe('number')
		expect(valueToKind({})).toBe('json')
	})

	it('names what a check needed', () => {
		expect(readExpectedKind(createCheck('a', 'above', 1))).toBe('number')
		expect(readExpectedKind(createCheck('a', 'between', [1, 2]))).toBe('number')
		expect(readExpectedKind(createCheck('a', 'equals', 'x'))).toBe('string')
		expect(readExpectedKind(createCheck('a', 'not', null))).toBe('null')
		expect(readExpectedKind(createCheck('a', 'any', ['x', 'y']))).toBe('string')
		expect(readExpectedKind(createCheck('a', 'none', ['x', 1]))).toBe('union')
		expect(readExpectedKind(createCheck('a', 'any', 'x'))).toBe('union')
	})
})

describe('filterUniqueFaults', () => {
	it('keeps the first fault of each flattened path', () => {
		const first = { reason: 'missing', path: ['a', 'b'], expected: 'number' } as const
		const second = { reason: 'extra', path: 'a.b' } as const
		const other = { reason: 'extra', path: 'c' } as const
		expect(filterUniqueFaults([first, second, other])).toEqual([first, other])
		expect(filterUniqueFaults([])).toEqual([])
	})
})

describe('buildRefusedResult', () => {
	it('carries the refusal on the empty result of the definition', () => {
		const fault = { reason: 'extra', path: 'x' } as const
		const refusal = { faults: [fault], repairs: [], defaulted: [], errors: ['no'] }
		const result = buildRefusedResult(createLogicalDefinition('d', 'd', []), refusal)
		expect(result).toMatchObject({
			reasoning: 'logical',
			conclusion: 'unread',
			success: false,
			errors: ['no'],
			faults: [fault],
		})
	})
})

describe('isLosslessRepair', () => {
	const number = { reason: 'type', path: ['a'], expected: 'number', received: '' } as const
	const integer = { reason: 'type', path: ['a'], expected: 'integer', received: '' } as const
	const literal = { reason: 'type', path: ['a'], expected: 'literal', received: '' } as const
	const boolean = { reason: 'type', path: ['a'], expected: 'boolean', received: '' } as const
	const string = { reason: 'type', path: ['a'], expected: 'string', received: '' } as const

	it('a number or literal needs a string whose trim is its own text', () => {
		expect(isLosslessRepair(number, { a: '30' }, { a: 30 })).toBe(true)
		expect(isLosslessRepair(number, { a: ' 30 ' }, { a: 30 })).toBe(true)
		expect(isLosslessRepair(integer, { a: '30' }, { a: 30 })).toBe(true)
		expect(isLosslessRepair(literal, { a: ' CA ' }, { a: 'CA' })).toBe(true)
		expect(isLosslessRepair(number, { a: '30.0' }, { a: 30 })).toBe(false)
		expect(isLosslessRepair(number, { a: '-0' }, { a: -0 })).toBe(false)
		expect(isLosslessRepair(number, { a: 30 }, { a: 30 })).toBe(false)
		expect(isLosslessRepair(number, { a: '30' }, {})).toBe(false)
	})

	it('a boolean needs its own word, and a string a finite number', () => {
		expect(isLosslessRepair(boolean, { a: 'true' }, { a: true })).toBe(true)
		expect(isLosslessRepair(boolean, { a: 'false' }, { a: false })).toBe(true)
		expect(isLosslessRepair(boolean, { a: '1' }, { a: true })).toBe(false)
		expect(isLosslessRepair(boolean, { a: 1 }, { a: true })).toBe(false)
		expect(isLosslessRepair(string, { a: 5 }, { a: '5' })).toBe(true)
		expect(isLosslessRepair(string, { a: true }, { a: 'true' })).toBe(false)
	})

	it('anything but a type fault of a known kind is no repair', () => {
		expect(isLosslessRepair({ reason: 'extra', path: 'a' }, { a: 1 }, {})).toBe(false)
		expect(
			isLosslessRepair({ reason: 'missing', path: 'a', expected: 'number' }, {}, { a: 1 }),
		).toBe(false)
		expect(
			isLosslessRepair(
				{ reason: 'type', path: 'a', expected: 'json', received: '' },
				{ a: 1 },
				{ a: 1 },
			),
		).toBe(false)
	})

	it('reads a nested path', () => {
		const nested = { reason: 'type', path: ['o', 'a'], expected: 'number', received: '' } as const
		expect(isLosslessRepair(nested, { o: { a: '1' } }, { o: { a: 1 } })).toBe(true)
	})
})

describe('projectValue', () => {
	it('keeps JSON, nulls a non-finite number, and omits what JSON cannot hold', () => {
		expect(projectValue(1)).toBe(1)
		expect(projectValue('a')).toBe('a')
		expect(projectValue(null)).toBe(null)
		expect(projectValue(Number.NaN)).toBe(null)
		expect(projectValue(Number.POSITIVE_INFINITY)).toBe(null)
		expect(projectValue(undefined)).toBeUndefined()
		expect(projectValue(1n)).toBeUndefined()
		expect(projectValue(new Date(0))).toBeUndefined()
		expect(projectValue({ a: Number.NaN, b: undefined, c: [1, undefined] })).toEqual({
			a: null,
			c: [1, null],
		})
	})

	it('a hole in an array is null, so the result is JSON', () => {
		const holes = sparse<number>(3, [[0, 1]])
		const projected = projectValue(holes)
		expect(projected).toEqual([1, null, null])
		expect(Object.keys(projected ?? {})).toEqual(['0', '1', '2'])
	})

	it('drops a reference back to an ancestor', () => {
		const cyclic: Record<string, unknown> = { keep: 1 }
		cyclic.self = cyclic
		expect(projectValue(cyclic)).toEqual({ keep: 1 })
		const ring: unknown[] = [1]
		ring.push(ring)
		expect(projectValue(ring)).toEqual([1, null])
	})

	it('a value sharing its sub-objects cannot unfold without end', () => {
		const shared = buildSharedNest(60)
		expect(JSON.stringify(projectValue(shared)).length).toBeLessThan(1_000_000)
	})

	it('a value that throws on being read is dropped, and nothing throws', () => {
		expect(projectValue(HOSTILE_VALUE)).toBeUndefined()
		expect(projectValue({ inner: HOSTILE_VALUE, keep: 1 })).toEqual({ keep: 1 })
		expect(projectValue({ proxy: HOSTILE_PROXY, keep: 1 })).toEqual({ keep: 1 })
	})

	it('a value past the depth limit is dropped rather than overflowing', () => {
		expect(() => projectValue(deepCompound(5000, createAtom('a', 'equals', 1)))).not.toThrow()
	})
})

describe('scanConclusionValues, describeMismatch, and describeTerms', () => {
	it('finds one key asserted with two values, and leaves one value alone', () => {
		const one = createAtom('k', 'equals', 1)
		const two = createAtom('k', 'equals', 2)
		expect(scanConclusionValues(createCompound('and', [one, two]))).toEqual([
			'Conclusion asserts two values for "k"',
		])
		expect(scanConclusionValues(createCompound('and', [one, one]))).toEqual([])
		expect(scanConclusionValues(one)).toEqual([])
	})

	it('describes what a definition reaching validate holds, whatever it is', () => {
		expect(describeMismatch('logical', { reasoning: 'symbolic' })).toBe(
			'Expected reasoning "logical", got "symbolic"',
		)
		expect(describeMismatch('logical', null)).toBe('Expected reasoning "logical", got null')
		expect(describeMismatch('logical', { reasoning: Symbol('x') })).toContain('Expected reasoning')
		expect(describeMismatch('logical', { reasoning: Object.create(null) })).toContain(
			'Expected reasoning',
		)
	})

	it('describes a term that a template would throw on', () => {
		expect(describeTerms(['a', 1, true])).toBe('a, 1, true')
		expect(describeTerms([Symbol('s')])).toContain('s')
		expect(() => describeTerms([Object.create(null)])).not.toThrow()
	})
})

describe('extractConclusions — keys', () => {
	it('holds a key named __proto__ as its own data', () => {
		const conclusions = extractConclusions(createAtom('__proto__', 'equals', true))
		expect(Object.keys(conclusions)).toEqual(['__proto__'])
		expect(Object.getPrototypeOf(conclusions)).toBe(Object.prototype)
	})
})

describe('findFilledPaths', () => {
	it('lists what the output holds and the input left absent or undefined', () => {
		expect(findFilledPaths({ a: 1 }, { a: 1, b: 2 })).toEqual([['b']])
		expect(findFilledPaths({ b: undefined }, { b: 2 })).toEqual([['b']])
		expect(findFilledPaths({ a: 1 }, { a: 1 })).toEqual([])
	})

	it('descends objects and arrays, and reports a default of null', () => {
		expect(findFilledPaths({ o: {} }, { o: { c: 3 } })).toEqual([['o', 'c']])
		expect(findFilledPaths({ l: [{}] }, { l: [{ c: 3 }] })).toEqual([['l', '0', 'c']])
		expect(findFilledPaths({}, { n: null })).toEqual([['n']])
	})

	it('a repaired value is no fill', () => {
		expect(findFilledPaths({ a: '1' }, { a: 1 })).toEqual([])
	})

	it('a value handed back by identity holds no fill, however it shares its parts', () => {
		const shared = buildSharedNest(60)
		expect(findFilledPaths({ blob: shared }, { blob: shared })).toEqual([])
	})
})

describe('findFieldShape', () => {
	const city = stringShape()
	const shape = objectShape({
		age: numberShape(),
		maybe: optionalShape(numberShape()),
		spouse: nullableShape(numberShape()),
		address: objectShape({ city }),
		list: arrayShape(numberShape()),
		either: unionShape(numberShape(), stringShape()),
		raw: rawShape({}),
		json: jsonShape(),
		open: objectShape({}, { additionalProperties: true }),
	})

	it('reads a key, removing optional and keeping nullable', () => {
		expect(findFieldShape(shape, 'age')).toEqual({ declared: true, shape: numberShape() })
		expect(findFieldShape(shape, 'maybe')).toEqual({ declared: true, shape: numberShape() })
		expect(findFieldShape(shape, 'spouse').shape?.category).toBe('nullable')
	})

	it('a string is one key, and an array descends', () => {
		expect(findFieldShape(shape, ['address', 'city']).shape).toEqual(city)
		expect(findFieldShape(shape, 'address.city').declared).toBe(false)
		expect(findFieldShape(shape, ['list', '0']).shape?.category).toBe('number')
		expect(findFieldShape(shape, ['list', 'x']).declared).toBe(false)
		expect(findFieldShape(shape, ['age', 'x']).declared).toBe(false)
	})

	it('an undeclared key is undeclared, including a name on the prototype', () => {
		expect(findFieldShape(shape, 'agee').declared).toBe(false)
		expect(findFieldShape(shape, 'toString').declared).toBe(false)
	})

	it('past an open object, a union, raw, or json it can say nothing', () => {
		expect(findFieldShape(shape, ['open', 'x'])).toEqual({ declared: true })
		expect(findFieldShape(shape, ['either', 'x'])).toEqual({ declared: true })
		expect(findFieldShape(shape, ['raw', 'x'])).toEqual({ declared: true, shape: rawShape({}) })
		expect(findFieldShape(shape, ['json', 'x'])).toEqual({ declared: true, shape: jsonShape() })
	})

	it('additional properties of a shape read that shape', () => {
		const record = objectShape({}, { additionalProperties: numberShape() })
		expect(findFieldShape(record, 'any').shape?.category).toBe('number')
	})
})

describe('isUntypedShape and admitsLiteral', () => {
	it('raw and json type nothing', () => {
		expect(isUntypedShape(rawShape({}))).toBe(true)
		expect(isUntypedShape(jsonShape())).toBe(true)
		expect(isUntypedShape(numberShape())).toBe(false)
		expect(isUntypedShape(undefined)).toBe(false)
	})

	it('a string needs a literal holding it, through nullable and union', () => {
		const states = literalShape(['FL', 'CA'])
		expect(admitsLiteral(states, 'FL')).toBe(true)
		expect(admitsLiteral(states, 'NY')).toBe(false)
		expect(admitsLiteral(nullableShape(states), 'FL')).toBe(true)
		expect(admitsLiteral(unionShape(numberShape(), states), 'CA')).toBe(true)
		expect(admitsLiteral(stringShape(), 'FL')).toBe(false)
	})
})

describe('scanShape', () => {
	it('accepts an object of plain fields', () => {
		const shape = objectShape({
			age: numberShape(),
			list: arrayShape(stringShape()),
			maybe: optionalShape(booleanShape()),
		})
		expect(scanShape(shape)).toEqual([])
	})

	it('the root is an object', () => {
		expect(scanShape(numberShape())).toEqual(['Shape must describe an object'])
		expect(scanShape(objectShape({}, { additionalProperties: numberShape() }))).toEqual([])
		expect(
			scanShape(objectShape({}, { additionalProperties: stringShape({ pattern: /x/ }) })),
		).toEqual(['Field "*" carries a pattern, which does not survive JSON'])
	})

	it('a pattern refuses, wherever it sits', () => {
		const pattern = stringShape({ pattern: /x/ })
		const message = 'Field "a" carries a pattern, which does not survive JSON'
		expect(scanShape(objectShape({ a: pattern }))).toEqual([message])
		expect(scanShape(objectShape({ a: optionalShape(pattern) }))).toEqual([message])
		expect(scanShape(objectShape({ a: nullableShape(pattern) }))).toEqual([message])
		expect(scanShape(objectShape({ a: arrayShape(pattern) }))).toEqual([message])
		expect(scanShape(objectShape({ a: unionShape(pattern, numberShape()) }))).toEqual([message])
		expect(scanShape(objectShape({ o: objectShape({ a: pattern }) }))).toEqual([
			'Field "o.a" carries a pattern, which does not survive JSON',
		])
	})

	it('a required key with a default refuses, since the keyword is only an annotation there', () => {
		// Built by hand, as a stored definition arrives.
		const restored = { category: 'raw', schema: { type: 'number', default: 3 } } as const
		const required = { category: 'object', properties: { a: restored } } as const
		const optional = {
			category: 'object',
			properties: { a: { category: 'optional', inner: restored } },
		} as const
		expect(scanShape(required)).toEqual(['Field "a" is required and carries a default'])
		expect(scanShape(optional)).toEqual([])
	})
})

describe('scanShapeReads and scanCheckExpected', () => {
	const shape = objectShape({
		age: numberShape(),
		state: literalShape(['FL', 'CA']),
		name: stringShape(),
		spouse: nullableShape(numberShape()),
		raw: rawShape({}),
		json: jsonShape(),
	})
	const none = new Set<string>()

	it('a declared path with a fitting expected value is clean', () => {
		const checks = [
			createCheck('age', 'above', 18),
			createCheck('age', 'between', [1, 2]),
			createCheck('state', 'equals', 'FL'),
			createCheck('state', 'any', ['FL', 'CA']),
			createCheck('spouse', 'not', null),
		]
		expect(scanShapeReads(shape, checks, [], none)).toEqual({ errors: [], warnings: [] })
	})

	it('a path the shape does not declare refuses, whether a check or a source reads it', () => {
		expect(scanShapeReads(shape, [createCheck('agee', 'above', 1)], [], none).errors).toEqual([
			'Field "agee" is read, and the shape does not declare it',
		])
		expect(scanShapeReads(shape, [], ['agee'], none).errors).toEqual([
			'Field "agee" is read, and the shape does not declare it',
		])
	})

	it('a key the definition produces itself needs no declaration', () => {
		const known = new Set(['adult'])
		expect(scanShapeReads(shape, [createCheck('adult', 'equals', true)], [], known).errors).toEqual(
			[],
		)
	})

	it('reports one message per path', () => {
		const checks = [createCheck('agee', 'above', 1), createCheck('agee', 'below', 9)]
		expect(scanShapeReads(shape, checks, ['agee'], none).errors).toHaveLength(1)
	})

	it('an expected value the field cannot hold refuses, per element of a list', () => {
		expect(scanCheckExpected(shape, createCheck('age', 'equals', '18'), none)).toEqual([
			'Check on "age": "18" is not a value of this field',
		])
		expect(scanCheckExpected(shape, createCheck('state', 'any', ['FL', 'NY']), none)).toEqual([
			'Check on "state": "NY" is not a value of this field',
		])
		expect(scanCheckExpected(shape, createCheck('age', 'not', null), none)).toEqual([
			'Check on "age": null is not a value of this field',
		])
	})

	it('free text is never compared by equality', () => {
		expect(scanCheckExpected(shape, createCheck('name', 'equals', 'Ann'), none)).toEqual([
			'Check on "name": a string compares only against a field that declares it as a literal',
		])
	})

	it('a raw or json read warns and checks nothing, because the typed read is the backstop', () => {
		const checks = [createCheck('raw', 'above', 1), createCheck('json', 'equals', 'x')]
		expect(scanShapeReads(shape, checks, [], none)).toEqual({
			errors: [],
			warnings: [
				'Field "raw" is read through a shape that types nothing',
				'Field "json" is read through a shape that types nothing',
			],
		})
	})
})

describe('scanShapeConclusions', () => {
	const rule = createFlagRule('r', 'ok')

	it('refuses a shape declaring a key a rule concludes', () => {
		expect(scanShapeConclusions(objectShape({ ok: booleanShape() }), [rule])).toEqual([
			'Shape declares conclusion "ok"',
		])
		expect(scanShapeConclusions(objectShape({ x: numberShape() }), [rule])).toEqual([])
	})

	it('an open object says nothing about the key, so nothing refuses', () => {
		const open = objectShape({}, { additionalProperties: true })
		expect(scanShapeConclusions(open, [rule])).toEqual([])
	})
})
