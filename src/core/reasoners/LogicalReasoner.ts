import type {
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
} from '../types.js'
import {
	equalValues,
	extractConclusions,
	findDuplicates,
	findOverlayMismatches,
	formatField,
	sortByPriority,
} from '../helpers.js'
import { DEFAULT_DEPTH, LOGICAL_ID } from '../constants.js'
import { ReasonError } from '../errors.js'
import { Evaluator } from '../operators/Evaluator.js'

/**
 * The logical reasoner — rule-based boolean deduction with forward or backward
 * chaining.
 *
 * @remarks
 * Forward chaining is a naive fixpoint capped at `depth` iterations: rules run
 * in ascending `priority` order each pass, and a firing rule's conclusion atoms
 * become a derived overlay that SHADOWS same-named subject fields on later
 * passes (derived keys are `formatField(check.field)` strings). Convergence —
 * one full pass with no new derivation — appends a trace containing
 * `converged`. Final rule results re-evaluate against the settled overlay in
 * ORIGINAL rule order (forward) / priority-sorted order (backward), and the
 * overall `conclusion` is the LAST result's conclusion. Backward chaining
 * proves EVERY rule goal-first: an unmet premise triggers sub-goal search
 * through rules whose conclusion atoms assert the needed `field = value` pair,
 * guarded by a visited-rule set (cycle-safe) plus the depth cap; `not` succeeds
 * when its operand cannot be established (negation-as-failure) and `implies` is
 * vacuously true on an unprovable antecedent. Expression evaluation is EAGER
 * (no short-circuit); conclusion extraction IGNORES connectives — every atom
 * inside a conclusion is asserted, even under `not` / `or`. Overlay bookkeeping
 * compares with SameValueZero (`equalValues`), so a NaN-valued conclusion
 * derives once and the fixpoint converges. Nothing mutates its inputs; fully
 * deterministic (AGENTS §11).
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

		// Duplicate ids are WARNINGS (runtime stays permissive: a degenerate rule
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
		// flat overlay key is also read via an array-path premise elsewhere.
		for (const key of findOverlayMismatches(definition.rules ?? [])) {
			warnings.push(
				`Overlay key "${key}" is written via an array path AND also read via an array path — the flat overlay key will not resolve`,
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
		if (!definition.rules || !Array.isArray(definition.rules)) {
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
	// then re-evaluate every runnable rule in ORIGINAL order for the results.
	#forward(
		definition: LogicalDefinition,
		subject: Subject,
		trace: string[],
		errors: string[],
	): { conclusion: boolean; rules: RuleResult[] } {
		const maxDepth = definition.depth ?? DEFAULT_DEPTH
		const derived: Record<string, unknown> = {}

		if (definition.rules.length === 0) trace.push('No rules defined')

		const sortedRules = sortByPriority(definition.rules)

		// Pre-pass: a premise-less or conclusion-less rule errors ONCE and is
		// excluded from every later pass.
		const reportedErrors = new Set<string>()
		for (const rule of sortedRules) {
			if (typeof rule !== 'object' || rule === null) continue
			if (rule.enabled === false) continue
			if (!rule.premises || rule.premises.length === 0) {
				errors.push(`Rule "${rule.id}" has no premises — skipped`)
				reportedErrors.add(rule.id)
			} else if (!rule.conclusion) {
				errors.push(`Rule "${rule.id}" has no conclusion — skipped`)
				reportedErrors.add(rule.id)
			}
		}

		for (let iteration = 0; iteration < maxDepth; iteration++) {
			let newDerivation = false
			const currentSubject: Subject = { ...subject, ...derived }

			for (const rule of sortedRules) {
				if (rule.enabled === false) {
					trace.push(`Skipped rule "${rule.id}" (disabled)`)
					continue
				}
				if (reportedErrors.has(rule.id)) continue

				const ruleResult = this.#evaluateRule(rule, currentSubject)

				if (ruleResult.applied && ruleResult.conclusion) {
					const conclusions = extractConclusions(rule.conclusion)
					for (const [key, value] of Object.entries(conclusions)) {
						// SameValueZero — a NaN conclusion must not re-derive forever.
						if (!equalValues(derived[key], value)) {
							derived[key] = value
							newDerivation = true
							trace.push(
								`Rule "${rule.id}" derived: ${key}=${String(value)} (iteration ${iteration + 1})`,
							)
						}
					}
				}
			}

			if (!newDerivation) {
				trace.push(`Forward chaining converged at iteration ${iteration + 1}`)
				break
			}
		}

		const finalSubject: Subject = { ...subject, ...derived }
		const finalResults: RuleResult[] = []
		for (const rule of definition.rules) {
			if (typeof rule !== 'object' || rule === null) continue
			if (rule.enabled === false) continue
			if (reportedErrors.has(rule.id)) continue
			finalResults.push(this.#evaluateRule(rule, finalSubject))
		}

		const conclusion =
			finalResults.length > 0 ? (finalResults[finalResults.length - 1]?.conclusion ?? false) : false

		return { conclusion, rules: finalResults }
	}

	// Goal-driven proving over EVERY rule in priority order, sharing a growing
	// derived overlay; the visited-rule set plus the depth cap keep cycles safe.
	#backward(
		definition: LogicalDefinition,
		subject: Subject,
		trace: string[],
		errors: string[],
	): { conclusion: boolean; rules: RuleResult[] } {
		const maxDepth = definition.depth ?? DEFAULT_DEPTH
		const derived: Record<string, unknown> = {}
		const ruleResults = new Map<string, RuleResult>()

		if (definition.rules.length === 0) trace.push('No rules defined')

		const sortedRules = sortByPriority(
			definition.rules.filter((rule) => {
				if (typeof rule !== 'object' || rule === null) return false
				if (rule.enabled === false) return false
				// A missing / non-array premises cannot be walked — errored and
				// excluded. An EMPTY premises array is kept: backward applies it
				// VACUOUSLY (scsr semantics — forward reports it instead).
				if (!rule.premises || !Array.isArray(rule.premises)) {
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
			if (typeof rule !== 'object' || rule === null) continue
			if (rule.enabled === false) trace.push(`Skipped rule "${rule.id}" (disabled)`)
		}

		const prove = (rule: Rule, depth: number, visited: ReadonlySet<string>): boolean => {
			if (depth > maxDepth) return false
			if (visited.has(rule.id)) return false

			const nextVisited = new Set(visited)
			nextVisited.add(rule.id)

			const currentSubject: Subject = { ...subject, ...derived }
			const premiseResults: boolean[] = []

			for (const premise of rule.premises) {
				premiseResults.push(
					this.#establish(
						premise,
						currentSubject,
						sortedRules,
						depth + 1,
						nextVisited,
						derived,
						subject,
						trace,
						ruleResults,
						maxDepth,
					),
				)
			}

			const allMet = premiseResults.every(Boolean)

			ruleResults.set(rule.id, {
				id: rule.id,
				applied: allMet,
				premises: premiseResults,
				conclusion: allMet,
			})

			if (allMet) {
				const conclusions = extractConclusions(rule.conclusion)
				for (const [key, value] of Object.entries(conclusions)) {
					// SameValueZero — a NaN conclusion derives (and traces) once.
					if (!equalValues(derived[key], value)) {
						derived[key] = value
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

		for (const rule of sortedRules) {
			prove(rule, 0, new Set())
		}

		const finalResults: RuleResult[] = []
		for (const rule of sortedRules) {
			const existing = ruleResults.get(rule.id)
			if (existing) {
				finalResults.push(existing)
			} else {
				finalResults.push(this.#evaluateRule(rule, { ...subject, ...derived }))
			}
		}

		const conclusion =
			finalResults.length > 0 ? (finalResults[finalResults.length - 1]?.conclusion ?? false) : false

		return { conclusion, rules: finalResults }
	}

	// Evaluate an expression against a settled overlay, then fall back to
	// sub-goal proving — the shared establish step of every backward branch.
	#establish(
		expression: Expression,
		currentSubject: Subject,
		rules: readonly Rule[],
		depth: number,
		visited: ReadonlySet<string>,
		derived: Record<string, unknown>,
		subject: Subject,
		trace: string[],
		ruleResults: Map<string, RuleResult>,
		maxDepth: number,
	): boolean {
		if (this.#evaluateExpression(expression, currentSubject)) return true
		return this.#proveExpression(
			expression,
			rules,
			depth,
			visited,
			derived,
			subject,
			trace,
			ruleResults,
			maxDepth,
		)
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
		derived: Record<string, unknown>,
		subject: Subject,
		trace: string[],
		ruleResults: Map<string, RuleResult>,
		maxDepth: number,
	): boolean {
		if (depth > maxDepth) return false

		if (expression.form === 'atom') {
			for (const rule of rules) {
				if (typeof rule !== 'object' || rule === null) continue
				if (visited.has(rule.id)) continue
				const conclusionFacts = extractConclusions(rule.conclusion)
				const field = formatField(expression.check.field)
				const value = expression.check.value

				if (field in conclusionFacts && conclusionFacts[field] === value) {
					const nextVisited = new Set(visited)
					nextVisited.add(rule.id)

					const currentSubject: Subject = { ...subject, ...derived }
					const premiseResults: boolean[] = []
					let allMet = true

					for (const premise of rule.premises) {
						const met = this.#establish(
							premise,
							currentSubject,
							rules,
							depth + 1,
							nextVisited,
							derived,
							subject,
							trace,
							ruleResults,
							maxDepth,
						)
						premiseResults.push(met)
						if (!met) {
							allMet = false
							break
						}
					}

					ruleResults.set(rule.id, {
						id: rule.id,
						applied: allMet,
						premises: premiseResults,
						conclusion: allMet,
					})

					if (allMet) {
						for (const [key, entry] of Object.entries(conclusionFacts)) {
							// SameValueZero — a NaN conclusion derives (and traces) once.
							if (!equalValues(derived[key], entry)) {
								derived[key] = entry
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
			const currentSubject: Subject = { ...subject, ...derived }

			switch (expression.operator) {
				case 'and':
					return expression.operands.every((operand) =>
						this.#establish(
							operand,
							currentSubject,
							rules,
							depth,
							visited,
							derived,
							subject,
							trace,
							ruleResults,
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
							derived,
							subject,
							trace,
							ruleResults,
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
						derived,
						subject,
						trace,
						ruleResults,
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
						derived,
						subject,
						trace,
						ruleResults,
						maxDepth,
					)
					if (!antecedentMet) return true
					return this.#establish(
						consequent,
						currentSubject,
						rules,
						depth,
						visited,
						derived,
						subject,
						trace,
						ruleResults,
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
						derived,
						subject,
						trace,
						ruleResults,
						maxDepth,
					)
					const rightMet = this.#establish(
						right,
						currentSubject,
						rules,
						depth,
						visited,
						derived,
						subject,
						trace,
						ruleResults,
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

	// A rule applies exactly when ALL premises hold — `applied` and `conclusion`
	// are the same boolean; a premise-less or conclusion-less rule never applies.
	#evaluateRule(rule: Rule, subject: Subject): RuleResult {
		if (!rule.premises || rule.premises.length === 0) {
			return { id: rule.id, applied: false, premises: [], conclusion: false }
		}
		if (!rule.conclusion) {
			return { id: rule.id, applied: false, premises: [], conclusion: false }
		}

		const premiseResults = rule.premises.map((premise) =>
			this.#evaluateExpression(premise, subject),
		)
		const allPremisesMet = premiseResults.every(Boolean)

		return {
			id: rule.id,
			applied: allPremisesMet,
			premises: premiseResults,
			conclusion: allPremisesMet,
		}
	}

	// EAGER evaluation (no short-circuit): `not` reads only its first operand
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
