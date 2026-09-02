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
	isBounds,
	isCheck,
	isDefinition,
	isExpression,
	isFact,
	isReasonError,
	isSource,
	isSymbolicExpression,
	isTransform,
	ReasonError,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError } from '@orkestrel/test'
import {
	buildSubjects,
	createThrowingReasoner,
	deepFreeze,
	expectInferential,
	expectLogical,
	expectQuantitative,
	expectSymbolic,
	sequence,
} from '../../setup.js'

// Cross-module composition of the reasons layer (AGENTS §16 cross-cutting
// "integration" test, exempt from the 1:1 source mirror): the
// PUBLIC builder vocabulary assembling real definitions, one orchestrator
// routing a quantitative → logical → symbolic underwriting pipeline (each
// stage's output feeding the next stage's subject), ordered batch dispatch,
// inferential forward + backward derivation with proof trees, the builder ↔
// guard round trip (every builder output satisfies its guard — the exact-record
// contract), factory-created operator INJECTION into a reasoner, and the
// orchestrator error surface (bail conversion, `isReasonError`, DESTROYED).

// The underwriting fixtures, built exclusively with the public builders.
const RISK_DEFINITION = createQuantitativeDefinition(
	'risk-score',
	'Risk Score',
	[
		createFactorGroup('age', 'sum', [
			createRangeFactor('age-band', 'age', [
				{ bounds: createBounds(undefined, 24), value: 30 },
				{ bounds: createBounds(25, 64), value: 15 },
				{ bounds: createBounds(65), value: 10 },
			]),
		]),
		createFactorGroup('financial', 'sum', [
			createFieldFactor('income-score', 'income', {
				transforms: [createTransform('divide', 1000)],
				bounds: createBounds(0, 40),
				fallback: 0,
			}),
			createLookupFactor('state-score', 'state', { CA: 5, NY: 8, TX: 2 }, { fallback: 1 }),
		]),
	],
	{ base: 10, bounds: createBounds(0, 100), precision: 2 },
)

const ELIGIBILITY_DEFINITION = createLogicalDefinition(
	'eligibility',
	'Eligibility',
	[
		createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
		createRule('risk', [createAtom('riskScore', 'from', 40)], createAtom('riskOk', 'equals', true)),
		createRule(
			'eligible',
			[createAtom('adult', 'equals', true), createAtom('riskOk', 'equals', true)],
			createAtom('eligible', 'equals', true),
		),
	],
	{ depth: 5 },
)

const RATE_DEFINITION = createSymbolicDefinition(
	'rate',
	'Rate',
	[
		createEquation(
			'base-rate',
			createVariable('baseRate'),
			createOperation(
				'subtract',
				createConstant(15),
				createOperation('divide', createVariable('riskScore'), createConstant(10)),
			),
			'baseRate',
		),
		createEquation(
			'final-rate',
			createVariable('finalRate'),
			createOperation('maximum', createVariable('baseRate'), createConstant(3)),
			'finalRate',
		),
	],
	{ precision: 2 },
)

describe('reasons — quantitative → logical → symbolic pipeline', () => {
	it('threads one applicant through risk scoring, eligibility, and rate solving', () => {
		const reason = createReason({
			reasoners: [createQuantitativeReasoner(), createLogicalReasoner(), createSymbolicReasoner()],
		})
		const subject = { id: 'applicant-1', age: 32, income: 68000, state: 'CA' }

		// Stage 1 — risk: age band 15 + income 68 clamped to 40 + state 5 + base 10.
		const risk = expectQuantitative(reason.reason(subject, RISK_DEFINITION))
		expect(risk.success).toBe(true)
		expect(risk.value).toBe(70)

		// Stage 2 — the risk value feeds the next stage's subject.
		const eligibility = expectLogical(
			reason.reason({ ...subject, riskScore: risk.value }, ELIGIBILITY_DEFINITION),
		)
		expect(eligibility.success).toBe(true)
		expect(eligibility.conclusion).toBe(true)

		// Stage 3 — the rate solves from the same risk value (15 − 70/10 = 8 ≥ the 3 floor).
		const rate = expectSymbolic(reason.reason({ riskScore: risk.value }, RATE_DEFINITION))
		expect(rate.success).toBe(true)
		expect(rate.solutions.finalRate).toBe(8)
		expect(rate.solutions.finalRate).toBeGreaterThanOrEqual(3)

		reason.destroy()
	})

	it('batches three applicants in order through the orchestrator', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const results = reason.reason(
			[
				{ age: 20, income: 20000, state: 'CA' },
				{ age: 40, income: 90000, state: 'TX' },
				{ age: 70, income: 40000, state: 'NY' },
			],
			RISK_DEFINITION,
		)
		expect(results).toHaveLength(3)
		expect(results.map((result) => expectQuantitative(result).value)).toEqual([65, 67, 68])
		for (const result of results) expect(expectQuantitative(result).value).toBeGreaterThan(0)
		reason.destroy()
	})
})

describe('reasons — inferential forward + backward through the orchestrator', () => {
	const baseFacts = [
		createFact('f1', 'hasFeathers', ['tweety'], 1),
		createFact('f2', 'laysEggs', ['tweety'], 0.9),
	]
	const birdRule = createInference(
		'bird-rule',
		[createFact('p1', 'hasFeathers', ['?x']), createFact('p2', 'laysEggs', ['?x'])],
		createFact('c1', 'isBird', ['?x']),
		{ confidence: 0.8 },
	)

	it('derives transitively forward (isBird, then canFly)', () => {
		const reason = createReason({ reasoners: [createInferentialReasoner()] })
		const definition = createInferentialDefinition(
			'birds',
			'Birds',
			baseFacts,
			[
				birdRule,
				createInference(
					'fly-rule',
					[createFact('p3', 'isBird', ['?x'])],
					createFact('c2', 'canFly', ['?x']),
					{
						confidence: 0.5,
					},
				),
			],
			{ depth: 5 },
		)
		const result = expectInferential(reason.reason({}, definition))
		expect(result.success).toBe(true)
		const predicates = result.derived.map((derived) => derived.predicate)
		expect(predicates).toContain('isBird')
		expect(predicates).toContain('canFly')
		reason.destroy()
	})

	it('proves backward with a proof tree naming the inference and conclusion fact', () => {
		const reason = createReason({ reasoners: [createInferentialReasoner()] })
		const definition = createInferentialDefinition('birds', 'Birds', baseFacts, [birdRule], {
			strategy: 'backward',
			depth: 5,
		})
		const result = expectInferential(reason.reason({}, definition))
		expect(result.proof?.inference).toBe('bird-rule')
		expect(result.proof?.fact).toBe('c1')
		reason.destroy()
	})
})

describe('reasons — builders round-trip their guards', () => {
	it('every builder output satisfies its guard (the exact-record contract)', () => {
		expect(isCheck(createCheck('age', 'from', 18))).toBe(true)
		expect(isTransform(createTransform('multiply', 2))).toBe(true)
		expect(isBounds(createBounds(0, 100))).toBe(true)
		expect(isSource(createStaticSource(42))).toBe(true)
		expect(isSource(createFieldSource(['profile', 'score']))).toBe(true)
		expect(isSource(createLookupSource('state', { CA: 5 }))).toBe(true)
		expect(
			isSource(createRangeSource('age', [{ bounds: createBounds(undefined, 25), value: 10 }])),
		).toBe(true)
		expect(isExpression(createCompound('and', [createAtom('age', 'from', 18)]))).toBe(true)
		expect(
			isSymbolicExpression(createOperation('add', createVariable('x'), createConstant(1))),
		).toBe(true)
		expect(isFact(createFact('f1', 'has', ['state', 'CA']))).toBe(true)
	})

	it('every full definition fixture satisfies isDefinition', () => {
		expect(isDefinition(RISK_DEFINITION)).toBe(true)
		expect(isDefinition(ELIGIBILITY_DEFINITION)).toBe(true)
		expect(isDefinition(RATE_DEFINITION)).toBe(true)
		expect(
			isDefinition(
				createLogicalDefinition(
					'backward',
					'Backward',
					[createRule('r', [createAtom('a', 'equals', 1)], createAtom('b', 'equals', 1))],
					{ strategy: 'backward' },
				),
			),
		).toBe(true)
		expect(
			isDefinition(
				createInferentialDefinition(
					'birds',
					'Birds',
					[createFact('f1', 'hasFeathers', ['tweety'])],
					[
						createInference(
							'i1',
							[createFact('p1', 'hasFeathers', ['?x'])],
							createFact('c1', 'isBird', ['?x']),
						),
					],
				),
			),
		).toBe(true)
	})
})

describe('reasons — factory-created operator injection', () => {
	it('injected operators drive the pipeline and keep their ids', () => {
		const evaluator = createEvaluator({ id: 'test-evaluator' })
		const transformer = createTransformer({ id: 'test-transformer' })
		const aggregator = createAggregator({ id: 'test-aggregator' })
		const reasoner = createQuantitativeReasoner({ evaluator, transformer, aggregator })

		const definition = createQuantitativeDefinition('injected', 'Injected', [
			createFactorGroup('g1', 'sum', [
				createFieldFactor('score', 'score', {
					checks: [createCheck('score', 'above', 0)],
					transforms: [createTransform('multiply', 3)],
				}),
			]),
		])
		const result = expectQuantitative(reasoner.reason({ score: 10 }, definition))
		expect(result.success).toBe(true)
		expect(result.value).toBe(30)

		expect(evaluator.id).toBe('test-evaluator')
		expect(transformer.id).toBe('test-transformer')
		expect(aggregator.id).toBe('test-aggregator')
	})
})

describe('reasons — error surface', () => {
	it('bail false converts a reasoner throw into an error result', () => {
		const reason = createReason({ reasoners: [createThrowingReasoner('boom')], bail: false })
		const result = expectQuantitative(
			reason.reason({}, createQuantitativeDefinition('any', 'Any', [])),
		)
		expect(result.success).toBe(false)
		expect(result.errors).toContain('boom')
		reason.destroy()
	})

	it('isReasonError brands ReasonErrors and rejects plain Errors', () => {
		expect(isReasonError(new ReasonError('DESTROYED', 'destroyed'))).toBe(true)
		expect(isReasonError(new Error('destroyed'))).toBe(false)
	})

	it('a destroyed orchestrator surfaces the DESTROYED code through isReasonError', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		reason.destroy()
		const error = captureError(() =>
			reason.reason({}, createQuantitativeDefinition('late', 'Late', [])),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('DESTROYED')
	})
})

// A genuinely hard end-to-end scenario: a multi-group weighted quantitative
// score → a 11-rule interdependent forward chain → a symbolic equation chain
// seeded by both prior stages → an inferential derivation over the result. Every
// stage consumes the previous stage's output and every final number is computed
// by hand from the reasoner semantics (confirmed by running).

// Stage A — weighted quantitative: risk (weighted sum 46) + loyalty (weighted
// average 6.5) + bonus (5) + base 10 = 67.5.
const SCORE_DEFINITION = createQuantitativeDefinition(
	'score',
	'Score',
	[
		createFactorGroup('risk', 'sum', [
			createRangeFactor(
				'age',
				'age',
				[
					{ bounds: createBounds(undefined, 25), value: 30 },
					{ bounds: createBounds(26, 50), value: 15 },
					{ bounds: createBounds(51), value: 25 },
				],
				{ weight: 2 },
			),
			createLookupFactor(
				'region',
				'region',
				{ west: 10, east: 5, north: 8 },
				{ fallback: 0, weight: 1 },
			),
			createFieldFactor('claims', 'claims', { weight: 3 }),
		]),
		createFactorGroup('loyalty', 'average', [
			createFieldFactor('tenure', 'tenure', { weight: 1 }),
			createFieldFactor('incomeScore', 'income', {
				transforms: [createTransform('divide', 10000)],
				bounds: createBounds(0, 10),
				weight: 3,
			}),
		]),
		createFactorGroup('bonus', 'sum', [createStaticFactor('flat', 5)]),
	],
	{ base: 10, precision: 2 },
)

// Stage B — 11 interdependent forward rules; derivations cascade preferred →
// premium → { discountEligible, vip } → tier, so 9 of 11 rules apply.
const TIER_DEFINITION = createLogicalDefinition('tier', 'Tier', [
	createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
	createRule('senior', [createAtom('age', 'from', 65)], createAtom('senior', 'equals', true)),
	createRule(
		'scoreHigh',
		[createAtom('score', 'above', 60)],
		createAtom('highScore', 'equals', true),
	),
	createRule(
		'scoreMid',
		[createAtom('score', 'between', [40, 60])],
		createAtom('midScore', 'equals', true),
	),
	createRule('lowClaims', [createAtom('claims', 'to', 3)], createAtom('lowClaims', 'equals', true)),
	createRule('loyal', [createAtom('tenure', 'from', 5)], createAtom('loyal', 'equals', true)),
	createRule(
		'preferred',
		[createAtom('highScore', 'equals', true), createAtom('lowClaims', 'equals', true)],
		createAtom('preferred', 'equals', true),
	),
	createRule(
		'premium',
		[createAtom('preferred', 'equals', true), createAtom('loyal', 'equals', true)],
		createAtom('premium', 'equals', true),
	),
	createRule(
		'discountEligible',
		[createAtom('premium', 'equals', true), createAtom('adult', 'equals', true)],
		createAtom('discountEligible', 'equals', true),
	),
	createRule(
		'vip',
		[
			createAtom('premium', 'equals', true),
			createAtom('highScore', 'equals', true),
			createAtom('loyal', 'equals', true),
		],
		createAtom('vip', 'equals', true),
	),
	createRule(
		'finalTier',
		[createAtom('vip', 'equals', true), createAtom('discountEligible', 'equals', true)],
		createAtom('tier', 'equals', 3),
	),
])

// Stage C — a three-equation chain: premium = score / 10 = 6.75; adjusted =
// premium + rules = 15.75; final = adjusted × 2 = 31.5.
const RATE_CHAIN = createSymbolicDefinition(
	'rateChain',
	'Rate Chain',
	[
		createEquation(
			'e1',
			createVariable('premium'),
			createOperation('divide', createVariable('score'), createConstant(10)),
			'premium',
		),
		createEquation(
			'e2',
			createVariable('adjusted'),
			createOperation('add', createVariable('premium'), createVariable('rules')),
			'adjusted',
		),
		createEquation(
			'e3',
			createVariable('final'),
			createOperation('multiply', createVariable('adjusted'), createConstant(2)),
			'final',
		),
	],
	{ precision: 2 },
)

// Stage D — derive classified(final) then reviewed(final) from the injected fact.
const CLASSIFY = createInferentialDefinition(
	'classify',
	'Classify',
	[],
	[
		createInference(
			'cls',
			[createFact('p', 'has', ['final', '?f'])],
			createFact('c', 'classified', ['?f']),
		),
		createInference(
			'rev',
			[createFact('p2', 'classified', ['?f'])],
			createFact('c2', 'reviewed', ['?f']),
		),
	],
)

describe('reasons — complex multi-step end-to-end problem', () => {
	it('threads a weighted score through a 11-rule chain, an equation chain, and a derivation', () => {
		const reason = createReason({
			reasoners: [
				createQuantitativeReasoner(),
				createLogicalReasoner(),
				createSymbolicReasoner(),
				createInferentialReasoner(),
			],
		})
		const applicant = { id: 'app', age: 40, region: 'west', claims: 2, tenure: 8, income: 60000 }

		// Stage A — quantitative score.
		const score = expectQuantitative(reason.reason(applicant, SCORE_DEFINITION))
		expect(score.success).toBe(true)
		expect(score.count).toBe(3)
		expect(score.value).toBe(67.5)

		// Stage B — the score + subject facts drive the interdependent rule chain.
		const tier = expectLogical(
			reason.reason(
				{
					score: score.value,
					age: applicant.age,
					claims: applicant.claims,
					tenure: applicant.tenure,
				},
				TIER_DEFINITION,
			),
		)
		expect(tier.success).toBe(true)
		expect(tier.conclusion).toBe(true)
		expect(tier.count).toBe(9)
		const applied = (id: string) => tier.rules.find((result) => result.id === id)?.applied
		expect(applied('senior')).toBe(false)
		expect(applied('scoreMid')).toBe(false)
		expect(applied('preferred')).toBe(true)
		expect(applied('vip')).toBe(true)
		expect(applied('finalTier')).toBe(true)

		// Stage C — the equation chain seeds from the score and the applied-rule count.
		const rate = expectSymbolic(
			reason.reason({ score: score.value, rules: tier.count }, RATE_CHAIN),
		)
		expect(rate.success).toBe(true)
		expect(rate.solutions.premium).toBe(6.75)
		expect(rate.solutions.adjusted).toBe(15.75)
		expect(rate.solutions.final).toBe(31.5)

		// Stage D — a two-hop derivation over the final rate.
		const proof = expectInferential(reason.reason({ final: rate.solutions.final }, CLASSIFY))
		expect(proof.success).toBe(true)
		expect(proof.derived.find((derived) => derived.predicate === 'classified')?.terms).toEqual([
			31.5,
		])
		expect(proof.derived.find((derived) => derived.predicate === 'reviewed')?.terms).toEqual([31.5])

		reason.destroy()
	})
})

describe('reasons — mixed pipeline failure-recovery', () => {
	it('a mid-stage failure does not stop the downstream stages (partial-output recovery)', () => {
		const reason = createReason({
			reasoners: [
				createQuantitativeReasoner(),
				createLogicalReasoner(),
				createSymbolicReasoner(),
				createInferentialReasoner(),
			],
		})

		// Stage 1 — quantitative deliberately produces a non-finite (NaN) value: a
		// gated-out factor leaves its only group unapplied, so a definition-level
		// `minimum` over zero applied groups is NaN (success false).
		const broken = createQuantitativeDefinition(
			'broken',
			'Broken',
			[
				createFactorGroup('g', 'sum', [
					createFieldFactor('f', 'missing', { checks: [createCheck('gate', 'equals', true)] }),
				]),
			],
			{ aggregation: 'minimum' },
		)
		const quantitative = expectQuantitative(reason.reason({ id: 'p' }, broken))
		expect(quantitative.success).toBe(false)
		expect(Number.isNaN(quantitative.value)).toBe(true)
		expect(quantitative.count).toBe(0)

		// Stage 2 — logical still runs on the failed NaN value without crashing.
		const gate = createLogicalDefinition('gate', 'Gate', [
			createRule('ok', [createAtom('risk', 'above', 0)], createAtom('ok', 'equals', true)),
		])
		const logical = expectLogical(reason.reason({ risk: quantitative.value }, gate))
		expect(logical.reasoning).toBe('logical')
		expect(logical.success).toBe(true)
		expect(logical.conclusion).toBe(false)

		// Stage 3 — symbolic copes with the NaN input (dropped by parseNumber) and
		// solves from its own seed: y = x × 2 = 10.
		const rate = createSymbolicDefinition(
			'rate',
			'Rate',
			[
				createEquation(
					'e',
					createVariable('y'),
					createOperation('multiply', createVariable('x'), createConstant(2)),
					'y',
				),
			],
			{ variables: { x: 5 }, precision: 2 },
		)
		const symbolic = expectSymbolic(reason.reason({ risk: quantitative.value }, rate))
		expect(symbolic.success).toBe(true)
		expect(symbolic.solutions.y).toBe(10)

		// Stage 4 — inferential derives from the recovered symbolic solution.
		const derive = createInferentialDefinition(
			'derive',
			'Derive',
			[],
			[
				createInference(
					'd',
					[createFact('p', 'has', ['y', '?v'])],
					createFact('c', 'doubled', ['?v']),
				),
			],
		)
		const inferential = expectInferential(reason.reason({ y: symbolic.solutions.y }, derive))
		expect(inferential.success).toBe(true)
		expect(inferential.derived.find((derived) => derived.predicate === 'doubled')?.terms).toEqual([
			10,
		])

		reason.destroy()
	})
})

describe('reasons — deep transitive inferential proof', () => {
	it('proves a 5-hop backward chain with a fully nested proof tree', () => {
		const reason = createReason({ reasoners: [createInferentialReasoner()] })
		// f ⇐ e ⇐ d ⇐ c ⇐ b ⇐ a(socrates): the top goal (declared first) drives a
		// deep recursive proof; backward returns on the first provable conclusion.
		const definition = createInferentialDefinition(
			'chain',
			'Chain',
			[createFact('fa', 'a', ['socrates'])],
			[
				createInference('i_top', [createFact('pe', 'e', ['?x'])], createFact('cf', 'f', ['?x'])),
				createInference('i2', [createFact('pd', 'd', ['?x'])], createFact('ce', 'e', ['?x'])),
				createInference('i3', [createFact('pc', 'c', ['?x'])], createFact('cd', 'd', ['?x'])),
				createInference('i4', [createFact('pb', 'b', ['?x'])], createFact('cc', 'c', ['?x'])),
				createInference('i5', [createFact('pa', 'a', ['?x'])], createFact('cb', 'b', ['?x'])),
			],
			{ strategy: 'backward' },
		)
		const result = expectInferential(reason.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.predicate).toBe('f')

		// The proof nests one inference per hop, bottoming out at the base fact leaf.
		const root = result.proof
		expect(root?.inference).toBe('i_top')
		expect(root?.depth).toBe(0)
		const hop1 = root?.children?.[0]
		expect(hop1?.inference).toBe('i2')
		const hop2 = hop1?.children?.[0]
		expect(hop2?.inference).toBe('i3')
		const hop3 = hop2?.children?.[0]
		expect(hop3?.inference).toBe('i4')
		const hop4 = hop3?.children?.[0]
		expect(hop4?.inference).toBe('i5')
		const leaf = hop4?.children?.[0]
		expect(leaf?.fact).toBe('fa')
		expect(leaf?.inference).toBeUndefined()
		expect(leaf?.depth).toBe(5)

		reason.destroy()
	})
})

describe('reasons — broad-definition breadth stress', () => {
	it('dispatches a 20-group quantitative and a 15-rule logical through one orchestrator', () => {
		const reason = createReason({
			reasoners: [createQuantitativeReasoner(), createLogicalReasoner()],
		})

		// 20 groups, each one static factor value i + 1 → definition sum = 1..20 = 210.
		const broad = createQuantitativeDefinition(
			'broad',
			'Broad',
			sequence(20).map((index) =>
				createFactorGroup(`g${index}`, 'sum', [createStaticFactor(`f${index}`, index + 1)]),
			),
		)
		const quantitative = expectQuantitative(reason.reason({}, broad))
		expect(quantitative.success).toBe(true)
		expect(quantitative.count).toBe(20)
		expect(quantitative.value).toBe(210)

		// 15 threshold rules, all met at n = 100 → all apply, the last concludes true.
		const wide = createLogicalDefinition(
			'wide',
			'Wide',
			sequence(15).map((index) =>
				createRule(
					`r${index}`,
					[createAtom('n', 'from', index)],
					createAtom(`c${index}`, 'equals', true),
				),
			),
		)
		const logical = expectLogical(reason.reason({ n: 100 }, wide))
		expect(logical.success).toBe(true)
		expect(logical.count).toBe(15)
		expect(logical.conclusion).toBe(true)

		reason.destroy()
	})
})

describe('reasons — cross-reasoner determinism through the orchestrator', () => {
	it('runs one scenario per reasoner kind twice and gets deep-equal full results', () => {
		const reason = createReason({
			reasoners: [
				createQuantitativeReasoner(),
				createLogicalReasoner(),
				createSymbolicReasoner(),
				createInferentialReasoner(),
			],
		})

		const quantitativeSubject = { id: 'det-q', age: 32, income: 68000, state: 'CA' }
		const logicalSubject = { age: 20, riskScore: 10 }
		const symbolicSubject = { riskScore: 20 }
		const inferentialFacts = [
			createFact('f1', 'hasFeathers', ['tweety'], 1),
			createFact('f2', 'laysEggs', ['tweety'], 0.9),
		]
		const detInferentialDefinition = createInferentialDefinition(
			'det-birds',
			'Det Birds',
			inferentialFacts,
			[
				createInference(
					'bird-rule',
					[createFact('p1', 'hasFeathers', ['?x']), createFact('p2', 'laysEggs', ['?x'])],
					createFact('c1', 'isBird', ['?x']),
					{ confidence: 0.8 },
				),
			],
			{ depth: 5 },
		)

		const runAll = () => ({
			quantitative: reason.reason(quantitativeSubject, RISK_DEFINITION),
			logical: reason.reason(logicalSubject, ELIGIBILITY_DEFINITION),
			symbolic: reason.reason(symbolicSubject, RATE_DEFINITION),
			inferential: reason.reason({}, detInferentialDefinition),
		})

		const first = runAll()
		const second = runAll()
		expect(second).toEqual(first)

		expect(expectQuantitative(first.quantitative).success).toBe(true)
		expect(expectLogical(first.logical).success).toBe(true)
		expect(expectSymbolic(first.symbolic).success).toBe(true)
		expect(expectInferential(first.inferential).success).toBe(true)

		reason.destroy()
	})
})

describe('reasons — deep-frozen inputs across all four reasoner kinds', () => {
	it('accepts deeply frozen subjects and definitions for every kind without throwing', () => {
		const reason = createReason({
			reasoners: [
				createQuantitativeReasoner(),
				createLogicalReasoner(),
				createSymbolicReasoner(),
				createInferentialReasoner(),
			],
		})

		const frozenQuantitativeSubject = deepFreeze({
			id: 'frozen-q',
			age: 40,
			income: 20000,
			state: 'TX',
		})
		const frozenQuantitativeDefinition = deepFreeze(
			createQuantitativeDefinition('frozen-score', 'Frozen Score', [
				createFactorGroup('g', 'sum', [createStaticFactor('flat', 12)]),
			]),
		)
		const frozenLogicalSubject = deepFreeze({ age: 30 })
		const frozenLogicalDefinition = deepFreeze(
			createLogicalDefinition('frozen-adult', 'Frozen Adult', [
				createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
			]),
		)
		const frozenSymbolicSubject = deepFreeze({ x: 4 })
		const frozenSymbolicDefinition = deepFreeze(
			createSymbolicDefinition(
				'frozen-double',
				'Frozen Double',
				[
					createEquation(
						'e',
						createVariable('y'),
						createOperation('multiply', createVariable('x'), createConstant(2)),
						'y',
					),
				],
				{ precision: 2 },
			),
		)
		const frozenInferentialSubject = deepFreeze({})
		const frozenInferentialDefinition = deepFreeze(
			createInferentialDefinition(
				'frozen-derive',
				'Frozen Derive',
				[createFact('f1', 'hasFeathers', ['tweety'], 1)],
				[
					createInference(
						'i1',
						[createFact('p1', 'hasFeathers', ['?x'])],
						createFact('c1', 'isBird', ['?x']),
					),
				],
			),
		)

		const quantitative = expectQuantitative(
			reason.reason(frozenQuantitativeSubject, frozenQuantitativeDefinition),
		)
		expect(quantitative.success).toBe(true)
		expect(quantitative.value).toBe(12)

		const logical = expectLogical(reason.reason(frozenLogicalSubject, frozenLogicalDefinition))
		expect(logical.success).toBe(true)
		expect(logical.conclusion).toBe(true)

		const symbolic = expectSymbolic(reason.reason(frozenSymbolicSubject, frozenSymbolicDefinition))
		expect(symbolic.success).toBe(true)
		expect(symbolic.solutions.y).toBe(8)

		const inferential = expectInferential(
			reason.reason(frozenInferentialSubject, frozenInferentialDefinition),
		)
		expect(inferential.success).toBe(true)
		expect(inferential.derived.map((derived) => derived.predicate)).toContain('isBird')

		reason.destroy()
	})
})

describe('reasons — mixed pipeline at scale (5000 subjects, quantitative feeding logical)', () => {
	it('scores 5000 subjects then decides a threshold rule, pinning exact aggregate counts and spot values', () => {
		const SCALE_SCORE_DEFINITION = createQuantitativeDefinition('scale-score', 'Scale Score', [
			createFactorGroup('g', 'sum', [createFieldFactor('score', 'value')]),
		])
		const THRESHOLD = 2500
		const SCALE_THRESHOLD_DEFINITION = createLogicalDefinition(
			'scale-threshold',
			'Scale Threshold',
			[
				createRule(
					'pass',
					[createAtom('score', 'above', THRESHOLD)],
					createAtom('pass', 'equals', true),
				),
			],
		)

		const run = () => {
			const reason = createReason({
				reasoners: [createQuantitativeReasoner(), createLogicalReasoner()],
			})
			const subjects = buildSubjects(5000)

			const quantitativeResults = reason.reason(subjects, SCALE_SCORE_DEFINITION)
			const scores = quantitativeResults.map((result) => expectQuantitative(result).value)

			const logicalSubjects = scores.map((score) => ({ score }))
			const logicalResults = reason.reason(logicalSubjects, SCALE_THRESHOLD_DEFINITION)
			const conclusions = logicalResults.map((result) => expectLogical(result).conclusion)

			reason.destroy()
			return { scores, conclusions }
		}

		const first = run()
		const second = run()
		expect(second).toEqual(first)

		expect(first.scores).toHaveLength(5000)
		expect(first.scores[0]).toBe(0)
		expect(first.scores[4999]).toBe(4999)

		// Exact aggregate formula: values 0..4999 score identically (identity
		// field factor), so `pass` (score > THRESHOLD) holds for values
		// THRESHOLD+1..4999 — computed here, not hard-coded.
		const expectedPassCount = 4999 - THRESHOLD
		const expectedFailCount = 5000 - expectedPassCount
		const passCount = first.conclusions.filter((conclusion) => conclusion === true).length
		const failCount = first.conclusions.filter((conclusion) => conclusion === false).length
		expect(passCount).toBe(expectedPassCount)
		expect(failCount).toBe(expectedFailCount)
		expect(first.conclusions[0]).toBe(false)
		expect(first.conclusions[4999]).toBe(true)
	})
})
