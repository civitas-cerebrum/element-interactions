# Adversarial Subagent Contract — Passes 4 and 5

Every subagent dispatched by `coverage-expansion` during pass 4 or pass 5 follows this contract. It is analogous to the compositional-pass subagent contract in SKILL.md but covers adversarial probing specifics.

## Canonical return + ledger schema

Every return and every ledger append produced under this contract MUST conform to the canonical subagent schema in [`../../element-interactions/references/subagent-return-schema.md`](../../element-interactions/references/subagent-return-schema.md). Specifically:

- **Finding-return format** — every finding emitted by the subagent (in its return, in the ledger, or both) uses the `- **<FINDING-ID>** [<severity>] — <title>` block with `scope` / `expected` / `observed` / `coverage` sub-bullets.
- **FINDING-ID scheme** — `<journey-slug>-<pass>-<nn>` for all Pass-4 and Pass-5 findings. Do not use legacy schemes (`AF-*`, `BUG-*`, `P4-*-BUG-NN`, `REG-*`).
- **Severities** — `critical`, `high`, `medium`, `low`, `info`. No others.
- **Return states** — if a subagent dispatch ends without new findings, it returns `status: covered-exhaustively` with the per-expectation mapping table from §2 of the reference file. `status: no-new-tests-by-rationalisation` is **not a valid return**.
- **Ledger schema** — the exact Markdown schema for `tests/e2e/docs/adversarial-findings.md` (see §3 of the reference file). Validate every append in-memory against that schema before releasing the lockfile.

The dispatch brief written by the `coverage-expansion` orchestrator includes a pointer to the reference file. The subagent reads the reference file; it does NOT rely on the schema being re-pasted inside the brief.

## Inputs (given at dispatch time)

1. The assigned journey's full `### j-<slug>` block from the current `journey-map.md`.
2. Any `sj-<slug>` sub-journey blocks referenced by the journey.
3. The current `page-repository.json` slice for the pages the journey touches.
4. The pass number (4 or 5).
5. Path to `tests/e2e/docs/adversarial-findings.md` — MAY NOT YET EXIST on first pass-4 invocation; subagent is responsible for creating it from the schema if absent.
6. Path to `tests/e2e/docs/.adversarial-findings.lock` — advisory lockfile for parallel appends (see below).
7. App credentials from `app-context.md`.
8. Live docker stack URL + any secondary user accounts needed for cross-account probing.

## Behavior

1. Prepare an isolated context window and an isolated Playwright MCP browser instance (same rules as compositional-pass subagents — the orchestrating agent must confirm per-subagent isolation is achievable before dispatching, per the `element-interactions` orchestrator's "Isolated MCP instances for parallel subagents" rule; parallel subagents never share a browser).
2. **Pass 4:** read the map block + page-repo slice + any existing composed tests for the journey. Before invoking `bug-discovery`, derive a **negative-case matrix** for the journey — one negative-case complement per `Test expectations:` entry, plus the standard cross-cutting negatives (auth, tenant isolation, idempotency, session expiry) (see §"Negative-case matrix — full QA scope" below). Invoke the `bug-discovery` skill scoped to this one journey, passing the matrix in the dispatch brief alongside the journey block and page-repo slice. The subagent's probing MUST cover every entry in the matrix in addition to the open-ended adversarial probe-categories that `bug-discovery` drives from live observation. Classify every finding as `Boundaries verified`, `Suspected bugs`, or `Ambiguous`. Do NOT write any tests.
3. **Pass 5:** additionally read the journey's existing section in `adversarial-findings.md` (pass-4 findings). Re-invoke `bug-discovery` with instructions to (a) resolve `Ambiguous` findings where possible, (b) attempt compound probes pass 4 did not try, (c) probe follow-ups implied by pass-4 boundary verifications, and (d) re-probe any negative-case-matrix entries that returned `Ambiguous` in pass 4 — the matrix is the deterministic floor across both adversarial passes. Write a passing regression test for every `Boundaries verified` finding (pass 4 + pass 5 combined) into `tests/e2e/j-<slug>-regression.spec.ts`. Never write tests for `Suspected bugs` or `Ambiguous` findings.
4. Append all new findings to the journey's section of the ledger, using the canonical ledger schema in [`../../element-interactions/references/subagent-return-schema.md`](../../element-interactions/references/subagent-return-schema.md) §3. The legacy `adversarial-findings-schema.md` is retained for probe-category vocabulary reference only; **the canonical schema governs structure**. Create the journey section if absent. Create the ledger file with its header if absent. Validate the append in-memory against the canonical schema BEFORE releasing the lockfile — if validation fails, fix the append and re-validate.
5. Stabilize any regression tests written in pass 5 to 3× green using the normal test-composer stabilization loop. If stabilization fails after 3 cycles, DO NOT commit a `test.fail()` marker; instead move the finding to `Suspected bugs` with note `deterministic-test-not-feasible` and continue.
6. Return a structured discovery report to the orchestrator. No probe transcripts, no DOM snapshots, no test source.

## Negative-case matrix — full QA scope

Adversarial passes are not just open-ended bug-hunting. They are the QA-coverage layer of the pipeline: every potential use case a QA engineer would test against this journey, including negative cases that the compositional passes (1–3) do not enumerate. The compositional passes lock the positive paths and a sample of error states; the adversarial pass closes the negative-case gap.

Before dispatch, the orchestrator (or the subagent itself, when running standalone) writes a negative-case matrix derived from the journey block. The matrix is a list of probe targets, each describing a use case and its expected behaviour. Each entry maps to one or more findings emitted under the canonical schema in §1 of the reference file.

### Derivation rules

The matrix is built in two layers:

**Layer A — per-expectation complement.** For every entry in the journey's `Test expectations:` list, derive at least one negative complement. Common transforms:

| Positive expectation | Negative complement |
|---|---|
| Submit valid form → success | Submit with each required field missing → validation error visible to user |
| Submit valid form → success | Submit with each field set to malformed value (email, date, phone, currency, postal-code, etc.) → inline format validation, no silent acceptance |
| Submit valid form → success | Submit with payload exceeding the documented length / range → server rejects, no silent truncation |
| Submit valid form → success | Submit with each field set to whitespace-only / empty string / unicode boundary characters → expected sanitisation |
| User performs action → record persisted | Unauthorized user attempts the same action → 403 / redirect, no record persisted, no leakage of action-existence |
| User views resource → resource shown | User from a different tenant requests the same resource → 403 / not-found, no cross-tenant leakage |
| User edits own resource → update applied | User attempts to edit another user's resource via direct URL or ID tamper → 403 / not-found |
| List loads results | List with zero results → documented empty state, no spinner / error / blank screen |
| Search returns results | Search with malformed / overlong / injection-prone input (`<script>`, `'"; DROP`, control chars) → no error, no leak, expected sanitisation |
| Mutation succeeds first time | Same mutation replayed (double-submit, retry-after-network-blip, browser-back resubmit) → idempotent OR explicit duplicate-rejection error |
| Action completes within session | Same action attempted post-logout / after session expiry → clean redirect to auth, no partial mutation |
| Wizard step N completes | User navigates back to step N-1 and resubmits → state consistent, no orphaned record |
| Action runs to completion | User cancels / closes tab mid-action → no partial state, expected rollback or resumption |

**Layer B — cross-cutting negatives (always present).** Independent of the journey's expectations, every matrix MUST include:

- **Authorisation tamper** — unauthenticated request to a state-changing endpoint, expired-token request, role-downgrade access (e.g., regular user hitting an admin-only flow).
- **Tenant isolation** — cross-tenant resource access via direct ID (URL param, hidden form field, API path), cross-tenant list-leak via filter manipulation.
- **Idempotency / replay** — double-submit of any mutating action, request replay with a stale CSRF token, request replay after network retry.
- **Session boundary** — action attempted at session expiry, action attempted after explicit logout from a second tab, action attempted with a forged session cookie.
- **Input boundaries** — empty / whitespace / max-length / overflow / unicode / null-byte for every free-text and numeric field on the journey.

These are illustrative — the subagent applies the same "what is the negative of this expectation, and what cross-cutting negatives apply to this surface" transform to every journey. An empty matrix is a contract violation; no journey has zero negative cases.

### Matrix format (passed in the dispatch brief)

```
journey: j-<slug>
expectations covered by passes 1–3:
  - <verbatim expectation 1>
  - <verbatim expectation 2>
  - ...
negative-case matrix:
  per-expectation:
    - expectation: <verbatim expectation 1>
      negatives:
        - <negative complement 1>
        - <negative complement 2>
    - expectation: <verbatim expectation 2>
      negatives:
        - <negative complement 1>
  cross-cutting:
    - <auth-tamper probe applicable to this journey>
    - <tenant-isolation probe applicable to this journey>
    - <idempotency probe applicable to this journey>
    - <session-boundary probe applicable to this journey>
    - <input-boundary probe applicable to this journey>
```

### Coexistence with open-ended probing

The matrix sets a deterministic floor. `bug-discovery`'s open-ended probing categories (boundary inputs, race conditions, cross-feature, cumulative state, etc.) extend above it. Neither replaces the other — the subagent runs both and merges findings under the canonical schema.

The matrix entries are NOT findings on their own; they are probe targets. A matrix entry produces a finding when the probed behaviour deviates from the expected complement. An entry whose probe confirms the negative case is correctly handled is recorded as a `Boundaries verified` finding (pass 5 then writes the regression test).

### Pass 4 vs Pass 5 split

- **Pass 4** runs every matrix entry once. Findings classify into `Boundaries verified` / `Suspected bugs` / `Ambiguous`. No tests written.
- **Pass 5** re-probes the matrix entries that returned `Ambiguous` in pass 4, runs the compound probes that combine matrix entries (e.g., auth-tamper × idempotency, tenant-isolation × session-boundary), and writes regression tests for every `Boundaries verified` finding (matrix-derived or open-ended) from passes 4 + 5 combined.

If the matrix is shorter than the open-ended probing surfaces (e.g., the journey is a single-page read-only view), the cross-cutting negatives still apply and the matrix is non-empty.

---

## Ledger write discipline — file locking

Parallel subagents may try to append to `adversarial-findings.md` simultaneously. Use an advisory lockfile at `tests/e2e/docs/.adversarial-findings.lock`:

```bash
# pseudo — actual implementation uses node's lockfile package or flock
while ! mkdir tests/e2e/docs/.adversarial-findings.lock 2>/dev/null; do
  sleep 0.2
done
# ... append to adversarial-findings.md ...
rmdir tests/e2e/docs/.adversarial-findings.lock
```

Holding the lock should take under 500ms per subagent. Read the file, compute the append, write, release. Do not hold the lock during probing or any MCP calls.

## Return shape (text block, not JSON — orchestrator parses keys)

The top-level return is a summary block with the keys shown below. Any per-finding detail emitted inside the return (e.g. high-severity suspected bugs the orchestrator needs to surface) MUST follow the canonical finding-return schema in the reference file — do not invent alternative finding blocks here.


```
journey: j-<slug>
pass: 4
probes_attempted: 14
probe_categories: auth-tamper, input-tamper, price-tamper, qty-tamper, boundary-values
findings:
  boundaries_verified: 9
  suspected_bugs: 2
  ambiguous: 1
regression_tests_added: 0
high_severity_bugs_found: 0
stabilization: n/a
ledger_bytes_appended: 3412
```

```
journey: j-<slug>
pass: 5
probes_attempted: 8
probe_categories: compound, auth-tamper+qty-tamper, header-bypass, ambiguous-resolution
findings:
  boundaries_verified: 5
  suspected_bugs: 1
  ambiguous: 0
regression_tests_added: 14
high_severity_bugs_found: 1
stabilization: 3x-green-after-1-retry for 1 test; rest green-on-first
ledger_bytes_appended: 1892
```

## Hard constraints

- Pass 4 commits nothing. Only the ledger grows; the orchestrator does the commit after aggregating the dispatch's returns.
- Pass 5 commits nothing inside the subagent. The subagent writes files; the orchestrator commits after the pass completes.
- Neither pass grows the journey-map. Map growth stays with compositional passes.
- Neither pass modifies the page-repository. Page-repo growth stays with compositional passes.
- Regression tests live only in `j-<slug>-regression.spec.ts` files, one per probed journey. They never mix into `j-<slug>.spec.ts` or `*-extended.spec.ts` files.
