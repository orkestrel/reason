import type {
	Aggregation,
	Atom,
	Bounds,
	CheckState,
	Definition,
	DefinitionEnvelope,
	Equation,
	Check,
	Expression,
	Fact,
	Factor,
	FactorGroup,
	FactorSource,
	Inference,
	InferentialClearKey,
	InferentialDefinition,
	LogicalClearKey,
	LogicalDefinition,
	LogicalOperator,
	MathOperation,
	PolarRead,
	QuantitativeClearKey,
	QuantitativeDefinition,
	ReasonResult,
	Rule,
	ShapeRead,
	ShapeScan,
	SourceResult,
	Subject,
	SubjectAdmission,
	SymbolicClearKey,
	SymbolicDefinition,
	SymbolicExpression,
} from './types.js'
import type {
	AuditFault,
	ContractShape,
	FaultKind,
	FieldPath,
	JSONValue,
} from '@orkestrel/contract'
import {
	createContract,
	GUARD_DEPTH_LIMIT,
	isArray,
	isBoolean,
	isFiniteNumber,
	isFunction,
	isNull,
	isNumber,
	isObject,
	isRecord,
	isString,
	iterateIndices,
	preview,
	resolveField,
} from '@orkestrel/contract'
import { DEFAULT_CONFIDENCE, DEFAULT_PRIORITY } from './constants.js'
import { ReasonError } from './errors.js'
import { isComparable, isLookupKey, isMembership, isRange } from './validators.js'

// The module's pure leaves: field display, the numeric helpers, equality and
// ordering, the inferential fact machinery, the symbolic algebra machinery, the
// id-keyed collection primitives, and the copy-on-write change / extend / merge
// / clear family over definitions and subjects. Every function here is
// referentially transparent — it returns a fresh, JSON-serializable value and
// touches no input — with one deliberate exception: `termToKey` and `factToKey`
// thread a caller-created `identities` ledger and register each newly seen
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
 * overlays; it is never re-parsed into a path (a string stays a single key).
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
	const minimum = limit.minimum !== undefined && value < limit.minimum ? limit.minimum : value
	return limit.maximum !== undefined && minimum > limit.maximum ? limit.maximum : minimum
}

/**
 * Checks whether a value falls inside an inclusive range expressed as an array.
 *
 * @remarks
 * The range test behind the `between` and `outside` `Comparison` operators: only
 * the first two elements of `range` are read, each end is inclusive, and a
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
 * silent success. An unknown aggregation from an untrusted definition is `NaN`
 * too, for the same reason.
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
		default:
			return Number.NaN
	}
}

/**
 * Resolves one {@link FactorSource} against a subject, falling back when it cannot.
 *
 * @remarks
 * The source-resolution leaf of the quantitative factor pipeline. A `static`
 * source passes its value through. A `field` or `range` source reads a finite
 * number, with no coercion. A `lookup` source reads a string, a finite number, or
 * a boolean as a key of the table's own keys. Anything else leaves the source
 * unread, with no `value`. `fallback` serves only a readable key the table does not
 * hold and a number no band covers. A `range` scans its bands in order and the
 * first match wins — a band without `bounds` is a catch-all and an absent bound side
 * is open. A malformed factor carrying no source is unread rather than a crash.
 *
 * @param source - The factor source to resolve
 * @param subject - The subject to read from
 * @param fallback - The value an unknown key or a missing band takes
 * @returns The resolved value, absent when the source is unread, and whether `fallback` supplied it
 *
 * @example
 * ```ts
 * import { createFieldSource, createLookupSource, resolveSource } from '@src/core'
 *
 * resolveSource(createFieldSource('age'), { age: 30 })                      // { value: 30, fallback: false }
 * resolveSource(createFieldSource('age'), { age: '30' }, 1)                 // { fallback: false } — unread
 * resolveSource(createLookupSource('state', { CA: 5 }), { state: 'NY' }, 1) // { value: 1, fallback: true }
 * ```
 */
export function resolveSource(
	source: FactorSource,
	subject: Subject,
	fallback?: number,
): SourceResult {
	const unread: SourceResult = { fallback: false }
	const missed: SourceResult = fallback === undefined ? unread : { value: fallback, fallback: true }
	// A malformed factor may carry no source at all — unread, not a crash.
	if (!source) return unread
	switch (source.origin) {
		case 'static':
			return { value: source.value, fallback: false }
		case 'field': {
			const value = resolveField(subject, source.field)
			return isFiniteNumber(value) ? { value, fallback: false } : unread
		}
		case 'lookup': {
			const resolved = resolveField(subject, source.field)
			if (!isLookupKey(resolved)) return unread
			const key = String(resolved)
			const value = Object.hasOwn(source.table, key) ? source.table[key] : undefined
			return value === undefined ? missed : { value, fallback: false }
		}
		case 'range': {
			const value = resolveField(subject, source.field)
			if (!isFiniteNumber(value)) return unread
			for (const range of source.ranges) {
				if (!isObject(range)) continue
				const limit = range.bounds
				// A band without bounds is a catch-all; an absent side is open.
				if (!limit) return { value: range.value, fallback: false }
				const aboveMinimum = limit.minimum === undefined || value >= limit.minimum
				const belowMaximum = limit.maximum === undefined || value <= limit.maximum
				if (aboveMinimum && belowMaximum) return { value: range.value, fallback: false }
			}
			return missed
		}
		default:
			return unread
	}
}

// === Comparison and logic over states

/**
 * Compares a subject value with an expected value and returns what that settles.
 *
 * @remarks
 * Every comparison reads `unread` rather than guessing when either side cannot be
 * compared, and a malformed expected value is unread. Ordering and range need finite
 * numbers on both sides. Equality settles two values of one primitive type by `===`, reads
 * a blank or padded string as unread, and reads any other difference of type as unread,
 * except that `null` as the expected value settles on any present field. Membership
 * settles on an exact hit, reads as unread when an element has another type, and otherwise
 * settles.
 *
 * @param actual - The subject's value
 * @param operator - The comparison, typed `string` because an untrusted definition reaches here unchecked
 * @param expected - The value to compare with
 * @returns The settled state
 * @throws {@link ReasonError} `'OPERATOR'` when `operator` names no known comparison
 *
 * @example
 * ```ts
 * import { settleComparison } from '@src/core'
 *
 * settleComparison(30, 'above', 18)        // 'met'
 * settleComparison(undefined, 'above', 18) // 'unread'
 * settleComparison(90, 'not', null)        // 'met'
 * settleComparison(90, 'not', 'none')      // 'unread'
 * settleComparison('1', 'equals', 1)       // 'unread'
 * settleComparison(' 1', 'equals', ' 1')   // 'unread'
 * ```
 */
export function settleComparison(actual: unknown, operator: string, expected: unknown): CheckState {
	switch (operator) {
		case 'equals':
		case 'not':
			if (!isComparable(actual) || !isComparable(expected)) return 'unread'
			if (isString(actual) && (actual === '' || actual !== actual.trim())) return 'unread'
			if (!isNull(expected) && typeof actual !== typeof expected) return 'unread'
			return (actual === expected) === (operator === 'equals') ? 'met' : 'unmet'
		case 'above':
		case 'below':
		case 'from':
		case 'to':
			if (!isFiniteNumber(actual) || !isFiniteNumber(expected)) return 'unread'
			if (operator === 'above') return actual > expected ? 'met' : 'unmet'
			if (operator === 'below') return actual < expected ? 'met' : 'unmet'
			if (operator === 'from') return actual >= expected ? 'met' : 'unmet'
			return actual <= expected ? 'met' : 'unmet'
		case 'any':
		case 'none':
			if (!isComparable(actual) || !isMembership(expected)) return 'unread'
			if (expected.includes(actual)) return operator === 'any' ? 'met' : 'unmet'
			if (expected.some((entry) => typeof entry !== typeof actual)) return 'unread'
			return operator === 'any' ? 'unmet' : 'met'
		case 'between':
		case 'outside':
			if (!isFiniteNumber(actual) || !isRange(expected)) return 'unread'
			return matchesBounds(actual, expected) === (operator === 'between') ? 'met' : 'unmet'
		default:
			throw new ReasonError('OPERATOR', `Unknown comparison operator: ${operator}`, { operator })
	}
}

/**
 * Returns what a comparison reads on a conclusion no rule concluded, once every rule
 * that could have has settled.
 *
 * @remarks
 * Closed-world applies to these keys alone. `equals` and `any` are unmet, `not` and
 * `none` are met, and an ordering or range comparison is unread, because it needs a
 * number and the key holds none.
 *
 * @param operator - The comparison reading the key
 * @returns The settled state
 *
 * @example
 * ```ts
 * import { readClosedState } from '@src/core'
 *
 * readClosedState('equals') // 'unmet'
 * readClosedState('not')    // 'met'
 * readClosedState('above')  // 'unread'
 * ```
 */
export function readClosedState(operator: string): CheckState {
	if (operator === 'equals' || operator === 'any') return 'unmet'
	if (operator === 'not' || operator === 'none') return 'met'
	return 'unread'
}

/**
 * Combines operand states under a logical connective, in strong Kleene logic.
 *
 * @remarks
 * `and` is `unmet` when any operand is, `or` is `met` when any operand is, and otherwise
 * an `unread` operand leaves the result `unread`, so `age above 18 and credit above 600`
 * with age 15 and no credit is exactly `unmet`. A wrong arity or an unknown connective
 * reads `unread`.
 *
 * @param operator - The connective, typed `string` because an untrusted definition reaches here unchecked
 * @param states - The operand states, in order
 * @returns The combined state
 *
 * @example
 * ```ts
 * import { combineStates } from '@src/core'
 *
 * combineStates('and', ['unmet', 'unread']) // 'unmet'
 * combineStates('or', ['met', 'unread'])    // 'met'
 * combineStates('not', ['unread'])          // 'unread'
 * combineStates('and', [])                  // 'unread'
 * ```
 */
export function combineStates(
	operator: LogicalOperator | string,
	states: readonly CheckState[],
): CheckState {
	// A hole is an operand nobody can read, and the array methods below would step over it.
	if (states.filter(() => true).length !== states.length) return 'unread'
	const first = states[0]
	const second = states[1]
	switch (operator) {
		case 'and':
			if (states.length === 0) return 'unread'
			if (states.includes('unmet')) return 'unmet'
			return states.includes('unread') ? 'unread' : 'met'
		case 'or':
			if (states.length === 0) return 'unread'
			if (states.includes('met')) return 'met'
			return states.includes('unread') ? 'unread' : 'unmet'
		case 'not':
			if (states.length !== 1 || first === undefined || first === 'unread') return 'unread'
			return first === 'met' ? 'unmet' : 'met'
		case 'implies':
			if (states.length !== 2 || first === undefined || second === undefined) return 'unread'
			if (first === 'unmet' || second === 'met') return 'met'
			return first === 'unread' || second === 'unread' ? 'unread' : 'unmet'
		case 'xor':
			if (states.length !== 2 || states.includes('unread')) return 'unread'
			return first === second ? 'unmet' : 'met'
		default:
			return 'unread'
	}
}

/**
 * Rounds a number to a fixed count of decimal places.
 *
 * @remarks
 * `Math.round` semantics — halves round toward `+∞` (`2.5` → `3`, `-2.5` → `-2`).
 * A negative precision rounds at whole-number scales (`-1` → tens, `-2` →
 * hundreds). A precision whose scale factor overflows the double range
 * (`10^p` → `Infinity` at roughly `p > 308`, `0` at roughly `p < -323`) returns
 * the value unchanged — passthrough, never `NaN`.
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
	if (!isFiniteNumber(factor) || factor === 0) return value
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
 * NaN-valued conclusion or fact term derives exactly once and the fixpoint
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
 * to `0`, equal priorities keep declaration order (stable), and the input array
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
	const usable = Iterator.from(items).filter(isObject).toArray()
	return usable.sort(
		(left, right) => (left.priority ?? DEFAULT_PRIORITY) - (right.priority ?? DEFAULT_PRIORITY),
	)
}

/**
 * Collects the ids that appear more than once in an id-carrying list — each
 * duplicated id reported once, in first-occurrence order.
 *
 * @remarks
 * The shared uniqueness scan behind every reasoner's `validate()` duplicate-id
 * warnings (rules, groups, factors, equations, inferences). Runtime stays
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
	const indexed = Iterator.from(items)
		.map((item, index): readonly [string, number] => [item.id, index])
		.toArray()
	const first = new Map(indexed.toReversed())
	const duplicates = new Set(
		indexed.filter(([id, index]) => first.get(id) !== index).map(([id]) => id),
	)
	return indexed
		.filter(([id, index]) => first.get(id) === index && duplicates.has(id))
		.map(([id]) => id)
}

// === Inferential fact machinery

/**
 * Derives a fact's predicate+arity bucket key — length-prefixed so the
 * delimiter cannot be forged.
 *
 * @remarks
 * Keys both stored facts and premise patterns (both are `Fact`-shaped) for
 * {@link indexByArity}: `matchFacts` already rejects an arity mismatch, so
 * narrowing a same-predicate bucket to one of the same predicate and arity only
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
 * already rejects a predicate or an arity mismatch, so restricting a premise's
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
	return Map.groupBy(facts, factToArityKey)
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
 * SameValueZero. Objects and functions key by reference through `identities` — a
 * first sighting is assigned the map's current size as its id, so distinct
 * objects never collide and the same reference always reproduces its key.
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
	if (isObject(term) || isFunction(term)) {
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
 * SameValueZero identity, with confidence excluded from it.
 *
 * @remarks
 * The dedup key of the inferential reasoner's forward fixpoint: two facts with
 * the same predicate, arity, and SameValueZero-equal terms share a key (so a
 * NaN-term fact derives once and ±0 collapse keeping the first), while
 * confidence never enters the key. Each part — the predicate, the stringified
 * arity, and every {@link termToKey} — is length-prefixed (`length + ':' + part`)
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
 * string term on either side (pattern or candidate) is a variable that binds to
 * the opposite term (the `'?'` prefix is kept in the binding key), while
 * consistency is enforced within the match — a variable seen twice must bind the
 * same value (raw `!==`) or the whole match fails. A predicate mismatch or an
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

	const bindings = new Map<string, unknown>()

	for (const [index, patternTerm] of pattern.terms.entries()) {
		const factTerm = candidate.terms[index]

		if (isString(patternTerm) && patternTerm.startsWith('?')) {
			if (bindings.has(patternTerm)) {
				if (bindings.get(patternTerm) !== factTerm) return undefined
			} else {
				bindings.set(patternTerm, factTerm)
			}
		} else if (isString(factTerm) && factTerm.startsWith('?')) {
			if (bindings.has(factTerm)) {
				if (bindings.get(factTerm) !== patternTerm) return undefined
			} else {
				bindings.set(factTerm, patternTerm)
			}
		} else if (patternTerm !== factTerm) {
			return undefined
		}
	}

	return Object.fromEntries(bindings)
}

/**
 * Substitutes a fact's bound `'?'`-variables with their values — a fresh fact
 * with unbound terms passed through unchanged.
 *
 * @remarks
 * The pattern-instantiation step of the inferential reasoner: a `'?'`-prefixed
 * string term that is present in `bindings` is replaced by its bound value;
 * every other term (constants and unbound variables alike) is kept verbatim. The
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
		if (isString(term) && term.startsWith('?') && term in bindings) {
			return bindings[term]
		}
		return term
	})
	return { ...fact, terms }
}

/**
 * Computes the confidence a set of matched premises contributes to a derived
 * fact — the product of each premise's first matching fact's confidence.
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
	return Iterator.from(premises).reduce((confidence, premise) => {
		const instantiated = instantiateFact(premise, bindings)
		for (const candidate of index.get(factToArityKey(premise)) ?? []) {
			if (matchFacts(instantiated, candidate)) {
				return confidence * (candidate.confidence ?? DEFAULT_CONFIDENCE)
			}
		}
		return confidence
	}, 1)
}

/**
 * Projects a subject's scalar fields into `has(key, value)` base facts — the
 * inferential reasoner's subject-injection step.
 *
 * @remarks
 * Every own subject field except `id` becomes a `has(key, value)` fact at full
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
	const rows = Object.keys(subject).flatMap((key) => {
		if (key === 'id') return []
		const value = subject[key]
		if (value === undefined || value === null) return []
		if (isObject(value)) return []

		const fact: Fact = {
			id: `subject:${key}`,
			predicate: 'has',
			terms: [key, value],
			confidence: DEFAULT_CONFIDENCE,
		}
		return [{ fact, trace: `Subject field "${key}" → has(${key}, ${String(value)})` }]
	})
	return {
		facts: rows.map((row) => row.fact),
		trace: [
			...rows.map((row) => row.trace),
			...(rows.length > 0 ? [`Injected ${rows.length} fact(s) from subject`] : []),
		],
	}
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
	const bound = new Set(
		Iterator.from(inference.premises).flatMap((premise) =>
			Iterator.from(premise.terms).filter((term) => isString(term) && term.startsWith('?')),
		),
	)
	return [
		...new Set(
			Iterator.from(inference.conclusion.terms).filter(
				(term): term is string => isString(term) && term.startsWith('?') && !bound.has(term),
			),
		),
	]
}

// === Symbolic algebra machinery

/**
 * Determines whether a symbolic expression contains an unbound occurrence of a
 * target variable.
 *
 * @remarks
 * The variable-presence probe of the symbolic reasoner's isolation: a `variable`
 * node matches only when its name is `target` and `target` is not already in
 * `bindings` (a pre-bound target is a known value, not an unknown to isolate); a
 * `constant` never matches; an `operation` recurses into both operands (the
 * `right` operand may be absent on a unary node). The walk is an iterative
 * worklist (never recursive) with short-circuit `true` on the first hit, so it
 * stays total on pathologically deep expression trees.
 *
 * @param expression - The expression to probe
 * @param target - The variable name being sought
 * @param bindings - The known bindings (a bound target does not count as present)
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
 * Inverts a `x op right = value` step, solving for the left operand `x`.
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
			// `x / 0 = value` has no solution — NaN (uniform with the other
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
 * Inverts a `left op x = value` step, solving for the right operand `x`.
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
 * unchecked; the only throwing path is the unknown-operator default, which
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
 * an iterative explicit-stack traversal (never recursive), so it stays total on
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
		const length = operands.length
		for (const offset of iterateIndices(() => length)) {
			const index = length - 1 - offset
			const operand = operands[index]
			if (operand !== undefined) stack.push(operand)
		}
	}

	return atoms
}

/**
 * Flattens a logical conclusion expression into its asserted `field = value`
 * pairs, ignoring the connectives.
 *
 * @remarks
 * The conclusion-extraction step of the logical reasoner's chaining: every
 * `atom` inside the expression asserts its `formatField(check.field) =
 * check.value` pair, and compounds are walked without regard to the connective
 * (an atom under `not` / `or` is asserted the same way). A later operand wins on
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
 * Builds the empty, type-shaped failure {@link ReasonResult} matching a
 * definition's reasoning.
 *
 * @remarks
 * The `bail: false` fallback of the `Reason` orchestrator: when a reasoner
 * throws and bail is off, the throw becomes an empty failure result carrying the
 * message as its sole `errors` entry. Each reasoning gets its own zero-valued
 * shape (`quantitative` → `value: 0` / empty `groups`; `logical` → `state:
 * 'unread'` / empty `rules`; `symbolic` → empty `solutions`; `inferential` → empty
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
 * // { reasoning: 'logical', state: 'unread', rules: [], count: 0, success: false, trace: [], errors: ['boom'], unread: [] }
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
				faults: [],
				repairs: [],
				defaulted: [],
			}
		case 'logical':
			return {
				reasoning: 'logical',
				conclusion: 'unread',
				rules: [],
				count: 0,
				success: false,
				trace: [],
				errors: [message],
				faults: [],
				repairs: [],
				defaulted: [],
			}
		case 'symbolic':
			return {
				reasoning: 'symbolic',
				solutions: {},
				success: false,
				trace: [],
				errors: [message],
				faults: [],
				repairs: [],
				defaulted: [],
			}
		case 'inferential':
			return {
				reasoning: 'inferential',
				derived: [],
				success: false,
				trace: [],
				errors: [message],
				faults: [],
				repairs: [],
				defaulted: [],
			}
	}
}

/**
 * Builds the empty failure result for a subject the door refused.
 *
 * @param definition - The definition whose reasoning shapes the result
 * @param admission - The refusal
 * @returns A failure result carrying the refusal's errors and faults
 *
 * @example
 * ```ts
 * import { buildRefusedResult, createLogicalDefinition } from '@src/core'
 *
 * const refusal = { faults: [], repairs: [], defaulted: [], errors: ['no'] }
 * buildRefusedResult(createLogicalDefinition('d', 'd', []), refusal).errors // ['no']
 * ```
 */
export function buildRefusedResult(
	definition: Definition,
	admission: SubjectAdmission,
): ReasonResult {
	const { faults, errors } = admission
	return { ...buildErrorResult(definition, ''), faults, errors }
}

/**
 * Collects each conclusion key with the rules that conclude it.
 *
 * @param rules - The rules to read, disabled ones excluded by the caller
 * @returns A fresh map from each flattened key to its concluding rules, in authored order
 *
 * @example
 * ```ts
 * import { collectConcluders, createAtom, createRule } from '@src/core'
 *
 * const rule = createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true))
 * collectConcluders([rule]).get('adult') // [rule]
 * ```
 */
export function collectConcluders(rules: readonly Rule[]): ReadonlyMap<string, readonly Rule[]> {
	const concluders = new Map<string, Rule[]>()
	for (const rule of rules) {
		for (const key of Object.keys(extractConclusions(rule.conclusion))) {
			const known = concluders.get(key)
			if (known === undefined) concluders.set(key, [rule])
			else known.push(rule)
		}
	}
	return concluders
}

/**
 * Finds the conclusion keys a subject supplies itself, which would let it assert what a
 * rule has to derive.
 *
 * @param rules - The enabled rules
 * @param subject - The subject to check
 * @returns The flattened keys the subject holds a value for, in authored order, once each
 *
 * @example
 * ```ts
 * import { createAtom, createRule, findSuppliedConclusions } from '@src/core'
 *
 * const rule = createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true))
 * findSuppliedConclusions([rule], { age: 15, adult: true }) // ['adult']
 * findSuppliedConclusions([rule], { age: 15 })              // []
 * ```
 */
export function findSuppliedConclusions(
	rules: readonly Rule[],
	subject: Subject,
): readonly string[] {
	const supplied = rules.flatMap((rule) =>
		extractAtoms(rule.conclusion).flatMap((atom) => {
			const key = formatField(atom.check.field)
			const held =
				Object.hasOwn(subject, key) || resolveField(subject, atom.check.field) !== undefined
			return held ? [key] : []
		}),
	)
	return [...new Set(supplied)]
}

/**
 * Finds the conclusion keys on a cycle through negation, which no order of evaluation
 * can settle.
 *
 * @remarks
 * A rule reading key `r` and concluding key `c` is an edge from `r` to `c`, negative
 * when the read sits under an odd number of negations: the `not` connective, the
 * antecedent of `implies`, either side of `xor`, or the `not` and `none` comparisons. A
 * negative edge on a cycle makes the answer depend on visit order, so forward refuses it
 * at run time and backward would settle it silently. A key on any cycle through such an
 * edge is reported, whichever rule wrote it.
 *
 * @param rules - The enabled rules
 * @returns The keys on such a cycle, in authored order, once each
 *
 * @example
 * ```ts
 * import { createAtom, createCompound, createRule, findNegativeCycles } from '@src/core'
 *
 * findNegativeCycles([
 * 	createRule('a', [createCompound('not', [createAtom('b', 'equals', true)])], createAtom('a', 'equals', true)),
 * 	createRule('b', [createCompound('not', [createAtom('a', 'equals', true)])], createAtom('b', 'equals', true)),
 * ]) // ['a', 'b']
 * ```
 */
export function findNegativeCycles(rules: readonly Rule[]): readonly string[] {
	const concluded = collectConcluders(rules)
	const edges = rules.flatMap((rule) => {
		const targets = Object.keys(extractConclusions(rule.conclusion))
		return rule.premises.flatMap((premise) =>
			collectPolarReads(premise, false).flatMap((read) =>
				concluded.has(read.key)
					? targets.map((target) => ({ from: read.key, to: target, negated: read.negated }))
					: [],
			),
		)
	})
	const forward = edges.map((edge): readonly [string, string] => [edge.from, edge.to])
	const reverse = edges.map((edge): readonly [string, string] => [edge.to, edge.from])
	const cyclic = new Set(
		edges.flatMap((edge) => {
			if (!edge.negated) return []
			const behind = collectReachable(edge.from, reverse)
			return [...collectReachable(edge.to, forward)].filter((key) => behind.has(key))
		}),
	)
	return [...concluded.keys()].filter((key) => cyclic.has(key))
}

/**
 * Collects every node a list of directed edges reaches from a start, the start included.
 *
 * @param start - The node to walk from
 * @param edges - The edges, each `[from, to]`
 * @returns A fresh set of the nodes reached
 *
 * @example
 * ```ts
 * import { collectReachable } from '@src/core'
 *
 * collectReachable('a', [['a', 'b'], ['b', 'c'], ['x', 'a']]) // Set { 'a', 'b', 'c' }
 * ```
 */
export function collectReachable(
	start: string,
	edges: ReadonlyArray<readonly [string, string]>,
): ReadonlySet<string> {
	const reached = new Set([start])
	for (const key of reached) {
		for (const edge of edges) if (edge[0] === key) reached.add(edge[1])
	}
	return reached
}

/**
 * Collects every key an expression reads with the polarity of that read.
 *
 * @param expression - The expression to walk
 * @param negated - Whether the expression itself sits under an odd number of negations
 * @returns One entry per atom, a `xor` operand contributing both polarities
 *
 * @example
 * ```ts
 * import { collectPolarReads, createAtom, createCompound } from '@src/core'
 *
 * collectPolarReads(createCompound('not', [createAtom('a', 'equals', true)]), false)
 * // [{ key: 'a', negated: true }]
 * ```
 */
export function collectPolarReads(expression: Expression, negated: boolean): readonly PolarRead[] {
	if (expression.form === 'atom') {
		const flipped = expression.check.operator === 'not' || expression.check.operator === 'none'
		return [{ key: formatField(expression.check.field), negated: flipped ? !negated : negated }]
	}
	const operator = expression.operator
	return expression.operands.flatMap((operand, index) => {
		if (operator === 'not') return collectPolarReads(operand, !negated)
		if (operator === 'implies' && index === 0) return collectPolarReads(operand, !negated)
		if (operator === 'xor') {
			return [...collectPolarReads(operand, negated), ...collectPolarReads(operand, !negated)]
		}
		return collectPolarReads(operand, negated)
	})
}

// === Faults

/**
 * Describes a fault as one `errors` entry.
 *
 * @param fault - The fault
 * @returns The message
 *
 * @example
 * ```ts
 * import { describeFault } from '@src/core'
 *
 * describeFault({ reason: 'missing', path: 'age', expected: 'number' }) // 'Field "age" is missing'
 * describeFault({ reason: 'extra', path: ['agee'] })                    // 'Field "agee" is not declared'
 * ```
 */
export function describeFault(fault: AuditFault): string {
	const field = formatField(fault.path)
	switch (fault.reason) {
		case 'missing':
			return `Field "${field}" is missing`
		case 'type':
			return `Field "${field}" expected ${fault.expected}, received ${fault.received}`
		case 'constraint':
			return `Field "${field}" breaks its ${fault.constraint} constraint, received ${fault.received}`
		case 'variant':
			return `Field "${field}" matches none of its ${String(fault.variants)} variants`
		case 'oneOf':
			return `Field "${field}" matches ${String(fault.matched)} of its variants, not exactly one`
		case 'extra':
			return `Field "${field}" is not declared`
	}
}

/**
 * Builds the fault for a field the engine could not read.
 *
 * @param path - The field
 * @param expected - What the reader needed
 * @param actual - What the field held
 * @returns A `missing` fault when the field is absent, otherwise a `type` fault
 *
 * @example
 * ```ts
 * import { valueToFault } from '@src/core'
 *
 * valueToFault('age', 'number', undefined) // { reason: 'missing', path: 'age', expected: 'number' }
 * valueToFault('age', 'number', 'old')     // { reason: 'type', path: 'age', expected: 'number', received: '"old"' }
 * ```
 */
export function valueToFault(path: FieldPath, expected: FaultKind, actual: unknown): AuditFault {
	return actual === undefined
		? { reason: 'missing', path, expected }
		: { reason: 'type', path, expected, received: preview(actual) }
}

/**
 * Names what a check needed from its field, for the fault an unread read becomes.
 *
 * @remarks
 * Ordering and range need a number. Equality needs the expected value's kind. Membership
 * needs the elements' kind, or `union` when they differ.
 *
 * @param check - The check
 * @returns The kind of value that would have read
 *
 * @example
 * ```ts
 * import { createCheck, readExpectedKind } from '@src/core'
 *
 * readExpectedKind(createCheck('a', 'above', 1))        // 'number'
 * readExpectedKind(createCheck('a', 'equals', 'x'))     // 'string'
 * readExpectedKind(createCheck('a', 'any', ['x', 1]))   // 'union'
 * ```
 */
export function readExpectedKind(check: Check): FaultKind {
	switch (check.operator) {
		case 'equals':
		case 'not':
			return valueToKind(check.value)
		case 'any':
		case 'none': {
			const kinds = new Set(isArray(check.value) ? check.value.map(valueToKind) : [])
			const [only] = kinds
			return kinds.size === 1 && only !== undefined ? only : 'union'
		}
		default:
			return 'number'
	}
}

/**
 * Names the fault kind of a JSON value.
 *
 * @param value - The value
 * @returns `null`, `string`, `boolean`, or `number` for a primitive, otherwise `json`
 *
 * @example
 * ```ts
 * import { valueToKind } from '@src/core'
 *
 * valueToKind(null) // 'null'
 * valueToKind(1)    // 'number'
 * valueToKind({})   // 'json'
 * ```
 */
export function valueToKind(value: unknown): FaultKind {
	if (isNull(value)) return 'null'
	if (isString(value)) return 'string'
	if (isBoolean(value)) return 'boolean'
	return isNumber(value) ? 'number' : 'json'
}

/**
 * Returns the faults of a list once per field, compared by the flattened path.
 *
 * @param faults - The faults, repeats allowed
 * @returns The first fault of each field, in order
 *
 * @example
 * ```ts
 * import { filterUniqueFaults } from '@src/core'
 *
 * const fault = { reason: 'extra', path: 'a' } as const
 * filterUniqueFaults([fault, fault]) // [fault]
 * ```
 */
export function filterUniqueFaults(faults: readonly AuditFault[]): readonly AuditFault[] {
	return faults.filter(
		(fault, index) =>
			faults.findIndex((other) => formatField(other.path) === formatField(fault.path)) === index,
	)
}

// === The JSON projection

/**
 * Projects any value to JSON: a non-finite number becomes `null`, and what JSON cannot hold is
 * dropped.
 *
 * @remarks
 * `undefined`, a function, a symbol, a bigint, and an object that is not a plain record have no
 * JSON form, so a key holding one is omitted and an array slot holding one is `null`. A value
 * past `GUARD_DEPTH_LIMIT` is dropped the same way, so a cycle cannot run away.
 *
 * @param value - The value to project
 * @param depth - How deep the walk already is
 * @returns The JSON value, or `undefined` when it has no JSON form
 *
 * @example
 * ```ts
 * import { projectValue } from '@src/core'
 *
 * projectValue({ a: Number.NaN, b: undefined, c: [1, undefined] }) // { a: null, c: [1, null] }
 * ```
 */
export function projectValue(value: unknown, depth = 0): JSONValue | undefined {
	if (isNull(value) || isString(value) || isBoolean(value)) return value
	if (isNumber(value)) return isFiniteNumber(value) ? value : null
	if (depth >= GUARD_DEPTH_LIMIT) return undefined
	if (isArray(value)) return value.map((entry) => projectValue(entry, depth + 1) ?? null)
	if (!isRecord(value)) return undefined
	return Object.fromEntries(
		Object.entries(value).flatMap(([key, entry]) => {
			const projected = projectValue(entry, depth + 1)
			return projected === undefined ? [] : [[key, projected]]
		}),
	)
}

/**
 * Projects a result to the JSON its contract reads.
 *
 * @remarks
 * The engine publishes `NaN` by design and a check's `actual` holds whatever the subject held,
 * so a result crosses a boundary as this projection, and the in-memory result and its guard
 * stay as they are.
 *
 * @param result - The result
 * @returns Its JSON projection, which `resultContract` admits
 *
 * @example
 * ```ts
 * import { createLogicalDefinition, createLogicalReasoner, projectResult, resultContract } from '@src/core'
 *
 * const result = createLogicalReasoner().reason({}, createLogicalDefinition('d', 'd', []))
 * resultContract.is(projectResult(result)) // true
 * ```
 */
export function projectResult(result: ReasonResult): JSONValue | undefined {
	return projectValue(result)
}

// === The door's rules

/**
 * Determines whether a `parse` coercion kept everything the value said.
 *
 * @remarks
 * Only a `type` fault can be a repair. A number needs a string whose trim is the number's
 * own text, so `'30'` and `' 30 '` pass and `'30.0'`, `'007'`, `'0x10'`, `'1e3'`, and
 * `'9007199254740993'` do not. A boolean needs `'true'` or `'false'`, a literal its trimmed
 * text, and a string a finite number.
 *
 * @param fault - The fault `audit` reported
 * @param subject - The subject as it arrived
 * @param parsed - What `parse` made of it
 * @returns True if the repair loses nothing; false otherwise
 *
 * @example
 * ```ts
 * import { isLosslessRepair } from '@src/core'
 *
 * const fault = { reason: 'type', path: ['a'], expected: 'number', received: '' } as const
 * isLosslessRepair(fault, { a: ' 30 ' }, { a: 30 })  // true
 * isLosslessRepair(fault, { a: '30.0' }, { a: 30 })  // false
 * ```
 */
export function isLosslessRepair(fault: AuditFault, subject: Subject, parsed: Subject): boolean {
	if (fault.reason !== 'type') return false
	const raw = resolveField(subject, fault.path)
	const value = resolveField(parsed, fault.path)
	switch (fault.expected) {
		case 'number':
		case 'integer':
		case 'literal':
			return isString(raw) && value !== undefined && raw.trim() === String(value)
		case 'boolean':
			return raw === 'true' || raw === 'false'
		case 'string':
			return isFiniteNumber(raw)
		default:
			return false
	}
}

/**
 * Lists the paths `parse` filled: absent or `undefined` in the input and present in the output.
 *
 * @remarks
 * Computed by that difference over object and array nesting rather than from a shape walk, so
 * it reports what `parse` did.
 *
 * @param input - The value as it arrived
 * @param parsed - What `parse` made of it
 * @param path - The path walked so far
 * @returns The filled paths, each an array of keys
 *
 * @example
 * ```ts
 * import { findFilledPaths } from '@src/core'
 *
 * findFilledPaths({ a: 1 }, { a: 1, b: 2 })             // [['b']]
 * findFilledPaths({ o: {} }, { o: { c: 3 } })           // [['o', 'c']]
 * findFilledPaths({ a: 1 }, { a: 1 })                   // []
 * ```
 */
export function findFilledPaths(
	input: unknown,
	parsed: unknown,
	path: readonly string[] = [],
): readonly FieldPath[] {
	if (!isObject(parsed)) return []
	return Object.keys(parsed).flatMap((key) => {
		const inner = [...path, key]
		const supplied =
			isObject(input) && Object.hasOwn(input, key) ? Reflect.get(input, key) : undefined
		return supplied === undefined
			? [inner]
			: findFilledPaths(supplied, Reflect.get(parsed, key), inner)
	})
}

// === Reading a shape

/**
 * Finds what a shape says about a field path.
 *
 * @remarks
 * A string is one key and an array descends, as a {@link Check} reads it. An `optional`
 * wrapper is removed and a `nullable` one is kept at the leaf, because `null` is a value the
 * field admits.
 *
 * @param shape - The shape to read
 * @param path - The field path
 * @returns What the shape says, see {@link ShapeRead}
 *
 * @example
 * ```ts
 * import { numberShape, objectShape } from '@orkestrel/contract'
 * import { findFieldShape } from '@src/core'
 *
 * const shape = objectShape({ age: numberShape() })
 * findFieldShape(shape, 'age').declared  // true
 * findFieldShape(shape, 'agee').declared // false
 * ```
 */
export function findFieldShape(shape: ContractShape, path: FieldPath): ShapeRead {
	const keys = isString(path) ? [path] : path
	if (shape.category === 'optional') return findFieldShape(shape.inner, keys)
	const key = keys[0]
	if (key === undefined) return { declared: true, shape }
	const rest = keys.slice(1)
	switch (shape.category) {
		case 'nullable':
			return findFieldShape(shape.inner, keys)
		case 'object': {
			const property = Object.hasOwn(shape.properties, key) ? shape.properties[key] : undefined
			if (property !== undefined) return findFieldShape(property, rest)
			const open = shape.additionalProperties
			if (open === true) return { declared: true }
			return isObject(open) ? findFieldShape(open, rest) : { declared: false }
		}
		case 'array':
			return /^\d+$/.test(key) ? findFieldShape(shape.items, rest) : { declared: false }
		case 'union':
		case 'raw':
		case 'json':
			return { declared: true }
		default:
			return { declared: false }
	}
}

/**
 * Determines whether a field's shape leaves its value untyped, which a `raw` or `json` node does.
 *
 * @param shape - The field's shape, absent when a path ran into something that says nothing
 * @returns True for a `raw` or `json` shape; false otherwise
 *
 * @example
 * ```ts
 * import { jsonShape, numberShape } from '@orkestrel/contract'
 * import { isUntypedShape } from '@src/core'
 *
 * isUntypedShape(jsonShape())   // true
 * isUntypedShape(numberShape()) // false
 * ```
 */
export function isUntypedShape(shape: ContractShape | undefined): boolean {
	return shape?.category === 'raw' || shape?.category === 'json'
}

/**
 * Determines whether a shape admits a string as one of its closed values.
 *
 * @param shape - The field's shape
 * @param value - The string
 * @returns True if a `literal` reachable through `nullable` or `union` holds it; false otherwise
 *
 * @example
 * ```ts
 * import { literalShape, stringShape } from '@orkestrel/contract'
 * import { admitsLiteral } from '@src/core'
 *
 * admitsLiteral(literalShape(['FL', 'CA']), 'FL') // true
 * admitsLiteral(stringShape(), 'FL')              // false
 * ```
 */
export function admitsLiteral(shape: ContractShape, value: string): boolean {
	switch (shape.category) {
		case 'literal':
			return shape.values.includes(value)
		case 'nullable':
			return admitsLiteral(shape.inner, value)
		case 'union':
			return shape.variants.some((variant) => admitsLiteral(variant, value))
		default:
			return false
	}
}

/**
 * Scans a shape for what cannot stand in a definition.
 *
 * @remarks
 * The subject is a record, so the root is an object. A `pattern` refuses, because it does not
 * survive JSON and a definition must. A required key carrying a `default` refuses, because
 * the keyword is only an annotation there.
 *
 * @param shape - The shape to scan
 * @param path - The path walked so far
 * @param required - Whether a key the shape requires holds this node
 * @returns The messages naming each fault, empty when the shape can stand
 *
 * @example
 * ```ts
 * import { numberShape, objectShape, stringShape } from '@orkestrel/contract'
 * import { scanShape } from '@src/core'
 *
 * scanShape(objectShape({ age: numberShape() }))                    // []
 * scanShape(objectShape({ a: stringShape({ pattern: /x/ }) })).length // 1
 * scanShape(numberShape()).length                                   // 1
 * ```
 */
export function scanShape(
	shape: ContractShape,
	path: readonly string[] = [],
	required = false,
): readonly string[] {
	const field = path.join('.')
	const root =
		path.length === 0 && shape.category !== 'object' ? ['Shape must describe an object'] : []
	switch (shape.category) {
		case 'string':
			return shape.pattern === undefined
				? root
				: [...root, `Field "${field}" carries a pattern, which does not survive JSON`]
		case 'optional':
			return [...root, ...scanShape(shape.inner, path)]
		case 'nullable':
			return [...root, ...scanShape(shape.inner, path, required)]
		case 'array':
			return [...root, ...scanShape(shape.items, path)]
		case 'union':
			return [...root, ...shape.variants.flatMap((variant) => scanShape(variant, path))]
		case 'object':
			return [
				...root,
				...Object.entries(shape.properties).flatMap(([key, property]) =>
					scanShape(property, [...path, key], property.category !== 'optional'),
				),
				...(isObject(shape.additionalProperties)
					? scanShape(shape.additionalProperties, path)
					: []),
			]
		case 'raw':
			return required && Object.hasOwn(shape.schema, 'default')
				? [...root, `Field "${field}" is required and carries a default`]
				: root
		default:
			return root
	}
}

/**
 * Scans what a definition reads against its shape.
 *
 * @remarks
 * Every path read is in the shape or in `known`, the keys the definition produces itself. A
 * check's expected value satisfies the field's shape, per element for a list, and a string one
 * needs a field that admits it as a literal, because free text is never compared by equality.
 * A `raw` or `json` field read is a warning, since the typed read is then the only guard.
 *
 * @param shape - The definition's shape
 * @param checks - The checks the definition evaluates
 * @param fields - The other fields it reads
 * @param known - The keys it produces itself, flattened
 * @returns The errors and warnings found
 *
 * @example
 * ```ts
 * import { numberShape, objectShape } from '@orkestrel/contract'
 * import { createCheck, scanShapeReads } from '@src/core'
 *
 * const shape = objectShape({ age: numberShape() })
 * scanShapeReads(shape, [createCheck('age', 'above', 18)], [], new Set()).errors  // []
 * scanShapeReads(shape, [createCheck('agee', 'above', 18)], [], new Set()).errors.length // 1
 * ```
 */
export function scanShapeReads(
	shape: ContractShape,
	checks: readonly Check[],
	fields: readonly FieldPath[],
	known: ReadonlySet<string>,
): ShapeScan {
	const reads = [...checks.map((check) => check.field), ...fields]
		.map((field) => ({ name: formatField(field), read: findFieldShape(shape, field) }))
		.filter(({ name }) => !known.has(name))
	return {
		errors: [
			...new Set([
				...reads
					.filter(({ read }) => !read.declared)
					.map(({ name }) => `Field "${name}" is read, and the shape does not declare it`),
				...checks.flatMap((check) => scanCheckExpected(shape, check, known)),
			]),
		],
		warnings: [
			...new Set(
				reads
					.filter(({ read }) => isUntypedShape(read.shape))
					.map(({ name }) => `Field "${name}" is read through a shape that types nothing`),
			),
		],
	}
}

/**
 * Scans a check's expected value against the shape of the field it reads.
 *
 * @param shape - The definition's shape
 * @param check - The check
 * @param known - The keys the definition produces itself, flattened
 * @returns The messages naming each fault, empty when the value fits or nothing can be said
 *
 * @example
 * ```ts
 * import { numberShape, objectShape } from '@orkestrel/contract'
 * import { createCheck, scanCheckExpected } from '@src/core'
 *
 * const shape = objectShape({ age: numberShape() })
 * scanCheckExpected(shape, createCheck('age', 'above', 18), new Set())   // []
 * scanCheckExpected(shape, createCheck('age', 'equals', '18'), new Set()).length // 1
 * ```
 */
export function scanCheckExpected(
	shape: ContractShape,
	check: Check,
	known: ReadonlySet<string>,
): readonly string[] {
	const name = formatField(check.field)
	if (known.has(name)) return []
	const field = findFieldShape(shape, check.field).shape
	if (field === undefined || isUntypedShape(field)) return []
	const contract = createContract(field)
	const values: readonly unknown[] = isArray(check.value) ? check.value : [check.value]
	return values.flatMap((value) => {
		if (!contract.is(value))
			return [`Check on "${name}": ${preview(value)} is not a value of this field`]
		return isString(value) && !admitsLiteral(field, value)
			? [`Check on "${name}": a string compares only against a field that declares it as a literal`]
			: []
	})
}

/**
 * Scans a shape for a key the rules conclude, which a subject may not supply.
 *
 * @param shape - The definition's shape
 * @param rules - The definition's rules
 * @returns One message per declared conclusion key
 *
 * @example
 * ```ts
 * import { booleanShape, objectShape } from '@orkestrel/contract'
 * import { createAtom, createRule, scanShapeConclusions } from '@src/core'
 *
 * const rule = createRule('r', [createAtom('a', 'equals', 1)], createAtom('ok', 'equals', true))
 * scanShapeConclusions(objectShape({ ok: booleanShape() }), [rule]) // ['Shape declares conclusion "ok"']
 * ```
 */
export function scanShapeConclusions(
	shape: ContractShape,
	rules: readonly Rule[],
): readonly string[] {
	const declared = rules.flatMap((rule) =>
		extractAtoms(rule.conclusion).flatMap((atom) =>
			findFieldShape(shape, atom.check.field).shape === undefined
				? []
				: [`Shape declares conclusion "${formatField(atom.check.field)}"`],
		),
	)
	return [...new Set(declared)]
}

// === Scanning definitions for what `validate` refuses

/**
 * Scans a check for an expected value its comparison cannot use.
 *
 * @param check - The check to scan
 * @returns The messages naming each fault, empty when the check is well formed
 *
 * @example
 * ```ts
 * import { createCheck, scanCheck } from '@src/core'
 *
 * scanCheck(createCheck('age', 'above', 18))   // []
 * scanCheck(createCheck('age', 'above', '18')).length // 1
 * ```
 */
export function scanCheck(check: Check): readonly string[] {
	const field = formatField(check.field)
	switch (check.operator) {
		case 'equals':
		case 'not':
			return isComparable(check.value)
				? []
				: [
						`Check on "${field}": "${check.operator}" needs a finite number, a string, a boolean, or null`,
					]
		case 'above':
		case 'below':
		case 'from':
		case 'to':
			return isFiniteNumber(check.value)
				? []
				: [`Check on "${field}": "${check.operator}" needs a finite number`]
		case 'any':
		case 'none':
			return isMembership(check.value)
				? []
				: [`Check on "${field}": "${check.operator}" needs a non-empty list of comparable values`]
		default:
			return isRange(check.value)
				? []
				: [
						`Check on "${field}": "${check.operator}" needs [minimum, maximum] of finite numbers in order`,
					]
	}
}

/**
 * Scans a premise expression for a wrong connective arity and a malformed check.
 *
 * @param expression - The expression to scan
 * @returns The messages naming each fault, empty when the expression is well formed
 *
 * @example
 * ```ts
 * import { createAtom, createCompound, scanExpression } from '@src/core'
 *
 * scanExpression(createCompound('and', [createAtom('a', 'equals', 1)])) // []
 * scanExpression(createCompound('and', [])).length                      // 1
 * ```
 */
export function scanExpression(expression: Expression): readonly string[] {
	if (expression.form === 'atom') return scanCheck(expression.check)
	const { operator, operands } = expression
	const arity =
		operator === 'not'
			? operands.length === 1
			: operator === 'implies' || operator === 'xor'
				? operands.length === 2
				: operands.length > 0
	return [
		...(arity ? [] : [`Connective "${operator}" has ${String(operands.length)} operands`]),
		...operands.flatMap((operand) => scanExpression(operand)),
	]
}

/**
 * Scans a rule's conclusion, which may only assert: `equals` atoms under `and`, none of
 * them asserting `false`.
 *
 * @remarks
 * `extractConclusions` ignores connectives and operators, so `not(blocked)` would assert
 * `blocked = true`. `false` is refused because a settled pass writes it to mean "this
 * rule did not fire".
 *
 * @param expression - The conclusion to scan
 * @returns The messages naming each fault, empty when the conclusion is well formed
 *
 * @example
 * ```ts
 * import { createAtom, createCompound, scanConclusion } from '@src/core'
 *
 * scanConclusion(createAtom('ok', 'equals', true))                              // []
 * scanConclusion(createCompound('not', [createAtom('ok', 'equals', true)])).length // 1
 * ```
 */
export function scanConclusion(expression: Expression): readonly string[] {
	if (expression.form === 'compound') {
		return [
			...(expression.operator === 'and' && expression.operands.length > 0
				? []
				: [`A conclusion may only join atoms with "and", not "${expression.operator}"`]),
			...expression.operands.flatMap((operand) => scanConclusion(operand)),
		]
	}
	const { field, operator, value } = expression.check
	const key = formatField(field)
	return [
		...(operator === 'equals'
			? []
			: [`Conclusion on "${key}" must use "equals", not "${operator}"`]),
		...(value === false ? [`Conclusion on "${key}" may not assert false`] : []),
		...(isComparable(value) ? [] : [`Conclusion on "${key}" must assert a comparable value`]),
	]
}

/**
 * Scans a factor for a `fallback` its source cannot use and for malformed checks.
 *
 * @param factor - The factor to scan
 * @returns The messages naming each fault, empty when the factor is well formed
 *
 * @example
 * ```ts
 * import { createFieldFactor, scanFactor } from '@src/core'
 *
 * scanFactor(createFieldFactor('age', 'age'))                       // []
 * scanFactor(createFieldFactor('age', 'age', { fallback: 0 })).length // 1
 * ```
 */
export function scanFactor(factor: Factor): readonly string[] {
	const usable = factor.source.origin === 'lookup' || factor.source.origin === 'range'
	return [
		...(factor.fallback !== undefined && !usable
			? [`Factor "${factor.id}": a "${factor.source.origin}" source cannot use a fallback`]
			: []),
		...(factor.checks ?? []).flatMap((check) => scanCheck(check)),
	]
}

/**
 * Scans a symbolic expression for a binary operation with no right side.
 *
 * @param expression - The expression to scan
 * @returns The messages naming each fault, empty when the expression is well formed
 *
 * @example
 * ```ts
 * import { createConstant, scanSymbolicExpression } from '@src/core'
 *
 * scanSymbolicExpression(createConstant(1))                                                       // []
 * scanSymbolicExpression({ form: 'operation', operator: 'add', left: createConstant(1) }).length // 1
 * ```
 */
export function scanSymbolicExpression(expression: SymbolicExpression): readonly string[] {
	if (expression.form !== 'operation') return []
	const unary = ['round', 'ceil', 'floor', 'abs'].includes(expression.operator)
	return [
		...(unary || expression.right !== undefined
			? []
			: [`Operation "${expression.operator}" has no right side`]),
		...scanSymbolicExpression(expression.left),
		...(expression.right === undefined ? [] : scanSymbolicExpression(expression.right)),
	]
}

/**
 * Collects every variable a symbolic expression reads.
 *
 * @param expression - The expression to walk
 * @returns The variable names, repeats allowed
 *
 * @example
 * ```ts
 * import { collectVariables, createOperation, createVariable } from '@src/core'
 *
 * collectVariables(createOperation('add', createVariable('x'), createVariable('y'))) // ['x', 'y']
 * ```
 */
export function collectVariables(expression: SymbolicExpression): readonly string[] {
	if (expression.form === 'variable') return [expression.name]
	if (expression.form === 'constant') return []
	return [
		...collectVariables(expression.left),
		...(expression.right === undefined ? [] : collectVariables(expression.right)),
	]
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
// separately named functions, and the optional `target` each takes is data — an
// id to anchor on — never a behavior switch. Every primitive is copy-on-write
// (`.claude/rules/typescript.md` § Immutability): the input array is never
// mutated, and a fresh array is always returned.

/**
 * Inserts `item` into an id-keyed collection, deduping any existing element
 * sharing its id, then placing it at the end, or immediately after `target`.
 *
 * @remarks
 * Insertion dedupes on the id first: `filtered` is `items` with every `item.id`
 * twin removed, because an input array may already carry same-id twins.
 * Re-appending an existing id therefore repositions it rather than updating it
 * in place — {@link replaceById} is the position-preserving alternative. With
 * no `target`, `item` lands at the end; with a `target`, it lands immediately
 * after the element whose `id === target` (searched in the deduped array). A
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
 * sharing its id, then placing it at the start, or immediately before `target`.
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
 * Swaps the element sharing `item.id` in place, preserving its position.
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
 * the result is ordered by `incoming`'s id order first (each element resolved
 * through `resolve` when its id also exists in `base`, defaulting to
 * incoming-wins-wholesale), then the `base`-only survivors in `base`'s own
 * order (retained, never deleted — merge is additive). Same-id twins within
 * either input are deduped to their first occurrence.
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

	const merged = new Map<string, T>()
	for (const item of incoming) {
		const query = item.id
		if (merged.has(query)) continue
		const id = item.id
		const existing = baseById.get(item.id)
		merged.set(id, existing === undefined ? item : resolve ? resolve(existing, item) : item)
	}
	for (const item of base) {
		const query = item.id
		if (merged.has(query)) continue
		merged.set(item.id, item)
	}
	return [...merged.values()]
}

// === Quantitative change/extend helpers

/**
 * Inserts `group` into a {@link QuantitativeDefinition}'s `groups` — dedup-then-
 * insert at the end, or immediately after `target`.
 *
 * @remarks
 * Group order is cosmetic (group aggregation is order-independent) but honored
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
 * Swaps the group sharing `group.id` in a {@link QuantitativeDefinition} in
 * place, preserving its position (appended when absent).
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
 * Factor order is load-bearing: the same-priority tiebreak is declaration
 * order ({@link sortByPriority} is a stable ascending sort). Operates on the
 * factor's direct container — compose into a definition through
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
 * Swaps the factor sharing `factor.id` in a {@link FactorGroup} in place,
 * preserving its position (appended when absent).
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
 * Order is load-bearing: the forward conclusion is the last declared
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
 * Swaps the rule sharing `rule.id` in a {@link LogicalDefinition} in place,
 * preserving its position (appended when absent).
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
 * Order is load-bearing: equations solve strictly in order and each rounded
 * solution feeds forward.
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
 * Swaps the equation sharing `equation.id` in a {@link SymbolicDefinition} in
 * place, preserving its position (appended when absent).
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
 * The destructure-rest form omits the key entirely (never sets it to
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
 * `Fact.id` is an authoring label — the runtime content-dedups facts by
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
 * Swaps the fact sharing `fact.id` in an {@link InferentialDefinition} in
 * place, preserving its position (appended when absent).
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
 * Order is load-bearing: backward proving iterates in declaration order and
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
 * in place, preserving its position (appended when absent).
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
// Scalars / value-object fields are incoming-wins-when-present, else base is
// kept — merge never clears, which is what the `clear*` helpers are for.

/**
 * Reconciles two {@link QuantitativeDefinition}s onto `base`'s id.
 *
 * @remarks
 * The merge is additive: a base-only group survives into the result and is
 * never deleted, and a scalar absent from `incoming` keeps its base value —
 * merge never clears a field, which is what {@link clearQuantitativeDefinition}
 * is for. `groups` merges through {@link mergeById}; a matched (same-id) pair of
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
 * The merge is additive: a base-only rule survives into the result and is never
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
 * The merge is additive: a base-only equation or variable survives into the
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
 * The merge is additive: a base-only inference or fact survives into the result
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
// result omits the key entirely (never sets it to `undefined`), keeping the
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
// The subject counterpart of the preceding definition engine — pure helpers over
// a plain record.
// Records are unordered, so there is no `append*`/`prepend*` on a subject
// (mirrors the `addVariable`/`removeVariable` note).

/**
 * Upserts one field of a {@link Subject} — copy-on-write spread.
 *
 * @remarks
 * Named `assignField` rather than `setField` because it returns a fresh subject
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
 * The key is deleted entirely (never set to `undefined`), keeping the result
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
 * same input always produces the same output (run-twice equality) — and emits
 * nothing. `count <= 0` yields an empty array.
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
	return iterateIndices(() => count)
		.map((index) => (isString(baseId) ? { ...subject, id: `${baseId}-${index}` } : { ...subject }))
		.toArray()
}
