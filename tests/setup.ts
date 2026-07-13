// Base test setup — environment-agnostic helpers loaded first by every
// Vitest project (`setupFiles[0]`). Keep this file free of `node:*` and of
// `document` / `window` / Vue: DOM/Vue helpers live in `setupBrowser.ts`.

import type { EmitterInterface, EventMap } from '@orkestrel/emitter'
import { isArray, isRecord } from '@orkestrel/contract'
import type {
	Expression,
	InferentialResult,
	LogicalResult,
	QuantitativeDefinition,
	QuantitativeResult,
	ReasonerInterface,
	Reasoning,
	ReasonResult,
	Subject,
	SymbolicExpression,
	SymbolicResult,
} from '@src/core'
import { compound, factorGroup, operation, quantitativeDefinition, staticFactor } from '@src/core'
import { afterEach, vi } from 'vitest'

afterEach(() => {
	vi.restoreAllMocks()
})

// A real callback that records its calls — use instead of a mock when a test
// only needs to count invocations or inspect arguments.
export interface TestRecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}

export function createRecorder<
	TArgs extends readonly unknown[] = readonly unknown[],
>(): TestRecorderInterface<TArgs> {
	const calls: TArgs[] = []
	return {
		get calls() {
			return calls
		},
		get count() {
			return calls.length
		},
		handler: (...args: TArgs) => {
			calls.push(args)
		},
		clear() {
			calls.length = 0
		},
	}
}

/**
 * Create a recorder for an {@link import('@src/core').EmitterErrorHandler} — the emitter's
 * own listener-error channel (AGENTS §13): a `TestRecorderInterface<[error, event]>` whose
 * `handler` is wired as the `error` option, so an emit-safety test asserts a buggy listener's
 * throw was routed here (with the offending event name) instead of corrupting the entity.
 * Argument order is `(error, event)`, matching `EmitterErrorHandler`. A thin alias over
 * {@link createRecorder} (AGENTS §16.1 — extract-once over the per-entity emit-safety blocks).
 *
 * @returns A recorder of `[error: unknown, event: string]` calls
 */
export function createErrorRecorder(): TestRecorderInterface<
	readonly [error: unknown, event: string]
> {
	return createRecorder<readonly [error: unknown, event: string]>()
}

/** A {@link createRecorder} per listed event of an `EmitterInterface`, keyed by event name. */
export type EmitterRecorders<TMap extends EventMap, TName extends keyof TMap> = {
	readonly [K in TName]: TestRecorderInterface<TMap[K]>
}

/**
 * Wire one {@link createRecorder} onto `emitter` for each of the named events — the
 * one generic form of the per-entity `recordXEvents` bundles (AGENTS §16.1). Each
 * recorder subscribes via `emitter.on(name, recorder.handler)` and is returned keyed
 * by its event name, typed with that event's argument tuple — so a test asserts what
 * fired (`events.write.calls`) and with which payload, exactly as the local bundles did.
 *
 * @typeParam TMap - The emitter's {@link EventMap}
 * @typeParam TName - The subset of event names to record (inferred from `events`)
 * @param emitter - The emitter to subscribe the recorders to
 * @param events - The event names to record (each becomes a key of the result)
 * @returns A recorder per name, each subscribed and keyed by event name
 */
export function recordEmitterEvents<TMap extends EventMap, TName extends keyof TMap>(
	emitter: EmitterInterface<TMap>,
	events: readonly TName[],
): EmitterRecorders<TMap, TName> {
	// Accumulate into a `Partial` of the exact mapped shape — every value keeps its
	// precise per-event tuple type (a recorder is invariant in its argument tuple, so a
	// widened record won't hold it), all keys optional until assigned. Each recorder is
	// created against its event's tuple, so `on(name, handler)` is precisely typed as it
	// is wired. The dynamic key list is the untyped edge: once every listed name is
	// present we narrow `Partial` → total through a guard, never an assertion (§14).
	const recorders: Partial<EmitterRecorders<TMap, TName>> = {}
	for (const name of events) {
		const recorder = createRecorder<TMap[typeof name]>()
		emitter.on(name, recorder.handler)
		recorders[name] = recorder
	}
	if (!isTotal(recorders, events)) {
		throw new Error('recordEmitterEvents: a recorder was not wired for every event')
	}
	return recorders
}

/**
 * Narrow an accumulated `Partial<EmitterRecorders>` to its total mapped form once every
 * listed event has a recorder present — the §14 guard standing in for an assertion in
 * {@link recordEmitterEvents} (whose loop assigns one recorder per name, so this holds;
 * the explicit per-name presence check keeps the narrowing a sound guard, not a cast).
 *
 * @typeParam TMap - The emitter's {@link EventMap}
 * @typeParam TName - The subset of event names that must each have a recorder
 * @param recorders - The partially-accumulated recorder map to narrow
 * @param events - The event names that must all be present for the map to be total
 * @returns Whether every listed event has a recorder (narrowing `recorders` to total)
 */
export function isTotal<TMap extends EventMap, TName extends keyof TMap>(
	recorders: Partial<EmitterRecorders<TMap, TName>>,
	events: readonly TName[],
): recorders is EmitterRecorders<TMap, TName> {
	return events.every((name) => recorders[name] !== undefined)
}

/**
 * Run `thunk` and return the value it threw, or `undefined` if it returned normally — the
 * one shared form of the `try { …; return undefined } catch (error) { return error }` IIFE
 * the error-path tests repeat (AGENTS §16.1). Lets a caller assert on the captured fault
 * unconditionally, never inside a conditional `expect`. For a synchronous throw site; an
 * async rejection is asserted with `await expect(…).rejects` instead.
 *
 * @param thunk - The (synchronous) operation to run and capture the throw of
 * @returns The thrown value, or `undefined` when `thunk` did not throw
 */
export function captureError(thunk: () => unknown): unknown {
	try {
		thunk()
		return undefined
	} catch (error) {
		return error
	}
}

/**
 * Narrow a `reason()` return to a `QuantitativeResult` — throws on a batch
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
 * Narrow a `reason()` return to a `LogicalResult` — throws on a batch array or
 * a result of another reasoning (the {@link expectQuantitative} sibling).
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
 * Narrow a `reason()` return to a `SymbolicResult` — throws on a batch array or
 * a result of another reasoning (the {@link expectQuantitative} sibling).
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
 * Narrow a `reason()` return to an `InferentialResult` — throws on a batch
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
 * Recursively `Object.freeze` a value and every nested plain object/array it
 * reaches — the deep-frozen-input stress the no-mutation reasoner tests share
 * (AGENTS §16.1), so a mutation anywhere in the input tree throws in strict
 * mode instead of silently succeeding. Narrows with {@link isArray} /
 * {@link isRecord} (never an `as`, AGENTS §1) and recurses only into a plain
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
 * The recurring flat `Subject` of the evaluator / reasoner tests — one field of
 * each scalar kind (number / string / boolean) plus an `id`, so check operators
 * and subject-binding paths read real data without re-typing the literal
 * (AGENTS §16.1).
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
 * The recurring nested `Subject` — two levels of nesting for the `FieldPath`
 * array-descent cases (a STRING field is ONE key; an ARRAY descends).
 */
export const NESTED_SUBJECT: Subject = {
	id: 'nested-1',
	address: { city: 'NY', zip: '10001' },
	scores: { math: 90, english: 80 },
}

/**
 * The recurring driver-scoring `Subject` — the multi-factor scenario the
 * evaluator and quantitative-reasoner tests share (AGENTS §16.1).
 */
export const DRIVER_SUBJECT: Subject = {
	driverAge: 22,
	violationCount: 0,
	vehicleYear: 2020,
}

/**
 * Build the simplest runnable `QuantitativeDefinition` — one sum group holding
 * one static factor, producing `value` on ANY subject. The shared definition the
 * orchestrator / factory tests dispatch when the scenario only needs SOME
 * working definition (AGENTS §16.1).
 *
 * @param id - The definition id (and name); defaults to `'static-quant'`
 * @param value - The static factor's value (the run's result); defaults to `42`
 * @returns The assembled quantitative definition
 */
export function buildStaticDefinition(id = 'static-quant', value = 42): QuantitativeDefinition {
	return quantitativeDefinition(id, id, [factorGroup('g1', 'sum', [staticFactor('f1', value)])])
}

/**
 * Create a REAL `ReasonerInterface` whose `reason` always throws
 * `new Error(message)` — the scripted collaborator driving the orchestrator's
 * `bail` / `error`-event paths (AGENTS §16.1: a real implementation of the
 * seam, not a mock of the orchestrator).
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
 * Invoke a method with deliberately malformed arguments, bypassing its
 * compile-time parameter types — the runtime-validation idiom for feeding a
 * unit under test input its signature forbids (a malformed definition, an
 * unknown operator) WITHOUT `as` (AGENTS §1/§14). `Reflect.apply` carries the
 * raw arguments past the type system while the method's declared RETURN type is
 * kept (pass `T` explicitly for overloaded methods), so assertions on the
 * result stay typed.
 *
 * @typeParam T - The method's return type
 * @param target - The receiver (`this`) to invoke the method on
 * @param method - The method whose parameter types are bypassed
 * @param args - The raw arguments to hand it
 * @returns Whatever the method returns
 */
export function invokeRaw<T>(
	target: unknown,
	method: (...args: never[]) => T,
	args: readonly unknown[],
): T {
	return Reflect.apply(method, target, [...args])
}

/**
 * Run `scenario` twice against fresh state and return both outcomes — the shared
 * form of the byte-identical `twice(scenario)` closure `DefinitionBuilder.test.ts`
 * and `SubjectBuilder.test.ts` each define locally (AGENTS §16.1), used throughout
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
 * A `count`-long ascending integer range starting at `start` — the shared
 * numeric-sequence fixture the aggregation / scale tests build inputs from
 * (AGENTS §16.1), replacing repeated `Array.from({ length: n }, (_, i) => i)`.
 * an empty range for `count <= 0`.
 *
 * @param count - How many integers to produce
 * @param start - The first integer of the range; defaults to `0`
 * @returns The `count`-long ascending integer range
 */
export function sequence(count: number, start = 0): readonly number[] {
	return Array.from({ length: Math.max(count, 0) }, (_unused, index) => start + index)
}

/**
 * An array of `count` copies of `value` — the uniform-input fill the aggregator /
 * transformer scale tests exercise (AGENTS §16.1). For a reference `value` every slot
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
 * The curated JavaScript numeric edge values the numeric-quirk tests probe — signed
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
 * The curated adversarial / unicode object keys the field-path, subject-key, id, and
 * lookup-table tests probe — the `Object.prototype` / prototype-pollution names, an empty
 * key, a surrogate-pair (astral) key, a combining-sequence key, an NFC-labile key (`Å`
 * ANGSTROM SIGN, which NFC-normalizes to `Å`), and a DOTTED key (`'a.b'`) that proves a
 * single-string `FieldPath` is ONE key, never dot-split. Frozen so a test can share it
 * without risk of mutation.
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
 * A `length`-long array with REAL holes everywhere except the given
 * `(index, value)` pairs — the sparse-array fixture the array-handling tests
 * probe (AGENTS §16.1). Built from `new Array(length)`, so unfilled slots are
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
 * Nest `leaf` inside `depth` layers of a single-operand `'and'`
 * compound — the deep-expression-tree fixture the recursion / stack
 * -depth tests probe (AGENTS §16.1). `depth <= 0` returns `leaf` itself,
 * unwrapped.
 *
 * @param depth - How many `'and'` compound layers to nest
 * @param leaf - The innermost expression
 * @returns `leaf` wrapped in `depth` nested `'and'` compounds
 */
export function deepCompound(depth: number, leaf: Expression): Expression {
	let result = leaf
	for (let index = 0; index < depth; index += 1) {
		result = compound('and', [result])
	}
	return result
}

/**
 * Left-nest `depth` layers of an `'add'` operation around `leaf`,
 * each layer adding `step` — the deep-symbolic-tree fixture the recursion /
 * stack-depth tests probe (AGENTS §16.1). `depth <= 0` returns `leaf` itself,
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
	let result = leaf
	for (let index = 0; index < depth; index += 1) {
		result = operation('add', result, step)
	}
	return result
}

/**
 * A frozen `Subject` whose integer-like keys are authored deliberately
 * OUT of order — the enumeration-order fixture the subject-key / field-path
 * tests probe (AGENTS §16.1). Per the spec, integer-index string keys
 * (`"1"`, `"2"`, `"10"`) always enumerate ascending numerically FIRST,
 * regardless of authoring order, followed by the ordinary string keys in
 * insertion order: `Object.keys(INTEGER_KEY_SUBJECT)` yields
 * `['1', '2', '10', 'id', 'zeta', 'alpha']`. Every non-`id` value is a
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

/** A symbol key used by {@link ADVERSARIAL_VALUE_SUBJECT} — invisible to `Object.keys`. */
export const ADVERSARIAL_SYMBOL_KEY: unique symbol = Symbol('adversarial')

/**
 * A frozen `Subject` exercising the adversarial value shapes
 * `subjectToFacts` must classify correctly (AGENTS §16.1): a
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
 * `count` subjects `{ id: "s0", value: 0 }, { id: "s1", value: 1 }, …` built
 * from {@link sequence} — the batch-of-subjects fixture the scale /
 * aggregation tests feed a reasoner instead of hand-writing a
 * literal array (AGENTS §16.1).
 *
 * @param count - How many subjects to produce
 * @returns The `count`-long array of subjects
 */
export function buildSubjects(count: number): readonly Subject[] {
	return sequence(count).map((index) => ({ id: `s${index}`, value: index }))
}
