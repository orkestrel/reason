import {
	evaluator,
	ageFrom18,
	evaluateArray,
	scoreAbove50,
	nameEqualsAlice,
	BASIC_SUBJECT,
	DRIVER_SUBJECT,
	EXTREME_NUMBERS,
	NESTED_SUBJECT,
	repeatValue,
	sequence,
	sparse,
	TRICKY_KEYS,
} from '../../../setup.js'
import type { CheckResult, Subject } from '@src/core'
import { createCheck, Evaluator } from '@src/core'
import { describe, expect, it } from 'vitest'
import { invokeUnchecked } from '@orkestrel/test'

// `Evaluator` behavior — the shared predicate engine. Each comparison settles met or
// unmet only over values it can read, and reads `unread` for everything else, whichever
// operator asked: an absent field, NaN, an object, a malformed expected value, any other
// difference of type, and a blank or padded string under `equals` and `not`. Also `resolveField` semantics (a STRING
// field is ONE key — never dot-split; an ARRAY descends), the caught unknown-operator
// error, and order-preserving isolated `batch`, over the project-wide one-word comparison
// vocabulary.
// No mocks — the real stateless instance throughout.

// The recurring shared checks.

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
		const result = evaluator.evaluate(createCheck('name', 'equals', 'Alice'), BASIC_SUBJECT)
		expect(result.state).toBe('met')
		expect(result.actual).toBe('Alice')
	})

	it('fails on a differing value', () => {
		expect(evaluator.evaluate(createCheck('name', 'equals', 'Bob'), BASIC_SUBJECT).state).toBe(
			'unmet',
		)
	})

	it('refuses the number 30 against its own text "30"', () => {
		expect(evaluator.evaluate(createCheck('age', 'equals', '30'), BASIC_SUBJECT).state).toBe(
			'unread',
		)
	})

	it('matches booleans', () => {
		expect(evaluator.evaluate(createCheck('employed', 'equals', true), BASIC_SUBJECT).state).toBe(
			'met',
		)
	})

	it('null is a value, so null equals null is met', () => {
		expect(evaluator.evaluate(createCheck('a', 'equals', null), { a: null }).state).toBe('met')
	})

	it('an undefined field reads unread against null and undefined alike', () => {
		expect(evaluator.evaluate(createCheck('missing', 'equals', null), {}).state).toBe('unread')
		const result = evaluator.evaluate(createCheck('missing', 'equals', undefined), {})
		expect(result.state).toBe('unread')
		expect(result.actual).toBeUndefined()
	})

	it('never coerces falsy cross-type pairs (0 / "" vs false), and never settles them', () => {
		expect(evaluator.evaluate(createCheck('a', 'equals', false), { a: 0 }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'equals', false), { a: '' }).state).toBe('unread')
	})

	it('an array has no value to compare', () => {
		expect(evaluator.evaluate(createCheck('a', 'equals', [1, 2]), { a: [1, 2] }).state).toBe(
			'unread',
		)
	})
})

describe('Evaluator — not', () => {
	it('holds on a differing value, fails on a match', () => {
		expect(evaluator.evaluate(createCheck('name', 'not', 'Bob'), BASIC_SUBJECT).state).toBe('met')
		expect(evaluator.evaluate(createCheck('name', 'not', 'Alice'), BASIC_SUBJECT).state).toBe(
			'unmet',
		)
	})

	it('an undefined field reads unread, not "is not test"', () => {
		expect(evaluator.evaluate(createCheck('missing', 'not', 'test'), {}).state).toBe('unread')
	})

	it('NaN has no value to compare', () => {
		expect(evaluator.evaluate(createCheck('a', 'not', Number.NaN), { a: Number.NaN }).state).toBe(
			'unread',
		)
	})

	it('undefined not undefined reads unread', () => {
		expect(evaluator.evaluate(createCheck('missing', 'not', undefined), {}).state).toBe('unread')
	})
})

describe('Evaluator — above', () => {
	it('holds strictly above, fails at and below the threshold', () => {
		expect(evaluator.evaluate(createCheck('age', 'above', 25), BASIC_SUBJECT).state).toBe('met')
		expect(evaluator.evaluate(createCheck('age', 'above', 30), BASIC_SUBJECT).state).toBe('unmet')
		expect(evaluator.evaluate(createCheck('age', 'above', 35), BASIC_SUBJECT).state).toBe('unmet')
	})

	it('reads unread without a number on each side', () => {
		expect(evaluator.evaluate(createCheck('name', 'above', 25), BASIC_SUBJECT).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('age', 'above', 'ten'), BASIC_SUBJECT).state).toBe(
			'unread',
		)
	})

	it('reads unread on infinities and NaN, which pass as numbers otherwise', () => {
		expect(
			evaluator.evaluate(createCheck('a', 'above', 999999999), { a: Number.POSITIVE_INFINITY })
				.state,
		).toBe('unread')
		expect(
			evaluator.evaluate(createCheck('a', 'above', 0), { a: Number.NEGATIVE_INFINITY }).state,
		).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'above', Number.NaN), { a: Number.NaN }).state).toBe(
			'unread',
		)
	})
})

describe('Evaluator — below', () => {
	it('holds strictly below, fails at the threshold', () => {
		expect(evaluator.evaluate(createCheck('age', 'below', 40), BASIC_SUBJECT).state).toBe('met')
		expect(evaluator.evaluate(createCheck('age', 'below', 30), BASIC_SUBJECT).state).toBe('unmet')
	})

	it('reads unread without a numeric actual', () => {
		expect(evaluator.evaluate(createCheck('name', 'below', 40), BASIC_SUBJECT).state).toBe('unread')
	})

	it('reads unread on infinities and NaN', () => {
		expect(
			evaluator.evaluate(createCheck('a', 'below', 0), { a: Number.NEGATIVE_INFINITY }).state,
		).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'below', 0), { a: Number.NaN }).state).toBe('unread')
	})
})

describe('Evaluator — from / to', () => {
	it('from holds at and above the threshold, fails below', () => {
		expect(evaluator.evaluate(createCheck('age', 'from', 30), BASIC_SUBJECT).state).toBe('met')
		expect(evaluator.evaluate(createCheck('age', 'from', 25), BASIC_SUBJECT).state).toBe('met')
		expect(evaluator.evaluate(createCheck('age', 'from', 35), BASIC_SUBJECT).state).toBe('unmet')
	})

	it('to holds at and below the threshold, fails above', () => {
		expect(evaluator.evaluate(createCheck('age', 'to', 30), BASIC_SUBJECT).state).toBe('met')
		expect(evaluator.evaluate(createCheck('age', 'to', 35), BASIC_SUBJECT).state).toBe('met')
		expect(evaluator.evaluate(createCheck('age', 'to', 25), BASIC_SUBJECT).state).toBe('unmet')
	})

	it('from / to read unread without numbers on BOTH sides', () => {
		expect(evaluator.evaluate(createCheck('name', 'from', 25), BASIC_SUBJECT).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('age', 'from', '18'), BASIC_SUBJECT).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('name', 'to', 25), BASIC_SUBJECT).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('age', 'to', '35'), BASIC_SUBJECT).state).toBe('unread')
	})
})

describe('Evaluator — any (array membership)', () => {
	it('holds for a member, fails for a non-member', () => {
		expect(evaluator.evaluate(createCheck('state', 'any', ['CA', 'NY']), BASIC_SUBJECT).state).toBe(
			'met',
		)
		expect(evaluator.evaluate(createCheck('state', 'any', ['TX', 'FL']), BASIC_SUBJECT).state).toBe(
			'unmet',
		)
	})

	it('reads unread on a non-array expected value and on an empty array', () => {
		expect(evaluator.evaluate(createCheck('state', 'any', 'CA'), BASIC_SUBJECT).state).toBe(
			'unread',
		)
		expect(evaluator.evaluate(createCheck('state', 'any', []), BASIC_SUBJECT).state).toBe('unread')
	})

	it('an undefined field reads unread, even against a list holding undefined', () => {
		expect(evaluator.evaluate(createCheck('missing', 'any', [undefined]), {}).state).toBe('unread')
	})

	it('matches number membership', () => {
		expect(evaluator.evaluate(createCheck('age', 'any', [25, 30, 35]), BASIC_SUBJECT).state).toBe(
			'met',
		)
	})

	it('works through an array field path', () => {
		expect(
			evaluator.evaluate(createCheck(['scores', 'math'], 'any', [90, 100]), NESTED_SUBJECT).state,
		).toBe('met')
	})
})

describe('Evaluator — none (array non-membership)', () => {
	it('holds for a non-member, fails for a member', () => {
		expect(
			evaluator.evaluate(createCheck('state', 'none', ['TX', 'FL']), BASIC_SUBJECT).state,
		).toBe('met')
		expect(
			evaluator.evaluate(createCheck('state', 'none', ['CA', 'NY']), BASIC_SUBJECT).state,
		).toBe('unmet')
	})

	it('reads unread on a non-array expected value', () => {
		// Both any and none demand an array — malformed input settles neither.
		expect(evaluator.evaluate(createCheck('state', 'none', 'CA'), BASIC_SUBJECT).state).toBe(
			'unread',
		)
	})

	it('an undefined field reads unread, not "none of an empty array"', () => {
		expect(evaluator.evaluate(createCheck('missing', 'none', []), {}).state).toBe('unread')
	})

	it('membership reads unread when an element has another type and nothing hit', () => {
		expect(evaluator.evaluate(createCheck('a', 'none', ['x', true]), { a: 1 }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'none', ['1', true]), { a: 1 }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'none', ['1', null]), { a: 1 }).state).toBe('unread')
	})

	it('NaN reads unread on any / none / equals, and -0 is a member of [0]', () => {
		expect(evaluator.evaluate(createCheck('a', 'any', [Number.NaN]), { a: Number.NaN }).state).toBe(
			'unread',
		)
		expect(
			evaluator.evaluate(createCheck('a', 'equals', Number.NaN), { a: Number.NaN }).state,
		).toBe('unread')
		expect(
			evaluator.evaluate(createCheck('a', 'none', [Number.NaN]), { a: Number.NaN }).state,
		).toBe('unread')
		// And -0 is a member of [0].
		expect(evaluator.evaluate(createCheck('a', 'any', [0]), { a: -0 }).state).toBe('met')
	})
})

describe('Evaluator — between (inclusive)', () => {
	it('holds within and at both bounds, fails outside', () => {
		expect(evaluator.evaluate(createCheck('age', 'between', [20, 40]), BASIC_SUBJECT).state).toBe(
			'met',
		)
		expect(evaluator.evaluate(createCheck('age', 'between', [30, 40]), BASIC_SUBJECT).state).toBe(
			'met',
		)
		expect(evaluator.evaluate(createCheck('age', 'between', [20, 30]), BASIC_SUBJECT).state).toBe(
			'met',
		)
		expect(evaluator.evaluate(createCheck('age', 'between', [35, 40]), BASIC_SUBJECT).state).toBe(
			'unmet',
		)
	})

	it('reads unread on a non-numeric actual and malformed ranges', () => {
		expect(evaluator.evaluate(createCheck('name', 'between', [20, 40]), BASIC_SUBJECT).state).toBe(
			'unread',
		)
		expect(evaluator.evaluate(createCheck('age', 'between', 'invalid'), BASIC_SUBJECT).state).toBe(
			'unread',
		)
		expect(evaluator.evaluate(createCheck('age', 'between', [30]), BASIC_SUBJECT).state).toBe(
			'unread',
		)
		expect(evaluator.evaluate(createCheck('age', 'between', ['a', 'b']), BASIC_SUBJECT).state).toBe(
			'unread',
		)
	})

	it('handles negative, point, and huge ranges', () => {
		expect(evaluator.evaluate(createCheck('a', 'between', [-10, -1]), { a: -5 }).state).toBe('met')
		expect(evaluator.evaluate(createCheck('age', 'between', [30, 30]), BASIC_SUBJECT).state).toBe(
			'met',
		)
		expect(
			evaluator.evaluate(createCheck('age', 'between', [-1e15, 1e15]), BASIC_SUBJECT).state,
		).toBe('met')
	})

	it('reads unread on a longer array, which is no range', () => {
		expect(
			evaluator.evaluate(createCheck('age', 'between', [20, 40, 100]), BASIC_SUBJECT).state,
		).toBe('unread')
	})
})

describe('Evaluator — outside (pure negation of between)', () => {
	it('holds outside, fails inside and at a boundary', () => {
		expect(evaluator.evaluate(createCheck('age', 'outside', [40, 50]), BASIC_SUBJECT).state).toBe(
			'met',
		)
		expect(evaluator.evaluate(createCheck('age', 'outside', [20, 40]), BASIC_SUBJECT).state).toBe(
			'unmet',
		)
		// between is inclusive, so its boundary is NOT outside.
		expect(evaluator.evaluate(createCheck('age', 'outside', [30, 40]), BASIC_SUBJECT).state).toBe(
			'unmet',
		)
	})

	it('reads unread on a non-numeric actual and on NaN, never "outside" by default', () => {
		expect(evaluator.evaluate(createCheck('name', 'outside', [20, 40]), BASIC_SUBJECT).state).toBe(
			'unread',
		)
		expect(evaluator.evaluate(createCheck('a', 'outside', [20, 40]), { a: Number.NaN }).state).toBe(
			'unread',
		)
	})
})

describe('Evaluator — missing fields & field paths', () => {
	it('a missing field yields an undefined actual, reads unread, and echoes the field', () => {
		const result = evaluator.evaluate(createCheck('missing', 'equals', 'x'), BASIC_SUBJECT)
		expect(result.state).toBe('unread')
		expect(result.actual).toBeUndefined()
		expect(result.field).toBe('missing')
	})

	it('an ARRAY field path descends into nested objects', () => {
		const result = evaluator.evaluate(
			createCheck(['address', 'city'], 'equals', 'NY'),
			NESTED_SUBJECT,
		)
		expect(result.state).toBe('met')
		expect(result.actual).toBe('NY')
	})

	it('a missing nested path resolves to undefined and reads unread', () => {
		const result = evaluator.evaluate(
			createCheck(['address', 'state'], 'equals', 'NY'),
			NESTED_SUBJECT,
		)
		expect(result.state).toBe('unread')
		expect(result.actual).toBeUndefined()
	})

	it('descends three levels deep', () => {
		expect(
			evaluator.evaluate(createCheck(['a', 'b', 'c'], 'equals', 7), { a: { b: { c: 7 } } }).state,
		).toBe('met')
	})

	it('a dotted STRING is ONE key, never a path', () => {
		// The flat 'a.b' key resolves; the nested { a: { b } } shape does NOT.
		expect(evaluator.evaluate(createCheck('a.b', 'equals', 1), { 'a.b': 1 }).state).toBe('met')
		expect(evaluator.evaluate(createCheck('a.b', 'equals', 1), { a: { b: 1 } }).state).toBe(
			'unread',
		)
	})

	it('an empty-string field name resolves the "" key', () => {
		expect(evaluator.evaluate(createCheck('', 'equals', 'blank'), { '': 'blank' }).state).toBe(
			'met',
		)
	})

	it('an EMPTY-array field path resolves the WHOLE subject, which is no comparable value', () => {
		const subject = { a: 1 }
		const result = evaluator.evaluate(createCheck([], 'equals', subject), subject)
		expect(result.state).toBe('unread')
		expect(result.actual).toBe(subject)
	})

	it('descends through an array by string index', () => {
		const subject = { items: [{ price: 5 }, { price: 9 }] }
		expect(
			evaluator.evaluate(createCheck(['items', '1', 'price'], 'equals', 9), subject).state,
		).toBe('met')
	})

	it('a path hitting null mid-way resolves undefined and reads unread (total, no crash)', () => {
		const result = evaluator.evaluate(createCheck(['a', 'b'], 'equals', undefined), { a: null })
		expect(result.actual).toBeUndefined()
		expect(result.state).toBe('unread')
	})
})

describe('Evaluator — a difference of type never settles', () => {
	const ROWS = [
		['a numeric string against a number', 'equals', '1', 1],
		['a numeric string against a different number', 'equals', '2', 1],
		['a padded numeric string', 'equals', ' 1 ', 1],
		['hex text', 'equals', '0x1', 1],
		['exponent text', 'equals', '1e0', 1],
		['a numeric string under not', 'not', '2', 1],
		['a word against a number', 'equals', 'abc', 1],
		['a word under not, against a number', 'not', 'abc', 1],
		['an empty string against a number', 'equals', '', 0],
		['"true" against a boolean', 'equals', 'true', true],
		['"false" against a boolean', 'equals', 'false', true],
		['"TRUE" against a boolean', 'equals', 'TRUE', true],
		['"true" under not', 'not', 'true', false],
		['a word against a boolean', 'equals', 'yes', true],
		['"no" against false', 'equals', 'no', false],
		['"off" against false', 'equals', 'off', false],
		['"False" against false', 'equals', 'False', false],
		['the number against its own text', 'equals', 1, '1'],
		['the number against padded text', 'equals', 1, ' 1 '],
		['the number under not', 'not', 1, '1'],
		['a number against text that is not its own', 'equals', 1, '2'],
		['a number against a word', 'not', 90, 'none'],
		['a number against a boolean', 'equals', 1, true],
		['the boolean against its own text', 'equals', true, 'true'],
		['the boolean under not', 'not', false, 'false'],
		['a boolean against a word', 'equals', true, 'yes'],
		['null against a number', 'equals', null, 1],
		['null against a word, under not', 'not', null, 'a'],
		['a numeric string in a number list', 'any', '1', [1, 2]],
		['a numeric string beside a number list', 'none', '3', [1, 2]],
		['"true" in a boolean list', 'any', 'true', [true]],
		['a number against text in a list', 'any', 1, ['1', 'x']],
		['a boolean against text in a list', 'none', true, ['true']],
		['a word against a number list', 'any', 'abc', [1, 2]],
		['a word beside a number list', 'none', 'abc', [1, 2]],
		['a number against a word list', 'none', 90, ['none']],
		['a number beside a null in a list', 'none', 5, [null]],
	] as const
	for (const [name, operator, actual, expected] of ROWS) {
		it(`reads unread: ${name}`, () => {
			expect(evaluator.evaluate(createCheck('a', operator, expected), { a: actual }).state).toBe(
				'unread',
			)
		})
	}

	const CONTROLS = [
		['the number and the number', 'equals', 1, 1, 'met'],
		['two different numbers', 'equals', 1, 2, 'unmet'],
		['the string and the string', 'equals', '1', '1', 'met'],
		['two different strings', 'equals', '1', '2', 'unmet'],
		['the boolean and the boolean', 'equals', true, true, 'met'],
		['two different booleans', 'equals', true, false, 'unmet'],
		['a number in its own list', 'any', 1, [1, 2], 'met'],
		['a number out of its own list', 'any', 3, [1, 2], 'unmet'],
		['an exact hit in a mixed list', 'any', '1', ['1', 1], 'met'],
		['an exact hit in a mixed list, under none', 'none', 1, ['1', 1], 'unmet'],
	] as const
	for (const [name, operator, actual, expected, state] of CONTROLS) {
		it(`settles: ${name}`, () => {
			expect(evaluator.evaluate(createCheck('a', operator, expected), { a: actual }).state).toBe(
				state,
			)
		})
	}
})

describe('Evaluator — a blank or padded string reads unread under equality and membership', () => {
	const ROWS = [
		['empty against empty', 'equals', '', ''],
		['spaces against themselves', 'equals', '  ', '  '],
		['padded against itself', 'equals', ' FL', ' FL'],
		['padded against its trim', 'equals', ' FL ', 'FL'],
		['padded under not', 'not', 'FL ', 'NY'],
		['empty against null', 'not', '', null],
		['padded against its trim, in a list', 'any', ' CA ', ['CA']],
		['padded beside a list', 'none', ' CA ', ['CA']],
		['padded against itself, in a list', 'any', ' CA ', [' CA ']],
		['blank in a list', 'any', '', ['']],
	] as const
	for (const [name, operator, actual, expected] of ROWS) {
		it(`reads unread: ${name}`, () => {
			expect(evaluator.evaluate(createCheck('a', operator, expected), { a: actual }).state).toBe(
				'unread',
			)
		})
	}
})

describe('Evaluator — null is a value', () => {
	const ROWS = [
		['null equals null', 'equals', null, 'met'],
		['null not null', 'not', null, 'unmet'],
		['a number equals null', 'equals', 5, 'unmet'],
		['a number not null', 'not', 5, 'met'],
		['a word not null', 'not', 'a', 'met'],
		['false not null', 'not', false, 'met'],
		['zero not null', 'not', 0, 'met'],
	] as const
	for (const [name, operator, actual, state] of ROWS) {
		it(`${name} is ${state}`, () => {
			expect(evaluator.evaluate(createCheck('a', operator, null), { a: actual }).state).toBe(state)
		})
	}

	it('an absent field is not null, so it stays unread', () => {
		expect(evaluator.evaluate(createCheck('a', 'equals', null), {}).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'not', null), {}).state).toBe('unread')
	})

	it('an ordering on null stays unread', () => {
		for (const operator of ['above', 'below', 'from', 'to'] as const) {
			expect(evaluator.evaluate(createCheck('a', operator, 1), { a: null }).state).toBe('unread')
		}
		expect(evaluator.evaluate(createCheck('a', 'between', [1, 2]), { a: null }).state).toBe(
			'unread',
		)
	})

	it('membership reads it per element', () => {
		expect(evaluator.evaluate(createCheck('a', 'any', [null, 'x']), { a: null }).state).toBe('met')
		expect(evaluator.evaluate(createCheck('a', 'none', [null]), { a: null }).state).toBe('unmet')
		expect(evaluator.evaluate(createCheck('a', 'any', ['x']), { a: null }).state).toBe('unread')
	})
})

describe('Evaluator — every comparison reads an unreadable input alike', () => {
	const COMPARISONS = [
		['equals', 1],
		['not', 1],
		['above', 1],
		['below', 1],
		['from', 1],
		['to', 1],
		['any', [1]],
		['none', [1]],
		['between', [0, 2]],
		['outside', [0, 2]],
	] as const
	const VALUES = [
		['absent', {}],
		['null', { a: null }],
		['undefined', { a: undefined }],
		['NaN', { a: Number.NaN }],
		['Infinity', { a: Number.POSITIVE_INFINITY }],
		['an object', { a: {} }],
		['an array', { a: [1] }],
		['a bigint', { a: 1n }],
	] as const
	for (const [operator, expected] of COMPARISONS) {
		for (const [name, subject] of VALUES) {
			it(`${operator} reads unread on ${name}`, () => {
				expect(evaluator.evaluate(createCheck('a', operator, expected), subject).state).toBe(
					'unread',
				)
			})
		}
	}
})

describe('Evaluator — error handling', () => {
	it('a SUCCESSFUL CheckResult omits the error key entirely', () => {
		const result = evaluator.evaluate(ageFrom18, BASIC_SUBJECT)
		expect(Object.keys(result)).toEqual(['field', 'state', 'actual'])
	})

	it('an unknown operator is caught: state unread, error names the operator', () => {
		const result = invokeUnchecked<CheckResult>(evaluator, evaluator.evaluate, [
			{ field: 'age', operator: 'invalid', value: 1 },
			BASIC_SUBJECT,
		])
		expect(result.state).toBe('unread')
		expect(result.error).toContain('Unknown comparison operator')
		expect(result.error).toContain('invalid')
	})
})

describe('Evaluator — batch', () => {
	it('evaluates each check, preserving length and per-item met', () => {
		const results = evaluator.batch([ageFrom18, createCheck('score', 'above', 90)], BASIC_SUBJECT)
		expect(results).toHaveLength(2)
		expect(results[0]?.state).toBe('met')
		expect(results[1]?.state).toBe('unmet')
	})

	it('returns [] for an empty check list', () => {
		expect(evaluator.batch([], BASIC_SUBJECT)).toEqual([])
	})

	it('undefined equals undefined reads unread against an empty subject', () => {
		expect(evaluator.batch([createCheck('missing', 'equals', undefined)], {})[0]?.state).toBe(
			'unread',
		)
	})

	it('a 100-check batch over age 30 meets exactly 30 (above 0..99)', () => {
		const checks = Array.from({ length: 100 }, (_, index) => createCheck('age', 'above', index))
		const results = evaluator.batch(checks, BASIC_SUBJECT)
		expect(results.filter((result) => result.state === 'met')).toHaveLength(30)
	})

	it('preserves order — results[i].field matches checks[i].field', () => {
		const checks = [
			createCheck('age', 'from', 18),
			createCheck('name', 'equals', 'Alice'),
			scoreAbove50,
		]
		const results = evaluator.batch(checks, BASIC_SUBJECT)
		expect(results.map((result) => result.field)).toEqual(['age', 'name', 'score'])
	})

	it('isolates an invalid-operator item — siblings are unaffected', () => {
		const results = invokeUnchecked<readonly CheckResult[]>(evaluator, evaluator.batch, [
			[
				createCheck('age', 'above', 0),
				{ field: 'age', operator: 'bogus', value: 1 },
				nameEqualsAlice,
			],
			BASIC_SUBJECT,
		])
		expect(results[0]?.state).toBe('met')
		expect(results[1]?.state).toBe('unread')
		expect(results[1]?.error).toContain('Unknown comparison operator')
		expect(results[2]?.state).toBe('met')
	})
})

describe('Evaluator — edge cases', () => {
	it('NaN reads unread on equals / above / below', () => {
		expect(
			evaluator.evaluate(createCheck('a', 'equals', Number.NaN), { a: Number.NaN }).state,
		).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'above', 0), { a: Number.NaN }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'below', 0), { a: Number.NaN }).state).toBe('unread')
	})

	it('-0 equals 0 (raw ===)', () => {
		expect(evaluator.evaluate(createCheck('a', 'equals', 0), { a: -0 }).state).toBe('met')
	})

	it('an object reads unread, whichever reference it is', () => {
		const shared = { nested: true }
		expect(evaluator.evaluate(createCheck('a', 'equals', shared), { a: shared }).state).toBe(
			'unread',
		)
		expect(
			evaluator.evaluate(createCheck('a', 'equals', { nested: true }), { a: shared }).state,
		).toBe('unread')
	})
})

describe('Evaluator — shared checks against shared subjects', () => {
	it('all three shared checks are met against the basic subject', () => {
		expect(evaluator.evaluate(ageFrom18, BASIC_SUBJECT).state).toBe('met')
		expect(evaluator.evaluate(scoreAbove50, BASIC_SUBJECT).state).toBe('met')
		expect(evaluator.evaluate(nameEqualsAlice, BASIC_SUBJECT).state).toBe('met')
	})

	it('each fails against its failing subject', () => {
		expect(evaluator.evaluate(ageFrom18, { age: 16 }).state).toBe('unmet')
		expect(evaluator.evaluate(scoreAbove50, { score: 30 }).state).toBe('unmet')
		expect(evaluator.evaluate(nameEqualsAlice, { name: 'Bob' }).state).toBe('unmet')
	})

	it('all read unread against an empty subject', () => {
		for (const shared of [ageFrom18, scoreAbove50, nameEqualsAlice]) {
			expect(evaluator.evaluate(shared, {}).state).toBe('unread')
		}
	})

	it('a batch of all three is fully met against the basic subject', () => {
		const results = evaluator.batch([ageFrom18, scoreAbove50, nameEqualsAlice], BASIC_SUBJECT)
		expect(results.every((result) => result.state === 'met')).toBe(true)
	})

	it('nested paths resolve against the nested subject', () => {
		expect(
			evaluator.evaluate(createCheck(['address', 'city'], 'equals', 'NY'), NESTED_SUBJECT).state,
		).toBe('met')
		expect(
			evaluator.evaluate(createCheck(['scores', 'math'], 'from', 90), NESTED_SUBJECT).state,
		).toBe('met')
		expect(
			evaluator.evaluate(createCheck(['address', 'state'], 'equals', 'NY'), NESTED_SUBJECT).state,
		).toBe('unread')
	})

	it('the driver subject satisfies its scoring checks', () => {
		expect(evaluator.evaluate(createCheck('driverAge', 'below', 25), DRIVER_SUBJECT).state).toBe(
			'met',
		)
		expect(
			evaluator.evaluate(createCheck('violationCount', 'equals', 0), DRIVER_SUBJECT).state,
		).toBe('met')
		expect(evaluator.evaluate(createCheck('vehicleYear', 'from', 2015), DRIVER_SUBJECT).state).toBe(
			'met',
		)
	})
})

describe('Evaluator — numeric threshold precision', () => {
	it('above / from resolve exactly at the MAX_SAFE_INTEGER boundary', () => {
		const max = Number.MAX_SAFE_INTEGER
		// Equal is not strictly above; the next representable integer IS above.
		expect(evaluator.evaluate(createCheck('a', 'above', max), { a: max }).state).toBe('unmet')
		expect(evaluator.evaluate(createCheck('a', 'above', max), { a: max + 1 }).state).toBe('met')
		// from is inclusive at the boundary.
		expect(evaluator.evaluate(createCheck('a', 'from', max), { a: max }).state).toBe('met')
	})

	it('below / above resolve at MIN_VALUE (the smallest positive denormal)', () => {
		const min = Number.MIN_VALUE
		// 0 is below the smallest positive; the value itself is not below itself.
		expect(evaluator.evaluate(createCheck('a', 'below', min), { a: 0 }).state).toBe('met')
		expect(evaluator.evaluate(createCheck('a', 'below', min), { a: min }).state).toBe('unmet')
		// MIN_VALUE is strictly above 0 despite being vanishingly small.
		expect(evaluator.evaluate(createCheck('a', 'above', 0), { a: min }).state).toBe('met')
	})

	it('EPSILON: 0.1 + 0.2 diverges from 0.3 under equals but stays within EPSILON', () => {
		const subject = { a: 0.1 + 0.2 }
		// The float sum is not exactly 0.3 — equals (raw ===) fails, above holds.
		expect(evaluator.evaluate(createCheck('a', 'equals', 0.3), subject).state).toBe('unmet')
		expect(evaluator.evaluate(createCheck('a', 'above', 0.3), subject).state).toBe('met')
		// Yet it sits inside a ±EPSILON band around 0.3.
		expect(evaluator.evaluate(createCheck('a', 'below', 0.3 + Number.EPSILON), subject).state).toBe(
			'met',
		)
		expect(evaluator.evaluate(createCheck('a', 'above', 0.3 - Number.EPSILON), subject).state).toBe(
			'met',
		)
	})

	it('every EXTREME_NUMBERS value equals itself, and -0 keeps its sign in actual', () => {
		for (const value of EXTREME_NUMBERS) {
			expect(evaluator.evaluate(createCheck('a', 'equals', value), { a: value }).state).toBe('met')
		}
		// equals collapses -0 and +0 (raw ===), but the echoed actual keeps the sign.
		const negativeZero = evaluator.evaluate(createCheck('a', 'equals', 0), { a: -0 })
		expect(negativeZero.state).toBe('met')
		expect(Object.is(negativeZero.actual, -0)).toBe(true)
	})
})

describe('Evaluator — between / outside range edge cases', () => {
	it('a reversed range [40, 20] is malformed, so both read unread', () => {
		expect(evaluator.evaluate(createCheck('a', 'between', [40, 20]), { a: 30 }).state).toBe(
			'unread',
		)
		expect(evaluator.evaluate(createCheck('a', 'outside', [40, 20]), { a: 30 }).state).toBe(
			'unread',
		)
	})

	it('a NaN bound is malformed, so both read unread', () => {
		expect(evaluator.evaluate(createCheck('a', 'between', [Number.NaN, 40]), { a: 30 }).state).toBe(
			'unread',
		)
		expect(evaluator.evaluate(createCheck('a', 'outside', [Number.NaN, 40]), { a: 30 }).state).toBe(
			'unread',
		)
	})

	it('a point range at MAX_VALUE includes only that exact value', () => {
		const max = Number.MAX_VALUE
		expect(evaluator.evaluate(createCheck('a', 'between', [max, max]), { a: max }).state).toBe(
			'met',
		)
		expect(evaluator.evaluate(createCheck('a', 'between', [max, max]), { a: max / 2 }).state).toBe(
			'unmet',
		)
	})

	it('an infinite bound is no finite number, so both read unread', () => {
		const range = [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
		expect(evaluator.evaluate(createCheck('a', 'between', range), { a: 1e308 }).state).toBe(
			'unread',
		)
		expect(evaluator.evaluate(createCheck('a', 'outside', range), { a: 1e308 }).state).toBe(
			'unread',
		)
	})
})

describe('Evaluator — unicode / surrogate / combining-mark equals', () => {
	it('matches an astral (surrogate-pair) emoji value exactly', () => {
		const emoji = TRICKY_KEYS[6]
		expect(emoji).toBe('\u{1F600}')
		expect(evaluator.evaluate(createCheck('a', 'equals', emoji), { a: '\u{1F600}' }).state).toBe(
			'met',
		)
		expect(evaluator.evaluate(createCheck('a', 'equals', '\u{1F601}'), { a: emoji }).state).toBe(
			'unmet',
		)
	})

	it('ANGSTROM SIGN U+212B is not === the composed U+00C5', () => {
		// Raw === does no unicode normalization — the two Å code points are distinct.
		expect(evaluator.evaluate(createCheck('a', 'equals', 'Å'), { a: 'Å' }).state).toBe('unmet')
		expect(evaluator.evaluate(createCheck('a', 'equals', 'Å'), { a: 'Å' }).state).toBe('met')
	})

	it('a combining sequence e + U+0301 is not === the precomposed U+00E9', () => {
		expect(evaluator.evaluate(createCheck('a', 'equals', 'é'), { a: 'é' }).state).toBe('unmet')
		expect(evaluator.evaluate(createCheck('a', 'equals', 'é'), { a: 'é' }).state).toBe('met')
	})
})

describe('Evaluator — Symbol and bigint field values (no coercion)', () => {
	it('a bigint reads unread on equals', () => {
		expect(evaluator.evaluate(createCheck('a', 'equals', 10), { a: 10n }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'equals', 10n), { a: 10n }).state).toBe('unread')
	})

	it('ordering operators read unread on a bigint on either side', () => {
		expect(evaluator.evaluate(createCheck('a', 'above', 5), { a: 10n }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'above', 5n), { a: 10 }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'from', 10n), { a: 10n }).state).toBe('unread')
	})

	it('a Symbol reads unread on equals and any', () => {
		const token = Symbol('token')
		expect(evaluator.evaluate(createCheck('a', 'equals', token), { a: token }).state).toBe('unread')
		expect(
			evaluator.evaluate(createCheck('a', 'equals', Symbol('token')), { a: token }).state,
		).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'any', [token]), { a: token }).state).toBe('unread')
	})
})

describe('Evaluator — deep field path', () => {
	it('descends ~100 levels to the leaf, one past the leaf is undefined', () => {
		const deep = sequence(100).reduce<Subject>((child) => ({ child }), { leaf: 'bottom' })
		const toLeaf = [...repeatValue<string>(100, 'child'), 'leaf']
		expect(evaluator.evaluate(createCheck(toLeaf, 'equals', 'bottom'), deep).state).toBe('met')
		// One segment past the (string) leaf resolves undefined — total, never a throw.
		const pastLeaf = [...toLeaf, 'beyond']
		const result = evaluator.evaluate(createCheck(pastLeaf, 'equals', undefined), deep)
		expect(result.actual).toBeUndefined()
		expect(result.state).toBe('unread')
	})
})

describe('Evaluator — array-of-arrays and string-index paths', () => {
	it('indexes nested arrays by string keys (["a", "0", "1"])', () => {
		const subject = { a: [[10, 20]] }
		expect(evaluator.evaluate(createCheck(['a', '0', '1'], 'equals', 20), subject).state).toBe(
			'met',
		)
		expect(evaluator.evaluate(createCheck(['a', '0', '0'], 'equals', 10), subject).state).toBe(
			'met',
		)
	})

	it('a partial array path yields the inner array, which reads unread; out-of-range too', () => {
		const inner = [10, 20]
		const subject = { a: [inner] }
		// The resolved value IS the same inner array, and an array has no value to compare.
		const partial = evaluator.evaluate(createCheck(['a', '0'], 'equals', inner), subject)
		expect(partial.state).toBe('unread')
		expect(partial.actual).toBe(inner)
		expect(evaluator.evaluate(createCheck(['a', '5'], 'equals', undefined), subject).state).toBe(
			'unread',
		)
	})
})

describe('Evaluator — prototype-pollution-safe key resolution', () => {
	it('resolves no inherited prototype member off a plain object', () => {
		const subject = { own: 1 }
		// resolveField walks own properties only, so an inherited member reads as an
		// absent field rather than as the prototype's value.
		const proto = evaluator.evaluate(createCheck('__proto__', 'equals', undefined), subject)
		expect(proto.state).toBe('unread')
		expect(proto.actual).toBeUndefined()
		const ctor = evaluator.evaluate(createCheck('constructor', 'equals', undefined), subject)
		expect(ctor.state).toBe('unread')
		expect(ctor.actual).toBeUndefined()
		expect(evaluator.evaluate(createCheck('toString', 'equals', undefined), subject).state).toBe(
			'unread',
		)
		expect(evaluator.evaluate(createCheck('prototype', 'equals', undefined), subject).state).toBe(
			'unread',
		)
		// An own field on the same subject still resolves, so the walk is narrowed
		// rather than broken.
		expect(evaluator.evaluate(createCheck('own', 'equals', 1), subject).state).toBe('met')
	})

	it('cannot descend through a function value (constructor.prototype is undefined)', () => {
		// `constructor` is inherited, so the first segment already resolves to
		// undefined and Object.prototype is unreachable through it.
		const result = evaluator.evaluate(
			createCheck(['constructor', 'prototype'], 'equals', undefined),
			{
				own: 1,
			},
		)
		expect(result.actual).toBeUndefined()
		expect(result.state).toBe('unread')
	})

	it('an Object.create(null) subject exposes no inherited keys, only own fields', () => {
		const nullProto: Subject = Object.create(null)
		// `Subject`'s index signature is readonly; set the own field reflectively.
		Reflect.set(nullProto, 'real', 5)
		for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
			expect(evaluator.evaluate(createCheck(key, 'equals', undefined), nullProto).state).toBe(
				'unread',
			)
		}
		expect(evaluator.evaluate(createCheck('real', 'equals', 5), nullProto).state).toBe('met')
	})
})

describe('Evaluator — empty-string key present vs absent', () => {
	it('an absent "" key reads unread; a present one resolves its value', () => {
		// Absent — no '' own key on the basic subject.
		expect(evaluator.evaluate(createCheck('', 'equals', undefined), BASIC_SUBJECT).state).toBe(
			'unread',
		)
		expect(evaluator.evaluate(createCheck('', 'equals', 'blank'), BASIC_SUBJECT).state).toBe(
			'unread',
		)
		// Present — the '' key resolves its literal value.
		expect(evaluator.evaluate(createCheck('', 'equals', 'blank'), { '': 'blank' }).state).toBe(
			'met',
		)
	})
})

// Scale/perf regression guard: 100_000-check batches pin batch() correctness
// and throughput at a size well beyond hand-written fixtures.
describe('Evaluator — batch at scale', () => {
	it('evaluates 100_000 checks, preserving length and exact per-item correctness', () => {
		// BASIC_SUBJECT.age is 30, so `above n` is met for exactly n in 0..29.
		const checks = sequence(100_000).map((n) => createCheck('age', 'above', n))
		const results = evaluator.batch(checks, BASIC_SUBJECT)
		expect(results).toHaveLength(100_000)
		expect(results.filter((result) => result.state === 'met')).toHaveLength(30)
		// Spot-check the boundary and the far tail.
		expect(results[0]?.state).toBe('met')
		expect(results[29]?.state).toBe('met')
		expect(results[30]?.state).toBe('unmet')
		expect(results[99_999]?.state).toBe('unmet')
	})

	it('completes a 100_000 uniform (repeatValue) batch, every item met', () => {
		const checks = repeatValue(100_000, createCheck('age', 'from', 18))
		const results = evaluator.batch(checks, BASIC_SUBJECT)
		expect(results).toHaveLength(100_000)
		expect(results.every((result) => result.state === 'met')).toBe(true)
	})
})

// Scale/perf regression guard: a 100_000-element expected array pins any/none
// lookup correctness at the same scale as the batch tests above.
describe('Evaluator — any / none over a large expected array', () => {
	it('finds / excludes a member of a 100_000-element expected array exactly', () => {
		const expected = sequence(100_000)
		// 99_999 is the last member; 100_000 is one past the range.
		expect(evaluator.evaluate(createCheck('a', 'any', expected), { a: 99_999 }).state).toBe('met')
		expect(evaluator.evaluate(createCheck('a', 'none', expected), { a: 99_999 }).state).toBe(
			'unmet',
		)
		expect(evaluator.evaluate(createCheck('a', 'any', expected), { a: 100_000 }).state).toBe(
			'unmet',
		)
		expect(evaluator.evaluate(createCheck('a', 'none', expected), { a: 100_000 }).state).toBe('met')
	})
})

// Reference-equality semantics for non-record object values (Map / Set / Date /
// class instance), no-coercion ordering with a non-number side, and total
// deterministic handling of sparse expected arrays across any / none / between /
// outside — the only check kinds whose `expected` is read as an array.
describe('Evaluator — a Map / Set / Date / class instance has no value to compare', () => {
	it('a Map reads unread on equals and not, whichever reference', () => {
		const map = new Map([['x', 1]])
		expect(evaluator.evaluate(createCheck('a', 'equals', map), { a: map }).state).toBe('unread')
		expect(
			evaluator.evaluate(createCheck('a', 'equals', new Map([['x', 1]])), { a: map }).state,
		).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'not', new Map([['x', 1]])), { a: map }).state).toBe(
			'unread',
		)
	})

	it('a Set reads unread on equals and not, whichever reference', () => {
		const set = new Set([1, 2, 3])
		expect(evaluator.evaluate(createCheck('a', 'equals', set), { a: set }).state).toBe('unread')
		expect(
			evaluator.evaluate(createCheck('a', 'equals', new Set([1, 2, 3])), { a: set }).state,
		).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'not', new Set([1, 2, 3])), { a: set }).state).toBe(
			'unread',
		)
	})

	it('a Date reads unread on equals and not, whichever reference', () => {
		const date = new Date(2024, 0, 1)
		expect(evaluator.evaluate(createCheck('a', 'equals', date), { a: date }).state).toBe('unread')
		expect(
			evaluator.evaluate(createCheck('a', 'equals', new Date(2024, 0, 1)), { a: date }).state,
		).toBe('unread')
		expect(
			evaluator.evaluate(createCheck('a', 'not', new Date(2024, 0, 1)), { a: date }).state,
		).toBe('unread')
	})

	it('a class instance reads unread on equals and not, whichever reference', () => {
		class Point {
			readonly x: number
			readonly y: number
			constructor(x: number, y: number) {
				this.x = x
				this.y = y
			}
		}
		const point = new Point(1, 2)
		expect(evaluator.evaluate(createCheck('a', 'equals', point), { a: point }).state).toBe('unread')
		expect(
			evaluator.evaluate(createCheck('a', 'equals', new Point(1, 2)), { a: point }).state,
		).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'not', new Point(1, 2)), { a: point }).state).toBe(
			'unread',
		)
	})
})

describe('Evaluator — ordering operators read unread on non-number sides without throwing', () => {
	it('above / below / from / to read unread on a Date actual against a number expected', () => {
		const date = new Date(2024, 0, 1)
		expect(() => evaluator.evaluate(createCheck('a', 'above', 0), { a: date })).not.toThrow()
		expect(evaluator.evaluate(createCheck('a', 'above', 0), { a: date }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'below', 0), { a: date }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'from', 0), { a: date }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'to', 0), { a: date }).state).toBe('unread')
	})

	it('above / below / from / to read unread on a numeric string on EITHER side — no coercion', () => {
		// Numeric-string actual against a real number expected.
		expect(evaluator.evaluate(createCheck('a', 'above', 5), { a: '10' }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'below', 20), { a: '10' }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'from', 10), { a: '10' }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'to', 10), { a: '10' }).state).toBe('unread')
		// Real number actual against a numeric-string expected.
		expect(evaluator.evaluate(createCheck('a', 'above', '5'), { a: 10 }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'from', '10'), { a: 10 }).state).toBe('unread')
		// Both sides numeric strings — still unread, both must be actual numbers.
		expect(evaluator.evaluate(createCheck('a', 'from', '10'), { a: '10' }).state).toBe('unread')
	})
})

describe('Evaluator — sparse expected arrays (any / none / between / outside)', () => {
	// The Check catalog has exactly four operators that read `expected` as an
	// array: any, none, between, outside. All four are exercised below with a
	// real-hole sparse array (never `[undefined, ...]`), each scenario run
	// twice to pin deterministic, total behavior. A hole makes the list malformed.
	it('any / none read unread over a sparse array, for any actual', () => {
		const expected = sparse<number | undefined>(3, [
			[0, 7],
			[2, 9],
		])
		expect(evaluateArray('any', expected, undefined)).toBe('unread')
		expect(evaluateArray('any', expected, undefined)).toBe('unread')
		expect(evaluateArray('none', expected, undefined)).toBe('unread')
		expect(evaluateArray('none', expected, undefined)).toBe('unread')
		// A concrete member (7) and a genuine non-member (100) read unread too.
		expect(evaluator.evaluate(createCheck('a', 'any', expected), { a: 7 }).state).toBe('unread')
		expect(evaluator.evaluate(createCheck('a', 'any', expected), { a: 100 }).state).toBe('unread')
	})

	it('between / outside with a hole at index 0 or 1 read unread', () => {
		const holeAtStart = sparse<number | undefined>(2, [[1, 40]])
		expect(evaluateArray('between', holeAtStart, 30)).toBe('unread')
		expect(evaluateArray('between', holeAtStart, 30)).toBe('unread')
		expect(evaluateArray('outside', holeAtStart, 30)).toBe('unread')
		expect(evaluateArray('outside', holeAtStart, 30)).toBe('unread')

		const holeAtSecond = sparse<number | undefined>(2, [[0, 20]])
		expect(evaluator.evaluate(createCheck('a', 'between', holeAtSecond), { a: 30 }).state).toBe(
			'unread',
		)
		expect(evaluator.evaluate(createCheck('a', 'outside', holeAtSecond), { a: 30 }).state).toBe(
			'unread',
		)
	})

	it('between / outside with a hole at index 2+ read unread, since a range has two elements', () => {
		const trailingHole = sparse<number | undefined>(3, [
			[0, 20],
			[1, 40],
		])
		expect(evaluateArray('between', trailingHole, 30)).toBe('unread')
		expect(evaluateArray('between', trailingHole, 30)).toBe('unread')
		expect(evaluateArray('outside', trailingHole, 30)).toBe('unread')
		expect(evaluateArray('outside', trailingHole, 30)).toBe('unread')
	})
})
