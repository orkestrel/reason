import type { CheckResult, Subject } from '@src/core'
import { check, createEvaluator, Evaluator } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	BASIC_SUBJECT,
	DRIVER_SUBJECT,
	EXTREME_NUMBERS,
	invokeRaw,
	NESTED_SUBJECT,
	repeatValue,
	sequence,
	sparse,
	TRICKY_KEYS,
} from '../../../setup.js'

// `Evaluator` behavior — the shared predicate engine: strict `===` / `!==` for
// equals / not (no coercion, reference equality for objects), number-demanding
// ordering operators (above / below / from / to), array-membership any / none
// (BOTH false on a non-array expected value — none is NOT the raw complement),
// inclusive between and its pure negation outside, `resolveField` semantics (a
// STRING field is ONE key — never dot-split; an ARRAY descends), the caught
// unknown-operator error, and order-preserving isolated `batch`. Ports the full
// scsr Evaluator catalog onto the renamed comparison vocabulary (DESIGN §2).
// No mocks — the real stateless instance throughout (AGENTS §16).

const evaluator = createEvaluator()

// The recurring shared checks (scsr's ageGte18 / scoreGt50 / nameEqualsAlice).
const ageFrom18 = check('age', 'from', 18)
const scoreAbove50 = check('score', 'above', 50)
const nameEqualsAlice = check('name', 'equals', 'Alice')

describe('Evaluator — identity', () => {
	it('defaults its id to "evaluator"', () => {
		expect(evaluator.id).toBe('evaluator')
		expect(new Evaluator().id).toBe('evaluator')
	})

	it('takes a custom id through the options object', () => {
		expect(new Evaluator({ id: 'custom-eval' }).id).toBe('custom-eval')
	})
})

describe('Evaluator — equals', () => {
	it('matches a string and echoes the actual', () => {
		const result = evaluator.evaluate(check('name', 'equals', 'Alice'), BASIC_SUBJECT)
		expect(result.met).toBe(true)
		expect(result.actual).toBe('Alice')
	})

	it('fails on a differing value', () => {
		expect(evaluator.evaluate(check('name', 'equals', 'Bob'), BASIC_SUBJECT).met).toBe(false)
	})

	it('is strict — the number 30 never equals the string "30"', () => {
		expect(evaluator.evaluate(check('age', 'equals', '30'), BASIC_SUBJECT).met).toBe(false)
	})

	it('matches booleans', () => {
		expect(evaluator.evaluate(check('employed', 'equals', true), BASIC_SUBJECT).met).toBe(true)
	})

	it('null equals null', () => {
		expect(evaluator.evaluate(check('a', 'equals', null), { a: null }).met).toBe(true)
	})

	it('an undefined field does not equal null, but does equal undefined', () => {
		expect(evaluator.evaluate(check('missing', 'equals', null), {}).met).toBe(false)
		const result = evaluator.evaluate(check('missing', 'equals', undefined), {})
		expect(result.met).toBe(true)
		expect(result.actual).toBeUndefined()
	})

	it('never coerces falsy cross-type pairs (0 / "" vs false)', () => {
		expect(evaluator.evaluate(check('a', 'equals', false), { a: 0 }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'equals', false), { a: '' }).met).toBe(false)
	})

	it('compares arrays by reference — equal contents, different references fail', () => {
		expect(evaluator.evaluate(check('a', 'equals', [1, 2]), { a: [1, 2] }).met).toBe(false)
	})
})

describe('Evaluator — not', () => {
	it('holds on a differing value, fails on a match', () => {
		expect(evaluator.evaluate(check('name', 'not', 'Bob'), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('name', 'not', 'Alice'), BASIC_SUBJECT).met).toBe(false)
	})

	it('an undefined field is not "test"', () => {
		expect(evaluator.evaluate(check('missing', 'not', 'test'), {}).met).toBe(true)
	})

	it('NaN not NaN holds (raw IEEE !==, no Object.is special-casing)', () => {
		expect(evaluator.evaluate(check('a', 'not', Number.NaN), { a: Number.NaN }).met).toBe(true)
	})

	it('undefined not undefined fails', () => {
		expect(evaluator.evaluate(check('missing', 'not', undefined), {}).met).toBe(false)
	})
})

describe('Evaluator — above', () => {
	it('holds strictly above, fails at and below the threshold', () => {
		expect(evaluator.evaluate(check('age', 'above', 25), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('age', 'above', 30), BASIC_SUBJECT).met).toBe(false)
		expect(evaluator.evaluate(check('age', 'above', 35), BASIC_SUBJECT).met).toBe(false)
	})

	it('demands numbers on both sides', () => {
		expect(evaluator.evaluate(check('name', 'above', 25), BASIC_SUBJECT).met).toBe(false)
		expect(evaluator.evaluate(check('age', 'above', 'ten'), BASIC_SUBJECT).met).toBe(false)
	})

	it('handles infinities and NaN', () => {
		expect(
			evaluator.evaluate(check('a', 'above', 999999999), { a: Number.POSITIVE_INFINITY }).met,
		).toBe(true)
		expect(evaluator.evaluate(check('a', 'above', 0), { a: Number.NEGATIVE_INFINITY }).met).toBe(
			false,
		)
		expect(evaluator.evaluate(check('a', 'above', Number.NaN), { a: Number.NaN }).met).toBe(false)
	})
})

describe('Evaluator — below', () => {
	it('holds strictly below, fails at the threshold', () => {
		expect(evaluator.evaluate(check('age', 'below', 40), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('age', 'below', 30), BASIC_SUBJECT).met).toBe(false)
	})

	it('demands a numeric actual', () => {
		expect(evaluator.evaluate(check('name', 'below', 40), BASIC_SUBJECT).met).toBe(false)
	})

	it('handles infinities and NaN', () => {
		expect(evaluator.evaluate(check('a', 'below', 0), { a: Number.NEGATIVE_INFINITY }).met).toBe(
			true,
		)
		expect(evaluator.evaluate(check('a', 'below', 0), { a: Number.NaN }).met).toBe(false)
	})
})

describe('Evaluator — from / to', () => {
	it('from holds at and above the threshold, fails below', () => {
		expect(evaluator.evaluate(check('age', 'from', 30), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('age', 'from', 25), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('age', 'from', 35), BASIC_SUBJECT).met).toBe(false)
	})

	it('to holds at and below the threshold, fails above', () => {
		expect(evaluator.evaluate(check('age', 'to', 30), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('age', 'to', 35), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('age', 'to', 25), BASIC_SUBJECT).met).toBe(false)
	})

	it('from / to demand numbers on BOTH sides', () => {
		expect(evaluator.evaluate(check('name', 'from', 25), BASIC_SUBJECT).met).toBe(false)
		expect(evaluator.evaluate(check('age', 'from', '18'), BASIC_SUBJECT).met).toBe(false)
		expect(evaluator.evaluate(check('name', 'to', 25), BASIC_SUBJECT).met).toBe(false)
		expect(evaluator.evaluate(check('age', 'to', '35'), BASIC_SUBJECT).met).toBe(false)
	})
})

describe('Evaluator — any (array membership)', () => {
	it('holds for a member, fails for a non-member', () => {
		expect(evaluator.evaluate(check('state', 'any', ['CA', 'NY']), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('state', 'any', ['TX', 'FL']), BASIC_SUBJECT).met).toBe(false)
	})

	it('fails on a non-array expected value and on an empty array', () => {
		expect(evaluator.evaluate(check('state', 'any', 'CA'), BASIC_SUBJECT).met).toBe(false)
		expect(evaluator.evaluate(check('state', 'any', []), BASIC_SUBJECT).met).toBe(false)
	})

	it('an undefined field is a member of an array containing undefined', () => {
		expect(evaluator.evaluate(check('missing', 'any', [undefined]), {}).met).toBe(true)
	})

	it('matches number membership', () => {
		expect(evaluator.evaluate(check('age', 'any', [25, 30, 35]), BASIC_SUBJECT).met).toBe(true)
	})

	it('works through an array field path', () => {
		expect(
			evaluator.evaluate(check(['scores', 'math'], 'any', [90, 100]), NESTED_SUBJECT).met,
		).toBe(true)
	})
})

describe('Evaluator — none (array non-membership)', () => {
	it('holds for a non-member, fails for a member', () => {
		expect(evaluator.evaluate(check('state', 'none', ['TX', 'FL']), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('state', 'none', ['CA', 'NY']), BASIC_SUBJECT).met).toBe(false)
	})

	it('fails on a non-array expected value (NOT the raw complement of any)', () => {
		// Both any and none demand an array — malformed input satisfies neither.
		expect(evaluator.evaluate(check('state', 'none', 'CA'), BASIC_SUBJECT).met).toBe(false)
	})

	it('an undefined field is none of an empty array', () => {
		expect(evaluator.evaluate(check('missing', 'none', []), {}).met).toBe(true)
	})

	it('membership is strict-typed — 1 is none of ["1", true, null]', () => {
		expect(evaluator.evaluate(check('a', 'none', ['1', true, null]), { a: 1 }).met).toBe(true)
	})

	it('any / none use SameValueZero membership — NaN and -0 diverge from equals', () => {
		// Array.includes finds NaN where === (equals) cannot.
		expect(evaluator.evaluate(check('a', 'any', [Number.NaN]), { a: Number.NaN }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'equals', Number.NaN), { a: Number.NaN }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'none', [Number.NaN]), { a: Number.NaN }).met).toBe(false)
		// And -0 is a member of [0].
		expect(evaluator.evaluate(check('a', 'any', [0]), { a: -0 }).met).toBe(true)
	})
})

describe('Evaluator — between (inclusive)', () => {
	it('holds within and at both bounds, fails outside', () => {
		expect(evaluator.evaluate(check('age', 'between', [20, 40]), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('age', 'between', [30, 40]), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('age', 'between', [20, 30]), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('age', 'between', [35, 40]), BASIC_SUBJECT).met).toBe(false)
	})

	it('fails on a non-numeric actual and malformed ranges', () => {
		expect(evaluator.evaluate(check('name', 'between', [20, 40]), BASIC_SUBJECT).met).toBe(false)
		expect(evaluator.evaluate(check('age', 'between', 'invalid'), BASIC_SUBJECT).met).toBe(false)
		expect(evaluator.evaluate(check('age', 'between', [30]), BASIC_SUBJECT).met).toBe(false)
		expect(evaluator.evaluate(check('age', 'between', ['a', 'b']), BASIC_SUBJECT).met).toBe(false)
	})

	it('handles negative, point, and huge ranges', () => {
		expect(evaluator.evaluate(check('a', 'between', [-10, -1]), { a: -5 }).met).toBe(true)
		expect(evaluator.evaluate(check('age', 'between', [30, 30]), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('age', 'between', [-1e15, 1e15]), BASIC_SUBJECT).met).toBe(true)
	})

	it('reads only the first two elements of a longer array', () => {
		expect(evaluator.evaluate(check('age', 'between', [20, 40, 100]), BASIC_SUBJECT).met).toBe(true)
	})
})

describe('Evaluator — outside (pure negation of between)', () => {
	it('holds outside, fails inside and at a boundary', () => {
		expect(evaluator.evaluate(check('age', 'outside', [40, 50]), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('age', 'outside', [20, 40]), BASIC_SUBJECT).met).toBe(false)
		// between is inclusive, so its boundary is NOT outside.
		expect(evaluator.evaluate(check('age', 'outside', [30, 40]), BASIC_SUBJECT).met).toBe(false)
	})

	it('holds on a non-numeric actual and on NaN (negating a malformed between)', () => {
		expect(evaluator.evaluate(check('name', 'outside', [20, 40]), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'outside', [20, 40]), { a: Number.NaN }).met).toBe(true)
	})
})

describe('Evaluator — missing fields & field paths', () => {
	it('a missing field yields an undefined actual, met false, and echoes the field', () => {
		const result = evaluator.evaluate(check('missing', 'equals', 'x'), BASIC_SUBJECT)
		expect(result.met).toBe(false)
		expect(result.actual).toBeUndefined()
		expect(result.field).toBe('missing')
	})

	it('an ARRAY field path descends into nested objects', () => {
		const result = evaluator.evaluate(check(['address', 'city'], 'equals', 'NY'), NESTED_SUBJECT)
		expect(result.met).toBe(true)
		expect(result.actual).toBe('NY')
	})

	it('a missing nested path resolves to undefined', () => {
		const result = evaluator.evaluate(check(['address', 'state'], 'equals', 'NY'), NESTED_SUBJECT)
		expect(result.met).toBe(false)
		expect(result.actual).toBeUndefined()
	})

	it('descends three levels deep', () => {
		expect(
			evaluator.evaluate(check(['a', 'b', 'c'], 'equals', 7), { a: { b: { c: 7 } } }).met,
		).toBe(true)
	})

	it('a dotted STRING is ONE key, never a path', () => {
		// The flat 'a.b' key resolves; the nested { a: { b } } shape does NOT.
		expect(evaluator.evaluate(check('a.b', 'equals', 1), { 'a.b': 1 }).met).toBe(true)
		expect(evaluator.evaluate(check('a.b', 'equals', 1), { a: { b: 1 } }).met).toBe(false)
	})

	it('an empty-string field name resolves the "" key', () => {
		expect(evaluator.evaluate(check('', 'equals', 'blank'), { '': 'blank' }).met).toBe(true)
	})

	it('an EMPTY-array field path resolves the WHOLE subject (reference identity)', () => {
		const subject = { a: 1 }
		const result = evaluator.evaluate(check([], 'equals', subject), subject)
		expect(result.met).toBe(true)
		expect(result.actual).toBe(subject)
	})

	it('descends through an array by string index', () => {
		const subject = { items: [{ price: 5 }, { price: 9 }] }
		expect(evaluator.evaluate(check(['items', '1', 'price'], 'equals', 9), subject).met).toBe(true)
	})

	it('a path hitting null mid-way resolves undefined (total, no crash)', () => {
		const result = evaluator.evaluate(check(['a', 'b'], 'equals', undefined), { a: null })
		expect(result.actual).toBeUndefined()
		expect(result.met).toBe(true)
	})
})

describe('Evaluator — error handling', () => {
	it('a SUCCESSFUL CheckResult omits the error key entirely', () => {
		const result = evaluator.evaluate(ageFrom18, BASIC_SUBJECT)
		expect(Object.keys(result)).toEqual(['field', 'met', 'actual'])
	})

	it('an unknown operator is caught: met false, error names the operator', () => {
		const result = invokeRaw<CheckResult>(evaluator, evaluator.evaluate, [
			{ field: 'age', operator: 'invalid', value: 1 },
			BASIC_SUBJECT,
		])
		expect(result.met).toBe(false)
		expect(result.error).toContain('Unknown comparison operator')
		expect(result.error).toContain('invalid')
	})
})

describe('Evaluator — batch', () => {
	it('evaluates each check, preserving length and per-item met', () => {
		const results = evaluator.batch([ageFrom18, check('score', 'above', 90)], BASIC_SUBJECT)
		expect(results).toHaveLength(2)
		expect(results[0]?.met).toBe(true)
		expect(results[1]?.met).toBe(false)
	})

	it('returns [] for an empty check list', () => {
		expect(evaluator.batch([], BASIC_SUBJECT)).toEqual([])
	})

	it('undefined equals undefined is met against an empty subject', () => {
		expect(evaluator.batch([check('missing', 'equals', undefined)], {})[0]?.met).toBe(true)
	})

	it('a 100-check batch over age 30 meets exactly 30 (above 0..99)', () => {
		const checks = Array.from({ length: 100 }, (_, index) => check('age', 'above', index))
		const results = evaluator.batch(checks, BASIC_SUBJECT)
		expect(results.filter((result) => result.met)).toHaveLength(30)
	})

	it('preserves order — results[i].field matches checks[i].field', () => {
		const checks = [check('age', 'from', 18), check('name', 'equals', 'Alice'), scoreAbove50]
		const results = evaluator.batch(checks, BASIC_SUBJECT)
		expect(results.map((result) => result.field)).toEqual(['age', 'name', 'score'])
	})

	it('isolates an invalid-operator item — siblings are unaffected', () => {
		const results = invokeRaw<readonly CheckResult[]>(evaluator, evaluator.batch, [
			[check('age', 'above', 0), { field: 'age', operator: 'bogus', value: 1 }, nameEqualsAlice],
			BASIC_SUBJECT,
		])
		expect(results[0]?.met).toBe(true)
		expect(results[1]?.met).toBe(false)
		expect(results[1]?.error).toContain('Unknown comparison operator')
		expect(results[2]?.met).toBe(true)
	})
})

describe('Evaluator — edge cases', () => {
	it('NaN never satisfies equals / above / below (but not NaN holds)', () => {
		expect(evaluator.evaluate(check('a', 'equals', Number.NaN), { a: Number.NaN }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'above', 0), { a: Number.NaN }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'below', 0), { a: Number.NaN }).met).toBe(false)
	})

	it('-0 equals 0 (raw ===)', () => {
		expect(evaluator.evaluate(check('a', 'equals', 0), { a: -0 }).met).toBe(true)
	})

	it('compares objects by reference — the SAME reference is equal', () => {
		const shared = { nested: true }
		expect(evaluator.evaluate(check('a', 'equals', shared), { a: shared }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'equals', { nested: true }), { a: shared }).met).toBe(
			false,
		)
	})
})

describe('Evaluator — shared checks against shared subjects', () => {
	it('all three shared checks are met against the basic subject', () => {
		expect(evaluator.evaluate(ageFrom18, BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(scoreAbove50, BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(nameEqualsAlice, BASIC_SUBJECT).met).toBe(true)
	})

	it('each fails against its failing subject', () => {
		expect(evaluator.evaluate(ageFrom18, { age: 16 }).met).toBe(false)
		expect(evaluator.evaluate(scoreAbove50, { score: 30 }).met).toBe(false)
		expect(evaluator.evaluate(nameEqualsAlice, { name: 'Bob' }).met).toBe(false)
	})

	it('all fail against an empty subject', () => {
		for (const shared of [ageFrom18, scoreAbove50, nameEqualsAlice]) {
			expect(evaluator.evaluate(shared, {}).met).toBe(false)
		}
	})

	it('a batch of all three is fully met against the basic subject', () => {
		const results = evaluator.batch([ageFrom18, scoreAbove50, nameEqualsAlice], BASIC_SUBJECT)
		expect(results.every((result) => result.met)).toBe(true)
	})

	it('nested paths resolve against the nested subject', () => {
		expect(evaluator.evaluate(check(['address', 'city'], 'equals', 'NY'), NESTED_SUBJECT).met).toBe(
			true,
		)
		expect(evaluator.evaluate(check(['scores', 'math'], 'from', 90), NESTED_SUBJECT).met).toBe(true)
		expect(
			evaluator.evaluate(check(['address', 'state'], 'equals', 'NY'), NESTED_SUBJECT).met,
		).toBe(false)
	})

	it('the driver subject satisfies its scoring checks', () => {
		expect(evaluator.evaluate(check('driverAge', 'below', 25), DRIVER_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('violationCount', 'equals', 0), DRIVER_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('vehicleYear', 'from', 2015), DRIVER_SUBJECT).met).toBe(true)
	})
})

describe('Evaluator — numeric threshold precision', () => {
	it('above / from resolve exactly at the MAX_SAFE_INTEGER boundary', () => {
		const max = Number.MAX_SAFE_INTEGER
		// Equal is not strictly above; the next representable integer IS above.
		expect(evaluator.evaluate(check('a', 'above', max), { a: max }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'above', max), { a: max + 1 }).met).toBe(true)
		// from is inclusive at the boundary.
		expect(evaluator.evaluate(check('a', 'from', max), { a: max }).met).toBe(true)
	})

	it('below / above resolve at MIN_VALUE (the smallest positive denormal)', () => {
		const min = Number.MIN_VALUE
		// 0 is below the smallest positive; the value itself is not below itself.
		expect(evaluator.evaluate(check('a', 'below', min), { a: 0 }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'below', min), { a: min }).met).toBe(false)
		// MIN_VALUE is strictly above 0 despite being vanishingly small.
		expect(evaluator.evaluate(check('a', 'above', 0), { a: min }).met).toBe(true)
	})

	it('EPSILON: 0.1 + 0.2 diverges from 0.3 under equals but stays within EPSILON', () => {
		const subject = { a: 0.1 + 0.2 }
		// The float sum is not exactly 0.3 — equals (raw ===) fails, above holds.
		expect(evaluator.evaluate(check('a', 'equals', 0.3), subject).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'above', 0.3), subject).met).toBe(true)
		// Yet it sits inside a ±EPSILON band around 0.3.
		expect(evaluator.evaluate(check('a', 'below', 0.3 + Number.EPSILON), subject).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'above', 0.3 - Number.EPSILON), subject).met).toBe(true)
	})

	it('every EXTREME_NUMBERS value equals itself, and -0 keeps its sign in actual', () => {
		for (const value of EXTREME_NUMBERS) {
			expect(evaluator.evaluate(check('a', 'equals', value), { a: value }).met).toBe(true)
		}
		// equals collapses -0 and +0 (raw ===), but the echoed actual keeps the sign.
		const negativeZero = evaluator.evaluate(check('a', 'equals', 0), { a: -0 })
		expect(negativeZero.met).toBe(true)
		expect(Object.is(negativeZero.actual, -0)).toBe(true)
	})
})

describe('Evaluator — between / outside range edge cases', () => {
	it('a reversed range [40, 20] contains nothing — between false, outside true', () => {
		expect(evaluator.evaluate(check('a', 'between', [40, 20]), { a: 30 }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'outside', [40, 20]), { a: 30 }).met).toBe(true)
	})

	it('a NaN bound makes between false and outside true', () => {
		// isNumber(NaN) is true, so the range passes the type guard; the comparison
		// (30 >= NaN) is what fails, so between is false and outside is its negation.
		expect(evaluator.evaluate(check('a', 'between', [Number.NaN, 40]), { a: 30 }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'outside', [Number.NaN, 40]), { a: 30 }).met).toBe(true)
	})

	it('a point range at MAX_VALUE includes only that exact value', () => {
		const max = Number.MAX_VALUE
		expect(evaluator.evaluate(check('a', 'between', [max, max]), { a: max }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'between', [max, max]), { a: max / 2 }).met).toBe(false)
	})

	it('an infinite range spans every finite actual', () => {
		const range = [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
		expect(evaluator.evaluate(check('a', 'between', range), { a: 1e308 }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'outside', range), { a: 1e308 }).met).toBe(false)
	})
})

describe('Evaluator — unicode / surrogate / combining-mark equals', () => {
	it('matches an astral (surrogate-pair) emoji value exactly', () => {
		const emoji = TRICKY_KEYS[6]
		expect(emoji).toBe('\u{1F600}')
		expect(evaluator.evaluate(check('a', 'equals', emoji), { a: '\u{1F600}' }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'equals', '\u{1F601}'), { a: emoji }).met).toBe(false)
	})

	it('ANGSTROM SIGN U+212B is not === the composed U+00C5', () => {
		// Raw === does no unicode normalization — the two Å code points are distinct.
		expect(evaluator.evaluate(check('a', 'equals', 'Å'), { a: 'Å' }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'equals', 'Å'), { a: 'Å' }).met).toBe(true)
	})

	it('a combining sequence e + U+0301 is not === the precomposed U+00E9', () => {
		expect(evaluator.evaluate(check('a', 'equals', 'é'), { a: 'é' }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'equals', 'é'), { a: 'é' }).met).toBe(true)
	})
})

describe('Evaluator — Symbol and bigint field values (no coercion)', () => {
	it('a bigint 10n never equals the number 10, and only equals 10n', () => {
		expect(evaluator.evaluate(check('a', 'equals', 10), { a: 10n }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'equals', 10n), { a: 10n }).met).toBe(true)
	})

	it('ordering operators reject a bigint on either side', () => {
		// above demands isNumber (typeof 'number') on BOTH sides; a bigint is neither.
		expect(evaluator.evaluate(check('a', 'above', 5), { a: 10n }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'above', 5n), { a: 10 }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'from', 10n), { a: 10n }).met).toBe(false)
	})

	it('a Symbol equals only its own reference and is found by any', () => {
		const token = Symbol('token')
		expect(evaluator.evaluate(check('a', 'equals', token), { a: token }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'equals', Symbol('token')), { a: token }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'any', [token]), { a: token }).met).toBe(true)
	})
})

describe('Evaluator — deep field path', () => {
	it('descends ~100 levels to the leaf, one past the leaf is undefined', () => {
		let deep: Subject = { leaf: 'bottom' }
		for (let level = 0; level < 100; level += 1) deep = { child: deep }
		const toLeaf = [...repeatValue<string>(100, 'child'), 'leaf']
		expect(evaluator.evaluate(check(toLeaf, 'equals', 'bottom'), deep).met).toBe(true)
		// One segment past the (string) leaf resolves undefined — total, never a throw.
		const pastLeaf = [...toLeaf, 'beyond']
		const result = evaluator.evaluate(check(pastLeaf, 'equals', undefined), deep)
		expect(result.actual).toBeUndefined()
		expect(result.met).toBe(true)
	})
})

describe('Evaluator — array-of-arrays and string-index paths', () => {
	it('indexes nested arrays by string keys (["a", "0", "1"])', () => {
		const subject = { a: [[10, 20]] }
		expect(evaluator.evaluate(check(['a', '0', '1'], 'equals', 20), subject).met).toBe(true)
		expect(evaluator.evaluate(check(['a', '0', '0'], 'equals', 10), subject).met).toBe(true)
	})

	it('a partial array path yields the inner array by reference; out-of-range is undefined', () => {
		const inner = [10, 20]
		const subject = { a: [inner] }
		// Reference identity — the resolved value IS the same inner array.
		const partial = evaluator.evaluate(check(['a', '0'], 'equals', inner), subject)
		expect(partial.met).toBe(true)
		expect(partial.actual).toBe(inner)
		expect(evaluator.evaluate(check(['a', '5'], 'equals', undefined), subject).met).toBe(true)
	})
})

describe('Evaluator — prototype-pollution-safe key resolution', () => {
	it('reads inherited prototype members off a plain object without throwing', () => {
		const subject = { own: 1 }
		// resolveField uses Reflect.get, so inherited accessors/methods DO resolve —
		// but only as read values; this is documented, safe, read-only behavior.
		const proto = evaluator.evaluate(check('__proto__', 'equals', Object.prototype), subject)
		expect(proto.met).toBe(true)
		expect(proto.actual).toBe(Object.prototype)
		const ctor = evaluator.evaluate(check('constructor', 'equals', Object), subject)
		expect(ctor.met).toBe(true)
		expect(ctor.actual).toBe(Object)
		expect(
			evaluator.evaluate(check('toString', 'equals', Object.prototype.toString), subject).met,
		).toBe(true)
		// A plain object has no own or inherited 'prototype' property.
		expect(evaluator.evaluate(check('prototype', 'equals', undefined), subject).met).toBe(true)
	})

	it('cannot descend through a function value (constructor.prototype is undefined)', () => {
		// constructor resolves to the Object function, but isObject rejects functions,
		// so the walk stops — Object.prototype is NOT reachable via constructor.prototype.
		const result = evaluator.evaluate(check(['constructor', 'prototype'], 'equals', undefined), {
			own: 1,
		})
		expect(result.actual).toBeUndefined()
		expect(result.met).toBe(true)
	})

	it('an Object.create(null) subject exposes no inherited keys, only own fields', () => {
		const nullProto: Subject = Object.create(null)
		// `Subject`'s index signature is readonly; set the own field reflectively.
		Reflect.set(nullProto, 'real', 5)
		for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
			expect(evaluator.evaluate(check(key, 'equals', undefined), nullProto).met).toBe(true)
		}
		expect(evaluator.evaluate(check('real', 'equals', 5), nullProto).met).toBe(true)
	})
})

describe('Evaluator — empty-string key present vs absent', () => {
	it('an absent "" key resolves undefined; a present one resolves its value', () => {
		// Absent — no '' own key on the basic subject.
		expect(evaluator.evaluate(check('', 'equals', undefined), BASIC_SUBJECT).met).toBe(true)
		expect(evaluator.evaluate(check('', 'equals', 'blank'), BASIC_SUBJECT).met).toBe(false)
		// Present — the '' key resolves its literal value.
		expect(evaluator.evaluate(check('', 'equals', 'blank'), { '': 'blank' }).met).toBe(true)
	})
})

// Scale/perf regression guard: 100_000-check batches pin batch() correctness
// and throughput at a size well beyond hand-written fixtures.
describe('Evaluator — batch at scale', () => {
	it('evaluates 100_000 checks, preserving length and exact per-item correctness', () => {
		// BASIC_SUBJECT.age is 30, so `above n` is met for exactly n in 0..29.
		const checks = sequence(100_000).map((n) => check('age', 'above', n))
		const results = evaluator.batch(checks, BASIC_SUBJECT)
		expect(results).toHaveLength(100_000)
		expect(results.filter((result) => result.met)).toHaveLength(30)
		// Spot-check the boundary and the far tail.
		expect(results[0]?.met).toBe(true)
		expect(results[29]?.met).toBe(true)
		expect(results[30]?.met).toBe(false)
		expect(results[99_999]?.met).toBe(false)
	})

	it('completes a 100_000 uniform (repeatValue) batch, every item met', () => {
		const checks = repeatValue(100_000, check('age', 'from', 18))
		const results = evaluator.batch(checks, BASIC_SUBJECT)
		expect(results).toHaveLength(100_000)
		expect(results.every((result) => result.met)).toBe(true)
	})
})

// Scale/perf regression guard: a 100_000-element expected array pins any/none
// lookup correctness at the same scale as the batch tests above.
describe('Evaluator — any / none over a large expected array', () => {
	it('finds / excludes a member of a 100_000-element expected array exactly', () => {
		const expected = sequence(100_000)
		// 99_999 is the last member; 100_000 is one past the range.
		expect(evaluator.evaluate(check('a', 'any', expected), { a: 99_999 }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'none', expected), { a: 99_999 }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'any', expected), { a: 100_000 }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'none', expected), { a: 100_000 }).met).toBe(true)
	})
})

// Reference-equality semantics for non-record object values (Map / Set / Date /
// class instance), no-coercion ordering with a non-number side, and total
// deterministic handling of sparse expected arrays across any / none / between /
// outside — the only check kinds whose `expected` is read as an array.
describe('Evaluator — reference equality for Map / Set / Date / class instances', () => {
	it('a Map equals only the SAME reference, not a structurally-equal copy', () => {
		const map = new Map([['x', 1]])
		expect(evaluator.evaluate(check('a', 'equals', map), { a: map }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'equals', new Map([['x', 1]])), { a: map }).met).toBe(
			false,
		)
		expect(evaluator.evaluate(check('a', 'not', new Map([['x', 1]])), { a: map }).met).toBe(true)
	})

	it('a Set equals only the SAME reference, not a structurally-equal copy', () => {
		const set = new Set([1, 2, 3])
		expect(evaluator.evaluate(check('a', 'equals', set), { a: set }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'equals', new Set([1, 2, 3])), { a: set }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'not', new Set([1, 2, 3])), { a: set }).met).toBe(true)
	})

	it('a Date equals only the SAME reference, not an equal-timestamp copy', () => {
		const date = new Date(2024, 0, 1)
		expect(evaluator.evaluate(check('a', 'equals', date), { a: date }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'equals', new Date(2024, 0, 1)), { a: date }).met).toBe(
			false,
		)
		expect(evaluator.evaluate(check('a', 'not', new Date(2024, 0, 1)), { a: date }).met).toBe(true)
	})

	it('a class instance equals only the SAME reference, not a same-shape copy', () => {
		class Point {
			readonly x: number
			readonly y: number
			constructor(x: number, y: number) {
				this.x = x
				this.y = y
			}
		}
		const point = new Point(1, 2)
		expect(evaluator.evaluate(check('a', 'equals', point), { a: point }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'equals', new Point(1, 2)), { a: point }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'not', new Point(1, 2)), { a: point }).met).toBe(true)
	})
})

describe('Evaluator — ordering operators reject non-number sides without throwing', () => {
	it('above / below / from / to fail on a Date actual against a number expected', () => {
		const date = new Date(2024, 0, 1)
		expect(() => evaluator.evaluate(check('a', 'above', 0), { a: date })).not.toThrow()
		expect(evaluator.evaluate(check('a', 'above', 0), { a: date }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'below', 0), { a: date }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'from', 0), { a: date }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'to', 0), { a: date }).met).toBe(false)
	})

	it('above / below / from / to fail on a numeric string on EITHER side — no coercion', () => {
		// Numeric-string actual against a real number expected.
		expect(evaluator.evaluate(check('a', 'above', 5), { a: '10' }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'below', 20), { a: '10' }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'from', 10), { a: '10' }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'to', 10), { a: '10' }).met).toBe(false)
		// Real number actual against a numeric-string expected.
		expect(evaluator.evaluate(check('a', 'above', '5'), { a: 10 }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'from', '10'), { a: 10 }).met).toBe(false)
		// Both sides numeric strings — still not met, both must be actual numbers.
		expect(evaluator.evaluate(check('a', 'from', '10'), { a: '10' }).met).toBe(false)
	})
})

describe('Evaluator — sparse expected arrays (any / none / between / outside)', () => {
	// The Check catalog has exactly four operators that read `expected` as an
	// array: any, none, between, outside. All four are exercised below with a
	// real-hole sparse array (never `[undefined, ...]`), each scenario run
	// twice to pin deterministic, total behavior.
	it('any / none over a sparse array treat a hole as membership-equal to undefined', () => {
		// Array.prototype.includes does NOT skip holes — it reads the hole as
		// undefined, so a hole at index 1 makes `undefined` a member.
		const expected = sparse<number | undefined>(3, [
			[0, 7],
			[2, 9],
		])
		const runAny = () => evaluator.evaluate(check('a', 'any', expected), { a: undefined }).met
		const runNone = () => evaluator.evaluate(check('a', 'none', expected), { a: undefined }).met
		expect(runAny()).toBe(true)
		expect(runAny()).toBe(true)
		expect(runNone()).toBe(false)
		expect(runNone()).toBe(false)
		// A concrete member (7) and a genuine non-member (100) behave normally.
		expect(evaluator.evaluate(check('a', 'any', expected), { a: 7 }).met).toBe(true)
		expect(evaluator.evaluate(check('a', 'any', expected), { a: 100 }).met).toBe(false)
	})

	it('between / outside with a hole at index 0 or 1 fail the type guard — false / true', () => {
		// #isBetween reads expected[0] and expected[1] directly; a hole resolves
		// to undefined, which fails isNumber, so between is false regardless of
		// the actual, and outside (the pure negation) is true.
		const holeAtStart = sparse<number | undefined>(2, [[1, 40]])
		const runBetween = () => evaluator.evaluate(check('a', 'between', holeAtStart), { a: 30 }).met
		const runOutside = () => evaluator.evaluate(check('a', 'outside', holeAtStart), { a: 30 }).met
		expect(runBetween()).toBe(false)
		expect(runBetween()).toBe(false)
		expect(runOutside()).toBe(true)
		expect(runOutside()).toBe(true)

		const holeAtSecond = sparse<number | undefined>(2, [[0, 20]])
		expect(evaluator.evaluate(check('a', 'between', holeAtSecond), { a: 30 }).met).toBe(false)
		expect(evaluator.evaluate(check('a', 'outside', holeAtSecond), { a: 30 }).met).toBe(true)
	})

	it('between / outside with a hole at index 2+ (past the read window) behaves normally', () => {
		// Only the first two elements are read — a trailing hole is irrelevant.
		const trailingHole = sparse<number | undefined>(3, [
			[0, 20],
			[1, 40],
		])
		const runBetween = () => evaluator.evaluate(check('a', 'between', trailingHole), { a: 30 }).met
		const runOutside = () => evaluator.evaluate(check('a', 'outside', trailingHole), { a: 30 }).met
		expect(runBetween()).toBe(true)
		expect(runBetween()).toBe(true)
		expect(runOutside()).toBe(false)
		expect(runOutside()).toBe(false)
	})
})
