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
	Source,
	Subject,
	TransformerInterface,
} from '../types.js'
import { parseNumberField } from '../../contracts/index.js'
import { resolveField } from '../../helpers.js'
import { clamp, findDuplicates, roundTo, sortByPriority } from '../helpers.js'
import { DEFAULT_BASE, DEFAULT_PRECISION, DEFAULT_WEIGHT, QUANTITATIVE_ID } from '../constants.js'
import { ReasonError } from '../errors.js'
import { Evaluator } from '../operators/Evaluator.js'
import { Transformer } from '../operators/Transformer.js'
import { Aggregator } from '../operators/Aggregator.js'

/**
 * The quantitative reasoner — factor-based numeric scoring.
 *
 * @remarks
 * Each factor runs a fixed pipeline: checks gate (ALL met) → source resolve
 * (`fallback` when unresolvable) → finite check → transforms chain → bounds
 * clamp → finite recheck. Factors evaluate in stable ascending `priority`
 * order; a `strict` group is all-or-nothing; a group's value is its `base` plus
 * the weighted aggregation of its APPLIED factors, clamped (never rounded); the
 * definition's value is its `base` plus the unweighted aggregation of the
 * APPLIED groups' values, clamped, then rounded to `precision`. A
 * required-factor failure or non-finite value appends an error (`success:
 * false`) without aborting — the numeric `value` is always computed. The
 * definition-level value is finite-checked AFTER rounding: a non-finite
 * aggregate (a `minimum` / `maximum` over zero applied groups) appends an error
 * while the `NaN` stays visible in `value`. Field sources coerce through the
 * contracts `parseNumberField`: a non-finite subject number or a non-numeric
 * string is unresolvable and takes the fallback path. Lookup sources read only
 * OWN table keys, and a missing / `null` field falls back directly. Nothing
 * mutates its inputs; fully deterministic (AGENTS §11).
 */
export class QuantitativeReasoner implements ReasonerInterface {
	readonly #id: string
	readonly #evaluator: EvaluatorInterface
	readonly #transformer: TransformerInterface
	readonly #aggregator: AggregatorInterface

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
		const errors: string[] = []
		const warnings: string[] = []

		if (definition.reasoning !== 'quantitative') {
			errors.push(`Expected reasoning "quantitative", got "${definition.reasoning}"`)
			return { valid: false, errors, warnings }
		}

		if (!definition.id) errors.push('Definition must have an id')
		if (!definition.name) errors.push('Definition must have a name')
		if (!definition.groups || definition.groups.length === 0) {
			errors.push('Definition must have at least one group')
		}

		// Duplicate ids are WARNINGS (runtime stays permissive: a weight lookup
		// takes the FIRST same-id twin) — once per duplicated id.
		for (const id of findDuplicates(definition.groups ?? [])) {
			warnings.push(`Duplicate group id "${id}"`)
		}

		for (const group of definition.groups ?? []) {
			if (!group.id) errors.push('Group must have an id')
			if (!group.factors || group.factors.length === 0) {
				warnings.push(`Group "${group.id}" has no factors`)
			}
			for (const id of findDuplicates(group.factors ?? [])) {
				warnings.push(`Duplicate factor id "${id}"`)
			}
			for (const factor of group.factors ?? []) {
				if (!factor.id) errors.push('Factor must have an id')
				if (!factor.source) errors.push(`Factor "${factor.id}" must have a source`)
			}
		}

		return { valid: errors.length === 0, errors, warnings }
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
		if (!definition.groups || !Array.isArray(definition.groups)) {
			return {
				reasoning: 'quantitative',
				value: 0,
				groups: [],
				count: 0,
				success: false,
				trace: [],
				errors: ['Definition must have a "groups" array'],
			}
		}

		const trace: string[] = []
		const errors: string[] = []
		let count = 0

		const groupResults: GroupResult[] = []
		for (const group of definition.groups) {
			if (typeof group !== 'object' || group === null) continue
			if (group.enabled === false) {
				trace.push(`Skipped group "${group.id}" (disabled)`)
				continue
			}
			const groupResult = this.#evaluateGroup(group, subject, trace, errors)
			groupResults.push(groupResult)
			if (groupResult.applied) count++
		}

		const groupValues = groupResults.filter((group) => group.applied).map((group) => group.value)

		const base = definition.base ?? DEFAULT_BASE
		let value = base + this.#aggregator.aggregate(groupValues, definition.aggregation)
		trace.push(
			`Aggregated ${groupValues.length} groups with "${definition.aggregation}": base=${base}, raw=${value}`,
		)

		value = clamp(value, definition.bounds)
		value = roundTo(value, definition.precision ?? DEFAULT_PRECISION)

		// Definition-level finite check (mirrors the factor-level formatter): a
		// minimum / maximum over zero applied groups aggregates to NaN — that is
		// the aggregator's deliberate "no data" signal, surfaced here as an error
		// while the non-finite value stays visible.
		if (!Number.isFinite(value)) {
			const description = Number.isNaN(value) ? 'NaN' : String(value)
			trace.push(`Definition "${definition.id}": produced non-finite value (${description})`)
			errors.push(`Definition "${definition.id}" produced non-finite value: ${description}`)
		}

		return {
			reasoning: 'quantitative',
			value,
			groups: groupResults,
			count,
			success: errors.length === 0,
			trace,
			errors,
		}
	}

	// Group pipeline: stable priority sort → skip disabled → strict all-or-nothing
	// → weighted aggregation of applied values → base → clamp (never rounded).
	#evaluateGroup(
		group: FactorGroup,
		subject: Subject,
		trace: string[],
		errors: string[],
	): GroupResult {
		if (!group.factors || group.factors.length === 0) {
			trace.push(`Group "${group.id}": no factors defined`)
			return { id: group.id, applied: false, value: group.base ?? DEFAULT_BASE, factors: [] }
		}

		const factorResults: FactorResult[] = []
		for (const factor of sortByPriority(group.factors)) {
			if (factor.enabled === false) {
				trace.push(`Skipped factor "${factor.id}" (disabled)`)
				continue
			}
			factorResults.push(this.#evaluateFactor(factor, subject, trace, errors))
		}

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
		// Weights come from the ORIGINAL factor list by id, not the priority-sorted
		// copy — hoisted to one id→weight Map (FIRST same-id twin wins, matching the
		// old `.find`) so the per-applied-factor lookup is O(1) instead of O(factors).
		const weightById = new Map<string, number>()
		for (const original of group.factors) {
			if (typeof original !== 'object' || original === null) continue
			if (!weightById.has(original.id))
				weightById.set(original.id, original.weight ?? DEFAULT_WEIGHT)
		}
		const weights = appliedFactors.map((factor) => weightById.get(factor.id) ?? DEFAULT_WEIGHT)

		const base = group.base ?? DEFAULT_BASE
		let value = base + this.#aggregator.aggregate(factorValues, group.aggregation, weights)
		value = clamp(value, group.bounds)

		trace.push(
			`Group "${group.id}": ${appliedFactors.length}/${factorResults.length} factors applied, value=${value}`,
		)

		return { id: group.id, applied: appliedFactors.length > 0, value, factors: factorResults }
	}

	// Factor pipeline: checks gate → source resolve → finite check → transforms
	// → bounds clamp → finite recheck. Weight is NOT applied here — it feeds the
	// group aggregation.
	#evaluateFactor(
		factor: Factor,
		subject: Subject,
		trace: string[],
		errors: string[],
	): FactorResult {
		if (factor.checks && factor.checks.length > 0) {
			const checkResults = this.#evaluator.batch(factor.checks, subject)
			const allMet = checkResults.every((result) => result.met)
			if (!allMet) {
				trace.push(`Factor "${factor.id}": checks not met`)
				if (factor.required) {
					errors.push(`Required factor "${factor.id}" checks not met`)
				}
				return { id: factor.id, applied: false, value: 0, checks: checkResults }
			}
		}

		const raw = this.#resolveSource(factor.source, subject, factor.fallback)
		if (raw === undefined) {
			trace.push(`Factor "${factor.id}": could not resolve source`)
			if (factor.required) {
				errors.push(`Required factor "${factor.id}" could not resolve source`)
			}
			// `raw` is documented as ABSENT when the source never resolved.
			return { id: factor.id, applied: false, value: 0 }
		}

		if (!Number.isFinite(raw)) {
			const description = Number.isNaN(raw) ? 'NaN' : String(raw)
			trace.push(`Factor "${factor.id}": source produced non-finite value (${description})`)
			errors.push(`Factor "${factor.id}" produced non-finite value: ${description}`)
			return { id: factor.id, applied: false, value: 0, raw }
		}

		let value = raw
		if (factor.transforms && factor.transforms.length > 0) {
			value = this.#transformer.chain(value, factor.transforms)
		}

		value = clamp(value, factor.bounds)

		if (!Number.isFinite(value)) {
			const description = Number.isNaN(value) ? 'NaN' : String(value)
			trace.push(`Factor "${factor.id}": produced non-finite value (${description})`)
			errors.push(`Factor "${factor.id}" produced non-finite value: ${description}`)
			return { id: factor.id, applied: false, value: 0, raw }
		}

		trace.push(`Factor "${factor.id}": raw=${raw}, value=${value}`)
		return { id: factor.id, applied: true, value, raw }
	}

	// Source resolution: static passes through; field/range coerce via parseNumberField
	// (non-finite / non-numeric → fallback); lookup stringifies PRESENT values into
	// the table's OWN keys (missing/null field and absent/inherited key → fallback).
	#resolveSource(source: Source, subject: Subject, fallback?: number): number | undefined {
		// A malformed factor may carry no source at all — the fallback path, not a crash.
		if (!source) return fallback
		switch (source.origin) {
			case 'static':
				return source.value
			case 'field':
				return parseNumberField(subject, source.field) ?? fallback
			case 'lookup': {
				const resolved = resolveField(subject, source.field)
				// A missing / null field never reaches the table (a '' key must not
				// intercept absent data); a PRESENT value still stringifies, so a
				// real '' value may hit a '' key.
				if (resolved === undefined || resolved === null) return fallback
				const key = String(resolved)
				return Object.hasOwn(source.table, key) ? source.table[key] : fallback
			}
			case 'range': {
				const value = parseNumberField(subject, source.field)
				if (value === undefined) return fallback
				for (const range of source.ranges) {
					if (typeof range !== 'object' || range === null) continue
					const bounds = range.bounds
					// A band without bounds is a catch-all; an absent side is open.
					if (!bounds) return range.value
					const aboveMinimum = bounds.minimum === undefined || value >= bounds.minimum
					const belowMaximum = bounds.maximum === undefined || value <= bounds.maximum
					if (aboveMinimum && belowMaximum) return range.value
				}
				return fallback
			}
			default:
				return fallback
		}
	}
}
