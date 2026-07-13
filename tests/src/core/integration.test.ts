import {
	atom,
	bounds,
	check,
	compound,
	constant,
	createAggregator,
	createEvaluator,
	createInferentialReasoner,
	createLogicalReasoner,
	createQuantitativeReasoner,
	createReason,
	createSymbolicReasoner,
	createTransformer,
	equation,
	fact,
	factorGroup,
	fieldFactor,
	fieldSource,
	inference,
	inferentialDefinition,
	isBounds,
	isCheck,
	isDefinition,
	isExpression,
	isFact,
	isReasonError,
	isSource,
	isSubject,
	isSymbolicExpression,
	isTransform,
	logicalDefinition,
	lookupFactor,
	lookupSource,
	operation,
	quantitativeDefinition,
	rangeFactor,
	rangeSource,
	ReasonError,
	rule,
	staticFactor,
	staticSource,
	symbolicDefinition,
	transform,
	variable,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	buildSubjects,
	captureError,
	createThrowingReasoner,
	deepFreeze,
	expectInferential,
	expectLogical,
	expectQuantitative,
	expectSymbolic,
	sequence,
} from '../../../setup.js'

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
const RISK_DEFINITION = quantitativeDefinition(
	'risk-score',
	'Risk Score',
	[
		factorGroup('age', 'sum', [
			rangeFactor('age-band', 'age', [
				{ bounds: bounds(undefined, 24), value: 30 },
				{ bounds: bounds(25, 64), value: 15 },
				{ bounds: bounds(65), value: 10 },
			]),
		]),
		factorGroup('financial', 'sum', [
			fieldFactor('income-score', 'income', {
				transforms: [transform('divide', 1000)],
				bounds: bounds(0, 40),
				fallback: 0,
			}),
			lookupFactor('state-score', 'state', { CA: 5, NY: 8, TX: 2 }, { fallback: 1 }),
		]),
	],
	{ base: 10, bounds: bounds(0, 100), precision: 2 },
)

const ELIGIBILITY_DEFINITION = logicalDefinition(
	'eligibility',
	'Eligibility',
	[
		rule('adult', [atom('age', 'from', 18)], atom('adult', 'equals', true)),
		rule('risk', [atom('riskScore', 'from', 40)], atom('riskOk', 'equals', true)),
		rule(
			'eligible',
			[atom('adult', 'equals', true), atom('riskOk', 'equals', true)],
			atom('eligible', 'equals', true),
		),
	],
	{ depth: 5 },
)

const RATE_DEFINITION = symbolicDefinition(
	'rate',
	'Rate',
	[
		equation(
			'base-rate',
			variable('baseRate'),
			operation('subtract', constant(15), operation('divide', variable('riskScore'), constant(10))),
			'baseRate',
		),
		equation(
			'final-rate',
			variable('finalRate'),
			operation('maximum', variable('baseRate'), constant(3)),
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
		fact('f1', 'hasFeathers', ['tweety'], 1),
		fact('f2', 'laysEggs', ['tweety'], 0.9),
	]
	const birdRule = inference(
		'bird-rule',
		[fact('p1', 'hasFeathers', ['?x']), fact('p2', 'laysEggs', ['?x'])],
		fact('c1', 'isBird', ['?x']),
		{ confidence: 0.8 },
	)

	it('derives transitively forward (isBird, then canFly)', () => {
		const reason = createReason({ reasoners: [createInferentialReasoner()] })
		const definition = inferentialDefinition(
			'birds',
			'Birds',
			baseFacts,
			[
				birdRule,
				inference('fly-rule', [fact('p3', 'isBird', ['?x'])], fact('c2', 'canFly', ['?x']), {
					confidence: 0.5,
				}),
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
		const definition = inferentialDefinition('birds', 'Birds', baseFacts, [birdRule], {
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
		expect(isSubject({ age: 30 })).toBe(true)
		expect(isCheck(check('age', 'from', 18))).toBe(true)
		expect(isTransform(transform('multiply', 2))).toBe(true)
		expect(isBounds(bounds(0, 100))).toBe(true)
		expect(isSource(staticSource(42))).toBe(true)
		expect(isSource(fieldSource(['profile', 'score']))).toBe(true)
		expect(isSource(lookupSource('state', { CA: 5 }))).toBe(true)
		expect(isSource(rangeSource('age', [{ bounds: bounds(undefined, 25), value: 10 }]))).toBe(true)
		expect(isExpression(compound('and', [atom('age', 'from', 18)]))).toBe(true)
		expect(isSymbolicExpression(operation('add', variable('x'), constant(1)))).toBe(true)
		expect(isFact(fact('f1', 'has', ['state', 'CA']))).toBe(true)
	})

	it('every full definition fixture satisfies isDefinition', () => {
		expect(isDefinition(RISK_DEFINITION)).toBe(true)
		expect(isDefinition(ELIGIBILITY_DEFINITION)).toBe(true)
		expect(isDefinition(RATE_DEFINITION)).toBe(true)
		expect(
			isDefinition(
				logicalDefinition(
					'backward',
					'Backward',
					[rule('r', [atom('a', 'equals', 1)], atom('b', 'equals', 1))],
					{ strategy: 'backward' },
				),
			),
		).toBe(true)
		expect(
			isDefinition(
				inferentialDefinition(
					'birds',
					'Birds',
					[fact('f1', 'hasFeathers', ['tweety'])],
					[inference('i1', [fact('p1', 'hasFeathers', ['?x'])], fact('c1', 'isBird', ['?x']))],
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

		const definition = quantitativeDefinition('injected', 'Injected', [
			factorGroup('g1', 'sum', [
				fieldFactor('score', 'score', {
					checks: [check('score', 'above', 0)],
					transforms: [transform('multiply', 3)],
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
		const result = expectQuantitative(reason.reason({}, quantitativeDefinition('any', 'Any', [])))
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
		const error = captureError(() => reason.reason({}, quantitativeDefinition('late', 'Late', [])))
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
const SCORE_DEFINITION = quantitativeDefinition(
	'score',
	'Score',
	[
		factorGroup('risk', 'sum', [
			rangeFactor(
				'age',
				'age',
				[
					{ bounds: bounds(undefined, 25), value: 30 },
					{ bounds: bounds(26, 50), value: 15 },
					{ bounds: bounds(51), value: 25 },
				],
				{ weight: 2 },
			),
			lookupFactor('region', 'region', { west: 10, east: 5, north: 8 }, { fallback: 0, weight: 1 }),
			fieldFactor('claims', 'claims', { weight: 3 }),
		]),
		factorGroup('loyalty', 'average', [
			fieldFactor('tenure', 'tenure', { weight: 1 }),
			fieldFactor('incomeScore', 'income', {
				transforms: [transform('divide', 10000)],
				bounds: bounds(0, 10),
				weight: 3,
			}),
		]),
		factorGroup('bonus', 'sum', [staticFactor('flat', 5)]),
	],
	{ base: 10, precision: 2 },
)

// Stage B — 11 interdependent forward rules; derivations cascade preferred →
// premium → { discountEligible, vip } → tier, so 9 of 11 rules apply.
const TIER_DEFINITION = logicalDefinition('tier', 'Tier', [
	rule('adult', [atom('age', 'from', 18)], atom('adult', 'equals', true)),
	rule('senior', [atom('age', 'from', 65)], atom('senior', 'equals', true)),
	rule('scoreHigh', [atom('score', 'above', 60)], atom('highScore', 'equals', true)),
	rule('scoreMid', [atom('score', 'between', [40, 60])], atom('midScore', 'equals', true)),
	rule('lowClaims', [atom('claims', 'to', 3)], atom('lowClaims', 'equals', true)),
	rule('loyal', [atom('tenure', 'from', 5)], atom('loyal', 'equals', true)),
	rule(
		'preferred',
		[atom('highScore', 'equals', true), atom('lowClaims', 'equals', true)],
		atom('preferred', 'equals', true),
	),
	rule(
		'premium',
		[atom('preferred', 'equals', true), atom('loyal', 'equals', true)],
		atom('premium', 'equals', true),
	),
	rule(
		'discountEligible',
		[atom('premium', 'equals', true), atom('adult', 'equals', true)],
		atom('discountEligible', 'equals', true),
	),
	rule(
		'vip',
		[
			atom('premium', 'equals', true),
			atom('highScore', 'equals', true),
			atom('loyal', 'equals', true),
		],
		atom('vip', 'equals', true),
	),
	rule(
		'finalTier',
		[atom('vip', 'equals', true), atom('discountEligible', 'equals', true)],
		atom('tier', 'equals', 3),
	),
])

// Stage C — a three-equation chain: premium = score / 10 = 6.75; adjusted =
// premium + rules = 15.75; final = adjusted × 2 = 31.5.
const RATE_CHAIN = symbolicDefinition(
	'rateChain',
	'Rate Chain',
	[
		equation(
			'e1',
			variable('premium'),
			operation('divide', variable('score'), constant(10)),
			'premium',
		),
		equation(
			'e2',
			variable('adjusted'),
			operation('add', variable('premium'), variable('rules')),
			'adjusted',
		),
		equation(
			'e3',
			variable('final'),
			operation('multiply', variable('adjusted'), constant(2)),
			'final',
		),
	],
	{ precision: 2 },
)

// Stage D — derive classified(final) then reviewed(final) from the injected fact.
const CLASSIFY = inferentialDefinition(
	'classify',
	'Classify',
	[],
	[
		inference('cls', [fact('p', 'has', ['final', '?f'])], fact('c', 'classified', ['?f'])),
		inference('rev', [fact('p2', 'classified', ['?f'])], fact('c2', 'reviewed', ['?f'])),
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
		const broken = quantitativeDefinition(
			'broken',
			'Broken',
			[
				factorGroup('g', 'sum', [
					fieldFactor('f', 'missing', { checks: [check('gate', 'equals', true)] }),
				]),
			],
			{ aggregation: 'minimum' },
		)
		const quantitative = expectQuantitative(reason.reason({ id: 'p' }, broken))
		expect(quantitative.success).toBe(false)
		expect(Number.isNaN(quantitative.value)).toBe(true)
		expect(quantitative.count).toBe(0)

		// Stage 2 — logical still runs on the failed NaN value without crashing.
		const gate = logicalDefinition('gate', 'Gate', [
			rule('ok', [atom('risk', 'above', 0)], atom('ok', 'equals', true)),
		])
		const logical = expectLogical(reason.reason({ risk: quantitative.value }, gate))
		expect(logical.reasoning).toBe('logical')
		expect(logical.success).toBe(true)
		expect(logical.conclusion).toBe(false)

		// Stage 3 — symbolic copes with the NaN input (dropped by parseNumber) and
		// solves from its own seed: y = x × 2 = 10.
		const rate = symbolicDefinition(
			'rate',
			'Rate',
			[equation('e', variable('y'), operation('multiply', variable('x'), constant(2)), 'y')],
			{ variables: { x: 5 }, precision: 2 },
		)
		const symbolic = expectSymbolic(reason.reason({ risk: quantitative.value }, rate))
		expect(symbolic.success).toBe(true)
		expect(symbolic.solutions.y).toBe(10)

		// Stage 4 — inferential derives from the recovered symbolic solution.
		const derive = inferentialDefinition(
			'derive',
			'Derive',
			[],
			[inference('d', [fact('p', 'has', ['y', '?v'])], fact('c', 'doubled', ['?v']))],
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
		const definition = inferentialDefinition(
			'chain',
			'Chain',
			[fact('fa', 'a', ['socrates'])],
			[
				inference('i_top', [fact('pe', 'e', ['?x'])], fact('cf', 'f', ['?x'])),
				inference('i2', [fact('pd', 'd', ['?x'])], fact('ce', 'e', ['?x'])),
				inference('i3', [fact('pc', 'c', ['?x'])], fact('cd', 'd', ['?x'])),
				inference('i4', [fact('pb', 'b', ['?x'])], fact('cc', 'c', ['?x'])),
				inference('i5', [fact('pa', 'a', ['?x'])], fact('cb', 'b', ['?x'])),
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
		const broad = quantitativeDefinition(
			'broad',
			'Broad',
			sequence(20).map((index) =>
				factorGroup(`g${index}`, 'sum', [staticFactor(`f${index}`, index + 1)]),
			),
		)
		const quantitative = expectQuantitative(reason.reason({}, broad))
		expect(quantitative.success).toBe(true)
		expect(quantitative.count).toBe(20)
		expect(quantitative.value).toBe(210)

		// 15 threshold rules, all met at n = 100 → all apply, the last concludes true.
		const wide = logicalDefinition(
			'wide',
			'Wide',
			sequence(15).map((index) =>
				rule(`r${index}`, [atom('n', 'from', index)], atom(`c${index}`, 'equals', true)),
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
			fact('f1', 'hasFeathers', ['tweety'], 1),
			fact('f2', 'laysEggs', ['tweety'], 0.9),
		]
		const detInferentialDefinition = inferentialDefinition(
			'det-birds',
			'Det Birds',
			inferentialFacts,
			[
				inference(
					'bird-rule',
					[fact('p1', 'hasFeathers', ['?x']), fact('p2', 'laysEggs', ['?x'])],
					fact('c1', 'isBird', ['?x']),
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
			quantitativeDefinition('frozen-score', 'Frozen Score', [
				factorGroup('g', 'sum', [staticFactor('flat', 12)]),
			]),
		)
		const frozenLogicalSubject = deepFreeze({ age: 30 })
		const frozenLogicalDefinition = deepFreeze(
			logicalDefinition('frozen-adult', 'Frozen Adult', [
				rule('adult', [atom('age', 'from', 18)], atom('adult', 'equals', true)),
			]),
		)
		const frozenSymbolicSubject = deepFreeze({ x: 4 })
		const frozenSymbolicDefinition = deepFreeze(
			symbolicDefinition(
				'frozen-double',
				'Frozen Double',
				[equation('e', variable('y'), operation('multiply', variable('x'), constant(2)), 'y')],
				{ precision: 2 },
			),
		)
		const frozenInferentialSubject = deepFreeze({})
		const frozenInferentialDefinition = deepFreeze(
			inferentialDefinition(
				'frozen-derive',
				'Frozen Derive',
				[fact('f1', 'hasFeathers', ['tweety'], 1)],
				[inference('i1', [fact('p1', 'hasFeathers', ['?x'])], fact('c1', 'isBird', ['?x']))],
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
		const SCALE_SCORE_DEFINITION = quantitativeDefinition('scale-score', 'Scale Score', [
			factorGroup('g', 'sum', [fieldFactor('score', 'value')]),
		])
		const THRESHOLD = 2500
		const SCALE_THRESHOLD_DEFINITION = logicalDefinition('scale-threshold', 'Scale Threshold', [
			rule('pass', [atom('score', 'above', THRESHOLD)], atom('pass', 'equals', true)),
		])

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
