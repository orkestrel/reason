// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest. The constants that follow are this
// package's own, as is the executed section that closes the file.

import { describe, expect, it } from 'vitest'
import {
	appendFactor,
	appendGroup,
	createAggregator,
	createAtom,
	createBounds,
	createCheck,
	createCompound,
	createConstant,
	createDefinitionBuilder,
	createEquation,
	createEvaluator,
	createFact,
	createFactorGroup,
	createFieldFactor,
	createInference,
	createInferentialDefinition,
	createInferentialReasoner,
	createLogicalDefinition,
	createLogicalReasoner,
	createLookupFactor,
	createOperation,
	createQuantitativeDefinition,
	createQuantitativeReasoner,
	createReason,
	createRule,
	createStaticFactor,
	createSubjectBuilder,
	createSymbolicDefinition,
	createSymbolicReasoner,
	createTransform,
	createTransformer,
	createVariable,
	mergeQuantitativeDefinition,
	parseDefinition,
	replaceGroup,
	roundTo,
} from '@src/core'
import {
	computeSymbolKey,
	createGuide,
	createSource,
	createSourceManager,
	extractFenceImports,
	findDrift,
	findMissing,
	findMissingSymbols,
	findUnexampled,
	findUnlisted,
	isExternalLink,
	parseManifest,
	resolveLink,
} from '@orkestrel/guide'
import { readFileSync } from 'node:fs'
import { requireValue } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'
import { expectInferential, expectLogical, expectQuantitative, expectSymbolic } from './setup.js'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** The one guide this package sources, whose tagline the README pitch equals. */
const GUIDE_SPEC = 'guides/reason.md'
/** Each import specifier this package's own guides may resolve against. */
const MODULES = Object.freeze({ '@orkestrel/reason': 'src/core', '@src/core': 'src/core' })
/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its single consumer cannot become a
 * local, so it stays exported without being public. Naming it here is what makes that
 * intentional rather than forgotten — and the assertion that follows it fails when a name
 * here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze(['class Collection'])

/** Root-level files these checks read. `readInventory` walks directories only. */
const ROOT_FILES = Object.freeze(['AGENTS.md', 'README.md'])

const root = new URL('../', import.meta.url)
const files: Record<string, string> = {
	...readInventory(root, ['src', 'guides', 'tests'], { extensions: ['.ts', '.md'] }),
}
for (const name of ROOT_FILES) files[name] = readFileSync(new URL(name, root), 'utf8')
const manifest = parseManifest(
	requireValue(files['guides/README.md'], 'Missing file: guides/README.md'),
	'guides',
)
const sources = createSourceManager({ files, modules: MODULES })
const own = requireValue(
	manifest.find((entry) => entry.spec === GUIDE_SPEC),
	`Missing manifest row: ${GUIDE_SPEC}`,
)

it('manifest lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
})

// The example half of the equality case is silent over an empty population: with no
// title on both sides `findDrift` compares no pair and the case passes on the summaries
// alone. This pins the population this repository's own guide contributes, so removing
// every `@example` title reddens the suite instead of quietly retiring half the gate.
// The failure names both title sets, because a pin reporting only its own emptiness
// leaves the reader to work out which side dropped the title.
it('pairs at least one example title across the guide and the source', () => {
	const guide = createGuide(requireValue(files[GUIDE_SPEC], `Missing file: ${GUIDE_SPEC}`))
	const source = createSource({ files, module: own.source })
	const declared = source
		.examples()
		.map((example) => example.title)
		.filter((title) => title !== undefined)
	const titled = new Set(declared)
	const headings: string[] = []
	const paired: string[] = []
	for (const fence of guide.fences()) {
		if (fence.title === undefined) continue
		headings.push(fence.title)
		if (titled.has(fence.title)) paired.push(fence.title)
	}
	const unpaired =
		paired.length > 0
			? []
			: [
					`${GUIDE_SPEC} pairs: guide ${JSON.stringify(headings)} source ${JSON.stringify(declared)}`,
				]
	expect(unpaired).toEqual([])
})

// The README's pitch and the guide's tagline are one text, each read as the blockquote
// under its file's H1. `README.md` is outside the concept index, so the reader is
// applied to it directly rather than through a manifest row. Each side is guarded
// against `undefined` first, so a file that lost its blockquote reports that rather
// than reporting two absences as agreement.
it('opens the README with the guide tagline', () => {
	const pitch = createGuide(requireValue(files['README.md'], 'Missing file: README.md')).tagline()
	const tagline = createGuide(
		requireValue(files[GUIDE_SPEC], `Missing file: ${GUIDE_SPEC}`),
	).tagline()

	expect(pitch).not.toBeUndefined()
	expect(tagline).not.toBeUndefined()
	expect(pitch).toBe(tagline)
})

for (const entry of manifest) {
	const guide = createGuide(requireValue(files[entry.spec], `Missing file: ${entry.spec}`))
	const source = createSource({ files, module: entry.source })

	describe(`${entry.concept}`, () => {
		it('uses only listed fence languages', () => {
			expect(findUnlisted(guide.fences(), FENCE_LANGUAGES)).toEqual([])
		})

		it('extracts a non-empty documented surface', () => {
			expect(guide.surface().length).toBeGreaterThan(0)
		})
		it('re-exports every direct declaration that is not named internal', () => {
			const stranded = findMissingSymbols(source.exports(), source.surface())
			expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
		})
		it('names no symbol internal that the barrel already exports', () => {
			const stranded = findMissingSymbols(source.exports(), source.surface())
			expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
		})
		it('re-exports only direct declarations', () => {
			expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
		})
		it('documents every barrel export', () => {
			expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
		})
		it('documents only barrel exports', () => {
			expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
		})

		it('exposes no hidden module-scope declarations', () => {
			expect(source.hidden().map(computeSymbolKey)).toEqual([])
		})

		for (const group of guide.methods()) {
			const members = source.methods(group.interface).map((method) => method.name)
			const documented = group.methods.map((method) => method.name)
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface}`, () => {
				it('documents at least one method', () => {
					expect(group.methods.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, documented)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(documented, members)).toEqual([])
				})
				it(`${entity} exposes no undocumented method`, () => {
					const extra =
						entity === group.interface
							? []
							: findMissing(
									source.methods(entity).map((method) => method.name),
									documented,
								)
					expect(extra).toEqual([])
				})
			})
		}

		// The equality gate: a `Summary` cell against its export's description paragraph, a
		// titled fence against the `@example` of that title. `findDrift` owns the comparison
		// and names both sides; converge the two sides with `npm run docs`, never by
		// weakening this assertion. `findDrift` pairs an example only where a title is
		// present on both sides, so an untitled `@example` block is outside this case. Each
		// collected line is the spec, the key, and each side's text or `absent` — the same
		// worklist `npm run docs` prints, so a failure here is read the way that command's
		// output is.
		it('keeps every compared summary and example equal to its source', () => {
			const disagreeing: string[] = []
			for (const drift of findDrift(guide, source)) {
				const left = drift.guide === undefined ? 'absent' : JSON.stringify(drift.guide)
				const right = drift.source === undefined ? 'absent' : JSON.stringify(drift.source)
				disagreeing.push(`${entry.spec} ${drift.key}: guide ${left} source ${right}`)
			}
			expect(disagreeing).toEqual([])
		})

		it('documents an example for every Surface function', () => {
			const fences = guide
				.fences()
				.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
				.map((fence) => fence.code)
			const names = guide
				.surface()
				.filter((symbol) => symbol.keyword === 'function')
				.map((symbol) => symbol.name)
			expect(
				findUnexampled(
					names,
					fences,
					source.examples().map((example) => example.name),
				),
			).toEqual([])
		})

		for (const group of guide.methods()) {
			const entity = group.interface.replace(/Interface$/, '')
			const documented = group.methods.map((method) => method.name)
			const examples =
				entity === group.interface
					? source.examples(group.interface).map((example) => example.name)
					: source
							.examples(group.interface)
							.map((example) => example.name)
							.concat(source.examples(entity).map((example) => example.name))
			describe(`${group.interface} examples`, () => {
				it('documents an example for every method', () => {
					const fences = guide
						.fences()
						.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
						.map((fence) => fence.code)
					expect(findUnexampled(documented, fences, examples)).toEqual([])
				})
			})
		}

		it('imports only real exports in every ```ts fence', () => {
			const fences = guide.fences().filter((fence) => fence.language === EXAMPLE_LANGUAGE)
			for (const fence of fences) {
				for (const { specifier, names } of extractFenceImports(fence.code)) {
					const imported = sources.source(specifier)
					if (imported === undefined) continue
					const surface = imported.surface().map((symbol) => symbol.name)
					expect(findMissing(names, surface)).toEqual([])
				}
			}
		})

		it('resolves every relative link', () => {
			const broken = guide
				.links()
				.filter((href) => !isExternalLink(href))
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(broken).toEqual([])
		})
		it('links only to test files that exist', () => {
			const missing = guide
				.tests()
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(missing).toEqual([])
		})
	})
}

// The parity assertions above resolve NAMES. A fence that states a value its
// code contradicts passes every one of them, so each flagship fence of
// `guides/reason.md` is transcribed here and its trailing-comment values are
// asserted against what the code actually returns. Change a fence, change the
// transcription beside it.

describe('flagship fences', () => {
	it('§ Surface — the orchestrator round trip', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const definition = createQuantitativeDefinition('risk', 'Risk score', [
			createFactorGroup('drivers', 'sum', [
				createFieldFactor('age', 'age'),
				createStaticFactor('floor', 10),
			]),
		])

		const result = expectQuantitative(reason.reason({ age: 25 }, definition))
		expect(result.value).toBe(35)
		expect(result.trace.length).toBeGreaterThan(0)

		expect(reason.supports('quantitative')).toBe(true)
		expect(reason.reasoner('quantitative')?.supports(definition)).toBe(true)
		reason.destroy()
	})

	it('§ Quantitative scoring — the factor pipeline', () => {
		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const definition = createQuantitativeDefinition('premium', 'Premium', [
			createFactorGroup(
				'risk',
				'sum',
				[
					createFieldFactor('age', 'age', {
						checks: [createCheck('licensed', 'equals', true)],
						transforms: [createTransform('percentage', 50)],
						bounds: createBounds(0, 40),
						required: true,
					}),
					createLookupFactor('region', 'region', { CA: 12, NY: 8 }, { fallback: 5, weight: 2 }),
				],
				{ base: 100 },
			),
		])

		const result = expectQuantitative(
			reason.reason({ age: 40, licensed: true, region: 'CA' }, definition),
		)
		expect(result.value).toBe(144)
		expect(result.groups[0]?.factors.map((factor) => factor.id)).toEqual(['age', 'region'])
		reason.destroy()
	})

	it('§ Quantitative scoring — the operators driven directly', () => {
		const evaluator = createEvaluator()
		expect(evaluator.evaluate(createCheck('age', 'above', 18), { age: 25 })).toEqual({
			field: 'age',
			met: true,
			actual: 25,
		})
		expect(evaluator.batch([createCheck('age', 'above', 18)], { age: 25 })).toHaveLength(1)

		const transformer = createTransformer()
		expect(transformer.apply(10, createTransform('multiply', 2))).toBe(20)
		expect(transformer.chain(10, [createTransform('add', 5), createTransform('multiply', 2)])).toBe(
			30,
		)

		expect(createAggregator().aggregate([10, 20, 30], 'sum')).toBe(60)
	})

	it('§ Numeric domains — the float claims and the scaled-integer recipe', () => {
		expect(0.1 + 0.2).toBe(0.30000000000000004)
		expect(roundTo(0.1 + 0.2, 4)).toBe(0.3)
		expect(roundTo(1 / 1_000_000, 4)).toBe(0)
		expect(roundTo(1 / 1_000_000, 6)).toBe(0.000001)

		expect((100 * 1.05 * 1.05 * 1.15) / 6).toBe(21.131249999999998)
		expect(roundTo((100 * 1.05 * 1.05 * 1.15) / 6, 4)).toBe(21.1312)
		expect(roundTo(21.13125, 4)).toBe(21.1313)

		const numerator = 100n * 105n * 105n * 115n
		const denominator = 100n * 100n * 100n * 6n
		const scaled = (numerator * 20000n) / denominator
		const rounded = scaled % 2n >= 1n ? scaled / 2n + 1n : scaled / 2n
		expect(Number(rounded) / 10000).toBe(21.1313)
	})

	it('§ Logical chaining — forward and backward', () => {
		const reason = createReason({ reasoners: [createLogicalReasoner()] })
		const rules = [
			createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
			createRule(
				'eligible',
				[
					createCompound('and', [
						createAtom('adult', 'equals', true),
						createAtom('accidents', 'below', 2),
					]),
				],
				createAtom('eligible', 'equals', true),
			),
		]

		const forward = expectLogical(
			reason.reason({ age: 25, accidents: 0 }, createLogicalDefinition('e', 'Eligibility', rules)),
		)
		expect(forward.conclusion).toBe(true)

		const goal = createLogicalDefinition('e', 'Eligibility', rules, {
			strategy: 'backward',
			depth: 5,
		})
		expect(expectLogical(reason.reason({ age: 25, accidents: 0 }, goal)).conclusion).toBe(true)
		reason.destroy()
	})

	it('§ Symbolic solving — isolation and rounded feed-forward', () => {
		const reason = createReason({ reasoners: [createSymbolicReasoner()] })
		const definition = createSymbolicDefinition(
			'pricing',
			'Pricing',
			[
				// net + tax = total → isolate: net = total - tax
				createEquation(
					'net',
					createOperation('add', createVariable('net'), createVariable('tax')),
					createVariable('total'),
					'net',
				),
				// discount = net * 10 / 100 — 'net' fed forward
				createEquation(
					'discount',
					createVariable('discount'),
					createOperation(
						'divide',
						createOperation('multiply', createVariable('net'), createConstant(10)),
						createConstant(100),
					),
					'discount',
				),
			],
			{ variables: { tax: 5 } },
		)

		const result = expectSymbolic(reason.reason({ total: 25 }, definition))
		expect(result.solutions).toEqual({ net: 20, discount: 2 })
		expect(definition.equations.map((equation) => equation.id)).toEqual(['net', 'discount'])
		reason.destroy()
	})

	it('§ Inferential derivation and proof', () => {
		const reason = createReason({ reasoners: [createInferentialReasoner()] })
		const grandparent = createInference(
			'grand',
			[createFact('p1', 'parent', ['?x', '?y']), createFact('p2', 'parent', ['?y', '?z'])],
			createFact('c1', 'grandparent', ['?x', '?z']),
		)
		const definition = createInferentialDefinition(
			'family',
			'Family',
			[
				createFact('f1', 'parent', ['alice', 'bob']),
				createFact('f2', 'parent', ['bob', 'carol'], 0.9),
			],
			[grandparent],
		)

		const result = expectInferential(reason.reason({}, definition))
		expect(result.derived).toHaveLength(1)
		expect(result.derived[0]?.predicate).toBe('grandparent')
		expect(result.derived[0]?.terms).toEqual(['alice', 'carol'])
		expect(result.derived[0]?.confidence).toBe(0.9)
		expect(definition.facts.map((fact) => fact.id)).toEqual(['f1', 'f2'])
		expect(definition.inferences.map((inference) => inference.id)).toEqual(['grand'])

		const proved = expectInferential(
			reason.reason(
				{},
				createInferentialDefinition(
					'family',
					'Family',
					[
						createFact('f1', 'parent', ['alice', 'bob']),
						createFact('f2', 'parent', ['bob', 'carol']),
					],
					[grandparent],
					{ strategy: 'backward' },
				),
			),
		)
		expect(proved.proof?.inference).toBe('grand')
		expect(proved.proof?.depth).toBe(0)
		reason.destroy()
	})

	it('§ Shaping definitions as data — the pure helper chain and the JSON round trip', () => {
		const base = createQuantitativeDefinition('risk', 'Risk', [
			createFactorGroup('drivers', 'sum', [createStaticFactor('floor', 10)]),
		])

		const drivers = base.groups[0]
		const grown =
			drivers === undefined
				? base
				: replaceGroup(base, appendFactor(drivers, createFieldFactor('age', 'age')))

		const wide = appendGroup(
			grown,
			createFactorGroup('region', 'sum', [createStaticFactor('flat', 5)]),
			'drivers',
		)
		expect(wide.groups.map((group) => group.id)).toEqual(['drivers', 'region'])

		const merged = mergeQuantitativeDefinition(
			wide,
			createQuantitativeDefinition('risk', 'Risk v2', []),
		)
		expect(merged.name).toBe('Risk v2')

		expect(parseDefinition(JSON.stringify(merged))).toEqual(merged)
		expect(parseDefinition('{}')).toBeUndefined()
	})

	it('§ The definition workspace — DefinitionBuilder', () => {
		const draft = createDefinitionBuilder(
			createQuantitativeDefinition('risk', 'Risk', [
				createFactorGroup('drivers', 'sum', [createStaticFactor('floor', 10)]),
			]),
		)

		draft.factors.append('drivers', createFieldFactor('age', 'age'))
		draft.factors.replace(
			'drivers',
			createFieldFactor('age', 'age', { checks: [createCheck('licensed', 'equals', true)] }),
		)
		draft.groups.append(createFactorGroup('region', 'sum', [createStaticFactor('flat', 5)]))
		draft.groups.prepend(createFactorGroup('base', 'sum', [createStaticFactor('seed', 1)]))
		expect(draft.groups.group('region')?.id).toBe('region')
		draft.clear('description')

		const reason = createReason({ reasoners: [createQuantitativeReasoner()] })
		const result = expectQuantitative(reason.reason({ age: 25, licensed: true }, draft.build()))
		expect(result.value).toBe(41)

		draft.groups.seat([createFactorGroup('only', 'sum', [])])
		expect(draft.build()).toEqual(draft.build())
		draft.destroy()
		reason.destroy()
	})

	it('§ The definition workspace — the accessor pair on every kind of draft', () => {
		const logical = createDefinitionBuilder(createLogicalDefinition('elig', 'Eligibility', []))
		logical.rules.append(
			createRule('adult', [createAtom('age', 'from', 18)], createAtom('adult', 'equals', true)),
		)
		expect(logical.rules.rule('adult')?.name).toBe('adult')
		expect(logical.rules.rules()).toHaveLength(1)

		const symbolic = createDefinitionBuilder(createSymbolicDefinition('rate', 'Rate', []))
		symbolic.equations.append(createEquation('e1', createVariable('x'), createConstant(42), 'x'))
		expect(symbolic.equations.equation('e1')?.target).toBe('x')
		symbolic.variables.add('x', 42)
		expect(symbolic.variables.variable('x')).toBe(42)

		const inferential = createDefinitionBuilder(
			createInferentialDefinition('mortality', 'Mortality', [], []),
		)
		inferential.facts.append(createFact('f1', 'human', ['socrates']))
		expect(inferential.facts.fact('f1')?.predicate).toBe('human')
		inferential.inferences.append(
			createInference(
				'mortal',
				[createFact('p1', 'human', ['?x'])],
				createFact('c1', 'mortal', ['?x']),
			),
		)
		expect(inferential.inferences.inference('mortal')?.name).toBe('mortal')
	})

	it('§ The subject workspace — SubjectBuilder', () => {
		const applicant = createSubjectBuilder({ id: 'alice', age: 25 })
		applicant.set('region', 'CA')
		applicant.merge({ licensed: true, accidents: 0 })
		expect(applicant.remove(['accidents'])).toBe(true)
		expect(applicant.fields()).toEqual({
			id: 'alice',
			age: 25,
			region: 'CA',
			licensed: true,
		})

		expect(applicant.repeat(3).map((subject) => subject.id)).toEqual([
			'alice-0',
			'alice-1',
			'alice-2',
		])
		applicant.destroy()
	})
})
