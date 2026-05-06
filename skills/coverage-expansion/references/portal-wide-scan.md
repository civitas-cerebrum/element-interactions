# Portal-Wide Pattern Scan — Pre-Pass-4 single dispatch

**Status:** authoritative spec for the one-shot portal-wide scan that precedes Pass 4 (and informs Pass 5). Cited from `coverage-expansion/SKILL.md` §"Adversarial passes (4 and 5)" and from `adversarial-subagent-contract.md`.
**Scope:** what the scan does, how it's dispatched, the pattern catalogue it establishes, the output file format, and how per-journey probes cite the catalogue rather than re-finding each pattern.

For the per-journey adversarial subagent contract that runs after the scan, see `adversarial-subagent-contract.md`.
For the empirical motivation (~80% of `info`-severity findings repeat the same patterns across journeys), see issue #164.3.

---

## What the portal-wide scan does

A **single** adversarial dispatch fired before Pass 4's per-journey probes. Its job is to find and document the patterns that recur across every journey — security headers, CSRF behaviour, error envelopes for nonsense parameters, asset-disclosure footprints, CORS posture — so the per-journey probes don't each re-derive them.

**Empirical justification (from #164's farmedvisie-t2 cycle):**

- ~80% of `info`-severity findings in Pass 4 ledgers across 30 journeys are duplicates of: CSRF tamper → 404 (not 403), missing autocomplete attrs on credential inputs, sort-by-unknown-field → 500, nginx version disclosure, CORS `*` on session-protected endpoints, missing `Cache-Control` on CSRF-bearing pages.
- Each per-journey probe spent ~3-5 minutes and ~30-50k tokens re-deriving these.
- Documenting once → all 30 journey probes cite via `coverage: portal-wide:<pattern-id>` instead of re-finding. ~3-5 minutes × 30 journeys = ~2 hours of subagent compute saved per cycle.

---

## When the scan runs

Once per `mode: depth` run, dispatched as the **first** Pass-4 step (before any per-journey probe). Output file is `tests/e2e/docs/portal-wide-patterns.md` (created by the scan; absent before).

In `mode: breadth`, the scan does NOT run — breadth is a single-sweep mode that doesn't dedicate a pass to adversarial work. Breadth users who want portal-wide pattern documentation can invoke the scan manually.

If the scan output file already exists from a prior run on the same project, the scan re-runs anyway — patterns drift over time as the app evolves. The orchestrator overwrites the file rather than merging; the prior file lives in git history.

---

## Dispatch shape

Description prefix: `probe-portal-wide:`. Single subagent, dedicated `playwright-cli` session, isolated context. Recognised by `hooks/coverage-expansion-dispatch-guard.sh` as a leaf-shape probe (the `probe-` family).

```
description: "probe-portal-wide: pass 4 — establish pattern catalogue"
```

Brief inputs:

1. App-context slice (auth endpoints, CSRF endpoint, representative URLs per page).
2. App credentials.
3. Live app URL.
4. The pattern catalogue checklist (below).
5. Output file path (`tests/e2e/docs/portal-wide-patterns.md`).

Brief explicitly says: do NOT iterate the journey map; this is a portal-wide reconnaissance pass, not a per-journey probe. The map will be probed per-journey in subsequent dispatches.

Model: opus (per `coverage-expansion/SKILL.md` §"Hybrid model selection — Sonnet by default, Opus where it pays" — adversarial discovery yield benefits from Opus reasoning depth on compound probes, and the portal-wide scan synthesises across many endpoints).

---

## Pattern catalogue checklist

The scan investigates every pattern in this checklist and documents the result for each. Each pattern has a stable `<pattern-id>` that per-journey probes cite via `coverage: portal-wide:<pattern-id>`.

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

## Output file format — `tests/e2e/docs/portal-wide-patterns.md`

```markdown
<!-- portal-wide-scan:generated -->

# Portal-Wide Pattern Catalogue

**Scanned at:** 2026-05-06T14:00:00Z
**Pass:** 4 (prelude)
**Subagent:** probe-portal-wide
**App URL:** <baseURL>

## Patterns

### csrf-tamper-status
- **Status observed:** 404
- **Expected per security best practices:** 403
- **Severity:** info
- **Note:** the app returns 404 (route-not-found semantics) rather than 403 (forbidden) when a CSRF token is tampered. This is consistent across every protected endpoint probed (POST /api/orders, PUT /api/users/me, DELETE /api/items/123).
- **Cite as:** `coverage: portal-wide:csrf-tamper-status`

### autocomplete-credential-inputs
- **Status observed:**
  - `/login` → `autocomplete="current-password"` on password input ✓, no `autocomplete` on email input ✗
  - `/signup` → no `autocomplete` on either input ✗
  - `/account/change-password` → no `autocomplete` on any of the three password inputs ✗
- **Severity:** info
- **Cite as:** `coverage: portal-wide:autocomplete-credential-inputs`

### sort-unknown-field-status
- **Status observed:** 500 (with stack trace partially exposed in the response body's `detail:` field)
- **Severity:** medium (stack-trace disclosure in error body)
- **Cite as:** `coverage: portal-wide:sort-unknown-field-status`

[... one section per pattern in the catalogue ...]
```

Required structure:

- Sentinel comment `<!-- portal-wide-scan:generated -->` at line 1 (allows hooks to recognise the file as scan output).
- One `### <pattern-id>` per pattern in the catalogue, in catalogue order.
- Every section has at minimum: `Status observed:` + `Severity:` + `Cite as:`.
- The `Cite as:` line is the canonical citation form per-journey probes use.

Hooks may extend this with additional structural validation in a follow-up issue (the file is currently markdown-only, with the sentinel comment as the load-bearing machine-readable signal).

---

## How per-journey probes cite the catalogue

Per-journey probes (Pass 4 and 5) include the portal-wide patterns file in their `coverage:` references. When a per-journey probe finds a pattern that the catalogue already documents, it cites:

```yaml
- finding-id: j-checkout-4-07
  scope: CSRF tamper on POST /api/checkout/submit
  severity: info
  expected: 403
  observed: 404
  coverage: portal-wide:csrf-tamper-status
```

The `coverage:` field IS the citation. The per-journey probe does NOT re-document the pattern in its own ledger entries — the citation is the documentation. Stage B reviewer (per the reviewer-subagent-contract) checks that per-journey probes cite portal-wide patterns rather than re-finding them, and flags `craft-issues` finding `re-derived-portal-wide-pattern` when a probe's finding could have been a citation.

---

## Hard constraints

- **One scan per `mode: depth` run.** Re-runs only when the orchestrator starts a fresh `mode: depth` invocation.
- **Runs first.** The portal-wide scan finishes (output file written + committed) before any Pass-4 per-journey probe is dispatched.
- **Single subagent, no fan-out.** The scan is a leaf probe; it does NOT dispatch its own children. The pattern catalogue is short enough (~15 patterns) that one subagent covers it.
- **Output file is committed**. Commit message: `docs(portal-wide): pattern catalogue established (pre-pass-4)`.
- **Severity defaults are conservative.** Most patterns map to `info` severity (informational, not necessarily a bug); the scan's role is documentation, not classification. Per-journey probes may upgrade severity when the pattern manifests as a real boundary.

---

## Cross-links

- `coverage-expansion/SKILL.md` §"Adversarial passes (4 and 5)" — invokes this scan as the Pass-4 prelude.
- `adversarial-subagent-contract.md` §"Inputs" — per-journey probes get the portal-wide-patterns file as Input 9 alongside the journey-specific inputs.
- `references/adversarial-findings-schema.md` — the `coverage:` field that holds the citation.
- Issue #164.3 (this scan's filing) for the empirical motivation and savings analysis.
