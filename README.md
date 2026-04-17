# Playwright Element Interactions

[![NPM Version](https://img.shields.io/npm/v/@civitas-cerebrum/element-interactions?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/@civitas-cerebrum/element-interactions)

A robust set of Playwright steps for readable interaction and assertions.

`@civitas-cerebrum/element-interactions` pairs perfectly with `@civitas-cerebrum/element-repository` to achieve a fully decoupled test automation architecture. By separating **Element Acquisition** from **Element Interaction**, your test scripts become highly readable, easily maintainable, and completely free of raw locators.

### ✨ The Unified Steps API

With the introduction of the `Steps` class, you can now combine your element repository and interactions into a single, flattened facade. This eliminates repetitive locator fetching and transforms your tests into clean, plain-English steps.

### 🧠 AI-Friendly Test Development & Boilerplate Reduction

Stop writing the same three lines of code for every single interaction. This library handles the fetching, waiting, and acting automatically.

Because the API is highly semantic and completely decoupled from the DOM, it is an **ideal framework for AI coding assistants**. AI models can easily generate robust test flows using plain-English strings (`'CheckoutPage'`, `'submitButton'`) without hallucinating complex CSS selectors, writing flaky interactions, or forgetting critical `waitFor` states.

**Before (Raw Playwright):**

```ts
// Hardcode or manage raw locators inside your test
const submitBtn = page.locator('button[data-test="submit-order"]');

// Explicitly wait for DOM stability and visibility
await submitBtn.waitFor({ state: 'visible', timeout: 30000 });

// Perform the interaction
await submitBtn.click();
```

**After (@civitas-cerebrum/element-interactions):**

```ts
// Locate, wait, and interact — one line
await steps.click('CheckoutPage', 'submitButton');
```

Because the API is semantic and decoupled from the DOM, it also works exceptionally well with AI coding assistants. Models can generate robust test flows using plain-English strings (`'CheckoutPage'`, `'submitButton'`) without hallucinating CSS selectors or writing flaky interactions.

---

## 📦 Installation

```bash
npm i @civitas-cerebrum/element-interactions
```

**Peer dependencies:** `@playwright/test` is required. The `Steps` API additionally requires `@civitas-cerebrum/element-repository`.

---

## 🤖 Claude Code Integration

`@civitas-cerebrum/element-interactions` ships with a built-in **Claude Code skill** — an agent instruction file that teaches Claude how to use the framework correctly. The skill is included in the npm package, so there's nothing extra to install. When Claude Code detects it in your `node_modules`, it can write, debug, and maintain your Playwright tests using the Steps API, inspect live pages via the Playwright MCP, and manage your page repository — all with guardrails that prevent common AI mistakes like inventing selectors or overwriting config files.

### Quick Start with Claude Code

**1. Initialize a new Playwright project** (skip if you already have one):

```bash
npm init playwright@latest playwright-project
cd playwright-project
```

**2. Install the packages:**

```bash
npm i @civitas-cerebrum/element-interactions @civitas-cerebrum/element-repository
```

That's it — the skill is now available to Claude Code. When you ask it to write tests, it will automatically scaffold the fixture file, page repository, and config if they don't exist yet.

**3. Ask Claude to discover your app and automate a scenario:**

Open Claude Code in your project directory and prompt it with something like:

> *"Inspect the repo & explore https://your-app-url.com and automate an example end-to-end scenario."*

Claude will navigate to your site, identify key pages and interactions, scaffold the fixture file and page repository, and write a working test — all in one shot.

> **Tip:** For the best results, connect the Playwright MCP first so Claude can inspect the live DOM and verify selectors against the real page before writing any locators. Run `/plugins` in Claude Code and enable Playwright from the list.

### What the Skill Enables

Once loaded, Claude Code will:

- **Scaffold your project** — creating the fixture file, page repository, and Playwright config on first use.
- **Write tests using the Steps API** — generating clean, readable test flows with `steps.click()`, `steps.verifyText()`, etc.
- **Inspect the live DOM before adding locators** — using the Playwright MCP to verify selectors instead of guessing.
- **Ask before modifying `page-repository.json`** — showing you the exact changes it wants to make.
- **Inspect failure screenshots** — using the HTML report to diagnose test failures visually before proposing fixes.
- **Follow project conventions** — PascalCase page names, camelCase element names, no raw selectors in test code.

> **Tip:** For the best experience, ensure `reporter: 'html'` is set in your `playwright.config.ts` so failure screenshots are captured and viewable in the report.

---

## ✨ Features

* **Zero locator boilerplate** — The `Steps` API fetches elements and interacts with them in a single call.
* **Automatic failure screenshots** — `baseFixture` captures a full-page screenshot on every failed test and attaches it to the HTML report.
* **Standardized waiting** — Built-in methods wait for elements to reach specific DOM states (visible, hidden, attached, detached).
* **Advanced image verification** — `verifyImages` evaluates actual browser decoding and `naturalWidth`, not just DOM presence.
* **Smart dropdowns** — Select by value, index, or randomly, with automatic skipping of disabled and empty options.
* **Flexible assertions** — Verify exact text, non-empty text, URL substrings, or dynamic element counts (greater than, less than, exact).
* **Smart interactions** — Drag to other elements, type sequentially, wait for specific element state, verify images and more!
* **Force click with auto-retry** — Clicks automatically retry with a native DOM event when pointer interception is detected. No configuration needed.
* **Non-throwing visibility probes** — `isVisible()` returns a boolean with configurable timeout and text filtering, never throws.
* **Conditional chaining** — `steps.on('banner', 'Page').ifVisible().click()` silently skips when the element isn't visible.
* **Chain-style expect matchers** — `steps.expect('price', 'Page').text.toMatch(/^\$/).count.toBe(1).attributes.get('data-status').toBe('ready')` chains as many verifications as you need on a single element; awaiting flushes the queue and short-circuits on the first failure. `.not` is one-shot, `.throws('msg')` overrides messages, `.timeout(ms)` scopes wait time per call.
* **Predicate escape hatch** — `steps.expect('price', 'Page').toBe(el => parseFloat(el.text.slice(1)) > 10).throws('price must be above $10')` for assertions the matcher tree doesn't cover. Predicates run against a snapshot of plain element data — no async access required inside the lambda.
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
  await steps.click('HomePage', 'category-accessories');

  // Use StepOptions to control element selection and interaction modifiers
  await steps.click('AccessoriesPage', 'product-cards', { strategy: 'random' });
  await steps.verifyUrlContains('/product/');

  const selectedSize = await steps.selectDropdown('ProductDetailsPage', 'size-selector', {
    type: DropdownSelectType.RANDOM,
  });

  await steps.verifyCount('ProductDetailsPage', 'gallery-images', { greaterThan: 0 });
  await steps.verifyText('ProductDetailsPage', 'product-title');  // no args = asserts not empty
  await steps.verifyImages('ProductDetailsPage', 'gallery-images');
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

  // Conditional — skip if not visible
  await steps.on('promoBanner', 'ProductDetailsPage').ifVisible().click();
  
  // Visibility probe — returns boolean, never throws
  const hasDiscount = await steps.on('discountBadge', 'ProductDetailsPage').isVisible();
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
    .toBe(el => parseFloat(el.text.slice(1)) > 10)
    .throws('price must be above $10');
});

test('Per-call timeout override', async ({ steps }) => {
  await steps.on('slow-widget', 'Page').timeout(5000).text.toBe('Ready');
  await steps.on('items', 'Page').count.timeout(500).toBeGreaterThan(0);
});
```

**Field matchers:** `text`, `value`, `count`, `visible`, `enabled`, `attributes`, `css(prop)`. Each carries `.not` for negation. Snapshot fields available in predicates: `text`, `value`, `attributes`, `visible`, `enabled`, `count`. See the [API reference](skills/element-interactions/references/api-reference.md#expect-matcher-tree) for the full surface.

### StepOptions

All Steps methods accept an optional last parameter for element selection and interaction modifiers:

```ts
// Select by strategy
await steps.click('Page', 'element', { strategy: 'random' });
await steps.click('Page', 'element', { strategy: 'index', index: 2 });
await steps.click('Page', 'element', { strategy: 'text', text: 'Submit' });

// Interaction modifiers
await steps.click('Page', 'element', { withoutScrolling: true });  // bypass actionability checks
await steps.click('Page', 'element', { ifPresent: true });         // skip if not visible
await steps.click('Page', 'element', { force: true });             // native DOM click (bypasses overlays)

// Combine both
await steps.click('Page', 'element', { strategy: 'random', withoutScrolling: true });
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
  await steps.click('HomePage', 'category-accessories');
  await steps.clickRandom('AccessoriesPage', 'product-cards');
  await steps.verifyUrlContains('/product/');

  const selectedSize = await steps.selectDropdown('ProductDetailsPage', 'size-selector', {
    type: DropdownSelectType.RANDOM,
  });

  await steps.verifyImages('ProductDetailsPage', 'gallery-images');
  await steps.click('ProductDetailsPage', 'add-to-cart-button');
  await steps.waitForState('CheckoutPage', 'confirmation-modal', 'visible');
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

  await steps.verifyAbsence('HomePage', 'categories');
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

* **`click(pageName, elementName, options?: StepOptions)`** — Clicks an element. Supports `{ strategy, withoutScrolling, ifPresent, force }`. Auto-retries with native DOM event on pointer interception.
* **`clickWithoutScrolling(pageName, elementName)`** — Dispatches a native `click` event, bypassing actionability checks. Useful for flyout/dropdown items.
* **`clickIfPresent(pageName, elementName)`** — Clicks only if visible; skips silently. Returns `boolean`.
* **`clickRandom(pageName, elementName, options?: StepOptions)`** — Clicks a random element from all matches. Supports `{ withoutScrolling }`.
* **`rightClick(pageName, elementName)`** — Right-clicks an element to trigger a context menu.
* **`doubleClick(pageName, elementName)`** — Double-clicks an element.
* **`check(pageName, elementName)`** — Checks a checkbox or radio button. No-op if already checked.
* **`uncheck(pageName, elementName)`** — Unchecks a checkbox. No-op if already unchecked.
* **`hover(pageName, elementName)`** — Hovers over an element to trigger dropdowns or tooltips.
* **`scrollIntoView(pageName, elementName)`** — Smoothly scrolls an element into the viewport.
* **`dragAndDrop(pageName, elementName, options: DragAndDropOptions)`** — Drags an element to a target element (`{ target: Locator | Element }`), by coordinate offset (`{ xOffset, yOffset }`), or both.
* **`dragAndDropListedElement(pageName, elementName, elementText, options: DragAndDropOptions)`** — Finds a specific element by its text from a list, then drags it to a destination.
* **`fill(pageName, elementName, text: string)`** — Clears and fills an input field with the provided text.
* **`uploadFile(pageName, elementName, filePath: string)`** — Uploads a file to an `<input type="file">` element.
* **`selectDropdown(pageName, elementName, options?: DropdownSelectOptions)`** — Selects an option from a `<select>` element and returns its `value`. Defaults to `{ type: DropdownSelectType.RANDOM }`. Also supports `VALUE` (exact match) and `INDEX` (zero-based).
* **`setSliderValue(pageName, elementName, value: number)`** — Sets a range input (`<input type="range">`) to the specified numeric value.
* **`pressKey(key: string)`** — Presses a keyboard key at the page level (e.g. `'Enter'`, `'Escape'`, `'Tab'`).
* **`typeSequentially(pageName, elementName, text: string, delay?: number)`** — Types text character by character with a configurable delay (default `100ms`). Ideal for OTP inputs or fields with `keyup` listeners.

### 📊 Data Extraction

* **`getText(pageName, elementName)`** — Returns the trimmed text content of an element, or an empty string if null.
* **`getAttribute(pageName, elementName, attributeName: string)`** — Returns the value of an HTML attribute (e.g. `href`, `aria-pressed`), or `null` if it doesn't exist.

### ✅ Verification

* **`verifyPresence(pageName, elementName)`** — Asserts that an element is attached to the DOM and visible.
* **`verifyAbsence(pageName, elementName)`** — Asserts that an element is hidden or detached from the DOM.
* **`verifyText(pageName, elementName, expectedText?)`** — Asserts element text. Provide `expectedText` for an exact match, or call with no args to assert not empty.
* **`verifyCount(pageName, elementName, options: CountVerifyOptions)`** — Asserts element count. Accepts `{ exactly: number }`, `{ greaterThan: number }`, or `{ lessThan: number }`.
* **`verifyImages(pageName, elementName, scroll?: boolean)`** — Verifies image rendering: checks visibility, valid `src`, `naturalWidth > 0`, and the browser's native `decode()` promise. Scrolls into view by default.
* **`verifyTextContains(pageName, elementName, expectedText: string)`** — Asserts that an element's text contains the expected substring.
* **`verifyState(pageName, elementName, state)`** — Asserts the state of an element. Supported states: `'enabled'`, `'disabled'`, `'editable'`, `'checked'`, `'focused'`, `'visible'`, `'hidden'`, `'attached'`, `'inViewport'`.
* **`verifyAttribute(pageName, elementName, attributeName: string, expectedValue: string)`** — Asserts that an element has a specific HTML attribute with an exact value.
* **`verifyUrlContains(text: string)`** — Asserts that the current URL contains the expected substring.
* **`verifyInputValue(pageName, elementName, expectedValue: string)`** — Asserts that an input, textarea, or select element has the expected value.
* **`verifyTabCount(expectedCount: number)`** — Asserts the number of currently open tabs/pages in the browser context.

### 🔍 Visibility Probe

* **`isVisible(pageName, elementName, options?)`** — Non-throwing visibility check. Returns `true` if the element is visible within the timeout, `false` otherwise. Options: `{ timeout?: number (default 2000), containsText?: string }`.
* **`isPresent(pageName, elementName)`** — Returns `true` if the element is currently visible, `false` otherwise. Uses the default element timeout.

### 📋 Listed Elements

Operate on a specific element within a list (table rows, cards, list items) by matching its visible text or an HTML attribute. Optionally drill into a child element within the matched item.

```ts
import { ListedElementMatch, VerifyListedOptions, GetListedDataOptions } from '@civitas-cerebrum/element-interactions';
```

* **`clickListedElement(pageName, elementName, options: ListedElementMatch)`** — Finds and clicks a specific element from a list. Identify the target by `{ text }` or `{ attribute: { name, value } }`, and optionally drill into a child with `{ child: 'css-selector' }` or `{ child: { pageName, elementName } }`.
* **`verifyListedElement(pageName, elementName, options: VerifyListedOptions)`** — Finds a listed element and asserts against it. Use `{ expectedText }` to verify text, `{ expected: { name, value } }` to verify an attribute, or omit both to assert visibility.
* **`getListedElementData(pageName, elementName, options: GetListedDataOptions)`** — Extracts data from a listed element. Returns the element's text content by default, or an attribute value when `{ extractAttribute: 'attrName' }` is specified.

```ts
// Click the row containing "John"
await steps.clickListedElement('UsersPage', 'tableRows', { text: 'John' });

// Click a child button inside the row matching an attribute
await steps.clickListedElement('UsersPage', 'tableRows', {
  attribute: { name: 'data-id', value: '5' },
  child: 'button.edit'
});

// Verify text of a child cell in the row containing "Name"
await steps.verifyListedElement('FormsPage', 'submissionEntries', {
  text: 'Name',
  child: 'td:nth-child(2)',
  expectedText: 'John Doe'
});

// Verify an attribute on a listed element
await steps.verifyListedElement('UsersPage', 'tableRows', {
  attribute: { name: 'data-id', value: '5' },
  expected: { name: 'class', value: 'active' }
});

// Extract an href from a child link inside a listed element
const href = await steps.getListedElementData('UsersPage', 'tableRows', {
  text: 'John',
  child: 'a.profile-link',
  extractAttribute: 'href'
});
```

### ⏳ Wait

* **`waitForState(pageName, elementName, state?: 'visible' | 'attached' | 'hidden' | 'detached')`** — Waits for an element to reach a specific DOM state. Defaults to `'visible'`.
* **`waitForNetworkIdle()`** — Waits until there are no in-flight network requests for at least 500ms.
* **`waitForResponse(urlPattern: string | RegExp, action: () => Promise<void>)`** — Executes an action and waits for a matching network response. Returns the `Response` object.
* **`waitAndClick(pageName, elementName, state?: string)`** — Waits for an element to reach a state (default `'visible'`), then clicks it.

### 🧩 Composite / Workflow

* **`fillForm(pageName, fields: Record<string, FillFormValue>)`** — Fills multiple form fields in one call. String values fill text inputs; `DropdownSelectOptions` values trigger dropdown selection.
* **`retryUntil(action, verification, maxRetries?, delayMs?)`** — Retries an action until a verification passes, or until the max attempts (default `3`) are reached.
* **`clearInput(pageName, elementName)`** — Clears the value of an input or textarea without filling new text.
* **`selectMultiple(pageName, elementName, values: string[])`** — Selects multiple options from a `<select multiple>` element by their value attributes.
* **`clickNth(pageName, elementName, index: number)`** — Clicks the element at a specific zero-based index from all matches.

### 📊 Additional Data Extraction

* **`getAll(pageName, elementName, options?: GetAllOptions)`** — Extracts text (or attributes) from all matching elements. Supports `{ child }` and `{ extractAttribute }`.
* **`getCount(pageName, elementName)`** — Returns the number of DOM elements matching the locator.
* **`getInputValue(pageName, elementName)`** — Returns the current `value` property of an input, textarea, or select element.
* **`getCssProperty(pageName, elementName, property: string)`** — Returns a computed CSS property value (e.g. `'rgb(255, 0, 0)'`).

### ✅ Additional Verification

* **`verifyOrder(pageName, elementName, expectedTexts: string[])`** — Asserts that elements' text contents appear in the exact order specified.
* **`verifyCssProperty(pageName, elementName, property: string, expectedValue: string)`** — Asserts that a computed CSS property matches the expected value.
* **`verifyListOrder(pageName, elementName, direction: 'asc' | 'desc')`** — Asserts that elements' text contents are sorted in the specified direction.

### 📸 Screenshot

* **`screenshot()`** — Captures a page screenshot. Pass `{ fullPage: true }` for scrollable capture, `{ path: 'file.png' }` to save to disk.
* **`screenshot(pageName, elementName, options?)`** — Captures a screenshot of a specific element.

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
const otpCode = await steps.getText('EmailPage', 'otpCode');

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
