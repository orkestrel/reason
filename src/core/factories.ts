import type {
	Aggregation,
	AggregatorInterface,
	AggregatorOptions,
	Bounds,
	Check,
	Comparison,
	Definition,
	DefinitionBuilderInterface,
	DefinitionBuilderOptions,
	Equation,
	EquationManagerInterface,
	EquationManagerOptions,
	EvaluatorInterface,
	EvaluatorOptions,
	Expression,
	Fact,
	FactManagerInterface,
	FactManagerOptions,
	Factor,
	FactorGroup,
	FactorManagerInterface,
	FactorManagerOptions,
	FactorRange,
	GroupManagerInterface,
	GroupManagerOptions,
	Inference,
	InferenceManagerInterface,
	InferenceManagerOptions,
	InferentialDefinition,
	InferentialReasonerOptions,
	LogicalDefinition,
	LogicalOperator,
	LogicalReasonerOptions,
	MathOperation,
	QuantitativeDefinition,
	QuantitativeReasonerOptions,
	ReasonInterface,
	ReasonOptions,
	ReasonerInterface,
	Rule,
	RuleManagerInterface,
	RuleManagerOptions,
	Source,
	Subject,
	SubjectBuilderInterface,
	SubjectBuilderOptions,
	SymbolicDefinition,
	SymbolicExpression,
	SymbolicReasonerOptions,
	Transform,
	TransformerInterface,
	TransformerOptions,
	VariableManagerInterface,
	VariableManagerOptions,
} from './types.js'
import type { FieldPath } from '@orkestrel/contract'
import { DEFAULT_CONFIDENCE } from './constants.js'
import { Reason } from './Reason.js'
import { Evaluator } from './operators/Evaluator.js'
import { Transformer } from './operators/Transformer.js'
import { Aggregator } from './operators/Aggregator.js'
import { QuantitativeReasoner } from './reasoners/QuantitativeReasoner.js'
import { LogicalReasoner } from './reasoners/LogicalReasoner.js'
import { SymbolicReasoner } from './reasoners/SymbolicReasoner.js'
import { InferentialReasoner } from './reasoners/InferentialReasoner.js'
import { DefinitionBuilder } from './builders/DefinitionBuilder.js'
import { SubjectBuilder } from './builders/SubjectBuilder.js'
import { GroupManager } from './builders/managers/GroupManager.js'
import { FactorManager } from './builders/managers/FactorManager.js'
import { RuleManager } from './builders/managers/RuleManager.js'
import { EquationManager } from './builders/managers/EquationManager.js'
import { VariableManager } from './builders/managers/VariableManager.js'
import { FactManager } from './builders/managers/FactManager.js'
import { InferenceManager } from './builders/managers/InferenceManager.js'

/**
 * Creates a check evaluator.
 *
 * @remarks
 * `id` — the evaluator's identity string (defaults to `'evaluator'`).
 *
 * @param options - Optional `id`
 * @returns A stateless {@link EvaluatorInterface}
 *
 * @example
 * ```ts
 * import { createEvaluator } from '@src/core'
 *
 * const evaluator = createEvaluator()
 * evaluator.evaluate({ field: 'age', operator: 'above', value: 18 }, { age: 25 })
 * // { field: 'age', met: true, actual: 25 }
 * ```
 */
export function createEvaluator(options?: EvaluatorOptions): EvaluatorInterface {
	return new Evaluator(options)
}

/**
 * Creates a math transformer.
 *
 * @remarks
 * `id` — the transformer's identity string (defaults to `'transformer'`).
 *
 * @param options - Optional `id`
 * @returns A stateless {@link TransformerInterface}
 *
 * @example
 * ```ts
 * import { createTransform, createTransformer } from '@src/core'
 *
 * const transformer = createTransformer()
 * transformer.chain(100, [createTransform('add', 50), createTransform('multiply', 2)]) // 300
 * ```
 */
export function createTransformer(options?: TransformerOptions): TransformerInterface {
	return new Transformer(options)
}

/**
 * Creates a number aggregator.
 *
 * @remarks
 * `id` — the aggregator's identity string (defaults to `'aggregator'`).
 *
 * @param options - Optional `id`
 * @returns A stateless {@link AggregatorInterface}
 *
 * @example
 * ```ts
 * import { createAggregator } from '@src/core'
 *
 * const aggregator = createAggregator()
 * aggregator.aggregate([10, 20], 'average', [1, 3]) // 17.5 — weighted mean
 * ```
 */
export function createAggregator(options?: AggregatorOptions): AggregatorInterface {
	return new Aggregator(options)
}

/**
 * Creates the quantitative reasoner — factor-based numeric scoring.
 *
 * @remarks
 * `id` — the reasoner's identity string (defaults to `'quantitative'`).
 * `evaluator` / `transformer` / `aggregator` — injectable operators, each
 * defaulting to a fresh default-constructed instance.
 *
 * @param options - Optional `id` and operator injections
 * @returns A {@link ReasonerInterface} with reasoning `'quantitative'`
 *
 * @example
 * ```ts
 * import { createFactorGroup, createFieldFactor, createQuantitativeDefinition, createQuantitativeReasoner } from '@src/core'
 *
 * const reasoner = createQuantitativeReasoner()
 * const definition = createQuantitativeDefinition('risk', 'Risk', [
 * 	createFactorGroup('g1', 'sum', [createFieldFactor('age', 'age')]),
 * ], { base: 100 })
 * reasoner.reason({ age: 25 }, definition) // value 125
 * ```
 */
export function createQuantitativeReasoner(
	options?: QuantitativeReasonerOptions,
): ReasonerInterface {
	return new QuantitativeReasoner(options)
}

/**
 * Creates the logical reasoner — rule-based deduction with forward / backward
 * chaining.
 *
 * @remarks
 * `id` — the reasoner's identity string (defaults to `'logical'`). `evaluator`
 * — the injectable check evaluator (defaults to a fresh instance).
 *
 * @param options - Optional `id` and evaluator injection
 * @returns A {@link ReasonerInterface} with reasoning `'logical'`
 *
 * @example
 * ```ts
 * import { createAtom, createLogicalDefinition, createLogicalReasoner, createRule } from '@src/core'
 *
 * const reasoner = createLogicalReasoner()
 * const definition = createLogicalDefinition('eligibility', 'Eligibility', [
 * 	createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
 * ])
 * reasoner.reason({ age: 25 }, definition) // conclusion true
 * ```
 */
export function createLogicalReasoner(options?: LogicalReasonerOptions): ReasonerInterface {
	return new LogicalReasoner(options)
}

/**
 * Creates the symbolic reasoner — algebraic equation solving by variable
 * isolation.
 *
 * @remarks
 * `id` — the reasoner's identity string (defaults to `'symbolic'`).
 *
 * @param options - Optional `id`
 * @returns A {@link ReasonerInterface} with reasoning `'symbolic'`
 *
 * @example
 * ```ts
 * import { createConstant, createEquation, createOperation, createSymbolicDefinition, createSymbolicReasoner, createVariable } from '@src/core'
 *
 * const reasoner = createSymbolicReasoner()
 * const definition = createSymbolicDefinition('double', 'Double', [
 * 	createEquation('e1', createVariable('y'), createOperation('multiply', createVariable('x'), createConstant(2)), 'y'),
 * ])
 * reasoner.reason({ x: 21 }, definition) // solutions.y === 42
 * ```
 */
export function createSymbolicReasoner(options?: SymbolicReasonerOptions): ReasonerInterface {
	return new SymbolicReasoner(options)
}

/**
 * Creates the inferential reasoner — fact derivation with unification variables
 * and proof trees.
 *
 * @remarks
 * `id` — the reasoner's identity string (defaults to `'inferential'`).
 *
 * @param options - Optional `id`
 * @returns A {@link ReasonerInterface} with reasoning `'inferential'`
 *
 * @example
 * ```ts
 * import { createFact, createInference, createInferentialDefinition, createInferentialReasoner } from '@src/core'
 *
 * const reasoner = createInferentialReasoner()
 * const definition = createInferentialDefinition('mortality', 'Mortality',
 * 	[createFact('f1', 'human', ['socrates'])],
 * 	[createInference('mortal', [createFact('p1', 'human', ['?x'])], createFact('c1', 'mortal', ['?x']))],
 * )
 * reasoner.reason({}, definition) // derives mortal(socrates)
 * ```
 */
export function createInferentialReasoner(options?: InferentialReasonerOptions): ReasonerInterface {
	return new InferentialReasoner(options)
}

/**
 * Creates the reasoning orchestrator.
 *
 * @remarks
 * `reasoners` — the initial registry (a later entry of the same reasoning
 * replaces an earlier one; the orchestrator ships with NO defaults). `bail` —
 * `true` (the default) rethrows a reasoner throw after the `error` emit;
 * `false` converts it to a failure result. `validate` — validate every
 * definition before running it, throwing `INVALID` on failure (default
 * `false`). `on` — initial event listeners. `error` — the emitter's
 * listener-error handler.
 *
 * @param options - Optional registry, policies, and emitter hooks
 * @returns A {@link ReasonInterface}
 *
 * @example
 * ```ts
 * import { createLogicalReasoner, createQuantitativeReasoner, createReason } from '@src/core'
 *
 * const reason = createReason({
 * 	reasoners: [createQuantitativeReasoner(), createLogicalReasoner()],
 * 	on: { reason: (result) => console.log(result.success) },
 * })
 * const result = reason.reason({ age: 25 }, definition)
 * reason.destroy()
 * ```
 */
export function createReason(options?: ReasonOptions): ReasonInterface {
	return new Reason(options)
}

/**
 * Creates a `DefinitionBuilder` — a stateful workspace builder accumulating a
 * {@link Definition} through seven self-owning manager properties.
 *
 * @remarks
 * `id` defaults to `seed.id`. Each manager slot is BRING-YOUR-OWN (a supplied
 * one is reused, else a fresh one is seeded from the seed's matching
 * collection). `on` — initial event listeners. `error` — the emitter's
 * listener-error handler. Mutate through the manager
 * properties (`groups` / `factors` / `rules` / `equations` / `variables` /
 * `facts` / `inferences`) and `merge` / `clear`, then call `build()` to produce
 * a fresh, plain {@link Definition} snapshot.
 *
 * @param seed - The starting definition (any of the four reasoning kinds)
 * @param options - Optional `id` override, manager injections, and emitter hooks
 * @returns A {@link DefinitionBuilderInterface}
 *
 * @example
 * ```ts
 * import { createDefinitionBuilder, createQuantitativeDefinition } from '@src/core'
 *
 * const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []))
 * definition.groups.append({ id: 'g1', name: 'g1', aggregation: 'sum', factors: [] })
 * definition.build() // a fresh QuantitativeDefinition with the group applied
 * definition.destroy()
 * ```
 */
export function createDefinitionBuilder(
	seed: Definition,
	options?: DefinitionBuilderOptions,
): DefinitionBuilderInterface {
	return new DefinitionBuilder(seed, options)
}

/**
 * Creates a `SubjectBuilder` — a stateful workspace builder accumulating a
 * {@link Subject}.
 *
 * @remarks
 * `id` defaults to `seed.id` and is OPTIONAL — when neither `options.id` nor
 * a string `seed.id` is present the builder is ANONYMOUS (`.id` is
 * `undefined`, `build()` emits no `id` key). `on` — initial event listeners.
 * `error` — the emitter's listener-error handler.
 * Mutate through `set` / `remove` / `merge` / `clear`, then call `build()` to
 * produce a fresh, plain {@link Subject} snapshot.
 *
 * @param seed - The starting subject
 * @param options - Optional `id` override and emitter hooks
 * @returns A {@link SubjectBuilderInterface}
 *
 * @example
 * ```ts
 * import { createSubjectBuilder } from '@src/core'
 *
 * const subject = createSubjectBuilder({ id: 's1', age: 30 })
 * subject.set('age', 31)
 * subject.build() // { id: 's1', age: 31 }
 * subject.destroy()
 * ```
 */
export function createSubjectBuilder(
	seed: Subject,
	options?: SubjectBuilderOptions,
): SubjectBuilderInterface {
	return new SubjectBuilder(seed, options)
}

/**
 * Creates a `GroupManager` — a self-owning manager over a quantitative
 * definition's `groups`.
 *
 * @remarks
 * `groups` — the initial collection (defaults to empty). `on` / `error` —
 * emitter hooks. Kind-free: hand it to a {@link createDefinitionBuilder}
 * `groups` slot regardless of reasoning.
 *
 * @param options - Optional seed collection and emitter hooks
 * @returns A {@link GroupManagerInterface}
 *
 * @example
 * ```ts
 * import { createFactorGroup, createGroupManager } from '@src/core'
 *
 * const groups = createGroupManager({ groups: [createFactorGroup('g1', 'sum', [])] })
 * groups.append(createFactorGroup('g2', 'sum', []))
 * ```
 */
export function createGroupManager(options?: GroupManagerOptions): GroupManagerInterface {
	return new GroupManager(options)
}

/**
 * Creates a `FactorManager` — the divergent manager over a group's `factors`,
 * threaded through a required `groupId` locator.
 *
 * @remarks
 * Holds no collection state of its own — it reads and writes factors through
 * the injected sibling {@link GroupManagerInterface}. `on` / `error` — emitter
 * hooks.
 *
 * @param groups - The sibling group manager factors are located within
 * @param options - Optional emitter hooks
 * @returns A {@link FactorManagerInterface}
 *
 * @example
 * ```ts
 * import { createFactorGroup, createFactorManager, createGroupManager, createStaticFactor } from '@src/core'
 *
 * const groups = createGroupManager({ groups: [createFactorGroup('g1', 'sum', [])] })
 * const factors = createFactorManager(groups)
 * factors.append('g1', createStaticFactor('f1', 10))
 * ```
 */
export function createFactorManager(
	groups: GroupManagerInterface,
	options?: FactorManagerOptions,
): FactorManagerInterface {
	return new FactorManager(groups, options)
}

/**
 * Creates a `RuleManager` — a self-owning manager over a logical definition's
 * `rules`.
 *
 * @remarks
 * `rules` — the initial collection (defaults to empty). `on` / `error` —
 * emitter hooks. Rule order is load-bearing.
 *
 * @param options - Optional seed collection and emitter hooks
 * @returns A {@link RuleManagerInterface}
 *
 * @example
 * ```ts
 * import { createAtom, createRule, createRuleManager } from '@src/core'
 *
 * const rules = createRuleManager()
 * rules.append(createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)))
 * ```
 */
export function createRuleManager(options?: RuleManagerOptions): RuleManagerInterface {
	return new RuleManager(options)
}

/**
 * Creates an `EquationManager` — a self-owning manager over a symbolic
 * definition's `equations`.
 *
 * @remarks
 * `equations` — the initial collection (defaults to empty). `on` / `error` —
 * emitter hooks. Equation order is strongly load-bearing.
 *
 * @param options - Optional seed collection and emitter hooks
 * @returns An {@link EquationManagerInterface}
 *
 * @example
 * ```ts
 * import { createConstant, createEquation, createEquationManager, createVariable } from '@src/core'
 *
 * const equations = createEquationManager()
 * equations.append(createEquation('e1', createVariable('y'), createConstant(2), 'y'))
 * ```
 */
export function createEquationManager(options?: EquationManagerOptions): EquationManagerInterface {
	return new EquationManager(options)
}

/**
 * Creates a `VariableManager` — a self-owning manager over a symbolic
 * definition's `variables` (a name-keyed record; `add` / `remove` only).
 *
 * @remarks
 * `variables` — the initial record (defaults to empty). `on` / `error` —
 * emitter hooks.
 *
 * @param options - Optional seed record and emitter hooks
 * @returns A {@link VariableManagerInterface}
 *
 * @example
 * ```ts
 * import { createVariableManager } from '@src/core'
 *
 * const variables = createVariableManager({ variables: { x: 1 } })
 * variables.add('y', 2)
 * ```
 */
export function createVariableManager(options?: VariableManagerOptions): VariableManagerInterface {
	return new VariableManager(options)
}

/**
 * Creates a `FactManager` — a self-owning manager over an inferential
 * definition's `facts`.
 *
 * @remarks
 * `facts` — the initial collection (defaults to empty). `on` / `error` —
 * emitter hooks.
 *
 * @param options - Optional seed collection and emitter hooks
 * @returns A {@link FactManagerInterface}
 *
 * @example
 * ```ts
 * import { createFact, createFactManager } from '@src/core'
 *
 * const facts = createFactManager()
 * facts.append(createFact('f1', 'human', ['socrates']))
 * ```
 */
export function createFactManager(options?: FactManagerOptions): FactManagerInterface {
	return new FactManager(options)
}

/**
 * Creates an `InferenceManager` — a self-owning manager over an inferential
 * definition's `inferences`.
 *
 * @remarks
 * `inferences` — the initial collection (defaults to empty). `on` / `error` —
 * emitter hooks. Inference order is load-bearing.
 *
 * @param options - Optional seed collection and emitter hooks
 * @returns An {@link InferenceManagerInterface}
 *
 * @example
 * ```ts
 * import { createFact, createInference, createInferenceManager } from '@src/core'
 *
 * const inferences = createInferenceManager()
 * inferences.append(createInference('m', [createFact('p', 'human', ['?x'])], createFact('c', 'mortal', ['?x'])))
 * ```
 */
export function createInferenceManager(
	options?: InferenceManagerOptions,
): InferenceManagerInterface {
	return new InferenceManager(options)
}

// The value factories that follow assemble the declarative definition vocabulary.
// Each returns a fresh, JSON-serializable value and OMITS absent optional keys
// entirely (never sets them to `undefined`), so the output round-trips through
// the exact-record validators. A factory with an `overrides` bag spreads it
// LAST — an override always wins over a default (a `name` defaults to the `id`
// wherever a display name is required).

// === Checks & expressions

/**
 * Creates a {@link Check} — one field predicate.
 *
 * @param field - The subject field to resolve (a string is ONE key; an array descends)
 * @param operator - The comparison to apply
 * @param value - The expected value (any type — the operator decides what is meaningful)
 * @returns A fresh check
 *
 * @example
 * ```ts
 * import { createCheck } from '@src/core'
 *
 * createCheck('age', 'from', 18) // { field: 'age', operator: 'from', value: 18 }
 * ```
 */
export function createCheck(field: FieldPath, operator: Comparison, value: unknown): Check {
	return { field, operator, value }
}

/**
 * Creates an atom {@link Expression} — a leaf wrapping one {@link Check}.
 *
 * @param field - The subject field to resolve
 * @param operator - The comparison to apply
 * @param value - The expected value
 * @returns A fresh atom expression
 *
 * @example
 * ```ts
 * import { createAtom } from '@src/core'
 *
 * createAtom('age', 'from', 18) // { form: 'atom', check: { field: 'age', operator: 'from', value: 18 } }
 * ```
 */
export function createAtom(field: FieldPath, operator: Comparison, value: unknown): Expression {
	return { form: 'atom', check: createCheck(field, operator, value) }
}

/**
 * Creates a compound {@link Expression} — a logical connective over nested
 * operands.
 *
 * @param operator - The logical connective
 * @param operands - The nested expressions it combines
 * @returns A fresh compound expression
 *
 * @example
 * ```ts
 * import { createAtom, createCompound } from '@src/core'
 *
 * createCompound('and', [createAtom('age', 'from', 18), createAtom('state', 'equals', 'CA')])
 * ```
 */
export function createCompound(
	operator: LogicalOperator,
	operands: readonly Expression[],
): Expression {
	return { form: 'compound', operator, operands }
}

/**
 * Creates a {@link Rule} — premises and a conclusion.
 *
 * @remarks
 * `name` defaults to the `id`; set `name`, `description`, `priority`, or
 * `enabled` through `overrides`.
 *
 * @param id - The rule id
 * @param premises - The expressions that must ALL hold
 * @param conclusion - The expression whose atoms are asserted when they do
 * @param overrides - Optional {@link Rule} fields merged over the defaults
 * @returns A fresh rule
 *
 * @example
 * ```ts
 * import { createAtom, createRule } from '@src/core'
 *
 * createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true), { priority: 1 })
 * ```
 */
export function createRule(
	id: string,
	premises: readonly Expression[],
	conclusion: Expression,
	overrides?: Partial<Omit<Rule, 'id' | 'premises' | 'conclusion'>>,
): Rule {
	return { id, name: id, premises, conclusion, ...overrides }
}

// === Transforms & bounds

/**
 * Creates a {@link Transform} — one math step.
 *
 * @remarks
 * The `operand` key is OMITTED when absent (never set to `undefined`), so the
 * transform stays exact-record valid; the transformer then applies its
 * per-operation default (`1` for `multiply` / `divide` / `power`, `0` otherwise).
 *
 * @param operator - The math operation to apply
 * @param operand - The operand (ignored by the unary operations)
 * @returns A fresh transform
 *
 * @example
 * ```ts
 * import { createTransform } from '@src/core'
 *
 * createTransform('multiply', 2) // { operation: 'multiply', operand: 2 }
 * createTransform('round')       // { operation: 'round' }
 * ```
 */
export function createTransform(operator: MathOperation, operand?: number): Transform {
	return operand === undefined ? { operation: operator } : { operation: operator, operand }
}

/**
 * Creates a {@link Bounds} — an inclusive numeric clamp.
 *
 * @remarks
 * Absent sides are OMITTED (never set to `undefined`) — an absent bound is
 * unbounded on that side.
 *
 * @param minimum - The inclusive lower bound
 * @param maximum - The inclusive upper bound
 * @returns A fresh bounds record
 *
 * @example
 * ```ts
 * import { createBounds } from '@src/core'
 *
 * createBounds(0, 100)         // { minimum: 0, maximum: 100 }
 * createBounds(undefined, 100) // { maximum: 100 }
 * ```
 */
export function createBounds(minimum?: number, maximum?: number): Bounds {
	return {
		...(minimum === undefined ? {} : { minimum }),
		...(maximum === undefined ? {} : { maximum }),
	}
}

// === Symbolic expressions

/**
 * Creates a variable {@link SymbolicExpression} leaf.
 *
 * @param name - The variable name
 * @returns A fresh variable node
 *
 * @example
 * ```ts
 * import { createVariable } from '@src/core'
 *
 * createVariable('x') // { form: 'variable', name: 'x' }
 * ```
 */
export function createVariable(name: string): SymbolicExpression {
	return { form: 'variable', name }
}

/**
 * Creates a constant {@link SymbolicExpression} leaf.
 *
 * @param value - The fixed number
 * @returns A fresh constant node
 *
 * @example
 * ```ts
 * import { createConstant } from '@src/core'
 *
 * createConstant(42) // { form: 'constant', value: 42 }
 * ```
 */
export function createConstant(value: number): SymbolicExpression {
	return { form: 'constant', value }
}

/**
 * Creates an operation {@link SymbolicExpression} node.
 *
 * @remarks
 * The `right` key is OMITTED when absent — correct for the unary operations
 * (`round` / `ceil` / `floor` / `abs`); a binary operation with no `right`
 * treats it as the constant `0`.
 *
 * @param operator - The math operation
 * @param left - The left operand
 * @param right - The right operand (omit for unary operations)
 * @returns A fresh operation node
 *
 * @example
 * ```ts
 * import { createConstant, createOperation, createVariable } from '@src/core'
 *
 * createOperation('add', createVariable('x'), createConstant(1))
 * createOperation('abs', createVariable('x')) // unary — no right operand
 * ```
 */
export function createOperation(
	operator: MathOperation,
	left: SymbolicExpression,
	right?: SymbolicExpression,
): SymbolicExpression {
	return right === undefined
		? { form: 'operation', operator, left }
		: { form: 'operation', operator, left, right }
}

/**
 * Creates an {@link Equation} — `left = right`, solved for `target`.
 *
 * @remarks
 * `name` defaults to the `id`; set `name` or `description` through `overrides`.
 *
 * @param id - The equation id
 * @param left - The left side
 * @param right - The right side
 * @param target - The variable name to solve for
 * @param overrides - Optional {@link Equation} fields merged over the defaults
 * @returns A fresh equation
 *
 * @example
 * ```ts
 * import { createConstant, createEquation, createOperation, createVariable } from '@src/core'
 *
 * // 2x + 3 = 11 — solved for x
 * createEquation('e1', createOperation('add', createOperation('multiply', createConstant(2), createVariable('x')), createConstant(3)), createConstant(11), 'x')
 * ```
 */
export function createEquation(
	id: string,
	left: SymbolicExpression,
	right: SymbolicExpression,
	target: string,
	overrides?: Partial<Omit<Equation, 'id' | 'left' | 'right' | 'target'>>,
): Equation {
	return { id, name: id, left, right, target, ...overrides }
}

// === Facts & inferences

/**
 * Creates a {@link Fact} — a predicate over positional terms.
 *
 * @remarks
 * `confidence` defaults to `1` (the key is always set). A string term starting
 * with `?` is a unification variable.
 *
 * @param id - The fact id
 * @param predicate - The predicate name
 * @param terms - The positional terms
 * @param confidence - The fact's confidence (`0–1`, defaults to `1`)
 * @returns A fresh fact
 *
 * @example
 * ```ts
 * import { createFact } from '@src/core'
 *
 * createFact('f1', 'human', ['socrates'])       // confidence 1
 * createFact('f2', 'laysEggs', ['tweety'], 0.9) // explicit confidence
 * ```
 */
export function createFact(
	id: string,
	predicate: string,
	terms: readonly unknown[],
	confidence?: number,
): Fact {
	return { id, predicate, terms, confidence: confidence ?? DEFAULT_CONFIDENCE }
}

/**
 * Creates an {@link Inference} — premise patterns and a conclusion pattern.
 *
 * @remarks
 * `name` defaults to the `id`; set `name`, `description`, `confidence`, or
 * `enabled` through `overrides`.
 *
 * @param id - The inference id
 * @param premises - The fact patterns that must ALL unify
 * @param conclusion - The fact pattern derived when they do
 * @param overrides - Optional {@link Inference} fields merged over the defaults
 * @returns A fresh inference
 *
 * @example
 * ```ts
 * import { createFact, createInference } from '@src/core'
 *
 * createInference('mortal', [createFact('p1', 'human', ['?x'])], createFact('c1', 'mortal', ['?x']), { confidence: 0.8 })
 * ```
 */
export function createInference(
	id: string,
	premises: readonly Fact[],
	conclusion: Fact,
	overrides?: Partial<Omit<Inference, 'id' | 'premises' | 'conclusion'>>,
): Inference {
	return { id, name: id, premises, conclusion, ...overrides }
}

// === Sources

/**
 * Creates a static {@link Source} — a fixed number.
 *
 * @param value - The fixed value
 * @returns A fresh static source
 *
 * @example
 * ```ts
 * import { createStaticSource } from '@src/core'
 *
 * createStaticSource(42) // { origin: 'static', value: 42 }
 * ```
 */
export function createStaticSource(value: number): Source {
	return { origin: 'static', value }
}

/**
 * Creates a field {@link Source} — a subject field read as a number.
 *
 * @param field - The subject field to resolve
 * @returns A fresh field source
 *
 * @example
 * ```ts
 * import { createFieldSource } from '@src/core'
 *
 * createFieldSource(['profile', 'score']) // descends into nested objects
 * ```
 */
export function createFieldSource(field: FieldPath): Source {
	return { origin: 'field', field }
}

/**
 * Creates a lookup {@link Source} — a subject field mapped through a table.
 *
 * @param field - The subject field to resolve (stringified into a table key)
 * @param table - The lookup table
 * @returns A fresh lookup source
 *
 * @example
 * ```ts
 * import { createLookupSource } from '@src/core'
 *
 * createLookupSource('state', { CA: 5, NY: 8, TX: 2 })
 * ```
 */
export function createLookupSource(
	field: FieldPath,
	table: Readonly<Record<string, number>>,
): Source {
	return { origin: 'lookup', field, table }
}

/**
 * Creates a range {@link Source} — a numeric subject field banded through ordered
 * ranges (first match wins).
 *
 * @param field - The subject field to resolve as a number
 * @param ranges - The bands, scanned in order
 * @returns A fresh range source
 *
 * @example
 * ```ts
 * import { createBounds, createRangeSource } from '@src/core'
 *
 * createRangeSource('age', [
 * 	{ bounds: createBounds(undefined, 24), value: 30 },
 * 	{ bounds: createBounds(25, 64), value: 15 },
 * 	{ bounds: createBounds(65), value: 10 },
 * ])
 * ```
 */
export function createRangeSource(field: FieldPath, ranges: readonly FactorRange[]): Source {
	return { origin: 'range', field, ranges }
}

// === Factors, groups & definitions

/**
 * Creates a {@link Factor} over a static {@link Source}.
 *
 * @remarks
 * `name` defaults to the `id`; every other {@link Factor} field (checks,
 * transforms, bounds, weight, priority, enabled, required, fallback) comes
 * through `overrides`.
 *
 * @param id - The factor id
 * @param value - The fixed source value
 * @param overrides - Optional {@link Factor} fields merged over the defaults
 * @returns A fresh factor
 *
 * @example
 * ```ts
 * import { createStaticFactor } from '@src/core'
 *
 * createStaticFactor('base-rate', 10, { weight: 2 })
 * ```
 */
export function createStaticFactor(
	id: string,
	value: number,
	overrides?: Partial<Omit<Factor, 'id' | 'source'>>,
): Factor {
	return { id, name: id, source: createStaticSource(value), ...overrides }
}

/**
 * Creates a {@link Factor} over a field {@link Source}.
 *
 * @param id - The factor id
 * @param field - The subject field to resolve as a number
 * @param overrides - Optional {@link Factor} fields merged over the defaults
 * @returns A fresh factor
 *
 * @example
 * ```ts
 * import { createFieldFactor, createTransform } from '@src/core'
 *
 * createFieldFactor('income-score', 'income', { transforms: [createTransform('divide', 1000)], fallback: 0 })
 * ```
 */
export function createFieldFactor(
	id: string,
	field: FieldPath,
	overrides?: Partial<Omit<Factor, 'id' | 'source'>>,
): Factor {
	return { id, name: id, source: createFieldSource(field), ...overrides }
}

/**
 * Creates a {@link Factor} over a lookup {@link Source}.
 *
 * @param id - The factor id
 * @param field - The subject field to resolve (stringified into a table key)
 * @param table - The lookup table
 * @param overrides - Optional {@link Factor} fields merged over the defaults
 * @returns A fresh factor
 *
 * @example
 * ```ts
 * import { createLookupFactor } from '@src/core'
 *
 * createLookupFactor('state-score', 'state', { CA: 5, NY: 8 }, { fallback: 1 })
 * ```
 */
export function createLookupFactor(
	id: string,
	field: FieldPath,
	table: Readonly<Record<string, number>>,
	overrides?: Partial<Omit<Factor, 'id' | 'source'>>,
): Factor {
	return { id, name: id, source: createLookupSource(field, table), ...overrides }
}

/**
 * Creates a {@link Factor} over a range {@link Source}.
 *
 * @param id - The factor id
 * @param field - The subject field to resolve as a number
 * @param ranges - The bands, scanned in order (first match wins)
 * @param overrides - Optional {@link Factor} fields merged over the defaults
 * @returns A fresh factor
 *
 * @example
 * ```ts
 * import { createBounds, createRangeFactor } from '@src/core'
 *
 * createRangeFactor('age-band', 'age', [{ bounds: createBounds(undefined, 24), value: 30 }])
 * ```
 */
export function createRangeFactor(
	id: string,
	field: FieldPath,
	ranges: readonly FactorRange[],
	overrides?: Partial<Omit<Factor, 'id' | 'source'>>,
): Factor {
	return { id, name: id, source: createRangeSource(field, ranges), ...overrides }
}

/**
 * Creates a {@link FactorGroup}.
 *
 * @remarks
 * `name` defaults to the `id`; set `name`, `description`, `base`, `bounds`,
 * `enabled`, or `strict` through `overrides`.
 *
 * @param id - The group id
 * @param aggregation - How the applied factors' values reduce to one
 * @param factors - The group's factors
 * @param overrides - Optional {@link FactorGroup} fields merged over the defaults
 * @returns A fresh factor group
 *
 * @example
 * ```ts
 * import { createFactorGroup, createStaticFactor } from '@src/core'
 *
 * createFactorGroup('g1', 'sum', [createStaticFactor('f1', 10)], { base: 100 })
 * ```
 */
export function createFactorGroup(
	id: string,
	aggregation: Aggregation,
	factors: readonly Factor[],
	overrides?: Partial<Omit<FactorGroup, 'id' | 'aggregation' | 'factors'>>,
): FactorGroup {
	return { id, name: id, aggregation, factors, ...overrides }
}

/**
 * Creates a {@link QuantitativeDefinition}.
 *
 * @remarks
 * `aggregation` defaults to `'sum'`; set `aggregation`, `description`, `base`,
 * `bounds`, or `precision` through `overrides`.
 *
 * @param id - The definition id
 * @param name - The display name
 * @param groups - The factor groups
 * @param overrides - Optional {@link QuantitativeDefinition} fields merged over the defaults
 * @returns A fresh quantitative definition
 *
 * @example
 * ```ts
 * import { createFactorGroup, createFieldFactor, createQuantitativeDefinition } from '@src/core'
 *
 * createQuantitativeDefinition('risk', 'Risk Score', [createFactorGroup('g1', 'sum', [createFieldFactor('age', 'age')])], {
 * 	base: 100,
 * })
 * ```
 */
export function createQuantitativeDefinition(
	id: string,
	name: string,
	groups: readonly FactorGroup[],
	overrides?: Partial<Omit<QuantitativeDefinition, 'reasoning' | 'id' | 'name' | 'groups'>>,
): QuantitativeDefinition {
	return { reasoning: 'quantitative', id, name, groups, aggregation: 'sum', ...overrides }
}

/**
 * Creates a {@link LogicalDefinition}.
 *
 * @remarks
 * `strategy` defaults to `'forward'`; set `strategy`, `description`, or `depth`
 * through `overrides`.
 *
 * @param id - The definition id
 * @param name - The display name
 * @param rules - The deduction rules
 * @param overrides - Optional {@link LogicalDefinition} fields merged over the defaults
 * @returns A fresh logical definition
 *
 * @example
 * ```ts
 * import { createAtom, createLogicalDefinition, createRule } from '@src/core'
 *
 * createLogicalDefinition('eligibility', 'Eligibility', [
 * 	createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
 * ])
 * ```
 */
export function createLogicalDefinition(
	id: string,
	name: string,
	rules: readonly Rule[],
	overrides?: Partial<Omit<LogicalDefinition, 'reasoning' | 'id' | 'name' | 'rules'>>,
): LogicalDefinition {
	return { reasoning: 'logical', id, name, rules, strategy: 'forward', ...overrides }
}

/**
 * Creates a {@link SymbolicDefinition}.
 *
 * @remarks
 * `variables` defaults to `{}`; set `variables`, `description`, or `precision`
 * through `overrides`.
 *
 * @param id - The definition id
 * @param name - The display name
 * @param equations - The equations, solved in order
 * @param overrides - Optional {@link SymbolicDefinition} fields merged over the defaults
 * @returns A fresh symbolic definition
 *
 * @example
 * ```ts
 * import { createConstant, createEquation, createSymbolicDefinition, createVariable } from '@src/core'
 *
 * createSymbolicDefinition('rate', 'Rate', [createEquation('e1', createVariable('x'), createConstant(42), 'x')], {
 * 	precision: 2,
 * })
 * ```
 */
export function createSymbolicDefinition(
	id: string,
	name: string,
	equations: readonly Equation[],
	overrides?: Partial<Omit<SymbolicDefinition, 'reasoning' | 'id' | 'name' | 'equations'>>,
): SymbolicDefinition {
	return { reasoning: 'symbolic', id, name, equations, variables: {}, ...overrides }
}

/**
 * Creates an {@link InferentialDefinition}.
 *
 * @remarks
 * `strategy` defaults to `'forward'`; set `strategy`, `description`, or `depth`
 * through `overrides`.
 *
 * @param id - The definition id
 * @param name - The display name
 * @param facts - The base knowledge
 * @param inferences - The inference rules
 * @param overrides - Optional {@link InferentialDefinition} fields merged over the defaults
 * @returns A fresh inferential definition
 *
 * @example
 * ```ts
 * import { createFact, createInference, createInferentialDefinition } from '@src/core'
 *
 * createInferentialDefinition('mortality', 'Mortality', [createFact('f1', 'human', ['socrates'])], [
 * 	createInference('mortal', [createFact('p1', 'human', ['?x'])], createFact('c1', 'mortal', ['?x'])),
 * ])
 * ```
 */
export function createInferentialDefinition(
	id: string,
	name: string,
	facts: readonly Fact[],
	inferences: readonly Inference[],
	overrides?: Partial<
		Omit<InferentialDefinition, 'reasoning' | 'id' | 'name' | 'facts' | 'inferences'>
	>,
): InferentialDefinition {
	return {
		reasoning: 'inferential',
		id,
		name,
		facts,
		inferences,
		strategy: 'forward',
		...overrides,
	}
}
