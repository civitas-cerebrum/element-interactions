# Subagent Return + Ledger Schema — Canonical Reference

**Status:** single source of truth for every subagent dispatched by `coverage-expansion`, `test-composer`, and `bug-discovery`.
**Scope:** prose contract + example templates. Not a runtime validator.

All three callers cite this file. Subagent dispatch briefs include a pointer to this file rather than re-pasting the schema. Callers MUST NOT fork, extend, or redefine the shape of these returns in their own SKILL.md files; deviations are contract violations.

---

## 1. Canonical finding-return schema (mandatory)

Every subagent dispatched by `coverage-expansion`, `test-composer`, or `bug-discovery` that reports a finding MUST format each finding exactly as:

```
- **<FINDING-ID>** [<severity>] — <one-line title>
  - scope: <what was probed>
  - expected: <what should happen>
  - observed: <what happened>
  - coverage: <existing test or none>
```

### Field rules

| Field | Rule |
|---|---|
| `FINDING-ID` | `<journey-slug>-<pass>-<nn>` (inside a numbered pass, Stage A findings) or `<journey-slug>-<nn>` (outside pass numbering). `<nn>` is a two-digit integer, zero-padded. Reviewer findings (Stage B) use the extended subformat `<journey-slug>-<pass>-<cycle>-R-<nn>` — see §2.4. No other alternative ID schemes (`AF-XX-NN`, `P4-XX-BUG-NN`, `REG-XX-NN`) are accepted. |
| `severity` | One of `critical`, `high`, `medium`, `low`, `info`. No other values. Do not invent new severities (no `no-impact`, `blocker`, `p0`). Map DOM-only / no-impact items to `info`. **Applies to Stage A finding blocks only.** Stage B (reviewer) findings use a fixed `[must-fix]` priority bracket, not a severity bracket — per §2.4. The "no other values" rule is scoped to Stage A; §1's bracket position is not meaningful for reviewer returns. |
| `title` | One line. No trailing period. Describes the finding, not the test. |
| `scope` | One sentence naming the probe surface — page, endpoint, element, flow step. |
| `expected` | One sentence describing correct behaviour. |
| `observed` | One sentence describing the actual behaviour. |
| `coverage` | `none`, or a spec-file path plus test name that locks the finding (e.g. `tests/e2e/j-checkout-regression.spec.ts › rejects negative quantity`). |

### Severity rubric

| Severity | Definition |
|---|---|
| `critical` | Security vulnerability, privacy violation, authentication bypass, data exfiltration path, complete failure of a primary user journey, or legal / compliance risk. |
| `high` | Functional bug that blocks a user journey without an obvious workaround. Core feature broken. |
| `medium` | Degraded UX or data correctness issue. User notices, but can still use the app. |
| `low` | Minor inconsistency, cosmetic defect, UX nit. |
| `info` | DOM-only / no user impact. Code hygiene. |

No finding may escalate above `info` if it is not visible in a screenshot. That rule is enforced by `bug-discovery` and inherited here.

### Worked example

```
- **j-checkout-4-03** [high] — server accepts negative quantity on cart update
  - scope: POST /api/cart/items price=-1 submitted via the quantity stepper on /cart
  - expected: 400 with a validation error surfaced in the cart error banner
  - observed: 200 with total recalculated to a negative sum; banner never shown
  - coverage: none
```

---

## 2. Return states — `covered-exhaustively` vs `no-new-tests-by-rationalisation`

A compositional or adversarial pass subagent may end a journey without producing new tests. When that happens, it MUST pick one of the two return states below. The distinction is binding.

**Relationship to the broader return-state enum.** The full no-skip contract (see `coverage-expansion` §"No-skip contract") defines four possible subagent return types: `new-tests-landed`, `covered-exhaustively` (replaces the legacy `no-new-tests`), `blocked (reason)`, and `skipped (reason + who-authorized)`. The two states documented in this section (§2.1 and §2.2) apply specifically to the "journey was inspected and ended without new tests" fork. `blocked` and `skipped` are **separate return types** governed by the no-skip contract, not covered here — a subagent that cannot inspect (tenant data missing, credentials unavailable, malformed journey block) returns `blocked` with a reason, not `covered-exhaustively`.

### 2.1 `status: covered-exhaustively`

Only valid when the subagent **inspected** the journey. Required evidence:

1. A per-expectation mapping table that names every item in the journey's `Test expectations:` list (or every explicit Pass-1 expectation, in a re-pass) and maps it to a spec file + test name.
2. An explicit check against every trigger that would *require* new work in this pass (for re-pass mode: "trigger 1 — no delta markers since Pass 1", "trigger 2 — no sibling-bug ledger entries requiring regression here", etc.).
3. Zero unexplained shorthand — every row in the mapping table names concrete coverage.

#### Mapping table template

```
| Expectation | Covering spec | Test name |
|---|---|---|
| <verbatim text from journey block> | tests/e2e/<file>.spec.ts | <test(...) title> |
| <verbatim text from journey block> | tests/e2e/<file>.spec.ts | <test(...) title> |
```

If the table has one or more rows with `coverage: none`, the subagent has NOT covered exhaustively and MUST compose tests or escalate.

### 2.2 `status: no-new-tests-by-rationalisation` — **not a valid return**

This state describes the failure mode where a subagent punts on the dispatch, rationalises that tests would be redundant, and returns without inspection. **This is not a valid return from any compositional or adversarial pass.** Orchestrators treat such returns as contract violations and MUST re-dispatch the subagent with a stricter brief.

Legacy skills that previously used `status: no-new-tests` MUST rename to `covered-exhaustively` and attach the mapping table. The unqualified phrase "no new tests" is banned as a status value.

### 2.3 Malformed-input escape hatch

If the subagent cannot produce the mapping table because the input itself is unusable — the journey block is missing, `Test expectations:` is blank or unreadable, the referenced `sj-<slug>` sub-journey blocks cannot be located, etc. — the subagent MUST return `blocked (malformed-input: <reason>)`, **not** `covered-exhaustively` and **not** `no-new-tests-by-rationalisation`. The orchestrator treats `blocked (malformed-input: …)` as actionable: it fixes the input (usually by re-running `journey-mapping` for that journey) and re-dispatches. This prevents the failure mode where a subagent with no input conspires with the schema to return "covered" — the schema requires evidence that doesn't exist.

### 2.4 Reviewer-return (Stage B of the dual-stage pipeline)

This subsection defines the Reviewer-return (Stage B) shape. Stage B reviewer subagents — dispatched by `coverage-expansion` per journey per pass after a Stage A return — use a different top-level status vocabulary than compositional or adversarial subagents:

| Status | Meaning | Blocks pass completion? |
|---|---|---|
| `greenlight` | Stage A's output is complete for this journey in this pass. No findings. | No. Orchestrator accepts. |
| `improvements-needed` | Reviewer has at least one `must-fix` finding. Stage A must retry. | Only if retry cycle reaches the cap or the finding list is repeated. |

The reviewer's outcome vocabulary is binary: greenlight (no findings) or improvements-needed (≥1 finding). There is no third "soft" state. A reviewer that wants to surface an observation classifies it as `must-fix` per the calibration rules in `reviewer-subagent-contract.md` step 6, which forces an `improvements-needed` return; observations that don't meet must-fix calibration are not surfaced.

Return body for `improvements-needed`:

````
status: improvements-needed
journey: j-<slug>
pass: <N>
cycle: <cycle-number>

missing-scenarios:
  - **<FINDING-ID>** [must-fix] — <one-line title>
    - why: <one sentence, staff-QA rationale>
    - category: <mobile | error-state | edge-case | adversarial | accessibility | i18n | lifecycle | concurrency>
    - suggested-test: <one-sentence description of the test to write>

craft-issues:
  - **<FINDING-ID>** [must-fix] — <one-line title>
    - file: <path>
    - issue: <what's wrong>
    - fix: <concrete remediation>

verification-misses:
  - **<FINDING-ID>** [must-fix] — <one-line title>
    - file: <path>
    - test-name: <test(...) title>
    - asserted: <what the test currently asserts>
    - live-observed: <what the reviewer saw via MCP>
    - suggested-fix: <concrete remediation>
````

Return body for `greenlight` (no findings):

````
status: greenlight
journey: j-<slug>
pass: <N>
cycle: <cycle-number>
summary: <one sentence — e.g., "All 8 test-expectations covered, craft clean, live DOM matches assertions.">
````

Every reviewer finding carries `[must-fix]`. There is no nice-to-have bracket, no notes sub-list, no third return state. If the reviewer noticed it and recorded it, Stage A retries; if the reviewer chose not to record it, it is gone. The classification gate is the recording gate — see `reviewer-subagent-contract.md` step 6 for the must-fix calibration that determines which observations get recorded.

**Reviewer finding-ID subformat:** `<journey-slug>-<pass>-<cycle>-R-<nn>` where `<cycle>` is a two-digit zero-padded integer (`01`..`07`) and `R` tags the finding as reviewer-sourced (distinguishes it from Stage A's `<journey-slug>-<pass>-<nn>` format). This subformat is an explicit addition to §1's finding-ID rules; Stage B subagents MUST use it, Stage A subagents MUST NOT.

**Caller contract addition:** Callers dispatching reviewer subagents (currently `coverage-expansion` only) must accept `greenlight` and `improvements-needed` as valid return statuses and MUST NOT treat `improvements-needed` as a schema violation. The retry loop for `improvements-needed` is documented in `skills/coverage-expansion/SKILL.md` §"Retry loop".

---

## 3. Strict ledger schema — `tests/e2e/docs/adversarial-findings.md`

The adversarial findings ledger is enforced, not conventional. Every subagent that appends to the ledger MUST validate its append against the schema below **before committing**. Schema violations are contract violations; the subagent corrects the append or re-emits.

The ledger lives at `tests/e2e/docs/adversarial-findings.md`. It is created on the first Pass-4 subagent invocation.

**Relationship to `skills/coverage-expansion/references/adversarial-findings-schema.md`.** This section replaces the **structural** portions of that file (header layout, per-journey block, finding block shape, pass summary line). The existing file is retained only for the **probe-category vocabulary** (`auth-tamper`, `input-tamper`, `price-tamper`, etc.) and the **severity rubric** referenced by subagents. When the two files overlap on structure, this file wins. A single cleanup follow-up will move the vocabulary into this file and delete the legacy schema; until then, callers cite both files explicitly in their dispatch briefs.

### 3.1 File header (written once, by the first Pass-4 subagent)

```markdown
<!-- coverage-expansion-adversarial:generated -->
# Adversarial Findings — <app name from package.json>

**Generated by:** coverage-expansion (depth mode, passes 4–5)
**Pass 4 date:** YYYY-MM-DD
**Pass 5 date:** _(filled by pass 5)_
**Dedup date:** _(filled by cleanup subagent)_

## Cross-cutting findings

_(Populated by the post-pass-5 cleanup subagent. Until then, leave the section present but empty — the header must exist so per-journey sections can backref it.)_
```

### 3.2 Per-journey section (one per journey, written by the first subagent to probe it)

```markdown
### j-<slug>

**Pass <N> — <kind> (YYYY-MM-DD)**

Scope: <one-line probe scope>

#### <FINDING-ID> [<severity>] — <title>
- expected: <one sentence>
- observed: <one sentence>
- ledger-only: <true|false>
- coverage: <spec file + test name, or "none">

#### <FINDING-ID> [<severity>] — <title>
- expected: ...
- observed: ...
- ledger-only: ...
- coverage: ...

(repeat per finding)

**Pass <N> summary:** probes=N, boundaries=M, suspected-bugs=K (crit=x, high=y, med=z, low=w)
```

Every Pass block MUST open with a `**Pass <N> — <kind> (YYYY-MM-DD)**` line, include a `Scope:` line, and close with a `**Pass <N> summary:**` footer. `<kind>` is one of `probe` (Pass 4) or `consolidation` (Pass 5). Mis-ordered or missing headers are schema violations.

### 3.3 Ledger field rules

| Field | Rule |
|---|---|
| `### j-<slug>` | Exactly one `###` header per journey. No nested `####` that aren't findings. |
| `**Pass <N> — <kind> (YYYY-MM-DD)**` | Bolded line. ISO date. `<kind>` ∈ {`probe`, `consolidation`}. |
| `Scope:` | Single-line prose, no bullets. |
| `#### <FINDING-ID> [<severity>] — <title>` | `<FINDING-ID>` follows §1's rules. `<severity>` is one of the five values. |
| `expected:` / `observed:` | One sentence each, on their own line, as list items. |
| `ledger-only:` | `true` when the finding is a suspected bug with no committed regression test; `false` when a passing regression test was added. |
| `coverage:` | Spec-file path + test name, or `none`. Matches §1 exactly. |
| `**Pass <N> summary:**` | One line. `probes=N, boundaries=M, suspected-bugs=K (crit=x, high=y, med=z, low=w)`. Integers only. |

### 3.4 Worked example

```markdown
### j-checkout

**Pass 4 — probe (2026-04-23)**

Scope: cart + checkout mutation endpoints, price/qty tamper, state-skip probes.

#### j-checkout-4-01 [high] — server accepts negative quantity on cart update
- expected: 400 with validation error in cart error banner
- observed: 200 with total recalculated to a negative sum; banner never shown
- ledger-only: true
- coverage: none

#### j-checkout-4-02 [medium] — price field editable via client-side before submit
- expected: server ignores client-supplied price and recomputes from SKU
- observed: server honoured client price on first submit until second attempt
- ledger-only: true
- coverage: none

**Pass 4 summary:** probes=12, boundaries=8, suspected-bugs=2 (crit=0, high=1, med=1, low=0)

**Pass 5 — consolidation (2026-04-24)**

Scope: compound probes, ambiguous-resolution, regression authoring for pass-4 boundaries.

#### j-checkout-5-01 [low] — cart badge desynced after tab-replay
- expected: badge count equals cart length after replay
- observed: badge lags by one; clears on manual nav
- ledger-only: false
- coverage: tests/e2e/j-checkout-regression.spec.ts › badge clears after replay

**Pass 5 summary:** probes=6, boundaries=5, suspected-bugs=0 (crit=0, high=0, med=0, low=0)
```

### 3.5 Append discipline

- Atomic append under the advisory lockfile at `tests/e2e/docs/.adversarial-findings.lock`. Hold the lock for ≤500ms.
- Validate against the schema in-memory BEFORE writing. If validation fails, fix the append and re-validate before releasing the lock.
- Never rewrite another journey's section. Appends are additive to one `### j-<slug>` block per dispatch.
- Cross-cutting consolidation is the cleanup subagent's job only (runs once after Pass 5).

---

## 4. Caller contract

Every caller (`coverage-expansion`, `test-composer`, `bug-discovery`) MUST:

1. Link to this file in its SKILL.md, using the relative path `skills/element-interactions/references/subagent-return-schema.md`.
2. Reference this file in every subagent dispatch brief — do not re-paste the schema into the brief.
3. Reject subagent returns that do not conform. Either:
   - re-dispatch with a stricter brief that names the specific schema violation, or
   - surface the violation to the user when re-dispatch is not possible.
4. Never invent new severities, new finding-ID schemes, or new ledger block shapes. One schema, one file.
5. **No "one extra field" extensions.** A caller that adds an informational bullet, sub-line, or suffix to the finding block is forking the schema. If a new field is genuinely necessary, open a follow-up that extends this file; do not ship the extension in a caller's SKILL.md as a de-facto override.

### 4.1 Minimal conformance check (what the caller should look for)

Callers do not run a parser — they grep the return for a short, fixed list of shape signals. A minimal check that catches the common violations:

- **Finding blocks:** one or more lines matching `^- \*\*[a-z0-9-]+-\d+-\d+\*\* \[(?:critical|high|medium|low|info)\]` (for in-pass findings) or the analogous out-of-pass form, followed by the four sub-bullets `scope:` / `expected:` / `observed:` / `coverage:`.
- **`covered-exhaustively` returns:** the literal string `status: covered-exhaustively`, a table header row `| Expectation | Covering spec | Test name |`, and at least one data row per `Test expectations:` entry in the journey block.
- **Banned tokens:** the literal strings `no-new-tests-by-rationalisation`, `no-new-tests` (unqualified), `AF-`, `P4-`, `REG-` (legacy finding-ID prefixes — note: the `-R-` infix in reviewer IDs is NOT a prefix and is allowed), and any `[p0]` / `[blocker]` / `[no-impact]` severity bracket.
- **Ledger append:** the `**Pass <N> — <kind> (YYYY-MM-DD)**` header line, the `Scope:` line, and the closing `**Pass <N> summary:** probes=…, boundaries=…, suspected-bugs=…` line, in that order, bracketing the finding blocks.
- **Reviewer returns (§2.4):** the top-level `status:` is one of `greenlight` or `improvements-needed`. Finding blocks (when present under `missing-scenarios:`, `craft-issues:`, or `verification-misses:` sub-lists) match `^ {2}- \*\*[a-z0-9-]+-\d+-\d+-R-\d+\*\* \[must-fix\]`. **A `summary:` line is REQUIRED on `greenlight` returns** — a `greenlight` status without a `summary:` is a contract violation; treat as `improvements-needed` and re-dispatch. `greenlight` carries `summary:` and no finding blocks; `improvements-needed` has at least one `must-fix` finding and no `summary:` line. Returns containing the literal tokens `nice-to-have`, `greenlight-with-notes`, or a `notes:` sub-list are contract violations from a prior schema revision; reject and re-dispatch with a brief that quotes the banned token. The Stage A regex in the previous bullet does NOT apply to reviewer returns.

If any of the above is missing or a banned token is present, the caller re-dispatches with a brief that quotes the specific violation. The grep-based check is sufficient — no AST, no JSON, no parser.

---

## 5. Non-goals

- A programmatic schema validator. This is prose + examples. Subagents read and conform.
- Per-skill schema overrides. If a future skill needs a return shape this schema cannot express, the fix is to extend this file — not to fork it.
- Transport format. Subagents return Markdown-in-text. JSON is not accepted; it breaks orchestrator parsing and mixes with `test-composer`'s legacy return block.
