import { isArray, isRecord } from '@orkestrel/contract'
import type {
	EquationManager,
	FactManager,
	FactorManager,
	GroupManager,
	InferenceManager,
	RuleManager,
	VariableManager,
	createEquationManager,
	createFactManager,
	createInferenceManager,
	createRuleManager,
	createVariableManager,
	Comparison,
	Definition,
	DefinitionBuilderEventMap,
	DefinitionBuilderInterface,
	EquationManagerEventMap,
	Expression,
	FactManagerEventMap,
	FactorManagerEventMap,
	GroupManagerEventMap,
	InferenceManagerEventMap,
	InferentialResult,
	LogicalResult,
	QuantitativeDefinition,
	QuantitativeResult,
	ReasonEventMap,
	ReasonInterface,
	ReasonResult,
	ReasonerInterface,
	Reasoning,
	RuleManagerEventMap,
	Subject,
	SubjectBuilderEventMap,
	SubjectBuilderInterface,
	SymbolicExpression,
	SymbolicResult,
	VariableManagerEventMap,
} from '@src/core'
import {
	ReasonError,
	containsVariable,
	createAtom,
	createBounds,
	createCheck,
	createCompound,
	createConstant,
	createDefinitionBuilder,
	createEquation,
	createEvaluator,
	createFact,
	createFactorGroup,
	createFactorManager,
	createFieldFactor,
	createGroupManager,
	createInference,
	createInferentialDefinition,
	createInferentialReasoner,
	createLogicalDefinition,
	createLogicalReasoner,
	createLookupFactor,
	createOperation,
	createQuantitativeDefinition,
	createQuantitativeReasoner,
	createRangeFactor,
	createReason,
	createRule,
	createStaticFactor,
	createSubjectBuilder,
	createSymbolicDefinition,
	createSymbolicReasoner,
	createTransform,
	createVariable,
} from '@src/core'
import { afterEach, vi } from 'vitest'
import type { createRecorder } from '@orkestrel/test'
import { createRecorders, requireValue } from '@orkestrel/test'
import { Collection } from '../src/core/builders/managers/Collection.js'

// Base test setup — environment-agnostic helpers loaded first by every
// Vitest project (`setupFiles[0]`). Keep this file free of `node:*` and of
// `document` / `window` / Vue.

afterEach(() => {
	vi.restoreAllMocks()
})

/**
 * Narrows a `reason()` return to a `QuantitativeResult` — throws on a batch
 * array or a result of another reasoning.
 *
 * @param result - The single-or-batch return of a `reason()` call
 * @returns The result, narrowed to `QuantitativeResult`
 */
export function expectQuantitative(
	result: ReasonResult | readonly ReasonResult[],
): QuantitativeResult {
	if (isArray<ReasonResult>(result)) throw new Error('Expected a single result, got a batch array')
	if (result.reasoning !== 'quantitative') {
		throw new Error(`Expected a quantitative result, got "${result.reasoning}"`)
	}
	return result
}

/**
 * Narrows a `reason()` return to a `LogicalResult` — throws on a batch array
 * or a result of another reasoning (the {@link expectQuantitative} sibling).
 *
 * @param result - The single-or-batch return of a `reason()` call
 * @returns The result, narrowed to `LogicalResult`
 */
export function expectLogical(result: ReasonResult | readonly ReasonResult[]): LogicalResult {
	if (isArray<ReasonResult>(result)) throw new Error('Expected a single result, got a batch array')
	if (result.reasoning !== 'logical') {
		throw new Error(`Expected a logical result, got "${result.reasoning}"`)
	}
	return result
}

/**
 * Narrows a `reason()` return to a `SymbolicResult` — throws on a batch array
 * or a result of another reasoning (the {@link expectQuantitative} sibling).
 *
 * @param result - The single-or-batch return of a `reason()` call
 * @returns The result, narrowed to `SymbolicResult`
 */
export function expectSymbolic(result: ReasonResult | readonly ReasonResult[]): SymbolicResult {
	if (isArray<ReasonResult>(result)) throw new Error('Expected a single result, got a batch array')
	if (result.reasoning !== 'symbolic') {
		throw new Error(`Expected a symbolic result, got "${result.reasoning}"`)
	}
	return result
}

/**
 * Narrows a `reason()` return to an `InferentialResult` — throws on a batch
 * array or a result of another reasoning (the {@link expectQuantitative} sibling).
 *
 * @param result - The single-or-batch return of a `reason()` call
 * @returns The result, narrowed to `InferentialResult`
 */
export function expectInferential(
	result: ReasonResult | readonly ReasonResult[],
): InferentialResult {
	if (isArray<ReasonResult>(result)) throw new Error('Expected a single result, got a batch array')
	if (result.reasoning !== 'inferential') {
		throw new Error(`Expected an inferential result, got "${result.reasoning}"`)
	}
	return result
}

/**
 * Freezes a value and every nested plain object/array it reaches, recursively
 * — the deep-frozen-input stress the no-mutation reasoner tests share,
 * so a mutation anywhere in the input tree throws in strict
 * mode instead of silently succeeding. Narrows with {@link isArray} /
 * {@link isRecord} (never an `as`) and recurses only into a plain
 * array's elements or a plain record's `Object.values` — any other value
 * (a primitive, `Date`, `Map`, function) is returned unchanged.
 *
 * @typeParam T - The value's type
 * @param value - The value to deep-freeze
 * @returns `value`, the same reference, frozen (and every plain nested
 *   object/array it reaches, frozen too)
 */
export function deepFreeze<T>(value: T): T {
	if (isArray(value)) {
		for (const item of value) deepFreeze(item)
		Object.freeze(value)
		return value
	}
	if (isRecord(value)) {
		for (const item of Object.values(value)) deepFreeze(item)
		Object.freeze(value)
		return value
	}
	return value
}

/**
 * Holds the recurring flat `Subject` of the evaluator / reasoner tests — one field of
 * each scalar kind (number / string / boolean) plus an `id`, so check operators
 * and subject-binding paths read real data without re-typing the literal.
 */
export const BASIC_SUBJECT: Subject = {
	id: 'subject-1',
	age: 30,
	name: 'Alice',
	score: 85,
	state: 'CA',
	employed: true,
}

/**
 * Holds the recurring nested `Subject` — two levels of nesting for the `FieldPath`
 * array-descent cases (a STRING field is ONE key; an ARRAY descends).
 */
export const NESTED_SUBJECT: Subject = {
	id: 'nested-1',
	address: { city: 'NY', zip: '10001' },
	scores: { math: 90, english: 80 },
}

/**
 * Holds the recurring driver-scoring `Subject` — the multi-factor scenario the
 * evaluator and quantitative-reasoner tests share.
 */
export const DRIVER_SUBJECT: Subject = {
	driverAge: 22,
	violationCount: 0,
	vehicleYear: 2020,
}

/**
 * Builds a minimal runnable `QuantitativeDefinition` — one sum group holding
 * one static factor, producing `value` on ANY subject. The shared definition the
 * orchestrator / factory tests dispatch when the scenario only needs SOME
 * working definition.
 *
 * @param id - The definition id (and name); defaults to `'static-quant'`
 * @param value - The static factor's value (the run's result); defaults to `42`
 * @returns The assembled quantitative definition
 */
export function buildStaticDefinition(id = 'static-quant', value = 42): QuantitativeDefinition {
	return createQuantitativeDefinition(id, id, [
		createFactorGroup('g1', 'sum', [createStaticFactor('f1', value)]),
	])
}

/**
 * Creates a REAL `ReasonerInterface` whose `reason` always throws
 * `new Error(message)` — the scripted collaborator driving the orchestrator's
 * `bail` / `error`-event paths (a real implementation of the seam, not a mock
 * of the orchestrator).
 *
 * @param message - The thrown error's message; defaults to `'boom'`
 * @param reasoning - The reasoning to register under; defaults to `'quantitative'`
 * @returns A reasoner whose `reason` throws
 */
export function createThrowingReasoner(
	message = 'boom',
	reasoning: Reasoning = 'quantitative',
): ReasonerInterface {
	return {
		id: 'throwing',
		reasoning,
		supports: (definition) => definition.reasoning === reasoning,
		validate: () => ({ valid: true, errors: [], warnings: [] }),
		reason: () => {
			throw new Error(message)
		},
	}
}

/**
 * Runs `scenario` twice against fresh state and returns both outcomes — the shared
 * form of the byte-identical `twice(scenario)` closure `DefinitionBuilder.test.ts`
 * and `SubjectBuilder.test.ts` each define locally, used throughout
 * both files to run a mutation scenario twice and deep-equal the two outcomes,
 * pinning both correctness and determinism in one assertion.
 *
 * @typeParam T - The scenario's return type
 * @param scenario - The (fresh-state) operation to run twice
 * @returns The two outcomes, in call order
 */
export function runTwice<T>(scenario: () => T): readonly [T, T] {
	return [scenario(), scenario()]
}

/**
 * Returns a `count`-long ascending integer range starting at `start` — the
 * shared numeric-range fixture the aggregation / scale tests build inputs from,
 * replacing repeated `Array.from({ length: n }, (_, i) => i)`. Produces an empty
 * range for `count <= 0`.
 *
 * @param count - How many integers to produce
 * @param start - The first integer of the range; defaults to `0`
 * @returns The `count`-long ascending integer range
 */
export function sequence(count: number, start = 0): readonly number[] {
	return Array.from({ length: Math.max(count, 0) }, (_unused, index) => start + index)
}

/**
 * Returns an array of `count` copies of `value` — the uniform-input fill the aggregator /
 * transformer scale tests exercise. For a reference `value` every slot
 * shares the one reference (a fill, not a deep clone); an empty array for `count <= 0`.
 *
 * @typeParam T - The element type
 * @param count - How many copies to produce
 * @param value - The value to repeat in every slot
 * @returns The `count`-long array of `value`
 */
export function repeatValue<T>(count: number, value: T): readonly T[] {
	return Array.from({ length: Math.max(count, 0) }, () => value)
}

/**
 * Lists the curated JavaScript numeric edge values the numeric-quirk tests probe — signed
 * zero, the safe-integer and representable-magnitude bounds, `EPSILON`, an overflow-scale
 * pair, and the classic `0.1 + 0.2 !== 0.3` floats. Every entry is FINITE; the non-finite
 * cases (`NaN` / `±Infinity`) are named explicitly at their own sites, never smuggled in
 * here. Frozen so a test can share it without risk of mutation.
 */
export const EXTREME_NUMBERS: readonly number[] = Object.freeze([
	0,
	-0,
	1,
	-1,
	Number.MAX_SAFE_INTEGER,
	Number.MIN_SAFE_INTEGER,
	Number.MAX_VALUE,
	Number.MIN_VALUE,
	Number.EPSILON,
	1e308,
	-1e308,
	0.1,
	0.2,
	0.3,
])

/**
 * Lists the curated adversarial / unicode object keys the field-path, subject-key, id, and
 * lookup-table tests probe — the `Object.prototype` / prototype-pollution names, an empty
 * key, a surrogate-pair (astral) key, a precomposed accented key (`é`, single code point
 * `U+00E9`, already NFC-stable), a precomposed key (`Å`, single code point `U+00C5` LATIN
 * CAPITAL LETTER A WITH RING ABOVE, already NFC-stable), and a DOTTED key (`'a.b'`) that
 * proves a single-string `FieldPath` is ONE key, never dot-split. Frozen so a test can share
 * it without risk of mutation.
 */
export const TRICKY_KEYS: readonly string[] = Object.freeze([
	'__proto__',
	'constructor',
	'prototype',
	'toString',
	'hasOwnProperty',
	'',
	'\u{1F600}',
	'é',
	'Å',
	'a.b',
])

/**
 * Returns a `length`-long array with REAL holes everywhere except the given
 * `(index, value)` pairs — the hole-bearing array fixture the array-handling
 * tests probe. Built from `new Array(length)`, so unfilled slots are
 * genuine holes (absent from `Object.keys` / `for…in`, skipped by `forEach` /
 * `map`), never `undefined` values written into every slot.
 *
 * @typeParam T - The element type
 * @param length - The array's `length`
 * @param filled - The `[index, value]` pairs to assign; every other index stays a hole
 * @returns The `length`-long sparse array
 */
export function sparse<T>(length: number, filled: ReadonlyArray<readonly [number, T]>): T[] {
	const result: T[] = new Array(length)
	for (const [index, value] of filled) {
		result[index] = value
	}
	return result
}

/**
 * Nests `leaf` inside `depth` layers of a single-operand `'and'`
 * compound — the deep-expression-tree fixture the recursion / stack
 * -depth tests probe. `depth <= 0` returns `leaf` itself,
 * unwrapped.
 *
 * @param depth - How many `'and'` compound layers to nest
 * @param leaf - The innermost expression
 * @returns `leaf` wrapped in `depth` nested `'and'` compounds
 */
export function deepCompound(depth: number, leaf: Expression): Expression {
	return sequence(Math.ceil(depth)).reduce((result) => createCompound('and', [result]), leaf)
}

/**
 * Nests `depth` left-leaning layers of an `'add'` operation around `leaf`,
 * each layer adding `step` — the deep-symbolic-tree fixture the recursion /
 * stack-depth tests probe. `depth <= 0` returns `leaf` itself,
 * unwrapped. When `step` is a `constant`, the resulting expression evaluates
 * to `leaf + depth * step`.
 *
 * @param depth - How many `'add'` operation layers to nest
 * @param leaf - The innermost expression
 * @param step - The right operand added at every layer
 * @returns `leaf` wrapped in `depth` nested `'add'` operations
 */
export function deepAddition(
	depth: number,
	leaf: SymbolicExpression,
	step: SymbolicExpression,
): SymbolicExpression {
	return sequence(Math.ceil(depth)).reduce((result) => createOperation('add', result, step), leaf)
}

/**
 * Holds a frozen `Subject` whose integer-like keys are authored deliberately
 * OUT of order — the enumeration-order fixture the subject-key / field-path
 * tests probe. Per the spec, integer-index string keys
 * (`"1"`, `"2"`, `"10"`) always enumerate ascending numerically FIRST,
 * regardless of authoring order, followed by the ordinary string keys in
 * insertion order: `Object.keys(INTEGER_KEY_SUBJECT)` yields
 * `['1', '2', '10', 'zeta', 'id', 'alpha']`. Every non-`id` value is a
 * NUMBER so the fixture serves `subjectToFacts` and symbolic binding alike.
 * Frozen so a test can share it without risk of mutation.
 */
export const INTEGER_KEY_SUBJECT: Subject = Object.freeze({
	'10': 10,
	'2': 2,
	zeta: 26,
	'1': 1,
	id: 'integer-key-subject',
	alpha: 1,
})

/** Provides the symbol key {@link ADVERSARIAL_VALUE_SUBJECT} carries — invisible to `Object.keys`. */
export const ADVERSARIAL_SYMBOL_KEY: unique symbol = Symbol('adversarial')

/**
 * Holds a frozen `Subject` exercising the adversarial value shapes
 * `subjectToFacts` must classify correctly: a
 * symbol-keyed property (invisible to `Object.keys`, so never surfaced as a
 * fact), plus string-keyed `bigint`, `symbol`, and `function` values — each
 * `typeof` is NOT `'object'`, so `subjectToFacts` keeps them as fact terms
 * rather than skipping them like it skips `null` / plain objects. Frozen so
 * a test can share it without risk of mutation.
 */
export const ADVERSARIAL_VALUE_SUBJECT: Subject = Object.freeze({
	id: 'adversarial-value-subject',
	[ADVERSARIAL_SYMBOL_KEY]: 'hidden',
	big: 9007199254740993n,
	sym: Symbol('value'),
	fn: () => 'adversarial',
})

/**
 * Builds `count` subjects `{ id: "s0", value: 0 }, { id: "s1", value: 1 }, …`
 * from {@link sequence} — the batch-of-subjects fixture the scale /
 * aggregation tests feed a reasoner instead of hand-writing a
 * literal array.
 *
 * @param count - How many subjects to produce
 * @returns The `count`-long array of subjects
 */
export function buildSubjects(count: number): readonly Subject[] {
	return sequence(count).map((index) => ({ id: `s${index}`, value: index }))
}

export const ADVERSARIAL: readonly unknown[] = [
	null,
	undefined,
	42,
	3.14,
	true,
	false,
	'junk',
	Symbol('s'),
	10n,
	() => 1,
	new Date(),
	new Map(),
	[],
	[1, 2, 3],
]

export class DerivedFactResult {
	readonly id = 'f1'
	readonly predicate = 'bird'
	readonly terms: readonly unknown[] = ['tweety']
}

export class ResultGuardFixture {
	// An own member beyond the seed, so every class control also proves
	// extra-member acceptance; its initializer keeps the class non-extraneous.
	readonly fixture: boolean = true

	constructor(seed: object) {
		Object.assign(this, seed)
	}
}

export function selectAccepted(guard: (value: unknown) => boolean): readonly unknown[] {
	return ADVERSARIAL.filter((value) => guard(value))
}

export class ReadCounter {
	#count = 0

	get count(): number {
		return this.#count
	}

	increment(): void {
		this.#count += 1
	}
}

export function buildExpressionNest(depth: number) {
	const leaf = createAtom('a', 'equals', 1)
	return sequence(depth).reduce((deep) => createCompound('not', [deep]), leaf)
}

export function buildSymbolicNest(depth: number) {
	return sequence(depth).reduce((deep) => createOperation('abs', deep), createConstant(1))
}

export function findDepthBoundary(
	low: number,
	high: number,
	build: (depth: number) => unknown,
	guard: (value: unknown) => boolean,
): readonly [number, number] {
	if (high - low <= 1) return [low, high]
	const middle = Math.floor((low + high) / 2)
	return guard(build(middle))
		? findDepthBoundary(middle, high, build, guard)
		: findDepthBoundary(low, middle, build, guard)
}

export function createValidatorsUnbrandedBuilder() {
	return {
		build: () => ({}),
		'reasons.definitionBuilder': true,
		'reasons.subjectBuilder': true,
	}
}

export const symbolicReasoner = createSymbolicReasoner()

export function evaluateExpression(expression: SymbolicExpression): number {
	const definition = createSymbolicDefinition('d', 'd', [
		createEquation('e1', createVariable('result'), expression, 'result'),
	])
	const result = expectSymbolic(symbolicReasoner.reason({}, definition)).solutions.result
	if (result === undefined) throw new Error('expected result solution')
	return result
}

export function evaluateSubjectBinding(value: unknown): SymbolicResult {
	const definition = createSymbolicDefinition('d', 'd', [
		createEquation('e1', createVariable('y'), createVariable('x'), 'y'),
	])
	return expectSymbolic(symbolicReasoner.reason({ x: value }, definition))
}

export function readSolution(definition: Definition): number {
	const result = expectSymbolic(symbolicReasoner.reason({}, definition)).solutions.x
	if (result === undefined) throw new Error('expected x solution')
	return result
}

export function readSubjectTrace(
	definition: Definition,
	verify: (result: SymbolicResult) => void,
): readonly string[] {
	const result = expectSymbolic(symbolicReasoner.reason(INTEGER_KEY_SUBJECT, definition))
	verify(result)
	return result.trace
}

export const quantitativeReasoner = createQuantitativeReasoner()

export function createFieldDefinition(fallback?: number) {
	return createQuantitativeDefinition('d', 'd', [
		createFactorGroup('g1', 'sum', [
			createFieldFactor('f1', 'value', fallback === undefined ? undefined : { fallback }),
		]),
	])
}

export function evaluateSparseRanges() {
	const ranges = sparse<{ bounds: ReturnType<typeof createBounds>; value: number }>(5, [
		[0, { bounds: createBounds(0, 10), value: 1 }],
		[4, { bounds: createBounds(90, 100), value: 99 }],
	])
	const definition = createQuantitativeDefinition('d', 'd', [
		createFactorGroup('g1', 'sum', [createRangeFactor('f1', 'age', ranges, { fallback: 0 })]),
	])
	return {
		inBand: expectQuantitative(quantitativeReasoner.reason({ age: 5 }, definition)).value,
		otherBand: expectQuantitative(quantitativeReasoner.reason({ age: 95 }, definition)).value,
		holeOnly: expectQuantitative(quantitativeReasoner.reason({ age: 50 }, definition)).value,
	}
}

export function evaluateLookupTable() {
	const reasoner = quantitativeReasoner
	// `Object.fromEntries` creates OWN data properties even for "__proto__",
	// unlike a dynamic bracket assignment (which would hit the proto setter).
	const table: Readonly<Record<string, number>> = Object.fromEntries([
		...sequence(2000).map((value): [string, number] => [`gen-${value}`, value]),
		...TRICKY_KEYS.map((key, index): [string, number] => [key, 100000 + index]),
	])
	const definition = createQuantitativeDefinition('d', 'd', [
		createFactorGroup('g1', 'sum', [createLookupFactor('f1', 'code', table, { fallback: -1 })]),
	])
	return {
		genHit: expectQuantitative(reasoner.reason({ code: 'gen-1500' }, definition)).value,
		properHit: expectQuantitative(reasoner.reason({ code: TRICKY_KEYS[0] }, definition)).value,
		emojiHit: expectQuantitative(reasoner.reason({ code: '\u{1F600}' }, definition)).value,
		emptyHit: expectQuantitative(reasoner.reason({ code: '' }, definition)).value,
		miss: expectQuantitative(reasoner.reason({ code: 'not-in-table' }, definition)).value,
	}
}

export function evaluateScale(groupCount: number, factorsPerGroup: number) {
	const groups = sequence(groupCount).map((groupIndex) =>
		createFactorGroup(
			`g${groupIndex}`,
			'sum',
			sequence(factorsPerGroup, groupIndex * factorsPerGroup).map((value) =>
				createStaticFactor(`f${groupIndex}_${value}`, value),
			),
		),
	)
	const definition = createQuantitativeDefinition('d', 'd', groups)
	return expectQuantitative(quantitativeReasoner.reason({}, definition))
}

export const logicalReasoner = createLogicalReasoner()

export function createDerivationRule(
	id: string,
	field: string,
	value: unknown,
	derived: string,
	overrides?: { readonly priority?: number; readonly enabled?: boolean },
) {
	return createRule(
		id,
		[createAtom(field, 'equals', value)],
		createAtom(derived, 'equals', true),
		overrides,
	)
}

export function createCompoundDefinition(premise: Expression) {
	return createLogicalDefinition('d', 'd', [
		createRule('r1', [premise], createAtom('ok', 'equals', true)),
	])
}

export function runAtDepth(depth: number) {
	const definition = createLogicalDefinition('d', 'd', FORWARD_CHAIN, { depth })
	return expectLogical(logicalReasoner.reason({ k0: true }, definition))
}

export function computeBackwardConclusion(
	provablePriority: number,
	unprovablePriority: number,
): boolean {
	const definition = createLogicalDefinition(
		'd',
		'd',
		[
			createRule('provable', [createAtom('a', 'equals', true)], createAtom('x', 'equals', true), {
				priority: provablePriority,
			}),
			createRule(
				'unprovable',
				[createAtom('missing', 'equals', true)],
				createAtom('y', 'equals', true),
				{
					priority: unprovablePriority,
				},
			),
		],
		{ strategy: 'backward' },
	)
	return expectLogical(logicalReasoner.reason({ a: true }, definition)).conclusion
}

export function buildBackwardChain() {
	return sequence(6, 1)
		.map((index) => createDerivationRule(`r${index}`, `k${index - 1}`, true, `k${index}`))
		.reverse()
}

export function readRuleApplied(id: string, depth: number | undefined) {
	const definition = createLogicalDefinition('d', 'd', buildBackwardChain(), {
		strategy: 'backward',
		...(depth === undefined ? {} : { depth }),
	})
	const result = expectLogical(logicalReasoner.reason({ k0: true }, definition))
	return result.rules.find((entry) => entry.id === id)?.applied
}

export function computeDepthBoundary() {
	return sequence(6, 1).map((hops) => readRuleApplied(`r${hops}`, 3))
}

export function evaluateDeepCompound(leafValue: boolean) {
	const deep = deepCompound(1000, createAtom('deep', 'equals', true))
	const definition = createLogicalDefinition('d', 'd', [
		createRule('nest', [deep], createAtom('ok', 'equals', true)),
	])
	return expectLogical(logicalReasoner.reason({ deep: leafValue }, definition))
}

export const FORWARD_CHAIN = sequence(6, 1).map((index) =>
	createDerivationRule(`r${index}`, `k${index - 1}`, true, `k${index}`),
)

export const inferentialReasoner = createInferentialReasoner()

export function createMortality(subjects: readonly string[] = ['socrates']) {
	return createInferentialDefinition(
		'mortality',
		'Mortality',
		subjects.map((name, index) => createFact(`f${index + 1}`, 'human', [name])),
		[
			createInference(
				'i1',
				[createFact('p1', 'human', ['?x'])],
				createFact('c1', 'mortal', ['?x']),
			),
		],
	)
}

export function hasDerivedPair(
	result: ReturnType<typeof expectInferential>,
	x: number,
	y: number,
): boolean {
	return result.derived.some((derived) => derived.terms[0] === x && derived.terms[1] === y)
}

export function readConfidence(
	result: ReturnType<typeof expectInferential>,
	predicate: string,
): number | undefined {
	return result.derived.find((derived) => derived.predicate === predicate)?.confidence
}

export function createMixedArity() {
	return createInferentialDefinition(
		'mixed-arity',
		'Mixed-arity',
		[
			createFact('f1', 'rel', ['a', 'b'], 0.9),
			createFact('f2', 'rel', ['x', 'y', 'z'], 0.8),
			createFact('f3', 'rel', ['b', 'c'], 0.7),
		],
		[
			createInference(
				'pair-rule',
				[createFact('p1', 'rel', ['?x', '?y'])],
				createFact('c1', 'pair', ['?x', '?y']),
				{
					confidence: 0.5,
				},
			),
			createInference(
				'triple-rule',
				[createFact('p2', 'rel', ['?x', '?y', '?z'])],
				createFact('c2', 'triple', ['?x', '?y', '?z']),
				{ confidence: 0.5 },
			),
		],
	)
}

export function createInferenceChain(length: number) {
	return sequence(length).map((step) =>
		createInference(
			`i${step}`,
			[createFact(`a${step}`, `p${step + 1}`, ['?x'])],
			createFact(`c${step}`, `p${step}`, ['?x']),
		),
	)
}

export function readProofLeaf(
	proof: ReturnType<typeof expectInferential>['proof'],
): ReturnType<typeof expectInferential>['proof'] {
	return proof?.children && proof.children.length > 0 ? readProofLeaf(proof.children[0]) : proof
}

export function createAncestry(depth: number) {
	return createInferentialDefinition(
		'ancestry',
		'Ancestry',
		sequence(5).map((node) => createFact(`p${node}`, 'parent', [node, node + 1])),
		[
			createInference(
				'base',
				[createFact('b1', 'parent', ['?x', '?y'])],
				createFact('cb', 'ancestor', ['?x', '?y']),
			),
			createInference(
				'trans',
				[createFact('t1', 'parent', ['?x', '?y']), createFact('t2', 'ancestor', ['?y', '?z'])],
				createFact('ct', 'ancestor', ['?x', '?z']),
			),
		],
		{ depth },
	)
}

export const AGE_DEFINITION = createQuantitativeDefinition(
	'age-score',
	'Age Score',
	[createFactorGroup('g1', 'sum', [createFieldFactor('age', 'age')])],
	{ base: 100 },
)

export const LOGICAL_DEFINITION = createLogicalDefinition('activation', 'Activation', [
	createRule(
		'activate',
		[createAtom('active', 'equals', true)],
		createAtom('result', 'equals', true),
	),
])

export const REASON_EVENTS = ['register', 'reason', 'error', 'destroy'] as const
export type ReasonEvent = (typeof REASON_EVENTS)[number]

export function createStringThrower(): ReasonerInterface {
	return {
		id: 'string-thrower',
		reasoning: 'quantitative',
		supports: (definition) => definition.reasoning === 'quantitative',
		validate: () => ({ valid: true, errors: [], warnings: [] }),
		reason: () => {
			// A deliberately non-Error throw — the String(error) branch.
			throw 'string-throw'
		},
	}
}

export function createMismatchedReasoner(): ReasonerInterface {
	return {
		id: 'mismatched',
		reasoning: 'logical',
		supports: (definition) => definition.reasoning === 'logical',
		validate: () => ({ valid: true, errors: [], warnings: [] }),
		reason: (_subject, definition) => {
			if (definition.reasoning !== 'quantitative') {
				throw new ReasonError(
					'MISMATCH',
					`Expected quantitative definition, got "${definition.reasoning}"`,
					{ definition: definition.id, reasoning: 'quantitative' },
				)
			}
			throw new Error('unreachable')
		},
	}
}

export const conditional: ReasonerInterface = {
	id: 'conditional',
	reasoning: 'quantitative',
	supports: (definition) => definition.reasoning === 'quantitative',
	validate: () => ({ valid: true, errors: [], warnings: [] }),
	reason: (subject) => {
		if (subject.fail === true) throw new Error('fail')
		const n = subject.n
		return {
			reasoning: 'quantitative',
			value: typeof n === 'number' ? n * 2 : 0,
			groups: [],
			count: 0,
			success: true,
			trace: [],
			errors: [],
		}
	},
}

export const REAL_FAILURE_REASONER: ReasonerInterface = {
	id: 'real-failure',
	reasoning: 'quantitative',
	supports: (definition) => definition.reasoning === 'quantitative',
	validate: () => ({ valid: true, errors: [], warnings: [] }),
	reason: () => ({
		reasoning: 'quantitative',
		value: 0,
		groups: [],
		count: 0,
		success: false,
		trace: ['deliberate failure'],
		errors: ['deliberate failure'],
	}),
}

export function createRecordedReasoner(
	validations: ReturnType<typeof createRecorder<[Definition]>>,
): ReasonerInterface {
	return {
		id: 'counting',
		reasoning: 'quantitative',
		supports: (definition) => definition.reasoning === 'quantitative',
		validate: (definition) => {
			validations.handler(definition)
			return { valid: true, errors: [], warnings: [] }
		},
		reason: () => ({
			reasoning: 'quantitative',
			value: 0,
			groups: [],
			count: 0,
			success: true,
			trace: [],
			errors: [],
		}),
	}
}

export function createReasonDestroyedCalls(
	reason: ReturnType<typeof createReason>,
): ReadonlyArray<() => unknown> {
	return [
		() => reason.reasoners(),
		() => reason.reasoner('quantitative'),
		() => reason.supports('quantitative'),
		() => reason.register(createQuantitativeReasoner()),
		() => reason.validate(buildStaticDefinition()),
		() => reason.reason({}, buildStaticDefinition()),
	]
}

export function runDefinitionScale() {
	const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
	const definitions = sequence(300).map((n) => buildStaticDefinition(`def-${n}`, n))
	const results = definitions.map((definition) => {
		return expectQuantitative(reason.reason({}, definition))
	})
	reason.destroy()
	return results
}

export function runSubjectScale() {
	const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
	const events = createRecorders<ReasonEventMap, ReasonEvent>(reason.emitter, REASON_EVENTS)
	const subjects = buildSubjects(7500)
	const results = reason.reason(subjects, buildStaticDefinition('scale-def', 9))
	return { results, events }
}

export const evaluator = createEvaluator()

export const ageFrom18 = createCheck('age', 'from', 18)
export const scoreAbove50 = createCheck('score', 'above', 50)
export const nameEqualsAlice = createCheck('name', 'equals', 'Alice')

export function evaluateArray(
	comparison: Comparison,
	expected: readonly unknown[],
	actual: unknown,
): boolean {
	return evaluator.evaluate(createCheck('a', comparison, expected), { a: actual }).met
}

export const RISK_DEFINITION = createQuantitativeDefinition(
	'risk-score',
	'Risk Score',
	[
		createFactorGroup('age', 'sum', [
			createRangeFactor('age-band', 'age', [
				{ bounds: createBounds(undefined, 24), value: 30 },
				{ bounds: createBounds(25, 64), value: 15 },
				{ bounds: createBounds(65), value: 10 },
			]),
		]),
		createFactorGroup('financial', 'sum', [
			createFieldFactor('income-score', 'income', {
				transforms: [createTransform('divide', 1000)],
				bounds: createBounds(0, 40),
				fallback: 0,
			}),
			createLookupFactor('state-score', 'state', { CA: 5, NY: 8, TX: 2 }, { fallback: 1 }),
		]),
	],
	{ base: 10, bounds: createBounds(0, 100), precision: 2 },
)

export const ELIGIBILITY_DEFINITION = createLogicalDefinition(
	'eligibility',
	'Eligibility',
	[
		createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
		createRule('risk', [createAtom('riskScore', 'from', 40)], createAtom('riskOk', 'equals', true)),
		createRule(
			'eligible',
			[createAtom('adult', 'equals', true), createAtom('riskOk', 'equals', true)],
			createAtom('eligible', 'equals', true),
		),
	],
	{ depth: 5 },
)

export const RATE_DEFINITION = createSymbolicDefinition(
	'rate',
	'Rate',
	[
		createEquation(
			'base-rate',
			createVariable('baseRate'),
			createOperation(
				'subtract',
				createConstant(15),
				createOperation('divide', createVariable('riskScore'), createConstant(10)),
			),
			'baseRate',
		),
		createEquation(
			'final-rate',
			createVariable('finalRate'),
			createOperation('maximum', createVariable('baseRate'), createConstant(3)),
			'finalRate',
		),
	],
	{ precision: 2 },
)

export function readApplied(
	result: ReturnType<typeof expectLogical>,
	id: string,
): boolean | undefined {
	return result.rules.find((rule) => rule.id === id)?.applied
}

export function runReasonScenarios(
	reason: ReasonInterface,
	quantitativeSubject: Subject,
	logicalSubject: Subject,
	symbolicSubject: Subject,
	detInferentialDefinition: Definition,
) {
	return {
		quantitative: reason.reason(quantitativeSubject, RISK_DEFINITION),
		logical: reason.reason(logicalSubject, ELIGIBILITY_DEFINITION),
		symbolic: reason.reason(symbolicSubject, RATE_DEFINITION),
		inferential: reason.reason({}, detInferentialDefinition),
	}
}

export function runScalePipeline(
	SCALE_SCORE_DEFINITION: Definition,
	SCALE_THRESHOLD_DEFINITION: Definition,
) {
	const reason = createReason({
		reasoners: [createQuantitativeReasoner(), createLogicalReasoner()],
	})
	const subjects = buildSubjects(5000)

	const quantitativeResults = reason.reason(subjects, SCALE_SCORE_DEFINITION)
	const scores = quantitativeResults.map((result) => expectQuantitative(result).value)

	const logicalSubjects = scores.map((score) => ({ score }))
	const logicalResults = reason.reason(logicalSubjects, SCALE_THRESHOLD_DEFINITION)
	const conclusions = logicalResults.map((result) => expectLogical(result).conclusion)

	reason.destroy()
	return { scores, conclusions }
}

export const SCORE_DEFINITION = createQuantitativeDefinition(
	'score',
	'Score',
	[
		createFactorGroup('risk', 'sum', [
			createRangeFactor(
				'age',
				'age',
				[
					{ bounds: createBounds(undefined, 25), value: 30 },
					{ bounds: createBounds(26, 50), value: 15 },
					{ bounds: createBounds(51), value: 25 },
				],
				{ weight: 2 },
			),
			createLookupFactor(
				'region',
				'region',
				{ west: 10, east: 5, north: 8 },
				{ fallback: 0, weight: 1 },
			),
			createFieldFactor('claims', 'claims', { weight: 3 }),
		]),
		createFactorGroup('loyalty', 'average', [
			createFieldFactor('tenure', 'tenure', { weight: 1 }),
			createFieldFactor('incomeScore', 'income', {
				transforms: [createTransform('divide', 10000)],
				bounds: createBounds(0, 10),
				weight: 3,
			}),
		]),
		createFactorGroup('bonus', 'sum', [createStaticFactor('flat', 5)]),
	],
	{ base: 10, precision: 2 },
)

export const TIER_DEFINITION = createLogicalDefinition('tier', 'Tier', [
	createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
	createRule('senior', [createAtom('age', 'from', 65)], createAtom('senior', 'equals', true)),
	createRule(
		'scoreHigh',
		[createAtom('score', 'above', 60)],
		createAtom('highScore', 'equals', true),
	),
	createRule(
		'scoreMid',
		[createAtom('score', 'between', [40, 60])],
		createAtom('midScore', 'equals', true),
	),
	createRule('lowClaims', [createAtom('claims', 'to', 3)], createAtom('lowClaims', 'equals', true)),
	createRule('loyal', [createAtom('tenure', 'from', 5)], createAtom('loyal', 'equals', true)),
	createRule(
		'preferred',
		[createAtom('highScore', 'equals', true), createAtom('lowClaims', 'equals', true)],
		createAtom('preferred', 'equals', true),
	),
	createRule(
		'premium',
		[createAtom('preferred', 'equals', true), createAtom('loyal', 'equals', true)],
		createAtom('premium', 'equals', true),
	),
	createRule(
		'discountEligible',
		[createAtom('premium', 'equals', true), createAtom('adult', 'equals', true)],
		createAtom('discountEligible', 'equals', true),
	),
	createRule(
		'vip',
		[
			createAtom('premium', 'equals', true),
			createAtom('highScore', 'equals', true),
			createAtom('loyal', 'equals', true),
		],
		createAtom('vip', 'equals', true),
	),
	createRule(
		'finalTier',
		[createAtom('vip', 'equals', true), createAtom('discountEligible', 'equals', true)],
		createAtom('tier', 'equals', 3),
	),
])

export const RATE_CHAIN = createSymbolicDefinition(
	'rateChain',
	'Rate Chain',
	[
		createEquation(
			'e1',
			createVariable('premium'),
			createOperation('divide', createVariable('score'), createConstant(10)),
			'premium',
		),
		createEquation(
			'e2',
			createVariable('adjusted'),
			createOperation('add', createVariable('premium'), createVariable('rules')),
			'adjusted',
		),
		createEquation(
			'e3',
			createVariable('final'),
			createOperation('multiply', createVariable('adjusted'), createConstant(2)),
			'final',
		),
	],
	{ precision: 2 },
)

export const CLASSIFY = createInferentialDefinition(
	'classify',
	'Classify',
	[],
	[
		createInference(
			'cls',
			[createFact('p', 'has', ['final', '?f'])],
			createFact('c', 'classified', ['?f']),
		),
		createInference(
			'rev',
			[createFact('p2', 'classified', ['?f'])],
			createFact('c2', 'reviewed', ['?f']),
		),
	],
)

export function readVariablePresence(expression: SymbolicExpression) {
	return {
		present: containsVariable(expression, 'x', {}),
		absent: containsVariable(expression, 'y', {}),
	}
}

export interface Item {
	readonly id: string
	readonly v?: number
}

export function runUpsertScenario(seed: Subject): Subject {
	const subject = createSubjectBuilder(seed)
	subject.set('age', 31)
	subject.set('name', 'Alice')
	return subject.build()
}

export function runRemoveScenario(seed: Subject) {
	const subject = createSubjectBuilder(seed)
	const allExisted = subject.remove(['age', 'name'])
	const built = subject.build()
	return { allExisted, built }
}

export function runSubjectBuilderMergeScenario(base: Subject, incoming: Subject) {
	const subject = createSubjectBuilder(base)
	const events = createRecorders<SubjectBuilderEventMap, 'merge'>(subject.emitter, ['merge'])
	subject.merge(incoming)
	return { built: subject.build(), mergeCalls: events.merge.calls }
}

export function createSubjectBuilderDestroyedCalls(
	subject: SubjectBuilderInterface,
): ReadonlyArray<() => unknown> {
	return [
		() => subject.field('age'),
		() => subject.fields(),
		() => subject.set('age', 31),
		() => subject.remove('age'),
		() => subject.merge({ age: 31 }),
		() => subject.clear(),
		() => subject.repeat(2),
		() => subject.build(),
	]
}

export function createSubjectBuilderUnbrandedBuilder() {
	return { build: () => ({ id: 's1' }) }
}

export function createVariableManagerEvents(manager: Pick<VariableManager, 'emitter'>) {
	return createRecorders<VariableManagerEventMap, 'add' | 'remove' | 'destroy'>(manager.emitter, [
		'add',
		'remove',
		'destroy',
	])
}

export function createVariableManagerDestroyedCalls(
	variables: ReturnType<typeof createVariableManager>,
): ReadonlyArray<() => unknown> {
	return [
		() => variables.variable('x'),
		() => variables.variables(),
		() => variables.add('y', 2),
		() => variables.remove('x'),
		() => variables.remove(['x']),
		() => variables.remove(),
		() => variables.seat({}),
	]
}

export function createRuleFixture(id: string) {
	return createRule(id, [createAtom('age', 'from', 18)], createAtom(id, 'equals', true))
}

export function createRuleManagerEvents(manager: Pick<RuleManager, 'emitter'>) {
	return createRecorders<
		RuleManagerEventMap,
		'append' | 'prepend' | 'replace' | 'remove' | 'destroy'
	>(manager.emitter, ['append', 'prepend', 'replace', 'remove', 'destroy'])
}

export function createRuleManagerTargetCalls(
	rules: ReturnType<typeof createRuleManager>,
): ReadonlyArray<() => unknown> {
	return [
		() => rules.append(createRuleFixture('b'), 'absent'),
		() => rules.prepend(createRuleFixture('c'), 'absent'),
	]
}

export function createRuleManagerDestroyedCalls(
	rules: ReturnType<typeof createRuleManager>,
): ReadonlyArray<() => unknown> {
	return [
		() => rules.rule('a'),
		() => rules.rules(),
		() => rules.append(createRuleFixture('b')),
		() => rules.prepend(createRuleFixture('c')),
		() => rules.replace(createRuleFixture('a')),
		() => rules.remove('a'),
		() => rules.remove(['a']),
		() => rules.remove(),
		() => rules.seat([]),
	]
}

export function createInferenceFixture(id: string, predicate = 'mortal') {
	const premise = createFact('p1', 'human', ['?x'])
	const conclusion = createFact('c1', predicate, ['?x'])
	return createInference(id, [premise], conclusion)
}

export function createInferenceManagerEvents(manager: Pick<InferenceManager, 'emitter'>) {
	return createRecorders<
		InferenceManagerEventMap,
		'append' | 'prepend' | 'replace' | 'remove' | 'destroy'
	>(manager.emitter, ['append', 'prepend', 'replace', 'remove', 'destroy'])
}

export function createInferenceManagerTargetCalls(
	inferences: ReturnType<typeof createInferenceManager>,
): ReadonlyArray<() => unknown> {
	return [
		() => inferences.append(createInferenceFixture('b'), 'absent'),
		() => inferences.prepend(createInferenceFixture('c'), 'absent'),
	]
}

export function createInferenceManagerDestroyedCalls(
	inferences: ReturnType<typeof createInferenceManager>,
): ReadonlyArray<() => unknown> {
	return [
		() => inferences.inference('a'),
		() => inferences.inferences(),
		() => inferences.append(createInferenceFixture('b')),
		() => inferences.prepend(createInferenceFixture('c')),
		() => inferences.replace(createInferenceFixture('a')),
		() => inferences.remove('a'),
		() => inferences.remove(['a']),
		() => inferences.remove(),
	]
}

export function createGroupManagerEvents(manager: Pick<GroupManager, 'emitter'>) {
	return createRecorders<
		GroupManagerEventMap,
		'append' | 'prepend' | 'replace' | 'remove' | 'destroy'
	>(manager.emitter, ['append', 'prepend', 'replace', 'remove', 'destroy'])
}

export function createGroupManagerTargetCalls(
	groups: ReturnType<typeof createGroupManager>,
): ReadonlyArray<() => unknown> {
	return [
		() => groups.append(createFactorGroup('b', 'sum', []), 'absent'),
		() => groups.prepend(createFactorGroup('c', 'sum', []), 'absent'),
	]
}

export function createGroupManagerDestroyedCalls(
	groups: ReturnType<typeof createGroupManager>,
): ReadonlyArray<() => unknown> {
	return [
		() => groups.group('a'),
		() => groups.groups(),
		() => groups.append(createFactorGroup('b', 'sum', [createStaticFactor('f', 1)])),
		() => groups.prepend(createFactorGroup('c', 'sum', [])),
		() => groups.replace(createFactorGroup('a', 'sum', [])),
		() => groups.remove('a'),
		() => groups.remove(['a']),
		() => groups.remove(),
		() => groups.seat([]),
	]
}

export function createSeededManagers(ids: readonly string[] = []) {
	const values = ids.map((id) => createStaticFactor(id, 1))
	const groups = createGroupManager({
		groups: [createFactorGroup('drivers', 'sum', values)],
	})
	return { groups, factors: createFactorManager(groups) }
}

export function createFactorManagerEvents(manager: Pick<FactorManager, 'emitter'>) {
	return createRecorders<
		FactorManagerEventMap,
		'append' | 'prepend' | 'replace' | 'remove' | 'destroy'
	>(manager.emitter, ['append', 'prepend', 'replace', 'remove', 'destroy'])
}

export function createLocatorCalls(
	factors: ReturnType<typeof createSeededManagers>['factors'],
): ReadonlyArray<() => unknown> {
	return [
		() => factors.factor('absent', 'a'),
		() => factors.factors('absent'),
		() => factors.append('absent', createStaticFactor('a', 1)),
		() => factors.prepend('absent', createStaticFactor('a', 1)),
		() => factors.replace('absent', createStaticFactor('a', 1)),
		() => factors.remove('absent', 'a'),
		() => factors.remove('absent'),
	]
}

export function createFactorManagerTargetCalls(
	factors: ReturnType<typeof createSeededManagers>['factors'],
): ReadonlyArray<() => unknown> {
	return [
		() => factors.append('drivers', createStaticFactor('b', 1), 'absent'),
		() => factors.prepend('drivers', createStaticFactor('c', 1), 'absent'),
	]
}

export function createFactorManagerDestroyedCalls(
	factors: ReturnType<typeof createSeededManagers>['factors'],
): ReadonlyArray<() => unknown> {
	return [
		() => factors.factor('drivers', 'a'),
		() => factors.factors('drivers'),
		() => factors.append('drivers', createStaticFactor('b', 1)),
		() => factors.prepend('drivers', createStaticFactor('c', 1)),
		() => factors.replace('drivers', createStaticFactor('a', 1)),
		() => factors.remove('drivers', 'a'),
		() => factors.remove('drivers', ['a']),
		() => factors.remove('drivers'),
	]
}

export function createFactFixture(id: string, term = 'socrates') {
	return createFact(id, 'human', [term])
}

export function createFactManagerEvents(manager: Pick<FactManager, 'emitter'>) {
	return createRecorders<
		FactManagerEventMap,
		'append' | 'prepend' | 'replace' | 'remove' | 'destroy'
	>(manager.emitter, ['append', 'prepend', 'replace', 'remove', 'destroy'])
}

export function createFactManagerTargetCalls(
	facts: ReturnType<typeof createFactManager>,
): ReadonlyArray<() => unknown> {
	return [
		() => facts.append(createFactFixture('b'), 'absent'),
		() => facts.prepend(createFactFixture('c'), 'absent'),
	]
}

export function createFactManagerDestroyedCalls(
	facts: ReturnType<typeof createFactManager>,
): ReadonlyArray<() => unknown> {
	return [
		() => facts.fact('a'),
		() => facts.facts(),
		() => facts.append(createFactFixture('b')),
		() => facts.prepend(createFactFixture('c')),
		() => facts.replace(createFactFixture('a')),
		() => facts.remove('a'),
		() => facts.remove(['a']),
		() => facts.remove(),
	]
}

export function createEquationFixture(id: string, value = 42) {
	return createEquation(id, createVariable(id), createConstant(value), id)
}

export function createEquationManagerEvents(manager: Pick<EquationManager, 'emitter'>) {
	return createRecorders<
		EquationManagerEventMap,
		'append' | 'prepend' | 'replace' | 'remove' | 'destroy'
	>(manager.emitter, ['append', 'prepend', 'replace', 'remove', 'destroy'])
}

export function createEquationManagerTargetCalls(
	equations: ReturnType<typeof createEquationManager>,
): ReadonlyArray<() => unknown> {
	return [
		() => equations.append(createEquationFixture('b'), 'absent'),
		() => equations.prepend(createEquationFixture('c'), 'absent'),
	]
}

export function createEquationManagerDestroyedCalls(
	equations: ReturnType<typeof createEquationManager>,
): ReadonlyArray<() => unknown> {
	return [
		() => equations.equation('a'),
		() => equations.equations(),
		() => equations.append(createEquationFixture('b')),
		() => equations.prepend(createEquationFixture('c')),
		() => equations.replace(createEquationFixture('a')),
		() => equations.remove('a'),
		() => equations.remove(['a']),
		() => equations.remove(),
	]
}

export interface Entry {
	readonly id: string
	readonly value: number
}

export function createEntry(id: string, value = 0): Entry {
	return { id, value }
}

export function createCollection(...ids: readonly string[]) {
	const entries = ids.map((id) => createEntry(id))
	return new Collection<Entry>('TestOwner', entries)
}

export function createCollectionTargetCalls(
	items: ReturnType<typeof createCollection>,
): ReadonlyArray<() => unknown> {
	return [
		() => items.append(createEntry('b'), 'absent'),
		() => items.prepend(createEntry('c'), 'absent'),
	]
}

export function createCollectionDestroyedCalls(
	items: ReturnType<typeof createCollection>,
): ReadonlyArray<() => unknown> {
	return [
		() => items.item('a'),
		() => items.items(),
		() => items.append(createEntry('b')),
		() => items.prepend(createEntry('c')),
		() => items.replace(createEntry('a')),
		() => items.remove('a'),
		() => items.seat([]),
	]
}

export function runQuantitativeScenario(seed: Definition): QuantitativeDefinition {
	const definition = createDefinitionBuilder(seed)
	definition.groups.append(createFactorGroup('g1', 'sum', []))
	definition.groups.append(createFactorGroup('g2', 'sum', []))
	definition.groups.prepend(createFactorGroup('g0', 'sum', []))
	definition.factors.append('g1', createStaticFactor('f1', 10))
	definition.factors.prepend('g1', createStaticFactor('f0', 5))
	definition.factors.append('g1', createStaticFactor('f2', 1))
	definition.factors.replace('g1', createStaticFactor('f2', 99))
	definition.factors.remove('g1', 'f0')
	definition.groups.replace(createFactorGroup('g2', 'product', []))
	definition.groups.remove('g0')
	const built = definition.build()
	if (built.reasoning !== 'quantitative') throw new Error('expected quantitative')
	return built
}

export function runLogicalScenario(
	seed: Definition,
	r1: ReturnType<typeof createRule>,
	r2: ReturnType<typeof createRule>,
	r3: ReturnType<typeof createRule>,
) {
	const definition = createDefinitionBuilder(seed)
	definition.rules.append(r1)
	definition.rules.append(r2)
	definition.rules.prepend(r3)
	definition.rules.replace(createRule('r2', [], createAtom('flag', 'equals', false)))
	const built = definition.build()
	if (built.reasoning !== 'logical') throw new Error('expected logical')
	return built
}

export function runSymbolicScenario(
	seed: Definition,
	e1: ReturnType<typeof createEquation>,
	e2: ReturnType<typeof createEquation>,
) {
	const definition = createDefinitionBuilder(seed)
	definition.equations.append(e1)
	definition.equations.prepend(e2)
	definition.equations.replace(createEquation('e1', createVariable('x'), createConstant(9), 'x'))
	definition.variables.add('a', 1)
	definition.variables.add('b', 2)
	definition.variables.remove('a')
	const built = definition.build()
	if (built.reasoning !== 'symbolic') throw new Error('expected symbolic')
	return built
}

export function runInferentialScenario(
	seed: Definition,
	f1: ReturnType<typeof createFact>,
	f2: ReturnType<typeof createFact>,
	i1: ReturnType<typeof createInference>,
	i2: ReturnType<typeof createInference>,
) {
	const definition = createDefinitionBuilder(seed)
	definition.facts.append(f1)
	definition.facts.prepend(f2)
	definition.inferences.append(i1)
	definition.inferences.replace(
		createInference('i1', [createFact('p', 'human', ['?z'])], createFact('c', 'mortal', ['?z'])),
	)
	definition.inferences.prepend(i2)
	const built = definition.build()
	if (built.reasoning !== 'inferential') throw new Error('expected inferential')
	return built
}

export function runOffKindScenario(): QuantitativeDefinition {
	const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []))
	definition.rules.append(createRule('r1', [], createAtom('a', 'equals', true)))
	definition.equations.append(createEquation('e1', createVariable('x'), createConstant(1), 'x'))
	definition.variables.add('x', 1)
	definition.facts.append(createFact('f1', 'human', ['socrates']))
	definition.inferences.append(
		createInference('i1', [createFact('p', 'human', ['?x'])], createFact('c', 'mortal', ['?x'])),
	)
	const built = definition.build()
	if (built.reasoning !== 'quantitative') throw new Error('expected quantitative')
	return built
}

export function runDefinitionBuilderMergeScenario(base: Definition, incoming: Definition) {
	const definition = createDefinitionBuilder(base)
	const events = createRecorders<DefinitionBuilderEventMap, 'merge'>(definition.emitter, ['merge'])
	definition.merge(incoming)
	const built = definition.build()
	if (built.reasoning !== 'quantitative') throw new Error('expected quantitative')
	return { built, mergeCalls: events.merge.calls }
}

export function createDefinitionBuilderDestroyedCalls(
	definition: DefinitionBuilderInterface,
): ReadonlyArray<() => unknown> {
	return [
		() => definition.build(),
		() => definition.merge(createQuantitativeDefinition('risk', 'Risk', [])),
		() => definition.clear('description'),
		() => definition.groups.groups(),
		() => definition.groups.append(createFactorGroup('g2', 'sum', [])),
		() => definition.factors.factors('g1'),
		() => definition.factors.append('g1', createStaticFactor('f1', 10)),
		() => definition.rules.rules(),
		() => definition.equations.equations(),
		() => definition.variables.variables(),
		() => definition.facts.facts(),
		() => definition.inferences.inferences(),
	]
}

export function createDefinitionBuilderUnbrandedBuilder() {
	return { build: () => createQuantitativeDefinition('risk', 'Risk', []) }
}

export const QUANTITATIVE_RESULT: QuantitativeResult = {
	reasoning: 'quantitative',
	value: 42,
	groups: [],
	count: 0,
	success: true,
	trace: [],
	errors: [],
}

export const LOGICAL_RESULT: LogicalResult = {
	reasoning: 'logical',
	conclusion: true,
	rules: [],
	count: 0,
	success: true,
	trace: [],
	errors: [],
}

export const SYMBOLIC_RESULT: SymbolicResult = {
	reasoning: 'symbolic',
	solutions: {},
	success: true,
	trace: [],
	errors: [],
}

export const INFERENTIAL_RESULT: InferentialResult = {
	reasoning: 'inferential',
	derived: [],
	success: true,
	trace: [],
	errors: [],
}

export const NARROWERS: ReadonlyArray<{
	readonly reasoning: Reasoning
	readonly narrow: (result: ReasonResult | readonly ReasonResult[]) => ReasonResult
	readonly result: ReasonResult
}> = Object.freeze([
	{ reasoning: 'quantitative', narrow: expectQuantitative, result: QUANTITATIVE_RESULT },
	{ reasoning: 'logical', narrow: expectLogical, result: LOGICAL_RESULT },
	{ reasoning: 'symbolic', narrow: expectSymbolic, result: SYMBOLIC_RESULT },
	{ reasoning: 'inferential', narrow: expectInferential, result: INFERENTIAL_RESULT },
])

export const LEAF: Expression = {
	form: 'atom',
	check: { field: 'age', operator: 'equals', value: 30 },
}

export const TERM: SymbolicExpression = { form: 'constant', value: 5 }

export const STEP: SymbolicExpression = { form: 'constant', value: 2 }

export function readCompoundLayers(
	node: Expression,
	visit: (node: Extract<Expression, { readonly form: 'compound' }>) => void,
	layers = 0,
): readonly [Expression, number] {
	if (node.form !== 'compound') return [node, layers]
	visit(node)
	return readCompoundLayers(requireValue(node.operands[0]), visit, layers + 1)
}

export function readAdditionLayers(
	node: SymbolicExpression,
	visit: (node: Extract<SymbolicExpression, { readonly form: 'operation' }>) => void,
	layers = 0,
): readonly [SymbolicExpression, number] {
	if (node.form !== 'operation') return [node, layers]
	visit(node)
	return readAdditionLayers(node.left, visit, layers + 1)
}
