import type { ReasonResult, ReasonValidationResult } from '@src/core'
import {
	createInferentialReasoner,
	createDefinitionBuilder,
	createSubjectBuilder,
	fact,
	inference,
	InferentialReasoner,
	inferentialDefinition,
	isReasonError,
	quantitativeDefinition,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	ADVERSARIAL_VALUE_SUBJECT,
	captureError,
	EXTREME_NUMBERS,
	expectInferential,
	INTEGER_KEY_SUBJECT,
	invokeRaw,
	sequence,
	sparse,
	TRICKY_KEYS,
} from '../../../setup.js'

// `InferentialReasoner` behavior — bidirectional positional unification
// (`?`-prefixed string terms are variables on EITHER side, consistent within a
// match and joined across premises), forward chaining as a deduped fixpoint
// (confidence = Π premise-fact confidences × the inference's own, rounded to 4
// decimal places; SameValueZero dedupe so a NaN term derives once; knownFacts
// grows LIVE within an iteration, so a depth cap interacts with declaration
// order; deriving nothing is still success), scalar subject fields injected as
// `has(key, value)` facts (`id` / null / undefined / objects / arrays skipped),
// backward chaining returning the FIRST provable inference's derived fact
// (confidence = the inference's own; variable terms stay uninstantiated; a
// base-fact goal yields a bare leaf proof; depth cap is the ONLY recursion
// guard; a malformed-premises candidate skips silently) plus its ProofNode
// tree (`fact` / `inference` — DESIGN §2 renames of scsr's factId /
// inferenceId), and validate()'s duplicate-id + confidence-range warnings.
// Ports the full scsr catalog (terms, not arguments).

const reasoner = createInferentialReasoner()

// The canonical mortality scenario: human(socrates) and human(?x) → mortal(?x).
function mortality(subjects: readonly string[] = ['socrates']) {
	return inferentialDefinition(
		'mortality',
		'Mortality',
		subjects.map((name, index) => fact(`f${index + 1}`, 'human', [name])),
		[inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']))],
	)
}

describe('InferentialReasoner — identity', () => {
	it('defaults its id to "inferential" and reports its reasoning', () => {
		expect(reasoner.id).toBe('inferential')
		expect(reasoner.reasoning).toBe('inferential')
		expect(new InferentialReasoner().id).toBe('inferential')
	})

	it('takes a custom id through the options object', () => {
		expect(new InferentialReasoner({ id: 'custom' }).id).toBe('custom')
	})
})

describe('InferentialReasoner — supports', () => {
	it('supports inferential definitions only', () => {
		expect(reasoner.supports(inferentialDefinition('d', 'd', [], []))).toBe(true)
		expect(reasoner.supports(quantitativeDefinition('d', 'd', []))).toBe(false)
	})
})

describe('InferentialReasoner — validate', () => {
	it('accepts a well-formed definition', () => {
		const validation = reasoner.validate(mortality())
		expect(validation.valid).toBe(true)
		expect(validation.errors).toEqual([])
	})

	it('rejects the wrong reasoning with the renamed message', () => {
		const validation = reasoner.validate(quantitativeDefinition('d', 'd', []))
		expect(validation.errors[0]).toBe('Expected reasoning "inferential", got "quantitative"')
	})

	it('demands an id and a name', () => {
		const validation = reasoner.validate(inferentialDefinition('', '', [], []))
		expect(validation.errors).toContain('Definition must have an id')
		expect(validation.errors).toContain('Definition must have a name')
	})

	it('an empty inference set is a WARNING, not an error', () => {
		const validation = reasoner.validate(inferentialDefinition('d', 'd', [], []))
		expect(validation.valid).toBe(true)
		expect(validation.warnings).toContain('Definition has no inference rules')
	})

	it('a premise-less inference is a WARNING; a conclusion-less one is an ERROR', () => {
		const warned = reasoner.validate(
			inferentialDefinition('d', 'd', [], [inference('i1', [], fact('c1', 'p', []))]),
		)
		expect(warned.valid).toBe(true)
		expect(warned.warnings).toContain('Inference "i1" has no premises')

		const errored = invokeRaw<ReasonValidationResult>(reasoner, reasoner.validate, [
			{
				reasoning: 'inferential',
				id: 'd',
				name: 'd',
				facts: [],
				strategy: 'forward',
				inferences: [{ id: 'i1', name: 'i1', premises: [fact('p1', 'p', [])] }],
			},
		])
		expect(errored.valid).toBe(false)
		expect(errored.errors).toContain('Inference "i1" must have a conclusion')
	})

	it('duplicate inference ids are a WARNING, once per duplicated id', () => {
		const validation = reasoner.validate(
			inferentialDefinition(
				'd',
				'd',
				[],
				[
					inference('dup', [fact('p1', 'a', [])], fact('c1', 'b', [])),
					inference('dup', [fact('p2', 'c', [])], fact('c2', 'd', [])),
					inference('dup', [fact('p3', 'e', [])], fact('c3', 'f', [])),
				],
			),
		)
		expect(validation.valid).toBe(true)
		expect(
			validation.warnings.filter((warning) => warning === 'Duplicate inference id "dup"'),
		).toHaveLength(1)
	})

	it('a confidence outside [0, 1] is a WARNING — on facts and inferences alike', () => {
		const validation = reasoner.validate(
			inferentialDefinition(
				'd',
				'd',
				[fact('f1', 'p', [], 1.5), fact('f2', 'q', [], 0.5)],
				[
					inference('i1', [fact('p1', 'p', [])], fact('c1', 'r', []), { confidence: -0.2 }),
					inference('i2', [fact('p2', 'q', [])], fact('c2', 's', []), { confidence: 1 }),
				],
			),
		)
		expect(validation.valid).toBe(true)
		expect(validation.warnings).toContain('Fact "f1" confidence outside [0, 1]')
		expect(validation.warnings).toContain('Inference "i1" confidence outside [0, 1]')
		// The in-range fact and inference stay silent.
		expect(validation.warnings.some((warning) => warning.includes('"f2"'))).toBe(false)
		expect(validation.warnings.some((warning) => warning.includes('"i2"'))).toBe(false)
	})

	it('a NaN confidence is outside [0, 1] too — the warning still fires', () => {
		const validation = reasoner.validate(
			inferentialDefinition(
				'd',
				'd',
				[fact('f1', 'p', [], Number.NaN)],
				[inference('i1', [fact('p1', 'p', [])], fact('c1', 'r', []), { confidence: Number.NaN })],
			),
		)
		expect(validation.valid).toBe(true)
		expect(validation.warnings).toContain('Fact "f1" confidence outside [0, 1]')
		expect(validation.warnings).toContain('Inference "i1" confidence outside [0, 1]')
	})

	it('a conclusion variable unbound by all premises is a WARNING (runnable)', () => {
		const footgun = inferentialDefinition(
			'd',
			'd',
			[],
			[inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x', '?y']))],
		)
		const validation = reasoner.validate(footgun)
		expect(validation.valid).toBe(true)
		expect(validation.warnings).toContain(
			'Inference "i1" conclusion variable "?y" is unbound by all premises',
		)
	})

	it('stays silent on the unbound-variable warning when every conclusion variable is premise-bound', () => {
		const clean = mortality()
		const validation = reasoner.validate(clean)
		expect(validation.warnings.filter((warning) => warning.includes('is unbound by'))).toEqual([])
	})

	it('stays silent on the unbound-variable warning for a fully ground conclusion', () => {
		const ground = inferentialDefinition(
			'd',
			'd',
			[],
			[inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['socrates']))],
		)
		const validation = reasoner.validate(ground)
		expect(validation.warnings.filter((warning) => warning.includes('is unbound by'))).toEqual([])
	})

	it('skips a disabled inference and a conclusion-less inference for the unbound-variable check', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[],
			[
				inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x', '?y']), {
					enabled: false,
				}),
			],
		)
		const validation = reasoner.validate(definition)
		expect(validation.warnings.filter((warning) => warning.includes('is unbound by'))).toEqual([])

		const errored = invokeRaw<ReasonValidationResult>(reasoner, reasoner.validate, [
			{
				reasoning: 'inferential',
				id: 'd',
				name: 'd',
				facts: [],
				strategy: 'forward',
				inferences: [{ id: 'i1', name: 'i1', premises: [fact('p1', 'human', ['?x'])] }],
			},
		])
		expect(errored.warnings.filter((warning) => warning.includes('is unbound by'))).toEqual([])
	})

	it('keeps the existing duplicate-id and confidence warnings unaffected by the new unbound-variable check', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[],
			[
				inference('dup', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x', '?y']), {
					confidence: -0.2,
				}),
				inference('dup', [fact('p2', 'human', ['?x'])], fact('c2', 'mortal', ['?x'])),
			],
		)
		const validation = reasoner.validate(definition)
		expect(validation.warnings).toContain('Duplicate inference id "dup"')
		expect(validation.warnings).toContain('Inference "dup" confidence outside [0, 1]')
		expect(validation.warnings).toContain(
			'Inference "dup" conclusion variable "?y" is unbound by all premises',
		)
	})
})

describe('InferentialReasoner — forward chaining', () => {
	it('derives mortal(socrates) from human(socrates)', () => {
		const result = expectInferential(reasoner.reason({}, mortality()))
		expect(result.success).toBe(true)
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.predicate).toBe('mortal')
		expect(result.derived[0]?.terms).toEqual(['socrates'])
		expect(result.trace.length).toBeGreaterThan(0)
	})

	it('derives one fact per matching entity', () => {
		const result = expectInferential(
			reasoner.reason({}, mortality(['socrates', 'plato', 'aristotle'])),
		)
		expect(result.derived).toHaveLength(3)
		expect(result.derived.every((derived) => derived.predicate === 'mortal')).toBe(true)
	})

	it('a join with only one supporting fact succeeds with nothing derived', () => {
		const definition = inferentialDefinition(
			'family',
			'Family',
			[fact('f1', 'parent', ['alice', 'bob'])],
			[
				inference(
					'grandparent',
					[fact('p1', 'parent', ['?x', '?y']), fact('p2', 'parent', ['?y', '?z'])],
					fact('c1', 'grandparent', ['?x', '?z']),
				),
			],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.derived).toHaveLength(0)
	})

	it('binds variables CONSISTENTLY across premises (relational join)', () => {
		const definition = inferentialDefinition(
			'family',
			'Family',
			[fact('f1', 'parent', ['alice', 'bob']), fact('f2', 'parent', ['bob', 'carol'])],
			[
				inference(
					'grandparent',
					[fact('p1', 'parent', ['?x', '?y']), fact('p2', 'parent', ['?y', '?z'])],
					fact('c1', 'grandparent', ['?x', '?z']),
				),
			],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.terms).toEqual(['alice', 'carol'])
	})

	it('chains transitively within the fixpoint (mortal → needsInsurance)', () => {
		const definition = inferentialDefinition(
			'chain',
			'Chain',
			[fact('f1', 'human', ['socrates'])],
			[
				inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x'])),
				inference('i2', [fact('p2', 'mortal', ['?x'])], fact('c2', 'needsInsurance', ['?x'])),
			],
			{ depth: 5 },
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toHaveLength(2)
		expect(result.derived.map((derived) => derived.predicate)).toEqual(['mortal', 'needsInsurance'])
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(true)
	})

	it('never re-derives an already-known fact (dedup by predicate + arity + terms)', () => {
		const definition = inferentialDefinition(
			'mortality',
			'Mortality',
			[fact('f1', 'human', ['socrates']), fact('f2', 'mortal', ['socrates'])],
			[inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']))],
		)
		expect(expectInferential(reasoner.reason({}, definition)).derived).toHaveLength(0)
	})

	it('a NaN-termed fact derives ONCE and the fixpoint converges (SameValueZero dedupe)', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[fact('f1', 'value', [Number.NaN])],
			[inference('i1', [fact('p1', 'value', ['?x'])], fact('c1', 'double', ['?x']))],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toHaveLength(1)
		expect(Number.isNaN(result.derived[0]?.terms[0])).toBe(true)
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(true)
		expect(result.success).toBe(true)
	})

	it('pins the exact forward Derived trace format', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[fact('f1', 'human', ['socrates'], 0.8)],
			[
				inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']), {
					confidence: 0.5,
				}),
			],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.trace).toContain(
			'Derived mortal(socrates) via "i1" [confidence: 0.4] (iteration 1)',
		)
	})

	it('a variable in a BASE FACT unifies against a constant premise (bidirectional)', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[fact('f1', 'human', ['?anyone'])],
			[inference('i1', [fact('p1', 'human', ['socrates'])], fact('c1', 'mortal', ['socrates']))],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.predicate).toBe('mortal')
		expect(result.derived[0]?.terms).toEqual(['socrates'])
		expect(result.derived[0]?.confidence).toBe(1)
	})

	it('the SAME variable twice in one premise enforces within-match consistency', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[fact('f1', 'pair', ['a', 'b']), fact('f2', 'pair', ['c', 'c'])],
			[inference('i1', [fact('p1', 'pair', ['?x', '?x'])], fact('c1', 'twin', ['?x']))],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.terms).toEqual(['c'])
	})

	it('the depth cap truncates by DECLARATION ORDER — knownFacts grows live within a pass', () => {
		const dependencyOrder = [
			inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x'])),
			inference('i2', [fact('p2', 'mortal', ['?x'])], fact('c2', 'insured', ['?x'])),
		]
		const base = [fact('f1', 'human', ['socrates'])]

		// In dependency order, ONE pass derives both — mortal lands in knownFacts
		// mid-pass and immediately feeds i2 (unlike the logical snapshot).
		const forward = expectInferential(
			reasoner.reason({}, inferentialDefinition('d', 'd', base, dependencyOrder, { depth: 1 })),
		)
		expect(forward.derived.map((derived) => derived.predicate)).toEqual(['mortal', 'insured'])
		expect(forward.trace.some((entry) => entry.includes('converged'))).toBe(false)

		// Reversed, the same pass sees no mortal yet — depth 1 truncates the chain.
		const reversed = expectInferential(
			reasoner.reason(
				{},
				inferentialDefinition('d', 'd', base, [...dependencyOrder].reverse(), { depth: 1 }),
			),
		)
		expect(reversed.derived.map((derived) => derived.predicate)).toEqual(['mortal'])
		expect(reversed.trace.some((entry) => entry.includes('converged'))).toBe(false)
	})

	it('skips a disabled inference silently', () => {
		const definition = inferentialDefinition(
			'mortality',
			'Mortality',
			[fact('f1', 'human', ['socrates'])],
			[
				inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']), {
					enabled: false,
				}),
			],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.derived).toHaveLength(0)
	})

	it('unmatched premises and empty fact sets are success with nothing derived', () => {
		const unmatched = inferentialDefinition(
			'd',
			'd',
			[fact('f1', 'dog', ['rex'])],
			[inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']))],
		)
		const unmatchedResult = expectInferential(reasoner.reason({}, unmatched))
		expect(unmatchedResult.success).toBe(true)
		expect(unmatchedResult.derived).toHaveLength(0)

		const empty = inferentialDefinition(
			'd',
			'd',
			[],
			[inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']))],
		)
		expect(expectInferential(reasoner.reason({}, empty)).success).toBe(true)
	})

	it('an empty inference set traces "No inference rules defined"', () => {
		const result = expectInferential(
			reasoner.reason({}, inferentialDefinition('d', 'd', [fact('f1', 'p', [])], [])),
		)
		expect(result.success).toBe(true)
		expect(result.trace).toContain('No inference rules defined')
	})

	it('a premise-less inference errors once and is excluded (forward)', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[],
			[inference('i1', [], fact('c1', 'p', []))],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Inference "i1" has no premises — skipped')
		expect(result.derived).toHaveLength(0)
	})
})

describe('InferentialReasoner — confidence', () => {
	it('multiplies the premise-fact confidence with the inference confidence', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[fact('f1', 'human', ['socrates'], 0.8)],
			[
				inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']), {
					confidence: 0.5,
				}),
			],
		)
		expect(expectInferential(reasoner.reason({}, definition)).derived[0]?.confidence).toBe(0.4)
	})

	it('propagates multiplicatively through a transitive chain', () => {
		const definition = inferentialDefinition(
			'birds',
			'Birds',
			[fact('f1', 'hasFeathers', ['tweety'], 1), fact('f2', 'laysEggs', ['tweety'], 0.9)],
			[
				inference(
					'bird-rule',
					[fact('p1', 'hasFeathers', ['?x']), fact('p2', 'laysEggs', ['?x'])],
					fact('c1', 'isBird', ['?x']),
					{ confidence: 0.8 },
				),
				inference('fly-rule', [fact('p3', 'isBird', ['?x'])], fact('c2', 'canFly', ['?x']), {
					confidence: 0.5,
				}),
			],
			{ depth: 5 },
		)
		const result = expectInferential(reasoner.reason({}, definition))
		const bird = result.derived.find((derived) => derived.predicate === 'isBird')
		const flight = result.derived.find((derived) => derived.predicate === 'canFly')
		expect(bird?.confidence).toBe(0.72)
		expect(flight?.confidence).toBe(0.36)
	})

	it('rounds the derived confidence to 4 decimal places', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[fact('f1', 'human', ['socrates'], 0.1111)],
			[
				inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']), {
					confidence: 0.1111,
				}),
			],
		)
		// 0.1111 × 0.1111 = 0.01234321 → rounded to 0.0123.
		expect(expectInferential(reasoner.reason({}, definition)).derived[0]?.confidence).toBe(0.0123)
	})
})

describe('InferentialReasoner — subject facts', () => {
	it('scalar subject fields become has(key, value) facts that feed premises', () => {
		const definition = inferentialDefinition(
			'residency',
			'Residency',
			[],
			[inference('i1', [fact('p1', 'has', ['state', 'CA'])], fact('c1', 'californiaResident', []))],
		)
		const result = expectInferential(reasoner.reason({ state: 'CA' }, definition))
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.predicate).toBe('californiaResident')
		expect(result.trace).toContain('Subject field "state" → has(state, CA)')
		expect(result.trace).toContain('Injected 1 fact(s) from subject')
	})

	it('skips id, null, undefined, objects, and arrays — scalars only', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[],
			[inference('i1', [fact('p1', 'has', ['age', 30])], fact('c1', 'adultish', []))],
		)
		const result = expectInferential(
			reasoner.reason(
				{ id: 'skip-me', a: null, b: undefined, c: { k: 1 }, d: [1], e: 1, age: 30 },
				definition,
			),
		)
		expect(result.trace).toContain('Subject field "age" → has(age, 30)')
		expect(result.trace).toContain('Subject field "e" → has(e, 1)')
		expect(result.trace).toContain('Injected 2 fact(s) from subject')
		for (const skipped of ['has(id', 'has(a,', 'has(b,', 'has(c,', 'has(d,']) {
			expect(result.trace.some((entry) => entry.includes(skipped))).toBe(false)
		}
	})

	it('subject facts combine with definition facts inside multi-premise inferences', () => {
		const definition = inferentialDefinition(
			'beach',
			'Beach',
			[fact('f1', 'likesSun', ['alice'])],
			[
				inference(
					'i1',
					[fact('p1', 'has', ['state', 'CA']), fact('p2', 'likesSun', ['?x'])],
					fact('c1', 'beachDay', ['?x']),
				),
			],
		)
		const result = expectInferential(reasoner.reason({ state: 'CA' }, definition))
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.terms).toEqual(['alice'])
	})
})

describe('InferentialReasoner — backward chaining (proof trees)', () => {
	const birds = inferentialDefinition(
		'birds',
		'Birds',
		[fact('f1', 'hasFeathers', ['tweety'], 1), fact('f2', 'laysEggs', ['tweety'], 0.9)],
		[
			inference(
				'bird-rule',
				[fact('p1', 'hasFeathers', ['?x']), fact('p2', 'laysEggs', ['?x'])],
				fact('c1', 'isBird', ['?x']),
				{ confidence: 0.8 },
			),
		],
		{ strategy: 'backward', depth: 5 },
	)

	it('returns the proof tree referencing the conclusion fact and the inference', () => {
		const result = expectInferential(reasoner.reason({}, birds))
		expect(result.success).toBe(true)
		expect(result.proof?.fact).toBe('c1')
		expect(result.proof?.inference).toBe('bird-rule')
		expect(result.proof?.depth).toBe(0)
		expect(result.proof?.children).toHaveLength(2)
		expect(result.proof?.children?.[0]).toEqual({ fact: 'f1', depth: 1 })
		expect(result.trace).toContain('Proved isBird(?x)')
	})

	it('the backward derived fact carries the INFERENCE confidence (premises not propagated)', () => {
		const result = expectInferential(reasoner.reason({}, birds))
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.predicate).toBe('isBird')
		expect(result.derived[0]?.confidence).toBe(0.8)
	})

	it('the backward derived fact keeps VARIABLE terms uninstantiated (reachability heuristic)', () => {
		const result = expectInferential(reasoner.reason({}, birds))
		expect(result.derived[0]?.terms).toEqual(['?x'])
	})

	it('a SELF-RECURSIVE inference terminates through the depth cap alone', () => {
		// p(?x) → p(?x) with no base facts: the ONLY recursion guard is the cap.
		const definition = inferentialDefinition(
			'd',
			'd',
			[],
			[inference('i1', [fact('p1', 'p', ['?x'])], fact('c1', 'p', ['?x']))],
			{ strategy: 'backward', depth: 5 },
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toEqual([])
		expect(result.proof).toBeUndefined()
		expect(result.success).toBe(true)
	})

	it('a goal that IS a base fact proves as a bare leaf — and still "derives" a duplicate', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[fact('f1', 'sunny', [])],
			[
				inference('i1', [fact('p1', 'irrelevant', [])], fact('c1', 'sunny', []), {
					confidence: 0.7,
				}),
			],
			{ strategy: 'backward' },
		)
		const result = expectInferential(reasoner.reason({}, definition))
		// The leaf carries NO inference / children keys — a bare fact reference.
		expect(result.proof).toEqual({ fact: 'f1', depth: 0 })
		if (!result.proof) throw new Error('expected a proof')
		expect(Object.keys(result.proof).sort()).toEqual(['depth', 'fact'])
		// The already-known fact is re-reported, stamped with the INFERENCE confidence.
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.predicate).toBe('sunny')
		expect(result.derived[0]?.confidence).toBe(0.7)
		expect(result.trace).toContain('Proved sunny()')
	})

	it('a candidate with MISSING premises is skipped silently — a valid sibling still proves', () => {
		const result = expectInferential(
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [
				{},
				{
					reasoning: 'inferential',
					id: 'd',
					name: 'd',
					facts: [fact('f1', 'p', ['a'])],
					strategy: 'backward',
					inferences: [
						{ id: 'i1', name: 'i1', conclusion: fact('c1', 'goal', []) },
						inference('i2', [fact('p2', 'p', ['?x'])], fact('c2', 'q', ['?x'])),
					],
				},
			]),
		)
		// No crash, no error — backward's error posture reports only missing conclusions.
		expect(result.success).toBe(true)
		expect(result.errors).toEqual([])
		expect(result.proof?.inference).toBe('i2')
		expect(result.derived).toHaveLength(1)
	})

	it('a missing base fact leaves the proof undefined (still success)', () => {
		const definition = inferentialDefinition(
			'birds',
			'Birds',
			[fact('f1', 'hasFeathers', ['tweety'])],
			[
				inference(
					'bird-rule',
					[fact('p1', 'hasFeathers', ['?x']), fact('p2', 'laysEggs', ['?x'])],
					fact('c1', 'isBird', ['?x']),
				),
			],
			{ strategy: 'backward' },
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.proof).toBeUndefined()
		expect(result.derived).toHaveLength(0)
	})

	it('returns on the FIRST provable inference in declaration order', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[fact('f1', 'p', ['a'])],
			[
				inference('i-fail', [fact('p1', 'q', ['?x'])], fact('c1', 'r', ['?x'])),
				inference('i-pass', [fact('p2', 'p', ['?x'])], fact('c2', 's', ['?x'])),
			],
			{ strategy: 'backward' },
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toHaveLength(1)
		expect(result.proof?.inference).toBe('i-pass')
	})

	it('proves through a nested inference chain (children carry the sub-proof)', () => {
		const definition = inferentialDefinition(
			'birds',
			'Birds',
			[fact('f1', 'hasFeathers', ['tweety']), fact('f2', 'laysEggs', ['tweety'])],
			[
				inference('fly-rule', [fact('p3', 'isBird', ['?x'])], fact('c2', 'canFly', ['?x'])),
				inference(
					'bird-rule',
					[fact('p1', 'hasFeathers', ['?x']), fact('p2', 'laysEggs', ['?x'])],
					fact('c1', 'isBird', ['?x']),
				),
			],
			{ strategy: 'backward', depth: 5 },
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.proof?.inference).toBe('fly-rule')
		expect(result.proof?.children?.[0]?.inference).toBe('bird-rule')
		expect(result.proof?.children?.[0]?.depth).toBe(1)
	})

	it('a conclusion-less inference errors and is skipped (backward)', () => {
		const result = expectInferential(
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [
				{},
				{
					reasoning: 'inferential',
					id: 'd',
					name: 'd',
					facts: [],
					strategy: 'backward',
					inferences: [{ id: 'i1', name: 'i1', premises: [fact('p1', 'p', [])] }],
				},
			]),
		)
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Inference "i1" has no conclusion — skipped')
	})

	it('a conclusion-less CANDIDATE inside sub-goal search is skipped, never a throw', () => {
		// The malformed inference is scanned as a proof candidate while proving the
		// healthy sibling's premise — it must be stepped over, and the sibling's
		// goal must still prove from the base fact.
		const result = expectInferential(
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [
				{},
				{
					reasoning: 'inferential',
					id: 'd',
					name: 'd',
					facts: [fact('f1', 'q', [1])],
					strategy: 'backward',
					inferences: [
						{ id: 'broken', name: 'broken', premises: [fact('p0', 'p', [])] },
						inference('i1', [fact('p1', 'q', [1])], fact('c1', 's', [1])),
					],
				},
			]),
		)
		expect(result.derived.map((derived) => derived.predicate)).toEqual(['s'])
		expect(result.proof?.inference).toBe('i1')
		expect(result.errors).toContain('Inference "broken" has no conclusion — skipped')
	})
})

describe('InferentialReasoner — mismatch vs malformed shape', () => {
	it('MISMATCH: the wrong reasoning THROWS a coded ReasonError with context', () => {
		const error = captureError(() =>
			reasoner.reason({}, quantitativeDefinition('other', 'Other', [])),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')
		expect(error.message).toBe('Expected inferential definition, got "quantitative"')
		expect(error.context).toEqual({ definition: 'other', reasoning: 'inferential' })
	})

	it('a malformed shape (missing facts or inferences) is a FAILURE RESULT, not a throw', () => {
		for (const malformed of [
			{ reasoning: 'inferential', id: 'd', name: 'd', inferences: [] },
			{ reasoning: 'inferential', id: 'd', name: 'd', facts: [] },
		]) {
			const result = expectInferential(
				invokeRaw<ReasonResult>(reasoner, reasoner.reason, [{}, malformed]),
			)
			expect(result.success).toBe(false)
			expect(result.errors).toEqual(['Definition must have "facts" and "inferences" arrays'])
		}
	})
})

// The transitive-closure fixture: a `parent` chain 0→1→…→5 plus a base rule
// (parent ⇒ ancestor) and a recursive rule (parent + ancestor ⇒ ancestor). With
// forward chaining's LIVE-growing knownFacts the first pass derives BOTH distance-1
// (base rule) and distance-2 (recursive rule reading the just-added distance-1
// ancestors) — so completeness is reached in L-1 passes, not L, for a chain of L
// edges. The full closure is every (i, j) with i < j — C(6, 2) = 15 pairs.
function ancestry(depth: number) {
	return inferentialDefinition(
		'ancestry',
		'Ancestry',
		sequence(5).map((node) => fact(`p${node}`, 'parent', [node, node + 1])),
		[
			inference('base', [fact('b1', 'parent', ['?x', '?y'])], fact('cb', 'ancestor', ['?x', '?y'])),
			inference(
				'trans',
				[fact('t1', 'parent', ['?x', '?y']), fact('t2', 'ancestor', ['?y', '?z'])],
				fact('ct', 'ancestor', ['?x', '?z']),
			),
		],
		{ depth },
	)
}

describe('InferentialReasoner — higher-arity joins', () => {
	it('threads a middle variable through arity-3 premises into an arity-5 conclusion', () => {
		const definition = inferentialDefinition(
			'wide',
			'Wide',
			[fact('e1', 'rel', ['a', 'b', 1]), fact('e2', 'rel', ['b', 'c', 2])],
			[
				inference(
					'chain-rule',
					[fact('p1', 'rel', ['?x', '?y', '?p']), fact('p2', 'rel', ['?y', '?z', '?q'])],
					fact('c1', 'chain', ['?x', '?y', '?z', '?p', '?q']),
				),
			],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.predicate).toBe('chain')
		expect(result.derived[0]?.terms).toHaveLength(5)
		// ?y = b is the JOIN key shared by both arity-3 premises; the walk that starts
		// at rel(b, c, 2) finds no rel(c, …) and contributes nothing.
		expect(result.derived[0]?.terms).toEqual(['a', 'b', 'c', 1, 2])
		expect(result.derived[0]?.confidence).toBe(1)
	})

	it('enforces within-match consistency of a repeated variable in an arity-3 premise', () => {
		const definition = inferentialDefinition(
			'triples',
			'Triples',
			[fact('f1', 'triple', ['a', 'a', 'b']), fact('f2', 'triple', ['a', 'c', 'b'])],
			[
				inference(
					'i1',
					[fact('p1', 'triple', ['?x', '?x', '?y'])],
					fact('c1', 'same', ['?x', '?y']),
				),
			],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		// Only triple(a, a, b) satisfies the doubled ?x; triple(a, c, b) fails position 1.
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.terms).toEqual(['a', 'b'])
	})
})

describe('InferentialReasoner — relational join scale', () => {
	it('an N×N cross join derives exactly N² pairs (bounded, deterministic)', () => {
		const size = 50
		const definition = inferentialDefinition(
			'cross',
			'Cross',
			[
				...sequence(size).map((n) => fact(`l${n}`, 'left', [n])),
				...sequence(size).map((n) => fact(`r${n}`, 'right', [n])),
			],
			[
				inference(
					'pair-rule',
					[fact('p1', 'left', ['?x']), fact('p2', 'right', ['?y'])],
					fact('c1', 'pair', ['?x', '?y']),
				),
			],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.derived).toHaveLength(size * size)
		expect(result.derived.every((derived) => derived.predicate === 'pair')).toBe(true)
		const hasPair = (x: number, y: number) =>
			result.derived.some((derived) => derived.terms[0] === x && derived.terms[1] === y)
		expect(hasPair(0, 0)).toBe(true)
		expect(hasPair(49, 49)).toBe(true)
		expect(hasPair(7, 13)).toBe(true)
	})

	it('a 100×100 cross join derives exactly 10,000 pairs (indexed join + O(1) dedup)', () => {
		// 200 base facts → 10k derivations. Before the predicate index and the Set-based
		// dedup this was O(bindings × facts) joins plus an O(derived²) rescan; both fixes
		// keep it tractable while the derived count and predicate stay exact.
		const size = 100
		const definition = inferentialDefinition(
			'cross-scale',
			'Cross-scale',
			[
				...sequence(size).map((n) => fact(`l${n}`, 'left', [n])),
				...sequence(size).map((n) => fact(`r${n}`, 'right', [n])),
			],
			[
				inference(
					'pair-rule',
					[fact('p1', 'left', ['?x']), fact('p2', 'right', ['?y'])],
					fact('c1', 'pair', ['?x', '?y']),
				),
			],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.derived).toHaveLength(size * size)
		expect(result.derived.every((derived) => derived.predicate === 'pair')).toBe(true)
		const hasPair = (x: number, y: number) =>
			result.derived.some((derived) => derived.terms[0] === x && derived.terms[1] === y)
		expect(hasPair(0, 0)).toBe(true)
		expect(hasPair(99, 99)).toBe(true)
		expect(hasPair(42, 7)).toBe(true)
	})

	it('a linear parent chain derives exactly N−1 grandparent pairs', () => {
		const size = 50
		const definition = inferentialDefinition(
			'lineage',
			'Lineage',
			sequence(size).map((n) => fact(`p${n}`, 'parent', [n, n + 1])),
			[
				inference(
					'grandparent',
					[fact('p1', 'parent', ['?x', '?y']), fact('p2', 'parent', ['?y', '?z'])],
					fact('c1', 'grandparent', ['?x', '?z']),
				),
			],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toHaveLength(size - 1)
		const hasPair = (x: number, z: number) =>
			result.derived.some((derived) => derived.terms[0] === x && derived.terms[1] === z)
		expect(hasPair(0, 2)).toBe(true)
		expect(hasPair(48, 50)).toBe(true)
		// The last edge parent(49, 50) has no parent(50, …) to join, so no (49, 51).
		expect(hasPair(49, 51)).toBe(false)
	})
})

describe('InferentialReasoner — transitive fixpoint depth', () => {
	it('a depth below the completion count truncates the closure', () => {
		// Passes: {d1, d2} at index 0, d3 at index 1, d4 at index 2 → depth 3 stops
		// after index 2 with distances 1-4 = 14 pairs, missing only ancestor(0, 5).
		const result = expectInferential(reasoner.reason({}, ancestry(3)))
		expect(result.derived).toHaveLength(14)
		expect(result.derived.every((derived) => derived.predicate === 'ancestor')).toBe(true)
		const hasPair = (x: number, z: number) =>
			result.derived.some((derived) => derived.terms[0] === x && derived.terms[1] === z)
		expect(hasPair(0, 4)).toBe(true)
		expect(hasPair(0, 5)).toBe(false)
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(false)
	})

	it('the exact completion depth yields the full closure WITHOUT a convergence pass', () => {
		// Distance-5 ancestor(0, 5) lands at pass index 3, so depth 4 completes the
		// 15-pair closure — but the loop exits on the depth cap, never on convergence.
		const result = expectInferential(reasoner.reason({}, ancestry(4)))
		expect(result.derived).toHaveLength(15)
		expect(result.derived.some((derived) => derived.terms[0] === 0 && derived.terms[1] === 5)).toBe(
			true,
		)
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(false)
	})

	it('a depth past completion converges — full closure plus the convergence trace', () => {
		const result = expectInferential(reasoner.reason({}, ancestry(6)))
		expect(result.derived).toHaveLength(15)
		expect(result.trace.some((entry) => entry.includes('converged at iteration 5'))).toBe(true)
	})
})

describe('InferentialReasoner — deep backward proof tree', () => {
	it('nests a five-level ProofNode with fact / inference / depth per level to a bare leaf', () => {
		const definition = inferentialDefinition(
			'deep',
			'Deep',
			[fact('f-base', 'base', ['thing'])],
			[
				inference('i-top', [fact('p-top', 'b', ['?x'])], fact('c-top', 'a', ['?x'])),
				inference('i-l4', [fact('p-l4', 'c', ['?x'])], fact('c-l4', 'b', ['?x'])),
				inference('i-l3', [fact('p-l3', 'd', ['?x'])], fact('c-l3', 'c', ['?x'])),
				inference('i-l2', [fact('p-l2', 'e', ['?x'])], fact('c-l2', 'd', ['?x'])),
				inference('i-l1', [fact('p-l1', 'base', ['?x'])], fact('c-l1', 'e', ['?x'])),
			],
			{ strategy: 'backward', depth: 10 },
		)
		const result = expectInferential(reasoner.reason({}, definition))
		// The node `fact` at each level is the GOAL id (the parent's premise), not the
		// matching inference's conclusion id — the top node alone carries the conclusion.
		const level0 = result.proof
		expect(level0).toMatchObject({ fact: 'c-top', inference: 'i-top', depth: 0 })
		const level1 = level0?.children?.[0]
		expect(level1).toMatchObject({ fact: 'p-top', inference: 'i-l4', depth: 1 })
		const level2 = level1?.children?.[0]
		expect(level2).toMatchObject({ fact: 'p-l4', inference: 'i-l3', depth: 2 })
		const level3 = level2?.children?.[0]
		expect(level3).toMatchObject({ fact: 'p-l3', inference: 'i-l2', depth: 3 })
		const level4 = level3?.children?.[0]
		expect(level4).toMatchObject({ fact: 'p-l2', inference: 'i-l1', depth: 4 })
		// The leaf is a bare base-fact reference — no inference / children keys.
		expect(level4?.children?.[0]).toEqual({ fact: 'f-base', depth: 5 })
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.predicate).toBe('a')
		expect(result.derived[0]?.terms).toEqual(['?x'])
	})
})

describe('InferentialReasoner — recursion termination', () => {
	it('mutually-recursive backward inferences terminate through the depth cap', () => {
		const definition = inferentialDefinition(
			'mutual',
			'Mutual',
			[],
			[
				inference('ping', [fact('p1', 'pong', ['?x'])], fact('c1', 'ping', ['?x'])),
				inference('pong', [fact('p2', 'ping', ['?x'])], fact('c2', 'pong', ['?x'])),
			],
			{ strategy: 'backward', depth: 5 },
		)
		const result = expectInferential(reasoner.reason({}, definition))
		// No base fact ever bottoms out the ping↔pong loop — the cap is the sole guard.
		expect(result.success).toBe(true)
		expect(result.derived).toEqual([])
		expect(result.proof).toBeUndefined()
	})

	it('a forward self-loop converges immediately via dedup', () => {
		const definition = inferentialDefinition(
			'self-loop',
			'Self-loop',
			[fact('f1', 'num', ['a'])],
			[inference('i1', [fact('p1', 'num', ['?x'])], fact('c1', 'num', ['?x']))],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toHaveLength(0)
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(true)
		expect(result.success).toBe(true)
	})
})

describe('InferentialReasoner — confidence extremes', () => {
	it('a zero-confidence premise fact yields a zero derived confidence', () => {
		const definition = inferentialDefinition(
			'zero',
			'Zero',
			[fact('f1', 'human', ['s'], 0)],
			[
				inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']), {
					confidence: 0.9,
				}),
			],
		)
		expect(expectInferential(reasoner.reason({}, definition)).derived[0]?.confidence).toBe(0)
	})

	it('an out-of-[0,1] confidence still computes — the product exceeds 1', () => {
		const definition = inferentialDefinition(
			'over',
			'Over',
			[fact('f1', 'human', ['s'], 1.5)],
			[
				inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']), {
					confidence: 2,
				}),
			],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		// validate() would WARN on both weights, but reason() never validates — 1.5 × 2 = 3.
		expect(result.success).toBe(true)
		expect(result.derived[0]?.confidence).toBe(3)
	})

	it('a -0 confidence propagates as -0 (signed-zero preserved through roundTo)', () => {
		const definition = inferentialDefinition(
			'neg-zero',
			'Neg-zero',
			[fact('f1', 'human', ['s'], -0)],
			[inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']))],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(Object.is(result.derived[0]?.confidence, -0)).toBe(true)
	})

	it('roundTo(4) truncates a long product to four decimal places', () => {
		const definition = inferentialDefinition(
			'trunc',
			'Trunc',
			[fact('f1', 'human', ['s'], 0.3333)],
			[
				inference('i1', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']), {
					confidence: 0.3333,
				}),
			],
		)
		// 0.3333 × 0.3333 = 0.11108889 → rounded to 0.1111.
		expect(expectInferential(reasoner.reason({}, definition)).derived[0]?.confidence).toBe(0.1111)
	})

	it('a multiplicative chain underflows to 0 through the roundTo(4) truncation', () => {
		const definition = inferentialDefinition(
			'underflow',
			'Underflow',
			[fact('f0', 'p0', ['x'])],
			[
				inference('i1', [fact('a1', 'p0', ['?a'])], fact('b1', 'p1', ['?a']), { confidence: 0.1 }),
				inference('i2', [fact('a2', 'p1', ['?a'])], fact('b2', 'p2', ['?a']), { confidence: 0.1 }),
				inference('i3', [fact('a3', 'p2', ['?a'])], fact('b3', 'p3', ['?a']), { confidence: 0.1 }),
				inference('i4', [fact('a4', 'p3', ['?a'])], fact('b4', 'p4', ['?a']), { confidence: 0.1 }),
				inference('i5', [fact('a5', 'p4', ['?a'])], fact('b5', 'p5', ['?a']), { confidence: 0.1 }),
			],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		const confidenceOf = (predicate: string) =>
			result.derived.find((derived) => derived.predicate === predicate)?.confidence
		expect(result.derived).toHaveLength(5)
		expect(confidenceOf('p1')).toBe(0.1)
		expect(confidenceOf('p2')).toBe(0.01)
		expect(confidenceOf('p3')).toBe(0.001)
		expect(confidenceOf('p4')).toBe(0.0001)
		// 0.0001 × 0.1 = 0.00001 → roundTo(4) → 0: the derivation survives at confidence 0.
		expect(confidenceOf('p5')).toBe(0)
	})
})

describe('InferentialReasoner — dedup quirks', () => {
	it('+0 and -0 terms collapse to a single derivation (SameValueZero), keeping the first', () => {
		const definition = inferentialDefinition(
			'signed-zero',
			'Signed-zero',
			[fact('f1', 'value', [-0]), fact('f2', 'value', [0])],
			[inference('i1', [fact('p1', 'value', ['?x'])], fact('c1', 'marked', ['?x']))],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toHaveLength(1)
		// value(-0) is declared first, so its binding wins the single slot.
		expect(Object.is(result.derived[0]?.terms[0], -0)).toBe(true)
	})

	it('two NaN-termed facts derive once (equalValues treats NaN as self-equal)', () => {
		const definition = inferentialDefinition(
			'nan',
			'NaN',
			[fact('f1', 'value', [Number.NaN]), fact('f2', 'value', [Number.NaN])],
			[inference('i1', [fact('p1', 'value', ['?x'])], fact('c1', 'marked', ['?x']))],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toHaveLength(1)
		expect(Number.isNaN(result.derived[0]?.terms[0])).toBe(true)
	})

	it('object / array terms dedupe by REFERENCE — shared refs collapse, equal values do not', () => {
		const shared = { k: 1 }
		const sameRef = inferentialDefinition(
			'same-ref',
			'Same-ref',
			[fact('f1', 'item', [shared]), fact('f2', 'item', [shared])],
			[inference('i1', [fact('p1', 'item', ['?x'])], fact('c1', 'tagged', ['?x']))],
		)
		// One shared reference → equalValues(shared, shared) is true → one derivation.
		expect(expectInferential(reasoner.reason({}, sameRef)).derived).toHaveLength(1)

		const distinct = inferentialDefinition(
			'distinct-ref',
			'Distinct-ref',
			[fact('f1', 'item', [{ k: 1 }]), fact('f2', 'item', [{ k: 1 }])],
			[inference('i1', [fact('p1', 'item', ['?x'])], fact('c1', 'tagged', ['?x']))],
		)
		// Two structurally-equal but distinct objects → === is false → two derivations.
		expect(expectInferential(reasoner.reason({}, distinct)).derived).toHaveLength(2)

		const array = [1]
		const sharedArray = inferentialDefinition(
			'shared-array',
			'Shared-array',
			[fact('f1', 'item', [array]), fact('f2', 'item', [array])],
			[inference('i1', [fact('p1', 'item', ['?x'])], fact('c1', 'tagged', ['?x']))],
		)
		expect(expectInferential(reasoner.reason({}, sharedArray)).derived).toHaveLength(1)
	})
})

describe('InferentialReasoner — extreme & unicode terms', () => {
	it('adversarial / unicode string terms match and are preserved exactly', () => {
		const definition = inferentialDefinition(
			'tricky',
			'Tricky',
			TRICKY_KEYS.map((key, index) => fact(`f${index}`, 'node', [key])),
			[inference('i1', [fact('p1', 'node', ['?x'])], fact('c1', 'seen', ['?x']))],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		// Every TRICKY_KEYS entry is a distinct string, so each derives its own seen fact.
		expect(result.derived).toHaveLength(TRICKY_KEYS.length)
		const seenTerms = result.derived.map((derived) => derived.terms[0])
		expect(seenTerms).toEqual([...TRICKY_KEYS])
		expect(seenTerms).toContain('\u{1F600}')
		expect(seenTerms).toContain('')
	})

	it('EXTREME_NUMBERS terms derive, with +0 / -0 collapsing to one fewer', () => {
		const definition = inferentialDefinition(
			'extreme',
			'Extreme',
			EXTREME_NUMBERS.map((value, index) => fact(`f${index}`, 'value', [value])),
			[inference('i1', [fact('p1', 'value', ['?x'])], fact('c1', 'big', ['?x']))],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		// EXTREME_NUMBERS holds both +0 and -0; equalValues collapses them, so one fewer.
		expect(result.derived).toHaveLength(EXTREME_NUMBERS.length - 1)
		// The declared-first +0 is kept; the later -0 is deduped away entirely.
		expect(result.derived.some((derived) => Object.is(derived.terms[0], 0))).toBe(true)
		expect(result.derived.some((derived) => Object.is(derived.terms[0], -0))).toBe(false)
		expect(result.derived.some((derived) => derived.terms[0] === Number.MAX_VALUE)).toBe(true)
	})
})

describe('InferentialReasoner — backward ordering & uninstantiated derivations', () => {
	it('returns the FIRST of two independently-provable inferences in declaration order', () => {
		const definition = inferentialDefinition(
			'order',
			'Order',
			[fact('f1', 'p', ['a']), fact('f2', 'q', ['a'])],
			[
				inference('first', [fact('p1', 'p', ['?x'])], fact('c1', 'r', ['?x'])),
				inference('second', [fact('p2', 'q', ['?x'])], fact('c2', 's', ['?x'])),
			],
			{ strategy: 'backward' },
		)
		const result = expectInferential(reasoner.reason({}, definition))
		// Both would prove; declaration order stops the search at the first.
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.predicate).toBe('r')
		expect(result.proof?.inference).toBe('first')
	})

	it('a multi-variable backward conclusion stays uninstantiated (premises proved independently)', () => {
		const definition = inferentialDefinition(
			'relate',
			'Relate',
			[fact('ffoo', 'foo', ['a']), fact('fbar', 'bar', ['b'])],
			[
				inference(
					'rel',
					[fact('p1', 'foo', ['?x']), fact('p2', 'bar', ['?y'])],
					fact('crel', 'relate', ['?x', '?y']),
					{
						confidence: 0.9,
					},
				),
			],
			{ strategy: 'backward', depth: 5 },
		)
		const result = expectInferential(reasoner.reason({}, definition))
		// foo(?x) and bar(?y) each prove from a base fact, but their bindings do NOT flow
		// back into the conclusion — the derived fact keeps both variables.
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.terms).toEqual(['?x', '?y'])
		expect(result.derived[0]?.confidence).toBe(0.9)
		expect(result.proof).toMatchObject({ fact: 'crel', inference: 'rel', depth: 0 })
		expect(result.proof?.children?.[0]).toEqual({ fact: 'ffoo', depth: 1 })
		expect(result.proof?.children?.[1]).toEqual({ fact: 'fbar', depth: 1 })
	})
})

describe('InferentialReasoner — predicate+arity index determinism (before/after pin)', () => {
	// Mixed arities under one shared predicate ("rel" carries both arity-2 and
	// arity-3 facts) — the only case the predicate+arity index change touches.
	// Refining the index key from predicate to predicate+arity only NARROWS each
	// bucket to facts matchFacts would have accepted anyway, so derived[]/trace
	// must stay byte-identical before and after. Pinned from OBSERVED behavior
	// against the pre-change code (indexed by predicate alone).
	function mixedArity() {
		return inferentialDefinition(
			'mixed-arity',
			'Mixed-arity',
			[
				fact('f1', 'rel', ['a', 'b'], 0.9),
				fact('f2', 'rel', ['x', 'y', 'z'], 0.8),
				fact('f3', 'rel', ['b', 'c'], 0.7),
			],
			[
				inference(
					'pair-rule',
					[fact('p1', 'rel', ['?x', '?y'])],
					fact('c1', 'pair', ['?x', '?y']),
					{
						confidence: 0.5,
					},
				),
				inference(
					'triple-rule',
					[fact('p2', 'rel', ['?x', '?y', '?z'])],
					fact('c2', 'triple', ['?x', '?y', '?z']),
					{ confidence: 0.5 },
				),
			],
		)
	}

	const PINNED_DERIVED = [
		{ id: 'c1', predicate: 'pair', terms: ['a', 'b'], confidence: 0.45 },
		{ id: 'c1', predicate: 'pair', terms: ['b', 'c'], confidence: 0.35 },
		{ id: 'c2', predicate: 'triple', terms: ['x', 'y', 'z'], confidence: 0.4 },
	]

	const PINNED_TRACE = [
		'Derived pair(a, b) via "pair-rule" [confidence: 0.45] (iteration 1)',
		'Derived pair(b, c) via "pair-rule" [confidence: 0.35] (iteration 1)',
		'Derived triple(x, y, z) via "triple-rule" [confidence: 0.4] (iteration 1)',
		'Forward chaining converged at iteration 2',
	]

	it('derives the exact pinned facts and trace, byte-identical across two runs', () => {
		const first = expectInferential(reasoner.reason({}, mixedArity()))
		const second = expectInferential(reasoner.reason({}, mixedArity()))
		expect(first).toEqual(second)
		expect(first.derived).toEqual(PINNED_DERIVED)
		expect(first.trace).toEqual(PINNED_TRACE)
		expect(first.success).toBe(true)
	})
})

describe('InferentialReasoner — sparse fact terms (post-fix factToKey)', () => {
	it('forward-chains over a sparse fact without throwing, and dedupes it against its dense twin', () => {
		// [a, hole, c] and ['a', undefined, 'c'] densify to the same key — one known fact.
		const sparseFact = fact(
			'f1',
			'value',
			sparse(3, [
				[0, 'a'],
				[2, 'c'],
			]),
		)
		const denseFact = fact('f2', 'value', ['a', undefined, 'c'])
		const definition = inferentialDefinition(
			'd',
			'd',
			[sparseFact, denseFact],
			[
				inference(
					'i1',
					[fact('p1', 'value', ['?x', '?y', '?z'])],
					fact('c1', 'seen', ['?x', '?y', '?z']),
				),
			],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.terms).toEqual(['a', undefined, 'c'])
	})

	it('a premise variable at a hole position binds to undefined, not a match failure', () => {
		const sparseFact = fact('f1', 'value', sparse(2, [[0, 'a']]))
		const definition = inferentialDefinition(
			'd',
			'd',
			[sparseFact],
			[inference('i1', [fact('p1', 'value', ['?x', '?y'])], fact('c1', 'seen', ['?x', '?y']))],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.terms[0]).toBe('a')
		expect(result.derived[0]?.terms[1]).toBeUndefined()
	})
})

describe('InferentialReasoner — confidence pins', () => {
	it('an inference confidence above 1 produces an unclamped derived confidence above 1', () => {
		const definition = inferentialDefinition(
			'd',
			'd',
			[fact('f1', 'p', ['x'], 1.5)],
			[inference('i1', [fact('p1', 'p', ['?x'])], fact('c1', 'q', ['?x']), { confidence: 2 })],
		)
		const result = expectInferential(reasoner.reason({}, definition))
		// validate() would warn on both weights, but reason() never validates: 1.5 × 2 = 3.
		expect(result.derived[0]?.confidence).toBe(3)
	})

	it('backward chaining does NOT multiply premise confidences — forward and backward diverge', () => {
		const facts = [fact('f1', 'a', ['x'], 0.5)]
		const chain = [
			inference('i1', [fact('p1', 'a', ['?x'])], fact('c1', 'b', ['?x']), { confidence: 0.5 }),
			inference('i2', [fact('p2', 'b', ['?x'])], fact('c2', 'c', ['?x']), { confidence: 0.5 }),
		]
		// Forward: b = 0.5(fact) × 0.5(i1) = 0.25; c = 0.25(b, now known) × 0.5(i2) = 0.125.
		const forward = expectInferential(
			reasoner.reason({}, inferentialDefinition('d', 'd', facts, chain, { depth: 5 })),
		)
		const b = forward.derived.find((derived) => derived.predicate === 'b')
		const c = forward.derived.find((derived) => derived.predicate === 'c')
		expect(b?.confidence).toBe(0.25)
		expect(c?.confidence).toBe(0.125)

		// Backward proves goal "b" via i1 alone; confidence is i1's OWN 0.5 — the
		// 0.5-confidence premise fact never enters the product.
		const backward = expectInferential(
			reasoner.reason(
				{},
				inferentialDefinition('d', 'd', facts, chain, { strategy: 'backward', depth: 5 }),
			),
		)
		expect(backward.derived).toHaveLength(1)
		expect(backward.derived[0]?.predicate).toBe('b')
		expect(backward.derived[0]?.confidence).toBe(0.5)
	})

	it('a 30-step 0.1-confidence chain underflows to exactly 0 and stays there', () => {
		const facts = [fact('f0', 'p0', ['x'])]
		const chain = sequence(30).map((step) =>
			inference(
				`i${step}`,
				[fact(`a${step}`, `p${step}`, ['?a'])],
				fact(`b${step}`, `p${step + 1}`, ['?a']),
				{ confidence: 0.1 },
			),
		)
		const result = expectInferential(
			reasoner.reason({}, inferentialDefinition('d', 'd', facts, chain, { depth: 30 })),
		)
		expect(result.derived).toHaveLength(30)
		const confidenceOf = (predicate: string) =>
			result.derived.find((derived) => derived.predicate === predicate)?.confidence
		// 0.1 → 0.01 → 0.001 → 0.0001 → 0.00001 rounds to 0 at step 5 — and every
		// step after multiplies a 0 confidence, so it stays exactly 0 for the rest.
		expect(confidenceOf('p1')).toBe(0.1)
		expect(confidenceOf('p2')).toBe(0.01)
		expect(confidenceOf('p3')).toBe(0.001)
		expect(confidenceOf('p4')).toBe(0.0001)
		expect(confidenceOf('p5')).toBe(0)
		expect(confidenceOf('p30')).toBe(0)
	})
})

describe('InferentialReasoner — subject injection edge fixtures', () => {
	it('INTEGER_KEY_SUBJECT injects has() facts in Object.keys enumeration order', () => {
		const definition = inferentialDefinition('d', 'd', [], [])
		const result = expectInferential(reasoner.reason(INTEGER_KEY_SUBJECT, definition))
		// Integer-index keys enumerate ascending numerically first ("1", "2", "10"),
		// then the ordinary string keys in insertion order ("zeta", "alpha") — "id"
		// is skipped by subjectToFacts regardless of its enumeration position.
		expect(result.trace).toEqual([
			'Subject field "1" → has(1, 1)',
			'Subject field "2" → has(2, 2)',
			'Subject field "10" → has(10, 10)',
			'Subject field "zeta" → has(zeta, 26)',
			'Subject field "alpha" → has(alpha, 1)',
			'Injected 5 fact(s) from subject',
			'No inference rules defined',
		])
	})

	it('ADVERSARIAL_VALUE_SUBJECT: the symbol key is invisible, bigint/symbol/function kept as terms', () => {
		const definition = inferentialDefinition('d', 'd', [], [])
		const result = expectInferential(reasoner.reason(ADVERSARIAL_VALUE_SUBJECT, definition))
		// id skipped by name; the symbol-keyed property never surfaces via Object.keys —
		// only big / sym / fn become has() facts. typeof bigint/symbol/function is never
		// 'object', so subjectToFacts keeps them rather than skipping them.
		expect(result.trace).toEqual([
			'Subject field "big" → has(big, 9007199254740993)',
			'Subject field "sym" → has(sym, Symbol(value))',
			'Subject field "fn" → has(fn, () => "adversarial")',
			'Injected 3 fact(s) from subject',
			'No inference rules defined',
		])
	})
})

describe('InferentialReasoner — depth-cap-bounded backward proof', () => {
	function chainOf(length: number) {
		return sequence(length).map((step) =>
			inference(
				`i${step}`,
				[fact(`a${step}`, `p${step + 1}`, ['?x'])],
				fact(`c${step}`, `p${step}`, ['?x']),
			),
		)
	}

	it('a 10-level proof chain proves exactly at the default depth cap of 10', () => {
		const definition = inferentialDefinition(
			'chain10',
			'Chain10',
			[fact('fbase', 'p10', ['x'])],
			chainOf(10),
			{ strategy: 'backward', depth: 10 },
		)
		const first = expectInferential(reasoner.reason({}, definition))
		const second = expectInferential(reasoner.reason({}, definition))
		expect(first).toEqual(second)
		expect(first.success).toBe(true)
		expect(first.derived).toHaveLength(1)
		expect(first.derived[0]?.predicate).toBe('p0')
		expect(first.proof?.depth).toBe(0)
		// The leaf base-fact reference lands at exactly depth 10 — the cap boundary.
		let leaf = first.proof
		while (leaf?.children && leaf.children.length > 0) leaf = leaf.children[0]
		expect(leaf).toEqual({ fact: 'fbase', depth: 10 })
	})

	it('an over-cap FIRST candidate is skipped for the next under-cap one, not a total failure', () => {
		// i0's conclusion "p0" needs 11 hops to fbase (p11) — one past the cap — and
		// fails; declaration order moves on to i1's "p1", needing exactly 10 hops,
		// which lands precisely at the cap boundary and succeeds.
		const definition = inferentialDefinition(
			'chain11',
			'Chain11',
			[fact('fbase', 'p11', ['x'])],
			chainOf(11),
			{ strategy: 'backward', depth: 10 },
		)
		const first = expectInferential(reasoner.reason({}, definition))
		const second = expectInferential(reasoner.reason({}, definition))
		expect(first).toEqual(second)
		expect(first.success).toBe(true)
		expect(first.derived).toHaveLength(1)
		expect(first.derived[0]?.predicate).toBe('p1')
		expect(first.proof?.inference).toBe('i1')
	})
})

describe('InferentialReasoner — sparse array positions are hole-tolerant', () => {
	it('a sparse facts list derives from only the present facts — holes are skipped', () => {
		const facts = sparse(3, [
			[0, fact('f1', 'p', ['a'])],
			[2, fact('f2', 'p', ['b'])],
		])
		const definition = {
			reasoning: 'inferential' as const,
			id: 'd',
			name: 'd',
			facts,
			inferences: [inference('i1', [fact('p1', 'p', ['?x'])], fact('c1', 'q', ['?x']))],
		}
		const result = expectInferential(
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [{}, definition]),
		)
		expect(result.success).toBe(true)
		expect(result.errors).toEqual([])
		expect(result.derived).toEqual([
			{ id: 'c1', predicate: 'q', terms: ['a'], confidence: 1 },
			{ id: 'c1', predicate: 'q', terms: ['b'], confidence: 1 },
		])
	})

	it('a sparse inferences list derives from only the present inferences — holes are skipped', () => {
		const inferences = sparse(2, [
			[1, inference('i1', [fact('p1', 'p', ['?x'])], fact('c1', 'q', ['?x']))],
		])
		const definition = {
			reasoning: 'inferential' as const,
			id: 'd',
			name: 'd',
			facts: [fact('f1', 'p', ['a'])],
			inferences,
		}
		const result = expectInferential(
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [{}, definition]),
		)
		expect(result.success).toBe(true)
		expect(result.errors).toEqual([])
		expect(result.derived).toEqual([{ id: 'c1', predicate: 'q', terms: ['a'], confidence: 1 }])
	})
})

describe('InferentialReasoner — builder build() output passed to supports/validate/reason (§15)', () => {
	const definition = mortality()

	it('a built definition + built subject behave identically to the same data written inline (run twice)', () => {
		const builtDefinition = createDefinitionBuilder(definition).build()
		const builtSubject = createSubjectBuilder({ id: 's1' }).build()

		expect(reasoner.supports(builtDefinition)).toBe(reasoner.supports(definition))
		expect(reasoner.validate(builtDefinition)).toEqual(reasoner.validate(definition))

		const plainResult = reasoner.reason({}, definition)
		const builtResult = reasoner.reason(builtSubject, builtDefinition)
		expect(builtResult).toEqual(plainResult)
		// Run twice — determinism.
		expect(reasoner.reason(builtSubject, builtDefinition)).toEqual(builtResult)
	})

	it('a mixed batch of plain and built subject payloads mapped through reason() individually produces equal-length, positionally correct results', () => {
		const builtDefinition = createDefinitionBuilder(definition).build()
		const builtSubject = createSubjectBuilder({ id: 's2' }).build()
		const subjects = [{}, builtSubject]
		const results = subjects.map((subject) => reasoner.reason(subject, builtDefinition))
		const expected = [reasoner.reason({}, definition), reasoner.reason(builtSubject, definition)]
		expect(results).toEqual(expected)
	})
})
