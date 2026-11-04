import type {
	Definition,
	Fact,
	Inference,
	InferentialChainResult,
	InferentialDefinition,
	InferentialReasonerOptions,
	ProofNode,
	Reasoning,
	ReasonResult,
	ReasonValidationResult,
	ReasonerInterface,
	Subject,
} from '../types.js'
import { isArray, isObject, iterateIndices } from '@orkestrel/contract'
import {
	buildRefusedResult,
	computePremiseConfidence,
	factToArityKey,
	factToKey,
	findDuplicates,
	findUnboundVariables,
	indexByArity,
	instantiateFact,
	matchFacts,
	roundTo,
	scanShape,
	subjectToFacts,
} from '../helpers.js'
import {
	CONFIDENCE_PRECISION,
	DEFAULT_CONFIDENCE,
	DEFAULT_DEPTH,
	INFERENTIAL_ID,
} from '../constants.js'
import { ReasonError } from '../errors.js'
import { SubjectDoor } from '../SubjectDoor.js'
import { InferenceJoin } from '../InferenceJoin.js'
import { isFact, isInference, isInferentialDefinition } from '../validators.js'

/**
 * Derives facts with unification variables and proof trees.
 *
 * @remarks
 * A string term starting with `?` is a unification variable — matching is
 * positional and bidirectional (variables may sit in facts as well as
 * patterns), with binding consistency enforced within one match and across
 * premises through pre-instantiation. Scalar subject fields (except `id`;
 * `null` / `undefined` / objects / arrays skipped) inject as
 * `has(key, value)` facts. Forward chaining is a naive fixpoint capped at
 * `depth` iterations: every consistent premise unification derives the
 * instantiated conclusion, with confidence = Π matched premise-fact confidences
 * × the inference's own `confidence`, rounded to four decimal places, and
 * duplicate facts (same predicate, arity, and SameValueZero-equal terms — a
 * NaN term derives once and converges) are never re-derived. Backward chaining
 * proves each inference's conclusion in
 * declaration order and returns on the first success with one derived fact
 * (confidence = the inference's own — premise confidences are not propagated)
 * plus its {@link ProofNode} tree; recursion is guarded only by the depth cap.
 * Deriving nothing is still success. Nothing mutates its inputs; fully
 * deterministic.
 *
 * @example
 * ```ts
 * import {
 * 	createFact,
 * 	createInference,
 * 	createInferentialDefinition,
 * 	createInferentialReasoner,
 * } from '@orkestrel/reason'
 *
 * const reasoner = createInferentialReasoner()
 * const definition = createInferentialDefinition(
 * 	'mortality',
 * 	'Mortality',
 * 	[createFact('f1', 'human', ['socrates'])],
 * 	[
 * 		createInference(
 * 			'mortal',
 * 			[createFact('p1', 'human', ['?x'])],
 * 			createFact('c1', 'mortal', ['?x']),
 * 		),
 * 	],
 * )
 * reasoner.supports(definition) // true
 * reasoner.validate(definition).valid // true
 * const result = reasoner.reason({}, definition)
 * if (result.reasoning === 'inferential') result.derived[0]?.terms // ['socrates']
 * ```
 */
export class InferentialReasoner implements ReasonerInterface {
	readonly #id: string

	readonly #door = new SubjectDoor()

	constructor(options?: InferentialReasonerOptions) {
		this.#id = options?.id ?? INFERENTIAL_ID
	}

	get id(): string {
		return this.#id
	}

	get reasoning(): Reasoning {
		return 'inferential'
	}

	supports(definition: Definition): boolean {
		return definition.reasoning === 'inferential'
	}

	validate(definition: Definition): ReasonValidationResult {
		if (definition.reasoning !== 'inferential') {
			return {
				valid: false,
				errors: [`Expected reasoning "inferential", got "${definition.reasoning}"`],
				warnings: [],
			}
		}
		const facts: unknown = definition.facts
		const inferences: unknown = definition.inferences
		if (!isInferentialDefinition(definition)) {
			const factEntries: readonly unknown[] = isArray(facts) ? facts : []
			const inferenceEntries: readonly unknown[] = isArray(inferences) ? inferences : []
			return {
				valid: false,
				errors: [
					'Definition does not match the inferential definition shape',
					...factEntries.flatMap((fact, index) =>
						isFact(fact) ? [] : [`Fact at index ${String(index)} is malformed`],
					),
					...inferenceEntries.flatMap((inference, index) =>
						isInference(inference) ? [] : [`Inference at index ${String(index)} is malformed`],
					),
				],
				warnings: [],
			}
		}
		const errors = [
			...(definition.id ? [] : ['Definition must have an id']),
			...(definition.name ? [] : ['Definition must have a name']),
			...findDuplicates(definition.inferences).map((id) => `Duplicate inference id "${id}"`),
			...findDuplicates(definition.facts).map((id) => `Duplicate fact id "${id}"`),
			// Confidence is a 0–1 multiplicative weight; a value outside it means nothing.
			...definition.facts.flatMap((fact) =>
				fact.confidence !== undefined && !(fact.confidence >= 0 && fact.confidence <= 1)
					? [`Fact "${fact.id}" confidence outside [0, 1]`]
					: [],
			),
			...definition.inferences.flatMap((inference) => [
				...(inference.id ? [] : ['Inference must have an id']),
				...(inference.confidence !== undefined &&
				!(inference.confidence >= 0 && inference.confidence <= 1)
					? [`Inference "${inference.id}" confidence outside [0, 1]`]
					: []),
			]),
			...(definition.shape === undefined ? [] : scanShape(definition.shape)),
		]
		const warnings = [
			// An empty inference set is suspicious but runnable, and deriving nothing claims nothing.
			...(definition.inferences.length === 0 ? ['Definition has no inference rules'] : []),
			...definition.inferences.flatMap((inference) => [
				...(inference.premises.length === 0 ? [`Inference "${inference.id}" has no premises`] : []),
				// Unbound-variable footgun: only meaningful for an enabled inference.
				...(inference.enabled === false
					? []
					: findUnboundVariables(inference).map(
							(name) =>
								`Inference "${inference.id}" conclusion variable "${name}" is unbound by all premises`,
						)),
			]),
		]
		return { valid: errors.length === 0, errors, warnings }
	}

	reason(subject: Subject, definition: Definition): ReasonResult {
		if (definition.reasoning !== 'inferential') {
			throw new ReasonError(
				'MISMATCH',
				`Expected inferential definition, got "${definition.reasoning}"`,
				{ definition: definition.id, reasoning: this.reasoning },
			)
		}

		// Runtime never assumes validate() ran — a malformed shape is a failure
		// result, not a throw.
		if (
			!definition.facts ||
			!isArray(definition.facts) ||
			!definition.inferences ||
			!isArray(definition.inferences)
		) {
			return {
				reasoning: 'inferential',
				derived: [],
				success: false,
				trace: [],
				errors: ['Definition must have "facts" and "inferences" arrays'],
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
		const injected = subjectToFacts(admitted)
		trace.push(...injected.trace)

		const result =
			definition.strategy === 'backward'
				? this.#backward(definition, injected.facts, trace, errors)
				: this.#forward(definition, injected.facts, trace, errors)

		return {
			reasoning: 'inferential',
			derived: result.derived,
			...(result.proof === undefined ? {} : { proof: result.proof }),
			success: errors.length === 0,
			trace,
			errors,
			faults: [],
			repairs: admission.repairs,
			defaulted: admission.defaulted,
		}
	}

	// Data-driven fixpoint: derive every consistent unification per iteration,
	// dedupe against known facts, and stop on convergence or the depth cap.
	#forward(
		definition: InferentialDefinition,
		subjectFacts: readonly Fact[],
		trace: string[],
		errors: string[],
	): InferentialChainResult {
		const maxDepth = definition.depth ?? DEFAULT_DEPTH
		const knownFacts: Fact[] = []
		for (const [index, known] of [...definition.facts, ...subjectFacts].entries()) {
			if (!isObject(known)) {
				errors.push(`Fact at index ${String(index)} is malformed`)
				continue
			}
			knownFacts.push(known)
		}
		const derived: Fact[] = []
		// Dedup through a Set of canonical fact keys maintained alongside
		// knownFacts, so membership is O(1) instead of a full linear rescan per
		// candidate. `identities` keys object/function terms by reference (mirroring
		// equalValues' `===`) so distinct objects never collide; primitives collapse
		// under SameValueZero.
		const identities = new Map<object, number>()
		const seen = new Set<string>()
		for (const known of knownFacts) seen.add(factToKey(known, identities))
		// A predicate+arity index maintained incrementally alongside `seen` (seeded
		// from the base facts, appended at every derivation) so the same-predicate
		// join scans never rebuild it per premise. It reflects every fact known so
		// far — including ones derived earlier in this pass — preserving the live
		// intra-iteration growth (an early derivation feeds a later inference in the
		// same pass). Arity-refinement only narrows each bucket to facts matchFacts
		// would have accepted anyway, so the surviving matches and their append
		// order are identical to a predicate-only index. `indexByArity` publishes a
		// readonly index, so the pass copies each bucket into state it owns before
		// appending to it.
		const byArity = new Map<string, Fact[]>()
		for (const [key, bucket] of indexByArity(knownFacts)) byArity.set(key, [...bucket])

		if (definition.inferences.length === 0) {
			trace.push('No inference rules defined')
			return { derived }
		}

		// Pre-filter: disabled inferences skip silently; a premise-less or
		// conclusion-less inference errors once and is excluded.
		const validInferences: Inference[] = []
		for (const [index, inference] of definition.inferences.entries()) {
			if (!isObject(inference)) {
				errors.push(`Inference at index ${String(index)} is malformed`)
				continue
			}
			if (inference.enabled === false) continue
			if (!inference.premises || inference.premises.length === 0) {
				errors.push(`Inference "${inference.id}" has no premises — skipped`)
				continue
			}
			if (!inference.conclusion) {
				errors.push(`Inference "${inference.id}" has no conclusion — skipped`)
				continue
			}
			validInferences.push(inference)
		}

		for (const iteration of iterateIndices(() => maxDepth)) {
			const changed = validInferences.reduce((previous, inference) => {
				const allBindings = new InferenceJoin(byArity).resolve(inference.premises)

				return allBindings.reduce((updated, bindings) => {
					const conclusion = instantiateFact(inference.conclusion, bindings)
					const premiseConfidence = computePremiseConfidence(inference.premises, byArity, bindings)
					const inferenceConfidence = inference.confidence ?? DEFAULT_CONFIDENCE
					const finalConfidence = premiseConfidence * inferenceConfidence

					const derivedFact: Fact = {
						...conclusion,
						confidence: roundTo(finalConfidence, CONFIDENCE_PRECISION),
					}

					const key = factToKey(derivedFact, identities)
					if (!seen.has(key)) {
						knownFacts.push(derivedFact)
						// Mirror the push into the live index (same order) so later premises
						// in this very pass can join against the freshly derived fact.
						const arityKey = factToArityKey(derivedFact)
						const bucket = byArity.get(arityKey)
						if (bucket) bucket.push(derivedFact)
						else byArity.set(arityKey, [derivedFact])
						seen.add(key)
						derived.push(derivedFact)
						trace.push(
							`Derived ${derivedFact.predicate}(${derivedFact.terms.join(', ')}) ` +
								`through "${inference.id}" [confidence: ${derivedFact.confidence}] (iteration ${iteration + 1})`,
						)
						return true
					}
					return updated
				}, previous)
			}, false)

			if (!changed) {
				trace.push(`Forward chaining converged at iteration ${iteration + 1}`)
				return { derived }
			}
		}

		errors.push(`Forward chaining did not settle within depth ${String(maxDepth)}`)
		return { derived }
	}

	// Goal-driven: prove each inference's conclusion in declaration order and
	// return on the first success with its proof tree.
	#backward(
		definition: InferentialDefinition,
		subjectFacts: readonly Fact[],
		trace: string[],
		errors: string[],
	): InferentialChainResult {
		const maxDepth = definition.depth ?? DEFAULT_DEPTH
		const derived: Fact[] = []
		const capped: string[] = []
		const allBaseFacts: Fact[] = []
		for (const [index, known] of [...definition.facts, ...subjectFacts].entries()) {
			if (!isObject(known)) {
				errors.push(`Fact at index ${String(index)} is malformed`)
				continue
			}
			allBaseFacts.push(known)
		}

		if (definition.inferences.length === 0) {
			trace.push('No inference rules defined')
			return { derived }
		}

		for (const [index, inference] of definition.inferences.entries()) {
			if (!isObject(inference)) {
				errors.push(`Inference at index ${String(index)} is malformed`)
				continue
			}
			if (inference.enabled === false) continue

			if (!inference.conclusion) {
				errors.push(`Inference "${inference.id}" has no conclusion — skipped`)
				continue
			}

			const proof = this.#prove(
				inference.conclusion,
				definition.inferences,
				allBaseFacts,
				0,
				maxDepth,
				capped,
			)

			if (proof) {
				// Backward confidence is the inference's own — premise confidences
				// are not propagated here.
				const derivedFact: Fact = {
					...inference.conclusion,
					confidence: inference.confidence ?? DEFAULT_CONFIDENCE,
				}
				derived.push(derivedFact)
				trace.push(
					`Proved ${inference.conclusion.predicate}(${inference.conclusion.terms.join(', ')})`,
				)
				return { derived, proof }
			}
		}

		// A search the cap cut short has no answer, unless another path already proved the goal.
		errors.push(...capped)
		return { derived }
	}

	// A goal proves as a base-fact leaf, or through an inference whose conclusion
	// unifies and whose premises all prove at depth + 1. No memoization; the
	// depth cap is the only recursion guard.
	#prove(
		goal: Fact,
		inferences: readonly Inference[],
		baseFacts: readonly Fact[],
		depth: number,
		maxDepth: number,
		capped: string[],
	): ProofNode | undefined {
		if (depth > maxDepth) {
			const message = `Backward proving hit depth ${String(maxDepth)}`
			if (!capped.includes(message)) capped.push(message)
			return undefined
		}

		for (const fact of baseFacts) {
			if (matchFacts(goal, fact)) {
				return { fact: fact.id, depth }
			}
		}

		for (const inference of inferences) {
			if (!isObject(inference)) continue
			if (inference.enabled === false) continue
			// A candidate whose premises are missing / not an array cannot be
			// walked — skipped silently (backward's error posture reports only
			// missing conclusions; the forward pre-filter is where premises error).
			if (!isArray(inference.premises)) continue
			// A conclusion-less candidate has nothing to unify the goal against.
			if (!inference.conclusion) continue

			const conclusionBindings = matchFacts(goal, inference.conclusion)
			if (!conclusionBindings) continue

			const children: ProofNode[] = []
			const allProved = Iterator.from(inference.premises).every((premise) => {
				const instantiated = instantiateFact(premise, conclusionBindings)
				const child = this.#prove(instantiated, inferences, baseFacts, depth + 1, maxDepth, capped)
				if (child) {
					children.push(child)
					return true
				}
				return false
			})

			if (allProved) {
				return { fact: goal.id, inference: inference.id, children, depth }
			}
		}

		return undefined
	}
}
