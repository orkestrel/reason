import type { Definition } from './types.js'
import { parseJSONAs } from '@orkestrel/contract'
import { isDefinition } from './validators.js'

// Coercers for the definition family — the JSON boundary of the store-ability
// surface. Every parser here returns `T | undefined` and never throws.

/**
 * Parses a JSON string into a {@link Definition}, failing safe to `undefined`.
 *
 * @remarks
 * The safe inverse of the builders: `parseJSONAs` composed with the data guard
 * {@link isDefinition}. A built definition body IS the durable JSON payload —
 * `JSON.stringify(definition)` round-trips through `parseDefinition`. Two
 * authoring hazards: a required `Check.value: undefined` drops its key on
 * `JSON.stringify` (author `null` instead), and a `Fact.terms` element of
 * `undefined` serializes to `null` (terms must be JSON-safe scalars/strings).
 *
 * @param json - The JSON text to parse
 * @returns A {@link Definition} of any reasoning, or `undefined` when malformed
 *
 * @example
 * ```ts
 * import { createLogicalDefinition, parseDefinition } from '@src/core'
 *
 * const text = JSON.stringify(createLogicalDefinition('e', 'E', []))
 * parseDefinition(text) // the definition, restored
 * parseDefinition('{}') // undefined — fails safe
 * ```
 */
export function parseDefinition(json: string): Definition | undefined {
	return parseJSONAs(json, isDefinition)
}
