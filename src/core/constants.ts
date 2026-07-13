import type { MathOperation } from './types.js'

// Frozen default data for the reasons module (AGENTS §5 — constants are
// UPPER_SNAKE_CASE data, the sole home for module-scope literal defaults).

/**
 * Default `bail` for the `Reason` orchestrator — a reasoner throw is rethrown
 * after the `error` emit.
 *
 * @remarks
 * Named with the domain qualifier so the generic `DEFAULT_BAIL` stays free for
 * other modules' bail defaults on the shared `@src/core` barrel.
 */
export const DEFAULT_REASON_BAIL = true

/** Default `validate` for the `Reason` orchestrator — per-call validation is skipped. */
export const DEFAULT_VALIDATE = false

/**
 * Default `depth` for chaining definitions — the forward-iteration /
 * backward-recursion cap of the logical and inferential reasoners.
 */
export const DEFAULT_DEPTH = 10

/** Default `base` added before aggregation, at both group and definition level. */
export const DEFAULT_BASE = 0

/** Default `precision` (decimal places) for quantitative values and symbolic solutions. */
export const DEFAULT_PRECISION = 4

/** Default `confidence` for facts, inferences, and injected subject facts. */
export const DEFAULT_CONFIDENCE = 1

/** Default factor `weight` at group aggregation. */
export const DEFAULT_WEIGHT = 1

/** Default factor / rule `priority` — evaluation order is ascending and stable. */
export const DEFAULT_PRIORITY = 0

/**
 * Decimal places a derived fact's confidence is rounded to during forward
 * inferential chaining.
 *
 * @remarks
 * Fixed — unlike {@link DEFAULT_PRECISION} it is NOT overridable per
 * definition, so confidence products stay comparable across derivations.
 */
export const CONFIDENCE_PRECISION = 4

/**
 * The math operations the symbolic reasoner can invert while isolating a
 * target variable — anything else (a `power`, an `abs`) fails the equation
 * with a non-invertible error.
 */
export const INVERTIBLE_OPERATIONS: ReadonlySet<MathOperation> = Object.freeze(
	new Set<MathOperation>(['add', 'subtract', 'multiply', 'divide']),
)

/** Default `id` for an `Evaluator`. */
export const EVALUATOR_ID = 'evaluator'

/** Default `id` for a `Transformer`. */
export const TRANSFORMER_ID = 'transformer'

/** Default `id` for an `Aggregator`. */
export const AGGREGATOR_ID = 'aggregator'

/** Default `id` for a `QuantitativeReasoner`. */
export const QUANTITATIVE_ID = 'quantitative'

/** Default `id` for a `LogicalReasoner`. */
export const LOGICAL_ID = 'logical'

/** Default `id` for a `SymbolicReasoner`. */
export const SYMBOLIC_ID = 'symbolic'

/** Default `id` for an `InferentialReasoner`. */
export const INFERENTIAL_ID = 'inferential'

/**
 * The `DefinitionBuilder` entity brand — a `unique symbol` key carrying
 * `readonly true` on every `DefinitionBuilderInterface` instance.
 *
 * @remarks
 * Only `isDefinitionBuilder` (`validators.ts`) reads this key, via
 * `Reflect.get`. A module-owned `unique symbol` cannot be produced by
 * `JSON.parse` or written by any consumer that does not import this constant,
 * so plain data can never forge the brand.
 */
export const DEFINITION_BUILDER_BRAND: unique symbol = Symbol('reasons.definitionBuilder')

/**
 * The `SubjectBuilder` entity brand — a `unique symbol` key carrying
 * `readonly true` on every `SubjectBuilderInterface` instance.
 *
 * @remarks
 * Only `isSubjectBuilder` (`validators.ts`) reads this key, via `Reflect.get`.
 * Distinct from {@link DEFINITION_BUILDER_BRAND}, so the two entities can never
 * match each other's guard.
 */
export const SUBJECT_BUILDER_BRAND: unique symbol = Symbol('reasons.subjectBuilder')
