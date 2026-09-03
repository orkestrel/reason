import type { FieldPath } from '@orkestrel/contract'
import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'
import type { DEFINITION_BUILDER_BRAND, SUBJECT_BUILDER_BRAND } from './constants.js'

// A synchronous, deterministic reasoning engine.
// Declarative, JSON-serializable DEFINITIONS are evaluated against SUBJECTS
// (plain data records) to produce traceable RESULTS. Three layers: the `Reason`
// orchestrator (registry + dispatch + events), four reasoners (quantitative /
// logical / symbolic / inferential), and three injectable operators (Evaluator /
// Transformer / Aggregator). Nothing mutates its inputs; every result is a fresh
// object carrying `success`, a human-readable `trace`, and `errors`. Types are
// the source of truth; every discriminant names its axis, never `kind` /
// `type`: `reasoning` splits definitions and results, `form` splits expression
// nodes, `origin` splits factor sources.

// === Vocabulary

/**
 * Names the four reasoning strategies — the axis a {@link Definition} /
 * {@link ReasonResult} discriminates on.
 *
 * @remarks
 * `quantitative` — factor-based numeric scoring. `logical` — rule-based boolean
 * deduction with forward / backward chaining. `symbolic` — algebraic equation
 * solving by variable isolation. `inferential` — fact derivation with
 * unification variables and proof trees.
 */
export type Reasoning = 'quantitative' | 'logical' | 'symbolic' | 'inferential'

/**
 * Names how a chaining reasoner walks its rules: `forward` (data-driven fixpoint) or
 * `backward` (goal-driven proving).
 */
export type ChainingStrategy = 'forward' | 'backward'

/**
 * Names a math operation applied by the {@link TransformerInterface} and inside
 * {@link SymbolicExpression} trees.
 *
 * @remarks
 * `round` / `ceil` / `floor` / `abs` are unary — they ignore the operand /
 * right side. All others are binary.
 */
export type MathOperation =
	| 'add'
	| 'subtract'
	| 'multiply'
	| 'divide'
	| 'percentage'
	| 'minimum'
	| 'maximum'
	| 'average'
	| 'power'
	| 'round'
	| 'ceil'
	| 'floor'
	| 'abs'

/**
 * Names how the {@link AggregatorInterface} reduces a list of numbers to one.
 *
 * @remarks
 * When weights apply: `sum` multiplies each value by its weight, `product`
 * raises each value to its weight (weight-as-exponent), `average` is the
 * weighted mean, and `minimum` / `maximum` ignore weights entirely.
 */
export type Aggregation = 'sum' | 'product' | 'average' | 'minimum' | 'maximum'

/**
 * Names the comparison a {@link Check} applies between a resolved subject field and
 * its expected value.
 *
 * @remarks
 * `equals` / `not` — strict `===` / `!==` (no coercion). `above` / `below` /
 * `from` / `to` — `>` / `<` / `>=` / `<=`, requiring numbers on BOTH sides
 * (anything else is not met). `any` / `none` — array membership / non-membership
 * (a non-array expected value is not met for BOTH — `none` is not the raw
 * complement of `any` on malformed input). `between` / `outside` — inclusive
 * range test on the first two numeric elements of the expected array; `outside`
 * IS the pure negation of `between`, so a malformed range is `outside`.
 */
export type Comparison =
	| 'equals'
	| 'not'
	| 'above'
	| 'below'
	| 'from'
	| 'to'
	| 'any'
	| 'none'
	| 'between'
	| 'outside'

/**
 * Names a logical connective inside a compound {@link Expression}.
 *
 * @remarks
 * `not` reads only its first operand (empty operands are vacuously true);
 * `implies` and `xor` read their first two (`implies` is vacuously true below
 * two operands, `xor` is false).
 */
export type LogicalOperator = 'and' | 'or' | 'not' | 'implies' | 'xor'

/**
 * Represents the data record being reasoned about — a plain readonly bag of fields, read
 * by {@link FieldPath}.
 */
export type Subject = Readonly<Record<string, unknown>>

// === Checks, transforms & bounds

/**
 * Represents a single field predicate: resolves `field` from the subject and compares it
 * to `value` with `operator`.
 *
 * @remarks
 * `field` follows the {@link FieldPath} idiom — a string is ONE key (never
 * dot-split), an array descends into nested objects. `value` is unconstrained
 * (`unknown`): the operator decides what shapes are meaningful.
 */
export interface Check {
	readonly field: FieldPath
	readonly operator: Comparison
	readonly value: unknown
}

/**
 * Represents the outcome of one {@link Check} evaluation.
 *
 * @remarks
 * `actual` is the resolved subject value (possibly `undefined`); `error` is set
 * ONLY when evaluation itself failed (an unknown operator) — a merely-unmet
 * check carries no `error`.
 */
export interface CheckResult {
	readonly field: FieldPath
	readonly met: boolean
	readonly actual: unknown
	readonly error?: string
}

/**
 * Represents one math step applied to a number by the {@link TransformerInterface}.
 *
 * @remarks
 * The absent-`operand` default is operation-specific and identity-preserving;
 * unary operations ignore it. Default: `1` for `multiply` / `divide` /
 * `power`, `0` for every other binary operation.
 */
export interface Transform {
	readonly operation: MathOperation
	readonly operand?: number
}

/**
 * Represents an inclusive numeric clamp — either side may be absent (unbounded).
 */
export interface Bounds {
	readonly minimum?: number
	readonly maximum?: number
}

// === Quantitative definitions

/** Represents a factor source yielding a fixed number. */
export interface StaticSource {
	readonly origin: 'static'
	readonly value: number
}

/**
 * Represents a factor source reading a subject field as a number.
 *
 * @remarks
 * The field is coerced with the contracts `parseNumber` — a finite number
 * passes through, a numeric string coerces, and everything else (including
 * `NaN` / `±Infinity`) is unresolvable, falling back to the factor's
 * `fallback`.
 */
export interface FieldSource {
	readonly origin: 'field'
	readonly field: FieldPath
}

/**
 * Represents a factor source mapping a subject field through a lookup table.
 *
 * @remarks
 * A missing or `null` field takes the factor's `fallback` directly (never the
 * `''` table key); a PRESENT value is stringified into a `table` key (a numeric
 * `42` finds the key `'42'`, a real `''` value may hit a `''` key). Only OWN
 * table keys hit — an absent or inherited key falls back.
 */
export interface LookupSource {
	readonly origin: 'lookup'
	readonly field: FieldPath
	readonly table: Readonly<Record<string, number>>
}

/**
 * Represents a factor source banding a numeric subject field through ordered ranges.
 *
 * @remarks
 * Ranges are scanned in order and the FIRST match wins. A range without
 * `bounds` matches anything (a catch-all); an absent bound side is open. No
 * match falls back to the factor's `fallback`.
 */
export interface RangeSource {
	readonly origin: 'range'
	readonly field: FieldPath
	readonly ranges: readonly FactorRange[]
}

/** Represents the four factor sources, discriminated by `origin`. */
export type Source = StaticSource | FieldSource | LookupSource | RangeSource

/** Represents one band of a {@link RangeSource} — an optional inclusive bounds test and the value it yields. */
export interface FactorRange {
	readonly bounds?: Bounds
	readonly value: number
}

/**
 * Represents one scored input of a quantitative group.
 *
 * @remarks
 * Evaluated as a pipeline: `checks` gate (ALL must be met) → `source` resolve
 * (`fallback` when unresolvable) → finite check → `transforms` chain →
 * `bounds` clamp → finite recheck. `weight` participates only at group
 * aggregation. Default: `1`. `priority` orders evaluation ascending, stable.
 * Default: `0`. `enabled: false` skips the factor entirely (omitted from
 * results); `required: true` promotes a gate / resolution failure to a result
 * error (making `success` false) without aborting the run.
 */
export interface Factor {
	readonly id: string
	readonly name: string
	readonly description?: string
	readonly source: Source
	readonly fallback?: number
	readonly checks?: readonly Check[]
	readonly transforms?: readonly Transform[]
	readonly bounds?: Bounds
	readonly weight?: number
	readonly priority?: number
	readonly enabled?: boolean
	readonly required?: boolean
}

/**
 * Represents a group of factors aggregated into one value.
 *
 * @remarks
 * `base` is added before aggregation. Default: `0`.
 * The group value is `base` plus the aggregation of its APPLIED
 * factors' values (with per-factor weights), clamped to `bounds` — never
 * rounded. `strict: true` makes the group all-or-nothing: if any evaluated
 * factor did not apply, the group contributes only its `base` and reports
 * `applied: false`. A group with zero applied factors is excluded from the
 * definition-level aggregation.
 */
export interface FactorGroup {
	readonly id: string
	readonly name: string
	readonly description?: string
	readonly factors: readonly Factor[]
	readonly aggregation: Aggregation
	readonly base?: number
	readonly bounds?: Bounds
	readonly enabled?: boolean
	readonly strict?: boolean
}

/**
 * Defines factor-based numeric scoring.
 *
 * @remarks
 * `base` is added before aggregation. Default: `0`.
 * The final value is `base` plus the aggregation of the applied
 * groups' values (NO weights at this level), clamped to `bounds`, then rounded
 * to `precision` decimal places. Default: `4`.
 */
export interface QuantitativeDefinition {
	readonly reasoning: 'quantitative'
	readonly id: string
	readonly name: string
	readonly description?: string
	readonly groups: readonly FactorGroup[]
	readonly aggregation: Aggregation
	readonly base?: number
	readonly bounds?: Bounds
	readonly precision?: number
}

// === Logical definitions

/** Represents a leaf boolean expression — one {@link Check} against the subject. */
export interface Atom {
	readonly form: 'atom'
	readonly check: Check
}

/** Represents a compound boolean expression — a {@link LogicalOperator} over nested operands. */
export interface Compound {
	readonly form: 'compound'
	readonly operator: LogicalOperator
	readonly operands: readonly Expression[]
}

/** Represents a boolean expression tree, discriminated by `form`. */
export type Expression = Atom | Compound

/**
 * Represents one deduction rule: when ALL `premises` hold, the `conclusion`'s atoms are
 * asserted as derived facts.
 *
 * @remarks
 * `priority` orders evaluation ascending, lower first. Default: `0`.
 * `enabled: false` skips the rule (omitted from results). Conclusion extraction
 * ignores connectives — EVERY atom inside the conclusion is asserted as a
 * `field = value` fact, even under `not` / `or`.
 */
export interface Rule {
	readonly id: string
	readonly name: string
	readonly description?: string
	readonly premises: readonly Expression[]
	readonly conclusion: Expression
	readonly priority?: number
	readonly enabled?: boolean
}

/**
 * Defines rule-based deduction.
 *
 * @remarks
 * `strategy` picks forward fixpoint chaining or backward goal-driven proving.
 * `depth` caps forward iterations / backward recursion. Default: `10`.
 */
export interface LogicalDefinition {
	readonly reasoning: 'logical'
	readonly id: string
	readonly name: string
	readonly description?: string
	readonly rules: readonly Rule[]
	readonly strategy: ChainingStrategy
	readonly depth?: number
}

// === Symbolic definitions

/** Represents a symbolic expression leaf naming a variable. */
export interface Variable {
	readonly form: 'variable'
	readonly name: string
}

/** Represents a symbolic expression leaf holding a fixed number. */
export interface Constant {
	readonly form: 'constant'
	readonly value: number
}

/**
 * Represents a symbolic operation node.
 *
 * @remarks
 * `right` is absent for unary operators (`round` / `ceil` / `floor` / `abs`)
 * and treated as the constant `0` when absent on a binary operator.
 */
export interface Operation {
	readonly form: 'operation'
	readonly operator: MathOperation
	readonly left: SymbolicExpression
	readonly right?: SymbolicExpression
}

/** Represents an algebraic expression tree, discriminated by `form`. */
export type SymbolicExpression = Variable | Constant | Operation

/**
 * Represents one equation `left = right`, solved for the `target` variable.
 *
 * @remarks
 * When `target` is unbound and appears on exactly one side, it is isolated
 * algebraically through invertible operations (`add` / `subtract` / `multiply`
 * / `divide`); otherwise the right side is evaluated directly.
 */
export interface Equation {
	readonly id: string
	readonly name: string
	readonly description?: string
	readonly left: SymbolicExpression
	readonly right: SymbolicExpression
	readonly target: string
}

/**
 * Defines equation-solving.
 *
 * @remarks
 * `variables` seeds the bindings; numeric subject fields OVERRIDE same-named
 * variables. Equations solve strictly in order, each solution rounded to
 * `precision` decimal places BEFORE feeding forward into later equations.
 * Default: `4`.
 */
export interface SymbolicDefinition {
	readonly reasoning: 'symbolic'
	readonly id: string
	readonly name: string
	readonly description?: string
	readonly equations: readonly Equation[]
	readonly variables: Readonly<Record<string, number>>
	readonly precision?: number
}

// === Inferential definitions

/**
 * Represents one fact: a `predicate` over positional `terms`.
 *
 * @remarks
 * A string term starting with `?` is a unification variable (the prefix is
 * part of its name). `confidence` is `0–1` and propagates multiplicatively
 * through derivations. Default: `1`.
 */
export interface Fact {
	readonly id: string
	readonly predicate: string
	readonly terms: readonly unknown[]
	readonly confidence?: number
}

/**
 * Represents one inference rule: when every premise pattern unifies against known facts
 * (with consistent variable bindings), the instantiated `conclusion` is
 * derived.
 *
 * @remarks
 * A derived fact's confidence is the product of its matched premise facts'
 * confidences times the inference's own `confidence`, rounded to four decimal
 * places. Default: `1`. `enabled: false` skips the inference silently.
 */
export interface Inference {
	readonly id: string
	readonly name: string
	readonly description?: string
	readonly premises: readonly Fact[]
	readonly conclusion: Fact
	readonly confidence?: number
	readonly enabled?: boolean
}

/**
 * Defines fact-derivation.
 *
 * @remarks
 * `facts` is the base knowledge; scalar subject fields are additionally
 * injected as `has(key, value)` facts. `strategy` picks a forward fixpoint
 * (derive everything) or backward proving (first provable conclusion wins,
 * returning a proof tree). `depth` caps iterations / recursion. Default: `10`.
 */
export interface InferentialDefinition {
	readonly reasoning: 'inferential'
	readonly id: string
	readonly name: string
	readonly description?: string
	readonly inferences: readonly Inference[]
	readonly facts: readonly Fact[]
	readonly strategy: ChainingStrategy
	readonly depth?: number
}

/** Represents any reasoning definition, discriminated by `reasoning`. */
export type Definition =
	| QuantitativeDefinition
	| LogicalDefinition
	| SymbolicDefinition
	| InferentialDefinition

// === Results

/**
 * Represents one factor's evaluation outcome.
 *
 * @remarks
 * `raw` is the resolved source value before transforms / clamping (absent when
 * the source never resolved); `checks` is present only when the factor
 * declared checks and they gated it out. An unapplied factor carries
 * `value: 0`.
 */
export interface FactorResult {
	readonly id: string
	readonly applied: boolean
	readonly value: number
	readonly raw?: number
	readonly checks?: readonly CheckResult[]
}

/**
 * Represents one group's evaluation outcome — its clamped value and the per-factor
 * results (disabled factors omitted entirely).
 *
 * @remarks
 * An UNAPPLIED group's `value` may be non-finite (a `minimum` / `maximum`
 * aggregation over zero applied factors is `base + NaN`) — it is excluded from
 * the definition-level aggregation, so only an APPLIED non-finite value reaches
 * the definition-level finite check.
 */
export interface GroupResult {
	readonly id: string
	readonly applied: boolean
	readonly value: number
	readonly factors: readonly FactorResult[]
}

/**
 * Represents the outcome of quantitative reasoning.
 *
 * @remarks
 * `count` tallies the applied groups. `success` is `false` whenever any error
 * accumulated (a required-factor failure, a non-finite value) — the numeric
 * `value` is still computed.
 */
export interface QuantitativeResult {
	readonly reasoning: 'quantitative'
	readonly value: number
	readonly groups: readonly GroupResult[]
	readonly count: number
	readonly success: boolean
	readonly trace: readonly string[]
	readonly errors: readonly string[]
}

/**
 * Represents one rule's evaluation outcome.
 *
 * @remarks
 * `premises` carries the per-premise truth values; `applied` is true exactly
 * when every premise held.
 */
export interface RuleResult {
	readonly id: string
	readonly applied: boolean
	readonly premises: readonly boolean[]
}

/**
 * Represents the outcome of logical reasoning.
 *
 * @remarks
 * `conclusion` is the LAST evaluated rule's `applied` (`false` when no rule
 * was evaluated); `count` tallies the applied rules; disabled rules are
 * omitted from `rules` entirely.
 */
export interface LogicalResult {
	readonly reasoning: 'logical'
	readonly conclusion: boolean
	readonly rules: readonly RuleResult[]
	readonly count: number
	readonly success: boolean
	readonly trace: readonly string[]
	readonly errors: readonly string[]
}

/**
 * Represents the outcome of symbolic reasoning — final bindings keyed by each equation's
 * `target` (a failed equation's target still appears when bound elsewhere).
 */
export interface SymbolicResult {
	readonly reasoning: 'symbolic'
	readonly solutions: Readonly<Record<string, number>>
	readonly success: boolean
	readonly trace: readonly string[]
	readonly errors: readonly string[]
}

/**
 * Represents one node of a backward-chaining proof tree.
 *
 * @remarks
 * `fact` is the proved fact's / goal's id; `inference` is set when the node was
 * derived through an inference (absent on a base-fact leaf); `children` are the
 * sub-proofs of that inference's premises; `depth` is the recursion depth the
 * node was proved at.
 */
export interface ProofNode {
	readonly fact: string
	readonly inference?: string
	readonly children?: readonly ProofNode[]
	readonly depth: number
}

/**
 * Represents the outcome of inferential reasoning.
 *
 * @remarks
 * `derived` lists the newly derived facts (deriving nothing is still success);
 * `proof` is produced only by the backward strategy, and only when a
 * conclusion was proved.
 */
export interface InferentialResult {
	readonly reasoning: 'inferential'
	readonly derived: readonly Fact[]
	readonly proof?: ProofNode
	readonly success: boolean
	readonly trace: readonly string[]
	readonly errors: readonly string[]
}

/** Represents any reasoning result, discriminated by `reasoning`. */
export type ReasonResult = QuantitativeResult | LogicalResult | SymbolicResult | InferentialResult

/**
 * Represents the outcome of validating a definition — hard `errors` (definition unusable)
 * and soft `warnings` (suspicious but runnable). `valid` is `true` exactly when
 * `errors` is empty.
 *
 * @remarks
 * Warnings cover empty collections, duplicate ids (`Duplicate <noun> id`),
 * inferential confidences outside `[0, 1]`, a logical conclusion's array-path
 * overlay key also read through an array-path premise elsewhere (the flat overlay
 * key will not resolve), and an inferential conclusion carrying a `?variable`
 * unbound by all of its inference's premises — the runtime stays permissive
 * about all of them.
 */
export interface ReasonValidationResult {
	readonly valid: boolean
	readonly errors: readonly string[]
	readonly warnings: readonly string[]
}

// === Operator options

/**
 * Configures `createEvaluator` / the `Evaluator` constructor.
 *
 * @remarks
 * `id` — the evaluator's identity string. Default: `EVALUATOR_ID`.
 */
export interface EvaluatorOptions {
	readonly id?: string
}

/**
 * Configures `createTransformer` / the `Transformer` constructor.
 *
 * @remarks
 * `id` — the transformer's identity string. Default: `TRANSFORMER_ID`.
 */
export interface TransformerOptions {
	readonly id?: string
}

/**
 * Configures `createAggregator` / the `Aggregator` constructor.
 *
 * @remarks
 * `id` — the aggregator's identity string. Default: `AGGREGATOR_ID`.
 */
export interface AggregatorOptions {
	readonly id?: string
}

// === Reasoner options

/**
 * Configures `createQuantitativeReasoner` / the `QuantitativeReasoner`
 * constructor.
 *
 * @remarks
 * `id` — the reasoner's identity string. Default: `QUANTITATIVE_ID`.
 * `evaluator` / `transformer` / `aggregator` — injectable operators. Default:
 * a fresh default-constructed instance of each.
 */
export interface QuantitativeReasonerOptions {
	readonly id?: string
	readonly evaluator?: EvaluatorInterface
	readonly transformer?: TransformerInterface
	readonly aggregator?: AggregatorInterface
}

/**
 * Configures `createLogicalReasoner` / the `LogicalReasoner` constructor.
 *
 * @remarks
 * `id` — the reasoner's identity string. Default: `LOGICAL_ID`.
 * `evaluator` — the injectable check evaluator. Default: a fresh
 * default-constructed instance.
 */
export interface LogicalReasonerOptions {
	readonly id?: string
	readonly evaluator?: EvaluatorInterface
}

/**
 * Configures `createSymbolicReasoner` / the `SymbolicReasoner` constructor.
 *
 * @remarks
 * `id` — the reasoner's identity string. Default: `SYMBOLIC_ID`.
 */
export interface SymbolicReasonerOptions {
	readonly id?: string
}

/**
 * Configures `createInferentialReasoner` / the `InferentialReasoner`
 * constructor.
 *
 * @remarks
 * `id` — the reasoner's identity string. Default: `INFERENTIAL_ID`.
 */
export interface InferentialReasonerOptions {
	readonly id?: string
}

// === Contracts

/**
 * Evaluates {@link Check}s against subjects.
 *
 * @remarks
 * Total: `evaluate` never throws — an unknown operator surfaces as
 * `CheckResult.error` with `met: false`, and errors are isolated per item in
 * `batch`.
 */
export interface EvaluatorInterface {
	readonly id: string
	evaluate(check: Check, subject: Subject): CheckResult
	batch(checks: readonly Check[], subject: Subject): readonly CheckResult[]
}

/**
 * Applies math {@link Transform}s to numbers.
 *
 * @remarks
 * Total: an unknown operation returns the value unchanged, and `divide` by
 * zero yields `NaN` rather than throwing. `chain` is a strict left fold —
 * `NaN` flows through.
 */
export interface TransformerInterface {
	readonly id: string
	apply(value: number, transform: Transform): number
	chain(value: number, transforms: readonly Transform[]): number
}

/**
 * Reduces number lists to one number per {@link Aggregation}.
 *
 * @remarks
 * Total: never throws. Empty-input identities: `sum` / `average` → `0`,
 * `product` → `1`, `minimum` / `maximum` → `NaN`. `weights` are honored ONLY
 * when their length matches `values` exactly (otherwise silently unweighted).
 */
export interface AggregatorInterface {
	readonly id: string
	aggregate(
		values: readonly number[],
		aggregation: Aggregation,
		weights?: readonly number[],
	): number
}

/**
 * Declares a reasoning strategy adapter — one per {@link Reasoning}.
 *
 * @remarks
 * `reason` throws a `ReasonError` (`MISMATCH`) when handed a definition of a
 * different reasoning; every other malformation yields a failure RESULT, not a
 * throw — the runtime never assumes `validate` ran. `supports` / `validate` /
 * `reason` each take plain data only — a {@link DefinitionBuilderInterface} /
 * {@link SubjectBuilderInterface}'s `build()` output is passed instead, by the
 * caller.
 */
export interface ReasonerInterface {
	readonly id: string
	readonly reasoning: Reasoning
	supports(definition: Definition): boolean
	validate(definition: Definition): ReasonValidationResult
	reason(subject: Subject, definition: Definition): ReasonResult
}

/**
 * Names a machine-readable `ReasonError` code.
 *
 * @remarks
 * `MISSING` — no reasoner registered for the definition's reasoning.
 * `INVALID` — pre-run validation failed (`validate: true`). `MISMATCH` — a
 * cross-reasoning definition handed to a reasoner or to a
 * {@link DefinitionBuilderInterface}'s `merge`, a `clear` key that is not
 * clearable for the builder's reasoning, or a write to a
 * {@link SubjectBuilderInterface}'s immutable `id`. `DESTROYED` — any use of a
 * destroyed orchestrator, builder, or manager. `TARGET` — any locator id
 * naming no existing element: the optional `target` id passed to `appendById` /
 * `prependById` (and the per-kind `append*` / `prepend*` helpers built on
 * them), or the required `groupId` every {@link FactorManagerInterface} verb
 * threads. `OPERATOR` — a math operator outside the accepted vocabulary: one
 * the {@link MathOperation} union does not name, or one outside the invertible
 * subset the symbolic isolation step can undo.
 */
export type ReasonErrorCode =
	| 'MISSING'
	| 'INVALID'
	| 'MISMATCH'
	| 'DESTROYED'
	| 'TARGET'
	| 'OPERATOR'

/**
 * Represents the push observation surface of a {@link ReasonInterface}.
 *
 * @remarks
 * `register` fires when a reasoner is registered (carrying its reasoning);
 * `reason` fires once per SUCCESSFUL result, synchronously before it returns
 * (bail-suppressed failure results do not fire it); `error` fires with the raw
 * thrown value when a reasoner throws (regardless of `bail`); `destroy` fires
 * once on teardown. Listener isolation is the emitter's own — a throwing
 * listener routes to the `error` OPTION handler, never onto this map.
 */
export type ReasonEventMap = {
	/** Fires when a reasoner is registered — carries its reasoning. */
	readonly register: readonly [reasoning: Reasoning]
	/** Fires when a reasoning run succeeds — carries the produced result. */
	readonly reason: readonly [result: ReasonResult]
	/** Fires when a reasoner throws — carries the raw thrown value. */
	readonly error: readonly [error: unknown]
	/** Fires when the orchestrator is destroyed. */
	readonly destroy: readonly []
}

/**
 * Configures `createReason` / the `Reason` constructor.
 *
 * @remarks
 * `reasoners` — the initial registry (a later entry of the same reasoning
 * replaces an earlier one). `bail` — if `true`, a reasoner throw is rethrown
 * after the `error` emit; if `false`, it becomes a failure result. Default:
 * `true`. `validate` — if `true`, every `reason` call validates the definition
 * first and throws `INVALID` on failure; if `false`, no call validates.
 * Default: `false`. `on` — initial event listeners. `error` — the emitter's
 * listener-error handler.
 */
export interface ReasonOptions {
	readonly reasoners?: readonly ReasonerInterface[]
	readonly bail?: boolean
	readonly validate?: boolean
	readonly on?: EmitterHooks<ReasonEventMap>
	readonly error?: EmitterErrorHandler
}

/**
 * Declares the reasoning orchestrator — a thin router over registered
 * {@link ReasonerInterface}s.
 *
 * @remarks
 * Dispatch is purely by `definition.reasoning` registry lookup; a missing
 * reasoner throws `MISSING` (never subject to `bail`, no `error` emit). The
 * batch `reason` overload maps subjects in order to an equal-length result
 * array. After `destroy()` every method except the `emitter` getter and
 * `destroy` itself throws `DESTROYED`. `reason` and `validate` each take
 * plain data only — a {@link DefinitionBuilderInterface} /
 * {@link SubjectBuilderInterface}'s `build()` output is passed instead, by
 * the caller.
 */
export interface ReasonInterface {
	readonly emitter: EmitterInterface<ReasonEventMap>
	// Array overload first so a list resolves to the batch form.
	reason(subjects: readonly Subject[], definition: Definition): readonly ReasonResult[]
	reason(subject: Subject, definition: Definition): ReasonResult
	register(reasoner: ReasonerInterface): void
	reasoner(reasoning: Reasoning): ReasonerInterface | undefined
	reasoners(): readonly ReasonerInterface[]
	supports(reasoning: Reasoning): boolean
	validate(definition: Definition): ReasonValidationResult
	destroy(): void
}

// === Definitions & subjects capability layer — entity managers
//
// The `DefinitionBuilder` manager contracts: each is a SELF-OWNING manager — it
// OWNS its collection as private copy-on-write state, OWNS its own
// {@link EmitterInterface} over its own verb-named event map, and takes its own
// options record (a seed collection + `on` / `error`). Managers are KIND-FREE:
// a `DefinitionBuilder` composes every one of them regardless of `reasoning`,
// and an off-kind manager is IGNORED by `build()` (no `MISMATCH` gating —
// appending a rule to a quantitative builder is inert, never a throw). A write
// verb copies-on-write into the manager's OWN state through the exported
// collection-level pure helpers and emits through the manager's OWN emitter;
// the accessors are pure reads and do NOT emit. `destroy()` is idempotent and
// tears the emitter down LAST; any call after it throws
// `ReasonError('DESTROYED', …)`. `seat` is the owning builder's bulk re-seat
// channel (used by `merge`) — it replaces the whole collection in one silent
// call (no per-element events).

/**
 * Declares the {@link DefinitionBuilderInterface} manager over a quantitative
 * definition's `groups` — a self-owning, kind-free collection manager.
 *
 * @remarks
 * `append` / `prepend` place a group relative to an optional `target` id (a
 * naming miss throws `ReasonError('TARGET', …)`); `replace` swaps a same-id
 * group in place. `remove` is the batch family: no argument removes every
 * group, one id removes that group, an id list removes those groups and
 * returns true only when every named id existed. It emits one `remove` per
 * group actually removed — an id naming no group emits nothing and returns
 * false.
 */
export interface GroupManagerInterface {
	readonly emitter: EmitterInterface<GroupManagerEventMap>
	group(id: string): FactorGroup | undefined
	groups(): readonly FactorGroup[]
	append(group: FactorGroup, target?: string): void
	prepend(group: FactorGroup, target?: string): void
	replace(group: FactorGroup): void
	// Array overload first so a list resolves to the batch form.
	remove(ids: readonly string[]): boolean
	remove(id: string): boolean
	remove(): void
	seat(groups: readonly FactorGroup[]): void
	destroy(): void
}

/** Represents the push observation surface of a {@link GroupManagerInterface}. */
export type GroupManagerEventMap = {
	/** Fires when a group is appended — carries its id. */
	readonly append: readonly [id: string]
	/** Fires when a group is prepended — carries its id. */
	readonly prepend: readonly [id: string]
	/** Fires when a group is replaced in place — carries its id. */
	readonly replace: readonly [id: string]
	/** Fires when a group is removed — carries its id. */
	readonly remove: readonly [id: string]
	/** Fires when the manager is destroyed. */
	readonly destroy: readonly []
}

/**
 * Configures `createGroupManager` / the `GroupManager` constructor.
 *
 * @remarks
 * `groups` — the initial collection. Default: `[]`. `on` — initial event
 * listeners. `error` — the emitter's listener-error handler.
 */
export interface GroupManagerOptions {
	readonly groups?: readonly FactorGroup[]
	readonly on?: EmitterHooks<GroupManagerEventMap>
	readonly error?: EmitterErrorHandler
}

/**
 * Declares the {@link DefinitionBuilderInterface} manager over a `FactorGroup`'s
 * `factors`, threaded through the required `groupId` locator (a factor lives
 * inside its group).
 *
 * @remarks
 * Divergent from the other managers: factors nest inside groups, so this
 * manager holds NO collection state of its own — it reads and writes through
 * the sibling {@link GroupManagerInterface} (`groups.group(groupId)` then
 * `groups.replace(…)`). A `groupId` naming no existing group throws
 * `ReasonError('TARGET', …, { groupId })`. `append` / `prepend` additionally
 * take an optional `target` factor id (a naming miss throws
 * `ReasonError('TARGET', …)`). It still owns its OWN emitter (factor-id
 * payloads). `remove` is the batch family behind the leading `groupId`
 * locator: the locator alone removes every factor of that group, a further id
 * removes that factor, a further id list removes those factors and returns
 * true only when every named id existed. It emits one `remove` per factor
 * actually removed, each paired with the sibling `GroupManagerInterface`'s
 * `replace` for the containing group.
 */
export interface FactorManagerInterface {
	readonly emitter: EmitterInterface<FactorManagerEventMap>
	factor(groupId: string, id: string): Factor | undefined
	factors(groupId: string): readonly Factor[]
	append(groupId: string, factor: Factor, target?: string): void
	prepend(groupId: string, factor: Factor, target?: string): void
	replace(groupId: string, factor: Factor): void
	// Array overload first so a list resolves to the batch form.
	remove(groupId: string, ids: readonly string[]): boolean
	remove(groupId: string, id: string): boolean
	remove(groupId: string): void
	destroy(): void
}

/** Represents the push observation surface of a {@link FactorManagerInterface}. */
export type FactorManagerEventMap = {
	/** Fires when a factor is appended — carries its id. */
	readonly append: readonly [id: string]
	/** Fires when a factor is prepended — carries its id. */
	readonly prepend: readonly [id: string]
	/** Fires when a factor is replaced in place — carries its id. */
	readonly replace: readonly [id: string]
	/** Fires when a factor is removed — carries its id. */
	readonly remove: readonly [id: string]
	/** Fires when the manager is destroyed. */
	readonly destroy: readonly []
}

/**
 * Configures `createFactorManager` / the `FactorManager` constructor.
 *
 * @remarks
 * The sibling `GroupManagerInterface` reference is a constructor argument, not
 * an option. `on` — initial event listeners. `error` — the
 * emitter's listener-error handler.
 */
export interface FactorManagerOptions {
	readonly on?: EmitterHooks<FactorManagerEventMap>
	readonly error?: EmitterErrorHandler
}

/**
 * Declares the {@link DefinitionBuilderInterface} manager over a logical definition's
 * `rules` — a self-owning, kind-free collection manager.
 *
 * @remarks
 * Rule order is load-bearing — the forward conclusion is the LAST declared
 * non-disabled rule, so `append` without a `target` makes a new rule the
 * conclusion. `remove` is the batch family: no argument removes every rule,
 * one id removes that rule, an id list removes those rules and returns true
 * only when every named id existed. It emits one `remove` per rule actually
 * removed — an id naming no rule emits nothing and returns false.
 */
export interface RuleManagerInterface {
	readonly emitter: EmitterInterface<RuleManagerEventMap>
	rule(id: string): Rule | undefined
	rules(): readonly Rule[]
	append(rule: Rule, target?: string): void
	prepend(rule: Rule, target?: string): void
	replace(rule: Rule): void
	// Array overload first so a list resolves to the batch form.
	remove(ids: readonly string[]): boolean
	remove(id: string): boolean
	remove(): void
	seat(rules: readonly Rule[]): void
	destroy(): void
}

/** Represents the push observation surface of a {@link RuleManagerInterface}. */
export type RuleManagerEventMap = {
	/** Fires when a rule is appended — carries its id. */
	readonly append: readonly [id: string]
	/** Fires when a rule is prepended — carries its id. */
	readonly prepend: readonly [id: string]
	/** Fires when a rule is replaced in place — carries its id. */
	readonly replace: readonly [id: string]
	/** Fires when a rule is removed — carries its id. */
	readonly remove: readonly [id: string]
	/** Fires when the manager is destroyed. */
	readonly destroy: readonly []
}

/**
 * Configures `createRuleManager` / the `RuleManager` constructor.
 *
 * @remarks
 * `rules` — the initial collection. Default: `[]`. `on` — initial event
 * listeners. `error` — the emitter's listener-error handler.
 */
export interface RuleManagerOptions {
	readonly rules?: readonly Rule[]
	readonly on?: EmitterHooks<RuleManagerEventMap>
	readonly error?: EmitterErrorHandler
}

/**
 * Declares the {@link DefinitionBuilderInterface} manager over a symbolic definition's
 * `equations` — a self-owning, kind-free collection manager.
 *
 * @remarks
 * Equation order is strongly load-bearing — equations solve strictly in
 * order and each rounded solution feeds forward. `remove` is the batch family:
 * no argument removes every equation, one id removes that equation, an id list
 * removes those equations and returns true only when every named id existed. It
 * emits one `remove` per equation actually removed — an id naming no equation
 * emits nothing and returns false.
 */
export interface EquationManagerInterface {
	readonly emitter: EmitterInterface<EquationManagerEventMap>
	equation(id: string): Equation | undefined
	equations(): readonly Equation[]
	append(equation: Equation, target?: string): void
	prepend(equation: Equation, target?: string): void
	replace(equation: Equation): void
	// Array overload first so a list resolves to the batch form.
	remove(ids: readonly string[]): boolean
	remove(id: string): boolean
	remove(): void
	seat(equations: readonly Equation[]): void
	destroy(): void
}

/** Represents the push observation surface of an {@link EquationManagerInterface}. */
export type EquationManagerEventMap = {
	/** Fires when an equation is appended — carries its id. */
	readonly append: readonly [id: string]
	/** Fires when an equation is prepended — carries its id. */
	readonly prepend: readonly [id: string]
	/** Fires when an equation is replaced in place — carries its id. */
	readonly replace: readonly [id: string]
	/** Fires when an equation is removed — carries its id. */
	readonly remove: readonly [id: string]
	/** Fires when the manager is destroyed. */
	readonly destroy: readonly []
}

/**
 * Configures `createEquationManager` / the `EquationManager` constructor.
 *
 * @remarks
 * `equations` — the initial collection. Default: `[]`. `on` — initial
 * event listeners. `error` — the emitter's listener-error handler.
 */
export interface EquationManagerOptions {
	readonly equations?: readonly Equation[]
	readonly on?: EmitterHooks<EquationManagerEventMap>
	readonly error?: EmitterErrorHandler
}

/**
 * Declares the {@link DefinitionBuilderInterface} manager over an inferential
 * definition's `facts` — a self-owning, kind-free collection manager.
 *
 * @remarks
 * `remove` is the batch family: no argument removes every fact, one id removes
 * that fact, an id list removes those facts and returns true only when every
 * named id existed. It emits one `remove` per fact actually removed — an id
 * naming no fact emits nothing and returns false.
 */
export interface FactManagerInterface {
	readonly emitter: EmitterInterface<FactManagerEventMap>
	fact(id: string): Fact | undefined
	facts(): readonly Fact[]
	append(fact: Fact, target?: string): void
	prepend(fact: Fact, target?: string): void
	replace(fact: Fact): void
	// Array overload first so a list resolves to the batch form.
	remove(ids: readonly string[]): boolean
	remove(id: string): boolean
	remove(): void
	seat(facts: readonly Fact[]): void
	destroy(): void
}

/** Represents the push observation surface of a {@link FactManagerInterface}. */
export type FactManagerEventMap = {
	/** Fires when a fact is appended — carries its id. */
	readonly append: readonly [id: string]
	/** Fires when a fact is prepended — carries its id. */
	readonly prepend: readonly [id: string]
	/** Fires when a fact is replaced in place — carries its id. */
	readonly replace: readonly [id: string]
	/** Fires when a fact is removed — carries its id. */
	readonly remove: readonly [id: string]
	/** Fires when the manager is destroyed. */
	readonly destroy: readonly []
}

/**
 * Configures `createFactManager` / the `FactManager` constructor.
 *
 * @remarks
 * `facts` — the initial collection. Default: `[]`. `on` — initial event
 * listeners. `error` — the emitter's listener-error handler.
 */
export interface FactManagerOptions {
	readonly facts?: readonly Fact[]
	readonly on?: EmitterHooks<FactManagerEventMap>
	readonly error?: EmitterErrorHandler
}

/**
 * Declares the {@link DefinitionBuilderInterface} manager over an inferential
 * definition's `inferences` — a self-owning, kind-free collection manager.
 *
 * @remarks
 * Inference order is load-bearing — backward proving iterates in declaration
 * order and returns on first success. `remove` is the batch family: no
 * argument removes every inference, one id removes that inference, an id list
 * removes those inferences and returns true only when every named id existed.
 * It emits one `remove` per inference actually removed — an id naming no
 * inference emits nothing and returns false.
 */
export interface InferenceManagerInterface {
	readonly emitter: EmitterInterface<InferenceManagerEventMap>
	inference(id: string): Inference | undefined
	inferences(): readonly Inference[]
	append(inference: Inference, target?: string): void
	prepend(inference: Inference, target?: string): void
	replace(inference: Inference): void
	// Array overload first so a list resolves to the batch form.
	remove(ids: readonly string[]): boolean
	remove(id: string): boolean
	remove(): void
	seat(inferences: readonly Inference[]): void
	destroy(): void
}

/** Represents the push observation surface of an {@link InferenceManagerInterface}. */
export type InferenceManagerEventMap = {
	/** Fires when an inference is appended — carries its id. */
	readonly append: readonly [id: string]
	/** Fires when an inference is prepended — carries its id. */
	readonly prepend: readonly [id: string]
	/** Fires when an inference is replaced in place — carries its id. */
	readonly replace: readonly [id: string]
	/** Fires when an inference is removed — carries its id. */
	readonly remove: readonly [id: string]
	/** Fires when the manager is destroyed. */
	readonly destroy: readonly []
}

/**
 * Configures `createInferenceManager` / the `InferenceManager` constructor.
 *
 * @remarks
 * `inferences` — the initial collection. Default: `[]`. `on` — initial
 * event listeners. `error` — the emitter's listener-error handler.
 */
export interface InferenceManagerOptions {
	readonly inferences?: readonly Inference[]
	readonly on?: EmitterHooks<InferenceManagerEventMap>
	readonly error?: EmitterErrorHandler
}

/**
 * Declares the {@link DefinitionBuilderInterface} manager over a symbolic definition's
 * `variables` — a name-keyed unordered record, so `add` / `remove` are the
 * only write verbs (no placement). A self-owning, kind-free manager.
 *
 * @remarks
 * The record is keyed by NAME, so `remove`'s batch family is over names: no
 * argument removes every variable, one name removes that variable, a name list
 * removes those variables and returns true only when every named variable
 * existed. It emits one `remove` per variable actually removed — a name
 * matching nothing emits nothing and returns false.
 */
export interface VariableManagerInterface {
	readonly emitter: EmitterInterface<VariableManagerEventMap>
	variable(name: string): number | undefined
	variables(): Readonly<Record<string, number>>
	add(name: string, value: number): void
	// Array overload first so a list resolves to the batch form.
	remove(names: readonly string[]): boolean
	remove(name: string): boolean
	remove(): void
	seat(variables: Readonly<Record<string, number>>): void
	destroy(): void
}

/**
 * Represents the push observation surface of a {@link VariableManagerInterface}.
 *
 * @remarks
 * `variables` is a name-keyed record with no placement, so the honest verbs
 * are `add` / `remove` — each carries the variable NAME.
 */
export type VariableManagerEventMap = {
	/** Fires when a variable is upserted — carries its name. */
	readonly add: readonly [name: string]
	/** Fires when a variable is removed — carries its name. */
	readonly remove: readonly [name: string]
	/** Fires when the manager is destroyed. */
	readonly destroy: readonly []
}

/**
 * Configures `createVariableManager` / the `VariableManager` constructor.
 *
 * @remarks
 * `variables` — the initial record. Default: `{}`. `on` — initial event
 * listeners. `error` — the emitter's listener-error handler.
 */
export interface VariableManagerOptions {
	readonly variables?: Readonly<Record<string, number>>
	readonly on?: EmitterHooks<VariableManagerEventMap>
	readonly error?: EmitterErrorHandler
}

// === Definitions & subjects capability layer — entities

/**
 * Represents the scalar-only projection of each definition kind — the {@link DefinitionBuilderInterface}
 * implementation's private envelope holds the non-collection fields; `build()` re-composes
 * the kind's collections from the managers' plural accessors.
 */
export type DefinitionEnvelope =
	| Omit<QuantitativeDefinition, 'groups'>
	| Omit<LogicalDefinition, 'rules'>
	| Omit<SymbolicDefinition, 'equations' | 'variables'>
	| Omit<InferentialDefinition, 'facts' | 'inferences'>

/**
 * Names the optional {@link QuantitativeDefinition} fields `clearQuantitativeDefinition`
 * (and a quantitative {@link DefinitionBuilderInterface}'s `clear`) can delete.
 */
export type QuantitativeClearKey = 'description' | 'base' | 'bounds' | 'precision'

/**
 * Names the optional {@link LogicalDefinition} fields `clearLogicalDefinition` (and a
 * logical {@link DefinitionBuilderInterface}'s `clear`) can delete.
 */
export type LogicalClearKey = 'description' | 'depth'

/**
 * Names the optional {@link SymbolicDefinition} fields `clearSymbolicDefinition` (and
 * a symbolic {@link DefinitionBuilderInterface}'s `clear`) can delete.
 */
export type SymbolicClearKey = 'description' | 'precision'

/**
 * Names the optional {@link InferentialDefinition} fields
 * `clearInferentialDefinition` (and an inferential
 * {@link DefinitionBuilderInterface}'s `clear`) can delete.
 */
export type InferentialClearKey = 'description' | 'depth'

/**
 * Represents one chaining pass of the `LogicalReasoner` — the overall `conclusion` plus
 * the per-rule results the pass produced.
 *
 * @remarks
 * The shared return shape of the forward-fixpoint and backward-proving passes;
 * `LogicalResult.count` is derived from `rules` rather than carried here.
 */
export interface LogicalChainingResult {
	readonly conclusion: boolean
	readonly rules: readonly RuleResult[]
}

/**
 * Represents one chaining pass of the `InferentialReasoner` — the facts the pass derived
 * plus the proof tree, when the pass produced one.
 *
 * @remarks
 * The shared return shape of the forward-fixpoint and backward-proving passes;
 * `proof` is produced only by the backward pass, and only when a conclusion was
 * proved.
 */
export interface InferentialChainingResult {
	readonly derived: readonly Fact[]
	readonly proof?: ProofNode
}

/**
 * Represents the push observation surface of a {@link DefinitionBuilderInterface} — the
 * builder-level lifecycle events; per-element mutation
 * events live on the individual managers' own emitters.
 *
 * @remarks
 * `merge` carries the definition's `reasoning`; `clear` carries the cleared
 * key; `destroy` fires once on teardown.
 */
export type DefinitionBuilderEventMap = {
	/** Fires when the definition is reconciled with an incoming definition — carries the reasoning. */
	readonly merge: readonly [reasoning: Reasoning]
	/** Fires when an optional field is cleared — carries the field key. */
	readonly clear: readonly [key: string]
	/** Fires when the entity is destroyed. */
	readonly destroy: readonly []
}

/**
 * Declares a stateful workspace builder accumulating a {@link Definition}
 * through always-present self-owning manager properties: a private scalar
 * envelope plus one manager per collection.
 *
 * @remarks
 * `build()` is TOTAL, deterministic, and returns a FRESH plain
 * {@link Definition} each call (the scalar envelope composed with the kind's
 * collections, read from the relevant managers' plural accessors — off-kind
 * managers are ignored). `merge(incoming)` requires the SAME `reasoning`,
 * distributes incoming scalars into the envelope and collections into the
 * managers through the matching `merge*` helper (a cross-reasoning `incoming`
 * throws `ReasonError('MISMATCH', …)`). `clear(key)` is the uniform
 * optional-key selector over the scalar envelope; a `key` that
 * is not a clearable optional field for the current kind throws
 * `ReasonError('MISMATCH', …, { key, reasoning })`. `destroy()` cascades to
 * every manager, emits `destroy`, then tears the builder emitter down LAST;
 * it is idempotent, and post-destroy mutation / build throws
 * `ReasonError('DESTROYED', …)` — only the `emitter` / manager getters and
 * `destroy` keep working.
 */
export interface DefinitionBuilderInterface {
	readonly [DEFINITION_BUILDER_BRAND]: true
	readonly id: string
	readonly reasoning: Reasoning
	readonly emitter: EmitterInterface<DefinitionBuilderEventMap>
	readonly groups: GroupManagerInterface
	readonly factors: FactorManagerInterface
	readonly rules: RuleManagerInterface
	readonly equations: EquationManagerInterface
	readonly variables: VariableManagerInterface
	readonly facts: FactManagerInterface
	readonly inferences: InferenceManagerInterface
	build(): Definition
	merge(incoming: Definition): void
	clear(key: string): void
	destroy(): void
}

/**
 * Configures `createDefinitionBuilder` / the `DefinitionBuilder` constructor.
 *
 * @remarks
 * `id` — overrides the seed definition's `id`. Default: `seed.id`. Every
 * manager slot is BRING-YOUR-OWN — a supplied manager is reused,
 * else one is constructed and seeded from the seed's matching collection. `on`
 * — initial event listeners. `error` — the emitter's
 * listener-error handler.
 */
export interface DefinitionBuilderOptions {
	readonly id?: string
	readonly groups?: GroupManagerInterface
	readonly factors?: FactorManagerInterface
	readonly rules?: RuleManagerInterface
	readonly equations?: EquationManagerInterface
	readonly variables?: VariableManagerInterface
	readonly facts?: FactManagerInterface
	readonly inferences?: InferenceManagerInterface
	readonly on?: EmitterHooks<DefinitionBuilderEventMap>
	readonly error?: EmitterErrorHandler
}

/**
 * Represents the push observation surface of a {@link SubjectBuilderInterface} — five
 * verb-named events, no generic `change` / `status`.
 */
export type SubjectBuilderEventMap = {
	/** Fires when a field is upserted — carries its key and new value. */
	readonly set: readonly [key: string, value: unknown]
	/** Fires when a field is removed — carries its key. */
	readonly remove: readonly [key: string]
	/** Fires when the subject is reconciled with an incoming subject — carries the incoming record. */
	readonly merge: readonly [incoming: Subject]
	/** Fires when every non-id field is removed. */
	readonly clear: readonly []
	/** Fires when the entity is destroyed. */
	readonly destroy: readonly []
}

/**
 * Declares a stateful workspace builder accumulating a {@link Subject} — one
 * flat key-value collection, no managers.
 *
 * @remarks
 * `id` is OPTIONAL on the entity (`options?.id ?? seed.id`). When present,
 * the builder is id-ful — `build()`'s output carries that `id` and `clear()`
 * restores it. When absent, the builder is ANONYMOUS — `.id` is `undefined`,
 * `build()`'s output carries NO `id` key, and `clear()` empties the record
 * entirely. `field` / `fields` are the singular / plural accessor pair over
 * TOP-LEVEL keys only. `set(key, value)` delegates to `assignField`;
 * `set('id', …)` throws — id is immutable through the entity, id-ful or
 * anonymous alike. `remove` is the batch family: no argument removes every
 * non-id field and emits one `remove` per key in the builder's key order, one
 * key removes that field, and a key list removes those fields and returns true
 * only when every named key existed. The array form is declared FIRST.
 * `merge(incoming)` delegates to `mergeSubjects` (incoming-wins, base `id`
 * preserved — plain {@link Subject} data only). `clear()` removes every
 * non-id field. `repeat(count)` returns `count`
 * deterministic minted-id clones as PLAIN payloads — a pure read that does
 * NOT emit. `build(): Subject` is total, deterministic, and returns a fresh
 * durable payload each call — `fields()` returns the live record and `build()`
 * returns a fresh copy of it. Post-destroy
 * mutation throws `ReasonError('DESTROYED', …)`; `destroy()` is idempotent
 * and tears the emitter down LAST.
 */
export interface SubjectBuilderInterface {
	readonly [SUBJECT_BUILDER_BRAND]: true
	readonly id: string | undefined
	readonly emitter: EmitterInterface<SubjectBuilderEventMap>
	field(key: string): unknown
	fields(): Subject
	set(key: string, value: unknown): void
	// Array overload first so a list resolves to the batch form.
	remove(keys: readonly string[]): boolean
	remove(key: string): boolean
	remove(): void
	merge(incoming: Subject): void
	clear(): void
	repeat(count: number): readonly Subject[]
	build(): Subject
	destroy(): void
}

/**
 * Configures `createSubjectBuilder` / the `SubjectBuilder` constructor.
 *
 * @remarks
 * `id` — overrides the seed subject's `id`. Default: `seed.id`. OPTIONAL
 * — when neither `options.id` nor a string `seed.id` is present the builder
 * is ANONYMOUS (`.id` is `undefined`, `build()` emits no `id` key). `on` —
 * initial event listeners. `error` — the emitter's listener-error handler.
 */
export interface SubjectBuilderOptions {
	readonly id?: string
	readonly on?: EmitterHooks<SubjectBuilderEventMap>
	readonly error?: EmitterErrorHandler
}
