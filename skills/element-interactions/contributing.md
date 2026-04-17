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

## 🏛️ Architecture: separation of concerns

The framework is split across **two packages** for a reason. Understand the split before adding anything.

### `@civitas-cerebrum/element-repository`

Owns **element acquisition** and the platform-agnostic `Element` interface.

- `Element` interface — cross-platform contract: `click`, `fill`, `getAttribute`, `getCssProperty`, `boundingBox`, `screenshot`, `dragTo`, `getTagName`, `exists`, `waitFor`, `count`, `first`, `nth`, `filter`, etc.
- `WebElement` — Playwright-backed implementation. Also exposes web-only methods that have no platform equivalent: `getAllAttributes`, `selectOption`, `rightClick`.
- `PlatformElement` — WebDriverIO/Appium-backed implementation. Implements every `Element` method.
- `ElementRepository` — resolves names → `Element` instances using `page-repository.json`.
- `ElementChain` — fluent action builder returned by `element.action()`.

**Where things go in element-repository:**
- A method on the **Element interface** if it has a meaningful implementation on both web and Appium.
- A method on **WebElement only** if it's a pure DOM/HTML/mouse concept with no cross-platform equivalent (HTML `<select>`, mouse right-click, DOM attribute enumeration).
- The `Element.click/fill/...` etc. include a presence-detection preamble (`ensureAttached(timeout)`) before the underlying driver call. New action methods MUST do the same.

### `@civitas-cerebrum/element-interactions`

Owns **interaction patterns, assertions, and the test-author-facing facade**.

- `Steps` — top-level API used in tests (`steps.click('el', 'page')`, `steps.expect('el', 'page').text.toBe('x')`).
- `ElementAction` — the fluent builder returned by `steps.on('el', 'page')`.
- `Interactions`, `Verifications`, `Extractions` — internal helpers Steps delegates to.
- `ExpectMatchers` — the chain-style matcher tree (`text.toBe`, `count.toBeGreaterThan`, `.not`, `.throws`, `.timeout`).
- `BaseFixture` — Playwright fixture that wires everything up.

**Where things go in element-interactions:**
- New verification matchers belong on `ExpectMatchers.ts` — extending the chain tree.
- New action helpers (e.g. composite workflows) belong on `Steps` and possibly `ElementAction`.
- Anything that touches a Playwright `Locator` directly is a smell — the underlying capability probably belongs in `element-repository`'s `Element` interface first.

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

## 📐 Design principles — respect when scaling

### 1. Chain-style API for assertions

The matcher tree (`steps.expect('price', 'Page').text.toBe('$10').count.toBe(1)`) is the canonical shape for verifications. New verifications should extend this tree, not add flat `verifyX` methods. The `verify*` family on `Steps` is legacy compatibility — keep it, don't grow it.

### 2. One-shot semantics for `.not`

`.not` flips the **next matcher only**, then resets. Don't introduce sticky-negation modes or multi-matcher negation scopes; it confuses reading.

### 3. Builder-mutates, matcher-clones

- Strategy selectors on `ElementAction` (`.first()`, `.nth()`, `.byText()`, `.timeout()`) **mutate** the builder and return `this`. Consistent with Playwright's locator semantics.
- Matcher classes are immutable — `.timeout(ms)` and `.not` return new instances. Each matcher call is independent.

### 4. Snapshot-based predicates

The predicate escape hatch (`steps.expect(el, page).toBe(predicate)`) takes a function that receives an `ElementSnapshot` — plain data, no async access. This keeps custom assertions readable and predictable. **Do not** change the predicate to receive an `Element` directly — users should never need to `await` inside a predicate.

### 5. Backwards compatibility on user-facing API

`steps.click`, `steps.verifyText`, `steps.on(...).fill`, etc. — all the entry points users have written tests against — stay stable across versions. Internal refactors are fine; signature changes on user-facing methods need a major bump and a clear migration note.

The current public `Target` type (`Locator | Element`) accepting raw Locators is held for backwards compatibility (see issue #74). Don't tighten this without coordination.

### 6. Patch-version one-PR-one-bump rule

Run `npm version patch` once per PR (at the first commit). Do not bump on every follow-up commit on the same branch — the `publish.yml` workflow publishes whatever version is in `package.json` at merge time.

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
