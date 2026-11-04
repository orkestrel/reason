import type { ContractInterface } from '@orkestrel/contract'
import { createContract } from '@orkestrel/contract'
import {
	inferentialDefinitionShape,
	inferentialResultShape,
	logicalResultShape,
	quantitativeDefinitionShape,
	quantitativeResultShape,
	resultShape,
	symbolicResultShape,
} from './shapers.js'

/**
 * Publishes a `QuantitativeDefinition` as a contract. Cross it on `is`.
 *
 * @remarks
 * `is` validates the nested `shape` through the dependency's shape contract.
 */
export const quantitativeDefinitionContract: ContractInterface<unknown> = createContract(
	quantitativeDefinitionShape,
)

/**
 * Publishes an `InferentialDefinition` as a contract. Cross it on `is`.
 *
 * @remarks
 * `is` validates the nested `shape` through the dependency's shape contract.
 */
export const inferentialDefinitionContract: ContractInterface<unknown> = createContract(
	inferentialDefinitionShape,
)

/** Publishes any `ReasonResult`'s JSON projection as a contract, read through `projectResult`. */
export const resultContract: ContractInterface<unknown> = createContract(resultShape)

/** Publishes a `QuantitativeResult`'s JSON projection as a contract. */
export const quantitativeResultContract: ContractInterface<unknown> =
	createContract(quantitativeResultShape)

/** Publishes a `LogicalResult`'s JSON projection as a contract. */
export const logicalResultContract: ContractInterface<unknown> = createContract(logicalResultShape)

/** Publishes a `SymbolicResult`'s JSON projection as a contract. */
export const symbolicResultContract: ContractInterface<unknown> =
	createContract(symbolicResultShape)

/** Publishes an `InferentialResult`'s JSON projection as a contract. */
export const inferentialResultContract: ContractInterface<unknown> =
	createContract(inferentialResultShape)
