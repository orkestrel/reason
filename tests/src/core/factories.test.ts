import {
	createAggregator,
	createAtom,
	createBounds,
	createCheck,
	createCompound,
	createConstant,
	createEquation,
	createEvaluator,
	createFact,
	createFactorGroup,
	createFieldFactor,
	createFieldSource,
	createInference,
	createInferentialDefinition,
	createInferentialReasoner,
	createLogicalDefinition,
	createLogicalReasoner,
	createLookupFactor,
	createLookupSource,
	createOperation,
	createQuantitativeDefinition,
	createQuantitativeReasoner,
	createRangeFactor,
	createRangeSource,
	createReason,
	createRule,
	createStaticFactor,
	createStaticSource,
	createSymbolicDefinition,
	createSymbolicReasoner,
	createTransform,
	createTransformer,
	createVariable,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { buildStaticDefinition, expectQuantitative } from '../../setup.js'

// The reasons factories, in two families. The VALUE factories: each
// returns a fresh JSON-serializable value with absent optional keys OMITTED
// entirely (so outputs round-trip the exact-record validators — pinned through
// `Object.keys`, the guard round-trip itself lives in integration.test.ts),
// `name` defaulting to the `id`, and an override bag merged LAST (an override
// wins over a default). The ENTITY factories: each `create*` returns a
// WORKING instance behind its interface type, with the default id when no
// options are given and a custom id through the options object. Deep per-class behavior
// lives in the operator / reasoner / orchestrator test files; here each factory
// is proven usable end to end. Operator INJECTION through
// `createQuantitativeReasoner` is exercised in integration.test.ts (scenario 5).

describe('createCheck / createAtom / createCompound — expression factories', () => {
	it('createCheck builds the field / operator / value triple', () => {
		expect(createCheck('age', 'from', 18)).toEqual({ field: 'age', operator: 'from', value: 18 })
	})

	it('createCheck carries an array field path and any value (including null)', () => {
		expect(createCheck(['address', 'city'], 'equals', null)).toEqual({
			field: ['address', 'city'],
			operator: 'equals',
			value: null,
		})
	})

	it('createAtom wraps one check as a leaf expression', () => {
		expect(createAtom('age', 'from', 18)).toEqual({
			form: 'atom',
			check: { field: 'age', operator: 'from', value: 18 },
		})
	})

	it('createCompound nests operands under a connective', () => {
		expect(
			createCompound('and', [createAtom('a', 'equals', true), createAtom('b', 'equals', true)]),
		).toEqual({
			form: 'compound',
			operator: 'and',
			operands: [createAtom('a', 'equals', true), createAtom('b', 'equals', true)],
		})
	})
})

describe('createRule — the rule factory', () => {
	it('defaults name to the id and omits absent optional keys', () => {
		const built = createRule(
			'adult',
			[createAtom('age', 'from', 18)],
			createAtom('adult', 'equals', true),
		)
		expect(built.name).toBe('adult')
		expect(Object.keys(built).sort()).toEqual(['conclusion', 'id', 'name', 'premises'])
	})

	it('merges overrides last — an override wins over a default', () => {
		const built = createRule('adult', [], createAtom('x', 'equals', 1), {
			name: 'Adult rule',
			priority: 5,
			enabled: false,
		})
		expect(built.name).toBe('Adult rule')
		expect(built.priority).toBe(5)
		expect(built.enabled).toBe(false)
	})
})

describe('createTransform / createBounds — factories', () => {
	it('createTransform omits the operand key entirely when absent', () => {
		expect(createTransform('multiply', 2)).toEqual({ operation: 'multiply', operand: 2 })
		expect(createTransform('round')).toEqual({ operation: 'round' })
		expect(Object.keys(createTransform('round'))).toEqual(['operation'])
	})

	it('createBounds omits absent sides entirely', () => {
		expect(createBounds(0, 100)).toEqual({ minimum: 0, maximum: 100 })
		expect(createBounds(undefined, 100)).toEqual({ maximum: 100 })
		expect(createBounds(5)).toEqual({ minimum: 5 })
		expect(createBounds()).toEqual({})
		expect(Object.keys(createBounds(undefined, 100))).toEqual(['maximum'])
	})
})

describe('createVariable / createConstant / createOperation / createEquation — symbolic factories', () => {
	it('createVariable and createConstant build leaves', () => {
		expect(createVariable('x')).toEqual({ form: 'variable', name: 'x' })
		expect(createConstant(42)).toEqual({ form: 'constant', value: 42 })
	})

	it('createOperation omits the right key when absent (unary form)', () => {
		expect(createOperation('add', createVariable('x'), createConstant(1))).toEqual({
			form: 'operation',
			operator: 'add',
			left: createVariable('x'),
			right: createConstant(1),
		})
		const unary = createOperation('abs', createVariable('x'))
		expect(unary).toEqual({ form: 'operation', operator: 'abs', left: createVariable('x') })
		expect(Object.keys(unary).sort()).toEqual(['form', 'left', 'operator'])
	})

	it('createEquation defaults name to the id and merges overrides', () => {
		const built = createEquation('e1', createVariable('x'), createConstant(42), 'x')
		expect(built).toEqual({
			id: 'e1',
			name: 'e1',
			left: createVariable('x'),
			right: createConstant(42),
			target: 'x',
		})
		expect(
			createEquation('e1', createVariable('x'), createConstant(42), 'x', { name: 'Solve x' }).name,
		).toBe('Solve x')
	})
})

describe('createFact / createInference — factories', () => {
	it('createFact ALWAYS sets confidence (defaulting to 1)', () => {
		expect(createFact('f1', 'human', ['socrates'])).toEqual({
			id: 'f1',
			predicate: 'human',
			terms: ['socrates'],
			confidence: 1,
		})
		expect(createFact('f2', 'laysEggs', ['tweety'], 0.9).confidence).toBe(0.9)
	})

	it('createInference defaults name to the id and merges overrides', () => {
		const built = createInference(
			'mortal',
			[createFact('p1', 'human', ['?x'])],
			createFact('c1', 'mortal', ['?x']),
		)
		expect(built.name).toBe('mortal')
		expect(Object.keys(built).sort()).toEqual(['conclusion', 'id', 'name', 'premises'])
		const overridden = createInference('mortal', [], createFact('c1', 'mortal', ['?x']), {
			confidence: 0.8,
			enabled: false,
		})
		expect(overridden.confidence).toBe(0.8)
		expect(overridden.enabled).toBe(false)
	})
})

describe('source factories — the four origins', () => {
	it('createStaticSource / createFieldSource / createLookupSource / createRangeSource carry their origin', () => {
		expect(createStaticSource(42)).toEqual({ origin: 'static', value: 42 })
		expect(createFieldSource(['profile', 'score'])).toEqual({
			origin: 'field',
			field: ['profile', 'score'],
		})
		expect(createLookupSource('state', { CA: 5 })).toEqual({
			origin: 'lookup',
			field: 'state',
			table: { CA: 5 },
		})
		expect(createRangeSource('age', [{ bounds: { maximum: 25 }, value: 10 }])).toEqual({
			origin: 'range',
			field: 'age',
			ranges: [{ bounds: { maximum: 25 }, value: 10 }],
		})
	})
})

describe('factor factories — one per source origin', () => {
	it('createStaticFactor defaults name to the id, wraps a static source, omits absent keys', () => {
		const built = createStaticFactor('f1', 10)
		expect(built).toEqual({ id: 'f1', name: 'f1', source: { origin: 'static', value: 10 } })
		expect(Object.keys(built).sort()).toEqual(['id', 'name', 'source'])
	})

	it('createStaticFactor merges overrides last (name / weight / priority / required)', () => {
		const built = createStaticFactor('f1', 10, {
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

	it('createFieldFactor wraps a field source and threads overrides', () => {
		const built = createFieldFactor('income', 'income', {
			fallback: 0,
			transforms: [createTransform('round')],
		})
		expect(built.source).toEqual({ origin: 'field', field: 'income' })
		expect(built.fallback).toBe(0)
		expect(built.transforms).toEqual([{ operation: 'round' }])
	})

	it('createLookupFactor wraps a lookup source', () => {
		const built = createLookupFactor('state', 'state', { CA: 5 }, { fallback: 1 })
		expect(built.source).toEqual({ origin: 'lookup', field: 'state', table: { CA: 5 } })
		expect(built.fallback).toBe(1)
	})

	it('createRangeFactor wraps a range source', () => {
		const built = createRangeFactor('band', 'age', [{ value: 42 }])
		expect(built.source).toEqual({ origin: 'range', field: 'age', ranges: [{ value: 42 }] })
	})
})

describe('createFactorGroup — the factor-group factory', () => {
	it('defaults name to the id and omits absent optional keys', () => {
		const built = createFactorGroup('g1', 'sum', [createStaticFactor('f1', 10)])
		expect(built.name).toBe('g1')
		expect(built.aggregation).toBe('sum')
		expect(Object.keys(built).sort()).toEqual(['aggregation', 'factors', 'id', 'name'])
	})

	it('merges overrides last (base / bounds / strict / enabled)', () => {
		const built = createFactorGroup('g1', 'product', [], {
			base: 100,
			bounds: createBounds(0, 50),
			strict: true,
			enabled: false,
		})
		expect(built.base).toBe(100)
		expect(built.bounds).toEqual({ minimum: 0, maximum: 50 })
		expect(built.strict).toBe(true)
		expect(built.enabled).toBe(false)
	})
})

describe('definition factories — defaults & overrides', () => {
	it('createQuantitativeDefinition fixes the reasoning and defaults aggregation to "sum"', () => {
		const built = createQuantitativeDefinition('risk', 'Risk', [])
		expect(built.reasoning).toBe('quantitative')
		expect(built.aggregation).toBe('sum')
		expect(Object.keys(built).sort()).toEqual(['aggregation', 'groups', 'id', 'name', 'reasoning'])
		expect(
			createQuantitativeDefinition('risk', 'Risk', [], { aggregation: 'product' }).aggregation,
		).toBe('product')
		expect(createQuantitativeDefinition('risk', 'Risk', [], { base: 10, precision: 2 }).base).toBe(
			10,
		)
	})

	it('createLogicalDefinition defaults strategy to "forward"', () => {
		const built = createLogicalDefinition('elig', 'Eligibility', [])
		expect(built.reasoning).toBe('logical')
		expect(built.strategy).toBe('forward')
		expect(
			createLogicalDefinition('elig', 'Eligibility', [], { strategy: 'backward' }).strategy,
		).toBe('backward')
		expect(createLogicalDefinition('elig', 'Eligibility', [], { depth: 5 }).depth).toBe(5)
	})

	it('createSymbolicDefinition defaults variables to {}', () => {
		const built = createSymbolicDefinition('rate', 'Rate', [])
		expect(built.reasoning).toBe('symbolic')
		expect(built.variables).toEqual({})
		expect(
			createSymbolicDefinition('rate', 'Rate', [], { variables: { pi: 3.14 }, precision: 2 })
				.variables,
		).toEqual({ pi: 3.14 })
	})

	it('createInferentialDefinition defaults strategy to "forward"', () => {
		const built = createInferentialDefinition('birds', 'Birds', [], [])
		expect(built.reasoning).toBe('inferential')
		expect(built.strategy).toBe('forward')
		expect(built.facts).toEqual([])
		expect(built.inferences).toEqual([])
		expect(
			createInferentialDefinition('birds', 'Birds', [], [], { strategy: 'backward', depth: 3 })
				.depth,
		).toBe(3)
	})
})

describe('createEvaluator', () => {
	it('returns a working evaluator with the default id', () => {
		const evaluator = createEvaluator()
		expect(evaluator.id).toBe('evaluator')
		expect(evaluator.evaluate(createCheck('age', 'above', 18), { age: 25 }).met).toBe(true)
	})

	it('honors a custom id', () => {
		expect(createEvaluator({ id: 'custom-eval' }).id).toBe('custom-eval')
	})
})

describe('createTransformer', () => {
	it('returns a working transformer with the default id', () => {
		const transformer = createTransformer()
		expect(transformer.id).toBe('transformer')
		expect(
			transformer.chain(100, [createTransform('add', 50), createTransform('multiply', 2)]),
		).toBe(300)
	})

	it('honors a custom id', () => {
		expect(createTransformer({ id: 'custom-transform' }).id).toBe('custom-transform')
	})
})

describe('createAggregator', () => {
	it('returns a working aggregator with the default id', () => {
		const aggregator = createAggregator()
		expect(aggregator.id).toBe('aggregator')
		expect(aggregator.aggregate([10, 20], 'average', [1, 3])).toBe(17.5)
	})

	it('honors a custom id', () => {
		expect(createAggregator({ id: 'custom-agg' }).id).toBe('custom-agg')
	})
})

describe('create*Reasoner — the four strategies', () => {
	it('createQuantitativeReasoner reports its reasoning and default id', () => {
		const reasoner = createQuantitativeReasoner()
		expect(reasoner.reasoning).toBe('quantitative')
		expect(reasoner.id).toBe('quantitative')
		expect(createQuantitativeReasoner({ id: 'custom' }).id).toBe('custom')
	})

	it('createLogicalReasoner reports its reasoning and default id', () => {
		const reasoner = createLogicalReasoner()
		expect(reasoner.reasoning).toBe('logical')
		expect(reasoner.id).toBe('logical')
		expect(createLogicalReasoner({ id: 'custom' }).id).toBe('custom')
	})

	it('createSymbolicReasoner reports its reasoning and default id', () => {
		const reasoner = createSymbolicReasoner()
		expect(reasoner.reasoning).toBe('symbolic')
		expect(reasoner.id).toBe('symbolic')
		expect(createSymbolicReasoner({ id: 'custom' }).id).toBe('custom')
	})

	it('createInferentialReasoner reports its reasoning and default id', () => {
		const reasoner = createInferentialReasoner()
		expect(reasoner.reasoning).toBe('inferential')
		expect(reasoner.id).toBe('inferential')
		expect(createInferentialReasoner({ id: 'custom' }).id).toBe('custom')
	})
})

describe('createReason', () => {
	it('returns an empty orchestrator by default', () => {
		const reason = createReason()
		expect(reason.reasoners()).toEqual([])
	})

	it('seeds the registry from options and dispatches end to end', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		expect(reason.supports('quantitative')).toBe(true)
		const result = expectQuantitative(reason.reason({}, buildStaticDefinition()))
		expect(result.value).toBe(42)
		expect(result.success).toBe(true)
		reason.destroy()
	})
})

describe('reasons factories — id semantics & instance independence', () => {
	it('preserves an explicit empty-string id (`??` treats only null / undefined as absent)', () => {
		expect(createEvaluator({ id: '' }).id).toBe('')
		expect(createTransformer({ id: '' }).id).toBe('')
		expect(createAggregator({ id: '' }).id).toBe('')
		expect(createQuantitativeReasoner({ id: '' }).id).toBe('')
		expect(createLogicalReasoner({ id: '' }).id).toBe('')
		expect(createSymbolicReasoner({ id: '' }).id).toBe('')
		expect(createInferentialReasoner({ id: '' }).id).toBe('')
	})

	it('two reasoners sharing one custom id are independent, working instances', () => {
		const first = createQuantitativeReasoner({ id: 'dup' })
		const second = createQuantitativeReasoner({ id: 'dup' })
		expect(first).not.toBe(second)
		expect(first.id).toBe('dup')
		expect(second.id).toBe('dup')
		expect(expectQuantitative(first.reason({}, buildStaticDefinition('a', 7))).value).toBe(7)
		expect(expectQuantitative(second.reason({}, buildStaticDefinition('b', 9))).value).toBe(9)
	})

	it('omitting options builds fresh, independent reasoners (no shared default is mutated)', () => {
		const first = createQuantitativeReasoner()
		const second = createQuantitativeReasoner()
		expect(first).not.toBe(second)
		expect(expectQuantitative(first.reason({}, buildStaticDefinition('x', 3))).value).toBe(3)
		expect(expectQuantitative(second.reason({}, buildStaticDefinition('y', 5))).value).toBe(5)
		// The first still runs correctly AFTER the second ran — no shared mutable state.
		expect(expectQuantitative(first.reason({}, buildStaticDefinition('x2', 11))).value).toBe(11)
	})

	it('injected operators keep their custom ids and drive the run end to end', () => {
		const evaluator = createEvaluator({ id: 'e' })
		const transformer = createTransformer({ id: 't' })
		const aggregator = createAggregator({ id: 'a' })
		const reasoner = createQuantitativeReasoner({ id: 'q', evaluator, transformer, aggregator })
		expect(reasoner.id).toBe('q')

		const definition = createQuantitativeDefinition('inj', 'Inj', [
			createFactorGroup('g', 'sum', [
				createFieldFactor('s', 'score', {
					checks: [createCheck('score', 'above', 0)],
					transforms: [createTransform('multiply', 2)],
				}),
			]),
		])
		// score 21 passes the check, doubles to 42 — all three injected operators fire.
		expect(expectQuantitative(reasoner.reason({ score: 21 }, definition)).value).toBe(42)
		expect(evaluator.id).toBe('e')
		expect(transformer.id).toBe('t')
		expect(aggregator.id).toBe('a')
	})
})
