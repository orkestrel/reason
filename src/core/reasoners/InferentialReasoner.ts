import type {
	Definition,
	Fact,
	Inference,
	InferentialDefinition,
	InferentialReasonerOptions,
	ProofNode,
	Reasoning,
	ReasonResult,
	ReasonValidationResult,
	ReasonerInterface,
	Subject,
} from '../types.js'
import {
	factToArityKey,
	factToKey,
	findDuplicates,
	findUnboundVariables,
	indexByArity,
	instantiateFact,
	matchFacts,
	roundTo,
	subjectToFacts,
} from '../helpers.js'
import {
	CONFIDENCE_PRECISION,
	DEFAULT_CONFIDENCE,
	DEFAULT_DEPTH,
	INFERENTIAL_ID,
} from '../constants.js'
import { ReasonError } from '../errors.js'

/**
 * The inferential reasoner — fact derivation with unification variables and
 * proof trees.
 *
 * @remarks
 * A string term starting with `?` is a unification variable — matching is
 * positional and BIDIRECTIONAL (variables may sit in facts as well as
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
 * declaration order and RETURNS ON THE FIRST SUCCESS with one derived fact
 * (confidence = the inference's own — premise confidences are NOT propagated)
 * plus its {@link ProofNode} tree; recursion is guarded only by the depth cap.
 * Deriving nothing is still success. Nothing mutates its inputs; fully
 * deterministic (AGENTS §11).
 */
export class InferentialReasoner implements ReasonerInterface {
	readonly #id: string

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
		const errors: string[] = []
		const warnings: string[] = []

		if (definition.reasoning !== 'inferential') {
			errors.push(`Expected reasoning "inferential", got "${definition.reasoning}"`)
			return { valid: false, errors, warnings }
		}

		if (!definition.id) errors.push('Definition must have an id')
		if (!definition.name) errors.push('Definition must have a name')

		// An empty inference set is suspicious but runnable — a WARNING, not an
		// error (unlike the other reasoners' empty collections).
		if (!definition.inferences || definition.inferences.length === 0) {
			warnings.push('Definition has no inference rules')
		}

		// Duplicate ids are WARNINGS — the runtime stays permissive about them.
		for (const id of findDuplicates(definition.inferences ?? [])) {
			warnings.push(`Duplicate inference id "${id}"`)
		}

		// Confidence is a 0–1 multiplicative weight; anything outside is
		// suspicious but runnable — a WARNING, never an error.
		for (const fact of definition.facts ?? []) {
			if (typeof fact !== 'object' || fact === null) continue
			if (fact.confidence !== undefined && !(fact.confidence >= 0 && fact.confidence <= 1)) {
				warnings.push(`Fact "${fact.id}" confidence outside [0, 1]`)
			}
		}

		for (const inference of definition.inferences ?? []) {
			if (typeof inference !== 'object' || inference === null) continue
			if (!inference.id) errors.push('Inference must have an id')
			if (!inference.premises || inference.premises.length === 0) {
				warnings.push(`Inference "${inference.id}" has no premises`)
			}
			if (!inference.conclusion) {
				errors.push(`Inference "${inference.id}" must have a conclusion`)
			}
			if (
				inference.confidence !== undefined &&
				!(inference.confidence >= 0 && inference.confidence <= 1)
			) {
				warnings.push(`Inference "${inference.id}" confidence outside [0, 1]`)
			}
			// Unbound-variable footgun: only meaningful for an enabled,
			// conclusion-bearing inference (a missing conclusion has nothing to check).
			if (inference.enabled !== false && inference.conclusion) {
				for (const name of findUnboundVariables(inference)) {
					warnings.push(
						`Inference "${inference.id}" conclusion variable "${name}" is unbound by all premises`,
					)
				}
			}
		}

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
			!Array.isArray(definition.facts) ||
			!definition.inferences ||
			!Array.isArray(definition.inferences)
		) {
			return {
				reasoning: 'inferential',
				derived: [],
				success: false,
				trace: [],
				errors: ['Definition must have "facts" and "inferences" arrays'],
			}
		}

		const trace: string[] = []
		const errors: string[] = []
		const subjectFacts = subjectToFacts(subject, trace)

		const result =
			definition.strategy === 'backward'
				? this.#backward(definition, subjectFacts, trace, errors)
				: this.#forward(definition, subjectFacts, trace, errors)

		return {
			reasoning: 'inferential',
			derived: result.derived,
			proof: result.proof,
			success: errors.length === 0,
			trace,
			errors,
		}
	}

	// Data-driven fixpoint: derive every consistent unification per iteration,
	// dedupe against known facts, and stop on convergence or the depth cap.
	#forward(
		definition: InferentialDefinition,
		subjectFacts: readonly Fact[],
		trace: string[],
		errors: string[],
	): { derived: Fact[]; proof?: ProofNode } {
		const maxDepth = definition.depth ?? DEFAULT_DEPTH
		const knownFacts: Fact[] = []
		for (const known of [...definition.facts, ...subjectFacts]) {
			if (typeof known !== 'object' || known === null) continue
			knownFacts.push(known)
		}
		const derived: Fact[] = []
		// Dedup via a Set of canonical fact keys maintained ALONGSIDE knownFacts, so
		// membership is O(1) instead of a full linear rescan per candidate. `identities`
		// keys object/function terms by REFERENCE (mirroring equalValues' `===`) so
		// distinct objects never collide; primitives collapse under SameValueZero.
		const identities = new Map<object, number>()
		const seen = new Set<string>()
		for (const known of knownFacts) seen.add(factToKey(known, identities))
		// A predicate+arity index maintained INCREMENTALLY alongside `seen` (seeded
		// from the base facts, appended at every derivation) so the same-predicate
		// join scans never rebuild it per premise. It reflects EVERY fact known so
		// far — including ones derived earlier in THIS pass — preserving the live
		// intra-iteration growth (an early derivation feeds a later inference in the
		// same pass). Arity-refinement only NARROWS each bucket to facts matchFacts
		// would have accepted anyway, so the surviving matches and their append
		// order are identical to a predicate-only index.
		const byArity = indexByArity(knownFacts)

		if (definition.inferences.length === 0) {
			trace.push('No inference rules defined')
			return { derived }
		}

		// Pre-filter: disabled inferences skip silently; a premise-less or
		// conclusion-less inference errors once and is excluded.
		const validInferences: Inference[] = []
		for (const inference of definition.inferences) {
			if (typeof inference !== 'object' || inference === null) continue
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

		for (let iteration = 0; iteration < maxDepth; iteration++) {
			let newDerivation = false

			for (const inference of validInferences) {
				const allBindings = this.#findAllBindings(inference.premises, byArity)

				for (const bindings of allBindings) {
					const conclusion = instantiateFact(inference.conclusion, bindings)
					const premiseConfidence = this.#calculatePremiseConfidence(
						inference.premises,
						byArity,
						bindings,
					)
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
						newDerivation = true
						trace.push(
							`Derived ${derivedFact.predicate}(${derivedFact.terms.join(', ')}) ` +
								`via "${inference.id}" [confidence: ${derivedFact.confidence}] (iteration ${iteration + 1})`,
						)
					}
				}
			}

			if (!newDerivation) {
				trace.push(`Forward chaining converged at iteration ${iteration + 1}`)
				break
			}
		}

		return { derived }
	}

	// Goal-driven: prove each inference's conclusion in declaration order and
	// return on the FIRST success with its proof tree.
	#backward(
		definition: InferentialDefinition,
		subjectFacts: readonly Fact[],
		trace: string[],
		errors: string[],
	): { derived: Fact[]; proof?: ProofNode } {
		const maxDepth = definition.depth ?? DEFAULT_DEPTH
		const derived: Fact[] = []
		const allBaseFacts: Fact[] = []
		for (const known of [...definition.facts, ...subjectFacts]) {
			if (typeof known !== 'object' || known === null) continue
			allBaseFacts.push(known)
		}

		if (definition.inferences.length === 0) {
			trace.push('No inference rules defined')
			return { derived }
		}

		for (const inference of definition.inferences) {
			if (typeof inference !== 'object' || inference === null) continue
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
			)

			if (proof) {
				// Backward confidence is the inference's own — premise confidences
				// are NOT propagated here.
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
	): ProofNode | undefined {
		if (depth > maxDepth) return undefined

		for (const fact of baseFacts) {
			if (matchFacts(goal, fact)) {
				return { fact: fact.id, depth }
			}
		}

		for (const inference of inferences) {
			if (typeof inference !== 'object' || inference === null) continue
			if (inference.enabled === false) continue
			// A candidate whose premises are missing / not an array cannot be
			// walked — skipped SILENTLY (backward's error posture reports only
			// missing conclusions; the forward pre-filter is where premises error).
			if (!inference.premises || !Array.isArray(inference.premises)) continue
			// A conclusion-less candidate has nothing to unify the goal against.
			if (!inference.conclusion) continue

			const conclusionBindings = matchFacts(goal, inference.conclusion)
			if (!conclusionBindings) continue

			const children: ProofNode[] = []
			let allProved = true

			for (const premise of inference.premises) {
				const instantiated = instantiateFact(premise, conclusionBindings)
				const child = this.#prove(instantiated, inferences, baseFacts, depth + 1, maxDepth)
				if (child) {
					children.push(child)
				} else {
					allProved = false
					break
				}
			}

			if (allProved) {
				return { fact: goal.id, inference: inference.id, children, depth }
			}
		}

		return undefined
	}

	// Relational join: thread accumulated bindings through each premise in turn,
	// branching per matching fact; any empty stage short-circuits to none. Reads the
	// LIVE predicate+arity index (maintained by #forward), so each premise scans only
	// its own predicate+arity bucket (append order kept) rather than the whole fact
	// base — matchFacts already rejects a predicate OR arity mismatch, so the matches
	// are identical.
	#findAllBindings(
		premises: readonly Fact[],
		byArity: ReadonlyMap<string, Fact[]>,
	): Record<string, unknown>[] {
		if (premises.length === 0) return [{}]

		let currentBindings: Record<string, unknown>[] = [{}]

		for (const premise of premises) {
			const nextBindings: Record<string, unknown>[] = []
			const candidates = byArity.get(factToArityKey(premise)) ?? []

			for (const existing of currentBindings) {
				const instantiated = instantiateFact(premise, existing)
				for (const fact of candidates) {
					const match = matchFacts(instantiated, fact)
					if (match) nextBindings.push({ ...existing, ...match })
				}
			}

			currentBindings = nextBindings
			if (currentBindings.length === 0) break
		}

		return currentBindings
	}

	// Multiply in the FIRST matching fact's confidence per premise; a premise
	// with no match contributes nothing. Reads the LIVE predicate+arity index
	// (append order kept), so the FIRST bucket match is the same fact the full
	// scan would.
	#calculatePremiseConfidence(
		premises: readonly Fact[],
		byArity: ReadonlyMap<string, Fact[]>,
		bindings: Record<string, unknown>,
	): number {
		let confidence = 1

		for (const premise of premises) {
			const instantiated = instantiateFact(premise, bindings)
			for (const fact of byArity.get(factToArityKey(premise)) ?? []) {
				if (matchFacts(instantiated, fact)) {
					confidence *= fact.confidence ?? DEFAULT_CONFIDENCE
					break
				}
			}
		}

		return confidence
	}
}
