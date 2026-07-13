import type { QuantitativeResult, ReasonerInterface, Reasoning } from '@src/core'
import {
	atom,
	createInferentialReasoner,
	createLogicalReasoner,
	createQuantitativeReasoner,
	createReason,
	createDefinitionBuilder,
	createSubjectBuilder,
	createSymbolicReasoner,
	factorGroup,
	fieldFactor,
	inferentialDefinition,
	isReasonError,
	logicalDefinition,
	quantitativeDefinition,
	Reason,
	ReasonError,
	rule,
	symbolicDefinition,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	buildStaticDefinition,
	buildSubjects,
	captureError,
	createErrorRecorder,
	createRecorder,
	createThrowingReasoner,
	deepFreeze,
	expectLogical,
	expectQuantitative,
	recordEmitterEvents,
	sequence,
} from '../../setup.js'

// `Reason` orchestrator behavior — the registry (one reasoner per reasoning,
// re-registration replaces, fresh-array snapshots), dispatch by
// `definition.reasoning` with the four coded `ReasonError`s (MISSING / INVALID
// bypass bail and emit nothing; MISMATCH surfaces from a reasoner; DESTROYED
// gates every method after destroy), the `bail` / `validate` policies, ordered
// batch dispatch, and the emitter surface (register / reason / error / destroy
// plus the `on` hooks and the `error` listener-error handler, AGENTS §13).
// `isReasonError` narrowing is pinned here (errors.ts carries no test file of
// its own). Real reasoners plus the shared scripted throwing reasoner — no
// mocks (AGENTS §16).

// A quantitative definition reading the subject's age on top of base 100.
const AGE_DEFINITION = quantitativeDefinition(
	'age-score',
	'Age Score',
	[factorGroup('g1', 'sum', [fieldFactor('age', 'age')])],
	{ base: 100 },
)

// A one-rule forward chain: active === true concludes result === true.
const LOGICAL_DEFINITION = logicalDefinition('activation', 'Activation', [
	rule('activate', [atom('active', 'equals', true)], atom('result', 'equals', true)),
])

// The ReasonEventMap names recorded across the emitter tests.
const REASON_EVENTS = ['register', 'reason', 'error', 'destroy'] as const

describe('Reason — constructor', () => {
	it('starts empty with no options', () => {
		expect(new Reason().reasoners()).toEqual([])
	})

	it('seeds the registry from options.reasoners', () => {
		const reason = new Reason({
			reasoners: [createQuantitativeReasoner(), createLogicalReasoner()],
		})
		expect(reason.reasoners()).toHaveLength(2)
		expect(reason.supports('quantitative')).toBe(true)
		expect(reason.supports('logical')).toBe(true)
	})

	it('a later same-reasoning entry in options wins', () => {
		const first = createQuantitativeReasoner({ id: 'first' })
		const second = createQuantitativeReasoner({ id: 'second' })
		const reason = new Reason({ reasoners: [first, second] })
		expect(reason.reasoners()).toHaveLength(1)
		expect(reason.reasoner('quantitative')).toBe(second)
	})
})

describe('Reason — registry', () => {
	it('registering a second reasoner of the same reasoning replaces the first', () => {
		const reason = createReason()
		const first = createQuantitativeReasoner({ id: 'first' })
		const second = createQuantitativeReasoner({ id: 'second' })
		reason.register(first)
		reason.register(second)
		expect(reason.reasoners()).toHaveLength(1)
		expect(reason.reasoner('quantitative')).toBe(second)
	})

	it('reasoner() returns undefined when nothing is registered', () => {
		expect(createReason().reasoner('quantitative')).toBeUndefined()
	})

	it('reasoners() returns a fresh array snapshot per call', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const first = reason.reasoners()
		const second = reason.reasoners()
		expect(first).not.toBe(second)
		expect(first).toEqual(second)
	})
})

describe('Reason — validate', () => {
	it('delegates to the registered reasoner', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const validation = reason.validate(buildStaticDefinition())
		expect(validation.valid).toBe(true)
		expect(validation.errors).toEqual([])
	})

	it('a missing reasoner is an invalid RESULT here (never a throw)', () => {
		const validation = createReason().validate(buildStaticDefinition())
		expect(validation.valid).toBe(false)
		expect(validation.errors).toContain('No reasoner registered for reasoning "quantitative"')
	})
})

describe('Reason — reason (dispatch)', () => {
	it('dispatches a quantitative definition (base 100 + age 25 = 125)', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const result = expectQuantitative(reason.reason({ age: 25 }, AGE_DEFINITION))
		expect(result.success).toBe(true)
		expect(result.value).toBe(125)
	})

	it('dispatches a logical definition', () => {
		const reason = createReason({ reasoners: [createLogicalReasoner()] })
		const result = expectLogical(reason.reason({ active: true }, LOGICAL_DEFINITION))
		expect(result.success).toBe(true)
		expect(result.conclusion).toBe(true)
	})

	it('a batch subject array maps to an equal-length, order-preserving result array', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const results = reason.reason([{ age: 10 }, { age: 20 }, { age: 30 }], AGE_DEFINITION)
		expect(results).toHaveLength(3)
		expect(results.map((result) => expectQuantitative(result).value)).toEqual([110, 120, 130])
	})

	it('an EMPTY batch returns [] — bypassing even the MISSING throw and every event', () => {
		const reason = createReason() // empty registry — a single dispatch would throw MISSING
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		const results = reason.reason([], buildStaticDefinition())
		expect(results).toEqual([])
		expect(events.reason.count).toBe(0)
		expect(events.error.count).toBe(0)
	})

	it('MISSING: no reasoner registered throws a coded ReasonError with context', () => {
		const error = captureError(() => createReason().reason({}, buildStaticDefinition('orphan')))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.name).toBe('ReasonError')
		expect(error.code).toBe('MISSING')
		expect(error.message).toBe('No reasoner registered for reasoning "quantitative"')
		expect(error.context).toEqual({ definition: 'orphan', reasoning: 'quantitative' })
	})
})

describe('Reason — options (validate / bail)', () => {
	// A shape-valid definition the quantitative reasoner's validate() rejects.
	const invalid = quantitativeDefinition('invalid', 'Invalid', [])

	it('INVALID: validate true + an invalid definition throws pre-run with context', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()], validate: true })
		const error = captureError(() => reason.reason({}, invalid))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('INVALID')
		expect(error.message).toContain('Validation failed')
		expect(error.message).toContain('Definition must have at least one group')
		expect(error.context).toEqual({ definition: 'invalid', reasoning: 'quantitative' })
	})

	it('validate defaults to false — the same invalid definition still runs', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const result = expectQuantitative(reason.reason({}, invalid))
		expect(result.reasoning).toBe('quantitative')
		expect(result.success).toBe(true)
	})

	it('default bail (true) rethrows the reasoner throw untouched (not a ReasonError)', () => {
		const reason = createReason({ reasoners: [createThrowingReasoner('boom')] })
		const error = captureError(() => reason.reason({}, buildStaticDefinition()))
		expect(error).toBeInstanceOf(Error)
		expect(isReasonError(error)).toBe(false)
		if (!(error instanceof Error)) throw new Error('expected an Error')
		expect(error.message).toBe('boom')
	})

	it('bail false converts the throw into a type-shaped failure result', () => {
		const reason = createReason({ reasoners: [createThrowingReasoner('boom')], bail: false })
		const result = expectQuantitative(reason.reason({}, buildStaticDefinition()))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['boom'])
		expect(result.value).toBe(0)
		expect(result.groups).toEqual([])
		expect(result.count).toBe(0)
		expect(result.trace).toEqual([])
	})

	it('bail false shapes the failure result per reasoning — logical / symbolic / inferential', () => {
		const logical = createReason({
			reasoners: [createThrowingReasoner('boom', 'logical')],
			bail: false,
		})
		expect(logical.reason({}, logicalDefinition('d', 'd', []))).toEqual({
			reasoning: 'logical',
			conclusion: false,
			rules: [],
			count: 0,
			success: false,
			trace: [],
			errors: ['boom'],
		})

		const symbolic = createReason({
			reasoners: [createThrowingReasoner('boom', 'symbolic')],
			bail: false,
		})
		expect(symbolic.reason({}, symbolicDefinition('d', 'd', []))).toEqual({
			reasoning: 'symbolic',
			solutions: {},
			success: false,
			trace: [],
			errors: ['boom'],
		})

		const inferential = createReason({
			reasoners: [createThrowingReasoner('boom', 'inferential')],
			bail: false,
		})
		const result = inferential.reason({}, inferentialDefinition('d', 'd', [], []))
		expect(result).toEqual({
			reasoning: 'inferential',
			derived: [],
			success: false,
			trace: [],
			errors: ['boom'],
		})
		// The proof key is genuinely ABSENT, not undefined.
		expect('proof' in result).toBe(false)
	})

	it('a NON-Error throw stringifies into the failure result (the raw value still emits)', () => {
		const thrower: ReasonerInterface = {
			id: 'string-thrower',
			reasoning: 'quantitative',
			supports: (definition) => definition.reasoning === 'quantitative',
			validate: () => ({ valid: true, errors: [], warnings: [] }),
			reason: () => {
				// A deliberately non-Error throw — the String(error) branch.
				throw 'string-throw'
			},
		}
		const reason = createReason({ reasoners: [thrower], bail: false })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		const result = expectQuantitative(reason.reason({}, buildStaticDefinition()))
		expect(result.errors).toEqual(['string-throw'])
		expect(events.error.calls[0]?.[0]).toBe('string-throw')
	})

	it('validate: true repeats validation once per batch subject', () => {
		let validations = 0
		// A REAL counting reasoner (recorder-style, not a mock) — its validate
		// tallies calls, its reason returns a fixed real result.
		const counting: ReasonerInterface = {
			id: 'counting',
			reasoning: 'quantitative',
			supports: (definition) => definition.reasoning === 'quantitative',
			validate: () => {
				validations++
				return { valid: true, errors: [], warnings: [] }
			},
			reason: () => ({
				reasoning: 'quantitative',
				value: 0,
				groups: [],
				count: 0,
				success: true,
				trace: [],
				errors: [],
			}),
		}
		const reason = createReason({ reasoners: [counting], validate: true })
		reason.reason([{}, {}, {}], buildStaticDefinition())
		expect(validations).toBe(3)
	})
})

describe('Reason — destroy', () => {
	it('DESTROYED: every method throws a coded ReasonError afterwards', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		reason.destroy()
		for (const call of [
			() => reason.reasoners(),
			() => reason.reasoner('quantitative'),
			() => reason.supports('quantitative'),
			() => reason.register(createQuantitativeReasoner()),
			() => reason.validate(buildStaticDefinition()),
			() => reason.reason({}, buildStaticDefinition()),
		]) {
			const error = captureError(call)
			if (!isReasonError(error)) throw new Error('expected a ReasonError')
			expect(error.code).toBe('DESTROYED')
			expect(error.message).toBe('Reason has been destroyed')
			expect(error.context).toBeUndefined()
		}
	})

	it('destroy is idempotent', () => {
		const reason = createReason()
		reason.destroy()
		expect(() => reason.destroy()).not.toThrow()
	})

	it('the emitter getter keeps working after destroy (and reports destroyed)', () => {
		const reason = createReason()
		reason.destroy()
		expect(reason.emitter.destroyed).toBe(true)
	})
})

describe('Reason — errors (isReasonError narrowing)', () => {
	it('isReasonError accepts a ReasonError and rejects a plain Error and junk', () => {
		expect(isReasonError(new ReasonError('DESTROYED', 'gone'))).toBe(true)
		expect(isReasonError(new Error('gone'))).toBe(false)
		expect(isReasonError({ code: 'DESTROYED', message: 'gone' })).toBe(false)
		expect(isReasonError(undefined)).toBe(false)
	})

	it('a ReasonError carries its code, optional context, and the ReasonError name', () => {
		const error = new ReasonError('MISMATCH', 'wrong shape', { definition: 'd1' })
		expect(error.code).toBe('MISMATCH')
		expect(error.context).toEqual({ definition: 'd1' })
		expect(error.name).toBe('ReasonError')
		expect(error.message).toBe('wrong shape')
		expect(error).toBeInstanceOf(Error)
	})
})

describe('Reason — emitter (push observation surface)', () => {
	it('register fires with the reasoner reasoning', () => {
		const reason = createReason()
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		reason.register(createQuantitativeReasoner())
		expect(events.register.calls).toEqual([['quantitative']])
	})

	it('constructor seeding emits NO register events (hooks are wired first)', () => {
		const register = createRecorder<readonly [Reasoning]>()
		createReason({
			reasoners: [createQuantitativeReasoner()],
			on: { register: register.handler },
		})
		expect(register.count).toBe(0)
	})

	it('reason fires once with the EXACT produced result (identity)', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		const result = reason.reason({}, buildStaticDefinition())
		expect(events.reason.count).toBe(1)
		expect(events.reason.calls[0]?.[0]).toBe(result)
	})

	it('a batch fires reason once per subject, in subject order (identity per result)', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		const results = reason.reason([{}, {}, {}], buildStaticDefinition())
		expect(events.reason.count).toBe(3)
		expect(events.reason.calls.map((call) => call[0])).toEqual([...results])
		expect(events.reason.calls[0]?.[0]).toBe(results[0])
		expect(events.reason.calls[2]?.[0]).toBe(results[2])
	})

	it('re-registering the same reasoning fires register AGAIN (replacement still emits)', () => {
		const reason = createReason()
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		reason.register(createQuantitativeReasoner({ id: 'first' }))
		reason.register(createQuantitativeReasoner({ id: 'second' }))
		expect(events.register.calls).toEqual([['quantitative'], ['quantitative']])
	})

	it('error fires once under bail false — and reason does NOT fire for the failure result', () => {
		const reason = createReason({ reasoners: [createThrowingReasoner()], bail: false })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		reason.reason({}, buildStaticDefinition())
		expect(events.error.count).toBe(1)
		expect(events.error.calls[0]?.[0]).toBeInstanceOf(Error)
		expect(events.reason.count).toBe(0)
	})

	it('error fires BEFORE the rethrow under default bail too', () => {
		const reason = createReason({ reasoners: [createThrowingReasoner()] })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		expect(captureError(() => reason.reason({}, buildStaticDefinition()))).toBeInstanceOf(Error)
		expect(events.error.count).toBe(1)
	})

	it('MISSING and INVALID bypass bail and emit NOTHING', () => {
		const missing = createReason({ bail: false })
		const missingEvents = recordEmitterEvents(missing.emitter, REASON_EVENTS)
		expect(captureError(() => missing.reason({}, buildStaticDefinition()))).toBeInstanceOf(Error)
		expect(missingEvents.error.count).toBe(0)
		expect(missingEvents.reason.count).toBe(0)

		const invalid = createReason({
			reasoners: [createQuantitativeReasoner()],
			validate: true,
			bail: false,
		})
		const invalidEvents = recordEmitterEvents(invalid.emitter, REASON_EVENTS)
		expect(
			captureError(() => invalid.reason({}, quantitativeDefinition('bad', 'Bad', []))),
		).toBeInstanceOf(Error)
		expect(invalidEvents.error.count).toBe(0)
		expect(invalidEvents.reason.count).toBe(0)
	})

	it('destroy fires exactly once, even across a repeated destroy', () => {
		const reason = createReason()
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		reason.destroy()
		reason.destroy()
		expect(events.destroy.count).toBe(1)
	})

	it('off unsubscribes a listener (terrain emitters: on returns void, off detaches)', () => {
		const reason = createReason()
		const register = createRecorder<readonly [Reasoning]>()
		reason.emitter.on('register', register.handler)
		reason.emitter.off('register', register.handler)
		reason.register(createQuantitativeReasoner())
		expect(register.count).toBe(0)
	})

	it('wires initial listeners through the on option (AGENTS §8)', () => {
		const register = createRecorder<readonly [Reasoning]>()
		const reason = createReason({ on: { register: register.handler } })
		reason.register(createLogicalReasoner())
		expect(register.calls).toEqual([['logical']])
	})

	it('EMIT SAFETY: a throwing listener is isolated and routed to the error option', () => {
		const listenerErrors = createErrorRecorder()
		const reason = createReason({ error: listenerErrors.handler })
		const sibling = createRecorder<readonly [Reasoning]>()
		reason.emitter.on('register', () => {
			throw new Error('register observer blew up')
		})
		reason.emitter.on('register', sibling.handler)
		// The register still completes, the sibling still fires, the throw lands
		// in the listener-error handler with the offending event name (AGENTS §13).
		reason.register(createQuantitativeReasoner())
		expect(reason.supports('quantitative')).toBe(true)
		expect(sibling.count).toBe(1)
		expect(listenerErrors.count).toBe(1)
		expect(listenerErrors.calls[0]?.[1]).toBe('register')
	})
})

describe('Reason — large-batch orchestration & event ordering at scale', () => {
	// A REAL conditional reasoner (a scripted collaborator, not a mock): it throws
	// `fail` for a flagged subject and otherwise returns a success result whose
	// value doubles the subject's numeric `n`. Drives the mixed-batch event-order
	// paths where SOME subjects succeed and SOME make the reasoner throw.
	const conditional: ReasonerInterface = {
		id: 'conditional',
		reasoning: 'quantitative',
		supports: (definition) => definition.reasoning === 'quantitative',
		validate: () => ({ valid: true, errors: [], warnings: [] }),
		reason: (subject) => {
			if (subject.fail === true) throw new Error('fail')
			const n = subject.n
			return {
				reasoning: 'quantitative',
				value: typeof n === 'number' ? n * 2 : 0,
				groups: [],
				count: 0,
				success: true,
				trace: [],
				errors: [],
			}
		},
	}

	// Scale/perf regression guard: 1500 subjects pins order preservation and
	// per-subject emission at a batch size beyond trivial fixtures.
	it('preserves order and fires one reason per subject over a 1500-subject batch', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		const subjects = sequence(1500).map((n) => ({ age: n }))
		const results = reason.reason(subjects, AGE_DEFINITION)

		expect(results).toHaveLength(1500)
		// result[i] corresponds to subject[i]: base 100 + age i, in order.
		expect(results.every((result, index) => expectQuantitative(result).value === 100 + index)).toBe(
			true,
		)
		// One 'reason' per successful result, none dropped, and no 'error'.
		expect(events.reason.count).toBe(1500)
		expect(events.error.count).toBe(0)
		// The emitted payloads are the exact result objects, in subject order.
		expect(events.reason.calls[0]?.[0]).toBe(results[0])
		expect(events.reason.calls[1499]?.[0]).toBe(results[1499])
		reason.destroy()
	})

	it('interleaves reason / error emits positionally across a mixed batch (bail false)', () => {
		const reason = createReason({ reasoners: [conditional], bail: false })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		// 300 subjects; every 5th (n % 5 === 0) drives the reasoner to throw → 60
		// failures, 240 successes.
		const subjects = sequence(300).map((n) => ({ n, fail: n % 5 === 0 }))
		const results = reason.reason(subjects, buildStaticDefinition())

		expect(results).toHaveLength(300)
		// Positional correctness at scale: a failing slot is the type-shaped empty
		// failure (value 0, errors ['fail']); a passing slot doubles its `n`.
		expect(
			results.every((result, n) => {
				const quantitative = expectQuantitative(result)
				return n % 5 === 0
					? !quantitative.success &&
							quantitative.value === 0 &&
							quantitative.count === 0 &&
							quantitative.groups.length === 0 &&
							quantitative.errors[0] === 'fail'
					: quantitative.success && quantitative.value === n * 2
			}),
		).toBe(true)
		// bail false: every failure emits 'error' (never 'reason'); every success
		// emits exactly one 'reason'.
		expect(events.reason.count).toBe(240)
		expect(events.error.count).toBe(60)
	})

	it('bail true rethrows on the first failing subject after emitting the prior successes', () => {
		const reason = createReason({ reasoners: [conditional], bail: true })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		// 50 successes, then a failing subject, then a trailing subject that is
		// never reached because the throw escapes the batch map.
		const subjects = [
			...sequence(50).map((n) => ({ n, fail: false })),
			{ n: 50, fail: true },
			{ n: 51, fail: false },
		]
		const error = captureError(() => reason.reason(subjects, buildStaticDefinition()))

		expect(error).toBeInstanceOf(Error)
		if (!(error instanceof Error)) throw new Error('expected an Error')
		expect(error.message).toBe('fail')
		// The 50 prior successes emitted 'reason'; the failing subject emitted
		// 'error' then rethrew; the trailing subject was never dispatched.
		expect(events.reason.count).toBe(50)
		expect(events.error.count).toBe(1)
	})
})

describe('Reason — event semantics (post-guide-correction pins)', () => {
	// A REAL minimal reasoner (createThrowingReasoner's style) whose `reason`
	// RETURNS a success:false failure result without throwing.
	const REAL_FAILURE_REASONER: ReasonerInterface = {
		id: 'real-failure',
		reasoning: 'quantitative',
		supports: (definition) => definition.reasoning === 'quantitative',
		validate: () => ({ valid: true, errors: [], warnings: [] }),
		reason: () => ({
			reasoning: 'quantitative',
			value: 0,
			groups: [],
			count: 0,
			success: false,
			trace: ['deliberate failure'],
			errors: ['deliberate failure'],
		}),
	}

	it('a RETURNED success:false result fires reason exactly once (never error)', () => {
		const reason = createReason({ reasoners: [REAL_FAILURE_REASONER] })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		const result = expectQuantitative(reason.reason({}, buildStaticDefinition()))
		expect(result.success).toBe(false)
		expect(events.reason.count).toBe(1)
		expect(events.reason.calls[0]?.[0]).toBe(result)
		expect(events.error.count).toBe(0)
	})

	it('createThrowingReasoner under bail false: error fires once, a failure result returns, NO reason fires', () => {
		const reason = createReason({ reasoners: [createThrowingReasoner('boom')], bail: false })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		const result = expectQuantitative(reason.reason({}, buildStaticDefinition()))
		expect(result.success).toBe(false)
		expect(result.errors).toEqual(['boom'])
		expect(events.error.count).toBe(1)
		expect(events.error.calls[0]?.[0]).toBeInstanceOf(Error)
		expect(events.reason.count).toBe(0)
	})

	it('createThrowingReasoner under bail true: error fires then the throw propagates', () => {
		const reason = createReason({ reasoners: [createThrowingReasoner('boom')], bail: true })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		const error = captureError(() => reason.reason({}, buildStaticDefinition()))
		expect(error).toBeInstanceOf(Error)
		if (!(error instanceof Error)) throw new Error('expected an Error')
		expect(error.message).toBe('boom')
		expect(events.error.count).toBe(1)
		expect(events.reason.count).toBe(0)
	})
})

describe('Reason — error taxonomy exactness', () => {
	it('MISSING: no reasoner registered — context carries definition and reasoning, bypasses bail, emits nothing', () => {
		const reason = createReason({ bail: false })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		const error = captureError(() => reason.reason({}, buildStaticDefinition('orphan-2')))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISSING')
		expect(error.context).toEqual({ definition: 'orphan-2', reasoning: 'quantitative' })
		expect(events.error.count).toBe(0)
		expect(events.reason.count).toBe(0)
	})

	it('INVALID: validate on + a malformed definition — context carries definition and reasoning, bypasses bail, emits nothing', () => {
		const malformed = quantitativeDefinition('malformed-invalid', 'Malformed', [])
		const reason = createReason({
			reasoners: [createQuantitativeReasoner()],
			validate: true,
			bail: false,
		})
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		const error = captureError(() => reason.reason({}, malformed))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('INVALID')
		expect(error.context).toEqual({ definition: 'malformed-invalid', reasoning: 'quantitative' })
		expect(events.error.count).toBe(0)
		expect(events.reason.count).toBe(0)
	})

	it('MISMATCH: a reasoner handed a definition of the wrong reasoning — emits error, respects bail', () => {
		// Registered under 'logical' (the map key), but its `reason` internally
		// validates for 'quantitative' — mirroring QuantitativeReasoner's own
		// MISMATCH guard so a definition routed to it (reasoning: 'logical')
		// trips that internal check.
		const mismatched: ReasonerInterface = {
			id: 'mismatched',
			reasoning: 'logical',
			supports: (definition) => definition.reasoning === 'logical',
			validate: () => ({ valid: true, errors: [], warnings: [] }),
			reason: (_subject, definition) => {
				if (definition.reasoning !== 'quantitative') {
					throw new ReasonError(
						'MISMATCH',
						`Expected quantitative definition, got "${definition.reasoning}"`,
						{ definition: definition.id, reasoning: 'quantitative' },
					)
				}
				throw new Error('unreachable')
			},
		}
		const reason = createReason({ reasoners: [mismatched], bail: false })
		const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
		const result = reason.reason({}, logicalDefinition('mismatch-def', 'Mismatch', []))
		expect(result.success).toBe(false)
		expect(events.error.count).toBe(1)
		const error = events.error.calls[0]?.[0]
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('MISMATCH')
		expect(error.context).toEqual({ definition: 'mismatch-def', reasoning: 'quantitative' })
		expect(events.reason.count).toBe(0)
	})

	it('DESTROYED: after destroy() every throw carries NO context', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		reason.destroy()
		const error = captureError(() => reason.reason({}, buildStaticDefinition()))
		if (!isReasonError(error)) throw new Error('expected a ReasonError')
		expect(error.code).toBe('DESTROYED')
		expect(error.context).toBeUndefined()
	})
})

describe('Reason — no input mutation', () => {
	it('a deep-frozen definition and subject run cleanly — no throw, exact result, inputs unchanged', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const definition = deepFreeze(buildStaticDefinition('frozen-def', 7))
		const subject = deepFreeze({ age: 5, nested: { detail: { value: 1 } } })
		const definitionSnapshot = JSON.parse(JSON.stringify(definition))
		const subjectSnapshot = JSON.parse(JSON.stringify(subject))

		let result: QuantitativeResult | undefined
		expect(() => {
			result = expectQuantitative(reason.reason(subject, definition))
		}).not.toThrow()
		expect(result?.success).toBe(true)
		expect(result?.value).toBe(7)
		expect(definition).toEqual(definitionSnapshot)
		expect(subject).toEqual(subjectSnapshot)
	})
})

describe('Reason — registry scale: several hundred distinct definitions in one instance', () => {
	it('dispatches 300 distinct static definitions — pins first/middle/last and exact count, twice', () => {
		const runOnce = () => {
			const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
			const definitions = sequence(300).map((n) => buildStaticDefinition(`def-${n}`, n))
			const results = definitions.map((definition) =>
				expectQuantitative(reason.reason({}, definition)),
			)
			reason.destroy()
			return results
		}
		const first = runOnce()
		const second = runOnce()

		expect(first).toHaveLength(300)
		expect(first[0]?.value).toBe(0)
		expect(first[150]?.value).toBe(150)
		expect(first[299]?.value).toBe(299)
		expect(first.every((result) => result.success)).toBe(true)
		expect(second).toEqual(first)
	})
})

describe('Reason — batch scale beyond 1500: 7500 subjects', () => {
	// Scale/perf regression guard: 7500 subjects pins order preservation and
	// per-subject emission well past the 1500-subject batch above.
	it('7500 subjects via buildSubjects through a static definition — exact count, values, and order', () => {
		const runOnce = () => {
			const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
			const events = recordEmitterEvents(reason.emitter, REASON_EVENTS)
			const subjects = buildSubjects(7500)
			const results = reason.reason(subjects, buildStaticDefinition('scale-def', 9))
			return { results, events }
		}
		const first = runOnce()
		const second = runOnce()

		expect(first.results).toHaveLength(7500)
		expect(expectQuantitative(first.results[0]).value).toBe(9)
		expect(expectQuantitative(first.results[7499]).value).toBe(9)
		expect(first.results.every((result) => expectQuantitative(result).success)).toBe(true)
		// Order preservation: the emitted 'reason' payloads are the exact result
		// objects in subject order (identity), at the first/mid/last positions.
		expect(first.events.reason.count).toBe(7500)
		expect(first.events.reason.calls[0]?.[0]).toBe(first.results[0])
		expect(first.events.reason.calls[3750]?.[0]).toBe(first.results[3750])
		expect(first.events.reason.calls[7499]?.[0]).toBe(first.results[7499])

		expect(second.results).toEqual(first.results)
	})
})

describe('Reason — registry replace & fresh-snapshot at scale', () => {
	it('register REPLACE mid-lifecycle swaps the reasoner while the registry size holds', () => {
		const reason = createReason({
			reasoners: [
				createQuantitativeReasoner(),
				createLogicalReasoner(),
				createSymbolicReasoner(),
				createInferentialReasoner(),
			],
		})
		expect(reason.reasoners()).toHaveLength(4)

		const replacement = createQuantitativeReasoner({ id: 'replacement' })
		reason.register(replacement)
		// Same reasoning → replaced in place, not appended.
		expect(reason.reasoners()).toHaveLength(4)
		expect(reason.reasoner('quantitative')).toBe(replacement)
		expect(reason.reasoner('quantitative')?.id).toBe('replacement')
	})

	it('reasoners() is an independent fresh snapshot each call — a replacement never mutates a prior one', () => {
		const original = createQuantitativeReasoner({ id: 'original' })
		const reason = createReason({ reasoners: [original] })

		const before = reason.reasoners()
		const replacement = createQuantitativeReasoner({ id: 'replacement' })
		reason.register(replacement)
		const after = reason.reasoners()

		expect(before).not.toBe(after)
		// The earlier snapshot still pins the original reasoner; the later one the replacement.
		expect(before[0]).toBe(original)
		expect(after[0]).toBe(replacement)

		// Snapshot at scale: 100 calls, each a distinct array, all equal in content.
		const snapshots = sequence(100).map(() => reason.reasoners())
		expect(snapshots.every((snapshot) => snapshot !== after)).toBe(true)
		expect(
			snapshots.every((snapshot) => snapshot.length === 1 && snapshot[0] === replacement),
		).toBe(true)
	})
})

describe('Reason — builder build() output passed to reason() (§15)', () => {
	it('a built definition + built subject reasons identically to the same data written inline (run twice)', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const plainSubject = { age: 25 }
		const plainDefinition = AGE_DEFINITION
		const builtSubject = createSubjectBuilder({ id: 'subject-1', age: 25 }).build()
		const builtDefinition = createDefinitionBuilder(AGE_DEFINITION).build()

		const plainResult = reason.reason(plainSubject, plainDefinition)
		const builtResult = reason.reason(builtSubject, builtDefinition)

		expect(builtResult).toEqual(plainResult)
		// Run twice — determinism.
		expect(reason.reason(builtSubject, builtDefinition)).toEqual(builtResult)
	})

	it('a built definition validates identically to the same data written inline (run twice)', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const builtDefinition = createDefinitionBuilder(AGE_DEFINITION).build()

		const plainValidation = reason.validate(AGE_DEFINITION)
		const builtValidation = reason.validate(builtDefinition)

		expect(builtValidation).toEqual(plainValidation)
		expect(reason.validate(builtDefinition)).toEqual(builtValidation)
	})

	it('a mixed batch of plain and built subject payloads maps correctly (run twice)', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const plainSubject = { age: 10 }
		const builtSubject = createSubjectBuilder({ id: 'subject-2', age: 20 }).build()
		const anotherBuiltSubject = createSubjectBuilder({ id: 'subject-3', age: 30 }).build()

		const results = reason.reason([plainSubject, builtSubject, anotherBuiltSubject], AGE_DEFINITION)
		const expected = reason.reason(
			[plainSubject, builtSubject, anotherBuiltSubject],
			AGE_DEFINITION,
		)

		expect(results).toEqual(expected)
		// Run twice — determinism.
		expect(
			reason.reason([plainSubject, builtSubject, anotherBuiltSubject], AGE_DEFINITION),
		).toEqual(results)
	})
})
