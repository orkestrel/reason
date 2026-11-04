import {
	createContract,
	isAuditFault,
	seededRandom,
	literalShape,
	numberShape,
	FAULT_KINDS,
	FAULT_CONSTRAINTS,
} from '@orkestrel/contract'
import { faultShape } from '@src/core'
import { describe, expect, it } from 'vitest'
import { sequence, sparse } from '../../setup.js'

describe('faultShape counts', () => {
	it.each([-1, 1.5, 0, 2])('matches the guard for count %s', (count) => {
		const contract = createContract(faultShape)
		for (const fault of [
			{ reason: 'variant', path: [], variants: count },
			{ reason: 'oneOf', path: [], matched: count },
		]) {
			expect(contract.is(fault)).toBe(isAuditFault(fault))
		}
	})
})

describe('faultShape parity', () => {
	it.each(['variant', 'oneOf'])('checks hinted and plain %s counts independently', (reason) => {
		const contract = createContract(faultShape)
		for (const count of [-1, 1.5, 0, 2, Infinity, Number.NaN]) {
			for (const hint of [{}, { key: 'kind', expected: ['a'] }]) {
				const fault = {
					reason,
					path: [],
					...(reason === 'variant' ? { variants: count } : { matched: count }),
					...hint,
				}
				expect(contract.is(fault)).toBe(isAuditFault(fault))
			}
		}
	})

	it.each([
		{ path: '', accepted: true },
		{ path: 'pick', accepted: true },
		{ path: [], accepted: true },
		{ path: ['pick', 'kind'], accepted: true },
		{ path: [-1], accepted: false },
		{ path: [1.5], accepted: false },
		{ path: ['pick', 0], accepted: false },
		{ path: [Number.NaN], accepted: false },
		{ path: [Symbol('key')], accepted: false },
		{ path: sparse<string>(2, [[1, 'pick']]), accepted: false },
	])('agrees on path $path', ({ path, accepted }) => {
		const fault = { reason: 'extra', path }
		expect(isAuditFault(fault)).toBe(accepted)
		expect(createContract(faultShape).is(fault)).toBe(accepted)
	})

	it('admits the dependency vocabulary for type, missing, and constraint faults', () => {
		const contract = createContract(faultShape)
		for (const expected of FAULT_KINDS) {
			for (const fault of [
				{ reason: 'type', path: [], expected, received: 'x' },
				{ reason: 'missing', path: [], expected },
				...FAULT_CONSTRAINTS.flatMap((constraint) => [
					{ reason: 'constraint', path: [], expected, constraint, received: 'x' },
					{ reason: 'constraint', path: [], expected, constraint, received: 'x', limit: 1 },
					{ reason: 'constraint', path: [], expected, constraint, received: 'x', limit: 'x' },
				]),
			]) {
				expect(isAuditFault(fault)).toBe(true)
				expect(contract.is(fault)).toBe(true)
			}
		}
	})

	it('refuses malformed fault fields in both directions', () => {
		const contract = createContract(faultShape)
		for (const fault of [
			null,
			{},
			{ reason: 'unknown', path: [] },
			{ reason: 'extra', path: [], extra: true },
			{ reason: 'type', path: [], expected: 'unknown', received: 'x' },
			{ reason: 'missing', expected: 'string' },
			{ reason: 'constraint', path: [], expected: 'number', constraint: 'unknown', received: 'x' },
			{
				reason: 'variant',
				path: [],
				variants: 2,
				key: 'kind',
				expected: sparse<string>(2, [[1, 'a']]),
			},
		]) {
			expect(isAuditFault(fault)).toBe(false)
			expect(contract.is(fault)).toBe(false)
		}
	})

	it.each([Infinity, -Infinity, Number.NaN])('keeps the JSON limit asymmetry for %s', (limit) => {
		const fault = {
			reason: 'constraint',
			path: [],
			expected: 'number',
			constraint: 'min',
			received: '0',
			limit,
		}
		expect(isAuditFault(fault)).toBe(true)
		expect(createContract(faultShape).is(fault)).toBe(false)
		expect(() => numberShape({ min: limit })).toThrow(/finite/)
	})

	it.each([Infinity, -Infinity, Number.NaN])(
		'refuses non-finite literal declarations and JSON hints for %s',
		(value) => {
			expect(() => literalShape([value])).toThrow(/non-finite/)
			for (const fault of [
				{ reason: 'variant', path: [], variants: 2, key: 'kind', expected: [value] },
				{ reason: 'oneOf', path: [], matched: 0, key: 'kind', expected: [value] },
			]) {
				expect(isAuditFault(fault)).toBe(true)
				expect(createContract(faultShape).is(fault)).toBe(false)
			}
		},
	)

	it('generates reproducible faults admitted by the guard', () => {
		const contract = createContract(faultShape)
		for (const seed of sequence(200)) {
			const fault = contract.generate(seededRandom(seed))
			expect(fault).toEqual(contract.generate(seededRandom(seed)))
			expect(contract.is(fault)).toBe(true)
			expect(isAuditFault(fault)).toBe(true)
		}
	})
})

describe('faultShape hints', () => {
	it.each([
		{ hint: {}, accepted: true },
		{ hint: { key: 'kind', expected: ['a', 1, true] }, accepted: true },
		{ hint: { key: '', expected: [] }, accepted: true },
		{ hint: { key: 'kind' }, accepted: false },
		{ hint: { expected: ['a'] }, accepted: false },
		{ hint: { key: 1, expected: ['a'] }, accepted: false },
		{ hint: { key: 'kind', expected: [null] }, accepted: false },
	])('requires a complete literal hint: $hint', ({ hint, accepted }) => {
		const contract = createContract(faultShape)
		for (const fault of [
			{ reason: 'variant', path: ['pick'], variants: 2, ...hint },
			{ reason: 'oneOf', path: ['pick'], matched: 0, ...hint },
		]) {
			expect(isAuditFault(fault)).toBe(accepted)
			expect(contract.is(fault)).toBe(accepted)
		}
	})
})
