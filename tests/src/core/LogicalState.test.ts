import { LogicalState } from '../../../src/core/LogicalState.js'
import { describe, expect, it } from 'vitest'

describe('LogicalState', () => {
	it('keeps fields and rule results within each reasoning call', () => {
		const state = new LogicalState()
		const other = new LogicalState()
		const applied = { id: 'rule', applied: true, premises: [true] }
		const rejected = { id: 'rule', applied: false, premises: [false] }
		state.set('eligible', true)
		state.record(applied)
		expect(state.field('eligible')).toBe(true)
		expect(state.fields).toEqual({ eligible: true })
		expect(state.rule('rule')).toBe(applied)
		state.record(rejected)
		expect(state.rule('rule')).toBe(rejected)
		expect(other.fields).toEqual({})
		expect(other.rule('rule')).toBeUndefined()
	})

	it('preserves ordinary object assignment for inherited and prototype keys', () => {
		const state = new LogicalState()
		const prototype = { inherited: true }
		state.set('__proto__', prototype)
		state.set('own', false)
		expect(state.field('inherited')).toBe(true)
		expect(Object.getPrototypeOf(state.fields)).toBe(prototype)
		expect(Object.keys(state.fields)).toEqual(['own'])
	})
})
