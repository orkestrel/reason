import { SymbolicState } from '../../../src/core/SymbolicState.js'
import { describe, expect, it } from 'vitest'

describe('SymbolicState', () => {
	it('copies the initial bindings and retains updates within its call', () => {
		const initial = Object.freeze({ x: 2 })
		const state = new SymbolicState(initial)
		const other = new SymbolicState(initial)
		state.set('x', 3)
		state.set('y', 4)
		expect(state.values).toEqual({ x: 3, y: 4 })
		expect(other.values).toEqual({ x: 2 })
		expect(initial).toEqual({ x: 2 })
	})
})
