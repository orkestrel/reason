// === Result

/**
 * Discriminated success branch of a {@link Result}.
 *
 * @remarks
 * Used for operations that can succeed or fail without throwing.
 */
export interface Success<T> {
	readonly success: true
	readonly value: T
}

/**
 * Discriminated failure branch of a {@link Result}.
 *
 * @remarks
 * Carries the error value when an operation does not succeed.
 */
export interface Failure<E> {
	readonly success: false
	readonly error: E
}

/** Discriminated union for operations that can succeed or fail without throwing. */
export type Result<T, E = Error> = Success<T> | Failure<E>

// === Deferred

/**
 * A manually-settled promise handle: the `promise` together with the `resolve`
 * and `reject` functions lifted out of its executor.
 *
 * @remarks
 * The standard captured-resolver idiom — construct one with {@link createDeferred}
 * when an operation must settle a promise from outside the executor body (a pump
 * that resolves on completion, a count-based completion gate). The returned
 * handle exposes the promise plus its settle functions so unrelated code can
 * drive it; the underlying promise still obeys native settle-once semantics
 * (the first `resolve` / `reject` wins, later calls are no-ops on the promise).
 */
export interface DeferredInterface<T> {
	readonly promise: Promise<T>
	readonly resolve: (value: T) => void
	readonly reject: (error: unknown) => void
}

// === Record access

/**
 * A field path into a record: a single key, or an ordered list of keys to
 * descend through nested objects.
 *
 * @remarks
 * A single `string` is ONE key — it is never split on `.`, so keys that contain
 * dots stay safe. Use a `readonly string[]` to descend into nested objects.
 */
export type FieldPath = string | readonly string[]
