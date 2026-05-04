# Test Infrastructure Probe Protocol

> Loaded by the `journey-mapping` skill during Phase 1 page discovery. Captures the application's test-infrastructure surface (auth model, reset endpoint, persistent banners, mutation endpoints, stable seed resources) and writes it as a `## Test Infrastructure` section in `tests/e2e/docs/app-context.md`.
>
> Consumer: Stage 4a of the test-composition pipeline reads this section to make optimization decisions (helper population, API shortcut gates).

## When this protocol runs

The probe runs in two coordinated layers — observation during the crawl + a dedicated post-crawl subagent dispatch:

1. **In parallel with the crawl** (per-entry-point `phase1-<entry>:` subagents already in flight): each crawl subagent records the **observed** items it sees while visiting pages — Category A (auth model: when it visits `/login` / `/signup`, captures the auth shape from network traffic) and Category E (mutation endpoints: every POST/PUT/PATCH/DELETE the browser fires while crawling). These are emitted as part of each crawl subagent's structured return.

2. **After the crawl completes** the orchestrator dispatches a single **`phase1-test-infra:` subagent** that runs the **deliberate post-crawl probes** — Category B (reset/seed endpoint probe — fires the fixed list of `POST /api/reset` etc. against the host), Category C (banner / modal selector resolution — replays one of the homepage hits and resolves dismissal selectors), and Category D (stable seed resource enumeration — visits each catalog-style page once and records first-render IDs). The subagent also reconciles the per-entry-point Categories A + E into a single deduplicated list, then writes the canonical `## Test Infrastructure` section to `tests/e2e/docs/app-context.md`.

**Why this split.** The deliberate probe (B / C / D + the A/E reconciliation) is several thousand tokens of network output, DOM snapshots, and parsing. Running it inline in the orchestrator's context puts that load on every downstream phase. Dispatching it as a subagent confines the load to a single throwaway context — the orchestrator only sees the subagent's structured return (the `## Test Infrastructure` markdown block + a list of constraint tags for the audit). This is the same context-discipline rule coverage-expansion enforces for composer/probe work, applied to journey-mapping Phase 1.

**Dispatch slug:** `phase1-test-infra:` (recognised by the dispatch-guard's `phase1-[a-z0-9-]+` allowed-prefix regex). Single dispatch — not per-entry-point. Runs after the crawl roster reports complete. CLI session slug: `phase1-test-infra` (same prefix, isolated session).

**Subagent return shape:** structured Markdown matching the canonical `## Test Infrastructure` template below + a top-of-return `tags:` array carrying the constraint tags surfaced for the onboarding shared-resource audit (`global-reset:cross-test-race`, `single-tenant-global-state`, `csrf-session-bound`, etc. — see `onboarding/SKILL.md` §"Shared-resource audit").

## Inputs

- `playwright.config.ts` `baseURL` (the host being probed).
- The `playwright-cli` session used for Phase 1 crawl. Network observations come from `playwright-cli requests` against that session; HTTP details come from `playwright-cli request <index>` / `playwright-cli response-headers <index>` / `playwright-cli response-body <index>`. See [`../../element-interactions/references/playwright-cli-protocol.md`](../../element-interactions/references/playwright-cli-protocol.md) §3 for the session model.

## Probe categories

### A. Auth model

Observed during the crawl when the agent visits `/login`, `/signup`, `/logout`, or any `/api/auth/*` endpoint shows up in network traffic.

Capture:

- **Type:** `JWT in cookie` / `Session cookie` / `Bearer header` / `Basic auth` / `none-discovered`.
- **Cookie name** (if cookie-based) — read from `Set-Cookie` headers.
- **Endpoints:** login, signup (if separate), logout. Path + method + observed request body shape (keys only, values redacted).

### B. Reset / seed endpoints (deliberate post-crawl probe)

After the crawl, probe a fixed list of common test/reset paths:

```
POST /api/reset
POST /api/seed
POST /api/test/reset
POST /api/test/setup
POST /__test/reset
```

For each: record HTTP code and any short response body. The first 200 / 204 response wins — log its path and call shape.

**Safety:** the probe runs only against `localhost`, `127.0.0.1`, `::1`, or `*.local` hosts, OR a host explicitly listed in `journey-map.md`'s frontmatter under `journey-mapping:reset-probe-allowlist`. Any other host short-circuits the probe with `reset-endpoint: skipped (host not in allowlist)`.

### C. Persistent banners / modals

Observed during the crawl. Any DOM element matching `[data-testid*="banner" i]`, `[data-testid*="cookie" i]`, `[data-testid*="consent" i]`, `[data-testid*="welcome" i]`, `[role="dialog"][aria-modal="true"]` that survives at least one page navigation gets recorded.

Capture: selector for the banner itself + selector for its dismissal action (close button, accept button, etc.). If dismissal is unclear, record only the banner selector and note `dismissal: unknown`.

### D. Stable seed resources

Observed during the crawl on catalog-style pages (book lists, marketplace, etc.). For each catalog page: record the IDs/names of resources visible at first render — these are candidates for "rotate through" rather than hardcode.

**Do NOT** record stock counts, quantities, or other per-resource state — that requires a privileged read journey-mapping does not perform. The list is "stable IDs visible at first render", nothing more.

### E. Mutation endpoints (UI-driven)

Observed during the crawl. Every `POST` / `PUT` / `PATCH` / `DELETE` request fired by the browser is logged with:

- HTTP method and path.
- The page / interaction that triggered it (best-effort association with the most recent user action).
- Request body shape (keys only, values redacted unless obviously a fixed enum like `condition: "NEW"`).
- Response status code.

This is the inventory Stage 4a §4 uses to gate API shortcut helpers.

## `## Test Infrastructure` section format (canonical)

This is the exact Markdown template the probe writes into `tests/e2e/docs/app-context.md`. Stage 4a parses the tables — keep column structure stable.

````markdown
## Test Infrastructure

_Auto-generated by `journey-mapping` skill during Phase 1 discovery. Reviewed and consumed by Stage 4a (test optimization) of the test-composition pipeline. Do not edit by hand — re-run `journey-mapping` to refresh._

### Auth model

- **Type:** JWT in cookie  *(or: Session, Bearer header, Basic auth, none-discovered)*
- **Cookie name:** `bookhive_token`  *(if cookie-based)*
- **Login endpoint:** `POST /api/auth/login` — body `{ email, password }`, 200 sets cookie
- **Signup endpoint:** `POST /api/auth/signup` — body `{ username, email, password }`, 200 sets cookie + auto-authenticates
- **Logout endpoint:** `POST /api/auth/logout` — clears cookie

### Reset / seed endpoints

- **Reset:** `POST /api/reset` — 200, no body, resets DB to seed state
- **Seed-only:** `POST /api/seed` — 200  *(omit if not separate)*

*(Or: "none discovered — flag tenant-pollution risk; Stage 4a check #1 falls back to per-test isolation rules.")*

### Persistent banners / modals

- **Cookie banner:** `[data-testid='cookie-banner']`, dismissed via `[data-testid='cookie-accept']`. Appears on first visit per origin.
- **Welcome modal:** `[data-testid='welcome-modal']`, dismissed via `[data-testid='welcome-close']`. Shown only to new signups on first homepage land.

*(Or: "none discovered.")*

### Stable seed resources

- **Books catalog:** 10 stable IDs `book-001` … `book-010` observed at first render of the home/catalog page.
- **Marketplace listings:** 5 stable seed listings observed on `/marketplace` first render, owned by `seed_seller`.

Stock / quantity / per-resource counters are NOT inventoried here — they require a privileged read journey-mapping does not perform. Stage 4a's #2 check uses this list only as a candidate set for rotation, not as ground truth on availability.

### Mutation endpoints (UI-driven, observed during crawl)

| Method | Path | Triggered by | Request shape | Response |
|---|---|---|---|---|
| POST | `/api/auth/login` | LoginPage submit | `{ email, password }` | 200 + Set-Cookie |
| POST | `/api/auth/signup` | SignupPage submit | `{ username, email, password }` | 200 + Set-Cookie |
| POST | `/api/cart/items` | "Add to Cart" button | `{ bookId, quantity }` | 200 |
| PUT  | `/api/cart/items/:id` | quantity input change | `{ quantity }` | 200 |
| POST | `/api/orders` | Checkout button | `{}` (cart implicit) | 200 + new order |
| POST | `/api/marketplace/listings` | Sell-book form submit | `{ bookId, price, condition }` | 200 |
| POST | `/api/orders/:id/return` | "Return Order" button | `{}` | 200 |

*(One row per observed mutation. Omit duplicates; keep only the most-informative trigger when multiple pages fire the same endpoint.)*
````
