import type { Definition, DefinitionBuilderInterface, QuantitativeDefinition } from '@src/core'
import {
	atom,
	constant,
	createDefinitionBuilder,
	createGroupManager,
	equation,
	fact,
	factorGroup,
	inference,
	inferentialDefinition,
	isDefinitionBuilder,
	isReasonError,
	logicalDefinition,
	quantitativeDefinition,
	rule,
	staticFactor,
	symbolicDefinition,
	variable,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError, deepFreeze, recordEmitterEvents, runTwice } from '../../../../setup.js'

// `DefinitionBuilder` — the definitions & subjects capability layer's stateful
// builder (PROPOSAL.md §13): seven always-present SELF-OWNING manager
// properties (`groups` / `factors` / `rules` / `equations` / `variables` /
// `facts` / `inferences`), each owning its own collection state + emitter. The
// builder owns a scalar envelope and composes `build()` from the kind's
// managers; off-kind managers are inert (kind-free, no MISMATCH). Every
// mutation-then-build scenario below runs TWICE (fresh entities, same
// operations) and deep-equals the two outcomes, pinning both correctness and
// determinism in one assertion (AGENTS §16.1).

describe('DefinitionBuilder — groups & factors (quantitative)', () => {
	it('round-trips append / prepend / replace / remove through the manager properties', () => {
		const seed = deepFreeze(quantitativeDefinition('risk', 'Risk', []))

		const scenario = (): QuantitativeDefinition => {
			const definition = createDefinitionBuilder(seed)
			definition.groups.append(factorGroup('g1', 'sum', []))
			definition.groups.append(factorGroup('g2', 'sum', []))
			definition.groups.prepend(factorGroup('g0', 'sum', []))
			definition.factors.append('g1', staticFactor('f1', 10))
			definition.factors.prepend('g1', staticFactor('f0', 5))
			definition.factors.append('g1', staticFactor('f2', 1))
			definition.factors.replace('g1', staticFactor('f2', 99))
			definition.factors.remove('g1', 'f0')
			definition.groups.replace(factorGroup('g2', 'product', []))
			definition.groups.remove('g0')
			const built = definition.build()
			if (built.reasoning !== 'quantitative') throw new Error('expected quantitative')
			return built
		}

		const [first, second] = runTwice(scenario)

		expect(first.groups.map((group) => group.id)).toEqual(['g1', 'g2'])
		expect(first.groups[1]?.aggregation).toBe('product')
		expect(first.groups[0]?.factors.map((factor) => factor.id)).toEqual(['f1', 'f2'])
		expect(first.groups[0]?.factors[1]).toEqual(staticFactor('f2', 99))
		expect(second).toEqual(first)
	})

	it('exposes the §9.1 singular/plural accessors for groups and factors', () => {
		const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []))
		const group = factorGroup('g1', 'sum', [])
		definition.groups.append(group)
		const factor = staticFactor('f1', 10)
		definition.factors.append('g1', factor)

		expect(definition.groups.group('g1')).toEqual({ ...group, factors: [factor] })
		expect(definition.groups.group('missing')).toBeUndefined()
		expect(definition.groups.groups().map((entry) => entry.id)).toEqual(['g1'])
		expect(definition.factors.factor('g1', 'f1')).toEqual(factor)
		expect(definition.factors.factor('g1', 'missing')).toBeUndefined()
		expect(definition.factors.factors('g1').map((entry) => entry.id)).toEqual(['f1'])
	})

	it('a missing groupId throws TARGET with groupId in the context', () => {
		const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []))
		const error = captureError(() =>
			definition.factors.append('missing-group', staticFactor('f1', 10)),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
		expect(error.context).toEqual({ groupId: 'missing-group' })
	})
})

describe('DefinitionBuilder — rules (logical)', () => {
	it('round-trips append / prepend / replace / remove and exposes accessors', () => {
		const seed = deepFreeze(logicalDefinition('elig', 'Eligibility', []))
		const r1 = rule('r1', [atom('age', 'from', 18)], atom('adult', 'equals', true))
		const r2 = rule('r2', [], atom('flag', 'equals', true))
		const r3 = rule('r3', [], atom('other', 'equals', true))

		const scenario = () => {
			const definition = createDefinitionBuilder(seed)
			definition.rules.append(r1)
			definition.rules.append(r2)
			definition.rules.prepend(r3)
			definition.rules.replace(rule('r2', [], atom('flag', 'equals', false)))
			const built = definition.build()
			if (built.reasoning !== 'logical') throw new Error('expected logical')
			return built
		}

		const [first, second] = runTwice(scenario)

		expect(first.rules.map((entry) => entry.id)).toEqual(['r3', 'r1', 'r2'])
		expect(first.rules[2]?.conclusion).toEqual(atom('flag', 'equals', false))
		expect(second).toEqual(first)

		const definition = createDefinitionBuilder(seed)
		definition.rules.append(r1)
		expect(definition.rules.rule('r1')).toEqual(r1)
		expect(definition.rules.rule('missing')).toBeUndefined()
		expect(definition.rules.rules().map((entry) => entry.id)).toEqual(['r1'])
		definition.rules.remove('r1')
		expect(definition.rules.rules()).toEqual([])
	})
})

describe('DefinitionBuilder — equations & variables (symbolic)', () => {
	it('round-trips equations and variables and exposes accessors', () => {
		const seed = deepFreeze(symbolicDefinition('calc', 'Calc', []))
		const e1 = equation('e1', variable('x'), constant(1), 'x')
		const e2 = equation('e2', variable('y'), constant(2), 'y')

		const scenario = () => {
			const definition = createDefinitionBuilder(seed)
			definition.equations.append(e1)
			definition.equations.prepend(e2)
			definition.equations.replace(equation('e1', variable('x'), constant(9), 'x'))
			definition.variables.add('a', 1)
			definition.variables.add('b', 2)
			definition.variables.remove('a')
			const built = definition.build()
			if (built.reasoning !== 'symbolic') throw new Error('expected symbolic')
			return built
		}

		const [first, second] = runTwice(scenario)

		expect(first.equations.map((entry) => entry.id)).toEqual(['e2', 'e1'])
		expect(first.equations[1]?.right).toEqual(constant(9))
		expect(first.variables).toEqual({ b: 2 })
		expect(second).toEqual(first)

		const definition = createDefinitionBuilder(seed)
		definition.equations.append(e1)
		definition.variables.add('a', 1)
		expect(definition.equations.equation('e1')).toEqual(e1)
		expect(definition.equations.equation('missing')).toBeUndefined()
		expect(definition.equations.equations().map((entry) => entry.id)).toEqual(['e1'])
		expect(definition.variables.variable('a')).toBe(1)
		expect(definition.variables.variable('missing')).toBeUndefined()
		expect(definition.variables.variables()).toEqual({ a: 1 })
		definition.equations.remove('e1')
		expect(definition.equations.equations()).toEqual([])
	})
})

describe('DefinitionBuilder — facts & inferences (inferential)', () => {
	it('round-trips facts and inferences and exposes accessors', () => {
		const seed = deepFreeze(inferentialDefinition('fam', 'Family', [], []))
		const f1 = fact('f1', 'human', ['socrates'])
		const f2 = fact('f2', 'human', ['plato'])
		const i1 = inference('i1', [fact('p', 'human', ['?x'])], fact('c', 'mortal', ['?x']))
		const i2 = inference('i2', [fact('p', 'human', ['?y'])], fact('c', 'mortal', ['?y']))

		const scenario = () => {
			const definition = createDefinitionBuilder(seed)
			definition.facts.append(f1)
			definition.facts.prepend(f2)
			definition.inferences.append(i1)
			definition.inferences.replace(
				inference('i1', [fact('p', 'human', ['?z'])], fact('c', 'mortal', ['?z'])),
			)
			definition.inferences.prepend(i2)
			const built = definition.build()
			if (built.reasoning !== 'inferential') throw new Error('expected inferential')
			return built
		}

		const [first, second] = runTwice(scenario)

		expect(first.facts.map((entry) => entry.id)).toEqual(['f2', 'f1'])
		expect(first.inferences.map((entry) => entry.id)).toEqual(['i2', 'i1'])
		expect(first.inferences[1]?.premises).toEqual([fact('p', 'human', ['?z'])])
		expect(second).toEqual(first)

		const definition = createDefinitionBuilder(seed)
		definition.facts.append(f1)
		definition.inferences.append(i1)
		expect(definition.facts.fact('f1')).toEqual(f1)
		expect(definition.facts.fact('missing')).toBeUndefined()
		expect(definition.facts.facts().map((entry) => entry.id)).toEqual(['f1'])
		expect(definition.inferences.inference('i1')).toEqual(i1)
		expect(definition.inferences.inference('missing')).toBeUndefined()
		expect(definition.inferences.inferences().map((entry) => entry.id)).toEqual(['i1'])
		definition.facts.remove('f1')
		expect(definition.facts.facts()).toEqual([])
	})
})

describe('DefinitionBuilder — off-kind managers are inert (kind-free)', () => {
	it('mutating every off-kind manager does not throw and build() omits their collections', () => {
		const scenario = (): QuantitativeDefinition => {
			const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []))
			definition.rules.append(rule('r1', [], atom('a', 'equals', true)))
			definition.equations.append(equation('e1', variable('x'), constant(1), 'x'))
			definition.variables.add('x', 1)
			definition.facts.append(fact('f1', 'human', ['socrates']))
			definition.inferences.append(
				inference('i1', [fact('p', 'human', ['?x'])], fact('c', 'mortal', ['?x'])),
			)
			const built = definition.build()
			if (built.reasoning !== 'quantitative') throw new Error('expected quantitative')
			return built
		}

		const [first, second] = runTwice(scenario)

		expect('rules' in first).toBe(false)
		expect('equations' in first).toBe(false)
		expect('variables' in first).toBe(false)
		expect('facts' in first).toBe(false)
		expect('inferences' in first).toBe(false)
		expect(first.groups).toEqual([])
		expect(second).toEqual(first)
	})

	it('groups are inert on a non-quantitative builder — build() omits them', () => {
		const definition = createDefinitionBuilder(logicalDefinition('elig', 'Eligibility', []))
		expect(() => definition.groups.append(factorGroup('g1', 'sum', []))).not.toThrow()
		const built = definition.build()
		if (built.reasoning !== 'logical') throw new Error('expected logical')
		expect('groups' in built).toBe(false)
		expect(built.rules).toEqual([])
	})
})

describe('DefinitionBuilder — merge', () => {
	it('reconciles onto the base id from a plain Definition, incoming-wins, emits merge(reasoning)', () => {
		const base = deepFreeze(
			quantitativeDefinition('risk', 'Risk', [factorGroup('g1', 'sum', [])], { base: 10 }),
		)
		const incoming = quantitativeDefinition('risk', 'Risk v2', [factorGroup('g2', 'sum', [])])

		const scenario = () => {
			const definition = createDefinitionBuilder(base)
			const events = recordEmitterEvents(definition.emitter, ['merge'] as const)
			definition.merge(incoming)
			const built = definition.build()
			if (built.reasoning !== 'quantitative') throw new Error('expected quantitative')
			return { built, mergeCalls: events.merge.calls }
		}

		const [first, second] = runTwice(scenario)

		expect(first.built.id).toBe('risk')
		expect(first.built.name).toBe('Risk v2')
		expect(first.built.groups.map((group) => group.id)).toEqual(['g2', 'g1'])
		expect(first.mergeCalls).toEqual([['quantitative']])
		expect(second.built).toEqual(first.built)
	})

	it('a cross-reasoning merge throws MISMATCH', () => {
		const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []))
		const error = captureError(() => definition.merge(logicalDefinition('risk', 'Risk', [])))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')
	})
})

describe('DefinitionBuilder — clear', () => {
	it('deletes an optional field per reasoning, uniformly, and emits clear(key)', () => {
		const seed = quantitativeDefinition('risk', 'Risk', [], { description: 'd', precision: 2 })
		const definition = createDefinitionBuilder(seed)
		const events = recordEmitterEvents(definition.emitter, ['clear'] as const)

		definition.clear('precision')
		const built = definition.build()
		expect('precision' in built).toBe(false)
		expect('description' in built).toBe(true)
		expect(events.clear.calls).toEqual([['precision']])
	})

	it('a non-clearable key for the current reasoning throws MISMATCH', () => {
		const definition = createDefinitionBuilder(logicalDefinition('elig', 'Eligibility', []))
		const error = captureError(() => definition.clear('base'))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')
		expect(error.context).toEqual({ key: 'base', reasoning: 'logical' })
	})
})

describe('DefinitionBuilder — per-manager emitter event pins', () => {
	it('group append / prepend / replace / remove fire on the groups manager emitter', () => {
		const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []))
		const events = recordEmitterEvents(definition.groups.emitter, [
			'append',
			'prepend',
			'replace',
			'remove',
		] as const)

		definition.groups.append(factorGroup('g1', 'sum', []))
		definition.groups.prepend(factorGroup('g0', 'sum', []))
		definition.groups.replace(factorGroup('g1', 'product', []))
		definition.groups.remove('g0')

		expect(events.append.calls).toEqual([['g1']])
		expect(events.prepend.calls).toEqual([['g0']])
		expect(events.replace.calls).toEqual([['g1']])
		expect(events.remove.calls).toEqual([['g0']])
	})

	it('factor mutations fire on the factors manager emitter with the factor id', () => {
		const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []))
		definition.groups.append(factorGroup('g1', 'sum', []))
		const events = recordEmitterEvents(definition.factors.emitter, [
			'append',
			'prepend',
			'replace',
			'remove',
		] as const)

		definition.factors.append('g1', staticFactor('f1', 10))
		definition.factors.prepend('g1', staticFactor('f0', 5))
		definition.factors.replace('g1', staticFactor('f1', 20))
		definition.factors.remove('g1', 'f0')

		expect(events.append.calls).toEqual([['f1']])
		expect(events.prepend.calls).toEqual([['f0']])
		expect(events.replace.calls).toEqual([['f1']])
		expect(events.remove.calls).toEqual([['f0']])
	})

	it('variables.add emits add(name) and variables.remove emits remove(name) on the variables emitter', () => {
		const definition = createDefinitionBuilder(symbolicDefinition('calc', 'Calc', []))
		const events = recordEmitterEvents(definition.variables.emitter, ['add', 'remove'] as const)

		definition.variables.add('x', 1)
		definition.variables.remove('x')

		expect(events.add.calls).toEqual([['x']])
		expect(events.remove.calls).toEqual([['x']])
	})
})

describe('DefinitionBuilder — manager lifecycle', () => {
	it('a manager destroy emits destroy on its OWN emitter, then throws DESTROYED', () => {
		const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []))
		const events = recordEmitterEvents(definition.groups.emitter, ['destroy'] as const)

		definition.groups.destroy()
		expect(() => definition.groups.destroy()).not.toThrow()

		expect(events.destroy.calls).toEqual([[]])
		expect(definition.groups.emitter.destroyed).toBe(true)
		const error = captureError(() => definition.groups.append(factorGroup('g1', 'sum', [])))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('DESTROYED')
	})

	it('DESTROYED: the builder destroy cascades — every entity + manager method throws', () => {
		const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []))
		definition.groups.append(factorGroup('g1', 'sum', []))
		definition.destroy()

		for (const call of [
			() => definition.build(),
			() => definition.merge(quantitativeDefinition('risk', 'Risk', [])),
			() => definition.clear('description'),
			() => definition.groups.groups(),
			() => definition.groups.append(factorGroup('g2', 'sum', [])),
			() => definition.factors.factors('g1'),
			() => definition.factors.append('g1', staticFactor('f1', 10)),
			() => definition.rules.rules(),
			() => definition.equations.equations(),
			() => definition.variables.variables(),
			() => definition.facts.facts(),
			() => definition.inferences.inferences(),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('DESTROYED')
		}
	})

	it('is idempotent and destroys the builder emitter LAST (a destroy listener still fires)', () => {
		const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []))
		const events = recordEmitterEvents(definition.emitter, ['destroy'] as const)

		definition.destroy()
		expect(() => definition.destroy()).not.toThrow()

		expect(events.destroy.calls).toEqual([[]])
		expect(definition.emitter.destroyed).toBe(true)
	})
})

describe('DefinitionBuilder — bring-your-own managers', () => {
	it('an injected manager is reused and visible in build(), observing its own mutations', () => {
		const groups = createGroupManager({
			groups: [factorGroup('g1', 'sum', [staticFactor('f1', 10)])],
		})
		const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []), {
			groups,
		})
		expect(definition.groups).toBe(groups)

		const built = definition.build()
		if (built.reasoning !== 'quantitative') throw new Error('expected quantitative')
		expect(built.groups.map((group) => group.id)).toEqual(['g1'])

		const events = recordEmitterEvents(groups.emitter, ['append'] as const)
		definition.groups.append(factorGroup('g2', 'sum', []))
		expect(events.append.calls).toEqual([['g2']])
		const rebuilt = definition.build()
		if (rebuilt.reasoning !== 'quantitative') throw new Error('expected quantitative')
		expect(rebuilt.groups.map((group) => group.id)).toEqual(['g1', 'g2'])
	})
})

describe('DefinitionBuilder — build determinism', () => {
	it('build() returns a fresh, deep-equal snapshot on every call', () => {
		const definition = createDefinitionBuilder(quantitativeDefinition('risk', 'Risk', []))
		definition.groups.append(factorGroup('g1', 'sum', [staticFactor('f1', 10)]))

		const first = definition.build()
		const second = definition.build()

		expect(second).toEqual(first)
		expect(second).not.toBe(first)
	})
})

describe('DefinitionBuilder — id defaulting and seed protection', () => {
	it('id defaults to seed.id, and an options.id overrides it', () => {
		const seed = quantitativeDefinition('risk', 'Risk', [])
		expect(createDefinitionBuilder(seed).id).toBe('risk')
		expect(createDefinitionBuilder(seed, { id: 'custom' }).id).toBe('custom')
		expect(createDefinitionBuilder(seed, { id: 'custom' }).build().id).toBe('custom')
	})

	it('never mutates the seed (deep-frozen) across every mutation surface', () => {
		const seed = deepFreeze(quantitativeDefinition('risk', 'Risk', [], { description: 'd' }))
		const snapshot: Definition = { ...seed, groups: [...seed.groups] }

		const definition = createDefinitionBuilder(seed)
		definition.groups.append(factorGroup('g1', 'sum', [staticFactor('f1', 10)]))
		definition.clear('description')
		definition.merge(quantitativeDefinition('risk', 'Risk v2', [factorGroup('g2', 'sum', [])]))

		expect(seed).toEqual(snapshot)
	})
})

describe('DefinitionBuilder — brand soundness', () => {
	it('a plain record forging a build() field does NOT narrow as a DefinitionBuilder', () => {
		const forged: unknown = { build: () => quantitativeDefinition('risk', 'Risk', []) }
		expect(isDefinitionBuilder(forged)).toBe(false)
	})

	it('accepts a real entity and rejects plain built data', () => {
		const definition: DefinitionBuilderInterface = createDefinitionBuilder(
			quantitativeDefinition('risk', 'Risk', []),
		)
		expect(isDefinitionBuilder(definition)).toBe(true)
		expect(isDefinitionBuilder(definition.build())).toBe(false)
	})
})
