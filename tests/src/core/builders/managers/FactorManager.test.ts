import type { FactorManagerEventMap, GroupManagerEventMap } from '@src/core'
import {
	createFactorGroup,
	createFactorManager,
	createGroupManager,
	createStaticFactor,
	FactorManager,
	isReasonError,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError, createRecorders } from '@orkestrel/test'

// `FactorManager` — the DIVERGENT manager: factors nest inside groups, so it
// holds no collection state of its own and threads a required `groupId`
// locator, reading and writing through the sibling `GroupManager`. Every write
// therefore lands TWO events: the factor id on this manager's emitter and a
// `replace` for the containing group on the sibling's. A `groupId` naming no
// group throws TARGET carrying `groupId` in the context; `remove` is the batch
// family behind that locator and reports exactly what it removed.

function seeded(ids: readonly string[] = []) {
	const groups = createGroupManager({
		groups: [
			createFactorGroup(
				'drivers',
				'sum',
				ids.map((id) => createStaticFactor(id, 1)),
			),
		],
	})
	return { groups, factors: createFactorManager(groups) }
}

function events(manager: { readonly emitter: FactorManager['emitter'] }) {
	return createRecorders<
		FactorManagerEventMap,
		'append' | 'prepend' | 'replace' | 'remove' | 'destroy'
	>(manager.emitter, ['append', 'prepend', 'replace', 'remove', 'destroy'])
}

describe('FactorManager — construction and accessors', () => {
	it('reads ONE factor by group id + id and ALL factors of one group in order', () => {
		const { factors } = seeded(['a', 'b'])
		expect(factors.factor('drivers', 'a')?.id).toBe('a')
		expect(factors.factor('drivers', 'absent')).toBeUndefined()
		expect(factors.factors('drivers').map((factor) => factor.id)).toEqual(['a', 'b'])
	})

	it('constructs identically through the class and the factory', () => {
		const groups = createGroupManager({ groups: [createFactorGroup('drivers', 'sum', [])] })
		expect(new FactorManager(groups).factors('drivers')).toEqual(
			createFactorManager(groups).factors('drivers'),
		)
	})

	it('throws TARGET carrying groupId when the locator names no group', () => {
		const { factors } = seeded()
		for (const call of [
			() => factors.factor('absent', 'a'),
			() => factors.factors('absent'),
			() => factors.append('absent', createStaticFactor('a', 1)),
			() => factors.prepend('absent', createStaticFactor('a', 1)),
			() => factors.replace('absent', createStaticFactor('a', 1)),
			() => factors.remove('absent', 'a'),
			() => factors.remove('absent'),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('TARGET')
			expect(error.context).toEqual({ groupId: 'absent' })
		}
	})
})

describe('FactorManager — placement verbs', () => {
	it('appends at the end without a target and after the target with one', () => {
		const { factors } = seeded()
		factors.append('drivers', createStaticFactor('a', 1))
		factors.append('drivers', createStaticFactor('b', 2))
		factors.append('drivers', createStaticFactor('c', 3), 'a')
		expect(factors.factors('drivers').map((factor) => factor.id)).toEqual(['a', 'c', 'b'])
	})

	it('prepends at the start without a target and before the target with one', () => {
		const { factors } = seeded(['a', 'b'])
		factors.prepend('drivers', createStaticFactor('c', 3))
		factors.prepend('drivers', createStaticFactor('d', 4), 'b')
		expect(factors.factors('drivers').map((factor) => factor.id)).toEqual(['c', 'a', 'd', 'b'])
	})

	it('replaces a same-id factor IN PLACE and appends an unmatched one', () => {
		const { factors } = seeded(['a', 'b'])
		factors.replace('drivers', createStaticFactor('a', 99))
		expect(factors.factors('drivers').map((factor) => factor.id)).toEqual(['a', 'b'])
		expect(factors.factor('drivers', 'a')?.source).toEqual({ origin: 'static', value: 99 })
		factors.replace('drivers', createStaticFactor('z', 1))
		expect(factors.factors('drivers').map((factor) => factor.id)).toEqual(['a', 'b', 'z'])
	})

	it('throws TARGET when a factor target names no existing factor', () => {
		const { factors } = seeded(['a'])
		for (const call of [
			() => factors.append('drivers', createStaticFactor('b', 1), 'absent'),
			() => factors.prepend('drivers', createStaticFactor('c', 1), 'absent'),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('TARGET')
		}
	})

	it('emits the factor id here and a group replace on the sibling manager', () => {
		const { groups, factors } = seeded()
		const factorEvents = events(factors)
		const groupEvents = createRecorders<GroupManagerEventMap, 'replace'>(groups.emitter, [
			'replace',
		])
		factors.append('drivers', createStaticFactor('a', 1))
		factors.prepend('drivers', createStaticFactor('b', 2))
		factors.replace('drivers', createStaticFactor('a', 3))
		factors.remove('drivers', 'a')
		expect(factorEvents.append.calls).toEqual([['a']])
		expect(factorEvents.prepend.calls).toEqual([['b']])
		expect(factorEvents.replace.calls).toEqual([['a']])
		expect(factorEvents.remove.calls).toEqual([['a']])
		expect(groupEvents.replace.calls).toEqual([['drivers'], ['drivers'], ['drivers'], ['drivers']])
	})
})

describe('FactorManager — the remove batch family', () => {
	it('removes ONE factor by id and reports whether it was there', () => {
		const { factors } = seeded(['a', 'b'])
		expect(factors.remove('drivers', 'a')).toBe(true)
		expect(factors.factors('drivers').map((factor) => factor.id)).toEqual(['b'])
		expect(factors.remove('drivers', 'absent')).toBe(false)
	})

	it('removes an id LIST and returns true only when every named id existed', () => {
		const { factors } = seeded(['a', 'b', 'c'])
		expect(factors.remove('drivers', ['a', 'b'])).toBe(true)
		expect(factors.factors('drivers').map((factor) => factor.id)).toEqual(['c'])
		expect(factors.remove('drivers', ['c', 'absent'])).toBe(false)
		expect(factors.factors('drivers')).toEqual([])
		expect(factors.remove('drivers', [])).toBe(true)
	})

	it('removes EVERY factor of the located group with the locator alone', () => {
		const { factors } = seeded(['a', 'b'])
		factors.remove('drivers')
		expect(factors.factors('drivers')).toEqual([])
		factors.remove('drivers')
		expect(factors.factors('drivers')).toEqual([])
	})

	it('emits nothing on either emitter for a factor the group never held', () => {
		const { groups, factors } = seeded(['a'])
		const factorEvents = events(factors)
		const groupEvents = createRecorders<GroupManagerEventMap, 'replace'>(groups.emitter, [
			'replace',
		])
		expect(factors.remove('drivers', 'absent')).toBe(false)
		expect(factorEvents.remove.calls).toEqual([])
		expect(groupEvents.replace.calls).toEqual([])
		expect(factors.remove('drivers', ['a', 'absent'])).toBe(false)
		expect(factorEvents.remove.calls).toEqual([['a']])
		expect(groupEvents.replace.calls).toEqual([['drivers']])
	})
})

describe('FactorManager — destroy', () => {
	it('emits destroy once and is idempotent', () => {
		const { factors } = seeded()
		const recorded = events(factors)
		factors.destroy()
		factors.destroy()
		expect(recorded.destroy.count).toBe(1)
	})

	it('throws DESTROYED on every call after destroy', () => {
		const { factors } = seeded(['a'])
		factors.destroy()
		for (const call of [
			() => factors.factor('drivers', 'a'),
			() => factors.factors('drivers'),
			() => factors.append('drivers', createStaticFactor('b', 1)),
			() => factors.prepend('drivers', createStaticFactor('c', 1)),
			() => factors.replace('drivers', createStaticFactor('a', 1)),
			() => factors.remove('drivers', 'a'),
			() => factors.remove('drivers', ['a']),
			() => factors.remove('drivers'),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('DESTROYED')
		}
	})

	it('leaves the sibling group manager usable after its own destroy', () => {
		const { groups, factors } = seeded(['a'])
		factors.destroy()
		expect(groups.group('drivers')?.factors.map((factor) => factor.id)).toEqual(['a'])
	})
})
