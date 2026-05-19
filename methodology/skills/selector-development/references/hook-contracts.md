# Hook Contracts

This reference specifies the exact behavior of each hook in the selector-development pipeline. **If any claim in this document contradicts a hook implementation, the hook is the runtime authority — this document is wrong and must be updated.**

---

## 1. Activation Gate (`selector-development-activation-gate.sh`)

**Event registration:** `PreToolUse:Edit|Write`

**Mode:** DENY

**State:**
- Reads: `package.json` (framework dependency detection), `tests/e2e/` directory structure
- Writes: none

**Env vars:**
- `WORKSPACE_ROOT` (optional) — defaults to `git rev-parse --show-toplevel`

**Deny conditions:**
- Tool is Edit or Write on a frontend source file (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`, `.htm`, or `.ts`/`.js` under `src/`, `app/`, `pages/`, `components/`), AND either:
  - `package.json` does not declare a frontend framework dependency (`react`, `vue`, `svelte`, `@angular/core`, `solid-js`, `preact`, `lit`), OR
  - `tests/e2e/` directory does not exist or contains no `*.spec.ts` files

**Deny message format:** Names the missing prerequisite: "frontend source not present" or "tests not present", followed by the notice that selector-development requires test work to live in the same project as the frontend source.

---

## 2. Inertness Guard (`selector-development-inertness-guard.sh`)

**Event registration:** `PreToolUse:Edit|Write`

**Mode:** DENY

**State:**
- Reads: `tests/e2e/.selector-development/.detected-convention` (cached convention) or defaults to `data-testid`; the file being edited (pre-state)
- Writes: none

**Env vars:**
- `WORKSPACE_ROOT` (optional) — defaults to `git rev-parse --show-toplevel`
- `CONVENTION_OVERRIDE` (optional, test-mode only) — overrides cached convention for testing

**Deny conditions:**
- Tool is Edit or Write on a frontend source file (same path filter as activation-gate), AND the file already exists, AND the diff does not match the inertness contract:
  - Must modify exactly one AST node (a JSXOpeningElement or equivalent).
  - That node must gain exactly one attribute.
  - The attribute name must match the detected test-attribute (`data-testid`, `data-cy`, `data-qa`, or `data-test`).
  - The attribute value must be a kebab-case string literal.
  - No other AST node, text, or structure must change.

**Record conditions (if applicable):** None — this hook never writes state. All validation is read-only.

---

## 3. Pipeline Stepper (`selector-development-pipeline-stepper.sh`)

**Event registration:** `PreToolUse:Bash|Edit|Write` and `PostToolUse:Bash|Edit|Write`

**Mode:** DENY (PreToolUse) / RECORD (PostToolUse)

**State:**
- Reads: `tests/e2e/.selector-development/.current-scope` (active scope pointer), `tests/e2e/.selector-development/<scope>.receipt.json` (step journal)
- Writes: `tests/e2e/.selector-development/<scope>.receipt.json` (on PostToolUse); `tests/e2e/.selector-development/.current-scope` (deleted on successful commit); `tests/e2e/.selector-development/archive/<scope>.<ts>.receipt.json` (on successful commit)

**Env vars:**
- `WORKSPACE_ROOT` (required) — filesystem root of the target project; defaults to `git rev-parse --show-toplevel`
- `FAKE_STAGED_HASH` (optional, test-mode only) — override for staged diff hash to avoid actual git operations in unit tests

### 3.1 Step Detection Signatures

The stepper detects which pipeline step is being attempted by matching the tool name + command/args (for Bash) or file path (for Edit|Write) against these patterns:

| # | Step | Detection signature |
|---|---|---|
| 1 | before_snapshot | Bash command matches `playwright-cli .* screenshot .*\/before\/` |
| 2 | patch_applied | Edit or Write on a frontend source path (`.tsx`/`.jsx`/`.ts`/`.js` under `/src/`, `/app/`, `/pages/`, `/components/`, `/lib/`, `/features/`, `/views/`, `/utils/` OR `.vue`, `.svelte`) — excludes `.spec.ts`, `.test.ts`, `.test.tsx`, and files under `/tests/`, `/__tests__/`, `/__mocks__/` |
| 3 | typecheck | Bash matches `npm run typecheck` OR `tsc --noEmit` OR `npx tsc` |
| 4 | unit_tests | Bash matches `npm test` / `npm run test` / `vitest` / `jest` AND does NOT match `playwright test` |
| 5 | e2e | Bash matches `playwright test` (but NOT `playwright-cli`) |
| 6 | after_snapshot | Bash command matches `playwright-cli .* screenshot .*\/after\/` |
| 7 | visual_diff | Bash matches `node .*\/visual-diff\.js` |
| 8 | commit | Bash matches `git commit` |

### 3.2 PreToolUse Gate Rules (Per Step)

Silent allow (exit 0) if:
- Tool is not Bash, Edit, or Write, OR
- `.current-scope` file does not exist, OR
- Receipt file for the current scope does not exist, OR
- Receipt file is not valid JSON, OR
- Step cannot be detected (unrecognised tool/command pattern)

Deny if:
- Any step in the journal has `status: "fail"` — the pipeline is broken and must be restarted from step 1.
- This step's predecessor is not in the journal with `status: "pass"`:
  - Step 1 (before_snapshot) has no predecessor — allow immediately if receipt exists.
  - Step 2 (patch_applied) requires before_snapshot: pass.
  - Step 3 (typecheck) requires patch_applied: pass.
  - Step 4 (unit_tests) requires typecheck: pass.
  - Step 5 (e2e) requires unit_tests: pass.
  - Step 6 (after_snapshot) requires e2e: pass.
  - Step 7 (visual_diff) requires after_snapshot: pass.
  - Step 8 (commit) requires visual_diff: pass AND git_diff_hash from step 2 must match the current staged diff hash (via `git diff --cached`).

Deny message names the missing predecessor and the scope, directing the caller to complete the predecessor step or restart from step 1.

### 3.3 PostToolUse Record Rules

Silent allow (exit 0) on all PostToolUse events — this hook never blocks on exit.

Append a new entry to the `steps` array in the receipt JSON with:
- `name`: the detected step name
- `status`: `"pass"` if the tool's exit code is 0, else `"fail"`
- `ts`: ISO-8601 UTC timestamp

**Per-step extras (recorded on pass):**
- **Step 2 (patch_applied):** Also set `files: [<array of modified file paths>]` and the top-level `git_diff_hash: <sha256 of staged diff at this moment>`. The `git_diff_hash` is computed via `git diff --cached | sha256sum`.
- **Step 7 (visual_diff):** Parse the tool's stdout for `diff_pixels` count. Record `diff_pixels: <number>`. If diff_pixels > 0, record `status: "fail"` instead of `"pass"` (the visual-diff tool outputs a non-zero exit code when pixels differ; the stepper respects that).
- **Step 8 (commit):** On successful commit, archive the receipt to `tests/e2e/.selector-development/archive/<scope>.<timestamp>.receipt.json` and delete `.current-scope` to mark the operation complete.

---

## 4. Revert on Stop (`selector-development-revert-on-stop.sh`)

**Event registration:** `Stop`

**Mode:** WARN (initial release; scheduled to flip to DENY after false-positive calibration)

**State:**
- Reads: `tests/e2e/.selector-development/.current-scope`, `tests/e2e/.selector-development/<scope>.receipt.json`
- Writes: none (the model or the skill will perform the cleanup; the hook only warns)

**Env vars:**
- `WORKSPACE_ROOT` (optional) — defaults to `git rev-parse --show-toplevel`

**Deny conditions:** (This hook uses WARN, not DENY; no tool is actually blocked.)

**Record conditions (if applicable):**

Emit a WARN system message if:
- `.current-scope` file exists, AND
- The receipt for that scope exists, AND
- The last step with `status: "pass"` in the journal is NOT `visual_diff` or `commit` — meaning the pipeline was incomplete when the model exited.

The warning message names the incomplete scope, the last recorded step, and provides a recovery command: `git checkout -- <files from receipt.files>` followed by deleting the receipt and `.current-scope` file. This allows the caller (usually the skill) to recognize the incomplete state and decide whether to resume or abort.

If the last passing step is `visual_diff` or `commit`, exit silently (no warning) — the pipeline is complete or nearly complete and no cleanup is needed.

---

## Notes on Implementation Fidelity

1. **Convention detection:** The inertness-guard and other hooks rely on a single source of truth for the detected convention, stored at `.detected-convention`. This prevents inconsistency across multiple hook invocations within a session.

2. **Journal atomicity:** The stepper uses a temp file + rename pattern to write the receipt atomically, preventing partial JSON on concurrent writes (though selector-development operations are serial per scope).

3. **Workspace root resolution:** All hooks accept an explicit `WORKSPACE_ROOT` env var for testing; otherwise they derive it from `git rev-parse --show-toplevel` or fall back to cwd.

4. **Specfile detection (step 5):** The stepper detects the e2e step via `playwright test` but does not validate that the spec being run matches the scope context; the calling skill is responsible for ensuring the correct test suite is invoked.

5. **Visual-diff pixel threshold:** Threshold is configurable via the CLI's `--threshold=N` flag; defaults to 0 (any pixel difference fails). There is no hard pixel cap in `methodology/hooks/lib/visual-diff.js`.
