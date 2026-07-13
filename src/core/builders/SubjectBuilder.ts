import type { EmitterInterface } from '../../emitters/index.js'
import type {
	Subject,
	SubjectBuilderEventMap,
	SubjectBuilderInterface,
	SubjectBuilderOptions,
} from '../types.js'
import { Emitter } from '../../emitters/index.js'
import { isArray } from '../../contracts/index.js'
import { assignField, mergeSubjects, removeField, repeatSubject } from '../helpers.js'
import { SUBJECT_BUILDER_BRAND } from '../constants.js'
import { ReasonError } from '../errors.js'

/**
 * A stateful workspace builder accumulating a {@link Subject}, taverna
 * `Workspace`-shaped (AGENTS §4.2.2): a single flat collection, no managers —
 * a flat sibling of `Reason.ts`.
 *
 * @remarks
 * `id` is OPTIONAL (`options?.id ?? seed.id`). When present, the builder is
 * id-ful and behaves as before. When absent, the builder is ANONYMOUS —
 * `.id` is `undefined` and the accumulated subject carries no `id` key.
 * `field(key)` / `fields()` are the AGENTS §9.1 accessor pair over TOP-LEVEL
 * keys only. `set(key, value)` delegates to `assignField`; `set('id', …)`
 * throws `ReasonError('MISMATCH', …)` — id is immutable via the entity,
 * id-ful or anonymous alike. `remove` is the AGENTS §9.2 batch overload
 * (array form declared first); removing `'id'` throws the same `MISMATCH`
 * for the same reason. `merge(incoming)` delegates to `mergeSubjects`
 * (incoming-wins, base `id` preserved — plain {@link Subject} data only).
 * `clear()` removes every non-id field, restoring `{ id }` when id-ful or
 * an empty record when anonymous. `repeat(count)` returns `count`
 * deterministic minted-id clones as PLAIN payloads — a pure read that does
 * NOT emit. `build(): Subject` is total, deterministic, and returns a fresh
 * durable payload each call. Post-destroy mutation throws
 * `ReasonError('DESTROYED', …)` — only the `emitter` getter and `destroy`
 * itself keep working, mirroring `Reason`. `destroy()` is idempotent and
 * tears the emitter down LAST (AGENTS §13).
 */
export class SubjectBuilder implements SubjectBuilderInterface {
	readonly [SUBJECT_BUILDER_BRAND]: true = true
	readonly #id: string | undefined
	readonly #emitter: Emitter<SubjectBuilderEventMap>
	#subject: Subject
	#destroyed = false

	constructor(seed: Subject, options?: SubjectBuilderOptions) {
		const id = options?.id ?? seed.id
		this.#id = typeof id === 'string' ? id : undefined
		if (typeof this.#id === 'string') {
			this.#subject = { ...seed, id: this.#id }
		} else {
			// Anonymous: strip any non-string `seed.id` (AGENTS §4.6.1 rest-omit) so
			// the accumulated subject never carries an `id` key.
			const { id: _id, ...rest } = seed
			this.#subject = rest
		}
		this.#emitter = new Emitter<SubjectBuilderEventMap>({
			on: options?.on,
			error: options?.error,
		})
	}

	get id(): string | undefined {
		return this.#id
	}

	get emitter(): EmitterInterface<SubjectBuilderEventMap> {
		return this.#emitter
	}

	field(key: string): unknown {
		this.#ensureAlive()
		return this.#subject[key]
	}

	fields(): Subject {
		this.#ensureAlive()
		return this.#subject
	}

	set(key: string, value: unknown): void {
		this.#ensureAlive()
		this.#ensureNotId(key)
		this.#subject = assignField(this.#subject, key, value)
		this.#emitter.emit('set', key, value)
	}

	// Array overload first (AGENTS §9) so a list resolves to the batch form.
	remove(keys: readonly string[]): boolean
	remove(key: string): boolean
	remove(keyOrKeys: readonly string[] | string): boolean {
		this.#ensureAlive()
		if (isArray<string>(keyOrKeys)) {
			let all = true
			for (const key of keyOrKeys) {
				if (!this.#removeOne(key)) all = false
			}
			return all
		}
		return this.#removeOne(keyOrKeys)
	}

	merge(incoming: Subject): void {
		this.#ensureAlive()
		const merged = mergeSubjects(this.#subject, incoming)
		// `mergeSubjects` only preserves a BASE id — an anonymous base has none,
		// so an incoming subject's own `id` key would otherwise survive into the
		// merged result. Strip it here so an anonymous builder never carries an
		// `id` key through this path either (AGENTS §4.6.1 rest-omit).
		if (typeof this.#id !== 'string' && Object.hasOwn(merged, 'id')) {
			const { id: _id, ...rest } = merged
			this.#subject = rest
		} else {
			this.#subject = merged
		}
		this.#emitter.emit('merge', incoming)
	}

	clear(): void {
		this.#ensureAlive()
		this.#subject = typeof this.#id === 'string' ? { id: this.#id } : {}
		this.#emitter.emit('clear')
	}

	repeat(count: number): readonly Subject[] {
		this.#ensureAlive()
		return repeatSubject(this.#subject, count)
	}

	build(): Subject {
		this.#ensureAlive()
		return { ...this.#subject }
	}

	destroy(): void {
		// Idempotent by construction: a second call re-clears an already-empty
		// destroyed flag and emits into an already-destroyed emitter (a no-op).
		this.#destroyed = true
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}

	#ensureAlive(): void {
		if (this.#destroyed) {
			throw new ReasonError('DESTROYED', 'SubjectBuilder has been destroyed')
		}
	}

	// `id` is immutable via the entity — writing or removing it through the
	// generic key-based verbs would desync `this.#id` from `this.#subject`.
	#ensureNotId(key: string): void {
		if (key === 'id') {
			throw new ReasonError('MISMATCH', 'SubjectBuilder id is immutable via this method', { key })
		}
	}

	#removeOne(key: string): boolean {
		this.#ensureNotId(key)
		const existed = Object.hasOwn(this.#subject, key)
		this.#subject = removeField(this.#subject, key)
		this.#emitter.emit('remove', key)
		return existed
	}
}
