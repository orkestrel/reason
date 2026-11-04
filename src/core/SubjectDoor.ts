import type { AuditFault, ContractInterface, ContractShape } from '@orkestrel/contract'
import type { Subject, SubjectAdmission, SubjectDoorInterface } from './types.js'
import {
	admitValue,
	describeFaults,
	attempt,
	createContract,
	errorToMessage,
	FAULT_LIMIT,
	isRecord,
	isSuccess,
} from '@orkestrel/contract'
import { findFilledPaths } from './helpers.js'

/**
 * Admits a subject through a definition's shape before any reasoner reads it.
 *
 * @remarks
 * Uses `admitValue` to refuse undeclared keys, ambiguous unions, truncated audits, and lossy
 * repairs. Reports accepted repairs and filled defaults beside the admitted subject. Compiles
 * one contract per shape identity. A malformed shape or hostile subject refuses without throwing.
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
 * door.admit({ age: 30, agee: 1 }, shape).errors // ['agee: extra; this key is not declared, remove it']
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
		const admitted = admitValue(contract, subject)
		if (!isSuccess(admitted)) {
			if (admitted.error.cause !== undefined) throw admitted.error.cause
			return this.#refuse(
				admitted.error.faults,
				admitted.error.faults.length >= FAULT_LIMIT
					? [`Subject has ${String(FAULT_LIMIT)} faults or more`]
					: [],
			)
		}
		const { value: parsed, repairs } = admitted.value
		if (!isRecord(parsed)) return this.#refuse([], ['Shape does not describe a record'])
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
			errors: [...faults.map((fault) => describeFaults([fault])), ...errors],
		}
	}
}
