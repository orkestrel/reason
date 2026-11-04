import {
	logicalReasoner as reasoner,
	createDerivationRule as derivationRule,
	createCompoundDefinition,
	runAtDepth,
	computeBackwardConclusion,
	buildBackwardChain,
	readRuleApplied,
	computeDepthBoundary,
	evaluateDeepCompound,
	reasonRules,
	readRuleErrors,
	createFlagAtom,
	createFlagRule,
	createNegatedFlag,
	createScriptedEvaluator,
	createShapedDefinition,
	SILENT_EVALUATOR,
	THROWING_EVALUATOR,
	EXTREME_NUMBERS,
	expectLogical,
	readAnswerLines,
	GENERATED_SUBJECTS,
	generateRuleSet,
	pickOne,
	sequence,
	sparse,
	TRICKY_KEYS,
} from '../../../setup.js'
import type { Expression, ReasonResult, ReasonValidationResult, Rule } from '@src/core'
import {
	booleanShape,
	jsonShape,
	literalShape,
	numberShape,
	objectShape,
	stringShape,
} from '@orkestrel/contract'
import {
	createAtom,
	createCompound,
	createDefinitionBuilder,
	createLogicalDefinition,
	createLogicalReasoner,
	createQuantitativeDefinition,
	createRule,
	createSubjectBuilder,
	isReasonError,
	LogicalReasoner,
} from '@src/core'
import { seededRandom } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import { captureError, invokeUnchecked, requireValue } from '@orkestrel/test'

// `LogicalReasoner` behavior — forward chaining as a fixpoint (derived
// conclusion atoms overlay the subject on later passes, convergence traced,
// depth-cap truncation and the depth-0 no-iteration edge, ascending priority
// order incl. negative priorities, `count` = fired rules, disabled rules
// omitted from the results entirely, SameValueZero bookkeeping so a NaN
// conclusion converges), backward chaining as goal-driven sub-goal search
// (cycle-safe through the visited set, exact backward trace formats, vacuous
// empty-premises rules vs errored missing-premises rules), eager compound
// evaluation (and / or / not / implies / xor with their vacuous edges), the
// duplicate-id runtime quirks validate() now warns about, and the
// MISMATCH-throw vs malformed-shape-failure-result distinction, plus the
// formatField derived-overlay pin: an ARRAY-path
// conclusion derives the dot-joined flat key, which a dotted-STRING premise
// (one key) then reads.

// One rule: `field === value` concludes `derived === true` (overrides merged).

describe('LogicalReasoner — identity', () => {
	it('defaults its id to "logical" and reports its reasoning', () => {
		expect(reasoner.id).toBe('logical')
		expect(reasoner.reasoning).toBe('logical')
		expect(new LogicalReasoner().id).toBe('logical')
	})

	it('takes a custom id through the options object', () => {
		expect(new LogicalReasoner({ id: 'custom' }).id).toBe('custom')
	})
})

describe('LogicalReasoner — supports', () => {
	it('supports logical definitions only', () => {
		expect(reasoner.supports(createLogicalDefinition('d', 'd', []))).toBe(true)
		expect(reasoner.supports(createQuantitativeDefinition('d', 'd', []))).toBe(false)
	})
})

describe('LogicalReasoner — validate', () => {
	it('accepts a well-formed rule set', () => {
		const validation = reasoner.validate(
			createLogicalDefinition('d', 'd', [derivationRule('r1', 'a', true, 'b')]),
		)
		expect(validation.valid).toBe(true)
		expect(validation.errors).toEqual([])
	})

	it('rejects the wrong reasoning with the renamed message', () => {
		const validation = reasoner.validate(createQuantitativeDefinition('d', 'd', []))
		expect(validation.errors[0]).toBe('Expected reasoning "logical", got "quantitative"')
	})

	it('demands an id, a name, and at least one rule', () => {
		const validation = reasoner.validate(createLogicalDefinition('', '', []))
		expect(validation.errors).toContain('Definition must have an id')
		expect(validation.errors).toContain('Definition must have a name')
		expect(validation.errors).toContain('Definition must have at least one rule')
	})

	it('a premise-less rule and a conclusion-less rule are both ERRORS', () => {
		const premiseless = reasoner.validate(
			createLogicalDefinition('d', 'd', [createRule('r1', [], createAtom('x', 'equals', 1))]),
		)
		expect(premiseless.valid).toBe(false)
		expect(premiseless.errors).toContain('Rule "r1" has no premises')

		const errored = invokeUnchecked<ReasonValidationResult>(reasoner, reasoner.validate, [
			{
				reasoning: 'logical',
				id: 'd',
				name: 'd',
				strategy: 'forward',
				rules: [{ id: 'r1', name: 'r1', premises: [createAtom('a', 'equals', 1)] }],
			},
		])
		expect(errored.valid).toBe(false)
		expect(errored.errors).toEqual([
			'Definition does not match the logical definition shape',
			'Rule at index 0 is malformed',
		])
	})

	it('duplicate rule ids are an ERROR, once per duplicated id', () => {
		const validation = reasoner.validate(
			createLogicalDefinition('d', 'd', [
				derivationRule('dup', 'a', true, 'x'),
				derivationRule('dup', 'b', true, 'y'),
				derivationRule('dup', 'c', true, 'z'),
			]),
		)
		expect(validation.valid).toBe(false)
		expect(validation.errors.filter((error) => error === 'Duplicate rule id "dup"')).toHaveLength(1)
	})

	it('an array-path conclusion read through an array-path premise is valid', () => {
		const footgun = createLogicalDefinition('d', 'd', [
			createRule(
				'a',
				[createAtom('go', 'equals', true)],
				createAtom(['address', 'city'], 'equals', 'NYC'),
			),
			createRule(
				'b',
				[createAtom(['address', 'city'], 'equals', 'NYC')],
				createAtom('eligible', 'equals', true),
			),
		])
		// The engine resolves the key by `formatField` on both sides, so it reads this correctly.
		expect(reasoner.validate(footgun)).toEqual({ valid: true, errors: [], warnings: [] })
	})

	it('stays silent on the overlay mismatch for a clean (dotted-string-read) definition', () => {
		const clean = createLogicalDefinition('d', 'd', [
			createRule(
				'a',
				[createAtom('go', 'equals', true)],
				createAtom(['address', 'city'], 'equals', 'NYC'),
			),
			createRule(
				'b',
				[createAtom('address.city', 'equals', 'NYC')],
				createAtom('eligible', 'equals', true),
			),
		])
		expect(reasoner.validate(clean)).toEqual({ valid: true, errors: [], warnings: [] })
	})

	it('an empty-premises error does not read as an overlay mismatch', () => {
		const definition = createLogicalDefinition('d', 'd', [
			createRule('r1', [], createAtom('x', 'equals', 1)),
			derivationRule('r2', 'a', true, 'b'),
		])
		expect(reasoner.validate(definition).errors).toEqual(['Rule "r1" has no premises'])
	})

	it('a duplicate id stands alone beside a key read through an array path', () => {
		const definition = createLogicalDefinition('d', 'd', [
			createRule('dup', [createAtom('go', 'equals', true)], createAtom(['x', 'y'], 'equals', 1)),
			createRule(
				'dup',
				[createAtom(['x', 'y'], 'equals', 1)],
				createAtom('eligible', 'equals', true),
			),
		])
		expect(reasoner.validate(definition).errors).toEqual(['Duplicate rule id "dup"'])
	})
})

describe('LogicalReasoner — forward chaining', () => {
	it('a met premise fires the rule; an unmet one does not', () => {
		const definition = createLogicalDefinition('d', 'd', [
			derivationRule('activate', 'active', true, 'result'),
		])
		const met = expectLogical(reasoner.reason({ active: true }, definition))
		expect(met.reasoning).toBe('logical')
		expect(met.success).toBe(true)
		expect(met.conclusion).toBe('met')
		expect(met.count).toBe(1)

		const unmet = expectLogical(reasoner.reason({ active: false }, definition))
		expect(unmet.conclusion).toBe('unmet')
		expect(unmet.count).toBe(0)
	})

	it('counts every fired rule', () => {
		const definition = createLogicalDefinition('d', 'd', [
			derivationRule('r1', 'a', true, 'x'),
			derivationRule('r2', 'b', true, 'y'),
		])
		expect(expectLogical(reasoner.reason({ a: true, b: true }, definition)).count).toBe(2)
	})

	it('derived conclusions become facts for later passes (multi-iteration chaining)', () => {
		const definition = createLogicalDefinition('d', 'd', [
			createRule(
				'income',
				[createAtom('annualIncome', 'from', 50000)],
				createAtom('incomeOk', 'equals', true),
			),
			createRule(
				'credit',
				[createAtom('creditScore', 'from', 700)],
				createAtom('creditOk', 'equals', true),
			),
			createRule(
				'approve',
				[createAtom('incomeOk', 'equals', true), createAtom('creditOk', 'equals', true)],
				createAtom('approved', 'equals', true),
			),
		])
		const result = expectLogical(
			reasoner.reason({ annualIncome: 75000, creditScore: 720 }, definition),
		)
		expect(result.conclusion).toBe('met')
		expect(result.count).toBe(3)
	})

	it('chains a three-hop derivation a → b → c → d', () => {
		const definition = createLogicalDefinition('d', 'd', [
			derivationRule('ra', 'a', true, 'b'),
			derivationRule('rb', 'b', true, 'c'),
			derivationRule('rc', 'c', true, 'd'),
		])
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.conclusion).toBe('met')
		expect(result.count).toBe(3)
	})

	it('hitting the depth cap REFUSES, because an unfinished derivation is no answer', () => {
		// The overlay snapshots per iteration, so depth 1 derives ONLY b; the final
		// re-evaluation then sees {a, b} — ra and rb fire, rc (needing c) reads unread.
		const definition = createLogicalDefinition(
			'd',
			'd',
			[
				derivationRule('ra', 'a', true, 'b'),
				derivationRule('rb', 'b', true, 'c'),
				derivationRule('rc', 'c', true, 'd'),
			],
			{ depth: 1 },
		)
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.trace).toEqual(['Rule "ra" derived: b=true (iteration 1)'])
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(false)
		expect(result.count).toBe(2)
		expect(result.conclusion).toBe('unread')
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Forward chaining did not settle within depth 1'])
	})

	it('depth 0 derives nothing, so anything left to derive refuses', () => {
		const chain = createLogicalDefinition(
			'd',
			'd',
			[
				derivationRule('ra', 'a', true, 'b'),
				derivationRule('rb', 'b', true, 'c'),
				derivationRule('rc', 'c', true, 'd'),
			],
			{ depth: 0 },
		)
		const truncated = expectLogical(reasoner.reason({ a: true }, chain))
		expect(truncated.trace).toEqual([])
		expect(truncated.count).toBe(1)
		expect(truncated.conclusion).toBe('unread')
		expect(truncated.errors).toEqual(['Forward chaining did not settle within depth 0'])

		// A directly-satisfied rule still reads met, and its unwritten conclusion still refuses.
		const direct = createLogicalDefinition('d', 'd', [derivationRule('ra', 'a', true, 'b')], {
			depth: 0,
		})
		const satisfied = expectLogical(reasoner.reason({ a: true }, direct))
		expect(satisfied.trace).toEqual([])
		expect(satisfied.count).toBe(1)
		expect(satisfied.conclusion).toBe('unread')
		expect(satisfied.rules[0]?.state).toBe('met')
	})

	it('a NaN-valued conclusion derives ONCE and the fixpoint converges (SameValueZero)', () => {
		const definition = createLogicalDefinition('d', 'd', [
			createRule('rn', [createAtom('x', 'equals', true)], createAtom('n', 'equals', Number.NaN)),
		])
		const result = expectLogical(reasoner.reason({ x: true }, definition))
		const derivations = result.trace.filter((entry) => entry.includes('derived: n=NaN'))
		expect(derivations).toHaveLength(1)
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(true)
		expect(result.success).toBe(true)
	})

	it('multiple premises on one rule are AND-ed', () => {
		const definition = createLogicalDefinition('d', 'd', [
			createRule(
				'both',
				[createAtom('a', 'equals', true), createAtom('b', 'equals', true)],
				createAtom('ok', 'equals', true),
			),
		])
		const result = expectLogical(reasoner.reason({ a: true, b: false }, definition))
		expect(result.conclusion).toBe('unmet')
		expect(result.count).toBe(0)
	})

	it('an ARRAY-path conclusion derives the dot-joined key a dotted-STRING premise reads', () => {
		const definition = createLogicalDefinition('d', 'd', [
			createRule(
				'flag',
				[createAtom('go', 'equals', true)],
				createAtom(['flags', 'ok'], 'equals', true),
			),
			createRule(
				'done',
				[createAtom('flags.ok', 'equals', true)],
				createAtom('done', 'equals', true),
			),
		])
		const result = expectLogical(reasoner.reason({ go: true }, definition))
		expect(result.conclusion).toBe('met')
		expect(result.count).toBe(2)
		expect(result.trace).toContain('Rule "flag" derived: flags.ok=true (iteration 1)')
	})

	it('disabled rules are excluded from the results ENTIRELY (not just unapplied)', () => {
		const definition = createLogicalDefinition('d', 'd', [
			createRule('off', [createAtom('a', 'equals', true)], createAtom('b', 'equals', true), {
				enabled: false,
			}),
		])
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.rules).toHaveLength(0)
		expect(result.conclusion).toBe('unmet')
		expect(result.trace).toContain('Skipped rule "off" (disabled)')
	})

	it('traces convergence — after firing once and when nothing fires at all', () => {
		const oneRule = createLogicalDefinition('d', 'd', [derivationRule('r1', 'a', true, 'b')])
		const firing = expectLogical(reasoner.reason({ a: true }, oneRule))
		expect(firing.trace.some((entry) => entry.includes('converged'))).toBe(true)

		const idle = expectLogical(reasoner.reason({}, oneRule))
		expect(idle.count).toBe(0)
		expect(idle.trace.some((entry) => entry.includes('converged'))).toBe(true)
	})

	it('exposes the rule-result shape (id / state / premises / checks) and no boolean twin', () => {
		const definition = createLogicalDefinition('d', 'd', [derivationRule('r1', 'a', true, 'b')])
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.rules).toHaveLength(1)
		expect(result.rules[0]).toEqual({
			id: 'r1',
			state: 'met',
			premises: ['met'],
			checks: [{ field: 'a', state: 'met', actual: true }],
		})
		expect(Object.hasOwn(requireValue(result.rules[0], 'missing rule result'), 'conclusion')).toBe(
			false,
		)
	})

	it('runs rules in ascending priority order — lower number first (trace-observable)', () => {
		const definition = createLogicalDefinition('d', 'd', [
			createRule('r-low', [createAtom('x', 'equals', true)], createAtom('low', 'equals', true), {
				priority: 10,
			}),
			createRule('r-high', [createAtom('x', 'equals', true)], createAtom('high', 'equals', true), {
				priority: 1,
			}),
		])
		const result = expectLogical(reasoner.reason({ x: true }, definition))
		expect(result.count).toBe(2)
		const highAt = result.trace.findIndex((entry) => entry.includes('"r-high"'))
		const lowAt = result.trace.findIndex((entry) => entry.includes('"r-low"'))
		expect(highAt).toBeGreaterThanOrEqual(0)
		expect(highAt).toBeLessThan(lowAt)
	})

	it('a NEGATIVE priority sorts before the default-0 rule', () => {
		const definition = createLogicalDefinition('d', 'd', [
			derivationRule('r-default', 'x', true, 'a'),
			derivationRule('r-negative', 'x', true, 'b', { priority: -5 }),
		])
		const result = expectLogical(reasoner.reason({ x: true }, definition))
		const negativeAt = result.trace.findIndex((entry) => entry.includes('"r-negative"'))
		const defaultAt = result.trace.findIndex((entry) => entry.includes('"r-default"'))
		expect(negativeAt).toBeGreaterThanOrEqual(0)
		expect(negativeAt).toBeLessThan(defaultAt)
	})

	it('an empty rule set traces "No rules defined" and concludes false', () => {
		const result = expectLogical(reasoner.reason({}, createLogicalDefinition('d', 'd', [])))
		expect(result.trace).toContain('No rules defined')
		expect(result.conclusion).toBe('unmet')
		expect(result.success).toBe(true)
	})
})

describe('LogicalReasoner — compound operators (eager evaluation)', () => {
	// One rule whose single premise is the given compound; conclusion `ok`.

	it('and / or resolve over their operands', () => {
		const both = createCompoundDefinition(
			createCompound('and', [createAtom('a', 'equals', true), createAtom('b', 'equals', true)]),
		)
		expect(expectLogical(reasoner.reason({ a: true, b: true }, both)).conclusion).toBe('met')
		expect(expectLogical(reasoner.reason({ a: true, b: false }, both)).conclusion).toBe('unmet')

		const either = createCompoundDefinition(
			createCompound('or', [createAtom('a', 'equals', true), createAtom('b', 'equals', true)]),
		)
		expect(expectLogical(reasoner.reason({ a: false, b: true }, either)).conclusion).toBe('met')
		expect(expectLogical(reasoner.reason({ a: false, b: false }, either)).conclusion).toBe('unmet')
	})

	it('not negates its operand — and reads unread on any other arity', () => {
		const negated = createCompoundDefinition(
			createCompound('not', [createAtom('a', 'equals', true)]),
		)
		expect(expectLogical(reasoner.reason({ a: false }, negated)).conclusion).toBe('met')
		expect(expectLogical(reasoner.reason({ a: true }, negated)).conclusion).toBe('unmet')

		const empty = createCompoundDefinition(createCompound('not', []))
		expect(expectLogical(reasoner.reason({}, empty)).conclusion).toBe('unread')
		const pair = createCompoundDefinition(
			createCompound('not', [createAtom('a', 'equals', true), createAtom('b', 'equals', true)]),
		)
		expect(expectLogical(reasoner.reason({ a: false, b: true }, pair)).conclusion).toBe('unread')
	})

	it('implies follows the material-implication truth table (vacuous truth included)', () => {
		const implication = createCompoundDefinition(
			createCompound('implies', [createAtom('p', 'equals', true), createAtom('q', 'equals', true)]),
		)
		expect(expectLogical(reasoner.reason({ p: true, q: true }, implication)).conclusion).toBe('met')
		expect(expectLogical(reasoner.reason({ p: false, q: false }, implication)).conclusion).toBe(
			'met',
		)
		expect(expectLogical(reasoner.reason({ p: true, q: false }, implication)).conclusion).toBe(
			'unmet',
		)
	})

	it('xor follows the full exclusive-or truth table', () => {
		const exclusive = createCompoundDefinition(
			createCompound('xor', [createAtom('p', 'equals', true), createAtom('q', 'equals', true)]),
		)
		expect(expectLogical(reasoner.reason({ p: true, q: false }, exclusive)).conclusion).toBe('met')
		expect(expectLogical(reasoner.reason({ p: false, q: true }, exclusive)).conclusion).toBe('met')
		expect(expectLogical(reasoner.reason({ p: true, q: true }, exclusive)).conclusion).toBe('unmet')
		expect(expectLogical(reasoner.reason({ p: false, q: false }, exclusive)).conclusion).toBe(
			'unmet',
		)
	})

	it('evaluates deeply nested compounds', () => {
		const nested = createCompoundDefinition(
			createCompound('and', [
				createCompound('or', [createAtom('a', 'equals', true), createAtom('b', 'equals', true)]),
				createCompound('not', [createAtom('c', 'equals', true)]),
			]),
		)
		expect(expectLogical(reasoner.reason({ a: true, b: false, c: false }, nested)).conclusion).toBe(
			'met',
		)
		expect(
			expectLogical(reasoner.reason({ a: false, b: false, c: false }, nested)).conclusion,
		).toBe('unmet')
	})
})

describe('LogicalReasoner — backward chaining', () => {
	it('proves a goal whose premise the subject satisfies', () => {
		const definition = createLogicalDefinition(
			'd',
			'd',
			[
				createRule(
					'adult',
					[createAtom('age', 'equals', 25)],
					createAtom('isAdult', 'equals', true),
				),
			],
			{ strategy: 'backward' },
		)
		expect(expectLogical(reasoner.reason({ age: 25 }, definition)).conclusion).toBe('met')
		expect(expectLogical(reasoner.reason({ age: 30 }, definition)).conclusion).toBe('unmet')
	})

	it('proves multiple independent rules', () => {
		const definition = createLogicalDefinition(
			'd',
			'd',
			[
				derivationRule('r1', 'a', true, 'x'),
				derivationRule('r2', 'b', true, 'y'),
				derivationRule('r3', 'c', true, 'z'),
			],
			{ strategy: 'backward' },
		)
		const result = expectLogical(reasoner.reason({ a: true, b: true, c: true }, definition))
		expect(result.conclusion).toBe('met')
		expect(result.count).toBe(3)
	})

	it('chains a three-hop backward derivation from a single base fact', () => {
		const definition = createLogicalDefinition(
			'd',
			'd',
			[
				derivationRule('ra', 'a', true, 'b'),
				derivationRule('rb', 'b', true, 'c'),
				derivationRule('rc', 'c', true, 'd'),
			],
			{ strategy: 'backward' },
		)
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.conclusion).toBe('met')
		expect(result.count).toBe(3)
	})

	it('recursively proves sub-goals through rules declared AFTER the goal', () => {
		// rc needs b, which only rb can derive — goal-driven search finds it.
		const definition = createLogicalDefinition(
			'd',
			'd',
			[derivationRule('rc', 'b', true, 'c'), derivationRule('rb', 'a', true, 'b')],
			{ strategy: 'backward' },
		)
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.conclusion).toBe('met')
		expect(result.count).toBe(2)
	})

	it('skips disabled rules (one result of two)', () => {
		const definition = createLogicalDefinition(
			'd',
			'd',
			[
				derivationRule('on', 'a', true, 'x'),
				derivationRule('off', 'a', true, 'y', { enabled: false }),
			],
			{ strategy: 'backward' },
		)
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.rules).toHaveLength(1)
		expect(result.trace).toContain('Skipped rule "off" (disabled)')
	})

	it('handles compound premises backward', () => {
		const definition = createLogicalDefinition(
			'd',
			'd',
			[
				createRule(
					'r1',
					[
						createCompound('and', [
							createAtom('a', 'equals', true),
							createCompound('or', [
								createAtom('b', 'equals', true),
								createAtom('c', 'equals', true),
							]),
						]),
					],
					createAtom('ok', 'equals', true),
				),
			],
			{ strategy: 'backward' },
		)
		expect(
			expectLogical(reasoner.reason({ a: true, b: false, c: true }, definition)).conclusion,
		).toBe('met')
		expect(
			expectLogical(reasoner.reason({ a: true, b: false, c: false }, definition)).conclusion,
		).toBe('unmet')
	})

	it('is CYCLE-SAFE — mutually recursive rules terminate', () => {
		const definition = createLogicalDefinition(
			'd',
			'd',
			[derivationRule('ra', 'a', true, 'b'), derivationRule('rb', 'b', true, 'a')],
			{ strategy: 'backward' },
		)
		const result = expectLogical(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.conclusion).toBe('unmet')
	})

	it('traces each proof as an attempt, and each derivation the answer made', () => {
		const definition = createLogicalDefinition(
			'd',
			'd',
			[derivationRule('r1', 'a', true, 'b'), derivationRule('r2', 'z', true, 'y')],
			{ strategy: 'backward' },
		)
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.trace).toContain('Proof: rule "r1" established (depth 0)')
		expect(result.trace).toContain('Proof: rule "r2" not established (depth 0)')
		expect(result.trace).toContain('Rule "r1" derived: b=true (iteration 1)')
		expect(result.trace).toContain('Backward chaining converged at iteration 2')
	})

	it('an EMPTY-premises rule fires VACUOUSLY backward (forward reports it instead)', () => {
		const definition = createLogicalDefinition(
			'd',
			'd',
			[createRule('vac', [], createAtom('v', 'equals', true))],
			{
				strategy: 'backward',
			},
		)
		const result = expectLogical(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Rule "vac" has no premises'])
		expect(result.conclusion).toBe('unread')
		expect(result.rules).toEqual([])
	})

	it('a MISSING-premises rule errors and is excluded backward (graceful, no crash)', () => {
		const result = expectLogical(
			invokeUnchecked<ReasonResult>(reasoner, reasoner.reason, [
				{ a: true },
				{
					reasoning: 'logical',
					id: 'd',
					name: 'd',
					strategy: 'backward',
					rules: [
						{ id: 'r1', name: 'r1', conclusion: createAtom('x', 'equals', true) },
						createRule('ok', [createAtom('a', 'equals', true)], createAtom('b', 'equals', true)),
					],
				},
			]),
		)
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Rule "r1" has no premises'])
		// The valid sibling still proves; the malformed rule is absent from results.
		expect(result.rules.map((entry) => entry.id)).toEqual(['ok'])
		expect(result.count).toBe(1)
	})
})

describe('LogicalReasoner — degenerate rules & malformed shapes', () => {
	it('a premise-less rule errors once and is excluded (forward)', () => {
		const definition = createLogicalDefinition('d', 'd', [
			createRule('r1', [], createAtom('x', 'equals', true)),
		])
		const result = expectLogical(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Rule "r1" has no premises')
		expect(result.rules).toHaveLength(0)
	})

	it('duplicate ids: a degenerate rule refuses the run and leaves its valid twin standing', () => {
		const definition = createLogicalDefinition('d', 'd', [
			createRule('dup', [], createAtom('x', 'equals', true)),
			derivationRule('dup', 'a', true, 'b'),
		])
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.rules.map((entry) => entry.state)).toEqual(['met'])
		expect(result.count).toBe(1)
		expect(result.errors).toEqual(['Rule "dup" has no premises'])
	})

	it('a conclusion-less rule errors and is excluded (forward and backward)', () => {
		const malformed = {
			reasoning: 'logical',
			id: 'd',
			name: 'd',
			rules: [{ id: 'r1', name: 'r1', premises: [createAtom('a', 'equals', true)] }],
		}
		const forward = expectLogical(
			invokeUnchecked<ReasonResult>(reasoner, reasoner.reason, [
				{ a: true },
				{ ...malformed, strategy: 'forward' },
			]),
		)
		expect(forward.errors).toContain('Rule "r1" has no conclusion')

		const backward = expectLogical(
			invokeUnchecked<ReasonResult>(reasoner, reasoner.reason, [
				{ a: true },
				{ ...malformed, strategy: 'backward' },
			]),
		)
		expect(backward.errors).toContain('Rule "r1" has no conclusion')
	})

	it('MISMATCH: the wrong reasoning THROWS a coded ReasonError with context', () => {
		const error = captureError(() =>
			reasoner.reason({}, createQuantitativeDefinition('other', 'Other', [])),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')
		expect(error.message).toBe('Expected logical definition, got "quantitative"')
		expect(error.context).toEqual({ definition: 'other', reasoning: 'logical' })
	})

	it('a malformed shape (missing rules) is a FAILURE RESULT, not a throw', () => {
		const result = expectLogical(
			invokeUnchecked<ReasonResult>(reasoner, reasoner.reason, [
				{},
				{ reasoning: 'logical', id: 'd', name: 'd', strategy: 'forward' },
			]),
		)
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Definition must have a "rules" array'])
	})
})

describe('LogicalReasoner — forward depth-boundary sweep (6-hop chain)', () => {
	// k0 → k1 → … → k6: one derivation hop per iteration, so N hops need N iterations.

	it('depth N-2 (4) refuses, with k5 and k6 unreached', () => {
		const result = runAtDepth(4)
		expect(result.trace).toContain('Rule "r4" derived: k4=true (iteration 4)')
		expect(result.trace.some((entry) => entry.includes('k5=true'))).toBe(false)
		expect(result.trace.some((entry) => entry.includes('k6='))).toBe(false)
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(false)
		// Final overlay {k0..k4} fires r1..r5; r6 (needs k5) reads unread.
		expect(result.count).toBe(5)
		expect(result.conclusion).toBe('unread')
		expect(result.errors).toEqual(['Forward chaining did not settle within depth 4'])
	})

	it('depth N-1 (5) refuses: r6 reads met off k5, but k6 was never derived', () => {
		const result = runAtDepth(5)
		expect(result.trace).toContain('Rule "r5" derived: k5=true (iteration 5)')
		// The overlay stops at k5 — k6 is never derived as a fact…
		expect(result.trace.some((entry) => entry.includes('k6='))).toBe(false)
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(false)
		// …so although the final evaluation reads k5 and r6 reads met, the run has not settled.
		expect(result.count).toBe(6)
		expect(result.conclusion).toBe('unread')
		expect(result.errors).toEqual(['Forward chaining did not settle within depth 5'])
	})

	it('depth exactly N (6) derives the full chain and settles, since observing that costs no depth', () => {
		const result = runAtDepth(6)
		expect(result.trace).toContain('Rule "r6" derived: k6=true (iteration 6)')
		expect(result.trace).toContain('Forward chaining converged at iteration 7')
		expect(result.success).toBe(true)
		expect(result.count).toBe(6)
		expect(result.conclusion).toBe('met')
	})

	it('depth much larger than needed (50) converges EARLY at iteration 7', () => {
		const result = runAtDepth(50)
		expect(result.trace).toContain('Rule "r6" derived: k6=true (iteration 6)')
		expect(result.trace).toContain('Forward chaining converged at iteration 7')
		expect(result.count).toBe(6)
		expect(result.conclusion).toBe('met')
	})
})

describe('LogicalReasoner — two rules concluding different values', () => {
	it('refuses in the first pass rather than oscillating until the depth cap', () => {
		// setX1/setX2 fire in one pass, each asserting its own `x`: nothing can settle that.
		const oscillating = createLogicalDefinition(
			'd',
			'd',
			[
				createRule('setX1', [createAtom('flag', 'equals', true)], createAtom('x', 'equals', 1)),
				createRule('setX2', [createAtom('flag', 'equals', true)], createAtom('x', 'equals', 2)),
			],
			{ depth: 50 },
		)
		const result = expectLogical(reasoner.reason({ flag: true }, oscillating))
		expect(result.trace.filter((entry) => entry.includes('derived: x=')).length).toBe(1)
		expect(result.errors).toEqual(['Rule "setX2" concludes a second value for "x"'])
		expect(result.success).toBe(false)
		expect(result.count).toBe(2)
		expect(result.conclusion).toBe('unread')
	})
})

describe('LogicalReasoner — large fixpoints', () => {
	it('a 100-rule interdependent chain converges at iteration 101 with full count', () => {
		const chain = sequence(100, 1).map((index) =>
			derivationRule(`r${index}`, `k${index - 1}`, true, `k${index}`),
		)
		const result = expectLogical(
			reasoner.reason({ k0: true }, createLogicalDefinition('d', 'd', chain, { depth: 200 })),
		)
		expect(result.trace).toContain('Forward chaining converged at iteration 101')
		expect(result.count).toBe(100)
		expect(result.conclusion).toBe('met')
		expect(result.success).toBe(true)
	})

	it('100 independent rules all fire from the base subject and converge in one hop', () => {
		const wide = sequence(100, 1).map((index) =>
			derivationRule(`w${index}`, 'base', true, `d${index}`),
		)
		const result = expectLogical(
			reasoner.reason({ base: true }, createLogicalDefinition('d', 'd', wide)),
		)
		expect(result.count).toBe(100)
		expect(result.conclusion).toBe('met')
		expect(result.trace).toContain('Forward chaining converged at iteration 2')
	})
})

describe('LogicalReasoner — deep compound nesting', () => {
	// A 500-deep single-operand `and` chain around one atom — the eager evaluator
	// recurses one frame per level and returns (no stack overflow at this depth).
	const deeplyNested = sequence(500).reduce<Expression>(
		(inner) => createCompound('and', [inner]),
		createAtom('deep', 'equals', true),
	)
	const definition = createLogicalDefinition('d', 'd', [
		createRule('nest', [deeplyNested], createAtom('ok', 'equals', true)),
	])

	it('evaluates a 500-deep compound to its innermost atom (true branch)', () => {
		const result = expectLogical(reasoner.reason({ deep: true }, definition))
		expect(result.conclusion).toBe('met')
		expect(result.count).toBe(1)
	})

	it('evaluates a 500-deep compound to its innermost atom (false branch)', () => {
		const result = expectLogical(reasoner.reason({ deep: false }, definition))
		expect(result.conclusion).toBe('unmet')
		expect(result.count).toBe(0)
	})
})

describe('LogicalReasoner — empty premises read alike in both strategies', () => {
	it('the SAME empty-premises rule errors and is excluded forward and backward', () => {
		const emptyRule = createRule('vac', [], createAtom('v', 'equals', true))

		const forward = expectLogical(
			reasoner.reason({}, createLogicalDefinition('d', 'd', [emptyRule])),
		)
		expect(forward.success).toBe(false)
		expect(forward.errors).toEqual(['Rule "vac" has no premises'])
		expect(forward.rules).toEqual([])
		expect(forward.conclusion).toBe('unread')

		const backward = expectLogical(
			reasoner.reason({}, createLogicalDefinition('d', 'd', [emptyRule], { strategy: 'backward' })),
		)
		expect(backward.success).toBe(false)
		expect(backward.errors).toEqual(['Rule "vac" has no premises'])
		expect(backward.conclusion).toBe('unread')
		expect(backward.rules).toEqual([])
	})
})

describe('LogicalReasoner — unicode & adversarial derived keys round-trip', () => {
	// Emoji, combining-sequence, NFC-labile, and DOTTED-string keys (TRICKY_KEYS[6..]) —
	// each concluded by one rule and read by a downstream rule. Object keys are NOT
	// normalized, so the exact string round-trips through the derived overlay.
	it.each([...TRICKY_KEYS.slice(6)])(
		'round-trips the derived key %j through a downstream premise',
		(key) => {
			const definition = createLogicalDefinition('d', 'd', [
				createRule('emit', [createAtom('go', 'equals', true)], createAtom(key, 'equals', true)),
				createRule('read', [createAtom(key, 'equals', true)], createAtom('done', 'equals', true)),
			])
			const result = expectLogical(reasoner.reason({ go: true }, definition))
			expect(result.conclusion).toBe('met')
			expect(result.count).toBe(2)
			expect(result.trace).toContain(`Rule "emit" derived: ${key}=true (iteration 1)`)
		},
	)
})

describe('LogicalReasoner — SameValueZero convergence on signed zero', () => {
	it('deriving +0 then -0 to one key does NOT oscillate — it converges after one set', () => {
		// EXTREME_NUMBERS[0] = +0, [1] = -0. equalValues(+0, -0) is true, so the second
		// rule sees no change and the fixpoint settles (contrast the 1-vs-2 oscillation).
		const definition = createLogicalDefinition('d', 'd', [
			createRule(
				'setZero',
				[createAtom('go', 'equals', true)],
				createAtom('z', 'equals', EXTREME_NUMBERS[0]),
			),
			createRule(
				'setNegZero',
				[createAtom('go', 'equals', true)],
				createAtom('z', 'equals', EXTREME_NUMBERS[1]),
			),
		])
		const result = expectLogical(reasoner.reason({ go: true }, definition))
		expect(result.trace.filter((entry) => entry.includes('derived: z='))).toEqual([
			'Rule "setZero" derived: z=0 (iteration 1)',
		])
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(true)
		expect(result.success).toBe(true)
	})
})

describe('LogicalReasoner — backward long cycle terminates', () => {
	it('a 20-rule cycle with no base facts settles unmet, because nothing derives to count', () => {
		// c_i needs k_{i+1} to conclude k_i, closing k1←k2←…←k20←k1 — unprovable, must not recurse forever.
		const cycle = sequence(20, 1).map((index) => {
			const next = (index % 20) + 1
			return createRule(
				`c${index}`,
				[createAtom(`k${next}`, 'equals', true)],
				createAtom(`k${index}`, 'equals', true),
			)
		})
		const result = expectLogical(
			reasoner.reason(
				{},
				createLogicalDefinition('d', 'd', cycle, { strategy: 'backward', depth: 30 }),
			),
		)
		expect(result.success).toBe(true)
		expect(result.conclusion).toBe('unmet')
		expect(result.count).toBe(0)
		expect(result.faults.map((fault) => fault.path)).toEqual([])

		const capped = expectLogical(
			reasoner.reason({}, createLogicalDefinition('d', 'd', cycle, { strategy: 'backward' })),
		)
		expect(capped.success).toBe(true)
		expect(capped.conclusion).toBe('unmet')
	})
})

describe('LogicalReasoner — priority extremes', () => {
	it('fractional and ±Infinity priorities order forward firing ascending', () => {
		const definition = createLogicalDefinition('d', 'd', [
			derivationRule('rPosInf', 'x', true, 'a', { priority: Number.POSITIVE_INFINITY }),
			derivationRule('rNegInf', 'x', true, 'b', { priority: Number.NEGATIVE_INFINITY }),
			derivationRule('rZero', 'x', true, 'c'),
			derivationRule('rHalf', 'x', true, 'd', { priority: 1.5 }),
			derivationRule('rNegHalf', 'x', true, 'e', { priority: -1.5 }),
			derivationRule('rTwoHalf', 'x', true, 'f', { priority: 2.5 }),
		])
		const result = expectLogical(reasoner.reason({ x: true }, definition))
		const order = ['rNegInf', 'rNegHalf', 'rZero', 'rHalf', 'rTwoHalf', 'rPosInf'].map((id) =>
			result.trace.findIndex((entry) => entry.includes(`"${id}"`)),
		)
		expect(order.every((index) => index >= 0)).toBe(true)
		expect(order).toEqual([...order].sort((left, right) => left - right))
		expect(result.count).toBe(6)
	})

	it('a NaN priority does not drop the rule from the sort — it still fires', () => {
		const definition = createLogicalDefinition('d', 'd', [
			derivationRule('rNaN', 'x', true, 'a', { priority: Number.NaN }),
			derivationRule('rB', 'x', true, 'b'),
			derivationRule('rC', 'x', true, 'c'),
		])
		const result = expectLogical(reasoner.reason({ x: true }, definition))
		expect(result.success).toBe(true)
		expect(result.count).toBe(3)
		expect(result.trace.some((entry) => entry.includes('"rNaN"'))).toBe(true)
	})

	it('the conclusion is the last authored rule under backward, as under forward, whatever the priorities', () => {
		// `provable` holds and `unprovable` does not. Authored order decides, so priority never does.

		// provable first (1.5) → unprovable is last → unmet.
		expect(computeBackwardConclusion(1.5, 2.5)).toBe('unmet')
		// provable last (2.5) → provable is last → met.
		expect(computeBackwardConclusion(2.5, 1.5)).toBe('unmet')
	})
})

describe('LogicalReasoner — backward depth-cap enforcement (sub-goal proving)', () => {
	// A 6-hop chain declared in REVERSE order (r6 first, needing k5, down to r1 needing k0).
	// `depth` counts the passes that derive something, as forward does, so the chain's order
	// decides nothing: only the proofs in the trace stop at the cap, and they answer nothing.

	it('depth 3 is insufficient — the goal (r6, needing 5 hops) refuses', () => {
		const definition = createLogicalDefinition('d', 'd', buildBackwardChain(), {
			strategy: 'backward',
			depth: 3,
		})
		const result = expectLogical(reasoner.reason({ k0: true }, definition))
		expect(result.conclusion).toBe('unread')
		expect(result.success).toBe(false)
		expect(result.errors.length).toBeGreaterThan(0)
		expect(result.errors).toEqual(['Backward chaining did not settle within depth 3'])
		expect(result.trace).toContain('Proof: rule "r6" not established (depth 0)')
		expect(result.trace).toContain('Proof: stopped at "k2", depth 3')
		// r5 is proved once, under r6, so its one line carries the depth that proof reached.
		expect(
			result.trace.filter((entry) => entry.startsWith('Proof: rule "r5" not established')),
		).toHaveLength(1)
	})

	it('the SAME 6-hop chain at a sufficient depth (10, and the default) proves the goal', () => {
		expect(readRuleApplied('r6', 10)).toBe('met')
		expect(readRuleApplied('r6', undefined)).toBe('met')
	})

	it('pins the exact off-by-one boundary — 3 hops settle at depth 3, 4 hops (and beyond) refuse (run twice, deep-equal)', () => {
		const first = computeDepthBoundary()
		const second = computeDepthBoundary()
		expect(first).toEqual(second)
		expect(first).toEqual([true, true, true, false, false, false])
	})
})

describe('LogicalReasoner — sparse compound operands', () => {
	it('a hole is an operand nobody can read, so a sparse "and" refuses', () => {
		// sparse(3, [[1, atom]]) leaves indices 0 and 2 as real holes, which array methods step over.
		const sparseOperands = sparse<Expression>(3, [[1, createAtom('a', 'equals', true)]])
		const definition = createLogicalDefinition('d', 'd', [
			createRule('r1', [createCompound('and', sparseOperands)], createAtom('ok', 'equals', true)),
		])

		for (const a of [true, false]) {
			const result = expectLogical(reasoner.reason({ a }, definition))
			expect(result.conclusion).toBe('unread')
			expect(result.count).toBe(0)
			expect(result.errors).toEqual(['Rule "r1" has a malformed premise'])
		}
	})
})

describe('LogicalReasoner — sparse / junk rules array', () => {
	it('a sparse rules array forward-chains using only the present rules', () => {
		const sparseRules = sparse<Rule>(3, [
			[0, derivationRule('r1', 'a', true, 'x1')],
			[2, derivationRule('r2', 'b', true, 'x2')],
		])
		const definition = createLogicalDefinition('d', 'd', sparseRules)

		const result = expectLogical(reasoner.reason({ a: true, b: true }, definition))
		expect(result.count).toBe(2)
		expect(result.conclusion).toBe('met')
	})

	it('a rules array containing null does not throw — it evaluates from the usable rules', () => {
		const rules = [
			derivationRule('r1', 'a', true, 'x1'),
			null,
			derivationRule('r2', 'b', true, 'x2'),
		]
		const definition = {
			reasoning: 'logical' as const,
			id: 'd',
			name: 'd',
			rules,
			strategy: 'forward' as const,
		}

		const result = expectLogical(
			invokeUnchecked<ReasonResult>(reasoner, reasoner.reason, [{ a: true, b: true }, definition]),
		)
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Rule at index 1 is malformed'])
		expect(result.count).toBe(2)
		expect(result.conclusion).toBe('unread')
	})

	it('a rules array containing null does not throw under backward strategy, and refuses', () => {
		const rules = [
			derivationRule('r1', 'a', true, 'x1'),
			null,
			derivationRule('r2', 'b', true, 'x2'),
		]
		const definition = {
			reasoning: 'logical' as const,
			id: 'd',
			name: 'd',
			rules,
			strategy: 'backward' as const,
		}

		const result = expectLogical(
			invokeUnchecked<ReasonResult>(reasoner, reasoner.reason, [{ a: true, b: true }, definition]),
		)
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Rule at index 1 is malformed'])
		expect(result.count).toBe(2)
		expect(result.conclusion).toBe('unread')
	})
})

describe('LogicalReasoner — deep-but-safe compound evaluation', () => {
	it('evaluates a deepCompound(1000, atom) expression without error (true and false leaves, run twice)', () => {
		const trueFirst = evaluateDeepCompound(true)
		const trueSecond = evaluateDeepCompound(true)
		expect(trueFirst).toEqual(trueSecond)
		expect(trueFirst.conclusion).toBe('met')
		expect(trueFirst.count).toBe(1)

		const falseFirst = evaluateDeepCompound(false)
		const falseSecond = evaluateDeepCompound(false)
		expect(falseFirst).toEqual(falseSecond)
		expect(falseFirst.conclusion).toBe('unmet')
		expect(falseFirst.count).toBe(0)
	})
})

describe('LogicalReasoner — array-path conclusion vs array-path premise mismatch', () => {
	it('a flat derived key "flags.ok" answers an ARRAY-path premise reading the same path', () => {
		// `flag` derives the FLAT overlay key 'flags.ok'; `read` reads the same path, and the
		// overlay answers it by that flat key, whichever form the path takes.
		const definition = createLogicalDefinition('d', 'd', [
			createRule(
				'flag',
				[createAtom('go', 'equals', true)],
				createAtom(['flags', 'ok'], 'equals', true),
			),
			createRule(
				'read',
				[createAtom(['flags', 'ok'], 'equals', true)],
				createAtom('done', 'equals', true),
			),
		])
		const result = expectLogical(reasoner.reason({ go: true }, definition))
		expect(result.trace).toContain('Rule "flag" derived: flags.ok=true (iteration 1)')
		expect(result.trace.some((entry) => entry.includes('done='))).toBe(true)
		expect(result.count).toBe(2)
		expect(result.conclusion).toBe('met')
	})
})

describe('LogicalReasoner — builder build() output passed to supports/validate/reason', () => {
	const definition = createLogicalDefinition('activation', 'Activation', [
		createRule(
			'activate',
			[createAtom('active', 'equals', true)],
			createAtom('result', 'equals', true),
		),
	])

	it('a built definition + built subject behave identically to the same data written inline (run twice)', () => {
		const builtDefinition = createDefinitionBuilder(definition).build()
		const builtSubject = createSubjectBuilder({ id: 's1', active: true }).build()

		expect(reasoner.supports(builtDefinition)).toBe(reasoner.supports(definition))
		expect(reasoner.validate(builtDefinition)).toEqual(reasoner.validate(definition))

		const plainResult = reasoner.reason({ active: true }, definition)
		const builtResult = reasoner.reason(builtSubject, builtDefinition)
		expect(builtResult).toEqual(plainResult)
		// Run twice — determinism.
		expect(reasoner.reason(builtSubject, builtDefinition)).toEqual(builtResult)
	})

	it('a mixed batch of plain and built subject payloads mapped through reason() individually produces equal-length, positionally correct results', () => {
		const builtDefinition = createDefinitionBuilder(definition).build()
		const builtSubject = createSubjectBuilder({ id: 's2', active: false }).build()
		const subjects = [{ active: true }, builtSubject]
		const results = subjects.map((subject) => reasoner.reason(subject, builtDefinition))
		const expected = [
			reasoner.reason({ active: true }, definition),
			reasoner.reason(builtSubject, definition),
		]
		expect(results).toEqual(expected)
	})
})

describe.each(['forward', 'backward'] as const)(
	'LogicalReasoner — refusing what it cannot read (%s)',
	(strategy) => {
		const okay = createAtom('ok', 'equals', true)
		const age = createAtom('age', 'above', 18)
		const credit = createAtom('credit', 'above', 600)

		it('a false operand settles "and", so the unread one is never asked about', () => {
			const rules = [createRule('r', [createCompound('and', [age, credit])], okay)]
			const result = reasonRules({ age: 15 }, rules, strategy)
			expect(result.conclusion).toBe('unmet')
			expect(result.success).toBe(true)
			expect(result.errors).toEqual([])
			expect(result.faults.map((fault) => fault.path)).toEqual([])
		})

		it('a true operand settles "or", so the unread one is never asked about', () => {
			const rules = [createRule('r', [createCompound('or', [age, credit])], okay)]
			const result = reasonRules({ age: 20 }, rules, strategy)
			expect(result.conclusion).toBe('met')
			expect(result.success).toBe(true)
			expect(result.faults.map((fault) => fault.path)).toEqual([])
		})

		it('an unread operand the answer depends on refuses, and names the field', () => {
			const rules = [createRule('r', [createCompound('and', [age, credit])], okay)]
			const result = reasonRules({ age: 20 }, rules, strategy)
			expect(result.conclusion).toBe('unread')
			expect(result.success).toBe(false)
			expect(result.count).toBe(0)
			expect(result.errors).toEqual(['Field "credit" is missing'])
			expect(result.faults.map((fault) => fault.path)).toEqual(['credit'])
		})

		it('"credit below 600" on no credit refuses rather than reading low', () => {
			const rules = [createRule('r', [createAtom('credit', 'below', 600)], okay)]
			const result = reasonRules({}, rules, strategy)
			expect(result.conclusion).toBe('unread')
			expect(result.success).toBe(false)
			expect(result.errors).toEqual(['Field "credit" is missing'])
			expect(result.faults.map((fault) => fault.path)).toEqual(['credit'])
		})

		it('a NOT over an unread field stays unread, never met', () => {
			const rules = [createRule('r', [createCompound('not', [credit])], okay)]
			const result = reasonRules({}, rules, strategy)
			expect(result.conclusion).toBe('unread')
			expect(result.faults.map((fault) => fault.path)).toEqual(['credit'])
		})

		it('a field read twice is named once', () => {
			const rules = [
				createRule('a', [credit], createAtom('x', 'equals', true)),
				createRule('b', [credit], createAtom('y', 'equals', true)),
			]
			const result = reasonRules({}, rules, strategy)
			expect(result.errors).toEqual(['Field "credit" is missing'])
			expect(result.faults.map((fault) => fault.path)).toEqual(['credit'])
		})

		it('a rule waiting on an unread conclusion adds nothing, the concluding rule names the input', () => {
			const rules = [
				createRule('adult', [age], createAtom('adult', 'equals', true)),
				createRule('r', [createAtom('adult', 'equals', true)], okay),
			]
			const result = reasonRules({}, rules, strategy)
			expect(result.conclusion).toBe('unread')
			expect(result.errors).toEqual(['Field "age" is missing'])
			expect(result.faults.map((fault) => fault.path)).toEqual(['age'])
		})

		it('a subject may not supply a conclusion', () => {
			const rules = [createRule('adult', [age], createAtom('adult', 'equals', true))]
			const result = reasonRules({ age: 15, adult: true }, rules, strategy)
			expect(result.conclusion).toBe('unread')
			expect(result.success).toBe(false)
			expect(result.rules).toEqual([])
			expect(result.errors).toEqual(['Subject supplies conclusion "adult"'])
		})

		it('a rule that holds with a wrong arity connective refuses as malformed', () => {
			const rules = [
				createRule(
					'r',
					[
						createCompound('not', [
							createAtom('a', 'equals', true),
							createAtom('b', 'equals', true),
						]),
					],
					okay,
				),
			]
			const result = reasonRules({ a: true, b: true }, rules, strategy)
			expect(result.conclusion).toBe('unread')
			expect(result.errors).toEqual(['Rule "r" has a malformed premise'])
		})
	},
)

describe.each(['forward', 'backward'] as const)(
	'LogicalReasoner — closing conclusion keys (%s)',
	(strategy) => {
		const a = createAtom('a', 'equals', true)
		const b = createAtom('b', 'equals', true)
		const nb = createAtom('nb', 'equals', true)
		const nc = createAtom('nc', 'equals', true)

		it('a negation never reads a key before its rule has had the chance to derive it', () => {
			// `nb` must not fire on the empty overlay and leave `nc` standing on it.
			const rules = [
				createRule('nb', [createCompound('not', [a])], nb),
				createRule('a', [createAtom('x', 'above', 1)], a),
				createRule('nc', [nb], nc),
			]
			const result = reasonRules({ x: 5 }, rules, strategy)
			const states = Object.fromEntries(result.rules.map((rule) => [rule.id, rule.state]))
			expect(states).toEqual({ nb: 'unmet', a: 'met', nc: 'unmet' })
			expect(result.success).toBe(true)
		})

		it('a key whose concluding rules all settled unmet closes, so a NOT over it is met', () => {
			const rules = [
				createRule('a', [createAtom('x', 'above', 1)], a),
				createRule('nb', [createCompound('not', [a])], nb),
			]
			const result = reasonRules({ x: 0 }, rules, strategy)
			const states = Object.fromEntries(result.rules.map((rule) => [rule.id, rule.state]))
			expect(states).toEqual({ a: 'unmet', nb: 'met' })
			expect(result.success).toBe(true)
			expect(result.conclusion).toBe('met')
		})

		it('a key stays open while its concluding rule is unread, and so does a NOT over it', () => {
			const rules = [
				createRule('a', [createAtom('x', 'above', 1)], a),
				createRule('nb', [createCompound('not', [a])], nb),
			]
			const result = reasonRules({}, rules, strategy)
			expect(result.conclusion).toBe('unread')
			expect(result.errors).toEqual(['Field "x" is missing'])
			expect(result.faults.map((fault) => fault.path)).toEqual(['x'])
		})

		it('a positive cycle waits only on itself, so it closes unmet', () => {
			const rules = [createRule('a', [b], a), createRule('b', [a], b)]
			const result = reasonRules({}, rules, strategy)
			expect(result.conclusion).toBe('unmet')
			expect(result.success).toBe(true)
			expect(result.faults.map((fault) => fault.path)).toEqual([])
		})

		it('a cycle with a real leaf refuses and names the leaf, not the cycle', () => {
			const rules = [
				createRule('a', [createCompound('and', [b, createAtom('x', 'above', 1)])], a),
				createRule('b', [a], b),
			]
			const result = reasonRules({}, rules, strategy)
			expect(result.conclusion).toBe('unread')
			expect(result.errors).toEqual(['Field "x" is missing'])
			expect(result.faults.map((fault) => fault.path)).toEqual(['x'])
		})

		it('an ordering on a closed key has no number to read, and refuses naming the rule', () => {
			const rules = [
				createRule('score', [createAtom('x', 'above', 1)], createAtom('score', 'equals', 10)),
				createRule('r', [createAtom('score', 'above', 5)], createAtom('ok', 'equals', true)),
			]
			const result = reasonRules({ x: 0 }, rules, strategy)
			expect(result.conclusion).toBe('unread')
			expect(result.success).toBe(false)
			expect(result.faults.map((fault) => fault.path)).toEqual([])
			expect(result.errors).toEqual([
				'Rule "r" reads conclusion "score" with "above", and no rule concluded a value',
			])
		})

		it('an ordering reads the derived value, however the rule was reached', () => {
			const rules = [
				createRule('r', [createAtom('score', 'above', 5)], createAtom('ok', 'equals', true)),
				createRule('score', [createAtom('x', 'above', 1)], createAtom('score', 'equals', 5)),
			]
			const held = reasonRules({ x: 2 }, rules, strategy)
			expect(held.rules.find((rule) => rule.id === 'r')?.state).toBe('unmet')
			expect(held.success).toBe(true)
			const lower = [
				createRule('r', [createAtom('score', 'above', 4)], createAtom('ok', 'equals', true)),
				createRule('score', [createAtom('x', 'above', 1)], createAtom('score', 'equals', 5)),
			]
			const met = reasonRules({ x: 2 }, lower, strategy)
			expect(met.rules.find((rule) => rule.id === 'r')?.state).toBe('met')
		})

		it('rule results carry each premise check, derived keys read from the overlay', () => {
			const rules = [
				createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
				createRule('ok', [createAtom('adult', 'equals', true)], createAtom('ok', 'equals', true)),
			]
			const result = reasonRules({ age: 25 }, rules, strategy)
			expect(result.rules.map((rule) => rule.checks)).toEqual([
				[{ field: 'age', state: 'met', actual: 25 }],
				[{ field: 'adult', state: 'met', actual: true }],
			])
		})
	},
)

describe('LogicalReasoner — a cycle through negation', () => {
	const a = createAtom('a', 'equals', true)
	const b = createAtom('b', 'equals', true)
	const rules = [
		createRule('ra', [createCompound('not', [b])], a),
		createRule('rb', [createCompound('not', [a])], b),
	]

	it('validate names every key on the cycle', () => {
		const validation = reasoner.validate(createLogicalDefinition('d', 'd', rules))
		expect(validation.valid).toBe(false)
		expect(validation.errors).toEqual(['Conclusions depend on their own negation: a, b'])
	})

	it('forward refuses at run time when validate was skipped', () => {
		const result = reasonRules({}, rules, 'forward')
		expect(result.conclusion).toBe('unread')
		expect(result.success).toBe(false)
		expect(result.errors).toEqual([
			'Unstratified: rule "ra" concludes "a", which a fired rule read as closed',
			'Unstratified: rule "rb" concludes "b", which a fired rule read as closed',
		])
	})

	it('backward refuses the same way when validate was skipped', () => {
		const result = reasonRules({}, rules, 'backward')
		expect(result.conclusion).toBe('unread')
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(reasonRules({}, rules, 'forward').errors)
	})

	it('validate leaves a positive cycle and a negation off any cycle alone', () => {
		const positive = [createRule('ra', [b], a), createRule('rb', [a], b)]
		const offCycle = [
			createRule('ra', [createAtom('x', 'above', 1)], a),
			createRule('rb', [createCompound('not', [a])], b),
		]
		expect(reasoner.validate(createLogicalDefinition('d', 'd', positive)).errors).toEqual([])
		expect(reasoner.validate(createLogicalDefinition('d', 'd', offCycle)).errors).toEqual([])
	})

	it('a disabled rule breaks the cycle', () => {
		const definition = createLogicalDefinition('d', 'd', [
			createRule('ra', [createCompound('not', [b])], a),
			createRule('rb', [createCompound('not', [a])], b, { enabled: false }),
		])
		expect(reasoner.validate(definition).valid).toBe(true)
	})
})

describe('LogicalReasoner — validate reads the expressions', () => {
	const premise = createAtom('a', 'equals', true)
	const okay = createAtom('ok', 'equals', true)
	const errorsOf = readRuleErrors

	it('a conclusion may only assert', () => {
		expect(errorsOf(okay)).toEqual([])
		expect(errorsOf(createCompound('and', [okay, createAtom('x', 'equals', 1)]))).toEqual([])
		expect(errorsOf(createCompound('not', [okay]))).toEqual([
			'A conclusion may only join atoms with "and", not "not"',
		])
		expect(errorsOf(createCompound('or', [okay]))).toEqual([
			'A conclusion may only join atoms with "and", not "or"',
		])
		expect(errorsOf(createAtom('ok', 'equals', false))).toEqual([
			'Conclusion on "ok" may not assert false',
		])
		expect(errorsOf(createAtom('ok', 'above', 1))).toEqual([
			'Conclusion on "ok" must use "equals", not "above"',
		])
	})

	it('a connective has the arity it reads, both ways', () => {
		expect(errorsOf(okay, [createCompound('and', [])])).toEqual(['Connective "and" has 0 operands'])
		expect(errorsOf(okay, [createCompound('not', [premise, premise])])).toEqual([
			'Connective "not" has 2 operands',
		])
		expect(errorsOf(okay, [createCompound('implies', [premise])])).toEqual([
			'Connective "implies" has 1 operands',
		])
	})

	it('a check has an expected value its comparison can use', () => {
		expect(errorsOf(okay, [createAtom('a', 'above', '18')])).toEqual([
			'Check on "a": "above" needs a finite number',
		])
	})
})

describe('LogicalReasoner — both strategies compute one supported model', () => {
	const flag = createFlagAtom
	const not = createNegatedFlag
	const x = createAtom('x', 'above', 1)
	const y = createAtom('y', 'above', 1)
	const DEFINITIONS: ReadonlyArray<readonly [string, readonly Rule[]]> = [
		['one rule', [createFlagRule('a', 'a', [x])]],
		['a chain', [createFlagRule('a', 'a', [x]), createFlagRule('b', 'b', [flag('a')])]],
		[
			'a chain authored backwards',
			[createFlagRule('b', 'b', [flag('a')]), createFlagRule('a', 'a', [x])],
		],
		[
			'a negation read before its key derives',
			[
				createFlagRule('nb', 'nb', [not('a')]),
				createFlagRule('a', 'a', [x]),
				createFlagRule('nc', 'nc', [flag('nb')]),
			],
		],
		[
			'a positive cycle',
			[createFlagRule('a', 'a', [flag('b')]), createFlagRule('b', 'b', [flag('a')])],
		],
		[
			'a positive cycle with a real leaf',
			[
				createFlagRule('a', 'a', [createCompound('and', [flag('b'), x])]),
				createFlagRule('b', 'b', [flag('a')]),
			],
		],
		[
			'a negation over a positive cycle with a real leaf',
			[
				createFlagRule('a', 'a', [createCompound('and', [flag('b'), x])]),
				createFlagRule('b', 'b', [flag('a')]),
				createFlagRule('c', 'c', [not('a')]),
			],
		],
		[
			'a negation over a free positive cycle',
			[
				createFlagRule('a', 'a', [flag('b')]),
				createFlagRule('b', 'b', [flag('a')]),
				createFlagRule('c', 'c', [not('a')]),
			],
		],
		[
			'a rule standing on a negation over a cycle with a real leaf',
			[
				createFlagRule('a', 'a', [createCompound('and', [flag('b'), x])]),
				createFlagRule('b', 'b', [flag('a')]),
				createFlagRule('c', 'c', [not('a')]),
				createFlagRule('d', 'd', [flag('c')]),
			],
		],
		[
			'negations stacked on a free positive cycle',
			[
				createFlagRule('a', 'a', [flag('b')]),
				createFlagRule('b', 'b', [flag('a')]),
				createFlagRule('c', 'c', [not('a')]),
				createFlagRule('e', 'e', [not('c')]),
			],
		],
		[
			'an "or" over a cycle and a leaf',
			[
				createFlagRule('a', 'a', [createCompound('or', [flag('b'), x])]),
				createFlagRule('b', 'b', [flag('a')]),
			],
		],
		['two concluders, one key', [createFlagRule('a1', 'a', [x]), createFlagRule('a2', 'a', [y])]],
		[
			'two concluders read through a negation',
			[
				createFlagRule('a1', 'a', [x]),
				createFlagRule('a2', 'a', [y]),
				createFlagRule('b', 'b', [not('a')]),
			],
		],
		[
			'priorities against the authored order',
			[
				createRule('b', [flag('a')], flag('b'), { priority: 5 }),
				createRule('a', [x], flag('a'), { priority: 9 }),
				createRule('c', [not('b')], flag('c'), { priority: 1 }),
			],
		],
		[
			'an ordering on a derived value',
			[
				createRule('r', [createAtom('score', 'above', 5)], flag('ok')),
				createRule('score', [x], createAtom('score', 'equals', 5)),
			],
		],
		[
			'two concluders with different values, against the authored order',
			[
				createRule('ra', [x], createAtom('k', 'equals', 1), { priority: 1 }),
				createRule('rb', [y], createAtom('k', 'equals', 2), { priority: 0 }),
				createRule('rc', [createAtom('k', 'equals', 2)], flag('out'), { priority: -1 }),
			],
		],
		[
			'an implication over a conclusion',
			[
				createFlagRule('a', 'a', [x]),
				createFlagRule('b', 'b', [createCompound('implies', [flag('a'), y])]),
			],
		],
		[
			'a disabled concluder',
			[createRule('a', [x], flag('a'), { enabled: false }), createFlagRule('b', 'b', [not('a')])],
		],
		[
			'a key concluded twice, and read between the two',
			[
				createRule('ok', [createAtom('score', 'equals', 1)], flag('ok'), { priority: -10 }),
				createRule('low', [flag('bridge')], createAtom('score', 'equals', 1), { priority: 0 }),
				createRule('high', [x], createAtom('score', 'equals', 2), { priority: 1 }),
				createRule('bridge', [x], flag('bridge'), { priority: 2 }),
			],
		],
		[
			'a derived value an ordering cannot read',
			[
				createRule('score', [x], createAtom('score', 'equals', '30')),
				createRule('ok', [createAtom('score', 'above', 18)], flag('ok')),
				createRule('done', [x], flag('done')),
			],
		],
	]
	const SUBJECTS = [
		{},
		{ x: 5 },
		{ x: 0 },
		{ y: 5 },
		{ y: 0 },
		{ x: 5, y: 5 },
		{ x: 0, y: 0 },
		{ x: 'old' },
	]

	for (const [name, rules] of DEFINITIONS) {
		it(`${name}: rules, conclusion, and faults agree`, () => {
			expect(reasoner.validate(createLogicalDefinition('d', 'd', rules)).valid).toBe(true)
			for (const subject of SUBJECTS) {
				const forward = reasonRules(subject, rules, 'forward')
				const backward = reasonRules(subject, rules, 'backward')
				expect(backward.rules).toEqual(forward.rules)
				expect(backward.conclusion).toBe(forward.conclusion)
				expect(backward.faults).toEqual(forward.faults)
				expect(backward.success).toBe(forward.success)
			}
		})
	}
})

describe.each(['forward', 'backward'] as const)(
	'LogicalReasoner — a cycle closes first, and what reads it settles after (%s)',
	(strategy) => {
		const flag = createFlagAtom
		const not = createNegatedFlag

		it('a free cycle closes alone, so the negations stacked on it read in order', () => {
			const rules = [
				createFlagRule('a', 'a', [flag('b')]),
				createFlagRule('b', 'b', [flag('a')]),
				createFlagRule('c', 'c', [not('a')]),
				createFlagRule('e', 'e', [not('c')]),
			]
			const result = reasonRules({}, rules, strategy)
			const states = Object.fromEntries(result.rules.map((rule) => [rule.id, rule.state]))
			expect(states).toEqual({ a: 'unmet', b: 'unmet', c: 'met', e: 'unmet' })
			expect(result.errors).toEqual([])
		})

		it('a cycle waiting on a real leaf holds what stands on it, and derives nothing', () => {
			const rules = [
				createFlagRule('a', 'a', [createCompound('and', [flag('b'), createAtom('x', 'above', 1)])]),
				createFlagRule('b', 'b', [flag('a')]),
				createFlagRule('c', 'c', [not('a')]),
				createFlagRule('d', 'd', [flag('c')]),
			]
			const result = reasonRules({}, rules, strategy)
			expect(result.rules.map((rule) => rule.state)).toEqual([
				'unread',
				'unread',
				'unread',
				'unread',
			])
			expect(result.count).toBe(0)
			expect(result.errors).toEqual(['Field "x" is missing'])
		})
	},
)

describe.each(['forward', 'backward'] as const)(
	'LogicalReasoner — a key stays open while any rule concluding it could still fire (%s)',
	(strategy) => {
		const rules = [
			createFlagRule('a1', 'a', [createAtom('x', 'above', 1)]),
			createFlagRule('a2', 'a', [createAtom('y', 'above', 1)]),
			createFlagRule('b', 'b', [createNegatedFlag('a')]),
		]

		it('one concluder unmet and one unread holds the negation over the key', () => {
			const result = reasonRules({ x: 0 }, rules, strategy)
			expect(result.rules.map((rule) => rule.state)).toEqual(['unmet', 'unread', 'unread'])
			expect(result.count).toBe(0)
			expect(result.errors).toEqual(['Field "y" is missing'])
		})

		it('both unmet close it, so the negation reads met', () => {
			const result = reasonRules({ x: 0, y: 0 }, rules, strategy)
			expect(result.rules.map((rule) => rule.state)).toEqual(['unmet', 'unmet', 'met'])
			expect(result.success).toBe(true)
		})

		it('either met derives it, so the negation reads unmet', () => {
			const result = reasonRules({ x: 5 }, rules, strategy)
			expect(result.rules.map((rule) => rule.state)).toEqual(['met', 'unread', 'unmet'])
		})
	},
)

describe('LogicalReasoner — a heavily cross-read definition', () => {
	it('backward proves each rule once, so many concluders of one key stay fast', () => {
		const rules = sequence(40).map((index) =>
			createFlagRule(`r${String(index)}`, 'k', [
				createFlagAtom('k'),
				createAtom(`x${String(index)}`, 'above', 1),
			]),
		)
		const backward = reasonRules({}, rules, 'backward')
		expect(backward.success).toBe(false)
		expect(backward.faults).toHaveLength(40)
		expect(backward.rules).toEqual(reasonRules({}, rules, 'forward').rules)
	})
})

describe('LogicalReasoner — an evaluator it was handed', () => {
	const rule = createFlagRule('r', 'ok', [createAtom('a', 'above', 1)])
	const definition = createLogicalDefinition('d', 'd', [rule])

	it('one that returns no state reads unread, never met', () => {
		const custom = invokeUnchecked<LogicalReasoner>(undefined, createLogicalReasoner, [
			{ evaluator: SILENT_EVALUATOR },
		])
		const result = expectLogical(custom.reason({ a: 5 }, definition))
		expect(result.conclusion).toBe('unread')
		expect(result.success).toBe(false)
		expect(result.count).toBe(0)
	})

	it('one that throws refuses the run, because a reasoner throws only MISMATCH', () => {
		const custom = invokeUnchecked<LogicalReasoner>(undefined, createLogicalReasoner, [
			{ evaluator: THROWING_EVALUATOR },
		])
		const result = expectLogical(custom.reason({ a: 5 }, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Chaining failed: boom'])
	})
})

describe('LogicalReasoner — a conclusion key named __proto__', () => {
	it('derives and reads as any other key', () => {
		const rules = [
			createFlagRule('w', '__proto__', [createAtom('x', 'above', 1)]),
			createFlagRule('r', 'ok', [createFlagAtom('__proto__')]),
		]
		const result = reasonRules({ x: 5 }, rules)
		expect(result.errors).toEqual([])
		expect(result.conclusion).toBe('met')
	})
})

describe('LogicalReasoner — one key spelled two ways', () => {
	it('a subject holding the nested spelling supplies the dotted conclusion', () => {
		const rules = [
			createFlagRule('w', 'a.b', [createAtom('x', 'above', 1)]),
			createFlagRule('r', 'ok', [createFlagAtom(['a', 'b'])]),
		]
		const result = reasonRules({ x: 0, a: { b: true } }, rules)
		expect(result.errors).toEqual(['Subject supplies conclusion "a.b"'])
	})
})

describe('LogicalReasoner — validate takes anything', () => {
	it('never throws on what reaches it unchecked', () => {
		for (const junk of [null, undefined, 1, 'x', { reasoning: Symbol('s') }, Object.create(null)]) {
			const validation = invokeUnchecked<ReasonValidationResult>(reasoner, reasoner.validate, [
				junk,
			])
			expect(validation.valid).toBe(false)
			expect(validation.errors).toHaveLength(1)
		}
	})

	it('a conclusion asserting one key twice refuses', () => {
		const twice = createCompound('and', [
			createAtom('k', 'equals', 1),
			createAtom('k', 'equals', 2),
		])
		expect(readRuleErrors(twice)).toEqual(['Conclusion asserts two values for "k"'])
	})

	it('a read through a raw or json field warns at any depth', () => {
		const shape = objectShape({ loose: jsonShape() })
		const validation = reasoner.validate(
			createShapedDefinition(createAtom(['loose', 'x'], 'above', 1), shape),
		)
		expect(validation.valid).toBe(true)
		expect(validation.warnings).toEqual([
			'Field "loose.x" is read through a shape that types nothing',
		])
	})
})

describe('LogicalReasoner — the fault channel', () => {
	const rule = createRule(
		'r',
		[createAtom('credit', 'above', 600)],
		createAtom('ok', 'equals', true),
	)

	it('an absent field is a missing fault, named from the operator', () => {
		expect(reasonRules({}, [rule]).faults).toEqual([
			{ reason: 'missing', path: 'credit', expected: 'number' },
		])
	})

	it('a wrong type is a type fault carrying a preview of what came', () => {
		const result = reasonRules({ credit: '700' }, [rule])
		expect(result.faults).toEqual([
			{ reason: 'type', path: 'credit', expected: 'number', received: '"700"' },
		])
		expect(result.errors).toEqual(['Field "credit" expected number, received "700"'])
	})

	it('names the kind the expected value needs', () => {
		const word = createRule('r', [createAtom('a', 'equals', 'x')], createAtom('ok', 'equals', true))
		expect(reasonRules({}, [word]).faults).toEqual([
			{ reason: 'missing', path: 'a', expected: 'string' },
		])
		const mixed = createRule(
			'r',
			[createAtom('a', 'any', ['x', 1])],
			createAtom('ok', 'equals', true),
		)
		expect(reasonRules({}, [mixed]).faults).toEqual([
			{ reason: 'missing', path: 'a', expected: 'union' },
		])
	})

	it('carries input leaves only, transitively, and never a conclusion key', () => {
		const rules = [
			createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
			createRule('r', [createAtom('adult', 'equals', true)], createAtom('ok', 'equals', true)),
		]
		expect(reasonRules({}, rules).faults).toEqual([
			{ reason: 'missing', path: 'age', expected: 'number' },
		])
	})

	it('holds one string per fault, and a settled run has neither', () => {
		const result = reasonRules({ credit: 700 }, [rule])
		expect(result).toMatchObject({ errors: [], faults: [], repairs: [], defaulted: [] })
	})

	it('an array path stays the path the rule read', () => {
		const nested = createRule(
			'r',
			[createAtom(['a', 'b'], 'above', 1)],
			createAtom('ok', 'equals', true),
		)
		expect(reasonRules({ a: {} }, [nested]).faults).toEqual([
			{ reason: 'missing', path: ['a', 'b'], expected: 'number' },
		])
	})
})

describe('LogicalReasoner — null is what says a thing does not apply', () => {
	const rules = [
		createRule(
			'r',
			[
				createCompound('and', [
					createAtom('spouse', 'not', null),
					createAtom('spouse', 'above', 0),
				]),
			],
			createAtom('ok', 'equals', true),
		),
	]

	it('settles on null without an invented default', () => {
		const result = reasonRules({ spouse: null }, rules)
		expect(result.conclusion).toBe('unmet')
		expect(result.success).toBe(true)
	})

	it('reads the number when there is one', () => {
		expect(reasonRules({ spouse: 5 }, rules).conclusion).toBe('met')
	})

	it('an absent field is not null, and refuses', () => {
		expect(reasonRules({}, rules).conclusion).toBe('unread')
	})
})

describe('LogicalReasoner — validate reads the shape', () => {
	const okay = createAtom('ok', 'equals', true)
	const define = createShapedDefinition
	const shape = objectShape({
		age: numberShape(),
		state: literalShape(['FL', 'CA']),
		name: stringShape(),
		loose: jsonShape(),
	})

	it('a read the shape declares, with a value it holds, is valid', () => {
		expect(reasoner.validate(define(createAtom('age', 'above', 18), shape))).toEqual({
			valid: true,
			errors: [],
			warnings: [],
		})
	})

	it('a typo refuses statically', () => {
		expect(reasoner.validate(define(createAtom('agee', 'above', 18), shape)).errors).toEqual([
			'Field "agee" is read, and the shape does not declare it',
		])
	})

	it('a conclusion key needs no declaration, and may not have one', () => {
		const chain = createLogicalDefinition(
			'd',
			'd',
			[
				createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
				createRule('r', [createAtom('adult', 'equals', true)], okay),
			],
			{ shape },
		)
		expect(reasoner.validate(chain).errors).toEqual([])
		const declared = objectShape({ age: numberShape(), ok: booleanShape() })
		expect(reasoner.validate(define(createAtom('age', 'above', 18), declared)).errors).toEqual([
			'Shape declares conclusion "ok"',
		])
	})

	it('an expected value the field cannot hold refuses, because it would be unmet forever', () => {
		expect(reasoner.validate(define(createAtom('age', 'equals', '18'), shape)).errors).toEqual([
			'Check on "age": "18" is not a value of this field',
		])
	})

	it('free text is never compared by equality', () => {
		expect(reasoner.validate(define(createAtom('name', 'equals', 'Ann'), shape)).errors).toEqual([
			'Check on "name": a string compares only against a field that declares it as a literal',
		])
	})

	it('a json field read warns and stays valid, the typed read its backstop', () => {
		const validation = reasoner.validate(define(createAtom('loose', 'above', 1), shape))
		expect(validation.valid).toBe(true)
		expect(validation.warnings).toEqual([
			'Field "loose" is read through a shape that types nothing',
		])
	})

	it('a pattern refuses at authoring, because it does not survive JSON', () => {
		const patterned = objectShape({ age: numberShape(), code: stringShape({ pattern: /x/ }) })
		expect(reasoner.validate(define(createAtom('age', 'above', 1), patterned)).errors).toEqual([
			'Field "code" carries a pattern, which does not survive JSON',
		])
	})

	it('a shape that is no shape is refused by the exact guard', () => {
		const definition = createLogicalDefinition('d', 'd', [createRule('r', [okay], okay)])
		const validation = invokeUnchecked<ReasonValidationResult>(reasoner, reasoner.validate, [
			{ ...definition, shape: { category: 'nope' } },
		])
		expect(validation.errors).toEqual(['Definition does not match the logical definition shape'])
	})
})

describe.each(['forward', 'backward'] as const)(
	'LogicalReasoner — a derived value a read cannot use (%s)',
	(strategy) => {
		const seed = createAtom('seed', 'equals', true)
		const score = createRule('score', [seed], createAtom('score', 'equals', '30'))
		const ok = createRule(
			'ok',
			[createAtom('score', 'above', 18)],
			createAtom('ok', 'equals', true),
		)
		const message =
			'Rule "ok" reads conclusion "score" with "above", and its value cannot be read that way'

		it('refuses, even with a later rule met', () => {
			const done = createRule('done', [seed], createAtom('done', 'equals', true))
			const result = reasonRules({ seed: true }, [score, ok, done], strategy)
			expect(result.rules.map((rule) => rule.state)).toEqual(['met', 'unread', 'met'])
			expect(result.success).toBe(false)
			expect(result.conclusion).toBe('unread')
			expect(result.errors).toEqual([message])
		})

		it('refuses when the unread rule is the last', () => {
			const result = reasonRules({ seed: true }, [score, ok], strategy)
			expect(result.success).toBe(false)
			expect(result.errors).toEqual([message])
		})

		it('names no input, because none is missing', () => {
			expect(reasonRules({ seed: true }, [score, ok], strategy).faults).toEqual([])
		})

		it('says a key that closed with no value apart from one that holds an unusable value', () => {
			const result = reasonRules({ seed: false }, [score, ok], strategy)
			expect(result.success).toBe(false)
			expect(result.rules.map((rule) => rule.state)).toEqual(['unmet', 'unread'])
			expect(result.errors).toEqual([
				'Rule "ok" reads conclusion "score" with "above", and no rule concluded a value',
			])
		})
	},
)

describe('LogicalReasoner — one answer from either strategy', () => {
	it('a depth cap refuses both strategies on the same definition', () => {
		const rules = [
			createRule('a', [createAtom('seed', 'equals', true)], createAtom('a', 'equals', true)),
			createRule('b', [createAtom('a', 'equals', true)], createAtom('b', 'equals', true)),
		]
		for (const order of [rules, [...rules].reverse()]) {
			for (const depth of [0, 1, 2, 3]) {
				const forward = expectLogical(
					reasoner.reason({ seed: true }, createLogicalDefinition('d', 'd', order, { depth })),
				)
				const backward = expectLogical(
					reasoner.reason(
						{ seed: true },
						createLogicalDefinition('d', 'd', order, { depth, strategy: 'backward' }),
					),
				)
				expect(backward.success).toBe(forward.success)
				expect(backward.success).toBe(depth >= 2)
				expect(backward.rules).toEqual(forward.rules)
				expect(backward.conclusion).toBe(forward.conclusion)
			}
		}
	})

	it('a long concluder ahead of a short one asks no more depth backward than forward', () => {
		const rules = [
			createRule('long', [createAtom('b', 'equals', true)], createAtom('goal', 'equals', true), {
				priority: 0,
			}),
			createRule('b', [createAtom('a', 'equals', true)], createAtom('b', 'equals', true)),
			createRule('a', [createAtom('seed', 'equals', true)], createAtom('a', 'equals', true)),
			createRule(
				'short',
				[createAtom('seed', 'equals', true)],
				createAtom('goal', 'equals', true),
				{
					priority: 1,
				},
			),
		]
		const definition = { depth: 3 }
		const forward = expectLogical(
			reasoner.reason({ seed: true }, createLogicalDefinition('d', 'd', rules, definition)),
		)
		const backward = expectLogical(
			reasoner.reason(
				{ seed: true },
				createLogicalDefinition('d', 'd', rules, { ...definition, strategy: 'backward' }),
			),
		)
		expect(forward.success).toBe(true)
		expect(backward.success).toBe(true)
		expect(backward.rules).toEqual(forward.rules)
	})

	it('a proof that exhausts the stack takes nothing from the answer', () => {
		// Reversed, so forward fires every rule in one pass and a proof walks all of them.
		const count = 16_000
		const rules = sequence(count, 1)
			.toReversed()
			.map((index) =>
				createRule(
					`r${String(index)}`,
					[
						createCompound('or', [
							createAtom(index === 1 ? 'seed' : `k${String(index - 1)}`, 'equals', true),
							createAtom('seed', 'equals', true),
						]),
					],
					createAtom(`k${String(index)}`, 'equals', true),
				),
			)
		const definition = createLogicalDefinition('d', 'd', rules, { depth: count })
		const forward = expectLogical(reasoner.reason({ seed: true }, definition))
		const backward = expectLogical(
			reasoner.reason({ seed: true }, { ...definition, strategy: 'backward' }),
		)
		expect(forward.count).toBe(count)
		expect(backward.errors).toEqual([])
		expect(backward.success).toBe(true)
		expect(backward.count).toBe(count)
		expect(backward.rules).toEqual(forward.rules)
	})

	it.each([
		[
			'throws on its first read',
			(read: number) => {
				if (read === 1) throw new Error('first read failure')
				return { x: true }
			},
		],
		['answers differently by read', (read: number) => ({ x: read === 2 })],
		['answers the same each read', () => ({ x: true })],
	])('an evaluator that %s gives the answer the same reads in either strategy', (_name, script) => {
		const definition = createLogicalDefinition('d', 'd', [
			createRule('r', [createAtom('x', 'equals', true)], createAtom('a', 'equals', true)),
		])
		const forwardReads = createScriptedEvaluator(script)
		const backwardReads = createScriptedEvaluator(script)
		const forward = expectLogical(
			createLogicalReasoner({ evaluator: forwardReads }).reason({ x: true }, definition),
		)
		const backward = expectLogical(
			createLogicalReasoner({ evaluator: backwardReads }).reason(
				{ x: true },
				{ ...definition, strategy: 'backward' },
			),
		)
		expect(backward.success).toBe(forward.success)
		expect(backward.rules).toEqual(forward.rules)
		expect(backward.count).toBe(forward.count)
		expect(backward.errors).toEqual(forward.errors)
		expect(readAnswerLines(backward.trace)).toEqual(readAnswerLines(forward.trace))
		expect(backwardReads.reads.slice(0, forwardReads.reads.length)).toEqual(forwardReads.reads)
	})

	it('runs the proofs after the answer, so each proof line follows the answer lines', () => {
		const definition = createLogicalDefinition(
			'd',
			'd',
			[createRule('r', [createAtom('x', 'equals', true)], createAtom('a', 'equals', true))],
			{ strategy: 'backward' },
		)
		expect(expectLogical(reasoner.reason({ x: true }, definition)).trace).toEqual([
			'Rule "r" derived: a=true (iteration 1)',
			'Backward chaining converged at iteration 2',
			'Proof: rule "r" established (depth 0)',
		])
	})

	it('a rule negating its own conclusion reads as not established, and the answer refuses', () => {
		const rule = createRule(
			'a',
			[createCompound('not', [createAtom('a', 'equals', true)])],
			createAtom('a', 'equals', true),
		)
		const backward = reasonRules({}, [rule], 'backward')
		expect(backward.rules.map((entry) => entry.state)).toEqual(['met'])
		expect(backward.errors).toEqual([
			'Unstratified: rule "a" concludes "a", which a fired rule read as closed',
		])
		expect(backward.trace).toContain('Proof: rule "a" not established (depth 0)')
		expect(reasonRules({}, [rule], 'forward').errors).toEqual(backward.errors)
	})

	it('validate accepts most of the generated rule sets, and the row below reads the rest too', () => {
		const valid = sequence(400, 1).filter(
			(seed) =>
				reasoner.validate(createLogicalDefinition('d', 'd', generateRuleSet(seededRandom(seed))))
					.valid,
		)
		expect(valid.length).toBeGreaterThan(200)
	})

	it.each(sequence(400, 1))(
		'generated rule set %i agrees, and never succeeds beside an unread rule',
		(seed) => {
			const random = seededRandom(seed)
			const rules = generateRuleSet(random)
			const depth = pickOne(random, [1, 2, 10])
			const definition = createLogicalDefinition('d', 'd', rules, { depth })
			for (const subject of GENERATED_SUBJECTS) {
				const forward = expectLogical(reasoner.reason(subject, definition))
				const backward = expectLogical(
					reasoner.reason(subject, { ...definition, strategy: 'backward' }),
				)
				expect(backward.rules).toEqual(forward.rules)
				expect(backward.conclusion).toBe(forward.conclusion)
				expect(backward.faults).toEqual(forward.faults)
				expect(backward.success).toBe(forward.success)
				expect(backward.count).toBe(forward.count)
				expect(readAnswerLines(backward.errors)).toEqual(readAnswerLines(forward.errors))
				expect(readAnswerLines(backward.trace)).toEqual(readAnswerLines(forward.trace))
				expect(forward.success && forward.rules.some((rule) => rule.state === 'unread')).toBe(false)
				expect(forward.success && forward.conclusion === 'unread').toBe(false)
			}
		},
	)
})
