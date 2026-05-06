**Status:** authoritative reference for the API-gap consumer flow. Cited from `contributing-to-element-interactions/SKILL.md`.

**Scope:** what to do when, as a consumer of the package, you hit a missing method / matcher / option and feel the temptation to drop down to raw Playwright.

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

2. **Run the duplicate-prevention checks** from the "Before filing an issue or opening a PR" hard rule (see [`./hard-rules.md`](./hard-rules.md)) — search existing issues/PRs (open + closed) in both repos, diff local vs. `origin/main`, and confirm your pinned dependency version is the latest. A large share of "missing API" reports are already fixed on main or in a newer published version.

3. **If it's genuinely missing after those checks:**
   - Open an issue on `civitas-cerebrum/element-interactions` describing the use case. Include the check results (see the hard rule's reporting template).
   - If it's a generic element capability (CSS variable, custom property, drag with timing), it belongs in element-repository's `Element` interface first.
   - If it's an assertion shape, it belongs on the matcher tree.

4. **If you need to ship NOW**, the documented escape hatch is `interactions.interact.*`, `interactions.verify.*`, `interactions.extract.*` — they accept either `Locator` or `Element`. Use these for the one-off, but file the issue so the proper API can land.

5. **Never** check raw `locator.*()` calls into a test file or into the element-interactions src/. The audit grep above will catch it in code review.

---

**See also:** [`./structural-gap-flow.md`](./structural-gap-flow.md) (sibling flow when the gap is structural, not just a missing method), [`./decision-tree.md`](./decision-tree.md) (where the new API will live once you file the issue), [`./hard-rules.md`](./hard-rules.md) (the duplicate-prevention checks step 2 references).
