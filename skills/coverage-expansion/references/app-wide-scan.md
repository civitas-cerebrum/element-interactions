# App-Wide Pattern Scan — Pre-Pass-4 single dispatch

**Status:** authoritative spec for the one-shot app-wide scan that precedes Pass 4 (and informs Pass 5). Cited from `coverage-expansion/SKILL.md` §"Adversarial passes (4 and 5)" and from `adversarial-subagent-contract.md`.
**Scope:** what the scan does, how it's dispatched, the pattern catalogue it establishes, the output file format, and how per-journey probes cite the catalogue rather than re-finding each pattern.

For the per-journey adversarial subagent contract that runs after the scan, see `adversarial-subagent-contract.md`.

---

## What the app-wide scan does

A **single** adversarial dispatch fired before Pass 4's per-journey probes. Its job is to find and document the patterns that recur across every journey — security headers, CSRF behaviour, error envelopes for nonsense parameters, asset-disclosure footprints, CORS posture — so the per-journey probes don't each re-derive them. Most `info`-severity Pass-4 findings are duplicates of patterns in the catalogue below; documenting once and citing via `coverage: app-wide:<pattern-id>` replaces one re-derivation per journey for every pattern.

---

## When the scan runs

Once per `mode: depth` run, dispatched as the **first** Pass-4 step (before any per-journey probe). Output file is `tests/e2e/docs/app-wide-patterns.md` (created by the scan; absent before).

In `mode: breadth`, the scan does NOT run — breadth is a single-sweep mode that doesn't dedicate a pass to adversarial work. Breadth users who want app-wide pattern documentation can invoke the scan manually.

If the scan output file already exists from a prior run on the same project, the scan re-runs anyway — patterns drift over time as the app evolves. The orchestrator overwrites the file rather than merging; the prior file lives in git history.

---

## Dispatch shape

Description prefix: `probe-app-wide:`. Single subagent, dedicated `playwright-cli` session, isolated context. Recognised by `hooks/coverage-expansion-dispatch-guard.sh` as a leaf-shape probe (the `probe-` family).

```
description: "probe-app-wide: pass 4 — establish pattern catalogue"
```

Brief inputs:

1. App-context slice (auth endpoints, CSRF endpoint, representative URLs per page).
2. App credentials.
3. Live app URL.
4. The pattern catalogue checklist (below).
5. Output file path (`tests/e2e/docs/app-wide-patterns.md`).

Brief explicitly says: do NOT iterate the journey map; this is a app-wide reconnaissance pass, not a per-journey probe. The map will be probed per-journey in subsequent dispatches.

Model: opus, per the Pass 4 row of `coverage-expansion/SKILL.md` §"Hybrid model selection".

---

## Pattern catalogue checklist

The scan investigates every pattern in this checklist and documents the result for each. Each pattern has a stable `<pattern-id>` that per-journey probes cite via `coverage: app-wide:<pattern-id>`.

| Pattern ID | What to probe | What to record |
|---|---|---|
| `csrf-tamper-status` | POST/PUT/PATCH/DELETE to a representative protected endpoint with a tampered or removed CSRF token. | Status code + response body shape. Document whether the app returns 403, 404, or something else. |
| `csrf-tamper-cookie-clear` | Same as above with the CSRF cookie removed entirely. | Status + body. |
| `autocomplete-credential-inputs` | Inspect every `<input type="password">` and email/username inputs on auth pages. | Whether each input has an `autocomplete` attribute, and what value (`current-password`, `new-password`, `email`, `username`, or absent). |
| `sort-unknown-field-status` | Hit a list endpoint with `?sort=__nonexistent__` (or the app's sort-param convention). | Status + body. Document whether the app rejects gracefully or 500s. |
| `nginx-version-disclosure` | Inspect response headers across a representative page set for `Server: nginx/X.Y.Z` or similar. | Whether server version is disclosed, and at what specificity. |
| `cors-session-protected` | Inspect `Access-Control-Allow-Origin` on a session-protected API endpoint. | Whether the app allows `*` or restricts to known origins. |
| `cache-control-csrf-bearing` | Inspect `Cache-Control` on pages that carry CSRF tokens. | Whether the page is cacheable. |
| `referrer-policy` | Inspect `Referrer-Policy` header across a representative page set. | Header value (`strict-origin-when-cross-origin`, `no-referrer`, absent, etc.). |
| `x-content-type-options` | Inspect `X-Content-Type-Options` header. | Header value (`nosniff` or absent). |
| `x-frame-options` | Inspect `X-Frame-Options` (and `Content-Security-Policy frame-ancestors`). | Frame-embedding posture. |
| `hsts` | Inspect `Strict-Transport-Security` on HTTPS pages. | Header value or absence. |
| `error-envelope-shape` | Trigger 400/401/403/404/500 error responses across representative endpoints. | Whether all errors share an envelope shape (`{ error: { code, message } }`-like) or vary per route. |
| `asset-disclosure-sourcemaps` | Probe for `.map` files alongside the main bundle paths. | Whether sourcemaps ship in production. |
| `asset-disclosure-package` | Probe for `/package.json`, `/composer.json`, `/.git/config`, etc. | Whether dependency manifests are reachable. |
| `auth-rate-limit` | Send N rapid login attempts with bad credentials. | Whether rate-limiting kicks in, and at what threshold. |
| `session-cookie-flags` | Inspect the session cookie's `HttpOnly`, `Secure`, `SameSite` attributes. | Each flag's setting. |

The orchestrator updates this checklist as new patterns surface in the wild — additions ride in via PR; the scan's brief includes the latest version.

---

## Output file format — `tests/e2e/docs/app-wide-patterns.md`

The format below shows the **structure** of each section. Values are placeholders; the scanning subagent fills them in from the live app. Do NOT carry the example values forward — they illustrate the schema, not a real observation.

```markdown
<!-- app-wide-scan:generated -->

# App-Wide Pattern Catalogue

**Scanned at:** <ISO-8601 timestamp>
**Pass:** 4 (prelude)
**Subagent:** probe-app-wide
**App URL:** <baseURL>

## Patterns

### <pattern-id>
- **Status observed:** <what the live app returned for this probe — single value or per-endpoint breakdown>
- **Expected per security best practices:** <industry-standard expectation, when one applies>
- **Severity:** <info | low | medium | high | critical>
- **Note:** <one-sentence interpretation, optional — only when the observation needs context>
- **Cite as:** `coverage: app-wide:<pattern-id>`

(repeat for every pattern in §"Pattern catalogue checklist" above)
```

Required structure:

- Sentinel comment `<!-- app-wide-scan:generated -->` at line 1 (allows hooks to recognise the file as scan output).
- One `### <pattern-id>` per pattern in the catalogue, in catalogue order. **All 16 sections must be present** — one per pattern in §"Pattern catalogue checklist" above. Missing a section means the scan didn't probe that pattern; emit it with `Status observed: not probed` + `Severity: info` + the canonical `Cite as:` line rather than omitting the section.
- Every section has at minimum: `Status observed:` + `Severity:` + `Cite as:`.
- The `Cite as:` line MUST be exactly `**Cite as:** \`coverage: app-wide:<pattern-id>\`` — single-line, backticked, no surrounding prose. This shape is machine-parseable (a future structural-validation hook greps each `### <pattern-id>` block for a `Cite as: \`coverage: app-wide:<id>\`` whose `<id>` matches the section header). Don't paraphrase the citation text or split it across lines.

Hooks may extend this with additional structural validation in a follow-up issue (the file is currently markdown-only, with the sentinel comment as the load-bearing machine-readable signal). The `Cite as:` shape rule above is the contract such a hook will enforce.

---

## What if a per-journey probe finds a app-wide pattern not in the catalogue?

Emit the finding normally with `coverage: none` (the canonical "no covering pattern" form per `subagent-return-schema.md` §1). The orchestrator records the finding-ID for the next cycle's catalogue update PR; the catalogue itself never updates mid-cycle — additions ride in via PR per the Hard constraint above. Treating the finding as `coverage: none` keeps the citation discipline honest while flagging the catalogue gap for human review. Stage B reviewer does NOT flag `re-derived-app-wide-pattern` for these findings (the pattern wasn't in the catalogue at scan time, so the per-journey probe couldn't have cited it).

---

## How per-journey probes cite the catalogue

Per-journey probes (Pass 4 and 5) include the app-wide patterns file in their `coverage:` references. When a per-journey probe finds a pattern that the catalogue already documents, it cites in the canonical finding-block shape from `subagent-return-schema.md` §1:

```markdown
- **<JOURNEY-A>-4-07** [info] — CSRF tamper returns 404 not 403
  - **scope**: POST /api/checkout/submit
  - **expected**: 403
  - **observed**: 404
  - **coverage**: app-wide:csrf-tamper-status
```

The `coverage:` field's third valid form `app-wide:<pattern-id>` is documented in `subagent-return-schema.md` §1 (alongside the existing `none` and spec-file-path forms). The §4.1 grep validator accepts it.

The `coverage:` field IS the citation. The per-journey probe does NOT re-document the pattern in its own ledger entries — the citation is the documentation. Stage B reviewer (per the reviewer-subagent-contract) checks that per-journey probes cite app-wide patterns rather than re-finding them, and flags `craft-issues` finding `re-derived-app-wide-pattern` when a probe's finding could have been a citation.

---

## Hard constraints

- **One scan per `mode: depth` run.** Re-runs only when the orchestrator starts a fresh `mode: depth` invocation. **Resume signal:** the orchestrator treats the **presence** of `tests/e2e/docs/app-wide-patterns.md` (with the `<!-- app-wide-scan:generated -->` sentinel) as the sole resume signal — if the file exists, the prelude has already run for this `mode: depth` invocation; if not, dispatch it. This avoids polluting the state-file schema with a Pass-4-specific flag.
- **Runs first.** The app-wide scan finishes (output file written + committed) before any Pass-4 per-journey probe is dispatched.
- **Single subagent, no fan-out.** The scan is a leaf probe; it does NOT dispatch its own children. The pattern catalogue (16 patterns at the time of writing — see §"Pattern catalogue checklist") is short enough that one subagent covers it.
- **Exempt from dual-stage Stage A/B contract.** The app-wide-scan prelude is a leaf reconnaissance dispatch, not a journey-iteration cycle. It has no Stage B reviewer. The Stage A output (the catalogue file) is the entire deliverable; subsequent per-journey Pass-4 probes use it as input, but those per-journey probes carry their own dual-stage A/B per the journey contract. The prelude does NOT count toward Pass-4 dispatch totals.
- **Output file is committed**. Commit message: `docs(app-wide): pattern catalogue established (pre-pass-4)` (per `depth-mode-pipeline.md` §"Commit-message conventions" — added to the table in this PR).
- **Severity defaults are conservative.** Most patterns map to `info` severity (informational, not necessarily a bug); the scan's role is documentation, not classification. Per-journey probes may upgrade severity when the pattern manifests as a real boundary.

---

## Cross-links

- `coverage-expansion/SKILL.md` §"Adversarial passes (4 and 5)" — invokes this scan as the Pass-4 prelude.
- `adversarial-subagent-contract.md` §"Inputs" — per-journey probes get the app-wide-patterns file as Input 9 alongside the journey-specific inputs.
- `references/adversarial-findings-schema.md` — the `coverage:` field that holds the citation.
- Issue #164.3 (this scan's filing) for the empirical motivation and savings analysis.
