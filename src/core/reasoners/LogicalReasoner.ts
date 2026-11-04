import type { AuditFault } from '@orkestrel/contract'
import type {
	Check,
	CheckResult,
	CheckState,
	Definition,
	EvaluatorInterface,
	Expression,
	LogicalDefinition,
	LogicalReasonerOptions,
	Reasoning,
	ReasonResult,
	ReasonValidationResult,
	ReasonerInterface,
	Rule,
	RuleResult,
	Subject,
	SubjectAdmission,
} from '../types.js'
import { isArray, isObject } from '@orkestrel/contract'
import {
	buildRefusedResult,
	collectConcluders,
	collectReachable,
	combineStates,
	describeFault,
	equalValues,
	extractAtoms,
	extractConclusions,
	filterUniqueFaults,
	findDuplicates,
	findNegativeCycles,
	findSuppliedConclusions,
	formatField,
	readClosedState,
	readExpectedKind,
	scanConclusion,
	scanExpression,
	scanShape,
	scanShapeConclusions,
	scanShapeReads,
	sortByPriority,
	valueToFault,
} from '../helpers.js'
import { DEFAULT_DEPTH, LOGICAL_ID } from '../constants.js'
import { LogicalState } from '../LogicalState.js'
import { ReasonError } from '../errors.js'
import { SubjectDoor } from '../SubjectDoor.js'
import { Evaluator } from '../operators/Evaluator.js'
import { isLogicalDefinition, isRule } from '../validators.js'

/**
 * Deduces states from rules with forward or backward chaining, refusing what it cannot read.
 *
 * @remarks
 * An atom on an input field reads through the evaluator, and a field it cannot read is
 * `unread`. A connective combines its operands in strong Kleene logic, so `unread` survives
 * only where the answer could still change. Closed-world covers one thing: a key an enabled
 * rule of the same definition concludes.
 *
 * Forward chaining runs in two phases. An atom on a conclusion key no rule has derived reads
 * `unread`, so a rule reading it holds, and rules fire to convergence. Then every such key whose
 * concluding rules have all settled unmet closes (`equals` and `any` unmet, `not` and `none` met,
 * ordering and range unread), and held rules run again. A key no rule can settle because it
 * only waits on itself closes too, so a positive cycle is unmet rather than stuck. Rules fire
 * from one snapshot per pass, in ascending `priority` order. Deriving a key a fired rule read as
 * closed refuses as unstratified, and hitting `depth` refuses.
 *
 * Backward chaining proves each rule goal-first. An atom on an underived conclusion key tries the
 * rules concluding that key, matched by field alone, and the atom re-reads the overlay once one
 * fires, so `score above 5` never proves through `score equals 5`. A key nothing can prove closes
 * as above, and a candidate left `unread` leaves the goal `unread`. A visited rule reads `unread`,
 * which breaks a cycle without answering it, and settling then closes it as forward does.
 *
 * A subject may not supply a conclusion key, because that would assert what a rule has to derive.
 * Any rule left `unread` refuses the run: `success` is false, `errors` holds one entry per input
 * field, and `faults` lists those fields. A definition with a `shape` admits its subject through
 * the door first. Nothing mutates its inputs; fully deterministic.
 *
 * @example
 * ```ts
 * import {
 * 	createAtom,
 * 	createLogicalDefinition,
 * 	createLogicalReasoner,
 * 	createRule,
 * } from '@orkestrel/reason'
 *
 * const reasoner = createLogicalReasoner()
 * const definition = createLogicalDefinition('e', 'Eligibility', [
 * 	createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
 * ])
 * reasoner.supports(definition) // true
 * reasoner.validate(definition).valid // true
 * const result = reasoner.reason({ age: 25 }, definition)
 * if (result.reasoning === 'logical') result.conclusion // 'met'
 * ```
 */
export class LogicalReasoner implements ReasonerInterface {
	readonly #id: string
	readonly #evaluator: EvaluatorInterface
	readonly #door = new SubjectDoor()

	constructor(options?: LogicalReasonerOptions) {
		this.#id = options?.id ?? LOGICAL_ID
		this.#evaluator = options?.evaluator ?? new Evaluator()
	}

	get id(): string {
		return this.#id
	}

	get reasoning(): Reasoning {
		return 'logical'
	}

	supports(definition: Definition): boolean {
		return definition.reasoning === 'logical'
	}

	validate(definition: Definition): ReasonValidationResult {
		if (definition.reasoning !== 'logical') {
			return {
				valid: false,
				errors: [`Expected reasoning "logical", got "${definition.reasoning}"`],
				warnings: [],
			}
		}
		const rules: unknown = definition.rules
		if (!isLogicalDefinition(definition)) {
			const entries: readonly unknown[] = isArray(rules) ? rules : []
			return {
				valid: false,
				errors: [
					'Definition does not match the logical definition shape',
					...entries.flatMap((rule, index) =>
						isRule(rule) ? [] : [`Rule at index ${String(index)} is malformed`],
					),
				],
				warnings: [],
			}
		}
		const enabled = definition.rules.filter((rule) => rule.enabled !== false)
		const cycles = findNegativeCycles(enabled)
		const shape = definition.shape
		const reads = enabled.flatMap((rule) =>
			rule.premises.flatMap((premise) => extractAtoms(premise)).map((atom) => atom.check),
		)
		const scan =
			shape === undefined
				? { errors: [], warnings: [] }
				: scanShapeReads(shape, reads, [], new Set(collectConcluders(enabled).keys()))
		const errors = [
			...(definition.id ? [] : ['Definition must have an id']),
			...(definition.name ? [] : ['Definition must have a name']),
			...(definition.rules.length === 0 ? ['Definition must have at least one rule'] : []),
			...findDuplicates(definition.rules).map((id) => `Duplicate rule id "${id}"`),
			...definition.rules.flatMap((rule) => [
				...(rule.id ? [] : ['Rule must have an id']),
				...(rule.premises.length === 0 ? [`Rule "${rule.id}" has no premises`] : []),
				...rule.premises.flatMap((premise) => scanExpression(premise)),
				...scanConclusion(rule.conclusion),
			]),
			...(cycles.length === 0
				? []
				: [`Conclusions depend on their own negation: ${cycles.join(', ')}`]),
			...(shape === undefined
				? []
				: [...scanShape(shape), ...scanShapeConclusions(shape, enabled)]),
			...scan.errors,
		]
		return { valid: errors.length === 0, errors, warnings: scan.warnings }
	}

	reason(subject: Subject, definition: Definition): ReasonResult {
		if (definition.reasoning !== 'logical') {
			throw new ReasonError(
				'MISMATCH',
				`Expected logical definition, got "${definition.reasoning}"`,
				{ definition: definition.id, reasoning: this.reasoning },
			)
		}

		// Runtime never assumes validate() ran — a malformed shape is a failure
		// result, not a throw.
		if (!isArray(definition.rules)) {
			return {
				reasoning: 'logical',
				conclusion: 'unread',
				rules: [],
				count: 0,
				success: false,
				trace: [],
				errors: ['Definition must have a "rules" array'],
				faults: [],
				repairs: [],
				defaulted: [],
			}
		}

		const admission = this.#door.admit(subject, definition.shape)
		const admitted = admission.subject
		if (admitted === undefined) return buildRefusedResult(definition, admission)

		const trace: string[] = []
		const errors: string[] = []
		if (definition.rules.length === 0) trace.push('No rules defined')
		const rules = this.#selectRules(definition.rules, trace, errors)
		const state = new LogicalState(rules)
		const supplied = findSuppliedConclusions(rules, admitted)
		errors.push(...supplied.map((key) => `Subject supplies conclusion "${key}"`))
		if (supplied.length > 0) return this.#buildResult([], [], trace, errors, admission)

		if (definition.strategy === 'backward') {
			this.#backward(definition, rules, admitted, state, trace, errors)
		} else this.#forward(definition, rules, admitted, state, trace, errors)
		const faults = this.#collectFaults(rules, admitted, state, errors)
		const results = rules.map((rule) => this.#buildRuleResult(rule, admitted, state))
		return this.#buildResult(results, faults, trace, errors, admission)
	}

	// Keeps the rules that can run, in authored order: a disabled rule is skipped and traced, and
	// a malformed one refuses the run instead of quietly dropping what it would have decided.
	#selectRules(rules: readonly Rule[], trace: string[], errors: string[]): readonly Rule[] {
		return rules.flatMap((rule, index) => {
			if (!isObject(rule)) {
				errors.push(`Rule at index ${String(index)} is malformed`)
				return []
			}
			if (rule.enabled === false) {
				trace.push(`Skipped rule "${rule.id}" (disabled)`)
				return []
			}
			if (!isArray(rule.premises) || rule.premises.length === 0) {
				errors.push(`Rule "${rule.id}" has no premises`)
				return []
			}
			if (!rule.conclusion) {
				errors.push(`Rule "${rule.id}" has no conclusion`)
				return []
			}
			return [rule]
		})
	}

	#buildResult(
		rules: readonly RuleResult[],
		faults: readonly AuditFault[],
		trace: readonly string[],
		errors: readonly string[],
		admission: SubjectAdmission,
	): ReasonResult {
		return {
			reasoning: 'logical',
			conclusion: errors.length > 0 ? 'unread' : (rules.at(-1)?.state ?? 'unmet'),
			rules,
			count: rules.filter((rule) => rule.state === 'met').length,
			success: errors.length === 0,
			trace,
			errors,
			faults,
			repairs: admission.repairs,
			defaulted: admission.defaulted,
		}
	}

	// Phase A fires what the overlay supports, phase B closes what has settled, and each runs
	// until the other has nothing to add.
	#forward(
		definition: LogicalDefinition,
		rules: readonly Rule[],
		subject: Subject,
		state: LogicalState,
		trace: string[],
		errors: string[],
	): void {
		const depth = definition.depth ?? DEFAULT_DEPTH
		const pass = this.#settle(sortByPriority(rules), subject, state, trace, errors, 1, depth)
		if (pass === undefined) {
			errors.push(`Forward chaining did not settle within depth ${String(depth)}`)
		} else if (errors.length === 0) trace.push(`Forward chaining converged at iteration ${pass}`)
	}

	// One pass fires from one snapshot, and `depth` counts the passes that derive something.
	// Closing and observing convergence cost nothing, so a chain of exactly `depth` hops
	// settles. Every pass derives a key or closes one, so the keys bound the recursion. Returns
	// the pass that found nothing left to do, or undefined when `depth` ran out first; an error
	// ends the walk too, having refused the run.
	#settle(
		rules: readonly Rule[],
		subject: Subject,
		state: LogicalState,
		trace: string[],
		errors: string[],
		pass: number,
		depth: number,
	): number | undefined {
		const fired = rules.filter((rule) => this.#evaluateRule(rule, subject, state) === 'met')
		for (const rule of fired) this.#markClosedReads(rule, state)
		const fresh = fired.filter((rule) =>
			Object.entries(extractConclusions(rule.conclusion)).some(
				([key, value]) => !state.has(key) || !equalValues(state.field(key), value),
			),
		)
		if (fresh.length === 0) {
			return this.#close(rules, subject, state)
				? this.#settle(rules, subject, state, trace, errors, pass, depth)
				: pass
		}
		if (pass > depth) return undefined
		for (const rule of fresh) this.#derive(rule, state, trace, errors, `iteration ${pass}`)
		if (errors.length > 0) return pass
		return this.#settle(rules, subject, state, trace, errors, pass + 1, depth)
	}

	#markClosedReads(rule: Rule, state: LogicalState): void {
		for (const atom of rule.premises.flatMap((premise) => extractAtoms(premise))) {
			const key = formatField(atom.check.field)
			if (state.closed(key)) state.mark(key)
		}
	}

	// Writes a met rule's conclusions. A second value for a derived key and a key a fired rule
	// read as closed both refuse, because either would retract what is already settled.
	#derive(rule: Rule, state: LogicalState, trace: string[], errors: string[], place: string): void {
		for (const [key, value] of Object.entries(extractConclusions(rule.conclusion))) {
			if (state.has(key)) {
				if (!equalValues(state.field(key), value)) {
					errors.push(`Rule "${rule.id}" concludes a second value for "${key}"`)
				}
				continue
			}
			if (state.marked(key)) {
				errors.push(
					`Unstratified: rule "${rule.id}" concludes "${key}", which a fired rule read as closed`,
				)
				continue
			}
			state.set(key, value)
			trace.push(`Rule "${rule.id}" derived: ${key}=${String(value)} (${place})`)
		}
	}

	// Closes every open key whose concluding rules have all settled unmet. Runs only once nothing
	// fires, and the caller fires again after it, since closing a key can make a rule met. When
	// nothing settles and nothing waits on a real input, what remains only waits on itself, and
	// it closes too. True if anything closed.
	#close(rules: readonly Rule[], subject: Subject, state: LogicalState): boolean {
		const open = state.keys.filter((key) => !state.has(key) && !state.closed(key))
		const settled = open.filter((key) =>
			state.concluders(key).every((rule) => this.#evaluateRule(rule, subject, state) === 'unmet'),
		)
		const closing = settled.length > 0 ? settled : this.#findFreeKeys(rules, open, subject, state)
		for (const key of closing) state.close(key)
		return closing.length > 0
	}

	// An unread rule is blocked when it reads something no closing can supply: an input, a closed
	// key an ordering cannot use, a malformed atom. Blocking spreads to the rules that read what
	// a blocked rule concludes. An open key no blocked rule concludes is free to close once all
	// it waits on waits on it too, so a cycle closes alone and what reads it settles afterwards.
	#findFreeKeys(
		rules: readonly Rule[],
		open: readonly string[],
		subject: Subject,
		state: LogicalState,
	): readonly string[] {
		const unread = rules.filter((rule) => this.#evaluateRule(rule, subject, state) === 'unread')
		const held = new Map(
			unread.map((rule) => [
				rule,
				rule.premises.flatMap((premise) => this.#findUnreadChecks(premise, subject, state)),
			]),
		)
		const blocked = new Set(
			unread.filter((rule) => {
				const checks = held.get(rule) ?? []
				return checks.length === 0 || checks.some((check) => !this.#isOpen(check, state))
			}),
		)
		for (const rule of blocked) {
			const written = Object.keys(extractConclusions(rule.conclusion))
			for (const reader of unread) {
				const reads = (held.get(reader) ?? []).map((check) => formatField(check.field))
				if (reads.some((key) => written.includes(key))) blocked.add(reader)
			}
		}
		const waits = unread.flatMap((rule) =>
			Object.keys(extractConclusions(rule.conclusion)).flatMap((key) =>
				(held.get(rule) ?? []).map((check): readonly [string, string] => [
					key,
					formatField(check.field),
				]),
			),
		)
		return open
			.filter((key) => !state.concluders(key).some((rule) => blocked.has(rule)))
			.filter((key) =>
				[...collectReachable(key, waits)].every((other) => collectReachable(other, waits).has(key)),
			)
	}

	#isOpen(check: Check, state: LogicalState): boolean {
		const key = formatField(check.field)
		return state.concludes(key) && !state.has(key) && !state.closed(key)
	}

	// Proves every rule, then settles what the proofs left the way forward does, so both
	// strategies close the same keys. A cycle through negation is refused before any proof,
	// since a proof of one would depend on visit order.
	#backward(
		definition: LogicalDefinition,
		rules: readonly Rule[],
		subject: Subject,
		state: LogicalState,
		trace: string[],
		errors: string[],
	): void {
		const depth = definition.depth ?? DEFAULT_DEPTH
		const sorted = sortByPriority(rules)
		const cycles = findNegativeCycles(rules)
		if (cycles.length > 0) {
			errors.push(`Unstratified: conclusions depend on their own negation: ${cycles.join(', ')}`)
			return
		}
		for (const rule of sorted) {
			this.#proveRule(rule, 0, new Set(), subject, state, trace, errors, depth)
		}
		if (errors.length > 0) return
		if (this.#settle(sorted, subject, state, trace, errors, 1, depth) === undefined) {
			errors.push(`Backward chaining did not settle within depth ${String(depth)}`)
		}
	}

	#proveRule(
		rule: Rule,
		depth: number,
		visited: ReadonlySet<string>,
		subject: Subject,
		state: LogicalState,
		trace: string[],
		errors: string[],
		maxDepth: number,
	): CheckState {
		// The visited cut reads unread, which breaks the cycle without answering it: read as unmet
		// it could settle an `and` over a real unread leaf, and a negation over that would fire.
		// Settling closes the cycle afterwards, the way forward does.
		if (visited.has(rule.id)) return 'unread'
		const next = new Set([...visited, rule.id])
		const outcome = combineStates(
			'and',
			rule.premises.map((premise) =>
				this.#establish(premise, depth + 1, next, subject, state, trace, errors, maxDepth),
			),
		)
		if (outcome === 'met') this.#derive(rule, state, trace, errors, `backward, depth ${depth}`)
		else trace.push(`Rule "${rule.id}": does not hold (backward, depth ${depth})`)
		return outcome
	}

	#establish(
		expression: Expression,
		depth: number,
		visited: ReadonlySet<string>,
		subject: Subject,
		state: LogicalState,
		trace: string[],
		errors: string[],
		maxDepth: number,
	): CheckState {
		if (expression.form === 'compound') {
			return combineStates(
				expression.operator,
				expression.operands.map((operand) =>
					this.#establish(operand, depth, visited, subject, state, trace, errors, maxDepth),
				),
			)
		}
		const { check } = expression
		const key = formatField(check.field)
		if (!state.concludes(key) || state.has(key)) return this.#readCheck(check, subject, state).state
		if (depth > maxDepth) {
			const message = `Backward chaining hit depth ${String(maxDepth)} proving "${key}"`
			if (!errors.includes(message)) errors.push(message)
			return 'unread'
		}
		const outcomes: CheckState[] = []
		for (const candidate of state.concluders(key)) {
			const outcome = this.#proveRule(
				candidate,
				depth,
				visited,
				subject,
				state,
				trace,
				errors,
				maxDepth,
			)
			// Matched by field alone: the goal re-reads what the candidate actually concluded.
			if (outcome === 'met') return this.#readCheck(check, subject, state).state
			outcomes.push(outcome)
		}
		return outcomes.includes('unread') ? 'unread' : readClosedState(check.operator)
	}

	#readCheck(check: Check, subject: Subject, state: LogicalState): CheckResult {
		const key = formatField(check.field)
		if (!state.concludes(key)) return this.#evaluator.evaluate(check, subject)
		if (state.has(key)) {
			const result = this.#evaluator.evaluate({ ...check, field: key }, state.fields)
			return { ...result, field: check.field }
		}
		return {
			field: check.field,
			state: state.closed(key) ? readClosedState(check.operator) : 'unread',
			actual: undefined,
		}
	}

	#evaluateExpression(expression: Expression, subject: Subject, state: LogicalState): CheckState {
		if (expression.form === 'atom') return this.#readCheck(expression.check, subject, state).state
		return combineStates(
			expression.operator,
			expression.operands.map((operand) => this.#evaluateExpression(operand, subject, state)),
		)
	}

	#evaluateRule(rule: Rule, subject: Subject, state: LogicalState): CheckState {
		return combineStates(
			'and',
			rule.premises.map((premise) => this.#evaluateExpression(premise, subject, state)),
		)
	}

	#buildRuleResult(rule: Rule, subject: Subject, state: LogicalState): RuleResult {
		const premises = rule.premises.map((premise) =>
			this.#evaluateExpression(premise, subject, state),
		)
		return {
			id: rule.id,
			state: combineStates('and', premises),
			premises,
			checks: rule.premises
				.flatMap((premise) => extractAtoms(premise))
				.map((atom) => this.#readCheck(atom.check, subject, state)),
		}
	}

	// The atoms the answer still depends on. A settled branch is skipped, so a false `and` never
	// asks about its other operand and a true `or` never asks about its own.
	#findUnreadChecks(
		expression: Expression,
		subject: Subject,
		state: LogicalState,
	): readonly Check[] {
		if (this.#evaluateExpression(expression, subject, state) !== 'unread') return []
		if (expression.form === 'atom') return [expression.check]
		return expression.operands.flatMap((operand) => this.#findUnreadChecks(operand, subject, state))
	}

	// Names why each unread rule refused, and returns the input fields among those reasons. A
	// rule unread only through an open conclusion adds nothing, because the rule concluding that
	// key names the input. A rule with no input to name still pushes an error, so `success`
	// cannot read true beside it.
	#collectFaults(
		rules: readonly Rule[],
		subject: Subject,
		state: LogicalState,
		errors: string[],
	): readonly AuditFault[] {
		const leaves = rules.flatMap((rule) => {
			if (this.#evaluateRule(rule, subject, state) !== 'unread') return []
			const checks = rule.premises.flatMap((premise) =>
				this.#findUnreadChecks(premise, subject, state),
			)
			if (checks.length === 0) errors.push(`Rule "${rule.id}" has a malformed premise`)
			return checks.flatMap((check) => {
				const key = formatField(check.field)
				if (state.concludes(key)) {
					if (state.closed(key)) {
						errors.push(
							`Rule "${rule.id}" reads conclusion "${key}" with "${check.operator}", and no rule concluded a value`,
						)
					}
					return []
				}
				const read = this.#readCheck(check, subject, state)
				if (read.error !== undefined) {
					errors.push(`Rule "${rule.id}": ${read.error}`)
					return []
				}
				return [valueToFault(check.field, readExpectedKind(check), read.actual)]
			})
		})
		const faults = filterUniqueFaults(leaves)
		errors.push(...faults.map((fault) => describeFault(fault)))
		return faults
	}
}
