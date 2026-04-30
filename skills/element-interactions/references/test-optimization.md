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
- `tests/e2e/docs/journey-map.md` exists and is sentinel-bearing, with each journey block declaring a `UI-covers:` field.
- `tests/fixtures/base.ts` exists and contains `HELPER SLOT` comment markers (produced by `onboarding`'s Phase 1 scaffold).

Missing any of these → stop the protocol, return an error pointing the caller at the missing prerequisite. Do not synthesize the missing artifact.

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

**Rule:** if `app-context.md`'s Test Infrastructure has a non-empty `Reset / seed endpoints` entry, every mutating spec MUST have `test.beforeEach(resetState)` (or an equivalent `test.beforeAll` for serial-mode describes — see §6).

**Auto-fix:**

1. If `tests/fixtures/base.ts`'s `resetState` HELPER SLOT is empty, populate it from the discovered reset endpoint:

   ```typescript
   import { request } from '@playwright/test';

   export async function resetState() {
     const ctx = await request.newContext({ baseURL: process.env.BASE_URL ?? 'http://localhost:7547' });
     const res = await ctx.post('/api/reset');  // ← path comes from app-context Test Infrastructure
     if (!res.ok()) throw new Error(`resetState failed: ${res.status()} ${await res.text()}`);
     await ctx.dispose();
   }
   ```

   Replace `/api/reset` with the exact path from `app-context.md`. Do not invent paths.

2. Insert into the spec's top-level describe:

   ```typescript
   import { test, expect } from '../fixtures/base';
   import { resetState } from '../fixtures/base';

   test.beforeEach(async () => {
     await resetState();
   });
   ```

**No-reset-discovered branch:** if the Test Infrastructure section's `Reset / seed endpoints` entry reads `none discovered`, mark the spec with a `// stage4a:no-reset-endpoint` top-of-file comment and proceed. Stage 4a's #2 (hardcoded shared resources) becomes the strict gate instead.

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

```typescript
// In tests/fixtures/base.ts (HELPER SLOT: setAuthCookie)
import { request, type Page } from '@playwright/test';

export async function setAuthCookie(page: Page, credentials: { email: string; password: string }) {
  const ctx = await request.newContext({ baseURL: process.env.BASE_URL ?? 'http://localhost:7547' });
  const res = await ctx.post('/api/auth/login', { data: credentials });  // ← path from Test Infrastructure
  if (!res.ok()) throw new Error(`setAuthCookie login failed: ${res.status()}`);
  const setCookie = res.headers()['set-cookie'] ?? '';
  // Extract the auth cookie name from Test Infrastructure's `Auth model` section.
  const match = setCookie.match(/(bookhive_token)=([^;]+)/);  // ← cookie name from Test Infrastructure
  if (!match) throw new Error('setAuthCookie: cookie not found in response');
  await page.context().addCookies([{
    name: match[1], value: match[2],
    url: process.env.BASE_URL ?? 'http://localhost:7547',
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
    const res = await authedCtx.post('/api/cart/items', { data: item });  // ← path from Test Infrastructure
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

1. Populate `tests/fixtures/base.ts`'s `dismissBanners` slot from the selectors captured in app-context Test Infrastructure's `Persistent banners / modals` section:

   ```typescript
   // In tests/fixtures/base.ts (HELPER SLOT: dismissBanners)
   import type { Page } from '@playwright/test';

   export async function dismissBanners(page: Page) {
     // Each entry comes from app-context Test Infrastructure 'Persistent banners / modals'.
     for (const sel of [
       '[data-testid="cookie-accept"]',  // ← cookie-accept selector from Test Infrastructure
       '[data-testid="welcome-close"]',  // ← welcome-modal close from Test Infrastructure
     ]) {
       const el = page.locator(sel).first();
       if (await el.isVisible({ timeout: 250 }).catch(() => false)) {
         await el.click().catch(() => { /* ignore — banner already dismissed */ });
       }
     }
   }
   ```

2. Wire into the fixture's `beforeEach`:

   ```typescript
   // In tests/fixtures/base.ts
   const test = baseFixture(base, 'tests/data/page-repository.json', { timeout: 60000 });

   test.beforeEach(async ({ page }) => {
     await dismissBanners(page);
   });
   ```

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
2. Parse `.stage4a-suite.json`:
   - `timedOut + failed + interrupted > 0` → refuse to advance.
   - `skipped` count > count of `test.skip(` markers found via `grep -c '^\s*test\.skip\b' tests/e2e/**/*.spec.ts` → refuse to advance (this catches cascade-skips from §6 violations).
3. On refusal, return `{ status: 'whole-suite-gate-failed', failures: [...], skips: [...] }` to the caller. The caller is responsible for deciding whether to halt the whole pipeline or continue with reduced scope.
4. Delete `.stage4a-suite.json` after parsing — it does not get committed.

**Why this exists:** per-pass `stabilize` confirms the just-written tests pass but does not guarantee the suite as a whole still passes after accumulated state. The NEW arm of the 2026-04-29 onboarding A/B run shipped 79/109 passing because integration-time pollution surfaced only at end-of-pipeline. The whole-suite gate catches this.

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
