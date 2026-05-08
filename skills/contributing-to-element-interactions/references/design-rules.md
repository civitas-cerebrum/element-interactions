**Status:** authoritative reference for design rules. Cited from `contributing-to-element-interactions/SKILL.md`.

**Scope:** the numbered invariants (Rules 1-19) that hold the framework together. Every change must respect them; breaking one is a major-version-bump conversation.

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

### 15. No version bumps without explicit authorisation

**Don't run `npm version <X>`. Don't edit `package.json`'s `version` field. Don't push a tag.** Versioning is release-time, not per-PR. The user controls when bumps happen.

The only time a contributor (or an agent acting for one) may bump is when **the user has explicitly authorised that specific bump in the conversation**. The authorisation is signalled by an in-band marker on the bash command line:

```bash
VERSION_BUMP_AUTHORISED=1 npm version patch --no-git-tag-version
VERSION_BUMP_AUTHORISED=1 npm version 0.4.0
```

The marker travels with the command — auditable in git log, copy-pasteable from the user's authorising message. Don't set the env var globally; inline it on the bump command only. Without that prefix, `hooks/version-bump-authorisation-guard.sh` (PreToolUse:Bash) denies the command at the harness boundary.

**Why this rule exists.** Multiple open PRs colliding on the same version number was the symptom; per-PR bumping was the disease. Reviewers had to mentally subtract the version line from every PR diff; merge order rewrites version slots; reviewers chase rebases instead of code. Versioning at release-time — when a coherent set of changes is ready to publish — collapses every PR's diff to "the actual change" and gives the maintainer release control.

**Escape hatches** (rare):
- `BUMP_AUTHORISATION_GUARD=off` — for release-script automation that has already proven authorisation upstream. Set in the parent shell that runs the bash command; not on the command line itself.
- The hook never fires on `npm publish` (out of scope; the existing `feedback_never_publish` rule covers that), `npm view ... version` (read, not bump), `node --version` / `npm --version`, or `npm run <some-script>` even if the script is named `version-bump`.

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

**Harness backstop.** This rule is mechanically backed by `hooks/contribution-doc-update-required.sh` (`PreToolUse:Bash`, WARN-only). The hook intercepts `git commit` invocations, parses the staged diff for additions to `src/steps/CommonSteps.ts`, `src/steps/ElementAction.ts`, and `src/steps/ExpectMatchers.ts` that introduce a new public method, and emits a `systemMessage` warning when the same staged diff does not also touch both `README.md` and `skills/element-interactions/references/api-reference.md`. WARN (not DENY) because internal-only refactors that look like new public methods at the heuristic level (e.g. a renamed private helper that surfaces in the matched line shape) are common false positives — surfacing the recommendation is more valuable than blocking. Escape hatch: `CONTRIB_DOC_UPDATE_GUARD=off`.

---

**See also:** [`./hard-rules.md`](./hard-rules.md) (the named hard rules these design rules complement), [`./architecture.md`](./architecture.md) (the layer model the rules govern), [`./contribution-handover.md`](./contribution-handover.md) (the handover surface that machine-checks each rule).
