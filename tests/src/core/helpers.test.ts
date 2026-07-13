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
	atom,
	bounds,
	buildErrorResult,
	check,
	clamp,
	clearInferentialDefinition,
	clearLogicalDefinition,
	clearQuantitativeDefinition,
	clearSymbolicDefinition,
	compound,
	constant,
	containsVariable,
	equalValues,
	equation,
	extractAtoms,
	extractConclusions,
	fact,
	factToArityKey,
	factToKey,
	factorGroup,
	fieldFactor,
	fieldSource,
	findDuplicates,
	findOverlayMismatches,
	findUnboundVariables,
	formatField,
	indexByArity,
	inference,
	inferentialDefinition,
	instantiateFact,
	invertLeft,
	invertRight,
	isReasonError,
	logicalDefinition,
	lookupFactor,
	lookupSource,
	matchFacts,
	mergeById,
	mergeInferentialDefinition,
	mergeLogicalDefinition,
	mergeQuantitativeDefinition,
	mergeSubjects,
	mergeSymbolicDefinition,
	operation,
	parseDefinition,
	prependById,
	prependEquation,
	prependFact,
	prependFactor,
	prependGroup,
	prependInference,
	prependRule,
	quantitativeDefinition,
	rangeFactor,
	rangeSource,
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
	roundTo,
	rule,
	sortByPriority,
	staticFactor,
	staticSource,
	subjectToFacts,
	symbolicDefinition,
	termToKey,
	transform,
	variable,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	ADVERSARIAL_VALUE_SUBJECT,
	EXTREME_NUMBERS,
	INTEGER_KEY_SUBJECT,
	TRICKY_KEYS,
	captureError,
	deepAddition,
	deepCompound,
	deepFreeze,
	invokeRaw,
	sequence,
	sparse,
} from '../../setup.js'

// The reasons builders + helpers — every builder's exact output shape (fresh
// JSON-serializable values), absent optional keys OMITTED entirely (so outputs
// round-trip the exact-record validators — pinned via Object.keys, the guard
// round-trip itself lives in integration.test.ts), `name` defaulting to the
// `id`, override bags merged LAST (an override wins over a default), the
// `clamp` / `roundTo` numerics (inverted bounds, negative and
// overflowing precisions included), and the shared reasoner machinery:
// `equalValues` (SameValueZero derivation equality), `sortByPriority` (stable
// ascending copy sort), and `findDuplicates` (the validate uniqueness scan).
// Ports the scsr builder surface onto the renamed vocabulary (DESIGN §2:
// origin / form discriminants, checks, terms, name).

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

describe('check / atom / compound — expression builders', () => {
	it('check builds the field / operator / value triple', () => {
		expect(check('age', 'from', 18)).toEqual({ field: 'age', operator: 'from', value: 18 })
	})

	it('check carries an array field path and any value (including null)', () => {
		expect(check(['address', 'city'], 'equals', null)).toEqual({
			field: ['address', 'city'],
			operator: 'equals',
			value: null,
		})
	})

	it('atom wraps one check as a leaf expression', () => {
		expect(atom('age', 'from', 18)).toEqual({
			form: 'atom',
			check: { field: 'age', operator: 'from', value: 18 },
		})
	})

	it('compound nests operands under a connective', () => {
		expect(compound('and', [atom('a', 'equals', true), atom('b', 'equals', true)])).toEqual({
			form: 'compound',
			operator: 'and',
			operands: [atom('a', 'equals', true), atom('b', 'equals', true)],
		})
	})
})

describe('rule — builder', () => {
	it('defaults name to the id and omits absent optional keys', () => {
		const built = rule('adult', [atom('age', 'from', 18)], atom('adult', 'equals', true))
		expect(built.name).toBe('adult')
		expect(Object.keys(built).sort()).toEqual(['conclusion', 'id', 'name', 'premises'])
	})

	it('merges overrides last — an override wins over a default', () => {
		const built = rule('adult', [], atom('x', 'equals', 1), {
			name: 'Adult rule',
			priority: 5,
			enabled: false,
		})
		expect(built.name).toBe('Adult rule')
		expect(built.priority).toBe(5)
		expect(built.enabled).toBe(false)
	})
})

describe('transform / bounds — builders', () => {
	it('transform omits the operand key entirely when absent', () => {
		expect(transform('multiply', 2)).toEqual({ operation: 'multiply', operand: 2 })
		expect(transform('round')).toEqual({ operation: 'round' })
		expect(Object.keys(transform('round'))).toEqual(['operation'])
	})

	it('bounds omits absent sides entirely', () => {
		expect(bounds(0, 100)).toEqual({ minimum: 0, maximum: 100 })
		expect(bounds(undefined, 100)).toEqual({ maximum: 100 })
		expect(bounds(5)).toEqual({ minimum: 5 })
		expect(bounds()).toEqual({})
		expect(Object.keys(bounds(undefined, 100))).toEqual(['maximum'])
	})
})

describe('variable / constant / operation / equation — symbolic builders', () => {
	it('variable and constant build leaves', () => {
		expect(variable('x')).toEqual({ form: 'variable', name: 'x' })
		expect(constant(42)).toEqual({ form: 'constant', value: 42 })
	})

	it('operation omits the right key when absent (unary form)', () => {
		expect(operation('add', variable('x'), constant(1))).toEqual({
			form: 'operation',
			operator: 'add',
			left: variable('x'),
			right: constant(1),
		})
		const unary = operation('abs', variable('x'))
		expect(unary).toEqual({ form: 'operation', operator: 'abs', left: variable('x') })
		expect(Object.keys(unary).sort()).toEqual(['form', 'left', 'operator'])
	})

	it('equation defaults name to the id and merges overrides', () => {
		const built = equation('e1', variable('x'), constant(42), 'x')
		expect(built).toEqual({
			id: 'e1',
			name: 'e1',
			left: variable('x'),
			right: constant(42),
			target: 'x',
		})
		expect(equation('e1', variable('x'), constant(42), 'x', { name: 'Solve x' }).name).toBe(
			'Solve x',
		)
	})
})

describe('fact / inference — builders', () => {
	it('fact ALWAYS sets confidence (defaulting to 1)', () => {
		expect(fact('f1', 'human', ['socrates'])).toEqual({
			id: 'f1',
			predicate: 'human',
			terms: ['socrates'],
			confidence: 1,
		})
		expect(fact('f2', 'laysEggs', ['tweety'], 0.9).confidence).toBe(0.9)
	})

	it('inference defaults name to the id and merges overrides', () => {
		const built = inference('mortal', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']))
		expect(built.name).toBe('mortal')
		expect(Object.keys(built).sort()).toEqual(['conclusion', 'id', 'name', 'premises'])
		const overridden = inference('mortal', [], fact('c1', 'mortal', ['?x']), {
			confidence: 0.8,
			enabled: false,
		})
		expect(overridden.confidence).toBe(0.8)
		expect(overridden.enabled).toBe(false)
	})
})

describe('source builders — the four origins', () => {
	it('staticSource / fieldSource / lookupSource / rangeSource carry their origin', () => {
		expect(staticSource(42)).toEqual({ origin: 'static', value: 42 })
		expect(fieldSource(['profile', 'score'])).toEqual({
			origin: 'field',
			field: ['profile', 'score'],
		})
		expect(lookupSource('state', { CA: 5 })).toEqual({
			origin: 'lookup',
			field: 'state',
			table: { CA: 5 },
		})
		expect(rangeSource('age', [{ bounds: { maximum: 25 }, value: 10 }])).toEqual({
			origin: 'range',
			field: 'age',
			ranges: [{ bounds: { maximum: 25 }, value: 10 }],
		})
	})
})

describe('factor builders — one per source origin', () => {
	it('staticFactor defaults name to the id, wraps a static source, omits absent keys', () => {
		const built = staticFactor('f1', 10)
		expect(built).toEqual({ id: 'f1', name: 'f1', source: { origin: 'static', value: 10 } })
		expect(Object.keys(built).sort()).toEqual(['id', 'name', 'source'])
	})

	it('staticFactor merges overrides last (name / weight / priority / required)', () => {
		const built = staticFactor('f1', 10, {
			name: 'Base',
			weight: 2,
			priority: 1,
			required: true,
		})
		expect(built.name).toBe('Base')
		expect(built.weight).toBe(2)
		expect(built.priority).toBe(1)
		expect(built.required).toBe(true)
	})

	it('fieldFactor wraps a field source and threads overrides', () => {
		const built = fieldFactor('income', 'income', { fallback: 0, transforms: [transform('round')] })
		expect(built.source).toEqual({ origin: 'field', field: 'income' })
		expect(built.fallback).toBe(0)
		expect(built.transforms).toEqual([{ operation: 'round' }])
	})

	it('lookupFactor wraps a lookup source', () => {
		const built = lookupFactor('state', 'state', { CA: 5 }, { fallback: 1 })
		expect(built.source).toEqual({ origin: 'lookup', field: 'state', table: { CA: 5 } })
		expect(built.fallback).toBe(1)
	})

	it('rangeFactor wraps a range source', () => {
		const built = rangeFactor('band', 'age', [{ value: 42 }])
		expect(built.source).toEqual({ origin: 'range', field: 'age', ranges: [{ value: 42 }] })
	})
})

describe('factorGroup — builder', () => {
	it('defaults name to the id and omits absent optional keys', () => {
		const built = factorGroup('g1', 'sum', [staticFactor('f1', 10)])
		expect(built.name).toBe('g1')
		expect(built.aggregation).toBe('sum')
		expect(Object.keys(built).sort()).toEqual(['aggregation', 'factors', 'id', 'name'])
	})

	it('merges overrides last (base / bounds / strict / enabled)', () => {
		const built = factorGroup('g1', 'product', [], {
			base: 100,
			bounds: bounds(0, 50),
			strict: true,
			enabled: false,
		})
		expect(built.base).toBe(100)
		expect(built.bounds).toEqual({ minimum: 0, maximum: 50 })
		expect(built.strict).toBe(true)
		expect(built.enabled).toBe(false)
	})
})

describe('definition builders — defaults & overrides', () => {
	it('quantitativeDefinition fixes the reasoning and defaults aggregation to "sum"', () => {
		const built = quantitativeDefinition('risk', 'Risk', [])
		expect(built.reasoning).toBe('quantitative')
		expect(built.aggregation).toBe('sum')
		expect(Object.keys(built).sort()).toEqual(['aggregation', 'groups', 'id', 'name', 'reasoning'])
		expect(quantitativeDefinition('risk', 'Risk', [], { aggregation: 'product' }).aggregation).toBe(
			'product',
		)
		expect(quantitativeDefinition('risk', 'Risk', [], { base: 10, precision: 2 }).base).toBe(10)
	})

	it('logicalDefinition defaults strategy to "forward"', () => {
		const built = logicalDefinition('elig', 'Eligibility', [])
		expect(built.reasoning).toBe('logical')
		expect(built.strategy).toBe('forward')
		expect(logicalDefinition('elig', 'Eligibility', [], { strategy: 'backward' }).strategy).toBe(
			'backward',
		)
		expect(logicalDefinition('elig', 'Eligibility', [], { depth: 5 }).depth).toBe(5)
	})

	it('symbolicDefinition defaults variables to {}', () => {
		const built = symbolicDefinition('rate', 'Rate', [])
		expect(built.reasoning).toBe('symbolic')
		expect(built.variables).toEqual({})
		expect(
			symbolicDefinition('rate', 'Rate', [], { variables: { pi: 3.14 }, precision: 2 }).variables,
		).toEqual({ pi: 3.14 })
	})

	it('inferentialDefinition defaults strategy to "forward"', () => {
		const built = inferentialDefinition('birds', 'Birds', [], [])
		expect(built.reasoning).toBe('inferential')
		expect(built.strategy).toBe('forward')
		expect(built.facts).toEqual([])
		expect(built.inferences).toEqual([])
		expect(
			inferentialDefinition('birds', 'Birds', [], [], { strategy: 'backward', depth: 3 }).depth,
		).toBe(3)
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

	it('returns a FRESH array and never mutates the input (AGENTS §11)', () => {
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
		const only: readonly { readonly id: string; readonly priority?: number }[] = [{ id: 'only' }]
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
		): readonly { readonly id: string; readonly priority?: number }[] =>
			sortByPriority<{ readonly id: string; readonly priority?: number }>(args[0])
		const sorted = invokeRaw<readonly { readonly id: string }[]>(undefined, sortByPriorityRaw, [
			items,
		])
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
	it('preserves a negative-zero result (sign asserted via Object.is)', () => {
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

	it('yields -0 only when the -0 minimum wins (sign asserted via Object.is)', () => {
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
// methods (AGENTS §5 / §7): the inferential fact machinery (indexing, term /
// fact keying, unification, instantiation, subject projection), the symbolic
// algebra (variable presence, left / right inversion, operation application),
// the logical conclusion flattening, and the orchestrator's failure-result
// builder. Behavior is byte-identical to the in-class versions except
// `factToKey`'s length-prefixed framing, which closes an injectivity hole where
// an adversarial NUL / delimiter-shaped string term could forge the key.

describe('factToArityKey — predicate+arity bucket key', () => {
	it('gives the same predicate + same arity the same key', () => {
		expect(factToArityKey(fact('a', 'rel', ['x', 'y']))).toBe(
			factToArityKey(fact('b', 'rel', [1, 2])),
		)
	})

	it('distinguishes different arities under the same predicate', () => {
		expect(factToArityKey(fact('a', 'rel', ['x', 'y']))).not.toBe(
			factToArityKey(fact('b', 'rel', ['x', 'y', 'z'])),
		)
	})

	it('distinguishes different predicates at the same arity', () => {
		expect(factToArityKey(fact('a', 'human', ['x']))).not.toBe(
			factToArityKey(fact('b', 'robot', ['x'])),
		)
	})

	it('is INJECTIVE against a forged delimiter — a predicate embedding a space never collides', () => {
		// Under a naive `${predicate} ${arity}` join, predicate "p 2" (arity 2)
		// and predicate "p" (impossible arity "2 2") would both flatten toward
		// "p 2 2" — length-prefixing the predicate keeps them distinct.
		const forged = factToArityKey(fact('a', 'p 2', ['x', 'y']))
		const other = factToArityKey(fact('b', 'p', ['x', 'y']))
		expect(forged).not.toBe(other)
		expect(forged).toBe('3:p 2 2')
		expect(other).toBe('1:p 2')
	})
})

describe('indexByArity — buckets facts by predicate+arity', () => {
	it('groups facts under their predicate+arity, preserving append order', () => {
		const facts = [
			fact('a', 'rel', ['x', 'y']),
			fact('b', 'rel', ['x', 'y', 'z']),
			fact('c', 'rel', ['p', 'q']),
		]
		const index = indexByArity(facts)
		expect(
			index.get(factToArityKey(fact('probe', 'rel', ['?x', '?y'])))?.map((entry) => entry.id),
		).toEqual(['a', 'c'])
		expect(
			index.get(factToArityKey(fact('probe', 'rel', ['?x', '?y', '?z'])))?.map((entry) => entry.id),
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
		expect(factToKey(fact('a', 'p', ['x'], 1), identities)).toBe(
			factToKey(fact('b', 'p', ['x'], 0.5), identities),
		)
	})

	it('collapses ±0 and matches NaN terms across facts', () => {
		const identities = new Map<object, number>()
		expect(factToKey(fact('a', 'p', [-0], 1), identities)).toBe(
			factToKey(fact('b', 'p', [0], 1), identities),
		)
		expect(factToKey(fact('a', 'p', [Number.NaN], 1), identities)).toBe(
			factToKey(fact('b', 'p', [Number.NaN], 1), identities),
		)
	})

	it('distinguishes predicate and arity', () => {
		const identities = new Map<object, number>()
		expect(factToKey(fact('a', 'p', ['x'], 1), identities)).not.toBe(
			factToKey(fact('b', 'q', ['x'], 1), identities),
		)
		expect(factToKey(fact('a', 'p', ['x'], 1), identities)).not.toBe(
			factToKey(fact('b', 'p', ['x', 'y'], 1), identities),
		)
	})

	it('is INJECTIVE against a forged delimiter — two distinct facts never collide', () => {
		// Under a naive join these two arity-2 facts collide: term keys
		// ['string:a string:b', 'string:c'] and ['string:a', 'string:b string:c']
		// both flatten to 'string:a string:b string:c'. Length-prefixing frames each
		// part so the delimiter cannot be forged.
		const identities = new Map<object, number>()
		const forged = factToKey(fact('f1', 'likes', ['a string:b', 'c'], 1), identities)
		const other = factToKey(fact('f2', 'likes', ['a', 'b string:c'], 1), identities)
		expect(forged).not.toBe(other)
	})
})

describe('matchFacts — positional unification', () => {
	it('binds a pattern variable to the candidate term', () => {
		expect(
			matchFacts(fact('p', 'parent', ['?x', 'bob']), fact('f', 'parent', ['alice', 'bob'])),
		).toEqual({
			'?x': 'alice',
		})
	})

	it("a '?'-variable binds from EITHER side", () => {
		expect(matchFacts(fact('p', 'parent', ['alice']), fact('f', 'parent', ['?y']))).toEqual({
			'?y': 'alice',
		})
	})

	it('a constant mismatch fails to unify', () => {
		expect(matchFacts(fact('p', 'parent', ['a']), fact('f', 'parent', ['b']))).toBeUndefined()
	})

	it('a predicate or arity mismatch fails to unify', () => {
		expect(matchFacts(fact('p', 'parent', ['?x']), fact('f', 'human', ['x']))).toBeUndefined()
		expect(matchFacts(fact('p', 'parent', ['?x']), fact('f', 'parent', ['a', 'b']))).toBeUndefined()
	})

	it('enforces binding consistency for a repeated variable', () => {
		expect(matchFacts(fact('p', 'r', ['?x', '?x']), fact('f', 'r', ['a', 'a']))).toEqual({
			'?x': 'a',
		})
		expect(matchFacts(fact('p', 'r', ['?x', '?x']), fact('f', 'r', ['a', 'b']))).toBeUndefined()
	})
})

describe('instantiateFact — substitute bound variables', () => {
	it('substitutes bound variables and leaves unbound ones untouched', () => {
		expect(instantiateFact(fact('c', 'mortal', ['?x']), { '?x': 'socrates' }).terms).toEqual([
			'socrates',
		])
		expect(instantiateFact(fact('c', 'p', ['?x', '?y']), { '?x': 1 }).terms).toEqual([1, '?y'])
	})

	it('returns a fresh fact and never mutates the input', () => {
		const input = fact('c', 'p', ['?x'])
		const output = instantiateFact(input, { '?x': 9 })
		expect(output).not.toBe(input)
		expect(input.terms).toEqual(['?x'])
		expect(output.terms).toEqual([9])
	})
})

describe('subjectToFacts — subject field injection', () => {
	it('projects scalar fields into has(k, v) facts, skipping id / null / objects / arrays', () => {
		const trace: string[] = []
		const facts = subjectToFacts(
			{ id: 'p1', age: 42, name: 'bob', tags: ['a'], addr: {}, nil: null, und: undefined },
			trace,
		)
		expect(facts).toEqual([
			{ id: 'subject:age', predicate: 'has', terms: ['age', 42], confidence: 1 },
			{ id: 'subject:name', predicate: 'has', terms: ['name', 'bob'], confidence: 1 },
		])
	})

	it('threads the trace with a line per field plus a summary count', () => {
		const trace: string[] = []
		subjectToFacts({ age: 42 }, trace)
		expect(trace).toEqual(['Subject field "age" → has(age, 42)', 'Injected 1 fact(s) from subject'])
	})

	it('injects nothing (and does not touch the trace) for an id-only subject', () => {
		const trace: string[] = []
		expect(subjectToFacts({ id: 'p1' }, trace)).toEqual([])
		expect(trace).toEqual([])
	})
})

describe('findUnboundVariables — conclusion variables absent from every premise', () => {
	it('returns the conclusion variable no premise binds', () => {
		const conclusionFootgun = inference(
			'i1',
			[fact('p1', 'human', ['?x'])],
			fact('c1', 'mortal', ['?x', '?y']),
		)
		expect(findUnboundVariables(conclusionFootgun)).toEqual(['?y'])
		expect(findUnboundVariables(conclusionFootgun)).toEqual(['?y'])
	})

	it('returns empty when every conclusion variable is premise-bound', () => {
		const clean = inference('i2', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']))
		expect(findUnboundVariables(clean)).toEqual([])
		expect(findUnboundVariables(clean)).toEqual([])
	})

	it('returns empty when the conclusion is fully ground', () => {
		const ground = inference(
			'i3',
			[fact('p1', 'human', ['?x'])],
			fact('c1', 'mortal', ['socrates']),
		)
		expect(findUnboundVariables(ground)).toEqual([])
		expect(findUnboundVariables(ground)).toEqual([])
	})

	it('reports each unbound variable once, in authored order, ignoring non-string terms', () => {
		const multi = inference(
			'i4',
			[fact('p1', 'human', ['?x'])],
			fact('c1', 'triple', ['?y', '?z', '?y', 42, '?z']),
		)
		expect(findUnboundVariables(multi)).toEqual(['?y', '?z'])
		expect(findUnboundVariables(multi)).toEqual(['?y', '?z'])
	})
})

describe('containsVariable — unbound variable presence', () => {
	it('finds the target variable', () => {
		expect(containsVariable(variable('x'), 'x', {})).toBe(true)
		expect(containsVariable(variable('y'), 'x', {})).toBe(false)
	})

	it('does NOT count a pre-bound target', () => {
		expect(containsVariable(variable('x'), 'x', { x: 5 })).toBe(false)
	})

	it('recurses into nested operations (constants never match)', () => {
		const expression = operation(
			'add',
			operation('multiply', constant(2), variable('x')),
			constant(1),
		)
		expect(containsVariable(expression, 'x', {})).toBe(true)
		expect(containsVariable(expression, 'y', {})).toBe(false)
		expect(containsVariable(constant(3), 'x', {})).toBe(false)
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

	it('an unknown operator throws', () => {
		expect(captureError(() => applyOperation('bogus', 1, 2))).toBeInstanceOf(Error)
	})
})

describe('extractAtoms — atom leaves of an expression tree', () => {
	it('returns the atom itself for an atom leaf', () => {
		const leaf = atom('adult', 'equals', true)
		expect(extractAtoms(leaf)).toEqual([leaf])
	})

	it('flattens a compound into its operands depth-first, left-to-right', () => {
		const first = atom('a', 'equals', 1)
		const second = atom('b', 'equals', 2)
		expect(extractAtoms(compound('and', [first, second]))).toEqual([first, second])
	})

	it('recurses through nested compounds preserving authored order', () => {
		const a = atom('a', 'equals', 1)
		const b = atom('b', 'equals', 2)
		const c = atom('c', 'equals', 3)
		expect(extractAtoms(compound('or', [compound('and', [a, b]), c]))).toEqual([a, b, c])
	})

	it('flattens a 500-deep single-operand compound to its one leaf', () => {
		let expression = atom('leaf', 'equals', true)
		for (let depth = 0; depth < 500; depth += 1) expression = compound('and', [expression])
		expect(extractAtoms(expression)).toEqual([atom('leaf', 'equals', true)])
	})

	it('returns no atoms for a compound with empty operands', () => {
		expect(extractAtoms(compound('and', []))).toEqual([])
	})
})

describe('extractConclusions — flatten a logical conclusion', () => {
	it('asserts an atom as its formatField(field) = value pair', () => {
		expect(extractConclusions(atom('adult', 'equals', true))).toEqual({
			[formatField('adult')]: true,
		})
	})

	it('asserts EVERY atom even under not / or', () => {
		expect(
			extractConclusions(compound('or', [atom('a', 'equals', 1), atom('b', 'equals', 2)])),
		).toEqual({
			a: 1,
			b: 2,
		})
		expect(extractConclusions(compound('not', [atom('x', 'equals', 5)]))).toEqual({ x: 5 })
	})

	it('a later operand WINS a key clash', () => {
		expect(
			extractConclusions(compound('and', [atom('k', 'equals', 1), atom('k', 'equals', 2)])),
		).toEqual({ k: 2 })
	})

	it('an array field path flattens to its dot-joined key', () => {
		expect(extractConclusions(atom(['a', 'b'], 'equals', 7))).toEqual({
			[formatField(['a', 'b'])]: 7,
		})
	})
})

describe('findOverlayMismatches — cross-rule array-path overlay-key collision', () => {
	it('flags an array-path conclusion whose key is also read via an array-path premise', () => {
		const mismatched = [
			rule('a', [], atom(['address', 'city'], 'equals', 'NYC')),
			rule('b', [atom(['address', 'city'], 'equals', 'NYC')], atom('eligible', 'equals', true)),
		]
		expect(findOverlayMismatches(mismatched)).toEqual(['address.city'])
		expect(findOverlayMismatches(mismatched)).toEqual(['address.city'])
	})

	it('stays silent when the reading premise uses the dotted-string form instead', () => {
		const safe = [
			rule('a', [], atom(['address', 'city'], 'equals', 'NYC')),
			rule('b', [atom('address.city', 'equals', 'NYC')], atom('eligible', 'equals', true)),
		]
		expect(findOverlayMismatches(safe)).toEqual([])
		expect(findOverlayMismatches(safe)).toEqual([])
	})

	it('stays silent when every field is a plain string (no array paths anywhere)', () => {
		const allString = [
			rule('a', [], atom('adult', 'equals', true)),
			rule('b', [atom('adult', 'equals', true)], atom('eligible', 'equals', true)),
		]
		expect(findOverlayMismatches(allString)).toEqual([])
		expect(findOverlayMismatches(allString)).toEqual([])
	})

	it('stays silent when the array-path conclusion key is never read by any premise', () => {
		const unread = [
			rule('a', [], atom(['address', 'city'], 'equals', 'NYC')),
			rule('b', [atom('unrelated', 'equals', true)], atom('eligible', 'equals', true)),
		]
		expect(findOverlayMismatches(unread)).toEqual([])
	})

	it('returns each mismatched key once, in authored order, across many rules', () => {
		const rules = [
			rule('a', [], atom(['x', 'y'], 'equals', 1)),
			rule('b', [], atom(['p', 'q'], 'equals', 2)),
			rule('c', [atom(['x', 'y'], 'equals', 1)], atom('c1', 'equals', true)),
			rule('d', [atom(['x', 'y'], 'equals', 1)], atom('c2', 'equals', true)),
			rule('e', [atom(['p', 'q'], 'equals', 2)], atom('c3', 'equals', true)),
		]
		expect(findOverlayMismatches(rules)).toEqual(['x.y', 'p.q'])
	})
})

describe('buildErrorResult — empty type-shaped failure result', () => {
	it('builds the quantitative failure shape', () => {
		expect(buildErrorResult(quantitativeDefinition('q', 'Q', []), 'boom')).toEqual({
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
		expect(buildErrorResult(logicalDefinition('l', 'L', []), 'boom')).toEqual({
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
		expect(buildErrorResult(symbolicDefinition('s', 'S', []), 'boom')).toEqual({
			reasoning: 'symbolic',
			solutions: {},
			success: false,
			trace: [],
			errors: ['boom'],
		})
	})

	it('builds the inferential failure shape', () => {
		expect(buildErrorResult(inferentialDefinition('i', 'I', [], []), 'boom')).toEqual({
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
		const pattern = fact('p', 'r', sparse(3, [[0, 'a']]))
		const candidate = fact('f', 'r', sparse(3, [[0, 'a']]))
		expect(() => matchFacts(pattern, candidate)).not.toThrow()
		expect(matchFacts(pattern, candidate)).toEqual({})
	})

	it('hole-vs-value fails to unify (never throws)', () => {
		const pattern = fact('p', 'r', sparse(2, [[0, 'a']]))
		const candidate = fact(
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
		const input = fact('c', 'p', terms)
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
			fact(
				'a',
				'p',
				sparse(3, [
					[0, 'x'],
					[2, 'z'],
				]),
			),
			identities,
		)
		const denseKey = factToKey(fact('b', 'p', ['x', undefined, 'z']), identities)
		expect(sparseKey).toBe(denseKey)
	})

	it('arity/length still counts holes toward the key', () => {
		const identities = new Map<object, number>()
		const twoHoles = factToKey(fact('a', 'p', sparse(2, [[0, 'x']])), identities)
		const threeHoles = factToKey(fact('b', 'p', sparse(3, [[0, 'x']])), identities)
		expect(twoHoles).not.toBe(threeHoles)
	})

	it('same-shape sparse terms dedupe to the same key', () => {
		const identities = new Map<object, number>()
		const first = factToKey(
			fact(
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
			fact(
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
		const first = atom('a', 'equals', 1)
		const second = atom('c', 'equals', 3)
		const operands = sparse(3, [
			[0, first],
			[2, second],
		])
		expect(extractAtoms(compound('and', operands))).toEqual([first, second])
	})
})

describe('subjectToFacts — enumeration order (integer-like keys first)', () => {
	it('orders integer-like keys ascending, then string keys insertion-ordered, id skipped', () => {
		const run = () => {
			const trace: string[] = []
			return subjectToFacts(INTEGER_KEY_SUBJECT, trace)
		}
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
		const trace: string[] = []
		const facts = subjectToFacts(ADVERSARIAL_VALUE_SUBJECT, trace)
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
		const expression = compound('and', [
			atom('b', 'equals', 1),
			atom('10', 'equals', 10),
			atom('2', 'equals', 2),
			atom('a', 'equals', 9),
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
		const leaf = atom('leaf', 'equals', true)
		const expression = deepCompound(10000, leaf)
		expect(() => extractAtoms(expression)).not.toThrow()
		const first = extractAtoms(expression)
		const second = extractAtoms(expression)
		expect(first).toEqual([leaf])
		expect(second).toEqual([leaf])
		expect(first).toEqual(second)
	})

	it('containsVariable over a 10,000-deep addition finds a present name, misses an absent one, twice', () => {
		const expression = deepAddition(10000, variable('x'), constant(1))
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

// === Definitions & subjects capability layer (PROPOSAL.md §§5-12) ===========

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
		const appendByIdRaw = (...args: never[]): readonly Item[] => appendById<Item>(args[0], args[1])
		const result = invokeRaw<readonly Item[]>(undefined, appendByIdRaw, [items, { id: 'z' }])
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
		const removeByIdRaw = (...args: never[]): readonly Item[] => removeById<Item>(args[0], args[1])
		expect(() => invokeRaw(undefined, removeByIdRaw, [items, 'nope'])).not.toThrow()
	})
})

describe('mergeById — incoming-order-first upsert with base-only survivors', () => {
	it('matched ids resolve via the default (incoming-wins-wholesale), unmatched incoming leads', () => {
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
			quantitativeDefinition('risk', 'Risk', [factorGroup('g1', 'sum', [])]),
		)
		const appended = appendGroup(definition, factorGroup('g2', 'sum', []))
		expect(appended.groups.map((g) => g.id)).toEqual(['g1', 'g2'])

		const prepended = prependGroup(definition, factorGroup('g0', 'sum', []))
		expect(prepended.groups.map((g) => g.id)).toEqual(['g0', 'g1'])

		const replaced = replaceGroup(definition, factorGroup('g1', 'product', []))
		expect(replaced.groups).toEqual([factorGroup('g1', 'product', [])])

		expect(removeGroup(definition, 'g1').groups).toEqual([])
		expect(definition.groups).toEqual([factorGroup('g1', 'sum', [])]) // input untouched
	})

	it('appendGroup with a missing target throws ReasonError("TARGET")', () => {
		const definition = deepFreeze(quantitativeDefinition('risk', 'Risk', []))
		const error = captureError(() =>
			appendGroup(definition, factorGroup('g1', 'sum', []), 'missing'),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})

	it('appendFactor / prependFactor / replaceFactor / removeFactor round-trip on a FactorGroup, and compose with appendGroup', () => {
		const group = deepFreeze(factorGroup('g1', 'sum', [staticFactor('f1', 10)]))
		const appended = appendFactor(group, staticFactor('f2', 20))
		expect(appended.factors.map((f) => f.id)).toEqual(['f1', 'f2'])

		const prepended = prependFactor(group, staticFactor('f0', 5))
		expect(prepended.factors.map((f) => f.id)).toEqual(['f0', 'f1'])

		const replaced = replaceFactor(group, staticFactor('f1', 99))
		expect(replaced.factors).toEqual([staticFactor('f1', 99)])

		expect(removeFactor(group, 'f1').factors).toEqual([])

		const definition = quantitativeDefinition('risk', 'Risk', [])
		const composed = appendGroup(
			definition,
			appendFactor(factorGroup('g1', 'sum', []), staticFactor('f1', 1)),
		)
		expect(composed.groups[0]?.factors.map((f) => f.id)).toEqual(['f1'])
	})

	it('appendFactor with a missing target throws ReasonError("TARGET")', () => {
		const group = deepFreeze(factorGroup('g1', 'sum', []))
		const error = captureError(() => appendFactor(group, staticFactor('f1', 1), 'missing'))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})
})

describe('logical change/extend helpers — appendRule / prependRule / replaceRule / removeRule', () => {
	const r1 = rule('r1', [], atom('a', 'equals', true))

	it('round-trips on a LogicalDefinition, and appendRule without a target becomes the new last rule', () => {
		const definition = deepFreeze(logicalDefinition('e', 'E', [r1]))
		const r2 = rule('r2', [], atom('b', 'equals', true))

		const appended = appendRule(definition, r2)
		expect(appended.rules.map((rr) => rr.id)).toEqual(['r1', 'r2']) // r2 is now the forward conclusion

		const prepended = prependRule(definition, r2)
		expect(prepended.rules.map((rr) => rr.id)).toEqual(['r2', 'r1'])

		const replaced = replaceRule(definition, rule('r1', [], atom('a', 'equals', false)))
		expect(replaced.rules).toEqual([rule('r1', [], atom('a', 'equals', false))])

		expect(removeRule(definition, 'r1').rules).toEqual([])
		expect(definition.rules).toEqual([r1]) // input untouched
	})

	it('appendRule with a missing target throws ReasonError("TARGET")', () => {
		const definition = deepFreeze(logicalDefinition('e', 'E', [r1]))
		const error = captureError(() =>
			appendRule(definition, rule('r2', [], atom('b', 'equals', true)), 'missing'),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})
})

describe('symbolic change/extend helpers — appendEquation / prependEquation / replaceEquation / removeEquation / addVariable / removeVariable', () => {
	const e1 = equation('e1', variable('x'), constant(1), 'x')

	it('round-trips on a SymbolicDefinition', () => {
		const definition = deepFreeze(symbolicDefinition('s', 'S', [e1]))
		const e2 = equation('e2', variable('y'), constant(2), 'y')

		const appended = appendEquation(definition, e2)
		expect(appended.equations.map((eq) => eq.id)).toEqual(['e1', 'e2'])

		const prepended = prependEquation(definition, e2)
		expect(prepended.equations.map((eq) => eq.id)).toEqual(['e2', 'e1'])

		const replaced = replaceEquation(definition, equation('e1', variable('x'), constant(9), 'x'))
		expect(replaced.equations).toEqual([equation('e1', variable('x'), constant(9), 'x')])

		expect(removeEquation(definition, 'e1').equations).toEqual([])
		expect(definition.equations).toEqual([e1]) // input untouched
	})

	it('appendEquation with a missing target throws ReasonError("TARGET")', () => {
		const definition = deepFreeze(symbolicDefinition('s', 'S', [e1]))
		const error = captureError(() =>
			appendEquation(definition, equation('e2', variable('y'), constant(2), 'y'), 'missing'),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})

	it('addVariable upserts, removeVariable omits the key entirely (never undefined)', () => {
		const definition = deepFreeze(symbolicDefinition('s', 'S', [], { variables: { x: 1 } }))
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
		const definition = symbolicDefinition('s', 'S', [], { variables: { [key]: 1 } })
		expect(() => removeVariable(definition, key)).not.toThrow()
		expect(Object.hasOwn(removeVariable(definition, key).variables, key)).toBe(false)
	})
})

describe('inferential change/extend helpers — appendFact / prependFact / replaceFact / removeFact / appendInference / prependInference / replaceInference / removeInference', () => {
	const f1 = fact('f1', 'human', ['socrates'])
	const i1 = inference('i1', [fact('p', 'human', ['?x'])], fact('c', 'mortal', ['?x']))

	it('facts round-trip on an InferentialDefinition', () => {
		const definition = deepFreeze(inferentialDefinition('m', 'M', [f1], []))
		const f2 = fact('f2', 'human', ['plato'])

		expect(appendFact(definition, f2).facts.map((f) => f.id)).toEqual(['f1', 'f2'])
		expect(prependFact(definition, f2).facts.map((f) => f.id)).toEqual(['f2', 'f1'])
		expect(replaceFact(definition, fact('f1', 'human', ['plato'])).facts).toEqual([
			fact('f1', 'human', ['plato']),
		])
		expect(removeFact(definition, 'f1').facts).toEqual([])
		expect(definition.facts).toEqual([f1]) // input untouched
	})

	it('appendFact with a missing target throws ReasonError("TARGET")', () => {
		const definition = deepFreeze(inferentialDefinition('m', 'M', [f1], []))
		const error = captureError(() =>
			appendFact(definition, fact('f2', 'human', ['plato']), 'missing'),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})

	it('inferences round-trip on an InferentialDefinition, order load-bearing (appendInference is the new last)', () => {
		const definition = deepFreeze(inferentialDefinition('m', 'M', [], [i1]))
		const i2 = inference(
			'i2',
			[fact('p2', 'parent', ['?x', '?y'])],
			fact('c2', 'ancestor', ['?x', '?y']),
		)

		expect(appendInference(definition, i2).inferences.map((i) => i.id)).toEqual(['i1', 'i2'])
		expect(prependInference(definition, i2).inferences.map((i) => i.id)).toEqual(['i2', 'i1'])
		const replaced = replaceInference(definition, inference('i1', [], fact('c', 'mortal', ['?x'])))
		expect(replaced.inferences).toEqual([inference('i1', [], fact('c', 'mortal', ['?x']))])
		expect(removeInference(definition, 'i1').inferences).toEqual([])
		expect(definition.inferences).toEqual([i1]) // input untouched
	})

	it('appendInference with a missing target throws ReasonError("TARGET")', () => {
		const definition = deepFreeze(inferentialDefinition('m', 'M', [], [i1]))
		const error = captureError(() =>
			appendInference(
				definition,
				inference('i2', [fact('p', 'x', ['?a'])], fact('c', 'y', ['?a'])),
				'missing',
			),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
	})
})

describe('merge helpers — whole-definition reconciliation (PROPOSAL.md §9)', () => {
	it('mergeQuantitativeDefinition preserves base.id, recurses factors on a matched group, incoming order first', () => {
		const base = deepFreeze(
			quantitativeDefinition('risk', 'Risk', [
				factorGroup('g1', 'sum', [staticFactor('f1', 1)]),
				factorGroup('g2', 'sum', []),
			]),
		)
		const incoming = deepFreeze(
			quantitativeDefinition('ignored-id', 'Risk v2', [
				factorGroup('g1', 'sum', [staticFactor('f2', 2)]),
				factorGroup('g3', 'sum', []),
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
			factorGroup('g1', 'sum', [staticFactor('f1', 1)]),
			factorGroup('g2', 'sum', []),
		]) // input untouched
	})

	it('mergeQuantitativeDefinition keeps base optional fields when incoming omits them (merge never clears)', () => {
		const base = deepFreeze(quantitativeDefinition('risk', 'Risk', [], { precision: 2, base: 5 }))
		const incoming = quantitativeDefinition('risk', 'Risk', [])
		expect(mergeQuantitativeDefinition(base, incoming).precision).toBe(2)
		expect(mergeQuantitativeDefinition(base, incoming).base).toBe(5)
	})

	it('mergeLogicalDefinition preserves base.id and merges rules incoming-order-first', () => {
		const base = deepFreeze(
			logicalDefinition('e', 'E', [rule('r1', [], atom('a', 'equals', true))]),
		)
		const incoming = deepFreeze(
			logicalDefinition('ignored', 'E2', [rule('r2', [], atom('b', 'equals', true))]),
		)
		const merged = mergeLogicalDefinition(base, incoming)
		expect(merged.id).toBe('e')
		expect(merged.rules.map((r) => r.id)).toEqual(['r2', 'r1'])
	})

	it('mergeSymbolicDefinition preserves base.id, spread-merges variables, incoming-wins on overlap', () => {
		const base = deepFreeze(symbolicDefinition('s', 'S', [], { variables: { x: 1, y: 1 } }))
		const incoming = deepFreeze(
			symbolicDefinition('ignored', 'S2', [], { variables: { y: 2, z: 3 } }),
		)
		const merged = mergeSymbolicDefinition(base, incoming)
		expect(merged.id).toBe('s')
		expect(merged.variables).toEqual({ x: 1, y: 2, z: 3 })
	})

	it('mergeInferentialDefinition preserves base.id and merges facts/inferences incoming-order-first', () => {
		const base = deepFreeze(inferentialDefinition('m', 'M', [fact('f1', 'human', ['a'])], []))
		const incoming = deepFreeze(
			inferentialDefinition('ignored', 'M2', [fact('f2', 'human', ['b'])], []),
		)
		const merged = mergeInferentialDefinition(base, incoming)
		expect(merged.id).toBe('m')
		expect(merged.facts.map((f) => f.id)).toEqual(['f2', 'f1'])
	})
})

describe('clear helpers — optional-field key-deletion (PROPOSAL.md §10)', () => {
	it('clearQuantitativeDefinition omits the key entirely (never sets undefined)', () => {
		const definition = deepFreeze(quantitativeDefinition('risk', 'Risk', [], { precision: 2 }))
		const cleared = clearQuantitativeDefinition(definition, 'precision')
		expect(Object.hasOwn(cleared, 'precision')).toBe(false)
		expect(definition.precision).toBe(2) // input untouched
	})

	it('clearLogicalDefinition omits the key entirely', () => {
		const definition = deepFreeze(logicalDefinition('e', 'E', [], { depth: 5 }))
		expect(Object.hasOwn(clearLogicalDefinition(definition, 'depth'), 'depth')).toBe(false)
	})

	it('clearSymbolicDefinition omits the key entirely', () => {
		const definition = deepFreeze(symbolicDefinition('s', 'S', [], { precision: 2 }))
		expect(Object.hasOwn(clearSymbolicDefinition(definition, 'precision'), 'precision')).toBe(false)
	})

	it('clearInferentialDefinition omits the key entirely', () => {
		const definition = deepFreeze(inferentialDefinition('m', 'M', [], [], { depth: 5 }))
		expect(Object.hasOwn(clearInferentialDefinition(definition, 'depth'), 'depth')).toBe(false)
	})

	it('clearing an already-absent key is a total no-op fresh copy', () => {
		const definition = deepFreeze(quantitativeDefinition('risk', 'Risk', []))
		const run = () => clearQuantitativeDefinition(definition, 'precision')
		expect(run()).toEqual(definition)
		expect(run()).not.toBe(definition)
	})

	it('clearQuantitativeDefinition with a hostile non-listed key is total (invokeRaw)', () => {
		const definition = deepFreeze(quantitativeDefinition('risk', 'Risk', []))
		const clearRaw = (...args: never[]) => clearQuantitativeDefinition(args[0], args[1])
		expect(() => invokeRaw(undefined, clearRaw, [definition, '__proto__'])).not.toThrow()
	})
})

describe('parseDefinition — safe JSON round-trip (PROPOSAL.md §12)', () => {
	it('round-trips a definition through JSON.stringify', () => {
		const definition = logicalDefinition('e', 'E', [rule('r1', [], atom('a', 'equals', true))])
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

describe('subject engine — assignField / removeField / mergeSubjects / repeatSubject (PROPOSAL.md §11)', () => {
	it('assignField upserts a key via copy-on-write spread, id-agnostic', () => {
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

	it('removeField over TRICKY_KEYS values is total and never throws (invokeRaw)', () => {
		const key = TRICKY_KEYS[0] ?? '__proto__'
		const subject = { id: 's1', [key]: 'x' }
		const removeFieldRaw = (...args: never[]) => removeField(args[0], args[1])
		expect(() => invokeRaw(undefined, removeFieldRaw, [subject, key])).not.toThrow()
		expect(Object.hasOwn(invokeRaw(undefined, removeFieldRaw, [subject, key]), key)).toBe(false)
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
