# The journey layer

The layer is the only door a journey has. It has two halves: the generic core `@orkestrel/test`
publishes from `./browser`, and the app glue only this workspace can write. Assemble both before
writing the first journey, and treat a journey that works around a missing capability as a layer
defect.

## Import the core, write the glue

Read the workspace's installed `@orkestrel/test` before writing an import. The gate is two checks:
the pinned manifest's `exports` map serves `./browser`, and the installed declarations carry the
symbols and signatures the journey needs. Read both from the installed package, never from a
remembered version number, and never write an import the pin cannot resolve.

- **Both checks pass.** Import every capability below from `@orkestrel/test/browser` and write no
  local copy of one. A second resolver beside the published one is a second set of failure voices,
  and a journey asserting the local voice proves nothing about the shared contract.
- **The pin does not serve `./browser`.** Implement the layer locally, to exactly these signatures
  and voices, in the workspace's browser test setup module, and replace it with the import when the
  pin moves.
- **The entry is served and a named symbol or signature is missing from it.** Report that as a
  package defect. Implement the one missing capability locally to the same signature and voice, and
  replace it when the pin moves.

The workspace writes the glue in both cases, because the package deliberately excludes it:

- mounting the shipped root component with its real provisions, and the idempotent cleanup that
  undoes what a journey changed;
- store, session, and route fixtures;
- applying the theme, which reaches the core as a capture variant's `apply`;
- helpers coupled to the workspace's own component framework, such as a Bootstrap offcanvas or
  modal driver;
- the capture registry, the variant matrix, the selected variant, the output directory, and the
  gate that decides whether a run writes — the core takes every one of them as an option.

## What it drives

- Drive the real browser through the installed Vitest browser provider. Import its `page` locators
  and `userEvent` from `vitest/browser`; the `@vitest/browser/context` specifier is deprecated and
  is not the import a new layer uses.
- Use the provider verbs for input: `click`, `keyboard`, `tab`, `type`, `clear`, `fill`, and
  `selectOptions`. Use `page.viewport` and `page.screenshot` for captures, and the runner's file
  command to read a written capture back.
- Never dispatch a constructed event. Synthetic input reaches handlers a person's input cannot
  reach and moves no focus, so a suite built on it passes while the interface is unusable.
- Never let an acting verb take an element, a component instance, or a selector from the caller.
  Every verb resolves its own target from role and accessible name, which is what keeps a journey
  honest. A reader of a node the caller already holds — `readRows`, `style`, `contrast` — is not an
  acting verb and is exempt.

## The resolver

```ts
resolveAccessible(name: string): HTMLElement
resolveAccessible(role: string, name: string): HTMLElement
resolveRendered(first: string, second?: string): HTMLElement
```

- Match the accessible name exactly. A substring match resolves a control the person did not mean.
- Search a fixed set of interactive roles for the bare-name form, and exactly the named role for
  the two-argument form. The core publishes that set as `ACCESSIBLE_ROLES`.
- Count a match as reachable only when every condition holds: it is connected; it passes a
  visibility check that honors opacity and CSS; its box has non-zero width and height; its
  `tabIndex` is at least zero; it matches neither `:disabled` nor `[aria-disabled="true"]`; and it
  has no `[inert]` ancestor.
- Scroll a wholly off-viewport target into view once, then measure reachability again. A control a
  person can scroll to is reachable; one that stays outside the viewport is not.
- `resolveRendered` is the same resolver without the viewport requirement, and it is what every
  acting verb resolves through, so a click does not fail on a target the act itself scrolls into
  view. Reach for it directly only when a journey needs a target before it is on screen.
- `isOutsideViewport(rectangle)` is the predicate `resolveAccessible` applies before scrolling and
  again after it. `resolveRendered` never calls it, which is what makes it the resolver without the
  viewport requirement.

### The failure voices

Keep these distinct, and never merge two into one message. A journey asserts the one it means.

| Condition                                        | The voice it must throw                                                               | Thrown by               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------- |
| No element carries the name                      | `No interactive element has the accessible name "<name>"`                             | `resolveRendered`       |
| Every match fails a reachability condition       | `Interactive target "<name>" is not visible and focus-reachable`                      | `resolveRendered`       |
| Several matches are reachable                    | `Interactive target "<name>" is ambiguous across <n> elements`                        | `resolveRendered`       |
| Still off-viewport after being scrolled to       | `Interactive target "<name>" is unreachable after scrolling`                          | `resolveAccessible`     |
| Nothing reachable carries the name in the region | `Interactive target "<name>" is not reachable inside "<region>"`                      | `clickAccessibleWithin` |
| Several reachable matches inside the region      | `Interactive target "<name>" is ambiguous across <n> elements inside "<region>"`      | `clickAccessibleWithin` |
| No reachable disclosure carries the summary      | `Native disclosure "<name>" is not visible and focus-reachable`                       | `clickDisclosure`       |
| Several reachable disclosures carry it           | `Native disclosure "<name>" is ambiguous across <n> elements`                         | `clickDisclosure`       |
| One whole traversal never reaches the target     | `Interactive target "<name>" is not reachable through forward Tab traversal: <trail>` | `traverseAccessible`    |
| The named region is absent or hidden             | `Named region "<name>" is not visible`                                                | `readPerception`        |
| Several named regions match                      | `Named region "<name>" is ambiguous across <n> elements`                              | `readPerception`        |
| The resolved control carries no value            | `Interactive target "<name>" does not carry a value`                                  | `readValue`             |
| The element exposes no computed text color       | `Computed foreground color is unavailable`                                            | `contrast`              |
| No layer up to the first opaque one paints       | `Computed background color is unavailable`                                            | `contrast`              |

- Pick the row by the verb the journey called, not by the condition alone. An absent region reports
  as `Named region "<name>" is not visible` from `readPerception` and as
  `Interactive target "<name>" is not reachable inside "<region>"` from `clickAccessibleWithin`.
- Assert the two `contrast` voices from real conditions: a detached element exposes no computed
  foreground color, and an element whose whole ancestor chain declares no background paints nothing.
- Absent and present-but-unreachable are different findings. The first says a control is missing;
  the second says the interface is gating one that exists.
- Ambiguity is a finding about the surface. A person disambiguates by role and context, so the
  message names the count and the journey re-targets by role or region.

## Role vocabulary

The platform computes a role; markup only suggests one. Confirm a computed role in the browser
whenever a target stops resolving.

- A `list`-bearing input computes `combobox`, not `textbox`. Attaching native suggestion machinery
  to a field is a role change: re-target every journey that names that field, and read a resolver
  miss immediately after such a change as this before treating the element as missing.
- A tab and its panel collide on a bare name by construction, because the panel is labelled by its
  tab. Target a tab by its role always.
- `<summary>` is exposed as a native disclosure rather than through a role the provider's role
  locators accept. `clickDisclosure(name)` keys on the summary's rendered text and requires it to be
  connected, visible, non-zero in width and height, focusable, and outside any `[inert]` subtree,
  under its own failure voices. It does not check `:disabled` or `[aria-disabled="true"]`, so prove
  a disabled disclosure through what the surface renders rather than through this refusal.

## Region-scoped resolution

```ts
clickAccessibleWithin(region: string, role: string, name: string): Promise<void>
```

- Use this form for repeated short verbs such as `Add`, and for a control whose accessible name is
  completed by a status the row renders. A person disambiguates those by the region they sit in.
- The region's name matches exactly and the control's name matches loosely: the region supplies the
  context, so the name only has to be recognizable inside it.
- Apply the same reachability conditions inside the region, and throw voices that name the region
  as well as the target.

## Input and traversal

| Verb                                     | Contract                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `clickAccessible(name)` / `(role, name)` | Resolve the rendered target and activate it through the provider's trusted click.                             |
| `clickDisclosure(name)`                  | Activate a native `<summary>` by the text a person reads on it.                                               |
| `typeAccessible(name, text)`             | Focus the field, select all, delete, then send real keystrokes. Escape the provider's key syntax in the text. |
| `fillAccessible(name, text)`             | Replace the value in one operation for text too long to type. The real element still publishes real input.    |
| `pressKeys(keys)`                        | Send a provider keyboard sequence for Enter, arrows, modifiers, and combinations.                             |
| `traverseAccessible(name)`               | Move focus by forward Tab from wherever focus is, and return the target once focus lands on it.               |

- Use typing wherever the keystrokes themselves are the subject, and filling wherever the text is
  only a payload the person pastes.
- Charge the trail and the cycle end only for focus that actually lands on an element. A Tab pressed
  before the page holds real input focus moves nothing, and a bound charged for swallowed keystrokes
  fails a reachable target under load.
- End the traversal when focus revisits an element — that is one complete cycle of the tab order —
  and throw the traversal's own voice, carrying the trail of what focus did reach.
- Count every Tab press against the hard cap, which sits above the cycle so a page with no tab order
  fails instead of hanging. A target that stops resolving mid-traversal records no visit on that
  step, so it runs to the cap and reports whatever trail landed.
- Re-resolve the target by role and name on every step. A framework may replace the node between
  resolution and focus arrival, and the person's target is the name, never one node.
- Never call the browser's focus method to place focus. A journey proves the order the interface
  actually offers.

## Perception

```ts
readPerception(name: string): string
readPage(): string
readFocus(): string | undefined
readValue(role: string, name: string): string
```

- `readPerception` returns the normalized `innerText` of exactly one visible named region, dialog,
  alert dialog, table, tab panel, alert, or status. Collapse whitespace runs to single spaces and
  trim.
- Read `innerText`, never `textContent`. `innerText` reports the text as rendered: CSS transforms
  applied, and content the layout hides left out. Assertions quote that.
- Include descendant visually-hidden text, which a screen reader perceives and which a clip-based
  hiding technique leaves in `innerText`.
- Throw when the named region is absent, hidden, or ambiguous, so a perception assertion cannot
  quietly read nothing.
- `readPage` is the whole-page reader for a sentence spanning two regions and for the vocabulary
  sweep. It returns whatever is there rather than throwing, so never use it where one named region
  is the subject.
- `readFocus` returns the active element's rendered text, and `readValue` returns a resolved
  control's value. A control's value is a rendered fact, not internal state.
- Expect the whole page's text from `readFocus` when nothing holds focus. The browser reports the
  body as the active element, and the body's rendered text is the page. `readFocus` returns
  `undefined` only when focus rests on a non-HTML element.
- Compare a post-destructive focus assertion exactly, never by inclusion. An inclusion check passes
  on that whole-page fallback, which is the case the assertion exists to catch.

## Rendering and measurement

These read or build a node the caller already holds, and they serve the proofs a journey makes
about how a surface renders rather than about what a person does to it.

| Helper                     | Contract                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `render(markup)`           | Attach trusted fixture markup in a container, for a proof that needs no app mount. |
| `style(element, property)` | One resolved CSS property, read from the real browser.                             |
| `contrast(element)`        | The WCAG 2.x ratio, compositing every translucent layer onto the first opaque one. |
| `readCascade()`            | Every class token the loaded stylesheets actually define.                          |
| `readRows(root, selector)` | One line per matched element, built from its text nodes.                           |
| `waitForFrame()`           | One animation frame, to settle pending paint work.                                 |

- Measure contrast against the composited stack, never against a declared token value. A tint over
  a translucent surface is what the person sees.
- Check an authored class against `readCascade` rather than against a stylesheet source file. A
  class no loaded stylesheet defines is an invented utility or a misspelling.

## Mounting and cleanup

This half is always the workspace's.

- Mount the shipped root component with its real provisions and return an idempotent cleanup that
  unmounts the app and removes its container.
- Undo everything a journey changed after each test: unmount, destroy the session, reset the theme,
  clear the keys the application persisted, and return the route to its entry. A journey that
  inherits the previous journey's state proves nothing about either.
- Remove every container `render` attached, in the same cleanup. A fixture container left in the
  document is a second element carrying the same accessible name, which the next journey's resolver
  reports as an ambiguity the layer created.

## The capture portfolio

The core publishes `createPortfolio` and `expandCaptures`; the workspace supplies the registry, the
variants, the selected variant, the directory, and the gate. [captures.md](captures.md) owns all of
it.
