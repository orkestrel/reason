import type { AuditFault, ContractInterface, ContractShape } from '@orkestrel/contract'
import type { Subject, SubjectAdmission, SubjectDoorInterface } from './types.js'
import {
	attempt,
	createContract,
	errorToMessage,
	FAULT_LIMIT,
	isRecord,
	isSuccess,
	resolveField,
} from '@orkestrel/contract'
import { describeFault, findFilledPaths, isLosslessRepair } from './helpers.js'

/**
 * Admits a subject through a definition's shape before any reasoner reads it.
 *
 * @remarks
 * Reads `contract`'s two domains the way they are built: `explain` for what `parse` cannot
 * answer, and `audit` for what `parse` answered by changing the value. It refuses, in order,
 * an `explain` fault; an undeclared key, because `parse` would drop it and a typo beside a
 * default would then read as an answer; an audit at `FAULT_LIMIT`, because the next fault is
 * hidden; a `variant` or `oneOf` fault, because a union repairs by declaration order; and any
 * repair that loses information. Accepted repairs and filled defaults are reported beside the
 * parsed subject. One contract is compiled per shape, by identity, so one door serves many
 * subjects. A malformed shape or a hostile subject refuses, and never throws.
 *
 * @example
 * ```ts
 * import { numberShape, objectShape } from '@orkestrel/contract'
 * import { SubjectDoor } from '@orkestrel/reason'
 *
 * const door = new SubjectDoor()
 * const shape = objectShape({ age: numberShape() })
 * door.admit({ age: '30' }, shape).subject // { age: 30 }
 * door.admit({ age: '30.0' }, shape).subject // undefined — the repair would lose the text
 * door.admit({ age: 30, agee: 1 }, shape).errors // ['Field "agee" is not declared']
 * ```
 */
export class SubjectDoor implements SubjectDoorInterface {
	readonly #contracts = new WeakMap<ContractShape, ContractInterface<unknown>>()

	admit(subject: Subject, shape?: ContractShape): SubjectAdmission {
		if (shape === undefined) return { subject, faults: [], repairs: [], defaulted: [], errors: [] }
		const outcome = attempt(() => this.#read(subject, shape))
		if (isSuccess(outcome)) return outcome.value
		const message = errorToMessage(outcome.error)
		return { faults: [], repairs: [], defaulted: [], errors: [`Subject refused: ${message}`] }
	}

	#read(subject: Subject, shape: ContractShape): SubjectAdmission {
		const contract = this.#compile(shape)
		const audited = contract.audit(subject)
		const explained = contract.explain(subject)
		if (explained.length > 0) {
			return this.#refuse([...explained, ...audited.filter((fault) => fault.reason === 'extra')])
		}
		if (audited.length >= FAULT_LIMIT) {
			return this.#refuse(audited, [`Subject has ${String(FAULT_LIMIT)} faults or more`])
		}
		const parsed = contract.parse(subject)
		if (!isRecord(parsed)) return this.#refuse([], ['Shape does not describe a record'])
		// A key holding undefined is absent, which `parse` has already answered, so it changes nothing.
		const repairs = audited.filter(
			(fault) => fault.reason !== 'type' || resolveField(subject, fault.path) !== undefined,
		)
		// An undeclared key and a union fault are no repair, so they refuse here with the rest.
		const lossy = repairs.filter((fault) => !isLosslessRepair(fault, subject, parsed))
		if (lossy.length > 0) return this.#refuse(lossy)
		return {
			subject: parsed,
			faults: [],
			repairs,
			defaulted: findFilledPaths(subject, parsed),
			errors: [],
		}
	}

	#compile(shape: ContractShape): ContractInterface<unknown> {
		const known = this.#contracts.get(shape)
		if (known !== undefined) return known
		const contract = createContract(shape)
		this.#contracts.set(shape, contract)
		return contract
	}

	#refuse(faults: readonly AuditFault[], errors: readonly string[] = []): SubjectAdmission {
		return {
			faults,
			repairs: [],
			defaulted: [],
			errors: [...faults.map((fault) => describeFault(fault)), ...errors],
		}
	}
}
