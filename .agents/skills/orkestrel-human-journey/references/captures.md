# The capture portfolio

Every screenshot comes from an acceptance journey, taken at the moment that journey is in the state
the picture names. Never add a test whose only purpose is a screenshot, and never stage a state for
the camera that a journey did not reach through the interface.

## The capture hook

```ts
capture(state: string): Promise<string | undefined>
```

- Return `undefined` and do nothing when the capture flag is unset, so an ordinary run neither
  resizes the viewport nor writes a file.
- Read one variant value that names the theme and the viewport together, and refuse a value that
  names no registered variant.
- Apply that variant's theme and viewport inside the hook, so the run's single variant value is the
  only source of both.
- Write one file named `<state>--<variant>.png` under the workspace's git-ignored `tmp/` tree, and
  return the path it wrote.

## The registry

Declare two frozen lists in the journey file: the state names, and the variants.

- Name a state for its surface and its condition — `answer-partial`, `start-storage-failure`,
  `case-delete-confirmation` — so a reviewer can find the screen without reading the test.
- Register the states the design work actually needs, and place every registered one. An unplaced
  state is a hole in the portfolio, not a spare name.
- Wrap the hook in a placement helper that refuses an unregistered state name, refuses a second
  placement of the same state, records each written path, and refuses a filename written twice.
  Those four refusals are what keep the registry and the disk in agreement.
- Place a state from inside the journey that reaches it, immediately after the assertion that
  proves the surface is in that state.

## Variants

- A variant is one value naming a theme and a viewport together, such as `dark-390`. Splitting them
  into two selectors lets a run write a filename that describes a combination it did not render.
- One run renders one variant. The portfolio is the registry times the variants, produced by
  repeating the run once per variant.

## The two proofs

| Proof                | Runs                        | Asserts                                                                                        |
| -------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| Filename expansion   | Always                      | The registry's length and uniqueness, the variant count, and that the expansion is unique      |
| Portfolio membership | Always; disk under the flag | Every registered state was placed; under the flag, the files on disk are exactly the expansion |

- Keep the filename proof always-on. It fails the moment a registry edit introduces a duplicate or
  a collision, in the ordinary run everyone already runs.
- Assert placement equality as set equality against the registry, in every run. A count passes while
  one state is placed twice and another never.
- Under the capture flag, assert the written filenames equal the registry expanded for the run's
  variant, then read each file back and require non-empty contents. A path a screenshot call
  returned is not proof that a file exists.
- Put the membership proof last in the file, so every journey has run before it reads the tally.

## Transient states

A state that exists only while an activation is in flight cannot be captured after the click
returns.

- Attach a one-shot listener to the resolved control, place the capture from inside it, then click
  through the normal verb and await the promise the listener recorded.
- Fail the step when the listener never ran. Otherwise an activation that missed its control leaves
  a silently unplaced state, which the placement proof reports as a registry error instead.

## Hygiene

- Keep the portfolio out of version control. It is evidence for a review round, regenerated from
  the journeys whenever the surface changes.
- Regenerate the whole matrix after any surface change. A round judged against a mixed portfolio,
  part old and part new, decides nothing.
- Reviewing the portfolio is the `orkestrel-polish-surface` campaign, which owns preflight,
  verdicts, and reconciliation. This reference owns only how the journeys generate it.
