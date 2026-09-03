import type {
	Aggregation,
	Atom,
	Bounds,
	Definition,
	DefinitionEnvelope,
	Equation,
	Expression,
	Fact,
	Factor,
	FactorGroup,
	Inference,
	InferentialClearKey,
	InferentialDefinition,
	LogicalClearKey,
	LogicalDefinition,
	MathOperation,
	QuantitativeClearKey,
	QuantitativeDefinition,
	ReasonResult,
	Rule,
	Source,
	Subject,
	SymbolicClearKey,
	SymbolicDefinition,
	SymbolicExpression,
} from './types.js'
import type { FieldPath } from '@orkestrel/contract'
import { isArray, isNumber, isString, parseNumberField, resolveField } from '@orkestrel/contract'
import { DEFAULT_CONFIDENCE, DEFAULT_PRIORITY } from './constants.js'
import { ReasonError } from './errors.js'

// The module's pure leaves: field display, the numeric helpers, equality and
// ordering, the inferential fact machinery, the symbolic algebra machinery, the
// id-keyed collection primitives, and the copy-on-write change / extend / merge
// / clear family over definitions and subjects. Every function here is
// referentially transparent — it returns a fresh, JSON-serializable value and
// touches no input — with one deliberate exception: `termToKey` and `factToKey`
// thread a caller-created `identities` ledger and REGISTER each newly seen
// object term in it, because reference identity has to survive across every
// call of one dedupe pass. The value constructors that assemble that vocabulary
// live in `factories.ts` under the `create*` form.

// === Field display

/**
 * Formats a {@link FieldPath} for display — the single string key itself, or the
 * array segments joined with `.`.
 *
 * @remarks
 * Display-only: the joined form is how a field appears in traces and derived
 * overlays; it is NOT re-parsed into a path (a string stays ONE key).
 *
 * @param field - The field path to format
 * @returns The display string
 *
 * @example
 * ```ts
 * formatField('age')               // 'age'
 * formatField(['address', 'city']) // 'address.city'
 * ```
 */
export function formatField(field: FieldPath): string {
	return isString(field) ? field : field.join('.')
}

// === Numeric helpers

/**
 * Clamps a number to inclusive {@link Bounds}.
 *
 * @remarks
 * An absent bound (or absent `bounds` entirely) never constrains that side.
 * `NaN` flows through unchanged (every comparison with `NaN` is false).
 *
 * @param value - The number to clamp
 * @param limit - The inclusive bounds (either side optional)
 * @returns The clamped number
 *
 * @example
 * ```ts
 * import { clamp } from '@src/core'
 *
 * clamp(150, { minimum: 0, maximum: 100 }) // 100
 * clamp(150)                               // 150 — unbounded
 * ```
 */
export function clamp(value: number, limit?: Bounds): number {
	if (!limit) return value
	let result = value
	if (limit.minimum !== undefined && result < limit.minimum) result = limit.minimum
	if (limit.maximum !== undefined && result > limit.maximum) result = limit.maximum
	return result
}

/**
 * Checks whether a value falls inside an inclusive range expressed as an array.
 *
 * @remarks
 * The range test behind the `between` and `outside` `Comparison` operators: only
 * the FIRST TWO elements of `range` are read, both ends are inclusive, and a
 * non-numeric `value`, a non-array `range`, a `range` shorter than two
 * elements, or a non-numeric bound all report `false`. `outside` is the pure
 * negation of this predicate, so a malformed range reads as outside.
 *
 * @param value - The resolved subject value to test
 * @param range - The expected range (its first two elements are the inclusive bounds)
 * @returns True if `value` is a number within the inclusive range; false otherwise
 *
 * @example
 * ```ts
 * import { matchesBounds } from '@src/core'
 *
 * matchesBounds(5, [1, 10]) // true — inclusive on both ends
 * matchesBounds(5, [1])     // false — a malformed range is never within
 * ```
 */
export function matchesBounds(value: unknown, range: unknown): boolean {
	if (!isNumber(value)) return false
	if (!isArray(range) || range.length < 2) return false
	const minimum = range[0]
	const maximum = range[1]
	if (!isNumber(minimum) || !isNumber(maximum)) return false
	return value >= minimum && value <= maximum
}

/**
 * Returns the empty-input identity of one {@link Aggregation}.
 *
 * @remarks
 * The aggregator's "no data" answers: `sum` and `average` reduce to `0`,
 * `product` to `1`, and `minimum` / `maximum` to `NaN` — a deliberate signal
 * the quantitative reasoner surfaces as a non-finite-value error rather than a
 * silent success. An unknown aggregation from an untrusted definition is `0`.
 *
 * @param aggregation - The aggregation whose identity is wanted
 * @returns The value the aggregation yields over zero inputs
 *
 * @example
 * ```ts
 * import { emptyAggregate } from '@src/core'
 *
 * emptyAggregate('sum')     // 0
 * emptyAggregate('product') // 1
 * emptyAggregate('minimum') // NaN — the "no data" signal
 * ```
 */
export function emptyAggregate(aggregation: Aggregation): number {
	switch (aggregation) {
		case 'sum':
		case 'average':
			return 0
		case 'product':
			return 1
		case 'minimum':
		case 'maximum':
			return Number.NaN
		default:
			return 0
	}
}

/**
 * Resolves one {@link Source} against a subject, falling back when it cannot.
 *
 * @remarks
 * The source-resolution leaf of the quantitative factor pipeline. A `static`
 * source passes its value through; `field` and `range` coerce through the
 * contracts `parseNumberField`, so a non-finite subject number or a
 * non-numeric string is unresolvable and takes `fallback`; `lookup` reads only
 * OWN table keys, and a missing or `null` field takes `fallback` directly
 * rather than letting a `''` key intercept absent data. A `range` scans its
 * bands in order and the FIRST match wins — a band without `bounds` is a
 * catch-all and an absent bound side is open. A malformed factor carrying no
 * source at all takes `fallback` rather than crashing.
 *
 * @param source - The factor source to resolve
 * @param subject - The subject to read from
 * @param fallback - The value taken when the source does not resolve
 * @returns The resolved number, the `fallback`, or `undefined` when neither exists
 *
 * @example
 * ```ts
 * import { createFieldSource, createLookupSource, resolveSource } from '@src/core'
 *
 * resolveSource(createFieldSource('age'), { age: 30 })                      // 30
 * resolveSource(createLookupSource('state', { CA: 5 }), { state: 'NY' }, 1) // 1 — fallback
 * ```
 */
export function resolveSource(
	source: Source,
	subject: Subject,
	fallback?: number,
): number | undefined {
	// A malformed factor may carry no source at all — the fallback path, not a crash.
	if (!source) return fallback
	switch (source.origin) {
		case 'static':
			return source.value
		case 'field':
			return parseNumberField(subject, source.field) ?? fallback
		case 'lookup': {
			const resolved = resolveField(subject, source.field)
			// A missing / null field never reaches the table (a '' key must not
			// intercept absent data); a PRESENT value still stringifies, so a
			// real '' value may hit a '' key.
			if (resolved === undefined || resolved === null) return fallback
			const key = String(resolved)
			return Object.hasOwn(source.table, key) ? source.table[key] : fallback
		}
		case 'range': {
			const value = parseNumberField(subject, source.field)
			if (value === undefined) return fallback
			for (const range of source.ranges) {
				if (typeof range !== 'object' || range === null) continue
				const limit = range.bounds
				// A band without bounds is a catch-all; an absent side is open.
				if (!limit) return range.value
				const aboveMinimum = limit.minimum === undefined || value >= limit.minimum
				const belowMaximum = limit.maximum === undefined || value <= limit.maximum
				if (aboveMinimum && belowMaximum) return range.value
			}
			return fallback
		}
		default:
			return fallback
	}
}

/**
 * Rounds a number to a fixed count of decimal places.
 *
 * @remarks
 * `Math.round` semantics — halves round toward `+∞` (`2.5` → `3`, `-2.5` → `-2`).
 * A negative precision rounds at whole-number scales (`-1` → tens, `-2` →
 * hundreds). An EXTREME precision whose scale factor overflows the double range
 * (`10^p` → `Infinity` at roughly `p > 308`, `0` at roughly `p < -323`) returns
 * the value UNCHANGED — passthrough, never `NaN`.
 *
 * @param value - The number to round
 * @param precision - Decimal places to keep (defaults to `0`)
 * @returns The rounded number
 *
 * @example
 * ```ts
 * import { roundTo } from '@src/core'
 *
 * roundTo(3.14159, 2) // 3.14
 * roundTo(2.5)        // 3
 * roundTo(1250, -2)   // 1300 — tens/hundreds scales
 * roundTo(1.5, 400)   // 1.5 — overflow passthrough
 * ```
 */
export function roundTo(value: number, precision = 0): number {
	const factor = Math.pow(10, precision)
	// An overflowed scale factor (Infinity / 0) would turn every value into NaN —
	// rounding is meaningless there, so the value passes through unchanged.
	if (!Number.isFinite(factor) || factor === 0) return value
	return Math.round(value * factor) / factor
}

// === Equality, ordering & uniqueness

/**
 * Determines whether two values are SameValueZero-equal — strict `===` with
 * `NaN` equal to itself (and, unlike `Object.is`, `+0` equal to `-0`).
 *
 * @remarks
 * This is the derivation-bookkeeping equality of the chaining reasoners: the
 * logical overlay and the inferential fact-dedupe compare with it so a
 * NaN-valued conclusion or fact term derives exactly ONCE and the fixpoint
 * converges (raw `===` would re-derive it every iteration, never converging).
 * It matches `Array.prototype.includes` semantics — the same membership test
 * the `any` / `none` comparisons use.
 *
 * @param left - The first value
 * @param right - The second value
 * @returns True if the values are SameValueZero-equal; false otherwise
 *
 * @example
 * ```ts
 * import { equalValues } from '@src/core'
 *
 * equalValues(Number.NaN, Number.NaN) // true — unlike ===
 * equalValues(0, -0)                  // true — unlike Object.is
 * equalValues(1, '1')                 // false — no coercion
 * ```
 */
export function equalValues(left: unknown, right: unknown): boolean {
	return left === right || (left !== left && right !== right)
}

/**
 * Sorts items ascending by `priority ?? DEFAULT_PRIORITY` — a stable copy sort.
 *
 * @remarks
 * The shared evaluation-order helper of the quantitative (factors) and logical
 * (rules) reasoners: lower priorities run first, an absent `priority` defaults
 * to `0`, equal priorities keep DECLARATION order (stable), and the input array
 * is never mutated. An array hole, `null`, or other non-record entry is dropped
 * rather than sorted — the output may be shorter than the input.
 *
 * @param items - The priority-carrying items to order
 * @returns A fresh array, sorted ascending by priority
 *
 * @example
 * ```ts
 * import { sortByPriority } from '@src/core'
 *
 * sortByPriority([{ priority: 5 }, {}, { priority: -1 }])
 * // [{ priority: -1 }, {}, { priority: 5 }] — default 0 sits between
 * ```
 */
export function sortByPriority<T extends { readonly priority?: number }>(
	items: readonly T[],
): readonly T[] {
	const usable: T[] = []
	for (const item of items) {
		if (typeof item !== 'object' || item === null) continue
		usable.push(item)
	}
	return usable.sort(
		(left, right) => (left.priority ?? DEFAULT_PRIORITY) - (right.priority ?? DEFAULT_PRIORITY),
	)
}

/**
 * Collects the ids that appear MORE THAN ONCE in an id-carrying list — each
 * duplicated id reported once, in first-occurrence order.
 *
 * @remarks
 * The shared uniqueness scan behind every reasoner's `validate()` duplicate-id
 * WARNINGS (rules, groups, factors, equations, inferences). Runtime stays
 * permissive about duplicates (first/last-wins artifacts) — this helper only
 * surfaces them.
 *
 * @param items - The id-carrying items to scan
 * @returns The duplicated ids, once each
 *
 * @example
 * ```ts
 * import { findDuplicates } from '@src/core'
 *
 * findDuplicates([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'a' }]) // ['a']
 * ```
 */
export function findDuplicates(items: ReadonlyArray<{ readonly id: string }>): readonly string[] {
	const counts = new Map<string, number>()
	for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
	return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id)
}

// === Inferential fact machinery

/**
 * Derives a fact's predicate+arity bucket key — length-prefixed so the
 * delimiter cannot be forged.
 *
 * @remarks
 * Keys both stored facts and premise patterns (both are `Fact`-shaped) for
 * {@link indexByArity}: `matchFacts` already rejects an arity mismatch, so
 * narrowing a same-predicate bucket to same-predicate-AND-same-arity only
 * excludes candidates that could never unify anyway. Only `predicate` — the
 * one free-form, adversary-controlled part — is length-prefixed
 * (`length + ':' + predicate`), mirroring {@link factToKey}'s framing so a
 * predicate string embedding the `' '` delimiter can never be mistaken for a
 * different predicate+arity pairing; `terms.length` is always a plain
 * non-negative integer (never itself contains a space) so it needs no prefix.
 *
 * @param fact - The fact (or premise pattern) to key
 * @returns The predicate+arity key string
 *
 * @example
 * ```ts
 * import { createFact, factToArityKey } from '@src/core'
 *
 * factToArityKey(createFact('a', 'human', ['x']))      // arity 1
 * factToArityKey(createFact('b', 'human', ['x', 'y'])) // arity 2 — distinct key
 * ```
 */
export function factToArityKey(fact: Fact): string {
	const p = fact.predicate
	return `${p.length}:${p} ${fact.terms.length}`
}

/**
 * Buckets facts by predicate+arity, preserving append order within each bucket.
 *
 * @remarks
 * The index behind the inferential reasoner's same-predicate-and-arity join
 * scans (`#findAllBindings` / `#calculatePremiseConfidence`): `matchFacts`
 * already rejects a predicate OR arity mismatch, so restricting a premise's
 * search to its own predicate+arity bucket changes nothing but the cost — the
 * surviving matches and their append order are identical to a predicate-only
 * index. Append order within a bucket is preserved, so a "first match wins"
 * scan finds the same fact a full linear pass would.
 *
 * @param facts - The facts to index
 * @returns A fresh readonly index from {@link factToArityKey} to its facts, in append order
 *
 * @example
 * ```ts
 * import { createFact, indexByArity } from '@src/core'
 *
 * const index = indexByArity([createFact('a', 'human', ['x']), createFact('b', 'human', ['y'])])
 * index.get(factToArityKey(createFact('c', 'human', ['z'])))?.length // 2
 * ```
 */
export function indexByArity(facts: readonly Fact[]): ReadonlyMap<string, readonly Fact[]> {
	const index = new Map<string, Fact[]>()
	for (const entry of facts) {
		const key = factToArityKey(entry)
		const bucket = index.get(key)
		if (bucket) bucket.push(entry)
		else index.set(key, [entry])
	}
	return index
}

/**
 * Derives one fact term's contribution to a dedup key — reference identity for
 * non-null objects / functions, a SameValueZero value string for primitives.
 *
 * @remarks
 * The per-term half of {@link factToKey}, used by the inferential reasoner's
 * forward-chaining dedupe. Primitives (and `null`) key by value, typeof-prefixed
 * so `1` (`number:1`) never collides with `'1'` (`string:1`); `-0` folds to `+0`
 * (both `number:0`) and `NaN` is self-consistent (`number:NaN`), matching
 * SameValueZero. Objects and functions key by REFERENCE through `identities` — a
 * first sighting is assigned the map's current size as its id, so distinct
 * objects never collide and the SAME reference always reproduces its key.
 *
 * @param term - The term to key
 * @param identities - The caller-created reference-identity ledger, threaded across a dedupe pass (a newly seen object/function is registered in it)
 * @returns The term's key string
 *
 * @example
 * ```ts
 * import { termToKey } from '@src/core'
 *
 * const identities = new Map<object, number>()
 * termToKey(1, identities)   // 'number:1'
 * termToKey('1', identities) // 'string:1' — never collides with the number
 * ```
 */
export function termToKey(term: unknown, identities: Map<object, number>): string {
	if ((typeof term === 'object' && term !== null) || typeof term === 'function') {
		const existing = identities.get(term)
		if (existing !== undefined) return `${typeof term}:#${existing}`
		const id = identities.size
		identities.set(term, id)
		return `${typeof term}:#${id}`
	}
	return `${typeof term}:${Object.is(term, -0) ? '0' : String(term)}`
}

/**
 * Derives a fact's canonical dedup key — predicate + arity + per-term
 * SameValueZero identity (confidence is NOT part of it).
 *
 * @remarks
 * The dedup key of the inferential reasoner's forward fixpoint: two facts with
 * the same predicate, arity, and SameValueZero-equal terms share a key (so a
 * NaN-term fact derives once and ±0 collapse keeping the first), while
 * confidence never enters the key. Each part — the predicate, the stringified
 * arity, and every {@link termToKey} — is LENGTH-PREFIXED (`length + ':' + part`)
 * before joining, so the delimiter can never be forged by an adversarial string
 * term embedding it: two distinct facts always produce distinct keys, even when
 * a term string contains the delimiter (an injective framing raw joining lacked).
 *
 * @param fact - The fact to key
 * @param identities - The reference-identity ledger threaded across the dedupe pass (see {@link termToKey})
 * @returns The fact's canonical key string
 *
 * @example
 * ```ts
 * import { createFact, factToKey } from '@src/core'
 *
 * const identities = new Map<object, number>()
 * // Same predicate + terms → same key regardless of confidence:
 * factToKey(createFact('a', 'p', ['x'], 1), identities) === factToKey(createFact('b', 'p', ['x'], 0.5), identities)
 * ```
 */
export function factToKey(fact: Fact, identities: Map<object, number>): string {
	const parts = [
		fact.predicate,
		String(fact.terms.length),
		...Array.from(fact.terms, (term) => termToKey(term, identities)),
	]
	// Length-prefix every part so the '\0' delimiter cannot be forged by a
	// term string that embeds it — the framing stays injective.
	return parts.map((part) => `${part.length}:${part}`).join('\0')
}

/**
 * Unifies a pattern fact positionally against a candidate fact — returning the
 * variable bindings on success, `undefined` on mismatch.
 *
 * @remarks
 * The bidirectional unification of the inferential reasoner: a `'?'`-prefixed
 * string term on EITHER side (pattern or candidate) is a variable that binds to
 * the opposite term (the `'?'` prefix is kept in the binding key), while
 * consistency is enforced within the match — a variable seen twice must bind the
 * SAME value (raw `!==`) or the whole match fails. A predicate mismatch or an
 * arity (term-count) mismatch fails immediately; non-variable terms must be
 * strictly (`===`) equal.
 *
 * @param pattern - The pattern fact (may carry `'?'` variables)
 * @param candidate - The candidate fact to unify against (may also carry `'?'` variables)
 * @returns A fresh bindings record, or `undefined` when they do not unify
 *
 * @example
 * ```ts
 * import { createFact, matchFacts } from '@src/core'
 *
 * matchFacts(createFact('p', 'parent', ['?x', 'bob']), createFact('f', 'parent', ['alice', 'bob'])) // { '?x': 'alice' }
 * matchFacts(createFact('p', 'parent', ['?x']), createFact('f', 'human', ['x']))                    // undefined — predicate
 * ```
 */
export function matchFacts(pattern: Fact, candidate: Fact): Record<string, unknown> | undefined {
	if (pattern.predicate !== candidate.predicate) return undefined
	if (pattern.terms.length !== candidate.terms.length) return undefined

	const bindings: Record<string, unknown> = {}

	for (let index = 0; index < pattern.terms.length; index++) {
		const patternTerm = pattern.terms[index]
		const factTerm = candidate.terms[index]

		if (typeof patternTerm === 'string' && patternTerm.startsWith('?')) {
			if (patternTerm in bindings) {
				if (bindings[patternTerm] !== factTerm) return undefined
			} else {
				bindings[patternTerm] = factTerm
			}
		} else if (typeof factTerm === 'string' && factTerm.startsWith('?')) {
			if (factTerm in bindings) {
				if (bindings[factTerm] !== patternTerm) return undefined
			} else {
				bindings[factTerm] = patternTerm
			}
		} else if (patternTerm !== factTerm) {
			return undefined
		}
	}

	return bindings
}

/**
 * Substitutes a fact's bound `'?'`-variables with their values — a fresh fact
 * with unbound terms passed through unchanged.
 *
 * @remarks
 * The pattern-instantiation step of the inferential reasoner: a `'?'`-prefixed
 * string term that is present in `bindings` is replaced by its bound value;
 * every other term (constants and UNBOUND variables alike) is kept verbatim. The
 * returned fact is a fresh copy (`{ ...fact, terms }`) — the input is never
 * mutated.
 *
 * @param fact - The fact (or pattern) to instantiate
 * @param bindings - The variable bindings to apply
 * @returns A fresh fact with bound variables substituted
 *
 * @example
 * ```ts
 * import { createFact, instantiateFact } from '@src/core'
 *
 * instantiateFact(createFact('c', 'mortal', ['?x']), { '?x': 'socrates' }).terms // ['socrates']
 * ```
 */
export function instantiateFact(fact: Fact, bindings: Record<string, unknown>): Fact {
	const terms = fact.terms.map((term) => {
		if (typeof term === 'string' && term.startsWith('?') && term in bindings) {
			return bindings[term]
		}
		return term
	})
	return { ...fact, terms }
}

/**
 * Computes the confidence a set of matched premises contributes to a derived
 * fact — the product of each premise's FIRST matching fact's confidence.
 *
 * @remarks
 * The confidence half of the inferential reasoner's forward derivation: each
 * premise is instantiated under `bindings`, then matched against its own
 * predicate+arity bucket of `index` (see {@link indexByArity}) and the first
 * match's `confidence ?? DEFAULT_CONFIDENCE` multiplies into the running
 * product. A premise with no match contributes nothing, so an empty premise set
 * yields `1`. Bucket append order is preserved, so the first bucket match is
 * the same fact a full linear scan would find. The inference's own
 * `confidence` is applied by the caller, not here.
 *
 * @param premises - The premise patterns to score
 * @param index - The live predicate+arity fact index to match against
 * @param bindings - The variable bindings the premises are instantiated under
 * @returns The product of the matched premise facts' confidences
 *
 * @example
 * ```ts
 * import { computePremiseConfidence, createFact, indexByArity } from '@src/core'
 *
 * const index = indexByArity([createFact('f1', 'human', ['socrates'], 0.5)])
 * computePremiseConfidence([createFact('p1', 'human', ['?x'])], index, {}) // 0.5
 * ```
 */
export function computePremiseConfidence(
	premises: readonly Fact[],
	index: ReadonlyMap<string, readonly Fact[]>,
	bindings: Record<string, unknown>,
): number {
	let confidence = 1

	for (const premise of premises) {
		const instantiated = instantiateFact(premise, bindings)
		for (const candidate of index.get(factToArityKey(premise)) ?? []) {
			if (matchFacts(instantiated, candidate)) {
				confidence *= candidate.confidence ?? DEFAULT_CONFIDENCE
				break
			}
		}
	}

	return confidence
}

/**
 * Projects a subject's scalar fields into `has(key, value)` base facts — the
 * inferential reasoner's subject-injection step.
 *
 * @remarks
 * Every own subject field EXCEPT `id` becomes a `has(key, value)` fact at full
 * `DEFAULT_CONFIDENCE`; `null` / `undefined` and any `object` (including arrays)
 * value is skipped. The returned `trace` carries one line per injection plus a
 * final count when at least one fact was produced, so no caller-owned
 * accumulator is written to. The injected fact ids are `subject:<key>`.
 *
 * @param subject - The subject to project
 * @returns The fresh `has(...)` facts (in `Object.keys` order) and the trace lines narrating them
 *
 * @example
 * ```ts
 * import { subjectToFacts } from '@src/core'
 *
 * subjectToFacts({ id: 'p1', age: 42, tags: ['a'] }).facts // one fact: has('age', 42) — tags skipped
 * ```
 */
export function subjectToFacts(subject: Subject): {
	readonly facts: readonly Fact[]
	readonly trace: readonly string[]
} {
	const facts: Fact[] = []
	const trace: string[] = []

	for (const key of Object.keys(subject)) {
		if (key === 'id') continue
		const value = subject[key]
		if (value === undefined || value === null) continue
		if (typeof value === 'object') continue

		facts.push({
			id: `subject:${key}`,
			predicate: 'has',
			terms: [key, value],
			confidence: DEFAULT_CONFIDENCE,
		})
		trace.push(`Subject field "${key}" → has(${key}, ${String(value)})`)
	}

	if (facts.length > 0) trace.push(`Injected ${facts.length} fact(s) from subject`)
	return { facts, trace }
}

/**
 * Collects the `'?'`-prefixed conclusion variables no premise binds.
 *
 * @remarks
 * The unbound names are the `'?'`-prefixed variables an inference's conclusion
 * introduces that no premise binds. The authoring-time footgun probe behind
 * `InferentialReasoner.validate`'s unbound-variable warning: backward proving
 * establishes each premise independently with no cross-premise binding
 * consistency, so a conclusion term that no premise's `terms` ever names stays
 * uninstantiated in the derived fact. Gathers the `?`-prefixed string terms of
 * `conclusion.terms`, subtracts every `?`-prefixed string term appearing in any
 * premise's `terms`, and returns the remainder once each, in the conclusion's
 * authored order.
 *
 * @param inference - The inference whose conclusion is checked against its premises
 * @returns The unbound conclusion variable names, once each, authored order
 *
 * @example
 * ```ts
 * import { createFact, createInference, findUnboundVariables } from '@src/core'
 *
 * findUnboundVariables(
 * 	createInference('i', 'I', [createFact('p', 'human', ['?x'])], createFact('c', 'mortal', ['?x', '?y'])),
 * ) // ['?y'] — '?x' is bound by the premise, '?y' is not
 * ```
 */
export function findUnboundVariables(inference: Inference): readonly string[] {
	const bound = new Set<string>()
	for (const premise of inference.premises) {
		for (const term of premise.terms) {
			if (isString(term) && term.startsWith('?')) bound.add(term)
		}
	}

	const unbound: string[] = []
	const seen = new Set<string>()
	for (const term of inference.conclusion.terms) {
		if (!isString(term) || !term.startsWith('?')) continue
		if (bound.has(term) || seen.has(term)) continue
		seen.add(term)
		unbound.push(term)
	}

	return unbound
}

// === Symbolic algebra machinery

/**
 * Determines whether a symbolic expression contains an UNBOUND occurrence of a
 * target variable.
 *
 * @remarks
 * The variable-presence probe of the symbolic reasoner's isolation: a `variable`
 * node matches only when its name is `target` AND `target` is not already in
 * `bindings` (a pre-bound target is a known value, not an unknown to isolate); a
 * `constant` never matches; an `operation` recurses into both operands (the
 * `right` operand may be absent on a unary node). The walk is an ITERATIVE
 * worklist (never recursive) with short-circuit `true` on the first hit, so it
 * stays total on pathologically deep expression trees.
 *
 * @param expression - The expression to probe
 * @param target - The variable name being sought
 * @param bindings - The known bindings (a bound target does NOT count as present)
 * @returns True if an unbound `target` occurs in the expression; false otherwise
 *
 * @example
 * ```ts
 * import { containsVariable, createConstant, createOperation, createVariable } from '@src/core'
 *
 * containsVariable(createOperation('add', createVariable('x'), createConstant(1)), 'x', {})       // true
 * containsVariable(createOperation('add', createVariable('x'), createConstant(1)), 'x', { x: 5 }) // false — pre-bound
 * ```
 */
export function containsVariable(
	expression: SymbolicExpression,
	target: string,
	bindings: Record<string, number>,
): boolean {
	const worklist: SymbolicExpression[] = [expression]

	while (worklist.length > 0) {
		const node = worklist.pop()
		if (node === undefined) continue
		if (node.form === 'variable') {
			if (node.name === target && !(target in bindings)) return true
		} else if (node.form === 'operation') {
			worklist.push(node.left)
			if (node.right) worklist.push(node.right)
		}
	}

	return false
}

/**
 * Inverts a `x op right = value` step, solving for the LEFT operand `x`.
 *
 * @remarks
 * The left-operand inverse of the symbolic reasoner's isolation: `add` inverts
 * to subtraction, `subtract` to addition, `multiply` to division, `divide` to
 * multiplication. Inversion by zero yields `NaN` (never a throw) — a `multiply`
 * with a zero `right` has no unique solution, and `x / 0 = value` has none
 * either, so both surface `NaN` for the non-finite check to report rather than a
 * bogus value. A non-invertible operator throws
 * `ReasonError('OPERATOR', …, { operator })`, caught per equation upstream.
 *
 * @param operator - The math operation to invert
 * @param value - The known result of `x op right`
 * @param rightValue - The known right operand
 * @returns The isolated left operand (`NaN` on a zero-division inverse)
 * @throws {@link ReasonError} `'OPERATOR'` when `operator` is outside the invertible vocabulary
 *
 * @example
 * ```ts
 * import { invertLeft } from '@src/core'
 *
 * invertLeft('add', 10, 3)      // 7  — x + 3 = 10
 * invertLeft('multiply', 10, 0) // NaN — x * 0 = 10 has no solution
 * ```
 */
export function invertLeft(operator: MathOperation, value: number, rightValue: number): number {
	switch (operator) {
		case 'add':
			return value - rightValue
		case 'subtract':
			return value + rightValue
		case 'multiply':
			return rightValue === 0 ? Number.NaN : value / rightValue
		case 'divide':
			// `x / 0 = value` has NO solution — NaN (uniform with the other
			// zero guards), so the non-finite check reports it rather than
			// a bogus `x = 0`.
			return rightValue === 0 ? Number.NaN : value * rightValue
		default:
			throw new ReasonError('OPERATOR', `Cannot invert operation "${operator}" for left operand`, {
				operator,
			})
	}
}

/**
 * Inverts a `left op x = value` step, solving for the RIGHT operand `x`.
 *
 * @remarks
 * The right-operand inverse of the symbolic reasoner's isolation: `add` inverts
 * to `value - left`, `subtract` to `left - value`, `multiply` to `value / left`
 * (with a zero `left` yielding `NaN`), `divide` to `left / value` (with a zero
 * `value` yielding `NaN`). Inversion by zero yields `NaN`, never a throw; a
 * non-invertible operator throws `ReasonError('OPERATOR', …, { operator })`,
 * caught per equation upstream.
 *
 * @param operator - The math operation to invert
 * @param value - The known result of `left op x`
 * @param leftValue - The known left operand
 * @returns The isolated right operand (`NaN` on a zero-division inverse)
 * @throws {@link ReasonError} `'OPERATOR'` when `operator` is outside the invertible vocabulary
 *
 * @example
 * ```ts
 * import { invertRight } from '@src/core'
 *
 * invertRight('subtract', 4, 10) // 6  — 10 - x = 4
 * invertRight('divide', 0, 10)   // NaN — 10 / x = 0 has no finite solution
 * ```
 */
export function invertRight(operator: MathOperation, value: number, leftValue: number): number {
	switch (operator) {
		case 'add':
			return value - leftValue
		case 'subtract':
			return leftValue - value
		case 'multiply':
			return leftValue === 0 ? Number.NaN : value / leftValue
		case 'divide':
			return value === 0 ? Number.NaN : leftValue / value
		default:
			throw new ReasonError('OPERATOR', `Cannot invert operation "${operator}" for right operand`, {
				operator,
			})
	}
}

/**
 * Applies one binary/unary math operation to already-evaluated operands.
 *
 * @remarks
 * The arithmetic core of the symbolic reasoner's expression evaluation: the full
 * {@link MathOperation} vocabulary plus its zero / unary conventions — `divide`
 * by zero is `NaN` (never a throw), the unary operations (`round` / `ceil` /
 * `floor` / `abs`) ignore `right`, and `percentage` is `left * (right / 100)`.
 * `operator` is typed `string` because untrusted definitions reach here
 * unchecked; the ONE throwing path is the unknown-operator default, which
 * throws `ReasonError('OPERATOR', …, { operator })` and is caught per equation
 * upstream.
 *
 * @param operator - The operation name (untrusted — an unknown one throws)
 * @param left - The left operand
 * @param right - The right operand (ignored by the unary operations)
 * @returns The operation's result (`NaN` on divide-by-zero)
 * @throws {@link ReasonError} `'OPERATOR'` when `operator` names no known operation
 *
 * @example
 * ```ts
 * import { applyOperation } from '@src/core'
 *
 * applyOperation('add', 2, 3)    // 5
 * applyOperation('divide', 1, 0) // NaN
 * ```
 */
export function applyOperation(operator: string, left: number, right: number): number {
	switch (operator) {
		case 'add':
			return left + right
		case 'subtract':
			return left - right
		case 'multiply':
			return left * right
		case 'divide':
			return right === 0 ? Number.NaN : left / right
		case 'power':
			return Math.pow(left, right)
		case 'minimum':
			return Math.min(left, right)
		case 'maximum':
			return Math.max(left, right)
		case 'average':
			return (left + right) / 2
		case 'percentage':
			return left * (right / 100)
		case 'round':
			return Math.round(left)
		case 'ceil':
			return Math.ceil(left)
		case 'floor':
			return Math.floor(left)
		case 'abs':
			return Math.abs(left)
		default:
			throw new ReasonError('OPERATOR', `Unknown operator: ${operator}`, { operator })
	}
}

/**
 * Resolves the effective right operand of a math operation — the supplied
 * `operand`, or the operation's own identity-preserving default when absent.
 *
 * @remarks
 * The operand-default half of the transform pipeline, paired with
 * {@link applyOperation}: `multiply` / `divide` / `power` default to `1` and
 * every other operation to `0`, so an absent operand leaves the value
 * unchanged. The unary operations (`round` / `ceil` / `floor` / `abs`) ignore
 * the operand entirely, so their default is never observable.
 *
 * @param operation - The operation whose operand default applies
 * @param operand - The supplied operand; an absent one takes the default
 * @returns The effective right operand. Default: `1` for `multiply` / `divide` / `power`, `0` otherwise
 *
 * @example
 * ```ts
 * import { resolveOperand } from '@src/core'
 *
 * resolveOperand('multiply')    // 1 — identity-preserving
 * resolveOperand('add')         // 0 — identity-preserving
 * resolveOperand('multiply', 3) // 3 — the supplied operand
 * ```
 */
export function resolveOperand(operation: MathOperation, operand?: number): number {
	if (operand !== undefined) return operand
	return operation === 'multiply' || operation === 'divide' || operation === 'power' ? 1 : 0
}

// === Logical conclusion extraction & error results

/**
 * Returns every atom leaf of an expression tree, depth-first, left-to-right.
 *
 * @remarks
 * The shared atom-walk behind both {@link extractConclusions} and the raters'
 * conclusion merge: an `atom` yields itself; a compound flattens its operands in
 * authored order, so a later operand's atoms follow an earlier one's. The walk is
 * an ITERATIVE explicit-stack traversal (never recursive), so it stays total on
 * pathologically deep expression trees; a hole in an `operands` array is skipped,
 * matching `flatMap`'s hole-skipping behavior.
 *
 * @param expression - The expression tree to walk
 * @returns A fresh, ordered list of the atom leaves
 *
 * @example
 * ```ts
 * import { createAtom, createCompound, extractAtoms } from '@src/core'
 *
 * extractAtoms(createAtom('a', 'equals', 1)).length                                                        // 1
 * extractAtoms(createCompound('and', [createAtom('a', 'equals', 1), createAtom('b', 'equals', 2)])).length // 2
 * ```
 */
export function extractAtoms(expression: Expression): readonly Atom[] {
	const atoms: Atom[] = []
	const stack: Expression[] = [expression]

	while (stack.length > 0) {
		const node = stack.pop()
		if (node === undefined) continue
		if (node.form === 'atom') {
			atoms.push(node)
			continue
		}
		const operands = node.operands
		for (let index = operands.length - 1; index >= 0; index--) {
			const operand = operands[index]
			if (operand !== undefined) stack.push(operand)
		}
	}

	return atoms
}

/**
 * Flattens a logical conclusion expression into its asserted `field = value`
 * pairs — connectives IGNORED.
 *
 * @remarks
 * The conclusion-extraction step of the logical reasoner's chaining: every
 * `atom` inside the expression asserts its `formatField(check.field) =
 * check.value` pair, and compounds are walked without regard to the connective
 * (an atom under `not` / `or` is asserted the same way). Later operands WIN on
 * a key clash (`Object.assign` order). Recursion runs through this exported
 * function itself; the derived-overlay keys are `formatField` strings (an array
 * field path flattens to its dot-joined form).
 *
 * @param expression - The conclusion expression to flatten
 * @returns A fresh record of asserted `field → value` pairs
 *
 * @example
 * ```ts
 * import { createAtom, createCompound, extractConclusions } from '@src/core'
 *
 * extractConclusions(createAtom('adult', 'equals', true))                                                 // { adult: true }
 * extractConclusions(createCompound('and', [createAtom('a', 'equals', 1), createAtom('b', 'equals', 2)])) // { a: 1, b: 2 }
 * ```
 */
export function extractConclusions(expression: Expression): Record<string, unknown> {
	const conclusions: Record<string, unknown> = {}
	for (const leaf of extractAtoms(expression))
		conclusions[formatField(leaf.check.field)] = leaf.check.value
	return conclusions
}

/**
 * Collects the flattened overlay keys written through an array path and also
 * read through an array path.
 *
 * @remarks
 * The reported keys are the `formatField`-flattened overlay keys an array-path
 * conclusion atom writes ANYWHERE among `rules` that an array-path premise atom
 * also reads ANYWHERE among `rules`. The cross-rule authoring-time footgun
 * probe behind `LogicalReasoner.validate`'s overlay-key-mismatch warning: a
 * logical conclusion's derived overlay is a FLAT record keyed by
 * `formatField(check.field)` — an array `FieldPath` dot-joins into one string
 * key. A premise that reads the same field through a DOTTED-STRING path resolves
 * that flat key correctly, but a premise that reads it through an ARRAY path
 * calls `resolveField`, which descends key-by-key into nesting the flat
 * overlay never created, so the chain silently fails to connect. Collects the
 * flattened keys of every array-path conclusion atom across `rules` (once
 * each, authored order), then returns the ones that also appear as the
 * flattened key of some array-path premise atom anywhere in `rules` — a
 * single pass over every rule's conclusion and premise atoms, so the cost is
 * linear in total atom count, never quadratic.
 *
 * @param rules - The rules to scan for the array-path write/read overlap
 * @returns The mismatched overlay keys, once each, authored order
 *
 * @example
 * ```ts
 * import { createAtom, createRule, findOverlayMismatches } from '@src/core'
 *
 * findOverlayMismatches([
 * 	createRule('a', [], createAtom(['address', 'city'], 'equals', 'NYC')),
 * 	createRule('b', [createAtom(['address', 'city'], 'equals', 'NYC')], createAtom('eligible', 'equals', true)),
 * ]) // ['address.city']
 * ```
 */
export function findOverlayMismatches(rules: readonly Rule[]): readonly string[] {
	const writeKeys: string[] = []
	const seenWrites = new Set<string>()
	for (const candidate of rules) {
		for (const atomLeaf of extractAtoms(candidate.conclusion)) {
			if (!Array.isArray(atomLeaf.check.field)) continue
			const key = formatField(atomLeaf.check.field)
			if (seenWrites.has(key)) continue
			seenWrites.add(key)
			writeKeys.push(key)
		}
	}

	const readKeys = new Set<string>()
	for (const candidate of rules) {
		for (const premise of candidate.premises) {
			for (const atomLeaf of extractAtoms(premise)) {
				if (!Array.isArray(atomLeaf.check.field)) continue
				readKeys.add(formatField(atomLeaf.check.field))
			}
		}
	}

	return writeKeys.filter((key) => readKeys.has(key))
}

/**
 * Builds the empty, type-shaped failure {@link ReasonResult} matching a
 * definition's reasoning.
 *
 * @remarks
 * The `bail: false` fallback of the `Reason` orchestrator: when a reasoner
 * throws and bail is off, the throw becomes an empty failure result carrying the
 * message as its sole `errors` entry. Each reasoning gets its own zero-valued
 * shape (`quantitative` → `value: 0` / empty `groups`; `logical` → `conclusion:
 * false` / empty `rules`; `symbolic` → empty `solutions`; `inferential` → empty
 * `derived`), always with `success: false` and an empty `trace`.
 *
 * @param definition - The definition whose reasoning selects the result shape
 * @param message - The error message to carry as the result's sole `errors` entry
 * @returns A fresh failure result of the matching reasoning
 *
 * @example
 * ```ts
 * import { buildErrorResult, createLogicalDefinition } from '@src/core'
 *
 * const result = buildErrorResult(createLogicalDefinition('e', 'E', []), 'boom')
 * // { reasoning: 'logical', conclusion: false, rules: [], count: 0, success: false, trace: [], errors: ['boom'] }
 * ```
 */
export function buildErrorResult(definition: Definition, message: string): ReasonResult {
	switch (definition.reasoning) {
		case 'quantitative':
			return {
				reasoning: 'quantitative',
				value: 0,
				groups: [],
				count: 0,
				success: false,
				trace: [],
				errors: [message],
			}
		case 'logical':
			return {
				reasoning: 'logical',
				conclusion: false,
				rules: [],
				count: 0,
				success: false,
				trace: [],
				errors: [message],
			}
		case 'symbolic':
			return {
				reasoning: 'symbolic',
				solutions: {},
				success: false,
				trace: [],
				errors: [message],
			}
		case 'inferential':
			return {
				reasoning: 'inferential',
				derived: [],
				success: false,
				trace: [],
				errors: [message],
			}
	}
}

// === Definition projection

/**
 * Projects a {@link Definition} to its scalar envelope — the kind's collections
 * drop out.
 *
 * @remarks
 * The `{noun}To{Noun}` projection behind the `DefinitionBuilder`'s private
 * envelope: a rest-omit removes `groups` from a quantitative definition,
 * `rules` from a logical one, `equations` / `variables` from a symbolic one,
 * and `facts` / `inferences` from an inferential one, leaving `reasoning` /
 * `id` / `name` plus the kind's own scalars. The input is never mutated.
 *
 * @param definition - The definition to project
 * @returns A fresh envelope carrying the definition's non-collection fields
 *
 * @example
 * ```ts
 * import { createLogicalDefinition, definitionToEnvelope } from '@src/core'
 *
 * 'rules' in definitionToEnvelope(createLogicalDefinition('e', 'E', [])) // false
 * ```
 */
export function definitionToEnvelope(definition: Definition): DefinitionEnvelope {
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

// === Id-keyed collection primitives
//
// The exported generic primitives every per-kind change/merge helper that follows
// composes over. No parameter selects behavior (`.claude/rules/names.md`
// § Split instead of compounding): `appendById` and `prependById` are
// separately named functions, and the optional `target` each takes is DATA — an
// id to anchor on — never a behavior switch. Every primitive is copy-on-write
// (`.claude/rules/typescript.md` § Immutability): the input array is never
// mutated, and a fresh array is always returned.

/**
 * Inserts `item` into an id-keyed collection, deduping any existing element
 * sharing its id, then placing it at the END (or immediately AFTER `target`).
 *
 * @remarks
 * Insertion DEDUPES on the id first: `filtered` is `items` with every `item.id`
 * twin removed, because an input array may already carry same-id twins.
 * Re-appending an existing id therefore REPOSITIONS it rather than updating it
 * in place — {@link replaceById} is the position-preserving alternative. With
 * no `target`, `item` lands at the end; with a `target`, it lands immediately
 * after the element whose `id === target` (searched in the DEDUPED array). A
 * `target` naming no element throws {@link ReasonError} (`'TARGET'`).
 *
 * @typeParam T - An id-carrying element type
 * @param items - The collection to insert into
 * @param item - The element to insert
 * @param target - Optional id to insert immediately after; appends at the end when absent
 * @returns A fresh array with `item` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no element in `items`
 *
 * @example
 * ```ts
 * import { appendById } from '@src/core'
 *
 * appendById([{ id: 'a' }, { id: 'b' }], { id: 'c' })      // [a, b, c]
 * appendById([{ id: 'a' }, { id: 'b' }], { id: 'c' }, 'a') // [a, c, b]
 * ```
 */
export function appendById<T extends { readonly id: string }>(
	items: readonly T[],
	item: T,
	target?: string,
): readonly T[] {
	const filtered = items.filter((existing) => existing.id !== item.id)
	if (target === undefined) return [...filtered, item]
	const index = filtered.findIndex((existing) => existing.id === target)
	if (index === -1)
		throw new ReasonError('TARGET', `Target id "${target}" not found`, {
			id: item.id,
			target,
			collection: 'items',
		})
	return [...filtered.slice(0, index + 1), item, ...filtered.slice(index + 1)]
}

/**
 * Inserts `item` into an id-keyed collection, deduping any existing element
 * sharing its id, then placing it at the START (or immediately BEFORE `target`).
 *
 * @remarks
 * Mirrors {@link appendById}'s dedup-then-insert semantics exactly, only the
 * placement differs: no `target` lands `item` at the start; a `target` lands
 * it immediately before the element whose `id === target` (searched in the
 * deduped array). A `target` naming no element throws {@link ReasonError}
 * (`'TARGET'`).
 *
 * @typeParam T - An id-carrying element type
 * @param items - The collection to insert into
 * @param item - The element to insert
 * @param target - Optional id to insert immediately before; prepends at the start when absent
 * @returns A fresh array with `item` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no element in `items`
 *
 * @example
 * ```ts
 * import { prependById } from '@src/core'
 *
 * prependById([{ id: 'a' }, { id: 'b' }], { id: 'c' })      // [c, a, b]
 * prependById([{ id: 'a' }, { id: 'b' }], { id: 'c' }, 'b') // [a, c, b]
 * ```
 */
export function prependById<T extends { readonly id: string }>(
	items: readonly T[],
	item: T,
	target?: string,
): readonly T[] {
	const filtered = items.filter((existing) => existing.id !== item.id)
	if (target === undefined) return [item, ...filtered]
	const index = filtered.findIndex((existing) => existing.id === target)
	if (index === -1)
		throw new ReasonError('TARGET', `Target id "${target}" not found`, {
			id: item.id,
			target,
			collection: 'items',
		})
	return [...filtered.slice(0, index), item, ...filtered.slice(index)]
}

/**
 * Swaps the element sharing `item.id` IN PLACE, preserving its position.
 *
 * @remarks
 * The position-preserving update primitive — unlike {@link appendById}, which
 * repositions a re-inserted id to the end/target. Appends `item` at the end
 * when no same-id element exists (never throws).
 *
 * @typeParam T - An id-carrying element type
 * @param items - The collection to update
 * @param item - The replacement element
 * @returns A fresh array with the same-id element replaced (or `item` appended)
 *
 * @example
 * ```ts
 * import { replaceById } from '@src/core'
 *
 * replaceById([{ id: 'a', v: 1 }, { id: 'b', v: 2 }], { id: 'a', v: 9 }) // [{a,9}, {b,2}]
 * replaceById([{ id: 'a' }], { id: 'z' })                                // [{a}, {z}] — appended
 * ```
 */
export function replaceById<T extends { readonly id: string }>(
	items: readonly T[],
	item: T,
): readonly T[] {
	const index = items.findIndex((existing) => existing.id === item.id)
	if (index === -1) return [...items, item]
	return [...items.slice(0, index), item, ...items.slice(index + 1)]
}

/**
 * Filters every element sharing `id` out of an id-keyed collection.
 *
 * @remarks
 * An absent `id` yields a same-length fresh copy — a no-op, never a throw.
 *
 * @typeParam T - An id-carrying element type
 * @param items - The collection to remove from
 * @param id - The id to remove every occurrence of
 * @returns A fresh array with every `id`-matching element removed
 *
 * @example
 * ```ts
 * import { removeById } from '@src/core'
 *
 * removeById([{ id: 'a' }, { id: 'b' }], 'a') // [{ id: 'b' }]
 * removeById([{ id: 'a' }], 'z')              // [{ id: 'a' }] — no-op
 * ```
 */
export function removeById<T extends { readonly id: string }>(
	items: readonly T[],
	id: string,
): readonly T[] {
	return items.filter((item) => item.id !== id)
}

/**
 * Reconciles two id-keyed collections — an incoming-order upsert with
 * base-only survivors appended after.
 *
 * @remarks
 * A Strategic-Merge-Patch-style id-keyed upsert:
 * the result is ordered by `incoming`'s id order FIRST (each element resolved
 * through `resolve` when its id also exists in `base`, defaulting to
 * incoming-wins-wholesale), THEN the `base`-only survivors in `base`'s own
 * order (retained, never deleted — merge is additive). Same-id twins within
 * EITHER input are deduped to their first occurrence.
 *
 * @typeParam T - An id-carrying element type
 * @param base - The base collection
 * @param incoming - The incoming collection (its order and matches take priority)
 * @param resolve - How to reconcile a matched (same-id) pair; defaults to keeping the incoming element wholesale
 * @returns A fresh, deduped, incoming-ordered-then-base-survivors array
 *
 * @example
 * ```ts
 * import { mergeById } from '@src/core'
 *
 * mergeById([{ id: 'a', v: 1 }, { id: 'b', v: 2 }], [{ id: 'a', v: 9 }])
 * // [{ id: 'a', v: 9 }, { id: 'b', v: 2 }] — incoming order first, base-only survivor after
 * ```
 */
export function mergeById<T extends { readonly id: string }>(
	base: readonly T[],
	incoming: readonly T[],
	resolve?: (base: T, incoming: T) => T,
): readonly T[] {
	const baseById = new Map<string, T>()
	for (const item of base) if (!baseById.has(item.id)) baseById.set(item.id, item)

	const seen = new Set<string>()
	const merged: T[] = []
	for (const item of incoming) {
		if (seen.has(item.id)) continue
		seen.add(item.id)
		const existing = baseById.get(item.id)
		merged.push(existing === undefined ? item : resolve ? resolve(existing, item) : item)
	}
	for (const item of base) {
		if (seen.has(item.id)) continue
		seen.add(item.id)
		merged.push(item)
	}
	return merged
}

// === Quantitative change/extend helpers

/**
 * Inserts `group` into a {@link QuantitativeDefinition}'s `groups` — dedup-then-
 * insert at the end, or immediately after `target`.
 *
 * @remarks
 * Group order is COSMETIC (group aggregation is order-independent) but honored
 * uniformly, same as every `append*` helper. Composes with {@link appendFactor}:
 * `appendGroup(def, appendFactor(group, factor))`.
 *
 * @param definition - The definition to insert into
 * @param group - The group to insert
 * @param target - Optional group id to insert immediately after
 * @returns A fresh definition with `group` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing group
 *
 * @example
 * ```ts
 * import { appendGroup, createFactorGroup, createQuantitativeDefinition } from '@src/core'
 *
 * appendGroup(createQuantitativeDefinition('risk', 'Risk', []), createFactorGroup('g1', 'sum', []))
 * ```
 */
export function appendGroup(
	definition: QuantitativeDefinition,
	group: FactorGroup,
	target?: string,
): QuantitativeDefinition {
	return { ...definition, groups: appendById(definition.groups, group, target) }
}

/**
 * Inserts `group` into a {@link QuantitativeDefinition}'s `groups` — dedup-then-
 * insert at the start, or immediately before `target`.
 *
 * @param definition - The definition to insert into
 * @param group - The group to insert
 * @param target - Optional group id to insert immediately before
 * @returns A fresh definition with `group` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing group
 *
 * @example
 * ```ts
 * import { createFactorGroup, createQuantitativeDefinition, prependGroup } from '@src/core'
 *
 * prependGroup(createQuantitativeDefinition('risk', 'Risk', []), createFactorGroup('g1', 'sum', []))
 * ```
 */
export function prependGroup(
	definition: QuantitativeDefinition,
	group: FactorGroup,
	target?: string,
): QuantitativeDefinition {
	return { ...definition, groups: prependById(definition.groups, group, target) }
}

/**
 * Swaps the group sharing `group.id` in a {@link QuantitativeDefinition} IN
 * PLACE, preserving its position (appends when absent).
 *
 * @param definition - The definition to update
 * @param group - The replacement group
 * @returns A fresh definition with the group replaced
 *
 * @example
 * ```ts
 * import { createFactorGroup, createQuantitativeDefinition, replaceGroup } from '@src/core'
 *
 * const definition = createQuantitativeDefinition('risk', 'Risk', [createFactorGroup('g1', 'sum', [])])
 * replaceGroup(definition, createFactorGroup('g1', 'product', []))
 * ```
 */
export function replaceGroup(
	definition: QuantitativeDefinition,
	group: FactorGroup,
): QuantitativeDefinition {
	return { ...definition, groups: replaceById(definition.groups, group) }
}

/**
 * Removes every group sharing `id` from a {@link QuantitativeDefinition}
 * (no-op when absent).
 *
 * @param definition - The definition to update
 * @param id - The group id to remove
 * @returns A fresh definition with the group removed
 *
 * @example
 * ```ts
 * import { createFactorGroup, createQuantitativeDefinition, removeGroup } from '@src/core'
 *
 * const definition = createQuantitativeDefinition('risk', 'Risk', [createFactorGroup('g1', 'sum', [])])
 * removeGroup(definition, 'g1').groups // []
 * ```
 */
export function removeGroup(
	definition: QuantitativeDefinition,
	id: string,
): QuantitativeDefinition {
	return { ...definition, groups: removeById(definition.groups, id) }
}

/**
 * Inserts `factor` into a {@link FactorGroup}'s `factors` — dedup-then-insert
 * at the end, or immediately after `target`.
 *
 * @remarks
 * Factor order is LOAD-BEARING: the same-priority tiebreak is declaration
 * order ({@link sortByPriority} is a stable ascending sort). Operates on the
 * factor's DIRECT container — compose into a definition through
 * `appendGroup(def, appendFactor(group, factor))`.
 *
 * @param group - The group to insert into
 * @param factor - The factor to insert
 * @param target - Optional factor id to insert immediately after
 * @returns A fresh group with `factor` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing factor
 *
 * @example
 * ```ts
 * import { appendFactor, createFactorGroup, createStaticFactor } from '@src/core'
 *
 * appendFactor(createFactorGroup('g1', 'sum', []), createStaticFactor('f1', 10))
 * ```
 */
export function appendFactor(group: FactorGroup, factor: Factor, target?: string): FactorGroup {
	return { ...group, factors: appendById(group.factors, factor, target) }
}

/**
 * Inserts `factor` into a {@link FactorGroup}'s `factors` — dedup-then-insert
 * at the start, or immediately before `target`.
 *
 * @param group - The group to insert into
 * @param factor - The factor to insert
 * @param target - Optional factor id to insert immediately before
 * @returns A fresh group with `factor` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing factor
 *
 * @example
 * ```ts
 * import { createFactorGroup, createStaticFactor, prependFactor } from '@src/core'
 *
 * prependFactor(createFactorGroup('g1', 'sum', []), createStaticFactor('f1', 10))
 * ```
 */
export function prependFactor(group: FactorGroup, factor: Factor, target?: string): FactorGroup {
	return { ...group, factors: prependById(group.factors, factor, target) }
}

/**
 * Swaps the factor sharing `factor.id` in a {@link FactorGroup} IN PLACE,
 * preserving its position (appends when absent).
 *
 * @param group - The group to update
 * @param factor - The replacement factor
 * @returns A fresh group with the factor replaced
 *
 * @example
 * ```ts
 * import { createFactorGroup, createStaticFactor, replaceFactor } from '@src/core'
 *
 * const group = createFactorGroup('g1', 'sum', [createStaticFactor('f1', 10)])
 * replaceFactor(group, createStaticFactor('f1', 20))
 * ```
 */
export function replaceFactor(group: FactorGroup, factor: Factor): FactorGroup {
	return { ...group, factors: replaceById(group.factors, factor) }
}

/**
 * Removes every factor sharing `id` from a {@link FactorGroup} (no-op when
 * absent).
 *
 * @param group - The group to update
 * @param id - The factor id to remove
 * @returns A fresh group with the factor removed
 *
 * @example
 * ```ts
 * import { createFactorGroup, createStaticFactor, removeFactor } from '@src/core'
 *
 * removeFactor(createFactorGroup('g1', 'sum', [createStaticFactor('f1', 10)]), 'f1').factors // []
 * ```
 */
export function removeFactor(group: FactorGroup, id: string): FactorGroup {
	return { ...group, factors: removeById(group.factors, id) }
}

// === Logical change/extend helpers

/**
 * Inserts a rule into a {@link LogicalDefinition}'s `rules` — dedup-then-insert
 * at the end, or immediately after `target`.
 *
 * @remarks
 * Order is LOAD-BEARING: the forward conclusion is the LAST declared
 * non-disabled rule, so `appendRule` without a `target` makes the new rule the
 * conclusion.
 *
 * @param definition - The definition to insert into
 * @param rule - The rule to insert
 * @param target - Optional rule id to insert immediately after
 * @returns A fresh definition with the rule inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing rule
 *
 * @example
 * ```ts
 * import { appendRule, createAtom, createLogicalDefinition, createRule } from '@src/core'
 *
 * appendRule(createLogicalDefinition('e', 'E', []), createRule('r1', [], createAtom('a', 'equals', true)))
 * ```
 */
export function appendRule(
	definition: LogicalDefinition,
	rule: Rule,
	target?: string,
): LogicalDefinition {
	return { ...definition, rules: appendById(definition.rules, rule, target) }
}

/**
 * Inserts a rule into a {@link LogicalDefinition}'s `rules` — dedup-then-insert
 * at the start, or immediately before `target`.
 *
 * @param definition - The definition to insert into
 * @param rule - The rule to insert
 * @param target - Optional rule id to insert immediately before
 * @returns A fresh definition with the rule inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing rule
 *
 * @example
 * ```ts
 * import { createAtom, createLogicalDefinition, createRule, prependRule } from '@src/core'
 *
 * prependRule(createLogicalDefinition('e', 'E', []), createRule('r1', [], createAtom('a', 'equals', true)))
 * ```
 */
export function prependRule(
	definition: LogicalDefinition,
	rule: Rule,
	target?: string,
): LogicalDefinition {
	return { ...definition, rules: prependById(definition.rules, rule, target) }
}

/**
 * Swaps the rule sharing `rule.id` in a {@link LogicalDefinition} IN PLACE,
 * preserving its position (appends when absent).
 *
 * @param definition - The definition to update
 * @param rule - The replacement rule
 * @returns A fresh definition with the rule replaced
 *
 * @example
 * ```ts
 * import { createAtom, createLogicalDefinition, createRule, replaceRule } from '@src/core'
 *
 * const definition = createLogicalDefinition('e', 'E', [createRule('r1', [], createAtom('a', 'equals', true))])
 * replaceRule(definition, createRule('r1', [], createAtom('a', 'equals', false)))
 * ```
 */
export function replaceRule(definition: LogicalDefinition, rule: Rule): LogicalDefinition {
	return { ...definition, rules: replaceById(definition.rules, rule) }
}

/**
 * Removes every rule sharing `id` from a {@link LogicalDefinition} (no-op when
 * absent).
 *
 * @param definition - The definition to update
 * @param id - The rule id to remove
 * @returns A fresh definition with the rule removed
 *
 * @example
 * ```ts
 * import { createAtom, createLogicalDefinition, createRule, removeRule } from '@src/core'
 *
 * const definition = createLogicalDefinition('e', 'E', [createRule('r1', [], createAtom('a', 'equals', true))])
 * removeRule(definition, 'r1').rules // []
 * ```
 */
export function removeRule(definition: LogicalDefinition, id: string): LogicalDefinition {
	return { ...definition, rules: removeById(definition.rules, id) }
}

// === Symbolic change/extend helpers

/**
 * Inserts an equation into a {@link SymbolicDefinition}'s `equations` — dedup-
 * then-insert at the end, or immediately after `target`.
 *
 * @remarks
 * Order is STRONGLY load-bearing: equations solve strictly in order and each
 * rounded solution feeds forward.
 *
 * @param definition - The definition to insert into
 * @param equation - The equation to insert
 * @param target - Optional equation id to insert immediately after
 * @returns A fresh definition with the equation inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing equation
 *
 * @example
 * ```ts
 * import { appendEquation, createConstant, createEquation, createSymbolicDefinition, createVariable } from '@src/core'
 *
 * appendEquation(createSymbolicDefinition('e', 'E', []), createEquation('e1', createVariable('x'), createConstant(1), 'x'))
 * ```
 */
export function appendEquation(
	definition: SymbolicDefinition,
	equation: Equation,
	target?: string,
): SymbolicDefinition {
	return { ...definition, equations: appendById(definition.equations, equation, target) }
}

/**
 * Inserts an equation into a {@link SymbolicDefinition}'s `equations` — dedup-
 * then-insert at the start, or immediately before `target`.
 *
 * @param definition - The definition to insert into
 * @param equation - The equation to insert
 * @param target - Optional equation id to insert immediately before
 * @returns A fresh definition with the equation inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing equation
 *
 * @example
 * ```ts
 * import { createConstant, createEquation, createSymbolicDefinition, createVariable, prependEquation } from '@src/core'
 *
 * prependEquation(createSymbolicDefinition('e', 'E', []), createEquation('e1', createVariable('x'), createConstant(1), 'x'))
 * ```
 */
export function prependEquation(
	definition: SymbolicDefinition,
	equation: Equation,
	target?: string,
): SymbolicDefinition {
	return { ...definition, equations: prependById(definition.equations, equation, target) }
}

/**
 * Swaps the equation sharing `equation.id` in a {@link SymbolicDefinition} IN
 * PLACE, preserving its position (appends when absent).
 *
 * @param definition - The definition to update
 * @param equation - The replacement equation
 * @returns A fresh definition with the equation replaced
 *
 * @example
 * ```ts
 * import { createConstant, createEquation, createSymbolicDefinition, createVariable, replaceEquation } from '@src/core'
 *
 * const definition = createSymbolicDefinition('e', 'E', [createEquation('e1', createVariable('x'), createConstant(1), 'x')])
 * replaceEquation(definition, createEquation('e1', createVariable('x'), createConstant(2), 'x'))
 * ```
 */
export function replaceEquation(
	definition: SymbolicDefinition,
	equation: Equation,
): SymbolicDefinition {
	return { ...definition, equations: replaceById(definition.equations, equation) }
}

/**
 * Removes every equation sharing `id` from a {@link SymbolicDefinition} (no-op
 * when absent).
 *
 * @param definition - The definition to update
 * @param id - The equation id to remove
 * @returns A fresh definition with the equation removed
 *
 * @example
 * ```ts
 * import { createConstant, createEquation, createSymbolicDefinition, createVariable, removeEquation } from '@src/core'
 *
 * const definition = createSymbolicDefinition('e', 'E', [createEquation('e1', createVariable('x'), createConstant(1), 'x')])
 * removeEquation(definition, 'e1').equations // []
 * ```
 */
export function removeEquation(definition: SymbolicDefinition, id: string): SymbolicDefinition {
	return { ...definition, equations: removeById(definition.equations, id) }
}

/**
 * Upserts one entry of a {@link SymbolicDefinition}'s `variables`.
 *
 * @remarks
 * `variables` is a name-keyed unordered record, so `add`/`remove` (no
 * placement) are the correct verbs — mirrored by {@link removeVariable}.
 *
 * @param definition - The definition to update
 * @param name - The variable name
 * @param value - The variable's value
 * @returns A fresh definition with the variable set
 *
 * @example
 * ```ts
 * import { addVariable, createSymbolicDefinition } from '@src/core'
 *
 * addVariable(createSymbolicDefinition('e', 'E', []), 'x', 5).variables // { x: 5 }
 * ```
 */
export function addVariable(
	definition: SymbolicDefinition,
	name: string,
	value: number,
): SymbolicDefinition {
	return { ...definition, variables: { ...definition.variables, [name]: value } }
}

/**
 * Removes one entry of a {@link SymbolicDefinition}'s `variables`.
 *
 * @remarks
 * The destructure-rest form OMITS the key entirely (never sets it to
 * `undefined`), keeping the result exact-record valid. A no-op (fresh copy)
 * when `name` is absent.
 *
 * @param definition - The definition to update
 * @param name - The variable name to remove
 * @returns A fresh definition with the variable removed
 *
 * @example
 * ```ts
 * import { createSymbolicDefinition, removeVariable } from '@src/core'
 *
 * removeVariable(createSymbolicDefinition('e', 'E', [], { variables: { x: 5 } }), 'x').variables // {}
 * ```
 */
export function removeVariable(definition: SymbolicDefinition, name: string): SymbolicDefinition {
	const { [name]: _drop, ...rest } = definition.variables
	return { ...definition, variables: rest }
}

// === Inferential change/extend helpers

/**
 * Inserts a fact into an {@link InferentialDefinition}'s `facts` — dedup-then-
 * insert at the end, or immediately after `target`.
 *
 * @remarks
 * `Fact.id` is an AUTHORING label — the runtime content-dedups facts by
 * predicate+arity+terms ({@link factToKey}), independently of this helper's
 * id-keyed dedup.
 *
 * @param definition - The definition to insert into
 * @param fact - The fact to insert
 * @param target - Optional fact id to insert immediately after
 * @returns A fresh definition with the fact inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing fact
 *
 * @example
 * ```ts
 * import { appendFact, createFact, createInferentialDefinition } from '@src/core'
 *
 * appendFact(createInferentialDefinition('m', 'M', [], []), createFact('f1', 'human', ['socrates']))
 * ```
 */
export function appendFact(
	definition: InferentialDefinition,
	fact: Fact,
	target?: string,
): InferentialDefinition {
	return { ...definition, facts: appendById(definition.facts, fact, target) }
}

/**
 * Inserts a fact into an {@link InferentialDefinition}'s `facts` — dedup-then-
 * insert at the start, or immediately before `target`.
 *
 * @param definition - The definition to insert into
 * @param fact - The fact to insert
 * @param target - Optional fact id to insert immediately before
 * @returns A fresh definition with the fact inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing fact
 *
 * @example
 * ```ts
 * import { createFact, createInferentialDefinition, prependFact } from '@src/core'
 *
 * prependFact(createInferentialDefinition('m', 'M', [], []), createFact('f1', 'human', ['socrates']))
 * ```
 */
export function prependFact(
	definition: InferentialDefinition,
	fact: Fact,
	target?: string,
): InferentialDefinition {
	return { ...definition, facts: prependById(definition.facts, fact, target) }
}

/**
 * Swaps the fact sharing `fact.id` in an {@link InferentialDefinition} IN
 * PLACE, preserving its position (appends when absent).
 *
 * @param definition - The definition to update
 * @param fact - The replacement fact
 * @returns A fresh definition with the fact replaced
 *
 * @example
 * ```ts
 * import { createFact, createInferentialDefinition, replaceFact } from '@src/core'
 *
 * const definition = createInferentialDefinition('m', 'M', [createFact('f1', 'human', ['socrates'])], [])
 * replaceFact(definition, createFact('f1', 'human', ['plato']))
 * ```
 */
export function replaceFact(definition: InferentialDefinition, fact: Fact): InferentialDefinition {
	return { ...definition, facts: replaceById(definition.facts, fact) }
}

/**
 * Removes every fact sharing `id` from an {@link InferentialDefinition} (no-op
 * when absent).
 *
 * @param definition - The definition to update
 * @param id - The fact id to remove
 * @returns A fresh definition with the fact removed
 *
 * @example
 * ```ts
 * import { createFact, createInferentialDefinition, removeFact } from '@src/core'
 *
 * const definition = createInferentialDefinition('m', 'M', [createFact('f1', 'human', ['socrates'])], [])
 * removeFact(definition, 'f1').facts // []
 * ```
 */
export function removeFact(definition: InferentialDefinition, id: string): InferentialDefinition {
	return { ...definition, facts: removeById(definition.facts, id) }
}

/**
 * Inserts an inference into an {@link InferentialDefinition}'s `inferences` —
 * dedup-then-insert at the end, or immediately after `target`.
 *
 * @remarks
 * Order is LOAD-BEARING: backward proving iterates in declaration order and
 * returns on first success.
 *
 * @param definition - The definition to insert into
 * @param inference - The inference to insert
 * @param target - Optional inference id to insert immediately after
 * @returns A fresh definition with the inference inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing inference
 *
 * @example
 * ```ts
 * import { appendInference, createFact, createInference, createInferentialDefinition } from '@src/core'
 *
 * appendInference(
 * 	createInferentialDefinition('m', 'M', [], []),
 * 	createInference('i1', [createFact('p', 'human', ['?x'])], createFact('c', 'mortal', ['?x'])),
 * )
 * ```
 */
export function appendInference(
	definition: InferentialDefinition,
	inference: Inference,
	target?: string,
): InferentialDefinition {
	return { ...definition, inferences: appendById(definition.inferences, inference, target) }
}

/**
 * Inserts an inference into an {@link InferentialDefinition}'s `inferences` —
 * dedup-then-insert at the start, or immediately before `target`.
 *
 * @param definition - The definition to insert into
 * @param inference - The inference to insert
 * @param target - Optional inference id to insert immediately before
 * @returns A fresh definition with the inference inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing inference
 *
 * @example
 * ```ts
 * import { createFact, createInference, createInferentialDefinition, prependInference } from '@src/core'
 *
 * prependInference(
 * 	createInferentialDefinition('m', 'M', [], []),
 * 	createInference('i1', [createFact('p', 'human', ['?x'])], createFact('c', 'mortal', ['?x'])),
 * )
 * ```
 */
export function prependInference(
	definition: InferentialDefinition,
	inference: Inference,
	target?: string,
): InferentialDefinition {
	return { ...definition, inferences: prependById(definition.inferences, inference, target) }
}

/**
 * Swaps the inference sharing `inference.id` in an {@link InferentialDefinition}
 * IN PLACE, preserving its position (appends when absent).
 *
 * @param definition - The definition to update
 * @param inference - The replacement inference
 * @returns A fresh definition with the inference replaced
 *
 * @example
 * ```ts
 * import { createFact, createInference, createInferentialDefinition, replaceInference } from '@src/core'
 *
 * const original = createInference('i1', [createFact('p', 'human', ['?x'])], createFact('c', 'mortal', ['?x']))
 * const definition = createInferentialDefinition('m', 'M', [], [original])
 * replaceInference(definition, createInference('i1', [], createFact('c', 'mortal', ['?x'])))
 * ```
 */
export function replaceInference(
	definition: InferentialDefinition,
	inference: Inference,
): InferentialDefinition {
	return { ...definition, inferences: replaceById(definition.inferences, inference) }
}

/**
 * Removes every inference sharing `id` from an {@link InferentialDefinition}
 * (no-op when absent).
 *
 * @param definition - The definition to update
 * @param id - The inference id to remove
 * @returns A fresh definition with the inference removed
 *
 * @example
 * ```ts
 * import { createFact, createInference, createInferentialDefinition, removeInference } from '@src/core'
 *
 * const original = createInference('i1', [createFact('p', 'human', ['?x'])], createFact('c', 'mortal', ['?x']))
 * removeInference(createInferentialDefinition('m', 'M', [], [original]), 'i1').inferences // []
 * ```
 */
export function removeInference(
	definition: InferentialDefinition,
	id: string,
): InferentialDefinition {
	return { ...definition, inferences: removeById(definition.inferences, id) }
}

// === Merge helpers — whole-definition reconciliation
//
// Model: id-keyed upsert, incoming order wins, base-only survivors retained
// (never deleted — additive). `base.id` (and `reasoning`) are preserved.
// Scalars / value-object fields are incoming-wins-WHEN-PRESENT, else base is
// kept — merge NEVER clears, which is what the `clear*` helpers are for.

/**
 * Reconciles two {@link QuantitativeDefinition}s onto `base`'s id.
 *
 * @remarks
 * The merge is ADDITIVE: a base-only group survives into the result and is
 * never deleted, and a scalar absent from `incoming` keeps its base value —
 * merge never clears a field, which is what {@link clearQuantitativeDefinition}
 * is for. `groups` merges through {@link mergeById}; a matched (same-id) PAIR of
 * groups recurses one level deeper — their `factors` also merge through
 * `mergeById` — the one exception to incoming-wins-wholesale. Every other
 * scalar / value-object field is incoming-wins-when-present, else base kept.
 *
 * @param base - The definition merge targets (its `id` is preserved)
 * @param incoming - The definition merged in (its order and matches take priority)
 * @returns A fresh, reconciled definition
 *
 * @example
 * ```ts
 * import { createFactorGroup, createQuantitativeDefinition, mergeQuantitativeDefinition } from '@src/core'
 *
 * const base = createQuantitativeDefinition('risk', 'Risk', [createFactorGroup('g1', 'sum', [])])
 * const incoming = createQuantitativeDefinition('risk', 'Risk v2', [createFactorGroup('g2', 'sum', [])])
 * mergeQuantitativeDefinition(base, incoming).groups.map((g) => g.id) // ['g2', 'g1']
 * ```
 */
export function mergeQuantitativeDefinition(
	base: QuantitativeDefinition,
	incoming: QuantitativeDefinition,
): QuantitativeDefinition {
	const groups = mergeById(base.groups, incoming.groups, (baseGroup, incomingGroup) => ({
		...incomingGroup,
		factors: mergeById(baseGroup.factors, incomingGroup.factors),
	}))
	return {
		...base,
		name: incoming.name,
		aggregation: incoming.aggregation,
		groups,
		...(Object.hasOwn(incoming, 'description') ? { description: incoming.description } : {}),
		...(Object.hasOwn(incoming, 'base') ? { base: incoming.base } : {}),
		...(Object.hasOwn(incoming, 'bounds') ? { bounds: incoming.bounds } : {}),
		...(Object.hasOwn(incoming, 'precision') ? { precision: incoming.precision } : {}),
	}
}

/**
 * Reconciles two {@link LogicalDefinition}s onto `base`'s id.
 *
 * @remarks
 * The merge is ADDITIVE: a base-only rule survives into the result and is never
 * deleted, and a scalar absent from `incoming` keeps its base value — merge
 * never clears a field, which is what {@link clearLogicalDefinition} is for.
 * `rules` merges through {@link mergeById} (incoming-wins-wholesale on a matched
 * id). Every other scalar field is incoming-wins-when-present, else base kept.
 *
 * @param base - The definition merge targets (its `id` is preserved)
 * @param incoming - The definition merged in (its order and matches take priority)
 * @returns A fresh, reconciled definition
 *
 * @example
 * ```ts
 * import { createAtom, createLogicalDefinition, createRule, mergeLogicalDefinition } from '@src/core'
 *
 * const base = createLogicalDefinition('e', 'E', [createRule('r1', [], createAtom('a', 'equals', true))])
 * const incoming = createLogicalDefinition('e', 'E2', [createRule('r2', [], createAtom('b', 'equals', true))])
 * mergeLogicalDefinition(base, incoming).rules.map((r) => r.id) // ['r2', 'r1']
 * ```
 */
export function mergeLogicalDefinition(
	base: LogicalDefinition,
	incoming: LogicalDefinition,
): LogicalDefinition {
	return {
		...base,
		name: incoming.name,
		strategy: incoming.strategy,
		rules: mergeById(base.rules, incoming.rules),
		...(Object.hasOwn(incoming, 'description') ? { description: incoming.description } : {}),
		...(Object.hasOwn(incoming, 'depth') ? { depth: incoming.depth } : {}),
	}
}

/**
 * Reconciles two {@link SymbolicDefinition}s onto `base`'s id.
 *
 * @remarks
 * The merge is ADDITIVE: a base-only equation or variable survives into the
 * result and is never deleted, and a scalar absent from `incoming` keeps its
 * base value — merge never clears a field, which is what
 * {@link clearSymbolicDefinition} is for. `equations` merges through
 * {@link mergeById} (incoming-wins-wholesale on a matched id); `variables` is a
 * plain incoming-wins spread (`{ ...base.variables, ...incoming.variables }`).
 * Every other scalar field is incoming-wins-when-present, else base kept.
 *
 * @param base - The definition merge targets (its `id` is preserved)
 * @param incoming - The definition merged in (its order, matches, and variables take priority)
 * @returns A fresh, reconciled definition
 *
 * @example
 * ```ts
 * import { createConstant, createEquation, createSymbolicDefinition, createVariable, mergeSymbolicDefinition } from '@src/core'
 *
 * const base = createSymbolicDefinition('e', 'E', [], { variables: { x: 1 } })
 * const incoming = createSymbolicDefinition('e', 'E2', [createEquation('e1', createVariable('x'), createConstant(2), 'x')], {
 * 	variables: { y: 2 },
 * })
 * mergeSymbolicDefinition(base, incoming).variables // { x: 1, y: 2 }
 * ```
 */
export function mergeSymbolicDefinition(
	base: SymbolicDefinition,
	incoming: SymbolicDefinition,
): SymbolicDefinition {
	return {
		...base,
		name: incoming.name,
		equations: mergeById(base.equations, incoming.equations),
		variables: { ...base.variables, ...incoming.variables },
		...(Object.hasOwn(incoming, 'description') ? { description: incoming.description } : {}),
		...(Object.hasOwn(incoming, 'precision') ? { precision: incoming.precision } : {}),
	}
}

/**
 * Reconciles two {@link InferentialDefinition}s onto `base`'s id.
 *
 * @remarks
 * The merge is ADDITIVE: a base-only inference or fact survives into the result
 * and is never deleted, and a scalar absent from `incoming` keeps its base
 * value — merge never clears a field, which is what
 * {@link clearInferentialDefinition} is for. `inferences` and `facts` each
 * merge through {@link mergeById} (incoming-wins-wholesale on a matched id). Every
 * other scalar field is incoming-wins-when-present, else base kept.
 *
 * @param base - The definition merge targets (its `id` is preserved)
 * @param incoming - The definition merged in (its order and matches take priority)
 * @returns A fresh, reconciled definition
 *
 * @example
 * ```ts
 * import { createFact, createInferentialDefinition, mergeInferentialDefinition } from '@src/core'
 *
 * const base = createInferentialDefinition('m', 'M', [createFact('f1', 'human', ['a'])], [])
 * const incoming = createInferentialDefinition('m', 'M2', [createFact('f2', 'human', ['b'])], [])
 * mergeInferentialDefinition(base, incoming).facts.map((f) => f.id) // ['f2', 'f1']
 * ```
 */
export function mergeInferentialDefinition(
	base: InferentialDefinition,
	incoming: InferentialDefinition,
): InferentialDefinition {
	return {
		...base,
		name: incoming.name,
		strategy: incoming.strategy,
		inferences: mergeById(base.inferences, incoming.inferences),
		facts: mergeById(base.facts, incoming.facts),
		...(Object.hasOwn(incoming, 'description') ? { description: incoming.description } : {}),
		...(Object.hasOwn(incoming, 'depth') ? { depth: incoming.depth } : {}),
	}
}

// === Clear helpers — optional-field key-deletion
//
// `const { [key]: _drop, ...rest } = definition; return rest` — the
// destructure-rest form sidesteps oxlint `no-param-reassign` friction, and the
// result OMITS the key entirely (never sets it to `undefined`), keeping the
// definition exact-record valid.

/**
 * Deletes one optional field of a {@link QuantitativeDefinition}.
 *
 * @param definition - The definition to update
 * @param key - The optional field to clear
 * @returns A fresh definition with `key` omitted
 *
 * @example
 * ```ts
 * import { clearQuantitativeDefinition, createQuantitativeDefinition } from '@src/core'
 *
 * const definition = createQuantitativeDefinition('risk', 'Risk', [], { precision: 2 })
 * 'precision' in clearQuantitativeDefinition(definition, 'precision') // false
 * ```
 */
export function clearQuantitativeDefinition(
	definition: QuantitativeDefinition,
	key: QuantitativeClearKey,
): QuantitativeDefinition {
	const { [key]: _drop, ...rest } = definition
	return rest
}

/**
 * Deletes one optional field of a {@link LogicalDefinition}.
 *
 * @param definition - The definition to update
 * @param key - The optional field to clear
 * @returns A fresh definition with `key` omitted
 *
 * @example
 * ```ts
 * import { clearLogicalDefinition, createLogicalDefinition } from '@src/core'
 *
 * const definition = createLogicalDefinition('e', 'E', [], { depth: 5 })
 * 'depth' in clearLogicalDefinition(definition, 'depth') // false
 * ```
 */
export function clearLogicalDefinition(
	definition: LogicalDefinition,
	key: LogicalClearKey,
): LogicalDefinition {
	const { [key]: _drop, ...rest } = definition
	return rest
}

/**
 * Deletes one optional field of a {@link SymbolicDefinition}.
 *
 * @param definition - The definition to update
 * @param key - The optional field to clear
 * @returns A fresh definition with `key` omitted
 *
 * @example
 * ```ts
 * import { clearSymbolicDefinition, createSymbolicDefinition } from '@src/core'
 *
 * const definition = createSymbolicDefinition('e', 'E', [], { precision: 2 })
 * 'precision' in clearSymbolicDefinition(definition, 'precision') // false
 * ```
 */
export function clearSymbolicDefinition(
	definition: SymbolicDefinition,
	key: SymbolicClearKey,
): SymbolicDefinition {
	const { [key]: _drop, ...rest } = definition
	return rest
}

/**
 * Deletes one optional field of an {@link InferentialDefinition}.
 *
 * @param definition - The definition to update
 * @param key - The optional field to clear
 * @returns A fresh definition with `key` omitted
 *
 * @example
 * ```ts
 * import { clearInferentialDefinition, createInferentialDefinition } from '@src/core'
 *
 * const definition = createInferentialDefinition('m', 'M', [], [], { depth: 5 })
 * 'depth' in clearInferentialDefinition(definition, 'depth') // false
 * ```
 */
export function clearInferentialDefinition(
	definition: InferentialDefinition,
	key: InferentialClearKey,
): InferentialDefinition {
	const { [key]: _drop, ...rest } = definition
	return rest
}

// === Subject engine
//
// The subject counterpart of the preceding definition engine — four pure helpers.
// Records are unordered, so there is no `append*`/`prepend*` on a subject
// (mirrors the `addVariable`/`removeVariable` note).

/**
 * Upserts one field of a {@link Subject} — copy-on-write spread.
 *
 * @remarks
 * Named `assignField` rather than `setField` because it RETURNS a fresh subject
 * instead of writing into the one it is given — `set*` reads as an in-place
 * write. Id-agnostic: overwrites an `id` key like any other field — id
 * protection is an entity's job, not this helper's.
 *
 * @param subject - The subject to update
 * @param key - The field to set
 * @param value - The value to set it to
 * @returns A fresh subject with `key` set to `value`
 *
 * @example
 * ```ts
 * import { assignField } from '@src/core'
 *
 * assignField({ id: 's1', age: 30 }, 'age', 31) // { id: 's1', age: 31 }
 * ```
 */
export function assignField(subject: Subject, key: string, value: unknown): Subject {
	return { ...subject, [key]: value }
}

/**
 * Deletes one field of a {@link Subject} — destructure-rest omit.
 *
 * @remarks
 * The key is DELETED entirely (never set to `undefined`), keeping the result
 * exact-record valid. A no-op (fresh copy) when `key` is absent.
 *
 * @param subject - The subject to update
 * @param key - The field to delete
 * @returns A fresh subject with `key` omitted
 *
 * @example
 * ```ts
 * import { removeField } from '@src/core'
 *
 * removeField({ id: 's1', age: 30 }, 'age') // { id: 's1' }
 * ```
 */
export function removeField(subject: Subject, key: string): Subject {
	const { [key]: _drop, ...rest } = subject
	return rest
}

/**
 * Reconciles two {@link Subject}s — incoming-wins spread, with the base `id`
 * preserved when present.
 *
 * @remarks
 * Mirrors the definition merge's base-id-wins rule: `{ ...base, ...incoming }`
 * with `base.id` restored afterward when `base` carries an own `id`.
 *
 * @param base - The subject merge targets (its `id` is preserved when present)
 * @param incoming - The subject merged in (its fields take priority)
 * @returns A fresh, reconciled subject
 *
 * @example
 * ```ts
 * import { mergeSubjects } from '@src/core'
 *
 * mergeSubjects({ id: 's1', age: 30 }, { age: 31, name: 'Alice' })
 * // { id: 's1', age: 31, name: 'Alice' }
 * ```
 */
export function mergeSubjects(base: Subject, incoming: Subject): Subject {
	const merged = { ...base, ...incoming }
	return Object.hasOwn(base, 'id') ? { ...merged, id: base.id } : merged
}

/**
 * Produces `count` deterministic clones of a {@link Subject}.
 *
 * @remarks
 * When `subject.id` is a string, each clone's id is minted
 * `` `${baseId}-${index}` `` (index from `0`); with no string `id`, the clones
 * pass through unchanged (still fresh copies). Pure and deterministic — the
 * same input always produces the same output (run-twice equality) — and does
 * NOT emit. `count <= 0` yields an empty array.
 *
 * @param subject - The subject to clone
 * @param count - How many clones to produce
 * @returns The `count`-long array of clones
 *
 * @example
 * ```ts
 * import { repeatSubject } from '@src/core'
 *
 * repeatSubject({ id: 's1', age: 30 }, 2) // [{ id: 's1-0', age: 30 }, { id: 's1-1', age: 30 }]
 * repeatSubject({ age: 30 }, 2)           // [{ age: 30 }, { age: 30 }] — no id to mint from
 * ```
 */
export function repeatSubject(subject: Subject, count: number): readonly Subject[] {
	const baseId = subject.id
	const clones: Subject[] = []
	for (let index = 0; index < count; index += 1) {
		clones.push(
			typeof baseId === 'string' ? { ...subject, id: `${baseId}-${index}` } : { ...subject },
		)
	}
	return clones
}
