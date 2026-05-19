---
name: selector-development
description: >
  Use when test authoring needs a stable selector for an element that has none — and only when the test
  work lives in the same project as the frontend source. Adds a single inert test attribute (data-testid
  or the project's detected convention) to the offending element, runs an 8-step hook-enforced guardrail
  pipeline (typecheck + unit + e2e + visual diff), and lets the calling skill resume. Triggers from Stage 2
  inspection escalation (no stable selector found), from failure-diagnosis (fragile-selector root cause),
  or directly when the user says "add stable selectors to <X>" / "audit selectors across the app". Never
  modifies structure, class, id, aria, handlers, or text — only appends one attribute. Refuses if the
  workspace doesn't contain both frontend source and tests/e2e/. Two modes: JIT (one element, default)
  and Audit (whole-app workflow, opt-in).
---

# selector-development — Stable Selector Instrumentation

A companion skill of `@civitas-cerebrum/element-interactions` that closes the gap between "no stable selector" and "resume test authoring". When the test workflow is co-located with the frontend source, this skill adds a single inert test attribute to the offending element, proves the change has zero functional or visual impact through an 8-step hook-enforced guardrail pipeline, and returns control to the calling skill.

**Core principle:** Smallest possible diff. One element, one attribute, one round-trip. No structural changes, no refactoring, no multi-element batching inside JIT mode.

## Reference index

| Reference file | What's in it |
|---|---|
| [`references/activation-gate.md`](references/activation-gate.md) | Workspace + missing-selector detection. |
| [`references/selector-convention.md`](references/selector-convention.md) | Attribute precedence + naming rules. |
| [`references/inertness-contract.md`](references/inertness-contract.md) | The additive-only contract. |
| [`references/guardrail-pipeline.md`](references/guardrail-pipeline.md) | The 8-step pipeline + journal schema + revert. |
| [`references/hook-contracts.md`](references/hook-contracts.md) | Per-hook deny/record rules — load-bearing for hook authors. |
| [`references/audit-mode-workflow.md`](references/audit-mode-workflow.md) | Whole-app workflow loop. |

---

## Activation contract

The skill is gated behind two preconditions. Both must hold or the skill exits with a notice — it never silently proceeds on a partial workspace.

### Workspace gate

Both signals must be present:

| Signal | Detection |
|---|---|
| Frontend source present | `package.json` has a frontend framework dep (`react`, `vue`, `svelte`, `@angular/core`, `solid-js`, `preact`, `lit`); a directory under `src/`, `app/`, or `pages/` contains files with extensions `.tsx`, `.jsx`, `.vue`, `.svelte`, or `.html`. |
| Tests present | `tests/e2e/` exists and contains at least one `*.spec.ts` file. |

**If frontend missing:** exit with notice — "tests not authored inside the frontend project — selector-development cannot run; fall back to best-effort locator."

**If tests missing:** exit with notice — "no test suite to author against — selector-development is only invoked from a test workflow."

### Missing-selector gate

The element under test must have ALL of the following:

- No existing test attribute (`data-testid` / `data-cy` / `data-qa` / `data-test`), AND
- No unique role + accessible-name combination, AND
- No unique stable text content (text that is asserted-on or copy-driven is not stable).

If any one of those is satisfied, exit silently — Stage 2 already has a working locator. This avoids over-instrumenting accessible UIs.

### Trigger points

When both gates pass, the skill activates from any of:

1. **Stage 2 inspection escalation** — `element-interactions` orchestrator reports "no stable selector available" and dispatches `selector-development` with `mode: "jit"` and the element-key/scope.
2. **`failure-diagnosis` escalation** — failure-diagnosis attributes a flake/break root cause to a fragile selector and dispatches `selector-development` with `mode: "jit"`.
3. **On-demand user invocation** — the user says "add stable selectors to the cart drawer" (JIT) or "audit selectors across the app" / `mode: "audit"` (Audit).

---

## Two operating modes

### JIT mode (default)

Instruments exactly **one element**. Smallest possible diff: one element, one attribute, one round-trip to the calling skill. Triggered by Stage 2 / failure-diagnosis / a single-element user request.

**JIT loop — every step is mandatory, in order:**

1. Receive the scope (element-key) from the calling skill or user.
2. Run both preconditions (workspace gate + missing-selector gate). Exit if either fails.
3. Initialize the receipt at `tests/e2e/.selector-development/<element-key>.receipt.json`; write `.current-scope` with the element-key.
4. **Step 1 — Before snapshot:** Take a screenshot of the affected route via `playwright-cli screenshot`, writing to `tests/e2e/.selector-development/before/<scope>.png`. The stepper hook records `before_snapshot: pass` on success.
5. **Step 2 — Patch applied:** Edit the frontend source file — append the detected test attribute to the target opening tag. Only this one attribute change is allowed. The inertness guard denies any broader diff at the filesystem layer. The stepper records `patch_applied: pass` with the file list and `git_diff_hash`.
6. **Step 3 — Typecheck:** Run the project's typecheck script (detected from `package.json`: `typecheck` → `tsc` → `lint:types`). The stepper records `typecheck: pass` with elapsed time.
7. **Step 4 — Unit tests:** Run the project's unit-test script (jest / vitest / equivalent). The stepper records `unit_tests: pass`.
8. **Step 5 — E2E:** Run `playwright test <spec>` for the affected spec file. The stepper records `e2e: pass` with the spec path.
9. **Step 6 — After snapshot:** Take a screenshot of the same route again, writing to `tests/e2e/.selector-development/after/<scope>.png`. The stepper records `after_snapshot: pass`.
10. **Step 7 — Visual diff:** Run `node methodology/hooks/lib/visual-diff.js before/<scope>.png after/<scope>.png`. Pass criterion is exactly 0 diff pixels (configurable up to 10 with explicit project config). The stepper records `visual_diff: pass` with `diff_pixels` count.
11. **Step 8 — Commit:** Run `git commit` with the patched frontend file staged. The stepper clears `.current-scope` and archives the receipt to `tests/e2e/.selector-development/archive/`.
12. Return the canonical return envelope (see "Return shape" below) to the caller.

**On any guardrail failure (steps 3–7):** the stepper appends `fail` instead of `pass`; the next step's gate denies. Run the revert path: `git checkout -- <patched files>`, delete the receipt, clear `.current-scope`, return `status: "blocked"` with the failing artifact path.

### Audit mode (opt-in)

Activated by `mode: "audit"` or phrases like "audit selectors across the app", "instrument all pages". Iterates the journey map page-by-page, instrumenting interactive/asserted nodes that lack stable selectors. Each page results in one commit with full guardrails.

**Audit prerequisites:**

- A complete sentinel-bearing `tests/e2e/docs/journey-map.md` (line 1 must be `<!-- journey-mapping:generated -->`). If absent or sentinel-less, exit and ask the user to run `journey-mapping` first.
- Both workspace-gate signals present.

**Audit loop — every step is mandatory:**

1. Read `tests/e2e/docs/journey-map.md`; build the ordered page list from the site map section.
2. Read (or initialize) the ledger at `tests/e2e/.selector-development/audit-ledger.json` — dedups across pages and enables resumption after interruption.
3. For each page (independent pages may be parallelized, matching `coverage-expansion`'s parallel-dispatch model):
   a. Drive the app to the page via `playwright-cli`.
   b. Snapshot the DOM; identify interactive/asserted nodes lacking stable selectors (missing-selector gate applied per node).
   c. For each qualifying node, run the full JIT loop (one receipt, one commit). Record the result in the audit ledger under the page-id key.
4. After all pages complete, return a summary envelope (status per page, total attributes added, ledger path).

Audit mode reuses the JIT loop and the same receipt schema — the only difference is the outer driver and the scope unit (page vs. element).

---

## Workflow contract — agent walkthrough

The 8-step pipeline runs in strict sequential order. The `selector-development-pipeline-stepper.sh` hook enforces ordering: each step's PreToolUse gate checks that all predecessors have `pass` recorded in the receipt; each step's PostToolUse handler writes the `pass` (or `fail`) entry. The model cannot skip, reorder, or fake a step.

**Step 1 — Before snapshot**

Before any frontend file edit, take a screenshot of the affected route:
```bash
playwright-cli session <slug> screenshot tests/e2e/.selector-development/before/<scope>.png
```
The stepper's PreToolUse gate checks that `.current-scope` exists and the receipt is initialized. PostToolUse writes `before_snapshot: pass` with the artifact path. Do not proceed to step 2 if this screenshot command fails — abort and surface the error.

**Step 2 — Patch applied (the only frontend edit)**

Edit the target frontend source file using the `Edit` tool. The change must be exactly: append the project's detected test attribute to the opening tag of the target element. Example: `<button` becomes `<button data-testid="submit-button"`. The inertness guard (`selector-development-inertness-guard.sh`) calls `methodology/hooks/lib/selector-diff-validator.js` and denies the write if the AST diff is anything other than one attribute added to one opening tag. The stepper records `patch_applied: pass` with the file path list and `git_diff_hash`.

**Step 3 — Typecheck**

Run the project's typecheck command:
```bash
npm run typecheck   # or tsc, or lint:types — detected from package.json
```
The stepper's PreToolUse gate requires `patch_applied: pass`. On exit 0, PostToolUse writes `typecheck: pass` with elapsed milliseconds. On non-zero exit, writes `typecheck: fail` — proceed to the revert path, do not continue to step 4.

**Step 4 — Unit tests**

Run the project's unit-test suite:
```bash
npm test   # or vitest run, jest, etc. — detected from package.json
```
PreToolUse requires `typecheck: pass`. On exit 0, records `unit_tests: pass`. On failure, records `unit_tests: fail` and reverts.

**Step 5 — E2E**

Run the affected e2e spec:
```bash
npx playwright test <spec-file>   # scope recorded in .current-scope context
```
PreToolUse requires `unit_tests: pass`. On exit 0, records `e2e: pass` with the spec path. On failure, records `e2e: fail` and reverts. Do not run the full e2e suite — only the spec(s) that exercise the instrumented element.

**Step 6 — After snapshot**

Take the post-patch screenshot:
```bash
playwright-cli session <slug> screenshot tests/e2e/.selector-development/after/<scope>.png
```
PreToolUse requires `e2e: pass`. Records `after_snapshot: pass` with artifact path.

**Step 7 — Visual diff**

Compare the before and after screenshots:
```bash
node methodology/hooks/lib/visual-diff.js \
  tests/e2e/.selector-development/before/<scope>.png \
  tests/e2e/.selector-development/after/<scope>.png
```
PreToolUse requires `after_snapshot: pass`. Pass criterion: `diff_pixels` is exactly 0 (or within the project's configured threshold — maximum 10 pixels). On pass, records `visual_diff: pass` with `diff_pixels` count. On fail (pixels above threshold), records `visual_diff: fail` and reverts — a pixel delta indicates an unexpected re-render and the patch is not inert.

**Step 8 — Commit**

Stage and commit the patched frontend file:
```bash
git add <patched-frontend-file>
git commit -m "feat(selectors): add data-testid='<value>' to <element-key>"
```
PreToolUse requires ALL seven prior steps `pass` in the journal AND verifies that `git_diff_hash` in the receipt matches the currently-staged diff (guards against stale journals from previous runs). On success, the stepper clears `.current-scope` and archives the receipt to `tests/e2e/.selector-development/archive/<scope>-<ts>.receipt.json`. The pipeline is complete.

---

## Return shape

Both JIT and Audit return via the canonical envelope (`subagent-return-schema.md`):

```jsonc
{
  "status": "ok" | "skipped" | "blocked",
  "mode": "jit" | "audit",
  "scope": "<element-key>" | "<page-id>",
  "attribute": { "name": "data-testid", "value": "submit-button" },
  "files_modified": ["src/components/Form.tsx"],
  "guardrails": {
    "before_snapshot": "pass",
    "patch_applied":   "pass",
    "typecheck":       "pass",
    "unit_tests":      "pass",
    "e2e":             "pass",
    "after_snapshot":  "pass",
    "visual_diff":     "pass"
  },
  "ledger_entry": "...",                    // audit mode only
  "skipped_reason": "no-inert-option" | "not-frontend-project" | "selector-already-stable" | null,
  "blocked_artifact": "<path>" | null       // failing artifact when status=blocked
}
```

`status: "ok"` — pipeline completed; attribute added; commit made. `status: "skipped"` — a gate exited early (selector already stable, not a frontend project, no inert option available). `status: "blocked"` — a guardrail step failed; `blocked_artifact` carries the failing screenshot, test output, or typecheck log path; the patch was reverted.

The `subagent-return-schema-guard.sh` hook routes `selector-development-<scope>:` description-prefixed dispatches to this return-shape validator.

---

## Out of scope

- **Multi-repo / submodule / monorepo cross-package frontend access.** Workspace gate aborts if the frontend isn't in the same workspace as `tests/e2e/`. Selector changes ride along in the test PR; cross-repo PR plumbing is excluded.
- **Auto-PR creation in a separate frontend repo.** Not supported — the skill operates inside a single workspace.
- **Migration tooling** (e.g., converting an existing project from `data-cy` to `data-testid`). Convention detection respects whatever attribute family is already in use; bulk renaming is out of scope.
- **Selector hardening for already-stable elements.** The missing-selector gate exits silently when a unique test attribute, unique role+name, or unique stable text already exists. The skill does not add redundant attributes.
- **Visual-regression pinning beyond the ≤ 10-pixel threshold.** This skill is not a visual-testing system; the visual diff exists only to prove inertness. Full visual regression is `bug-discovery`'s domain.
- **Wrapping third-party components that do not forward arbitrary props.** If the target element is rendered by a library that swallows unknown props, the skill escalates to the user rather than improvising (e.g., adding a wrapper div). The escalation message names the library and the element.
- **Instrumenting elements that would require structural change.** If adding the attribute requires any tag-structure, child, or prop modification — even a trivial one — the skill declines and returns `status: "blocked"` with `skipped_reason: "no-inert-option"`.
