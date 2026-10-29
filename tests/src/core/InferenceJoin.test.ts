import type { Fact } from '@src/core'
import { createFact, indexByArity } from '@src/core'
import { InferenceJoin } from '../../../src/core/InferenceJoin.js'
import { describe, expect, it } from 'vitest'
import { createRecorder } from '@orkestrel/test'

describe('InferenceJoin', () => {
	it('joins consistent bindings in fact order and starts each resolution from empty bindings', () => {
		const join = new InferenceJoin(
			indexByArity([
				createFact('person', 'human', ['Ada']),
				createFact('city', 'resident', ['Ada', 'London']),
			]),
		)
		expect(
			join.resolve([
				createFact('human', 'human', ['?person']),
				createFact('resident', 'resident', ['?person', '?city']),
			]),
		).toEqual([{ '?person': 'Ada', '?city': 'London' }])
		expect(join.resolve([])).toEqual([{}])
		expect(join.resolve([createFact('missing', 'missing', ['?person'])])).toEqual([])
	})

	it('closes the caller iterator on an empty stage without reading another premise', () => {
		const closed = createRecorder<[]>()
		const premises = Object.defineProperty(
			[createFact('missing', 'missing', [])],
			Symbol.iterator,
			{
				value: function* () {
					try {
						yield createFact('missing', 'missing', [])
						throw new Error('The next premise must remain unread')
					} finally {
						closed.handler()
					}
				},
			},
		)
		expect(new InferenceJoin(new Map()).resolve(premises)).toEqual([])
		expect(closed.calls).toEqual([[]])
	})

	it('joins a broad premise list without recursive stack growth', () => {
		const fact = createFact('fact', 'human', ['Ada'])
		const premises: readonly Fact[] = Array.from({ length: 20000 }, () => fact)
		expect(new InferenceJoin(indexByArity([fact])).resolve(premises)).toEqual([{}])
	})
})
