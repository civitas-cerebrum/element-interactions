**Status:** authoritative reference for hard rules. Cited from `contributing-to-element-interactions/SKILL.md`.

**Scope:** the named, non-negotiable rules a contribution must satisfy before it ships — methodology-as-hooks, before-filing duplicate-prevention, no raw locator in src/, action methods presence-detect, web-only cast, 100% API coverage, in-package smoke tests must verify causally, no mocked unit tests.

---

## 🚨 Hard rules — don't violate

### Methodology improvements ship as programmatic hooks, not just markdown

**Every PR that adds, modifies, or strengthens a rule, workflow, phase, gate, invariant, or contract in any `skills/*/SKILL.md` (or its referenced files under `references/`) MUST ship a corresponding harness hook in `hooks/` that enforces the rule programmatically — or include an explicit, reviewer-visible note explaining why mechanical enforcement is impossible.**

Markdown is documentation, not enforcement. Under context pressure, an orchestrator reading its own rule will rationalise around it ("this case is different", "given session constraints", "I'll be transparent about the trade-off") and stop / narrow / skip anyway. This is not a hypothetical — it is the documented failure pattern of issues #139, #154, #155, and #156. The harness layer is the only second-reader the orchestrator cannot talk past.

**Decision rule** (apply when you write or edit any SKILL.md rule):

| Rule shape | Hook surface |
|---|---|
| "Read X before doing Y" | `PreToolUse:Edit\|Write\|Agent` checks transcript for the required Read before allowing the dependent tool call. |
| "Don't stop until Y is done" | `Stop` or `SubagentStop` reads a ledger / state file, denies stop when invariant fails. |
| "Don't dispatch shape Z here" | `PreToolUse:Agent` greps `tool_input.prompt` for the forbidden pattern. |
| "State file Z must satisfy invariant W" | `PreToolUse:Write` validates the JSON / markdown shape. |
| "Subagent return must follow shape S" | `SubagentStop` parses the handover envelope, exit-2-blocks non-compliant returns. |
| "After phase N, file F must exist" | `PreToolUse:Agent` denies advancing to phase N+1 when F is absent or stale. |

If none of these apply because the rule is genuinely unenforceable mechanically (e.g. "use the right level of detail in the brief", "be honest about uncertainty"), the SKILL.md edit MUST add a `markdown-only` tag to the relevant entry in `coverage-expansion/references/anti-rationalizations.md` so the registry continues to track the failure surface even without harness backing.

**Why this is non-negotiable:** every markdown-only methodology rule that survives a release is a future incident waiting to happen. The cost of writing the hook is hours; the cost of debugging a wrong-classification incident the rule was meant to prevent is days plus the operator trust the package is supposed to earn. The asymmetry is the rule.

**Reference:** [`./hook-authoring.md`](./hook-authoring.md) details the hook authoring patterns, test-case expectations, and `scripts/postinstall.js` registration. Read it before authoring any SKILL.md edit so the hook is designed alongside the rule rather than retro-fitted.

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

**See also:** [`./design-rules.md`](./design-rules.md) (the numbered design invariants that complement these hard rules), [`./hook-authoring.md`](./hook-authoring.md) (how to back the methodology rule with a hook), [`./contribution-handover.md`](./contribution-handover.md) (the handover surface that machine-checks every hard rule).
