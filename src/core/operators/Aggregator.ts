import type { Aggregation, AggregatorInterface, AggregatorOptions } from '../types.js'
import { AGGREGATOR_ID, DEFAULT_WEIGHT } from '../constants.js'

/**
 * Reduces number lists to one number per {@link Aggregation} — the quantitative
 * reasoner's group and definition combiner.
 *
 * @remarks
 * TOTAL: never throws. Empty-input identities: `sum` / `average` → `0`,
 * `product` → `1`, `minimum` / `maximum` → `NaN` (the deliberate "no data"
 * signal). Weights are honored ONLY when their length matches `values` exactly
 * (otherwise silently unweighted): a weight multiplies into a `sum`, acts as an
 * EXPONENT for a `product`, is the weight of a weighted mean for `average`
 * (a zero total weight yields `0`, never a division blow-up), and is ignored by
 * `minimum` / `maximum`. An unknown aggregation yields `0`. Stateless and
 * deterministic.
 */
export class Aggregator implements AggregatorInterface {
	readonly #id: string

	constructor(options?: AggregatorOptions) {
		this.#id = options?.id ?? AGGREGATOR_ID
	}

	get id(): string {
		return this.#id
	}

	aggregate(
		values: readonly number[],
		aggregation: Aggregation,
		weights?: readonly number[],
	): number {
		if (values.length === 0) return this.#empty(aggregation)
		// Weights apply only on an exact length match — anything else is unweighted.
		const scaled = weights !== undefined && weights.length === values.length ? weights : undefined
		switch (aggregation) {
			case 'sum':
				return scaled
					? values.reduce(
							(total, value, index) => total + value * (scaled[index] ?? DEFAULT_WEIGHT),
							0,
						)
					: values.reduce((total, value) => total + value, 0)
			case 'product':
				return scaled
					? values.reduce(
							(total, value, index) => total * Math.pow(value, scaled[index] ?? DEFAULT_WEIGHT),
							1,
						)
					: values.reduce((total, value) => total * value, 1)
			case 'average': {
				if (scaled) {
					const totalWeight = scaled.reduce((total, weight) => total + weight, 0)
					if (totalWeight === 0) return 0
					const weightedSum = values.reduce(
						(total, value, index) => total + value * (scaled[index] ?? DEFAULT_WEIGHT),
						0,
					)
					return weightedSum / totalWeight
				}
				return values.reduce((total, value) => total + value, 0) / values.length
			}
			case 'minimum':
				// Seedless pairwise reduce (values is non-empty — #empty short-circuits
				// the 0-length case above), so an arbitrarily large list never spreads
				// past the argument-count limit. Math.min keeps NaN-propagation and the
				// -0 < +0 sign rule a `a < b ? a : b` fold would lose.
				return values.reduce((minimum, value) => Math.min(minimum, value))
			case 'maximum':
				return values.reduce((maximum, value) => Math.max(maximum, value))
			default:
				// An unknown aggregation from an untrusted definition yields 0.
				return 0
		}
	}

	// Empty-input identity per aggregation — NaN for min/max signals "no data".
	#empty(aggregation: Aggregation): number {
		switch (aggregation) {
			case 'sum':
			case 'average':
				return 0
			case 'product':
				return 1
			case 'minimum':
			case 'maximum':
				return Number.NaN
			default:
				return 0
		}
	}
}
