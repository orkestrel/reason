import type { InferenceManagerEventMap } from '@src/core'
import {
	createFact,
	createInference,
	createInferenceManager,
	InferenceManager,
	isReasonError,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError, createRecorders } from '@orkestrel/test'

// `InferenceManager` — the self-owning, kind-free manager over an inferential
// definition's `inferences`. Inference order is LOAD-BEARING (backward proving
// iterates in declaration order and returns on first success), so placement is
// proved by the order the plural accessor reports. `remove` is the batch family
// reporting exactly what it removed, `seat` is the owning builder's SILENT bulk
// re-seat channel, and `destroy()` is idempotent with every other call
// afterwards throwing DESTROYED.

function inference(id: string, predicate = 'mortal') {
	return createInference(
		id,
		[createFact('p1', 'human', ['?x'])],
		createFact('c1', predicate, ['?x']),
	)
}

function events(manager: { readonly emitter: InferenceManager['emitter'] }) {
	return createRecorders<
		InferenceManagerEventMap,
		'append' | 'prepend' | 'replace' | 'remove' | 'destroy'
	>(manager.emitter, ['append', 'prepend', 'replace', 'remove', 'destroy'])
}

describe('InferenceManager — construction and accessors', () => {
	it('defaults to an empty collection and seeds from options', () => {
		expect(createInferenceManager().inferences()).toEqual([])
		expect(
			createInferenceManager({ inferences: [inference('a')] })
				.inferences()
				.map((entry) => entry.id),
		).toEqual(['a'])
	})

	it('reads ONE inference by id and ALL inferences in declaration order', () => {
		const inferences = createInferenceManager({ inferences: [inference('a'), inference('b')] })
		expect(inferences.inference('a')?.name).toBe('a')
		expect(inferences.inference('absent')).toBeUndefined()
		expect(inferences.inferences().map((entry) => entry.id)).toEqual(['a', 'b'])
	})

	it('constructs identically through the class and the factory', () => {
		const seed = [inference('a')]
		expect(new InferenceManager({ inferences: seed }).inferences()).toEqual(
			createInferenceManager({ inferences: seed }).inferences(),
		)
	})
})

describe('InferenceManager — placement verbs', () => {
	it('appends at the end without a target and after the target with one', () => {
		const inferences = createInferenceManager()
		inferences.append(inference('a'))
		inferences.append(inference('b'))
		inferences.append(inference('c'), 'a')
		expect(inferences.inferences().map((entry) => entry.id)).toEqual(['a', 'c', 'b'])
	})

	it('prepends at the start without a target and before the target with one', () => {
		const inferences = createInferenceManager({ inferences: [inference('a'), inference('b')] })
		inferences.prepend(inference('c'))
		inferences.prepend(inference('d'), 'b')
		expect(inferences.inferences().map((entry) => entry.id)).toEqual(['c', 'a', 'd', 'b'])
	})

	it('replaces a same-id inference IN PLACE and appends an unmatched one', () => {
		const inferences = createInferenceManager({ inferences: [inference('a'), inference('b')] })
		inferences.replace(inference('a', 'wise'))
		expect(inferences.inferences().map((entry) => entry.id)).toEqual(['a', 'b'])
		expect(inferences.inference('a')?.conclusion.predicate).toBe('wise')
		inferences.replace(inference('z'))
		expect(inferences.inferences().map((entry) => entry.id)).toEqual(['a', 'b', 'z'])
	})

	it('throws TARGET when a target names no existing inference', () => {
		const inferences = createInferenceManager({ inferences: [inference('a')] })
		for (const call of [
			() => inferences.append(inference('b'), 'absent'),
			() => inferences.prepend(inference('c'), 'absent'),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('TARGET')
		}
	})

	it('emits the affected inference id per write verb, AFTER the mutation', () => {
		const inferences = createInferenceManager()
		const recorded = events(inferences)
		inferences.append(inference('a'))
		inferences.prepend(inference('b'))
		inferences.replace(inference('a', 'wise'))
		inferences.remove('a')
		expect(recorded.append.calls).toEqual([['a']])
		expect(recorded.prepend.calls).toEqual([['b']])
		expect(recorded.replace.calls).toEqual([['a']])
		expect(recorded.remove.calls).toEqual([['a']])
	})
})

describe('InferenceManager — the remove batch family', () => {
	it('removes ONE inference by id and reports whether it was there', () => {
		const inferences = createInferenceManager({ inferences: [inference('a'), inference('b')] })
		expect(inferences.remove('a')).toBe(true)
		expect(inferences.inferences().map((entry) => entry.id)).toEqual(['b'])
		expect(inferences.remove('absent')).toBe(false)
	})

	it('removes an id LIST and returns true only when every named id existed', () => {
		const inferences = createInferenceManager({
			inferences: [inference('a'), inference('b'), inference('c')],
		})
		expect(inferences.remove(['a', 'b'])).toBe(true)
		expect(inferences.inferences().map((entry) => entry.id)).toEqual(['c'])
		expect(inferences.remove(['c', 'absent'])).toBe(false)
		expect(inferences.inferences()).toEqual([])
		expect(inferences.remove([])).toBe(true)
	})

	it('removes EVERY inference with no argument', () => {
		const inferences = createInferenceManager({ inferences: [inference('a'), inference('b')] })
		inferences.remove()
		expect(inferences.inferences()).toEqual([])
	})

	it('emits once per inference actually removed, and nothing for an absent id', () => {
		const inferences = createInferenceManager({ inferences: [inference('a'), inference('b')] })
		const recorded = events(inferences)
		inferences.remove('absent')
		expect(recorded.remove.calls).toEqual([])
		inferences.remove(['a', 'absent'])
		expect(recorded.remove.calls).toEqual([['a']])
		recorded.remove.clear()
		inferences.remove()
		expect(recorded.remove.calls).toEqual([['b']])
	})
})

describe('InferenceManager — seat, the silent bulk re-seat channel', () => {
	it('replaces the whole collection with a different one and emits nothing', () => {
		const inferences = createInferenceManager({ inferences: [inference('a'), inference('b')] })
		const recorded = events(inferences)
		inferences.seat([inference('c'), inference('d')])
		expect(inferences.inferences().map((entry) => entry.id)).toEqual(['c', 'd'])
		expect(inferences.inference('a')).toBeUndefined()
		expect(recorded.append.calls).toEqual([])
		expect(recorded.prepend.calls).toEqual([])
		expect(recorded.replace.calls).toEqual([])
		expect(recorded.remove.calls).toEqual([])
	})

	it('throws DESTROYED after the manager is destroyed', () => {
		const inferences = createInferenceManager()
		inferences.destroy()
		const error = captureError(() => inferences.seat([]))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('DESTROYED')
	})
})

describe('InferenceManager — destroy', () => {
	it('emits destroy once and is idempotent', () => {
		const inferences = createInferenceManager()
		const recorded = events(inferences)
		inferences.destroy()
		inferences.destroy()
		expect(recorded.destroy.count).toBe(1)
	})

	it('throws DESTROYED on every call after destroy', () => {
		const inferences = createInferenceManager({ inferences: [inference('a')] })
		inferences.destroy()
		for (const call of [
			() => inferences.inference('a'),
			() => inferences.inferences(),
			() => inferences.append(inference('b')),
			() => inferences.prepend(inference('c')),
			() => inferences.replace(inference('a')),
			() => inferences.remove('a'),
			() => inferences.remove(['a']),
			() => inferences.remove(),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('DESTROYED')
		}
	})
})
