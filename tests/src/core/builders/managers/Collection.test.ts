import { isReasonError } from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError } from '@orkestrel/test'
import { Collection } from '../../../../../src/core/builders/managers/Collection.js'

// `Collection<T>` — the id-keyed collection state the list managers share by
// COMPOSITION. It is interned (named in this package's parity INTERNAL list),
// so it is reached here through its source path rather than the barrel. It owns
// its array as copy-on-write state, delegates every write verb to the exported
// collection-level pure helper, emits nothing itself, reports from `remove`
// whether the id was there, and names its OWNER in the DESTROYED message.

interface Entry {
	readonly id: string
	readonly value: number
}

function entry(id: string, value = 0): Entry {
	return { id, value }
}

function collection(...ids: readonly string[]) {
	return new Collection<Entry>(
		'TestOwner',
		ids.map((id) => entry(id)),
	)
}

describe('Collection — accessors', () => {
	it('reads ONE element by id and ALL elements in order', () => {
		const items = collection('a', 'b')
		expect(items.item('a')).toEqual(entry('a'))
		expect(items.item('absent')).toBeUndefined()
		expect(items.items().map((element) => element.id)).toEqual(['a', 'b'])
	})

	it('starts from the seed it was constructed with', () => {
		expect(new Collection<Entry>('TestOwner', []).items()).toEqual([])
	})
})

describe('Collection — placement verbs', () => {
	it('appends at the end without a target and after the target with one', () => {
		const items = collection()
		items.append(entry('a'))
		items.append(entry('b'))
		items.append(entry('c'), 'a')
		expect(items.items().map((element) => element.id)).toEqual(['a', 'c', 'b'])
	})

	it('prepends at the start without a target and before the target with one', () => {
		const items = collection('a', 'b')
		items.prepend(entry('c'))
		items.prepend(entry('d'), 'b')
		expect(items.items().map((element) => element.id)).toEqual(['c', 'a', 'd', 'b'])
	})

	it('repositions a re-appended id rather than updating it in place', () => {
		const items = collection('a', 'b')
		items.append(entry('a', 9))
		expect(items.items().map((element) => element.id)).toEqual(['b', 'a'])
		expect(items.item('a')?.value).toBe(9)
	})

	it('replaces a same-id element IN PLACE and appends an unmatched one', () => {
		const items = collection('a', 'b')
		items.replace(entry('a', 9))
		expect(items.items().map((element) => element.id)).toEqual(['a', 'b'])
		expect(items.item('a')?.value).toBe(9)
		items.replace(entry('z'))
		expect(items.items().map((element) => element.id)).toEqual(['a', 'b', 'z'])
	})

	it('throws TARGET when a target names no element', () => {
		const items = collection('a')
		for (const call of [
			() => items.append(entry('b'), 'absent'),
			() => items.prepend(entry('c'), 'absent'),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('TARGET')
		}
	})

	it('never mutates the seed array it was given', () => {
		const seed = [entry('a')]
		const items = new Collection<Entry>('TestOwner', seed)
		items.append(entry('b'))
		items.remove('a')
		expect(seed).toEqual([entry('a')])
	})
})

describe('Collection — remove', () => {
	it('reports whether an element with that id was there', () => {
		const items = collection('a', 'b')
		expect(items.remove('a')).toBe(true)
		expect(items.items().map((element) => element.id)).toEqual(['b'])
		expect(items.remove('a')).toBe(false)
		expect(items.items().map((element) => element.id)).toEqual(['b'])
	})

	it('removes every same-id twin in one call', () => {
		const items = new Collection<Entry>('TestOwner', [entry('a', 1), entry('a', 2), entry('b')])
		expect(items.remove('a')).toBe(true)
		expect(items.items().map((element) => element.id)).toEqual(['b'])
	})
})

describe('Collection — seat', () => {
	it('replaces the whole collection in one assignment', () => {
		const items = collection('a', 'b')
		items.seat([entry('c')])
		expect(items.items().map((element) => element.id)).toEqual(['c'])
		items.seat([])
		expect(items.items()).toEqual([])
	})
})

describe('Collection — destroy', () => {
	it('is idempotent', () => {
		const items = collection()
		items.destroy()
		expect(() => items.destroy()).not.toThrow()
	})

	it('throws a DESTROYED error naming its OWNER on every other call', () => {
		const items = collection('a')
		items.destroy()
		for (const call of [
			() => items.item('a'),
			() => items.items(),
			() => items.append(entry('b')),
			() => items.prepend(entry('c')),
			() => items.replace(entry('a')),
			() => items.remove('a'),
			() => items.seat([]),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('DESTROYED')
			expect(error.message).toBe('TestOwner has been destroyed')
		}
	})
})
