**Status:** authoritative reference for the new-API workflow. Cited from `contributing-to-element-interactions/SKILL.md`.

**Scope:** the concrete, command-by-command shipping recipes for adding to element-repository, element-interactions, or both at once.

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

# 6. Bump version against npm-latest (Rule 15 — collision-safe across parallel PRs)
npm version "$(npm view @civitas-cerebrum/element-repository version | awk -F. '{print $1"."$2"."$3+1}')" --no-git-tag-version

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

# 5. Bump version once, against npm-latest (Rule 15 — collision-safe across parallel PRs)
npm version "$(npm view @civitas-cerebrum/element-interactions version | awk -F. '{print $1"."$2"."$3+1}')" --no-git-tag-version

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

**See also:** [`./decision-tree.md`](./decision-tree.md) (where the new API belongs before you reach for the recipe), [`./design-rules.md`](./design-rules.md) §15 (version-bump rule that the recipes use), [`./pr-checklist.md`](./pr-checklist.md) (the final preflight before pushing), [`./contribution-handover.md`](./contribution-handover.md) (the handover that gates the push).
