import type { FactManagerEventMap } from '@src/core'
import { createFact, createFactManager, FactManager, isReasonError } from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError, createRecorders } from '@orkestrel/test'

// `FactManager` — the self-owning, kind-free manager over an inferential
// definition's `facts`. `Fact.id` is an AUTHORING label, so this manager's
// id-keyed dedup is independent of the runtime's content dedup. `remove` is the
// batch family reporting exactly what it removed, `seat` is the owning
// builder's SILENT bulk re-seat channel, and `destroy()` is idempotent with
// every other call afterwards throwing DESTROYED.

function fact(id: string, term = 'socrates') {
	return createFact(id, 'human', [term])
}

function events(manager: { readonly emitter: FactManager['emitter'] }) {
	return createRecorders<
		FactManagerEventMap,
		'append' | 'prepend' | 'replace' | 'remove' | 'destroy'
	>(manager.emitter, ['append', 'prepend', 'replace', 'remove', 'destroy'])
}

describe('FactManager — construction and accessors', () => {
	it('defaults to an empty collection and seeds from options', () => {
		expect(createFactManager().facts()).toEqual([])
		expect(
			createFactManager({ facts: [fact('a')] })
				.facts()
				.map((entry) => entry.id),
		).toEqual(['a'])
	})

	it('reads ONE fact by id and ALL facts in order', () => {
		const facts = createFactManager({ facts: [fact('a'), fact('b', 'plato')] })
		expect(facts.fact('a')?.predicate).toBe('human')
		expect(facts.fact('b')?.terms).toEqual(['plato'])
		expect(facts.fact('absent')).toBeUndefined()
		expect(facts.facts().map((entry) => entry.id)).toEqual(['a', 'b'])
	})

	it('constructs identically through the class and the factory', () => {
		const seed = [fact('a')]
		expect(new FactManager({ facts: seed }).facts()).toEqual(
			createFactManager({ facts: seed }).facts(),
		)
	})
})

describe('FactManager — placement verbs', () => {
	it('appends at the end without a target and after the target with one', () => {
		const facts = createFactManager()
		facts.append(fact('a'))
		facts.append(fact('b'))
		facts.append(fact('c'), 'a')
		expect(facts.facts().map((entry) => entry.id)).toEqual(['a', 'c', 'b'])
	})

	it('prepends at the start without a target and before the target with one', () => {
		const facts = createFactManager({ facts: [fact('a'), fact('b')] })
		facts.prepend(fact('c'))
		facts.prepend(fact('d'), 'b')
		expect(facts.facts().map((entry) => entry.id)).toEqual(['c', 'a', 'd', 'b'])
	})

	it('replaces a same-id fact IN PLACE and appends an unmatched one', () => {
		const facts = createFactManager({ facts: [fact('a'), fact('b')] })
		facts.replace(fact('a', 'plato'))
		expect(facts.facts().map((entry) => entry.id)).toEqual(['a', 'b'])
		expect(facts.fact('a')?.terms).toEqual(['plato'])
		facts.replace(fact('z'))
		expect(facts.facts().map((entry) => entry.id)).toEqual(['a', 'b', 'z'])
	})

	it('throws TARGET when a target names no existing fact', () => {
		const facts = createFactManager({ facts: [fact('a')] })
		for (const call of [
			() => facts.append(fact('b'), 'absent'),
			() => facts.prepend(fact('c'), 'absent'),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('TARGET')
		}
	})

	it('emits the affected fact id per write verb, AFTER the mutation', () => {
		const facts = createFactManager()
		const recorded = events(facts)
		facts.append(fact('a'))
		facts.prepend(fact('b'))
		facts.replace(fact('a', 'plato'))
		facts.remove('a')
		expect(recorded.append.calls).toEqual([['a']])
		expect(recorded.prepend.calls).toEqual([['b']])
		expect(recorded.replace.calls).toEqual([['a']])
		expect(recorded.remove.calls).toEqual([['a']])
	})
})

describe('FactManager — the remove batch family', () => {
	it('removes ONE fact by id and reports whether it was there', () => {
		const facts = createFactManager({ facts: [fact('a'), fact('b')] })
		expect(facts.remove('a')).toBe(true)
		expect(facts.facts().map((entry) => entry.id)).toEqual(['b'])
		expect(facts.remove('absent')).toBe(false)
	})

	it('removes an id LIST and returns true only when every named id existed', () => {
		const facts = createFactManager({ facts: [fact('a'), fact('b'), fact('c')] })
		expect(facts.remove(['a', 'b'])).toBe(true)
		expect(facts.facts().map((entry) => entry.id)).toEqual(['c'])
		expect(facts.remove(['c', 'absent'])).toBe(false)
		expect(facts.facts()).toEqual([])
		expect(facts.remove([])).toBe(true)
	})

	it('removes EVERY fact with no argument', () => {
		const facts = createFactManager({ facts: [fact('a'), fact('b')] })
		facts.remove()
		expect(facts.facts()).toEqual([])
	})

	it('emits once per fact actually removed, and nothing for an absent id', () => {
		const facts = createFactManager({ facts: [fact('a'), fact('b')] })
		const recorded = events(facts)
		facts.remove('absent')
		expect(recorded.remove.calls).toEqual([])
		facts.remove(['a', 'absent'])
		expect(recorded.remove.calls).toEqual([['a']])
		recorded.remove.clear()
		facts.remove()
		expect(recorded.remove.calls).toEqual([['b']])
	})
})

describe('FactManager — seat, the silent bulk re-seat channel', () => {
	it('replaces the whole collection with a different one and emits nothing', () => {
		const facts = createFactManager({ facts: [fact('a'), fact('b')] })
		const recorded = events(facts)
		facts.seat([fact('c'), fact('d')])
		expect(facts.facts().map((entry) => entry.id)).toEqual(['c', 'd'])
		expect(facts.fact('a')).toBeUndefined()
		expect(recorded.append.calls).toEqual([])
		expect(recorded.prepend.calls).toEqual([])
		expect(recorded.replace.calls).toEqual([])
		expect(recorded.remove.calls).toEqual([])
	})

	it('throws DESTROYED after the manager is destroyed', () => {
		const facts = createFactManager()
		facts.destroy()
		const error = captureError(() => facts.seat([]))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('DESTROYED')
	})
})

describe('FactManager — destroy', () => {
	it('emits destroy once and is idempotent', () => {
		const facts = createFactManager()
		const recorded = events(facts)
		facts.destroy()
		facts.destroy()
		expect(recorded.destroy.count).toBe(1)
	})

	it('throws DESTROYED on every call after destroy', () => {
		const facts = createFactManager({ facts: [fact('a')] })
		facts.destroy()
		for (const call of [
			() => facts.fact('a'),
			() => facts.facts(),
			() => facts.append(fact('b')),
			() => facts.prepend(fact('c')),
			() => facts.replace(fact('a')),
			() => facts.remove('a'),
			() => facts.remove(['a']),
			() => facts.remove(),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('DESTROYED')
		}
	})
})
