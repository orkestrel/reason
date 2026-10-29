import { ReasonError, isReasonError } from '@src/core'
import { describe, expect, it } from 'vitest'

describe('isReasonError', () => {
	it('accepts a class-instance context', () => {
		class Context {
			readonly [key: string]: unknown
			readonly offset = 8
		}

		const context: Readonly<Record<string, unknown>> = new Context()
		const error = new ReasonError('INVALID', 'invalid', context)
		expect(isReasonError(error)).toBe(true)
	})

	it('accepts a callable context', () => {
		const members: Readonly<Record<string, unknown>> = { offset: 8 }
		const context = Object.assign(() => undefined, members)
		const error = new ReasonError('INVALID', 'invalid', context)
		expect(isReasonError(error)).toBe(true)
	})
})
