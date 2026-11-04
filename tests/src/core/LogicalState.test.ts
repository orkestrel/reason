import { LogicalState } from '../../../src/core/LogicalState.js'
import { createAtom, createRule } from '@src/core'
import { describe, expect, it } from 'vitest'

describe('LogicalState', () => {
	const concluding = createRule(
		'r',
		[createAtom('a', 'equals', 1)],
		createAtom('ok', 'equals', true),
	)

	it('keeps fields within each reasoning call', () => {
		const state = new LogicalState([concluding])
		const other = new LogicalState([concluding])
		state.set('eligible', true)
		expect(state.field('eligible')).toBe(true)
		expect(state.has('eligible')).toBe(true)
		expect(state.fields).toEqual({ eligible: true })
		expect(other.fields).toEqual({})
		expect(other.has('eligible')).toBe(false)
	})

	it('knows the keys its rules conclude, and which rules conclude them', () => {
		const state = new LogicalState([concluding])
		expect(state.keys).toEqual(['ok'])
		expect(state.concludes('ok')).toBe(true)
		expect(state.concludes('a')).toBe(false)
		expect(state.concluders('ok')).toEqual([concluding])
		expect(state.concluders('a')).toEqual([])
	})

	it('reopens a closed key when it is derived, and keeps a mark separately', () => {
		const state = new LogicalState([concluding])
		expect(state.closed('ok')).toBe(false)
		state.close('ok')
		state.mark('ok')
		expect(state.closed('ok')).toBe(true)
		expect(state.marked('ok')).toBe(true)
		state.set('ok', true)
		expect(state.closed('ok')).toBe(false)
		expect(state.marked('ok')).toBe(true)
	})

	it('holds a key literally named __proto__ as own data, inheriting nothing', () => {
		const state = new LogicalState([])
		const prototype = { inherited: true }
		state.set('__proto__', prototype)
		state.set('own', false)
		expect(state.field('inherited')).toBeUndefined()
		expect(Object.getPrototypeOf(state.fields)).toBe(null)
		expect(Object.keys(state.fields)).toEqual(['__proto__', 'own'])
		expect(state.has('__proto__')).toBe(true)
	})
})
