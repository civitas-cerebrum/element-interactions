**Status:** authoritative reference for placement decisions. Cited from `contributing-to-element-interactions/SKILL.md`.

**Scope:** the five-step decision tree for picking the right home for a new API, plus the "stop and discuss" escape.

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

**See also:** [`./architecture.md`](./architecture.md) (layer responsibilities the tree assumes), [`./design-rules.md`](./design-rules.md) (the invariants each placement must respect), [`./api-workflow.md`](./api-workflow.md) (the concrete shipping recipe once placement is decided).
