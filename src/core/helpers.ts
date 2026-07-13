import type {
	Aggregation,
	Atom,
	Bounds,
	Check,
	Comparison,
	Definition,
	Equation,
	Expression,
	Fact,
	Factor,
	FactorGroup,
	FactorRange,
	FieldPath,
	Inference,
	InferentialDefinition,
	LogicalDefinition,
	LogicalOperator,
	MathOperation,
	QuantitativeDefinition,
	ReasonResult,
	Rule,
	Source,
	Subject,
	SymbolicDefinition,
	SymbolicExpression,
	Transform,
} from './types.js'
import { formatField } from '../helpers.js'
import { isString, parseJSONAs } from '../contracts/index.js'
import { DEFAULT_CONFIDENCE, DEFAULT_PRIORITY } from './constants.js'
import { ReasonError } from './errors.js'
import { isDefinition } from './validators.js'

// Pure builders for the declarative definition vocabulary, plus the module's
// numeric helpers. Every builder returns a fresh, JSON-serializable value and
// OMITS absent optional keys entirely (never sets them to `undefined`), so the
// output round-trips through the exact-record validators (AGENTS §14). Builders
// with an `overrides` bag spread it LAST — an override always wins over a
// default (a `name` defaults to the `id` wherever a display name is required).

// === Checks & expressions

/**
 * Build a {@link Check} — one field predicate.
 *
 * @param field - The subject field to resolve (a string is ONE key; an array descends)
 * @param operator - The comparison to apply
 * @param value - The expected value (any type — the operator decides what is meaningful)
 * @returns A fresh check
 *
 * @example
 * ```ts
 * import { check } from '@src/core'
 *
 * check('age', 'from', 18) // { field: 'age', operator: 'from', value: 18 }
 * ```
 */
export function check(field: FieldPath, operator: Comparison, value: unknown): Check {
	return { field, operator, value }
}

/**
 * Build an atom {@link Expression} — a leaf wrapping one {@link Check}.
 *
 * @param field - The subject field to resolve
 * @param operator - The comparison to apply
 * @param value - The expected value
 * @returns A fresh atom expression
 *
 * @example
 * ```ts
 * import { atom } from '@src/core'
 *
 * atom('age', 'from', 18) // { form: 'atom', check: { field: 'age', operator: 'from', value: 18 } }
 * ```
 */
export function atom(field: FieldPath, operator: Comparison, value: unknown): Expression {
	return { form: 'atom', check: check(field, operator, value) }
}

/**
 * Build a compound {@link Expression} — a logical connective over nested
 * operands.
 *
 * @param operator - The logical connective
 * @param operands - The nested expressions it combines
 * @returns A fresh compound expression
 *
 * @example
 * ```ts
 * import { atom, compound } from '@src/core'
 *
 * compound('and', [atom('age', 'from', 18), atom('state', 'equals', 'CA')])
 * ```
 */
export function compound(operator: LogicalOperator, operands: readonly Expression[]): Expression {
	return { form: 'compound', operator, operands }
}

/**
 * Build a {@link Rule} — premises and a conclusion.
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
 * import { atom, rule } from '@src/core'
 *
 * rule('adult', [atom('age', 'from', 18)], atom('adult', 'equals', true), { priority: 1 })
 * ```
 */
export function rule(
	id: string,
	premises: readonly Expression[],
	conclusion: Expression,
	overrides?: Partial<Omit<Rule, 'id' | 'premises' | 'conclusion'>>,
): Rule {
	return { id, name: id, premises, conclusion, ...overrides }
}

// === Transforms & bounds

/**
 * Build a {@link Transform} — one math step.
 *
 * @remarks
 * The `operand` key is OMITTED when absent (never set to `undefined`), so the
 * transform stays exact-record valid; the transformer then applies its
 * per-operation default (`1` for `multiply` / `divide` / `power`, `0` otherwise).
 *
 * @param operation - The math operation to apply
 * @param operand - The operand (ignored by the unary operations)
 * @returns A fresh transform
 *
 * @example
 * ```ts
 * import { transform } from '@src/core'
 *
 * transform('multiply', 2) // { operation: 'multiply', operand: 2 }
 * transform('round')       // { operation: 'round' }
 * ```
 */
export function transform(operation: MathOperation, operand?: number): Transform {
	return operand === undefined ? { operation } : { operation, operand }
}

/**
 * Build a {@link Bounds} — an inclusive numeric clamp.
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
 * import { bounds } from '@src/core'
 *
 * bounds(0, 100)          // { minimum: 0, maximum: 100 }
 * bounds(undefined, 100)  // { maximum: 100 }
 * ```
 */
export function bounds(minimum?: number, maximum?: number): Bounds {
	return {
		...(minimum === undefined ? {} : { minimum }),
		...(maximum === undefined ? {} : { maximum }),
	}
}

// === Symbolic expressions

/**
 * Build a variable {@link SymbolicExpression} leaf.
 *
 * @param name - The variable name
 * @returns A fresh variable node
 *
 * @example
 * ```ts
 * import { variable } from '@src/core'
 *
 * variable('x') // { form: 'variable', name: 'x' }
 * ```
 */
export function variable(name: string): SymbolicExpression {
	return { form: 'variable', name }
}

/**
 * Build a constant {@link SymbolicExpression} leaf.
 *
 * @param value - The fixed number
 * @returns A fresh constant node
 *
 * @example
 * ```ts
 * import { constant } from '@src/core'
 *
 * constant(42) // { form: 'constant', value: 42 }
 * ```
 */
export function constant(value: number): SymbolicExpression {
	return { form: 'constant', value }
}

/**
 * Build an operation {@link SymbolicExpression} node.
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
 * import { constant, operation, variable } from '@src/core'
 *
 * operation('add', variable('x'), constant(1))
 * operation('abs', variable('x')) // unary — no right operand
 * ```
 */
// A const (not a hoisted function declaration) so `transform`'s `operation`
// parameter above — named for the Transform key it fills — does not shadow it.
export const operation = (
	operator: MathOperation,
	left: SymbolicExpression,
	right?: SymbolicExpression,
): SymbolicExpression => {
	return right === undefined
		? { form: 'operation', operator, left }
		: { form: 'operation', operator, left, right }
}

/**
 * Build an {@link Equation} — `left = right`, solved for `target`.
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
 * import { constant, equation, operation, variable } from '@src/core'
 *
 * // 2x + 3 = 11 — solved for x
 * equation('e1', operation('add', operation('multiply', constant(2), variable('x')), constant(3)), constant(11), 'x')
 * ```
 */
export function equation(
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
 * Build a {@link Fact} — a predicate over positional terms.
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
 * import { fact } from '@src/core'
 *
 * fact('f1', 'human', ['socrates'])        // confidence 1
 * fact('f2', 'laysEggs', ['tweety'], 0.9)  // explicit confidence
 * ```
 */
export function fact(
	id: string,
	predicate: string,
	terms: readonly unknown[],
	confidence?: number,
): Fact {
	return { id, predicate, terms, confidence: confidence ?? DEFAULT_CONFIDENCE }
}

/**
 * Build an {@link Inference} — premise patterns and a conclusion pattern.
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
 * import { fact, inference } from '@src/core'
 *
 * inference('mortal', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x']), { confidence: 0.8 })
 * ```
 */
export function inference(
	id: string,
	premises: readonly Fact[],
	conclusion: Fact,
	overrides?: Partial<Omit<Inference, 'id' | 'premises' | 'conclusion'>>,
): Inference {
	return { id, name: id, premises, conclusion, ...overrides }
}

// === Sources

/**
 * Build a static {@link Source} — a fixed number.
 *
 * @param value - The fixed value
 * @returns A fresh static source
 *
 * @example
 * ```ts
 * import { staticSource } from '@src/core'
 *
 * staticSource(42) // { origin: 'static', value: 42 }
 * ```
 */
export function staticSource(value: number): Source {
	return { origin: 'static', value }
}

/**
 * Build a field {@link Source} — a subject field read as a number.
 *
 * @param field - The subject field to resolve
 * @returns A fresh field source
 *
 * @example
 * ```ts
 * import { fieldSource } from '@src/core'
 *
 * fieldSource(['profile', 'score']) // descends into nested objects
 * ```
 */
export function fieldSource(field: FieldPath): Source {
	return { origin: 'field', field }
}

/**
 * Build a lookup {@link Source} — a subject field mapped through a table.
 *
 * @param field - The subject field to resolve (stringified into a table key)
 * @param table - The lookup table
 * @returns A fresh lookup source
 *
 * @example
 * ```ts
 * import { lookupSource } from '@src/core'
 *
 * lookupSource('state', { CA: 5, NY: 8, TX: 2 })
 * ```
 */
export function lookupSource(field: FieldPath, table: Readonly<Record<string, number>>): Source {
	return { origin: 'lookup', field, table }
}

/**
 * Build a range {@link Source} — a numeric subject field banded through ordered
 * ranges (first match wins).
 *
 * @param field - The subject field to resolve as a number
 * @param ranges - The bands, scanned in order
 * @returns A fresh range source
 *
 * @example
 * ```ts
 * import { bounds, rangeSource } from '@src/core'
 *
 * rangeSource('age', [
 * 	{ bounds: bounds(undefined, 24), value: 30 },
 * 	{ bounds: bounds(25, 64), value: 15 },
 * 	{ bounds: bounds(65), value: 10 },
 * ])
 * ```
 */
export function rangeSource(field: FieldPath, ranges: readonly FactorRange[]): Source {
	return { origin: 'range', field, ranges }
}

// === Factors, groups & definitions

/**
 * Build a {@link Factor} over a static {@link Source}.
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
 * import { staticFactor } from '@src/core'
 *
 * staticFactor('base-rate', 10, { weight: 2 })
 * ```
 */
export function staticFactor(
	id: string,
	value: number,
	overrides?: Partial<Omit<Factor, 'id' | 'source'>>,
): Factor {
	return { id, name: id, source: staticSource(value), ...overrides }
}

/**
 * Build a {@link Factor} over a field {@link Source}.
 *
 * @param id - The factor id
 * @param field - The subject field to resolve as a number
 * @param overrides - Optional {@link Factor} fields merged over the defaults
 * @returns A fresh factor
 *
 * @example
 * ```ts
 * import { fieldFactor, transform } from '@src/core'
 *
 * fieldFactor('income-score', 'income', { transforms: [transform('divide', 1000)], fallback: 0 })
 * ```
 */
export function fieldFactor(
	id: string,
	field: FieldPath,
	overrides?: Partial<Omit<Factor, 'id' | 'source'>>,
): Factor {
	return { id, name: id, source: fieldSource(field), ...overrides }
}

/**
 * Build a {@link Factor} over a lookup {@link Source}.
 *
 * @param id - The factor id
 * @param field - The subject field to resolve (stringified into a table key)
 * @param table - The lookup table
 * @param overrides - Optional {@link Factor} fields merged over the defaults
 * @returns A fresh factor
 *
 * @example
 * ```ts
 * import { lookupFactor } from '@src/core'
 *
 * lookupFactor('state-score', 'state', { CA: 5, NY: 8 }, { fallback: 1 })
 * ```
 */
export function lookupFactor(
	id: string,
	field: FieldPath,
	table: Readonly<Record<string, number>>,
	overrides?: Partial<Omit<Factor, 'id' | 'source'>>,
): Factor {
	return { id, name: id, source: lookupSource(field, table), ...overrides }
}

/**
 * Build a {@link Factor} over a range {@link Source}.
 *
 * @param id - The factor id
 * @param field - The subject field to resolve as a number
 * @param ranges - The bands, scanned in order (first match wins)
 * @param overrides - Optional {@link Factor} fields merged over the defaults
 * @returns A fresh factor
 *
 * @example
 * ```ts
 * import { bounds, rangeFactor } from '@src/core'
 *
 * rangeFactor('age-band', 'age', [{ bounds: bounds(undefined, 24), value: 30 }])
 * ```
 */
export function rangeFactor(
	id: string,
	field: FieldPath,
	ranges: readonly FactorRange[],
	overrides?: Partial<Omit<Factor, 'id' | 'source'>>,
): Factor {
	return { id, name: id, source: rangeSource(field, ranges), ...overrides }
}

/**
 * Build a {@link FactorGroup}.
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
 * import { factorGroup, staticFactor } from '@src/core'
 *
 * factorGroup('g1', 'sum', [staticFactor('f1', 10)], { base: 100 })
 * ```
 */
export function factorGroup(
	id: string,
	aggregation: Aggregation,
	factors: readonly Factor[],
	overrides?: Partial<Omit<FactorGroup, 'id' | 'aggregation' | 'factors'>>,
): FactorGroup {
	return { id, name: id, aggregation, factors, ...overrides }
}

/**
 * Build a {@link QuantitativeDefinition}.
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
 * import { factorGroup, fieldFactor, quantitativeDefinition } from '@src/core'
 *
 * quantitativeDefinition('risk', 'Risk Score', [factorGroup('g1', 'sum', [fieldFactor('age', 'age')])], {
 * 	base: 100,
 * })
 * ```
 */
export function quantitativeDefinition(
	id: string,
	name: string,
	groups: readonly FactorGroup[],
	overrides?: Partial<Omit<QuantitativeDefinition, 'reasoning' | 'id' | 'name' | 'groups'>>,
): QuantitativeDefinition {
	return { reasoning: 'quantitative', id, name, groups, aggregation: 'sum', ...overrides }
}

/**
 * Build a {@link LogicalDefinition}.
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
 * import { atom, logicalDefinition, rule } from '@src/core'
 *
 * logicalDefinition('eligibility', 'Eligibility', [
 * 	rule('adult', [atom('age', 'from', 18)], atom('adult', 'equals', true)),
 * ])
 * ```
 */
export function logicalDefinition(
	id: string,
	name: string,
	rules: readonly Rule[],
	overrides?: Partial<Omit<LogicalDefinition, 'reasoning' | 'id' | 'name' | 'rules'>>,
): LogicalDefinition {
	return { reasoning: 'logical', id, name, rules, strategy: 'forward', ...overrides }
}

/**
 * Build a {@link SymbolicDefinition}.
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
 * import { constant, equation, symbolicDefinition, variable } from '@src/core'
 *
 * symbolicDefinition('rate', 'Rate', [equation('e1', variable('x'), constant(42), 'x')], {
 * 	precision: 2,
 * })
 * ```
 */
export function symbolicDefinition(
	id: string,
	name: string,
	equations: readonly Equation[],
	overrides?: Partial<Omit<SymbolicDefinition, 'reasoning' | 'id' | 'name' | 'equations'>>,
): SymbolicDefinition {
	return { reasoning: 'symbolic', id, name, equations, variables: {}, ...overrides }
}

/**
 * Build an {@link InferentialDefinition}.
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
 * import { fact, inference, inferentialDefinition } from '@src/core'
 *
 * inferentialDefinition('mortality', 'Mortality', [fact('f1', 'human', ['socrates'])], [
 * 	inference('mortal', [fact('p1', 'human', ['?x'])], fact('c1', 'mortal', ['?x'])),
 * ])
 * ```
 */
export function inferentialDefinition(
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

// === Numeric helpers

/**
 * Clamp a number to inclusive {@link Bounds}.
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
 * Round a number to a fixed count of decimal places.
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
 * Determine whether two values are SameValueZero-equal — strict `===` with
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
 * @returns `true` when the values are SameValueZero-equal
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
 * Sort items ascending by `priority ?? DEFAULT_PRIORITY` — a stable copy sort.
 *
 * @remarks
 * The shared evaluation-order helper of the quantitative (factors) and logical
 * (rules) reasoners: lower priorities run first, an absent `priority` defaults
 * to `0`, equal priorities keep DECLARATION order (stable), and the input array
 * is never mutated (AGENTS §11). An array hole, `null`, or other non-record
 * entry is dropped rather than sorted — the output may be shorter than the
 * input.
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
 * Collect the ids that appear MORE THAN ONCE in an id-carrying list — each
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
export function findDuplicates(items: readonly { readonly id: string }[]): readonly string[] {
	const counts = new Map<string, number>()
	for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
	return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id)
}

// === Inferential fact machinery

/**
 * Derive a fact's predicate+arity bucket key — length-prefixed so the
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
 * import { fact, factToArityKey } from '@src/core'
 *
 * factToArityKey(fact('a', 'human', ['x']))          // arity 1
 * factToArityKey(fact('b', 'human', ['x', 'y'])) // arity 2 — distinct key
 * ```
 */
export function factToArityKey(fact: Fact): string {
	const p = fact.predicate
	return `${p.length}:${p} ${fact.terms.length}`
}

/**
 * Bucket facts by predicate+arity, preserving append order within each bucket.
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
 * @returns A fresh `Map` from {@link factToArityKey} to its facts, in append order
 *
 * @example
 * ```ts
 * import { fact, indexByArity } from '@src/core'
 *
 * const index = indexByArity([fact('a', 'human', ['x']), fact('b', 'human', ['y'])])
 * index.get(factToArityKey(fact('c', 'human', ['z'])))?.length // 2
 * ```
 */
export function indexByArity(facts: readonly Fact[]): Map<string, Fact[]> {
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
 * Derive one fact term's contribution to a dedup key — reference identity for
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
 * @param identities - The reference-identity map, threaded across a dedupe pass (mutated: a new object/function is registered)
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
 * Derive a fact's canonical dedup key — predicate + arity + per-term
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
 * @param source - The fact to key
 * @param identities - The reference-identity map threaded across the dedupe pass (see {@link termToKey})
 * @returns The fact's canonical key string
 *
 * @example
 * ```ts
 * import { fact, factToKey } from '@src/core'
 *
 * const identities = new Map<object, number>()
 * // Same predicate + terms → same key regardless of confidence:
 * factToKey(fact('a', 'p', ['x'], 1), identities) === factToKey(fact('b', 'p', ['x'], 0.5), identities)
 * ```
 */
export function factToKey(source: Fact, identities: Map<object, number>): string {
	const parts = [
		source.predicate,
		String(source.terms.length),
		...Array.from(source.terms, (term) => termToKey(term, identities)),
	]
	// Length-prefix every part so the ' ' delimiter cannot be forged by a
	// term string that embeds it — the framing stays injective.
	return parts.map((part) => `${part.length}:${part}`).join(' ')
}

/**
 * Positionally unify a pattern fact against a candidate fact — returning the
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
 * import { fact, matchFacts } from '@src/core'
 *
 * matchFacts(fact('p', 'parent', ['?x', 'bob']), fact('f', 'parent', ['alice', 'bob'])) // { '?x': 'alice' }
 * matchFacts(fact('p', 'parent', ['?x']), fact('f', 'human', ['x']))                     // undefined — predicate
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
 * Substitute a fact's bound `'?'`-variables with their values — a fresh fact
 * with unbound terms passed through unchanged.
 *
 * @remarks
 * The pattern-instantiation step of the inferential reasoner: a `'?'`-prefixed
 * string term that is present in `bindings` is replaced by its bound value;
 * every other term (constants and UNBOUND variables alike) is kept verbatim. The
 * returned fact is a fresh copy (`{ ...fact, terms }`) — the input is never
 * mutated (AGENTS §11).
 *
 * @param source - The fact (or pattern) to instantiate
 * @param bindings - The variable bindings to apply
 * @returns A fresh fact with bound variables substituted
 *
 * @example
 * ```ts
 * import { fact, instantiateFact } from '@src/core'
 *
 * instantiateFact(fact('c', 'mortal', ['?x']), { '?x': 'socrates' }).terms // ['socrates']
 * ```
 */
export function instantiateFact(source: Fact, bindings: Record<string, unknown>): Fact {
	const terms = source.terms.map((term) => {
		if (typeof term === 'string' && term.startsWith('?') && term in bindings) {
			return bindings[term]
		}
		return term
	})
	return { ...source, terms }
}

/**
 * Project a subject's scalar fields into `has(key, value)` base facts — the
 * inferential reasoner's subject-injection step.
 *
 * @remarks
 * Every own subject field EXCEPT `id` becomes a `has(key, value)` fact at full
 * `DEFAULT_CONFIDENCE`; `null` / `undefined` and any `object` (including arrays)
 * value is skipped. Each injection appends a line to `trace` (mutated), plus a
 * final count when at least one fact was produced. The injected fact ids are
 * `subject:<key>`.
 *
 * @param subject - The subject to project
 * @param trace - The trace accumulator to append to (mutated)
 * @returns The fresh `has(...)` facts (in `Object.keys` order)
 *
 * @example
 * ```ts
 * import { subjectToFacts } from '@src/core'
 *
 * const trace: string[] = []
 * subjectToFacts({ id: 'p1', age: 42, tags: ['a'] }, trace) // one fact: has('age', 42) — tags skipped
 * ```
 */
export function subjectToFacts(subject: Subject, trace: string[]): Fact[] {
	const facts: Fact[] = []

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
	return facts
}

/**
 * The `'?'`-prefixed variables an inference's conclusion introduces that no
 * premise binds.
 *
 * @remarks
 * The authoring-time footgun probe behind `InferentialReasoner.validate`'s
 * unbound-variable warning: backward proving establishes each premise
 * independently with no cross-premise binding consistency, so a conclusion
 * term that no premise's `terms` ever names stays uninstantiated in the
 * derived fact. Gathers the `?`-prefixed string terms of `conclusion.terms`,
 * subtracts every `?`-prefixed string term appearing in any premise's
 * `terms`, and returns the remainder once each, in the conclusion's authored
 * order.
 *
 * @param inference - The inference whose conclusion is checked against its premises
 * @returns The unbound conclusion variable names, once each, authored order
 *
 * @example
 * ```ts
 * import { fact, findUnboundVariables, inference } from '@src/core'
 *
 * findUnboundVariables(
 * 	inference('i', 'I', [fact('p', 'human', ['?x'])], fact('c', 'mortal', ['?x', '?y'])),
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
 * Determine whether a symbolic expression contains an UNBOUND occurrence of a
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
 * @returns `true` when an unbound `target` occurs in the expression
 *
 * @example
 * ```ts
 * import { containsVariable, operation, variable, constant } from '@src/core'
 *
 * containsVariable(operation('add', variable('x'), constant(1)), 'x', {})        // true
 * containsVariable(operation('add', variable('x'), constant(1)), 'x', { x: 5 })  // false — pre-bound
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
 * Invert a `x op right = value` step, solving for the LEFT operand `x`.
 *
 * @remarks
 * The left-operand inverse of the symbolic reasoner's isolation: `add` inverts
 * to subtraction, `subtract` to addition, `multiply` to division, `divide` to
 * multiplication. Inversion by zero yields `NaN` (never a throw) — a `multiply`
 * with a zero `right` has no unique solution, and `x / 0 = value` has none
 * either, so both surface `NaN` for the non-finite check to report rather than a
 * bogus value. A non-invertible operator throws (caught per equation upstream).
 *
 * @param operator - The math operation to invert
 * @param value - The known result of `x op right`
 * @param rightValue - The known right operand
 * @returns The isolated left operand (`NaN` on a zero-division inverse)
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
			throw new Error(`Cannot invert operation "${operator}" for left operand`)
	}
}

/**
 * Invert a `left op x = value` step, solving for the RIGHT operand `x`.
 *
 * @remarks
 * The right-operand inverse of the symbolic reasoner's isolation: `add` inverts
 * to `value - left`, `subtract` to `left - value`, `multiply` to `value / left`
 * (with a zero `left` yielding `NaN`), `divide` to `left / value` (with a zero
 * `value` yielding `NaN`). Inversion by zero yields `NaN`, never a throw; a
 * non-invertible operator throws (caught per equation upstream).
 *
 * @param operator - The math operation to invert
 * @param value - The known result of `left op x`
 * @param leftValue - The known left operand
 * @returns The isolated right operand (`NaN` on a zero-division inverse)
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
			throw new Error(`Cannot invert operation "${operator}" for right operand`)
	}
}

/**
 * Apply one binary/unary math operation to already-evaluated operands.
 *
 * @remarks
 * The arithmetic core of the symbolic reasoner's expression evaluation: the full
 * {@link MathOperation} vocabulary plus its zero / unary conventions — `divide`
 * by zero is `NaN` (never a throw), the unary operations (`round` / `ceil` /
 * `floor` / `abs`) ignore `right`, and `percentage` is `left * (right / 100)`.
 * `operator` is typed `string` because untrusted definitions reach here
 * unchecked; the ONE throwing path is the unknown-operator default (caught per
 * equation upstream).
 *
 * @param operator - The operation name (untrusted — an unknown one throws)
 * @param left - The left operand
 * @param right - The right operand (ignored by the unary operations)
 * @returns The operation's result (`NaN` on divide-by-zero)
 *
 * @example
 * ```ts
 * import { applyOperation } from '@src/core'
 *
 * applyOperation('add', 2, 3)     // 5
 * applyOperation('divide', 1, 0)  // NaN
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
			throw new Error(`Unknown operator: ${operator}`)
	}
}

// === Logical conclusion extraction & error results

/**
 * Return every atom leaf of an expression tree, depth-first, left-to-right.
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
 * import { atom, compound, extractAtoms } from '@src/core'
 *
 * extractAtoms(atom('a', 'equals', 1)).length                                   // 1
 * extractAtoms(compound('and', [atom('a', 'equals', 1), atom('b', 'equals', 2)])).length // 2
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
			if (index in operands) stack.push(operands[index])
		}
	}

	return atoms
}

/**
 * Flatten a logical conclusion expression into its asserted `field = value`
 * pairs — connectives IGNORED.
 *
 * @remarks
 * The conclusion-extraction step of the logical reasoner's chaining: every
 * `atom` inside the expression asserts its `formatField(check.field) =
 * check.value` pair, and compounds are walked without regard to the connective
 * (an atom under `not` / `or` is asserted just the same). Later operands WIN on
 * a key clash (`Object.assign` order). Recursion runs through this exported
 * function itself; the derived-overlay keys are `formatField` strings (an array
 * field path flattens to its dot-joined form).
 *
 * @param expression - The conclusion expression to flatten
 * @returns A fresh record of asserted `field → value` pairs
 *
 * @example
 * ```ts
 * import { atom, compound, extractConclusions } from '@src/core'
 *
 * extractConclusions(atom('adult', 'equals', true))                              // { adult: true }
 * extractConclusions(compound('and', [atom('a', 'equals', 1), atom('b', 'equals', 2)])) // { a: 1, b: 2 }
 * ```
 */
export function extractConclusions(expression: Expression): Record<string, unknown> {
	const conclusions: Record<string, unknown> = {}
	for (const leaf of extractAtoms(expression))
		conclusions[formatField(leaf.check.field)] = leaf.check.value
	return conclusions
}

/**
 * The `formatField`-flattened overlay keys an array-path conclusion atom
 * writes ANYWHERE among `rules` that an array-path premise atom also reads
 * ANYWHERE among `rules`.
 *
 * @remarks
 * The cross-rule authoring-time footgun probe behind
 * `LogicalReasoner.validate`'s overlay-key-mismatch warning: a logical
 * conclusion's derived overlay is a FLAT record keyed by
 * `formatField(check.field)` — an array `FieldPath` dot-joins into one string
 * key. A premise that reads the same field via a DOTTED-STRING path resolves
 * that flat key correctly, but a premise that reads it via an ARRAY path
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
 * import { atom, findOverlayMismatches, rule } from '@src/core'
 *
 * findOverlayMismatches([
 * 	rule('a', [], atom(['address', 'city'], 'equals', 'NYC')),
 * 	rule('b', [atom(['address', 'city'], 'equals', 'NYC')], atom('eligible', 'equals', true)),
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
 * Build the empty, type-shaped failure {@link ReasonResult} matching a
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
 * import { buildErrorResult, logicalDefinition } from '@src/core'
 *
 * const result = buildErrorResult(logicalDefinition('e', 'E', []), 'boom')
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

// === Id-keyed collection primitives (PROPOSAL.md §7)
//
// Five exported generic primitives every per-kind change/merge helper below
// composes over. Per AGENTS §4.2.4 no parameter selects behavior: `appendById`
// and `prependById` are separately named functions, and the optional `target`
// each takes is DATA — an id to anchor on — never a behavior switch. Every
// primitive is copy-on-write (AGENTS §11): the input array is never mutated,
// and a fresh array is always returned.

/**
 * Insert `item` into an id-keyed collection, deduping any existing element
 * sharing its id, then placing it at the END (or immediately AFTER `target`).
 *
 * @remarks
 * `filtered` is `items` with every `item.id` twin removed FIRST (dedup-on-
 * insert — input arrays may already carry same-id twins per PROPOSAL.md §7).
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
 * appendById([{ id: 'a' }, { id: 'b' }], { id: 'c' })         // [a, b, c]
 * appendById([{ id: 'a' }, { id: 'b' }], { id: 'c' }, 'a')    // [a, c, b]
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
 * Insert `item` into an id-keyed collection, deduping any existing element
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
 * Swap the element sharing `item.id` IN PLACE, preserving its position.
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
 * Filter every element sharing `id` out of an id-keyed collection.
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
 * Reconcile two id-keyed collections — an incoming-order upsert with
 * base-only survivors appended after.
 *
 * @remarks
 * The Strategic-Merge-Patch-style id-keyed upsert of PROPOSAL.md §6-§7:
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

// === Quantitative change/extend helpers (PROPOSAL.md §8)

/**
 * Insert `group` into a {@link QuantitativeDefinition}'s `groups` — dedup-then-
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
 * import { appendGroup, factorGroup, quantitativeDefinition } from '@src/core'
 *
 * appendGroup(quantitativeDefinition('risk', 'Risk', []), factorGroup('g1', 'sum', []))
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
 * Insert `group` into a {@link QuantitativeDefinition}'s `groups` — dedup-then-
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
 * import { factorGroup, prependGroup, quantitativeDefinition } from '@src/core'
 *
 * prependGroup(quantitativeDefinition('risk', 'Risk', []), factorGroup('g1', 'sum', []))
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
 * Swap the group sharing `group.id` in a {@link QuantitativeDefinition} IN
 * PLACE, preserving its position (appends when absent).
 *
 * @param definition - The definition to update
 * @param group - The replacement group
 * @returns A fresh definition with the group replaced
 *
 * @example
 * ```ts
 * import { factorGroup, quantitativeDefinition, replaceGroup } from '@src/core'
 *
 * const definition = quantitativeDefinition('risk', 'Risk', [factorGroup('g1', 'sum', [])])
 * replaceGroup(definition, factorGroup('g1', 'product', []))
 * ```
 */
export function replaceGroup(
	definition: QuantitativeDefinition,
	group: FactorGroup,
): QuantitativeDefinition {
	return { ...definition, groups: replaceById(definition.groups, group) }
}

/**
 * Remove every group sharing `id` from a {@link QuantitativeDefinition}
 * (no-op when absent).
 *
 * @param definition - The definition to update
 * @param id - The group id to remove
 * @returns A fresh definition with the group removed
 *
 * @example
 * ```ts
 * import { factorGroup, quantitativeDefinition, removeGroup } from '@src/core'
 *
 * const definition = quantitativeDefinition('risk', 'Risk', [factorGroup('g1', 'sum', [])])
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
 * Insert `factor` into a {@link FactorGroup}'s `factors` — dedup-then-insert
 * at the end, or immediately after `target`.
 *
 * @remarks
 * Factor order is LOAD-BEARING: the same-priority tiebreak is declaration
 * order ({@link sortByPriority} is a stable ascending sort). Operates on the
 * factor's DIRECT container — compose into a definition via
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
 * import { appendFactor, factorGroup, staticFactor } from '@src/core'
 *
 * appendFactor(factorGroup('g1', 'sum', []), staticFactor('f1', 10))
 * ```
 */
export function appendFactor(group: FactorGroup, factor: Factor, target?: string): FactorGroup {
	return { ...group, factors: appendById(group.factors, factor, target) }
}

/**
 * Insert `factor` into a {@link FactorGroup}'s `factors` — dedup-then-insert
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
 * import { factorGroup, prependFactor, staticFactor } from '@src/core'
 *
 * prependFactor(factorGroup('g1', 'sum', []), staticFactor('f1', 10))
 * ```
 */
export function prependFactor(group: FactorGroup, factor: Factor, target?: string): FactorGroup {
	return { ...group, factors: prependById(group.factors, factor, target) }
}

/**
 * Swap the factor sharing `factor.id` in a {@link FactorGroup} IN PLACE,
 * preserving its position (appends when absent).
 *
 * @param group - The group to update
 * @param factor - The replacement factor
 * @returns A fresh group with the factor replaced
 *
 * @example
 * ```ts
 * import { factorGroup, replaceFactor, staticFactor } from '@src/core'
 *
 * const group = factorGroup('g1', 'sum', [staticFactor('f1', 10)])
 * replaceFactor(group, staticFactor('f1', 20))
 * ```
 */
export function replaceFactor(group: FactorGroup, factor: Factor): FactorGroup {
	return { ...group, factors: replaceById(group.factors, factor) }
}

/**
 * Remove every factor sharing `id` from a {@link FactorGroup} (no-op when
 * absent).
 *
 * @param group - The group to update
 * @param id - The factor id to remove
 * @returns A fresh group with the factor removed
 *
 * @example
 * ```ts
 * import { factorGroup, removeFactor, staticFactor } from '@src/core'
 *
 * removeFactor(factorGroup('g1', 'sum', [staticFactor('f1', 10)]), 'f1').factors // []
 * ```
 */
export function removeFactor(group: FactorGroup, id: string): FactorGroup {
	return { ...group, factors: removeById(group.factors, id) }
}

// === Logical change/extend helpers (PROPOSAL.md §8)

/**
 * Insert `rule` into a {@link LogicalDefinition}'s `rules` — dedup-then-insert
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
 * @returns A fresh definition with `rule` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing rule
 *
 * @example
 * ```ts
 * import { appendRule, atom, logicalDefinition, rule } from '@src/core'
 *
 * appendRule(logicalDefinition('e', 'E', []), rule('r1', [], atom('a', 'equals', true)))
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
 * Insert `rule` into a {@link LogicalDefinition}'s `rules` — dedup-then-insert
 * at the start, or immediately before `target`.
 *
 * @param definition - The definition to insert into
 * @param rule - The rule to insert
 * @param target - Optional rule id to insert immediately before
 * @returns A fresh definition with `rule` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing rule
 *
 * @example
 * ```ts
 * import { atom, logicalDefinition, prependRule, rule } from '@src/core'
 *
 * prependRule(logicalDefinition('e', 'E', []), rule('r1', [], atom('a', 'equals', true)))
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
 * Swap the rule sharing `rule.id` in a {@link LogicalDefinition} IN PLACE,
 * preserving its position (appends when absent).
 *
 * @param definition - The definition to update
 * @param rule - The replacement rule
 * @returns A fresh definition with the rule replaced
 *
 * @example
 * ```ts
 * import { atom, logicalDefinition, replaceRule, rule } from '@src/core'
 *
 * const definition = logicalDefinition('e', 'E', [rule('r1', [], atom('a', 'equals', true))])
 * replaceRule(definition, rule('r1', [], atom('a', 'equals', false)))
 * ```
 */
export function replaceRule(definition: LogicalDefinition, rule: Rule): LogicalDefinition {
	return { ...definition, rules: replaceById(definition.rules, rule) }
}

/**
 * Remove every rule sharing `id` from a {@link LogicalDefinition} (no-op when
 * absent).
 *
 * @param definition - The definition to update
 * @param id - The rule id to remove
 * @returns A fresh definition with the rule removed
 *
 * @example
 * ```ts
 * import { atom, logicalDefinition, removeRule, rule } from '@src/core'
 *
 * const definition = logicalDefinition('e', 'E', [rule('r1', [], atom('a', 'equals', true))])
 * removeRule(definition, 'r1').rules // []
 * ```
 */
export function removeRule(definition: LogicalDefinition, id: string): LogicalDefinition {
	return { ...definition, rules: removeById(definition.rules, id) }
}

// === Symbolic change/extend helpers (PROPOSAL.md §8)

/**
 * Insert `equation` into a {@link SymbolicDefinition}'s `equations` — dedup-
 * then-insert at the end, or immediately after `target`.
 *
 * @remarks
 * Order is STRONGLY load-bearing: equations solve strictly in order and each
 * rounded solution feeds forward.
 *
 * @param definition - The definition to insert into
 * @param equation - The equation to insert
 * @param target - Optional equation id to insert immediately after
 * @returns A fresh definition with `equation` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing equation
 *
 * @example
 * ```ts
 * import { appendEquation, constant, equation, symbolicDefinition, variable } from '@src/core'
 *
 * appendEquation(symbolicDefinition('e', 'E', []), equation('e1', variable('x'), constant(1), 'x'))
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
 * Insert `equation` into a {@link SymbolicDefinition}'s `equations` — dedup-
 * then-insert at the start, or immediately before `target`.
 *
 * @param definition - The definition to insert into
 * @param equation - The equation to insert
 * @param target - Optional equation id to insert immediately before
 * @returns A fresh definition with `equation` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing equation
 *
 * @example
 * ```ts
 * import { constant, equation, prependEquation, symbolicDefinition, variable } from '@src/core'
 *
 * prependEquation(symbolicDefinition('e', 'E', []), equation('e1', variable('x'), constant(1), 'x'))
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
 * Swap the equation sharing `equation.id` in a {@link SymbolicDefinition} IN
 * PLACE, preserving its position (appends when absent).
 *
 * @param definition - The definition to update
 * @param equation - The replacement equation
 * @returns A fresh definition with the equation replaced
 *
 * @example
 * ```ts
 * import { constant, equation, replaceEquation, symbolicDefinition, variable } from '@src/core'
 *
 * const definition = symbolicDefinition('e', 'E', [equation('e1', variable('x'), constant(1), 'x')])
 * replaceEquation(definition, equation('e1', variable('x'), constant(2), 'x'))
 * ```
 */
export function replaceEquation(
	definition: SymbolicDefinition,
	equation: Equation,
): SymbolicDefinition {
	return { ...definition, equations: replaceById(definition.equations, equation) }
}

/**
 * Remove every equation sharing `id` from a {@link SymbolicDefinition} (no-op
 * when absent).
 *
 * @param definition - The definition to update
 * @param id - The equation id to remove
 * @returns A fresh definition with the equation removed
 *
 * @example
 * ```ts
 * import { constant, equation, removeEquation, symbolicDefinition, variable } from '@src/core'
 *
 * const definition = symbolicDefinition('e', 'E', [equation('e1', variable('x'), constant(1), 'x')])
 * removeEquation(definition, 'e1').equations // []
 * ```
 */
export function removeEquation(definition: SymbolicDefinition, id: string): SymbolicDefinition {
	return { ...definition, equations: removeById(definition.equations, id) }
}

/**
 * Upsert one entry of a {@link SymbolicDefinition}'s `variables`.
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
 * import { addVariable, symbolicDefinition } from '@src/core'
 *
 * addVariable(symbolicDefinition('e', 'E', []), 'x', 5).variables // { x: 5 }
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
 * Remove one entry of a {@link SymbolicDefinition}'s `variables`.
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
 * import { removeVariable, symbolicDefinition } from '@src/core'
 *
 * removeVariable(symbolicDefinition('e', 'E', [], { variables: { x: 5 } }), 'x').variables // {}
 * ```
 */
export function removeVariable(definition: SymbolicDefinition, name: string): SymbolicDefinition {
	const { [name]: _drop, ...rest } = definition.variables
	return { ...definition, variables: rest }
}

// === Inferential change/extend helpers (PROPOSAL.md §8)

/**
 * Insert `fact` into an {@link InferentialDefinition}'s `facts` — dedup-then-
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
 * @returns A fresh definition with `fact` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing fact
 *
 * @example
 * ```ts
 * import { appendFact, fact, inferentialDefinition } from '@src/core'
 *
 * appendFact(inferentialDefinition('m', 'M', [], []), fact('f1', 'human', ['socrates']))
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
 * Insert `fact` into an {@link InferentialDefinition}'s `facts` — dedup-then-
 * insert at the start, or immediately before `target`.
 *
 * @param definition - The definition to insert into
 * @param fact - The fact to insert
 * @param target - Optional fact id to insert immediately before
 * @returns A fresh definition with `fact` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing fact
 *
 * @example
 * ```ts
 * import { fact, inferentialDefinition, prependFact } from '@src/core'
 *
 * prependFact(inferentialDefinition('m', 'M', [], []), fact('f1', 'human', ['socrates']))
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
 * Swap the fact sharing `fact.id` in an {@link InferentialDefinition} IN
 * PLACE, preserving its position (appends when absent).
 *
 * @param definition - The definition to update
 * @param fact - The replacement fact
 * @returns A fresh definition with the fact replaced
 *
 * @example
 * ```ts
 * import { fact, inferentialDefinition, replaceFact } from '@src/core'
 *
 * const definition = inferentialDefinition('m', 'M', [fact('f1', 'human', ['socrates'])], [])
 * replaceFact(definition, fact('f1', 'human', ['plato']))
 * ```
 */
export function replaceFact(definition: InferentialDefinition, fact: Fact): InferentialDefinition {
	return { ...definition, facts: replaceById(definition.facts, fact) }
}

/**
 * Remove every fact sharing `id` from an {@link InferentialDefinition} (no-op
 * when absent).
 *
 * @param definition - The definition to update
 * @param id - The fact id to remove
 * @returns A fresh definition with the fact removed
 *
 * @example
 * ```ts
 * import { fact, inferentialDefinition, removeFact } from '@src/core'
 *
 * const definition = inferentialDefinition('m', 'M', [fact('f1', 'human', ['socrates'])], [])
 * removeFact(definition, 'f1').facts // []
 * ```
 */
export function removeFact(definition: InferentialDefinition, id: string): InferentialDefinition {
	return { ...definition, facts: removeById(definition.facts, id) }
}

/**
 * Insert `inference` into an {@link InferentialDefinition}'s `inferences` —
 * dedup-then-insert at the end, or immediately after `target`.
 *
 * @remarks
 * Order is LOAD-BEARING: backward proving iterates in declaration order and
 * returns on first success.
 *
 * @param definition - The definition to insert into
 * @param inference - The inference to insert
 * @param target - Optional inference id to insert immediately after
 * @returns A fresh definition with `inference` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing inference
 *
 * @example
 * ```ts
 * import { appendInference, fact, inference, inferentialDefinition } from '@src/core'
 *
 * appendInference(
 * 	inferentialDefinition('m', 'M', [], []),
 * 	inference('i1', [fact('p', 'human', ['?x'])], fact('c', 'mortal', ['?x'])),
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
 * Insert `inference` into an {@link InferentialDefinition}'s `inferences` —
 * dedup-then-insert at the start, or immediately before `target`.
 *
 * @param definition - The definition to insert into
 * @param inference - The inference to insert
 * @param target - Optional inference id to insert immediately before
 * @returns A fresh definition with `inference` inserted
 * @throws {@link ReasonError} `'TARGET'` when `target` names no existing inference
 *
 * @example
 * ```ts
 * import { fact, inference, inferentialDefinition, prependInference } from '@src/core'
 *
 * prependInference(
 * 	inferentialDefinition('m', 'M', [], []),
 * 	inference('i1', [fact('p', 'human', ['?x'])], fact('c', 'mortal', ['?x'])),
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
 * Swap the inference sharing `inference.id` in an {@link InferentialDefinition}
 * IN PLACE, preserving its position (appends when absent).
 *
 * @param definition - The definition to update
 * @param inference - The replacement inference
 * @returns A fresh definition with the inference replaced
 *
 * @example
 * ```ts
 * import { fact, inference, inferentialDefinition, replaceInference } from '@src/core'
 *
 * const original = inference('i1', [fact('p', 'human', ['?x'])], fact('c', 'mortal', ['?x']))
 * const definition = inferentialDefinition('m', 'M', [], [original])
 * replaceInference(definition, inference('i1', [], fact('c', 'mortal', ['?x'])))
 * ```
 */
export function replaceInference(
	definition: InferentialDefinition,
	inference: Inference,
): InferentialDefinition {
	return { ...definition, inferences: replaceById(definition.inferences, inference) }
}

/**
 * Remove every inference sharing `id` from an {@link InferentialDefinition}
 * (no-op when absent).
 *
 * @param definition - The definition to update
 * @param id - The inference id to remove
 * @returns A fresh definition with the inference removed
 *
 * @example
 * ```ts
 * import { fact, inference, inferentialDefinition, removeInference } from '@src/core'
 *
 * const original = inference('i1', [fact('p', 'human', ['?x'])], fact('c', 'mortal', ['?x']))
 * removeInference(inferentialDefinition('m', 'M', [], [original]), 'i1').inferences // []
 * ```
 */
export function removeInference(
	definition: InferentialDefinition,
	id: string,
): InferentialDefinition {
	return { ...definition, inferences: removeById(definition.inferences, id) }
}

// === Merge helpers — whole-definition reconciliation (PROPOSAL.md §9)
//
// Model: id-keyed upsert, incoming order wins, base-only survivors retained
// (never deleted — additive). `base.id` (and `reasoning`) are preserved.
// Scalars / value-object fields are incoming-wins-WHEN-PRESENT, else base is
// kept — merge NEVER clears (that is `clear*`'s job, §10).

/**
 * Reconcile two {@link QuantitativeDefinition}s onto `base`'s id.
 *
 * @remarks
 * `groups` merges via {@link mergeById}; a matched (same-id) PAIR of groups
 * recurses one level deeper — their `factors` also merge via `mergeById` — the
 * one exception to incoming-wins-wholesale (PROPOSAL.md §9). Every other
 * scalar / value-object field is incoming-wins-when-present, else base kept.
 *
 * @param base - The definition merge targets (its `id` is preserved)
 * @param incoming - The definition merged in (its order and matches take priority)
 * @returns A fresh, reconciled definition
 *
 * @example
 * ```ts
 * import { factorGroup, mergeQuantitativeDefinition, quantitativeDefinition } from '@src/core'
 *
 * const base = quantitativeDefinition('risk', 'Risk', [factorGroup('g1', 'sum', [])])
 * const incoming = quantitativeDefinition('risk', 'Risk v2', [factorGroup('g2', 'sum', [])])
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
 * Reconcile two {@link LogicalDefinition}s onto `base`'s id.
 *
 * @remarks
 * `rules` merges via {@link mergeById} (incoming-wins-wholesale on a matched
 * id). Every other scalar field is incoming-wins-when-present, else base kept.
 *
 * @param base - The definition merge targets (its `id` is preserved)
 * @param incoming - The definition merged in (its order and matches take priority)
 * @returns A fresh, reconciled definition
 *
 * @example
 * ```ts
 * import { atom, logicalDefinition, mergeLogicalDefinition, rule } from '@src/core'
 *
 * const base = logicalDefinition('e', 'E', [rule('r1', [], atom('a', 'equals', true))])
 * const incoming = logicalDefinition('e', 'E2', [rule('r2', [], atom('b', 'equals', true))])
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
 * Reconcile two {@link SymbolicDefinition}s onto `base`'s id.
 *
 * @remarks
 * `equations` merges via {@link mergeById} (incoming-wins-wholesale on a
 * matched id); `variables` is a plain incoming-wins spread
 * (`{ ...base.variables, ...incoming.variables }`). Every other scalar field
 * is incoming-wins-when-present, else base kept.
 *
 * @param base - The definition merge targets (its `id` is preserved)
 * @param incoming - The definition merged in (its order, matches, and variables take priority)
 * @returns A fresh, reconciled definition
 *
 * @example
 * ```ts
 * import { constant, equation, mergeSymbolicDefinition, symbolicDefinition, variable } from '@src/core'
 *
 * const base = symbolicDefinition('e', 'E', [], { variables: { x: 1 } })
 * const incoming = symbolicDefinition('e', 'E2', [equation('e1', variable('x'), constant(2), 'x')], {
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
 * Reconcile two {@link InferentialDefinition}s onto `base`'s id.
 *
 * @remarks
 * `inferences` and `facts` each merge via {@link mergeById}
 * (incoming-wins-wholesale on a matched id). Every other scalar field is
 * incoming-wins-when-present, else base kept.
 *
 * @param base - The definition merge targets (its `id` is preserved)
 * @param incoming - The definition merged in (its order and matches take priority)
 * @returns A fresh, reconciled definition
 *
 * @example
 * ```ts
 * import { fact, inferentialDefinition, mergeInferentialDefinition } from '@src/core'
 *
 * const base = inferentialDefinition('m', 'M', [fact('f1', 'human', ['a'])], [])
 * const incoming = inferentialDefinition('m', 'M2', [fact('f2', 'human', ['b'])], [])
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

// === Clear helpers — optional-field key-deletion (PROPOSAL.md §10)
//
// `const { [key]: _drop, ...rest } = definition; return rest` — the
// destructure-rest form sidesteps oxlint `no-param-reassign` friction, and the
// result OMITS the key entirely (never sets it to `undefined`), keeping the
// definition exact-record valid.

/**
 * Delete one optional field of a {@link QuantitativeDefinition}.
 *
 * @param definition - The definition to update
 * @param key - The optional field to clear
 * @returns A fresh definition with `key` omitted
 *
 * @example
 * ```ts
 * import { clearQuantitativeDefinition, quantitativeDefinition } from '@src/core'
 *
 * const definition = quantitativeDefinition('risk', 'Risk', [], { precision: 2 })
 * 'precision' in clearQuantitativeDefinition(definition, 'precision') // false
 * ```
 */
export function clearQuantitativeDefinition(
	definition: QuantitativeDefinition,
	key: 'description' | 'base' | 'bounds' | 'precision',
): QuantitativeDefinition {
	const { [key]: _drop, ...rest } = definition
	return rest
}

/**
 * Delete one optional field of a {@link LogicalDefinition}.
 *
 * @param definition - The definition to update
 * @param key - The optional field to clear
 * @returns A fresh definition with `key` omitted
 *
 * @example
 * ```ts
 * import { clearLogicalDefinition, logicalDefinition } from '@src/core'
 *
 * const definition = logicalDefinition('e', 'E', [], { depth: 5 })
 * 'depth' in clearLogicalDefinition(definition, 'depth') // false
 * ```
 */
export function clearLogicalDefinition(
	definition: LogicalDefinition,
	key: 'description' | 'depth',
): LogicalDefinition {
	const { [key]: _drop, ...rest } = definition
	return rest
}

/**
 * Delete one optional field of a {@link SymbolicDefinition}.
 *
 * @param definition - The definition to update
 * @param key - The optional field to clear
 * @returns A fresh definition with `key` omitted
 *
 * @example
 * ```ts
 * import { clearSymbolicDefinition, symbolicDefinition } from '@src/core'
 *
 * const definition = symbolicDefinition('e', 'E', [], { precision: 2 })
 * 'precision' in clearSymbolicDefinition(definition, 'precision') // false
 * ```
 */
export function clearSymbolicDefinition(
	definition: SymbolicDefinition,
	key: 'description' | 'precision',
): SymbolicDefinition {
	const { [key]: _drop, ...rest } = definition
	return rest
}

/**
 * Delete one optional field of an {@link InferentialDefinition}.
 *
 * @param definition - The definition to update
 * @param key - The optional field to clear
 * @returns A fresh definition with `key` omitted
 *
 * @example
 * ```ts
 * import { clearInferentialDefinition, inferentialDefinition } from '@src/core'
 *
 * const definition = inferentialDefinition('m', 'M', [], [], { depth: 5 })
 * 'depth' in clearInferentialDefinition(definition, 'depth') // false
 * ```
 */
export function clearInferentialDefinition(
	definition: InferentialDefinition,
	key: 'description' | 'depth',
): InferentialDefinition {
	const { [key]: _drop, ...rest } = definition
	return rest
}

// === Store-ability (PROPOSAL.md §12)

/**
 * Parse a JSON string into a {@link Definition}, failing safe to `undefined`.
 *
 * @remarks
 * The safe inverse of the builders: `parseJSONAs` composed with the data guard
 * {@link isDefinition}. A built definition body IS the durable JSON payload —
 * `JSON.stringify(definition)` round-trips through `parseDefinition`. Two
 * authoring hazards: a required `Check.value: undefined` drops its key on
 * `JSON.stringify` (author `null` instead), and a `Fact.terms` element of
 * `undefined` serializes to `null` (terms must be JSON-safe scalars/strings).
 *
 * @param json - The JSON text to parse
 * @returns A {@link Definition} of any reasoning, or `undefined` when malformed
 *
 * @example
 * ```ts
 * import { logicalDefinition, parseDefinition } from '@src/core'
 *
 * const text = JSON.stringify(logicalDefinition('e', 'E', []))
 * parseDefinition(text)   // the definition, restored
 * parseDefinition('{}')   // undefined — fails safe
 * ```
 */
export function parseDefinition(json: string): Definition | undefined {
	return parseJSONAs(json, isDefinition)
}

// === Subject engine (PROPOSAL.md §11)
//
// The subject counterpart of the definition engine above — four pure helpers.
// Records are unordered, so there is no `append*`/`prepend*` on a subject
// (mirrors the `addVariable`/`removeVariable` note, §8). Named `assignField`,
// not `setField` — the core layer already exports a `FieldPath`-deep, in-place
// `setField` (`src/core/helpers.ts:139`, returns `void`); reusing that token
// for this pure, `Subject`-returning upsert would collide in the `@src/core`
// barrel and violate AGENTS §4.4 (identical verbs must mean identical things).

/**
 * Upsert one field of a {@link Subject} — copy-on-write spread.
 *
 * @remarks
 * Id-agnostic: overwrites an `id` key like any other field — id protection is
 * an entity's job, not this helper's.
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
 * Delete one field of a {@link Subject} — destructure-rest omit.
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
 * Reconcile two {@link Subject}s — incoming-wins spread, with the base `id`
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
 * Produce `count` deterministic clones of a {@link Subject}.
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
