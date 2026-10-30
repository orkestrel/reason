import type {
	Definition,
	EvaluatorInterface,
	Expression,
	LogicalChainResult,
	LogicalDefinition,
	LogicalReasonerOptions,
	Reasoning,
	ReasonResult,
	ReasonValidationResult,
	ReasonerInterface,
	Rule,
	RuleResult,
	Subject,
} from '../types.js'
import { isArray, isObject, iterateIndices } from '@orkestrel/contract'
import {
	equalValues,
	extractConclusions,
	findDuplicates,
	findOverlayMismatches,
	formatField,
	sortByPriority,
} from '../helpers.js'
import { DEFAULT_DEPTH, LOGICAL_ID } from '../constants.js'
import { LogicalState } from '../LogicalState.js'
import { ReasonError } from '../errors.js'
import { Evaluator } from '../operators/Evaluator.js'

/**
 * Deduces booleans from rules with forward or backward chaining.
 *
 * @remarks
 * Forward chaining is a naive fixpoint capped at `depth` iterations: rules run
 * in ascending `priority` order each pass, and a firing rule's conclusion atoms
 * become a derived overlay that shadows same-named subject fields on later
 * passes (derived keys are `formatField(check.field)` strings). Convergence —
 * one full pass with no new derivation — appends a trace containing
 * `converged`. Final rule results re-evaluate against the settled overlay in
 * original rule order (forward) / priority-sorted order (backward), and the
 * overall `conclusion` is whether the last result applied. Backward chaining
 * proves every rule goal-first: an unmet premise triggers sub-goal search
 * through rules whose conclusion atoms assert the needed `field = value` pair,
 * guarded by a visited-rule set (cycle-safe) plus the depth cap; `not` succeeds
 * when its operand cannot be established (negation-as-failure) and `implies` is
 * vacuously true on an unprovable antecedent. Expression evaluation is eager
 * (no short-circuit); conclusion extraction ignores connectives — every atom
 * inside a conclusion is asserted, even under `not` / `or`. Overlay bookkeeping
 * compares with SameValueZero (`equalValues`), so a NaN-valued conclusion
 * derives once and the fixpoint converges. Nothing mutates its inputs; fully
 * deterministic.
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
 * if (result.reasoning === 'logical') result.conclusion // true
 * ```
 */
export class LogicalReasoner implements ReasonerInterface {
	readonly #id: string
	readonly #evaluator: EvaluatorInterface

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
		const errors: string[] = []
		const warnings: string[] = []

		if (definition.reasoning !== 'logical') {
			errors.push(`Expected reasoning "logical", got "${definition.reasoning}"`)
			return { valid: false, errors, warnings }
		}

		if (!definition.id) errors.push('Definition must have an id')
		if (!definition.name) errors.push('Definition must have a name')
		if (!definition.rules || definition.rules.length === 0) {
			errors.push('Definition must have at least one rule')
		}

		// Duplicate ids are warnings (runtime stays permissive: a degenerate rule
		// id-poisons its same-id twin in the forward exclusion set).
		for (const id of findDuplicates(definition.rules ?? [])) {
			warnings.push(`Duplicate rule id "${id}"`)
		}

		for (const rule of definition.rules ?? []) {
			if (!rule.id) errors.push('Rule must have an id')
			if (!rule.premises || rule.premises.length === 0) {
				warnings.push(`Rule "${rule.id}" has no premises`)
			}
			if (!rule.conclusion) {
				errors.push(`Rule "${rule.id}" must have a conclusion`)
			}
		}

		// Cross-rule overlay-key mismatch: an array-path conclusion write whose
		// flat overlay key is also read through an array-path premise elsewhere.
		for (const key of findOverlayMismatches(definition.rules ?? [])) {
			warnings.push(
				`Overlay key "${key}" is written through an array path AND also read through an array path — the flat overlay key will not resolve`,
			)
		}

		return { valid: errors.length === 0, errors, warnings }
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
				conclusion: false,
				rules: [],
				count: 0,
				success: false,
				trace: [],
				errors: ['Definition must have a "rules" array'],
			}
		}

		const trace: string[] = []
		const errors: string[] = []

		const result =
			definition.strategy === 'backward'
				? this.#backward(definition, subject, trace, errors)
				: this.#forward(definition, subject, trace, errors)

		return {
			reasoning: 'logical',
			conclusion: result.conclusion,
			rules: result.rules,
			count: result.rules.filter((rule) => rule.applied).length,
			success: errors.length === 0,
			trace,
			errors,
		}
	}

	// Data-driven fixpoint: derive until a pass adds nothing new (or depth caps),
	// then re-evaluate every runnable rule in original order for the results.
	#forward(
		definition: LogicalDefinition,
		subject: Subject,
		trace: string[],
		errors: string[],
	): LogicalChainResult {
		const maxDepth = definition.depth ?? DEFAULT_DEPTH
		const state = new LogicalState()

		if (definition.rules.length === 0) trace.push('No rules defined')

		const sortedRules = sortByPriority(definition.rules)

		// Pre-pass: a premise-less or conclusion-less rule errors once and is
		// excluded from every later pass.
		const reportedErrors = new Set(
			sortedRules.flatMap((rule) => {
				if (!isObject(rule)) return []
				if (rule.enabled === false) return []
				if (!rule.premises || rule.premises.length === 0) {
					errors.push(`Rule "${rule.id}" has no premises — skipped`)
					return [rule.id]
				} else if (!rule.conclusion) {
					errors.push(`Rule "${rule.id}" has no conclusion — skipped`)
					return [rule.id]
				}
				return []
			}),
		)

		for (const iteration of iterateIndices(() => maxDepth)) {
			const currentSubject: Subject = { ...subject, ...state.fields }

			const changed = sortedRules.reduce((previous, rule) => {
				if (rule.enabled === false) {
					trace.push(`Skipped rule "${rule.id}" (disabled)`)
					return previous
				}
				if (reportedErrors.has(rule.id)) return previous

				const ruleResult = this.#evaluateRule(rule, currentSubject)

				if (ruleResult.applied) {
					const conclusions = extractConclusions(rule.conclusion)
					return Object.entries(conclusions).reduce((updated, [key, value]) => {
						// SameValueZero — a NaN conclusion must not re-derive forever.
						if (!equalValues(state.field(key), value)) {
							state.set(key, value)
							trace.push(
								`Rule "${rule.id}" derived: ${key}=${String(value)} (iteration ${iteration + 1})`,
							)
							return true
						}
						return updated
					}, previous)
				}
				return previous
			}, false)

			if (!changed) {
				trace.push(`Forward chaining converged at iteration ${iteration + 1}`)
				break
			}
		}

		const finalSubject: Subject = { ...subject, ...state.fields }
		const finalResults = Iterator.from(definition.rules)
			.flatMap((rule) => {
				if (!isObject(rule)) return []
				if (rule.enabled === false) return []
				if (reportedErrors.has(rule.id)) return []
				return [this.#evaluateRule(rule, finalSubject)]
			})
			.toArray()

		const conclusion =
			finalResults.length > 0 ? (finalResults[finalResults.length - 1]?.applied ?? false) : false

		return { conclusion, rules: finalResults }
	}

	// Goal-driven proving over every rule in priority order, sharing a growing
	// derived overlay; the visited-rule set plus the depth cap keep cycles safe.
	#backward(
		definition: LogicalDefinition,
		subject: Subject,
		trace: string[],
		errors: string[],
	): LogicalChainResult {
		const maxDepth = definition.depth ?? DEFAULT_DEPTH
		const state = new LogicalState()

		if (definition.rules.length === 0) trace.push('No rules defined')

		const sortedRules = sortByPriority(
			definition.rules.filter((rule) => {
				if (!isObject(rule)) return false
				if (rule.enabled === false) return false
				// A missing / non-array premises cannot be walked — errored and
				// excluded. An empty premises array is kept: backward applies it
				// vacuously (forward reports it instead).
				if (!isArray(rule.premises)) {
					errors.push(`Rule "${rule.id}" has no premises — skipped`)
					return false
				}
				if (!rule.conclusion) {
					errors.push(`Rule "${rule.id}" has no conclusion — skipped`)
					return false
				}
				return true
			}),
		)

		for (const rule of definition.rules) {
			if (!isObject(rule)) continue
			if (rule.enabled === false) trace.push(`Skipped rule "${rule.id}" (disabled)`)
		}

		for (const rule of sortedRules) {
			this.#proveRule(rule, 0, new Set(), sortedRules, state, subject, trace, maxDepth)
		}

		const finalResults = sortedRules.map(
			(rule) => state.rule(rule.id) ?? this.#evaluateRule(rule, { ...subject, ...state.fields }),
		)

		const conclusion =
			finalResults.length > 0 ? (finalResults[finalResults.length - 1]?.applied ?? false) : false

		return { conclusion, rules: finalResults }
	}

	// Prove one rule against the shared backward-chaining overlay.
	#proveRule(
		rule: Rule,
		depth: number,
		visited: ReadonlySet<string>,
		rules: readonly Rule[],
		state: LogicalState,
		subject: Subject,
		trace: string[],
		maxDepth: number,
	): boolean {
		if (depth > maxDepth) return false
		if (visited.has(rule.id)) return false

		const nextVisited = new Set([...visited, rule.id])

		const currentSubject: Subject = { ...subject, ...state.fields }
		const premiseResults = Iterator.from(rule.premises)
			.map((premise) =>
				this.#establish(
					premise,
					currentSubject,
					rules,
					depth + 1,
					nextVisited,
					state,
					subject,
					trace,
					maxDepth,
				),
			)
			.toArray()

		const allMet = premiseResults.every(Boolean)

		state.record({ id: rule.id, applied: allMet, premises: premiseResults })

		if (allMet) {
			const conclusions = extractConclusions(rule.conclusion)
			for (const [key, value] of Object.entries(conclusions)) {
				// SameValueZero — a NaN conclusion derives (and traces) once.
				if (!equalValues(state.field(key), value)) {
					state.set(key, value)
					trace.push(
						`Rule "${rule.id}" derived: ${key}=${String(value)} (backward, depth ${depth})`,
					)
				}
			}
		} else {
			trace.push(`Rule "${rule.id}": does not hold (backward, depth ${depth})`)
		}

		return allMet
	}

	// Evaluate an expression against a settled overlay, then fall back to
	// sub-goal proving — the shared establish step of every backward branch.
	#establish(
		expression: Expression,
		currentSubject: Subject,
		rules: readonly Rule[],
		depth: number,
		visited: ReadonlySet<string>,
		state: LogicalState,
		subject: Subject,
		trace: string[],
		maxDepth: number,
	): boolean {
		if (this.#evaluateExpression(expression, currentSubject)) return true
		return this.#proveExpression(expression, rules, depth, visited, state, subject, trace, maxDepth)
	}

	// Sub-goal search: establish an atom by firing rules whose conclusion atoms
	// assert the needed field = value pair; compounds get connective-aware proving.
	// The depth cap mirrors the top-level `prove` guard — a sub-goal past
	// `maxDepth` fails (unproven), never throws.
	#proveExpression(
		expression: Expression,
		rules: readonly Rule[],
		depth: number,
		visited: ReadonlySet<string>,
		state: LogicalState,
		subject: Subject,
		trace: string[],
		maxDepth: number,
	): boolean {
		if (depth > maxDepth) return false

		if (expression.form === 'atom') {
			for (const rule of rules) {
				if (!isObject(rule)) continue
				if (visited.has(rule.id)) continue
				const conclusionFacts = extractConclusions(rule.conclusion)
				const field = formatField(expression.check.field)
				const value = expression.check.value

				if (field in conclusionFacts && conclusionFacts[field] === value) {
					const nextVisited = new Set([...visited, rule.id])

					const currentSubject: Subject = { ...subject, ...state.fields }
					const premiseResults: boolean[] = []
					const allMet = Iterator.from(rule.premises).every((premise) => {
						const met = this.#establish(
							premise,
							currentSubject,
							rules,
							depth + 1,
							nextVisited,
							state,
							subject,
							trace,
							maxDepth,
						)
						premiseResults.push(met)
						return met
					})

					state.record({ id: rule.id, applied: allMet, premises: premiseResults })

					if (allMet) {
						for (const [key, entry] of Object.entries(conclusionFacts)) {
							// SameValueZero — a NaN conclusion derives (and traces) once.
							if (!equalValues(state.field(key), entry)) {
								state.set(key, entry)
								trace.push(
									`Rule "${rule.id}" derived: ${key}=${String(entry)} (backward, depth ${depth})`,
								)
							}
						}
						return true
					}
				}
			}
		}

		if (expression.form === 'compound') {
			const currentSubject: Subject = { ...subject, ...state.fields }

			switch (expression.operator) {
				case 'and':
					return expression.operands.every((operand) =>
						this.#establish(
							operand,
							currentSubject,
							rules,
							depth,
							visited,
							state,
							subject,
							trace,
							maxDepth,
						),
					)
				case 'or':
					return expression.operands.some((operand) =>
						this.#establish(
							operand,
							currentSubject,
							rules,
							depth,
							visited,
							state,
							subject,
							trace,
							maxDepth,
						),
					)
				case 'not': {
					// Negation-as-failure: succeeds when the operand cannot be established.
					if (expression.operands.length === 0) return true
					const first = expression.operands[0]
					if (!first) return true
					return !this.#establish(
						first,
						currentSubject,
						rules,
						depth,
						visited,
						state,
						subject,
						trace,
						maxDepth,
					)
				}
				case 'implies': {
					// Vacuously true when the antecedent cannot be established.
					if (expression.operands.length < 2) return true
					const antecedent = expression.operands[0]
					const consequent = expression.operands[1]
					if (!antecedent || !consequent) return true
					const antecedentMet = this.#establish(
						antecedent,
						currentSubject,
						rules,
						depth,
						visited,
						state,
						subject,
						trace,
						maxDepth,
					)
					if (!antecedentMet) return true
					return this.#establish(
						consequent,
						currentSubject,
						rules,
						depth,
						visited,
						state,
						subject,
						trace,
						maxDepth,
					)
				}
				case 'xor': {
					if (expression.operands.length < 2) return false
					const left = expression.operands[0]
					const right = expression.operands[1]
					if (!left || !right) return false
					const leftMet = this.#establish(
						left,
						currentSubject,
						rules,
						depth,
						visited,
						state,
						subject,
						trace,
						maxDepth,
					)
					const rightMet = this.#establish(
						right,
						currentSubject,
						rules,
						depth,
						visited,
						state,
						subject,
						trace,
						maxDepth,
					)
					return leftMet !== rightMet
				}
				default:
					return false
			}
		}

		return false
	}

	// A rule applies exactly when every premise holds; a premise-less or
	// conclusion-less rule never applies.
	#evaluateRule(rule: Rule, subject: Subject): RuleResult {
		if (!rule.premises || rule.premises.length === 0) {
			return { id: rule.id, applied: false, premises: [] }
		}
		if (!rule.conclusion) {
			return { id: rule.id, applied: false, premises: [] }
		}

		const premiseResults = rule.premises.map((premise) =>
			this.#evaluateExpression(premise, subject),
		)

		return { id: rule.id, applied: premiseResults.every(Boolean), premises: premiseResults }
	}

	// Eager evaluation (no short-circuit): `not` reads only its first operand
	// (empty → vacuously true); `implies` / `xor` read their first two.
	#evaluateExpression(expression: Expression, subject: Subject): boolean {
		if (expression.form === 'atom') {
			return this.#evaluator.evaluate(expression.check, subject).met
		}

		const results = expression.operands.map((operand) => this.#evaluateExpression(operand, subject))

		switch (expression.operator) {
			case 'and':
				return results.every(Boolean)
			case 'or':
				return results.some(Boolean)
			case 'not':
				return results.length > 0 ? !results[0] : true
			case 'implies':
				return results.length < 2 ? true : !results[0] || (results[1] ?? false)
			case 'xor':
				return results.length < 2 ? false : results[0] !== results[1]
			default:
				return false
		}
	}
}
