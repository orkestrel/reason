import type { SubjectBuilderInterface, Subject } from '@src/core'
import { createSubjectBuilder, isReasonError, isSubjectBuilder } from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError, deepFreeze, recordEmitterEvents, runTwice } from '../../../setup.js'

// `SubjectBuilder` — the definitions & subjects capability layer's stateful
// subject builder (PROPOSAL.md §14): a flat single-collection workspace
// mutated through single-word methods, then `build()` a fresh plain
// `Subject` at act-time. Every mutation-then-build scenario below runs
// TWICE (fresh entities, same operations) and deep-equals the two outcomes,
// pinning both correctness and determinism in one assertion (AGENTS §16.1).

describe('SubjectBuilder — set / field / fields round-trip', () => {
	it('upserts fields via set and reads them back via field/fields', () => {
		const seed = deepFreeze<Subject>({ id: 's1', age: 30 })

		const scenario = (): Subject => {
			const subject = createSubjectBuilder(seed)
			subject.set('age', 31)
			subject.set('name', 'Alice')
			return subject.build()
		}

		const [first, second] = runTwice(scenario)

		expect(first).toEqual({ id: 's1', age: 31, name: 'Alice' })
		expect(second).toEqual(first)

		const subject = createSubjectBuilder(seed)
		subject.set('age', 40)
		expect(subject.field('age')).toBe(40)
		expect(subject.field('missing')).toBeUndefined()
		expect(subject.fields()).toEqual({ id: 's1', age: 40 })
	})

	it('set is id-agnostic at the helper level but the entity method throws on "id"', () => {
		const subject = createSubjectBuilder({ id: 's1', age: 30 })
		const error = captureError(() => subject.set('id', 'other'))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')
		expect(subject.id).toBe('s1')
		expect(subject.build().id).toBe('s1')
	})
})

describe('SubjectBuilder — remove', () => {
	it('the array-first overload removes many keys and returns true only when all existed', () => {
		const seed = deepFreeze<Subject>({ id: 's1', age: 30, name: 'Alice', extra: true })

		const scenario = () => {
			const subject = createSubjectBuilder(seed)
			const allExisted = subject.remove(['age', 'name'])
			const built = subject.build()
			return { allExisted, built }
		}

		const [first, second] = runTwice(scenario)

		expect(first.allExisted).toBe(true)
		expect(first.built).toEqual({ id: 's1', extra: true })
		expect(second).toEqual(first)

		const subject = createSubjectBuilder(seed)
		expect(subject.remove(['age', 'missing'])).toBe(false)
		expect(subject.build()).toEqual({ id: 's1', name: 'Alice', extra: true })
	})

	it('the single-key overload removes one key and returns whether it existed', () => {
		const subject = createSubjectBuilder({ id: 's1', age: 30 })
		expect(subject.remove('age')).toBe(true)
		expect(subject.remove('age')).toBe(false)
		expect(subject.build()).toEqual({ id: 's1' })
	})

	it('removing "id" throws MISMATCH and leaves the id intact', () => {
		const subject = createSubjectBuilder({ id: 's1', age: 30 })
		const error = captureError(() => subject.remove('id'))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')
		expect(subject.build()).toEqual({ id: 's1', age: 30 })
	})
})

describe('SubjectBuilder — merge', () => {
	it('reconciles incoming-wins from a plain Subject, base id preserved, emits merge(incoming)', () => {
		const base = deepFreeze<Subject>({ id: 's1', age: 30, name: 'Alice' })
		const incoming: Subject = { age: 31, extra: true }

		const scenario = () => {
			const subject = createSubjectBuilder(base)
			const events = recordEmitterEvents(subject.emitter, ['merge'] as const)
			subject.merge(incoming)
			return { built: subject.build(), mergeCalls: events.merge.calls }
		}

		const [first, second] = runTwice(scenario)

		expect(first.built).toEqual({ id: 's1', age: 31, name: 'Alice', extra: true })
		expect(first.mergeCalls).toEqual([[incoming]])
		expect(second.built).toEqual(first.built)
	})
})

describe('SubjectBuilder — clear', () => {
	it('removes every non-id field and emits clear()', () => {
		const subject = createSubjectBuilder({ id: 's1', age: 30, name: 'Alice' })
		const events = recordEmitterEvents(subject.emitter, ['clear'] as const)

		subject.clear()

		expect(subject.build()).toEqual({ id: 's1' })
		expect(events.clear.calls).toEqual([[]])
	})
})

describe('SubjectBuilder — repeat', () => {
	it('mints deterministic baseId-index ids and returns plain payloads without emitting', () => {
		const subject = createSubjectBuilder({ id: 's1', age: 30 })
		const events = recordEmitterEvents(subject.emitter, [
			'set',
			'remove',
			'merge',
			'clear',
		] as const)

		const [first, second] = runTwice(() => subject.repeat(3))

		expect(first).toEqual([
			{ id: 's1-0', age: 30 },
			{ id: 's1-1', age: 30 },
			{ id: 's1-2', age: 30 },
		])
		expect(second).toEqual(first)
		expect(isSubjectBuilder(first[0])).toBe(false)
		expect(events.set.calls).toEqual([])
		expect(events.remove.calls).toEqual([])
		expect(events.merge.calls).toEqual([])
		expect(events.clear.calls).toEqual([])
	})
})

describe('SubjectBuilder — emitter event pins per verb', () => {
	it('set / remove / merge / clear each carry the documented payload', () => {
		const subject = createSubjectBuilder({ id: 's1', age: 30 })
		const events = recordEmitterEvents(subject.emitter, [
			'set',
			'remove',
			'merge',
			'clear',
		] as const)

		subject.set('age', 31)
		subject.remove('age')
		subject.merge({ name: 'Alice' })
		subject.clear()

		expect(events.set.calls).toEqual([['age', 31]])
		expect(events.remove.calls).toEqual([['age']])
		expect(events.merge.calls).toEqual([[{ name: 'Alice' }]])
		expect(events.clear.calls).toEqual([[]])
	})
})

describe('SubjectBuilder — destroy', () => {
	it('DESTROYED: every method throws afterwards (except emitter/destroy)', () => {
		const subject = createSubjectBuilder({ id: 's1', age: 30 })
		subject.destroy()

		for (const call of [
			() => subject.field('age'),
			() => subject.fields(),
			() => subject.set('age', 31),
			() => subject.remove('age'),
			() => subject.merge({ age: 31 }),
			() => subject.clear(),
			() => subject.repeat(2),
			() => subject.build(),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('DESTROYED')
		}
	})

	it('is idempotent and destroys the emitter LAST (a destroy listener still fires)', () => {
		const subject = createSubjectBuilder({ id: 's1', age: 30 })
		const events = recordEmitterEvents(subject.emitter, ['destroy'] as const)

		subject.destroy()
		expect(() => subject.destroy()).not.toThrow()

		expect(events.destroy.calls).toEqual([[]])
		expect(subject.emitter.destroyed).toBe(true)
	})
})

describe('SubjectBuilder — build determinism', () => {
	it('build() returns a fresh, deep-equal snapshot on every call', () => {
		const subject = createSubjectBuilder({ id: 's1', age: 30 })
		subject.set('name', 'Alice')

		const first = subject.build()
		const second = subject.build()

		expect(second).toEqual(first)
		expect(second).not.toBe(first)
	})
})

describe('SubjectBuilder — id defaulting, requirement, and seed protection', () => {
	it('id defaults to seed.id, and an options.id overrides it', () => {
		const seed = { id: 's1', age: 30 }
		expect(createSubjectBuilder(seed).id).toBe('s1')
		expect(createSubjectBuilder(seed, { id: 'custom' }).id).toBe('custom')
		expect(createSubjectBuilder(seed, { id: 'custom' }).build().id).toBe('custom')
	})

	it('builds anonymously when neither options.id nor a string seed.id is present', () => {
		const subject = createSubjectBuilder({ age: 30 })
		expect(subject.id).toBeUndefined()

		subject.set('name', 'Alice')
		const built = subject.build()
		expect(built).toEqual({ age: 30, name: 'Alice' })
		expect(Object.hasOwn(built, 'id')).toBe(false)

		const error = captureError(() => subject.set('id', 'other'))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')

		const removeError = captureError(() => subject.remove('id'))
		if (!isReasonError(removeError)) throw new Error('expected a ReasonError')
		expect(removeError.code).toBe('MISMATCH')

		expect(subject.remove('age')).toBe(true)
		subject.merge({ extra: true })
		expect(subject.build()).toEqual({ name: 'Alice', extra: true })

		subject.clear()
		expect(subject.build()).toEqual({})
		expect(subject.id).toBeUndefined()
	})

	it('a non-string seed.id never leaks an "id" key into build()', () => {
		const subject = createSubjectBuilder({ id: 42, age: 1 })
		expect(subject.id).toBeUndefined()
		const built = subject.build()
		expect(Object.hasOwn(built, 'id')).toBe(false)
		expect(built).toEqual({ age: 1 })
	})

	it('merging an id-carrying subject into an anonymous builder never leaks an "id" key', () => {
		const subject = createSubjectBuilder({ age: 30 })
		subject.merge({ id: 's1', name: 'Alice' })
		const built = subject.build()
		expect(Object.hasOwn(built, 'id')).toBe(false)
		expect(built).toEqual({ age: 30, name: 'Alice' })
	})

	it('repeat() on an anonymous builder never leaks an "id" key', () => {
		const subject = createSubjectBuilder({ age: 30 })
		const clones = subject.repeat(2)
		for (const clone of clones) expect(Object.hasOwn(clone, 'id')).toBe(false)
		expect(clones).toEqual([{ age: 30 }, { age: 30 }])
	})

	it('never mutates the seed (deep-frozen) across every mutation surface', () => {
		const seed = deepFreeze<Subject>({ id: 's1', age: 30, name: 'Alice' })
		const snapshot: Subject = { ...seed }

		const subject = createSubjectBuilder(seed)
		subject.set('age', 99)
		subject.remove('name')
		subject.merge({ extra: true })
		subject.clear()
		subject.repeat(2)

		expect(seed).toEqual(snapshot)
	})
})

describe('SubjectBuilder — brand soundness', () => {
	it('a plain record forging a build() field does NOT narrow as a SubjectBuilder', () => {
		const forged: unknown = { build: () => ({ id: 's1' }) }
		expect(isSubjectBuilder(forged)).toBe(false)
	})

	it('accepts a real entity and rejects plain built data', () => {
		const subject: SubjectBuilderInterface = createSubjectBuilder({ id: 's1', age: 30 })
		expect(isSubjectBuilder(subject)).toBe(true)
		expect(isSubjectBuilder(subject.build())).toBe(false)
	})
})
