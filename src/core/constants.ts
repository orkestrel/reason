import type { MathOperation } from './types.js'

// Frozen default data for the reasons module — constants are
// UPPER_SNAKE_CASE data, and this is the sole home for module-scope literal
// defaults.

/**
 * Holds the default `bail` for the `Reason` orchestrator — a reasoner throw is rethrown
 * after the `error` emit. Default: `true`.
 *
 * @remarks
 * Named with the domain qualifier so the generic `DEFAULT_BAIL` stays free for
 * other modules' bail defaults on the shared `@src/core` barrel.
 */
export const DEFAULT_REASON_BAIL = true

/**
 * Holds the default `validate` for the `Reason` orchestrator — a definition is validated
 * before it first runs, and remembered by identity. Default: `true`.
 */
export const DEFAULT_VALIDATE = true

/**
 * Holds the default `depth` for chaining definitions — the forward-iteration /
 * backward-recursion cap of the logical and inferential reasoners. Default: `10`.
 */
export const DEFAULT_DEPTH = 10

/**
 * Holds the default `base` added before aggregation, at both group and definition
 * level. Default: `0`.
 */
export const DEFAULT_BASE = 0

/**
 * Holds the default `precision` (decimal places) for quantitative values and symbolic
 * solutions. Default: `4`.
 */
export const DEFAULT_PRECISION = 4

/**
 * Holds the default `confidence` for facts, inferences, and injected subject facts.
 * Default: `1`.
 */
export const DEFAULT_CONFIDENCE = 1

/** Holds the default factor `weight` at group aggregation. Default: `1`. */
export const DEFAULT_WEIGHT = 1

/**
 * Holds the default factor / rule `priority` — evaluation order is ascending and
 * stable. Default: `0`.
 */
export const DEFAULT_PRIORITY = 0

/**
 * Holds the decimal places a derived fact's confidence is rounded to during forward
 * inferential chaining.
 *
 * @remarks
 * Fixed — unlike {@link DEFAULT_PRECISION} it is not overridable per
 * definition, so confidence products stay comparable across derivations.
 */
export const CONFIDENCE_PRECISION = 4

/**
 * Lists the math operations the symbolic reasoner can invert while isolating a
 * target variable — anything else (a `power`, an `abs`) fails the equation
 * with a non-invertible error.
 */
export const INVERTIBLE_OPERATIONS: ReadonlySet<MathOperation> = Object.freeze(
	new Set<MathOperation>(['add', 'subtract', 'multiply', 'divide']),
)

/** Lists the states a check, a rule, and a conclusion settle on. */
export const CHECK_STATES = ['met', 'unmet', 'unread'] as const

/** Lists the reasoning strategies. */
export const REASONINGS = ['quantitative', 'logical', 'symbolic', 'inferential'] as const

/** Lists how a chaining reasoner walks its rules. */
export const CHAIN_STRATEGIES = ['forward', 'backward'] as const

/** Lists the math operations a transform or a symbolic operation applies. */
export const MATH_OPERATIONS = [
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
] as const

/** Lists how an aggregator reduces a list of numbers to one. */
export const AGGREGATIONS = ['sum', 'product', 'average', 'minimum', 'maximum'] as const

/** Lists the comparisons a check applies. */
export const COMPARISONS = [
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
] as const

/** Lists the connectives of a compound expression. */
export const LOGICAL_OPERATORS = ['and', 'or', 'not', 'implies', 'xor'] as const

/**
 * Holds how many objects and arrays one JSON projection walks before it drops the rest, so a
 * value sharing its sub-objects cannot unfold without end.
 */
export const PROJECTION_NODE_LIMIT = 10_000

/**
 * Holds how many connectives the published `Expression` shape may nest.
 *
 * @remarks
 * A shape refuses cycles, so the recursive guard stays the authority and this bounds what a
 * schema can say. The schema grows linearly with it.
 */
export const EXPRESSION_SHAPE_DEPTH = 8

/**
 * Holds how many operations the published `SymbolicExpression` shape may nest.
 *
 * @remarks
 * An operation has two sides, so the schema doubles with each level: about 14 KB here against
 * 56 KB at depth 6. A deeper authored expression still runs, because the guard admits it, and
 * cannot cross a boundary on `is`.
 */
export const SYMBOLIC_SHAPE_DEPTH = 4

/** Names the default `id` for an `Evaluator`. */
export const EVALUATOR_ID = 'evaluator'

/** Names the default `id` for a `Transformer`. */
export const TRANSFORMER_ID = 'transformer'

/** Names the default `id` for an `Aggregator`. */
export const AGGREGATOR_ID = 'aggregator'

/** Names the default `id` for a `QuantitativeReasoner`. */
export const QUANTITATIVE_ID = 'quantitative'

/** Names the default `id` for a `LogicalReasoner`. */
export const LOGICAL_ID = 'logical'

/** Names the default `id` for a `SymbolicReasoner`. */
export const SYMBOLIC_ID = 'symbolic'

/** Names the default `id` for an `InferentialReasoner`. */
export const INFERENTIAL_ID = 'inferential'

/**
 * Holds the `DefinitionBuilder` entity brand — a `unique symbol` key carrying
 * `readonly true` on every `DefinitionBuilderInterface` instance.
 *
 * @remarks
 * Only `isDefinitionBuilder` (`validators.ts`) reads this key, through
 * `Reflect.get`. A module-owned `unique symbol` cannot be produced by
 * `JSON.parse` or written by any consumer that does not import this constant,
 * so plain data can never forge the brand.
 */
export const DEFINITION_BUILDER_BRAND: unique symbol = Symbol('reasons.definitionBuilder')

/**
 * Holds the `SubjectBuilder` entity brand — a `unique symbol` key carrying
 * `readonly true` on every `SubjectBuilderInterface` instance.
 *
 * @remarks
 * Only `isSubjectBuilder` (`validators.ts`) reads this key, through `Reflect.get`.
 * Distinct from {@link DEFINITION_BUILDER_BRAND}, so neither entity can ever
 * match the other's guard.
 */
export const SUBJECT_BUILDER_BRAND: unique symbol = Symbol('reasons.subjectBuilder')
