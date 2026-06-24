# RFC: Complementary Steps API — eliminating the raw-`page.*` residual

**Status:** proposed · **Author:** consumer-driven (Mr Marvis e2e residual audit)

## Motivation

A residual audit of a real consumer suite found that, after the navigation/URL/storage
gaps were closed, the remaining raw Playwright `page.*` calls fall into a handful of
recurring shapes: page-structural probes, scoped structural counts, deliberate timing,
window-level state reads, and session-aware HTTP requests. These are not exotic — they
recur across adversarial and contract tests. Today consumers drop to raw `page.*` for
them, which scatters selectors, loses auto-retry, and bypasses the logging/annotation
surface.

This RFC designs a **complementary** Steps surface for these cases: controlled, named,
typed, retrying, and logged — so reaching into the raw `Page` is never required, **without**
turning Steps into a generic back-door.

## Design principles

1. **Named over arbitrary.** Resolve against `page-repository.json` first; where a raw
   selector is unavoidable, take it as an explicit, documented argument — never expose the `Page`.
2. **Typed returns + retrying assertions.** Getters return typed values; `verify*` use the
   web-first retry semantics of the existing matcher tree.
3. **Semantic intent over mechanism.** Express "do this rapidly N times", not "sleep 120ms".
4. **One labelled escape hatch.** Exactly one low-level `evaluateScript` remains, named to
   discourage casual use, so the targeted steps stay the obvious path.

## Surface (phased)

### Phase 1 — page-level family + scoped child queries (this PR)

Page-level verification mirrors the element surface at document scope:

```ts
await steps.getPageText();                                  // (shipped) document.body.innerText
await steps.getPageHtml({ outer });                         // (exists)
await steps.verifyPageContainsText('Wishlist');             // body text contains (substring | RegExp)
await steps.verifyPageContainsText(/404|niet gevonden/i);
await steps.verifyPageNotContainsText('<script>alert');     // absence — XSS / "not a 404" checks
await steps.verifyPageTitle(/Wishlist/i);                   // wraps expect(page).toHaveTitle
await steps.getHtml('name', 'Page', { outer });             // element-level HTML
```

Scoped child queries on the fluent builder — "X within a named element" without exposing
a parent `Locator`. Resolves the parent via the repo, then queries within it:

```ts
await steps.on('cookieDialog', 'CookieBanner').findByRole('button').count.toBe(2);
await steps.on('cookieDialog', 'CookieBanner').findByRole('button', { name: /voorkeuren|manage/i }).count.toBe(0);
await steps.on('cartDrawer', 'CartDrawer').findByText('Je winkelwagen is leeg').verifyState('visible');
await steps.on('panel', 'Page').findBySelector("input[name='email']").fill('a@b.com');
```

`findByRole / findByText / findBySelector` return a scoped `ElementAction` that composes
with every existing terminal (`.count`, `.verifyState`, `.click`, `.getText`, `.first()`, …).
This closes scoped `getByRole` counts and `page.locator(parent).getByText/.locator(child)`
compositions.

### Phase 2 — window/script + session HTTP

Controlled window-state family (the targeted 90%) + one labelled escape:

```ts
const fired = await steps.getWindowProperty<boolean>('__XSS_FIRED');   // read by dotted path
await steps.verifyWindowProperty('dataLayer.length', { greaterThan: 0 });
await steps.setWindowProperty('__test.flag', true);
const n = await steps.evaluateScript<number>(() => document.querySelectorAll('img').length);  // the one escape
```

Session-aware HTTP, backed by Playwright's `page.request` (shares the browser context's
cookies — distinct from the wasapi `apiGet` external-service client):

```ts
const res = await steps.requestGet('/account', { maxRedirects: 0 });   // uses the logged-in session
await steps.verifyRequestStatus(res, 307);
await steps.verifyRequestHeader(res, 'location', /\/login/);
// requestGet/Post/Put/Patch/Delete/Head; opts { maxRedirects, headers, params, data, failOnStatusCode };
// response { status, headers, json(), text() } + verifyRequest{Status,Header,Json}
```

### Phase 3 — timing + dispatch/keys/style misc

```ts
await steps.repeat((i) => steps.on('swatch', 'PDP').nth(i).click({ force: true }), 3, { intervalMs: 120 });
await steps.pace(120);                          // deliberate timing control (NOT a wait-for-state)
await steps.dispatchEvent('name', 'Page', 'click');
await steps.pressKeys(['Control', 'A']);
await steps.getBoundingBox('name', 'Page');
```

## Naming rationale

- `verifyPage*` mirrors `verify*` (element) — same mental model, document scope.
- `findBy*` (scoped) parallels Playwright's `getBy*` but is explicitly a **within-parent**
  sub-query — distinguished from top-level repo resolution.
- `pace(ms)` is intentionally **not** `wait(ms)` — naming signals deliberate timing, not a
  missing wait-for-state. `repeat(fn, n, { intervalMs })` is the preferred, intent-revealing form.
- `getWindowProperty` / `evaluateScript` — the first is targeted and safe; the second is the
  single, clearly-named, typed, logged escape so raw `page.evaluate` is never needed.
- `request*` is session-aware (browser cookies); `api*` (wasapi) stays the external-service path.

## Compatibility

All additions are additive. No existing signature changes. `findBy*` and `verifyPage*` are
new methods; the window/HTTP/timing families are new namespaced methods.

## Rollout

- **PR 1 (this):** page-level family + scoped `findBy*`.
- **PR 2:** window/script + `request*`.
- **PR 3:** timing + dispatch/keys/style.

Each phase is independently shippable and closes a distinct slice of the residual.
