# The capture portfolio

Every screenshot comes from an acceptance journey, taken at the moment that journey is in the state
the picture names. Never add a test whose only purpose is a screenshot, and never stage a state for
the camera that a journey did not reach through the interface.

## The portfolio

```ts
createPortfolio(options: PortfolioOptions): PortfolioInterface
expandCaptures(states: readonly string[], variants: readonly CaptureVariant[]): readonly string[]
portfolio.place(state: string): Promise<string | undefined>
```

`@orkestrel/test/browser` publishes the two functions. `place` is a member of the
`PortfolioInterface` that `createPortfolio` returns, so a journey calls `portfolio.place(state)` and
never imports it. Import the two when the workspace's pin serves that entry, and implement them
locally to this contract until it does ([layer.md](layer.md) → Import the core, write the glue).

The workspace owns every option and nothing else:

| Option      | What the workspace supplies                                                      |
| ----------- | -------------------------------------------------------------------------------- |
| `states`    | The registry: every state name the journeys place, declared once.                |
| `variants`  | The matrix: each variant's name, width, height, and the `apply` its theme needs. |
| `variant`   | The one variant this run renders.                                                |
| `directory` | Where the run writes, relative to the calling test file.                         |
| `enabled`   | The capture gate: whether this run writes at all.                                |

An enabled portfolio refuses these, and each is one voice a proof can assert:

| Refusal                                      | Voice                                        |
| -------------------------------------------- | -------------------------------------------- |
| The selected variant names no registered one | `Capture variant "<name>" is not registered` |
| `place` is given an unregistered state       | `Capture state "<state>" is not registered`  |
| `place` is given a state already placed      | `Capture state "<state>" is already placed`  |

A disabled `place` returns `undefined` before any validation, so it refuses nothing. Assert the two
`place` refusals only under the capture gate. The one refusal an ordinary run can meet is
`createPortfolio`'s unregistered-variant refusal, which fires at creation whether or not the run
writes.

The portfolio also owns the filename law: one enabled run writes
`<directory>/<state>--<variant>.png` and records the path the provider reports writing. A future
naming change that breaks that law's injectivity must reintroduce a collision refusal before
writing.

Read `portfolio.states` and `portfolio.paths` for what this run placed and wrote, and
`portfolio.files` for the registry expanded across every variant.

## The registry

Declare the two frozen lists in the browser test setup module and export them from there. The
journey file imports them and passes them as options.

- Name a state for its surface and its condition — `answer-partial`, `start-storage-failure`,
  `case-delete-confirmation` — so a reviewer can find the screen without reading the test.
- Register the states the design work actually needs, and place every registered one. An unplaced
  state is a hole in the portfolio, not a spare name.
- Place a state from inside the journey that reaches it, immediately after the assertion that
  proves the surface is in that state.
- Call `place` unconditionally. A disabled portfolio resizes nothing, writes nothing, and records
  nothing, so an ordinary run pays for none of it and no journey carries a capture branch.

## Variants

- A variant is one value naming a theme and a viewport together, such as `dark-390`. Splitting them
  into two selectors lets a run write a filename that describes a combination it did not render.
- Put the theme in the variant's `apply`, so the run's single variant value is the only source of
  both halves. `place` applies it before resizing.
- One run renders one variant. The portfolio is the registry times the variants, produced by
  repeating the run once per variant.

## The two proofs

| Proof                | Runs                            | Asserts                                                                                                   |
| -------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Filename expansion   | Every ordinary Browser Mode run | The registry's length and uniqueness, the variant count, and that `expandCaptures` is unique              |
| Portfolio membership | Under the capture gate          | Every registered state was placed, and the run's written files are exactly the expansion for this variant |

- Run the filename proof in an ordinary Browser Mode run with capture disabled. It is pure: it reads
  the registry and the matrix, needs no capture flag, and touches no disk. Put it in a Browser Mode
  project anyway, because `expandCaptures` ships from a module that imports `vitest/browser` and a
  plain unit run cannot load it.
- Keep it in the run everyone already runs, so it fails the moment a registry edit introduces a
  duplicate.
- Run the membership proof only under the capture gate. A disabled portfolio records nothing, so a
  membership assertion in an ordinary run either reads an empty tally or asserts nothing.
- Assert placement as set equality between `portfolio.states` and the registry, so a failure names
  the state no journey reached instead of reporting a count.
- Basename `portfolio.paths` before comparing it: the provider reports the full path it wrote, and
  `expandCaptures` yields bare names. Assert those basenames equal the registry expanded for the
  run's variant, then read each file back and require non-empty contents. A path a screenshot call
  returned is not proof that a file exists.
- Put the membership proof last in the file, so every journey has run before it reads the tally.

## Transient states

A state that exists only while an activation is in flight cannot be captured after the click
returns.

- Attach a one-shot listener to the resolved control, place the capture from inside it, then click
  through the normal verb and await the promise the listener recorded.
- Fail the step when the listener never ran. Otherwise an activation that missed its control leaves
  a silently unplaced state, which the membership proof reports as a registry error instead.

## Hygiene

- Keep the portfolio out of version control. It is evidence for a review round, regenerated from
  the journeys whenever the surface changes.
- Regenerate the whole matrix after any surface change. A round judged against a mixed portfolio,
  part old and part new, decides nothing.
- Reviewing the portfolio is the `orkestrel-polish-surface` campaign, which owns preflight,
  verdicts, and reconciliation. This reference owns only how the journeys generate it.
