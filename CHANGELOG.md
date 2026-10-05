# Changelog

## Unreleased

### Added

- `steps.forPage(page)` — returns a `Steps` bound to another `Page` of the same
  test (a popup, a new tab, a second window), so a test never constructs an
  `ElementRepository` itself to drive one. Repository names resolve on the bound
  page exactly as they do on the main page. Everything except the page is
  shared: the repository data and its live resolution timeout (a later
  `repo.setDefaultTimeout` is seen), the step timeout, `interceptionRetry`, the
  API and SQL client registries (one connection pool, closed once by the owning
  fixture), the email client, and the `tester:*` debug logging. The original
  `Steps` stays bound to its own page — nothing is switched. Pairs with
  `switchToNewTab`:
  `const popupSteps = steps.forPage(await steps.switchToNewTab(() => steps.click('walletButton', 'CheckoutPage')))`.
  Throws if the given page is already closed (a self-closing popup, rather than
  a target-closed error blamed on the next element), and if the repository
  cannot be rebound onto it.

### Changed

- `steps.switchToNewTab(action)` accepts a value-returning `action`
  (`() => Promise<unknown>`). The documented form passes `steps.click(...)`,
  which resolves `boolean | void` and so did not satisfy the previous
  `() => Promise<void>` under `tsc --strict`. Same treatment `waitForUrl`
  already had; callers passing a `void` action are unaffected. Also on
  `Navigation.switchToNewTab`.

## 0.3.9 — 2026-08-12

### Fixed

- **A timed-out click is never re-dispatched.** The 5s-capped first click
  attempt used to be blind-retried with the full timeout after any
  non-interception error — including a timeout raised *after* the click's input
  had already been dispatched, which delivered a second physical click. Failed
  attempts are now classified: interception → unchanged `dispatchEvent('click')`
  fallback; timeout after input dispatch → accepted as delivered (`log.warn` +
  a `deadline-click` annotation), never clicked again; timeout still waiting for
  actionability → continues on the *remaining* budget, so total elapsed stays
  within the caller's `timeout`; anything else → rethrown. Timeout detection is
  class-based (`errors.TimeoutError`), not message-substring sniffing.

## 0.3.8 — 2026-07-28

### Added

- `steps.navigateTo(url, options?)` now **returns the navigation `Response`**
  (`Promise<Response | null>`) — the last redirect's response, or `null` when no
  network request was triggered (same-document hash nav). Consumers asserting
  `res.status()` on 404 / redirect contracts no longer need raw `page.goto`.
  Backward compatible — callers that ignore the return value are unaffected.
  Also surfaced on `Navigation.toUrl`.
- `steps.waitForLoadState(state, options?)` — a standalone page-lifecycle wait
  for use **after an action** that does not navigate. Accepts the new exported
  `LoadState` type (`'load' | 'domcontentloaded' | 'networkidle'`) and an
  optional `{ timeout }`. Complements `waitForNetworkIdle` (which is fixed to
  `'networkidle'`). Also surfaced on `Navigation.waitForLoadState`.
- `steps.getLocalStorageKeys()` / `steps.getSessionStorageKeys()` — return every
  key currently set in `window.localStorage` / `window.sessionStorage` as a
  `string[]`. The enumerating companions to `getLocalStorage` / `getSessionStorage`,
  completing the storage surface (get/set/remove/clear already existed). Also on
  `Extractions`.
- `steps.getPageText()` — returns the rendered page text (`document.body.innerText`),
  the text companion to `getPageHtml`, for page-level text assertions (e.g. a 404
  body) without dropping to `page.locator('body').innerText()`. Also on `Extractions`.
- `steps.on(el, page).visible()` — a new strategy selector on the fluent
  `ElementAction` builder that resolves to the visible match among duplicates
  (via `repo.getVisible(..., true)`), then composes with terminal actions /
  verifications exactly like `.first()`. Throws if no visible match exists.
  Distinct from `.ifVisible()` / `.isVisible()` (which conditionally skip when
  hidden) — `.visible()` selects the visible one and proceeds. Disambiguates
  responsive duplicate elements.
- **Page-level verification family** — document-scoped mirrors of the element
  verification surface, so page-wide copy / title checks no longer drop to
  raw Playwright `page.*`:
  - `steps.verifyPageContainsText(text: string | RegExp, options?)` — web-first
    assert the document body contains `text`. Mirrored on
    `Verifications.pageContainsText`.
  - `steps.verifyPageNotContainsText(text: string | RegExp, options?)` — negated
    companion; "not a 404" / no-error-copy body checks. Text-level — raw markup
    never appears in rendered text, so for markup-level assertions use
    `verifyPageHtmlContains(html, { negated: true })` instead.
    Mirrored on `Verifications.pageNotContainsText`.
  - `steps.verifyPageTitle(title: string | RegExp, options?)` — wraps
    `expect(page).toHaveTitle`. Mirrored on `Verifications.pageTitle`.
  All three accept `{ timeout?, errorMessage? }`.
- **Scoped child queries on the fluent builder** — query "X within a named
  element" without exposing the parent `Locator`. Each resolves the parent
  (`steps.on(name, page)`) and returns a scoped `ElementAction` that composes
  with every existing terminal (`.count`, `.verifyState`, `.click`, `.getText`,
  `.first()` / `.nth()`, the matcher tree, …):
  - `steps.on(el, page).findByRole(role, options?: { name?, exact? })` — scopes
    `parent.getByRole(role, options)`.
  - `steps.on(el, page).findByText(text: string | RegExp, options?: { exact? })`
    — scopes `parent.getByText(text, options)`.
  - `steps.on(el, page).findBySelector(css: string)` — scopes
    `parent.locator(css)`.
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
    failOnStatusCode?, timeout? }` (default `failOnStatusCode: false` so status assertions work
    on 4xx/5xx). Return a typed `BrowserResponse` (`{ status, ok, url, headers,
    statusText, json<T>(), text(), body() }`).
  - `steps.verifyRequestStatus(res, code)`, `steps.verifyRequestHeader(res, name,
    value?)` (case-insensitive name; presence when value omitted), and
    `steps.verifyRequestOk(res)` (2xx) — simple throw helpers.
  - New `BrowserRequest` class wired through `ElementInteractions.request`; new
    exported types `BrowserResponse` and `BrowserRequestOptions`.
- Timing family (complementary-steps RFC, phase 3) — deliberate, intent-revealing
  timing control without dropping to raw `page.waitForTimeout` / hand-rolled loops:
  - `steps.pace(ms)` — a deliberate pause, named `pace` (NOT `wait`) to signal
    intentional timing rather than a missing wait-for-state; prefer `waitForState`
    / `waitForUrl` / web-first assertions whenever you are actually waiting for a
    condition. Throws on a negative/non-finite duration. Mirrored on `Utils.pace`.
  - `steps.repeat(action, times, { intervalMs? })` — runs `action` `times` times in
    sequence (passing the zero-based index), collects each result, and with
    `intervalMs` paces BETWEEN iterations (never before the first or after the
    last). The intent-revealing form of "do X rapidly N times". Throws when
    `times` is not a non-negative integer. Mirrored on `Utils.repeat`.
- Dispatch / keys / geometry (complementary-steps RFC, phase 3):
  - `steps.dispatchEvent(element, page, type, eventInit?)` — dispatches a synthetic
    DOM event on a named element WITHOUT actionability checks (custom events,
    firing `input`/`change` on widgets that swallow synthetic typing); prefer
    `click`/`fill`/`pressKey` for real user input. Mirrored on `Interactions.dispatchEvent`.
  - `steps.pressKeys(keys)` — presses a multi-key chord, joining the parts with `+`
    (`['Control', 'A']` → `Control+A`); the intent-revealing companion to
    `pressKey` for shortcuts. Throws on an empty array. Mirrored on `Interactions.pressKeys`.
  - `steps.getBoundingBox(element, page)` — returns the element's
    `{ x, y, width, height }` (CSS pixels, main-frame relative) or `null` when it
    is not rendered (short-circuits on zero matches rather than blocking on
    `boundingBox()`'s own auto-wait). Mirrored on `Extractions.getBoundingBox`.

### Security

- Clear the high-severity `npm audit` findings published since 0.3.7: in-range
  lockfile bump for `linkify-it` (GHSA-v245-v573-v5vm, via `mailparser`), and a
  scoped override lifting `@civitas-cerebrum/test-coverage`'s `glob` to `^13`,
  clearing `brace-expansion` GHSA-mh99-v99m-4gvg (which has no in-range fix —
  every `brace-expansion` ≤ 5.0.7 is affected).

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
