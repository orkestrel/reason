import type { Equation, ReasonResult, SymbolicExpression, SymbolicResult } from '@src/core'
import {
	createConstant,
	createDefinitionBuilder,
	createEquation,
	createOperation,
	createQuantitativeDefinition,
	createSubjectBuilder,
	createSymbolicDefinition,
	createSymbolicReasoner,
	createVariable,
	isReasonError,
	roundTo,
	SymbolicReasoner,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError, invokeUnchecked } from '@orkestrel/test'
import {
	deepAddition,
	EXTREME_NUMBERS,
	expectSymbolic,
	INTEGER_KEY_SUBJECT,
	sequence,
	sparse,
	TRICKY_KEYS,
} from '../../../setup.js'

// `SymbolicReasoner` behavior — bindings seeded from definition variables and
// OVERRIDDEN by numeric subject fields (parseNumber coercion: numeric strings
// bind, non-numeric strings and non-finite numbers do not; `id` is skipped),
// in-order equation solving with single-variable algebraic ISOLATION over the
// invertible operations (add / subtract / multiply / divide — target on either
// equation side and either operand), per-equation error containment (unbound
// variable / divide-by-zero / non-invertible power / unknown operator fail THAT
// equation and continue), precision rounding applied BEFORE binding (so later
// equations see the rounded value), and solutions keyed by equation targets
// only, all keyed on the `form` discriminant.

const reasoner = createSymbolicReasoner()

describe('SymbolicReasoner — identity', () => {
	it('defaults its id to "symbolic" and reports its reasoning', () => {
		expect(reasoner.id).toBe('symbolic')
		expect(reasoner.reasoning).toBe('symbolic')
		expect(new SymbolicReasoner().id).toBe('symbolic')
	})

	it('takes a custom id through the options object', () => {
		expect(new SymbolicReasoner({ id: 'custom' }).id).toBe('custom')
	})
})

describe('SymbolicReasoner — supports', () => {
	it('supports symbolic definitions only', () => {
		expect(reasoner.supports(createSymbolicDefinition('d', 'd', []))).toBe(true)
		expect(reasoner.supports(createQuantitativeDefinition('d', 'd', []))).toBe(false)
	})
})

describe('SymbolicReasoner — validate', () => {
	it('accepts a well-formed definition', () => {
		const validation = reasoner.validate(
			createSymbolicDefinition('d', 'd', [
				createEquation('e1', createVariable('x'), createConstant(42), 'x'),
			]),
		)
		expect(validation.valid).toBe(true)
		expect(validation.errors).toEqual([])
	})

	it('rejects the wrong reasoning with the renamed message', () => {
		const validation = reasoner.validate(createQuantitativeDefinition('d', 'd', []))
		expect(validation.errors[0]).toBe('Expected reasoning "symbolic", got "quantitative"')
	})

	it('demands an id, a name, and at least one equation', () => {
		const validation = reasoner.validate(createSymbolicDefinition('', '', []))
		expect(validation.errors).toContain('Definition must have an id')
		expect(validation.errors).toContain('Definition must have a name')
		expect(validation.errors).toContain('Definition must have at least one equation')
	})

	it('demands an equation id and a target variable', () => {
		const validation = reasoner.validate(
			createSymbolicDefinition('d', 'd', [
				createEquation('', createVariable('x'), createConstant(1), ''),
			]),
		)
		expect(validation.errors).toContain('Equation must have an id')
		expect(validation.errors).toContain('Equation "" must have a target variable')
	})

	it('duplicate equation ids are a WARNING, once per duplicated id', () => {
		const validation = reasoner.validate(
			createSymbolicDefinition('d', 'd', [
				createEquation('dup', createVariable('x'), createConstant(1), 'x'),
				createEquation('dup', createVariable('y'), createConstant(2), 'y'),
				createEquation('dup', createVariable('z'), createConstant(3), 'z'),
			]),
		)
		expect(validation.valid).toBe(true)
		expect(
			validation.warnings.filter((warning) => warning === 'Duplicate equation id "dup"'),
		).toHaveLength(1)
	})
})

describe('SymbolicReasoner — reason (evaluation)', () => {
	it('assigns a constant', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('x'), createConstant(42), 'x'),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.solutions.x).toBe(42)
	})

	it('binds subject fields as variables', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('x'), createVariable('a'), 'x'),
		])
		expect(expectSymbolic(reasoner.reason({ a: 10 }, definition)).solutions.x).toBe(10)
	})

	it('evaluates the four arithmetic operations', () => {
		const cases: ReadonlyArray<readonly [SymbolicExpression, number]> = [
			[createOperation('add', createConstant(10), createConstant(5)), 15],
			[createOperation('subtract', createConstant(10), createConstant(3)), 7],
			[createOperation('multiply', createConstant(6), createConstant(7)), 42],
			[createOperation('divide', createConstant(20), createConstant(4)), 5],
		]
		for (const [expression, expected] of cases) {
			const definition = createSymbolicDefinition('d', 'd', [
				createEquation('e1', createVariable('x'), expression, 'x'),
			])
			expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(expected)
		}
	})

	it('evaluates nested expressions', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('x'),
				createOperation(
					'add',
					createOperation('multiply', createConstant(2), createConstant(3)),
					createConstant(4),
				),
				'x',
			),
		])
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(10)
	})

	it('evaluates unary operations and treats an absent right operand as 0', () => {
		const absolute = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('y'), createOperation('abs', createVariable('x')), 'y'),
		])
		expect(expectSymbolic(reasoner.reason({ x: -5 }, absolute)).solutions.y).toBe(5)

		const bare = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('y'), createOperation('add', createVariable('x')), 'y'),
		])
		expect(expectSymbolic(reasoner.reason({ x: 7 }, bare)).solutions.y).toBe(7)
	})

	it('chains equations — earlier solutions bind later ones', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('a'), createConstant(10), 'a'),
			createEquation(
				'e2',
				createVariable('b'),
				createOperation('multiply', createVariable('a'), createConstant(2)),
				'b',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.solutions.a).toBe(10)
		expect(result.solutions.b).toBe(20)
	})

	it('uses pre-defined definition variables', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[
				createEquation(
					'e1',
					createVariable('circumference'),
					createOperation(
						'multiply',
						createOperation('multiply', createConstant(2), createVariable('pi')),
						createVariable('r'),
					),
					'circumference',
				),
			],
			{ variables: { pi: 3.14159, r: 5 } },
		)
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.circumference).toBeCloseTo(
			31.4159,
			3,
		)
	})

	it('chains three equations through subject + definition variables', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[
				createEquation(
					'interest',
					createVariable('interest'),
					createOperation(
						'multiply',
						createOperation('multiply', createVariable('principal'), createVariable('rate')),
						createVariable('years'),
					),
					'interest',
				),
				createEquation(
					'total',
					createVariable('total'),
					createOperation('add', createVariable('principal'), createVariable('interest')),
					'total',
				),
				createEquation(
					'monthly',
					createVariable('monthly'),
					createOperation(
						'divide',
						createVariable('total'),
						createOperation('multiply', createVariable('years'), createConstant(12)),
					),
					'monthly',
				),
			],
			{ variables: { rate: 0.1, years: 2 } },
		)
		const result = expectSymbolic(reasoner.reason({ principal: 1000 }, definition))
		expect(result.solutions.interest).toBe(200)
		expect(result.solutions.total).toBe(1200)
		expect(result.solutions.monthly).toBe(50)
	})

	it('produces a trace including the subject bindings', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('y'),
				createOperation('multiply', createVariable('x'), createConstant(2)),
				'y',
			),
		])
		const result = expectSymbolic(reasoner.reason({ x: 21 }, definition))
		expect(result.solutions.y).toBe(42)
		expect(result.trace).toContain('Subject field "x" bound as x = 21')
		expect(result.trace).toContain('Bound 1 variable(s) from subject')
		expect(result.trace).toContain('Equation "e1": y = 42')
	})
})

describe('SymbolicReasoner — bindings (parseNumber coercion & precedence)', () => {
	it('subject fields OVERRIDE definition variables of the same name', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[
				createEquation(
					'e1',
					createVariable('y'),
					createOperation('add', createVariable('x'), createConstant(1)),
					'y',
				),
			],
			{ variables: { x: 10 } },
		)
		expect(expectSymbolic(reasoner.reason({ x: 41 }, definition)).solutions.y).toBe(42)
	})

	it('numeric-string subject fields parse; non-numeric strings never bind', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('y'),
				createOperation('add', createVariable('x'), createConstant(2)),
				'y',
			),
		])
		expect(expectSymbolic(reasoner.reason({ x: '40' }, definition)).solutions.y).toBe(42)

		const unbound = expectSymbolic(reasoner.reason({ x: 'hello' }, definition))
		expect(unbound.success).toBe(false)
		expect(unbound.errors).toContain('Equation "e1": Unbound variable: x')
	})

	it('a non-finite subject number never binds (parseNumber rejects NaN)', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('y'), createVariable('x'), 'y'),
		])
		const result = expectSymbolic(reasoner.reason({ x: Number.NaN }, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Equation "e1": Unbound variable: x')
	})

	it('the id subject field is traceability, not data — it never binds', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('y'), createVariable('id'), 'y'),
		])
		const result = expectSymbolic(reasoner.reason({ id: 5 }, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Equation "e1": Unbound variable: id')
	})

	it('only the SUBJECT id is skipped — definition.variables may carry an id key', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[createEquation('e1', createVariable('y'), createVariable('id'), 'y')],
			{ variables: { id: 5 } },
		)
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.solutions).toEqual({ y: 5 })
	})

	it('a PRE-BOUND target does not count as present — the right side re-evaluates and REBINDS', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[createEquation('e1', createVariable('x'), createConstant(10), 'x')],
			{ variables: { x: 5 } },
		)
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.solutions).toEqual({ x: 10 })
		expect(result.trace).toContain('Equation "e1": x = 10')
	})

	it('an UNBOUND target on BOTH equation sides is an Unbound error (x = x + 1)', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('x'),
				createOperation('add', createVariable('x'), createConstant(1)),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": Unbound variable: x'])
	})
})

describe('SymbolicReasoner — algebraic isolation', () => {
	it('solves 2x + 3 = 11 (peels add, then multiply)', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation(
					'add',
					createOperation('multiply', createConstant(2), createVariable('x')),
					createConstant(3),
				),
				createConstant(11),
				'x',
			),
		])
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(4)
	})

	it('solves x / 5 = 3', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation('divide', createVariable('x'), createConstant(5)),
				createConstant(3),
				'x',
			),
		])
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(15)
	})

	it('solves 10 − x = 3 (target on the right operand)', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation('subtract', createConstant(10), createVariable('x')),
				createConstant(3),
				'x',
			),
		])
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(7)
	})

	it('solves 100 = x × 4 (target on the right side of the equation)', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createConstant(100),
				createOperation('multiply', createVariable('x'), createConstant(4)),
				'x',
			),
		])
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(25)
	})

	it('a non-invertible operation containing the target fails that equation', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation('power', createVariable('x'), createConstant(2)),
				createConstant(16),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toContain(
			'Equation "e1": Cannot isolate "x" through non-invertible operation "power"',
		)
	})

	it('a target on BOTH operands of one operation fails that equation', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation('add', createVariable('x'), createVariable('x')),
				createConstant(10),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors[0]).toContain('variable appears on both sides of "add"')
	})

	it('isolating through multiply-by-zero yields the non-finite error (x·0 = 5)', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation('multiply', createVariable('x'), createConstant(0)),
				createConstant(5),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": produced non-finite value (NaN)'])
	})

	it('inverting a divide-by-zero yields the non-finite error, not a bogus x = 0 (x / 0 = 5)', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation('divide', createVariable('x'), createConstant(0)),
				createConstant(5),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": produced non-finite value (NaN)'])
		expect('x' in result.solutions).toBe(false)
	})
})

describe('SymbolicReasoner — error containment & precision', () => {
	it('an unbound variable is an error result, not a throw', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('y'), createVariable('x'), 'y'),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": Unbound variable: x'])
		expect(result.trace).toContain('Equation "e1": FAILED — Unbound variable: x')
	})

	it('division by zero is a non-finite error result, not Infinity', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('x'),
				createOperation('divide', createConstant(10), createConstant(0)),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Equation "e1": produced non-finite value (NaN)')
		expect(result.trace).toContain('Equation "e1": FAILED — produced non-finite value (NaN)')
	})

	it('an unknown operator fails only that equation (contained internally)', () => {
		const result = expectSymbolic(
			invokeUnchecked<ReasonResult>(reasoner, reasoner.reason, [
				{},
				{
					reasoning: 'symbolic',
					id: 'd',
					name: 'd',
					variables: {},
					equations: [
						{
							id: 'e1',
							name: 'e1',
							left: createVariable('y'),
							right: {
								form: 'operation',
								operator: 'modulo',
								left: createConstant(10),
								right: createConstant(3),
							},
							target: 'y',
						},
					],
				},
			]),
		)
		expect(result.success).toBe(false)
		expect(result.errors).toContain('Equation "e1": Unknown operator: modulo')
	})

	it('continues past a failed equation — later solutions are retained', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'bad',
				createVariable('bad'),
				createOperation('divide', createConstant(10), createConstant(0)),
				'bad',
			),
			createEquation('good', createVariable('good'), createConstant(42), 'good'),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.solutions.good).toBe(42)
		expect(Object.keys(result.solutions)).toEqual(['good'])
	})

	it('a FAILED equation targeting a pre-bound variable still surfaces it in solutions', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[createEquation('e1', createVariable('a'), createVariable('unbound'), 'a')],
			{ variables: { a: 7 } },
		)
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": Unbound variable: unbound'])
		// The target was bound BEFORE the run — solutions read final bindings.
		expect(result.solutions).toEqual({ a: 7 })
	})

	it('precision rounds solutions (and defaults to 4 decimal places)', () => {
		const rounded = createSymbolicDefinition(
			'd',
			'd',
			[createEquation('e1', createVariable('x'), createConstant(3.14159), 'x')],
			{ precision: 2 },
		)
		expect(expectSymbolic(reasoner.reason({}, rounded)).solutions.x).toBe(3.14)

		const defaulted = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('x'),
				createOperation('divide', createConstant(1), createConstant(3)),
				'x',
			),
		])
		expect(expectSymbolic(reasoner.reason({}, defaulted)).solutions.x).toBe(0.3333)
	})

	it('rounds BEFORE binding — later equations see the rounded value', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[
				createEquation('e1', createVariable('a'), createConstant(2.6), 'a'),
				createEquation(
					'e2',
					createVariable('b'),
					createOperation('multiply', createVariable('a'), createConstant(2)),
					'b',
				),
			],
			{ precision: 0 },
		)
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.solutions.a).toBe(3)
		expect(result.solutions.b).toBe(6)
	})

	it('solutions contain ONLY equation targets, never intermediate variables', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[
				createEquation(
					'e1',
					createVariable('sum'),
					createOperation('add', createVariable('x'), createVariable('y')),
					'sum',
				),
			],
			{ variables: { x: 1, y: 2 } },
		)
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(Object.keys(result.solutions)).toEqual(['sum'])
		expect(result.solutions.sum).toBe(3)
	})

	it('an empty equation list traces "No equations to solve" and succeeds', () => {
		const result = expectSymbolic(reasoner.reason({}, createSymbolicDefinition('d', 'd', [])))
		expect(result.success).toBe(true)
		expect(result.solutions).toEqual({})
		expect(result.trace).toContain('No equations to solve')
	})
})

describe('SymbolicReasoner — mismatch vs malformed shape', () => {
	it('MISMATCH: the wrong reasoning THROWS a coded ReasonError with context', () => {
		const error = captureError(() =>
			reasoner.reason({}, createQuantitativeDefinition('other', 'Other', [])),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')
		expect(error.message).toBe('Expected symbolic definition, got "quantitative"')
		expect(error.context).toEqual({ definition: 'other', reasoning: 'symbolic' })
	})

	it('a malformed shape (missing equations) is a FAILURE RESULT, not a throw', () => {
		const result = expectSymbolic(
			invokeUnchecked<ReasonResult>(reasoner, reasoner.reason, [
				{},
				{ reasoning: 'symbolic', id: 'd', name: 'd', variables: {} },
			]),
		)
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Definition must have an "equations" array'])
	})
})

describe('SymbolicReasoner — multi-variable systems', () => {
	it('solves a three-equation system where each solution feeds the next', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'a',
				createVariable('a'),
				createOperation('add', createConstant(2), createConstant(3)),
				'a',
			),
			createEquation(
				'b',
				createVariable('b'),
				createOperation('multiply', createVariable('a'), createConstant(4)),
				'b',
			),
			createEquation(
				'c',
				createVariable('c'),
				createOperation('subtract', createVariable('b'), createVariable('a')),
				'c',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.solutions).toEqual({ a: 5, b: 20, c: 15 })
	})

	it('solves a system seeded by subject fields that OVERRIDE definition variables', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[
				createEquation(
					'total',
					createVariable('total'),
					createOperation('multiply', createVariable('principal'), createVariable('rate')),
					'total',
				),
				createEquation(
					'net',
					createVariable('net'),
					createOperation('subtract', createVariable('total'), createVariable('fee')),
					'net',
				),
			],
			{ variables: { rate: 2, fee: 8 } },
		)
		const result = expectSymbolic(reasoner.reason({ principal: 10, rate: 5 }, definition))
		expect(result.success).toBe(true)
		// `rate` from the subject (5) overrides the definition's 2: total = 10 × 5 = 50.
		expect(result.solutions).toEqual({ total: 50, net: 42 })
	})
})

describe('SymbolicReasoner — multi-peel isolation', () => {
	it('peels three operations to isolate x in ((x + 3) × 2) − 5 = 9', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation(
					'subtract',
					createOperation(
						'multiply',
						createOperation('add', createVariable('x'), createConstant(3)),
						createConstant(2),
					),
					createConstant(5),
				),
				createConstant(9),
				'x',
			),
		])
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(4)
	})

	it('peels four operations to isolate x in (((x + 1) × 3) − 4) / 2 = 7', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation(
					'divide',
					createOperation(
						'subtract',
						createOperation(
							'multiply',
							createOperation('add', createVariable('x'), createConstant(1)),
							createConstant(3),
						),
						createConstant(4),
					),
					createConstant(2),
				),
				createConstant(7),
				'x',
			),
		])
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(5)
	})

	it('isolates the target on the RIGHT operand of an outer subtract: 20 − (x × 2) = 6', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation(
					'subtract',
					createConstant(20),
					createOperation('multiply', createVariable('x'), createConstant(2)),
				),
				createConstant(6),
				'x',
			),
		])
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(7)
	})

	it('isolates the target as the DIVISOR: 20 / x = 4', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation('divide', createConstant(20), createVariable('x')),
				createConstant(4),
				'x',
			),
		])
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(5)
	})
})

describe('SymbolicReasoner — full-operator evaluation', () => {
	// The target appears on neither side, so the right expression is evaluated directly.
	const evaluate = (expression: SymbolicExpression): number => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('result'), expression, 'result'),
		])
		const result = expectSymbolic(reasoner.reason({}, definition)).solutions.result
		if (result === undefined) throw new Error('expected result solution')
		return result
	}

	it('evaluates power, percentage, minimum, maximum and average', () => {
		expect(evaluate(createOperation('power', createConstant(2), createConstant(10)))).toBe(1024)
		expect(evaluate(createOperation('percentage', createConstant(200), createConstant(15)))).toBe(
			30,
		)
		expect(evaluate(createOperation('minimum', createConstant(3), createConstant(8)))).toBe(3)
		expect(evaluate(createOperation('maximum', createConstant(3), createConstant(8)))).toBe(8)
		expect(evaluate(createOperation('average', createConstant(10), createConstant(20)))).toBe(15)
	})

	it('evaluates the unary operations round, ceil, floor and abs', () => {
		expect(evaluate(createOperation('round', createConstant(2.5)))).toBe(3)
		expect(evaluate(createOperation('ceil', createConstant(2.1)))).toBe(3)
		expect(evaluate(createOperation('floor', createConstant(2.9)))).toBe(2)
		expect(evaluate(createOperation('abs', createConstant(-7)))).toBe(7)
	})

	it('a unary operation IGNORES a supplied right operand', () => {
		expect(evaluate(createOperation('abs', createConstant(-7), createConstant(999)))).toBe(7)
		expect(evaluate(createOperation('round', createConstant(2.5), createConstant(999)))).toBe(3)
	})

	it('a binary operation with no right operand treats it as 0', () => {
		expect(evaluate(createOperation('power', createConstant(5)))).toBe(1)
		expect(evaluate(createOperation('multiply', createConstant(5)))).toBe(0)
		expect(evaluate(createOperation('minimum', createConstant(5)))).toBe(0)
		expect(evaluate(createOperation('maximum', createConstant(5)))).toBe(5)
		expect(evaluate(createOperation('subtract', createConstant(5)))).toBe(5)
		expect(evaluate(createOperation('percentage', createConstant(5)))).toBe(0)
	})

	it('a binary DIVIDE with no right operand is a divide-by-zero non-finite error', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('result'),
				createOperation('divide', createConstant(5)),
				'result',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": produced non-finite value (NaN)'])
	})
})

describe('SymbolicReasoner — numeric extremes', () => {
	it('round-trips every finite-after-round EXTREME_NUMBER', () => {
		// corrected: finite check now runs post-round; the solution is the input rounded BEFORE binding
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('y'), createVariable('x'), 'y'),
		])
		const finiteAfterRound = EXTREME_NUMBERS.filter((value) => Number.isFinite(roundTo(value, 4)))
		for (const value of finiteAfterRound) {
			const result = expectSymbolic(reasoner.reason({ x: value }, definition))
			expect(result.success).toBe(true)
			expect(result.solutions.y).toBe(roundTo(value, 4))
		}
	})

	it('a round-overflow EXTREME_NUMBER is now a non-finite error, not a bound Infinity', () => {
		// corrected: MAX_VALUE / ±1e308 are finite INPUTS, but roundTo(·, 4) overflows the 1e4
		// scale factor to ±Infinity — the post-round gate fails the equation instead of binding
		// a non-finite solution with success:true.
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('y'), createVariable('x'), 'y'),
		])
		const overflowAfterRound = EXTREME_NUMBERS.filter(
			(value) => !Number.isFinite(roundTo(value, 4)),
		)
		expect(overflowAfterRound.length).toBeGreaterThan(0)
		for (const value of overflowAfterRound) {
			const result = expectSymbolic(reasoner.reason({ x: value }, definition))
			expect(result.success).toBe(false)
			expect('y' in result.solutions).toBe(false)
		}
	})

	it('MAX_SAFE_INTEGER passes through exactly at precision 0', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[createEquation('e1', createVariable('x'), createConstant(Number.MAX_SAFE_INTEGER), 'x')],
			{ precision: 0 },
		)
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(
			Number.MAX_SAFE_INTEGER,
		)
	})

	it('default-precision rounding DRIFTS MAX_SAFE_INTEGER past the safe-integer range', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('x'), createConstant(Number.MAX_SAFE_INTEGER), 'x'),
		])
		// roundTo scales by 10^4 before Math.round, pushing the value past 2^53 and losing
		// the low digits — a REAL roundTo artifact at extreme magnitude, not a solve bug.
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(9007199254740990)
	})

	it('an evaluation that overflows to Infinity is a non-finite error (1e308 × 10)', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('x'),
				createOperation('multiply', createConstant(1e308), createConstant(10)),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": produced non-finite value (Infinity)'])
		expect(result.trace).toContain('Equation "e1": FAILED — produced non-finite value (Infinity)')
		expect('x' in result.solutions).toBe(false)
	})

	it('power producing Infinity is a non-finite error (10 ^ 400, evaluated not isolated)', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('x'),
				createOperation('power', createConstant(10), createConstant(400)),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": produced non-finite value (Infinity)'])
	})

	it('rounding overflow is a post-round non-finite error, not a bound Infinity (constant 1e308)', () => {
		// corrected: finite check now runs post-round
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('x'), createConstant(1e308), 'x'),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		// 1e308 is finite, but roundTo(1e308, 4) overflows to Infinity; the finite gate
		// now runs AFTER rounding, so the equation fails instead of binding Infinity.
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": produced non-finite value (Infinity)'])
		expect(result.trace).toContain('Equation "e1": FAILED — produced non-finite value (Infinity)')
		expect('x' in result.solutions).toBe(false)
	})

	it('division underflow to a subnormal survives at overflow-passthrough precision (400)', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[
				createEquation(
					'e1',
					createVariable('x'),
					createOperation('divide', createConstant(1e-323), createConstant(2)),
					'x',
				),
			],
			{ precision: 400 },
		)
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.solutions.x).toBe(Number.MIN_VALUE)
	})

	it('division underflow rounds a subnormal to 0 at default precision', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('x'),
				createOperation('divide', createConstant(1e-323), createConstant(2)),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(result.solutions.x).toBe(0)
	})
})

describe('SymbolicReasoner — signed-zero solutions', () => {
	it('preserves NEGATIVE zero through multiply and rounding (-0 × 5)', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('x'),
				createOperation('multiply', createConstant(-0), createConstant(5)),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(true)
		expect(Object.is(result.solutions.x, -0)).toBe(true)
	})

	it('keeps POSITIVE zero positive (0 × 5) — distinct from -0', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('x'),
				createOperation('multiply', createConstant(0), createConstant(5)),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(Object.is(result.solutions.x, 0)).toBe(true)
		expect(Object.is(result.solutions.x, -0)).toBe(false)
	})
})

describe('SymbolicReasoner — precision extremes', () => {
	it('precision 0 rounds to whole numbers', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[createEquation('e1', createVariable('x'), createConstant(2.6), 'x')],
			{ precision: 0 },
		)
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(3)
	})

	it('NEGATIVE precision rounds at whole-number scales (hundreds at -2)', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[createEquation('e1', createVariable('x'), createConstant(1250), 'x')],
			{ precision: -2 },
		)
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(1300)
	})

	it('EXTREME precision (400) overflows the scale factor and passes the value through', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[createEquation('e1', createVariable('x'), createConstant(3.14159), 'x')],
			{ precision: 400 },
		)
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.x).toBe(3.14159)
	})

	it('rounds BEFORE binding at precision 1 — the next equation sees 0.3, not 1/3', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[
				createEquation(
					'e1',
					createVariable('a'),
					createOperation('divide', createConstant(1), createConstant(3)),
					'a',
				),
				createEquation(
					'e2',
					createVariable('b'),
					createOperation('multiply', createVariable('a'), createConstant(3)),
					'b',
				),
			],
			{ precision: 1 },
		)
		const result = expectSymbolic(reasoner.reason({}, definition))
		// a = roundTo(1/3, 1) = 0.3; b = roundTo(0.3 × 3, 1) = 0.9 (NOT roundTo(1/3 × 3) = 1).
		expect(result.solutions.a).toBe(0.3)
		expect(result.solutions.b).toBe(0.9)
	})
})

describe('SymbolicReasoner — unicode & adversarial variable names', () => {
	const emoji = '\u{1F600}'

	it('solves with an emoji-named variable bound through definition variables', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[
				createEquation(
					'e1',
					createVariable('y'),
					createOperation('add', createVariable(emoji), createConstant(1)),
					'y',
				),
			],
			{ variables: { [emoji]: 41 } },
		)
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.y).toBe(42)
	})

	it('solves with an emoji-named variable bound through a subject field', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('y'),
				createOperation('add', createVariable(emoji), createConstant(1)),
				'y',
			),
		])
		expect(expectSymbolic(reasoner.reason({ [emoji]: 41 }, definition)).solutions.y).toBe(42)
	})

	it('solves FOR an emoji-named target', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable(emoji), createConstant(99), emoji),
		])
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions[emoji]).toBe(99)
	})

	it('every non-__proto__ TRICKY_KEY works as a definition-bound variable name', () => {
		for (const key of TRICKY_KEYS) {
			if (key === '__proto__') continue
			const definition = createSymbolicDefinition(
				'd',
				'd',
				[
					createEquation(
						'e1',
						createVariable('y'),
						createOperation('add', createVariable(key), createConstant(1)),
						'y',
					),
				],
				{ variables: { [key]: 41 } },
			)
			expect(expectSymbolic(reasoner.reason({}, definition)).solutions.y).toBe(42)
		}
	})

	it('a "__proto__" SUBJECT field cannot bind — the setter drops the number', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('y'), createVariable('__proto__'), 'y'),
		])
		const result = expectSymbolic(reasoner.reason({ ['__proto__']: 5 }, definition))
		// `bindings['__proto__'] = 5` hits the prototype setter, which ignores a non-object, so
		// no own key is created; reading `__proto__` yields Object.prototype — a non-number that
		// trips the non-finite guard as "[object Object]". A prototype-key hazard; flagged, not fixed.
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": produced non-finite value ([object Object])'])
	})
})

describe('SymbolicReasoner — deep expression tree', () => {
	it('evaluates a 300-deep left-nested addition without stack overflow', () => {
		let expression: SymbolicExpression = createConstant(0)
		for (let index = 0; index < 300; index += 1) {
			expression = createOperation('add', expression, createConstant(1))
		}
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('result'), expression, 'result'),
		])
		// Depth 300 sits comfortably within V8's default stack; #evaluate and
		// #containsVariable each descend the left spine once. 0 + 300 × 1 = 300.
		expect(expectSymbolic(reasoner.reason({}, definition)).solutions.result).toBe(300)
	})
})

describe('SymbolicReasoner — large equation list', () => {
	it('solves 150 chained equations in declaration order', () => {
		const equations = sequence(150).map((index) =>
			index === 0
				? createEquation('v0', createVariable('v0'), createConstant(0), 'v0')
				: createEquation(
						`v${index}`,
						createVariable(`v${index}`),
						createOperation('add', createVariable(`v${index - 1}`), createConstant(1)),
						`v${index}`,
					),
		)
		const result = expectSymbolic(
			reasoner.reason({}, createSymbolicDefinition('d', 'd', equations)),
		)
		expect(result.success).toBe(true)
		const keys = Object.keys(result.solutions)
		expect(keys).toHaveLength(150)
		expect(keys[0]).toBe('v0')
		expect(keys[149]).toBe('v149')
		expect(result.solutions.v75).toBe(75)
		expect(result.solutions.v149).toBe(149)
	})
})

describe('SymbolicReasoner — sparse equations array', () => {
	it('a sparse equations array solves only the present equations', () => {
		const equations = sparse<Equation>(3, [
			[0, createEquation('e1', createVariable('x'), createConstant(5), 'x')],
			[2, createEquation('e2', createVariable('y'), createConstant(7), 'y')],
		])
		const result = expectSymbolic(
			reasoner.reason({}, createSymbolicDefinition('d', 'd', equations)),
		)
		expect(result.success).toBe(true)
		expect(result.errors).toEqual([])
		expect(result.solutions).toEqual({ x: 5, y: 7 })
	})
})

describe('SymbolicReasoner — divide-by-zero inversion (zero guards)', () => {
	it('inverting multiply on the RIGHT operand by zero yields NaN (0 × x = 5)', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation('multiply', createConstant(0), createVariable('x')),
				createConstant(5),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": produced non-finite value (NaN)'])
		// NaN is NEVER bound (the finite guard `continue`s before binding), so x is absent.
		expect('x' in result.solutions).toBe(false)
	})

	it('inverting divide where the DIVIDEND target must equal a zero result yields NaN (20 / x = 0)', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation('divide', createConstant(20), createVariable('x')),
				createConstant(0),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": produced non-finite value (NaN)'])
		expect('x' in result.solutions).toBe(false)
	})
})

describe('SymbolicReasoner — parseNumber binding-site boundary pins', () => {
	const bindsAs = (value: unknown): SymbolicResult => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('y'), createVariable('x'), 'y'),
		])
		return expectSymbolic(reasoner.reason({ x: value }, definition))
	}

	const neverBinds = (value: unknown): SymbolicResult => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('y'), createVariable('x'), 'y'),
		])
		return expectSymbolic(reasoner.reason({ x: value }, definition))
	}

	it('exponential-notation string "1e3" binds 1000', () => {
		const result = bindsAs('1e3')
		expect(result.success).toBe(true)
		expect(result.solutions.y).toBe(1000)
	})

	it('hex-notation string "0x10" binds 16', () => {
		const result = bindsAs('0x10')
		expect(result.success).toBe(true)
		expect(result.solutions.y).toBe(16)
	})

	it('a numeric string with surrounding spaces binds trimmed (" 42 " → 42)', () => {
		const result = bindsAs(' 42 ')
		expect(result.success).toBe(true)
		expect(result.solutions.y).toBe(42)
	})

	it('an empty string never binds', () => {
		const result = neverBinds('')
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": Unbound variable: x'])
	})

	it('a whitespace-only string never binds', () => {
		const result = neverBinds('   ')
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": Unbound variable: x'])
	})

	it('the string "Infinity" never binds (finite guard rejects it)', () => {
		const result = neverBinds('Infinity')
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": Unbound variable: x'])
	})

	it('a boolean true never binds — never coerced to 1', () => {
		const result = neverBinds(true)
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": Unbound variable: x'])
	})

	it('a bigint value never binds', () => {
		const result = neverBinds(9007199254740993n)
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": Unbound variable: x'])
	})
})

describe('SymbolicReasoner — isolation edge pins', () => {
	it('an unbound target on both sides of DIFFERENT operations fails with the exact Unbound message', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation('multiply', createVariable('x'), createConstant(2)),
				createOperation('add', createVariable('x'), createConstant(3)),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": Unbound variable: x'])
	})

	it('a target on both operands of a single "multiply" fails with the exact appears-on-both-sides text', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation('multiply', createVariable('x'), createVariable('x')),
				createConstant(9),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual([
			'Equation "e1": Cannot isolate "x" — variable appears on both sides of "multiply"',
		])
	})

	it('a non-invertible "abs" in the isolation path fails with the exact non-invertible message', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createOperation('abs', createVariable('x')), createConstant(5), 'x'),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual([
			'Equation "e1": Cannot isolate "x" through non-invertible operation "abs"',
		])
	})

	it('a division-inverse hitting zero deep in the isolation chain yields NaN, then the non-finite rejection', () => {
		// (x / 0) + 3 = 10 — peels "add" first (x/0 = 7), then invertLeft("divide", 7, 0) = NaN.
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createOperation(
					'add',
					createOperation('divide', createVariable('x'), createConstant(0)),
					createConstant(3),
				),
				createConstant(10),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({}, definition))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['Equation "e1": produced non-finite value (NaN)'])
		expect('x' in result.solutions).toBe(false)
	})
})

describe('SymbolicReasoner — pre-bound target rebinding', () => {
	it('a SUBJECT-bound target with no unbound occurrence is clobbered by the re-evaluated right side', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				createVariable('x'),
				createOperation('add', createConstant(3), createConstant(4)),
				'x',
			),
		])
		const result = expectSymbolic(reasoner.reason({ x: 5 }, definition))
		expect(result.success).toBe(true)
		// x was subject-bound to 5, but neither side contains an UNBOUND x, so the
		// right side (3 + 4 = 7) is evaluated directly and rebinds the target.
		expect(result.solutions).toEqual({ x: 7 })
	})
})

describe('SymbolicReasoner — deep invertible isolation (750-peel)', () => {
	it('isolates x through 750 nested "add 1" layers: x + 750×1 = 1000 → x = 250', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				deepAddition(750, createVariable('x'), createConstant(1)),
				createConstant(1000),
				'x',
			),
		])
		const run = (): number => {
			const result = expectSymbolic(reasoner.reason({}, definition)).solutions.x
			if (result === undefined) throw new Error('expected x solution')
			return result
		}
		const first = run()
		const second = run()
		expect(first).toBe(250)
		expect(second).toBe(250)
	})
})

describe('SymbolicReasoner — binding enumeration order (INTEGER_KEY_SUBJECT)', () => {
	it('binds integer-like keys ascending (1, 2, 10) before insertion-ordered string keys', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation('e1', createVariable('y'), createConstant(0), 'y'),
		])
		const run = (): readonly string[] => {
			const result = expectSymbolic(reasoner.reason(INTEGER_KEY_SUBJECT, definition))
			expect(result.success).toBe(true)
			return result.trace
		}
		const first = run()
		const second = run()
		expect(first).toEqual(second)

		const order = ['1', '2', '10', 'zeta', 'alpha']
		const indices = order.map((key) =>
			first.indexOf(`Subject field "${key}" bound as ${key} = ${INTEGER_KEY_SUBJECT[key]}`),
		)
		expect(indices.every((index) => index >= 0)).toBe(true)
		expect(indices).toEqual([...indices].sort((left, right) => left - right))
		expect(new Set(indices).size).toBe(indices.length)
	})
})

describe('SymbolicReasoner — precision drift over a long additive chain', () => {
	it('isolates x through 100 nested "add 0.1" layers and rounds the drifted result to 4 places', () => {
		const definition = createSymbolicDefinition('d', 'd', [
			createEquation(
				'e1',
				deepAddition(100, createVariable('x'), createConstant(0.1)),
				createConstant(1000),
				'x',
			),
		])
		const run = (): number => {
			const result = expectSymbolic(reasoner.reason({}, definition)).solutions.x
			if (result === undefined) throw new Error('expected x solution')
			return result
		}
		const first = run()
		const second = run()
		// Repeated floating-point subtraction of 0.1 across 100 peels drifts the raw
		// solve to 989.9999999999977 — roundTo(·, 4) settles it at exactly 990.
		expect(first).toBe(990)
		expect(second).toBe(990)
	})
})

describe('SymbolicReasoner — builder build() output passed to supports/validate/reason', () => {
	const definition = createSymbolicDefinition('d', 'd', [
		createEquation('e1', createVariable('x'), createConstant(42), 'x'),
	])

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
