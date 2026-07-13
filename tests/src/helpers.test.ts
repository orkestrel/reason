import { describe, expect, it } from 'vitest'
import type { Result } from '@src/core'
import {
	attempt,
	cloneValue,
	createDeferred,
	escapeRegExp,
	formatField,
	freezeValue,
	interpolateMessage,
	isFailure,
	isRecord,
	isSuccess,
	omitUndefined,
	resolveField,
	setField,
	slugify,
} from '@src/core'

describe('Result guards', () => {
	it('narrows a success result with isSuccess', () => {
		const ok: Result<number> = { success: true, value: 42 }
		expect(isSuccess(ok)).toBe(true)
		expect(isFailure(ok)).toBe(false)
		// Narrow via the guard, then assert unconditionally (no conditional expect).
		const value = isSuccess(ok) ? ok.value : undefined
		expect(value).toBe(42)
	})

	it('narrows a failure result with isFailure', () => {
		const bad: Result<number> = { success: false, error: new Error('nope') }
		expect(isFailure(bad)).toBe(true)
		expect(isSuccess(bad)).toBe(false)
		const message = isFailure(bad) ? bad.error.message : undefined
		expect(message).toBe('nope')
	})
})

describe('helpers', () => {
	it('attempt captures a return value as success', () => {
		const outcome = attempt(() => 21)
		expect(outcome.success).toBe(true)
		const value = outcome.success ? outcome.value : undefined
		expect(value).toBe(21)
	})

	it('attempt contains a thrown Error as failure', () => {
		const outcome = attempt(() => {
			throw new Error('boom')
		})
		expect(outcome.success).toBe(false)
		const error = outcome.success ? undefined : outcome.error
		expect(error).toBeInstanceOf(Error)
		expect(error?.message).toBe('boom')
	})

	it('attempt normalises a non-Error throw to an Error', () => {
		const reason = (): unknown => 'plain failure'
		const outcome = attempt(() => {
			throw reason()
		})
		expect(outcome.success).toBe(false)
		const error = outcome.success ? undefined : outcome.error
		expect(error).toBeInstanceOf(Error)
		expect(error?.message).toBe('plain failure')
	})
})

describe('resolveField', () => {
	it('reads a single top-level key', () => {
		const record: Record<string, unknown> = { name: 'Ada', count: 1 }
		expect(resolveField(record, 'name')).toBe('Ada')
		expect(resolveField(record, 'count')).toBe(1)
		expect(resolveField(record, 'missing')).toBeUndefined()
	})

	it('descends a nested key path', () => {
		const record: Record<string, unknown> = {
			user: { profile: { name: 'Ada' }, roles: ['admin', 'editor'] },
		}
		expect(resolveField(record, ['user', 'profile', 'name'])).toBe('Ada')
		expect(resolveField(record, ['user', 'profile'])).toEqual({ name: 'Ada' })
		// An array element reached by string index along the path.
		expect(resolveField(record, ['user', 'roles', '0'])).toBe('admin')
		expect(resolveField(record, ['user', 'roles', '1'])).toBe('editor')
	})

	it('returns the record itself for an empty path', () => {
		const record: Record<string, unknown> = { a: 1 }
		expect(resolveField(record, [])).toBe(record)
	})

	it('returns undefined when a segment is missing or non-object', () => {
		const record: Record<string, unknown> = { user: { name: 'Ada' }, scalar: 7 }
		expect(resolveField(record, ['user', 'missing'])).toBeUndefined()
		expect(resolveField(record, ['missing', 'name'])).toBeUndefined()
		// A scalar intermediate cannot be descended into.
		expect(resolveField(record, ['scalar', 'whatever'])).toBeUndefined()
	})

	it('treats a single string key literally (no dot-splitting)', () => {
		const record: Record<string, unknown> = { 'a.b': 'literal', a: { b: 'nested' } }
		// 'a.b' is ONE key — distinct from the path ['a', 'b'].
		expect(resolveField(record, 'a.b')).toBe('literal')
		expect(resolveField(record, ['a', 'b'])).toBe('nested')
	})

	it('stays total — never throws — when over-descending past a leaf', () => {
		const record: Record<string, unknown> = { a: 1 }
		expect(() => resolveField(record, ['a', 'b', 'c', 'd'])).not.toThrow()
		expect(resolveField(record, ['a', 'b', 'c', 'd'])).toBeUndefined()
	})
})

describe('formatField — display form of a FieldPath', () => {
	it('returns a string key as itself', () => {
		expect(formatField('age')).toBe('age')
	})

	it('joins array segments with a dot', () => {
		expect(formatField(['address', 'city'])).toBe('address.city')
	})

	it('a dotted string passes through untouched (never re-split)', () => {
		expect(formatField('a.b')).toBe('a.b')
	})

	it('an empty array joins to the empty string', () => {
		expect(formatField([])).toBe('')
	})
})

describe('setField', () => {
	it('writes array paths and creates intermediate records', () => {
		const record: Record<string, unknown> = {}
		setField(record, ['a', 'b'], 42)
		expect(record).toEqual({ a: { b: 42 } })
	})

	it('treats a dotted string as one literal key', () => {
		const record: Record<string, unknown> = {}
		setField(record, 'flat.key', 7)
		expect(record).toEqual({ 'flat.key': 7 })
	})

	it('overwrites non-record intermediates when descending', () => {
		const record: Record<string, unknown> = { a: 1 }
		setField(record, ['a', 'b'], 2)
		expect(record).toEqual({ a: { b: 2 } })
	})

	it('leaves the record unchanged for an empty array path', () => {
		const record: Record<string, unknown> = { a: 1 }
		setField(record, [], 2)
		expect(record).toEqual({ a: 1 })
	})
})

describe('setField — prototype-pollution safety', () => {
	it('refuses forbidden path segments and never reaches or mutates a prototype object', () => {
		const arrayTarget: Record<string, unknown> = {}
		setField(arrayTarget, ['__proto__', 'polluted'], 1)
		const stringTarget: Record<string, unknown> = {}
		setField(stringTarget, '__proto__', { x: 1 })
		const constructorTarget: Record<string, unknown> = {}
		setField(constructorTarget, ['constructor', 'prototype', 'y'], 1)
		const fresh: Record<string, unknown> = {}
		// No global key leaks onto any object through the prototype chain.
		expect('polluted' in {}).toBe(false)
		expect(fresh.polluted).toBeUndefined()
		expect(fresh.y).toBeUndefined()
		expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
		expect(Object.hasOwn(Object.prototype, 'y')).toBe(false)
		expect(Object.hasOwn(Function.prototype, 'y')).toBe(false)
		// The forbidden writes are no-ops — targets stay empty with an intact prototype.
		expect(arrayTarget).toEqual({})
		expect(constructorTarget).toEqual({})
		expect(stringTarget).toEqual({})
		expect(Object.getPrototypeOf(stringTarget)).toBe(Object.prototype)
	})

	it('still writes legitimate nested fields', () => {
		const record: Record<string, unknown> = {}
		setField(record, ['a', 'b'], 1)
		expect(record).toEqual({ a: { b: 1 } })
	})
})

describe('omitUndefined', () => {
	it('omits undefined values while preserving null', () => {
		expect(omitUndefined({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null })
	})

	it('returns an empty record for absent input', () => {
		expect(omitUndefined()).toEqual({})
	})

	it('does not mutate the input record', () => {
		const input: Record<string, unknown> = { a: 1, b: undefined }
		const output = omitUndefined(input)
		expect(output).toEqual({ a: 1 })
		expect(input).toEqual({ a: 1, b: undefined })
	})
})

describe('cloneValue', () => {
	it('passes primitives through unchanged', () => {
		expect(cloneValue(1)).toBe(1)
		expect(cloneValue('x')).toBe('x')
		expect(cloneValue(null)).toBeNull()
	})

	it('deep-clones nested records and arrays', () => {
		const original = { nested: { items: [1] } }
		const cloned = cloneValue(original)
		expect(cloned).toEqual(original)
		expect(cloned).not.toBe(original)
		expect(isRecord(cloned)).toBe(true)
		const nested = isRecord(cloned) ? cloned.nested : undefined
		expect(nested).not.toBe(original.nested)
		expect(isRecord(nested)).toBe(true)
		const items = isRecord(nested) ? nested.items : undefined
		expect(items).not.toBe(original.nested.items)
		if (Array.isArray(items)) items.push(2)
		expect(original.nested.items).toEqual([1])
	})

	it('returns non-record objects by reference', () => {
		const date = new Date(0)
		const callback = (): string => 'ok'
		expect(cloneValue(date)).toBe(date)
		expect(cloneValue(callback)).toBe(callback)
	})

	it('throws on cyclic structures', () => {
		const cycle: Record<string, unknown> = {}
		cycle.self = cycle
		expect(() => cloneValue(cycle)).toThrow(TypeError)
	})
})

describe('freezeValue', () => {
	it('deep-freezes nested records and arrays', () => {
		const value = { nested: { items: [1] } }
		const frozen = freezeValue(value)
		expect(frozen).toBe(value)
		expect(Object.isFrozen(value)).toBe(true)
		expect(Object.isFrozen(value.nested)).toBe(true)
		expect(Object.isFrozen(value.nested.items)).toBe(true)
	})

	it('throws on cyclic structures', () => {
		const cycle: Record<string, unknown> = {}
		cycle.self = cycle
		expect(() => freezeValue(cycle)).toThrow(TypeError)
	})

	it('allows shared DAG subtrees', () => {
		const shared = { value: 1 }
		const graph = { left: shared, right: shared }
		expect(() => freezeValue(graph)).not.toThrow()
		expect(Object.isFrozen(shared)).toBe(true)
	})
})

describe('createDeferred', () => {
	it('resolves the promise with the value passed to resolve', async () => {
		const deferred = createDeferred<number>()
		deferred.resolve(42)
		await expect(deferred.promise).resolves.toBe(42)
	})

	it('rejects the promise with the reason passed to reject', async () => {
		const deferred = createDeferred<number>()
		const reason = new Error('nope')
		deferred.reject(reason)
		await expect(deferred.promise).rejects.toBe(reason)
	})

	it('settles once — a reject after a resolve is a no-op (first settle wins)', async () => {
		const deferred = createDeferred<string>()
		deferred.resolve('first')
		// Native promise settle-once: the later reject cannot override the resolved value.
		deferred.reject(new Error('too late'))
		await expect(deferred.promise).resolves.toBe('first')
	})

	it('settles once — a second resolve cannot change the resolved value', async () => {
		const deferred = createDeferred<number>()
		deferred.resolve(1)
		deferred.resolve(2)
		await expect(deferred.promise).resolves.toBe(1)
	})

	it('wires promise / resolve / reject to the same underlying promise', async () => {
		const deferred = createDeferred<number>()
		// Resolving asynchronously still settles the very promise the handle exposes.
		queueMicrotask(() => deferred.resolve(7))
		const value = await deferred.promise
		expect(value).toBe(7)
	})

	it('supports a void deferred used as a completion gate', async () => {
		const deferred = createDeferred<void>()
		let settled = false
		const waiter = deferred.promise.then(() => {
			settled = true
		})
		expect(settled).toBe(false)
		// `resolve()` with no argument satisfies the void value — the gate opens.
		deferred.resolve()
		await waiter
		expect(settled).toBe(true)
	})
})

describe('escapeRegExp', () => {
	it('escapes every regex metacharacter', () => {
		expect(escapeRegExp('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\')
	})

	it('leaves normal characters untouched', () => {
		expect(escapeRegExp('abc 123 _-')).toBe('abc 123 _-')
		expect(escapeRegExp('')).toBe('')
	})

	it('produces a pattern that matches the literal input', () => {
		// The escaped form, anchored, matches the original string verbatim — its
		// metacharacters are no longer interpreted as regex syntax.
		const literal = 'a.b*c(1+1)'
		expect(new RegExp(`^${escapeRegExp(literal)}$`).test(literal)).toBe(true)
		expect(new RegExp(`^${escapeRegExp(literal)}$`).test('aXbYYc2')).toBe(false)
	})
})

describe('interpolateMessage', () => {
	it('interpolates fields and leaves missing markers intact', () => {
		expect(interpolateMessage('Value {{value}}; missing {{missing}}', { value: 42 })).toBe(
			'Value 42; missing {{missing}}',
		)
	})

	it('interpolates dotted markers as nested field paths', () => {
		expect(
			interpolateMessage('Zone {{location.zone}}; flat {{location}}', {
				location: { zone: 'A' },
			}),
		).toBe('Zone A; flat [object Object]')
	})

	it('tolerates whitespace inside markers', () => {
		expect(interpolateMessage('Value {{ value }}', { value: 42 })).toBe('Value 42')
	})

	it('substitutes repeated markers every time', () => {
		expect(interpolateMessage('{{value}} and {{ value }}', { value: 'x' })).toBe('x and x')
	})

	it('leaves non-identifier and single-brace content literal', () => {
		expect(interpolateMessage('{{not valid}} {a}', { a: 1, not: 'x' })).toBe('{{not valid}} {a}')
	})

	it('returns an empty template unchanged', () => {
		expect(interpolateMessage('', { value: 1 })).toBe('')
	})

	it('renders finite numbers with thousands separators on the integer part', () => {
		expect(interpolateMessage('${{cap}}', { cap: 2_000_000 })).toBe('$2,000,000')
		expect(interpolateMessage('{{n}}', { n: -12345.6 })).toBe('-12,345.6')
		expect(interpolateMessage('{{n}}', { n: 42 })).toBe('42')
	})
})

describe('slugify', () => {
	it('lowercases and collapses non-alphanumerics to single hyphens', () => {
		expect(slugify('Show Opens Dialog')).toBe('show-opens-dialog')
	})

	it('trims leading and trailing separators', () => {
		expect(slugify('  Turn On!  ')).toBe('turn-on')
		expect(slugify('--edge--')).toBe('edge')
	})

	it('collapses a run of separators into one hyphen', () => {
		expect(slugify('a   b___c')).toBe('a-b-c')
	})

	it('returns an empty string for an all-separator input', () => {
		expect(slugify('   ')).toBe('')
		expect(slugify('!!!')).toBe('')
	})
})
