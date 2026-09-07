# @orkestrel/reason

> A synchronous, deterministic reasoning engine: declarative JSON-serializable
> definitions evaluated against plain subject records to produce traceable
> results, through the `quantitative`, `logical`, `symbolic`, and `inferential`
> strategies behind one dispatch surface.

Register the reasoners you need on an orchestrator with the `createReason`
function, build a definition as plain data, then call `reason` with a subject
and read the traceable result it returns. Environment-agnostic — no I/O, no
browser or server assumptions. Part of the `@orkestrel` line.

## Install

```sh
npm install @orkestrel/reason
```

## Requirements

- Node.js >= 22.12.0, matching the package engine declaration
- ESM-only (no CommonJS build)

## Usage

```ts
import {
	createFactorGroup,
	createFieldFactor,
	createQuantitativeDefinition,
	createQuantitativeReasoner,
	createReason,
	createStaticFactor,
} from '@orkestrel/reason'

const reason = createReason({ reasoners: [createQuantitativeReasoner()] })

const definition = createQuantitativeDefinition('risk', 'Risk score', [
	createFactorGroup('drivers', 'sum', [
		createFieldFactor('age', 'age'), // reads subject.age, parseNumber-coerced
		createStaticFactor('floor', 10), // a fixed contribution
	]),
])

const result = reason.reason({ age: 25 }, definition) // one subject → one result
if (result.reasoning === 'quantitative') result.value // 35 — narrow by the discriminant
result.trace // the step-by-step account of how the value came to be
```

`reason` dispatches by `definition.reasoning` — pass an array of subjects and
the batch overload maps them in order onto an equal-length result array.
Results are a discriminated union (`reasoning` names the axis): narrow with
the discriminant and read the strategy-specific payload (`value` /
`conclusion` / `solutions` / `derived`).

## Guide

For the full surface — the orchestrator, the reasoners, the operators, the
definitions & subjects capability layer, the `DefinitionBuilder` and
`SubjectBuilder` workspaces, validators, errors, and the observation surface —
see [`guides/reason.md`](guides/reason.md).

## Package

Published as a single typed entry point per the `exports` field in
`package.json`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
