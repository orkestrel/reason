import type { FieldPath, Guard } from '@orkestrel/contract'
import type {
	Aggregation,
	Bounds,
	ChainingStrategy,
	Check,
	CheckResult,
	Comparison,
	Definition,
	DefinitionBuilderInterface,
	Equation,
	Expression,
	Fact,
	Factor,
	FactorGroup,
	FactorRange,
	FactorResult,
	GroupResult,
	Inference,
	InferentialDefinition,
	InferentialResult,
	LogicalDefinition,
	LogicalOperator,
	LogicalResult,
	MathOperation,
	ProofNode,
	QuantitativeDefinition,
	QuantitativeResult,
	ReasonResult,
	ReasonValidationResult,
	Reasoning,
	Rule,
	RuleResult,
	Source,
	SubjectBuilderInterface,
	SymbolicDefinition,
	SymbolicExpression,
	SymbolicResult,
	Transform,
} from './types.js'
import {
	arrayOf,
	GUARD_DEPTH_LIMIT,
	holds,
	isArray,
	isBoolean,
	isFiniteNumber,
	isNumber,
	isObject,
	isRecord,
	isString,
	lazyOf,
	literalOf,
	notOf,
	orOf,
	readArrayEntries,
	recordOf,
	unionOf,
	whereOf,
} from '@orkestrel/contract'
import { DEFINITION_BUILDER_BRAND, SUBJECT_BUILDER_BRAND } from './constants.js'

// AGENTS §14: every guard here is a TOTAL function — adversarial input (junk,
// hostile prototypes, deep nesting) returns `false`, never throws. Input guards
// compose the contracts combinators. Result guards use bespoke
// open member checks, with the combinators retained for nested values. Of the
// three recursive shapes,
// `isExpression` and `isSymbolicExpression` recurse through `lazyOf`, while
// `isProofNode` uses a depth-bounded iterative worklist. Both sanctioned
// mechanisms contain pathologically deep or cyclic input as a non-match.
// Input record guards are EXACT (`recordOf`): an extra key fails, so a
// definition that drifted from its declared shape is rejected loudly. Result
// guards are OPEN: exactness follows who produces the value, not who declares
// the type — caller-supplied inputs are exact, while package or
// foreign-interface outputs may carry extra members. Numeric definition
// fields guard with `isFiniteNumber` — JSON cannot carry `NaN` /
// `±Infinity`, so a non-finite number marks a corrupted definition. The one
// unconstrained field (`Check.value`, legitimately ANY value including `null`)
// uses the trivially-true guard `notOf(unionOf())` — `unionOf()` of zero guards
// is always-false, its negation always-true. Record-shape guards take the
// declared-predicate function form (the `recordOf` shape inlined per call, so
// no non-exported member lingers — §5; terminals precedent).

/**
 * Determine whether a value is a {@link Reasoning} literal.
 *
 * @param value - The value to test
 * @returns `true` when `value` is one of the four reasoning strategies
 *
 * @example
 * ```ts
 * import { isReasoning } from '@src/core'
 *
 * isReasoning('logical') // true
 * isReasoning('fuzzy')   // false
 * ```
 */
export const isReasoning: Guard<Reasoning> = literalOf(
	'quantitative',
	'logical',
	'symbolic',
	'inferential',
)

/**
 * Determine whether a value is a {@link ChainingStrategy} literal.
 *
 * @param value - The value to test
 * @returns `true` when `value` is `'forward'` or `'backward'`
 *
 * @example
 * ```ts
 * import { isChainingStrategy } from '@src/core'
 *
 * isChainingStrategy('forward') // true
 * isChainingStrategy('upward')  // false
 * ```
 */
export const isChainingStrategy: Guard<ChainingStrategy> = literalOf('forward', 'backward')

/**
 * Determine whether a value is a {@link MathOperation} literal.
 *
 * @param value - The value to test
 * @returns `true` when `value` is one of the thirteen math operations
 *
 * @example
 * ```ts
 * import { isMathOperation } from '@src/core'
 *
 * isMathOperation('multiply') // true
 * isMathOperation('modulo')   // false
 * ```
 */
export const isMathOperation: Guard<MathOperation> = literalOf(
	'add',
	'subtract',
	'multiply',
	'divide',
	'percentage',
	'minimum',
	'maximum',
	'average',
	'power',
	'round',
	'ceil',
	'floor',
	'abs',
)

/**
 * Determine whether a value is an {@link Aggregation} literal.
 *
 * @param value - The value to test
 * @returns `true` when `value` is one of the five aggregations
 *
 * @example
 * ```ts
 * import { isAggregation } from '@src/core'
 *
 * isAggregation('sum')    // true
 * isAggregation('median') // false
 * ```
 */
export const isAggregation: Guard<Aggregation> = literalOf(
	'sum',
	'product',
	'average',
	'minimum',
	'maximum',
)

/**
 * Determine whether a value is a {@link Comparison} literal.
 *
 * @param value - The value to test
 * @returns `true` when `value` is one of the ten comparison operators
 *
 * @example
 * ```ts
 * import { isComparison } from '@src/core'
 *
 * isComparison('between')     // true
 * isComparison('greaterThan') // false — the operator vocabulary is single-word
 * ```
 */
export const isComparison: Guard<Comparison> = literalOf(
	'equals',
	'not',
	'above',
	'below',
	'from',
	'to',
	'any',
	'none',
	'between',
	'outside',
)

/**
 * Determine whether a value is a {@link LogicalOperator} literal.
 *
 * @param value - The value to test
 * @returns `true` when `value` is one of the five logical connectives
 *
 * @example
 * ```ts
 * import { isLogicalOperator } from '@src/core'
 *
 * isLogicalOperator('implies') // true
 * isLogicalOperator('nand')    // false
 * ```
 */
export const isLogicalOperator: Guard<LogicalOperator> = literalOf(
	'and',
	'or',
	'not',
	'implies',
	'xor',
)

/**
 * Determine whether a value is a {@link FieldPath} — a single string key or an
 * array of keys descending into nested objects.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a string or an array of strings
 *
 * @example
 * ```ts
 * import { isFieldPath } from '@src/core'
 *
 * isFieldPath('age')               // true — ONE key (never dot-split)
 * isFieldPath(['address', 'city']) // true — descends
 * isFieldPath(42)                  // false
 * ```
 */
export const isFieldPath: Guard<FieldPath> = orOf(isString, arrayOf(isString))

/**
 * Determine whether a value is a `Subject` — a plain record of fields to reason
 * about.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a plain record (arrays and class instances fail)
 *
 * @example
 * ```ts
 * import { isSubject } from '@src/core'
 *
 * isSubject({ age: 30 }) // true
 * isSubject([1, 2, 3])   // false — an array is not a subject
 * ```
 */
export const isSubject: Guard<Readonly<Record<string, unknown>>> = isRecord

/**
 * Determine whether a value is a record whose every value is a finite number —
 * the shape of a `LookupSource.table` and a `SymbolicDefinition.variables`.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a plain record of finite numbers
 *
 * @example
 * ```ts
 * import { isNumberRecord } from '@src/core'
 *
 * isNumberRecord({ CA: 1.2, NY: 0.8 }) // true
 * isNumberRecord({ CA: '1.2' })        // false — strings do not coerce here
 * ```
 */
export const isNumberRecord: Guard<Readonly<Record<string, number>>> = whereOf(
	isRecord,
	(record): record is Record<string, number> => Object.values(record).every(isFiniteNumber),
)

/**
 * Determine whether a value is a {@link Check} — a field / operator / value
 * predicate.
 *
 * @remarks
 * `value` may be ANYTHING (including `null` / `undefined`) but the key must be
 * PRESENT — exact-record semantics reject a check that lost its `value` key.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed check
 *
 * @example
 * ```ts
 * import { isCheck } from '@src/core'
 *
 * isCheck({ field: 'age', operator: 'above', value: 18 }) // true
 * isCheck({ field: 'age', operator: 'over', value: 18 })  // false — unknown operator
 * ```
 */
export function isCheck(value: unknown): value is Check {
	return recordOf({
		field: isFieldPath,
		operator: isComparison,
		value: notOf(unionOf()),
	})(value)
}

/**
 * Determine whether a value is a {@link Transform} — one math step.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed transform
 *
 * @example
 * ```ts
 * import { isTransform } from '@src/core'
 *
 * isTransform({ operation: 'multiply', operand: 2 }) // true
 * isTransform({ operation: 'round' })                // true — operand is optional
 * isTransform({ operation: 'multiply', by: 2 })      // false — extra key
 * ```
 */
export function isTransform(value: unknown): value is Transform {
	return recordOf({ operation: isMathOperation, operand: isFiniteNumber }, ['operand'])(value)
}

/**
 * Determine whether a value is a {@link Bounds} — an inclusive numeric clamp.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed bounds record (both sides optional)
 *
 * @example
 * ```ts
 * import { isBounds } from '@src/core'
 *
 * isBounds({ minimum: 0, maximum: 100 }) // true
 * isBounds({})                           // true — unbounded
 * isBounds({ minimum: NaN })             // false — non-finite
 * ```
 */
export function isBounds(value: unknown): value is Bounds {
	return recordOf({ minimum: isFiniteNumber, maximum: isFiniteNumber }, true)(value)
}

/**
 * Determine whether a value is a {@link FactorRange} — one band of a range
 * source.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed factor range
 *
 * @example
 * ```ts
 * import { isFactorRange } from '@src/core'
 *
 * isFactorRange({ bounds: { maximum: 25 }, value: 1.5 }) // true
 * isFactorRange({ value: 42 })                           // true — a catch-all band
 * ```
 */
export function isFactorRange(value: unknown): value is FactorRange {
	return recordOf({ bounds: isBounds, value: isFiniteNumber }, ['bounds'])(value)
}

/**
 * Determine whether a value is a {@link Source} — any of the four factor
 * sources, discriminated by `origin`.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed static / field / lookup / range source
 *
 * @example
 * ```ts
 * import { isSource } from '@src/core'
 *
 * isSource({ origin: 'static', value: 42 })                        // true
 * isSource({ origin: 'lookup', field: 'state', table: { CA: 5 } }) // true
 * isSource({ origin: 'random' })                                   // false
 * ```
 */
export function isSource(value: unknown): value is Source {
	return unionOf(
		recordOf({ origin: literalOf('static'), value: isFiniteNumber }),
		recordOf({ origin: literalOf('field'), field: isFieldPath }),
		recordOf({ origin: literalOf('lookup'), field: isFieldPath, table: isNumberRecord }),
		recordOf({ origin: literalOf('range'), field: isFieldPath, ranges: arrayOf(isFactorRange) }),
	)(value)
}

/**
 * Determine whether a value is a {@link Factor} — one scored input of a
 * quantitative group.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed factor
 *
 * @example
 * ```ts
 * import { isFactor } from '@src/core'
 *
 * isFactor({ id: 'age', name: 'Age', source: { origin: 'field', field: 'age' } }) // true
 * isFactor({ id: 'age', name: 'Age' })                                            // false — no source
 * ```
 */
export function isFactor(value: unknown): value is Factor {
	return recordOf(
		{
			id: isString,
			name: isString,
			description: isString,
			source: isSource,
			fallback: isFiniteNumber,
			checks: arrayOf(isCheck),
			transforms: arrayOf(isTransform),
			bounds: isBounds,
			weight: isFiniteNumber,
			priority: isFiniteNumber,
			enabled: isBoolean,
			required: isBoolean,
		},
		[
			'description',
			'fallback',
			'checks',
			'transforms',
			'bounds',
			'weight',
			'priority',
			'enabled',
			'required',
		],
	)(value)
}

/**
 * Determine whether a value is a {@link FactorGroup} — a group of factors
 * aggregated into one value.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed factor group
 *
 * @example
 * ```ts
 * import { isFactorGroup, staticFactor } from '@src/core'
 *
 * isFactorGroup({ id: 'g1', name: 'g1', aggregation: 'sum', factors: [staticFactor('f1', 10)] }) // true
 * isFactorGroup({ id: 'g1', name: 'g1', aggregation: 'median', factors: [] })                    // false
 * ```
 */
export function isFactorGroup(value: unknown): value is FactorGroup {
	return recordOf(
		{
			id: isString,
			name: isString,
			description: isString,
			factors: arrayOf(isFactor),
			aggregation: isAggregation,
			base: isFiniteNumber,
			bounds: isBounds,
			enabled: isBoolean,
			strict: isBoolean,
		},
		['description', 'base', 'bounds', 'enabled', 'strict'],
	)(value)
}

/**
 * Determine whether a value is an {@link Expression} — a boolean expression
 * tree of atoms and compounds, discriminated by `form`.
 *
 * @remarks
 * Recursive through `lazyOf` (AGENTS §14) — recursion is STACK-BOUNDED, not
 * unbounded: nesting beyond the engine's stack budget (roughly 1000 levels)
 * and cyclic input are CONTAINED as `false`, never a throw. Input past that
 * bound is rejected, not validated.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed expression tree
 *
 * @example
 * ```ts
 * import { atom, compound, isExpression } from '@src/core'
 *
 * isExpression(atom('age', 'from', 18))                    // true
 * isExpression(compound('and', [atom('age', 'from', 18)])) // true
 * isExpression({ form: 'compound', operator: 'and' })      // false — operands missing
 * ```
 */
export function isExpression(value: unknown): value is Expression {
	return unionOf(
		recordOf({ form: literalOf('atom'), check: isCheck }),
		recordOf({
			form: literalOf('compound'),
			operator: isLogicalOperator,
			operands: arrayOf(lazyOf(() => isExpression)),
		}),
	)(value)
}

/**
 * Determine whether a value is a {@link Rule} — premises and a conclusion.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed rule
 *
 * @example
 * ```ts
 * import { atom, isRule, rule } from '@src/core'
 *
 * isRule(rule('adult', [atom('age', 'from', 18)], atom('adult', 'equals', true))) // true
 * isRule({ id: 'adult' })                                                         // false
 * ```
 */
export function isRule(value: unknown): value is Rule {
	return recordOf(
		{
			id: isString,
			name: isString,
			description: isString,
			premises: arrayOf(isExpression),
			conclusion: isExpression,
			priority: isFiniteNumber,
			enabled: isBoolean,
		},
		['description', 'priority', 'enabled'],
	)(value)
}

/**
 * Determine whether a value is a {@link SymbolicExpression} — an algebraic
 * expression tree of variables, constants, and operations, discriminated by
 * `form`.
 *
 * @remarks
 * Recursive through `lazyOf` (AGENTS §14) — recursion is STACK-BOUNDED, not
 * unbounded: nesting beyond the engine's stack budget (roughly 1000 levels)
 * and cyclic input are CONTAINED as `false`, never a throw. Input past that
 * bound is rejected, not validated.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed symbolic expression tree
 *
 * @example
 * ```ts
 * import { constant, isSymbolicExpression, operation, variable } from '@src/core'
 *
 * isSymbolicExpression(operation('add', variable('x'), constant(1))) // true
 * isSymbolicExpression({ form: 'variable' })                         // false — name missing
 * ```
 */
export function isSymbolicExpression(value: unknown): value is SymbolicExpression {
	return unionOf(
		recordOf({ form: literalOf('variable'), name: isString }),
		recordOf({ form: literalOf('constant'), value: isFiniteNumber }),
		recordOf(
			{
				form: literalOf('operation'),
				operator: isMathOperation,
				left: lazyOf(() => isSymbolicExpression),
				right: lazyOf(() => isSymbolicExpression),
			},
			['right'],
		),
	)(value)
}

/**
 * Determine whether a value is an {@link Equation} — `left = right`, solved for
 * `target`.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed equation
 *
 * @example
 * ```ts
 * import { constant, equation, isEquation, variable } from '@src/core'
 *
 * isEquation(equation('e1', variable('x'), constant(42), 'x')) // true
 * isEquation({ id: 'e1', target: 'x' })                        // false — sides missing
 * ```
 */
export function isEquation(value: unknown): value is Equation {
	return recordOf(
		{
			id: isString,
			name: isString,
			description: isString,
			left: isSymbolicExpression,
			right: isSymbolicExpression,
			target: isString,
		},
		['description'],
	)(value)
}

/**
 * Determine whether a value is a {@link Fact} — a predicate over positional
 * terms.
 *
 * @remarks
 * `terms` elements are unconstrained (`unknown`) — a `'?'`-prefixed string term
 * is a unification variable, anything else a constant.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed fact
 *
 * @example
 * ```ts
 * import { isFact } from '@src/core'
 *
 * isFact({ id: 'f1', predicate: 'human', terms: ['socrates'] }) // true
 * isFact({ id: 'f1', predicate: 'human' })                      // false — terms missing
 * ```
 */
export function isFact(value: unknown): value is Fact {
	return recordOf(
		{ id: isString, predicate: isString, terms: isArray, confidence: isFiniteNumber },
		['confidence'],
	)(value)
}

/**
 * Determine whether a value is an {@link Inference} — premise patterns and a
 * conclusion pattern.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed inference
 *
 * @example
 * ```ts
 * import { fact, inference, isInference } from '@src/core'
 *
 * isInference(inference('mortal', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']))) // true
 * isInference({ id: 'mortal' })                                                                 // false
 * ```
 */
export function isInference(value: unknown): value is Inference {
	return recordOf(
		{
			id: isString,
			name: isString,
			description: isString,
			premises: arrayOf(isFact),
			conclusion: isFact,
			confidence: isFiniteNumber,
			enabled: isBoolean,
		},
		['description', 'confidence', 'enabled'],
	)(value)
}

/**
 * Determine whether a value is a {@link QuantitativeDefinition}.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed quantitative definition
 *
 * @example
 * ```ts
 * import { isQuantitativeDefinition, quantitativeDefinition } from '@src/core'
 *
 * isQuantitativeDefinition(quantitativeDefinition('risk', 'Risk', [])) // true
 * isQuantitativeDefinition({ reasoning: 'quantitative', id: 'risk' })  // false
 * ```
 */
export function isQuantitativeDefinition(value: unknown): value is QuantitativeDefinition {
	return recordOf(
		{
			reasoning: literalOf('quantitative'),
			id: isString,
			name: isString,
			description: isString,
			groups: arrayOf(isFactorGroup),
			aggregation: isAggregation,
			base: isFiniteNumber,
			bounds: isBounds,
			precision: isFiniteNumber,
		},
		['description', 'base', 'bounds', 'precision'],
	)(value)
}

/**
 * Determine whether a value is a {@link LogicalDefinition}.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed logical definition
 *
 * @example
 * ```ts
 * import { isLogicalDefinition, logicalDefinition } from '@src/core'
 *
 * isLogicalDefinition(logicalDefinition('eligibility', 'Eligibility', [])) // true
 * isLogicalDefinition({ reasoning: 'logical', id: 'eligibility' })         // false
 * ```
 */
export function isLogicalDefinition(value: unknown): value is LogicalDefinition {
	return recordOf(
		{
			reasoning: literalOf('logical'),
			id: isString,
			name: isString,
			description: isString,
			rules: arrayOf(isRule),
			strategy: isChainingStrategy,
			depth: isFiniteNumber,
		},
		['description', 'depth'],
	)(value)
}

/**
 * Determine whether a value is a {@link SymbolicDefinition}.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed symbolic definition
 *
 * @example
 * ```ts
 * import { isSymbolicDefinition, symbolicDefinition } from '@src/core'
 *
 * isSymbolicDefinition(symbolicDefinition('rate', 'Rate', [])) // true
 * isSymbolicDefinition({ reasoning: 'symbolic', id: 'rate' })  // false
 * ```
 */
export function isSymbolicDefinition(value: unknown): value is SymbolicDefinition {
	return recordOf(
		{
			reasoning: literalOf('symbolic'),
			id: isString,
			name: isString,
			description: isString,
			equations: arrayOf(isEquation),
			variables: isNumberRecord,
			precision: isFiniteNumber,
		},
		['description', 'precision'],
	)(value)
}

/**
 * Determine whether a value is an {@link InferentialDefinition}.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed inferential definition
 *
 * @example
 * ```ts
 * import { inferentialDefinition, isInferentialDefinition } from '@src/core'
 *
 * isInferentialDefinition(inferentialDefinition('birds', 'Birds', [], [])) // true
 * isInferentialDefinition({ reasoning: 'inferential', id: 'birds' })       // false
 * ```
 */
export function isInferentialDefinition(value: unknown): value is InferentialDefinition {
	return recordOf(
		{
			reasoning: literalOf('inferential'),
			id: isString,
			name: isString,
			description: isString,
			inferences: arrayOf(isInference),
			facts: arrayOf(isFact),
			strategy: isChainingStrategy,
			depth: isFiniteNumber,
		},
		['description', 'depth'],
	)(value)
}

/**
 * Determine whether a value is a {@link Definition} — any of the four
 * definition shapes, discriminated by `reasoning`.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed definition of any reasoning
 *
 * @example
 * ```ts
 * import { isDefinition, logicalDefinition } from '@src/core'
 *
 * isDefinition(logicalDefinition('eligibility', 'Eligibility', [])) // true
 * isDefinition({ reasoning: 'quantum' })                            // false
 * ```
 */
export function isDefinition(value: unknown): value is Definition {
	return (
		isQuantitativeDefinition(value) ||
		isLogicalDefinition(value) ||
		isSymbolicDefinition(value) ||
		isInferentialDefinition(value)
	)
}

/**
 * Determine whether a value is a result-side {@link Fact}.
 *
 * @remarks
 * Unlike the exact input guard {@link isFact}, this guard accepts unknown
 * members, class instances, and every JavaScript `number` confidence.
 *
 * @param value - The value to test
 * @returns `true` when every published fact member is valid for a result
 *
 * @example
 * ```ts
 * import { isResultFact } from '@src/core'
 *
 * isResultFact({ id: 'f1', predicate: 'bird', terms: ['tweety'], note: 'derived' }) // true
 * isResultFact({ id: 'f1', predicate: 'bird' }) // false
 * ```
 */
export function isResultFact(value: unknown): value is Fact {
	return whereOf(isObject, (result): result is Fact => {
		if (isArray(result)) return false
		const confidence = Reflect.get(result, 'confidence')
		return (
			isString(Reflect.get(result, 'id')) &&
			isString(Reflect.get(result, 'predicate')) &&
			isArray(Reflect.get(result, 'terms')) &&
			(confidence === undefined || isNumber(confidence))
		)
	})(value)
}

/**
 * Determine whether a value is a {@link CheckResult}.
 *
 * @param value - The value to test
 * @returns `true` when every published check-result member is valid
 *
 * @example
 * ```ts
 * import { isCheckResult } from '@src/core'
 *
 * isCheckResult({ field: 'age', met: true, actual: 30 }) // true
 * isCheckResult({ field: 'age', met: 'yes', actual: 30 }) // false
 * ```
 */
export function isCheckResult(value: unknown): value is CheckResult {
	return whereOf(isObject, (result): result is CheckResult => {
		if (isArray(result)) return false
		const error = Reflect.get(result, 'error')
		return (
			isFieldPath(Reflect.get(result, 'field')) &&
			isBoolean(Reflect.get(result, 'met')) &&
			Reflect.has(result, 'actual') &&
			(error === undefined || isString(error))
		)
	})(value)
}

/**
 * Determine whether a value is a {@link FactorResult}.
 *
 * @param value - The value to test
 * @returns `true` when every published factor-result member is valid
 *
 * @example
 * ```ts
 * import { isFactorResult } from '@src/core'
 *
 * isFactorResult({ id: 'age', applied: true, value: 5 }) // true
 * isFactorResult({ id: 'age', applied: true, value: '5' }) // false
 * ```
 */
export function isFactorResult(value: unknown): value is FactorResult {
	return whereOf(isObject, (result): result is FactorResult => {
		if (isArray(result)) return false
		const raw = Reflect.get(result, 'raw')
		const checks = Reflect.get(result, 'checks')
		return (
			isString(Reflect.get(result, 'id')) &&
			isBoolean(Reflect.get(result, 'applied')) &&
			isNumber(Reflect.get(result, 'value')) &&
			(raw === undefined || isNumber(raw)) &&
			(checks === undefined || arrayOf(isCheckResult)(checks))
		)
	})(value)
}

/**
 * Determine whether a value is a {@link GroupResult}.
 *
 * @param value - The value to test
 * @returns `true` when every published group-result member is valid
 *
 * @example
 * ```ts
 * import { isGroupResult } from '@src/core'
 *
 * isGroupResult({ id: 'risk', applied: true, value: 5, factors: [] }) // true
 * isGroupResult({ id: 'risk', applied: true, value: 5 }) // false
 * ```
 */
export function isGroupResult(value: unknown): value is GroupResult {
	return whereOf(isObject, (result): result is GroupResult => {
		return (
			!isArray(result) &&
			isString(Reflect.get(result, 'id')) &&
			isBoolean(Reflect.get(result, 'applied')) &&
			isNumber(Reflect.get(result, 'value')) &&
			arrayOf(isFactorResult)(Reflect.get(result, 'factors'))
		)
	})(value)
}

/**
 * Determine whether a value is a {@link RuleResult}.
 *
 * @param value - The value to test
 * @returns `true` when every published rule-result member is valid
 *
 * @example
 * ```ts
 * import { isRuleResult } from '@src/core'
 *
 * isRuleResult({ id: 'adult', applied: true, premises: [true], conclusion: true }) // true
 * isRuleResult({ id: 'adult', applied: true, premises: [1], conclusion: true }) // false
 * ```
 */
export function isRuleResult(value: unknown): value is RuleResult {
	return whereOf(isObject, (result): result is RuleResult => {
		return (
			!isArray(result) &&
			isString(Reflect.get(result, 'id')) &&
			isBoolean(Reflect.get(result, 'applied')) &&
			arrayOf(isBoolean)(Reflect.get(result, 'premises')) &&
			isBoolean(Reflect.get(result, 'conclusion'))
		)
	})(value)
}

/**
 * Determine whether a value is a depth-bounded, acyclic {@link ProofNode} tree.
 *
 * @remarks
 * Traversal is iterative and reuses `GUARD_DEPTH_LIMIT`. Active ancestors refuse cycles, and a
 * settled-depth record prevents repeated validation of shared subtrees while keeping the bound
 * exact: a node revisited no deeper than its validated depth is skipped, and one reached deeper
 * is walked again. The traversal accepts an acyclic graph only when every reachable node is
 * valid and every root-to-node path contains at most `GUARD_DEPTH_LIMIT` nodes; shared aliases
 * and sibling order do not affect the verdict.
 *
 * @param value - The value to test
 * @returns `true` when every proof node is valid within the runtime guard bound
 *
 * @example
 * ```ts
 * import { isProofNode } from '@src/core'
 *
 * isProofNode({ fact: 'bird', depth: 0, children: [{ fact: 'feathers', depth: 1 }] }) // true
 * isProofNode({ fact: 'bird', children: [] }) // false
 * ```
 */
export function isProofNode(value: unknown): value is ProofNode {
	return holds(() => {
		if (!isObject(value) || isArray(value)) return false
		const active = new WeakSet<object>()
		const settled = new WeakMap<object, number>()
		const worklist: Array<[object, number, boolean]> = [[value, 1, false]]
		while (worklist.length > 0) {
			const frame = worklist.pop()
			if (frame === undefined) continue
			const node = frame[0]
			const depth = frame[1]
			if (frame[2]) {
				active.delete(node)
				const known = settled.get(node)
				settled.set(node, known === undefined || depth > known ? depth : known)
				continue
			}
			if (depth > GUARD_DEPTH_LIMIT || active.has(node)) return false
			const known = settled.get(node)
			if (known !== undefined && depth <= known) continue
			active.add(node)
			worklist.push([node, depth, true])
			const inference = Reflect.get(node, 'inference')
			const children = Reflect.get(node, 'children')
			if (
				!isString(Reflect.get(node, 'fact')) ||
				!isNumber(Reflect.get(node, 'depth')) ||
				(inference !== undefined && !isString(inference))
			) {
				return false
			}
			if (children === undefined) continue
			if (!isArray(children)) return false
			const entries = readArrayEntries(children)
			if (!entries.success || !entries.value.dense) return false
			for (let index = entries.value.entries.length - 1; index >= 0; index -= 1) {
				const child = entries.value.entries[index]
				if (!isObject(child) || isArray(child)) return false
				worklist.push([child, depth + 1, false])
			}
		}
		return true
	})
}

/**
 * Determine whether a value is a {@link QuantitativeResult}.
 *
 * @param value - The value to test
 * @returns `true` when every published quantitative-result member is valid
 *
 * @example
 * ```ts
 * import { isQuantitativeResult } from '@src/core'
 *
 * isQuantitativeResult({ reasoning: 'quantitative', value: 0, groups: [], count: 0, success: true, trace: [], errors: [] }) // true
 * isQuantitativeResult({ reasoning: 'quantitative' }) // false
 * ```
 */
export function isQuantitativeResult(value: unknown): value is QuantitativeResult {
	return whereOf(isObject, (result): result is QuantitativeResult => {
		return (
			!isArray(result) &&
			Reflect.get(result, 'reasoning') === 'quantitative' &&
			isNumber(Reflect.get(result, 'value')) &&
			arrayOf(isGroupResult)(Reflect.get(result, 'groups')) &&
			isNumber(Reflect.get(result, 'count')) &&
			isBoolean(Reflect.get(result, 'success')) &&
			arrayOf(isString)(Reflect.get(result, 'trace')) &&
			arrayOf(isString)(Reflect.get(result, 'errors'))
		)
	})(value)
}

/**
 * Determine whether a value is a {@link LogicalResult}.
 *
 * @param value - The value to test
 * @returns `true` when every published logical-result member is valid
 *
 * @example
 * ```ts
 * import { isLogicalResult } from '@src/core'
 *
 * isLogicalResult({ reasoning: 'logical', conclusion: false, rules: [], count: 0, success: true, trace: [], errors: [] }) // true
 * isLogicalResult({ reasoning: 'logical', rules: [] }) // false
 * ```
 */
export function isLogicalResult(value: unknown): value is LogicalResult {
	return whereOf(isObject, (result): result is LogicalResult => {
		return (
			!isArray(result) &&
			Reflect.get(result, 'reasoning') === 'logical' &&
			isBoolean(Reflect.get(result, 'conclusion')) &&
			arrayOf(isRuleResult)(Reflect.get(result, 'rules')) &&
			isNumber(Reflect.get(result, 'count')) &&
			isBoolean(Reflect.get(result, 'success')) &&
			arrayOf(isString)(Reflect.get(result, 'trace')) &&
			arrayOf(isString)(Reflect.get(result, 'errors'))
		)
	})(value)
}

/**
 * Determine whether a value is a {@link SymbolicResult}.
 *
 * @param value - The value to test
 * @returns `true` when every published symbolic-result member is valid
 *
 * @example
 * ```ts
 * import { isSymbolicResult } from '@src/core'
 *
 * isSymbolicResult({ reasoning: 'symbolic', solutions: { x: 4 }, success: true, trace: [], errors: [] }) // true
 * isSymbolicResult({ reasoning: 'symbolic', solutions: { x: '4' }, success: true, trace: [], errors: [] }) // false
 * ```
 */
export function isSymbolicResult(value: unknown): value is SymbolicResult {
	return whereOf(isObject, (result): result is SymbolicResult => {
		return (
			!isArray(result) &&
			Reflect.get(result, 'reasoning') === 'symbolic' &&
			whereOf(
				isObject,
				(solutions) =>
					!isArray(solutions) &&
					Object.getOwnPropertyNames(solutions).every((key) =>
						isNumber(Reflect.get(solutions, key)),
					),
			)(Reflect.get(result, 'solutions')) &&
			isBoolean(Reflect.get(result, 'success')) &&
			arrayOf(isString)(Reflect.get(result, 'trace')) &&
			arrayOf(isString)(Reflect.get(result, 'errors'))
		)
	})(value)
}

/**
 * Determine whether a value is an {@link InferentialResult}.
 *
 * @param value - The value to test
 * @returns `true` when every published inferential-result member is valid
 *
 * @example
 * ```ts
 * import { isInferentialResult } from '@src/core'
 *
 * isInferentialResult({ reasoning: 'inferential', derived: [], success: true, trace: [], errors: [] }) // true
 * isInferentialResult({ reasoning: 'inferential', derived: [null], success: true, trace: [], errors: [] }) // false
 * ```
 */
export function isInferentialResult(value: unknown): value is InferentialResult {
	return whereOf(isObject, (result): result is InferentialResult => {
		if (isArray(result)) return false
		const proof = Reflect.get(result, 'proof')
		return (
			Reflect.get(result, 'reasoning') === 'inferential' &&
			arrayOf(isResultFact)(Reflect.get(result, 'derived')) &&
			(proof === undefined || isProofNode(proof)) &&
			isBoolean(Reflect.get(result, 'success')) &&
			arrayOf(isString)(Reflect.get(result, 'trace')) &&
			arrayOf(isString)(Reflect.get(result, 'errors'))
		)
	})(value)
}

/**
 * Determine whether a value is any {@link ReasonResult} arm.
 *
 * @param value - The value to test
 * @returns `true` when one complete reasoning-result guard accepts the value
 *
 * @example
 * ```ts
 * import { isReasonResult } from '@src/core'
 *
 * isReasonResult({ reasoning: 'symbolic', solutions: {}, success: true, trace: [], errors: [] }) // true
 * isReasonResult({ reasoning: 'unknown' }) // false
 * ```
 */
export function isReasonResult(value: unknown): value is ReasonResult {
	return (
		isQuantitativeResult(value) ||
		isLogicalResult(value) ||
		isSymbolicResult(value) ||
		isInferentialResult(value)
	)
}

/**
 * Determine whether a value is a {@link ReasonValidationResult}.
 *
 * @param value - The value to test
 * @returns `true` when every published validation-result member is valid
 *
 * @example
 * ```ts
 * import { isReasonValidationResult } from '@src/core'
 *
 * isReasonValidationResult({ valid: true, errors: [], warnings: [] }) // true
 * isReasonValidationResult({ valid: true, errors: [] }) // false
 * ```
 */
export function isReasonValidationResult(value: unknown): value is ReasonValidationResult {
	return whereOf(isObject, (result): result is ReasonValidationResult => {
		return (
			!isArray(result) &&
			isBoolean(Reflect.get(result, 'valid')) &&
			arrayOf(isString)(Reflect.get(result, 'errors')) &&
			arrayOf(isString)(Reflect.get(result, 'warnings'))
		)
	})(value)
}

/**
 * Determine whether a value is a `DefinitionBuilder` ENTITY — the brand-guarded
 * stateful workspace, not the plain {@link Definition} data union.
 *
 * @remarks
 * A `unique symbol` brand check (`Reflect.get`, AGENTS §14): a plain subject
 * is an open record whose values may legally be functions, so a
 * method-presence check (`typeof value.build === 'function'`) is FORGEABLE —
 * this guard is not. A module-owned `unique symbol` cannot be produced by
 * `JSON.parse` or written by any consumer that does not import
 * `DEFINITION_BUILDER_BRAND`, so plain data can never forge it. Total: a
 * non-object, a missing brand, or a hostile prototype all return `false`,
 * never throw.
 *
 * @param value - The value to test
 * @returns `true` when `value` carries the `DefinitionBuilder` entity brand
 *
 * @example
 * ```ts
 * import { createDefinitionBuilder, isDefinitionBuilder, quantitativeDefinition } from '@src/core'
 *
 * const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []))
 * isDefinitionBuilder(definition)                       // true
 * isDefinitionBuilder({ build: () => undefined })       // false — forged build field
 * isDefinitionBuilder(quantitativeDefinition('r', 'R', []))  // false — plain data, not the entity
 * ```
 */
export function isDefinitionBuilder(value: unknown): value is DefinitionBuilderInterface {
	return isObject(value) && Reflect.get(value, DEFINITION_BUILDER_BRAND) === true
}

/**
 * Determine whether a value is a `SubjectBuilder` ENTITY — the brand-guarded
 * stateful workspace, not the plain {@link Subject} data record.
 *
 * @remarks
 * A `unique symbol` brand check (`Reflect.get`, AGENTS §14), distinct from
 * {@link isDefinitionBuilder} — the two entities can never match each other's
 * guard. Total: a non-object, a missing brand, or a hostile prototype all
 * return `false`, never throw.
 *
 * @param value - The value to test
 * @returns `true` when `value` carries the `SubjectBuilder` entity brand
 *
 * @example
 * ```ts
 * import { createSubjectBuilder, isSubjectBuilder } from '@src/core'
 *
 * const subject = createSubjectBuilder({ id: 's1', age: 30 })
 * isSubjectBuilder(subject)               // true
 * isSubjectBuilder({ build: () => ({}) }) // false — forged build field
 * isSubjectBuilder({ id: 's1', age: 30 }) // false — plain data, not the entity
 * ```
 */
export function isSubjectBuilder(value: unknown): value is SubjectBuilderInterface {
	return isObject(value) && Reflect.get(value, SUBJECT_BUILDER_BRAND) === true
}
