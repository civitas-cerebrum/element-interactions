# Playwright Element Interactions

[![NPM Version](https://img.shields.io/npm/v/@civitas-cerebrum/element-interactions?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/@civitas-cerebrum/element-interactions)

A robust, readable interaction-and-assertion facade for Playwright. The `Steps` API and `ElementRepository` decouple element acquisition from interaction, so raw selectors never appear in test code — and tests stay tight, semantic, and resistant to DOM churn.

This package is the **framework** layer: a programmatic Playwright facade for humans + LLM agents to write against. If you want the **methodology** layer — agent skills, harness hooks, return-shape schemas, and the postinstall plumbing that drives Claude Code through an end-to-end autonomous QA pipeline — install [`@civitas-cerebrum/achilles`](https://www.npmjs.com/package/@civitas-cerebrum/achilles) alongside this package. Achilles depends on element-interactions and orchestrates it through eight documented phases.

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

**Peer dependencies:** `@playwright/test` is required.

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
* **Force click with auto-retry** — Clicks automatically retry with a native DOM event when pointer interception is detected. No configuration needed.
* **Unified visibility API** — `isVisible()` is a dual-behavior chain. `await steps.isVisible('banner', 'Page')` resolves to a boolean (probe, never throws). `steps.isVisible('banner', 'Page').click()` silently skips the action when hidden (gate). Both forms accept `{ timeout, containsText }`. Replaces `ifVisible()` and the old boolean `isVisible()` probe.
* **Chain-style expect matchers** — `steps.expect('price', 'Page').text.toMatch(/^\$/).count.toBe(1).attributes.get('data-status').toBe('ready')` chains as many verifications as you need on a single element; awaiting flushes the queue and short-circuits on the first failure. `.not` is one-shot, `.throws('msg')` overrides messages, `.timeout(ms)` scopes wait time per call.
* **Predicate escape hatch** — `steps.expect('price', 'Page').satisfy(el => parseFloat(el.text.slice(1)) > 10).throws('price must be above $10')` for assertions the matcher tree doesn't cover. Predicates run against a snapshot of plain element data — no async access required inside the lambda.
* **Role + accessible name selectors** — `{ "role": "button", "name": "Log in" }` resolves via `page.getByRole()` with regex support.
* **Regex text selectors** — `{ "text": { "regex": "pattern", "flags": "i" } }` for matching dynamic content.
* **Iframe-scoped pages** — Elements inside iframes are resolved transparently via `frame` property on page definitions.
* **Cross-platform** — Enhanced selectors resolve natively on Android (UiSelector) and iOS (predicate strings).

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
Cross-platform: role and regex selectors resolve via UiSelector on Android and predicate strings on iOS.

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
});
```

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

**Field matchers:** `text`, `value`, `count`, `visible`, `enabled`, `attributes`, `css(prop)`. Each carries `.not` for negation. Snapshot fields available in predicates: `text`, `value`, `attributes`, `visible`, `enabled`, `count`. See the [API reference](https://github.com/civitas-cerebrum/achilles/blob/main/skills/element-interactions/references/api-reference.md#expect-matcher-tree) for the full surface.

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

`baseFixture` also attaches a full-page `failure-screenshot` to the Playwright HTML report on every failed test.

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

---

## 🛠️ API Reference: `Steps`

Every method below automatically fetches the Playwright `Locator` using your `pageName` and `elementName` keys from the repository.

### 🧭 Navigation

* **`navigateTo(url: string)`** — Navigates the browser to the specified absolute or relative URL.
* **`refresh()`** — Reloads the current page.
* **`backOrForward(direction: 'back' | 'forward')`** — Navigates the browser history stack in the given direction.
* **`setViewport(width: number, height: number)`** — Resizes the browser viewport to the specified pixel dimensions.
* **`switchToNewTab(action: () => Promise<void>)`** — Executes an action that opens a new tab (e.g. clicking a link with `target="_blank"`), waits for the new tab, and returns the new `Page` object.
* **`closeTab(targetPage?: Page)`** — Closes the specified tab (or the current one) and returns the remaining active page.
* **`getTabCount()`** — Returns the number of currently open tabs/pages in the browser context.

### 🖱️ Interaction

* **`click(elementName, pageName, options?: StepOptions)`** — Clicks an element. Supports `{ strategy, withoutScrolling, ifPresent, force }`. On pointer interception it falls back to a dispatched DOM `'click'` event, logs a warning, and pushes a report-visible `interception-fallback` test annotation naming `PageName.elementName`; set `interceptionRetry: false` on the fixture to rethrow the original error instead. Note: `force` dispatches a DOM `'click'` event directly (no pointer simulation, no actionability checks — NOT Playwright's `force: true`); `withoutScrolling` has alias semantics of `force` (no scroll into view). Rename pending in a future major.
* **`clickIfPresent(elementName, pageName)`** — Clicks only if visible; skips silently. Returns `boolean`.
* **`clickRandom(elementName, pageName, options?: StepOptions)`** — Clicks a random element from all matches. Supports `{ withoutScrolling }`.
* **`rightClick(elementName, pageName)`** — Right-clicks an element to trigger a context menu.
* **`doubleClick(elementName, pageName)`** — Double-clicks an element.
* **`check(elementName, pageName)`** — Checks a checkbox or radio button. No-op if already checked.
* **`uncheck(elementName, pageName)`** — Unchecks a checkbox. No-op if already unchecked.
* **`hover(elementName, pageName)`** — Hovers over an element to trigger dropdowns or tooltips.
* **`scrollIntoView(elementName, pageName)`** — Smoothly scrolls an element into the viewport.
* **`dragAndDrop(elementName, pageName, options: DragAndDropOptions)`** — Drags an element to a target element (`{ target: Locator | Element }`), by coordinate offset (`{ xOffset, yOffset }`), or both.
* **`dragAndDropListedElement(elementName, pageName, elementText, options: DragAndDropOptions)`** — Finds a specific element by its text from a list, then drags it to a destination.
* **`fill(elementName, pageName, text: string)`** — Clears and fills an input field with the provided text.
* **`uploadFile(elementName, pageName, filePath: string)`** — Uploads a file to an `<input type="file">` element.
* **`selectDropdown(elementName, pageName, options?: DropdownSelectOptions)`** — Selects an option from a `<select>` element and returns its `value`. Defaults to `{ type: DropdownSelectType.RANDOM }`. Also supports `VALUE` (exact match) and `INDEX` (zero-based).
* **`setSliderValue(elementName, pageName, value: number)`** — Sets a range input (`<input type="range">`) to the specified numeric value.
* **`pressKey(key: string)`** — Presses a keyboard key at the page level (e.g. `'Enter'`, `'Escape'`, `'Tab'`).
* **`typeSequentially(elementName, pageName, text: string, delay?: number)`** — Types text character by character with a configurable delay (default `100ms`). Ideal for OTP inputs or fields with `keyup` listeners.

### 📊 Data Extraction

* **`getText(elementName, pageName)`** — Returns the trimmed text content of an element, or an empty string if null.
* **`getAttribute(elementName, pageName, attributeName: string)`** — Returns the value of an HTML attribute (e.g. `href`, `aria-pressed`), or `null` if it doesn't exist.
* **`getLocalStorage(key: string)`** — Reads `window.localStorage[key]`. Returns the stored string or `null` if the key is absent (matches the native `getItem` contract). Use for state the framework cannot reach through the DOM — persisted theme, dismissed-banner flag, feature toggles, auth tokens.
* **`getSessionStorage(key: string)`** — Same shape, against `window.sessionStorage`.

### ✅ Verification

* **`verifyPresence(elementName, pageName)`** — Asserts that an element is attached to the DOM and visible.
* **`verifyAllPresent(targets: Array<{ elementName, pageName, options? }>)`** — Asserts presence of multiple independent elements in parallel via `Promise.all`. Equivalent to sequential `verifyPresence` calls but resolves all assertions concurrently — useful when a page has many content blocks to assert at once. Example: `await steps.verifyAllPresent([{ elementName: 'title', pageName: 'PDP' }, { elementName: 'price', pageName: 'PDP' }])`.
* **`verifyAbsence(elementName, pageName)`** — Asserts that an element is hidden or detached from the DOM.
* **`verifyText(elementName, pageName, expectedText?)`** — Asserts element text. Provide `expectedText` for an exact match, or call with no args to assert not empty.
* **`verifyCount(elementName, pageName, options: CountVerifyOptions)`** — Asserts element count. Accepts `{ exactly: number }`, `{ greaterThan: number }`, or `{ lessThan: number }`.
* **`verifyImages(elementName, pageName, scroll?: boolean, options?: StepOptions & { verifyDecoded?: boolean })`** — Verifies image rendering: checks visibility, valid `src`, and `naturalWidth > 0`. Pass `{ verifyDecoded: true }` in `options` to also run the browser's native `decode()` round-trip (more thorough, adds a CDP round-trip per image; off by default). Scrolls into view by default.
* **`verifyTextContains(elementName, pageName, expectedText: string)`** — Asserts that an element's text contains the expected substring.
* **`verifyState(elementName, pageName, state)`** — Asserts the state of an element. Supported states: `'enabled'`, `'disabled'`, `'editable'`, `'checked'`, `'focused'`, `'visible'`, `'hidden'`, `'attached'`, `'inViewport'`.
* **`verifyAttribute(elementName, pageName, attributeName: string, expectedValue: string)`** — Asserts that an element has a specific HTML attribute with an exact value.
* **`verifyUrlContains(text: string)`** — Asserts that the current URL contains the expected substring.
* **`verifyInputValue(elementName, pageName, expectedValue: string)`** — Asserts that an input, textarea, or select element has the expected value.
* **`verifyTabCount(expectedCount: number)`** — Asserts the number of currently open tabs/pages in the browser context.
* **`verifyLocalStorage(key: string, options: StorageVerifyOptions)`** — Asserts a property of `localStorage[key]`. Pick exactly one matcher in the options: `{ equals: string }` (exact match), `{ contains: string }` (substring), `{ matches: RegExp }`, or `{ present: boolean }` (existence). All four forms also accept `negated`, `timeout`, and `errorMessage`. Polls until the predicate holds or the timeout expires, so it survives the race between a UI action firing and its persistence side-effect landing.
* **`verifySessionStorage(key: string, options: StorageVerifyOptions)`** — Same shape, against `window.sessionStorage`.

```ts
// Examples
await steps.verifyLocalStorage('theme', { equals: 'dark' });
await steps.verifyLocalStorage('flag', { contains: 'enabled' });
await steps.verifyLocalStorage('build', { matches: /^v\d+$/ });
await steps.verifyLocalStorage('seen', { present: true });
await steps.verifyLocalStorage('temp', { present: false });                  // absence
await steps.verifyLocalStorage('theme', { equals: 'light', negated: true }); // not equal
```

### 🔍 Visibility — Probe + Gate

* **`isVisible(elementName, pageName, options?)`** — Dual-behavior entry point. Returns a `VisibleChain` that is both:
  - **awaitable as `Promise<boolean>`** — the probe, never throws. `await steps.isVisible(...)` resolves to `true` / `false`.
  - **chainable with action methods and the matcher tree** — the gate, silently skips when hidden.
  Options: `{ timeout?: number (default 2000), containsText?: string }`.
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

* **`waitForState(elementName, pageName, state?: 'visible' | 'attached' | 'hidden' | 'detached', options?)`** — Waits for an element to reach a specific DOM state. Defaults to `'visible'`. Returns `Promise<boolean>`. **Throws on timeout as of 0.4.0**; pass `{ optional: true }` to probe without failing (resolves `false` instead). `{ timeout: ms }` overrides the instance timeout per call.

  ```ts
  await steps.waitForState('confirmationModal', 'CheckoutPage', 'visible');                        // throws on timeout (0.4.0+)
  const open = await steps.waitForState('promoBanner', 'HomePage', 'visible', { optional: true }); // probe — false on timeout
  ```

* **`waitForNetworkIdle()`** — Waits until there are no in-flight network requests for at least 500ms.
* **`waitForResponse(urlPattern: string | RegExp, action: () => Promise<void>)`** — Executes an action and waits for a matching network response. Returns the `Response` object.
* **`waitAndClick(elementName, pageName, state?: string, options?)`** — Waits for an element to reach a state (default `'visible'`), then clicks it. Throws when the element never reaches the state — `optional` softness is deliberately not inherited here.

### 🧩 Composite / Workflow

* **`fillForm(pageName, fields: Record<string, FillFormValue>)`** — Fills multiple form fields in one call. String values fill text inputs; `DropdownSelectOptions` values trigger dropdown selection.
* **`retryUntil(action, verification, maxRetries?, delayMs?)`** — Retries an action until a verification passes, or until the max attempts (default `3`) are reached.
* **`clearInput(elementName, pageName)`** — Clears the value of an input or textarea without filling new text.
* **`selectMultiple(elementName, pageName, values: string[])`** — Selects multiple options from a `<select multiple>` element by their value attributes.
* **`clickNth(elementName, pageName, index: number)`** — Clicks the element at a specific zero-based index from all matches.

### 📊 Additional Data Extraction

* **`getAll(elementName, pageName, options?: GetAllOptions)`** — Extracts text (or attributes) from all matching elements. Supports `{ child }` and `{ extractAttribute }`.
* **`getCount(elementName, pageName)`** — Returns the number of DOM elements matching the locator.
* **`getInputValue(elementName, pageName)`** — Returns the current `value` property of an input, textarea, or select element.
* **`getCssProperty(elementName, pageName, property: string)`** — Returns a computed CSS property value (e.g. `'rgb(255, 0, 0)'`).

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

---

## 🧱 Advanced: Raw Interactions API

To bypass the repository or work with dynamically generated locators, use `ElementInteractions` directly. All methods accept both Playwright `Locator` and `Element` types:

```ts
import { ElementInteractions } from '@civitas-cerebrum/element-interactions';

const interactions = new ElementInteractions(page);

// Works with Playwright Locators
const customLocator = page.locator('button.dynamic-class');
await interactions.interact.click(customLocator, { withoutScrolling: true });
await interactions.verify.count(customLocator, { greaterThan: 2 });

// Also works with Element from the repository
const element = await repo.get('submitButton', 'LoginPage');
await interactions.interact.click(element);
await interactions.verify.presence(element);
```

All `interact`, `verify`, `extract`, and `navigate` methods are available on `ElementInteractions`.

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
mutation actually persisted. Backed by `@civitas-cerebrum/sql-client` (Postgres). All values are
parametrised; never interpolate values into SQL.

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

**Documentation.** Every new `Steps` method must be added to the [API Reference](#️-api-reference-steps) section of this README, following the existing format. PRs without documentation will not be merged.
