import type { SubjectAdmission } from '@src/core'
import {
	arrayShape,
	booleanShape,
	compileSchema,
	FAULT_LIMIT,
	integerShape,
	jsonShape,
	literalShape,
	nullableShape,
	numberShape,
	objectShape,
	optionalShape,
	rawShape,
	stringShape,
	unionShape,
} from '@orkestrel/contract'
import {
	createAtom,
	createConstant,
	createEquation,
	createFact,
	createFactorGroup,
	createFieldFactor,
	createInferentialDefinition,
	createInferentialReasoner,
	createLogicalDefinition,
	createLogicalReasoner,
	createQuantitativeDefinition,
	createQuantitativeReasoner,
	createRule,
	createSubjectDoor,
	createSymbolicDefinition,
	createSymbolicReasoner,
	createVariable,
	SubjectDoor,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { invokeUnchecked } from '@orkestrel/test'
import { buildSharedNest, expectLogical } from '../../setup.js'

// The door a subject passes before a reasoner reads it: the order of its refusals, the
// lossless rule on repairs, and that each reasoner puts it first. Filling a default needs
// a `contract` that has them, so the fill itself is proved through `findFilledPaths`.

const door = new SubjectDoor()
const age = objectShape({ age: numberShape() })

describe('SubjectDoor — no shape', () => {
	it('admits the subject unchanged, by identity', () => {
		const subject = { anything: 'at all' }
		const admission = door.admit(subject)
		expect(admission.subject).toBe(subject)
		expect(admission).toMatchObject({ faults: [], repairs: [], defaulted: [], errors: [] })
	})
})

describe('SubjectDoor — refusals, in order', () => {
	it('preserves an unchecked scalar union fault before the record-shape refusal', () => {
		const admission = invokeUnchecked<SubjectAdmission>(door, door.admit, [
			'1',
			unionShape(numberShape(), booleanShape()),
		])
		expect(admission.subject).toBeUndefined()
		expect(admission.faults).toEqual([{ reason: 'variant', path: [], variants: 2 }])
		expect(admission.errors).toEqual(['Field "" matches none of its 2 variants'])
	})

	it('an absent required key refuses, naming it', () => {
		const admission = door.admit({}, age)
		expect(admission.subject).toBeUndefined()
		expect(admission.faults).toEqual([{ reason: 'missing', path: ['age'], expected: 'number' }])
		expect(admission.errors).toEqual(['Field "age" is missing'])
	})

	it('a value parse cannot answer refuses', () => {
		const admission = door.admit({ age: 'old' }, age)
		expect(admission.subject).toBeUndefined()
		expect(admission.faults).toEqual([
			{ reason: 'type', path: ['age'], expected: 'number', received: '"old"' },
		])
	})

	it('an undeclared key refuses, because parse would drop it silently', () => {
		const admission = door.admit({ age: 30, agee: 1 }, age)
		expect(admission.subject).toBeUndefined()
		expect(admission.faults).toEqual([{ reason: 'extra', path: ['agee'] }])
		expect(admission.errors).toEqual(['Field "agee" is not declared'])
	})

	it('a typo reports the key it left missing and the key it brought', () => {
		const admission = door.admit({ agee: 30 }, age)
		expect(admission.faults).toEqual([
			{ reason: 'missing', path: ['age'], expected: 'number' },
			{ reason: 'extra', path: ['agee'] },
		])
	})

	it('an object declared open admits extras', () => {
		const open = objectShape({ age: numberShape() }, { additionalProperties: true })
		expect(door.admit({ age: 30, other: 1 }, open).subject).toEqual({ age: 30, other: 1 })
	})

	it('an audit at the fault limit refuses, because the next fault is hidden', () => {
		const properties = Object.fromEntries(
			Array.from({ length: FAULT_LIMIT + 1 }, (_, index) => [`n${String(index)}`, numberShape()]),
		)
		const subject = Object.fromEntries(
			Array.from({ length: FAULT_LIMIT + 1 }, (_, index) => [`n${String(index)}`, '1']),
		)
		const admission = door.admit(subject, objectShape(properties))
		expect(admission.subject).toBeUndefined()
		expect(admission.errors.at(-1)).toBe(`Subject has ${String(FAULT_LIMIT)} faults or more`)
	})

	it('a union that would repair by declaration order refuses', () => {
		const union = objectShape({ x: unionShape(numberShape(), booleanShape()) })
		const admission = door.admit({ x: '1' }, union)
		expect(admission.subject).toBeUndefined()
		expect(admission.faults.map((fault) => fault.reason)).toContain('variant')
	})
})

describe('SubjectDoor — the lossless rule on repairs', () => {
	it.each(['30', ' 30 '])('a number from %j is a repair', (value) => {
		const admission = door.admit({ age: value }, age)
		expect(admission.subject).toEqual({ age: 30 })
		expect(admission.repairs).toEqual([
			{ reason: 'type', path: ['age'], expected: 'number', received: JSON.stringify(value) },
		])
		expect(admission.errors).toEqual([])
	})

	it.each(['30.0', '1.500', '007', '0x10', '1e3', '+5', '.5', '-0', '9007199254740993'])(
		'a number from %j refuses, because its text says more than the number',
		(value) => {
			const admission = door.admit({ age: value }, age)
			expect(admission.subject).toBeUndefined()
			expect(admission.faults.map((fault) => fault.reason)).toEqual(['type'])
		},
	)

	it('an integer field reads the same rule', () => {
		const shape = objectShape({ n: integerShape() })
		expect(door.admit({ n: '5' }, shape).subject).toEqual({ n: 5 })
		expect(door.admit({ n: '5.0' }, shape).subject).toBeUndefined()
	})

	const flag = objectShape({ flag: booleanShape() })

	it.each([
		['true', true],
		['false', false],
	])('a boolean from %j is a repair', (value, parsed) => {
		expect(door.admit({ flag: value }, flag).subject).toEqual({ flag: parsed })
	})

	it.each(['1', '0', 1, 0])('a boolean from %j refuses', (value) => {
		expect(door.admit({ flag: value }, flag).subject).toBeUndefined()
	})

	it('a literal from its trimmed text is a repair', () => {
		const shape = objectShape({ state: literalShape(['CA', 'NY']) })
		const admission = door.admit({ state: ' CA ' }, shape)
		expect(admission.subject).toEqual({ state: 'CA' })
		expect(admission.repairs.map((fault) => fault.path)).toEqual([['state']])
	})

	it('a string from a finite number is a repair', () => {
		const shape = objectShape({ zip: stringShape() })
		expect(door.admit({ zip: 94105 }, shape).subject).toEqual({ zip: '94105' })
	})

	it('a canonical value is no repair', () => {
		expect(door.admit({ age: 30 }, age)).toMatchObject({ subject: { age: 30 }, repairs: [] })
	})
})

describe('SubjectDoor — a union whose literal names its arm', () => {
	const pay = unionShape(
		objectShape({ kind: literalShape(['card']), last: numberShape() }),
		objectShape({ kind: literalShape(['cash']), amount: numberShape() }),
	)
	const shape = objectShape({ pay })

	it('a lossless repair in the named arm is a repair, at its real path', () => {
		const admission = door.admit({ pay: { kind: 'cash', amount: '30' } }, shape)
		expect(admission.subject).toEqual({ pay: { kind: 'cash', amount: 30 } })
		expect(admission.repairs).toEqual([
			{ reason: 'type', path: ['pay', 'amount'], expected: 'number', received: '"30"' },
		])
		expect(admission.errors).toEqual([])
	})

	it.each(['30.0', '1e3', '0x10', '007'])(
		'a repair from %j in the named arm refuses, because its text says more than the number',
		(amount) => {
			const admission = door.admit({ pay: { kind: 'cash', amount } }, shape)
			expect(admission.subject).toBeUndefined()
			expect(admission.faults.map((fault) => fault.path)).toEqual([['pay', 'amount']])
		},
	)

	it('a field the named arm needs refuses at its real path, and asks for nothing else', () => {
		const admission = door.admit({ pay: { kind: 'cash' } }, shape)
		expect(admission.subject).toBeUndefined()
		expect(admission.faults).toEqual([
			{ reason: 'missing', path: ['pay', 'amount'], expected: 'number' },
		])
	})

	it('a key the named arm does not declare refuses, though the other arm declares it', () => {
		const admission = door.admit({ pay: { kind: 'cash', amount: 30, last: 4 } }, shape)
		expect(admission.subject).toBeUndefined()
		expect(admission.faults).toEqual([{ reason: 'extra', path: ['pay', 'last'] }])
	})

	it.each([
		['no arm holds it', { kind: 'cheque', amount: 30 }],
		['it is padded', { kind: ' cash ', amount: 30 }],
		['it is absent', { amount: 30 }],
	])('a value names no arm when %s, and refuses as a variant', (_reason, value) => {
		const admission = door.admit({ pay: value }, shape)
		expect(admission.subject).toBeUndefined()
		expect(admission.faults.map((fault) => fault.reason)).toContain('variant')
	})

	it('a one-of union whose literal names its arm reads the same rule', () => {
		const single = objectShape({ pay: { ...pay, mode: 'oneOf' } })
		const repaired = door.admit({ pay: { kind: 'cash', amount: '30' } }, single)
		expect(repaired.subject).toEqual({ pay: { kind: 'cash', amount: 30 } })
		const lossy = door.admit({ pay: { kind: 'cash', amount: '30.0' } }, single)
		expect(lossy.subject).toBeUndefined()
	})
})

describe('SubjectDoor — defaults', () => {
	const shape = objectShape({
		age: numberShape(),
		licensed: optionalShape(booleanShape(), { default: false }),
		address: optionalShape(
			objectShape({ city: optionalShape(stringShape(), { default: 'none' }) }),
		),
	})

	it('fills an absent key and an undefined one, and says so', () => {
		for (const subject of [{ age: 30 }, { age: 30, licensed: undefined }]) {
			const admission = door.admit(subject, shape)
			expect(admission.subject).toEqual({ age: 30, licensed: false })
			expect(admission.defaulted).toEqual([['licensed']])
			expect(admission.repairs).toEqual([])
		}
	})

	it('a stated value is not a fill, whatever it is', () => {
		const admission = door.admit({ age: 30, licensed: false }, shape)
		expect(admission.subject).toEqual({ age: 30, licensed: false })
		expect(admission.defaulted).toEqual([])
	})

	it('reports a nested fill by its path', () => {
		const admission = door.admit({ age: 30, address: {} }, shape)
		expect(admission.subject).toEqual({ age: 30, licensed: false, address: { city: 'none' } })
		expect(admission.defaulted).toEqual([['licensed'], ['address', 'city']])
	})

	it('a typo beside a default refuses, instead of filling the default as an answer', () => {
		const admission = door.admit({ age: 30, licenced: true }, shape)
		expect(admission.subject).toBeUndefined()
		expect(admission.faults).toEqual([{ reason: 'extra', path: ['licenced'] }])
	})

	it('a default reaches the rule, which then settles', () => {
		const rule = createRule(
			'r',
			[createAtom('licensed', 'equals', false)],
			createAtom('ok', 'equals', true),
		)
		const definition = createLogicalDefinition('d', 'd', [rule], { shape })
		const result = expectLogical(createLogicalReasoner().reason({ age: 30 }, definition))
		expect(result.conclusion).toBe('met')
		expect(result.defaulted).toEqual([['licensed']])
	})

	it('reaches the schema', () => {
		const schema = compileSchema(shape)
		expect(schema.properties?.licensed?.default).toBe(false)
	})
})

describe('SubjectDoor — null', () => {
	it('is a fault unless the field admits it', () => {
		expect(door.admit({ age: null }, age).subject).toBeUndefined()
		const nullable = objectShape({ age: nullableShape(numberShape()) })
		expect(door.admit({ age: null }, nullable).subject).toEqual({ age: null })
	})

	it('an absent nullable is missing, since null is a value and absence is not', () => {
		const nullable = objectShape({ age: nullableShape(numberShape()) })
		expect(door.admit({}, nullable).faults.map((fault) => fault.reason)).toEqual(['missing'])
	})
})

describe('SubjectDoor — optional and untyped fields', () => {
	it('an absent optional passes, and stays absent with no default', () => {
		const shape = objectShape({ age: optionalShape(numberShape()) })
		const admission = door.admit({}, shape)
		expect(admission.subject).toEqual({})
		expect(admission.defaulted).toEqual([])
	})

	it('an optional key holding undefined is absent, so nothing was repaired or filled', () => {
		const shape = objectShape({ age: optionalShape(numberShape()) })
		const admission = door.admit({ age: undefined }, shape)
		expect(admission.subject).toEqual({})
		expect(admission.repairs).toEqual([])
		expect(admission.defaulted).toEqual([])
	})

	it('an undeclared key holding undefined still refuses, because it faults on presence', () => {
		const shape = objectShape({ age: optionalShape(numberShape()) })
		expect(door.admit({ agee: undefined }, shape).subject).toBeUndefined()
	})

	it('a raw or json field passes unchanged, so the typed read is the backstop', () => {
		expect(door.admit({ r: '700' }, objectShape({ r: rawShape({}) })).subject).toEqual({ r: '700' })
		expect(door.admit({ r: '700' }, objectShape({ r: jsonShape() })).subject).toEqual({ r: '700' })
	})

	it('reads nested paths through objects and arrays', () => {
		const shape = objectShape({ items: arrayShape(objectShape({ n: numberShape() })) })
		const admission = door.admit({ items: [{ n: '5' }] }, shape)
		expect(admission.subject).toEqual({ items: [{ n: 5 }] })
		expect(admission.repairs.map((fault) => fault.path)).toEqual([['items', '0', 'n']])
	})
})

describe('SubjectDoor — total', () => {
	it('a malformed shape refuses, never throws', () => {
		const admission = invokeUnchecked<ReturnType<typeof door.admit>>(door, door.admit, [
			{},
			{ category: 'nope' },
		])
		expect(admission.subject).toBeUndefined()
		expect(admission.errors).toHaveLength(1)
		expect(admission.errors[0]).toMatch(/^Subject refused: /)
	})

	it('a subject sharing its sub-objects does not unfold', () => {
		const shape = objectShape({ blob: jsonShape() })
		const blob = buildSharedNest(14)
		expect(door.admit({ blob }, shape).defaulted).toEqual([])
	})

	it('one contract serves many subjects, by shape identity', () => {
		const own = createSubjectDoor()
		expect(own.admit({ age: 1 }, age).subject).toEqual({ age: 1 })
		expect(own.admit({ age: 2 }, age).subject).toEqual({ age: 2 })
	})
})

describe('the door comes first in every reasoner', () => {
	const refused = ['Field "x" is missing']
	const shape = objectShape({ x: numberShape() })

	it('logical', () => {
		const rule = createRule('r', [createAtom('x', 'above', 1)], createAtom('ok', 'equals', true))
		const definition = createLogicalDefinition('d', 'd', [rule], { shape })
		const reasoner = createLogicalReasoner()
		const result = expectLogical(reasoner.reason({}, definition))
		expect(result.conclusion).toBe('unread')
		expect(result.errors).toEqual(refused)
		expect(result.faults).toEqual([{ reason: 'missing', path: ['x'], expected: 'number' }])
		const admitted = expectLogical(reasoner.reason({ x: '5' }, definition))
		expect(admitted.conclusion).toBe('met')
		expect(admitted.repairs.map((fault) => fault.path)).toEqual([['x']])
	})

	it('quantitative', () => {
		const definition = createQuantitativeDefinition(
			'd',
			'd',
			[createFactorGroup('g', 'sum', [createFieldFactor('f', 'x')])],
			{ shape },
		)
		const reasoner = createQuantitativeReasoner()
		expect(reasoner.reason({}, definition).errors).toEqual(refused)
		const admitted = reasoner.reason({ x: '5' }, definition)
		expect(admitted.success).toBe(true)
		expect(admitted.repairs.map((fault) => fault.path)).toEqual([['x']])
	})

	it('symbolic', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[createEquation('e', createVariable('y'), createVariable('x'), 'y')],
			{ shape },
		)
		const reasoner = createSymbolicReasoner()
		expect(reasoner.reason({}, definition).errors).toEqual(refused)
		expect(reasoner.reason({ x: '5' }, definition).success).toBe(true)
	})

	it('inferential', () => {
		const definition = createInferentialDefinition('d', 'd', [createFact('f', 'p', ['a'])], [], {
			shape,
		})
		const reasoner = createInferentialReasoner()
		expect(reasoner.reason({}, definition).errors).toEqual(refused)
		expect(reasoner.reason({ x: 5 }, definition).success).toBe(true)
	})

	it('a symbolic equation with no field still carries the door', () => {
		const definition = createSymbolicDefinition(
			'd',
			'd',
			[createEquation('e', createVariable('y'), createConstant(1), 'y')],
			{ shape },
		)
		expect(createSymbolicReasoner().reason({}, definition).success).toBe(false)
	})
})
