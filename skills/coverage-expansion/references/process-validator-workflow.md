# Process-Validator Workflow — Sub-Orchestrator Pattern

**Status:** authoritative spec for the `process-validator-<scope>:` role. Cited from `coverage-expansion/SKILL.md` §"Recursive dispatch is impossible — plan, don't fan out".
**Scope:** when to invoke, manifest shape the parent passes in, validator-side review checklist, response shape, parent's handling of the response.

---

## Background

Subagents in this environment cannot dispatch their own sub-subagents — the Agent / Task tool is parent-only. The sub-orchestrator pattern works around that constraint: a fresh subagent with the relevant skill loaded reviews the parent orchestrator's planned dispatch wave **before** the wave fires, and returns a structured greenlight / improvements-needed verdict. The parent reads the verdict and either fans out the wave or revises the manifest.

Same shape as the Stage B reviewer applied one level up. The validator does NOT execute any of the planned dispatches; it only inspects the manifest.

---

## 1. When to invoke

Invoke a `process-validator-<scope>:` subagent before fanning out a wave when ANY of the following hold:

| Trigger | Threshold |
|---|---|
| Wave size | ≥ 3 parallel non-trivial dispatches in one message (composer / reviewer / probe). Phase-1 / phase-2 discovery waves don't count — those have a separate isolation contract. |
| Pass boundary | First wave of a new pass (Pass 1 → Pass 2, Pass 2 → Pass 3, etc.). The pass-1 → pass-2 boundary is the highest-leverage validator invocation in the depth-mode pipeline. |
| Scope change | Any wave that introduces a new role-prefix mapping, a new slug-naming pattern, or a new must-fix-list shape vs. the previous wave. |
| Recovery | After ≥ 1 cycle of `improvements-needed` returns from Stage B reviewers in the previous wave. The pattern signals systematic brief-quality drift; a validator catches it before the next wave repeats the mistake. |
| Re-pass mode | Any compositional re-pass (Passes 2 / 3) — the re-pass triggers (1–4) shape the manifest in non-obvious ways and benefit from review. |

Skip the validator when ALL of the following hold:
- The wave is < 3 dispatches.
- It is a continuation of the immediately-preceding wave (same pass, same role, same slug pattern).
- The previous wave's Stage B returns were 100% greenlight.
- No must-fix-list shape change.

The validator costs one extra Agent call per wave. The break-even is roughly: validator catches one bad brief before it costs a 7-cycle Stage A↔B retry loop. At wave size ≥ 3, expected savings dominate the cost.

---

## 2. Manifest shape (what the parent passes in)

The parent dispatches the validator with a **manifest** of the planned wave. The manifest is enough to validate the *shape* of the wave — it does NOT include test source, full briefs, or pasted journey blocks. Those would defeat the validator's isolation.

### Manifest template

````markdown
## Planned dispatch wave

**Pass:** <pass number, e.g. 2/5>
**Stage:** <A composer | B reviewer | adversarial probe | mixed>
**Cycle:** <cycle number for the dual-stage retry loop, or 1 on a fresh pass>
**Wave size:** <N> parallel dispatches in one message
**Slug-naming convention:** <pattern in use, e.g. `composer-j-<slug>-<pass>-c<N>`>

| # | description prefix | journey-id | slug | model-hint | must-fix-list summary |
|---|---|---|---|---|---|
| 1 | composer-j-checkout: cycle 1 | j-checkout | composer-j-checkout-2-c1 | sonnet | (n/a — pass 1) |
| 2 | composer-j-cart: cycle 1     | j-cart     | composer-j-cart-2-c1     | sonnet | (n/a — pass 1) |
| 3 | composer-j-orders: cycle 1   | j-orders   | composer-j-orders-2-c1   | opus   | (n/a — pass 1) |

(continue for all N rows)

## Pre-checks performed by parent before manifest emission
- [ ] All description prefixes use role-explicit form (composer-/reviewer-/probe-/process-validator-).
- [ ] All slugs ≤ 28 chars.
- [ ] No two rows share a slug.
- [ ] Journey-ids drawn from the current journey-map.md (sentinel-verified).
- [ ] Coverage-expansion-state.json reflects the current pass / cycle.
````

### Field rules

| Field | Rule |
|---|---|
| `description prefix` | Begins with `composer-` / `reviewer-` / `probe-` / `process-validator-`. Bare `j-` / `sj-` are forbidden — see issue #126. |
| `journey-id` | Slug from `journey-map.md`. The mapping description-prefix → journey-id is what the dispatch-guard checks. |
| `slug` | The CLI session slug for this dispatch. Pattern matches the role (composer-j-… / reviewer-j-… / probe-j-…) and respects the 28-char cap. |
| `model-hint` | `sonnet` (default) or `opus` (large journeys). Matches `coverage-expansion/SKILL.md` §"Model selection per journey". |
| `must-fix-list summary` | One-line summary of the Stage B feedback this Stage A retry must address, OR `(n/a)` for fresh-cycle composer dispatches. |

### What the manifest does NOT contain

- Pasted journey blocks (validator infers shape from the journey-id + map sentinel).
- Pasted Stage B feedback (validator infers shape from the must-fix summary).
- Test source.
- DOM snapshots / CLI transcripts.

The parent's job is to summarise enough that the validator can grep the shape. If the validator needs more detail, it returns `improvements-needed` with a finding asking for the field; the parent revises and re-emits.

---

## 3. Validator-side review checklist

The validator runs the following checks against the manifest. Each check produces zero, one, or many findings. The summary tally is the basis for the `greenlight` vs `improvements-needed` verdict.

| Check | What to look for | Failure → finding |
|---|---|---|
| **Slug-length** | Every slug ≤ 28 chars. | `slug-length-cap-violation` — name the offending row. |
| **Role-prefix consistency** | Every description prefix matches the role-explicit set (composer-/reviewer-/probe-/process-validator-). | `forbidden-prefix` — name the row + suggested prefix. |
| **Description ↔ slug 1:1** | Every row's description prefix and slug share the same role-prefix (`composer-j-…` description ↔ `composer-j-…` slug). | `description-slug-mismatch` — name the row + show diff. |
| **Journey-coverage completeness** | For composer/reviewer waves: the wave covers every journey listed in the current pass's roster (or the must-fix-list's journey-set for retry waves). | `journey-coverage-gap` — list missing journeys. |
| **No duplicates** | No two rows share a slug or a journey-id. | `duplicate-slug` / `duplicate-journey` — name the conflicting rows. |
| **Brief-minimalism (proxied via must-fix-list summary)** | The must-fix-list summary ≤ 240 chars; no orchestrator meta-content (`depth mode`, `5-pass pipeline`, `Pass 4/5`, etc.). | `brief-leak` — name the row + leaked phrase. |
| **Parallelism cap** | Wave size ≤ host-max parallelism cap (typically `P=4` per the playwright-cli-protocol §1.1 empirical numbers; the cap is a function of the consumer's host). | `parallelism-cap-violation` — name the planned size + cap. |
| **Hook-rule pre-checks** | All bullets in the manifest's "Pre-checks performed by parent" section are checked. | `pre-check-not-acknowledged` — name the unchecked bullet. |
| **Model-hint sanity** | Sonnet for journeys with ≤ 8 Test-expectations bullets; Opus for journeys with > 8 OR explicitly tagged "complex" in the journey block. | `model-mismatch` — name the row + suggested model. |
| **Pass-boundary fit** | The wave's pass + stage match the coverage-expansion-state.json's pending state. | `state-misalignment` — quote the conflict. |

### Finding-block shape

Each finding follows a §4.1-style block:

```
- **<FINDING-ID>** [must-fix] — <one-line title>
  - manifest-row: <row #>
  - issue: <what's wrong>
  - fix: <concrete remediation>
```

`<FINDING-ID>` follows `pv-<scope-slug>-<nn>` (e.g. `pv-stage-a-wave-01`). The `pv-` prefix is process-validator-specific; it is NOT a journey-slug subformat per `subagent-return-schema.md` §1, since process-validator findings aren't anchored to one journey.

---

## 4. Response shape

The validator's return shape mirrors the Stage B reviewer return defined in `subagent-return-schema.md` §2.4, adapted for manifest-scope findings. The harness validator hook (`hooks/subagent-return-schema-guard.sh`) routes `process-validator-` returns through the same field-marker check.

### `greenlight` (no findings)

````
status: greenlight
scope: <stage-a-wave | stage-b-wave | adversarial-wave | retry-wave>
wave-size: <N>
pass: <pass number>
findings: []
summary: <one sentence — e.g., "16 dispatches conform; slugs ≤ 24 chars; role prefixes role-explicit; journey roster fully covered.">
````

The `summary:` line is REQUIRED on greenlight — without it, the harness validator hook flags the return as malformed and the parent re-dispatches. The `findings: []` line is also required (empty array, explicit) so parsers don't have to distinguish "no findings field" from "no findings value".

### `improvements-needed` (≥1 finding)

````
status: improvements-needed
scope: <stage-a-wave | stage-b-wave | adversarial-wave | retry-wave>
wave-size: <N>
pass: <pass number>

findings:
  - **pv-stage-a-wave-01** [must-fix] — slug exceeds 28-char cap
    - manifest-row: 7
    - issue: "composer-j-marketplace-buy-2-c1" is 31 chars; will fail playwright-cli daemon socket bind on darwin
    - fix: shorten to "composer-j-mkt-buy-2-c1" (24 chars) — coordinate with journey-map slug

  - **pv-stage-a-wave-02** [must-fix] — brief-leak in must-fix-list summary
    - manifest-row: 12
    - issue: must-fix-list summary mentions "5-pass pipeline" — orchestrator meta-content
    - fix: rewrite as "address Stage B finding j-orders-1-2-R-01 (mobile variant)"

summary: 2 findings — one slug-length cap violation, one brief-leak. Block this wave; the parent revises rows 7 and 12 and re-emits the manifest.
````

The `summary:` line on `improvements-needed` is allowed but not required (matches the reviewer-return spec). The `findings:` array has at least one entry.

### Banned tokens

The validator's return MUST NOT contain `nice-to-have`, `greenlight-with-notes`, or a top-level `notes:` sub-list — those are banned by `subagent-return-schema.md` §4.1 (this file follows the same vocabulary). Findings that don't meet must-fix calibration are not surfaced; if the validator noticed it and recorded it, the parent retries.

---

## 5. Parent's response handling

On receipt of the validator's return:

### Greenlight path

1. The parent reads `status: greenlight` and the `summary:` line.
2. The parent fans out the wave **as planned in the manifest** — no edits between greenlight and dispatch.
3. The parent records a one-line entry in the run progress log: `[coverage-expansion] Pass <N>/5 wave-<scope>: process-validator greenlight (N=<wave-size>)`.

### Improvements-needed path

1. The parent reads each finding under `findings:`.
2. For each finding, the parent applies the `fix:` line:
   - `slug-length-cap-violation` → shorten the slug in the manifest.
   - `forbidden-prefix` → rewrite the description prefix.
   - `journey-coverage-gap` → add the missing rows.
   - `brief-leak` → rewrite the must-fix-list summary.
   - …etc.
3. The parent re-emits the revised manifest and re-dispatches the validator. **The parent does NOT fan out the wave on `improvements-needed` — only after a subsequent greenlight.**
4. Cycle cap: 3 validator dispatches per wave. After cycle 3 of `improvements-needed`, the parent escalates to the user with the validator's last set of findings — the run is `blocked-validator-stalled` until the user resolves the conflict (or explicitly authorises a workaround).

### Cycle counting

Validator cycles count toward the wave's overall budget but do NOT consume the 7-cycle Stage A↔B retry-loop budget — the validator runs *before* Stage A fires, so the 7-cycle clock starts after greenlight.

---

## 6. Optional: harness enforcement (deferred)

A PreToolUse:Agent hook could detect "wave size ≥ 3 with composer-/reviewer-/probe- prefix" and require an immediate-prior `process-validator-` dispatch in conversation history (state-file driven, similar to the suite-gate ratchet). This is deferred to a follow-up issue — the workflow documented above is sufficient as markdown-only enforcement initially. When the harness layer is added, it cites this file as its source of truth.

---

## 7. Worked example

A pass-2 wave of 5 composer dispatches:

### Parent's manifest

````markdown
## Planned dispatch wave

**Pass:** 2/5
**Stage:** A composer
**Cycle:** 1
**Wave size:** 5
**Slug-naming convention:** composer-j-<slug>-2-c1

| # | description prefix | journey-id | slug | model-hint | must-fix-list summary |
|---|---|---|---|---|---|
| 1 | composer-j-checkout: cycle 1     | j-checkout     | composer-j-checkout-2-c1   | sonnet | address Stage B finding j-checkout-1-1-R-01 (mobile variant) |
| 2 | composer-j-cart: cycle 1         | j-cart         | composer-j-cart-2-c1       | sonnet | (n/a — re-pass trigger 3, no prior must-fix) |
| 3 | composer-j-orders: cycle 1       | j-orders       | composer-j-orders-2-c1     | opus   | address Stage B findings j-orders-1-2-R-{01,02,03} |
| 4 | composer-j-checkout-pay: cycle 1 | sj-checkout-pay| composer-sj-pay-2-c1       | sonnet | address Stage B finding sj-checkout-pay-1-1-R-01 (error state) |
| 5 | composer-j-marketplace-buy: cycle 1 | j-marketplace-buy | composer-j-mkt-buy-2-c1 | sonnet | (n/a) |

## Pre-checks performed by parent before manifest emission
- [x] All description prefixes use role-explicit form.
- [x] All slugs ≤ 28 chars (longest: 24).
- [x] No two rows share a slug.
- [x] Journey-ids drawn from journey-map.md (sentinel verified).
- [x] coverage-expansion-state.json shows pending: pass=2, stage=a, cycle=1.
````

### Validator's greenlight return

````
status: greenlight
scope: stage-a-wave
wave-size: 5
pass: 2
findings: []
summary: 5 dispatches conform — role-explicit prefixes, slugs ≤ 24 chars, journey roster covers all pending pass-2 entries, must-fix-list summaries reference §4.1 finding-IDs cleanly.
````

### Parent's progress-log entry

```
[coverage-expansion] Pass 2/5 wave-stage-a: process-validator greenlight (N=5)
```

### Then — only then — the parent fans out 5 parallel composer dispatches in one message.
