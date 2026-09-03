import type { GroupManagerEventMap } from '@src/core'
import {
	createFactorGroup,
	createGroupManager,
	createStaticFactor,
	GroupManager,
	isReasonError,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError, createRecorders } from '@orkestrel/test'

// `GroupManager` — the self-owning, kind-free manager over a quantitative
// definition's `groups`. It owns its collection as copy-on-write state and its
// own emitter: every write verb mutates then emits the affected group id, the
// accessors are pure reads that emit nothing, `remove` is the batch family
// reporting exactly what it removed, `seat` is the owning builder's SILENT bulk
// re-seat channel, and `destroy()` is idempotent with every other call
// afterwards throwing DESTROYED.

function events(manager: { readonly emitter: GroupManager['emitter'] }) {
	return createRecorders<
		GroupManagerEventMap,
		'append' | 'prepend' | 'replace' | 'remove' | 'destroy'
	>(manager.emitter, ['append', 'prepend', 'replace', 'remove', 'destroy'])
}

describe('GroupManager — construction and accessors', () => {
	it('defaults to an empty collection and seeds from options', () => {
		expect(createGroupManager().groups()).toEqual([])
		expect(
			createGroupManager({ groups: [createFactorGroup('g1', 'sum', [])] })
				.groups()
				.map((group) => group.id),
		).toEqual(['g1'])
	})

	it('reads ONE group by id and ALL groups in order', () => {
		const groups = createGroupManager({
			groups: [createFactorGroup('g1', 'sum', []), createFactorGroup('g2', 'product', [])],
		})
		expect(groups.group('g1')?.aggregation).toBe('sum')
		expect(groups.group('g2')?.aggregation).toBe('product')
		expect(groups.group('absent')).toBeUndefined()
		expect(groups.groups().map((group) => group.id)).toEqual(['g1', 'g2'])
	})

	it('reads without emitting', () => {
		const groups = createGroupManager({ groups: [createFactorGroup('g1', 'sum', [])] })
		const recorded = events(groups)
		groups.group('g1')
		groups.groups()
		expect(recorded.append.count).toBe(0)
		expect(recorded.prepend.count).toBe(0)
		expect(recorded.replace.count).toBe(0)
		expect(recorded.remove.count).toBe(0)
	})

	it('constructs identically through the class and the factory', () => {
		const seed = [createFactorGroup('g1', 'sum', [])]
		expect(new GroupManager({ groups: seed }).groups()).toEqual(
			createGroupManager({ groups: seed }).groups(),
		)
	})
})

describe('GroupManager — placement verbs', () => {
	it('appends at the end without a target and after the target with one', () => {
		const groups = createGroupManager()
		groups.append(createFactorGroup('a', 'sum', []))
		groups.append(createFactorGroup('b', 'sum', []))
		groups.append(createFactorGroup('c', 'sum', []), 'a')
		expect(groups.groups().map((group) => group.id)).toEqual(['a', 'c', 'b'])
	})

	it('prepends at the start without a target and before the target with one', () => {
		const groups = createGroupManager()
		groups.append(createFactorGroup('a', 'sum', []))
		groups.append(createFactorGroup('b', 'sum', []))
		groups.prepend(createFactorGroup('c', 'sum', []))
		groups.prepend(createFactorGroup('d', 'sum', []), 'b')
		expect(groups.groups().map((group) => group.id)).toEqual(['c', 'a', 'd', 'b'])
	})

	it('replaces a same-id group IN PLACE, preserving position', () => {
		const groups = createGroupManager({
			groups: [createFactorGroup('a', 'sum', []), createFactorGroup('b', 'sum', [])],
		})
		groups.replace(createFactorGroup('a', 'product', []))
		expect(groups.groups().map((group) => group.id)).toEqual(['a', 'b'])
		expect(groups.group('a')?.aggregation).toBe('product')
	})

	it('appends on replace when no same-id group exists', () => {
		const groups = createGroupManager({ groups: [createFactorGroup('a', 'sum', [])] })
		groups.replace(createFactorGroup('z', 'sum', []))
		expect(groups.groups().map((group) => group.id)).toEqual(['a', 'z'])
	})

	it('throws TARGET when a target names no existing group', () => {
		const groups = createGroupManager({ groups: [createFactorGroup('a', 'sum', [])] })
		for (const call of [
			() => groups.append(createFactorGroup('b', 'sum', []), 'absent'),
			() => groups.prepend(createFactorGroup('c', 'sum', []), 'absent'),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('TARGET')
		}
	})

	it('emits the affected group id per write verb, AFTER the mutation', () => {
		const groups = createGroupManager()
		const recorded = events(groups)
		groups.append(createFactorGroup('a', 'sum', []))
		groups.prepend(createFactorGroup('b', 'sum', []))
		groups.replace(createFactorGroup('a', 'product', []))
		groups.remove('a')
		expect(recorded.append.calls).toEqual([['a']])
		expect(recorded.prepend.calls).toEqual([['b']])
		expect(recorded.replace.calls).toEqual([['a']])
		expect(recorded.remove.calls).toEqual([['a']])
	})
})

describe('GroupManager — the remove batch family', () => {
	it('removes ONE group by id and reports whether it was there', () => {
		const groups = createGroupManager({
			groups: [createFactorGroup('a', 'sum', []), createFactorGroup('b', 'sum', [])],
		})
		expect(groups.remove('a')).toBe(true)
		expect(groups.groups().map((group) => group.id)).toEqual(['b'])
		expect(groups.remove('absent')).toBe(false)
		expect(groups.groups().map((group) => group.id)).toEqual(['b'])
	})

	it('removes an id LIST and returns true only when every named id existed', () => {
		const groups = createGroupManager({
			groups: [
				createFactorGroup('a', 'sum', []),
				createFactorGroup('b', 'sum', []),
				createFactorGroup('c', 'sum', []),
			],
		})
		expect(groups.remove(['a', 'b'])).toBe(true)
		expect(groups.groups().map((group) => group.id)).toEqual(['c'])
		expect(groups.remove(['c', 'absent'])).toBe(false)
		expect(groups.groups()).toEqual([])
		expect(groups.remove([])).toBe(true)
	})

	it('removes EVERY group with no argument', () => {
		const groups = createGroupManager({
			groups: [createFactorGroup('a', 'sum', []), createFactorGroup('b', 'sum', [])],
		})
		groups.remove()
		expect(groups.groups()).toEqual([])
		groups.remove()
		expect(groups.groups()).toEqual([])
	})

	it('emits once per group actually removed, and nothing for an absent id', () => {
		const groups = createGroupManager({
			groups: [createFactorGroup('a', 'sum', []), createFactorGroup('b', 'sum', [])],
		})
		const recorded = events(groups)
		groups.remove('absent')
		expect(recorded.remove.calls).toEqual([])
		groups.remove(['a', 'absent'])
		expect(recorded.remove.calls).toEqual([['a']])
		recorded.remove.clear()
		groups.remove()
		expect(recorded.remove.calls).toEqual([['b']])
	})
})

describe('GroupManager — seat, the silent bulk re-seat channel', () => {
	it('replaces the whole collection and emits nothing', () => {
		const groups = createGroupManager({
			groups: [createFactorGroup('a', 'sum', []), createFactorGroup('b', 'sum', [])],
		})
		const recorded = events(groups)
		groups.seat([createFactorGroup('c', 'sum', []), createFactorGroup('d', 'sum', [])])
		expect(groups.groups().map((group) => group.id)).toEqual(['c', 'd'])
		expect(groups.group('a')).toBeUndefined()
		expect(recorded.append.calls).toEqual([])
		expect(recorded.prepend.calls).toEqual([])
		expect(recorded.replace.calls).toEqual([])
		expect(recorded.remove.calls).toEqual([])
	})

	it('seats an empty collection', () => {
		const groups = createGroupManager({ groups: [createFactorGroup('a', 'sum', [])] })
		groups.seat([])
		expect(groups.groups()).toEqual([])
	})
})

describe('GroupManager — destroy', () => {
	it('emits destroy once and is idempotent', () => {
		const groups = createGroupManager()
		const recorded = events(groups)
		groups.destroy()
		groups.destroy()
		expect(recorded.destroy.count).toBe(1)
	})

	it('throws DESTROYED on every call after destroy', () => {
		const groups = createGroupManager({ groups: [createFactorGroup('a', 'sum', [])] })
		groups.destroy()
		for (const call of [
			() => groups.group('a'),
			() => groups.groups(),
			() => groups.append(createFactorGroup('b', 'sum', [createStaticFactor('f', 1)])),
			() => groups.prepend(createFactorGroup('c', 'sum', [])),
			() => groups.replace(createFactorGroup('a', 'sum', [])),
			() => groups.remove('a'),
			() => groups.remove(['a']),
			() => groups.remove(),
			() => groups.seat([]),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('DESTROYED')
		}
	})

	it('keeps the emitter getter working after destroy', () => {
		const groups = createGroupManager()
		groups.destroy()
		expect(typeof groups.emitter.on).toBe('function')
	})
})
