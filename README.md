# Element Interactions

[![NPM Version](https://img.shields.io/npm/v/@civitas-cerebrum/element-interactions?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/@civitas-cerebrum/element-interactions)

A robust, readable interaction-and-assertion facade for test automation: web apps through Playwright, and native Android and iOS apps through Appium and WebdriverIO, with one `Steps` API for both ([Platform testing](#-platform-testing-android-ios)). The `Steps` API and `ElementRepository` decouple element acquisition from interaction, so raw selectors never appear in test code — and tests stay tight, semantic, and resistant to DOM churn.

This package is the **framework** layer: a programmatic test facade (Playwright on the web, Appium on devices) for humans + LLM agents to write against. If you want the **methodology** layer — agent skills, harness hooks, return-shape schemas, and the postinstall plumbing that drives Claude Code through an end-to-end autonomous QA pipeline — install [`@civitas-cerebrum/achilles`](https://www.npmjs.com/package/@civitas-cerebrum/achilles) alongside this package. Achilles depends on element-interactions and orchestrates it through eight documented phases.

---

## 🏗️ The Test-Authoring Framework

A `page-repository.json` file is the single source of truth for selectors. Tests reference elements by plain strings (`'CheckoutPage'`, `'submitButton'`); the framework handles resolution, waiting, logging, and overlay-retry on every interaction.

**Before (Raw Playwright):**

```ts
// Hardcode or manage raw locators inside your test
const submitBtn = page.locator('button[data-test="submit-order"]');

// Explicitly wait for DOM stability and visibility
await submitBtn.waitFor({ state: 'visible', timeout: 30000 });

// Log what's happening so failures are debuggable
console.log('Clicking on "submitButton" in "CheckoutPage"');

// Perform the interaction — and hand-roll a fallback for overlays
// that intercept pointer events (cookie banners, sticky headers, etc.)
try {
  await submitBtn.click({ timeout: 5000 });
} catch (error) {
  if (error instanceof Error && error.message.includes('intercepts pointer events')) {
    await submitBtn.dispatchEvent('click');
  } else {
    throw error;
  }
}
```

**After (@civitas-cerebrum/element-interactions):**

```ts
// Resolve from the page repository, log the action, wait, click,
// and auto-retry past pointer interception — one line.
await steps.click('submitButton', 'CheckoutPage');
```

---

## 📦 Installation

```bash
npm i @civitas-cerebrum/element-interactions
```

**Peer dependencies:** `@playwright/test` is required. `webdriverio@^10` is an optional peer, needed only for platform (Android, iOS) runs: see [Platform testing](#-platform-testing-android-ios).

If you don't have a Playwright project yet:

```bash
npm init playwright@latest playwright-project
cd playwright-project
npm i @civitas-cerebrum/element-interactions
```

> **Tip:** Set `reporter: 'html'` in `playwright.config.ts` so failure screenshots are captured and viewable in the HTML report — `baseFixture` attaches them there, and the [`@civitas-cerebrum/achilles`](https://www.npmjs.com/package/@civitas-cerebrum/achilles) failure-diagnosis skill reads from the same report when you run that package.

---

## ✨ Features

* **Zero locator boilerplate** — The `Steps` API fetches elements and interacts with them in a single call.
* **Automatic failure screenshots** — `baseFixture` captures a full-page screenshot on every failed test and attaches it to the HTML report.
* **Standardized waiting** — Built-in methods wait for elements to reach specific DOM states (visible, hidden, attached, detached).
* **Advanced image verification** — `verifyImages` evaluates actual browser decoding and `naturalWidth`, not just DOM presence.
* **Visual regression with dynamic-data masking** — `verifyVisualMatch` is a thin facade over Playwright's `toHaveScreenshot` with masks referenced by `{ elementName, pageName }`. Cover clocks / generated ids / live counters / "updated N minutes ago" badges so the pixel diff stays stable across runs without dropping into raw Playwright locators.
* **Smart dropdowns** — Select by value, index, or randomly, with automatic skipping of disabled and empty options.
* **Flexible assertions** — Verify exact text, non-empty text, URL substrings, or dynamic element counts (greater than, less than, exact).
* **Smart interactions** — Drag to other elements, type sequentially, wait for specific element state, verify images and more!
* **Force click with auto-retry** — Clicks automatically retry with a native DOM event when pointer interception is detected, and a click that times out *after* its input was dispatched is never clicked again — so toggles and overlay-openers can't double-fire on slow environments. No configuration needed.
* **Unified visibility API** — `isVisible()` is a dual-behavior chain. `await steps.isVisible('banner', 'Page')` resolves to a boolean (probe, never throws). `steps.isVisible('banner', 'Page').click()` silently skips the action when hidden (gate). Both forms accept `{ timeout, containsText }`. Replaces `ifVisible()` and the old boolean `isVisible()` probe.
* **Chain-style expect matchers** — `steps.expect('price', 'Page').text.toMatch(/^\$/).count.toBe(1).attributes.get('data-status').toBe('ready')` chains as many verifications as you need on a single element; awaiting flushes the queue and short-circuits on the first failure. `.not` is one-shot, `.throws('msg')` overrides messages, `.timeout(ms)` scopes wait time per call.
* **Predicate escape hatch** — `steps.expect('price', 'Page').satisfy(el => parseFloat(el.text.slice(1)) > 10).throws('price must be above $10')` for assertions the matcher tree doesn't cover. Predicates run against a snapshot of plain element data — no async access required inside the lambda.
* **Role + accessible name selectors** — `{ "role": "button", "name": "Log in" }` resolves via `page.getByRole()` with regex support.
* **Regex text selectors** — `{ "text": { "regex": "pattern", "flags": "i" } }` for matching dynamic content.
* **Iframe-scoped pages** — Elements inside iframes are resolved transparently via `frame` property on page definitions.
* **Platform testing (Android, iOS)** — One `E2E_PLATFORM` switch runs the same `Steps` API on native apps through Appium and WebdriverIO, with per-platform page blocks in one page repository. Steps that a platform cannot honour throw `PlatformNotSupportedError`. See [Platform testing](#-platform-testing-android-ios) for what is supported and what is verified on devices.

---

## 🗂️ Defining Locators

All selectors live in a page repository JSON file — the single source of truth for element locations. No raw selectors should appear in test code.

```json
{
  "pages": [
    {
      "name": "HomePage",
      "elements": [
        {
          "elementName": "submitButton",
          "selector": {
            "css": "button[data-test='submit']"
          }
        }
      ]
    }
  ]
}
```

Each selector object supports `css`, `xpath`, `id`, or `text` as the locator strategy.

**Enhanced selectors** — the following advanced selector types are also supported:

```json
{ "role": "button", "name": "Log in" }
{ "role": "button", "name": { "regex": "Log in|Sign in", "flags": "i" } }
{ "text": { "regex": "Total.*\\$\\d+", "flags": "i" } }
```

**Iframe-scoped pages** — add a `frame` property to scope elements inside an iframe:

```json
{
  "name": "PaymentIframe",
  "frame": { "css": "iframe[title*='card number' i]" },
  "elements": [{ "elementName": "cardInput", "selector": { "css": "#card" } }]
}
```

Supports `frameIndex` (`"first"`, `"last"`, or zero-based number) and nested frames (array of frame selectors).
On platform (Android, iOS) pages, element-repository translates the enhanced `role` + `name` selector into a UiSelector on Android and a predicate string on iOS; see [Platform testing](#-platform-testing-android-ios).

**Naming conventions:**
- `name` — PascalCase page identifier, e.g. `CheckoutPage`, `ProductDetailsPage`
- `elementName` — camelCase element identifier, e.g. `submitButton`, `galleryImages`

---

## 💻 Usage: The `Steps` API (Recommended)

Initialize `Steps` by passing your `ElementRepository` instance (which already holds the driver/page):

```ts
import { test } from '@playwright/test';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { Steps, DropdownSelectType } from '@civitas-cerebrum/element-interactions';

test('Add random product and verify image gallery', async ({ page }) => {
  const repo = new ElementRepository(page, 'tests/data/locators.json');
  const steps = new Steps(repo);

  await steps.navigateTo('/');
  await steps.click('category-accessories', 'HomePage');

  // Use StepOptions to control element selection and interaction modifiers
  await steps.click('product-cards', 'AccessoriesPage', { strategy: 'random' });
  await steps.verifyUrlContains('/product/');

  const selectedSize = await steps.selectDropdown('size-selector', 'ProductDetailsPage', {
    type: DropdownSelectType.RANDOM,
  });

  await steps.verifyCount('gallery-images', 'ProductDetailsPage', { greaterThan: 0 });
  await steps.verifyText('product-title', 'ProductDetailsPage');  // no args = asserts not empty
  await steps.verifyImages('gallery-images', 'ProductDetailsPage');
});
```

### Fluent API: `steps.on()`

For a chainable alternative, use `steps.on(elementName, pageName)`:

```ts
test('Fluent checkout flow', async ({ steps }) => {
  await steps.on('category-accessories', 'HomePage').click();
  await steps.on('product-cards', 'AccessoriesPage').random().click();
  await steps.on('product-title', 'ProductDetailsPage').verifyPresence();
  
  const price = await steps.on('price', 'ProductDetailsPage').getText();
  await steps.on('add-to-cart', 'ProductDetailsPage').click({ withoutScrolling: true });
  await steps.on('cart-count', 'Header').verifyText('1');

  // Gate — skip action if not visible (replaces deprecated ifVisible())
  await steps.on('promoBanner', 'ProductDetailsPage').isVisible().click();

  // Probe — returns boolean, never throws
  const hasDiscount = await steps.on('discountBadge', 'ProductDetailsPage').isVisible();

  // Gate with text filter — only click when the banner shows "50% off"
  await steps.isVisible('promo', 'ProductDetailsPage', { containsText: '50% off' }).click();

  // Strategy selector: pick the VISIBLE duplicate among responsive copies, then
  // compose terminals like .first() does. Throws if none visible (unlike the
  // skip-if-hidden .ifVisible()/.isVisible() gates). Resolves via repo.getVisible().
  await steps.on('navMenu', 'HomePage').visible().click();
  await steps.on('cta', 'HomePage').visible().verifyState('visible');
});
```

> **`.visible()` vs `.visible` vs `.isVisible()`.** `steps.on(el, page).visible()` (a **call**) is the *visible-selection strategy*: among duplicate matches it resolves the visible one via `repo.getVisible(...)` and **throws if none is visible** — use it to disambiguate responsive desktop/mobile duplicate elements. `steps.on(el, page).visible` (no call) is the *matcher-tree boolean field* (`.visible.toBeTrue()`). Both coexist on the same chain. Distinct again from `.ifVisible()` / `.isVisible()`, which *conditionally skip* when the element is hidden rather than selecting and proceeding.
> **Collection terminals.** `getCount()`, `getAllTexts()`, `verifyOrder(...)`, `verifyListOrder(...)`, `verifyImages()` and the `.count` matchers read the entry's whole collection, whatever strategy selector (`.first()`, `.nth(i)`, `.byText(...)`, ...) the chain carries: `await steps.on('rows', 'TablePage').getCount()` equals `await steps.getCount('rows', 'TablePage')`.

#### Scoped child queries: `findByRole` / `findByText` / `findBySelector`

Query "X within a named element" without ever exposing the parent `Locator` to your test. Each resolves the parent (`steps.on(name, page)`) and returns a **scoped `ElementAction`** querying inside it — composing with every existing terminal (`.count`, `.verifyState`, `.click`, `.getText`, `.first()` / `.nth()`, the matcher tree, …). They mirror Playwright's `getByRole` / `getByText` / `locator`, but as an explicit within-parent sub-query distinguished from top-level repository resolution.

* **`findByRole(role, options?: { name?: string | RegExp; exact?: boolean })`** — scopes `parent.getByRole(role, options)`.
* **`findByText(text: string | RegExp, options?: { exact?: boolean })`** — scopes `parent.getByText(text, options)`.
* **`findBySelector(css: string)`** — scopes `parent.locator(css)`.

```ts
// Count the buttons inside a named dialog — no parent selector in the test.
await steps.on('cookieDialog', 'CookieBanner').findByRole('button').count.toBe(2);
await steps.on('cookieDialog', 'CookieBanner').findByRole('button', { name: /preferences|manage/i }).count.toBe(0);

// Assert text that lives inside a named drawer is visible.
await steps.on('cartPanel', 'CartPage').findByText('Your cart is empty').verifyState('visible');

// Fill an input scoped to a named panel; .first() / .nth() narrowing composes.
await steps.on('panel', 'Page').findBySelector("input[name='email']").fill('a@b.com');
await steps.on('table', 'TablePage').findByRole('row').nth(1).getText();
```

`.first()` / `.nth(i)` narrow the scoped match the same way they narrow a repo-resolved element; count / order terminals see the whole scoped set.

#### Gesture terminals

The element gestures are chain terminals too. Each acts on the element the chain selects (`nth`, `byText`, `random`, ...) with the chain timeout unless its options carry a `timeout`, and returns `Promise<void>`. The option types are element-repository's, re-exported by this package.

* **`.swipe(direction: SwipeDirection, options?: SwipeOptions)`** — Swipes on the element: the finger moves in `direction` (`'up'` reveals content below), `distance` in px. On web a mouse drag.
* **`.scrollIntoView(options?: ScrollStepOptions)`** — Scrolls the element into view; the no-argument form is unchanged. On a device `direction` says where the element lies (default `'down'`), `maxSwipes` caps the sweep (default 20) and `container` names the scrollable ancestor to sweep inside (see [Scroll container](#scroll-container)).
* **`.scrollUntilFound(options?: ScrollStepOptions)`** — Scrolls until the element is displayed; throws when the timeout or the swipe limit is reached first; `container` names the scrollable ancestor (see [Scroll container](#scroll-container)). Not gated by `ifVisible()`. On web the browser scrolls it into view.
* **`.longPress(options?: LongPressOptions)`** — Presses and holds the element, `duration` in ms (default 1000). On web the mouse button is held.
* **`.tapAt(offset: TapOffset, options?: TapAtOptions)`** — Taps the point `offset` px from the element's top-left corner. On web a mouse click at that point.
* **`.pinch(options?: PinchOptions)`** — Two-finger pinch, `scale` in (0, 1), default 0.5. Platform only; throws `PlatformNotSupportedError` on web before the element is resolved.
* **`.zoom(options?: ZoomOptions)`** — Two-finger zoom, `scale` above 1, default 2. Platform only; throws `PlatformNotSupportedError` on web before the element is resolved.

```ts
await steps.on('photo', 'GalleryPage').zoom({ scale: 3 });
await steps.on('rows', 'SettingsPage').byText('Privacy').scrollUntilFound({ direction: 'down' });
```

#### Chain platform and probe

* **`.platform`** — The platform the chain acts on (`'web'`, `'android'`, `'ios'`, ...), read-only.
* **`.probeVisible(timeout: number, containsText?: string): Promise<boolean>`** — Internal plumbing of `isVisible()` / `ifVisible()`, public so the visibility chain can reach it; test code should use `isVisible()` / `ifVisible()` instead.

### Expect Matcher Tree

A chain-style assertion API for the common case where you want to verify multiple things about a single element. Available at both `steps.expect(el, page)` (top-level) and as field getters on `steps.on(el, page)` (fluent). Each matcher call queues an assertion; awaiting flushes the queue and short-circuits on the first failure.

```ts
test('Submit button readiness', async ({ steps }) => {
  // Chain multiple verifications in one expression
  await steps.on('submit-button', 'CheckoutPage')
    .text.toBe('Place Order')
    .visible.toBeTrue()
    .enabled.toBeTrue()
    .attributes.get('data-variant').toBe('primary')
    .not.attributes.toHaveKey('disabled')
    .css('cursor').toMatch(/pointer|default|auto/);
});

test('Top-level matcher tree', async ({ steps }) => {
  await steps.expect('price', 'ProductPage').text.toBe('$19.99');
  await steps.expect('price', 'ProductPage').text.toMatch(/^\$\d+\.\d{2}$/);
  await steps.expect('items', 'ListPage').count.toBeGreaterThan(3);
  await steps.expect('error', 'Page').not.text.toContain('Crash');
});

test('Predicate escape hatch + custom message', async ({ steps }) => {
  await steps.expect('price', 'ProductPage')
    .satisfy(el => parseFloat(el.text.slice(1)) > 10)
    .throws('price must be above $10');
});

test('Per-call timeout override', async ({ steps }) => {
  await steps.on('slow-widget', 'Page').timeout(5000).text.toBe('Ready');
  await steps.on('items', 'Page').count.timeout(500).toBeGreaterThan(0);
});
```

**Field matchers:** `text`, `value`, `count`, `visible`, `enabled`, `attributes`, `css(prop)`, `html`, `outerHtml`. Each carries `.not` for negation. Snapshot fields available in predicates: `text`, `value`, `attributes`, `visible`, `enabled`, `count`. See the [API reference](https://github.com/civitas-cerebrum/achilles/blob/main/skills/element-interactions/references/api-reference.md#expect-matcher-tree) for the full surface.

### StepOptions

All Steps methods accept an optional last parameter for element selection and interaction modifiers:

```ts
// Select by strategy
await steps.click('element', 'Page', { strategy: 'random' });
await steps.click('element', 'Page', { strategy: 'index', index: 2 });
await steps.click('element', 'Page', { strategy: 'text', text: 'Submit' });

// Interaction modifiers
await steps.click('element', 'Page', { withoutScrolling: true });  // dispatches a DOM 'click' event without scrolling into view (alias semantics of force)
await steps.click('element', 'Page', { ifPresent: true });         // skip if not visible
await steps.click('element', 'Page', { force: true });             // dispatches a DOM 'click' event directly — NOT Playwright's force: true
                                                                   // (no pointer simulation, no actionability checks; rename pending in a future major)

// Combine both
await steps.click('element', 'Page', { strategy: 'random', withoutScrolling: true });
```

---

## 🔧 Fixtures: Zero-Setup Tests (Recommended)

For larger projects, manually initializing `repo` and `steps` in every test becomes repetitive. `baseFixture` injects all core dependencies automatically via Playwright's fixture system.

### Included fixtures

| Fixture | Type | Description |
|---|---|---|
| `steps` | `Steps` | The full Steps API, ready to use |
| `repo` | `ElementRepository` | Direct repository access for advanced locator queries |
| `interactions` | `ElementInteractions` | Raw interactions API for custom locators |
| `contextStore` | `ContextStore` | Shared in-memory store for passing data between steps |
| `driver` | `WebdriverIO.Browser` | The device session on a platform run; throws `PlatformNotSupportedError` on web |

`page` is Playwright's on web; on a platform run it throws. See [Fixture values per platform](#fixture-values-per-platform).

`baseFixture` also attaches a full-page `failure-screenshot` to the Playwright HTML report on every failed test. On a platform run it attaches the device screenshot and the screen's page source instead; see [Failure evidence](#failure-evidence).

> **Note:** `reporter: 'html'` must be set in `playwright.config.ts` for screenshots to appear. Run `npx playwright show-report` after a failed run to inspect them.

### 1. Playwright Config

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: 'html',
  use: {
    baseURL: 'https://your-project-url.com',
    headless: true,
  },
});
```

### 2. Create your fixture file

```ts
// tests/fixtures/base.ts
import { test as base, expect } from '@playwright/test';
import { baseFixture } from '@civitas-cerebrum/element-interactions';

export const test = baseFixture(base, 'tests/data/page-repository.json', {
  timeout: 60000,                   // element timeout for Steps/Interactions (default: 30000)
  repoTimeout: 15000,               // element resolution timeout for repo (default: 15000)
  interceptionRetry: true,          // intercepted clicks fall back to a dispatched DOM click event (default: true);
                                    // set false so genuine overlay bugs (stuck modals, cookie walls) fail the
                                    // click — recommended for adversarial/bug-discovery suites
  blockedOrigins: /(analytics\.com|tracking\.io)/,  // auto-abort matching routes
  screenshotOnFailure: true,        // auto-capture on test failure (default: true)
  mutationInjection: true,          // forward an opted-in E2E_MUTATION_INIT / E2E_MUTATION_CSS payload to
                                    // every page and frame of the context, popups included (default: false;
                                    // inert without the E2E_MUTATION_RUN opt-in) — the hook behavioural
                                    // mutation runners such as achilles-mutate need. See "6. Mutation
                                    // injection" below
  // mutationInjection: { strict: true },  // fail the test when the injection cannot be proven to have applied
  // screenshotOnFailure: { fullPage: false },  // viewport-only screenshots
  // screenshotOnFailure: false,                 // disable screenshots
});
export { expect };
```

### 3. Use fixtures in your tests

```ts
// tests/checkout.spec.ts
import { test, expect } from '../fixtures/base';
import { DropdownSelectType } from '@civitas-cerebrum/element-interactions';

test('Complete checkout flow', async ({ steps }) => {
  await steps.navigateTo('/');
  await steps.click('category-accessories', 'HomePage');
  await steps.clickRandom('product-cards', 'AccessoriesPage');
  await steps.verifyUrlContains('/product/');

  const selectedSize = await steps.selectDropdown('size-selector', 'ProductDetailsPage', {
    type: DropdownSelectType.RANDOM,
  });

  await steps.verifyImages('gallery-images', 'ProductDetailsPage');
  await steps.click('add-to-cart-button', 'ProductDetailsPage');
  await steps.waitForState('confirmation-modal', 'CheckoutPage', 'visible');
});
```

### 4. Access `repo` directly when needed

Repository methods return `Element` wrappers (not raw Playwright `Locator` objects). For most use cases, the `Steps` API handles this transparently. When using `repo` directly, the `Element` interface provides common methods like `click()`, `fill()`, `textContent()`, etc. To access the underlying Playwright `Locator` (e.g. for Playwright-specific assertions), cast to `WebElement`:

```ts
import { WebElement } from '@civitas-cerebrum/element-interactions';

test('Navigate to Forms category', async ({ repo, steps }) => {
  await steps.navigateTo('/');

  const formsLink = await repo.getByText('categories', 'HomePage', 'Forms');
  await formsLink?.click();

  await steps.verifyAbsence('categories', 'HomePage');
});

test('Use underlying Locator for advanced assertions', async ({ repo }) => {
  const element = await repo.get('elementName', 'PageName');
  const locator = (element as WebElement).locator;
  await expect(locator).toHaveCSS('color', 'rgb(255, 0, 0)');
});

test('Use fluent action chain', async ({ repo }) => {
  const element = await repo.get('submitButton', 'LoginPage');
  await element.action(5000).waitForState('visible').click();
});
```

**Full Repository API** (note: `(elementName, pageName)` order, no driver arg):

```ts
await repo.get('elementName', 'PageName');                         // single Element (first match)
await repo.get('elementName', 'PageName', { strategy: SelectionStrategy.RANDOM }); // with options
await repo.getAll('elementName', 'PageName');                      // array of Elements
await repo.getRandom('elementName', 'PageName');                   // random from matches
await repo.getByText('elementName', 'PageName', 'Text');           // filter by visible text
await repo.getByAttribute('elementName', 'PageName', 'data-status', 'active'); // filter by attribute
await repo.getByIndex('elementName', 'PageName', 2);               // zero-based index
await repo.getByRole('elementName', 'PageName', 'button');          // filter by role
await repo.getVisible('elementName', 'PageName');                   // first visible match
repo.getSelector('elementName', 'PageName');                        // sync, selector string
repo.getSelectorRaw('elementName', 'PageName');                     // sync, { strategy, value }
repo.driver;                                                        // the bound Page/Browser
```

### 5. Extend with your own fixtures

Because `baseFixture` returns a standard Playwright `test` object, you can layer your own fixtures on top:

```ts
// tests/fixtures/base.ts
import { test as base } from '@playwright/test';
import { baseFixture } from '@civitas-cerebrum/element-interactions';
import { AuthService } from '../services/AuthService';

type MyFixtures = {
  authService: AuthService;
};

const testWithBase = baseFixture(base, 'tests/data/page-repository.json');

export const test = testWithBase.extend<MyFixtures>({
  authService: async ({ page }, use) => {
    await use(new AuthService(page));
  },
});

export { expect } from '@playwright/test';
```

```ts
test('Authenticated flow', async ({ steps, authService }) => {
  await authService.login('user@test.com', 'secret');
  await steps.verifyUrlContains('/dashboard');
});
```

### 6. Mutation injection (for behavioural mutation runners)

A behavioural mutation runner (e.g. `achilles-mutate`) breaks the page on purpose and
then asks whether your suite noticed. `mutationInjection` is the hook it needs, so the
project writes none itself. Three environment variables drive it:

| Variable | Meaning |
|---|---|
| `E2E_MUTATION_RUN` | **The opt-in.** Nothing is injected unless this is `1` / `true` / `yes`. |
| `E2E_MUTATION_INIT` | A JS string, run before the page's own scripts in every page and child frame (`context.addInitScript`). |
| `E2E_MUTATION_CSS` | A CSS string, adopted as a constructable stylesheet from an init script of its own. |

The opt-in exists because the payload variables are ambient: a value left behind by an
earlier mutation run in the same CI job, exported by a shell profile, or committed to a
`.env` (this package calls `dotenv`) would otherwise mutate a perfectly normal run and
the resulting failure would be blamed on your application.

The CSS goes through CSSOM rather than an injected `<style>` element on purpose. A
`Content-Security-Policy: style-src 'self'` header blocks an inline `<style>` — the
element lands, the rules never apply — while leaving CSSOM alone; and running from an
init script puts the rules in place before the document's first script, instead of on
`load`, which never fires while a subresource hangs. An already-open page gets the CSS
applied to its current document immediately; `E2E_MUTATION_INIT` cannot reach a document
that has already run its scripts, so for such a page it lands on the next navigation.

**A mutated run is never silent.** Activation logs a warning and pushes a
`mutation-injection` annotation onto the test; every page load is sampled for proof that
the injection applied; anything unprovable (malformed init JS — caught in Node, not only
inside the page — CSS that parses to no rules, a stylesheet the browser refused, no
document reporting the injection at all) is reported as a `mutation-injection-error`
annotation, and CSS that applied but matched no element as a `mutation-injection-warning`.
With `mutationInjection: { strict: true }` the unprovable cases *fail* the test instead,
so an injection that never applied cannot be scored as a surviving mutant — a coverage
gap that was never real.

The helpers are exported for suites that drive a context themselves:

```ts
import {
  forwardMutationInjection,
  readMutationInjection,
  MUTATION_RUN_VAR,          // 'E2E_MUTATION_RUN'
  type MutationInjection,    // { init?: string; css?: string }
  type MutationInjectionOptions,
  type MutationInjectionHandle,
} from '@civitas-cerebrum/element-interactions';

readMutationInjection();                      // {} unless E2E_MUTATION_RUN is set
readMutationInjection(someEnvObject);          // same, from an explicit env

// Explicit payloads need no opt-in — passing them *is* the opt-in.
const mutation = await forwardMutationInjection(context, { css: '.cart { display: none }' }, { strict: true });
const problems = await mutation.verify();      // [] once the injection is proven applied
```

---

## 📱 Platform testing (Android, iOS)

The same `Steps` API drives native apps on Android and iOS through [Appium](https://appium.io) and [WebdriverIO](https://webdriver.io). One switch chooses the platform; test code, page names and element names stay the same, and only the page repository holds one block per platform.

| Platform | Driver family | Status |
|---|---|---|
| `web` | Playwright | Supported (default, unchanged) |
| `android` | Appium (UiAutomator2) | Supported (see [What is verified](#what-is-verified)) |
| `ios` | Appium (XCUITest) | Supported (see [What is verified](#what-is-verified)) |
| `macos`, `windows` | Appium | Declared, **not implemented**: the session start throws `Platform "<p>" is declared but not implemented yet.` |

### Install

`webdriverio` is an **optional** peer dependency. Web-only projects install nothing new; install it only for platform runs:

```bash
npm i -D webdriverio@^10
```

It is imported on the first session start, never at load time; a platform run without it fails with `webdriverio is not installed: install webdriverio@^10 ...`. WebdriverIO 10 declares Node `>=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1` in its `engines`; use a matching Node version for platform runs.

You also need an Appium server with the UiAutomator2 (Android) and/or XCUITest (iOS) driver, and a device, emulator or simulator it can reach.

**TypeScript and the Appium API.** The package's typings name the driver type `WebdriverIO.Browser`. So that web projects compile without `webdriverio`, an empty global `WebdriverIO.Browser` interface ships with the typings; it merges with WebdriverIO's full one when `webdriverio` is installed. If you use the Appium API in TypeScript (the `driver` fixture, `AppiumFactory`, a custom `SessionProvider`), make WebdriverIO's global types visible: add `import type {} from 'webdriverio';` to one file of the project (for example the fixture file), or `"types": ["webdriverio"]` to `compilerOptions` in `tsconfig.json`. Without `skipLibCheck`, WebdriverIO 10's own declarations also need `puppeteer-core` types to be resolvable.

### The switch: `platform` and `session`

```ts
// tests/platform/fixtures/base.ts
import { test as base } from '@playwright/test';
import { baseFixture } from '@civitas-cerebrum/element-interactions';

export const test = baseFixture(base, 'tests/e2e/page-repository.json', {
  // platform: 'ios',            // default: process.env.E2E_PLATFORM, else 'web'
  session: {                     // used only when the platform is android / ios
    // capabilities: 'tests/capabilities/iphone.json',  // PATH to a JSON file; default: E2E_CAPABILITIES
    // server: 'http://<appium-server>:4723',  // the server's own URL (its base path, if it has one), or an object; default: APPIUM_URL
    reset: 'relaunch',           // 'relaunch' (default) | 'none'
    // relaunchTimeout: 15000,   // ms the relaunched app may take to reach the foreground
    // startTimeout: 600000,     // ms opening the worker's session may take (start + onSessionStarted)
    onSessionStarted: async (driver) => { /* once per worker, after the session opened */ },
  },
});
export { expect } from '@playwright/test';
```

* **`platform`** — `'web' | 'android' | 'ios' | 'macos' | 'windows'`. Read once, when `baseFixture()` is called: the option, else `E2E_PLATFORM`, else `'web'`. Any other value throws, naming where it came from.
* **`session.capabilities`** — always the **path** of a JSON capabilities file (default `E2E_CAPABILITIES`). An inline object is refused. A relative path resolves against the directory Playwright was started in (usually the project root).
* **`session.server`** — the server's own URL as a string, with its base path only if the server has one (a local Appium server usually has none: `http://127.0.0.1:4723`; a server started with `--base-path /wd/hub` needs `https://<appium-server>/wd/hub`), or an object `{ protocol, hostname, port, path, user, key }`. Default: `APPIUM_URL`, else `http://127.0.0.1:4723`. A field the object form leaves out comes from `http://127.0.0.1:4723`, never from `APPIUM_URL`. `user` / `key` left out are filled from `APPIUM_USER` / `APPIUM_KEY` in every form, and are never read from the capabilities file.
* **`session.provider`** — a `SessionProvider` (`start(context)` / `stop(driver)`) that opens and closes the WebdriverIO session. Default: the built-in `AppiumSessionProvider` (WebdriverIO `remote()`). Bring your own for a vendor that needs more than connection options (tunnels, app upload).
* **`session.reset`** — what happens between tests (see [Reset policy](#reset-policy)).
* **`session.relaunchTimeout`** — with `reset: 'relaunch'`, how long (ms) the app under test may take to reach the foreground after it was activated. Default `15000`. A retried iOS activation (see [Reset policy](#reset-policy)) shares this budget with the foreground wait.
* **`session.startTimeout`** — how long (ms) opening the worker's session may take: the provider's start plus `onSessionStarted`. Default `600000` (ten minutes: a cold start on a real device can build and sign WebDriverAgent or install the UiAutomator2 server first). It is the worker fixture's own timeout, so it does not depend on the test timeout. A start that has not answered shortly before it expires (a tenth of it, at most 5 s, is kept back) fails with `session start on <server URL, no credentials> for platform "<platform>": no session within <ms> ms (session.startTimeout <ms> ms, ...)` instead of Playwright's generic fixture timeout; a session that still arrives later is closed. A failing start names the server and platform the same way and keeps the provider's error. Must be a positive, finite number.
* **`session.onSessionStarted(driver)`** — called once per worker, right after the session opened, within what is left of `session.startTimeout`. If it throws, the session is still closed and the error fails the test, with the [setup evidence](#failure-evidence) attached.

The web-only options `blockedOrigins`, `mutationInjection` (unless `false`), `interceptionRetry` and the object form of `screenshotOnFailure` throw when `baseFixture()` is called for a platform, instead of being ignored. `timeout`, `repoTimeout`, `emailCredentials`, `apiBaseUrl` / `apiProviders` and `dbUrl` / `dbProviders` work on every platform.

### Running a platform run

The one documented form:

```bash
E2E_PLATFORM=<platform> E2E_CAPABILITIES=tests/capabilities/<device>.json APPIUM_URL=<appium-server-url> \
  npx playwright test -c playwright.platform.config.ts
```

A platform config holds one device session per worker, so use `workers: 1` per device and generous timeouts:

```ts
// playwright.platform.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/platform',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: 'html',
});
```

### Environment variables

These five are the complete list; no other variable selects a platform, device or server. An **empty** value counts as unset (`E2E_PLATFORM=''` means `web`), so CI can pass blank inputs.

`E2E_PLATFORM` is namespaced so that nothing ambient can fail a web run: the library never reads `PLATFORM` or `CAPABILITIES` (a `Platform=x64` set by Windows developer shells is ignored). A set `E2E_PLATFORM` that is not a platform name throws, naming the variable. The `platform` option of `baseFixture` takes precedence over the variable.

`resolvePlatform(option?, env = process.env)` is exported and applies the same rule (the option, else `E2E_PLATFORM`, else `'web'`; an unknown value throws). Use it in a platform config or fixture to read the active platform, for example to skip a device-only spec on web: `test.skip(resolvePlatform(undefined) !== 'ios', 'iOS only')`.

| Variable | Meaning |
|---|---|
| `E2E_PLATFORM` | `web` (default) \| `android` \| `ios` \| `macos` \| `windows` |
| `E2E_CAPABILITIES` | Path to the capabilities JSON file |
| `APPIUM_URL` | The Appium server's own URL, with its base path only if it has one (`http://127.0.0.1:4723` for a local server without one; `.../wd/hub` only for a server started with that base path) |
| `APPIUM_USER`, `APPIUM_KEY` | Optional credentials for a remote or cloud server |

### Capabilities files

Capabilities live **only** in JSON files, one per device or device class, conventionally under `tests/capabilities/`. The library sends exactly the file's content: it adds, defaults and rewrites nothing, and holds no default device, app or automation name.

```json
{
  "platformName": "iOS",
  "appium:automationName": "XCUITest",
  "appium:deviceName": "<device-name>",
  "appium:udid": "<device-udid>",
  "appium:bundleId": "com.example.app",
  "appium:newCommandTimeout": 300,
  "appium:autoAcceptAlerts": false,
  "appium:noReset": true
}
```

* **Flat W3C object.** Top-level keys only; a file wrapped in `alwaysMatch` / `firstMatch` is refused, naming the file.
* **`platformName` is required** and must match the platform (case-insensitive), or the run fails before a session opens, naming both.
* **The app under test** is read from `appium:appPackage` (android) or `appium:bundleId` (ios), at the top level or inside `"appium:options": { "appPackage": ... }` / `{ "bundleId": ... }`. Steps that take an optional `appId` default to it. A file that names only `appium:app` (a build path) has no app id: set `session.reset: 'none'` and pass `appId` to app steps explicitly.
* **Mobile browser sessions.** A file with `browserName` must also set `"wdio:enforceWebDriverClassic": true`, or the fixture refuses it, naming the file and the key: without it WebdriverIO 10 adds WebDriver BiDi capabilities (`webSocketUrl`, `unhandledPromptBehavior`, `appium:chromedriverForwardBiDi`) and the file would not be sent as written. Native-app files do not need it.
* **Set `appium:deviceName` and `appium:newCommandTimeout` explicitly.** Inspection tools such as `wdio session` inject their own defaults for keys the file leaves out; setting them keeps the inspected session and the test session identical.
* **No secrets, no server addresses** in the file: the server comes from `APPIUM_URL`, credentials from `APPIUM_USER` / `APPIUM_KEY`. Do not commit real device names, UDIDs or signing team ids.

### Fixture values per platform

| Fixture | `web` | `android` / `ios` |
|---|---|---|
| `steps` | `Steps` on the Playwright page | `Steps` on the Appium family |
| `repo` | `ElementRepository` with `{ platform: 'web' }` active | `ElementRepository` with the platform active |
| `interactions` | `ElementInteractions` | A `PlatformInteractions` with the same members (`interact`, `verify`, `extract`, `navigate`, `email`) plus `gestures` and `device`; `request` throws. The fixture is typed `ElementInteractions \| PlatformInteractions`: narrow with `interactions instanceof PlatformInteractions` to reach `gestures` / `device`. |
| `contextStore` | `ContextStore` | `ContextStore` |
| `page`, `context` | Playwright's | Throw `PlatformNotSupportedError('page' \| 'context', <platform>)`; no browser starts |
| `driver` | Throws `PlatformNotSupportedError('driver', 'web')` | The worker's `WebdriverIO.Browser` session |

`steps.platform` tells a test which platform it runs on.

### Reset policy

One WebdriverIO session per Playwright worker, opened by the first test that needs it and closed at worker teardown (closing is time-boxed and best-effort: a dead device cannot stall the teardown or hide a test's own error).

* `reset: 'relaunch'` (default) — before **every** test, the first one included, the app under test is terminated and activated again. It needs the app id from the capabilities file; without one the run fails before a session opens, naming the key to add. The test body starts only once the app is in the foreground (`mobile: queryAppState` reports 4), so even a first step that does not poll (`getPageSource`) sees the app, not the home screen. If the app is not in the foreground within `session.relaunchTimeout` (default 15000 ms) the test fails in its setup: `session.reset 'relaunch': app "<app id>" is not in the foreground on platform "<platform>" <timeout> ms after it was terminated and activated (last app state: 3, running in background). ...`. Any other failure names its phase, the app, the platform and the budget: `session.reset 'relaunch' failed in phase "<terminate | activate | foreground wait>" for app "<app id>" on platform "<platform>": <driver error>. ...`. A dead session fails at once with the driver's error.
  * **One retry of an iOS launch timeout.** When WebDriverAgent answers the relaunch's `mobile: activateApp` with `Timed out attempting to launch app` (XCTest's own launch timeout, seen on simulators under load), the fixture activates the app once more and logs a warning naming the app id, the platform and the error. The retried activation and the foreground wait after it share one `session.relaunchTimeout`; a second failure fails the setup with its error (phase `activate (retried once after a launch timeout)`). Only that text is matched, only on iOS, and no other error is retried. Terminate and the first activation run under the driver's own command timeout. The longest a relaunch can take is therefore the driver's command timeout for terminate and for the first activation, plus one `session.relaunchTimeout` for the retried activation and the foreground wait together; with the default that is twice the driver's command timeout + 15000 ms. When setup evidence is collected after a failure, up to 3 × 10 s more is added. All of it runs inside the test timeout. Android is not retried: UiAutomator2 has no single launch-timeout message to match. The `resetApp`, `activateApp` and `launchApp` steps never retry.
  * **The fixture stops, then waits for, a lookup a timed-out check left running.** A device check that times out while one of its lookups is still running (typically a `.byText()` pass reading a long list) aborts that lookup (element-repository's lookup `signal`): it starts no further driver command. Two things cannot be stopped: the driver command already in flight, and a read the check makes on an element a lookup already returned (such an element does not carry the signal; the check only starts no new read after it). After the test body, before the failure evidence and before the next relaunch, the fixture aborts such lookups again and waits for that last command to end, so it ends on the app launch it started on. (After a relaunch an element it holds would be stale, and WebdriverIO would look it up again, holding up the next test.) **A failing device test may therefore take about one driver command, or the commands of one element read in flight (a container's text read reads its descendants) longer** (so may a passing one that caught a timed-out check); on a slow device one command can still take a second or more. The wait is capped at 10000 ms (one whole measured pass with a margin, see the `.byText()` limitation under [Which steps run where](#which-steps-run-where) for the figures, so that a command that hangs cannot hold the run) and cannot be configured. What you see: when the fixture has something to wait for, it first extends the test's timeout by the cap (10000 ms) — the test's own timeout before the relaunch, Playwright's teardown time (the larger of the project and the test timeout) after the body — so the wait never makes a test run out of time; a timeout of `0` (none) stays as it is. When lookups are still running at the cap, the console shows `[element-interactions] N device lookup(s) abandoned by a timed-out check still running <after the test | before the relaunch | at worker teardown>, after waiting X ms (the oldest for Y ms); carrying on. They may still send driver commands to the device.` and the test gets a `warning` annotation with the same text (none at worker teardown, which belongs to no test); then the run carries on. This relies on Playwright running a test's fixture teardown in its own time slot, the larger of the project and the test timeout (Playwright 1.61, the version this package is tested with; its tests pin that slot length and that later teardown fixtures run inside the extended slot); on a Playwright that runs teardown inside the test's own timeout the extension is at least as large, and with a project timeout of `0` and a test timeout set the wait then runs inside the test's timeout. A command still running at the cap (a driver that stopped answering) is still running at the relaunch: the warning names it, and the next test may be slowed by it. At worker teardown the wait (up to 10000 ms) and closing the session (up to 10000 ms) run inside the worker fixture's timeout, `session.startTimeout`: below about 20000 ms that teardown can run out of it. The wait never fails a test and never replaces a test's own error. It runs again before each relaunch and at worker teardown.
* `reset: 'none'` — the app is left as the previous test left it.

Data reset (`appium:noReset`, `appium:fullReset`) is a capability and stays in the file.

### Failure evidence

A test that does not end as expected (the same trigger as the web failure screenshot: `status !== expectedStatus`) gets two attachments:

| Name | Content type | Content |
|---|---|---|
| `failure-screenshot` | `image/png` | The device screenshot (skipped with `screenshotOnFailure: false`) |
| `page-source` | `text/xml` | The UI hierarchy of the screen at the failure |

Each is collected with a 10 s limit and is best-effort: when the device cannot answer, the attachment is skipped and the test's own failure is reported unchanged.

A test whose **setup** fails after the session exists (the relaunch, the foreground wait, `onSessionStarted`) also gets `setup-error` (`text/plain`): the error with its stack, and the last app state (from the foreground wait when it read one, else one time-boxed `mobile: queryAppState`). The screenshot and page source follow as above, whatever `test.fail()` says, since the test body never ran. None of them replaces the setup error.

### Page repository per platform

One file may hold the same page name once per platform. A page without `platform` is a `web` page. Use the same element names on every platform so the spec is identical:

```json
{ "pages": [
  { "name": "LoginPage", "platform": "web",     "elements": [ { "elementName": "submit", "selector": { "css": "button[type=submit]" } } ] },
  { "name": "LoginPage", "platform": "android", "elements": [ { "elementName": "submit", "selector": { "accessibility id": "login-submit" } } ] },
  { "name": "LoginPage", "platform": "ios",     "elements": [ { "elementName": "submit", "selector": { "accessibility id": "login-submit" } } ] }
] }
```

The fixture's `repo` uses the page block of the active platform; a page that has no block for it throws `ElementRepository: page '<name>' has no entry for platform '<platform>'. Available: <platforms>.` Platform selector keys are `accessibility id`, `id` (resource-id on Android, `name` on iOS, never CSS), `xpath`, `class name`, `uiautomator`, `predicate`, `class chain`, `text`, and the enhanced `role` + `name` (translated by element-repository into a UiSelector on Android and a predicate string on iOS). The flags `list`, `provisional` and `fallback` keep their meaning. Preferred order: accessibility id, then id (Android) / predicate (iOS), then class chain / uiautomator, then text, and xpath last.

### Which steps run where

Shared steps keep their names and `(elementName, pageName, ...)` argument order on every platform. A step that a platform cannot honour throws `PlatformNotSupportedError(<step>, <platform>)` before anything is sent; nothing warns and continues.

| Kind | Steps | `web` | `android` / `ios` |
|---|---|---|---|
| **Shared** | `on`, `click`, `clickRandom`, `clickIfPresent`, `doubleClick`, `check`, `uncheck`, `scrollIntoView`, `fill`, `typeSequentially`, `clearInput`, `dragAndDrop`, `dragAndDropListedElement`, `getText`, `getAttribute`, `getCount`, `getInputValue`, `getBoundingBox`, `getAll`, `verifyPresence`, `verifyAllPresent`, `isPresent`, `isVisible`, `verifyAbsence`, `verifyText`, `verifyTextContains`, `verifyCount`, `verifyState`, `verifyAttribute`, `verifyInputValue`, `expect`, `verifyOrder`, `verifyListOrder`, `clickListedElement`, `verifyListedElement`, `getListedElementData`, `waitForState`, `waitAndClick`, `clickNth`, `fillForm`, `screenshot` | ✅ | ✅ (notes below) |
| **Non-UI** | `pace`, `repeat`, `retryUntil`, `apiGet` … `verifyApiHeader`, `sql*` / `verifySql*`, `closeDbConnections`, `sendEmail` / `receiveEmail` / `receiveAllEmails` / `cleanEmails` / `markEmail`, `verifyRequestStatus` / `verifyRequestHeader` / `verifyRequestOk` | ✅ | ✅ |
| **Web-only** | URL, history and tabs (`navigateTo`, `getUrl`, `getCurrentPath`, `waitForUrl`, `refresh`, `backOrForward`, `setViewport`, `switchToNewTab`, `forPage`, `closeTab`, `getTabCount`, `verifyTabCount`, `verifyUrlContains`); pointer, keyboard and form controls (`rightClick`, `hover`, `uploadFile`, `dropFiles`, `selectDropdown`, `selectMultiple`, `setSliderValue`, `pressKey`, `pressKeys`, `dispatchEvent`); HTML, CSS, page text, window and scripts (`getHtml`, `getPageHtml`, `getPageText`, `getCssProperty`, `getWindowProperty`, `setWindowProperty`, `evaluateScript`, `verifyImages`, `verifyHtml*`, `verifyPageHtml*`, `verifyCssProperty`, `verifyWindowProperty`, `verifyPageContainsText`, `verifyPageNotContainsText`, `verifyPageTitle`); storage (`*LocalStorage*`, `*SessionStorage*`); browser-session requests and network (`requestGet` … `requestHead`, `waitForNetworkIdle`, `waitForLoadState`, `waitForResponse`, `expectNoRequest`); `verifyVisualMatch` | ✅ | ❌ `PlatformNotSupportedError` |
| **Element gestures** | `swipe`, `scrollUntilFound`, `longPress` | ✅ `swipe` / `longPress`: mouse gestures (the element primitive); `scrollUntilFound`: scrolls the element into view | ✅ |
| | `pinch`, `zoom` | ❌ `PlatformNotSupportedError`, before the element is resolved | ✅ |
| **Platform-only** | App (`launchApp`, `activateApp`, `terminateApp`, `backgroundApp`, `resetApp`, `installApp`, `removeApp`, `openDeepLink`), screen gestures (`swipeScreen`, `tapAt`), device (`hideKeyboard`, `setOrientation`, `acceptAlert`, `dismissAlert`, `setPermission`), contexts (`getContexts`, `switchContext`), device assertions (`verifyAppInForeground`, `verifyOrientation`, `verifyKeyboardShown`, `verifyContext`), `getPageSource` | ❌ `PlatformNotSupportedError` | ✅ |
| | `pressBack` | ❌ | ✅ android; ❌ ios (iOS has no system back: tap the on-screen back button) |
| **`steps.on(...)` chain** | `findByRole`, `findByText`, `findBySelector`, `hover`, `rightClick`, `selectDropdown`, `selectMultiple`, `uploadFile`, `dropFiles`, `setSliderValue`, `getHtml`, `getCssProperty`, `verifyHtml*`, `verifyCssProperty`, `verifyImages`; matcher fields `html`, `outerHtml`, `css` | ✅ | ❌ `PlatformNotSupportedError` |

On `macos` and `windows` no step runs: the session start throws `Platform "<p>" is declared but not implemented yet.`

Notes for the shared steps on a device:

* **Visible text is the element's own `textContent()` (element-repository).** On iOS that is the `label`, falling back to the `value`, not WebdriverIO's raw `getText()` (which answers `value` first, so a settings row with a badge would read as its badge count); `name` (usually the accessibility id) is never read, and on a text field, secure text field, text view or search field the typed `value` wins. Every text read of the shared steps (`verifyText*`, `getText`, `getAll`, `verifyOrder`, `verifyListOrder`, listed-element `text`, matcher `text`, `isVisible({ containsText })`) uses it, and so does element-repository's own text lookup. Android reads the element's text; when that is empty (a list row or another container), it reads the text of its descendants (hints left out), joined with single spaces in document order, so a row holding the TextViews "Item 1" and "Alpha" reads `Item 1 Alpha`. iOS follows the same rule: an element whose `label` and `value` are empty (not a text input, a static text or an image, e.g. a cell or another container) reads its descendants' static text, joined with single spaces. One rule everywhere: an element's text is its own, else its descendants'.
* **A checkbox's, switch's or radio button's state is read with `verifyState(..., 'checked')`, not `getText` or `getInputValue`** (on Android those return the control's label). Android reads the `checked` attribute; iOS reads a switch's or toggle's `value` (`1` / `0`) and the `selected` state of other elements.
* **`check` / `uncheck` on a device** tap only when the state differs (on a control already in the wanted state they do nothing) and then wait, within the step timeout, until the new state reads back; a tap that does not change it fails with `is still unchecked after clicking` / `is still checked after clicking`. They refuse without a tap: `uncheck` on a checked Android radio button (`is a radio button; select another option instead`), an Android control that is not checkable (`is not checkable`), and a control still disabled at the timeout (`is disabled`).
* **`getAttribute` on a device** returns `null` for an attribute the element does not have (UiAutomator2 itself answers the string `"null"`) and for a name the driver does not know (XCUITest and UiAutomator2 answer with an "attribute is unknown" error), so a misspelt name reads as missing and `attributes.not.toHaveKey(name)` passes. Any other driver error still fails at once.
* **`doubleClick` on a device** is a native double tap on the element's centre (element-repository sends `mobile: doubleTap` on iOS and `mobile: doubleClickGesture` on Android), so a double-tap recogniser fires and a button counting taps sees two. An element that is not found fails (`doubleClick: "<selector>" not found within N ms`) before anything is sent.
* **Verifications poll.** Every `verify*` step and every `steps.expect(...)` / `steps.on(...)` matcher retries until its timeout on every platform.
* **`.byText()` under polling reads the whole list.** Each poll of a `verify*` terminal, a matcher, a `satisfy()` snapshot or a visibility probe re-resolves the chain; element-repository's text strategy reads every candidate of a pass it has started (its budget only decides whether another pass starts), so `steps.on('items', 'Page').byText('Green 2').verifyText('Green 2')` finds a later item with the same one-check budget per poll as a plain entry. A text that matches nothing fails at the step's timeout with the strategy's own reason (`with text "Purple" not found`). A list whose single read pass takes longer than the step's timeout does not answer within it: the step fails (`No answer was obtained: no check finished within the timeout`), and a cut-off pass is never read as "not found", "absent" or "not visible"; give such a list a longer `.timeout(ms)`. On a device a pass that met a transient driver error (a failed `$$`, a stale text read) did not see every match either: its "not found" ends with `(last driver error: ...)`, and `verifyAbsence`, `not.visible` and `visible.toBeFalse()` poll again instead of reading it as absent or hidden; only a clean "not found" (no driver error) is. Likewise a plain entry's `verifyAbsence` on a device retries a lookup that failed, or a read of a match that failed (a list redrawn while shown leaves every handle stale), instead of reading it as absent. An element that leaves the tree is gone from the next poll's lookup, so `verifyAbsence` still passes. Matches that are re-created faster than they can be read, on every poll (a list redrawn or animating for the whole timeout), never give an answer: the step fails with `Last error: stale element reference ...`. In that case wait until the screen settles, or assert on a stable signal first (for example `steps.verifyText('status', 'Page', 'Saved')` on a status label, or `verifyPresence` of the next screen's element), then assert absence; a longer `.timeout(ms)` helps when the redraw is temporary.
* **A fatal driver error fails at once.** A dead session, an invalid selector or a lost server connection is not retried: verifications, list presence, listed-element steps and probes fail at once with the driver's error instead of at the timeout, and such an error never counts as "absent" or "not visible".
* **A visibility read that fails is never "not visible".** On a device only a no-match answer (no element matches, an index past the end, a clean text miss) reads as not visible. Any other driver error (an `unknown error`, a stale reference twice in a row) is no answer: polling checks (`not.visible`, `visible.toBeFalse()`, `verifyState('hidden')`, `verifyAbsence`, `satisfy()`, list presence) retry it and report it as their last error; the `isVisible()` probe and the `isVisible()` / `ifVisible()` gates retry within their timeout and then throw `isVisible: could not tell whether '<page>.<element>' is displayed within <timeout> ms: <error>`; `isPresent` and `clickIfPresent` throw it. On web `isPresent` still answers `false` on any error.
* **`verifyAbsence`** passes when the element is absent or not displayed, polling until the timeout; `"list": true` entries pass when no item of the list is displayed.
* **`.byText()` on a long list is slow (limitation).** The text selection finds its match by reading the text of every element the entry's selector matches, one after another; a started pass is never cut short, so it cannot report "not found" or "absent" for a match it has not read yet. On the iOS SIMULATOR (iOS 17.2) one pass over the test app's long list cost about 1.3 s for the lookup, then about 155 ms a cell (its name and label read serially): about 3.8 s or more for the 16 cells a virtualised list keeps in the tree, and, by the same figures, about 17 s for 100 cells. On a real Android phone one pass over the test app's long list of 11 cells cost 720 to 816 ms for the lookup, then 211 to 250 ms a cell: 3.05 to 3.57 s for the whole pass on a cold start, 2.46 to 2.68 s warm. Real iOS-device figures are not measured yet. What that means with the default timeouts (step 30 s, repository lookup 15 s): a click, `getText` or `verifyPresence` by text answers only after one whole pass (about 4 s for 16 cells, 17 s for 100; an exact text match ends the pass at its row); a 100-cell list leaves room for only one pass, so a row that appears after the pass has started is not seen; a check whose `.timeout(ms)` is shorter than one pass gets no answer at all and fails with `No answer was obtained: no check finished within the timeout`; and a test of several such steps can outrun Playwright's own test timeout. Where a step is slow, prefer a selector that names the row itself, so the lookup matches one element instead of reading every row: an `accessibility id` on the row, or a `predicate` / `class chain` that filters by label on iOS (for example `{ "predicate": "label == 'Item 3'" }`) and a `uiautomator` `text(...)` selector on Android, as a plain entry without `.byText()`. When `.byText()` stays, give its step a `.timeout(ms)` that holds one whole pass with a margin: one pass that finishes gives the answer, and the margin covers devices and loads not measured.
* **`.byText()` on a narrowable selector.** On a device, a selector element-repository can narrow (accessibility id, class chain / predicate on iOS; XPath, full resource id, accessibility id on Android) answers a text lookup from its narrowed queries; a narrowed miss is a clean miss, so absence on such a selector relies on element-repository's narrowing (an Android match deeper than `appium:snapshotMaxDepth` is not found).
* **`"list": true` entries and listed-element steps** work on platform pages. `child` and `withDescendant` are resolved inside the matched item; prefer the `{ pageName, elementName }` form. A string `child` is a platform selector as WebdriverIO accepts it (`~id`, an xpath, `-ios predicate string:...`), not CSS.
* **Listed-element `text` and `withDescendant.text` match as on web**: a string is a case-insensitive substring with whitespace normalised, the first item in list order wins, and a RegExp is tested on the text as is (`{ text: 'Apple' }` on "Apple pie", "Apple" picks "Apple pie"). `repo.getByText` differs: on a device it prefers an exact match, then a substring, as element-repository's text strategy does.
* **`isVisible` / `ifVisible` probes and gates** re-resolve the entry within their budget, as on web. A web-only terminal behind a gate (`hover`, `rightClick`, `uploadFile`, `selectDropdown`, `setSliderValue`, `selectMultiple`, the `css` matcher, and behind `ifVisible()` the `html` / `outerHtml` matchers) throws `PlatformNotSupportedError` before the probe, whether the element is shown or not: it is never skipped as "not visible".
* **`fillForm`** refuses dropdown fields on a device (`selectDropdown` is web-only).
* **`waitForState` / `verifyState`:** `focused` is supported on Android and throws `PlatformNotSupportedError("state('focused')", 'ios')` on iOS (XCUITest exposes no focus attribute).
* **`click` on a device** taps the element once it is visible. `{ force: true }` taps the centre of its bounds with a positional tap instead of the element click command; `withoutScrolling` is accepted and changes nothing (a device tap never scrolls first).

### Platform steps

All return `Promise<void>` unless noted. `appId` defaults to the app under test from the capabilities file. `SwipeDirection` (also exported as `Direction`) is `'up' | 'down' | 'left' | 'right'`; `Orientation` is `'portrait' | 'landscape'`. The gesture option types (`SwipeOptions`, `ScrollIntoViewOptions`, `LongPressOptions`, `TapOffset`, `TapAtOptions`, `PinchOptions`, `ZoomOptions`) are element-repository's, re-exported by this package; the scroll steps take `ScrollStepOptions`, which is `ScrollIntoViewOptions` with `container` as an element name ([Scroll container](#scroll-container)); every element gesture step also takes the `StepOptions` of the other element steps (`strategy`, `index`, a per-call `timeout`). Each step has a bullet in the API Reference: [App](#-app), [Gestures](#-gestures), [Device](#-device), [Contexts and page source](#-contexts-and-page-source), [Device assertions](#-device-assertions).

```ts
// App
steps.launchApp(appId?: string)
steps.activateApp(appId?: string)
steps.terminateApp(appId?: string)
steps.backgroundApp(seconds: number)
steps.resetApp()                                   // terminate + activate the app under test
steps.installApp(appPath: string)                  // .apk / .app / .ipa path or URL the Appium server can reach
steps.removeApp(appId: string)
steps.openDeepLink(url: string, appId?: string)

// Gestures (element-level ones delegate to the element's primitive)
steps.swipe(elementName, pageName, direction: SwipeDirection, options?: StepOptions & SwipeOptions)    // distance
steps.swipeScreen(direction: SwipeDirection, options?: { distance?: number })
steps.scrollIntoView(elementName, pageName, options?: StepOptions & ScrollStepOptions)                  // direction, maxSwipes, container
steps.scrollUntilFound(elementName, pageName, options?: StepOptions & ScrollStepOptions)                // direction, maxSwipes, container
steps.longPress(elementName, pageName, options?: StepOptions & LongPressOptions)    // duration ms, default 1000
steps.tapAt(x: number, y: number)                  // screen coordinates, px
steps.pinch(elementName, pageName, options?: StepOptions & PinchOptions)            // scale in (0, 1), default 0.5
steps.zoom(elementName, pageName, options?: StepOptions & ZoomOptions)              // scale > 1, default 2

// Device
steps.pressBack()                                  // android only
steps.hideKeyboard(options?: HideKeyboardOptions): Promise<boolean>   // tapElement { pageName, elementName }, timeout
steps.setOrientation(orientation: Orientation)
steps.acceptAlert()
steps.dismissAlert()
steps.setPermission(permission: string, state: 'grant' | 'deny' | 'reset')  // android 'reset' revokes

// Contexts
steps.getContexts(): Promise<string[]>
steps.switchContext(name: string)                  // 'NATIVE_APP' or a 'WEBVIEW_*' name

// Assertions (polling until the step timeout, or options.timeout)
steps.verifyAppInForeground(appId?: string, options?: { timeout?: number; errorMessage?: string })
steps.verifyOrientation(orientation: Orientation, options?: { timeout?: number; errorMessage?: string })
steps.verifyKeyboardShown(options?: { negated?: boolean; timeout?: number; errorMessage?: string })
steps.verifyContext(name: string, options?: { timeout?: number; errorMessage?: string })

// Extraction
steps.getPageSource(): Promise<string>             // the screen's UI hierarchy as XML
```

The element gestures are on the fluent chain too, acting on the element the chain selects (`nth`, `byText`, ...) with the chain timeout unless the options carry one:

```ts
steps.on(elementName, pageName)
    .swipe(direction: SwipeDirection, options?: SwipeOptions)
    .scrollIntoView(options?: ScrollStepOptions)          // the no-argument form is unchanged
    .scrollUntilFound(options?: ScrollStepOptions)
    .longPress(options?: LongPressOptions)
    .tapAt(offset: TapOffset, options?: TapAtOptions)     // offset from the element's top-left corner; on web a mouse click there
    .pinch(options?: PinchOptions)                        // device platforms only
    .zoom(options?: ZoomOptions)                          // device platforms only
```

Each is a terminal (`Promise<void>`). `pinch` / `zoom` throw `PlatformNotSupportedError` on web before the element is resolved.

**Swipe directions.** Two different meanings, on purpose:

* `swipe` and `swipeScreen` take the **finger's** direction: `swipe(..., 'up')` moves the finger up, which reveals content further **down** the list.
* `scrollIntoView({ direction })` and `scrollUntilFound({ direction })` take where the **target** lies relative to the view: `direction: 'down'` (the default for `scrollUntilFound`) looks further down the list.

<a id="scroll-container"></a>**Scroll container.** `ScrollStepOptions` is element-repository's `ScrollIntoViewOptions` with `container?: string`: the element name, on the target's page, of the scrollable ancestor (a carousel, a side list). The step resolves it through the repository, so it follows the active platform's entry, and passes the element to element-repository's `scrollIntoView({ container })`.

```ts
await steps.scrollUntilFound('productName2', 'ProductCarouselPage', { direction: 'right', container: 'carousel' });
await steps.on('productName0', 'ProductCarouselPage').scrollIntoView({ direction: 'left', container: 'carousel' });
```

* On a device each swipe is then a paging-safe drag inside the container's rect (85% to 15% of its extent along the scroll axis, with a short hold at each end), so a paging carousel advances a page and a free list moves by the drag. Without a container the sweep runs along the target's own row or column while the target is in the element tree, else across the window's centre line, which misses a carousel near the top of the screen whose next slides are not in the tree yet: pass `container` for such a scroller.
* A name the page does not define fails before any swipe: `scrollIntoView: container "<name>" on page "<page>" could not be resolved: ...`. A container that is defined but not on screen, outside the window, or too close to the window edge to sweep fails with element-repository's error, before any swipe.
* On web the container is resolved the same way (a misspelt name fails there too) and Playwright ignores it: the browser scrolls the target into view directly.

**Timeouts.**

* Verifications and device assertions poll until the step timeout (the fixture's `timeout`, default 30000 ms).
* `scrollIntoView` and `scrollUntilFound` on a device are element-repository's `scrollIntoView` sweep, always given the step's timeout (`options.timeout`, else the step timeout, default 30 s): the sweep stops at that timeout or after `maxSwipes` swipes (default 20), whichever comes first. When the element is not already on screen, a shown soft keyboard is hidden first (best-effort, element-repository's behaviour), then the fixed swipes run. The timeout bounds when a new swipe may start and an in-flight swipe always finishes, so the step may run up to one swipe longer than `timeout`. Pass a larger `timeout` for long lists.
* The first gesture of a fresh iOS session can take tens of seconds (XCUITest warms up); size the test timeout for it.

**Errors.** Every error below can be caught by type:

* **`PlatformNotSupportedError`** (element-repository's own class, re-exported so `instanceof` works across both packages; fields `method`, `platform`) — thrown first, before anything is resolved or sent, by a step the active platform cannot do: every platform-only step on web, `pinch` / `zoom` on web, a web-only step on a device, `pressBack` on ios, and the `page` / `context` / `driver` fixtures on the wrong platform.
* **`PollTimeoutError`** (fields `timeout`, `lastValue`, `lastError`) — thrown when a polling step on a device runs out of time: the device assertions (`verifyAppInForeground`, `verifyOrientation`, `verifyKeyboardShown`, `verifyContext`), the element `verify*` steps (`verifyText`, `verifyState`, `verifyCount`, ...) and the listed-element steps. Its message names what was awaited, the timeout, the last observed value and the last error. The exception is `verifyPresence` on a `"list": true` entry (list-entry presence): it throws a plain `Error` whose `cause` is the `PollTimeoutError`.
* **`ProbeTimeoutError`** (field `budget`) — never thrown by a step itself: it is the `lastError` of a `PollTimeoutError` when a single device query did not answer within its share of the timeout. When an earlier query of the same poll answered, the message leads with that last value and names the unanswered query only after it (`Last value: true; the last probe did not answer within N ms.`). When no query answered at all (each one ran out of its share), the message says so instead of reporting a failed check: after the step's own lead (for example `Expected element to be absent (not displayed): timed out after 3000 ms.`) it reads `No answer was obtained: no check finished within the timeout. The probe was still running when its 3000 ms ran out: one check (a driver call or a lookup pass) takes longer than the 3000 ms timeout, or the driver stopped answering. Allow more time with a longer timeout.` An element check (`verify*`, matchers, `verifyCount`, list presence, listed elements) adds `For an element check, one lookup pass may be slower than the timeout: use a longer `.timeout(ms)` or a selector that matches fewer elements (a `byText` selection reads the text of every candidate).`; a device check (`verifyOrientation`, `verifyKeyboardShown`, `verifyContext`, `verifyAppInForeground`) does not, since no lookup is involved. One whole check that finishes gives the answer, so a longer timeout needs room for one pass plus a margin, not for several passes. `lastValue` is then `undefined`. `(no value; every probe failed)` is kept for a poll whose queries all answered with an error.
* **`MissingAppIdError`** (fields `caller`, `capability`, `platform`) — thrown when a step needs the app under test and neither an `appId` argument nor the capabilities file names one: `launchApp`, `activateApp`, `terminateApp`, `resetApp`, `setPermission` and `verifyAppInForeground`.
* **`AppNotInForegroundError`** (fields `appId`, `platform`, `timeout`, `lastState`, `lastError`) — thrown when the app under test does not reach the foreground in time after it was relaunched: `lastState` is the last `mobile: queryAppState` answer as the driver returned it (a number 0–4 from a working driver; any other answer is kept as is and shown in the message), or `undefined` when no query answered (`lastError` then holds the last query error). The fixture's `reset: 'relaunch'` setup throws a plain `Error` whose `cause` is the `AppNotInForegroundError`.

```ts
import { PlatformNotSupportedError, PollTimeoutError, ProbeTimeoutError } from '@civitas-cerebrum/element-interactions';

try {
  await steps.verifyKeyboardShown({ timeout: 5_000 });
} catch (error) {
  if (error instanceof PlatformNotSupportedError) test.skip(true, `${error.method} needs a device`);
  if (error instanceof PollTimeoutError && error.lastError instanceof ProbeTimeoutError) {
    throw new Error(`the device stopped answering: ${error.message}`);
  }
  throw error;
}
```

### Without the fixture

`Steps` also has a factory form, for a session you manage yourself:

```ts
import { AppiumFactory, Steps } from '@civitas-cerebrum/element-interactions';
import { ElementRepository } from '@civitas-cerebrum/element-repository';

const repo = new ElementRepository(driver, 'tests/e2e/page-repository.json', { platform: 'ios' });
const steps = new Steps(new AppiumFactory(driver, 'ios', { appId: 'com.example.app' }), repo);
```

The web family has the same form: `new Steps(new PlaywrightFactory(page), repo)` (`PlaywrightFactory(page, { timeout?, interceptionRetry? })`).

`new Steps(repo, options)` keeps building web Steps on the repository's Playwright page, as before.

### Exported types

Besides the classes above, the package exports these for platform code:

* **Fixture and steps:** `BaseFixtureTest` (the fixture's test type), `BaseFixtureOptions`, `StepsOptions`, `ElementActionFamily` (the family a `steps.on(...)` chain acts through).
* **Web family:** `PlaywrightInteractions`, `PlaywrightVerifications`, `PlaywrightExtractions`, `PlaywrightNavigation` (the same classes as `Interactions`, `Verifications`, `Extractions`, `Navigation`, under their family names); `VerifyOptions` (`{ negated?, timeout?, errorMessage? }`, accepted by every `Verifications` method) and `VisualMatchPrimitiveOptions` (the resolved options `Verifications.visuallyMatches` takes).
* **Family interfaces:** `IInteractions`, `IVerifications` (with `VerifiableState`), `IExtractions`, `INavigation`, `IUtils`, `IGestures`, `IDevice`, `IInteractionFactory`; `EntryTarget` (a repository entry as the families resolve it) and `ElementSnapshot`.
* **Device vocabulary:** `Orientation`, `PermissionState`, `DeviceVerifyOptions` (`{ timeout?, errorMessage? }` of the device assertions).
* **Platforms:** `Platform`, `DriverFamily`, `PLATFORMS`, `isPlatformName`, `familyOf`, `resolvePlatform` (the first five are element-repository's vocabulary, re-exported; `resolvePlatform(option, env?)` is this package's, the fixture's platform rule).
* **Gesture options:** `SwipeDirection`, `SwipeOptions`, `ScrollIntoViewOptions`, `LongPressOptions`, `TapOffset`, `TapAtOptions`, `PinchOptions`, `ZoomOptions` (element-repository's, re-exported), `ScreenSwipeOptions` (`swipeScreen`'s `{ distance? }`), `ScrollStepOptions` (the scroll steps' options, `container` as an element name) and `Direction` (an alias of `SwipeDirection`).
* **Session:** `ServerOptions`, `SessionOptions`, `SessionStartContext`, `SessionProvider`, `AppiumSessionProviderOptions`, `AppiumClientOptions`, `WebdriverioLogLevel`, `WebdriverioModule`, `AppiumFactoryOptions`, `AppiumDriver`, `PlaywrightFactoryOptions`.
* **Errors:** `PlatformNotSupportedError`, `PollTimeoutError`, `ProbeTimeoutError`, `MissingAppIdError`, `AppNotInForegroundError` (see [Errors](#platform-steps)).

### CI

`.github/workflows/platform.yml` runs the cross-platform spec (`tests/cross-platform`) on an Android emulator against the test app `com.civitas.testapp` and on an iOS simulator against the built-in Settings app, read-only. The Android job checks out the public [android-test-app](https://github.com/civitas-cerebrum/android-test-app) repository at a pinned commit, builds its debug APK with Gradle (JDK 17) and installs it on the emulator with `adb install` before the run; the capabilities file only names the app (`appium:appPackage`, `appium:appActivity`) and never installs it. It is **manual only** (`workflow_dispatch`): it does not run on push or pull request until a maintainer changes the trigger. Its status is under [What is verified](#what-is-verified).

The iOS job prebuilds WebDriverAgent (`appium driver run xcuitest build-wda`) before the session opens, and both jobs run Playwright with `--timeout=600000` to leave room for emulator / simulator start-up and the first session.

### What is verified

The library is unit-tested on both platforms with mock drivers, and the cross-platform spec runs on web in the default suite. `tests/cross-platform/appGuard.spec.ts` (the device-app guard) and `tests/cross-platform/hasEntry.spec.ts` are unit tests: they run in the default suite, not on a device, and the platform config leaves them out.

**Verified on a real Android phone (Android 17, the project's Android test app `com.civitas.testapp`):** Appium 3 with the UiAutomator2 driver, WebdriverIO 10, on 2026-11-26, at commit 34766fa: 24 of 24 tests passed. Source: `tests/live/android-testapp.spec.ts` and `tests/cross-platform/navigation.spec.ts`.

| Area | Status |
|---|---|
| Worker-scoped session opened from a capabilities file checked by the device-app guard; the relaunch lands with the app in the foreground, and a first, non-polling `getPageSource` already sees the test app, not the launcher | ✅ verified |
| `backgroundApp`, then back on the same screen | ✅ verified |
| `terminateApp` then `activateApp`, and `terminateApp` then `launchApp`, back on the home grid | ✅ verified |
| `resetApp` back on the home grid | ✅ verified |
| `verifyAppInForeground`, `verifyPresence`, `verifyAbsence`, `verifyCount` | ✅ verified |
| The app's own dialogs: `click` to open and close them, `verifyText` / `verifyTextContains` on the status label | ✅ verified |
| `fill`, `verifyInputValue`, `verifyKeyboardShown`, `hideKeyboard`, `verifyKeyboardShown({ negated: true })` | ✅ verified |
| `setOrientation` landscape and portrait, `verifyOrientation` | ✅ verified |
| `getContexts` (lists `NATIVE_APP`), `verifyContext` | ✅ verified |
| `swipeScreen` up and down, checked with `getBoundingBox` | ✅ verified |
| `scrollUntilFound` down to the last section and back up to the first | ✅ verified |
| `getCount`, and `getAll` through a `child` text view; `verifyListedElement` / `clickListedElement` picking a row by `withDescendant` and acting on its `child` | ✅ verified |
| A row container's text is its child texts joined (`Item 1 Alpha`) in `getText`, `verifyText`, `verifyTextContains`, `getAll` and listed-element `text` | ✅ verified |
| `verifyState(..., 'checked')` on checkboxes and switches (an unchecked control fails with `PollTimeoutError`, `lastValue: false`); `check` / `uncheck`, idempotent; `check` on a disabled checkbox refused, leaving it unchecked and disabled | ✅ verified |
| `doubleClick` on the counter's increment button raises the counter by two | ✅ verified |
| `pressBack`, twice, back to the home grid | ✅ verified |
| A web-only step (`getUrl`, `verifyUrlContains`) throws `PlatformNotSupportedError` naming `android` | ✅ verified |
| The cross-platform navigation spec (`tests/cross-platform/navigation.spec.ts`, the same file as the web run) on Android, including its web-only step refused | ✅ verified |

**Verified on a real iOS device (iOS 26, iOS Settings app, read-only):** Appium 3 with the XCUITest driver, WebdriverIO 10, on 2026-11-23; re-verified at commit 34766fa: 10 of 11 tests passed. The first test, the cross-platform navigation spec, failed because the first session did not open within the old 180 s fixture budget (a cold WebDriverAgent start; that start is now bounded by `session.startTimeout`); the next session opened and the other 10 passed. The cross-platform navigation spec was re-run on the device at commit bace1e2: 2 of 2 passed, with the session opening within the default `session.startTimeout`. Source: `tests/live/ios-settings.spec.ts` and `tests/cross-platform/navigation.spec.ts`.

| Area | Status |
|---|---|
| Worker-scoped session opened from a capabilities file; app relaunched before every test | ✅ verified |
| `verifyAppInForeground`, `verifyCount`, `verifyText` (label-first iOS text, polling), `verifyTextContains` | ✅ verified |
| `scrollIntoView` with `direction: 'down'` to a row further down the list | ✅ verified |
| `swipeScreen` up and down, checked with `getBoundingBox` | ✅ verified |
| `scrollUntilFound` down and back up | ✅ verified |
| `click` into General and back through the on-screen back button; `verifyPresence`, `verifyAbsence` | ✅ verified |
| `getPageSource` | ✅ verified |
| A web-only step (`getUrl`) and `pressBack` throw `PlatformNotSupportedError` on iOS | ✅ verified |
| The cross-platform navigation spec (`tests/cross-platform/navigation.spec.ts`, the same file as the web run) on iOS, at commit bace1e2: start screen, destination and back through the on-screen back button, and its web-only step (`verifyUrlContains`) refused | ✅ verified |

**The iOS test app (`tests/live/ios-testapp.spec.ts`).** The state-changing iOS paths the read-only Settings spec cannot cover run against the project's iOS test app `com.civitas-cerebrum.test-app`. It runs only when `E2E_PLATFORM=ios` and the capabilities file names the test app; a file naming Settings runs the Settings spec instead, so each iOS spec selects itself by the file. The login-form `hideKeyboard` tests (a keyboard without a Done key) run in both forms: without options, and with the screen title as `tapElement`; the app is portrait only, so the landscape rotation test is skipped as not applicable. How to run it: [tests/capabilities/README.md](tests/capabilities/README.md#the-ios-test-app-spec).

**iOS simulator results (iOS 17.2, the project's iOS test app).** **A run on an iOS simulator is a simulator result, never verification on a real device**: these rows are not entered in the device tables above. Appium 3 with the XCUITest driver, WebdriverIO 10, on 2026-11-26, at commit 34766fa: 27 of 30 tests passed. One between-tests relaunch timed out in WebDriverAgent (`Timed out attempting to launch app`) before the `longPress` test, which passed on rerun; the fixture now retries that launch once (see [Reset policy](#reset-policy)). Two were skipped by design: `hideKeyboard` on the login form (no Done key; waits on a keyboard dismissal fix) and landscape rotation (not applicable, the app is portrait only).

| Area | Status (simulator) |
|---|---|
| A first, non-polling `getPageSource` already sees the test app's home grid | ✅ passed on a simulator |
| `fill`, `getInputValue`, `verifyInputValue`, `clearInput`, `typeSequentially` | ✅ passed on a simulator |
| `hideKeyboard` on a field with a Done key; the field keeps the text | ✅ passed on a simulator |
| `verifyState(..., 'checked')` on switches and checkboxes; `check` / `uncheck`, idempotent | ✅ passed on a simulator |
| `acceptAlert` / `dismissAlert` on the app's own `UIAlertController` | ✅ passed on a simulator |
| `longPress` raises the long-press alert (passed on rerun, see above) | ✅ passed on a simulator |
| `doubleClick`: the double-tap alert, and the counter's increment button raising the counter by two | ✅ passed on a simulator |
| `tapAt` on an element and on the screen | ✅ passed on a simulator |
| `swipe` up on the long list, then `scrollUntilFound` up back to its first row | ✅ passed on a simulator |
| Vertical `scrollIntoView` and `scrollUntilFound` on the tall page | ✅ passed on a simulator |
| Horizontal `scrollIntoView` and fluent `scrollUntilFound` inside the product carousel, passed as the scroll `container` | ✅ passed on a simulator |
| Portrait orientation: the app starts in portrait, `setOrientation` portrait keeps it there | ✅ passed on a simulator |
| `getContexts` (lists `NATIVE_APP`), `switchContext`, `verifyContext` | ✅ passed on a simulator |
| The long list: row container text in `getText`, `verifyText`, `getAll`; `getCount`, `verifyCount`; `verifyListedElement` by row text | ✅ passed on a simulator |
| `verifyCount` with inclusive bounds and an inclusive range, both bounds of a range enforced | ✅ passed on a simulator |
| A web-only step and `pressBack` throw `PlatformNotSupportedError` naming `ios` | ✅ passed on a simulator |
| `hideKeyboard` on a keyboard without a Done key (login form) | ⏸️ `fixme` at that commit; enabled since, in both forms, not yet run |
| `setOrientation` landscape | ⏸️ skipped, not applicable (portrait-only app) |

**Not yet verified on a device:**

* Android: `installApp` / `removeApp`, `openDeepLink`, `setPermission`, system alerts (`acceptAlert` / `dismissAlert`), `longPress`, `tapAt`, `pinch` / `zoom`, and `switchContext`. The live Android spec says why the test app cannot exercise the first four. Each device spec drives one app: the built-in Settings app (iOS, read-only) or the iOS test app (its build may be installed by the capabilities file on a simulator only), and the Android test app, which must already be installed (guard: `tests/cross-platform/appGuard.ts`).
* Failure-evidence attachments (`failure-screenshot`, `page-source`) on a device, on either platform.
* iOS: app install / remove, deep links, `pinch` / `zoom`, contexts on a hybrid app, and `setPermission` (iOS `mobile: setPermission` may work on simulators only). The state-changing paths of the iOS test app (`fill` and the other text-input steps, `hideKeyboard`, `check` / `uncheck`, alerts, `longPress`, `doubleClick`, `tapAt`, `swipe`, carousel scrolling, `setOrientation`) have run on a simulator only (see the simulator table above), not on a real iOS device. `hideKeyboard` on a keyboard without a Done key (the login form, without options and with a `tapElement`) has not yet run with the element-repository dismissal, on a simulator or a device; on Android, `hideKeyboard` on the login form, without options and with a `tapElement`, has not yet run either.
* The CI workflow (emulator and simulator): not yet run.
* `macos` and `windows` are not implemented.
* Any other step not listed in the verified tables above.

---

## 🛠️ API Reference: `Steps`

Every method below automatically resolves the element (a Playwright locator on web, a platform element on a device) using your `pageName` and `elementName` keys from the repository.

### 🧭 Navigation

* **`navigateTo(url: string, options?: { query?: Record<string, string>; waitUntil?: WaitUntilState })`** — Navigates the browser to the specified absolute or relative URL. `query` appends key-value pairs as query parameters. `waitUntil` chooses the page lifecycle state to wait for before resolving — `'load'` (default, unchanged), `'domcontentloaded'`, `'networkidle'`, or `'commit'`. Pass `'domcontentloaded'` for SPA navigations that stall a cold WebKit/Safari on the full `load` event. **Returns the navigation `Response`** (the last redirect's response), or `null` when navigation triggered no network request (same-document hash nav). Read `res.status()` to assert 404 / redirect contracts without dropping to raw `page.goto`; callers that ignore the return value are unaffected.
* **`getUrl()`** — Returns the current page URL (the full href) synchronously. The value-returning companion to `verifyUrlContains` — use it when a test needs the live URL to compute a path, diff against a start URL, or build a pattern.
* **`getCurrentPath()`** — Returns the `pathname` of the current page URL (no origin, query, or hash). Convenience over `new URL(steps.getUrl()).pathname`.
* **`waitForUrl(url: string | RegExp | ((url: URL) => boolean), action?: () => Promise<unknown>, options?: { timeout?: number; waitUntil?: WaitUntilState })`** — Waits until the page URL matches `url`. A string is a glob pattern, a RegExp is a contains-style match, and a predicate receives the live `URL`. Pass `action` to arm the wait **before** the navigation-triggering action runs (issued concurrently via `Promise.all`) so a fast client-side route change cannot complete in the gap between acting and waiting — the race-safe form for rapid navigations. The `action`'s return value is ignored, so a value-returning call (e.g. `() => steps.navigateTo('/x')`, which resolves a `Response | null`) is accepted without a `void`-assignability error.
* **`refresh()`** — Reloads the current page.
* **`backOrForward(direction: 'back' | 'forward')`** — Navigates the browser history stack in the given direction.
* **`setViewport(width: number, height: number)`** — Resizes the browser viewport to the specified pixel dimensions.
* **`switchToNewTab(action: () => Promise<unknown>)`** — Executes an action that opens a new tab (e.g. clicking a link with `target="_blank"`), waits for the new tab, and returns the new `Page` object. The `action`'s return value is ignored, so a value-returning call (e.g. `() => steps.click('walletButton', 'CheckoutPage')`, which resolves a `boolean | void`) is accepted without a `void`-assignability error.
* **`forPage(page: Page): Steps`** — Returns a `Steps` bound to another page of the same test (a popup, a new tab, a second window) that shares the repository, timeouts, API/SQL clients and logging with the original. Use it with `switchToNewTab`: `const popupSteps = steps.forPage(await steps.switchToNewTab(() => steps.click('openHelp', 'HomePage')))`. The original `Steps` stays bound to its own page.
* **`closeTab(targetPage?: Page)`** — Closes the specified tab (or the current one) and returns the remaining active page.
* **`getTabCount()`** — Returns the number of currently open tabs/pages in the browser context.

### 🖱️ Interaction

* **`click(elementName, pageName, options?: StepOptions)`** — Clicks an element. Supports `{ strategy, withoutScrolling, ifPresent, force }`. On pointer interception it falls back to a dispatched DOM `'click'` event, logs a warning, and pushes a report-visible `interception-fallback` test annotation naming `PageName.elementName`; set `interceptionRetry: false` on the fixture to rethrow the original error instead (that opt-out is scoped to the interception fallback). A click that fails is never blind-retried — what happens depends on how it failed:

  | The click failed… | Behaviour |
  |---|---|
  | with a pointer interception | Falls back to `dispatchEvent('click')` (above). |
  | by timing out *after* its input was dispatched | Treated as delivered: logs a warning, pushes a `deadline-click` annotation, and does **not** click again. Your next verification is the gate that it landed. |
  | by timing out while still waiting for actionability | Continues on the *remaining* budget, so total elapsed stays within your `timeout`. |
  | any other way (page closed, strict-mode violation) | Rethrown. |

  Note: `force` dispatches a DOM `'click'` event directly (no pointer simulation, no actionability checks — NOT Playwright's `force: true`); `withoutScrolling` has alias semantics of `force` (no scroll into view). Rename pending in a future major.
* **`clickIfPresent(elementName, pageName)`** — Clicks only if visible; skips silently. Returns `boolean`.
* **`clickRandom(elementName, pageName, options?: StepOptions)`** — Clicks a random element from all matches. Supports `{ withoutScrolling }`.
* **`rightClick(elementName, pageName)`** — Right-clicks an element to trigger a context menu.
* **`doubleClick(elementName, pageName)`** — Double-clicks an element.
* **`check(elementName, pageName)`** — Checks a checkbox or radio button. No-op if already checked. On a device it fails when the tap does not check it or the control is disabled (see the device notes under Platform testing).
* **`uncheck(elementName, pageName)`** — Unchecks a checkbox. No-op if already unchecked. On a device it fails when the tap does not uncheck it, and refuses a checked Android radio button (select another option instead).
* **`hover(elementName, pageName)`** — Hovers over an element to trigger dropdowns or tooltips.
* **`scrollIntoView(elementName, pageName, options?: StepOptions & ScrollStepOptions)`** — Smoothly scrolls an element into the viewport. On a device, `direction` says where the element lies relative to the view (it swipes towards it), `maxSwipes` caps the sweep (default 20) and `container` names the scrollable ancestor to sweep inside (ignored on web); see [Platform steps](#platform-steps) and [Scroll container](#scroll-container).
* **`dragAndDrop(elementName, pageName, options: DragAndDropOptions)`** — Drags an element to a target element (`{ target: Locator | Element }`), by coordinate offset (`{ xOffset, yOffset }`), or both.
* **`dragAndDropListedElement(elementName, pageName, elementText, options: DragAndDropOptions)`** — Finds a specific element by its text from a list, then drags it to a destination.
* **`fill(elementName, pageName, text: string)`** — Clears and fills an input field with the provided text.
* **`uploadFile(elementName, pageName, filePath: string | string[])`** — Uploads one or more files to an `<input type="file">` element. Pass a string array to attach multiple files in a single call.
* **`dropFiles(elementName, pageName, filenames: string[], options?: { mimeType?: string })`** — Simulates dropping files onto a drop-zone by dispatching `dragenter`, `dragover`, and `drop` events with a populated `DataTransfer`. Filenames are basenames only — no real file is read from disk.
* **`selectDropdown(elementName, pageName, options?: DropdownSelectOptions)`** — Selects an option from a `<select>` element and returns its `value`. Defaults to `{ type: DropdownSelectType.RANDOM }`. Also supports `VALUE` (exact match) and `INDEX` (zero-based).
* **`setSliderValue(elementName, pageName, value: number)`** — Sets a range input (`<input type="range">`) to the specified numeric value.
* **`pressKey(key: string)`** — Presses a keyboard key at the page level (e.g. `'Enter'`, `'Escape'`, `'Tab'`).
* **`pressKeys(keys: string[])`** — Presses a multi-key chord at the page level; parts are joined with `+`, so `['Control', 'A']` presses `Control+A`. The intent-revealing companion to `pressKey` for shortcuts where listing the modifiers reads clearer. Throws on an empty array.
* **`dispatchEvent(elementName, pageName, type: string, eventInit?)`** — Dispatches a synthetic DOM event on a named element WITHOUT actionability checks (custom events, firing `input`/`change` on widgets that swallow synthetic typing). Prefer `click`/`fill`/`pressKey` for real user input — this is the controlled escape for driving handlers directly. Example: `await steps.dispatchEvent('searchInput', 'HomePage', 'input')`.
* **`typeSequentially(elementName, pageName, text: string, delay?: number)`** — Types text character by character with a configurable delay (default `100ms`). Ideal for OTP inputs or fields with `keyup` listeners.

### 📊 Data Extraction

* **`getText(elementName, pageName)`** — Returns the trimmed text content of an element, or `null` when the element has no text content.
* **`getAttribute(elementName, pageName, attributeName: string)`** — Returns the value of an HTML attribute (e.g. `href`, `aria-pressed`), or `null` if it doesn't exist.
* **`getLocalStorage(key: string)`** — Reads `window.localStorage[key]`. Returns the stored string or `null` if the key is absent (matches the native `getItem` contract). Use for state the framework cannot reach through the DOM — persisted theme, dismissed-banner flag, feature toggles, auth tokens.
* **`getSessionStorage(key: string)`** — Same shape, against `window.sessionStorage`.
* **`getLocalStorageKeys()`** — Returns every key currently set in `window.localStorage` as a `string[]`. The enumerating companion to `getLocalStorage` — use when the test needs to know *which* keys exist (e.g. asserting a logout cleared all persisted state) rather than reading one known key.
* **`getSessionStorageKeys()`** — Same shape, against `window.sessionStorage`.
* **`setLocalStorage(key: string, value: string)`** — Writes `window.localStorage[key]` (matches the native `setItem` contract; value coerced to string). The mutating companion to `getLocalStorage`. Use to seed persisted state a test depends on, or to drive resilience checks with deliberately malformed values (e.g. corrupt JSON the app must tolerate).
* **`setSessionStorage(key: string, value: string)`** — Same shape, against `window.sessionStorage`.
* **`removeLocalStorage(key: string)`** — Removes a single key from `window.localStorage` (no-op when absent — native `removeItem` contract). The mutating companion to `getLocalStorage`; clears one piece of persisted state without disturbing the rest.
* **`removeSessionStorage(key: string)`** — Same shape, against `window.sessionStorage`.
* **`clearLocalStorage()`** — Removes every key from `window.localStorage` (native `clear` contract). Reset persisted state between phases of a test.
* **`clearSessionStorage()`** — Same shape, against `window.sessionStorage`.
* **`getWindowProperty<T>(path: string)`** — Reads a `window`-level value by dotted path — e.g. `'__XSS_FIRED'`, `'dataLayer.length'`, `'document.title'`. Walks the path key-by-key and returns `undefined` for any missing segment (never throws on a missing path). Use to assert window-state the DOM doesn't surface: analytics layers, injected sentinels, feature flags.
* **`setWindowProperty(path: string, value: unknown)`** — Sets a `window`-level value by dotted path, creating intermediate objects as needed. The mutating companion to `getWindowProperty`; use to seed window-level state a test depends on.
* **`evaluateScript<T>(fn, arg?)`** — The **single labelled escape hatch** for arbitrary in-page JavaScript: `page.evaluate(fn, arg)`, typed and logged. This is the **last resort** — prefer the targeted steps (`getWindowProperty`, `verifyWindowProperty`, the matcher tree, scoped queries), which stay named, retrying, and grep-able. Reach here only when no targeted step expresses the read. Example: `await steps.evaluateScript<number>(() => document.querySelectorAll('a').length)`.

### ✅ Verification

* **`verifyPresence(elementName, pageName)`** — Asserts that an element is attached to the DOM and visible. For an entry declared `"list": true` in the repository (and no narrowing `strategy`), asserts that **at least one** match is visible (count ≥ 1) rather than the first match.
* **`verifyAllPresent(targets: Array<{ elementName, pageName, options? }>)`** — Asserts presence of multiple independent elements in parallel via `Promise.all`. Equivalent to sequential `verifyPresence` calls but resolves all assertions concurrently — useful when a page has many content blocks to assert at once. Example: `await steps.verifyAllPresent([{ elementName: 'title', pageName: 'PDP' }, { elementName: 'price', pageName: 'PDP' }])`.
* **`verifyAbsence(elementName, pageName, options?)`** — Asserts that an element is hidden or detached from the DOM (on a device: absent or not displayed). It resolves the entry through the repository with a short attach slice per `fallback` chain node and passes when no match is visible. The slice is an eighth of the chain's effective timeout, clamped to 250–1000 ms, so `options.timeout` / `.timeout(ms)` buys a slow-hydrating primary more room to attach; the same timeout bounds the underlying `toBeHidden`. For a `fallback` entry it asserts on the variant the repository resolves — the first node that exists — so a primary that exists but is hidden is absent even if the fallback is visible, and a primary that takes longer than the attach slice to attach is treated as missing. A fallback entry whose resolved node matches several elements is asserted on that node's whole match set, so it is absent only when every match is hidden (requires `@civitas-cerebrum/element-repository` 0.3.4 or later). A text selection (`.byText(text)`, or `{ strategy: 'text', text }` in `options`) is asserted on that selection: it passes when the match the selection picks is hidden or when no match has the text, and fails while that match is shown. It checks only the match the selection picks (on web the first element containing the text; on a device an exact text match, else the first containing match), so a hidden first match passes even while a later match with the same text is shown. To assert that no element with the text is shown, use the plain entry (no `.byText()`) with an attribute- or text-specific selector in the repository, such as `{ "css": "li.row:has-text('Sale')" }` on web or an accessibility id / predicate that names the text on a device.
* **`verifyText(elementName, pageName, expectedText?)`** — Asserts element text. Provide `expectedText` for an exact match, or call with no args to assert not empty.
* **`verifyCount(elementName, pageName, options: CountVerifyOptions)`** — Asserts element count, polling until the timeout. Accepts `{ exactly: number }`, or a range of at most one lower bound (`greaterThan` or `greaterThanOrEqual`) and at most one upper bound (`lessThan` or `lessThanOrEqual`), e.g. `{ greaterThanOrEqual: 6 }`, `{ greaterThan: 1, lessThan: 3 }`, `{ greaterThan: 0, lessThanOrEqual: 10 }`; every given bound must hold. A failure names the bound the last count broke (`6 is not < 3`). Contradictory options (`exactly` with a bound, two lower or two upper bounds, a range no count satisfies such as `{ greaterThan: 3, lessThan: 4 }`) and empty options throw at once, before the element is resolved. The fluent `steps.on(el, page).verifyCount(options)` is the same step.
* **`verifyImages(elementName, pageName, scroll?: boolean, options?: StepOptions & { verifyDecoded?: boolean })`** — Verifies image rendering: checks visibility, valid `src`, and `naturalWidth > 0`. Pass `{ verifyDecoded: true }` in `options` to also run the browser's native `decode()` round-trip (more thorough, adds a CDP round-trip per image; off by default). Scrolls into view by default.
* **`verifyTextContains(elementName, pageName, expectedText: string)`** — Asserts that an element's text contains the expected substring.
* **`verifyState(elementName, pageName, state)`** — Asserts the state of an element. Supported states: `'enabled'`, `'disabled'`, `'editable'`, `'checked'`, `'focused'`, `'visible'`, `'hidden'`, `'attached'`, `'inViewport'`.
* **`verifyAttribute(elementName, pageName, attributeName: string, expectedValue: string)`** — Asserts that an element has a specific HTML attribute with an exact value.
* **`verifyUrlContains(text: string)`** — Asserts that the current URL contains the expected substring.
* **`verifyPageContainsText(text: string | RegExp, options?: { timeout?: number; errorMessage?: string })`** — Page-level mirror of `verifyTextContains`. Asserts the document body contains `text` (substring or RegExp), with web-first retry. Use for page-wide copy where no single element is the natural scope. Example: `await steps.verifyPageContainsText(/404|niet gevonden/i)`.
* **`verifyPageNotContainsText(text: string | RegExp, options?: { timeout?: number; errorMessage?: string })`** — Negated companion. Asserts the body does **not** contain `text`. Use for "not a 404" / no-error-copy body checks. Text-level: raw markup never appears in rendered text — for markup-level assertions use `verifyPageHtmlContains(html, { negated: true })`. Example: `await steps.verifyPageNotContainsText(/server error/i)`.
* **`verifyPageTitle(title: string | RegExp, options?: { timeout?: number; errorMessage?: string })`** — Asserts the page `<title>` equals the string or matches the RegExp. Wraps `expect(page).toHaveTitle`.
* **`verifyInputValue(elementName, pageName, expectedValue: string)`** — Asserts that an input, textarea, or select element has the expected value.
* **`verifyTabCount(expectedCount: number)`** — Asserts the number of currently open tabs/pages in the browser context.
* **`verifyLocalStorage(key: string, options: StorageVerifyOptions)`** — Asserts a property of `localStorage[key]`. Pick exactly one matcher in the options: `{ equals: string }` (exact match), `{ contains: string }` (substring), `{ matches: RegExp }`, or `{ present: boolean }` (existence). All four forms also accept `negated`, `timeout`, and `errorMessage`. Polls until the predicate holds or the timeout expires, so it survives the race between a UI action firing and its persistence side-effect landing.
* **`verifySessionStorage(key: string, options: StorageVerifyOptions)`** — Same shape, against `window.sessionStorage`.
* **`verifyWindowProperty(path: string, options: WindowVerifyOptions)`** — Retrying assertion over a `window`-level value read by dotted path. Pick exactly one matcher: `{ equals }`, `{ contains }` (substring / array membership), `{ matches: RegExp }`, `{ present: boolean }`, `{ truthy: boolean }`, `{ greaterThan: number }`, or `{ lessThan: number }`. All forms also accept `negated`, `timeout`, and `errorMessage`. Polls until the predicate holds (or its negation) or the timeout expires.
* **`expectNoRequest(urlPattern: string | RegExp, action, options?: { timeout?: number; methods?: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS')[]; redactQuery?: boolean })`** — Negative companion to `waitForResponse`. Asserts that **no** request matching `urlPattern` fires during `action` (and an observation window after, default `1000`ms). Use to prove a client-side block — HTML5 `required`, native `type=email` validation, custom JS guards — short-circuits before the XHR is issued. Strings are Playwright globs (same semantics as `waitForResponse`); reach for a RegExp for contains-style matches. Throws with the offending `method url` lines when a matching request did fire. **Secret-leak surface**: the offender URL is included verbatim in the thrown error (which flows into runner output and Playwright traces) — pass `{ redactQuery: true }` when your URLs may carry tokens or API keys in query parameters.

```ts
// Examples
await steps.verifyLocalStorage('theme', { equals: 'dark' });
await steps.verifyLocalStorage('flag', { contains: 'enabled' });
await steps.verifyLocalStorage('build', { matches: /^v\d+$/ });
await steps.verifyLocalStorage('seen', { present: true });
await steps.verifyLocalStorage('temp', { present: false });                  // absence
await steps.verifyLocalStorage('theme', { equals: 'light', negated: true }); // not equal

// Window-level state (analytics layers, injected flags, XSS sentinels)
await steps.verifyWindowProperty('dataLayer.length', { greaterThan: 0 });
await steps.verifyWindowProperty('__test.flag', { equals: true });
await steps.verifyWindowProperty('__XSS_FIRED', { present: false });          // sentinel never fired
await steps.verifyWindowProperty('document.title', { matches: /Wishlist/i });
```

### 🌐 Session-aware HTTP requests

Backed by Playwright's `page.request` (`APIRequestContext`), which **shares the browser context's cookies/session** — the right tool for authenticated redirect / protected-route contract checks (e.g. "hitting `/account` while logged out 30x-redirects to `/login`"). Distinct from the wasapi `api*` external-service client. Each verb returns a typed `BrowserResponse`; `failOnStatusCode` defaults to `false` so status assertions work on 4xx/5xx responses.

```ts
import { BrowserResponse, BrowserRequestOptions } from '@civitas-cerebrum/element-interactions';
```

* **`requestGet(url, opts?)`** / **`requestPost`** / **`requestPut`** / **`requestPatch`** / **`requestDelete`** / **`requestHead`** — Thin wrappers over `page.request.<verb>`. `opts: { maxRedirects?, headers?, params?, data?, form?, failOnStatusCode?, timeout? }` pass through to Playwright's request options. Return a `BrowserResponse`: `{ status, ok, url, headers, statusText, json<T>(), text(), body() }`.
* **`verifyRequestStatus(res: BrowserResponse, code: number)`** — Asserts the response status equals `code` (simple throw helper; the response is already resolved).
* **`verifyRequestHeader(res: BrowserResponse, name: string, value?: string | RegExp)`** — Asserts a header is present (name match is case-insensitive). Omit `value` for presence only; a string asserts exact equality (values are case-sensitive, matching `verifyApiHeader` — use a `RegExp` with `/i` for case-insensitive matching); a `RegExp` asserts a match.
* **`verifyRequestOk(res: BrowserResponse)`** — Asserts the response is a 2xx success.

```ts
const res = await steps.requestGet('/account', { maxRedirects: 0 });   // uses the logged-in session
await steps.verifyRequestStatus(res, 307);
await steps.verifyRequestHeader(res, 'location', /\/login/);
expect(await res.text()).toContain('Sign in');
```

### 🔍 Visibility — Probe + Gate

* **`isVisible(elementName, pageName, options?)`** — Dual-behavior entry point. Returns a `VisibleChain` that is both:
  - **awaitable as `Promise<boolean>`** — the probe, never throws. `await steps.isVisible(...)` resolves to `true` / `false`.
  - **chainable with action methods and the matcher tree** — the gate, silently skips when hidden. On a device a web-only terminal (`hover`, `rightClick`, `uploadFile`, `selectDropdown`, `setSliderValue`, `selectMultiple`, `css(...)`) throws `PlatformNotSupportedError(step, platform)` before the probe instead of being skipped.
  Options: `{ timeout?: number (default 2000), containsText?: string }`.
  The probe resolves the entry through the repository exactly like an action does — role + accessible name, regex text, `fallback` chains, frame-scoped pages and the chain's own strategy selector (`.nth(i)`, `.byText(...)`, `.byAttribute(...)`) are all honoured — and uses `timeout` as its whole budget, so a missing element reports `false` after about `timeout` ms, never after the repository default. Within that budget the probe re-resolves the entry rather than resolving once and waiting, because a `fallback` chain resolves to whichever node is attached *while the walk runs*: an entry whose primary hydrates part-way into the probe is picked up instead of being answered on the fallback the first walk settled for. Each walk gives the repository a fixed 250 ms per chain node, so a long chain costs the same whatever the budget; a walk is not interruptible, so an entry with a long chain can exceed `timeout` by at most one walk.
* **`isPresent(elementName, pageName)`** — Boolean presence check with the default element timeout. Equivalent to `await element.isVisible()` on the resolved element.

```ts
// Probe — boolean
const ok = await steps.isVisible('banner', 'Page', { timeout: 500 });

// Gate — click only if visible (no throw)
await steps.isVisible('cookieBanner', 'Page').click();

// Gate with text filter
await steps.isVisible('promo', 'Page', { containsText: '50% off' }).click();

// Matcher tree — silently skipped when hidden
await steps.isVisible('banner', 'Page').text.toBe('Hello');
```

Every probe and gate decision is logged under the `tester:visible` debug channel with a `[probe]` or `[gate]` tag so silently-skipped actions stay debuggable.

> **`ifVisible()` is deprecated** in favor of `isVisible()`. It remains available as a backwards-compatible alias on `ElementAction`.

### 📋 Listed Elements

Operate on a specific element within a list (table rows, cards, list items) by matching its visible text or an HTML attribute. Optionally drill into a child element within the matched item.

```ts
import { ListedElementMatch, VerifyListedOptions, GetListedDataOptions } from '@civitas-cerebrum/element-interactions';
```

* **`clickListedElement(elementName, pageName, options: ListedElementMatch)`** — Finds and clicks a specific element from a list. Identify the target by `{ text }` or `{ attribute: { name, value } }`, and optionally drill into a child with `{ child: 'css-selector' }` or `{ child: { pageName, elementName } }`.
* **`verifyListedElement(elementName, pageName, options: VerifyListedOptions)`** — Finds a listed element and asserts against it. Use `{ expectedText }` to verify text, `{ expected: { name, value } }` to verify an attribute, or omit both to assert visibility.
* **`getListedElementData(elementName, pageName, options: GetListedDataOptions)`** — Extracts data from a listed element. Returns the element's text content by default, or an attribute value when `{ extractAttribute: 'attrName' }` is specified.

```ts
// Click the row containing "John"
await steps.clickListedElement('tableRows', 'UsersPage', { text: 'John' });

// Click a child button inside the row matching an attribute
await steps.clickListedElement('tableRows', 'UsersPage', {
  attribute: { name: 'data-id', value: '5' },
  child: 'button.edit'
});

// Verify text of a child cell in the row containing "Name"
await steps.verifyListedElement('submissionEntries', 'FormsPage', {
  text: 'Name',
  child: 'td:nth-child(2)',
  expectedText: 'John Doe'
});

// Verify an attribute on a listed element
await steps.verifyListedElement('tableRows', 'UsersPage', {
  attribute: { name: 'data-id', value: '5' },
  expected: { name: 'class', value: 'active' }
});

// Extract an href from a child link inside a listed element
const href = await steps.getListedElementData('tableRows', 'UsersPage', {
  text: 'John',
  child: 'a.profile-link',
  extractAttribute: 'href'
});

// Regex text match — pick any row whose text matches the pattern
await steps.clickListedElement('tableRows', 'Users', {
  text: { regex: 'Alice|Bob|Carol', flags: 'i' }
});

// withDescendant — match only rows that contain a specific descendant element
await steps.clickListedElement('tableRows', 'Users', {
  text: 'John',
  withDescendant: { pageName: 'Users', elementName: 'activeBadge' }
});
```

### ⏳ Wait

* **`waitForState(elementName, pageName, state?: 'visible' | 'attached' | 'hidden' | 'detached', options?)`** — Waits for an element to reach a specific DOM state. Defaults to `'visible'`. Returns `Promise<boolean>`. **Throws on timeout as of 0.3.7**; pass `{ optional: true }` to probe without failing (resolves `false` instead). `{ timeout: ms }` overrides the instance timeout per call.

  ```ts
  await steps.waitForState('confirmationModal', 'CheckoutPage', 'visible');                        // throws on timeout (0.3.7+)
  const open = await steps.waitForState('promoBanner', 'HomePage', 'visible', { optional: true }); // probe — false on timeout
  ```

* **`waitForNetworkIdle(options?: { timeout?: number; optional?: boolean })`** — Waits until there are no in-flight network requests for at least 500ms. `timeout` sets a per-call bound (without it, Playwright's default timeout applies — configurable via `page.setDefaultTimeout` / the test config). `optional: true` resolves quietly on a `TimeoutError` instead of throwing, for best-effort settling where lingering traffic should not fail the test (real failures still throw). With no options, behaviour is unchanged.
* **`waitForLoadState(state: LoadState, options?: { timeout?: number })`** — Waits for the page to reach the given lifecycle `state` (`'load'`, `'domcontentloaded'`, or `'networkidle'`). The general-purpose lifecycle-wait companion to `waitForNetworkIdle` (which is fixed to `'networkidle'`): use it for a standalone wait **after an action** that does not navigate — e.g. waiting for `'domcontentloaded'` once a client-side view swap finishes. `options.timeout` bounds the wait.
* **`pace(ms: number)`** — A deliberate pause, named `pace` (NOT `wait`) to signal intentional timing control — settling a debounce, spacing rapid-fire actions — never a substitute for a wait-for-state (prefer `waitForState` / `waitForUrl` / a web-first assertion when you are actually waiting for the app to reach a condition). Throws on a negative or non-finite duration. Mirrored on `Utils.pace`.
* **`repeat(action, times, options?: { intervalMs? })`** — Runs `action` `times` times in sequence (passing the zero-based index) and returns every result in order; with `intervalMs`, paces BETWEEN iterations (never before the first or after the last). The intent-revealing form of "do X rapidly N times". Throws unless `times` is a non-negative integer. Example: `await steps.repeat(i => steps.on('swatch', 'PDP').nth(i).click(), 3, { intervalMs: 120 })`. Mirrored on `Utils.repeat`.
* **`waitForResponse(urlPattern: string | RegExp, action: () => Promise<void>)`** — Executes an action and waits for a matching network response. Returns the `Response` object. For the negative companion (asserting **no** matching request fires), see `expectNoRequest` in the Verification section.
* **`waitAndClick(elementName, pageName, state?: string, options?)`** — Waits for an element to reach a state (default `'visible'`), then clicks it. Throws when the element never reaches the state — `optional` softness is deliberately not inherited here.

### 🧩 Composite / Workflow

* **`fillForm(pageName, fields: Record<string, FillFormValue>)`** — Fills multiple form fields in one call. String values fill text inputs; `DropdownSelectOptions` values trigger dropdown selection.
* **`retryUntil(action, verification, maxRetries?, delayMs?)`** — Retries an action until a verification passes, or until the max attempts (default `3`) are reached.
* **`clearInput(elementName, pageName)`** — Clears the value of an input or textarea without filling new text.
* **`selectMultiple(elementName, pageName, values: string[])`** — Selects multiple options from a `<select multiple>` element by their value attributes.
* **`clickNth(elementName, pageName, index: number)`** — Clicks the element at a specific zero-based index from all matches.

### 📊 Additional Data Extraction

* **`getAll(elementName, pageName, options?: GetAllOptions)`** — Extracts text (or attributes) from all matching elements. Supports `{ child }` and `{ extractAttribute }`. For an entry declared `"list": true`, waits for at least one match and throws when there is none (count ≥ 1); other entries return `[]` when nothing matches.
* **`getCount(elementName, pageName)`** — Returns the number of DOM elements matching the locator.
* **`getInputValue(elementName, pageName)`** — Returns the current `value` property of an input, textarea, or select element.
* **`getCssProperty(elementName, pageName, property: string)`** — Returns a computed CSS property value (e.g. `'rgb(255, 0, 0)'`).
* **`getBoundingBox(elementName, pageName, options?)`** — Returns the element's bounding box `{ x, y, width, height }` (CSS pixels, main-frame relative), or `null` when the element is not rendered (short-circuits on zero matches instead of blocking on `boundingBox()`'s auto-wait). Use for layout/geometry assertions the DOM doesn't otherwise surface: overlap, off-screen positioning, collapsed `0×0` regions. Mirrored on `Extractions.getBoundingBox`.
* **`getPageText()`** — Returns the rendered text of the current page (`document.body.innerText`). The page-level text companion to `getPageHtml` — use for page-level text assertions where no single element is the natural scope (e.g. confirming a 404 body renders known copy).

### ✅ Additional Verification

* **`verifyOrder(elementName, pageName, expectedTexts: string[])`** — Asserts that elements' text contents appear in the exact order specified.
* **`verifyCssProperty(elementName, pageName, property: string, expectedValue: string)`** — Asserts that a computed CSS property matches the expected value.
* **`verifyListOrder(elementName, pageName, direction: 'asc' | 'desc')`** — Asserts that elements' text contents are sorted in the specified direction.

### 📸 Screenshot

* **`screenshot()`** — Captures a page screenshot. Pass `{ fullPage: true }` for scrollable capture, `{ path: 'file.png' }` to save to disk.
* **`screenshot(elementName, pageName, options?)`** — Captures a screenshot of a specific element.

### 🎯 Visual Regression — `verifyVisualMatch`

Visual regression tests are great until your UI has dynamic data. A clock that ticks every second, a generated transaction id, or an "updated 3 minutes ago" badge is enough to break a baseline snapshot — your test fails on the first run, then again, then again, you give up and disable it.

You don't have to. Playwright has a `mask` option built right into `toHaveScreenshot`: pass a list of locators and Playwright paints a solid box over those regions before the snapshot is captured, so the rest of the page stays pixel-perfect for comparison.

`verifyVisualMatch` is the framework's facade over that capability — masks are referenced by `{ elementName, pageName }` (the same shape every other step uses), so you don't have to drop into raw Playwright locators.

```ts
// Page-level. The dashboard has a `currentTime` and a `transactionId` that
// change every run. Both get masked. The snapshot stays stable.
await steps.verifyVisualMatch('dashboard.png', {
  mask: [
    { elementName: 'currentTime',   pageName: 'DashboardPage' },
    { elementName: 'transactionId', pageName: 'DashboardPage' },
  ],
});

// Element-level. Scope the snapshot to the header; mask sub-regions inside it.
await steps.verifyVisualMatch('header.png', {
  elementName: 'header',
  pageName:    'DashboardPage',
  mask: [{ elementName: 'liveCounter', pageName: 'DashboardPage' }],
});

// Raw selector escape hatch — for regions that don't warrant a repo entry.
await steps.verifyVisualMatch('dashboard.png', {
  mask: [{ selector: '[data-testid="current-time"]' }],
});
```

**When to use it.** Any UI that has live counters, charts, timestamps, randomly-generated ids, user avatars, or "updated N minutes ago" badges. Mask the dynamic regions once and sleep at night like a baby. The pattern is part of every recommended test-composition flow in the framework's skill suite — coverage-expansion composers, happy-path tests, and adversarial probes all benefit when the surface they're locking down has any content-level dynamism.

**What you don't have to worry about.** CSS animations are disabled by default during the snapshot (Playwright's own `animations: 'disabled'`). You only need `mask` for content-level dynamism — no need for animation-freezing CSS hacks.

**Baselines.** The first run writes the baseline; subsequent runs diff. Use `npx playwright test --update-snapshots` to refresh baselines intentionally. Playwright fingerprints baselines per OS / browser channel, so generate them in the same environment your CI runs.

**Full options surface.** `mask`, `maskColor`, `fullPage`, `maxDiffPixelRatio`, `maxDiffPixels`, `timeout`, `errorMessage`. See [`VisualMatchOptions`](./src/enum/Options.ts).

### 📱 Platform

The steps below drive native apps (see [Platform testing](#-platform-testing-android-ios)). "Platform only" steps throw `PlatformNotSupportedError` on web before anything is resolved or sent. `appId` defaults to the app under test from the capabilities file (`appium:appPackage` / `appium:bundleId`); a step that needs one and finds none throws `MissingAppIdError`.

* **`platform: Platform`** — The platform these steps act on (`'web'`, `'android'`, `'ios'`, ...), read-only: `steps.platform`.

### 📱 App

* **`launchApp(appId?: string)`** — Launches the app, starting it when it is not running. Platform only; throws `PlatformNotSupportedError` on web.
* **`activateApp(appId?: string)`** — Brings the app to the foreground, starting it when needed. Platform only; throws `PlatformNotSupportedError` on web.
* **`terminateApp(appId?: string)`** — Terminates the app. Platform only; throws `PlatformNotSupportedError` on web.
* **`backgroundApp(seconds: number)`** — Sends the app under test to the background for `seconds` (non-negative, finite), then brings it back. Platform only; throws `PlatformNotSupportedError` on web.
* **`resetApp()`** — Terminates and re-activates the app under test. Platform only; throws `PlatformNotSupportedError` on web.
* **`installApp(appPath: string)`** — Installs an app from an `.apk` / `.app` / `.ipa` path or URL the Appium server can reach. Platform only; throws `PlatformNotSupportedError` on web.
* **`removeApp(appId: string)`** — Uninstalls the app `appId` (Android package / iOS bundle id). Platform only; throws `PlatformNotSupportedError` on web.
* **`openDeepLink(url: string, appId?: string)`** — Opens a deep link (custom scheme or universal / app link) in `appId`, the app under test by default. Platform only; throws `PlatformNotSupportedError` on web.

### 📱 Gestures

* **`swipe(elementName, pageName, direction: SwipeDirection, options?: StepOptions & SwipeOptions)`** — Swipes on the element: the finger moves in `direction` through its centre (`'up'` reveals content below); `distance` is the finger travel in px. Every platform: on web a mouse drag.
* **`swipeScreen(direction: SwipeDirection, options?: ScreenSwipeOptions)`** — Swipes across the screen through its centre, clear of the system gesture zones; `distance` defaults to half the screen along that axis. Platform only; throws `PlatformNotSupportedError` on web.
* **`scrollUntilFound(elementName, pageName, options?: StepOptions & ScrollStepOptions)`** — Swipes until the element is displayed; throws when `timeout` expires or `maxSwipes` (default 20) is reached first. `direction` is where the element lies (default `'down'`); `container` names the scrollable ancestor to sweep inside (see [Scroll container](#scroll-container)). Every platform: on web the browser scrolls the element into view.
* **`longPress(elementName, pageName, options?: StepOptions & LongPressOptions)`** — Presses and holds the element for `duration` ms (default 1000). Every platform: on web the mouse button is held.
* **`tapAt(x: number, y: number)`** — Taps the screen at (`x`, `y`) px, native-context screen coordinates. Platform only; throws `PlatformNotSupportedError` on web. To tap inside an element on every platform use the chain: `steps.on(el, page).tapAt({ x, y })`.
* **`pinch(elementName, pageName, options?: StepOptions & PinchOptions)`** — Two-finger pinch (fingers move together) on the element, `scale` in (0, 1), default 0.5. Platform only; throws `PlatformNotSupportedError` on web.
* **`zoom(elementName, pageName, options?: StepOptions & ZoomOptions)`** — Two-finger zoom (fingers spread) on the element, `scale` above 1, default 2. Platform only; throws `PlatformNotSupportedError` on web.

`scrollIntoView(elementName, pageName, options?: StepOptions & ScrollStepOptions)` is listed under [Interaction](#️-interaction). The fluent chain has the element gestures as terminals: see [Gesture terminals](#gesture-terminals).

### 📱 Device

* **`pressBack()`** — Presses the system back button. Android only; throws `PlatformNotSupportedError` on web and on ios (tap the on-screen back button there).
* **`hideKeyboard(options?: HideKeyboardOptions)`** — Hides the on-screen keyboard with element-repository's `dismissKeyboard` and returns whether it had to: `true` when a keyboard was shown and is now gone, `false` only when no keyboard was shown, in which case nothing else is sent. element-repository's check (WebdriverIO's `isKeyboardShown()`) also answers "no keyboard" when the driver lacks that method or the check fails, so that answer is checked again with `mobile: isKeyboardShown`: when it reports a keyboard, or fails, the step throws `hideKeyboard: the keyboard state could not be confirmed and nothing was sent: <reason>` (a fatal driver error of that check passes unchanged). iOS tries, in order: a tap on `options.tapElement` (when given), a bare `mobile: hideKeyboard`, then `mobile: hideKeyboard` with the action-key names (done, return, go, search, send, join); Android sends WebdriverIO's `hideKeyboard()` and then the two legacy `mobile: hideKeyboard` strategies. The keyboard is checked again after every step. **Warning:** without a neutral element, iOS may press the keyboard's action key, which can submit a form or run a search. To avoid it, name a neutral element on the screen that does nothing when tapped and is not covered by the keyboard (a screen title, a navigation-bar label) by its repository entry: `await steps.hideKeyboard({ tapElement: { pageName: 'LoginPage', elementName: 'title' } })`. `tapElement` takes `{ pageName, elementName }`, the form the listed-element `child` option takes; it is resolved through the repository on every device platform (an entry the page does not define fails with `hideKeyboard: tapElement "<name>" on page "<page>" could not be resolved: ...` before anything is sent), and Android ignores the tap. `options.timeout` (ms) is one budget for the whole step: the `tapElement` resolution spends from it and the dismissal gets only what is left. The dismissal checks the budget before each of its steps, and a step it has started runs to its end (with its 300 ms pause and keyboard check), so the call can end up to one dismissal step after `timeout` (on iOS the bare `mobile: hideKeyboard`, which WebDriverAgent refuses on a keyboard without a Done key after about 3.5 s on a simulator, is the longest). A dismissal stopped by the budget throws `KeyboardStillShownError` ending in `(timeout <ms> ms)`, the time that was left for it. Without `timeout` the dismissal steps bound the call. A keyboard still shown after every step throws element-repository's `KeyboardStillShownError` (its `steps` lists the steps tried), re-exported by this package so `instanceof` works; it is passed through unchanged rather than wrapped, so the step names and the error class stay the ones element-repository documents. A fatal driver error (dead session) also passes unchanged. It does not use element-repository's `dismissKeyboard({ strict: true })`, and `KeyboardStateUnknownError` is never thrown (so not re-exported): strict mode trusts WebdriverIO's `isKeyboardShown()` alone, so it throws when that check is missing or fails even though the device's `mobile: isKeyboardShown` can tell there is no keyboard, and answers `false` when that check says no keyboard while the device shows one; `hideKeyboard` confirms every "no keyboard" with `mobile: isKeyboardShown` instead. Platform only; throws `PlatformNotSupportedError` on web before `tapElement` is resolved.
* **`setOrientation(orientation: Orientation)`** — Rotates the device to `'portrait'` or `'landscape'`. Platform only; throws `PlatformNotSupportedError` on web.
* **`acceptAlert()`** — Accepts the open system or app alert. Platform only; throws `PlatformNotSupportedError` on web.
* **`dismissAlert()`** — Dismisses the open system or app alert. Platform only; throws `PlatformNotSupportedError` on web.
* **`setPermission(permission: string, state: PermissionState)`** — Grants, denies or resets a permission of the app under test; `permission` is the platform's name (`android.permission.CAMERA`, or an iOS service such as `camera`), `state` is `'grant'`, `'deny'` or `'reset'` (on Android `'reset'` revokes). Platform only; throws `PlatformNotSupportedError` on web.

### 📱 Contexts and page source

* **`getContexts(): Promise<string[]>`** — Returns the available contexts (`'NATIVE_APP'`, `'WEBVIEW_*'`). Platform only; throws `PlatformNotSupportedError` on web.
* **`switchContext(name: string)`** — Switches to the context `name` (`'NATIVE_APP'` or a `'WEBVIEW_*'` name). Platform only; throws `PlatformNotSupportedError` on web.
* **`getPageSource(): Promise<string>`** — Returns the current screen's UI hierarchy as XML. Platform only; throws `PlatformNotSupportedError` on web. On web use `getPageHtml`.

### 📱 Device assertions

Each polls until `options.timeout` (default the step timeout) and then throws `PollTimeoutError` naming the last observed value; `errorMessage` replaces the failure header.

* **`verifyAppInForeground(appId?: string, options?: DeviceVerifyOptions)`** — Asserts the app is in the foreground. Platform only; throws `PlatformNotSupportedError` on web.
* **`verifyOrientation(orientation: Orientation, options?: DeviceVerifyOptions)`** — Asserts the device reports `orientation` (`'portrait'` or `'landscape'`; any other value throws at once). Platform only; throws `PlatformNotSupportedError` on web.
* **`verifyKeyboardShown(options?: DeviceVerifyOptions & { negated?: boolean })`** — Asserts the on-screen keyboard is shown, or hidden with `{ negated: true }`. Platform only; throws `PlatformNotSupportedError` on web.
* **`verifyContext(name: string, options?: DeviceVerifyOptions)`** — Asserts the current context is `name`. Platform only; throws `PlatformNotSupportedError` on web.

---

## 🧱 Advanced: Raw Interactions API

To bypass the `Steps` facade, use `ElementInteractions` directly. All methods take a `WebElement` — the element type the repository resolves. Raw Playwright `Locator`s are not accepted; wrap one in `new WebElement(locator)` at the seam if you must bridge:

```ts
import { ElementInteractions } from '@civitas-cerebrum/element-interactions';
import { WebElement } from '@civitas-cerebrum/element-repository';

const interactions = new ElementInteractions(page);

// Elements come from the repository (the `repo` fixture)
const element = await repo.get('submitButton', 'LoginPage') as WebElement;
await interactions.interact.click(element, { withoutScrolling: true });
await interactions.verify.presence(element);

// Bridging a hand-built locator (one-off escape hatch — prefer a repository entry)
const custom = new WebElement(page.locator('button.dynamic-class'));
await interactions.verify.count(custom, { greaterThan: 2 });
```

All `interact`, `verify`, `extract`, and `navigate` methods are available on `ElementInteractions`.

**Sanctioned escape hatches.** When the facade genuinely doesn't cover what you need:

- **Element-level** — `(element as WebElement).locator` exposes the underlying Playwright `Locator` of a repository-resolved element, e.g. for a raw Playwright expectation: `expect((element as WebElement).locator).toHaveScreenshot()`.
- **Page-level** — use the `page` fixture directly for page-scoped Playwright APIs the facade doesn't wrap (dialogs, downloads, `page.on(...)` events).

If you reach for either of these more than once for the same need, that's an API gap — file an issue so the capability can land in the framework properly.

---

## 📧 Email API

Send and receive emails in your tests. Supports plain text, inline HTML, and HTML file templates for full customisation.

### Setup

Pass email credentials to `baseFixture` via the options parameter. Configure `smtp`, `imap`, or both depending on which features you need:

```ts
// tests/fixtures/base.ts
import { test as base, expect } from '@playwright/test';
import { baseFixture } from '@civitas-cerebrum/element-interactions';

export const test = baseFixture(base, 'tests/data/page-repository.json', {
  emailCredentials: {
    smtp: {
      email: process.env.SENDER_EMAIL!,
      password: process.env.SENDER_PASSWORD!,
      host: process.env.SENDER_SMTP_HOST!,
    },
    imap: {
      email: process.env.RECEIVER_EMAIL!,
      password: process.env.RECEIVER_PASSWORD!,
    },
  }
});
export { expect };
```

Only need to send? Provide `smtp` only. Only need to receive? Provide `imap` only. The client will throw a clear error if you call a method that requires the missing credential.

### Sending Emails

```ts
// Plain text
await steps.sendEmail({
  to: 'user@example.com',
  subject: 'Test Email',
  text: 'Hello from Playwright!'
});

// Inline HTML
await steps.sendEmail({
  to: 'user@example.com',
  subject: 'HTML Email',
  html: '<h1>Hello</h1><p>Inline HTML content</p>'
});

// HTML file from project directory — great for branded templates
await steps.sendEmail({
  to: 'user@example.com',
  subject: 'Monthly Report',
  htmlFile: 'emails/report-template.html'
});
```

### Receiving Emails

Use composable filters to search the inbox. Combine as many filters as needed — all are applied with AND logic. Filtering tries exact match first, then falls back to partial case-insensitive match (with a warning log).

```ts
import { EmailFilterType } from '@civitas-cerebrum/element-interactions';
// Note: EmailFilterType and other email types can also be imported from '@civitas-cerebrum/email-client'

// Single filter — get the latest matching email
const email = await steps.receiveEmail({
  filters: [{ type: EmailFilterType.SUBJECT, value: 'Your OTP Code' }]
});

// Open the downloaded HTML in the browser
await steps.navigateTo('file://' + email.filePath);

// Now interact with the email content like any web page
const otpCode = await steps.getText('otpCode', 'EmailPage');

// Combine multiple filters
const email2 = await steps.receiveEmail({
  filters: [
    { type: EmailFilterType.SUBJECT, value: 'Verification' },
    { type: EmailFilterType.FROM, value: 'noreply@example.com' },
    { type: EmailFilterType.CONTENT, value: 'verification code' },
  ]
});

// Get ALL matching emails
const allEmails = await steps.receiveAllEmails({
  filters: [
    { type: EmailFilterType.FROM, value: 'alerts@example.com' },
    { type: EmailFilterType.SINCE, value: new Date('2025-01-01') },
  ]
});
```

### Marking Emails

Mark emails as read, unread, flagged, unflagged, or archived:

```ts
import { EmailMarkAction } from '@civitas-cerebrum/element-interactions';

// Mark matching emails as read
await steps.markEmail(EmailMarkAction.READ, {
  filters: [{ type: EmailFilterType.SUBJECT, value: 'OTP' }]
});

// Flag all emails from a sender
await steps.markEmail(EmailMarkAction.FLAGGED, {
  filters: [{ type: EmailFilterType.FROM, value: 'noreply@example.com' }]
});

// Archive emails
await steps.markEmail(EmailMarkAction.ARCHIVED, {
  filters: [{ type: EmailFilterType.SUBJECT, value: 'Report' }]
});

// Mark all emails in folder
await steps.markEmail(EmailMarkAction.UNREAD);
```

### Cleaning the Inbox

Delete emails matching filters, or clean the entire inbox:

```ts
// Delete emails from a specific sender
await steps.cleanEmails({
  filters: [{ type: EmailFilterType.FROM, value: 'noreply@example.com' }]
});

// Delete all emails in the inbox
await steps.cleanEmails();
```

**Filter types (`EmailFilterType`):**

| Type | Value Type | Description |
|---|---|---|
| `SUBJECT` | `string` | Filter by email subject |
| `FROM` | `string` | Filter by sender address |
| `TO` | `string` | Filter by recipient address |
| `CONTENT` | `string` | Filter by email body (HTML or plain text) |
| `SINCE` | `Date` | Only include emails received after this date |

**`receiveEmail()` / `receiveAllEmails()` options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `filters` | `EmailFilter[]` | — | **Required.** Composable filters (AND logic) |
| `folder` | `string` | `'INBOX'` | IMAP folder to search |
| `waitTimeout` | `number` | `30000` | Max time (ms) to wait for a match |
| `pollInterval` | `number` | `3000` | How often (ms) to poll the inbox |
| `expectedCount` | `number` | — | Specific number of expected results |
| `maxFetchLimit` | `number` | `50` | Max emails to fetch per polling cycle |
| `downloadDir` | `string` | `os.tmpdir()/pw-emails` | Where to save the downloaded HTML |

**`ReceivedEmail` return type:**

| Property | Type | Description |
|---|---|---|
| `filePath` | `string` | Absolute path to the downloaded HTML file |
| `subject` | `string` | Email subject line |
| `from` | `string` | Sender address |
| `date` | `Date` | When the email was sent |
| `html` | `string` | Raw HTML content |
| `text` | `string` | Plain text content |

---

## SQL Database Steps

Query a SQL database directly in your tests — the natural oracle for verifying that a UI or API
mutation actually persisted. Backed by `@civitas-cerebrum/sql-client`, which speaks
Postgres, MySQL/MariaDB, SQLite, SQL Server, and Oracle. All values are parametrised; never
interpolate values into SQL.

### Install the engine driver

element-interactions does **not** bundle SQL drivers — install the one for the engine you target,
alongside this package:

```sh
npm install pg              # Postgres
npm install mysql2          # MySQL / MariaDB
npm install better-sqlite3  # SQLite
npm install mssql           # SQL Server
npm install oracledb        # Oracle
```

Drivers load lazily: a `steps.sql*` call against an engine whose driver isn't installed throws a
clear `UnsupportedEngineException` naming the package to install — at the first DB step, not at
fixture setup. Tests that never touch SQL need no driver at all.

### Fixture configuration

```ts
export const test = baseFixture(base, 'tests/data/page-repository.json', {
  dbUrl: process.env.DB_URL,            // default connection
  dbProviders: {                        // optional named connections
    analytics: process.env.ANALYTICS_DB_URL,
  },
});
```

Pools open lazily on first use and are closed automatically when the test finishes.

### Reading (SELECT)

```ts
const res = await steps.sqlQuery<{ title: string }>(
  'SELECT title FROM books WHERE genre = $1 ORDER BY title', ['Fiction']);
await steps.verifySqlRowCount(res, 5);
await steps.verifySqlValue(res, 0, 'title', '1984');
```

### Writing (INSERT/UPDATE/DELETE)

```ts
const ins = await steps.sqlExecute(
  'INSERT INTO cart_items (cart_item_id,user_id,book_id,quantity,added_at) VALUES ($1,$2,$3,$4,$5)',
  ['cart-1','user-1','book-1',2,'2026-01-01T00:00:00Z']);
// ins.rowCount === 1
```

### Fluent builder

```ts
const top = await steps.sqlSelect('books')
  .columns('title', 'price')
  .where('price < ?', 15)
  .orderBy('price', 'desc')
  .limit(5)
  .run();

await steps.sqlInsert('cart_items').values({ cart_item_id: 'c1', user_id: 'u1', book_id: 'b1', quantity: 1, added_at: '2026-01-01T00:00:00Z' }).run();
await steps.sqlUpdate('books').set({ stock: 14 }).where('book_id = ?', 'book-001').run();
await steps.sqlDelete('cart_items').where('cart_item_id = ?', 'c1').run();
```

### Transactions

```ts
await steps.sqlTransaction(async (tx) => {
  await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = $1', ['book-001']);
  await tx.execute('INSERT INTO orders (...) VALUES (...)');
}); // auto-COMMIT, or auto-ROLLBACK if the callback throws
```

### Verification matchers

| Method | Asserts |
|---|---|
| `verifySqlRowCount(res, n \| {min,max})` | exact or bounded row count |
| `verifySqlValue(res, rowIndex, column, expected)` | a single cell's value |
| `verifySqlContains(res, partialRow)` | ≥1 row matches a column subset |
| `verifySqlColumn(res, column, expectedOrdered[])` | a column's ordered values (ORDER BY) |
| `verifySqlEmpty(res)` / `verifySqlNotEmpty(res)` | zero / ≥1 rows |

### Running the bookhive Postgres fixture

```bash
docker compose -f docker-compose.sql.yml up -d --wait
npx playwright test tests/sql-steps.spec.ts
docker compose -f docker-compose.sql.yml down -v
```

---

## 🤝 Contributing

Contributions are welcome! Please read the guidelines below before opening a PR.

### 🧪 Testing locally

Verify your changes end-to-end in a real consumer project using [`yalc`](https://github.com/wclr/yalc):

```bash
# Install yalc globally (one-time)
npm i -g yalc

# In the element-interactions repo folder
yalc publish

# In your consumer project
yalc add @civitas-cerebrum/element-interactions
```

Push updates without re-adding:

```bash
yalc publish --push
```

Restore the original npm version when done:

```bash
yalc remove @civitas-cerebrum/element-interactions
npm install
```

### 📋 PR guidelines

**Architecture.** Every new capability must follow this order:

1. Implement the core method in the appropriate domain class (`interact`, `verify`, `navigate`, etc.).
2. Expose it via a `Steps` wrapper.

PRs that skip step 1 will not be merged.

**Logging.** Core interaction methods must not contain any logs. `Steps` wrappers are responsible for logging what action is being performed.

**Unit tests.** Every new method must include a unit test. Tests run against the [Vue test app](https://github.com/civitas-cerebrum/vue-test-app), which is built from its Docker image during CI. If the component you need doesn't exist in the test app, open a PR there first and wait for it to merge before updating this repository.

Platform (Android / iOS) code is unit-tested without a device: `tests/appium/mocks.ts` provides mock WebdriverIO drivers and elements, and every Appium-family method gets a test against them. Fixture tests that need a Playwright run of their own live in `tests/fixture-platform/` and are named `*.pw.ts`: the default `testMatch` skips that suffix on purpose, and a parent spec starts them as a nested run with `tests/fixture-platform/playwright.config.ts`. Live device checks (`tests/live/`, `tests/cross-platform/` on a device) run only with `playwright.platform.config.ts`.

**Coverage.** CI gates on the report produced by `@civitas-cerebrum/test-coverage` (`npm run test:coverage` writes `test-coverage-report.txt`; `test:with-coverage` prints the CI-friendly variant). Note what that number means: it is **API (method-invocation) coverage** — every public method on `Steps`, `ElementAction`, the matcher classes, and the interaction layers is exercised by at least one test — **not** line/branch coverage.

**Documentation.** Every new `Steps` method must be added to the [API Reference](#️-api-reference-steps) section of this README, following the existing format. PRs without documentation will not be merged.
