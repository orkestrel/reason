import type { AuditFault } from '@orkestrel/contract'
import type {
	AggregatorInterface,
	Definition,
	EvaluatorInterface,
	Factor,
	FactorGroup,
	FactorResult,
	GroupResult,
	QuantitativeReasonerOptions,
	Reasoning,
	ReasonResult,
	ReasonValidationResult,
	ReasonerInterface,
	Subject,
	TransformerInterface,
} from '../types.js'
import { isArray, isFiniteNumber, isObject, preview, resolveField } from '@orkestrel/contract'
import {
	buildRefusedResult,
	clamp,
	combineStates,
	describeFault,
	describeMismatch,
	filterUniqueFaults,
	findDuplicates,
	readExpectedKind,
	resolveSource,
	roundTo,
	scanFactor,
	scanShape,
	scanShapeReads,
	sortByPriority,
	valueToFault,
} from '../helpers.js'
import { DEFAULT_BASE, DEFAULT_PRECISION, DEFAULT_WEIGHT, QUANTITATIVE_ID } from '../constants.js'
import { ReasonError } from '../errors.js'
import { SubjectDoor } from '../SubjectDoor.js'
import { Evaluator } from '../operators/Evaluator.js'
import { Transformer } from '../operators/Transformer.js'
import { Aggregator } from '../operators/Aggregator.js'
import { isFactorGroup, isLookupKey, isQuantitativeDefinition } from '../validators.js'

/**
 * Performs factor-based numeric scoring.
 *
 * @remarks
 * Each factor runs a fixed pipeline: checks gate (an unmet check leaves it unapplied,
 * otherwise an unread check refuses) → source resolve (an unread source refuses) →
 * finite check → transforms chain → bounds clamp → finite recheck. Factors evaluate in stable ascending `priority`
 * order; a `strict` group is all-or-nothing; a group's value is its `base` plus
 * the weighted aggregation of its applied factors, clamped (never rounded); the
 * definition's value is its `base` plus the unweighted aggregation of the
 * applied groups' values, clamped, then rounded to `precision`. An unread field,
 * an unmet check on a `required` factor, or a non-finite value appends an error
 * (`success: false`) without aborting — the numeric `value` is still computed, and
 * is no answer then. An unread field also joins `faults`. The definition-level value
 * is finite-checked after rounding: a non-finite aggregate (a `minimum` / `maximum`
 * over zero applied groups) appends an error while the `NaN` stays visible in `value`.
 * A field or range source reads a finite number and nothing else. Lookup sources read
 * only the table's own keys. A definition with a `shape` admits its subject through the
 * door first. Nothing mutates its inputs; fully deterministic.
 *
 * @example
 * ```ts
 * import {
 * 	createFactorGroup,
 * 	createQuantitativeDefinition,
 * 	createQuantitativeReasoner,
 * 	createStaticFactor,
 * } from '@orkestrel/reason'
 *
 * const reasoner = createQuantitativeReasoner()
 * const definition = createQuantitativeDefinition('risk', 'Risk', [
 * 	createFactorGroup('drivers', 'sum', [createStaticFactor('floor', 10)]),
 * ])
 * reasoner.supports(definition) // true
 * reasoner.validate(definition).valid // true
 * const result = reasoner.reason({}, definition)
 * if (result.reasoning === 'quantitative') result.value // 10
 * ```
 */
export class QuantitativeReasoner implements ReasonerInterface {
	readonly #id: string
	readonly #evaluator: EvaluatorInterface
	readonly #transformer: TransformerInterface
	readonly #aggregator: AggregatorInterface
	readonly #door = new SubjectDoor()

	constructor(options?: QuantitativeReasonerOptions) {
		this.#id = options?.id ?? QUANTITATIVE_ID
		this.#evaluator = options?.evaluator ?? new Evaluator()
		this.#transformer = options?.transformer ?? new Transformer()
		this.#aggregator = options?.aggregator ?? new Aggregator()
	}

	get id(): string {
		return this.#id
	}

	get reasoning(): Reasoning {
		return 'quantitative'
	}

	supports(definition: Definition): boolean {
		return definition.reasoning === 'quantitative'
	}

	validate(definition: Definition): ReasonValidationResult {
		if (!isObject(definition) || definition.reasoning !== 'quantitative') {
			return { valid: false, errors: [describeMismatch('quantitative', definition)], warnings: [] }
		}
		const groups: unknown = definition.groups
		if (!isQuantitativeDefinition(definition)) {
			const entries: readonly unknown[] = isArray(groups) ? groups : []
			return {
				valid: false,
				errors: [
					'Definition does not match the quantitative definition shape',
					...entries.flatMap((group, index) =>
						isFactorGroup(group) ? [] : [`Group at index ${String(index)} is malformed`],
					),
				],
				warnings: [],
			}
		}
		const shape = definition.shape
		const factors = definition.groups.flatMap((group) => group.factors)
		const scan =
			shape === undefined
				? { errors: [], warnings: [] }
				: scanShapeReads(
						shape,
						factors.flatMap((factor) => factor.checks ?? []),
						factors.flatMap((factor) =>
							factor.source.origin === 'static' ? [] : [factor.source.field],
						),
						new Set(),
					)
		const errors = [
			...(definition.id ? [] : ['Definition must have an id']),
			...(definition.name ? [] : ['Definition must have a name']),
			...(definition.groups.length === 0 ? ['Definition must have at least one group'] : []),
			...findDuplicates(definition.groups).map((id) => `Duplicate group id "${id}"`),
			...definition.groups.flatMap((group) => [
				...(group.id ? [] : ['Group must have an id']),
				...(group.factors.length === 0 ? [`Group "${group.id}" has no factors`] : []),
				...findDuplicates(group.factors).map((id) => `Duplicate factor id "${id}"`),
				...group.factors.flatMap((factor) => [
					...(factor.id ? [] : ['Factor must have an id']),
					...scanFactor(factor),
				]),
			]),
			...(shape === undefined ? [] : scanShape(shape)),
			...scan.errors,
		]
		return { valid: errors.length === 0, errors, warnings: scan.warnings }
	}

	reason(subject: Subject, definition: Definition): ReasonResult {
		if (definition.reasoning !== 'quantitative') {
			throw new ReasonError(
				'MISMATCH',
				`Expected quantitative definition, got "${definition.reasoning}"`,
				{ definition: definition.id, reasoning: this.reasoning },
			)
		}

		// Runtime never assumes validate() ran — a malformed shape is a failure
		// result, not a throw.
		if (!isArray(definition.groups)) {
			return {
				reasoning: 'quantitative',
				value: 0,
				groups: [],
				count: 0,
				success: false,
				trace: [],
				errors: ['Definition must have a "groups" array'],
				faults: [],
				repairs: [],
				defaulted: [],
			}
		}

		const admission = this.#door.admit(subject, definition.shape)
		const admitted = admission.subject
		if (admitted === undefined) return buildRefusedResult(definition, admission)

		const trace: string[] = []
		const errors: string[] = []
		const leaves: AuditFault[] = []
		if (definition.groups.length === 0) errors.push('Definition must have at least one group')
		const groupResults = definition.groups.flatMap((group, index) => {
			if (!isObject(group)) {
				errors.push(`Group at index ${String(index)} is malformed`)
				return []
			}
			if (group.enabled === false) {
				trace.push(`Skipped group "${group.id}" (disabled)`)
				return []
			}
			return [this.#evaluateGroup(group, admitted, trace, errors, leaves)]
		})
		const faults = filterUniqueFaults(leaves)
		errors.push(...faults.map((fault) => describeFault(fault)))

		const groupValues = groupResults.filter((group) => group.applied).map((group) => group.value)

		const base = definition.base ?? DEFAULT_BASE
		const raw = base + this.#aggregator.aggregate(groupValues, definition.aggregation)
		trace.push(
			`Aggregated ${groupValues.length} groups with "${definition.aggregation}": base=${base}, raw=${raw}`,
		)

		const bounded = clamp(raw, definition.bounds)
		const value = roundTo(bounded, definition.precision ?? DEFAULT_PRECISION)

		// Definition-level finite check (mirrors the factor-level formatter): a
		// minimum / maximum over zero applied groups aggregates to NaN — that is
		// the aggregator's deliberate "no data" signal, surfaced here as an error
		// while the non-finite value stays visible.
		if (!isFiniteNumber(value)) {
			const description = Number.isNaN(value) ? 'NaN' : String(value)
			trace.push(`Definition "${definition.id}": produced non-finite value (${description})`)
			errors.push(`Definition "${definition.id}" produced non-finite value: ${description}`)
		}

		return {
			reasoning: 'quantitative',
			value,
			groups: groupResults,
			count: groupValues.length,
			success: errors.length === 0,
			trace,
			errors,
			faults,
			repairs: admission.repairs,
			defaulted: admission.defaulted,
		}
	}

	// Group pipeline: stable priority sort → skip disabled → strict all-or-nothing
	// → weighted aggregation of applied values → base → clamp (never rounded).
	#evaluateGroup(
		group: FactorGroup,
		subject: Subject,
		trace: string[],
		errors: string[],
		leaves: AuditFault[],
	): GroupResult {
		if (!group.factors || group.factors.length === 0) {
			trace.push(`Group "${group.id}": no factors defined`)
			errors.push(`Group "${group.id}" has no factors`)
			return { id: group.id, applied: false, value: group.base ?? DEFAULT_BASE, factors: [] }
		}

		const factorResults = Iterator.from(sortByPriority(group.factors))
			.flatMap((factor) => {
				if (factor.enabled === false) {
					trace.push(`Skipped factor "${factor.id}" (disabled)`)
					return []
				}
				return [this.#evaluateFactor(factor, subject, trace, errors, leaves)]
			})
			.toArray()

		const appliedFactors = factorResults.filter((factor) => factor.applied)

		if (group.strict && appliedFactors.length !== factorResults.length) {
			trace.push(`Group "${group.id}" strict mode: not all factors applied`)
			return {
				id: group.id,
				applied: false,
				value: group.base ?? DEFAULT_BASE,
				factors: factorResults,
			}
		}

		const factorValues = appliedFactors.map((factor) => factor.value)
		// Weights come from the original factor list by id, not the priority-sorted
		// copy — hoisted to one id→weight Map (the first same-id twin wins, matching
		// the old `.find`) so the per-applied-factor lookup is O(1) instead of
		// O(factors).
		const weightById = new Map<string, number>()
		for (const original of group.factors) {
			if (!isObject(original)) continue
			if (!weightById.has(original.id))
				weightById.set(original.id, original.weight ?? DEFAULT_WEIGHT)
		}
		const weights = appliedFactors.map((factor) => weightById.get(factor.id) ?? DEFAULT_WEIGHT)

		const base = group.base ?? DEFAULT_BASE
		const raw = base + this.#aggregator.aggregate(factorValues, group.aggregation, weights)
		const value = clamp(raw, group.bounds)

		trace.push(
			`Group "${group.id}": ${appliedFactors.length}/${factorResults.length} factors applied, value=${value}`,
		)

		return { id: group.id, applied: appliedFactors.length > 0, value, factors: factorResults }
	}

	// Factor pipeline: checks gate → source resolve → finite check → transforms
	// → bounds clamp → finite recheck. Weight is not applied here — it feeds the
	// group aggregation. An unmet check settles the factor as unapplied, so a sibling
	// check it could not read does not refuse; only an unread gate with no unmet check
	// and an unread source refuse.
	#evaluateFactor(
		factor: Factor,
		subject: Subject,
		trace: string[],
		errors: string[],
		leaves: AuditFault[],
	): FactorResult {
		if (factor.checks && factor.checks.length > 0) {
			const checkResults = this.#evaluator.batch(factor.checks, subject)
			const gate = combineStates(
				'and',
				checkResults.map((result) => result.state),
			)
			if (gate !== 'met') {
				trace.push(`Factor "${factor.id}": checks not met`)
				if (gate === 'unmet' && factor.required) {
					errors.push(`Required factor "${factor.id}" checks not met`)
				}
				if (gate === 'unread') {
					for (const [index, result] of checkResults.entries()) {
						const check = factor.checks[index]
						if (result.state !== 'unread' || check === undefined) continue
						if (result.error === undefined) {
							leaves.push(valueToFault(result.field, readExpectedKind(check), result.actual))
						} else errors.push(`Factor "${factor.id}": ${result.error}`)
					}
				}
				return { id: factor.id, applied: false, value: 0, checks: checkResults }
			}
		}

		const resolved = resolveSource(factor.source, subject, factor.fallback)
		const raw = resolved.value
		if (raw === undefined) {
			trace.push(`Factor "${factor.id}": could not resolve source`)
			if (factor.source && factor.source.origin !== 'static') {
				const origin = factor.source.origin
				const actual = resolveField(subject, factor.source.field)
				// A readable value the table or bands miss, with no `fallback`, is no fault of the input.
				if (origin === 'lookup' ? isLookupKey(actual) : isFiniteNumber(actual)) {
					errors.push(`Factor "${factor.id}" has no value for ${preview(actual)}`)
				} else {
					leaves.push(
						valueToFault(factor.source.field, origin === 'lookup' ? 'union' : 'number', actual),
					)
				}
			} else errors.push(`Factor "${factor.id}" has no readable source`)
			// `raw` is documented as absent when the source never resolved.
			return { id: factor.id, applied: false, value: 0 }
		}
		if (resolved.fallback) trace.push(`Factor "${factor.id}": took its fallback, ${raw}`)

		if (!isFiniteNumber(raw)) {
			const description = Number.isNaN(raw) ? 'NaN' : String(raw)
			trace.push(`Factor "${factor.id}": source produced non-finite value (${description})`)
			errors.push(`Factor "${factor.id}" produced non-finite value: ${description}`)
			return { id: factor.id, applied: false, value: 0, raw }
		}

		const transformed =
			factor.transforms && factor.transforms.length > 0
				? this.#transformer.chain(raw, factor.transforms)
				: raw
		const value = clamp(transformed, factor.bounds)

		if (!isFiniteNumber(value)) {
			const description = Number.isNaN(value) ? 'NaN' : String(value)
			trace.push(`Factor "${factor.id}": produced non-finite value (${description})`)
			errors.push(`Factor "${factor.id}" produced non-finite value: ${description}`)
			return { id: factor.id, applied: false, value: 0, raw }
		}

		trace.push(`Factor "${factor.id}": raw=${raw}, value=${value}`)
		return { id: factor.id, applied: true, value, raw }
	}
}
