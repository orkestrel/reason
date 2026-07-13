import type { Factor, FactorGroup, ReasonResult, ReasonValidationResult } from '@src/core'
import {
	bounds,
	check,
	createQuantitativeReasoner,
	createDefinitionBuilder,
	createSubjectBuilder,
	factorGroup,
	fieldFactor,
	isReasonError,
	logicalDefinition,
	lookupFactor,
	QuantitativeReasoner,
	quantitativeDefinition,
	rangeFactor,
	staticFactor,
	transform,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	BASIC_SUBJECT,
	captureError,
	DRIVER_SUBJECT,
	EXTREME_NUMBERS,
	expectQuantitative,
	invokeRaw,
	repeatValue,
	sequence,
	sparse,
	TRICKY_KEYS,
} from '../../../setup.js'

// `QuantitativeReasoner` behavior — the full factor pipeline (checks gate →
// source resolve with fallback → finite check → transforms → bounds clamp →
// finite recheck), all four source origins (static / field / lookup / range),
// stable ascending priority order, strict all-or-nothing groups, required-
// factor errors that never abort the run, stacked bases, weighted group
// aggregation, definition-level clamp + precision rounding, and the
// MISMATCH-throw vs malformed-shape-failure-result distinction. Ports the full
// scsr catalog PLUS the parseNumber coercion divergences (DESIGN §2: a
// non-finite subject number or a non-numeric string like '12px' is UNRESOLVABLE
// and takes the fallback path — scsr's parseFloat prefix-parse is gone) and the
// FieldPath cases (a dotted STRING is ONE key; an ARRAY descends).

const reasoner = createQuantitativeReasoner()

describe('QuantitativeReasoner — identity', () => {
	it('defaults its id to "quantitative" and reports its reasoning', () => {
		expect(reasoner.id).toBe('quantitative')
		expect(reasoner.reasoning).toBe('quantitative')
		expect(new QuantitativeReasoner().id).toBe('quantitative')
	})

	it('takes a custom id through the options object', () => {
		expect(new QuantitativeReasoner({ id: 'custom' }).id).toBe('custom')
	})
})

describe('QuantitativeReasoner — supports', () => {
	it('supports quantitative definitions only', () => {
		expect(reasoner.supports(quantitativeDefinition('d', 'd', []))).toBe(true)
		expect(reasoner.supports(logicalDefinition('d', 'd', []))).toBe(false)
	})
})

describe('QuantitativeReasoner — validate', () => {
	it('accepts a well-formed definition', () => {
		const validation = reasoner.validate(
			quantitativeDefinition('risk', 'Risk', [factorGroup('g1', 'sum', [staticFactor('f1', 1)])]),
		)
		expect(validation.valid).toBe(true)
		expect(validation.errors).toEqual([])
	})

	it('rejects the wrong reasoning with the renamed message', () => {
		const validation = reasoner.validate(logicalDefinition('d', 'd', []))
		expect(validation.valid).toBe(false)
		expect(validation.errors[0]).toBe('Expected reasoning "quantitative", got "logical"')
	})

	it('demands an id, a name, and at least one group', () => {
		const validation = reasoner.validate(quantitativeDefinition('', '', []))
		expect(validation.valid).toBe(false)
		expect(validation.errors).toContain('Definition must have an id')
		expect(validation.errors).toContain('Definition must have a name')
		expect(validation.errors).toContain('Definition must have at least one group')
	})

	it('demands group and factor ids', () => {
		const validation = reasoner.validate(
			quantitativeDefinition('d', 'd', [factorGroup('', 'sum', [staticFactor('', 1)])]),
		)
		expect(validation.errors).toContain('Group must have an id')
		expect(validation.errors).toContain('Factor must have an id')
	})

	it('a factorless group is a WARNING, not an error', () => {
		const validation = reasoner.validate(
			quantitativeDefinition('d', 'd', [factorGroup('g1', 'sum', [])]),
		)
		expect(validation.valid).toBe(true)
		expect(validation.warnings).toContain('Group "g1" has no factors')
	})

	it('a factor without a source is an error (malformed shape past the types)', () => {
		const validation = invokeRaw<ReasonValidationResult>(reasoner, reasoner.validate, [
			{
				reasoning: 'quantitative',
				id: 'd',
				name: 'd',
				groups: [{ id: 'g1', name: 'g1', aggregation: 'sum', factors: [{ id: 'f1', name: 'f1' }] }],
			},
		])
		expect(validation.valid).toBe(false)
		expect(validation.errors).toContain('Factor "f1" must have a source')
	})

	it('duplicate group and factor ids are WARNINGS, once per duplicated id', () => {
		const validation = reasoner.validate(
			quantitativeDefinition('d', 'd', [
				factorGroup('g', 'sum', [staticFactor('f', 1), staticFactor('f', 2), staticFactor('f', 3)]),
				factorGroup('g', 'sum', [staticFactor('solo', 1)]),
				factorGroup('g', 'sum', []),
			]),
		)
		expect(validation.valid).toBe(true)
		expect(
			validation.warnings.filter((warning) => warning === 'Duplicate group id "g"'),
		).toHaveLength(1)
		expect(
			validation.warnings.filter((warning) => warning === 'Duplicate factor id "f"'),
		).toHaveLength(1)
	})

	it('the same factor id in DIFFERENT groups does not warn (uniqueness is per group)', () => {
		const validation = reasoner.validate(
			quantitativeDefinition('d', 'd', [
				factorGroup('g1', 'sum', [staticFactor('base', 1)]),
				factorGroup('g2', 'sum', [staticFactor('base', 2)]),
			]),
		)
		expect(validation.warnings).toEqual([])
	})
})

describe('QuantitativeReasoner — reason (core pipeline)', () => {
	it('adds a static factor onto the definition base', () => {
		const definition = quantitativeDefinition(
			'd',
			'd',
			[factorGroup('g1', 'sum', [staticFactor('f1', 50)])],
			{ base: 100 },
		)
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(150)
	})

	it('reads a field factor from the subject', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('price', 'price')]),
		])
		expect(expectQuantitative(reasoner.reason({ price: 200 }, definition)).value).toBe(200)
	})

	it('applies transforms to the factor value', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('f1', 100, { transforms: [transform('multiply', 2)] }),
			]),
		])
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(200)
	})

	it('sums multiple factors in a group and multiple groups at the top', () => {
		const summed = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('f1', 10),
				staticFactor('f2', 20),
				staticFactor('f3', 30),
			]),
		])
		expect(expectQuantitative(reasoner.reason({}, summed)).value).toBe(60)

		const grouped = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', 100)]),
			factorGroup('g2', 'sum', [staticFactor('f2', 200)]),
		])
		expect(expectQuantitative(reasoner.reason({}, grouped)).value).toBe(300)
	})

	it('multiplies under product aggregation at group and definition level', () => {
		const definition = quantitativeDefinition(
			'd',
			'd',
			[factorGroup('g1', 'product', [staticFactor('f1', 2), staticFactor('f2', 3)])],
			{ aggregation: 'product' },
		)
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(6)
	})

	it('excludes a disabled group (with a skip trace) and a disabled factor', () => {
		const groupOff = quantitativeDefinition(
			'd',
			'd',
			[factorGroup('off', 'sum', [staticFactor('f1', 50)], { enabled: false })],
			{ base: 100 },
		)
		const groupResult = expectQuantitative(reasoner.reason({}, groupOff))
		expect(groupResult.value).toBe(100)
		expect(groupResult.groups).toEqual([])
		expect(groupResult.trace).toContain('Skipped group "off" (disabled)')

		const factorOff = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('f1', 10),
				staticFactor('f2', 20, { enabled: false }),
			]),
		])
		const factorResult = expectQuantitative(reasoner.reason({}, factorOff))
		expect(factorResult.value).toBe(10)
		expect(factorResult.trace).toContain('Skipped factor "f2" (disabled)')
	})

	it('clamps the final value to the definition bounds', () => {
		const definition = quantitativeDefinition(
			'd',
			'd',
			[factorGroup('g1', 'sum', [staticFactor('f1', 100)])],
			{ bounds: bounds(undefined, 50) },
		)
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(50)
	})

	it('uses the fallback when a field is missing', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('f1', 'missing', { fallback: 25 })]),
		])
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(25)
	})

	it('produces a non-empty trace with the pipeline formats', () => {
		const definition = quantitativeDefinition(
			'd',
			'd',
			[factorGroup('g1', 'sum', [staticFactor('f1', 10)])],
			{ base: 100 },
		)
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.trace.length).toBeGreaterThan(0)
		expect(result.trace).toContain('Factor "f1": raw=10, value=10')
		expect(result.trace).toContain('Group "g1": 1/1 factors applied, value=10')
		expect(result.trace).toContain('Aggregated 1 groups with "sum": base=100, raw=110')
	})

	it('checks gate a factor in or out (with the renamed trace)', () => {
		const met = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', 100, { checks: [check('age', 'from', 18)] })]),
		])
		expect(expectQuantitative(reasoner.reason({ age: 25 }, met)).value).toBe(100)

		const unmet = quantitativeDefinition(
			'd',
			'd',
			[factorGroup('g1', 'sum', [staticFactor('f1', 100, { checks: [check('age', 'from', 18)] })])],
			{ base: 50 },
		)
		const result = expectQuantitative(reasoner.reason({ age: 10 }, unmet))
		expect(result.value).toBe(50)
		expect(result.trace).toContain('Factor "f1": checks not met')
	})

	it('ANDs every check on a factor', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('f1', 100, {
					checks: [check('age', 'from', 18), check('state', 'equals', 'CA')],
				}),
			]),
		])
		expect(expectQuantitative(reasoner.reason(BASIC_SUBJECT, definition)).value).toBe(100)
		expect(expectQuantitative(reasoner.reason({ age: 30, state: 'TX' }, definition)).value).toBe(0)
	})
})

describe('QuantitativeReasoner — lookup & range sources', () => {
	const stateLookup = quantitativeDefinition('d', 'd', [
		factorGroup('g1', 'sum', [lookupFactor('f1', 'state', { CA: 1.2, NY: 0.8 }, { fallback: 1 })]),
	])

	it('a lookup hit maps through the table; a miss and a missing field take the fallback', () => {
		expect(expectQuantitative(reasoner.reason({ state: 'CA' }, stateLookup)).value).toBe(1.2)
		expect(expectQuantitative(reasoner.reason({ state: 'FL' }, stateLookup)).value).toBe(1)
		expect(expectQuantitative(reasoner.reason({}, stateLookup)).value).toBe(1)
	})

	it('a numeric field value coerces to a string table key', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [lookupFactor('f1', 'code', { '42': 99 })]),
		])
		expect(expectQuantitative(reasoner.reason({ code: 42 }, definition)).value).toBe(99)
	})

	it('a missing or null field takes the FALLBACK — an "" table key never intercepts it', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [lookupFactor('f1', 'missing', { '': 9 }, { fallback: 3 })]),
		])
		// Absent field and explicit null both bypass the '' key.
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(3)
		expect(expectQuantitative(reasoner.reason({ missing: null }, definition)).value).toBe(3)
		// A PRESENT empty-string value still stringifies and hits the '' key.
		expect(expectQuantitative(reasoner.reason({ missing: '' }, definition)).value).toBe(9)
	})

	it('only OWN table keys hit — an inherited key (toString / constructor) falls back', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [lookupFactor('f1', 'key', {}, { fallback: 7 })]),
		])
		const result = expectQuantitative(reasoner.reason({ key: 'toString' }, definition))
		expect(result.value).toBe(7)
		expect(result.success).toBe(true)
		expect(expectQuantitative(reasoner.reason({ key: 'constructor' }, definition)).value).toBe(7)
	})

	const ageBands = quantitativeDefinition('d', 'd', [
		factorGroup('g1', 'sum', [
			rangeFactor('f1', 'age', [
				{ bounds: bounds(undefined, 25), value: 1.5 },
				{ bounds: bounds(26, 65), value: 1 },
				{ bounds: bounds(66), value: 1.3 },
			]),
		]),
	])

	it('range bands are inclusive with open missing sides', () => {
		expect(expectQuantitative(reasoner.reason({ age: 20 }, ageBands)).value).toBe(1.5)
		expect(expectQuantitative(reasoner.reason({ age: 30 }, ageBands)).value).toBe(1)
		expect(expectQuantitative(reasoner.reason({ age: 70 }, ageBands)).value).toBe(1.3)
	})

	it('no matching band takes the fallback', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				rangeFactor('f1', 'age', [{ bounds: bounds(100), value: 5 }], { fallback: 0 }),
			]),
		])
		expect(expectQuantitative(reasoner.reason({ age: 30 }, definition)).value).toBe(0)
	})

	it('a boundless band is a catch-all', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [rangeFactor('f1', 'age', [{ value: 42 }])]),
		])
		expect(expectQuantitative(reasoner.reason({ age: 999 }, definition)).value).toBe(42)
	})

	it('overlapping bands resolve to the FIRST match', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				rangeFactor('f1', 'age', [
					{ bounds: bounds(0, 100), value: 1 },
					{ bounds: bounds(50, 150), value: 2 },
				]),
			]),
		])
		expect(expectQuantitative(reasoner.reason({ age: 75 }, definition)).value).toBe(1)
	})
})

describe('QuantitativeReasoner — strict groups & required factors', () => {
	it('a strict group contributes nothing when any factor fails its checks', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup(
				'g1',
				'sum',
				[
					staticFactor('always', 10),
					staticFactor('gated', 20, { checks: [check('missing', 'equals', true)] }),
				],
				{ strict: true },
			),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.value).toBe(0)
		expect(result.groups[0]?.applied).toBe(false)
		expect(result.trace).toContain('Group "g1" strict mode: not all factors applied')
	})

	it('a strict group passes when every factor applies', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', 10), staticFactor('f2', 20)], {
				strict: true,
			}),
		])
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(30)
	})

	it('a required factor with an unresolvable source fails the run (renamed error)', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('f1', 'missing', { required: true })]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Required factor "f1" could not resolve source')
		expect(result.trace).toContain('Factor "f1": could not resolve source')
	})

	it('a required factor with unmet checks fails the run (checks, not conditions)', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('f1', 10, { required: true, checks: [check('age', 'from', 18)] }),
			]),
		])
		const result = expectQuantitative(reasoner.reason({ age: 10 }, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Required factor "f1" checks not met')
	})

	it('a required failure does NOT zero the other factors', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				fieldFactor('gone', 'missing', { required: true }),
				staticFactor('kept', 50),
			]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.value).toBe(50)
	})
})

describe('QuantitativeReasoner — result shape, bases & weights', () => {
	it('factor results expose raw / value / applied', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', 10)]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.groups[0]?.factors[0]).toEqual({ id: 'f1', applied: true, value: 10, raw: 10 })
		expect(result.count).toBe(1)
	})

	it('group base adds to the group aggregation and group bounds clamp it', () => {
		const based = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', 5)], { base: 100 }),
		])
		expect(expectQuantitative(reasoner.reason({}, based)).value).toBe(105)

		const clamped = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', 500)], { bounds: bounds(undefined, 100) }),
		])
		expect(expectQuantitative(reasoner.reason({}, clamped)).value).toBe(100)

		const baseAndFactors = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', 10), staticFactor('f2', 20)], { base: 100 }),
		])
		expect(expectQuantitative(reasoner.reason({}, baseAndFactors)).value).toBe(130)
	})

	it('definition base and group base STACK', () => {
		const definition = quantitativeDefinition(
			'd',
			'd',
			[factorGroup('g1', 'sum', [staticFactor('f1', 10)], { base: 50 })],
			{ base: 100 },
		)
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(160)
	})

	it('weights feed the group aggregation — weighted averages', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'average', [
				staticFactor('f1', 100, { weight: 3 }),
				staticFactor('f2', 0, { weight: 1 }),
			]),
		])
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(75)

		const second = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'average', [
				staticFactor('f1', 100, { weight: 3 }),
				staticFactor('f2', 200, { weight: 1 }),
			]),
		])
		expect(expectQuantitative(reasoner.reason({}, second)).value).toBe(125)
	})

	it('weights multiply into SUM aggregation too (the full pipeline combined)', () => {
		// raw 10 → ×3 = 30 → clamped to 25 → weight 2 in a sum → 50.
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('f1', 10, {
					transforms: [transform('multiply', 3)],
					bounds: bounds(undefined, 25),
					weight: 2,
				}),
			]),
		])
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(50)
	})

	it('mixed group aggregations combine at the top level', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'product', [staticFactor('f1', 2), staticFactor('f2', 3)]),
			factorGroup('g2', 'average', [staticFactor('f3', 10), staticFactor('f4', 20)]),
		])
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(21)
	})

	it('product / minimum / maximum groups aggregate their factors', () => {
		const product = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'product', [
				staticFactor('f1', 3),
				staticFactor('f2', 4),
				staticFactor('f3', 5),
			]),
		])
		expect(expectQuantitative(reasoner.reason({}, product)).value).toBe(60)

		const minimum = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'minimum', [staticFactor('f1', 10), staticFactor('f2', 50)]),
		])
		expect(expectQuantitative(reasoner.reason({}, minimum)).value).toBe(10)

		const maximum = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'maximum', [staticFactor('f1', 10), staticFactor('f2', 50)]),
		])
		expect(expectQuantitative(reasoner.reason({}, maximum)).value).toBe(50)
	})

	it('factors evaluate in stable ascending priority order (trace-observable)', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('slow', 1, { priority: 10 }),
				staticFactor('fast', 2, { priority: 1 }),
			]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		const fastAt = result.trace.findIndex((entry) => entry.includes('"fast"'))
		const slowAt = result.trace.findIndex((entry) => entry.includes('"slow"'))
		expect(fastAt).toBeGreaterThanOrEqual(0)
		expect(fastAt).toBeLessThan(slowAt)
	})

	it('a NEGATIVE priority sorts before the default-0 factor', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('unprioritized', 1),
				staticFactor('negative', 2, { priority: -5 }),
			]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		const negativeAt = result.trace.findIndex((entry) => entry.includes('"negative"'))
		const defaultAt = result.trace.findIndex((entry) => entry.includes('"unprioritized"'))
		expect(negativeAt).toBeGreaterThanOrEqual(0)
		expect(negativeAt).toBeLessThan(defaultAt)
	})

	it('EQUAL priorities keep declaration order (the sort is stable)', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('first', 1, { priority: 1 }),
				staticFactor('second', 2, { priority: 1 }),
				staticFactor('third', 3, { priority: 1 }),
			]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		const positions = ['first', 'second', 'third'].map((id) =>
			result.trace.findIndex((entry) => entry.includes(`"${id}"`)),
		)
		expect(positions[0]).toBeGreaterThanOrEqual(0)
		expect(positions[0]).toBeLessThan(positions[1] ?? -1)
		expect(positions[1]).toBeLessThan(positions[2] ?? -1)
	})

	it('duplicate factor ids: the weight lookup takes the FIRST twin (runtime quirk, warned by validate)', () => {
		// Values 10 and 100 with declared weights 2 and 5 — BOTH resolve weight 2
		// (the by-id lookup finds the first twin): 10·2 + 100·2 = 220, not 520.
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('dup', 10, { weight: 2 }),
				staticFactor('dup', 100, { weight: 5 }),
			]),
		])
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(220)
	})
})

describe('QuantitativeReasoner — field paths (FieldPath semantics)', () => {
	it('an ARRAY path descends into nested objects', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('f1', ['data', 'score'])]),
		])
		expect(expectQuantitative(reasoner.reason({ data: { score: 95 } }, definition)).value).toBe(95)

		const deep = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('f1', ['a', 'b', 'c', 'd'])]),
		])
		expect(expectQuantitative(reasoner.reason({ a: { b: { c: { d: 42 } } } }, deep)).value).toBe(42)
	})

	it('a dotted STRING is ONE key — it reads the flat key, never the nested shape', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('f1', 'data.score', { fallback: 0 })]),
		])
		expect(expectQuantitative(reasoner.reason({ 'data.score': 95 }, definition)).value).toBe(95)
		expect(expectQuantitative(reasoner.reason({ data: { score: 95 } }, definition)).value).toBe(0)
	})
})

describe('QuantitativeReasoner — parseNumber coercion (contracts semantics)', () => {
	const readValue = (fallback?: number) =>
		quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				fieldFactor('f1', 'value', fallback === undefined ? undefined : { fallback }),
			]),
		])

	it('parses numeric strings, whitespace-padded and hex included', () => {
		expect(expectQuantitative(reasoner.reason({ value: '42' }, readValue())).value).toBe(42)
		expect(expectQuantitative(reasoner.reason({ value: '  42  ' }, readValue())).value).toBe(42)
		expect(expectQuantitative(reasoner.reason({ value: '0x10' }, readValue())).value).toBe(16)
	})

	it('a non-numeric string takes the fallback', () => {
		expect(expectQuantitative(reasoner.reason({ value: 'abc' }, readValue(0))).value).toBe(0)
	})

	it('a prefix-numeric string like "12px" is UNRESOLVABLE (diverges from scsr parseFloat)', () => {
		expect(expectQuantitative(reasoner.reason({ value: '12px' }, readValue(7))).value).toBe(7)
	})

	it('a NaN subject number takes the fallback path, not the non-finite error path', () => {
		const result = expectQuantitative(reasoner.reason({ value: Number.NaN }, readValue(5)))
		expect(result.value).toBe(5)
		expect(result.success).toBe(true)

		// Without a fallback the factor is simply unresolvable — still no error.
		const bare = expectQuantitative(reasoner.reason({ value: Number.NaN }, readValue()))
		expect(bare.success).toBe(true)
		expect(bare.trace).toContain('Factor "f1": could not resolve source')
	})
})

describe('QuantitativeReasoner — non-finite guard', () => {
	it('a static NaN source errors with the NaN description', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', Number.NaN)]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.value).toBe(0)
		expect(result.errors[0]).toBe('Factor "f1" produced non-finite value: NaN')
		expect(result.trace).toContain('Factor "f1": source produced non-finite value (NaN)')
	})

	it('static ±Infinity sources error with their signed description', () => {
		const positive = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', Number.POSITIVE_INFINITY)]),
		])
		expect(expectQuantitative(reasoner.reason({}, positive)).errors[0]).toBe(
			'Factor "f1" produced non-finite value: Infinity',
		)

		const negative = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', Number.NEGATIVE_INFINITY)]),
		])
		expect(expectQuantitative(reasoner.reason({}, negative)).errors[0]).toBe(
			'Factor "f1" produced non-finite value: -Infinity',
		)
	})

	it('a non-finite factor does not contaminate its siblings', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('bad', Number.POSITIVE_INFINITY),
				staticFactor('good', 42),
			]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.value).toBe(42)
		expect(result.success).toBe(false)
		expect(result.errors).toHaveLength(1)
	})

	it('a divide-by-zero transform trips the post-transform finite recheck', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', 10, { transforms: [transform('divide', 0)] })]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors[0]).toBe('Factor "f1" produced non-finite value: NaN')
		expect(result.trace).toContain('Factor "f1": produced non-finite value (NaN)')
	})

	it('a NaN fallback feeds the non-finite error path (it IS the resolved value)', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('f1', 'missing', { fallback: Number.NaN })]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors[0]).toBe('Factor "f1" produced non-finite value: NaN')
		expect(result.value).toBe(0)
	})

	it('minimum/maximum over ZERO applied groups is a definition-level non-finite error, value NaN', () => {
		for (const aggregation of ['minimum', 'maximum'] as const) {
			const result = expectQuantitative(
				reasoner.reason({}, quantitativeDefinition('d', 'd', [], { aggregation })),
			)
			expect(Number.isNaN(result.value)).toBe(true)
			expect(result.success).toBe(false)
			expect(result.count).toBe(0)
			expect(result.errors).toContain('Definition "d" produced non-finite value: NaN')
			expect(result.trace).toContain(`Aggregated 0 groups with "${aggregation}": base=0, raw=NaN`)
			expect(result.trace).toContain('Definition "d": produced non-finite value (NaN)')
		}
	})

	it('an UNAPPLIED group may carry a NaN value — excluded from the definition aggregate', () => {
		// The gated-out factor leaves a minimum aggregation over zero values:
		// base 0 + NaN. The group is unapplied, so the definition (sum) ignores it.
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'minimum', [
				staticFactor('gated', 5, { checks: [check('missing', 'equals', true)] }),
			]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(Number.isNaN(result.groups[0]?.value)).toBe(true)
		expect(result.groups[0]?.applied).toBe(false)
		expect(result.value).toBe(0)
		expect(result.success).toBe(true)
	})
})

describe('QuantitativeReasoner — precision, scale & scenarios', () => {
	it('sums negative values', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('f1', 10),
				staticFactor('f2', -5),
				staticFactor('f3', 3),
			]),
		])
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(8)
	})

	it('GROUP values are never rounded — only the definition value rounds', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', 0.1), staticFactor('f2', 0.2)]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.groups[0]?.value).toBe(0.30000000000000004)
		expect(result.value).toBe(0.3)
	})

	it('precision 0 rounds to an integer; the default precision is 4 decimal places', () => {
		const integer = quantitativeDefinition(
			'd',
			'd',
			[factorGroup('g1', 'sum', [staticFactor('f1', 3.14159)])],
			{ precision: 0 },
		)
		expect(expectQuantitative(reasoner.reason({}, integer)).value).toBe(3)

		const defaulted = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('f1', 0.123456)]),
		])
		expect(expectQuantitative(reasoner.reason({}, defaulted)).value).toBe(0.1235)
	})

	it('50 factors of 1 sum to 50', () => {
		const factors = Array.from({ length: 50 }, (_, index) => staticFactor(`f${index}`, 1))
		const definition = quantitativeDefinition('d', 'd', [factorGroup('g1', 'sum', factors)])
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(50)
	})

	it('all four source origins combine in one definition', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('static', 10),
				fieldFactor('field', 'score'),
				lookupFactor('lookup', 'state', { CA: 5 }),
				rangeFactor('range', 'age', [{ bounds: bounds(26, 65), value: 2 }]),
			]),
		])
		expect(expectQuantitative(reasoner.reason(BASIC_SUBJECT, definition)).value).toBe(102)
	})

	it('the driver scenario spans two groups (sum + product)', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('penalties', 'sum', [
				fieldFactor('age', 'driverAge'),
				fieldFactor('violations', 'violationCount'),
			]),
			factorGroup('vehicle', 'product', [fieldFactor('year', 'vehicleYear')]),
		])
		const result = expectQuantitative(reasoner.reason(DRIVER_SUBJECT, definition))
		expect(result.value).toBe(2042)
		expect(result.groups).toHaveLength(2)
	})

	it('a group with no ENABLED factors leaves only the definition base', () => {
		const definition = quantitativeDefinition(
			'd',
			'd',
			[factorGroup('g1', 'sum', [staticFactor('f1', 10, { enabled: false })])],
			{ base: 50 },
		)
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(50)
	})
})

describe('QuantitativeReasoner — mismatch vs malformed shape', () => {
	it('MISMATCH: the wrong reasoning THROWS a coded ReasonError with context', () => {
		const error = captureError(() => reasoner.reason({}, logicalDefinition('other', 'Other', [])))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')
		expect(error.message).toBe('Expected quantitative definition, got "logical"')
		expect(error.context).toEqual({ definition: 'other', reasoning: 'quantitative' })
	})

	it('a malformed shape (missing groups) is a FAILURE RESULT, not a throw', () => {
		const result = expectQuantitative(
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [
				{},
				{ reasoning: 'quantitative', id: 'd', name: 'd' },
			]),
		)
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Definition must have a "groups" array'])
	})

	it('an empty-factors group traces "no factors defined" and stays unapplied', () => {
		const definition = quantitativeDefinition('d', 'd', [factorGroup('empty', 'sum', [])])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.trace).toContain('Group "empty": no factors defined')
		expect(result.groups[0]?.applied).toBe(false)
	})

	it('a factor with NO source takes the could-not-resolve path, never a crash', () => {
		const malformed = {
			reasoning: 'quantitative',
			id: 'd',
			name: 'd',
			aggregation: 'sum',
			groups: [{ id: 'g1', name: 'g1', aggregation: 'sum', factors: [{ id: 'f1', name: 'f1' }] }],
		}
		const result = expectQuantitative(
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [{}, malformed]),
		)
		expect(result.success).toBe(true)
		expect(result.trace).toContain('Factor "f1": could not resolve source')
		expect(result.groups[0]?.factors[0]).toEqual({ id: 'f1', applied: false, value: 0 })

		// A required factor promotes the same path to an error, still no crash.
		const required = {
			...malformed,
			groups: [
				{
					id: 'g1',
					name: 'g1',
					aggregation: 'sum',
					factors: [{ id: 'f1', name: 'f1', required: true }],
				},
			],
		}
		const requiredResult = expectQuantitative(
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [{}, required]),
		)
		expect(requiredResult.success).toBe(false)
		expect(requiredResult.errors).toContain('Required factor "f1" could not resolve source')
	})

	it('an unresolved-source factor result OMITS the raw key entirely', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('f1', 'missing')]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		const factorResult = result.groups[0]?.factors[0]
		expect(factorResult).toBeDefined()
		if (!factorResult) throw new Error('expected a factor result')
		expect(Object.keys(factorResult).sort()).toEqual(['applied', 'id', 'value'])
	})
})

describe('QuantitativeReasoner — scale & stress', () => {
	it('sums 2000 factors in one group to an EXACT integer', () => {
		const factors = repeatValue(2000, 1).map((value, index) => staticFactor(`f${index}`, value))
		const definition = quantitativeDefinition('d', 'd', [factorGroup('g1', 'sum', factors)])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.value).toBe(2000)
		expect(result.success).toBe(true)
		expect(result.count).toBe(1)
		expect(result.groups[0]?.factors).toHaveLength(2000)
	})

	it('aggregates 150 single-factor groups at the definition level', () => {
		const groups = sequence(150).map((index) =>
			factorGroup(`g${index}`, 'sum', [staticFactor(`f${index}`, 1)]),
		)
		const result = expectQuantitative(reasoner.reason({}, quantitativeDefinition('d', 'd', groups)))
		expect(result.value).toBe(150)
		expect(result.count).toBe(150)
		expect(result.groups).toHaveLength(150)
	})

	it('sums a SINGLE 20,000-factor group exactly (O(1) hoisted weight lookup, was O(n²))', () => {
		// One group of 20k factors — before the id→weight Map hoist the per-applied-factor
		// `group.factors.find` made this O(n²); now the whole group is O(n). Σ of 20k ones.
		const factors = repeatValue(20000, 1).map((value, index) => staticFactor(`f${index}`, value))
		const definition = quantitativeDefinition('d', 'd', [factorGroup('g1', 'sum', factors)])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.value).toBe(20000)
		expect(result.success).toBe(true)
		expect(result.count).toBe(1)
		expect(result.groups[0]?.factors).toHaveLength(20000)
	})

	it('completes 50,000 factors across 500 groups with the exact triangular sum', () => {
		// Values 0..49999 spread over 500 groups of 100 — the whole-path sum
		// n(n-1)/2 = 1,249,975,000 stays below 2^53, so the IEEE result is exact and
		// precision-4 rounding cannot perturb it. (Kept per-group small: the source's
		// weight lookup is a linear scan per applied factor, so one 50k group is O(n²).)
		const groups = sequence(500).map((groupIndex) =>
			factorGroup(
				`g${groupIndex}`,
				'sum',
				sequence(100, groupIndex * 100).map((value) =>
					staticFactor(`f${groupIndex}_${value}`, value),
				),
			),
		)
		const result = expectQuantitative(reasoner.reason({}, quantitativeDefinition('d', 'd', groups)))
		expect(result.value).toBe(1249975000)
		expect(result.success).toBe(true)
		expect(result.count).toBe(500)
		const totalFactors = result.groups.reduce((sum, group) => sum + group.factors.length, 0)
		expect(totalFactors).toBe(50000)
	})
})

describe('QuantitativeReasoner — numeric extremes', () => {
	it('accumulates two MAX_SAFE_INTEGER factors across the 2^53 boundary (precision 0)', () => {
		// Precision 0 keeps the roundTo scale factor at 1 — a precision-4 factor would
		// multiply the ~2^54 sum past 2^53 and corrupt it on the round-trip.
		const definition = quantitativeDefinition(
			'd',
			'd',
			[
				factorGroup('g1', 'sum', [
					staticFactor('a', Number.MAX_SAFE_INTEGER),
					staticFactor('b', Number.MAX_SAFE_INTEGER),
				]),
			],
			{ precision: 0 },
		)
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.value).toBe(Number.MAX_SAFE_INTEGER * 2)
		expect(result.value).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
		expect(result.success).toBe(true)
	})

	it('a MIN_VALUE subnormal survives the group but rounds to 0 at the definition', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('tiny', Number.MIN_VALUE)]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		// Groups are never rounded, so the subnormal is intact there…
		expect(result.groups[0]?.value).toBe(Number.MIN_VALUE)
		// …but roundTo at precision 4 scales it below the double range → 0.
		expect(result.value).toBe(0)
		expect(result.success).toBe(true)
	})

	it('an overflow-scale precision passes the MIN_VALUE subnormal through untouched', () => {
		// 10^400 is Infinity, so roundTo short-circuits to the value unchanged.
		const definition = quantitativeDefinition(
			'd',
			'd',
			[factorGroup('g1', 'sum', [staticFactor('tiny', Number.MIN_VALUE)])],
			{ precision: 400 },
		)
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(Number.MIN_VALUE)
	})

	it('a factor transform overflowing to Infinity trips the post-transform finite recheck', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('over', 1e308, { transforms: [transform('multiply', 10)] }),
			]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.value).toBe(0)
		expect(result.success).toBe(false)
		expect(result.errors[0]).toBe('Factor "over" produced non-finite value: Infinity')
		expect(result.count).toBe(0)
		const factorResult = result.groups[0]?.factors[0]
		expect(factorResult?.applied).toBe(false)
		expect(factorResult?.raw).toBe(1e308)
	})

	it('a group sum overflowing to Infinity is a DEFINITION-level finite error', () => {
		// Each 1e308 factor is finite (passes its own recheck); the overflow happens
		// in the group aggregation, so the group applies with an Infinity value and the
		// error surfaces at the definition finite-check after rounding.
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('a', 1e308), staticFactor('b', 1e308)]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.groups[0]?.value).toBe(Number.POSITIVE_INFINITY)
		expect(result.groups[0]?.applied).toBe(true)
		expect(result.value).toBe(Number.POSITIVE_INFINITY)
		expect(result.success).toBe(false)
		expect(result.count).toBe(1)
		expect(result.errors).toContain('Definition "d" produced non-finite value: Infinity')
	})

	it('catastrophic cancellation [1e16, 1, -1e16] loses the 1 to exactly 0', () => {
		// 1e16 + 1 === 1e16 in IEEE double, so the middle term vanishes before the
		// subtraction — the sum is +0, not 1.
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('big', 1e16),
				staticFactor('one', 1),
				staticFactor('negBig', -1e16),
			]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.value).toBe(0)
		expect(Object.is(result.value, -0)).toBe(false)
		expect(result.success).toBe(true)
	})

	it('summing every EXTREME_NUMBERS factor overflows to Infinity (each applies first)', () => {
		// MAX_VALUE + 1e308 overflows during aggregation, though all 14 factors are
		// individually finite and applied.
		const factors = EXTREME_NUMBERS.map((value, index) => staticFactor(`e${index}`, value))
		const definition = quantitativeDefinition('d', 'd', [factorGroup('g1', 'sum', factors)])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.groups[0]?.factors).toHaveLength(14)
		expect(result.groups[0]?.factors.every((factor) => factor.applied)).toBe(true)
		expect(result.value).toBe(Number.POSITIVE_INFINITY)
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Definition "d" produced non-finite value: Infinity')
	})
})

describe('QuantitativeReasoner — signed zero', () => {
	it('a multiply-by-(-0) transform yields a -0 FACTOR value that the group base washes to +0', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('z', 5, { transforms: [transform('multiply', -0)] })]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(Object.is(result.groups[0]?.factors[0]?.value, -0)).toBe(true)
		// base + reduce start at +0, so 0 + (-0) === +0 — the sign does not reach the group.
		expect(Object.is(result.groups[0]?.value, -0)).toBe(false)
		expect(Object.is(result.groups[0]?.value, 0)).toBe(true)
	})

	it('clamping to a minimum of -0 produces a -0 factor value', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [staticFactor('c', -5, { bounds: bounds(-0) })]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(Object.is(result.groups[0]?.factors[0]?.value, -0)).toBe(true)
	})

	it('a -0 propagates all the way to the definition value under product aggregation', () => {
		// Product reduce starts at 1 (1 * -0 === -0) and every base is -0, so no +0
		// addition ever washes the sign — the final rounded value is -0.
		const definition = quantitativeDefinition(
			'd',
			'd',
			[factorGroup('g1', 'product', [staticFactor('z', -0)], { base: -0 })],
			{ aggregation: 'product', base: -0 },
		)
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(Object.is(result.groups[0]?.value, -0)).toBe(true)
		expect(Object.is(result.value, -0)).toBe(true)
	})
})

describe('QuantitativeReasoner — deep & adversarial field paths', () => {
	it('an array path descends ~100 levels to the leaf number', () => {
		const deepKeys = sequence(100).map((index) => `level${index}`)
		const deepSubject = deepKeys.reduceRight<Record<string, unknown>>(
			(inner, key) => ({ [key]: inner }),
			{ deepest: 42 },
		)
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('f1', [...deepKeys, 'deepest'])]),
		])
		expect(expectQuantitative(reasoner.reason(deepSubject, definition)).value).toBe(42)
	})

	it('a dotted STRING key "a.b" reads flat and NEVER equals the array path ["a", "b"]', () => {
		const subject: Record<string, unknown> = { 'a.b': 11, a: { b: 22 } }
		const flat = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('f1', 'a.b', { fallback: -1 })]),
		])
		const nested = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('f1', ['a', 'b'], { fallback: -1 })]),
		])
		expect(expectQuantitative(reasoner.reason(subject, flat)).value).toBe(11)
		expect(expectQuantitative(reasoner.reason(subject, nested)).value).toBe(22)
	})

	it('reads every TRICKY_KEYS field name as an OWN property (proto names included)', () => {
		// Object.fromEntries creates OWN data properties even for "__proto__", so the
		// dangerous names are read as data — never through the prototype chain.
		const subject: Record<string, unknown> = Object.fromEntries(
			TRICKY_KEYS.map((key, index): [string, number] => [key, index]),
		)
		TRICKY_KEYS.forEach((key, index) => {
			const definition = quantitativeDefinition('d', 'd', [
				factorGroup('g1', 'sum', [fieldFactor('f1', key, { fallback: -1 })]),
			])
			expect(expectQuantitative(reasoner.reason(subject, definition)).value).toBe(index)
		})
	})
})

describe('QuantitativeReasoner — adversarial lookup keys', () => {
	// A subject cannot carry duplicate keys — an object literal collapses them and
	// `Object.fromEntries` keeps the last — so a duplicate-subject-key lookup is not
	// expressible and is intentionally omitted here.
	const trickyTable: Readonly<Record<string, number>> = Object.fromEntries(
		TRICKY_KEYS.map((key, index): [string, number] => [key, index * 10]),
	)

	it('an OWN "__proto__" table key and a unicode key both hit through the lookup', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [lookupFactor('f1', 'code', trickyTable, { fallback: -1 })]),
		])
		expect(expectQuantitative(reasoner.reason({ code: '__proto__' }, definition)).value).toBe(0)
		expect(expectQuantitative(reasoner.reason({ code: '\u{1F600}' }, definition)).value).toBe(60)
		expect(expectQuantitative(reasoner.reason({ code: '' }, definition)).value).toBe(50)
	})

	it('a "__proto__" field value against a table WITHOUT that own key takes the fallback', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [lookupFactor('f1', 'code', {}, { fallback: 7 })]),
		])
		expect(expectQuantitative(reasoner.reason({ code: '__proto__' }, definition)).value).toBe(7)
	})

	it('a numeric field and its numeric-string twin collide on the same String() key', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [lookupFactor('f1', 'code', { '42': 99 }, { fallback: -1 })]),
		])
		expect(expectQuantitative(reasoner.reason({ code: 42 }, definition)).value).toBe(99)
		expect(expectQuantitative(reasoner.reason({ code: '42' }, definition)).value).toBe(99)
	})

	it('a 1000-key lookup table resolves a hit and falls back on a miss', () => {
		const table: Readonly<Record<string, number>> = Object.fromEntries(
			sequence(1000).map((value): [string, number] => [String(value), value * 2]),
		)
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [lookupFactor('f1', 'code', table, { fallback: -1 })]),
		])
		expect(expectQuantitative(reasoner.reason({ code: 500 }, definition)).value).toBe(1000)
		expect(expectQuantitative(reasoner.reason({ code: 9999 }, definition)).value).toBe(-1)
	})

	it('an OWN "toString" table key DOES hit (unlike the inherited method)', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [lookupFactor('f1', 'key', { toString: 55 }, { fallback: 7 })]),
		])
		expect(expectQuantitative(reasoner.reason({ key: 'toString' }, definition)).value).toBe(55)
	})
})

describe('QuantitativeReasoner — range band quirks', () => {
	it('a reversed band (minimum > maximum) never matches, so the fallback wins', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				rangeFactor('f1', 'age', [{ bounds: bounds(50, 10), value: 5 }], { fallback: 0 }),
			]),
		])
		expect(expectQuantitative(reasoner.reason({ age: 30 }, definition)).value).toBe(0)
		expect(expectQuantitative(reasoner.reason({ age: 60 }, definition)).value).toBe(0)
		expect(expectQuantitative(reasoner.reason({ age: 5 }, definition)).value).toBe(0)
	})

	it('a NaN band bound is dead (every comparison false) — a later catch-all wins', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				rangeFactor('f1', 'age', [{ bounds: bounds(Number.NaN), value: 5 }, { value: 9 }]),
			]),
		])
		expect(expectQuantitative(reasoner.reason({ age: 30 }, definition)).value).toBe(9)
	})

	it('a boundless band placed FIRST short-circuits every later band', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				rangeFactor('f1', 'age', [{ value: 1 }, { bounds: bounds(0, 100), value: 2 }]),
			]),
		])
		expect(expectQuantitative(reasoner.reason({ age: 50 }, definition)).value).toBe(1)
	})
})

describe('QuantitativeReasoner — weight & priority extremes', () => {
	it('a NaN weight poisons the weighted sum into a definition NaN error', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('a', 10, { weight: Number.NaN }),
				staticFactor('b', 20, { weight: 1 }),
			]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(Number.isNaN(result.value)).toBe(true)
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Definition "d" produced non-finite value: NaN')
	})

	it('an Infinity weight drives the sum to a definition Infinity error', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('a', 10, { weight: Number.POSITIVE_INFINITY }),
				staticFactor('b', 20, { weight: 1 }),
			]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.value).toBe(Number.POSITIVE_INFINITY)
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Definition "d" produced non-finite value: Infinity')
	})

	it('a -0 weight zeroes its factor contribution (5·-0 + 20·1 = 20)', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('a', 5, { weight: -0 }),
				staticFactor('b', 20, { weight: 1 }),
			]),
		])
		expect(expectQuantitative(reasoner.reason({}, definition)).value).toBe(20)
	})

	it('fractional priorities sort ascending (0.1 before 0.5)', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('high', 1, { priority: 0.5 }),
				staticFactor('low', 2, { priority: 0.1 }),
			]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		const lowAt = result.trace.findIndex((entry) => entry.includes('"low"'))
		const highAt = result.trace.findIndex((entry) => entry.includes('"high"'))
		expect(lowAt).toBeGreaterThanOrEqual(0)
		expect(lowAt).toBeLessThan(highAt)
	})

	it('a NaN priority neither throws nor drops a factor — both still apply', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [
				staticFactor('normal', 1, { priority: 5 }),
				staticFactor('nanp', 2, { priority: Number.NaN }),
			]),
		])
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.value).toBe(3)
		expect(result.success).toBe(true)
		expect(result.groups[0]?.factors.every((factor) => factor.applied)).toBe(true)
	})
})

describe('QuantitativeReasoner — sparse range sources', () => {
	it('a present band inside a sparse ranges array applies; a hole-only position falls back (no throw, twice)', () => {
		const buildAndRun = () => {
			const ranges = sparse<{ bounds: ReturnType<typeof bounds>; value: number }>(5, [
				[0, { bounds: bounds(0, 10), value: 1 }],
				[4, { bounds: bounds(90, 100), value: 99 }],
			])
			const definition = quantitativeDefinition('d', 'd', [
				factorGroup('g1', 'sum', [rangeFactor('f1', 'age', ranges, { fallback: 0 })]),
			])
			return {
				inBand: expectQuantitative(reasoner.reason({ age: 5 }, definition)).value,
				otherBand: expectQuantitative(reasoner.reason({ age: 95 }, definition)).value,
				holeOnly: expectQuantitative(reasoner.reason({ age: 50 }, definition)).value,
			}
		}
		const first = buildAndRun()
		expect(first).toEqual({ inBand: 1, otherBand: 99, holeOnly: 0 })
		const second = buildAndRun()
		expect(second).toEqual(first)
	})
})

describe('QuantitativeReasoner — sparse groups & factors arrays', () => {
	it('a sparse groups array aggregates the definition value from only the present groups', () => {
		const groups = sparse<FactorGroup>(3, [
			[0, factorGroup('g1', 'sum', [staticFactor('f1', 10)])],
			[2, factorGroup('g2', 'sum', [staticFactor('f2', 20)])],
		])
		const definition = quantitativeDefinition('d', 'd', groups)

		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.value).toBe(30)
		expect(result.count).toBe(2)
		expect(result.success).toBe(true)
	})

	it('a sparse factors array aggregates a group value from only the present factors', () => {
		const factors = sparse<Factor>(3, [
			[0, staticFactor('f1', 10)],
			[2, staticFactor('f2', 20)],
		])
		const definition = quantitativeDefinition('d', 'd', [factorGroup('g1', 'sum', factors)])

		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(result.value).toBe(30)
		expect(result.groups[0]?.value).toBe(30)
		expect(result.success).toBe(true)
	})
})

describe('QuantitativeReasoner — field-source coercion divergences', () => {
	it('a Date field value does not coerce to a timestamp — the factor falls back', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('f1', 'when', { fallback: -1 })]),
		])
		expect(
			expectQuantitative(reasoner.reason({ when: new Date(2020, 0, 1) }, definition)).value,
		).toBe(-1)
	})

	it('a non-numeric string field value takes the fallback', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [fieldFactor('f1', 'when', { fallback: -1 })]),
		])
		expect(expectQuantitative(reasoner.reason({ when: 'not-a-number' }, definition)).value).toBe(-1)
	})
})

describe('QuantitativeReasoner — lookup-site stringification of non-record field values', () => {
	it('an array field value stringifies via String() to the joined key', () => {
		const definition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [lookupFactor('f1', 'code', { '1,2': 77 }, { fallback: -1 })]),
		])
		expect(expectQuantitative(reasoner.reason({ code: [1, 2] }, definition)).value).toBe(77)
	})

	it('a plain-object field value stringifies to "[object Object]" — pin both the hit and the miss', () => {
		const hitTable = { '[object Object]': 88 }
		const hitDefinition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [lookupFactor('f1', 'code', hitTable, { fallback: -1 })]),
		])
		expect(expectQuantitative(reasoner.reason({ code: {} }, hitDefinition)).value).toBe(88)

		const missDefinition = quantitativeDefinition('d', 'd', [
			factorGroup('g1', 'sum', [lookupFactor('f1', 'code', {}, { fallback: -1 })]),
		])
		expect(expectQuantitative(reasoner.reason({ code: {} }, missDefinition)).value).toBe(-1)
	})
})

describe('QuantitativeReasoner — large lookup table (2000 keys, TRICKY_KEYS mixed in)', () => {
	it('resolves exact hits for several tricky keys and an exact miss, twice, deep-equal', () => {
		const buildTableAndRun = () => {
			// `Object.fromEntries` creates OWN data properties even for "__proto__",
			// unlike a dynamic bracket assignment (which would hit the proto setter).
			const table: Readonly<Record<string, number>> = Object.fromEntries([
				...sequence(2000).map((value): [string, number] => [`gen-${value}`, value]),
				...TRICKY_KEYS.map((key, index): [string, number] => [key, 100000 + index]),
			])
			const definition = quantitativeDefinition('d', 'd', [
				factorGroup('g1', 'sum', [lookupFactor('f1', 'code', table, { fallback: -1 })]),
			])
			return {
				genHit: expectQuantitative(reasoner.reason({ code: 'gen-1500' }, definition)).value,
				properHit: expectQuantitative(reasoner.reason({ code: TRICKY_KEYS[0] }, definition)).value,
				emojiHit: expectQuantitative(reasoner.reason({ code: '\u{1F600}' }, definition)).value,
				emptyHit: expectQuantitative(reasoner.reason({ code: '' }, definition)).value,
				miss: expectQuantitative(reasoner.reason({ code: 'not-in-table' }, definition)).value,
			}
		}
		const first = buildTableAndRun()
		expect(first).toEqual({
			genHit: 1500,
			properHit: 100000,
			emojiHit: 100000 + TRICKY_KEYS.indexOf('\u{1F600}'),
			emptyHit: 100000 + TRICKY_KEYS.indexOf(''),
			miss: -1,
		})
		const second = buildTableAndRun()
		expect(second).toEqual(first)
	})
})

describe('QuantitativeReasoner — precision drift then roundTo', () => {
	it('1000 factors of 0.1 drift below 100 raw, but the definition value rounds to EXACTLY 100', () => {
		const factors = repeatValue(1000, 0.1).map((value, index) => staticFactor(`f${index}`, value))
		const definition = quantitativeDefinition('d', 'd', [factorGroup('g1', 'sum', factors)])
		const result = expectQuantitative(reasoner.reason({}, definition))
		// The group-level value is clamped but NEVER rounded — pin the actual drifted float.
		expect(result.groups[0]?.value).toBe(99.9999999999986)
		expect(result.groups[0]?.value).toBeLessThan(100)
		// roundTo(., 4) at the definition level recovers the exact integer.
		expect(result.value).toBe(100)
		expect(result.success).toBe(true)
	})
})

describe('QuantitativeReasoner — scale: 300 groups × 30 factors, arithmetic series', () => {
	it('sums an arithmetic series of 9000 static factors to the exact formula total, twice', () => {
		const groupCount = 300
		const factorsPerGroup = 30
		const run = () => {
			const groups = sequence(groupCount).map((groupIndex) =>
				factorGroup(
					`g${groupIndex}`,
					'sum',
					sequence(factorsPerGroup, groupIndex * factorsPerGroup).map((value) =>
						staticFactor(`f${groupIndex}_${value}`, value),
					),
				),
			)
			return expectQuantitative(reasoner.reason({}, quantitativeDefinition('d', 'd', groups)))
		}
		const totalCount = groupCount * factorsPerGroup
		const expectedTotal = (totalCount * (totalCount - 1)) / 2

		const first = run()
		expect(first.value).toBe(expectedTotal)
		expect(first.success).toBe(true)
		expect(first.count).toBe(groupCount)

		const second = run()
		expect(second.value).toBe(first.value)
		expect(second.count).toBe(first.count)
	})
})

describe('QuantitativeReasoner — empty min/max aggregate over unapplied groups', () => {
	it('a minimum definition over only-unapplied groups is a NaN finite error', () => {
		// The group exists but its sole factor is gated out, so zero groups apply and
		// the minimum aggregation signals "no data" with NaN.
		const definition = quantitativeDefinition(
			'd',
			'd',
			[
				factorGroup('g1', 'sum', [
					staticFactor('gated', 5, { checks: [check('missing', 'equals', true)] }),
				]),
			],
			{ aggregation: 'minimum' },
		)
		const result = expectQuantitative(reasoner.reason({}, definition))
		expect(Number.isNaN(result.value)).toBe(true)
		expect(result.success).toBe(false)
		expect(result.count).toBe(0)
		expect(result.groups).toHaveLength(1)
		expect(result.errors).toContain('Definition "d" produced non-finite value: NaN')
	})
})

describe('QuantitativeReasoner — builder build() output passed to supports/validate/reason (§15)', () => {
	const definition = quantitativeDefinition('d', 'd', [
		factorGroup('g1', 'sum', [fieldFactor('age', 'age')]),
	])

	it('a built definition + built subject behave identically to the same data written inline (run twice)', () => {
		const builtDefinition = createDefinitionBuilder(definition).build()
		const builtSubject = createSubjectBuilder({ id: 's1', age: 25 }).build()

		expect(reasoner.supports(builtDefinition)).toBe(reasoner.supports(definition))
		expect(reasoner.validate(builtDefinition)).toEqual(reasoner.validate(definition))

		const plainResult = reasoner.reason({ age: 25 }, definition)
		const builtResult = reasoner.reason(builtSubject, builtDefinition)
		expect(builtResult).toEqual(plainResult)
		// Run twice — determinism.
		expect(reasoner.reason(builtSubject, builtDefinition)).toEqual(builtResult)
	})

	it('a mixed batch of plain and built subject payloads mapped through reason() individually produces equal-length, positionally correct results', () => {
		const builtDefinition = createDefinitionBuilder(definition).build()
		const builtSubject = createSubjectBuilder({ id: 's2', age: 2 }).build()
		const subjects = [{ age: 1 }, builtSubject]
		const results = subjects.map((subject) => reasoner.reason(subject, builtDefinition))
		const expected = [
			reasoner.reason({ age: 1 }, definition),
			reasoner.reason(builtSubject, definition),
		]
		expect(results).toEqual(expected)
	})
})
