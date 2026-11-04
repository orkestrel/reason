import type { AuditFault } from '@orkestrel/contract'
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
import {
	describeFaults,
	isArray,
	isError,
	isFiniteNumber,
	isObject,
	resolveField,
} from '@orkestrel/contract'
import {
	applyOperation,
	buildRefusedResult,
	collectVariables,
	containsVariable,
	describeMismatch,
	filterUniqueFaults,
	findDuplicates,
	invertLeft,
	invertRight,
	roundTo,
	scanShape,
	scanShapeReads,
	scanSymbolicExpression,
	valueToFault,
} from '../helpers.js'
import { DEFAULT_PRECISION, INVERTIBLE_OPERATIONS, SYMBOLIC_ID } from '../constants.js'
import { ReasonError } from '../errors.js'
import { SubjectDoor } from '../SubjectDoor.js'
import { SymbolicState } from '../SymbolicState.js'
import { isEquation, isSymbolicDefinition } from '../validators.js'

/**
 * Solves algebraic equations by variable isolation.
 *
 * @remarks
 * A definition with a `shape` admits its subject through the door first. Bindings
 * seed from `definition.variables`, then subject fields holding a finite number,
 * and nothing else, override same-named variables — the `id` field is skipped.
 * Equations solve strictly in order: when the `target` is unbound and appears
 * on exactly one side, it is isolated by peeling invertible operations (`add` /
 * `subtract` / `multiply` / `divide`); a non-invertible operation, a target on
 * both sides of an operation, or an unbound variable throws internally — the
 * throw is caught per equation and surfaced as a result error (`Equation
 * "<id>": <message>` plus a `FAILED` trace) while later equations still run.
 * Inversion or division by zero yields `NaN`, caught by the non-finite check.
 * A solved value is rounded to `precision` before binding, so later equations
 * see the rounded value; `solutions` reads the settled bindings keyed by each
 * equation's target (a failed equation's target still appears when bound
 * elsewhere). Nothing mutates its inputs; fully deterministic.
 *
 * @example
 * ```ts
 * import {
 * 	createConstant,
 * 	createEquation,
 * 	createSymbolicDefinition,
 * 	createSymbolicReasoner,
 * 	createVariable,
 * } from '@orkestrel/reason'
 *
 * const reasoner = createSymbolicReasoner()
 * const definition = createSymbolicDefinition('rate', 'Rate', [
 * 	createEquation('e1', createVariable('x'), createConstant(42), 'x'),
 * ])
 * reasoner.supports(definition) // true
 * reasoner.validate(definition).valid // true
 * const result = reasoner.reason({}, definition)
 * if (result.reasoning === 'symbolic') result.solutions // { x: 42 }
 * ```
 */
export class SymbolicReasoner implements ReasonerInterface {
	readonly #id: string
	readonly #door = new SubjectDoor()

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
		if (!isObject(definition) || definition.reasoning !== 'symbolic') {
			return { valid: false, errors: [describeMismatch('symbolic', definition)], warnings: [] }
		}
		const equations: unknown = definition.equations
		if (!isSymbolicDefinition(definition)) {
			const entries: readonly unknown[] = isArray(equations) ? equations : []
			return {
				valid: false,
				errors: [
					'Definition does not match the symbolic definition shape',
					...entries.flatMap((equation, index) =>
						isEquation(equation) ? [] : [`Equation at index ${String(index)} is malformed`],
					),
				],
				warnings: [],
			}
		}
		const shape = definition.shape
		const scan =
			shape === undefined
				? { errors: [], warnings: [] }
				: scanShapeReads(
						shape,
						[],
						definition.equations.flatMap((equation) => [
							...collectVariables(equation.left),
							...collectVariables(equation.right),
						]),
						new Set([
							...Object.keys(definition.variables),
							...definition.equations.map((equation) => equation.target),
						]),
					)
		const errors = [
			...(definition.id ? [] : ['Definition must have an id']),
			...(definition.name ? [] : ['Definition must have a name']),
			...(definition.equations.length === 0 ? ['Definition must have at least one equation'] : []),
			...findDuplicates(definition.equations).map((id) => `Duplicate equation id "${id}"`),
			...definition.equations.flatMap((equation) => [
				...(equation.id ? [] : ['Equation must have an id']),
				...(equation.target ? [] : [`Equation "${equation.id}" must have a target variable`]),
				...scanSymbolicExpression(equation.left),
				...scanSymbolicExpression(equation.right),
			]),
			...(shape === undefined ? [] : scanShape(shape)),
			...scan.errors,
		]
		return { valid: errors.length === 0, errors, warnings: scan.warnings }
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
		if (!isArray(definition.equations)) {
			return {
				reasoning: 'symbolic',
				solutions: {},
				success: false,
				trace: [],
				errors: ['Definition must have an "equations" array'],
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
		const precision = definition.precision ?? DEFAULT_PRECISION

		const state = new SymbolicState(definition.variables)
		const bound = Object.keys(admitted).reduce((count, key) => {
			if (key === 'id') return count
			const value = admitted[key]
			if (isFiniteNumber(value)) {
				state.set(key, value)
				trace.push(`Subject field "${key}" bound as ${key} = ${value}`)
				return count + 1
			}
			return count
		}, 0)
		if (bound > 0) trace.push(`Bound ${bound} variable(s) from subject`)

		if (definition.equations.length === 0) {
			trace.push('No equations to solve')
			return {
				reasoning: 'symbolic',
				solutions: {},
				success: true,
				trace,
				errors,
				faults: [],
				repairs: admission.repairs,
				defaulted: admission.defaulted,
			}
		}

		const targets = new Set(
			definition.equations.flatMap((equation) => (isObject(equation) ? [equation.target] : [])),
		)
		const leaves: AuditFault[] = []
		for (const [index, equation] of definition.equations.entries()) {
			if (!isObject(equation)) {
				errors.push(`Equation at index ${String(index)} is malformed`)
				continue
			}
			try {
				const value = this.#solve(equation, state.values)
				const rounded = roundTo(value, precision)
				// The finite gate covers a non-finite solved value as well as a finite
				// value that overflows during rounding (a huge constant scaled past the
				// double range → ±Infinity) — the latter previously slipped past the
				// pre-round check and bound Infinity with success:true. Describe whichever
				// is non-finite: the pre-round value keeps its exact rendering (for example
				// a non-numeric "[object Object]"), a round-overflow renders the ±Infinity.
				if (!isFiniteNumber(value) || !isFiniteNumber(rounded)) {
					const offender = isFiniteNumber(value) ? rounded : value
					const description = Number.isNaN(offender) ? 'NaN' : `${offender}`
					errors.push(`Equation "${equation.id}": produced non-finite value (${description})`)
					trace.push(
						`Equation "${equation.id}": FAILED — produced non-finite value (${description})`,
					)
					continue
				}
				// Rounded before binding — later equations see the rounded value.
				state.set(equation.target, rounded)
				trace.push(`Equation "${equation.id}": ${equation.target} = ${rounded}`)
			} catch (error) {
				const message = isError(error) ? error.message : String(error)
				trace.push(`Equation "${equation.id}": FAILED — ${message}`)
				const unbound = [...collectVariables(equation.left), ...collectVariables(equation.right)]
					.filter((name) => state.values[name] === undefined && !targets.has(name))
					.map((name) => valueToFault(name, 'number', resolveField(admitted, name)))
				leaves.push(...unbound)
				// A fault already says an unbound variable, and `errors` holds one string per fault.
				if (unbound.length === 0 || !message.startsWith('Unbound variable:')) {
					errors.push(`Equation "${equation.id}": ${message}`)
				}
			}
		}
		const faults = filterUniqueFaults(leaves)
		errors.push(...faults.map((fault) => describeFaults([fault])))

		const solutions = new SymbolicState()
		for (const equation of definition.equations) {
			if (!isObject(equation)) continue
			const value = state.values[equation.target]
			if (value !== undefined) solutions.set(equation.target, value)
		}

		return {
			reasoning: 'symbolic',
			solutions: solutions.values,
			success: errors.length === 0,
			trace,
			errors,
			faults,
			repairs: admission.repairs,
			defaulted: admission.defaulted,
		}
	}

	// Isolate around whichever side holds the unbound target; a pre-bound target
	// (or one absent from both sides) re-evaluates the right side instead.
	#solve(equation: Equation, bindings: Readonly<Record<string, number>>): number {
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
		bindings: Readonly<Record<string, number>>,
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
			if (rightExpression === undefined) {
				throw new Error(`Operation "${operator}" has no right side`)
			}
			const rightValue = this.#evaluate(rightExpression, bindings)
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

	// Unary operations ignore `right`; a binary operation with no right operand and an
	// unbound variable both throw (caught per equation).
	#evaluate(expression: SymbolicExpression, bindings: Readonly<Record<string, number>>): number {
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
				if (expression.right === undefined) {
					throw new Error(`Operation "${operator}" has no right side`)
				}
				return applyOperation(operator, left, this.#evaluate(expression.right, bindings))
			}
			default:
				throw new Error('Unknown expression form')
		}
	}
}
