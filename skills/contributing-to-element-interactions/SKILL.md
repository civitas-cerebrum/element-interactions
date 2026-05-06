---
name: contributing-to-element-interactions
description: >
  Use this skill when contributing to the @civitas-cerebrum/element-interactions
  package or its skill suite — and, just as importantly, when a consumer hits
  the package's edges from the outside. Two trigger families:

  (A) **API gap.** A user, test, or skill needs a method, option, matcher, or
  assertion shape that does not exist on Steps / ElementAction / ExpectMatchers
  / the matcher tree, and the temptation is to drop down to raw Playwright
  `Locator.*` calls. Triggers: "extend the Steps API", "add a new method to
  ElementAction", "no equivalent in the framework", "the package doesn't have",
  "missing API in element-interactions", "missing matcher", "drop down to raw
  Playwright", "fall back to page.locator", "the framework doesn't expose X",
  "how do I add to this framework".

  (B) **Structural / framework / protocol gap.** A skill, workflow, or
  documented invariant declares a rule that the package's current architecture
  cannot satisfy without changing the package itself, switching its underlying
  tooling, or relaxing the rule. The MCP→playwright-cli migration (#121, #122)
  is the canonical example: the parallel-isolation rule was structurally
  unsatisfiable on top of the Playwright MCP plugin and required a tooling
  change at the package layer, not a skill-level workaround. Triggers: "the
  framework can't satisfy", "framework limitation", "this rule cannot be
  satisfied", "the package's architecture prevents", "structural gap",
  "protocol gap", "isolation can't be guaranteed", "this prereq isn't
  satisfiable", "the underlying tooling doesn't support", "should I file an
  issue against the package", "is this a skill issue or a package issue", "do
  we need to change the package to fix this", any case where a skill is about
  to silently weaken or skip a documented invariant because the package can't
  back it.

  Also use when contributing to the skill suite under `skills/` (adding,
  modifying, or registering a skill, debugging the package's own tests, or
  opening a PR against this repo). This skill explains the separation of
  concerns between element-repository and element-interactions, the test
  coverage rules, the design principles that must be respected when scaling
  the package, the exact workflow for adding new APIs cleanly, and how to
  distinguish an API gap from a structural gap.

  Triggers also on: "contribute to element-interactions", any request to
  modify files under the package's `src/`, "open an issue on element-
  interactions", "open a PR on element-interactions", or any of the structural
  / protocol-gap phrases above.
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

### Before filing an issue or opening a PR — check existing work and sync status

Two duplicate-prevention checks are **mandatory** before creating any new GitHub issue or PR. Skipping them wastes maintainer time and has produced duplicate issues / PRs against already-fixed code.

**1. Search existing issues and PRs first.** Both open AND closed — a closed issue often contains the resolution you need:

```bash
# Issues matching the topic
gh issue list --state all --search "<keyword>" --repo civitas-cerebrum/element-interactions
gh issue list --state all --search "<keyword>" --repo civitas-cerebrum/element-repository

# PRs matching the topic
gh pr list --state all --search "<keyword>" --repo civitas-cerebrum/element-interactions
gh pr list --state all --search "<keyword>" --repo civitas-cerebrum/element-repository
```

If a matching **open** issue/PR exists, comment on it — don't open a duplicate. If a matching **closed** one exists, read the resolution first; the fix may already be on `main` (see check #2).

**2. Diff local vs. latest upstream before claiming a gap.** "Missing API" / "this is broken" reports filed from stale local branches are the single largest source of false-positive issues. Before filing anything:

```bash
git fetch origin
git log --oneline HEAD..origin/main           # commits you don't have locally
git diff HEAD origin/main -- src/             # source changes you're missing
```

If there are incoming commits, pull/rebase first, rebuild, and re-verify the gap still exists before filing.

**3. For cross-package gaps, also check the published dependency version.** When the report is "element-interactions doesn't expose X" but X is really an `Element` capability, the fix may already be in a newer element-repository release you simply haven't bumped to:

```bash
# Currently pinned version in this repo
grep -E '"@civitas-cerebrum/element-(repository|interactions)"' package.json

# Latest published version
npm view @civitas-cerebrum/element-repository version
npm view @civitas-cerebrum/element-interactions version

# Diff of what landed since your pinned version
npm view @civitas-cerebrum/element-repository versions --json
```

If the capability landed in a newer version, bump the dep and re-verify — don't file "missing" against an outdated pin.

**Report the check results in the issue/PR body** so maintainers don't have to redo them. One line each:

```
Searched existing issues/PRs: gh issue list / gh pr list — no matches for "<keyword>" in either repo.
Local vs. origin/main: in sync (or: rebased onto <sha> and re-verified).
Dependency version: element-repository pinned at 1.4.2; latest is 1.4.2.
```

### Attribute issue reporters

**Every commit and PR that closes a GitHub issue MUST credit the issue's author with a `Reported-by:` line in the commit body and the PR description.**

The contract:

- The commit body that includes a `Closes #N` / `Fixes #N` / `Resolves #N` reference also includes:

  ```
  Reported-by: @<github-handle>
  ```

  Multi-reporter is fine: `Reported-by: @umutayb, @Emmdb`.

- The PR description repeats the same attribution near the top, before the rest of the summary.

**Why:** issue-driven improvements are the load-bearing input that makes this package's methodology improve faster than any internal review process could. The minimum acknowledgement is a verifiable line in the commit body — it travels with the merge commit, survives squash-merge, surfaces in `git log`, and is mechanically detectable. Without it, the issue author's contribution silently disappears into the maintainer's PR description and the credit graph rots over time.

**How to find the author:**

```bash
gh issue view <N> --json author -q .author.login
# Multi-issue:
for n in 156 157; do gh issue view $n --json author -q '.number, .author.login' --jq @csv; done
```

**Self-reported / chore caveat.** When the contributor is also the issue author, self-attribution is still appropriate — the audit trail is the value, not the social acknowledgement. For purely-chore commits with no upstream issue, the rule does not apply.

**Harness-enforced by `hooks/commit-attribution-gate.sh`** (PreToolUse:Bash, filters to `git commit`). When the commit references an issue without a `Reported-by:` / `Issue-reported-by:` line, the hook emits a `systemMessage` with the gh-CLI snippet to fetch the author. Escape hatch for genuine edge cases: `COMMIT_ATTRIBUTION_GATE=off`.

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

### In-package smoke tests must still verify — and the verification must be causally meaningful

100% API coverage is a floor, not a ceiling. The coverage tool only checks that every public method is *called* from at least one test — it doesn't check that the test *asserts* anything after calling it, let alone that the assertion proves the action did something.

Two levels of failure to avoid:

**Level 1 — no assertion at all.** A test like

```ts
test('hover()', async ({ steps }) => {
  await steps.on('primaryButton', 'ButtonsPage').hover();   // ❌ no assertion
});
```

satisfies coverage but is indistinguishable from a no-op — it only catches thrown exceptions.

**Level 2 — tautological assertion.** Worse than no assertion, because it looks like coverage:

```ts
test('clickListedElement with regex alternation', async ({ steps }) => {
  await steps.clickListedElement('rows', 'TablePage', { text: { regex: 'A|B|C' } });
  await steps.verifyPresence('rows', 'TablePage');  // ❌ list was there before the click
});

test('hover', async ({ steps }) => {
  await steps.on('btn', 'Page').hover();
  await steps.on('btn', 'Page').verifyState('visible');  // ❌ it was visible to be hovered
});

test('fill', async ({ steps }) => {
  await steps.fill('input', 'Page', 'hello');
  await steps.verifyPresence('input', 'Page');  // ❌ inputs don't disappear when filled
});
```

These pass even if the action silently does nothing.

**Rule:** every test in `tests/` must end with an assertion that would *fail under a no-op*. Ask yourself: **"If the exercised method had been replaced with an empty function body, would this test still pass?"** If yes, the assertion is tautological — rewrite it.

Acceptable verification forms (ordered by strength):

1. **Direct effect on a feedback element** — the action updates a `resultText`, `status`, `stateSummary`, `selectedCount`, etc. Verify that specific element's text/attribute.
2. **Navigation** — click a listed element that navigates; `verifyUrlContains(...)` or `verifyAbsence(...)` on an element only present before the click.
3. **Extraction + assertion** — `expect(await steps.getInputValue(...)).toBe('filled')` for `fill`; `expect(cellText).toMatch(/pattern/)` for regex filters.
4. **State-change verification** — `verifyState('checked')` after `check()`, `verifyState('disabled')` after a submit that disables the button, etc.
5. **Fallback** — `verifyState('visible')` or `verifyPresence(...)` on the target is acceptable ONLY when (a) the method has genuinely no observable side-effect at any layer, and (b) a one-line comment explains why. Framework-only smoke cases qualify; feature tests do not.

When reviewing a PR:

1. `grep` the diff for `await steps.*\.\(click|fill|drag|hover|check|uncheck|type|upload|setSliderValue|scrollIntoView|rightClick|doubleClick|clickListedElement)\(` as the *last* line of a test body — every hit is a missing assertion (Level 1).
2. For every `verifyPresence` / `verifyState('visible')` / `verifyState('enabled')` added in the diff, ask whether the element was in that state *before* the action. If yes, it's a tautology (Level 2). The fix is usually to reach for a feedback element (`resultText`, `status`, etc.) instead.

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

Every element-scoped `verify*` is exposed in **two forms that share one implementation**:

1. **Fluent form on `ElementAction`** — `steps.on(el, page).verifyX(...)`. This is the canonical implementation. Each method is either a thin wrapper over the matcher tree (for `verifyPresence`, `verifyText`, `verifyTextContains`, `verifyCount`, `verifyAttribute`, `verifyInputValue`, `verifyCssProperty`) or a direct call into `Verifications` where a specialized fast path is needed (`verifyAbsence` via `toBeHidden`, `verifyState`, `verifyImages`, `verifyOrder`, `verifyListOrder`).
2. **Standalone form on `Steps`** — `steps.verifyX(el, page, ...)`. This is a thin delegate that constructs the fluent builder via `actionWithStrategy(...)` and calls the matching `ElementAction.verifyX(...)`. One implementation, two entry points.

This is the invariant to preserve when adding a new verification:
- Add the method on `ElementAction` (or grow `Verifications` first if the underlying primitive doesn't exist).
- Add the matching standalone method on `Steps` that delegates via `this.actionWithStrategy(elementName, pageName, options).verifyX(...)`. Keep the logging on the Steps side so `tester:verify` output stays consistent.

A handful of verifications only make sense as page-level or filter-then-match shapes and only exist on `Steps`:
- **`verifyUrlContains`, `verifyTabCount`** — page-level, not element-scoped; the tree starts at an element.
- **`verifyListedElement`** — filter-then-match; the fluent tree operates on a single resolved element.

The matcher tree (`.text.toBe`, `.count.toBeGreaterThan`, etc.) remains the place to grow **new** assertion shapes — chainable negation, regex, substring, custom predicates, etc. When a matcher-tree shape lands that subsumes an existing `verify*` form, don't deprecate the `verify*`; the two coexist as equally valid entry points.

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

**Scope — what `.timeout(ms)` affects:**
1. Every verification/matcher (`.text.toBe`, `.count.toBeGreaterThan`, `.satisfy(pred)`, `.verifyText`, `.verifyCount`, etc.).
2. Element-routed actions that go through `element.action(this._timeout).X()` on `ElementAction` — `hover`, `fill`, `check`, `uncheck`, `doubleClick`, `typeSequentially`, `clearInput`, `scrollIntoView`, `getText`, `getAttribute`, `getCount`, `getInputValue`.
3. Interactions-routed actions — `click`, `clickIfPresent`, `rightClick`, `uploadFile`, `dragAndDrop`, `selectDropdown`, `setSliderValue`, `selectMultiple`. `ElementAction` passes `this._timeout` through the option bag of each `interactions.interact.*` call, which then uses it for both the pre-action `Utils.waitForState(...)` and the Playwright primitive (`element.click({ timeout })`, etc.).

When adding a new Interactions-routed action, extend its option bag with `timeout?: number` (or accept an `ActionTimeoutOptions` parameter for modifier-free methods) and plumb it to the same two places — pre-wait and primitive. The `ElementAction` call site passes `{ timeout: this._timeout }` into the bag.

**Repo resolution has its own timeout.** `repo.get(...)` pays `ElementRepository.defaultTimeout` (configured by `repoTimeout` on the fixture, 15000ms default) waiting for the element to reach `attached`. This is upstream of `ElementAction._timeout` — the chain-level `.timeout(ms)` only governs action + verification, not resolution. If you need to bound resolution too, use `repo.setDefaultTimeout(ms)` on the fixture or in a `beforeEach`.

**Visibility probe/gate is another deliberate exception.** `isVisible(options?)` (the unified replacement for the old `ifVisible()` / boolean `isVisible()` pair) and its older aliases use a short `visibilityTimeout` (default 2000ms) because their whole purpose is fast-skip: a hidden element should abort the action in ~2s, not 30s. Do not unify it into the main timeout.

`isVisible(options?)` returns a `VisibleChain` that is both awaitable (`Promise<boolean>`) and chainable (`.click()`, `.text.toBe(...)`, etc.). The probe constructs a `WebElement` directly from `repo.getSelector(...)` rather than going through `repo.get(...)` — otherwise the 15s repository-resolution wait would swallow the caller's short timeout. Every probe and gate decision is logged under `tester:visible` with a `[probe]` or `[gate]` tag.

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

The public `Target` type on `Interactions`, `Verifications`, `Extractions`, and `Utils` is `Element` (no Locator union). Consumers with custom Playwright locators wrap them via `new WebElement(locator)` at the seam — that's the single documented bridging point.

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

### 18. Keep `Steps` lightweight — fewer methods, more flexibility

`Steps` is the user-facing facade. It is a dispatch surface, not an implementation surface. The implementation layers — `Interactions`, `Verifications`, `Extractions` — *should* grow many small specialized methods (`localStorage`, `localStorageContains`, `localStorageMatches`, `localStoragePresent`). `Steps` should grow as few methods as possible, each accepting a flexible options shape that selects between the underlying variants.

**Why this split exists:**

- **Grep-ability for users.** A user reads a test and asks "what assertions exist for X?" — finding one `verifyX(key, options)` plus typed options is faster than scanning five sibling methods.
- **Discoverability via TypeScript.** A discriminated-union options type (e.g. `StorageVerifyOptions`) gives autocomplete the matcher names without forcing the user to recall five method suffixes.
- **Refactor blast radius.** Adding a new matcher variant means adding one method to `Verifications` and one branch to a Steps dispatcher — not a full new public method on `Steps` (with logging, doc block, coverage test, surface-area churn).
- **Cognitive load on the API surface.** Every method on `Steps` is a thing a user can call. The API budget is finite; spend it on distinct *resources* (an element, the URL, page HTML, browser storage), not on every variant of how to assert against them.

**The rule:**

When you add a new family of related verifications/extractions on `Steps`, the default shape is **one method per resource**, accepting a discriminated-union options type that picks the matcher.

✓ DO:

```ts
// One Steps method, four matchers selected via discriminated union.
type StorageVerifyOptions =
    | { equals: string; contains?: never; matches?: never; present?: never; ... }
    | { equals?: never; contains: string; matches?: never; present?: never; ... }
    | { equals?: never; contains?: never; matches: RegExp; present?: never; ... }
    | { equals?: never; contains?: never; matches?: never; present: boolean; ... };

async verifyLocalStorage(key: string, options: StorageVerifyOptions): Promise<void> {
    // Dispatch to verify.localStorage / localStorageContains / localStorageMatches / localStoragePresent.
}
```

✗ DON'T:

```ts
// Four separate Steps methods — bloats the surface, splits docs, splits log lines.
async verifyLocalStorage(key, expected, options?) { ... }
async verifyLocalStorageContains(key, substring, options?) { ... }
async verifyLocalStorageMatches(key, regex, options?) { ... }
async verifyLocalStoragePresent(key, options?) { ... }
```

**Variety still belongs on `Interactions` / `Verifications` / `Extractions`.** Those classes are the implementation. They take *concrete* arguments and have *concrete* shapes — one method per matcher is the right granularity there because each method maps to a single Playwright primitive (e.g. `expect.toHaveText` vs `expect.toContainText` vs `expect.toMatch`). Don't try to merge `Verifications.localStorage` and `Verifications.localStorageContains` into one — the implementation layer benefits from specialization.

**Existing technical debt.** Several legacy families on `Steps` *do* have multiple methods per resource (`verifyText` / `verifyTextContains` / `verifyTextMatches`, `verifyHtml` / `verifyHtmlContains` / etc.). These predate this rule. Don't refactor them in the same PR that adds new work — that's a separate cleanup. But every *new* family must follow this rule. When in doubt: one Steps method, dispatch via options.

**Exception: matcher tree.** The matcher tree (`steps.expect(el, page).text.toBe(...)`) is *itself* the flexible-shape API — the chained matchers play the role that an options-union plays for flat methods. So `.text.toBe` / `.text.toContain` / `.text.toMatch` are correct on the matcher tree. The rule applies to flat `verifyX` methods on `Steps`, not to the chain.

### 19. Doc updates are mandatory for new public API

Any PR that adds a new public method to `Steps`, `ElementAction`, the matcher tree, or a new public matcher class **must** update both of:

1. `README.md` — under the relevant `🛠️ API Reference: Steps` subsection (Interaction / Verification / Data Extraction / Visibility / Listed Elements / etc.). One bullet per new method, plus an inline code example block when the API has a non-obvious option shape (e.g. discriminated unions, multi-form matchers).
2. `skills/element-interactions/references/api-reference.md` — under the matching section. The api-reference is the canonical documentation consumed by other skills (test-composer, coverage-expansion, bug-discovery), so missing entries here cause downstream agents to write tests that drop out of the framework.

**No "headline-worthy" exception.** The previous version of this rule allowed README updates only for headline-worthy features and produced silent doc drift — the HTML extraction surface (commit `d2f200e`) shipped without a README entry. If the change adds a method a user can call from a test, both files get an entry. The PR description should quote the new bullets verbatim so reviewers can grep them.

**Internal-only changes don't trigger this rule.** Adding a method to `Verifications`, `Interactions`, or `Extractions` *without* a corresponding `Steps` / `ElementAction` / matcher-tree entry point is internal — it's reachable only from the raw escape hatch (`interactions.verify.X`). The README docs the recommended surface; raw escape-hatch methods are documented inline via JSDoc on the class.

**Skill files updates** (`skills/element-interactions/SKILL.md`, `skills/contributing-to-element-interactions/SKILL.md`, etc.) are required only when the change affects a workflow stage, the contribution rules, or a hard rule. A new `verify*` method does not normally require a SKILL.md change.

---

## 📝 Contribution Handover

Every PR against this repo must ship a populated `.contribution-handover.json` at the repo root. The handover captures one boolean per guardrail in this skill, plus a small set of free-form fields (PR title, summary, version delta).

The schema lives at `schemas/contribution-handover.schema.json`. A blank template lives at `.contribution-handover.template.json`. Copy the template, fill it in, and commit the result as `.contribution-handover.json` on your branch.

The companion gate is `hooks/contribution-handover-gate.sh` — a `PreToolUse:Bash` hook that intercepts `git push origin` and `gh pr create` and refuses to let either run while the handover is missing, malformed, or has unset booleans. Install it by adding a `PreToolUse:Bash` entry pointing at the script in your `~/.claude/settings.json` (see the script's header for an exact wiring snippet).

**Why a handover, not just a checklist:**
- Structured booleans are machine-checkable. The gate spot-verifies a subset of claims against the actual repo state (e.g. `readmeUpdated: true` is cross-checked against the README diff vs. `origin/main`).
- The handover travels with the branch, so reviewers see what the contributor signed off on, with reasons attached to any `false` field. A markdown checklist can be ticked without verification; a structured handover with mismatched claims fails CI.
- The shape evolves with the rules. When a new hard rule lands in this skill, it gets a new field in the schema. Old handovers fail validation and contributors can't push until they review the new rule. The schema is the rule index.

**Field families:**
- `preflight` — duplicate-search, branch sync, dependency version checks (Hard Rule "Before filing").
- `design` — argument order, async, no-raw-locator, action-presence-detect, lightweight Steps, naming, error format, logging, TypeScript discipline (Design Rules 1–18).
- `tests` — implementation, real-Vue-app, non-tautological assertions, passing (Hard Rules "no mocked", "must verify causally").
- `build` — TypeScript build clean, full suite green, knownFailures (free-form for legitimate skips).
- `coverage` — 100% API coverage gate (Hard Rule).
- `docs` — README, api-reference, skill files (Rule 19).
- `version` — single patch bump (Rule 15).

For any boolean set to `false` or `"n/a"`, the corresponding `*Reason` field must be populated. Vague reasons ("not applicable", "didn't need it") fail the gate; specific reasons ("change is internal-only on Verifications, no public Steps surface added — Rule 19 doesn't apply") pass.

**Worked example.** This PR ships its own `.contribution-handover.json` — read it for the populated shape.

### Hook error message format — repo standard

Every hook under `hooks/*.sh` that emits a `permissionDecision: "deny"` (or a `systemMessage` warn) must format the reason text using the layout below. The shape is identical across hooks so contributors recognize a hook block instantly and know where to look.

```
[BLOCKED] <one-line headline — what's wrong, in present tense>

──────────────────────────
Do this instead:
──────────────────────────
  Option A — <case>
    <concrete template / command / config diff>
  Option B — <other case>
    <concrete next step>

──────────────────────────
What was wrong:
──────────────────────────
File: <path or N/A>
<observed values — claim, actual, diff, etc.>
<one-paragraph why it matters — the rule, the prior incident, the cost of the failure>

──────────────────────────
If <common motivation> — read this:
──────────────────────────
<pointer to the upstream fix or the rule the contributor is bumping against>

References:
  <canonical docs — file paths or URLs>
```

`[WARN]` replaces `[BLOCKED]` for `systemMessage`-style soft warnings. Box-drawing characters are U+2500 — copy them from this skill, not from any other hook (existing hooks predate this standard and use ad-hoc formatting; they'll be normalized in a separate cleanup PR).

**Why these sections exist:**
- *Headline* — the contributor sees the failure in one line in their terminal. Don't bury the rule in paragraph two.
- *Do this instead* — concrete, copy-pasteable. At least two options when there are two valid resolutions (fix the work vs. update the claim). One option when there's only one path (e.g. file-corruption → repair the file).
- *What was wrong* — observed state, including the file path, the claim, and the actual value. This is the audit-log section; without it, contributors can't tell which check fired.
- *If <motivation>* — the empathy line. Anticipates the most common reason a contributor hit this gate ("you ticked the box without updating the file") and routes them to the right fix path. Skip this section if there's no common motivation worth naming.
- *References* — the canonical docs for the rule. Always include the SKILL.md section that defines the rule, plus the schema / config file the contributor will edit. Two to four lines.

The `contribution-handover-gate.sh` hook is the canonical implementation — copy its `build_message` helper when writing a new hook.

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

# 4. Update docs (Rule 19 — both files mandatory for any new public API):
#    - skills/element-interactions/references/api-reference.md (the canonical source)
#    - README.md (the user-facing reference under "🛠️ API Reference: Steps")
#    - skills/element-interactions/SKILL.md (only if the change affects workflow stages)

# 5. Bump version once
npm version patch --no-git-tag-version

# 6. Populate the contribution handover
cp .contribution-handover.template.json .contribution-handover.json
# fill in every boolean; pair every false / "n/a" with a *Reason field

# 7. Commit + push + open PR
#    The contribution-handover-gate.sh hook (PreToolUse:Bash) will refuse
#    `git push origin` and `gh pr create` until the handover is valid.
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

## 🪝 Workflow: adding a harness hook

Hooks live in `hooks/<name>.sh`, are installed into `~/.claude/hooks/` by `scripts/postinstall.js`, and are registered in `~/.claude/settings.json` via the `HOOK_MANIFEST` array. They run at PreToolUse / PostToolUse / SubagentStop / Stop boundaries to enforce skill contracts mechanically — markdown rules can be rationalised away mid-run, hooks cannot.

When to add a hook (vs leaving the rule markdown-only):

- The rule is **mechanically detectable** at a tool-use boundary (specific tool, file path, command pattern, response-shape signal).
- Markdown enforcement has been observed to fail under context pressure.
- The cost of a violation is high (corrupt state, lost work, contract violation propagating downstream).

If the rule is too contextual to detect mechanically (e.g. "use the right level of detail in this brief"), it stays markdown-only. The anti-rationalization registry (`coverage-expansion/references/anti-rationalizations.md`) has a `markdown-only` tag for those.

### Hook authoring — three required patterns

#### 1. Documentation header — uniform across all hooks

Every hook starts with a structured comment block. Readers should be able to scan the header alone and answer: what event does it fire on, what does it block / warn on, where's the canonical rule it implements, what's the exact failure → action mapping.

```bash
#!/bin/bash
# <name>.sh — <one-line summary of what this hook does>
#
# Hook    : <event>:<matcher>  (e.g. PreToolUse:Agent, PostToolUse:Bash, SubagentStop)
# Mode    : <DENY | WARN | RECORD | combinations>  (DENY blocks the tool call,
#           WARN emits systemMessage, RECORD updates state without output)
# State   : <none | <repo-or-home>/.claude/<file>.json>
# Env     : <none | CIVITAS_X_Y=<int>  (default <N>, semantics)>
#
# Rule
# ----
# <Single paragraph: what this hook enforces. Names the contract surface
# concretely. No ambiguity about which tool calls are caught.>
#
# Why
# ---
# <Single paragraph: motivation. Why mechanical enforcement here? What
# failure mode does it catch that markdown couldn't?>
#
# Canonical reference
# -------------------
# skills/<skill>/SKILL.md §"<section>"  (and/or)
# skills/<skill>/references/<file>.md §"<section>"
#
# (Optional sections: Conventions / Allowed list / Migration / etc. —
#  use them when the rule has a non-trivial vocabulary the reader needs
#  alongside the comment block.)
#
# Failure → action
# ----------------
# - <violation>                                       → DENY|WARN|RECORD
# - <other violation>                                 → DENY|WARN|RECORD
# - <legitimate-looking case that's exempt>          → silent allow
# - Anything else                                     → silent allow
```

This pattern is followed by every hook in `hooks/`. Adding a new hook with a different shape regresses scannability — match the existing template. Examples to read first: `hooks/coverage-expansion-dispatch-guard.sh` (DENY + WARN), `hooks/raw-playwright-api-warning.sh` (WARN-only), `hooks/suite-gate-ratchet.sh` (RECORD + DENY across two events).

#### 2. Helper functions — consistent shape

Hooks emit two output shapes: a deny JSON (PreToolUse-only, blocks the tool call) and a warn JSON (any event, emits a `systemMessage`). Both are wrapped in helpers defined inline at the top of the script:

```bash
emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

emit_warn() {
  jq -n --arg m "$1" '{
    "systemMessage": $m,
    "suppressOutput": false
  }'
}
```

Define only what the hook actually uses (a deny-only hook doesn't need `emit_warn`). Don't inline a fresh `jq -n` in each call site — that's the older pattern PR #136 unified away.

#### 3. Action-first error message template — guide the agent back on track

Hook deny / warn messages are read by an agent under context pressure. The agent's next action is what matters most — not the diagnosis, not the references. Lead with the action.

Template:

```
[BLOCKED|WARN] <one-line headline of what was caught>

──────────────────────────────────────────────────────────────────
Do this instead — <option list or concrete template>:
──────────────────────────────────────────────────────────────────

  Option A — <case>
    <concrete next step: code template, command, or option>
  Option B — <other case, if applicable>
    <concrete next step>

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
File: <path>
<observed values that triggered the rule>

<one-paragraph diagnosis: what the violation was, what failure mode it
represents, name the framings/symptoms verbatim where applicable>

──────────────────────────────────────────────────────────────────
If <common motivation for the violation> — read this:
──────────────────────────────────────────────────────────────────
<pointer to the upstream fix that resolves the underlying concern, NOT
the symptom-level workaround>

References:
  <canonical-doc-path-1>
  <canonical-doc-path-2>
```

Why this shape:
- **Action first.** The agent reading the message under context pressure should see the next step in the first ~10 lines. References at the end are for follow-up, not primary action.
- **Show, don't describe.** A concrete `Agent({...})` template, command, or option-list beats prose. Substitute extracted values where possible (slug from file path, count from JSON, etc.) so the agent can copy-paste.
- **Named symptoms.** When the violation has a recognisable internal-monologue framing ("honest stopping point", "I'll be transparent", "given session constraints"), name it verbatim in the diagnosis. Future agents recognise their own self-talk.
- **Underlying concern + upstream fix.** When a violation is driven by a real concern (e.g., parallel dispatch felt unsafe due to shared-DB races), acknowledge the concern and point at the upstream fix (per-test-user pattern in test-optimization §1.A) — NOT the symptom-level workaround. Otherwise the agent re-violates as soon as the same concern recurs.
- **References last.** Two to four canonical doc paths. Don't bury them in prose; list them.

Examples to read: `hooks/coverage-state-schema-guard.sh` (pre-emptive-stop deny — Option A / Option B layout) and `hooks/coverage-expansion-direct-compose-block.sh` (concrete Agent template substituted with the journey slug from the file path; gated on the `.in-flight-composers.json` registry written by `hooks/coverage-expansion-dispatch-guard.sh` to distinguish legitimate composer-subagent writes from orchestrator-direct composition without a harness `is_subagent` field).

### Hook checklist

When opening a PR that adds or modifies a hook:

- [ ] Documentation header follows the unified template (Hook / Mode / State / Env / Rule / Why / Canonical reference / Failure → action).
- [ ] `emit_deny` / `emit_warn` helpers used consistently — no inline `jq -n --arg` calls in the body.
- [ ] Error messages follow the action-first template (headline → Do this instead → What was wrong → upstream fix → References).
- [ ] Test cases added to `hooks/tests/cases/<NN>-<topic>.sh` covering: happy-path allow, each rule's deny/warn path, exempt cases, edge cases (empty inputs, special characters, alternate runner forms, etc.).
- [ ] `bash hooks/tests/run.sh` reports green on the new case file plus all existing cases.
- [ ] If the hook records state, the state-file path and shape are documented in the canonical reference.
- [ ] `scripts/postinstall.js` HOOK_MANIFEST updated with the new entry (file, event, matcher, timeout, optional async).
- [ ] If the hook gates a markdown rule, the kernel-resident invariants in the relevant SKILL.md mention the harness backstop ("Harness-enforced by `hooks/<name>.sh`").
- [ ] If the rule has a category in the anti-rationalization registry, the registry entry's `Hooks that catch this:` list is updated.

### Approximating `is_subagent` — the in-flight-registry pattern

The Claude Code harness payload doesn't include an `is_subagent` field on hook input — `Write` calls from a dispatched subagent and `Write` calls from the orchestrator are indistinguishable at hook-fire time.

When a hook needs to distinguish "was this tool call made by a legitimately-dispatched subagent doing its expected work" from "was this the orchestrator absorbing work that should have been delegated", use the **in-flight-registry pattern**:

1. **PreToolUse:Agent (the dispatch-guard)** writes a registration entry to a state file (e.g. `tests/e2e/docs/.in-flight-composers.json`) when the dispatch matches a known role-prefix that produces specific tool calls (e.g. `composer-j-<slug>:` produces a `Write tests/e2e/j-<slug>.spec.ts`).
2. **PostToolUse / PreToolUse on the produced tool call** reads the registry and gates the call: if the slug is in-flight (within a TTL window), the writer is the legitimate subagent — ALLOW. If not in-flight, it's the orchestrator absorbing — DENY with a redirect to dispatch the right subagent.
3. **TTL / cleanup as a failsafe**: the registry uses a rolling 30-min TTL — entries that aren't deregistered explicitly (see point 4) expire on the next dispatch-guard run, so stale registrations don't accumulate when a subagent crashes or is abandoned mid-flight.
4. **Explicit deregistration on terminal handover (the primary cleanup path).** Each subagent return is prefaced with a `handover:` envelope (`role`, `cycle`, `status`, `next-action` — schema in [`../element-interactions/references/subagent-return-schema.md`](../element-interactions/references/subagent-return-schema.md) §2.0). The PostToolUse return-schema guard parses the envelope, cycle-matches against the registry entry, and **deregisters the slot immediately on terminal status** instead of waiting for TTL. Cycle-mismatch (envelope claims a different cycle than the registered dispatch) refuses to deregister and asks the orchestrator to redispatch under the correct cycle. This shorter leash matters because the orchestrator's redispatch under the same slug can race with stale handovers from a slow / auto-compacted prior cycle — the cycle-match contract pins the deregistration to one specific dispatch.

The reference implementation is `hooks/coverage-expansion-dispatch-guard.sh` (registers `composer-j-*` / `composer-sj-*` / `probe-j-*` / `probe-sj-*` dispatches with a `cycle` field) paired with `hooks/coverage-expansion-direct-compose-block.sh` (gates `tests/e2e/{j,sj}-*.spec.ts` writes against the registry) and `hooks/subagent-return-schema-guard.sh` (parses the handover envelope, cycle-matches, deregisters terminal handovers). The pattern avoids false positives that would otherwise force a WARN — the gate runs as a hard DENY because the registry mechanically distinguishes legitimate from violation, and the leash is bounded by the explicit handover instead of the looser 30-min window.

When you ship a new harness pattern that needs the same distinction, register at the dispatch boundary, gate at the produced-tool-call boundary, deregister on the canonical handover envelope, and keep the TTL as a failsafe. Use a hidden state file under `tests/e2e/docs/.<topic>-<scope>.json` to keep the registry alongside other coverage-expansion state.

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

2. **Run the duplicate-prevention checks** from the "Before filing an issue or opening a PR" hard rule above — search existing issues/PRs (open + closed) in both repos, diff local vs. `origin/main`, and confirm your pinned dependency version is the latest. A large share of "missing API" reports are already fixed on main or in a newer published version.

3. **If it's genuinely missing after those checks:**
   - Open an issue on `civitas-cerebrum/element-interactions` describing the use case. Include the check results (see the hard rule's reporting template).
   - If it's a generic element capability (CSS variable, custom property, drag with timing), it belongs in element-repository's `Element` interface first.
   - If it's an assertion shape, it belongs on the matcher tree.

4. **If you need to ship NOW**, the documented escape hatch is `interactions.interact.*`, `interactions.verify.*`, `interactions.extract.*` — they accept either `Locator` or `Element`. Use these for the one-off, but file the issue so the proper API can land.

5. **Never** check raw `locator.*()` calls into a test file or into the element-interactions src/. The audit grep above will catch it in code review.

---

## 🧱 When the framework cannot satisfy a documented rule

Sometimes the problem is not a missing method on `Steps` — it's that a skill, workflow, or invariant declares a rule the package's current architecture cannot back. The MCP→playwright-cli migration (#121, #122) is the canonical case: every browser-using skill in this suite required parallel-subagent isolation, but the Playwright MCP plugin shared one browser process across all subagents. The rule was unsatisfiable until the package switched tooling.

Distinguishing a structural gap from an API gap:

| Symptom | Class | What you're missing |
|---|---|---|
| User wants `steps.foo()` and it doesn't exist | API gap | A method on the public surface |
| Skill prereq says "X must be true at dispatch time" and the package can't make X true | Structural gap | A primitive / mechanism the package doesn't currently provide |
| Workaround would mean turning off, weakening, or silently skipping a documented invariant | Structural gap | The invariant is load-bearing; the fix is at the package layer |
| Two parallel subagents corrupt each other's state through the package's chosen tool | Structural gap | OS-level isolation the current tool can't give |
| The package's protocol assumes a host capability the runtime doesn't expose | Structural gap | A different protocol or a different tool |

**If it's a structural gap, the workflow is different from "open an API-gap issue":**

1. **Write down the unsatisfied invariant precisely.** Quote the rule from the skill that depends on it (file + line). State the mechanism in the package that fails to back it. Without this, the issue reads as "a thing didn't work" instead of "this contract is structurally broken."

2. **Don't relax the invariant in the consuming skill.** The rest of the suite is built on it. Patching around it locally hides the structural problem and creates inconsistencies between skills that respect the rule and skills that don't.

3. **Open an issue on `civitas-cerebrum/element-interactions`** (the package, not the consuming skill repo, even if you found the gap while writing a skill) — with the duplicate-prevention checks above and a "smallest credible structural fix" sketch. Examples of "smallest fix": switch underlying tool, expose a new primitive, change a protocol shape. If the fix is large, that's fine — name it; don't hide it.

4. **The PR that fixes it lands in the package**, not in the consuming skill. The consuming skill only updates once the new primitive is published — and at that point, the consuming skill's job is to *delete* its workaround and trust the new contract.

5. **Decide between "block the rollout" and "ship a documented workaround."** A structural gap blocks the rollout when the invariant is safety-critical (data corruption, cross-tenant leakage, false-pass tests). A documented workaround is acceptable when (a) the workaround is local and reversible, (b) the cost of waiting exceeds the cost of the workaround, and (c) the issue is filed and the cleanup is tracked.

**Examples that should trigger this skill, not a skill-level workaround:**

- "I need parallel browser isolation, but the package's MCP protocol shares one browser." → File an issue; consider a tool swap. (#121 / #122 — actual case.)
- "My skill needs auth state to survive a failure boundary, but the package doesn't expose state-save / state-load." → File an issue against the package; do not write a brittle re-login loop in the skill.
- "The orchestrator's Rule X requires Y before dispatch, but the package can't tell us Y." → File an issue; add the primitive in the package; consume it from the orchestrator.

If a skill's prereq check is consistently failing because the package can't satisfy it, that's a structural gap, not a skill bug. Route it here.

---

## 📋 PR checklist

Before opening a PR on element-interactions:

- [ ] Searched existing issues + PRs (both repos, open + closed) for duplicates — none found, or linked to related work in the PR body
- [ ] Local branch is up-to-date with `origin/main` (`git fetch && git log HEAD..origin/main` is empty, or rebased)
- [ ] Dependency versions (`@civitas-cerebrum/element-repository`) checked against `npm view` — pinned to latest or intentionally older with a reason
- [ ] Tests pass: `npm run test` shows all tests passing
- [ ] Coverage 100%: `npx test-coverage --format=github-plain` shows ✅
- [ ] No raw Playwright leak: `grep -rn "locator\.\(click\|fill\|...\)" src/ --include="*.ts"` returns zero matches in non-`Element`-impl code
- [ ] Version bumped exactly once (`npm version patch` at first commit, not at every commit)
- [ ] API reference updated (`skills/element-interactions/references/api-reference.md`) — mandatory for any new public method on Steps / ElementAction / matcher tree (Rule 19)
- [ ] README updated under `🛠️ API Reference: Steps` — mandatory for any new public method on Steps / ElementAction / matcher tree (Rule 19)
- [ ] If adding a new method, it has a JSDoc block on the public-facing class
- [ ] `.contribution-handover.json` populated against `schemas/contribution-handover.schema.json` — every boolean set; every `false` / `"n/a"` paired with a specific `*Reason` field (verified by `hooks/contribution-handover-gate.sh`)
- [ ] If this PR closes a GitHub issue, the commit body and the PR description both include `Reported-by: @<github-handle>` crediting the issue author (Hard rule §"Attribute issue reporters", verified by `hooks/commit-attribution-gate.sh`)

If you're adding to element-repository first:

- [ ] Searched existing issues + PRs on `civitas-cerebrum/element-repository` (open + closed) — no duplicate
- [ ] Local branch is up-to-date with `origin/main` on element-repository
- [ ] New method on `Element` interface (cross-platform) OR `WebElement` only (with rationale comment)
- [ ] `WebElement` implementation included
- [ ] `PlatformElement` implementation included if cross-platform
- [ ] Action methods include the `ensureAttached(timeout)` preamble
- [ ] Live test added in `tests/live-element-location.spec.ts`
- [ ] Coverage 100% (`npx test-coverage`)
- [ ] Patch version bumped
- [ ] README updated if adding to the public surface
