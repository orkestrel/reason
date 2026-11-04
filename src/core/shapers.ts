import type { ContractShape } from '@orkestrel/contract'
import {
	arrayShape,
	booleanShape,
	auditFaultShape,
	shapeShape,
	jsonShape,
	literalShape,
	nullableShape,
	numberShape,
	objectShape,
	optionalShape,
	recordShape,
	stringShape,
	unionShape,
} from '@orkestrel/contract'
import {
	AGGREGATIONS,
	CHAIN_STRATEGIES,
	CHECK_STATES,
	COMPARISONS,
	EXPRESSION_SHAPE_DEPTH,
	LOGICAL_OPERATORS,
	MATH_OPERATIONS,
	SYMBOLIC_SHAPE_DEPTH,
} from './constants.js'

// The package's definitions and results as shapes, so they reach an LLM, a tool, and MCP as
// JSON Schema. The guards in `validators.ts` stay the authority on a definition, because a
// shape refuses cycles: `Expression` and `SymbolicExpression` are recursive, so each is a
// depth-bounded expansion here and a test holds `is` inside the guard. Connective arity and
// the rest of what `validate` reads are left to `validate`. Building those expansions is what
// costs, so that family stays behind functions and an import pays nothing for it.

/** Describes a `FieldPath` — one key, or the keys descending into nested objects. */
export const fieldPathShape: ContractShape = unionShape(stringShape(), arrayShape(stringShape()))

/** Describes a `Check` — one field predicate, its expected value any JSON value. */
export const checkShape: ContractShape = objectShape({
	field: fieldPathShape,
	operator: literalShape(COMPARISONS),
	value: jsonShape(),
})

/** Describes a `Transform` — one math step. */
export const transformShape: ContractShape = objectShape({
	operation: literalShape(MATH_OPERATIONS),
	operand: optionalShape(numberShape()),
})

/** Describes a `Bounds` — an inclusive numeric clamp. */
export const boundsShape: ContractShape = objectShape({
	minimum: optionalShape(numberShape()),
	maximum: optionalShape(numberShape()),
})

/** Describes a `FactorRange` — one band of a range source. */
export const factorRangeShape: ContractShape = objectShape({
	bounds: optionalShape(boundsShape),
	value: numberShape(),
})

/** Describes a `FactorSource` — a static, field, lookup, or range source. */
export const factorSourceShape: ContractShape = unionShape(
	objectShape({ origin: literalShape(['static']), value: numberShape() }),
	objectShape({ origin: literalShape(['field']), field: fieldPathShape }),
	objectShape({
		origin: literalShape(['lookup']),
		field: fieldPathShape,
		table: recordShape(numberShape()),
	}),
	objectShape({
		origin: literalShape(['range']),
		field: fieldPathShape,
		ranges: arrayShape(factorRangeShape),
	}),
)

/** Describes a `Factor` — one scored input of a quantitative group. */
export const factorShape: ContractShape = objectShape({
	id: stringShape(),
	name: stringShape(),
	description: optionalShape(stringShape()),
	source: factorSourceShape,
	fallback: optionalShape(numberShape()),
	checks: optionalShape(arrayShape(checkShape)),
	transforms: optionalShape(arrayShape(transformShape)),
	bounds: optionalShape(boundsShape),
	weight: optionalShape(numberShape()),
	priority: optionalShape(numberShape()),
	enabled: optionalShape(booleanShape()),
	required: optionalShape(booleanShape()),
})

/** Describes a `FactorGroup` — a group of factors aggregated into one value. */
export const factorGroupShape: ContractShape = objectShape({
	id: stringShape(),
	name: stringShape(),
	description: optionalShape(stringShape()),
	factors: arrayShape(factorShape),
	aggregation: literalShape(AGGREGATIONS),
	base: optionalShape(numberShape()),
	bounds: optionalShape(boundsShape),
	enabled: optionalShape(booleanShape()),
	strict: optionalShape(booleanShape()),
})

/**
 * Describes a `QuantitativeDefinition`.
 *
 * @remarks
 * `shape` admits a valid nested `ContractShape`.
 */
export const quantitativeDefinitionShape: ContractShape = objectShape({
	reasoning: literalShape(['quantitative']),
	id: stringShape(),
	name: stringShape(),
	description: optionalShape(stringShape()),
	groups: arrayShape(factorGroupShape),
	aggregation: literalShape(AGGREGATIONS),
	base: optionalShape(numberShape()),
	bounds: optionalShape(boundsShape),
	precision: optionalShape(numberShape()),
	shape: optionalShape(shapeShape()),
})

/**
 * Creates the shape of an `Expression` nesting at most `depth` connectives.
 *
 * @remarks
 * One `operands` array serves every connective, so the schema grows linearly with `depth`, and
 * arity stays with `validate`, since a shape holding it refuses to build at depth 7.
 *
 * @param depth - How many connectives may nest. Default: `EXPRESSION_SHAPE_DEPTH`
 * @returns A shape admitting an atom, or a compound over shapes one level down
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { createAtom, createCompound, createExpressionShape } from '@src/core'
 *
 * const atom = createAtom('a', 'equals', 1)
 * const contract = createContract(createExpressionShape(1))
 * contract.is(createCompound('not', [atom]))                             // true
 * contract.is(createCompound('not', [createCompound('not', [atom])])) // false
 * ```
 */
export function createExpressionShape(depth: number = EXPRESSION_SHAPE_DEPTH): ContractShape {
	const atom = objectShape({ form: literalShape(['atom']), check: checkShape })
	if (depth <= 0) return atom
	return unionShape(
		atom,
		objectShape({
			form: literalShape(['compound']),
			operator: literalShape(LOGICAL_OPERATORS),
			operands: arrayShape(createExpressionShape(depth - 1)),
		}),
	)
}

/**
 * Creates the shape of a `Rule` — premises and a conclusion.
 *
 * @returns A shape holding expressions at `EXPRESSION_SHAPE_DEPTH`
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { createAtom, createRule, createRuleShape } from '@src/core'
 *
 * const rule = createRule('r', [createAtom('a', 'equals', 1)], createAtom('ok', 'equals', true))
 * createContract(createRuleShape()).is(rule) // true
 * ```
 */
export function createRuleShape(): ContractShape {
	const expression = createExpressionShape()
	return objectShape({
		id: stringShape(),
		name: stringShape(),
		description: optionalShape(stringShape()),
		premises: arrayShape(expression),
		conclusion: expression,
		priority: optionalShape(numberShape()),
		enabled: optionalShape(booleanShape()),
	})
}

/**
 * Creates the shape of a `LogicalDefinition`.
 *
 * @remarks
 * `shape` admits a valid nested `ContractShape`.
 *
 * @returns A shape holding rules at `EXPRESSION_SHAPE_DEPTH`
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { createLogicalDefinition, createLogicalDefinitionShape } from '@src/core'
 *
 * createContract(createLogicalDefinitionShape()).is(createLogicalDefinition('d', 'd', [])) // true
 * ```
 */
export function createLogicalDefinitionShape(): ContractShape {
	return objectShape({
		reasoning: literalShape(['logical']),
		id: stringShape(),
		name: stringShape(),
		description: optionalShape(stringShape()),
		rules: arrayShape(createRuleShape()),
		strategy: literalShape(CHAIN_STRATEGIES),
		depth: optionalShape(numberShape()),
		shape: optionalShape(shapeShape()),
	})
}

/**
 * Creates the shape of a `SymbolicExpression` nesting at most `depth` operations.
 *
 * @remarks
 * An operation holds two sides, so the schema doubles with each level.
 *
 * @param depth - How many operations may nest. Default: `SYMBOLIC_SHAPE_DEPTH`
 * @returns A shape admitting a variable, a constant, or an operation over shapes one level down
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { createConstant, createOperation, createSymbolicExpressionShape } from '@src/core'
 *
 * const contract = createContract(createSymbolicExpressionShape(0))
 * contract.is(createConstant(1))                                         // true
 * contract.is(createOperation('abs', createConstant(1)))                 // false
 * ```
 */
export function createSymbolicExpressionShape(depth: number = SYMBOLIC_SHAPE_DEPTH): ContractShape {
	const variable = objectShape({ form: literalShape(['variable']), name: stringShape() })
	const constant = objectShape({ form: literalShape(['constant']), value: numberShape() })
	if (depth <= 0) return unionShape(variable, constant)
	const inner = createSymbolicExpressionShape(depth - 1)
	return unionShape(
		variable,
		constant,
		objectShape({
			form: literalShape(['operation']),
			operator: literalShape(MATH_OPERATIONS),
			left: inner,
			right: optionalShape(inner),
		}),
	)
}

/**
 * Creates the shape of an `Equation` — `left = right`, solved for `target`.
 *
 * @returns A shape holding expressions at `SYMBOLIC_SHAPE_DEPTH`
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { createConstant, createEquation, createEquationShape, createVariable } from '@src/core'
 *
 * const equation = createEquation('e', createVariable('x'), createConstant(1), 'x')
 * createContract(createEquationShape()).is(equation) // true
 * ```
 */
export function createEquationShape(): ContractShape {
	const expression = createSymbolicExpressionShape()
	return objectShape({
		id: stringShape(),
		name: stringShape(),
		description: optionalShape(stringShape()),
		left: expression,
		right: expression,
		target: stringShape(),
	})
}

/**
 * Creates the shape of a `SymbolicDefinition`.
 *
 * @remarks
 * `shape` admits a valid nested `ContractShape`.
 *
 * @returns A shape holding equations at `SYMBOLIC_SHAPE_DEPTH`
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { createSymbolicDefinition, createSymbolicDefinitionShape } from '@src/core'
 *
 * createContract(createSymbolicDefinitionShape()).is(createSymbolicDefinition('d', 'd', [])) // true
 * ```
 */
export function createSymbolicDefinitionShape(): ContractShape {
	return objectShape({
		reasoning: literalShape(['symbolic']),
		id: stringShape(),
		name: stringShape(),
		description: optionalShape(stringShape()),
		equations: arrayShape(createEquationShape()),
		variables: recordShape(numberShape()),
		precision: optionalShape(numberShape()),
		shape: optionalShape(shapeShape()),
	})
}

/** Describes a `Fact` — a predicate over positional terms. */
export const factShape: ContractShape = objectShape({
	id: stringShape(),
	predicate: stringShape(),
	terms: arrayShape(jsonShape()),
	confidence: optionalShape(numberShape()),
})

/** Describes an `Inference` — premise patterns and a conclusion pattern. */
export const inferenceShape: ContractShape = objectShape({
	id: stringShape(),
	name: stringShape(),
	description: optionalShape(stringShape()),
	premises: arrayShape(factShape),
	conclusion: factShape,
	confidence: optionalShape(numberShape()),
	enabled: optionalShape(booleanShape()),
})

/**
 * Describes an `InferentialDefinition`.
 *
 * @remarks
 * `shape` admits a valid nested `ContractShape`.
 */
export const inferentialDefinitionShape: ContractShape = objectShape({
	reasoning: literalShape(['inferential']),
	id: stringShape(),
	name: stringShape(),
	description: optionalShape(stringShape()),
	inferences: arrayShape(inferenceShape),
	facts: arrayShape(factShape),
	strategy: literalShape(CHAIN_STRATEGIES),
	depth: optionalShape(numberShape()),
	shape: optionalShape(shapeShape()),
})

/**
 * Creates the shape of any `Definition`, discriminated by `reasoning`.
 *
 * @returns A union of the four definition shapes
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { createDefinitionShape, createLogicalDefinition } from '@src/core'
 *
 * createContract(createDefinitionShape()).is(createLogicalDefinition('d', 'd', [])) // true
 * ```
 */
export function createDefinitionShape(): ContractShape {
	return unionShape(
		quantitativeDefinitionShape,
		createLogicalDefinitionShape(),
		createSymbolicDefinitionShape(),
		inferentialDefinitionShape,
	)
}

/** Describes a `CheckResult` in its JSON projection. */
export const checkResultShape: ContractShape = objectShape({
	field: fieldPathShape,
	state: literalShape(CHECK_STATES),
	actual: optionalShape(jsonShape()),
	error: optionalShape(stringShape()),
})

/** Describes a `FactorResult` in its JSON projection, where a non-finite number is `null`. */
export const factorResultShape: ContractShape = objectShape({
	id: stringShape(),
	applied: booleanShape(),
	value: nullableShape(numberShape()),
	raw: optionalShape(nullableShape(numberShape())),
	checks: optionalShape(arrayShape(checkResultShape)),
})

/** Describes a `GroupResult` in its JSON projection, where a non-finite number is `null`. */
export const groupResultShape: ContractShape = objectShape({
	id: stringShape(),
	applied: booleanShape(),
	value: nullableShape(numberShape()),
	factors: arrayShape(factorResultShape),
})

/** Describes a `RuleResult` in its JSON projection. */
export const ruleResultShape: ContractShape = objectShape({
	id: stringShape(),
	state: literalShape(CHECK_STATES),
	premises: arrayShape(literalShape(CHECK_STATES)),
	checks: arrayShape(checkResultShape),
})

/** Describes a `QuantitativeResult` in its JSON projection, where a non-finite number is `null`. */
export const quantitativeResultShape: ContractShape = objectShape({
	reasoning: literalShape(['quantitative']),
	value: nullableShape(numberShape()),
	groups: arrayShape(groupResultShape),
	count: numberShape(),
	success: booleanShape(),
	trace: arrayShape(stringShape()),
	errors: arrayShape(stringShape()),
	faults: arrayShape(auditFaultShape()),
	repairs: arrayShape(auditFaultShape()),
	defaulted: arrayShape(fieldPathShape),
})

/** Describes a `LogicalResult` in its JSON projection. */
export const logicalResultShape: ContractShape = objectShape({
	reasoning: literalShape(['logical']),
	conclusion: literalShape(CHECK_STATES),
	rules: arrayShape(ruleResultShape),
	count: numberShape(),
	success: booleanShape(),
	trace: arrayShape(stringShape()),
	errors: arrayShape(stringShape()),
	faults: arrayShape(auditFaultShape()),
	repairs: arrayShape(auditFaultShape()),
	defaulted: arrayShape(fieldPathShape),
})

/** Describes a `SymbolicResult` in its JSON projection. */
export const symbolicResultShape: ContractShape = objectShape({
	reasoning: literalShape(['symbolic']),
	solutions: recordShape(numberShape()),
	success: booleanShape(),
	trace: arrayShape(stringShape()),
	errors: arrayShape(stringShape()),
	faults: arrayShape(auditFaultShape()),
	repairs: arrayShape(auditFaultShape()),
	defaulted: arrayShape(fieldPathShape),
})

/**
 * Describes an `InferentialResult` in its JSON projection.
 *
 * @remarks
 * `proof` is any JSON value here, because a `ProofNode` is recursive with no bound but the
 * definition's own `depth`. `isProofNode` reads it.
 */
export const inferentialResultShape: ContractShape = objectShape({
	reasoning: literalShape(['inferential']),
	derived: arrayShape(factShape),
	proof: optionalShape(jsonShape()),
	success: booleanShape(),
	trace: arrayShape(stringShape()),
	errors: arrayShape(stringShape()),
	faults: arrayShape(auditFaultShape()),
	repairs: arrayShape(auditFaultShape()),
	defaulted: arrayShape(fieldPathShape),
})

/** Describes any `ReasonResult` in its JSON projection, discriminated by `reasoning`. */
export const resultShape: ContractShape = unionShape(
	quantitativeResultShape,
	logicalResultShape,
	symbolicResultShape,
	inferentialResultShape,
)
