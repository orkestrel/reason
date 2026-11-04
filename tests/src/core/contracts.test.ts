import { createContract, seededRandom } from '@orkestrel/contract'
import {
	createAtom,
	createCheck,
	createCompound,
	createConstant,
	createExpressionShape,
	createFact,
	createFactorGroup,
	createFieldFactor,
	createInference,
	createInferentialDefinition,
	createInferentialReasoner,
	createLogicalDefinition,
	createLogicalReasoner,
	createOperation,
	createQuantitativeDefinition,
	createQuantitativeReasoner,
	createRule,
	createStaticFactor,
	createSymbolicDefinition,
	createSymbolicExpressionShape,
	createSymbolicReasoner,
	createVariable,
	createEquation,
	createDefinitionContract,
	createLogicalDefinitionContract,
	createSymbolicDefinitionContract,
	EXPRESSION_SHAPE_DEPTH,
	inferentialDefinitionContract,
	inferentialResultContract,
	isDefinition,
	isExpression,
	isReasonResult,
	isSymbolicExpression,
	logicalResultContract,
	projectResult,
	quantitativeDefinitionContract,
	quantitativeResultContract,
	resultContract,
	SYMBOLIC_SHAPE_DEPTH,
	symbolicResultContract,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	buildCycle,
	HOSTILE_PROXY,
	HOSTILE_VALUE,
	buildCompoundNest,
	buildOperationNest,
	buildSharedNest,
	dropShapeKey,
	sequence,
	sparse,
} from '../../setup.js'

// The published contracts, held in lockstep with the guards that stay the authority: anything
// `is` admits the guard admits, and the shape is bounded where the guard is not. Results cross
// as a JSON projection, because the engine publishes `NaN` by design.

const quantitative = createQuantitativeDefinition('d', 'd', [
	createFactorGroup('g', 'sum', [createFieldFactor('f', 'x'), createStaticFactor('s', 1)]),
])
const logical = createLogicalDefinition('d', 'd', [
	createRule('r', [createAtom('a', 'above', 1)], createAtom('ok', 'equals', true)),
])
const symbolic = createSymbolicDefinition('d', 'd', [
	createEquation('e', createVariable('y'), createConstant(1), 'y'),
])
const inferential = createInferentialDefinition(
	'd',
	'd',
	[createFact('f', 'p', ['a'])],
	[createInference('i', [createFact('q', 'p', ['?x'])], createFact('c', 'r', ['?x']))],
)

const definitionContract = createDefinitionContract()
const logicalDefinitionContract = createLogicalDefinitionContract()
const symbolicDefinitionContract = createSymbolicDefinitionContract()

describe('definition contracts', () => {
	it('admit what the factories build', () => {
		expect(quantitativeDefinitionContract.is(quantitative)).toBe(true)
		expect(logicalDefinitionContract.is(logical)).toBe(true)
		expect(symbolicDefinitionContract.is(symbolic)).toBe(true)
		expect(inferentialDefinitionContract.is(inferential)).toBe(true)
		for (const definition of [quantitative, logical, symbolic, inferential]) {
			expect(definitionContract.is(definition)).toBe(true)
		}
	})

	it('refuse what the guards refuse', () => {
		for (const junk of [
			{},
			null,
			'x',
			{ ...logical, reasoning: 'nope' },
			{ ...logical, extra: 1 },
		]) {
			expect(definitionContract.is(junk)).toBe(false)
			expect(isDefinition(junk)).toBe(false)
		}
	})

	it('what is admits, the guard admits', () => {
		for (const seed of sequence(200)) {
			const generated = dropShapeKey(definitionContract.generate(seededRandom(seed)))
			expect(definitionContract.is(generated)).toBe(true)
			expect(isDefinition(generated)).toBe(true)
		}
	})

	it('a schema stays small enough to travel', () => {
		expect(JSON.stringify(definitionContract.schema).length).toBeLessThan(50_000)
	})

	it('a deeper authored expression runs in memory and cannot cross on is', () => {
		const deep = createSymbolicDefinition('d', 'd', [
			createEquation('e', createVariable('y'), buildOperationNest(SYMBOLIC_SHAPE_DEPTH + 1), 'y'),
		])
		expect(symbolicDefinitionContract.is(deep)).toBe(false)
		expect(isDefinition(deep)).toBe(true)
		const result = createSymbolicReasoner().reason({ x: 1 }, deep)
		expect(result.success).toBe(true)
	})

	it('publish a schema a tool can carry', () => {
		const schema = logicalDefinitionContract.schema
		expect(schema.type).toBe('object')
		expect(schema.additionalProperties).toBe(false)
		expect(JSON.parse(JSON.stringify(schema))).toEqual(schema)
	})
})

describe('the depth the expression shapes hold', () => {
	const contract = createContract(createExpressionShape(EXPRESSION_SHAPE_DEPTH))

	it('an expression at the bound passes, and one past it is the guard alone', () => {
		const atThe = buildCompoundNest(EXPRESSION_SHAPE_DEPTH)
		expect(contract.is(atThe)).toBe(true)
		expect(isExpression(atThe)).toBe(true)
		const past = buildCompoundNest(EXPRESSION_SHAPE_DEPTH + 1)
		expect(contract.is(past)).toBe(false)
		expect(isExpression(past)).toBe(true)
	})

	it('the bounds are the ruled ones', () => {
		expect(EXPRESSION_SHAPE_DEPTH).toBe(8)
		expect(SYMBOLIC_SHAPE_DEPTH).toBe(4)
	})

	it('arity stays with validate', () => {
		const wrong = createCompound('not', [
			createAtom('a', 'equals', 1),
			createAtom('b', 'equals', 1),
		])
		expect(contract.is(wrong)).toBe(true)
	})

	it('a symbolic expression holds its own bound', () => {
		const symbolicContract = createContract(createSymbolicExpressionShape(SYMBOLIC_SHAPE_DEPTH))
		const atThe = buildOperationNest(SYMBOLIC_SHAPE_DEPTH)
		expect(symbolicContract.is(atThe)).toBe(true)
		expect(isSymbolicExpression(atThe)).toBe(true)
		const past = buildOperationNest(SYMBOLIC_SHAPE_DEPTH + 1)
		expect(symbolicContract.is(past)).toBe(false)
		expect(isSymbolicExpression(past)).toBe(true)
		expect(symbolicContract.is(createOperation('abs', createVariable('x')))).toBe(true)
	})
})

describe('result contracts read the JSON projection', () => {
	it('every reasoner, settled', () => {
		const pairs = [
			[quantitativeResultContract, createQuantitativeReasoner().reason({ x: 1 }, quantitative)],
			[logicalResultContract, createLogicalReasoner().reason({ a: 2 }, logical)],
			[symbolicResultContract, createSymbolicReasoner().reason({}, symbolic)],
			[inferentialResultContract, createInferentialReasoner().reason({}, inferential)],
		] as const
		for (const [contract, result] of pairs) {
			expect(result.success).toBe(true)
			expect(contract.is(projectResult(result))).toBe(true)
			expect(resultContract.is(projectResult(result))).toBe(true)
		}
	})

	it('a refusal, where every field carries what the engine could not read', () => {
		const result = createLogicalReasoner().reason({ a: 'x' }, logical)
		expect(result.success).toBe(false)
		expect(resultContract.is(projectResult(result))).toBe(true)
	})

	it('the raw result fails where the engine publishes NaN or an absent actual, and the projection passes', () => {
		const missing = createLogicalReasoner().reason({}, logical)
		expect(resultContract.is(missing)).toBe(false)
		expect(resultContract.is(projectResult(missing))).toBe(true)
		const empty = createQuantitativeDefinition(
			'd',
			'd',
			[createFactorGroup('g', 'minimum', [createFieldFactor('f', 'flag')])],
			{ aggregation: 'minimum' },
		)
		const noData = createQuantitativeReasoner().reason({ flag: 'x' }, empty)
		expect(Number.isNaN(noData.reasoning === 'quantitative' ? noData.value : 0)).toBe(true)
		expect(resultContract.is(noData)).toBe(false)
		expect(resultContract.is(projectResult(noData))).toBe(true)
	})

	it.each<[string, unknown]>([
		['a cycle', buildCycle()],
		['shared sub-objects', buildSharedNest(60)],
		['a throwing member', HOSTILE_VALUE],
		['a throwing proxy', HOSTILE_PROXY],
		['an array with holes', sparse<number>(3, [[0, 1]])],
		['a bigint', 1n],
		['a symbol', Symbol('s')],
	])('%s as an actual still projects to what the contract admits', (_name, actual) => {
		const projected = projectResult(createLogicalReasoner().reason({ a: actual }, logical))
		expect(resultContract.audit(projected)).toEqual([])
	})

	it('one huge actual cannot starve the checks around it', () => {
		const rules = [
			createRule('r1', [createAtom('a', 'equals', 1)], createAtom('x', 'equals', true)),
			createRule('r2', [createAtom('b', 'equals', 1)], createAtom('y', 'equals', true)),
		]
		const subject = { a: buildSharedNest(60), b: buildSharedNest(60) }
		const result = createLogicalReasoner().reason(subject, createLogicalDefinition('d', 'd', rules))
		expect(resultContract.audit(projectResult(result))).toEqual([])
	})

	it('a quantitative check and its value project too', () => {
		const gated = createQuantitativeDefinition('d', 'd', [
			createFactorGroup('g', 'sum', [
				createStaticFactor('f', 1, { checks: [createCheck('a', 'equals', 1)] }),
			]),
		])
		const result = createQuantitativeReasoner().reason({ a: buildSharedNest(60) }, gated)
		expect(resultContract.audit(projectResult(result))).toEqual([])
	})

	it('the in-memory result and its guard stay as they were', () => {
		const result = createLogicalReasoner().reason({}, logical)
		expect(isReasonResult(result)).toBe(true)
	})
})
