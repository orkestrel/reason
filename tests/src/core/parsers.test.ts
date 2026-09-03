import {
	createAtom,
	createFact,
	createFactorGroup,
	createInference,
	createInferentialDefinition,
	createLogicalDefinition,
	createQuantitativeDefinition,
	createRule,
	createStaticFactor,
	parseDefinition,
} from '@src/core'
import { describe, expect, it } from 'vitest'

// `parseDefinition` — the JSON boundary of the definition family. It is
// `parseJSONAs` composed with the exact-record `isDefinition` guard, so it must
// restore what `JSON.stringify` wrote for every reasoning, and fail SAFE to
// `undefined` on malformed text, on a well-formed object that is not a
// definition, and on a definition carrying an extra key the exact records
// refuse. It never throws.

describe('parseDefinition — the definition JSON round trip', () => {
	it('restores a stringified definition of each reasoning, byte-for-byte equal', () => {
		const definitions = [
			createQuantitativeDefinition('risk', 'Risk', [
				createFactorGroup('drivers', 'sum', [createStaticFactor('floor', 10)]),
			]),
			createLogicalDefinition('elig', 'Eligibility', [
				createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
			]),
			createInferentialDefinition(
				'mortality',
				'Mortality',
				[createFact('f1', 'human', ['socrates'])],
				[
					createInference(
						'mortal',
						[createFact('p1', 'human', ['?x'])],
						createFact('c1', 'mortal', ['?x']),
					),
				],
			),
		]

		for (const definition of definitions) {
			expect(parseDefinition(JSON.stringify(definition))).toEqual(definition)
		}
	})

	it('is deterministic — the same text parses to the same value twice', () => {
		const text = JSON.stringify(createLogicalDefinition('e', 'E', []))
		expect(parseDefinition(text)).toEqual(parseDefinition(text))
	})

	it('fails safe on an empty object, which is well-formed JSON but no definition', () => {
		expect(parseDefinition('{}')).toBeUndefined()
	})

	it('fails safe on malformed JSON text rather than throwing', () => {
		for (const text of ['', '{', 'not json', '[1,', '{"reasoning":', 'undefined']) {
			expect(parseDefinition(text)).toBeUndefined()
		}
	})

	it('fails safe on well-formed JSON of the wrong shape', () => {
		for (const text of ['null', '42', '"a string"', 'true', '[]', '[{"reasoning":"logical"}]']) {
			expect(parseDefinition(text)).toBeUndefined()
		}
	})

	it('refuses a definition carrying an extra key — the records are EXACT', () => {
		const definition = createLogicalDefinition('e', 'E', [])
		const extended = { ...definition, note: 'not part of the contract' }
		expect(parseDefinition(JSON.stringify(definition))).toEqual(definition)
		expect(parseDefinition(JSON.stringify(extended))).toBeUndefined()
	})

	it('refuses an extra key nested inside a collection element', () => {
		const definition = createLogicalDefinition('e', 'E', [
			createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
		])
		const poisoned = {
			...definition,
			rules: definition.rules.map((rule) => ({ ...rule, note: 'extra' })),
		}
		expect(parseDefinition(JSON.stringify(poisoned))).toBeUndefined()
	})

	it('refuses a definition whose reasoning names no known strategy', () => {
		const definition = createLogicalDefinition('e', 'E', [])
		const renamed = { ...definition, reasoning: 'telepathic' }
		expect(parseDefinition(JSON.stringify(renamed))).toBeUndefined()
	})

	it('refuses a prototype-poisoning payload without throwing', () => {
		expect(parseDefinition('{"__proto__": {"polluted": true}}')).toBeUndefined()
		expect(Reflect.get(Object.prototype, 'polluted')).toBeUndefined()
	})
})
