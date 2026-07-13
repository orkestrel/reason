import type {
	AggregatorInterface,
	AggregatorOptions,
	Definition,
	DefinitionBuilderInterface,
	DefinitionBuilderOptions,
	EquationManagerInterface,
	EquationManagerOptions,
	EvaluatorInterface,
	EvaluatorOptions,
	FactManagerInterface,
	FactManagerOptions,
	FactorManagerInterface,
	FactorManagerOptions,
	GroupManagerInterface,
	GroupManagerOptions,
	InferenceManagerInterface,
	InferenceManagerOptions,
	InferentialReasonerOptions,
	LogicalReasonerOptions,
	QuantitativeReasonerOptions,
	ReasonInterface,
	ReasonOptions,
	ReasonerInterface,
	RuleManagerInterface,
	RuleManagerOptions,
	Subject,
	SubjectBuilderInterface,
	SubjectBuilderOptions,
	SymbolicReasonerOptions,
	TransformerInterface,
	TransformerOptions,
	VariableManagerInterface,
	VariableManagerOptions,
} from './types.js'
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
 * Create a check evaluator.
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
 * Create a math transformer.
 *
 * @remarks
 * `id` — the transformer's identity string (defaults to `'transformer'`).
 *
 * @param options - Optional `id`
 * @returns A stateless {@link TransformerInterface}
 *
 * @example
 * ```ts
 * import { createTransformer, transform } from '@src/core'
 *
 * const transformer = createTransformer()
 * transformer.chain(100, [transform('add', 50), transform('multiply', 2)]) // 300
 * ```
 */
export function createTransformer(options?: TransformerOptions): TransformerInterface {
	return new Transformer(options)
}

/**
 * Create a number aggregator.
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
 * Create the quantitative reasoner — factor-based numeric scoring.
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
 * import { createQuantitativeReasoner, fieldFactor, factorGroup, quantitativeDefinition } from '@src/core'
 *
 * const reasoner = createQuantitativeReasoner()
 * const definition = quantitativeDefinition('risk', 'Risk', [
 * 	factorGroup('g1', 'sum', [fieldFactor('age', 'age')]),
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
 * Create the logical reasoner — rule-based deduction with forward / backward
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
 * import { atom, createLogicalReasoner, logicalDefinition, rule } from '@src/core'
 *
 * const reasoner = createLogicalReasoner()
 * const definition = logicalDefinition('eligibility', 'Eligibility', [
 * 	rule('adult', [atom('age', 'from', 18)], atom('adult', 'equals', true)),
 * ])
 * reasoner.reason({ age: 25 }, definition) // conclusion true
 * ```
 */
export function createLogicalReasoner(options?: LogicalReasonerOptions): ReasonerInterface {
	return new LogicalReasoner(options)
}

/**
 * Create the symbolic reasoner — algebraic equation solving by variable
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
 * import { constant, createSymbolicReasoner, equation, operation, symbolicDefinition, variable } from '@src/core'
 *
 * const reasoner = createSymbolicReasoner()
 * const definition = symbolicDefinition('double', 'Double', [
 * 	equation('e1', variable('y'), operation('multiply', variable('x'), constant(2)), 'y'),
 * ])
 * reasoner.reason({ x: 21 }, definition) // solutions.y === 42
 * ```
 */
export function createSymbolicReasoner(options?: SymbolicReasonerOptions): ReasonerInterface {
	return new SymbolicReasoner(options)
}

/**
 * Create the inferential reasoner — fact derivation with unification variables
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
 * import { createInferentialReasoner, fact, inference, inferentialDefinition } from '@src/core'
 *
 * const reasoner = createInferentialReasoner()
 * const definition = inferentialDefinition('mortality', 'Mortality',
 * 	[fact('f1', 'human', ['socrates'])],
 * 	[inference('mortal', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']))],
 * )
 * reasoner.reason({}, definition) // derives mortal(socrates)
 * ```
 */
export function createInferentialReasoner(options?: InferentialReasonerOptions): ReasonerInterface {
	return new InferentialReasoner(options)
}

/**
 * Create the reasoning orchestrator.
 *
 * @remarks
 * `reasoners` — the initial registry (a later entry of the same reasoning
 * replaces an earlier one; the orchestrator ships with NO defaults). `bail` —
 * `true` (the default) rethrows a reasoner throw after the `error` emit;
 * `false` converts it to a failure result. `validate` — validate every
 * definition before running it, throwing `INVALID` on failure (default
 * `false`). `on` — initial event listeners (AGENTS §8). `error` — the
 * emitter's listener-error handler (AGENTS §13).
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
 * Create a `DefinitionBuilder` — a stateful workspace builder accumulating a
 * {@link Definition} through seven self-owning manager properties.
 *
 * @remarks
 * `id` defaults to `seed.id`. Each manager slot is BRING-YOUR-OWN (a supplied
 * one is reused, else a fresh one is seeded from the seed's matching
 * collection). `on` — initial event listeners (AGENTS §8). `error` — the
 * emitter's listener-error handler (AGENTS §13). Mutate through the manager
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
 * import { createDefinitionBuilder, quantitativeDefinition } from '@src/core'
 *
 * const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []))
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
 * Create a `SubjectBuilder` — a stateful workspace builder accumulating a
 * {@link Subject}.
 *
 * @remarks
 * `id` defaults to `seed.id` and is OPTIONAL — when neither `options.id` nor
 * a string `seed.id` is present the builder is ANONYMOUS (`.id` is
 * `undefined`, `build()` emits no `id` key). `on` — initial event listeners
 * (AGENTS §8). `error` — the emitter's listener-error handler (AGENTS §13).
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
 * Create a `GroupManager` — a self-owning manager over a quantitative
 * definition's `groups`.
 *
 * @remarks
 * `groups` — the initial collection (defaults to empty). `on` / `error` —
 * emitter hooks (AGENTS §8 / §13). Kind-free: hand it to a
 * {@link createDefinitionBuilder} `groups` slot regardless of reasoning.
 *
 * @param options - Optional seed collection and emitter hooks
 * @returns A {@link GroupManagerInterface}
 *
 * @example
 * ```ts
 * import { createGroupManager, factorGroup } from '@src/core'
 *
 * const groups = createGroupManager({ groups: [factorGroup('g1', 'sum', [])] })
 * groups.append(factorGroup('g2', 'sum', []))
 * ```
 */
export function createGroupManager(options?: GroupManagerOptions): GroupManagerInterface {
	return new GroupManager(options)
}

/**
 * Create a `FactorManager` — the divergent manager over a group's `factors`,
 * threaded through a required `groupId` locator.
 *
 * @remarks
 * Holds no collection state of its own — it reads and writes factors through
 * the injected sibling {@link GroupManagerInterface}. `on` / `error` — emitter
 * hooks (AGENTS §8 / §13).
 *
 * @param groups - The sibling group manager factors are located within
 * @param options - Optional emitter hooks
 * @returns A {@link FactorManagerInterface}
 *
 * @example
 * ```ts
 * import { createFactorManager, createGroupManager, factorGroup, staticFactor } from '@src/core'
 *
 * const groups = createGroupManager({ groups: [factorGroup('g1', 'sum', [])] })
 * const factors = createFactorManager(groups)
 * factors.append('g1', staticFactor('f1', 10))
 * ```
 */
export function createFactorManager(
	groups: GroupManagerInterface,
	options?: FactorManagerOptions,
): FactorManagerInterface {
	return new FactorManager(groups, options)
}

/**
 * Create a `RuleManager` — a self-owning manager over a logical definition's
 * `rules`.
 *
 * @remarks
 * `rules` — the initial collection (defaults to empty). `on` / `error` —
 * emitter hooks (AGENTS §8 / §13). Rule order is load-bearing.
 *
 * @param options - Optional seed collection and emitter hooks
 * @returns A {@link RuleManagerInterface}
 *
 * @example
 * ```ts
 * import { atom, createRuleManager, rule } from '@src/core'
 *
 * const rules = createRuleManager()
 * rules.append(rule('adult', [atom('age', 'from', 18)], atom('adult', 'equals', true)))
 * ```
 */
export function createRuleManager(options?: RuleManagerOptions): RuleManagerInterface {
	return new RuleManager(options)
}

/**
 * Create an `EquationManager` — a self-owning manager over a symbolic
 * definition's `equations`.
 *
 * @remarks
 * `equations` — the initial collection (defaults to empty). `on` / `error` —
 * emitter hooks (AGENTS §8 / §13). Equation order is strongly load-bearing.
 *
 * @param options - Optional seed collection and emitter hooks
 * @returns An {@link EquationManagerInterface}
 *
 * @example
 * ```ts
 * import { constant, createEquationManager, equation, variable } from '@src/core'
 *
 * const equations = createEquationManager()
 * equations.append(equation('e1', variable('y'), constant(2), 'y'))
 * ```
 */
export function createEquationManager(options?: EquationManagerOptions): EquationManagerInterface {
	return new EquationManager(options)
}

/**
 * Create a `VariableManager` — a self-owning manager over a symbolic
 * definition's `variables` (a name-keyed record; `add` / `remove` only).
 *
 * @remarks
 * `variables` — the initial record (defaults to empty). `on` / `error` —
 * emitter hooks (AGENTS §8 / §13).
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
 * Create a `FactManager` — a self-owning manager over an inferential
 * definition's `facts`.
 *
 * @remarks
 * `facts` — the initial collection (defaults to empty). `on` / `error` —
 * emitter hooks (AGENTS §8 / §13).
 *
 * @param options - Optional seed collection and emitter hooks
 * @returns A {@link FactManagerInterface}
 *
 * @example
 * ```ts
 * import { createFactManager, fact } from '@src/core'
 *
 * const facts = createFactManager()
 * facts.append(fact('f1', 'human', ['socrates']))
 * ```
 */
export function createFactManager(options?: FactManagerOptions): FactManagerInterface {
	return new FactManager(options)
}

/**
 * Create an `InferenceManager` — a self-owning manager over an inferential
 * definition's `inferences`.
 *
 * @remarks
 * `inferences` — the initial collection (defaults to empty). `on` / `error` —
 * emitter hooks (AGENTS §8 / §13). Inference order is load-bearing.
 *
 * @param options - Optional seed collection and emitter hooks
 * @returns An {@link InferenceManagerInterface}
 *
 * @example
 * ```ts
 * import { createInferenceManager, fact, inference } from '@src/core'
 *
 * const inferences = createInferenceManager()
 * inferences.append(inference('m', [fact('p', 'human', ['?x'])], fact('c', 'mortal', ['?x'])))
 * ```
 */
export function createInferenceManager(
	options?: InferenceManagerOptions,
): InferenceManagerInterface {
	return new InferenceManager(options)
}
