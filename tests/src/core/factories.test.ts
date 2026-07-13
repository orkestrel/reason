import {
	check,
	createAggregator,
	createEvaluator,
	createInferentialReasoner,
	createLogicalReasoner,
	createQuantitativeReasoner,
	createReason,
	createSymbolicReasoner,
	createTransformer,
	factorGroup,
	fieldFactor,
	quantitativeDefinition,
	transform,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { buildStaticDefinition, expectQuantitative } from '../../../setup.js'

// The reasons factories — each `create*` returns a WORKING instance behind its
// interface type, with the default id when no options are given and a custom id
// through the options object (DESIGN §2: one options bag replaces scsr's
// positional arguments). Deep per-class behavior lives in the operator /
// reasoner / orchestrator test files; here each factory is proven usable end to
// end. Operator INJECTION through `createQuantitativeReasoner` is exercised in
// integration.test.ts (scenario 5).

describe('createEvaluator', () => {
	it('returns a working evaluator with the default id', () => {
		const evaluator = createEvaluator()
		expect(evaluator.id).toBe('evaluator')
		expect(evaluator.evaluate(check('age', 'above', 18), { age: 25 }).met).toBe(true)
	})

	it('honors a custom id', () => {
		expect(createEvaluator({ id: 'custom-eval' }).id).toBe('custom-eval')
	})
})

describe('createTransformer', () => {
	it('returns a working transformer with the default id', () => {
		const transformer = createTransformer()
		expect(transformer.id).toBe('transformer')
		expect(transformer.chain(100, [transform('add', 50), transform('multiply', 2)])).toBe(300)
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

		const definition = quantitativeDefinition('inj', 'Inj', [
			factorGroup('g', 'sum', [
				fieldFactor('s', 'score', {
					checks: [check('score', 'above', 0)],
					transforms: [transform('multiply', 2)],
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
