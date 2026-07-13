import type {
	Definition,
	Equation,
	Reasoning,
	ReasonResult,
	ReasonValidationResult,
	ReasonerInterface,
	Subject,
	SymbolicExpression,
	SymbolicReasonerOptions,
} from '../types.js'
import { parseNumber } from '../../contracts/index.js'
import {
	applyOperation,
	containsVariable,
	findDuplicates,
	invertLeft,
	invertRight,
	roundTo,
} from '../helpers.js'
import { DEFAULT_PRECISION, INVERTIBLE_OPERATIONS, SYMBOLIC_ID } from '../constants.js'
import { ReasonError } from '../errors.js'

/**
 * The symbolic reasoner — algebraic equation solving by variable isolation.
 *
 * @remarks
 * Bindings seed from `definition.variables`, then numeric subject fields (a
 * finite number or a numeric string, coerced through the contracts
 * `parseNumber`) OVERRIDE same-named variables — the `id` field is skipped.
 * Equations solve strictly in order: when the `target` is unbound and appears
 * on exactly ONE side, it is isolated by peeling invertible operations (`add` /
 * `subtract` / `multiply` / `divide`); a non-invertible operation, a target on
 * both sides of an operation, or an unbound variable throws internally — the
 * throw is caught PER EQUATION and surfaced as a result error (`Equation
 * "<id>": <message>` plus a `FAILED` trace) while later equations still run.
 * Inversion or division by zero yields `NaN`, caught by the non-finite check.
 * A solved value is rounded to `precision` BEFORE binding, so later equations
 * see the rounded value; `solutions` reads FINAL bindings keyed by each
 * equation's target (a failed equation's target still appears when bound
 * elsewhere). Nothing mutates its inputs; fully deterministic (AGENTS §11).
 */
export class SymbolicReasoner implements ReasonerInterface {
	readonly #id: string

	constructor(options?: SymbolicReasonerOptions) {
		this.#id = options?.id ?? SYMBOLIC_ID
	}

	get id(): string {
		return this.#id
	}

	get reasoning(): Reasoning {
		return 'symbolic'
	}

	supports(definition: Definition): boolean {
		return definition.reasoning === 'symbolic'
	}

	validate(definition: Definition): ReasonValidationResult {
		const errors: string[] = []
		const warnings: string[] = []

		if (definition.reasoning !== 'symbolic') {
			errors.push(`Expected reasoning "symbolic", got "${definition.reasoning}"`)
			return { valid: false, errors, warnings }
		}

		if (!definition.id) errors.push('Definition must have an id')
		if (!definition.name) errors.push('Definition must have a name')
		if (!definition.equations || definition.equations.length === 0) {
			errors.push('Definition must have at least one equation')
		}

		// Duplicate ids are WARNINGS — the runtime stays permissive about them.
		for (const id of findDuplicates(definition.equations ?? [])) {
			warnings.push(`Duplicate equation id "${id}"`)
		}

		for (const equation of definition.equations ?? []) {
			if (!equation.id) errors.push('Equation must have an id')
			if (!equation.target) errors.push(`Equation "${equation.id}" must have a target variable`)
		}

		return { valid: errors.length === 0, errors, warnings }
	}

	reason(subject: Subject, definition: Definition): ReasonResult {
		if (definition.reasoning !== 'symbolic') {
			throw new ReasonError(
				'MISMATCH',
				`Expected symbolic definition, got "${definition.reasoning}"`,
				{ definition: definition.id, reasoning: this.reasoning },
			)
		}

		// Runtime never assumes validate() ran — a malformed shape is a failure
		// result, not a throw.
		if (!definition.equations || !Array.isArray(definition.equations)) {
			return {
				reasoning: 'symbolic',
				solutions: {},
				success: false,
				trace: [],
				errors: ['Definition must have an "equations" array'],
			}
		}

		const trace: string[] = []
		const errors: string[] = []
		const precision = definition.precision ?? DEFAULT_PRECISION

		const bindings: Record<string, number> = { ...definition.variables }

		// Numeric subject fields bind as variables, OVERRIDING definition
		// variables of the same name; the `id` field is traceability, not data.
		let bound = 0
		for (const key of Object.keys(subject)) {
			if (key === 'id') continue
			const value = parseNumber(subject[key])
			if (value !== undefined) {
				bindings[key] = value
				trace.push(`Subject field "${key}" bound as ${key} = ${value}`)
				bound++
			}
		}
		if (bound > 0) trace.push(`Bound ${bound} variable(s) from subject`)

		if (definition.equations.length === 0) {
			trace.push('No equations to solve')
			return { reasoning: 'symbolic', solutions: {}, success: true, trace, errors }
		}

		for (const equation of definition.equations) {
			if (typeof equation !== 'object' || equation === null) continue
			try {
				const value = this.#solve(equation, bindings)
				const rounded = roundTo(value, precision)
				// The finite gate now covers BOTH a non-finite solved value AND a finite
				// value that OVERFLOWS during rounding (a huge constant scaled past the
				// double range → ±Infinity) — the latter previously slipped past the
				// pre-round check and bound Infinity with success:true. Describe whichever
				// is non-finite: the pre-round value keeps its exact rendering (e.g. a
				// non-numeric "[object Object]"), a round-overflow renders the ±Infinity.
				if (!Number.isFinite(value) || !Number.isFinite(rounded)) {
					const offender = Number.isFinite(value) ? rounded : value
					const description = Number.isNaN(offender) ? 'NaN' : `${offender}`
					errors.push(`Equation "${equation.id}": produced non-finite value (${description})`)
					trace.push(
						`Equation "${equation.id}": FAILED — produced non-finite value (${description})`,
					)
					continue
				}
				// Rounded BEFORE binding — later equations see the rounded value.
				bindings[equation.target] = rounded
				trace.push(`Equation "${equation.id}": ${equation.target} = ${rounded}`)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				errors.push(`Equation "${equation.id}": ${message}`)
				trace.push(`Equation "${equation.id}": FAILED — ${message}`)
			}
		}

		const solutions: Record<string, number> = {}
		for (const equation of definition.equations) {
			if (typeof equation !== 'object' || equation === null) continue
			const value = bindings[equation.target]
			if (value !== undefined) solutions[equation.target] = value
		}

		return { reasoning: 'symbolic', solutions, success: errors.length === 0, trace, errors }
	}

	// Isolate around whichever side holds the unbound target; a pre-bound target
	// (or one absent from both sides) just re-evaluates the right side.
	#solve(equation: Equation, bindings: Record<string, number>): number {
		const target = equation.target
		const leftHas = containsVariable(equation.left, target, bindings)
		const rightHas = containsVariable(equation.right, target, bindings)

		if (leftHas && rightHas) return this.#evaluate(equation.right, bindings)
		if (leftHas) {
			const rhs = this.#evaluate(equation.right, bindings)
			return this.#isolate(equation.left, target, rhs, bindings)
		}
		if (rightHas) {
			const lhs = this.#evaluate(equation.left, bindings)
			return this.#isolate(equation.right, target, lhs, bindings)
		}
		return this.#evaluate(equation.right, bindings)
	}

	// Peel invertible operations off around the target until the bare variable
	// remains; every unsolvable shape throws (caught per equation by `reason`).
	#isolate(
		expression: SymbolicExpression,
		target: string,
		value: number,
		bindings: Record<string, number>,
	): number {
		if (expression.form === 'variable' && expression.name === target) return value
		if (expression.form !== 'operation') {
			throw new Error(`Cannot isolate "${target}" — unexpected node form "${expression.form}"`)
		}

		const operator = expression.operator
		if (!INVERTIBLE_OPERATIONS.has(operator)) {
			throw new Error(`Cannot isolate "${target}" through non-invertible operation "${operator}"`)
		}

		const leftHas = containsVariable(expression.left, target, bindings)
		const rightExpression = expression.right
		const rightHas = rightExpression ? containsVariable(rightExpression, target, bindings) : false

		if (leftHas && rightHas) {
			throw new Error(
				`Cannot isolate "${target}" — variable appears on both sides of "${operator}"`,
			)
		}

		if (leftHas) {
			const rightValue = rightExpression ? this.#evaluate(rightExpression, bindings) : 0
			return this.#isolate(
				expression.left,
				target,
				invertLeft(operator, value, rightValue),
				bindings,
			)
		}

		if (rightHas && rightExpression) {
			const leftValue = this.#evaluate(expression.left, bindings)
			return this.#isolate(
				rightExpression,
				target,
				invertRight(operator, value, leftValue),
				bindings,
			)
		}

		throw new Error(`Cannot isolate "${target}" — variable not found in expression`)
	}

	// Unary operations ignore `right`; a binary operation with no right operand
	// treats it as 0; an unbound variable throws (caught per equation).
	#evaluate(expression: SymbolicExpression, bindings: Record<string, number>): number {
		switch (expression.form) {
			case 'constant':
				return expression.value
			case 'variable': {
				const value = bindings[expression.name]
				if (value === undefined) throw new Error(`Unbound variable: ${expression.name}`)
				return value
			}
			case 'operation': {
				const operator = expression.operator
				const left = this.#evaluate(expression.left, bindings)
				if (
					operator === 'round' ||
					operator === 'ceil' ||
					operator === 'floor' ||
					operator === 'abs'
				) {
					return applyOperation(operator, left, 0)
				}
				const right = expression.right ? this.#evaluate(expression.right, bindings) : 0
				return applyOperation(operator, left, right)
			}
			default:
				throw new Error('Unknown expression form')
		}
	}
}
