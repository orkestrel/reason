import type {
	Definition,
	DefinitionBuilderEventMap,
	DefinitionBuilderInterface,
	FactorManagerEventMap,
	GroupManagerEventMap,
	QuantitativeDefinition,
	VariableManagerEventMap,
} from '@src/core'
import {
	createAtom,
	createConstant,
	createDefinitionBuilder,
	createEquation,
	createFact,
	createFactorGroup,
	createGroupManager,
	createInference,
	createInferentialDefinition,
	createLogicalDefinition,
	createQuantitativeDefinition,
	createRule,
	createStaticFactor,
	createSymbolicDefinition,
	createVariable,
	isDefinitionBuilder,
	isReasonError,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { captureError, createRecorders } from '@orkestrel/test'
import { deepFreeze, runTwice } from '../../../setup.js'

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
		const seed = deepFreeze(createQuantitativeDefinition('risk', 'Risk', []))

		const scenario = (): QuantitativeDefinition => {
			const definition = createDefinitionBuilder(seed)
			definition.groups.append(createFactorGroup('g1', 'sum', []))
			definition.groups.append(createFactorGroup('g2', 'sum', []))
			definition.groups.prepend(createFactorGroup('g0', 'sum', []))
			definition.factors.append('g1', createStaticFactor('f1', 10))
			definition.factors.prepend('g1', createStaticFactor('f0', 5))
			definition.factors.append('g1', createStaticFactor('f2', 1))
			definition.factors.replace('g1', createStaticFactor('f2', 99))
			definition.factors.remove('g1', 'f0')
			definition.groups.replace(createFactorGroup('g2', 'product', []))
			definition.groups.remove('g0')
			const built = definition.build()
			if (built.reasoning !== 'quantitative') throw new Error('expected quantitative')
			return built
		}

		const [first, second] = runTwice(scenario)

		expect(first.groups.map((group) => group.id)).toEqual(['g1', 'g2'])
		expect(first.groups[1]?.aggregation).toBe('product')
		expect(first.groups[0]?.factors.map((factor) => factor.id)).toEqual(['f1', 'f2'])
		expect(first.groups[0]?.factors[1]).toEqual(createStaticFactor('f2', 99))
		expect(second).toEqual(first)
	})

	it('exposes the §9.1 singular/plural accessors for groups and factors', () => {
		const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []))
		const group = createFactorGroup('g1', 'sum', [])
		definition.groups.append(group)
		const factor = createStaticFactor('f1', 10)
		definition.factors.append('g1', factor)

		expect(definition.groups.group('g1')).toEqual({ ...group, factors: [factor] })
		expect(definition.groups.group('missing')).toBeUndefined()
		expect(definition.groups.groups().map((entry) => entry.id)).toEqual(['g1'])
		expect(definition.factors.factor('g1', 'f1')).toEqual(factor)
		expect(definition.factors.factor('g1', 'missing')).toBeUndefined()
		expect(definition.factors.factors('g1').map((entry) => entry.id)).toEqual(['f1'])
	})

	it('a missing groupId throws TARGET with groupId in the context', () => {
		const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []))
		const error = captureError(() =>
			definition.factors.append('missing-group', createStaticFactor('f1', 10)),
		)
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('TARGET')
		expect(error.context).toEqual({ groupId: 'missing-group' })
	})
})

describe('DefinitionBuilder — rules (logical)', () => {
	it('round-trips append / prepend / replace / remove and exposes accessors', () => {
		const seed = deepFreeze(createLogicalDefinition('elig', 'Eligibility', []))
		const r1 = createRule(
			'r1',
			[createAtom('age', 'from', 18)],
			createAtom('adult', 'equals', true),
		)
		const r2 = createRule('r2', [], createAtom('flag', 'equals', true))
		const r3 = createRule('r3', [], createAtom('other', 'equals', true))

		const scenario = () => {
			const definition = createDefinitionBuilder(seed)
			definition.rules.append(r1)
			definition.rules.append(r2)
			definition.rules.prepend(r3)
			definition.rules.replace(createRule('r2', [], createAtom('flag', 'equals', false)))
			const built = definition.build()
			if (built.reasoning !== 'logical') throw new Error('expected logical')
			return built
		}

		const [first, second] = runTwice(scenario)

		expect(first.rules.map((entry) => entry.id)).toEqual(['r3', 'r1', 'r2'])
		expect(first.rules[2]?.conclusion).toEqual(createAtom('flag', 'equals', false))
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
		const seed = deepFreeze(createSymbolicDefinition('calc', 'Calc', []))
		const e1 = createEquation('e1', createVariable('x'), createConstant(1), 'x')
		const e2 = createEquation('e2', createVariable('y'), createConstant(2), 'y')

		const scenario = () => {
			const definition = createDefinitionBuilder(seed)
			definition.equations.append(e1)
			definition.equations.prepend(e2)
			definition.equations.replace(
				createEquation('e1', createVariable('x'), createConstant(9), 'x'),
			)
			definition.variables.add('a', 1)
			definition.variables.add('b', 2)
			definition.variables.remove('a')
			const built = definition.build()
			if (built.reasoning !== 'symbolic') throw new Error('expected symbolic')
			return built
		}

		const [first, second] = runTwice(scenario)

		expect(first.equations.map((entry) => entry.id)).toEqual(['e2', 'e1'])
		expect(first.equations[1]?.right).toEqual(createConstant(9))
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
		const seed = deepFreeze(createInferentialDefinition('fam', 'Family', [], []))
		const f1 = createFact('f1', 'human', ['socrates'])
		const f2 = createFact('f2', 'human', ['plato'])
		const i1 = createInference(
			'i1',
			[createFact('p', 'human', ['?x'])],
			createFact('c', 'mortal', ['?x']),
		)
		const i2 = createInference(
			'i2',
			[createFact('p', 'human', ['?y'])],
			createFact('c', 'mortal', ['?y']),
		)

		const scenario = () => {
			const definition = createDefinitionBuilder(seed)
			definition.facts.append(f1)
			definition.facts.prepend(f2)
			definition.inferences.append(i1)
			definition.inferences.replace(
				createInference(
					'i1',
					[createFact('p', 'human', ['?z'])],
					createFact('c', 'mortal', ['?z']),
				),
			)
			definition.inferences.prepend(i2)
			const built = definition.build()
			if (built.reasoning !== 'inferential') throw new Error('expected inferential')
			return built
		}

		const [first, second] = runTwice(scenario)

		expect(first.facts.map((entry) => entry.id)).toEqual(['f2', 'f1'])
		expect(first.inferences.map((entry) => entry.id)).toEqual(['i2', 'i1'])
		expect(first.inferences[1]?.premises).toEqual([createFact('p', 'human', ['?z'])])
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
			const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []))
			definition.rules.append(createRule('r1', [], createAtom('a', 'equals', true)))
			definition.equations.append(createEquation('e1', createVariable('x'), createConstant(1), 'x'))
			definition.variables.add('x', 1)
			definition.facts.append(createFact('f1', 'human', ['socrates']))
			definition.inferences.append(
				createInference(
					'i1',
					[createFact('p', 'human', ['?x'])],
					createFact('c', 'mortal', ['?x']),
				),
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
		const definition = createDefinitionBuilder(createLogicalDefinition('elig', 'Eligibility', []))
		expect(() => definition.groups.append(createFactorGroup('g1', 'sum', []))).not.toThrow()
		const built = definition.build()
		if (built.reasoning !== 'logical') throw new Error('expected logical')
		expect('groups' in built).toBe(false)
		expect(built.rules).toEqual([])
	})
})

describe('DefinitionBuilder — seat (the bulk re-seat channel)', () => {
	it("replaces a list manager's whole collection in one silent call — no per-element events", () => {
		const definition = createDefinitionBuilder(
			createQuantitativeDefinition('risk', 'Risk', [createFactorGroup('g1', 'sum', [])]),
		)
		const events = createRecorders<
			GroupManagerEventMap,
			'append' | 'prepend' | 'replace' | 'remove'
		>(definition.groups.emitter, ['append', 'prepend', 'replace', 'remove'])

		definition.groups.seat([createFactorGroup('g2', 'sum', []), createFactorGroup('g3', 'sum', [])])

		expect(definition.groups.groups().map((group) => group.id)).toEqual(['g2', 'g3'])
		expect(definition.groups.group('g1')).toBeUndefined()
		expect(events.append.calls).toEqual([])
		expect(events.prepend.calls).toEqual([])
		expect(events.replace.calls).toEqual([])
		expect(events.remove.calls).toEqual([])
	})

	it('replaces the variables record in one silent call — no per-entry events', () => {
		const definition = createDefinitionBuilder(
			createSymbolicDefinition('rate', 'Rate', [], { variables: { x: 1 } }),
		)
		const events = createRecorders<VariableManagerEventMap, 'add' | 'remove'>(
			definition.variables.emitter,
			['add', 'remove'],
		)

		definition.variables.seat({ y: 2 })

		expect(definition.variables.variables()).toEqual({ y: 2 })
		expect(definition.variables.variable('x')).toBeUndefined()
		expect(events.add.calls).toEqual([])
		expect(events.remove.calls).toEqual([])
	})

	it('throws DESTROYED after the owning manager is destroyed', () => {
		const definition = createDefinitionBuilder(createLogicalDefinition('elig', 'Eligibility', []))
		definition.rules.destroy()
		const error = captureError(() => definition.rules.seat([]))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('DESTROYED')
	})

	it('throws DESTROYED after the variables manager is destroyed', () => {
		const definition = createDefinitionBuilder(
			createSymbolicDefinition('rate', 'Rate', [], { variables: { x: 1 } }),
		)
		definition.variables.destroy()
		const error = captureError(() => definition.variables.seat({}))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('DESTROYED')
	})
})

describe('DefinitionBuilder — merge', () => {
	it('reconciles onto the base id from a plain Definition, incoming-wins, emits merge(reasoning)', () => {
		const base = deepFreeze(
			createQuantitativeDefinition('risk', 'Risk', [createFactorGroup('g1', 'sum', [])], {
				base: 10,
			}),
		)
		const incoming = createQuantitativeDefinition('risk', 'Risk v2', [
			createFactorGroup('g2', 'sum', []),
		])

		const scenario = () => {
			const definition = createDefinitionBuilder(base)
			const events = createRecorders<DefinitionBuilderEventMap, 'merge'>(definition.emitter, [
				'merge',
			])
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
		const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []))
		const error = captureError(() => definition.merge(createLogicalDefinition('risk', 'Risk', [])))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')
	})
})

describe('DefinitionBuilder — clear', () => {
	it('deletes an optional field per reasoning, uniformly, and emits clear(key)', () => {
		const seed = createQuantitativeDefinition('risk', 'Risk', [], {
			description: 'd',
			precision: 2,
		})
		const definition = createDefinitionBuilder(seed)
		const events = createRecorders<DefinitionBuilderEventMap, 'clear'>(definition.emitter, [
			'clear',
		])

		definition.clear('precision')
		const built = definition.build()
		expect('precision' in built).toBe(false)
		expect('description' in built).toBe(true)
		expect(events.clear.calls).toEqual([['precision']])
	})

	it('a non-clearable key for the current reasoning throws MISMATCH', () => {
		const definition = createDefinitionBuilder(createLogicalDefinition('elig', 'Eligibility', []))
		const error = captureError(() => definition.clear('base'))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')
		expect(error.context).toEqual({ key: 'base', reasoning: 'logical' })
	})
})

describe('DefinitionBuilder — per-manager emitter event pins', () => {
	it('group append / prepend / replace / remove fire on the groups manager emitter', () => {
		const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []))
		const events = createRecorders<
			GroupManagerEventMap,
			'append' | 'prepend' | 'replace' | 'remove'
		>(definition.groups.emitter, ['append', 'prepend', 'replace', 'remove'])

		definition.groups.append(createFactorGroup('g1', 'sum', []))
		definition.groups.prepend(createFactorGroup('g0', 'sum', []))
		definition.groups.replace(createFactorGroup('g1', 'product', []))
		definition.groups.remove('g0')

		expect(events.append.calls).toEqual([['g1']])
		expect(events.prepend.calls).toEqual([['g0']])
		expect(events.replace.calls).toEqual([['g1']])
		expect(events.remove.calls).toEqual([['g0']])
	})

	it('factor mutations fire on the factors manager emitter with the factor id', () => {
		const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []))
		definition.groups.append(createFactorGroup('g1', 'sum', []))
		const events = createRecorders<
			FactorManagerEventMap,
			'append' | 'prepend' | 'replace' | 'remove'
		>(definition.factors.emitter, ['append', 'prepend', 'replace', 'remove'])

		definition.factors.append('g1', createStaticFactor('f1', 10))
		definition.factors.prepend('g1', createStaticFactor('f0', 5))
		definition.factors.replace('g1', createStaticFactor('f1', 20))
		definition.factors.remove('g1', 'f0')

		expect(events.append.calls).toEqual([['f1']])
		expect(events.prepend.calls).toEqual([['f0']])
		expect(events.replace.calls).toEqual([['f1']])
		expect(events.remove.calls).toEqual([['f0']])
	})

	it('variables.add emits add(name) and variables.remove emits remove(name) on the variables emitter', () => {
		const definition = createDefinitionBuilder(createSymbolicDefinition('calc', 'Calc', []))
		const events = createRecorders<VariableManagerEventMap, 'add' | 'remove'>(
			definition.variables.emitter,
			['add', 'remove'],
		)

		definition.variables.add('x', 1)
		definition.variables.remove('x')

		expect(events.add.calls).toEqual([['x']])
		expect(events.remove.calls).toEqual([['x']])
	})
})

describe('DefinitionBuilder — manager lifecycle', () => {
	it('a manager destroy emits destroy on its OWN emitter, then throws DESTROYED', () => {
		const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []))
		const events = createRecorders<GroupManagerEventMap, 'destroy'>(definition.groups.emitter, [
			'destroy',
		])

		definition.groups.destroy()
		expect(() => definition.groups.destroy()).not.toThrow()

		expect(events.destroy.calls).toEqual([[]])
		expect(definition.groups.emitter.destroyed).toBe(true)
		const error = captureError(() => definition.groups.append(createFactorGroup('g1', 'sum', [])))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('DESTROYED')
	})

	it('DESTROYED: the builder destroy cascades — every entity + manager method throws', () => {
		const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []))
		definition.groups.append(createFactorGroup('g1', 'sum', []))
		definition.destroy()

		for (const call of [
			() => definition.build(),
			() => definition.merge(createQuantitativeDefinition('risk', 'Risk', [])),
			() => definition.clear('description'),
			() => definition.groups.groups(),
			() => definition.groups.append(createFactorGroup('g2', 'sum', [])),
			() => definition.factors.factors('g1'),
			() => definition.factors.append('g1', createStaticFactor('f1', 10)),
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
		const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []))
		const events = createRecorders<DefinitionBuilderEventMap, 'destroy'>(definition.emitter, [
			'destroy',
		])

		definition.destroy()
		expect(() => definition.destroy()).not.toThrow()

		expect(events.destroy.calls).toEqual([[]])
		expect(definition.emitter.destroyed).toBe(true)
	})
})

describe('DefinitionBuilder — bring-your-own managers', () => {
	it('an injected manager is reused and visible in build(), observing its own mutations', () => {
		const groups = createGroupManager({
			groups: [createFactorGroup('g1', 'sum', [createStaticFactor('f1', 10)])],
		})
		const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []), {
			groups,
		})
		expect(definition.groups).toBe(groups)

		const built = definition.build()
		if (built.reasoning !== 'quantitative') throw new Error('expected quantitative')
		expect(built.groups.map((group) => group.id)).toEqual(['g1'])

		const events = createRecorders<GroupManagerEventMap, 'append'>(groups.emitter, ['append'])
		definition.groups.append(createFactorGroup('g2', 'sum', []))
		expect(events.append.calls).toEqual([['g2']])
		const rebuilt = definition.build()
		if (rebuilt.reasoning !== 'quantitative') throw new Error('expected quantitative')
		expect(rebuilt.groups.map((group) => group.id)).toEqual(['g1', 'g2'])
	})
})

describe('DefinitionBuilder — build determinism', () => {
	it('build() returns a fresh, deep-equal snapshot on every call', () => {
		const definition = createDefinitionBuilder(createQuantitativeDefinition('risk', 'Risk', []))
		definition.groups.append(createFactorGroup('g1', 'sum', [createStaticFactor('f1', 10)]))

		const first = definition.build()
		const second = definition.build()

		expect(second).toEqual(first)
		expect(second).not.toBe(first)
	})
})

describe('DefinitionBuilder — id defaulting and seed protection', () => {
	it('id defaults to seed.id, and an options.id overrides it', () => {
		const seed = createQuantitativeDefinition('risk', 'Risk', [])
		expect(createDefinitionBuilder(seed).id).toBe('risk')
		expect(createDefinitionBuilder(seed, { id: 'custom' }).id).toBe('custom')
		expect(createDefinitionBuilder(seed, { id: 'custom' }).build().id).toBe('custom')
	})

	it('never mutates the seed (deep-frozen) across every mutation surface', () => {
		const seed = deepFreeze(createQuantitativeDefinition('risk', 'Risk', [], { description: 'd' }))
		const snapshot: Definition = { ...seed, groups: [...seed.groups] }

		const definition = createDefinitionBuilder(seed)
		definition.groups.append(createFactorGroup('g1', 'sum', [createStaticFactor('f1', 10)]))
		definition.clear('description')
		definition.merge(
			createQuantitativeDefinition('risk', 'Risk v2', [createFactorGroup('g2', 'sum', [])]),
		)

		expect(seed).toEqual(snapshot)
	})
})

describe('DefinitionBuilder — brand soundness', () => {
	it('a plain record forging a build() field does NOT narrow as a DefinitionBuilder', () => {
		const forged: unknown = { build: () => createQuantitativeDefinition('risk', 'Risk', []) }
		expect(isDefinitionBuilder(forged)).toBe(false)
	})

	it('accepts a real entity and rejects plain built data', () => {
		const definition: DefinitionBuilderInterface = createDefinitionBuilder(
			createQuantitativeDefinition('risk', 'Risk', []),
		)
		expect(isDefinitionBuilder(definition)).toBe(true)
		expect(isDefinitionBuilder(definition.build())).toBe(false)
	})
})
