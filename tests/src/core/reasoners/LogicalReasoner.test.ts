import type { Expression, ReasonResult, ReasonValidationResult, Rule } from '@src/core'
import {
	atom,
	compound,
	createLogicalReasoner,
	createDefinitionBuilder,
	createSubjectBuilder,
	isReasonError,
	LogicalReasoner,
	logicalDefinition,
	quantitativeDefinition,
	rule,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	captureError,
	deepCompound,
	EXTREME_NUMBERS,
	expectLogical,
	invokeRaw,
	sequence,
	sparse,
	TRICKY_KEYS,
} from '../../../../setup.js'

// `LogicalReasoner` behavior — forward chaining as a fixpoint (derived
// conclusion atoms overlay the subject on later passes, convergence traced,
// depth-cap truncation and the depth-0 no-iteration edge, ascending priority
// order incl. negative priorities, `count` = fired rules, disabled rules
// omitted from the results entirely, SameValueZero bookkeeping so a NaN
// conclusion converges), backward chaining as goal-driven sub-goal search
// (cycle-safe via the visited set, exact backward trace formats, vacuous
// empty-premises rules vs errored missing-premises rules), eager compound
// evaluation (and / or / not / implies / xor with their vacuous edges), the
// duplicate-id runtime quirks validate() now warns about, and the
// MISMATCH-throw vs malformed-shape-failure-result distinction. Ports the full
// scsr catalog PLUS the formatField derived-overlay pin: an ARRAY-path
// conclusion derives the dot-joined flat key, which a dotted-STRING premise
// (one key) then reads.

const reasoner = createLogicalReasoner()

// One rule: `field === value` concludes `derived === true` (overrides merged).
function derivationRule(
	id: string,
	field: string,
	value: unknown,
	derived: string,
	overrides?: { readonly priority?: number; readonly enabled?: boolean },
) {
	return rule(id, [atom(field, 'equals', value)], atom(derived, 'equals', true), overrides)
}

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
		expect(reasoner.supports(logicalDefinition('d', 'd', []))).toBe(true)
		expect(reasoner.supports(quantitativeDefinition('d', 'd', []))).toBe(false)
	})
})

describe('LogicalReasoner — validate', () => {
	it('accepts a well-formed rule set', () => {
		const validation = reasoner.validate(
			logicalDefinition('d', 'd', [derivationRule('r1', 'a', true, 'b')]),
		)
		expect(validation.valid).toBe(true)
		expect(validation.errors).toEqual([])
	})

	it('rejects the wrong reasoning with the renamed message', () => {
		const validation = reasoner.validate(quantitativeDefinition('d', 'd', []))
		expect(validation.errors[0]).toBe('Expected reasoning "logical", got "quantitative"')
	})

	it('demands an id, a name, and at least one rule', () => {
		const validation = reasoner.validate(logicalDefinition('', '', []))
		expect(validation.errors).toContain('Definition must have an id')
		expect(validation.errors).toContain('Definition must have a name')
		expect(validation.errors).toContain('Definition must have at least one rule')
	})

	it('a premise-less rule is a WARNING; a conclusion-less rule is an ERROR', () => {
		const warned = reasoner.validate(
			logicalDefinition('d', 'd', [rule('r1', [], atom('x', 'equals', 1))]),
		)
		expect(warned.valid).toBe(true)
		expect(warned.warnings).toContain('Rule "r1" has no premises')

		const errored = invokeRaw<ReasonValidationResult>(reasoner, reasoner.validate, [
			{
				reasoning: 'logical',
				id: 'd',
				name: 'd',
				strategy: 'forward',
				rules: [{ id: 'r1', name: 'r1', premises: [atom('a', 'equals', 1)] }],
			},
		])
		expect(errored.valid).toBe(false)
		expect(errored.errors).toContain('Rule "r1" must have a conclusion')
	})

	it('duplicate rule ids are a WARNING, once per duplicated id', () => {
		const validation = reasoner.validate(
			logicalDefinition('d', 'd', [
				derivationRule('dup', 'a', true, 'x'),
				derivationRule('dup', 'b', true, 'y'),
				derivationRule('dup', 'c', true, 'z'),
			]),
		)
		expect(validation.valid).toBe(true)
		expect(
			validation.warnings.filter((warning) => warning === 'Duplicate rule id "dup"'),
		).toHaveLength(1)
	})

	it('an array-path conclusion overlay key also read via an array-path premise is a WARNING (runnable)', () => {
		const footgun = logicalDefinition('d', 'd', [
			rule('a', [], atom(['address', 'city'], 'equals', 'NYC')),
			rule('b', [atom(['address', 'city'], 'equals', 'NYC')], atom('eligible', 'equals', true)),
		])
		const validation = reasoner.validate(footgun)
		expect(validation.valid).toBe(true)
		expect(validation.warnings).toContain(
			'Overlay key "address.city" is written via an array path AND also read via an array path — the flat overlay key will not resolve',
		)
	})

	it('stays silent on the overlay-mismatch warning for a clean (dotted-string-read) definition', () => {
		const clean = logicalDefinition('d', 'd', [
			rule('a', [], atom(['address', 'city'], 'equals', 'NYC')),
			rule('b', [atom('address.city', 'equals', 'NYC')], atom('eligible', 'equals', true)),
		])
		const validation = reasoner.validate(clean)
		expect(validation.warnings.filter((warning) => warning.startsWith('Overlay key'))).toEqual([])
	})

	it('keeps the existing empty-premises warning (ii) unaffected by the new overlay-mismatch check', () => {
		const definition = logicalDefinition('d', 'd', [
			rule('r1', [], atom('x', 'equals', 1)),
			derivationRule('r2', 'a', true, 'b'),
		])
		const validation = reasoner.validate(definition)
		expect(validation.valid).toBe(true)
		expect(validation.warnings).toContain('Rule "r1" has no premises')
		expect(validation.warnings.filter((warning) => warning.startsWith('Overlay key'))).toEqual([])
	})

	it('duplicate-id and overlay-mismatch warnings coexist without interference', () => {
		const definition = logicalDefinition('d', 'd', [
			rule('dup', [], atom(['x', 'y'], 'equals', 1)),
			rule('dup', [atom(['x', 'y'], 'equals', 1)], atom('eligible', 'equals', true)),
		])
		const validation = reasoner.validate(definition)
		expect(validation.warnings).toContain('Duplicate rule id "dup"')
		expect(validation.warnings).toContain(
			'Overlay key "x.y" is written via an array path AND also read via an array path — the flat overlay key will not resolve',
		)
	})
})

describe('LogicalReasoner — forward chaining', () => {
	it('a met premise fires the rule; an unmet one does not', () => {
		const definition = logicalDefinition('d', 'd', [
			derivationRule('activate', 'active', true, 'result'),
		])
		const met = expectLogical(reasoner.reason({ active: true }, definition))
		expect(met.reasoning).toBe('logical')
		expect(met.success).toBe(true)
		expect(met.conclusion).toBe(true)
		expect(met.count).toBe(1)

		const unmet = expectLogical(reasoner.reason({ active: false }, definition))
		expect(unmet.conclusion).toBe(false)
		expect(unmet.count).toBe(0)
	})

	it('counts every fired rule', () => {
		const definition = logicalDefinition('d', 'd', [
			derivationRule('r1', 'a', true, 'x'),
			derivationRule('r2', 'b', true, 'y'),
		])
		expect(expectLogical(reasoner.reason({ a: true, b: true }, definition)).count).toBe(2)
	})

	it('derived conclusions become facts for later passes (multi-iteration chaining)', () => {
		const definition = logicalDefinition('d', 'd', [
			rule('income', [atom('annualIncome', 'from', 50000)], atom('incomeOk', 'equals', true)),
			rule('credit', [atom('creditScore', 'from', 700)], atom('creditOk', 'equals', true)),
			rule(
				'approve',
				[atom('incomeOk', 'equals', true), atom('creditOk', 'equals', true)],
				atom('approved', 'equals', true),
			),
		])
		const result = expectLogical(
			reasoner.reason({ annualIncome: 75000, creditScore: 720 }, definition),
		)
		expect(result.conclusion).toBe(true)
		expect(result.count).toBe(3)
	})

	it('chains a three-hop derivation a → b → c → d', () => {
		const definition = logicalDefinition('d', 'd', [
			derivationRule('ra', 'a', true, 'b'),
			derivationRule('rb', 'b', true, 'c'),
			derivationRule('rc', 'c', true, 'd'),
		])
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.conclusion).toBe(true)
		expect(result.count).toBe(3)
	})

	it('the depth cap TRUNCATES the fixpoint — one hop per iteration, no convergence trace', () => {
		// The overlay snapshots per iteration, so depth 1 derives ONLY b; the final
		// re-evaluation then sees {a, b} — ra and rb fire, rc (needing c) does not.
		const definition = logicalDefinition(
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
		expect(result.conclusion).toBe(false)
		expect(result.success).toBe(true)
	})

	it('depth 0 runs ZERO fixpoint iterations — results still evaluate the raw subject', () => {
		const chain = logicalDefinition(
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
		expect(truncated.conclusion).toBe(false)

		// A directly-satisfied LAST rule still concludes true without any iteration.
		const direct = logicalDefinition('d', 'd', [derivationRule('ra', 'a', true, 'b')], { depth: 0 })
		const satisfied = expectLogical(reasoner.reason({ a: true }, direct))
		expect(satisfied.trace).toEqual([])
		expect(satisfied.count).toBe(1)
		expect(satisfied.conclusion).toBe(true)
	})

	it('a NaN-valued conclusion derives ONCE and the fixpoint converges (SameValueZero)', () => {
		const definition = logicalDefinition('d', 'd', [
			rule('rn', [atom('x', 'equals', true)], atom('n', 'equals', Number.NaN)),
		])
		const result = expectLogical(reasoner.reason({ x: true }, definition))
		const derivations = result.trace.filter((entry) => entry.includes('derived: n=NaN'))
		expect(derivations).toHaveLength(1)
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(true)
		expect(result.success).toBe(true)
	})

	it('multiple premises on one rule are AND-ed', () => {
		const definition = logicalDefinition('d', 'd', [
			rule(
				'both',
				[atom('a', 'equals', true), atom('b', 'equals', true)],
				atom('ok', 'equals', true),
			),
		])
		const result = expectLogical(reasoner.reason({ a: true, b: false }, definition))
		expect(result.conclusion).toBe(false)
		expect(result.count).toBe(0)
	})

	it('an ARRAY-path conclusion derives the dot-joined key a dotted-STRING premise reads', () => {
		const definition = logicalDefinition('d', 'd', [
			rule('flag', [atom('go', 'equals', true)], atom(['flags', 'ok'], 'equals', true)),
			rule('done', [atom('flags.ok', 'equals', true)], atom('done', 'equals', true)),
		])
		const result = expectLogical(reasoner.reason({ go: true }, definition))
		expect(result.conclusion).toBe(true)
		expect(result.count).toBe(2)
		expect(result.trace).toContain('Rule "flag" derived: flags.ok=true (iteration 1)')
	})

	it('disabled rules are excluded from the results ENTIRELY (not just unapplied)', () => {
		const definition = logicalDefinition('d', 'd', [
			rule('off', [atom('a', 'equals', true)], atom('b', 'equals', true), { enabled: false }),
		])
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.rules).toHaveLength(0)
		expect(result.conclusion).toBe(false)
		expect(result.trace).toContain('Skipped rule "off" (disabled)')
	})

	it('traces convergence — after firing once and when nothing fires at all', () => {
		const oneRule = logicalDefinition('d', 'd', [derivationRule('r1', 'a', true, 'b')])
		const firing = expectLogical(reasoner.reason({ a: true }, oneRule))
		expect(firing.trace.some((entry) => entry.includes('converged'))).toBe(true)

		const idle = expectLogical(reasoner.reason({}, oneRule))
		expect(idle.count).toBe(0)
		expect(idle.trace.some((entry) => entry.includes('converged'))).toBe(true)
	})

	it('exposes the rule-result shape (id / applied / premises / conclusion)', () => {
		const definition = logicalDefinition('d', 'd', [derivationRule('r1', 'a', true, 'b')])
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.rules).toHaveLength(1)
		expect(result.rules[0]).toEqual({ id: 'r1', applied: true, premises: [true], conclusion: true })
	})

	it('runs rules in ascending priority order — lower number first (trace-observable)', () => {
		const definition = logicalDefinition('d', 'd', [
			rule('r-low', [atom('x', 'equals', true)], atom('low', 'equals', true), { priority: 10 }),
			rule('r-high', [atom('x', 'equals', true)], atom('high', 'equals', true), { priority: 1 }),
		])
		const result = expectLogical(reasoner.reason({ x: true }, definition))
		expect(result.count).toBe(2)
		const highAt = result.trace.findIndex((entry) => entry.includes('"r-high"'))
		const lowAt = result.trace.findIndex((entry) => entry.includes('"r-low"'))
		expect(highAt).toBeGreaterThanOrEqual(0)
		expect(highAt).toBeLessThan(lowAt)
	})

	it('a NEGATIVE priority sorts before the default-0 rule', () => {
		const definition = logicalDefinition('d', 'd', [
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
		const result = expectLogical(reasoner.reason({}, logicalDefinition('d', 'd', [])))
		expect(result.trace).toContain('No rules defined')
		expect(result.conclusion).toBe(false)
		expect(result.success).toBe(true)
	})
})

describe('LogicalReasoner — compound operators (eager evaluation)', () => {
	// One rule whose single premise is the given compound; conclusion `ok`.
	function compoundDefinition(premise: Expression) {
		return logicalDefinition('d', 'd', [rule('r1', [premise], atom('ok', 'equals', true))])
	}

	it('and / or resolve over their operands', () => {
		const both = compoundDefinition(
			compound('and', [atom('a', 'equals', true), atom('b', 'equals', true)]),
		)
		expect(expectLogical(reasoner.reason({ a: true, b: true }, both)).conclusion).toBe(true)
		expect(expectLogical(reasoner.reason({ a: true, b: false }, both)).conclusion).toBe(false)

		const either = compoundDefinition(
			compound('or', [atom('a', 'equals', true), atom('b', 'equals', true)]),
		)
		expect(expectLogical(reasoner.reason({ a: false, b: true }, either)).conclusion).toBe(true)
		expect(expectLogical(reasoner.reason({ a: false, b: false }, either)).conclusion).toBe(false)
	})

	it('not negates its first operand — and is vacuously true on empty operands', () => {
		const negated = compoundDefinition(compound('not', [atom('a', 'equals', true)]))
		expect(expectLogical(reasoner.reason({ a: false }, negated)).conclusion).toBe(true)
		expect(expectLogical(reasoner.reason({ a: true }, negated)).conclusion).toBe(false)

		const vacuous = compoundDefinition(compound('not', []))
		expect(expectLogical(reasoner.reason({}, vacuous)).conclusion).toBe(true)
	})

	it('implies follows the material-implication truth table (vacuous truth included)', () => {
		const implication = compoundDefinition(
			compound('implies', [atom('p', 'equals', true), atom('q', 'equals', true)]),
		)
		expect(expectLogical(reasoner.reason({ p: true, q: true }, implication)).conclusion).toBe(true)
		expect(expectLogical(reasoner.reason({ p: false, q: false }, implication)).conclusion).toBe(
			true,
		)
		expect(expectLogical(reasoner.reason({ p: true, q: false }, implication)).conclusion).toBe(
			false,
		)
	})

	it('xor follows the full exclusive-or truth table', () => {
		const exclusive = compoundDefinition(
			compound('xor', [atom('p', 'equals', true), atom('q', 'equals', true)]),
		)
		expect(expectLogical(reasoner.reason({ p: true, q: false }, exclusive)).conclusion).toBe(true)
		expect(expectLogical(reasoner.reason({ p: false, q: true }, exclusive)).conclusion).toBe(true)
		expect(expectLogical(reasoner.reason({ p: true, q: true }, exclusive)).conclusion).toBe(false)
		expect(expectLogical(reasoner.reason({ p: false, q: false }, exclusive)).conclusion).toBe(false)
	})

	it('evaluates deeply nested compounds', () => {
		const nested = compoundDefinition(
			compound('and', [
				compound('or', [atom('a', 'equals', true), atom('b', 'equals', true)]),
				compound('not', [atom('c', 'equals', true)]),
			]),
		)
		expect(expectLogical(reasoner.reason({ a: true, b: false, c: false }, nested)).conclusion).toBe(
			true,
		)
		expect(
			expectLogical(reasoner.reason({ a: false, b: false, c: false }, nested)).conclusion,
		).toBe(false)
	})
})

describe('LogicalReasoner — backward chaining', () => {
	it('proves a goal whose premise the subject satisfies', () => {
		const definition = logicalDefinition(
			'd',
			'd',
			[rule('adult', [atom('age', 'equals', 25)], atom('isAdult', 'equals', true))],
			{ strategy: 'backward' },
		)
		expect(expectLogical(reasoner.reason({ age: 25 }, definition)).conclusion).toBe(true)
		expect(expectLogical(reasoner.reason({ age: 30 }, definition)).conclusion).toBe(false)
	})

	it('proves multiple independent rules', () => {
		const definition = logicalDefinition(
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
		expect(result.conclusion).toBe(true)
		expect(result.count).toBe(3)
	})

	it('chains a three-hop backward derivation from a single base fact', () => {
		const definition = logicalDefinition(
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
		expect(result.conclusion).toBe(true)
		expect(result.count).toBe(3)
	})

	it('recursively proves sub-goals through rules declared AFTER the goal', () => {
		// rc needs b, which only rb can derive — goal-driven search finds it.
		const definition = logicalDefinition(
			'd',
			'd',
			[derivationRule('rc', 'b', true, 'c'), derivationRule('rb', 'a', true, 'b')],
			{ strategy: 'backward' },
		)
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.conclusion).toBe(true)
		expect(result.count).toBe(2)
	})

	it('skips disabled rules (one result of two)', () => {
		const definition = logicalDefinition(
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
		const definition = logicalDefinition(
			'd',
			'd',
			[
				rule(
					'r1',
					[
						compound('and', [
							atom('a', 'equals', true),
							compound('or', [atom('b', 'equals', true), atom('c', 'equals', true)]),
						]),
					],
					atom('ok', 'equals', true),
				),
			],
			{ strategy: 'backward' },
		)
		expect(
			expectLogical(reasoner.reason({ a: true, b: false, c: true }, definition)).conclusion,
		).toBe(true)
		expect(
			expectLogical(reasoner.reason({ a: true, b: false, c: false }, definition)).conclusion,
		).toBe(false)
	})

	it('is CYCLE-SAFE — mutually recursive rules terminate', () => {
		const definition = logicalDefinition(
			'd',
			'd',
			[derivationRule('ra', 'a', true, 'b'), derivationRule('rb', 'b', true, 'a')],
			{ strategy: 'backward' },
		)
		const result = expectLogical(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.conclusion).toBe(false)
	})

	it('traces the exact backward formats — derived and does-not-hold', () => {
		const definition = logicalDefinition(
			'd',
			'd',
			[derivationRule('r1', 'a', true, 'b'), derivationRule('r2', 'z', true, 'y')],
			{ strategy: 'backward' },
		)
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.trace).toContain('Rule "r1" derived: b=true (backward, depth 0)')
		expect(result.trace).toContain('Rule "r2": does not hold (backward, depth 0)')
	})

	it('an EMPTY-premises rule fires VACUOUSLY backward (forward reports it instead)', () => {
		const definition = logicalDefinition('d', 'd', [rule('vac', [], atom('v', 'equals', true))], {
			strategy: 'backward',
		})
		const result = expectLogical(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.errors).toEqual([])
		expect(result.conclusion).toBe(true)
		expect(result.rules).toEqual([{ id: 'vac', applied: true, premises: [], conclusion: true }])
		expect(result.trace).toContain('Rule "vac" derived: v=true (backward, depth 0)')
	})

	it('a MISSING-premises rule errors and is excluded backward (graceful, no crash)', () => {
		const result = expectLogical(
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [
				{ a: true },
				{
					reasoning: 'logical',
					id: 'd',
					name: 'd',
					strategy: 'backward',
					rules: [
						{ id: 'r1', name: 'r1', conclusion: atom('x', 'equals', true) },
						rule('ok', [atom('a', 'equals', true)], atom('b', 'equals', true)),
					],
				},
			]),
		)
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Rule "r1" has no premises — skipped'])
		// The valid sibling still proves; the malformed rule is absent from results.
		expect(result.rules.map((entry) => entry.id)).toEqual(['ok'])
		expect(result.count).toBe(1)
	})
})

describe('LogicalReasoner — degenerate rules & malformed shapes', () => {
	it('a premise-less rule errors once and is excluded (forward)', () => {
		const definition = logicalDefinition('d', 'd', [rule('r1', [], atom('x', 'equals', true))])
		const result = expectLogical(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Rule "r1" has no premises — skipped')
		expect(result.rules).toHaveLength(0)
	})

	it('duplicate ids: a degenerate rule ID-POISONS its valid twin (forward quirk, warned by validate)', () => {
		// The forward exclusion set is keyed by rule id — the premise-less 'dup'
		// silently disables the satisfiable 'dup' sharing its id.
		const definition = logicalDefinition('d', 'd', [
			rule('dup', [], atom('x', 'equals', true)),
			derivationRule('dup', 'a', true, 'b'),
		])
		const result = expectLogical(reasoner.reason({ a: true }, definition))
		expect(result.rules).toEqual([])
		expect(result.count).toBe(0)
		expect(result.errors).toEqual(['Rule "dup" has no premises — skipped'])
	})

	it('a conclusion-less rule errors and is excluded (forward and backward)', () => {
		const malformed = {
			reasoning: 'logical',
			id: 'd',
			name: 'd',
			rules: [{ id: 'r1', name: 'r1', premises: [atom('a', 'equals', true)] }],
		}
		const forward = expectLogical(
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [
				{ a: true },
				{ ...malformed, strategy: 'forward' },
			]),
		)
		expect(forward.errors).toContain('Rule "r1" has no conclusion — skipped')

		const backward = expectLogical(
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [
				{ a: true },
				{ ...malformed, strategy: 'backward' },
			]),
		)
		expect(backward.errors).toContain('Rule "r1" has no conclusion — skipped')
	})

	it('MISMATCH: the wrong reasoning THROWS a coded ReasonError with context', () => {
		const error = captureError(() =>
			reasoner.reason({}, quantitativeDefinition('other', 'Other', [])),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')
		expect(error.message).toBe('Expected logical definition, got "quantitative"')
		expect(error.context).toEqual({ definition: 'other', reasoning: 'logical' })
	})

	it('a malformed shape (missing rules) is a FAILURE RESULT, not a throw', () => {
		const result = expectLogical(
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [
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
	const sixHopChain = sequence(6, 1).map((index) =>
		derivationRule(`r${index}`, `k${index - 1}`, true, `k${index}`),
	)

	function runAtDepth(depth: number) {
		return expectLogical(
			reasoner.reason({ k0: true }, logicalDefinition('d', 'd', sixHopChain, { depth })),
		)
	}

	it('depth N-2 (4) truncates the overlay AND drops the final count — k5/k6 unreached', () => {
		const result = runAtDepth(4)
		expect(result.trace).toContain('Rule "r4" derived: k4=true (iteration 4)')
		expect(result.trace.some((entry) => entry.includes('k5=true'))).toBe(false)
		expect(result.trace.some((entry) => entry.includes('k6='))).toBe(false)
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(false)
		// Final overlay {k0..k4} fires r1..r5; r6 (needs k5) does not.
		expect(result.count).toBe(5)
		expect(result.conclusion).toBe(false)
	})

	it('depth N-1 (5): k6 never enters the OVERLAY yet the final re-eval still fires r6 off k5', () => {
		const result = runAtDepth(5)
		expect(result.trace).toContain('Rule "r5" derived: k5=true (iteration 5)')
		// The overlay stops at k5 — k6 is never derived as a fact…
		expect(result.trace.some((entry) => entry.includes('k6='))).toBe(false)
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(false)
		// …but the final re-evaluation reads k5 and fires r6, so count/conclusion are FULL.
		expect(result.count).toBe(6)
		expect(result.conclusion).toBe(true)
	})

	it('depth exactly N (6) derives the full chain and exhausts the loop WITHOUT a converge trace', () => {
		const result = runAtDepth(6)
		expect(result.trace).toContain('Rule "r6" derived: k6=true (iteration 6)')
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(false)
		expect(result.count).toBe(6)
		expect(result.conclusion).toBe(true)
	})

	it('depth much larger than needed (50) converges EARLY at iteration 7', () => {
		const result = runAtDepth(50)
		expect(result.trace).toContain('Rule "r6" derived: k6=true (iteration 6)')
		expect(result.trace).toContain('Forward chaining converged at iteration 7')
		expect(result.count).toBe(6)
		expect(result.conclusion).toBe(true)
	})
})

describe('LogicalReasoner — runaway rulesets still terminate at the depth cap', () => {
	it('two rules oscillating one key never converge, but the depth cap bounds the run', () => {
		// setX1/setX2 fire every pass (premise is the constant `flag`), each overwriting
		// the other's `x` — a fixpoint that NEVER settles, terminated only by `depth`.
		const oscillating = logicalDefinition(
			'd',
			'd',
			[
				rule('setX1', [atom('flag', 'equals', true)], atom('x', 'equals', 1)),
				rule('setX2', [atom('flag', 'equals', true)], atom('x', 'equals', 2)),
			],
			{ depth: 50 },
		)
		const result = expectLogical(reasoner.reason({ flag: true }, oscillating))
		// 50 iterations × 2 derivations each = 100 lines, proving the cap ran (not convergence).
		expect(result.trace.filter((entry) => entry.includes('derived: x=')).length).toBe(100)
		expect(result.trace.some((entry) => entry.includes('converged'))).toBe(false)
		expect(result.success).toBe(true)
		expect(result.count).toBe(2)
		expect(result.conclusion).toBe(true)
	})
})

describe('LogicalReasoner — large fixpoints', () => {
	it('a 100-rule interdependent chain converges at iteration 101 with full count', () => {
		const chain = sequence(100, 1).map((index) =>
			derivationRule(`r${index}`, `k${index - 1}`, true, `k${index}`),
		)
		const result = expectLogical(
			reasoner.reason({ k0: true }, logicalDefinition('d', 'd', chain, { depth: 200 })),
		)
		expect(result.trace).toContain('Forward chaining converged at iteration 101')
		expect(result.count).toBe(100)
		expect(result.conclusion).toBe(true)
		expect(result.success).toBe(true)
	})

	it('100 independent rules all fire from the base subject and converge in one hop', () => {
		const wide = sequence(100, 1).map((index) =>
			derivationRule(`w${index}`, 'base', true, `d${index}`),
		)
		const result = expectLogical(reasoner.reason({ base: true }, logicalDefinition('d', 'd', wide)))
		expect(result.count).toBe(100)
		expect(result.conclusion).toBe(true)
		expect(result.trace).toContain('Forward chaining converged at iteration 2')
	})
})

describe('LogicalReasoner — deep compound nesting', () => {
	// A 500-deep single-operand `and` chain around one atom — the eager evaluator
	// recurses one frame per level and returns (no stack overflow at this depth).
	const deeplyNested = sequence(500).reduce<Expression>(
		(inner) => compound('and', [inner]),
		atom('deep', 'equals', true),
	)
	const definition = logicalDefinition('d', 'd', [
		rule('nest', [deeplyNested], atom('ok', 'equals', true)),
	])

	it('evaluates a 500-deep compound to its innermost atom (true branch)', () => {
		const result = expectLogical(reasoner.reason({ deep: true }, definition))
		expect(result.conclusion).toBe(true)
		expect(result.count).toBe(1)
	})

	it('evaluates a 500-deep compound to its innermost atom (false branch)', () => {
		const result = expectLogical(reasoner.reason({ deep: false }, definition))
		expect(result.conclusion).toBe(false)
		expect(result.count).toBe(0)
	})
})

describe('LogicalReasoner — empty-premises forward/backward divergence', () => {
	it('the SAME empty-premises rule errors+excludes forward but applies vacuously backward', () => {
		const emptyRule = rule('vac', [], atom('v', 'equals', true))

		const forward = expectLogical(reasoner.reason({}, logicalDefinition('d', 'd', [emptyRule])))
		expect(forward.success).toBe(false)
		expect(forward.errors).toEqual(['Rule "vac" has no premises — skipped'])
		expect(forward.rules).toEqual([])
		expect(forward.conclusion).toBe(false)

		const backward = expectLogical(
			reasoner.reason({}, logicalDefinition('d', 'd', [emptyRule], { strategy: 'backward' })),
		)
		expect(backward.success).toBe(true)
		expect(backward.errors).toEqual([])
		expect(backward.conclusion).toBe(true)
		expect(backward.rules).toEqual([{ id: 'vac', applied: true, premises: [], conclusion: true }])
	})
})

describe('LogicalReasoner — unicode & adversarial derived keys round-trip', () => {
	// Emoji, combining-sequence, NFC-labile, and DOTTED-string keys (TRICKY_KEYS[6..]) —
	// each concluded by one rule and read by a downstream rule. Object keys are NOT
	// normalized, so the exact string round-trips through the derived overlay.
	it.each([...TRICKY_KEYS.slice(6)])(
		'round-trips the derived key %j through a downstream premise',
		(key) => {
			const definition = logicalDefinition('d', 'd', [
				rule('emit', [atom('go', 'equals', true)], atom(key, 'equals', true)),
				rule('read', [atom(key, 'equals', true)], atom('done', 'equals', true)),
			])
			const result = expectLogical(reasoner.reason({ go: true }, definition))
			expect(result.conclusion).toBe(true)
			expect(result.count).toBe(2)
			expect(result.trace).toContain(`Rule "emit" derived: ${key}=true (iteration 1)`)
		},
	)
})

describe('LogicalReasoner — SameValueZero convergence on signed zero', () => {
	it('deriving +0 then -0 to one key does NOT oscillate — it converges after one set', () => {
		// EXTREME_NUMBERS[0] = +0, [1] = -0. equalValues(+0, -0) is true, so the second
		// rule sees no change and the fixpoint settles (contrast the 1-vs-2 oscillation).
		const definition = logicalDefinition('d', 'd', [
			rule('setZero', [atom('go', 'equals', true)], atom('z', 'equals', EXTREME_NUMBERS[0])),
			rule('setNegZero', [atom('go', 'equals', true)], atom('z', 'equals', EXTREME_NUMBERS[1])),
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
	it('a 20-rule cycle with no base facts terminates via the visited set and depth cap', () => {
		// c_i needs k_{i+1} to conclude k_i, closing k1←k2←…←k20←k1 — unprovable, must not recurse forever.
		const cycle = sequence(20, 1).map((index) => {
			const next = (index % 20) + 1
			return rule(
				`c${index}`,
				[atom(`k${next}`, 'equals', true)],
				atom(`k${index}`, 'equals', true),
			)
		})
		const result = expectLogical(
			reasoner.reason({}, logicalDefinition('d', 'd', cycle, { strategy: 'backward' })),
		)
		expect(result.success).toBe(true)
		expect(result.conclusion).toBe(false)
		expect(result.count).toBe(0)
	})
})

describe('LogicalReasoner — priority extremes', () => {
	it('fractional and ±Infinity priorities order forward firing ascending', () => {
		const definition = logicalDefinition('d', 'd', [
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
		const definition = logicalDefinition('d', 'd', [
			derivationRule('rNaN', 'x', true, 'a', { priority: Number.NaN }),
			derivationRule('rB', 'x', true, 'b'),
			derivationRule('rC', 'x', true, 'c'),
		])
		const result = expectLogical(reasoner.reason({ x: true }, definition))
		expect(result.success).toBe(true)
		expect(result.count).toBe(3)
		expect(result.trace.some((entry) => entry.includes('"rNaN"'))).toBe(true)
	})

	it('priority decides the LAST backward-sorted rule, which sets the conclusion', () => {
		// Backward conclusion = last priority-sorted rule. `provable` holds; `unprovable` does not.
		function backwardConclusion(provablePriority: number, unprovablePriority: number): boolean {
			const definition = logicalDefinition(
				'd',
				'd',
				[
					rule('provable', [atom('a', 'equals', true)], atom('x', 'equals', true), {
						priority: provablePriority,
					}),
					rule('unprovable', [atom('missing', 'equals', true)], atom('y', 'equals', true), {
						priority: unprovablePriority,
					}),
				],
				{ strategy: 'backward' },
			)
			return expectLogical(reasoner.reason({ a: true }, definition)).conclusion
		}
		// provable first (1.5) → unprovable is last → false.
		expect(backwardConclusion(1.5, 2.5)).toBe(false)
		// provable last (2.5) → provable is last → true.
		expect(backwardConclusion(2.5, 1.5)).toBe(true)
	})
})

describe('LogicalReasoner — backward depth-cap enforcement (sub-goal proving)', () => {
	// A 6-hop chain declared in REVERSE order (r6 first, needing k5, down to r1
	// needing k0). Since the top-level loop attempts each rule at depth 0, the
	// FIRST-attempted rule (the deepest, r6) is the only one whose own proof must
	// recurse the full chain from scratch — recursing r6→r5→r4→r3→r2→r1 costs 5
	// nested `#proveExpression` calls (depth 1..5); direct facts (k0 in the
	// subject) resolve without consuming a depth level. Rules positioned later in
	// the array benefit from facts already committed by an earlier rule's
	// (successful, sub-cap) recursive proof, so only the OVER-cap prefix of the
	// chain (here r6 and r5) actually fails.
	function sixHopChain() {
		return sequence(6, 1)
			.map((index) => derivationRule(`r${index}`, `k${index - 1}`, true, `k${index}`))
			.reverse()
	}

	function ruleConclusion(id: string, depth: number | undefined) {
		const definition = logicalDefinition('d', 'd', sixHopChain(), {
			strategy: 'backward',
			...(depth === undefined ? {} : { depth }),
		})
		const result = expectLogical(reasoner.reason({ k0: true }, definition))
		return result.rules.find((entry) => entry.id === id)?.conclusion
	}

	it('depth 3 is insufficient — the goal (r6, needing 5 hops) is NOT proven', () => {
		const definition = logicalDefinition('d', 'd', sixHopChain(), {
			strategy: 'backward',
			depth: 3,
		})
		const result = expectLogical(reasoner.reason({ k0: true }, definition))
		expect(result.rules.find((entry) => entry.id === 'r6')).toEqual({
			id: 'r6',
			applied: false,
			premises: [false],
			conclusion: false,
		})
		expect(result.rules.find((entry) => entry.id === 'r5')).toEqual({
			id: 'r5',
			applied: false,
			premises: [false],
			conclusion: false,
		})
		expect(result.count).toBe(4)
		expect(result.success).toBe(true)
		expect(result.trace).toContain('Rule "r6": does not hold (backward, depth 0)')
		expect(result.trace).toContain('Rule "r5": does not hold (backward, depth 0)')
	})

	it('the SAME 6-hop chain at a sufficient depth (10, and the default) proves the goal', () => {
		expect(ruleConclusion('r6', 10)).toBe(true)
		expect(ruleConclusion('r6', undefined)).toBe(true)
	})

	it('pins the exact off-by-one boundary — 4 hops prove at depth 3, 5 hops (and beyond) do not (run twice, deep-equal)', () => {
		function boundary() {
			return sequence(6, 1).map((hops) => ruleConclusion(`r${hops}`, 3))
		}
		const first = boundary()
		const second = boundary()
		expect(first).toEqual(second)
		expect(first).toEqual([true, true, true, true, false, false])
	})
})

describe('LogicalReasoner — sparse compound operands', () => {
	it('a sparse "and" operand array is deterministic — holes are skipped, not thrown on', () => {
		// sparse(3, [[1, atom]]) leaves indices 0 and 2 as real holes; `.map`/`.every`
		// both skip holes, so only the atom at index 1 gates the conclusion.
		const sparseOperands = sparse<Expression>(3, [[1, atom('a', 'equals', true)]])
		const definition = logicalDefinition('d', 'd', [
			rule('r1', [compound('and', sparseOperands)], atom('ok', 'equals', true)),
		])

		const met = expectLogical(reasoner.reason({ a: true }, definition))
		expect(met.conclusion).toBe(true)
		expect(met.count).toBe(1)

		const unmet = expectLogical(reasoner.reason({ a: false }, definition))
		expect(unmet.conclusion).toBe(false)
		expect(unmet.count).toBe(0)
	})
})

describe('LogicalReasoner — sparse / junk rules array', () => {
	it('a sparse rules array forward-chains using only the present rules', () => {
		const sparseRules = sparse<Rule>(3, [
			[0, derivationRule('r1', 'a', true, 'x1')],
			[2, derivationRule('r2', 'b', true, 'x2')],
		])
		const definition = logicalDefinition('d', 'd', sparseRules)

		const result = expectLogical(reasoner.reason({ a: true, b: true }, definition))
		expect(result.count).toBe(2)
		expect(result.conclusion).toBe(true)
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
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [{ a: true, b: true }, definition]),
		)
		expect(result.success).toBe(true)
		expect(result.count).toBe(2)
		expect(result.conclusion).toBe(true)
	})

	it('a rules array containing null does not throw under backward strategy — it proves from the usable rules', () => {
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
			invokeRaw<ReasonResult>(reasoner, reasoner.reason, [{ a: true, b: true }, definition]),
		)
		expect(result.success).toBe(true)
		expect(result.count).toBe(2)
		expect(result.conclusion).toBe(true)
	})
})

describe('LogicalReasoner — deep-but-safe compound evaluation', () => {
	it('evaluates a deepCompound(1000, atom) expression without error (true and false leaves, run twice)', () => {
		function evaluate(leafValue: boolean) {
			const deep = deepCompound(1000, atom('deep', 'equals', true))
			const definition = logicalDefinition('d', 'd', [
				rule('nest', [deep], atom('ok', 'equals', true)),
			])
			return expectLogical(reasoner.reason({ deep: leafValue }, definition))
		}

		const trueFirst = evaluate(true)
		const trueSecond = evaluate(true)
		expect(trueFirst).toEqual(trueSecond)
		expect(trueFirst.conclusion).toBe(true)
		expect(trueFirst.count).toBe(1)

		const falseFirst = evaluate(false)
		const falseSecond = evaluate(false)
		expect(falseFirst).toEqual(falseSecond)
		expect(falseFirst.conclusion).toBe(false)
		expect(falseFirst.count).toBe(0)
	})
})

describe('LogicalReasoner — array-path conclusion vs array-path premise mismatch', () => {
	it('a flat derived key "flags.ok" is invisible to an ARRAY-path premise reading nested flags.ok', () => {
		// `flag` derives the FLAT overlay key 'flags.ok'; `read` reads the NESTED path
		// ['flags','ok'], which resolveField descends — the key shapes never meet.
		const definition = logicalDefinition('d', 'd', [
			rule('flag', [atom('go', 'equals', true)], atom(['flags', 'ok'], 'equals', true)),
			rule('read', [atom(['flags', 'ok'], 'equals', true)], atom('done', 'equals', true)),
		])
		const result = expectLogical(reasoner.reason({ go: true }, definition))
		expect(result.trace).toContain('Rule "flag" derived: flags.ok=true (iteration 1)')
		expect(result.trace.some((entry) => entry.includes('done='))).toBe(false)
		expect(result.count).toBe(1)
		expect(result.conclusion).toBe(false)
	})
})

describe('LogicalReasoner — builder build() output passed to supports/validate/reason (§15)', () => {
	const definition = logicalDefinition('activation', 'Activation', [
		rule('activate', [atom('active', 'equals', true)], atom('result', 'equals', true)),
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
