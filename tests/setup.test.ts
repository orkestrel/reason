// The proof of `tests/setup.ts` — the host-independent test infrastructure every Vitest
// project in this workspace loads as `setupFiles[0]`. Its subject is that module's own
// exported behavior: the narrowers, the builders, and the frozen data tables the suites
// read. The `@src/core` production behavior those builders compose is proven by the
// `src:core` suites, and nothing here re-proves it.

import { describe, expect, it } from 'vitest'
import { requireValue } from '@orkestrel/test'
import type {
	Expression,
	InferentialResult,
	LogicalResult,
	QuantitativeResult,
	ReasonResult,
	Reasoning,
	SymbolicExpression,
	SymbolicResult,
} from '@src/core'
import {
	ADVERSARIAL_SYMBOL_KEY,
	ADVERSARIAL_VALUE_SUBJECT,
	BASIC_SUBJECT,
	buildStaticDefinition,
	buildSubjects,
	createThrowingReasoner,
	deepAddition,
	deepCompound,
	deepFreeze,
	DRIVER_SUBJECT,
	expectInferential,
	expectLogical,
	expectQuantitative,
	expectSymbolic,
	EXTREME_NUMBERS,
	INTEGER_KEY_SUBJECT,
	NESTED_SUBJECT,
	repeatValue,
	runTwice,
	sequence,
	sparse,
	TRICKY_KEYS,
} from './setup.js'

/** An inert `QuantitativeResult` — the narrowers read `reasoning` and nothing else. */
const QUANTITATIVE_RESULT: QuantitativeResult = {
	reasoning: 'quantitative',
	value: 42,
	groups: [],
	count: 0,
	success: true,
	trace: [],
	errors: [],
}

/** An inert `LogicalResult` — the {@link QUANTITATIVE_RESULT} sibling. */
const LOGICAL_RESULT: LogicalResult = {
	reasoning: 'logical',
	conclusion: true,
	rules: [],
	count: 0,
	success: true,
	trace: [],
	errors: [],
}

/** An inert `SymbolicResult` — the {@link QUANTITATIVE_RESULT} sibling. */
const SYMBOLIC_RESULT: SymbolicResult = {
	reasoning: 'symbolic',
	solutions: {},
	success: true,
	trace: [],
	errors: [],
}

/** An inert `InferentialResult` — the {@link QUANTITATIVE_RESULT} sibling. */
const INFERENTIAL_RESULT: InferentialResult = {
	reasoning: 'inferential',
	derived: [],
	success: true,
	trace: [],
	errors: [],
}

/** Each narrower paired with the reasoning it accepts and a result carrying that reasoning. */
const NARROWERS: ReadonlyArray<{
	readonly reasoning: Reasoning
	readonly narrow: (result: ReasonResult | readonly ReasonResult[]) => ReasonResult
	readonly result: ReasonResult
}> = Object.freeze([
	{ reasoning: 'quantitative', narrow: expectQuantitative, result: QUANTITATIVE_RESULT },
	{ reasoning: 'logical', narrow: expectLogical, result: LOGICAL_RESULT },
	{ reasoning: 'symbolic', narrow: expectSymbolic, result: SYMBOLIC_RESULT },
	{ reasoning: 'inferential', narrow: expectInferential, result: INFERENTIAL_RESULT },
])

/** The leaf the compound-nesting cases wrap. */
const LEAF: Expression = { form: 'atom', check: { field: 'age', operator: 'equals', value: 30 } }

/** The innermost term the addition-nesting cases wrap. */
const TERM: SymbolicExpression = { form: 'constant', value: 5 }

/** The operand each addition layer adds. */
const STEP: SymbolicExpression = { form: 'constant', value: 2 }

describe('result narrowers', () => {
	it('returns the matching single result unchanged', () => {
		for (const entry of NARROWERS) {
			expect(entry.narrow(entry.result)).toBe(entry.result)
		}
	})

	it('refuses a batch array', () => {
		for (const entry of NARROWERS) {
			expect(() => entry.narrow([entry.result])).toThrow(
				'Expected a single result, got a batch array',
			)
		}
	})

	it('refuses another reasoning and names the one it found', () => {
		for (const [index, entry] of NARROWERS.entries()) {
			const other = requireValue(NARROWERS[(index + 1) % NARROWERS.length])
			expect(() => entry.narrow(other.result)).toThrow(`got "${other.reasoning}"`)
		}
	})
})

describe('deep freezing', () => {
	it('freezes the value in place and every plain object and array it reaches', () => {
		const tree = { name: 'root', items: [1, 2], child: { flags: [true] } }
		expect(deepFreeze(tree)).toBe(tree)
		expect(Object.isFrozen(tree)).toBe(true)
		expect(Object.isFrozen(tree.items)).toBe(true)
		expect(Object.isFrozen(tree.child)).toBe(true)
		expect(Object.isFrozen(tree.child.flags)).toBe(true)
		expect(() => {
			tree.child.flags[0] = false
		}).toThrow(TypeError)
	})

	it('returns a value outside the plain object family untouched', () => {
		const stamp = new Date(0)
		const table = new Map([['key', { nested: true }]])
		expect(deepFreeze(stamp)).toBe(stamp)
		expect(Object.isFrozen(stamp)).toBe(false)
		expect(deepFreeze(table)).toBe(table)
		expect(Object.isFrozen(table)).toBe(false)
		expect(deepFreeze(7)).toBe(7)
	})
})

describe('subject fixtures', () => {
	it('spans one field of each scalar kind', () => {
		expect(new Set(Object.values(BASIC_SUBJECT).map((value) => typeof value))).toEqual(
			new Set(['string', 'number', 'boolean']),
		)
		expect(BASIC_SUBJECT.id).toBe('subject-1')
	})

	it('nests two levels for the field-path descent cases', () => {
		expect(NESTED_SUBJECT.id).toBe('nested-1')
		expect(NESTED_SUBJECT.address).toEqual({ city: 'NY', zip: '10001' })
		expect(NESTED_SUBJECT.scores).toEqual({ math: 90, english: 80 })
	})

	it('carries the driver-scoring factors as numbers', () => {
		expect(Object.keys(DRIVER_SUBJECT)).toEqual(['driverAge', 'violationCount', 'vehicleYear'])
		expect(Object.entries(DRIVER_SUBJECT).filter(([, value]) => typeof value !== 'number')).toEqual(
			[],
		)
	})
})

describe('definition and reasoner builders', () => {
	it('assembles one sum group holding one static factor', () => {
		expect(buildStaticDefinition('rate', 7)).toEqual({
			reasoning: 'quantitative',
			id: 'rate',
			name: 'rate',
			aggregation: 'sum',
			groups: [
				{
					id: 'g1',
					name: 'g1',
					aggregation: 'sum',
					factors: [{ id: 'f1', name: 'f1', source: { origin: 'static', value: 7 } }],
				},
			],
		})
	})

	it('defaults its id and its factor value', () => {
		const definition = buildStaticDefinition()
		expect(definition.id).toBe('static-quant')
		expect(definition.name).toBe('static-quant')
		const group = requireValue(definition.groups[0])
		expect(requireValue(group.factors[0]).source).toEqual({ origin: 'static', value: 42 })
	})

	it('scripts a reasoner that validates clean and throws on every run', () => {
		const reasoner = createThrowingReasoner()
		const definition = buildStaticDefinition()
		expect(reasoner.id).toBe('throwing')
		expect(reasoner.reasoning).toBe('quantitative')
		expect(reasoner.supports(definition)).toBe(true)
		expect(reasoner.validate(definition)).toEqual({ valid: true, errors: [], warnings: [] })
		expect(() => reasoner.reason(BASIC_SUBJECT, definition)).toThrow('boom')
	})

	it('registers the scripted reasoner under the reasoning it is given', () => {
		const reasoner = createThrowingReasoner('no reasoner here', 'logical')
		const definition = buildStaticDefinition()
		expect(reasoner.reasoning).toBe('logical')
		expect(reasoner.supports(definition)).toBe(false)
		expect(() => reasoner.reason(BASIC_SUBJECT, definition)).toThrow('no reasoner here')
	})
})

describe('sequence and fill builders', () => {
	it('runs a scenario twice and returns the outcomes in call order', () => {
		const seen: string[] = []
		const outcomes = runTwice(() => {
			seen.push(`run-${seen.length}`)
			return seen.length
		})
		expect(seen).toEqual(['run-0', 'run-1'])
		expect(outcomes).toEqual([1, 2])
	})

	it('counts up from the start it is given', () => {
		expect(sequence(4, 3)).toEqual([3, 4, 5, 6])
		expect(sequence(3)).toEqual([0, 1, 2])
	})

	it('produces an empty range and an empty fill for a non-positive count', () => {
		expect(sequence(0)).toEqual([])
		expect(sequence(-3, 5)).toEqual([])
		expect(repeatValue(0, 'x')).toEqual([])
		expect(repeatValue(-3, 'x')).toEqual([])
		expect(buildSubjects(0)).toEqual([])
	})

	it('fills every slot with the one reference it is given', () => {
		const marker = { shared: true }
		const filled = repeatValue(3, marker)
		expect(filled).toHaveLength(3)
		for (const slot of filled) expect(slot).toBe(marker)
	})

	it('numbers each built subject by its index', () => {
		expect(buildSubjects(3)).toEqual([
			{ id: 's0', value: 0 },
			{ id: 's1', value: 1 },
			{ id: 's2', value: 2 },
		])
	})

	it('leaves a real hole at every index it is not given', () => {
		const holed = sparse(4, [
			[1, 'b'],
			[3, 'd'],
		])
		expect(holed).toHaveLength(4)
		expect(Object.keys(holed)).toEqual(['1', '3'])
		expect(1 in holed).toBe(true)
		expect(0 in holed).toBe(false)
		expect(holed[1]).toBe('b')
	})
})

describe('expression builders', () => {
	it('wraps the leaf in one single-operand and-compound per layer', () => {
		let node: Expression = deepCompound(3, LEAF)
		let layers = 0
		while (node.form === 'compound') {
			expect(node.operator).toBe('and')
			expect(node.operands).toHaveLength(1)
			node = requireValue(node.operands[0])
			layers += 1
		}
		expect(layers).toBe(3)
		expect(node).toBe(LEAF)
	})

	it('left-nests one add operation per layer around the same step', () => {
		let node: SymbolicExpression = deepAddition(3, TERM, STEP)
		let layers = 0
		while (node.form === 'operation') {
			expect(node.operator).toBe('add')
			expect(node.right).toBe(STEP)
			node = node.left
			layers += 1
		}
		expect(layers).toBe(3)
		expect(node).toBe(TERM)
	})

	it('returns the leaf unwrapped for a non-positive depth', () => {
		expect(deepCompound(0, LEAF)).toBe(LEAF)
		expect(deepCompound(-2, LEAF)).toBe(LEAF)
		expect(deepAddition(0, TERM, STEP)).toBe(TERM)
		expect(deepAddition(-2, TERM, STEP)).toBe(TERM)
	})
})

describe('frozen data tables', () => {
	it('keeps every extreme number finite and each zero distinct', () => {
		expect(Object.isFrozen(EXTREME_NUMBERS)).toBe(true)
		expect(EXTREME_NUMBERS.filter((value) => !Number.isFinite(value))).toEqual([])
		expect(EXTREME_NUMBERS.filter((value) => Object.is(value, -0))).toHaveLength(1)
		expect(EXTREME_NUMBERS.filter((value) => Object.is(value, 0))).toHaveLength(1)
	})

	it('carries the adversarial key shapes the field-path proofs read', () => {
		expect(Object.isFrozen(TRICKY_KEYS)).toBe(true)
		expect(new Set(TRICKY_KEYS).size).toBe(TRICKY_KEYS.length)
		for (const key of ['__proto__', 'constructor', 'prototype', 'toString', '', 'a.b']) {
			expect(TRICKY_KEYS).toContain(key)
		}
		const astral = requireValue(TRICKY_KEYS.find((key) => key.length > [...key].length))
		expect([...astral]).toHaveLength(1)
		expect(astral.length).toBe(2)
	})

	it('enumerates its integer-like keys ascending ahead of its string keys', () => {
		expect(Object.isFrozen(INTEGER_KEY_SUBJECT)).toBe(true)
		expect(Object.keys(INTEGER_KEY_SUBJECT)).toEqual(['1', '2', '10', 'zeta', 'id', 'alpha'])
		const scored = Object.entries(INTEGER_KEY_SUBJECT).filter(([key]) => key !== 'id')
		expect(scored.filter(([, value]) => typeof value !== 'number')).toEqual([])
	})

	it('hides its symbol-keyed property from the string keys that surface as facts', () => {
		expect(Object.isFrozen(ADVERSARIAL_VALUE_SUBJECT)).toBe(true)
		expect(Object.keys(ADVERSARIAL_VALUE_SUBJECT)).toEqual(['id', 'big', 'sym', 'fn'])
		expect(Object.getOwnPropertySymbols(ADVERSARIAL_VALUE_SUBJECT)).toEqual([
			ADVERSARIAL_SYMBOL_KEY,
		])
		const hidden = requireValue(
			Object.getOwnPropertyDescriptor(ADVERSARIAL_VALUE_SUBJECT, ADVERSARIAL_SYMBOL_KEY),
		)
		expect(hidden.value).toBe('hidden')
	})

	it('types every string-keyed value outside the object family', () => {
		expect(
			Object.entries(ADVERSARIAL_VALUE_SUBJECT).map(([key, value]) => [key, typeof value]),
		).toEqual([
			['id', 'string'],
			['big', 'bigint'],
			['sym', 'symbol'],
			['fn', 'function'],
		])
	})
})
