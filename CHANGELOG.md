# Changelog

## Unreleased

### Added

- Window/script family (complementary-steps RFC, phase 2) — controlled access to
  window-level JS state without dropping to raw `page.evaluate`:
  - `steps.getWindowProperty<T>(path)` — read a `window` value by dotted path
    (e.g. `'__XSS_FIRED'`, `'dataLayer.length'`, `'document.title'`); returns
    `undefined` for a missing path. Mirrored on `Extractions.getWindowProperty`.
  - `steps.setWindowProperty(path, value)` — set a `window` value by dotted path,
    creating intermediate objects as needed. Mirrored on `Extractions.setWindowProperty`.
  - `steps.verifyWindowProperty(path, options)` — retrying (`expect.poll`)
    assertion; pick one matcher: `equals` | `contains` | `matches` (RegExp) |
    `present` | `truthy` | `greaterThan` | `lessThan`, with
    `{ negated?, timeout?, errorMessage? }` modifiers. New exported type
    `WindowVerifyOptions`. Backed by `Verifications.windowProperty`.
  - `steps.evaluateScript<T>(fn, arg?)` — the single labelled escape hatch over
    `page.evaluate`, typed and logged; prefer the targeted steps. Mirrored on
    `Extractions.evaluateScript`.
- Session-aware HTTP request family (complementary-steps RFC, phase 2) — backed by
  Playwright's `page.request` (`APIRequestContext`), which shares the browser
  context's cookies/session (distinct from the wasapi `api*` external-service client):
  - `steps.requestGet/Post/Put/Patch/Delete/Head(url, opts?)` — thin wrappers over
    `page.request.<verb>`. `opts: { maxRedirects?, headers?, params?, data?, form?,
    failOnStatusCode? }` (default `failOnStatusCode: false` so status assertions work
    on 4xx/5xx). Return a typed `BrowserResponse` (`{ status, ok, url, headers,
    statusText, json<T>(), text(), body() }`).
  - `steps.verifyRequestStatus(res, code)`, `steps.verifyRequestHeader(res, name,
    value?)` (case-insensitive name; presence when value omitted), and
    `steps.verifyRequestOk(res)` (2xx) — simple throw helpers.
  - New `BrowserRequest` class wired through `ElementInteractions.request`; new
    exported types `BrowserResponse` and `BrowserRequestOptions`.

## 0.3.7 — 2026-06-12

### Security

- Bump the `nodemailer` override `^8.0.11` → `^9.0.1`. The earlier pin fell inside
  the GHSA-p6gq-j5cr-w38f advisory range (`nodemailer <= 9.0.0` — message-level
  `raw` option bypasses `disableFileAccess`/`disableUrlAccess`, enabling file read
  / SSRF); `9.0.1` is the patched release. Clears `npm audit --audit-level=high`.

### Breaking

- `steps.waitForState` / `Utils.waitForState` now **throw on timeout** instead of
  logging a warning and continuing. Both return `Promise<boolean>` (`true` = state
  reached; `false` only in optional mode).
  **Migration:** intentional probes ("is the banner there?") add `{ optional: true }`
  to keep the soft behavior — the call then resolves `false` instead of rejecting:
  ```ts
  await steps.waitForState('confirmationModal', 'CheckoutPage', 'visible');                       // throws on timeout
  const open = await steps.waitForState('promoBanner', 'HomePage', 'visible', { optional: true }); // probe
  ```
  Internal pre-action waits (`click`, `fill`, `hover`, drag, extraction attached-waits,
  `getListedElement`, `waitAndClick`) now fail earlier with an element-qualified
  `did not reach state '<state>'` error instead of falling through to the primitive's
  opaque timeout. `waitAndClick` deliberately does not forward `optional`.

### Added

- `steps.navigateTo(url, { waitUntil })` — the navigation now accepts a
  `waitUntil` lifecycle state (`'load'` default, `'domcontentloaded'`,
  `'networkidle'`, `'commit'`), threaded into `page.goto`. Pass
  `'domcontentloaded'` for SPA navigations that stall a cold WebKit/Safari on the
  full `load` event (the WebKit-hang root cause). Default behaviour is unchanged.
  New exported type `WaitUntilState`. Mirrored on `Navigation.toUrl(url, waitUntil?)`.
- `steps.getUrl()` / `steps.getCurrentPath()` — synchronous getters for the live
  page URL (full href) and its `pathname`. The value-returning companions to
  `verifyUrlContains`. Mirrored on `Navigation.getUrl()` / `getCurrentPath()`.
- `steps.waitForUrl(url, action?, options?)` — waits until the page URL matches a
  glob string, RegExp, or `(url: URL) => boolean` predicate. When `action` is
  given, the wait is armed concurrently with the action (`Promise.all`) so a fast
  client-side route change cannot complete in the act→wait gap — the race-safe
  form for rapid navigations. `options` is `{ timeout?, waitUntil? }`. Mirrored on
  `Navigation.waitForUrl`.
- `steps.setLocalStorage(key, value)` / `steps.setSessionStorage(key, value)` —
  the mutating companions to `getLocalStorage` / `getSessionStorage`. Seed
  persisted state a test depends on, or drive resilience checks with deliberately
  malformed values (e.g. corrupt JSON). Matches the native `setItem` contract.
  Mirrored on `Extractions.setLocalStorage` / `setSessionStorage`.
- `steps.removeLocalStorage(key)` / `steps.removeSessionStorage(key)` and
  `steps.clearLocalStorage()` / `steps.clearSessionStorage()` — complete the
  storage surface: drop a single key (no-op when absent) or empty a store.
  Match the native `removeItem` / `clear` contracts. Mirrored on `Extractions`.
- `steps.waitForNetworkIdle({ timeout, optional })` — the idle wait now accepts a
  per-call `timeout` override (previously it relied on Playwright's default
  timeout) and `optional: true`, which resolves quietly on a `TimeoutError`
  instead of throwing (best-effort settling where lingering long-poll/analytics
  traffic should not fail the test; real failures still throw). No-arg behaviour
  is unchanged. New exported type `WaitForNetworkIdleOptions`.
- `StepOptions.timeout` — per-call timeout override on `waitForState` (falls back to
  the instance timeout), and `StepOptions.optional` — the soft-probe switch above.
- `BaseFixtureOptions.interceptionRetry` (default `true`) — set `false` so clicks
  intercepted by an overlaying element **fail** with the original
  `intercepts pointer events` error instead of silently falling back to
  `dispatchEvent('click')`. Recommended for adversarial / bug-discovery suites where
  stuck modals and cookie walls are bugs, not noise. Threaded
  `BaseFixture` → `Steps` / `ElementInteractions` → `Interactions`, like `timeout`.
- When the interception fallback does fire, it is now report-visible: a Playwright
  test annotation `{ type: 'interception-fallback', description }` naming
  `PageName.elementName` is pushed (visible in HTML reports), plus a `warn` log with
  the first line of the original error. The element identity travels via the new
  `ClickOptions.subject` string, set by every click entry point that knows the names.
- `typecheck:tests` script (`tsc -p tsconfig.tests.json`) — the test suite is now
  typechecked and runs as part of `test:unit`; raw-`Locator` drift in specs is a
  compile error.
- `check:publishable` script — fails on any `file:`/`link:` dependency; wired into
  `prepublishOnly` so an unpublishable state can never reach `npm publish` again.

### Fixed

- `@civitas-cerebrum/sql-client` is resolved from the npm registry (`^0.1.0`); the
  previous `file:../sql-client` dependency made the package unpublishable.
- Honest docs for `force` / `withoutScrolling` (`ClickOptions` / `StepOptions` JSDoc,
  README, API reference): both dispatch a DOM `'click'` event directly — no pointer
  simulation, no actionability checks. NOT Playwright's `force: true`; rename pending
  in a future major.
- README truth pass:
  - "Advanced: Raw Interactions API" rewritten to the `WebElement`-only reality
    (raw `Locator`s were dropped in 0.2.6; `new WebElement(locator)` is the documented
    bridging seam) and now lists the sanctioned escape hatches
    (`(element as WebElement).locator`, the `page` fixture).
  - `getText` contract corrected: returns `null` when the element has no text content.
  - `verifyCount` documents the `greaterThanOrEqual` / `lessThanOrEqual` variants and
    range combinations.
  - Matcher list includes `html` and `outerHtml`.
  - `waitForState` documented with both modes (throwing default + `optional` probe).
  - Coverage claim relabeled: the CI gate is **API (method-invocation) coverage**,
    not line/branch coverage.
