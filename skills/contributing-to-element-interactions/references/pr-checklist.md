**Status:** authoritative reference for the PR checklist. Cited from `contributing-to-element-interactions/SKILL.md`.

**Scope:** the preflight every PR must pass before opening — element-interactions side and element-repository side.

---

## 📋 PR checklist

Before opening a PR on element-interactions:

- [ ] Searched existing issues + PRs (both repos, open + closed) for duplicates — none found, or linked to related work in the PR body
- [ ] Local branch is up-to-date with `origin/main` (`git fetch && git log HEAD..origin/main` is empty, or rebased)
- [ ] Dependency versions (`@civitas-cerebrum/element-repository`) checked against `npm view` — pinned to latest or intentionally older with a reason
- [ ] Tests pass: `npm run test` shows all tests passing
- [ ] Coverage 100%: `npx test-coverage --format=github-plain` shows ✅
- [ ] No raw Playwright leak: `grep -rn "locator\.\(click\|fill\|...\)" src/ --include="*.ts"` returns zero matches in non-`Element`-impl code
- [ ] Version bumped exactly once, to `(npm-latest + 1 patch)` — verified against `npm view @civitas-cerebrum/element-interactions version` (Rule 15 — collision-safe across parallel PRs)
- [ ] API reference updated (`skills/element-interactions/references/api-reference.md`) — mandatory for any new public method on Steps / ElementAction / matcher tree (Rule 19)
- [ ] README updated under `🛠️ API Reference: Steps` — mandatory for any new public method on Steps / ElementAction / matcher tree (Rule 19)
- [ ] If adding a new method, it has a JSDoc block on the public-facing class
- [ ] `.contribution-handover.json` populated against `schemas/contribution-handover.schema.json` — every boolean set; every `false` / `"n/a"` paired with a specific `*Reason` field (verified by `hooks/contribution-handover-gate.sh`)
- [ ] **If this PR adds, modifies, or strengthens any `skills/*/SKILL.md` rule, workflow, phase, gate, invariant, or contract, it ALSO ships a hook under `hooks/` that enforces the rule programmatically (Hard rule §"Methodology improvements ship as programmatic hooks"). When mechanical enforcement is genuinely impossible, the PR description includes a paragraph explaining why and the rule is tagged `markdown-only` in `coverage-expansion/references/anti-rationalizations.md`.**

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

---

**See also:** [`./hard-rules.md`](./hard-rules.md) (the rules each box maps to), [`./design-rules.md`](./design-rules.md) (Rules 15 + 19 referenced inline), [`./contribution-handover.md`](./contribution-handover.md) (the structured handover the gate enforces), [`./api-workflow.md`](./api-workflow.md) (the recipe whose outputs this checklist verifies).
