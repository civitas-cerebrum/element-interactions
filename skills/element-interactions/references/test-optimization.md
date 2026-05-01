# Test Optimization Protocol

> Single source of truth for Stage 4a (test optimization). Loaded on demand by:
> - `element-interactions` orchestrator's **Stage 4a**.
> - `test-composer`'s **Step 6a**.
>
> Do not read this file from memory. Always load it before applying its rules.

## When this protocol runs

Stage 4a runs after a test reaches passing state in stabilization, **before** Stage 4b (API Compliance Review). It reviews the freshly-written tests against six best-practice checks — three reliability checks, two speed checks, one DRY check — and applies fixes before handing off to 4b.

The protocol assumes:

- `tests/e2e/docs/app-context.md` exists and contains a `## Test Infrastructure` section (produced by `journey-mapping`'s Phase 1 probe).
- `tests/e2e/docs/journey-map.md` exists and is sentinel-bearing.
- `tests/fixtures/base.ts` exists and contains `HELPER SLOT` comment markers (produced by `onboarding`'s Phase 1 scaffold).

Missing either of those two → stop the protocol, return an error pointing the caller at the missing prerequisite. Do not synthesize the missing artifact.

**Single-spec mode.** If `journey-map.md` exists and has the sentinel but no journey blocks are populated with `UI-covers:` fields yet (e.g. during onboarding's Phase 3 happy-path before Phase 4 produces the full map), Stage 4a runs in **single-spec mode**: §4 (API shortcuts) is skipped entirely — no UI-covers registry to consult, so all prerequisites stay UI-driven. Checks §1, §2, §3, §5, §6 still apply. The `next_stage` of the structured return notes `mode: single-spec`.

## Placeholder convention

Helper-code blocks below contain placeholders inside `«double-angle-brackets»`. These are app-specific values the agent MUST substitute before copying the template into `tests/fixtures/base.ts`. Substitutions come from the `## Test Infrastructure` section of `tests/e2e/docs/app-context.md`:

| Placeholder | Source |
|---|---|
| `«BASE_URL»` | `playwright.config.ts` `baseURL` |
| `«RESET_ENDPOINT»` | Test Infrastructure `Reset / seed endpoints` |
| `«LOGIN_ENDPOINT»` | Test Infrastructure `Auth model → Login endpoint` |
| `«COOKIE_NAME»` | Test Infrastructure `Auth model → Cookie name` |
| `«CART_ADD_ENDPOINT»` | Test Infrastructure `Mutation endpoints` row matching cart-add |
| `«BANNER_DISMISS_SELECTORS»` | Test Infrastructure `Persistent banners / modals` (each banner's dismissal selector, comma-separated) |

A template with any unresolved `«…»` placeholder MUST NOT be written into `base.ts`. Stage 4a halts and returns `placeholder-unresolved` if it cannot find the substitution in app-context.

## The six checks

| # | Category | Name | Auto-fix? |
|---|---|---|---|
| 1 | Reliability | State isolation (`beforeEach(resetState)`) | yes (per-spec insert) |
| 2 | Reliability | Hardcoded shared resources | yes (per-spec rotate or fall through to #1) |
| 3 | Reliability | Per-run uniqueness (`Date.now()`/`crypto.randomUUID()`) | yes (per-spec rewrite literal) |
| 4 | Speed | API shortcuts for tested prerequisites | yes (per-spec replace UI prereq with helper call; populate helper in `base.ts` if absent) |
| 5 | Speed | Cookie banner / persistent modal handling | yes (per-spec strip duplicated dismiss; populate `dismissBanners` in `base.ts`) |
| 6 | DRY | Serial mode discipline | flag-only (do not silently strip `mode: 'serial'`) |

The detailed rules for each check are in §1 through §6 below.

## §1 State isolation

**Trigger:** the spec under review mutates state. Mutating tests are detected by any of: `steps.click('submit*')` in a flow that creates a record; `signupFresh()` / `loginFresh()` helpers; calls into endpoints listed under `Mutation endpoints (UI-driven)` in app-context's Test Infrastructure section.

§1 has two branches. **Read app-context.md's Test Infrastructure section AND the onboarding shared-resource-audit tags before applying either.** Picking the wrong branch silently caps the suite at `workers=1` forever or causes cross-worker test pollution.

### §1.A — Per-test-user isolation (mandatory when `global-reset:cross-test-race` tag is present)

**Trigger:** the onboarding shared-resource audit reported `global-reset:cross-test-race` — the discovered reset endpoint touches global (non-tenanted) collections, and `beforeEach(reset)` would race across Playwright workers.

**Rule:** the spec MUST NOT call `beforeEach(resetState)` or any equivalent global-wipe hook. Instead:

1. Each test creates its own throwaway user (or uses an isolated test-user pool) and asserts against per-user-scoped views.
2. The suite has ONE `globalSetup` (Playwright config) that seeds the global state once before any test runs.
3. Specs that need clean state for a specific resource use targeted per-user cleanup, never global reset.

**Auto-fix:**

1. Populate `tests/fixtures/base.ts`'s `freshUser` HELPER SLOT to mint a throwaway user per test. The helper signs the user in and returns the `{ email, password, userId }` triplet:

   ```typescript
   import { request, type Page } from '@playwright/test';

   export async function freshUser(page: Page): Promise<{ email: string; password: string; userId: string }> {
     const email = `test+${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.test`;
     const password = 'P@ssw0rd!';
     const ctx = await request.newContext({ baseURL: process.env.BASE_URL ?? '«BASE_URL»' });
     const res = await ctx.post('«SIGNUP_ENDPOINT»', { data: { email, password } });
     if (!res.ok()) throw new Error(`freshUser signup failed: ${res.status()}`);
     const { userId } = await res.json();
     await ctx.dispose();
     // The page-level login is left to the spec — fixtures shouldn't navigate.
     return { email, password, userId };
   }
   ```

2. Populate `playwright.config.ts`'s `globalSetup` slot with a once-per-suite seed:

   ```typescript
   // playwright.config.ts
   export default defineConfig({
     globalSetup: require.resolve('./tests/fixtures/global-setup'),
     // ...
   });
   ```

   ```typescript
   // tests/fixtures/global-setup.ts
   import { request } from '@playwright/test';
   export default async function globalSetup() {
     const ctx = await request.newContext({ baseURL: process.env.BASE_URL ?? '«BASE_URL»' });
     await ctx.post('«RESET_ENDPOINT»');  // run once, before any worker spawns
     await ctx.dispose();
   }
   ```

3. Each spec uses `freshUser` per-test, with assertions scoped to that user:

   ```typescript
   test('listing creates and appears on MY profile', async ({ page }) => {
     const { email, password } = await freshUser(page);
     await steps.signin(email, password);
     await steps.createListing({ title: 'My item', price: 10 });
     // SCOPED — assert on MY profile, not on the global marketplace.
     await steps.navigateTo('/me/listings');
     await steps.verifyText('listingTitle', 'My item');
   });
   ```

**Banned in this branch:** `test.beforeEach(resetState)`, `test.beforeAll(resetState)` (in non-serial mode), and any direct call to the discovered reset endpoint inside a spec body. The banned forms produce cross-worker races (worker A's reset wipes worker B's mid-test state).

**Why:** a shared-DB SaaS-style app where every test calls `/api/reset` in `beforeEach` *appears* isolated but actually serialises every worker through one global mutation. Workers never run in parallel — `workers=4` becomes `workers=1` in practice. The per-test-user pattern is the only way to keep `workers=N` real.

### §1.B — Global reset isolation (default when no global-reset tag is present)

**Trigger:** `app-context.md`'s `Reset / seed endpoints` is non-empty AND the audit did NOT report `global-reset:cross-test-race`. This means the reset is either tenanted (per-user-or-tenant scope) or the suite is mono-worker by design.

**Rule:** every mutating spec MUST have `test.beforeEach(resetState)` (or `test.beforeAll` for serial-mode describes — see §6).

**Auto-fix:**

1. If `tests/fixtures/base.ts`'s `resetState` HELPER SLOT is empty, populate it from the discovered reset endpoint:

   ```typescript
   import { request } from '@playwright/test';

   export async function resetState() {
     const ctx = await request.newContext({ baseURL: process.env.BASE_URL ?? '«BASE_URL»' });
     const res = await ctx.post('«RESET_ENDPOINT»');
     if (!res.ok()) throw new Error(`resetState failed: ${res.status()} ${await res.text()}`);
     await ctx.dispose();
   }
   ```

2. Insert into the spec's top-level describe:

   ```typescript
   import { test, expect } from '../fixtures/base';
   import { resetState } from '../fixtures/base';

   test.beforeEach(async () => {
     await resetState();
   });
   ```

### Branch-selection summary

| audit tag                      | reset endpoint discovered | applies | beforeEach(reset) |
|---|---|---|---|
| `global-reset:cross-test-race` | yes                       | §1.A    | **forbidden** — use freshUser + globalSetup |
| (none)                         | yes                       | §1.B    | **mandatory** |
| (none)                         | no — `none discovered`    | mark spec `// stage4a:no-reset-endpoint`, fall through to §2 | n/a |
| `single-tenant-global-state`   | (independent of reset)    | overlay on §1.A or §1.B | rewrite global-state assertions to per-user-scoped views |

**No-reset-discovered branch:** if the Test Infrastructure section's `Reset / seed endpoints` entry reads `none discovered`, mark the spec with a `// stage4a:no-reset-endpoint` top-of-file comment and proceed. Stage 4a's §2 (hardcoded shared resources) becomes the strict gate instead.

## §2 Hardcoded shared resources

**Trigger:** the spec hardcodes a fixed resource ID in a mutation path. Detected by literal matches against `Stable seed resources` entries in app-context's Test Infrastructure (e.g. literal strings `book-001`, `listing-XYZ`, `testuser1@…`) appearing in `steps.click('addToCart…')` paths or in mutation API helpers.

**Rule:** either (a) rotate via a per-test counter / random-index lookup against the seed catalog, OR (b) ensure `beforeEach(resetState)` is in place (rule §1).

**Auto-fix preference:** if §1 applies (reset endpoint discovered), prefer §1 — it's stronger isolation than rotation. Apply rotation only when §1's no-reset-discovered branch was taken.

**Rotation pattern:**

```typescript
const SEED_BOOKS = ['book-001','book-002','book-003','book-004','book-005','book-006','book-007','book-008','book-009','book-010'];

test('happy-path: add to cart, checkout', async ({ steps }) => {
  const bookIdx = test.info().workerIndex * 7 + (test.info().retry ?? 0);  // worker × 7 + retry
  const bookId = SEED_BOOKS[bookIdx % SEED_BOOKS.length];
  // …rest of test uses bookId, e.g. steps.click('bookCardTitle' + bookId.replace('book-',''), 'HomePage');
});
```

The exact seed list comes from `app-context.md`'s `Stable seed resources`. Do not invent IDs.

**Flag-and-stop exception:** if the journey is *deliberately about* the named resource (e.g. `j-purchase-the-great-gatsby` literally tests `book-001` because the journey name says so), leave the literal in place and add a `// stage4a:resource-deliberate` comment for human review. Do not auto-rotate.

## §3 Per-run uniqueness for created entities

**Trigger:** a test creates a tenant entity (signup, listing, profile creation, etc.) using a literal identifier value.

**Rule:** the literal must come from a per-run unique source: `Date.now()`, a counter, or `crypto.randomUUID()`. Bare literals like `'new-user@test.com'` or `'My Listing'` are not allowed in mutation paths.

**Auto-fix:** convert any literal that looks fixed to a templated unique value. Example:

```typescript
// before
const email = 'new-user@test.com';

// after
const email = `new-user-${Date.now()}@test.com`;
```

For values that participate in case-sensitivity tests, prefer `crypto.randomUUID().slice(0, 8)` to avoid timing collisions.

**Allowance — duplicate-detection tests:** if the spec is *about* duplicate detection (file name or describe title contains `duplicate` / `already-exists` / `taken`), the literal stays — the test is verifying the duplicate path. Add a `// stage4a:duplicate-deliberate` comment for human review and skip the auto-fix.

## §4 API shortcuts for tested prerequisites

**Trigger:** the spec performs UI prerequisite steps that are not the subject of the test (e.g. a checkout test that signs up via the UI before reaching the checkout step).

**Two-of-two gate:**

| Gate | Source of truth | Question |
|---|---|---|
| **A. UI-covered elsewhere** | `UI-covers:` field in `journey-map.md` | Does any journey claim to UI-cover this flow? |
| **B. API equivalent discovered** | `Mutation endpoints (UI-driven)` in `app-context.md`'s Test Infrastructure | Is there a logged endpoint whose URL + method + body shape matches the prerequisite? |

**Both YES → recommend API shortcut helper.** Populate the helper in `base.ts` if absent, replace UI calls in the spec under review with the helper call.

**Either NO → keep UI flow.**
- A-fail: flag a coverage gap to journey-mapping. The spec stays UI-driven so that *some* journey eventually covers this flow via UI.
- B-fail: permanent fact about this app. The spec stays UI-driven; do not re-flag.

### Decision matrix (illustrative)

| Prerequisite | UI-covered? | API discovered? | Action |
|---|:---:|:---:|---|
| login | yes | yes | use `setAuthCookie()` helper |
| login | yes | no | keep UI |
| login | no | yes | keep UI; flag A-gap to journey-mapping |
| login | no | no | keep UI |
| cart-add | yes | yes (`POST /api/cart/items`) | use `seedCart()` helper |
| theme toggle | yes | no API equivalent | keep UI |

### Helper template — `setAuthCookie`

Substitute the `«…»` placeholders per the placeholder-convention table above:

```typescript
// In tests/fixtures/base.ts (HELPER SLOT: setAuthCookie)
import { request, type Page } from '@playwright/test';

const COOKIE_NAME = '«COOKIE_NAME»';
const BASE_URL = process.env.BASE_URL ?? '«BASE_URL»';

export async function setAuthCookie(page: Page, credentials: { email: string; password: string }) {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const res = await ctx.post('«LOGIN_ENDPOINT»', { data: credentials });
  if (!res.ok()) throw new Error(`setAuthCookie login failed: ${res.status()}`);
  const setCookie = res.headers()['set-cookie'] ?? '';
  const re = new RegExp(`(${COOKIE_NAME})=([^;]+)`);
  const match = setCookie.match(re);
  if (!match) throw new Error(`setAuthCookie: ${COOKIE_NAME} cookie not found in response`);
  await page.context().addCookies([{
    name: match[1],
    value: match[2],
    url: BASE_URL,
  }]);
  await ctx.dispose();
}
```

### Helper template — `seedCart`

```typescript
// In tests/fixtures/base.ts (HELPER SLOT: seedCart)
import type { APIRequestContext } from '@playwright/test';

export async function seedCart(authedCtx: APIRequestContext, items: { bookId: string; quantity: number }[]) {
  for (const item of items) {
    const res = await authedCtx.post('«CART_ADD_ENDPOINT»', { data: item });
    if (!res.ok()) throw new Error(`seedCart failed for ${item.bookId}: ${res.status()}`);
  }
}
```

Other helpers (`createListingViaApi`, etc.) follow the same shape: read the request body shape from Test Infrastructure's `Mutation endpoints` table, parameterize what the call site needs, throw on non-2xx.

**Per-spec replacement pattern:**

```typescript
// before
test('happy-path: cart → checkout → order', async ({ steps, page }) => {
  await signupFresh(steps);  // UI signup, ~3-5s
  await steps.click('addToCartBook001', 'HomePage');  // UI add, ~1s
  // …rest of test
});

// after
test('happy-path: cart → checkout → order', async ({ steps, page, request }) => {
  const email = `flow-${Date.now()}@test.com`;
  await signupViaApi(request, { email, password: 'TestPass123!' });  // API signup
  await setAuthCookie(page, { email, password: 'TestPass123!' });
  await seedCart(request, [{ bookId: SEED_BOOKS[0], quantity: 1 }]);
  await page.goto('/cart');
  // …rest of test starts from cart-loaded state
});
```

The mechanical rule: **any `signupFresh` / `loginFresh` / `addToCartViaUI` call that is not the focus of the test is a candidate for replacement, gated by §4's 2-of-2 check.**

## §5 Cookie banner / persistent modal handling

**Trigger:** any test body or spec-level helper clicks a banner-dismiss / modal-close, OR the same dismissal selector appears in two or more spec files.

**Rule:** dismissal goes in `base.ts`'s `dismissBanners` HELPER SLOT, called from the fixture's `beforeEach`. Specs do not repeat it.

**Auto-fix:**

1. Populate `tests/fixtures/base.ts`'s `dismissBanners` slot. Substitute `«BANNER_DISMISS_SELECTORS»` with the comma-separated list from app-context Test Infrastructure's `Persistent banners / modals` section:

   ```typescript
   // In tests/fixtures/base.ts (HELPER SLOT: dismissBanners)
   import type { Page } from '@playwright/test';

   export async function dismissBanners(page: Page) {
     for (const sel of [«BANNER_DISMISS_SELECTORS»]) {
       const el = page.locator(sel).first();
       if (await el.isVisible({ timeout: 250 }).catch(() => false)) {
         await el.click().catch(() => { /* ignore — banner already dismissed */ });
       }
     }
   }
   ```

   Example substitution (BookHive): `'[data-testid="cookie-accept"]', '[data-testid="welcome-close"]'`.

2. Populate the `HELPER SLOT: beforeEach` slot in `base.ts` (NOT a freeform region — the slot is the single contracted insertion point for fixture-level `beforeEach` hooks):

   ```typescript
   // In tests/fixtures/base.ts (HELPER SLOT: beforeEach)
   test.beforeEach(async ({ page }) => {
     await dismissBanners(page);
   });
   ```

   If the slot already contains other `test.beforeEach` blocks (e.g., from a prior Stage 4a run that populated `resetState` here), append the new block to the slot — do NOT overwrite. The slot is additive across protocol runs.

3. Strip duplicated `await steps.click('cookieAccept', …)` / `await page.locator(...)` dismiss calls from each spec body. The fixture handles it now.

**No-banner-discovered branch:** if Test Infrastructure's `Persistent banners / modals` reads `none discovered`, the `dismissBanners` slot stays empty (or has a no-op stub). Check is a no-op for the spec under review.

## §6 Serial mode discipline

**Trigger:** `test.describe.configure({ mode: 'serial' })` (or `test.describe.serial(...)`) is present in the spec under review.

**Rule:** allowed only when both (a) AND (b) hold:

- **(a)** Serial dependency is intentional — i.e. test N+1 deliberately depends on the side-effects of test N. (Most well-isolated tests do not need this.)
- **(b)** The first test in the block is a **cheap, fast-failing sentinel** that surfaces real env breakage cleanly. Examples:
  - A single `await steps.verifyPresence('homeRoot', 'HomePage');` after a navigate.
  - An API health-check via `request.get('/api/health')`.

  The sentinel is named `sentinel: …` so cascade-skips become diagnostic, not silent collateral damage.

**Flag-only behavior:** Stage 4a does NOT silently strip `mode: 'serial'` even if the rule is violated. It does:

1. Detect the violation (no sentinel as first test, or no apparent inter-test state dependency).
2. Append a `// stage4a:serial-mode-review` comment above the `configure` line.
3. Surface the finding in the structured return as `{ rule: '§6', severity: 'review', spec: <path>, reason: '…' }`.

The agent does not auto-flip `mode: 'serial'` to per-test isolation because doing so can break tests that genuinely need serial state. Human review or a follow-up coverage-expansion pass takes the call.

**Sentinel example (compliant):**

```typescript
test.describe.configure({ mode: 'serial', timeout: 60_000 });

test.describe('j-cart-clear — Clear entire cart', () => {
  test('sentinel: app health + auth ready', async ({ steps, request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBe(true);
    await steps.navigateTo('/');
    await steps.verifyPresence('homeRoot', 'HomePage');
  });

  test('happy-path: add items, clear cart, empty state shown, badge gone', async ({ steps }) => {
    // …real test, depends on the sentinel having warmed the env
  });
});
```

## §7 Whole-suite re-run gate (orchestrator-level)

This rule is enforced by **orchestrators**, not by Stage 4a itself. Stage 4a runs per-spec; the gate runs per-pass / per-phase exit and verifies that the whole suite — not just the just-written tests — is still green.

**Where it runs:**

- `test-composer` Step 7 exit (after coverage verification, before structured return).
- `coverage-expansion` per-pass exit (after each of its 5 passes, before invoking the next pass).
- `onboarding` Phase 5 → Phase 6 transition.

**What it does:**

1. Run `npx playwright test --reporter=json > .stage4a-suite.json` against the entire suite (no `--grep`, no `--shard`).
2. Parse `.stage4a-suite.json`. Playwright's JSON reporter shape is `{ stats: { expected, unexpected, flaky, skipped, ... }, suites: [...] }`. Apply both checks:
   - `stats.unexpected > 0` (failures, including timed-out and interrupted) → refuse to advance.
   - `stats.skipped` > count of explicit `test.skip(` markers across spec files → refuse to advance. This catches cascade-skips from §6 (`test.describe.configure({ mode: 'serial' })` blocks where the first test failed and Playwright skipped its siblings). Use the portable command:
     ```bash
     grep -rh '^\s*test\.skip\b' tests/e2e --include='*.spec.ts' | wc -l
     ```
     `grep -r` recurses; `--include` filters by glob without depending on shell `**` (which only works with `globstar` enabled in bash and is not portable).
3. On refusal, return `{ status: 'whole-suite-gate-failed', stats: { unexpected, skipped, expected, flaky }, failures: [...], skips_unexplained: <skipped-stats minus marker-count> }` to the caller. The caller is responsible for deciding whether to halt the whole pipeline or continue with reduced scope; the gate itself does not decide.
4. Delete `.stage4a-suite.json` after parsing — it does not get committed.

**Why this exists:** per-pass `stabilize` confirms the just-written tests pass but does not guarantee the suite as a whole still passes after accumulated state. Cumulative state changes — DB pollution, port collisions, fixture drift, shared-resource depletion — only surface when the whole suite runs together. The whole-suite gate moves that surfacing forward from end-of-pipeline to per-pass-exit.

## §8 Output format

Stage 4a returns a structured JSON-shaped block back to its caller. The block is also rendered as Markdown for the user-visible review summary (when run interactively via the orchestrator).

**Schema:**

```json
{
  "stage": "4a",
  "specs_reviewed": ["tests/e2e/<path>.spec.ts", "..."],
  "fixtures_modified": ["tests/fixtures/base.ts"],
  "findings": [
    { "rule": "§1", "severity": "fixed", "spec": "<path>", "summary": "Inserted beforeEach(resetState)." },
    { "rule": "§4", "severity": "fixed", "spec": "<path>", "summary": "Replaced UI signup with setAuthCookie() (login UI-covered in j-login-to-purchase)." },
    { "rule": "§4", "severity": "gap-flagged", "spec": "<path>", "summary": "Cart-add not UI-covered in any journey; kept UI flow and flagged journey-mapping." },
    { "rule": "§6", "severity": "review", "spec": "<path>", "summary": "Serial mode without sentinel; inserted // stage4a:serial-mode-review comment." }
  ],
  "post_fix_run": { "status": "passing", "specs_passed": 18, "specs_failed": 0 },
  "next_stage": "4b"
}
```

**Severity values:**

- `fixed` — auto-fix applied, test re-run, still passing.
- `review` — flagged for human read; no auto-fix taken.
- `gap-flagged` — coverage gap surfaced to a sibling skill (journey-mapping for §4 A-fails); the spec under review is unchanged.
- `blocked` — auto-fix attempted but caused a regression; reverted; flagged for human read.

**Markdown render (for interactive Stage 4a):**

```markdown
**Test Optimization Review (Stage 4a)**

Reviewed: `tests/e2e/checkout.spec.ts`, `tests/e2e/cart.spec.ts`
Fixtures modified: `tests/fixtures/base.ts`

- `checkout.spec.ts` (§1) — fixed: inserted `beforeEach(resetState)`.
- `checkout.spec.ts` (§4) — fixed: replaced UI signup with `setAuthCookie()` (login UI-covered in `j-login-to-purchase`).
- `cart.spec.ts` (§4) — gap: cart-add not UI-covered; kept UI flow, flagged to journey-mapping.
- `cart.spec.ts` (§6) — review: serial mode without sentinel; comment inserted.

Post-fix re-run: 18 / 18 passing. Proceeding to 4b.
```
