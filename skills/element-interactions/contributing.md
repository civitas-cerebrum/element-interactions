---
name: contributing-to-element-interactions
description: >
  Use this skill when contributing to the @civitas-cerebrum/element-interactions
  package itself (adding/modifying source in src/, opening a PR, reviewing
  contributions, debugging the package's own tests), or when a user of the
  package runs into an API gap — they need a method/option that doesn't exist
  yet, or they're tempted to drop down to raw Playwright Locator calls because
  the framework doesn't expose what they need. This skill explains the
  separation of concerns between element-repository and element-interactions,
  the test coverage rules, the design principles that must be respected when
  scaling the package, and the exact workflow for adding new APIs cleanly.
  Triggers on phrases like: "contribute to element-interactions", "extend the
  Steps API", "add a new method to ElementAction", "no equivalent in the
  framework", "the package doesn't have", "missing API in element-interactions",
  "how do I add to this framework", "drop down to raw Playwright", or any
  request to modify files under /Users/Ay/GitHub/element-interactions/src/.
---

# Contributing to @civitas-cerebrum/element-interactions

This package is a Playwright-on-top facade. Every API decision should preserve the framework's two non-negotiable promises:

1. **No raw selectors in user test files.** Tests refer to elements by name (`'submitButton'`, `'CheckoutPage'`), never by CSS/XPath/locator strings.
2. **No raw Playwright `Locator.*` calls in user test files.** Every interaction, verification, and extraction goes through `Steps`, `ElementAction`, or the matcher tree — never `await page.locator('x').click()` directly.

If a contribution undermines either promise, it doesn't ship.

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
| `Interactions` / `Verifications` / `Extractions` | Internal helpers — accept `Element \| Locator`, route everything through `Element` | Calling raw `locator.X()` after the input is normalized |
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
- `skills/element-interactions/` — agent-facing skill files (this file lives here).

When you add a new file:
- New public API entrypoint? `src/steps/`.
- New internal helper (called only by the package itself)? `src/utils/` or co-located in the file that uses it.
- New enum or public type? `src/enum/Options.ts` (or a new file in the same dir for large groups).
- Never create a top-level "misc" folder.

---

## 🚦 Decision tree: where does my new API go?

When you want to add something, walk this in order:

1. **Is it a raw element capability** (e.g. "read CSS variable", "drag with custom timing")?
   → Add to `Element` interface in element-repository (and/or `WebElement` if web-only). Bump element-repository version. Then expose it through element-interactions.

2. **Is it a verification/assertion** (e.g. "assert element has class X", "assert N items in this list")?
   → Add a matcher to `ExpectMatchers.ts`. Either extend an existing matcher class (`TextMatcher`, `CountMatcher`, etc.) or add a new field matcher under `ExpectBuilder`.

3. **Is it a composite workflow** (e.g. "fill an entire form from an object", "retry an action until verification passes")?
   → Add a method to `Steps` in `CommonSteps.ts`. Use existing primitives (`steps.fill`, `steps.verifyText`, `steps.on(...)`) — never call `page.locator()` from inside the new method.

4. **Is it a strategy selector or filter** (e.g. "select first matching by aria-label")?
   → Add to `ElementAction` as a chainable strategy method. It should mutate `resolutionOptions` and return `this`.

5. **Is it a fixture-level concern** (e.g. "auto-clean cookies between tests")?
   → Extend `BaseFixture` or compose via `test.extend<T>()` — don't pollute Steps with global cross-cutting setup.

If none of the above fit, **stop and discuss** before writing code. There's probably a deeper design issue.

---

## 🚨 Hard rules — don't violate

### No raw `locator.*()` in element-interactions src/

Every `locator.click()`, `locator.fill()`, `locator.evaluate()`, etc. that creeps into `src/` is a regression. If you need a primitive Playwright doesn't expose through `Element`, **add it to the Element interface in element-repository first**.

The one exception: the `WebElement` constructor itself (`new WebElement(locator)`) is the boundary where a raw Locator legitimately enters. Everywhere else uses `Element`.

To audit:

```bash
grep -rn "locator\.\(click\|fill\|textContent\|inputValue\|getAttribute\|count\|evaluate\|isVisible\|isEnabled\|waitFor\|scrollIntoView\|hover\|check\|uncheck\|selectOption\|dispatchEvent\|boundingBox\|press\|setInputFiles\|screenshot\|dragTo\|clear\)" src/ --include="*.ts" | grep -v "dist/"
```

Should return **zero results** in user-facing call sites. The only allowed calls are in `Element` implementations themselves (which live in element-repository).

### Action methods presence-detect

Every action on `Element` (`click`, `fill`, `dragTo`, ...) calls `ensureAttached(timeout)` first. When you add a new action to element-repository, follow the same pattern:

```ts
async myNewAction(options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);  // <-- mandatory
    await this.locator.myUnderlyingCall({ timeout: options?.timeout });
    return this;
}
```

This is what gives the framework predictable failure modes ("element never attached" instead of opaque driver errors) and makes Appium actions stable without depending on auto-wait.

### Web-only methods only get cast at the call site, not aliased

If element-interactions needs `selectOption` (which is `WebElement`-only), the call site does the narrowing:

```ts
const element = toElement(target) as WebElement;
await element.selectOption(...);
```

Don't smuggle web-only methods onto `Element` with throw-stubs on `PlatformElement`. The cast makes the web-only intent explicit and keeps the cross-platform contract honest.

### Maintain 100% API coverage

The CI gate requires **100% API coverage** — every public method on `Steps`, `ElementAction`, `Verifications`, `Interactions`, `Extractions`, and the matcher classes must have at least one test that exercises it. The coverage tool (`@civitas-cerebrum/test-coverage`) introspects the public surface and fails the build if anything is uncovered.

When you add a new method:
1. Add a passing test for it (even a one-liner against the Vue test app).
2. Run `npx test-coverage --format=github-plain` locally to confirm 100%.
3. The CI coverage job will fail otherwise.

### No mocked unit tests

Every test in this repo runs against the **real Vue test app** at `https://civitas-cerebrum.github.io/vue-test-app/` via Playwright. We do **not** use mocked locators / mock Steps / spy fixtures.

Reason: the framework is a Playwright facade. Mocked tests would only verify that we wire up Playwright "correctly" — but Playwright's actual behavior is what users care about. End-to-end tests catch real regressions; mocks don't.

When adding tests, place them in `tests/` and use the existing `StepFixture` import pattern:

```ts
import { test, expect } from './fixture/StepFixture';

test('new feature', async ({ steps }) => {
    await steps.navigateTo('/');
    // ... real interactions against the live app
});
```

---

## 📐 Design rules — invariants that must stay consistent

These are the contracts that hold the framework together. Every change must respect them. If a change requires breaking one, that's a major-version-bump conversation, not a casual PR.

### 1. Argument order — `(elementName, pageName, ...rest)` everywhere

Every method that targets a named element starts with `elementName, pageName`. No exceptions, no historical accidents.

```ts
steps.click('submit-button', 'CheckoutPage');
steps.verifyText('summary', 'CartPage', 'Total: $42');
steps.expect('price', 'ProductPage').text.toBe('$19');
steps.on('row', 'TablePage').nth(2).text.toBe('Active');
repo.get('submit-button', 'CheckoutPage');
repo.getByText('option', 'DropdownPage', 'United States');
```

Adding a method that flips this (e.g. `(pageName, elementName)`) is a hard rejection in review.

### 2. Async-everywhere

Every public method that reaches the DOM/driver is `async`. No synchronous element accessors. If you find yourself wanting a sync getter, you're doing something wrong (the only sync exception is `repo.getSelector()` which returns a string, not an element).

### 3. Chain-style for assertions, flat for actions

- **Assertions** extend the matcher tree (`steps.expect(el, page).field.matcher(value)`). New assertions add to `ExpectMatchers.ts`, not new flat `verifyX` on `Steps`.
- **Actions** stay flat on `Steps` (`steps.click`, `steps.fill`, `steps.dragAndDrop`). Composite workflows (`steps.fillForm`, `steps.retryUntil`) stay flat too.

The legacy `verify*` family on `Steps` is kept for backwards compatibility — don't grow it; route new assertions through the matcher tree.

### 3a. Implementation lives in the `Interactions` / `Verifications` / `Extractions` layer. Everything else is a facade.

The single source of truth for assertion behavior — retry mechanics, web-first polling, error formatting, negation, timeout handling — is the `Verifications` class. For actions, it's `Interactions`. For reads, `Extractions`.

All user-facing layers are **dispatch-only** and must ultimately call into the appropriate interaction class:

```
Steps.verifyText(el, page, ...)            ──┐
Steps.expect(el, page).text.toBe(...)        │
ElementAction.verifyText(...)                ├─► Verifications.text(target, expected, options)
ElementAction.text.toBe(...)                 │   ↑ one implementation, one codepath
interactions.verify.text(locator, ...)     ──┘
```

**The rule for new assertions:**
1. If `Verifications` can do what you need, add a matcher in `ExpectMatchers.ts` that delegates to it (2–3 lines — e.g. `return this.ctx.verify.X(target, ..., opts)`).
2. If `Verifications` can't do what you need, **add a method to `Verifications` first**. Implementation goes there. Then add the matcher that delegates.
3. Never reimplement assertion logic in the matcher tree (snapshot-capture + predicate polling + custom retry). The exception is `.satisfy(predicate)` — the predicate escape hatch legitimately needs a snapshot-based poll because user lambdas run against plain data, not against a live element.

**The rule for new actions:**
- Same shape — `Steps.X` and `ElementAction.X` both delegate into `Interactions.X`. Never write click/fill/hover logic directly on `Steps`.

**Why this matters:**
- One bug fix propagates everywhere. Fix Playwright's web-first assertion handling in one place, every entry point benefits.
- Error messages stay consistent because `describeFailure`-style messages are threaded as `errorMessage` into the single implementation, which embeds them via Playwright's `expect(locator, message)` overload.
- The raw `interactions.verify.X` / `interactions.interact.X` public API (documented as the escape hatch for users with custom locators) is never out of sync with the matcher-tree / Steps behavior.
- Adding a new matcher is cheap: write a one-liner in the tree, add one method to Verifications (which is itself a thin Playwright wrapper).

**Helper pattern the matcher tree uses:**

```ts
// Matcher method — 2-line dispatch
toBe(expected: string): ExpectBuilder {
    return this.builder.enqueue(this.ctx, (entry) =>
        runWithElement(entry.ctx,
            el => entry.ctx.verify.text(el, expected, this.msgOpts(entry.ctx, 'text', 'to be', expected)),
            entry.messageOverride));
}
```

`runWithElement` handles the `ifVisible` gate + resolves the Element. `this.msgOpts` builds the `{ negated, timeout, errorMessage }` shape every Verifications method accepts. Verifications does the actual work.

**Audit grep:** if you find yourself writing retry loops, snapshot capture, or Playwright `expect(locator)...` calls outside of `Verifications` / `Interactions` / `Extractions`, stop. It probably belongs in one of those classes instead.

### 4. One-shot semantics for `.not`

`.not` flips the **next matcher only**, then resets. Don't introduce sticky-negation modes or multi-matcher negation scopes; it confuses reading. Both `steps.expect('el', 'Page').not.text.toBe('x')` and `steps.expect('el', 'Page').text.not.toBe('x')` produce the same single-call negation.

### 5. One timeout, uniform mutation

A single chain-level `timeout` var is the source of truth across the whole chain:

```
Steps.timeout (fixture) → ElementAction._timeout → ExpectContext.timeout → VerifyOptions.timeout (threaded into Verifications)
```

`.timeout(ms)` **mutates** at every layer it appears — no cloning, no divergent semantics:

- `ElementAction.timeout(ms)` mutates `_timeout`; `.text`, `.count`, etc. getters rebuild the ExpectContext with the new value.
- `ExpectBuilder.timeout(ms)` mutates `ctx.timeout` and retroactively patches the last queued assertion (so `.satisfy(pred).timeout(500)` applies 500ms to that predicate).
- Matcher `.timeout(ms)` (e.g. `.text.timeout(500)`) mutates its own ctx AND propagates to the builder for subsequent matchers — but does NOT retroactively patch a prior matcher's queued entry.

**Scope — what `.timeout(ms)` currently affects:**
1. Every verification/matcher (`.text.toBe`, `.count.toBeGreaterThan`, `.satisfy(pred)`, `.verifyText`, `.verifyCount`, etc.).
2. Element-routed actions that go through `element.action(this._timeout).X()` on `ElementAction` — `hover`, `fill`, `check`, `uncheck`, `doubleClick`, `typeSequentially`, `clearInput`, `scrollIntoView`, `getText`, `getAttribute`, `getCount`, `getInputValue`.

**What it does NOT currently affect** (open issue — Interactions-routed actions use the fixture-level timeout):
- `click`, `clickIfPresent`, `rightClick`, `uploadFile`, `dragAndDrop`, `selectDropdown`, `setSliderValue`, `selectMultiple`.

These flow through `this.interactions.interact.*` where `ElementInteractions.interact`'s internal `ELEMENT_TIMEOUT` is set once at construction and never mutated by `ElementAction.timeout()`. Wiring this through requires threading `timeout` into every `Interactions.*` signature — tracked as a follow-up.

**Visibility probe is another deliberate exception.** `ifVisible(ms?)` has its own short `visibilityTimeout` (default 2000ms) because its whole purpose is fast-skip: a hidden element should abort the action in ~2s, not 30s. Do not unify it into the main timeout.

Other builder state (queue, pendingNot) also mutates, but stays scoped: each `.expect()` / `.on()` call returns a fresh builder, so mutation doesn't leak across chains. `.not` is one-shot — it flips the next matcher only, then resets.

### 6. Snapshot-based predicates

The predicate escape hatch (`steps.expect(el, page).satisfy(predicate)`) takes a function that receives an `ElementSnapshot` — plain data, no async access. This keeps custom assertions readable and predictable.

```ts
// ✓
await steps.expect('price', 'Page').satisfy(el => parseFloat(el.text.slice(1)) > 10);

// ✗ Never change to this — users would need to await inside the predicate
await steps.expect('price', 'Page').satisfy(async el => (await el.getText()) === '$10');
```

### 7. Naming conventions

| Prefix | Returns | Behavior on failure |
|---|---|---|
| `verify*` | `Promise<void>` | Throws |
| `expect(...)...` (matcher tree) | thenable that throws on failure | Throws on failure |
| `is*` | `Promise<boolean>` | Returns `false` (never throws) |
| `get*` | `Promise<value>` | Throws if element not found |
| `wait*` | `Promise<void>` | Throws on timeout |
| `click*` / `fill*` / `hover*` etc. | `Promise<void>` (or `Promise<boolean>` for the `IfPresent` variants) | Throws on failure |

If your new method doesn't fit one of these, reconsider the shape — the naming is the API contract.

### 8. Public API stability

`steps.click`, `steps.verifyText`, `steps.on(...).fill`, the matcher tree shape — all the entry points users have written tests against — stay stable across patch and minor versions. Internal refactors are fine; signature changes on user-facing methods need a major bump and a clear migration note in the PR description.

The current public `Target` type (`Locator | Element`) accepting raw Locators is held for backwards compatibility (see issue #74). Don't tighten this without coordination.

### 9. Action methods presence-detect

Every action on `Element` (`click`, `fill`, `hover`, `dragTo`, ...) calls `ensureAttached(timeout)` first. New action methods MUST do the same. This is what gives the framework predictable failure modes ("element not attached" instead of opaque driver errors) and stable Appium behavior.

```ts
async myNewAction(options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);  // mandatory
    await this.locator.myUnderlyingCall({ timeout: options?.timeout });
    return this;
}
```

### 10. No raw `locator.*()` in element-interactions src/

Every `locator.click()`, `locator.fill()`, `locator.evaluate()`, etc. that creeps into `src/` is a regression. If you need a primitive Playwright doesn't expose through `Element`, **add it to the Element interface in element-repository first**.

The one exception: the `WebElement` constructor itself (`new WebElement(locator)`) is the boundary where a raw Locator legitimately enters. Everywhere else uses `Element`.

To audit:

```bash
grep -rn "locator\.\(click\|fill\|textContent\|inputValue\|getAttribute\|count\|evaluate\|isVisible\|isEnabled\|waitFor\|scrollIntoView\|hover\|check\|uncheck\|selectOption\|dispatchEvent\|boundingBox\|press\|setInputFiles\|screenshot\|dragTo\|clear\)" src/ --include="*.ts" | grep -v "dist/"
```

Should return **zero** results in user-facing call sites.

### 11. Web-only methods only get cast at the call site

If element-interactions needs `selectOption` (which is `WebElement`-only), the call site does the narrowing:

```ts
const element = toElement(target) as WebElement;
await element.selectOption(...);
```

Don't smuggle web-only methods onto `Element` with throw-stubs on `PlatformElement`. The cast makes the web-only intent explicit at the call site and keeps the cross-platform contract honest.

### 12. Error message format

User-facing assertion failures follow a consistent header format:

```
expected <PageName>.<elementName> <field> [not ]<verb> <expected>
```

Examples:
- `expected ProductPage.price text to be "$19.99"`
- `expected CheckoutPage.submitBtn count not to be 5`

The actual value comes from Playwright's built-in "Expected / Received" diff block appended below the header — we pass the header string as the `message` argument to `expect(locator, message).<matcher>()`, and Playwright prepends it to its own assertion output. Don't hand-roll the `got <actual>` suffix — it'll duplicate what Playwright already emits.

Use the `BaseMatcher.msgOpts(ctx, field, verb, expected)` helper in `ExpectMatchers.ts` — it builds `{ negated, timeout, errorMessage }` in the exact shape every Verifications method accepts. Don't hand-roll error strings.

For predicate failures (`satisfy(pred)`), the path is different — we poll a snapshot manually, so there's no Playwright diff block. The message includes the full `ElementSnapshot` JSON pretty-printed under the header. Don't truncate or summarize the snapshot — users debug from it.

### 13. Logging

Every public method on `Steps` logs at one of: `tester:navigate`, `tester:interact`, `tester:verify`, `tester:extract`, `tester:wait`, `tester:email`. The category mirrors the operation kind. Use the existing `log.X(...)` helpers in `CommonSteps.ts` rather than `console.log`.

### 14. TypeScript discipline

- **No `any`** in `src/`. Test fixtures are exempted (the Playwright fixture types are awkward to spell exactly).
- **Prefer interfaces over type aliases** for public surfaces. `ExpectContext`, `ElementSnapshot`, `QueuedAssertion` are interfaces.
- **Use `readonly`** on snapshot/data interface fields. Mutable internal state is fine on classes; data passing between layers should be readonly.
- **Use `as const`** for matcher verb strings and similar string literals when they need narrow types.
- **Avoid `as unknown as X` double-casts.** If you need one, the type model is wrong somewhere — refactor.

### 15. Patch-version one-PR-one-bump rule

Run `npm version patch` **once** per PR (at the first commit). Do not bump on every follow-up commit on the same branch. The `publish.yml` workflow publishes whatever version is in `package.json` at merge time, so multi-bumps inflate the version number for nothing.

For minor/major bumps, same rule: bump once, at the start.

### 16. Tests hit the real Vue test app

No mocks, no spies, no fake locators. Every test in `tests/` runs against `https://civitas-cerebrum.github.io/vue-test-app/` via Playwright. The framework's value is its Playwright wiring — mocks would only verify wiring against itself.

### 17. 100% API coverage is a CI gate

Every public method on `Steps`, `ElementAction`, `Verifications`, `Interactions`, `Extractions`, and the matcher classes must have at least one test that exercises it. The coverage tool (`@civitas-cerebrum/test-coverage`) introspects the public surface and fails the build if anything is uncovered. New methods need new tests.

---

## 🧰 Workflow: adding a new API

### A. Adding to element-repository (the underlying capability)

```bash
cd /path/to/element-repository
git checkout main && git pull
git checkout -b feat/your-feature

# 1. Update src/types/Element.ts (interface)
# 2. Implement in src/types/WebElement.ts
# 3. Implement in src/types/PlatformElement.ts (or stub if web-only — but prefer cross-platform)
# 4. Add live test in tests/live-element-location.spec.ts using the Vue test app
# 5. Verify
npm run build
npx playwright test tests/live-element-location.spec.ts
npx test-coverage --format=github-plain     # must show 100%

# 6. Bump version
npm version patch --no-git-tag-version

# 7. Commit + push + open PR
git add -A
git commit -m "feat: add Element.<method> for <use case>"
git push -u origin feat/your-feature
gh pr create --base main --title "feat: ..." --body "..."
```

After this PR merges, element-repository auto-publishes to npm. Then update element-interactions to use the new version.

### B. Adding to element-interactions (the user-facing API)

```bash
cd /path/to/element-interactions
git checkout main && git pull
git checkout -b feat/your-feature

# 1. Add the API to the right layer:
#    - New matcher → src/steps/ExpectMatchers.ts
#    - New step / composite → src/steps/CommonSteps.ts
#    - New strategy → src/steps/ElementAction.ts
#    - Internal helper → src/interactions/{Interaction,Verification,Extraction}.ts

# 2. Add tests in tests/ — must hit the real Vue test app
# 3. Run full suite + coverage
npm run build
npm run test                                 # all tests must pass
npx test-coverage --format=github-plain     # must show 100%

# 4. Update docs (in this order):
#    - skills/element-interactions/references/api-reference.md (the canonical source)
#    - skills/element-interactions/SKILL.md (only if the change affects the workflow stages)
#    - README.md (only for headline-worthy features)

# 5. Bump version once
npm version patch --no-git-tag-version

# 6. Commit + push + open PR
git add -A
git commit -m "feat: add steps.<method> for <use case>"
git push -u origin feat/your-feature
gh pr create --base main --title "feat: ..." --body "..."
```

### C. Cross-package change (new Element capability + matching Steps API)

Open both PRs in parallel. Element-repository PR ships first; element-interactions PR depends on it:

1. Push element-repository PR.
2. Locally, point element-interactions at `file:../element-repository` so you can develop both sides simultaneously.
3. Once element-repository PR merges and the new version publishes, flip element-interactions back to `^X.Y.Z`.
4. Push the version-flip commit; CI goes green; merge.

---

## 🧯 When a user runs into an API gap

If you're using the package and want to write something like:

```ts
// ❌ Don't do this — drops out of the framework
const locator = page.locator('button.submit');
const cssVar = await locator.evaluate(el => getComputedStyle(el).getPropertyValue('--brand-color'));
```

Stop. The right path:

1. **Check if the framework already supports it.** Read `skills/element-interactions/references/api-reference.md` end-to-end. The matcher tree, predicate form, `.css(prop)`, and `interactions` raw escape hatch cover most needs.

2. **If it's truly missing:**
   - Open an issue on `civitas-cerebrum/element-interactions` describing the use case.
   - If it's a generic element capability (CSS variable, custom property, drag with timing), it belongs in element-repository's `Element` interface first.
   - If it's an assertion shape, it belongs on the matcher tree.

3. **If you need to ship NOW**, the documented escape hatch is `interactions.interact.*`, `interactions.verify.*`, `interactions.extract.*` — they accept either `Locator` or `Element`. Use these for the one-off, but file the issue so the proper API can land.

4. **Never** check raw `locator.*()` calls into a test file or into the element-interactions src/. The audit grep above will catch it in code review.

---

## 📋 PR checklist

Before opening a PR on element-interactions:

- [ ] Tests pass: `npm run test` shows all tests passing
- [ ] Coverage 100%: `npx test-coverage --format=github-plain` shows ✅
- [ ] No raw Playwright leak: `grep -rn "locator\.\(click\|fill\|...\)" src/ --include="*.ts"` returns zero matches in non-`Element`-impl code
- [ ] Version bumped exactly once (`npm version patch` at first commit, not at every commit)
- [ ] API reference updated (`skills/element-interactions/references/api-reference.md`) for any new public surface
- [ ] README updated only if the change is headline-worthy (new entry point, new feature category)
- [ ] If adding a new method, it has a JSDoc block on the public-facing class

If you're adding to element-repository first:

- [ ] New method on `Element` interface (cross-platform) OR `WebElement` only (with rationale comment)
- [ ] `WebElement` implementation included
- [ ] `PlatformElement` implementation included if cross-platform
- [ ] Action methods include the `ensureAttached(timeout)` preamble
- [ ] Live test added in `tests/live-element-location.spec.ts`
- [ ] Coverage 100% (`npx test-coverage`)
- [ ] Patch version bumped
- [ ] README updated if adding to the public surface
