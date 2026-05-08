**Status:** authoritative reference for software architecture. Cited from `contributing-to-element-interactions/SKILL.md`.

**Scope:** the two-package split, layer responsibilities, end-to-end data flow of a single call, the rationale for the split, and module / file conventions.

---

## 🏛️ Software Architecture

### The two packages

The framework is split across **two packages** for a reason. Understand the split before adding anything.

```
┌──────────────────────────────────────────────────────────────────┐
│ User test file (tests/*.spec.ts)                                  │
│                                                                   │
│   await steps.expect('price', 'ProductPage').text.toBe('$19.99') │
│   await steps.on('btn', 'Page').nth(2).click()                   │
└────────────────────────────┬─────────────────────────────────────┘
                             │ string names only — no selectors,
                             │ no Locators, no driver primitives
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ @civitas-cerebrum/element-interactions                            │
│                                                                   │
│   Steps  ──┬─► Interactions  (click, fill, hover, ...)           │
│            ├─► Verifications  (verifyText, verifyCount, ...)      │
│            ├─► Extractions    (getText, getAttribute, ...)        │
│            └─► ExpectBuilder  (.text.toBe, .count.toBeGT, ...)    │
│                                                                   │
│   ElementAction  (fluent builder behind steps.on(...))           │
│   BaseFixture    (wires Steps + Repository + Interactions)        │
└────────────────────────────┬─────────────────────────────────────┘
                             │ uses Element abstraction —
                             │ never raw Locator
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ @civitas-cerebrum/element-repository                              │
│                                                                   │
│   ElementRepository.get('btn', 'Page')  ──► Element              │
│                                                                   │
│   Element  (platform-agnostic interface)                          │
│     ├─► WebElement       (Playwright-backed)                      │
│     └─► PlatformElement  (Appium / WebDriverIO-backed)            │
│                                                                   │
│   page-repository.json  (single source of truth for selectors)   │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
            Playwright Locator   /   WebDriverIO Element
```

### Layer responsibilities

| Layer | Responsibility | Forbidden |
|---|---|---|
| User test | Describe scenarios in domain language | Constructing locators, importing `@playwright/test` directly for assertions, calling `page.locator()` |
| `Steps` | Top-level facade users call | Holding state across calls, exposing `Locator` in return types |
| `ElementAction` | Fluent builder for `steps.on(...)` chains | Long-lived state (only in-flight chain state); exposing raw Playwright |
| `ExpectMatchers` | Chain-style assertion tree | Mocking, side-effects beyond the awaited assertion |
| `Interactions` / `Verifications` / `Extractions` | Internal helpers — accept `Element` only (no Locator). Wrap raw Locators in `new WebElement(locator)` at the seam if you must. | Calling raw `locator.X()` instead of going through `Element` |
| `BaseFixture` | Constructs Steps with the right deps; auto-attaches failure screenshots | Test-specific logic |
| `Element` interface | Cross-platform element abstraction | Concept that doesn't exist on one of the platforms |
| `WebElement` | Playwright impl + web-only methods | Anything that's not a thin Playwright delegation |
| `PlatformElement` | WebDriverIO/Appium impl | Web-only DOM concepts |
| `ElementRepository` | Resolves name → `Element`, owns `page-repository.json` | Wrapping interactions or assertions — that's element-interactions' job |

### Data flow — anatomy of one call

Tracing `await steps.on('submit-button', 'CheckoutPage').text.toBe('Place Order')`:

1. **`steps.on('submit-button', 'CheckoutPage')`** — `Steps` constructs an `ElementAction` with the element/page names and a fresh `ExpectBuilder` context.
2. **`.text`** — getter on `ElementAction` returns a `TextMatcher` carrying the builder's context (timeout, page, name, negation flag).
3. **`.toBe('Place Order')`** — `TextMatcher.toBe` queues a `QueuedAssertion` on the builder's queue and returns the builder. **No work runs yet.** The chain is synchronous up to this point.
4. **`await`** — JavaScript invokes `builder.then(...)` because `ExpectBuilder` implements `PromiseLike<void>`. `then` calls `flush()`.
5. **`flush()`** — drains the queue. For each assertion:
   - Calls `ctx.captureSnapshot()` → `ElementAction.captureSnapshot()` resolves the named element via `ElementRepository.get(...)` (returning an `Element`), then calls `Element.count/textContent/inputValue/getAllAttributes/isVisible/isEnabled` in parallel.
   - Runs the matcher's predicate against the snapshot.
   - On failure, throws with a structured error that includes the snapshot pretty-printed.
6. **`Element.click/textContent/...`** under the hood call into `WebElement` (Playwright `Locator`) or `PlatformElement` (WebDriverIO). User test code never sees these primitives.

The same shape applies to actions — `steps.on('btn', 'Page').click()` flows through `Interactions.click(target)` → `toElement(target)` → `Element.click({ timeout })` → `WebElement.click()` → `Locator.click()`.

### Why this split exists

- **Cross-platform abstraction has to be at the bottom.** If `Element` lived in element-interactions, every package that wanted platform support would have to depend on the entire interaction surface. Keeping `Element` in its own package means future platforms (desktop, smart TV, native macOS) can implement only the Element contract.
- **Element acquisition is a different concern from interaction.** Repository logic (parsing `page-repository.json`, applying selection strategies, formatting selectors per platform) is independent of what you do with the resolved element. Mixing them produces a god-class.
- **The fixture is the wiring layer, not the API.** Tests import from `BaseFixture`; `Steps` itself is constructible standalone for unusual scenarios. The fixture is opinionated; `Steps` is composable.

### Module / file conventions

- `src/steps/` — user-facing `Steps`, `ElementAction`, `ExpectMatchers`. The chain-style API lives here.
- `src/interactions/` — internal `Interactions`, `Verifications`, `Extractions`, plus the `facade/ElementInteractions` aggregator.
- `src/utils/` — shared helpers (`ElementUtilities` for waiting, `DateUtilities` for date formatting). Pure functions only.
- `src/enum/` — public enum types (`DropdownSelectType`, `EmailFilterType`, etc.).
- `src/fixture/` — `BaseFixture` and related fixture helpers.
- `src/config/` — environment / credentials parsing.
- `src/logger/` — debug logger for verify/interact/email categories.
- `tests/` — Playwright tests, all hitting the real Vue test app.
- `tests/fixture/` — test fixture wiring + shared helper functions (e.g. `pageHelpers.ts`).
- `tests/data/` — `page-repository.json` and any fixture data.
- `skills/contributing-to-element-interactions/` — this skill (top-level so the harness auto-discovers it). Agent-facing skill files for the broader suite live under sibling directories at `skills/<skill-name>/SKILL.md`.

When you add a new file:
- New public API entrypoint? `src/steps/`.
- New internal helper (called only by the package itself)? `src/utils/` or co-located in the file that uses it.
- New enum or public type? `src/enum/Options.ts` (or a new file in the same dir for large groups).
- Never create a top-level "misc" folder.

---

**See also:** [`./decision-tree.md`](./decision-tree.md) (where to put a new API once you've understood the layering), [`./design-rules.md`](./design-rules.md) (invariants that govern each layer), [`./api-workflow.md`](./api-workflow.md) (concrete add-an-API recipe).
