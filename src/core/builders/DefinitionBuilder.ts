import type { EmitterInterface } from '../../emitters/index.js'
import type {
	Definition,
	DefinitionBuilderEventMap,
	DefinitionBuilderInterface,
	DefinitionBuilderOptions,
	EquationManagerInterface,
	FactManagerInterface,
	FactorManagerInterface,
	GroupManagerInterface,
	InferenceManagerInterface,
	InferentialDefinition,
	LogicalDefinition,
	QuantitativeDefinition,
	Reasoning,
	RuleManagerInterface,
	SymbolicDefinition,
	VariableManagerInterface,
} from '../types.js'
import { Emitter } from '../../emitters/index.js'
import {
	clearInferentialDefinition,
	clearLogicalDefinition,
	clearQuantitativeDefinition,
	clearSymbolicDefinition,
	mergeInferentialDefinition,
	mergeLogicalDefinition,
	mergeQuantitativeDefinition,
	mergeSymbolicDefinition,
} from '../helpers.js'
import { DEFINITION_BUILDER_BRAND } from '../constants.js'
import { ReasonError } from '../errors.js'
import { EquationManager } from './managers/EquationManager.js'
import { FactManager } from './managers/FactManager.js'
import { FactorManager } from './managers/FactorManager.js'
import { GroupManager } from './managers/GroupManager.js'
import { InferenceManager } from './managers/InferenceManager.js'
import { RuleManager } from './managers/RuleManager.js'
import { VariableManager } from './managers/VariableManager.js'

// The scalar-only projection of each definition kind — the builder's private
// envelope holds the non-collection fields; `build()` re-composes the kind's
// collections from the managers' plural accessors.
type DefinitionEnvelope =
	| Omit<QuantitativeDefinition, 'groups'>
	| Omit<LogicalDefinition, 'rules'>
	| Omit<SymbolicDefinition, 'equations' | 'variables'>
	| Omit<InferentialDefinition, 'facts' | 'inferences'>

/**
 * A stateful workspace builder accumulating a {@link Definition} through seven
 * always-present self-owning manager properties, shaped like `AgentContext`
 * (AGENTS §4.2.2): a private SCALAR ENVELOPE (reasoning / id / name plus the
 * kind's scalars) composed with each collection read from its manager.
 *
 * @remarks
 * Each manager is BRING-YOUR-OWN (a supplied one is reused) or a fresh one
 * seeded from the seed's matching collection (empty for off-kind collections).
 * Managers are KIND-FREE — an off-kind manager is simply ignored by `build()`,
 * never a `MISMATCH`. `build()` is TOTAL, deterministic, and returns a FRESH
 * plain {@link Definition} each call. `merge(incoming)` requires the SAME
 * `reasoning` (else `MISMATCH`) and distributes incoming scalars into the
 * envelope and collections into the managers via the matching `merge*` helper.
 * `clear(key)` deletes one optional field of the envelope for the instance's
 * `reasoning` (a non-clearable key throws `MISMATCH`). `destroy()` cascades to
 * all seven managers, emits `destroy`, then tears the builder emitter down LAST
 * (AGENTS §13); it is idempotent, and post-destroy mutation / build throws
 * `ReasonError('DESTROYED', …)`.
 */
export class DefinitionBuilder implements DefinitionBuilderInterface {
	readonly [DEFINITION_BUILDER_BRAND]: true = true
	readonly #id: string
	readonly #emitter: Emitter<DefinitionBuilderEventMap>
	readonly groups: GroupManagerInterface
	readonly factors: FactorManagerInterface
	readonly rules: RuleManagerInterface
	readonly equations: EquationManagerInterface
	readonly variables: VariableManagerInterface
	readonly facts: FactManagerInterface
	readonly inferences: InferenceManagerInterface
	#envelope: DefinitionEnvelope
	#destroyed = false

	constructor(seed: Definition, options?: DefinitionBuilderOptions) {
		this.#id = options?.id ?? seed.id
		const seeded: Definition = { ...seed, id: this.#id }
		this.#envelope = this.#strip(seeded)
		this.#emitter = new Emitter<DefinitionBuilderEventMap>({
			on: options?.on,
			error: options?.error,
		})

		this.groups =
			options?.groups ??
			new GroupManager({ groups: seeded.reasoning === 'quantitative' ? seeded.groups : [] })
		this.factors = options?.factors ?? new FactorManager(this.groups)
		this.rules =
			options?.rules ??
			new RuleManager({ rules: seeded.reasoning === 'logical' ? seeded.rules : [] })
		this.equations =
			options?.equations ??
			new EquationManager({ equations: seeded.reasoning === 'symbolic' ? seeded.equations : [] })
		this.variables =
			options?.variables ??
			new VariableManager({ variables: seeded.reasoning === 'symbolic' ? seeded.variables : {} })
		this.facts =
			options?.facts ??
			new FactManager({ facts: seeded.reasoning === 'inferential' ? seeded.facts : [] })
		this.inferences =
			options?.inferences ??
			new InferenceManager({
				inferences: seeded.reasoning === 'inferential' ? seeded.inferences : [],
			})
	}

	get id(): string {
		return this.#id
	}

	get reasoning(): Reasoning {
		return this.#envelope.reasoning
	}

	get emitter(): EmitterInterface<DefinitionBuilderEventMap> {
		return this.#emitter
	}

	build(): Definition {
		this.#ensureAlive()
		return this.#compose()
	}

	merge(incoming: Definition): void {
		this.#ensureAlive()
		const current = this.#compose()
		if (current.reasoning !== incoming.reasoning) {
			throw new ReasonError(
				'MISMATCH',
				`Expected "${current.reasoning}" definition, got "${incoming.reasoning}"`,
				{ definition: this.#id, reasoning: current.reasoning },
			)
		}
		let merged: Definition
		if (current.reasoning === 'quantitative' && incoming.reasoning === 'quantitative') {
			merged = mergeQuantitativeDefinition(current, incoming)
		} else if (current.reasoning === 'logical' && incoming.reasoning === 'logical') {
			merged = mergeLogicalDefinition(current, incoming)
		} else if (current.reasoning === 'symbolic' && incoming.reasoning === 'symbolic') {
			merged = mergeSymbolicDefinition(current, incoming)
		} else if (current.reasoning === 'inferential' && incoming.reasoning === 'inferential') {
			merged = mergeInferentialDefinition(current, incoming)
		} else {
			merged = current
		}
		this.#seat(merged)
		this.#emitter.emit('merge', merged.reasoning)
	}

	clear(key: string): void {
		this.#ensureAlive()
		const current = this.#compose()
		let next: Definition
		if (current.reasoning === 'quantitative' && this.#isQuantitativeClearKey(key)) {
			next = clearQuantitativeDefinition(current, key)
		} else if (current.reasoning === 'logical' && this.#isLogicalClearKey(key)) {
			next = clearLogicalDefinition(current, key)
		} else if (current.reasoning === 'symbolic' && this.#isSymbolicClearKey(key)) {
			next = clearSymbolicDefinition(current, key)
		} else if (current.reasoning === 'inferential' && this.#isInferentialClearKey(key)) {
			next = clearInferentialDefinition(current, key)
		} else {
			throw new ReasonError(
				'MISMATCH',
				`"${key}" is not a clearable field for reasoning "${current.reasoning}"`,
				{ key, reasoning: current.reasoning },
			)
		}
		this.#envelope = this.#strip(next)
		this.#emitter.emit('clear', key)
	}

	destroy(): void {
		// Cascade to every manager first (each idempotent, emitter LAST), then the
		// builder's own destroy emit, then its emitter LAST — idempotent overall.
		this.groups.destroy()
		this.factors.destroy()
		this.rules.destroy()
		this.equations.destroy()
		this.variables.destroy()
		this.facts.destroy()
		this.inferences.destroy()
		this.#destroyed = true
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	// Compose the current plain definition from the scalar envelope and the
	// kind's collections (off-kind managers ignored) — the `build()` body sans
	// the alive guard, reused by `merge` / `clear`.
	#compose(): Definition {
		const envelope = this.#envelope
		switch (envelope.reasoning) {
			case 'quantitative':
				return { ...envelope, groups: this.groups.groups() }
			case 'logical':
				return { ...envelope, rules: this.rules.rules() }
			case 'symbolic':
				return {
					...envelope,
					equations: this.equations.equations(),
					variables: this.variables.variables(),
				}
			case 'inferential':
				return {
					...envelope,
					facts: this.facts.facts(),
					inferences: this.inferences.inferences(),
				}
		}
	}

	// Distribute a whole definition back into the envelope + managers: the
	// scalars strip into the envelope, the kind's collections re-seat wholesale
	// through the managers' silent `collection` setters (no per-element events).
	#seat(definition: Definition): void {
		switch (definition.reasoning) {
			case 'quantitative':
				this.groups.collection = definition.groups
				break
			case 'logical':
				this.rules.collection = definition.rules
				break
			case 'symbolic':
				this.equations.collection = definition.equations
				this.variables.collection = definition.variables
				break
			case 'inferential':
				this.facts.collection = definition.facts
				this.inferences.collection = definition.inferences
				break
		}
		this.#envelope = this.#strip(definition)
	}

	// Project a definition to its scalar envelope — the collections drop out
	// (rest-sibling omission), leaving reasoning / id / name + the kind's scalars.
	#strip(definition: Definition): DefinitionEnvelope {
		switch (definition.reasoning) {
			case 'quantitative': {
				const { groups, ...rest } = definition
				return rest
			}
			case 'logical': {
				const { rules, ...rest } = definition
				return rest
			}
			case 'symbolic': {
				const { equations, variables, ...rest } = definition
				return rest
			}
			case 'inferential': {
				const { facts, inferences, ...rest } = definition
				return rest
			}
		}
	}

	#ensureAlive(): void {
		if (this.#destroyed) {
			throw new ReasonError('DESTROYED', 'DefinitionBuilder has been destroyed')
		}
	}

	#isQuantitativeClearKey(key: string): key is 'description' | 'base' | 'bounds' | 'precision' {
		return key === 'description' || key === 'base' || key === 'bounds' || key === 'precision'
	}

	#isLogicalClearKey(key: string): key is 'description' | 'depth' {
		return key === 'description' || key === 'depth'
	}

	#isSymbolicClearKey(key: string): key is 'description' | 'precision' {
		return key === 'description' || key === 'precision'
	}

	#isInferentialClearKey(key: string): key is 'description' | 'depth' {
		return key === 'description' || key === 'depth'
	}
}
