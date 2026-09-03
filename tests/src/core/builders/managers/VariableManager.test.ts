import type { VariableManagerEventMap } from '@src/core'
import { createVariableManager, isReasonError, VariableManager } from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError, createRecorders } from '@orkestrel/test'
import { TRICKY_KEYS } from '../../../../setup.js'

// `VariableManager` — the self-owning, kind-free manager over a symbolic
// definition's `variables`, a NAME-keyed unordered record. The record has no
// placement, so `add` / `remove` are the only write verbs; `remove` OMITS the
// key entirely rather than writing `undefined`, and its batch family runs over
// names. `seat` is the owning builder's SILENT bulk re-seat channel, and
// `destroy()` is idempotent with every other call afterwards throwing
// DESTROYED.

function events(manager: { readonly emitter: VariableManager['emitter'] }) {
	return createRecorders<VariableManagerEventMap, 'add' | 'remove' | 'destroy'>(manager.emitter, [
		'add',
		'remove',
		'destroy',
	])
}

describe('VariableManager — construction and accessors', () => {
	it('defaults to an empty record and seeds from options', () => {
		expect(createVariableManager().variables()).toEqual({})
		expect(createVariableManager({ variables: { x: 1 } }).variables()).toEqual({ x: 1 })
	})

	it('reads ONE variable by name and the WHOLE record', () => {
		const variables = createVariableManager({ variables: { x: 1, y: 2 } })
		expect(variables.variable('x')).toBe(1)
		expect(variables.variable('absent')).toBeUndefined()
		expect(variables.variables()).toEqual({ x: 1, y: 2 })
	})

	it('constructs identically through the class and the factory', () => {
		expect(new VariableManager({ variables: { x: 1 } }).variables()).toEqual(
			createVariableManager({ variables: { x: 1 } }).variables(),
		)
	})
})

describe('VariableManager — add', () => {
	it('upserts an entry and emits the NAME', () => {
		const variables = createVariableManager()
		const recorded = events(variables)
		variables.add('x', 1)
		variables.add('x', 2)
		expect(variables.variables()).toEqual({ x: 2 })
		expect(recorded.add.calls).toEqual([['x'], ['x']])
	})

	it('accepts adversarial and unicode names as ordinary own keys', () => {
		const variables = createVariableManager()
		for (const [index, key] of TRICKY_KEYS.entries()) variables.add(key, index)
		for (const [index, key] of TRICKY_KEYS.entries()) expect(variables.variable(key)).toBe(index)
	})
})

describe('VariableManager — the remove batch family', () => {
	it('removes ONE name, OMITS the key, and reports whether it was there', () => {
		const variables = createVariableManager({ variables: { x: 1, y: 2 } })
		expect(variables.remove('x')).toBe(true)
		expect(variables.variables()).toEqual({ y: 2 })
		expect(Object.hasOwn(variables.variables(), 'x')).toBe(false)
		expect(variables.remove('absent')).toBe(false)
	})

	it('removes a name LIST and returns true only when every named variable existed', () => {
		const variables = createVariableManager({ variables: { x: 1, y: 2, z: 3 } })
		expect(variables.remove(['x', 'y'])).toBe(true)
		expect(variables.variables()).toEqual({ z: 3 })
		expect(variables.remove(['z', 'absent'])).toBe(false)
		expect(variables.variables()).toEqual({})
		expect(variables.remove([])).toBe(true)
	})

	it('removes EVERY variable with no argument', () => {
		const variables = createVariableManager({ variables: { x: 1, y: 2 } })
		variables.remove()
		expect(variables.variables()).toEqual({})
		variables.remove()
		expect(variables.variables()).toEqual({})
	})

	it('emits once per variable actually removed, and nothing for an absent name', () => {
		const variables = createVariableManager({ variables: { x: 1, y: 2 } })
		const recorded = events(variables)
		variables.remove('absent')
		expect(recorded.remove.calls).toEqual([])
		variables.remove(['x', 'absent'])
		expect(recorded.remove.calls).toEqual([['x']])
		recorded.remove.clear()
		variables.remove()
		expect(recorded.remove.calls).toEqual([['y']])
	})

	it('removes an inherited-looking name only when the record owns it', () => {
		const variables = createVariableManager()
		expect(variables.remove('toString')).toBe(false)
		variables.add('toString', 1)
		expect(variables.remove('toString')).toBe(true)
	})
})

describe('VariableManager — seat, the silent bulk re-seat channel', () => {
	it('replaces the whole record and emits nothing', () => {
		const variables = createVariableManager({ variables: { x: 1 } })
		const recorded = events(variables)
		variables.seat({ y: 2, z: 3 })
		expect(variables.variables()).toEqual({ y: 2, z: 3 })
		expect(variables.variable('x')).toBeUndefined()
		expect(recorded.add.calls).toEqual([])
		expect(recorded.remove.calls).toEqual([])
	})

	it('seats an empty record', () => {
		const variables = createVariableManager({ variables: { x: 1 } })
		variables.seat({})
		expect(variables.variables()).toEqual({})
	})
})

describe('VariableManager — destroy', () => {
	it('emits destroy once and is idempotent', () => {
		const variables = createVariableManager()
		const recorded = events(variables)
		variables.destroy()
		variables.destroy()
		expect(recorded.destroy.count).toBe(1)
	})

	it('throws DESTROYED on every call after destroy', () => {
		const variables = createVariableManager({ variables: { x: 1 } })
		variables.destroy()
		for (const call of [
			() => variables.variable('x'),
			() => variables.variables(),
			() => variables.add('y', 2),
			() => variables.remove('x'),
			() => variables.remove(['x']),
			() => variables.remove(),
			() => variables.seat({}),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('DESTROYED')
		}
	})
})
