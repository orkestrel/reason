import type { EquationManagerEventMap } from '@src/core'
import {
	createConstant,
	createEquation,
	createEquationManager,
	createVariable,
	EquationManager,
	isReasonError,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError, createRecorders } from '@orkestrel/test'

// `EquationManager` — the self-owning, kind-free manager over a symbolic
// definition's `equations`. Equation order is STRONGLY load-bearing (equations
// solve strictly in order and each rounded solution feeds forward), so
// placement is proved by the order the plural accessor reports. `remove` is the
// batch family reporting exactly what it removed, `seat` is the owning
// builder's SILENT bulk re-seat channel, and `destroy()` is idempotent with
// every other call afterwards throwing DESTROYED.

function equation(id: string, value = 42) {
	return createEquation(id, createVariable(id), createConstant(value), id)
}

function events(manager: { readonly emitter: EquationManager['emitter'] }) {
	return createRecorders<
		EquationManagerEventMap,
		'append' | 'prepend' | 'replace' | 'remove' | 'destroy'
	>(manager.emitter, ['append', 'prepend', 'replace', 'remove', 'destroy'])
}

describe('EquationManager — construction and accessors', () => {
	it('defaults to an empty collection and seeds from options', () => {
		expect(createEquationManager().equations()).toEqual([])
		expect(
			createEquationManager({ equations: [equation('a')] })
				.equations()
				.map((entry) => entry.id),
		).toEqual(['a'])
	})

	it('reads ONE equation by id and ALL equations in solve order', () => {
		const equations = createEquationManager({ equations: [equation('a'), equation('b')] })
		expect(equations.equation('a')?.target).toBe('a')
		expect(equations.equation('absent')).toBeUndefined()
		expect(equations.equations().map((entry) => entry.id)).toEqual(['a', 'b'])
	})

	it('constructs identically through the class and the factory', () => {
		const seed = [equation('a')]
		expect(new EquationManager({ equations: seed }).equations()).toEqual(
			createEquationManager({ equations: seed }).equations(),
		)
	})
})

describe('EquationManager — placement verbs', () => {
	it('appends at the end without a target and after the target with one', () => {
		const equations = createEquationManager()
		equations.append(equation('a'))
		equations.append(equation('b'))
		equations.append(equation('c'), 'a')
		expect(equations.equations().map((entry) => entry.id)).toEqual(['a', 'c', 'b'])
	})

	it('prepends at the start without a target and before the target with one', () => {
		const equations = createEquationManager({ equations: [equation('a'), equation('b')] })
		equations.prepend(equation('c'))
		equations.prepend(equation('d'), 'b')
		expect(equations.equations().map((entry) => entry.id)).toEqual(['c', 'a', 'd', 'b'])
	})

	it('replaces a same-id equation IN PLACE and appends an unmatched one', () => {
		const equations = createEquationManager({ equations: [equation('a'), equation('b')] })
		equations.replace(equation('a', 99))
		expect(equations.equations().map((entry) => entry.id)).toEqual(['a', 'b'])
		expect(equations.equation('a')?.right).toEqual(createConstant(99))
		equations.replace(equation('z'))
		expect(equations.equations().map((entry) => entry.id)).toEqual(['a', 'b', 'z'])
	})

	it('throws TARGET when a target names no existing equation', () => {
		const equations = createEquationManager({ equations: [equation('a')] })
		for (const call of [
			() => equations.append(equation('b'), 'absent'),
			() => equations.prepend(equation('c'), 'absent'),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('TARGET')
		}
	})

	it('emits the affected equation id per write verb, AFTER the mutation', () => {
		const equations = createEquationManager()
		const recorded = events(equations)
		equations.append(equation('a'))
		equations.prepend(equation('b'))
		equations.replace(equation('a', 1))
		equations.remove('a')
		expect(recorded.append.calls).toEqual([['a']])
		expect(recorded.prepend.calls).toEqual([['b']])
		expect(recorded.replace.calls).toEqual([['a']])
		expect(recorded.remove.calls).toEqual([['a']])
	})
})

describe('EquationManager — the remove batch family', () => {
	it('removes ONE equation by id and reports whether it was there', () => {
		const equations = createEquationManager({ equations: [equation('a'), equation('b')] })
		expect(equations.remove('a')).toBe(true)
		expect(equations.equations().map((entry) => entry.id)).toEqual(['b'])
		expect(equations.remove('absent')).toBe(false)
	})

	it('removes an id LIST and returns true only when every named id existed', () => {
		const equations = createEquationManager({
			equations: [equation('a'), equation('b'), equation('c')],
		})
		expect(equations.remove(['a', 'b'])).toBe(true)
		expect(equations.equations().map((entry) => entry.id)).toEqual(['c'])
		expect(equations.remove(['c', 'absent'])).toBe(false)
		expect(equations.equations()).toEqual([])
		expect(equations.remove([])).toBe(true)
	})

	it('removes EVERY equation with no argument', () => {
		const equations = createEquationManager({ equations: [equation('a'), equation('b')] })
		equations.remove()
		expect(equations.equations()).toEqual([])
	})

	it('emits once per equation actually removed, and nothing for an absent id', () => {
		const equations = createEquationManager({ equations: [equation('a'), equation('b')] })
		const recorded = events(equations)
		equations.remove('absent')
		expect(recorded.remove.calls).toEqual([])
		equations.remove(['a', 'absent'])
		expect(recorded.remove.calls).toEqual([['a']])
		recorded.remove.clear()
		equations.remove()
		expect(recorded.remove.calls).toEqual([['b']])
	})
})

describe('EquationManager — seat, the silent bulk re-seat channel', () => {
	it('replaces the whole collection with a different one and emits nothing', () => {
		const equations = createEquationManager({ equations: [equation('a'), equation('b')] })
		const recorded = events(equations)
		equations.seat([equation('c'), equation('d')])
		expect(equations.equations().map((entry) => entry.id)).toEqual(['c', 'd'])
		expect(equations.equation('a')).toBeUndefined()
		expect(recorded.append.calls).toEqual([])
		expect(recorded.prepend.calls).toEqual([])
		expect(recorded.replace.calls).toEqual([])
		expect(recorded.remove.calls).toEqual([])
	})

	it('throws DESTROYED after the manager is destroyed', () => {
		const equations = createEquationManager()
		equations.destroy()
		const error = captureError(() => equations.seat([]))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('DESTROYED')
	})
})

describe('EquationManager — destroy', () => {
	it('emits destroy once and is idempotent', () => {
		const equations = createEquationManager()
		const recorded = events(equations)
		equations.destroy()
		equations.destroy()
		expect(recorded.destroy.count).toBe(1)
	})

	it('throws DESTROYED on every call after destroy', () => {
		const equations = createEquationManager({ equations: [equation('a')] })
		equations.destroy()
		for (const call of [
			() => equations.equation('a'),
			() => equations.equations(),
			() => equations.append(equation('b')),
			() => equations.prepend(equation('c')),
			() => equations.replace(equation('a')),
			() => equations.remove('a'),
			() => equations.remove(['a']),
			() => equations.remove(),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('DESTROYED')
		}
	})
})
