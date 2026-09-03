import type { RuleManagerEventMap } from '@src/core'
import { createAtom, createRule, createRuleManager, isReasonError, RuleManager } from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError, createRecorders } from '@orkestrel/test'

// `RuleManager` — the self-owning, kind-free manager over a logical
// definition's `rules`. Rule order is LOAD-BEARING (the forward conclusion is
// the last declared non-disabled rule), so placement is proved by the order the
// plural accessor reports. `remove` is the batch family reporting exactly what
// it removed, `seat` is the owning builder's SILENT bulk re-seat channel, and
// `destroy()` is idempotent with every other call afterwards throwing
// DESTROYED.

function rule(id: string) {
	return createRule(id, [createAtom('age', 'from', 18)], createAtom(id, 'equals', true))
}

function events(manager: { readonly emitter: RuleManager['emitter'] }) {
	return createRecorders<
		RuleManagerEventMap,
		'append' | 'prepend' | 'replace' | 'remove' | 'destroy'
	>(manager.emitter, ['append', 'prepend', 'replace', 'remove', 'destroy'])
}

describe('RuleManager — construction and accessors', () => {
	it('defaults to an empty collection and seeds from options', () => {
		expect(createRuleManager().rules()).toEqual([])
		expect(
			createRuleManager({ rules: [rule('a')] })
				.rules()
				.map((entry) => entry.id),
		).toEqual(['a'])
	})

	it('reads ONE rule by id and ALL rules in declaration order', () => {
		const rules = createRuleManager({ rules: [rule('a'), rule('b')] })
		expect(rules.rule('a')?.name).toBe('a')
		expect(rules.rule('absent')).toBeUndefined()
		expect(rules.rules().map((entry) => entry.id)).toEqual(['a', 'b'])
	})

	it('reads without emitting', () => {
		const rules = createRuleManager({ rules: [rule('a')] })
		const recorded = events(rules)
		rules.rule('a')
		rules.rules()
		expect(recorded.append.count + recorded.remove.count).toBe(0)
	})

	it('constructs identically through the class and the factory', () => {
		const seed = [rule('a')]
		expect(new RuleManager({ rules: seed }).rules()).toEqual(
			createRuleManager({ rules: seed }).rules(),
		)
	})
})

describe('RuleManager — placement verbs', () => {
	it('appends at the end without a target and after the target with one', () => {
		const rules = createRuleManager()
		rules.append(rule('a'))
		rules.append(rule('b'))
		rules.append(rule('c'), 'a')
		expect(rules.rules().map((entry) => entry.id)).toEqual(['a', 'c', 'b'])
	})

	it('prepends at the start without a target and before the target with one', () => {
		const rules = createRuleManager({ rules: [rule('a'), rule('b')] })
		rules.prepend(rule('c'))
		rules.prepend(rule('d'), 'b')
		expect(rules.rules().map((entry) => entry.id)).toEqual(['c', 'a', 'd', 'b'])
	})

	it('replaces a same-id rule IN PLACE and appends an unmatched one', () => {
		const rules = createRuleManager({ rules: [rule('a'), rule('b')] })
		rules.replace(createRule('a', [], createAtom('a', 'equals', false)))
		expect(rules.rules().map((entry) => entry.id)).toEqual(['a', 'b'])
		expect(rules.rule('a')?.premises).toEqual([])
		rules.replace(rule('z'))
		expect(rules.rules().map((entry) => entry.id)).toEqual(['a', 'b', 'z'])
	})

	it('throws TARGET when a target names no existing rule', () => {
		const rules = createRuleManager({ rules: [rule('a')] })
		for (const call of [
			() => rules.append(rule('b'), 'absent'),
			() => rules.prepend(rule('c'), 'absent'),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('TARGET')
		}
	})

	it('emits the affected rule id per write verb, AFTER the mutation', () => {
		const rules = createRuleManager()
		const recorded = events(rules)
		rules.append(rule('a'))
		rules.prepend(rule('b'))
		rules.replace(rule('a'))
		rules.remove('a')
		expect(recorded.append.calls).toEqual([['a']])
		expect(recorded.prepend.calls).toEqual([['b']])
		expect(recorded.replace.calls).toEqual([['a']])
		expect(recorded.remove.calls).toEqual([['a']])
	})
})

describe('RuleManager — the remove batch family', () => {
	it('removes ONE rule by id and reports whether it was there', () => {
		const rules = createRuleManager({ rules: [rule('a'), rule('b')] })
		expect(rules.remove('a')).toBe(true)
		expect(rules.rules().map((entry) => entry.id)).toEqual(['b'])
		expect(rules.remove('absent')).toBe(false)
	})

	it('removes an id LIST and returns true only when every named id existed', () => {
		const rules = createRuleManager({ rules: [rule('a'), rule('b'), rule('c')] })
		expect(rules.remove(['a', 'b'])).toBe(true)
		expect(rules.rules().map((entry) => entry.id)).toEqual(['c'])
		expect(rules.remove(['c', 'absent'])).toBe(false)
		expect(rules.rules()).toEqual([])
		expect(rules.remove([])).toBe(true)
	})

	it('removes EVERY rule with no argument', () => {
		const rules = createRuleManager({ rules: [rule('a'), rule('b')] })
		rules.remove()
		expect(rules.rules()).toEqual([])
	})

	it('emits once per rule actually removed, and nothing for an absent id', () => {
		const rules = createRuleManager({ rules: [rule('a'), rule('b')] })
		const recorded = events(rules)
		rules.remove('absent')
		expect(recorded.remove.calls).toEqual([])
		rules.remove(['a', 'absent'])
		expect(recorded.remove.calls).toEqual([['a']])
		recorded.remove.clear()
		rules.remove()
		expect(recorded.remove.calls).toEqual([['b']])
	})
})

describe('RuleManager — seat, the silent bulk re-seat channel', () => {
	it('replaces the whole collection and emits nothing', () => {
		const rules = createRuleManager({ rules: [rule('a'), rule('b')] })
		const recorded = events(rules)
		rules.seat([rule('c'), rule('d')])
		expect(rules.rules().map((entry) => entry.id)).toEqual(['c', 'd'])
		expect(rules.rule('a')).toBeUndefined()
		expect(recorded.append.calls).toEqual([])
		expect(recorded.prepend.calls).toEqual([])
		expect(recorded.replace.calls).toEqual([])
		expect(recorded.remove.calls).toEqual([])
	})
})

describe('RuleManager — destroy', () => {
	it('emits destroy once and is idempotent', () => {
		const rules = createRuleManager()
		const recorded = events(rules)
		rules.destroy()
		rules.destroy()
		expect(recorded.destroy.count).toBe(1)
	})

	it('throws DESTROYED on every call after destroy', () => {
		const rules = createRuleManager({ rules: [rule('a')] })
		rules.destroy()
		for (const call of [
			() => rules.rule('a'),
			() => rules.rules(),
			() => rules.append(rule('b')),
			() => rules.prepend(rule('c')),
			() => rules.replace(rule('a')),
			() => rules.remove('a'),
			() => rules.remove(['a']),
			() => rules.remove(),
			() => rules.seat([]),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('DESTROYED')
		}
	})
})
