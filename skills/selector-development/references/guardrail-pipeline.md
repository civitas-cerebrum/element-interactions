# Guardrail Pipeline

This reference specifies the hook-enforced state machine that gates and records all eight steps of a selector-development operation. The pipeline is stateful, deterministic, and uncuttable — the model cannot skip, reorder, or fake any step.

## 1. The Eight Steps

| # | Step | Tool action that triggers it |
|---|---|---|
| 1 | `before_snapshot` | `Bash`: `playwright-cli … screenshot` writing to `tests/e2e/.selector-development/before/<scope>.png` |
| 2 | `patch_applied` | `Edit` or `Write` on a frontend source file |
| 3 | `typecheck` | `Bash`: project's typecheck script (detected from `package.json`) |
| 4 | `unit_tests` | `Bash`: project's test script (jest / vitest / etc.) |
| 5 | `e2e` | `Bash`: `playwright test <spec>` for the affected spec |
| 6 | `after_snapshot` | `Bash`: `playwright-cli … screenshot` writing to `tests/e2e/.selector-development/after/<scope>.png` |
| 7 | `visual_diff` | `Bash`: `node hooks/lib/visual-diff.js before/<scope>.png after/<scope>.png` |
| 8 | `commit` | `Bash`: `git commit` with the staged frontend file |

Each step must complete with exit status 0 and append a `pass` entry to the receipt journal before the next step's PreToolUse gate permits it to run. A failed step appends a `fail` entry, denies the next step, and triggers the revert path (§3).

---

## 2. Receipt Journal Schema (v2)

**Path:** `tests/e2e/.selector-development/<scope>.receipt.json`

The journal is grown by hook PostToolUse handlers only — the model never writes it directly. Each step appends an entry when it completes; the full journal is consulted by every subsequent step's PreToolUse gate.

**Top-level schema:**

```jsonc
{
  "schema_version": 2,
  "mode": "jit" | "audit",
  "scope": "<element-key>" | "<page-id>",
  "git_diff_hash": null,                    // set at step 2 completion
  "attribute": { "name": "data-testid", "value": "submit-button" },
  "files": [],                              // populated at step 2
  "steps": [ /* entries appended by hooks */ ]
}
```

**Per-step entry format:**

```jsonc
{
  "name": "<step-name>",
  "status": "pass" | "fail",
  "ts": "ISO-8601 timestamp"
  // ... step-specific extras below
}
```

**Step-specific extras:**

- **step 1 (before_snapshot):** `artifact: "<path to PNG>"`
- **step 2 (patch_applied):** `files: ["<paths>"]` (the frontend files modified)
- **step 3 (typecheck):** `elapsed_ms: <number>`
- **step 4 (unit_tests):** `elapsed_ms: <number>`
- **step 5 (e2e):** `spec: "<spec path>"`
- **step 6 (after_snapshot):** `artifact: "<path to PNG>"`
- **step 7 (visual_diff):** `diff_pixels: <number>` (0 = pass; set to `fail` if diff > threshold)

A step is "done" only when an entry with `status: "pass"` exists in the array at the correct position in sequence. Missing, out-of-order, or `fail` entries cause the next step's gate to deny with a "previous step failed or missing" message.

---

## 3. Scope Pointer

**Path:** `tests/e2e/.selector-development/.current-scope`

A single-line file containing the current operation's scope (element-key in JIT mode, page-id in Audit mode). Written by the skill at operation start; read by all hooks to locate the correct receipt journal.

Cleared (deleted) by:
- The `selector-development-revert-on-stop.sh` hook at model stop time.
- The step 8 commit handler on successful completion.

This prevents orphaned state from previous failed operations interfering with new ones.

---

## 4. Failure & Revert Path

When any of steps 3–7 returns non-zero (test failure, type error, visual change):

1. **Hook records `fail`.** The stepper's PostToolUse handler appends a `fail` entry instead of `pass` in the journal for that step.

2. **Next step gate denies.** When the model attempts step N+1, the PreToolUse gate reads the journal, sees `fail` in step N, and denies with a message naming the failing step and the artifact (e.g., "step 3 (typecheck) failed; see artifact /path/to/output").

3. **Skill reverts the patch.** The skill must:
   - Run `git checkout -- <files from journal.steps[patch_applied].files>` to revert to pre-patch state.
   - Delete the receipt at `tests/e2e/.selector-development/<scope>.receipt.json`.
   - Clear `.current-scope` (delete the file).
   - Return `status: "blocked"` to the caller with `blocked_artifact: "<path>"` pointing to the failing artifact (typecheck output, test screenshot, visual-diff PNG, etc.).

4. **Safety guarantee.** The revert itself (`git checkout`) is unconstrained — no hooks gate it. Safety still holds because:
   - Any subsequent re-patch attempt re-enters the pipeline at step 1 (before_snapshot).
   - The inertness-guard re-validates the new Edit/Write against the AST diff validator.
   - The stepper re-validates all gate preconditions.
   - A revert can never be used to smuggle a non-inert change because the validator runs on every file edit, regardless of whether a receipt exists.

The caller (Stage 2 / failure-diagnosis / Audit mode) decides whether to retry with a different attribute value, escalate to the user with the failing artifact, or fall back to a non-frontend approach (e.g., API-level test fixtures).
