import {
	atom,
	bounds,
	check,
	compound,
	constant,
	DEFINITION_BUILDER_BRAND,
	equation,
	fact,
	factorGroup,
	fieldFactor,
	inference,
	inferentialDefinition,
	isAggregation,
	isBounds,
	isChainingStrategy,
	isCheck,
	isComparison,
	isDefinition,
	isEquation,
	isExpression,
	isFact,
	isFactor,
	isFactorGroup,
	isFactorRange,
	isFieldPath,
	isInference,
	isInferentialDefinition,
	isLogicalDefinition,
	isLogicalOperator,
	isMathOperation,
	isNumberRecord,
	isQuantitativeDefinition,
	isReasoning,
	isDefinitionBuilder,
	isSubjectBuilder,
	isRule,
	isSource,
	isSubject,
	isSymbolicDefinition,
	isSymbolicExpression,
	isTransform,
	logicalDefinition,
	lookupSource,
	operation,
	quantitativeDefinition,
	rangeSource,
	rule,
	staticFactor,
	staticSource,
	SUBJECT_BUILDER_BRAND,
	symbolicDefinition,
	transform,
	variable,
} from '@src/core'
import { parseJSON } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import { TRICKY_KEYS, captureError, sequence } from '../../setup.js'

// The reasons validators — deep TOTAL guards (AGENTS §14): every guard accepts
// its builder's output (builder ↔ guard round-trip), rejects off-shape input,
// enforces EXACT records (an extra key fails), guards numeric fields with
// finite-only semantics (JSON cannot carry NaN / Infinity), and survives
// adversarial junk — including CYCLIC and pathologically deep expression trees,
// contained by `lazyOf` (false, never a throw). `Check.value` must be PRESENT
// but may be anything (null / undefined included); `Fact.terms` elements are
// unrestricted.

// The shared adversarial spread — none of these is any reasons shape except
// the empty array, which ONLY isFieldPath accepts (an empty key path); every
// record guard must reject both array probes (records get their own tailored
// near-miss probes per guard).
const ADVERSARIAL: readonly unknown[] = [
	null,
	undefined,
	42,
	3.14,
	true,
	false,
	'junk',
	Symbol('s'),
	10n,
	() => 1,
	new Date(),
	new Map(),
	[],
	[1, 2, 3],
]

// The subset of the adversarial values a guard accepts (empty = rejects all).
function accepted(guard: (value: unknown) => boolean): readonly unknown[] {
	return ADVERSARIAL.filter((value) => guard(value))
}

describe('literal-union guards', () => {
	it('isReasoning accepts the four strategies and rejects everything else', () => {
		for (const value of ['quantitative', 'logical', 'symbolic', 'inferential']) {
			expect(isReasoning(value)).toBe(true)
		}
		expect(isReasoning('fuzzy')).toBe(false)
		expect(accepted(isReasoning)).toEqual([])
	})

	it('isChainingStrategy accepts forward / backward only', () => {
		expect(isChainingStrategy('forward')).toBe(true)
		expect(isChainingStrategy('backward')).toBe(true)
		expect(isChainingStrategy('upward')).toBe(false)
		expect(accepted(isChainingStrategy)).toEqual([])
	})

	it('isMathOperation accepts all thirteen operations and rejects strays', () => {
		const operations = [
			'add',
			'subtract',
			'multiply',
			'divide',
			'percentage',
			'minimum',
			'maximum',
			'average',
			'power',
			'round',
			'ceil',
			'floor',
			'abs',
		]
		for (const value of operations) expect(isMathOperation(value)).toBe(true)
		expect(isMathOperation('modulo')).toBe(false)
		expect(accepted(isMathOperation)).toEqual([])
	})

	it('isAggregation accepts the five aggregations only', () => {
		for (const value of ['sum', 'product', 'average', 'minimum', 'maximum']) {
			expect(isAggregation(value)).toBe(true)
		}
		expect(isAggregation('median')).toBe(false)
		expect(accepted(isAggregation)).toEqual([])
	})

	it('isComparison accepts the renamed ten-operator vocabulary only', () => {
		const comparisons = [
			'equals',
			'not',
			'above',
			'below',
			'from',
			'to',
			'any',
			'none',
			'between',
			'outside',
		]
		for (const value of comparisons) expect(isComparison(value)).toBe(true)
		// The scsr multi-word vocabulary is gone (DESIGN §2).
		expect(isComparison('greaterThan')).toBe(false)
		expect(isComparison('notEquals')).toBe(false)
		expect(accepted(isComparison)).toEqual([])
	})

	it('isLogicalOperator accepts the five connectives only', () => {
		for (const value of ['and', 'or', 'not', 'implies', 'xor']) {
			expect(isLogicalOperator(value)).toBe(true)
		}
		expect(isLogicalOperator('nand')).toBe(false)
		// 'not' doubles as a Comparison — but is still a valid connective here.
		expect(accepted(isLogicalOperator)).toEqual([])
	})
})

describe('isFieldPath / isSubject / isNumberRecord', () => {
	it('isFieldPath accepts a string key and a string array (including empty)', () => {
		expect(isFieldPath('age')).toBe(true)
		expect(isFieldPath('a.b')).toBe(true)
		expect(isFieldPath(['address', 'city'])).toBe(true)
		expect(isFieldPath([])).toBe(true)
	})

	it('isFieldPath rejects mixed arrays and non-strings', () => {
		expect(isFieldPath(['a', 1])).toBe(false)
		expect(isFieldPath(42)).toBe(false)
		expect(isFieldPath({ path: 'a' })).toBe(false)
		// Of the adversarial spread only the string and the EMPTY array qualify.
		expect(accepted(isFieldPath)).toEqual(['junk', []])
	})

	it('isSubject accepts plain records and rejects arrays / class instances', () => {
		expect(isSubject({})).toBe(true)
		expect(isSubject({ age: 30 })).toBe(true)
		expect(isSubject(Object.create(null))).toBe(true)
		expect(isSubject([1, 2, 3])).toBe(false)
		expect(accepted(isSubject)).toEqual([])
	})

	it('isNumberRecord demands finite-number values on every key', () => {
		expect(isNumberRecord({})).toBe(true)
		expect(isNumberRecord({ CA: 1.2, NY: 0.8 })).toBe(true)
		expect(isNumberRecord({ CA: '1.2' })).toBe(false)
		expect(isNumberRecord({ CA: Number.NaN })).toBe(false)
		expect(isNumberRecord({ CA: Number.POSITIVE_INFINITY })).toBe(false)
		expect(accepted(isNumberRecord)).toEqual([])
	})
})

describe('isCheck', () => {
	it('accepts the builder output and any value type — but the value key must be PRESENT', () => {
		expect(isCheck(check('age', 'above', 18))).toBe(true)
		expect(isCheck(check('a', 'equals', null))).toBe(true)
		expect(isCheck({ field: 'a', operator: 'equals', value: undefined })).toBe(true)
		expect(isCheck({ field: 'a', operator: 'equals' })).toBe(false)
	})

	it('rejects unknown operators, bad field paths, extra keys, and junk', () => {
		expect(isCheck({ field: 'age', operator: 'over', value: 18 })).toBe(false)
		expect(isCheck({ field: 7, operator: 'equals', value: 18 })).toBe(false)
		expect(isCheck({ field: 'age', operator: 'equals', value: 18, negate: true })).toBe(false)
		expect(accepted(isCheck)).toEqual([])
	})

	it('an OWN __proto__ key (parsed JSON) is an extra key — rejected', () => {
		// JSON parsing creates __proto__ as an OWN key (no prototype poisoning),
		// so exact-record semantics see and reject it like any other stray key.
		const hostile = parseJSON(
			'{"field":"a","operator":"equals","value":1,"__proto__":{"polluted":true}}',
		)
		expect(isCheck(hostile)).toBe(false)
	})

	it('SYMBOL-keyed extras are invisible to exactness — accepted (string keys only)', () => {
		const extra = Symbol('extra')
		expect(isCheck({ ...check('a', 'equals', 1), [extra]: 1 })).toBe(true)
	})
})

describe('isTransform / isBounds / isFactorRange', () => {
	it('isTransform accepts operand-less and operand-carrying transforms', () => {
		expect(isTransform(transform('round'))).toBe(true)
		expect(isTransform(transform('multiply', 2))).toBe(true)
	})

	it('isTransform rejects non-finite operands, extra keys, and junk', () => {
		expect(isTransform({ operation: 'multiply', operand: Number.NaN })).toBe(false)
		expect(isTransform({ operation: 'multiply', by: 2 })).toBe(false)
		expect(isTransform({ operation: 'modulo' })).toBe(false)
		expect(accepted(isTransform)).toEqual([])
	})

	it('isBounds accepts empty / one-sided / two-sided bounds', () => {
		expect(isBounds(bounds())).toBe(true)
		expect(isBounds(bounds(0))).toBe(true)
		expect(isBounds(bounds(undefined, 100))).toBe(true)
		expect(isBounds(bounds(0, 100))).toBe(true)
	})

	it('isBounds rejects non-finite sides, extra keys, and junk', () => {
		expect(isBounds({ minimum: Number.NaN })).toBe(false)
		expect(isBounds({ minimum: 0, maximum: 100, step: 1 })).toBe(false)
		expect(accepted(isBounds)).toEqual([])
	})

	it('isFactorRange accepts a banded and a catch-all range', () => {
		expect(isFactorRange({ bounds: { maximum: 25 }, value: 1.5 })).toBe(true)
		expect(isFactorRange({ value: 42 })).toBe(true)
	})

	it('isFactorRange rejects a missing value, malformed bounds, and junk', () => {
		expect(isFactorRange({ bounds: { maximum: 25 } })).toBe(false)
		expect(isFactorRange({ bounds: { maximum: 'high' }, value: 1 })).toBe(false)
		expect(isFactorRange({ value: 42, label: 'x' })).toBe(false)
		expect(accepted(isFactorRange)).toEqual([])
	})
})

describe('isSource', () => {
	it('accepts all four origins (builder round-trip)', () => {
		expect(isSource(staticSource(42))).toBe(true)
		expect(isSource({ origin: 'field', field: ['profile', 'score'] })).toBe(true)
		expect(isSource(lookupSource('state', { CA: 5 }))).toBe(true)
		expect(isSource(rangeSource('age', [{ bounds: { maximum: 25 }, value: 10 }]))).toBe(true)
	})

	it('rejects an unknown origin, cross-shape mixes, and junk', () => {
		expect(isSource({ origin: 'random' })).toBe(false)
		expect(isSource({ origin: 'static', value: Number.NaN })).toBe(false)
		// An exact record — a static source may not carry a field key.
		expect(isSource({ origin: 'static', value: 42, field: 'age' })).toBe(false)
		expect(isSource({ origin: 'lookup', field: 'state', table: { CA: 'high' } })).toBe(false)
		expect(accepted(isSource)).toEqual([])
	})
})

describe('isFactor / isFactorGroup', () => {
	it('isFactor accepts a minimal and a fully-loaded factor', () => {
		expect(isFactor(staticFactor('f1', 10))).toBe(true)
		expect(
			isFactor(
				fieldFactor('f2', 'income', {
					description: 'income score',
					fallback: 0,
					checks: [check('income', 'above', 0)],
					transforms: [transform('divide', 1000)],
					bounds: bounds(0, 40),
					weight: 2,
					priority: 1,
					enabled: true,
					required: true,
				}),
			),
		).toBe(true)
	})

	it('isFactor rejects a missing source, extra keys, and junk', () => {
		expect(isFactor({ id: 'f1', name: 'f1' })).toBe(false)
		expect(isFactor({ ...staticFactor('f1', 10), label: 'legacy' })).toBe(false)
		expect(isFactor({ ...staticFactor('f1', 10), weight: Number.NaN })).toBe(false)
		expect(accepted(isFactor)).toEqual([])
	})

	it('isFactorGroup accepts minimal and overridden groups', () => {
		expect(isFactorGroup(factorGroup('g1', 'sum', [staticFactor('f1', 10)]))).toBe(true)
		expect(
			isFactorGroup(factorGroup('g1', 'product', [], { base: 1, strict: true, enabled: false })),
		).toBe(true)
	})

	it('isFactorGroup rejects a bad aggregation, a bad factor, extra keys, and junk', () => {
		expect(isFactorGroup({ id: 'g1', name: 'g1', aggregation: 'median', factors: [] })).toBe(false)
		expect(
			isFactorGroup({ id: 'g1', name: 'g1', aggregation: 'sum', factors: [{ id: 'broken' }] }),
		).toBe(false)
		expect(isFactorGroup({ ...factorGroup('g1', 'sum', []), weight: 1 })).toBe(false)
		expect(accepted(isFactorGroup)).toEqual([])
	})
})

describe('isExpression — recursive via lazyOf', () => {
	it('accepts atoms, compounds, and deeply nested trees', () => {
		expect(isExpression(atom('age', 'from', 18))).toBe(true)
		expect(isExpression(compound('and', [atom('a', 'equals', 1), atom('b', 'equals', 2)]))).toBe(
			true,
		)
		// A 100-deep nest still validates (recursion is depth-tolerant at sane sizes).
		let deep = atom('a', 'equals', 1)
		for (let index = 0; index < 100; index++) deep = compound('not', [deep])
		expect(isExpression(deep)).toBe(true)
	})

	it('rejects missing operands, unknown forms, extra keys, and junk', () => {
		expect(isExpression({ form: 'compound', operator: 'and' })).toBe(false)
		expect(isExpression({ form: 'chain', operator: 'and', operands: [] })).toBe(false)
		expect(isExpression({ form: 'atom', check: check('a', 'equals', 1), extra: true })).toBe(false)
		expect(isExpression(compound('and', []))).toBe(true)
		expect(accepted(isExpression)).toEqual([])
	})

	it('contains a CYCLIC expression — false, never a throw (AGENTS §14)', () => {
		const cyclic: Record<string, unknown> = { form: 'compound', operator: 'and' }
		cyclic.operands = [cyclic]
		expect(isExpression(cyclic)).toBe(false)
	})

	it('contains a BEYOND-STACK-BUDGET nest — false, never a RangeError (AGENTS §14)', () => {
		// Recursion is stack-bounded, not unbounded: 100,000 levels of `not`
		// overflow the engine stack; lazyOf contains the overflow as a non-match.
		let deep = atom('a', 'equals', 1)
		for (let index = 0; index < 100000; index++) deep = compound('not', [deep])
		expect(isExpression(deep)).toBe(false)
	})
})

describe('isRule', () => {
	it('accepts the builder output (with and without overrides)', () => {
		expect(isRule(rule('adult', [atom('age', 'from', 18)], atom('adult', 'equals', true)))).toBe(
			true,
		)
		expect(
			isRule(rule('adult', [], atom('adult', 'equals', true), { priority: 1, enabled: false })),
		).toBe(true)
	})

	it('rejects a missing conclusion, a bad premise, extra keys, and junk', () => {
		expect(isRule({ id: 'adult', name: 'adult', premises: [] })).toBe(false)
		expect(
			isRule({ id: 'r', name: 'r', premises: [{ bad: true }], conclusion: atom('x', 'equals', 1) }),
		).toBe(false)
		expect(isRule({ ...rule('r', [], atom('x', 'equals', 1)), confidence: 0.5 })).toBe(false)
		expect(accepted(isRule)).toEqual([])
	})
})

describe('isSymbolicExpression — recursive via lazyOf', () => {
	it('accepts variables, constants, and nested operations (right optional)', () => {
		expect(isSymbolicExpression(variable('x'))).toBe(true)
		expect(isSymbolicExpression(constant(42))).toBe(true)
		expect(isSymbolicExpression(operation('add', variable('x'), constant(1)))).toBe(true)
		expect(isSymbolicExpression(operation('abs', variable('x')))).toBe(true)
		expect(
			isSymbolicExpression(
				operation('add', operation('multiply', constant(2), variable('x')), constant(3)),
			),
		).toBe(true)
	})

	it('rejects a non-finite constant, a nameless variable, unknown forms, and junk', () => {
		expect(isSymbolicExpression({ form: 'constant', value: Number.NaN })).toBe(false)
		expect(isSymbolicExpression({ form: 'variable' })).toBe(false)
		expect(
			isSymbolicExpression({ form: 'operation', operator: 'add', left: variable('x'), extra: 1 }),
		).toBe(false)
		expect(isSymbolicExpression({ form: 'lambda', name: 'x' })).toBe(false)
		expect(accepted(isSymbolicExpression)).toEqual([])
	})

	it('contains a CYCLIC operation tree — false, never a throw (AGENTS §14)', () => {
		const cyclic: Record<string, unknown> = { form: 'operation', operator: 'add' }
		cyclic.left = cyclic
		expect(isSymbolicExpression(cyclic)).toBe(false)
	})

	it('contains a BEYOND-STACK-BUDGET nest — false, never a RangeError (AGENTS §14)', () => {
		let deep = constant(1)
		for (let index = 0; index < 100000; index++) deep = operation('abs', deep)
		expect(isSymbolicExpression(deep)).toBe(false)
	})
})

describe('isEquation', () => {
	it('accepts the builder output', () => {
		expect(isEquation(equation('e1', variable('x'), constant(42), 'x'))).toBe(true)
		expect(
			isEquation(equation('e1', variable('x'), constant(42), 'x', { description: 'solve x' })),
		).toBe(true)
	})

	it('rejects missing sides, a missing target, extra keys, and junk', () => {
		expect(isEquation({ id: 'e1', name: 'e1', target: 'x' })).toBe(false)
		expect(isEquation({ id: 'e1', name: 'e1', left: variable('x'), right: constant(1) })).toBe(
			false,
		)
		expect(isEquation({ ...equation('e1', variable('x'), constant(1), 'x'), label: 'x' })).toBe(
			false,
		)
		expect(accepted(isEquation)).toEqual([])
	})
})

describe('isFact / isInference', () => {
	it('isFact accepts mixed unrestricted terms (confidence optional)', () => {
		expect(isFact(fact('f1', 'human', ['socrates']))).toBe(true)
		expect(isFact({ id: 'f1', predicate: 'has', terms: ['age', 30, null, { deep: true }] })).toBe(
			true,
		)
	})

	it('isFact rejects non-array terms, a non-finite confidence, extra keys, and junk', () => {
		expect(isFact({ id: 'f1', predicate: 'human', terms: 'socrates' })).toBe(false)
		expect(isFact({ id: 'f1', predicate: 'human', terms: [], confidence: Number.NaN })).toBe(false)
		expect(isFact({ ...fact('f1', 'human', ['x']), arguments: ['x'] })).toBe(false)
		expect(accepted(isFact)).toEqual([])
	})

	it('isInference accepts the builder output (with and without overrides)', () => {
		expect(
			isInference(inference('mortal', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']))),
		).toBe(true)
		expect(
			isInference(
				inference('mortal', [], fact('c1', 'mortal', ['?x']), { confidence: 0.8, enabled: true }),
			),
		).toBe(true)
	})

	it('isInference rejects a missing conclusion, bad premises, extra keys, and junk', () => {
		expect(isInference({ id: 'i1', name: 'i1', premises: [] })).toBe(false)
		expect(
			isInference({ id: 'i1', name: 'i1', premises: [{}], conclusion: fact('c', 'p', []) }),
		).toBe(false)
		expect(isInference({ ...inference('i1', [], fact('c', 'p', [])), priority: 1 })).toBe(false)
		expect(accepted(isInference)).toEqual([])
	})
})

describe('definition guards', () => {
	it('isQuantitativeDefinition accepts builder output, minimal and loaded', () => {
		expect(isQuantitativeDefinition(quantitativeDefinition('risk', 'Risk', []))).toBe(true)
		expect(
			isQuantitativeDefinition(
				quantitativeDefinition('risk', 'Risk', [factorGroup('g1', 'sum', [staticFactor('f', 1)])], {
					base: 10,
					bounds: bounds(0, 100),
					precision: 2,
				}),
			),
		).toBe(true)
	})

	it('isQuantitativeDefinition rejects the wrong reasoning, missing groups, and extras', () => {
		expect(isQuantitativeDefinition(logicalDefinition('x', 'x', []))).toBe(false)
		expect(isQuantitativeDefinition({ reasoning: 'quantitative', id: 'risk' })).toBe(false)
		expect(
			isQuantitativeDefinition({ ...quantitativeDefinition('r', 'r', []), strategy: 'forward' }),
		).toBe(false)
		expect(accepted(isQuantitativeDefinition)).toEqual([])
	})

	it('isLogicalDefinition accepts builder output and rejects drift', () => {
		expect(isLogicalDefinition(logicalDefinition('elig', 'Eligibility', []))).toBe(true)
		expect(
			isLogicalDefinition(
				logicalDefinition('elig', 'Eligibility', [rule('r', [], atom('x', 'equals', 1))], {
					strategy: 'backward',
					depth: 5,
				}),
			),
		).toBe(true)
		expect(isLogicalDefinition({ reasoning: 'logical', id: 'elig' })).toBe(false)
		expect(isLogicalDefinition({ ...logicalDefinition('e', 'e', []), depth: Number.NaN })).toBe(
			false,
		)
		expect(accepted(isLogicalDefinition)).toEqual([])
	})

	it('isSymbolicDefinition accepts builder output and rejects drift', () => {
		expect(isSymbolicDefinition(symbolicDefinition('rate', 'Rate', []))).toBe(true)
		expect(
			isSymbolicDefinition(
				symbolicDefinition('rate', 'Rate', [equation('e1', variable('x'), constant(1), 'x')], {
					variables: { pi: 3.14 },
					precision: 2,
				}),
			),
		).toBe(true)
		expect(isSymbolicDefinition({ reasoning: 'symbolic', id: 'rate' })).toBe(false)
		expect(
			isSymbolicDefinition({ ...symbolicDefinition('r', 'r', []), variables: { x: 'ten' } }),
		).toBe(false)
		expect(accepted(isSymbolicDefinition)).toEqual([])
	})

	it('isInferentialDefinition accepts builder output and rejects drift', () => {
		expect(isInferentialDefinition(inferentialDefinition('birds', 'Birds', [], []))).toBe(true)
		expect(
			isInferentialDefinition(
				inferentialDefinition(
					'birds',
					'Birds',
					[fact('f1', 'hasFeathers', ['tweety'])],
					[inference('i1', [fact('p1', 'hasFeathers', ['?x'])], fact('c1', 'isBird', ['?x']))],
					{ strategy: 'backward', depth: 5 },
				),
			),
		).toBe(true)
		expect(isInferentialDefinition({ reasoning: 'inferential', id: 'birds' })).toBe(false)
		expect(isInferentialDefinition({ ...inferentialDefinition('b', 'b', [], []), rules: [] })).toBe(
			false,
		)
		expect(accepted(isInferentialDefinition)).toEqual([])
	})

	it('isDefinition unions the four (and rejects a fifth reasoning)', () => {
		expect(isDefinition(quantitativeDefinition('a', 'a', []))).toBe(true)
		expect(isDefinition(logicalDefinition('b', 'b', []))).toBe(true)
		expect(isDefinition(symbolicDefinition('c', 'c', []))).toBe(true)
		expect(isDefinition(inferentialDefinition('d', 'd', [], []))).toBe(true)
		expect(isDefinition({ reasoning: 'quantum', id: 'x', name: 'x' })).toBe(false)
		expect(accepted(isDefinition)).toEqual([])
	})
})

// ── Entity brand guards — isDefinitionBuilder / isSubjectBuilder ────────────────
// PROPOSAL §4: a plain subject is an open record whose values may legally be
// functions, so a method-presence check (`typeof value.build === 'function'`)
// is FORGEABLE. These guards check a `unique symbol` brand via `Reflect.get`
// instead — a module-owned symbol cannot be produced by a plain object
// literal (JSON has no symbol keys), so plain data can never forge either
// entity, and the two brands are distinct symbols so neither entity can match
// the other's guard.

describe('isDefinitionBuilder / isSubjectBuilder — entity brand guards', () => {
	it('isDefinitionBuilder accepts only a value carrying DEFINITION_BUILDER_BRAND === true', () => {
		expect(isDefinitionBuilder({ [DEFINITION_BUILDER_BRAND]: true })).toBe(true)
		expect(isDefinitionBuilder({ [DEFINITION_BUILDER_BRAND]: false })).toBe(false)
		expect(isDefinitionBuilder({})).toBe(false)
		// Plain definition DATA is not the entity — the guard is brand-based, not shape-based.
		expect(isDefinitionBuilder(quantitativeDefinition('r', 'R', []))).toBe(false)
		expect(accepted(isDefinitionBuilder)).toEqual([])
	})

	it('isSubjectBuilder accepts only a value carrying SUBJECT_BUILDER_BRAND === true', () => {
		expect(isSubjectBuilder({ [SUBJECT_BUILDER_BRAND]: true })).toBe(true)
		expect(isSubjectBuilder({ [SUBJECT_BUILDER_BRAND]: false })).toBe(false)
		expect(isSubjectBuilder({})).toBe(false)
		// Plain subject DATA is not the entity — the guard is brand-based, not shape-based.
		expect(isSubjectBuilder({ id: 's1', age: 30 })).toBe(false)
		expect(accepted(isSubjectBuilder)).toEqual([])
	})

	it('the two brands are distinct — neither entity guard matches the other brand', () => {
		expect(isDefinitionBuilder({ [SUBJECT_BUILDER_BRAND]: true })).toBe(false)
		expect(isSubjectBuilder({ [DEFINITION_BUILDER_BRAND]: true })).toBe(false)
	})

	it('a forged record — a build function field plus a fake STRING-keyed brand — narrows as neither entity', () => {
		// The forge-negative: JSON data can carry a `build` field (a subject legally
		// may) and string keys resembling the brand's Symbol description, but never
		// the actual `unique symbol` key — so neither guard is fooled.
		const forged = {
			build: () => ({}),
			'reasons.definitionBuilder': true,
			'reasons.subjectBuilder': true,
		}
		expect(isDefinitionBuilder(forged)).toBe(false)
		expect(isSubjectBuilder(forged)).toBe(false)
	})
})

// ── Recursion-depth boundary, numeric extremes & adversarial keys ─────────────
// The deep hardening pass (AGENTS §14): a binary-search sweep locating the EXACT
// depth where the two lazyOf-recursive guards flip true → false (contained by the
// engine's stack budget — never a RangeError), a cycle buried deep in an otherwise
// valid tree, a symbolic cycle through the RIGHT operand, the numeric-field guards
// across signed-zero / safe-integer / subnormal extremes, and adversarial /
// unicode record keys against the exact-record guarantee. Nests are built
// ITERATIVELY so the test's OWN stack cannot overflow — only the guard recurses.

describe('recursion-depth boundary — isExpression / isSymbolicExpression', () => {
	const nestExpression = (depth: number) => {
		let deep = atom('a', 'equals', 1)
		for (let index = 0; index < depth; index += 1) deep = compound('not', [deep])
		return deep
	}
	const nestSymbolic = (depth: number) => {
		let deep = constant(1)
		for (let index = 0; index < depth; index += 1) deep = operation('abs', deep)
		return deep
	}

	it('accepts a modest nest, rejects a beyond-stack nest, and never throws', () => {
		expect(isExpression(nestExpression(100))).toBe(true)
		expect(isExpression(nestExpression(100000))).toBe(false)
		expect(isSymbolicExpression(nestSymbolic(100))).toBe(true)
		expect(isSymbolicExpression(nestSymbolic(100000))).toBe(false)
		// Containment, not a thrown RangeError (lazyOf catches the overflow).
		expect(captureError(() => isExpression(nestExpression(100000)))).toBeUndefined()
		expect(captureError(() => isSymbolicExpression(nestSymbolic(100000)))).toBeUndefined()
	})

	it('binary-searches the exact depth where isExpression flips true → false', () => {
		let low = 100 // known-true floor
		let high = 100000 // known-false ceiling
		expect(isExpression(nestExpression(low))).toBe(true)
		expect(isExpression(nestExpression(high))).toBe(false)
		while (high - low > 1) {
			const mid = Math.floor((low + high) / 2)
			if (isExpression(nestExpression(mid))) low = mid
			else high = mid
		}
		// A single adjacent boundary inside the probed window: `low` is the deepest
		// accepted, `high === low + 1` the shallowest rejected.
		expect(high).toBe(low + 1)
		expect(low).toBeGreaterThanOrEqual(100)
		expect(high).toBeLessThanOrEqual(100000)
		// Re-confirm the WINDOW after the sweep, never depths near the flip: the
		// boundary is the engine's stack budget, and JIT re-tiering during the
		// sweep resizes frames — a depth that rejected mid-search can validate
		// afterward, so only the probed window's edges are contract. The
		// known-true floor still validates and the known-false ceiling still
		// rejects post-warm-up.
		expect(isExpression(nestExpression(100))).toBe(true)
		expect(isExpression(nestExpression(100000))).toBe(false)
	})

	it('binary-searches the exact depth where isSymbolicExpression flips true → false', () => {
		let low = 100
		let high = 100000
		expect(isSymbolicExpression(nestSymbolic(low))).toBe(true)
		expect(isSymbolicExpression(nestSymbolic(high))).toBe(false)
		while (high - low > 1) {
			const mid = Math.floor((low + high) / 2)
			if (isSymbolicExpression(nestSymbolic(mid))) low = mid
			else high = mid
		}
		expect(high).toBe(low + 1)
		expect(low).toBeGreaterThanOrEqual(100)
		expect(high).toBeLessThanOrEqual(100000)
		// Same post-sweep re-confirmation as the expression sweep: window edges
		// only — near-flip margins drift with JIT re-tiering and are unsound to pin.
		expect(isSymbolicExpression(nestSymbolic(100))).toBe(true)
		expect(isSymbolicExpression(nestSymbolic(100000))).toBe(false)
	})

	it('never throws a RangeError at any probed depth (both guards)', () => {
		for (const depth of [1, 50, 100, 500, 1000, 2000, 5000, 20000, 100000]) {
			expect(captureError(() => isExpression(nestExpression(depth)))).toBeUndefined()
			expect(captureError(() => isSymbolicExpression(nestSymbolic(depth)))).toBeUndefined()
		}
	})

	it('rejects a cycle buried DEEP inside an otherwise-valid expression tree', () => {
		const cyclic: Record<string, unknown> = { form: 'compound', operator: 'and' }
		cyclic.operands = [cyclic]
		// Wrap the cyclic node under 50 valid compound layers — the cycle is not at root.
		let deep: unknown = cyclic
		for (let index = 0; index < 50; index += 1) {
			deep = { form: 'compound', operator: 'and', operands: [deep] }
		}
		expect(isExpression(deep)).toBe(false)
		expect(captureError(() => isExpression(deep))).toBeUndefined()
	})

	it('rejects a symbolic operation cyclic through RIGHT (existing coverage is LEFT only)', () => {
		const cyclic: Record<string, unknown> = {
			form: 'operation',
			operator: 'add',
			left: constant(1),
		}
		cyclic.right = cyclic
		expect(isSymbolicExpression(cyclic)).toBe(false)
		expect(captureError(() => isSymbolicExpression(cyclic))).toBeUndefined()
	})
})

describe('numeric-field guards — signed zero, safe-integer & subnormal extremes', () => {
	it('accept -0, MAX/MIN_SAFE_INTEGER, and the smallest subnormal (all finite)', () => {
		for (const value of [-0, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.MIN_VALUE]) {
			expect(isBounds({ minimum: value, maximum: value })).toBe(true)
			expect(isTransform({ operation: 'multiply', operand: value })).toBe(true)
			expect(isFactorRange({ value })).toBe(true)
			expect(isNumberRecord({ k: value })).toBe(true)
			expect(isSource({ origin: 'static', value })).toBe(true)
			expect(isFactor({ ...staticFactor('f', 1), weight: value })).toBe(true)
		}
	})

	it('still reject NaN and ±Infinity on every numeric field', () => {
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			expect(isBounds({ minimum: value })).toBe(false)
			expect(isTransform({ operation: 'multiply', operand: value })).toBe(false)
			expect(isFactorRange({ value })).toBe(false)
			expect(isNumberRecord({ k: value })).toBe(false)
			expect(isSource({ origin: 'static', value })).toBe(false)
			expect(isFactor({ ...staticFactor('f', 1), weight: value })).toBe(false)
		}
	})
})

describe('adversarial record keys — prototype names, unicode & exactness', () => {
	it('isSubject / isNumberRecord accept a record of adversarial & unicode OWN keys', () => {
		const record: Record<string, unknown> = {}
		for (const key of TRICKY_KEYS) record[key] = 1
		expect(isSubject(record)).toBe(true)
		expect(isNumberRecord(record)).toBe(true)
	})

	it('an OWN __proto__ key (Object.create(null)) is a stray on an exact-record guard', () => {
		// A null-prototype object has no __proto__ setter, so the assignment creates a
		// plain OWN data key — exact-record semantics see it and reject it as extra.
		const hostile: Record<string, unknown> = Object.create(null)
		hostile['operation'] = 'multiply'
		hostile['__proto__'] = 5
		expect(Object.hasOwn(hostile, '__proto__')).toBe(true)
		expect(isTransform(hostile)).toBe(false)
	})

	it('a surrogate-pair / combining unicode extra key breaks exactness', () => {
		expect(isTransform({ operation: 'multiply', ['\u{1F600}']: 1 })).toBe(false)
		expect(isBounds({ minimum: 0, é: 1 })).toBe(false)
	})

	it('a SYMBOL extra key is invisible to exactness, but a STRING tricky extra is not', () => {
		const extra = Symbol('x')
		expect(isBounds({ minimum: 0, [extra]: 1 })).toBe(true)
		expect(isBounds({ minimum: 0, ['a.b']: 1 })).toBe(false)
	})
})

describe('isFieldPath — long arrays & adversarial segments', () => {
	it('accepts a very long all-string array', () => {
		const long = sequence(2000).map((index) => `k${index}`)
		expect(isFieldPath(long)).toBe(true)
	})

	it('rejects an array carrying a non-string element (number or null)', () => {
		expect(isFieldPath([...sequence(500).map(String), 7])).toBe(false)
		expect(isFieldPath([...sequence(100).map(String), null])).toBe(false)
	})

	it('accepts adversarial / unicode strings as path segments', () => {
		expect(isFieldPath([...TRICKY_KEYS])).toBe(true)
	})
})
