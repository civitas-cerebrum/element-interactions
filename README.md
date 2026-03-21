# Playwright Element Interactions

[![NPM Version](https://img.shields.io/npm/v/pw-element-interactions?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/pw-element-interactions)

A robust set of Playwright steps for readable interaction and assertions.

`pw-element-interactions` pairs perfectly with `pw-element-repository` to achieve a fully decoupled test automation architecture. By separating **Element Acquisition** from **Element Interaction**, your test scripts become highly readable, easily maintainable, and completely free of raw locators.

### ✨ The Unified Steps API

With the introduction of the `Steps` class, you can now combine your element repository and interactions into a single, flattened facade. This eliminates repetitive locator fetching and transforms your tests into clean, plain-English steps.

### 🤖 AI-Friendly Test Development & Boilerplate Reduction

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

**After (pw-element-interactions):**

```ts
// Locate, wait, and interact — one line
await steps.click('CheckoutPage', 'submitButton');
```

Because the API is semantic and decoupled from the DOM, it also works exceptionally well with AI coding assistants. Models can generate robust test flows using plain-English strings (`'CheckoutPage'`, `'submitButton'`) without hallucinating CSS selectors or writing flaky interactions.

---

## 📦 Installation

```bash
npm i pw-element-interactions
```

**Peer dependencies:** `@playwright/test` is required. The `Steps` API additionally requires `pw-element-repository`.

---

## ✨ Features

* **Zero locator boilerplate** — The `Steps` API fetches elements and interacts with them in a single call.
* **Automatic failure screenshots** — `baseFixture` captures a full-page screenshot on every failed test and attaches it to the HTML report.
* **Standardized waiting** — Built-in methods wait for elements to reach specific DOM states (visible, hidden, attached, detached).
* **Advanced image verification** — `verifyImages` evaluates actual browser decoding and `naturalWidth`, not just DOM presence.
* **Smart dropdowns** — Select by value, index, or randomly, with automatic skipping of disabled and empty options.
* **Flexible assertions** — Verify exact text, non-empty text, URL substrings, or dynamic element counts (greater than, less than, exact).
* **Drag and drop** — Drag to other elements, to coordinate offsets, or combine both strategies.

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

**Naming conventions:**
- `name` — PascalCase page identifier, e.g. `CheckoutPage`, `ProductDetailsPage`
- `elementName` — camelCase element identifier, e.g. `submitButton`, `galleryImages`

---

## 💻 Usage: The `Steps` API (Recommended)

Initialize `Steps` by passing the current Playwright `page` and your `ElementRepository` instance.

```ts
import { test } from '@playwright/test';
import { ElementRepository } from 'pw-element-repository';
import { Steps, DropdownSelectType } from 'pw-element-interactions';

test('Add random product and verify image gallery', async ({ page }) => {
  const repo = new ElementRepository('tests/data/locators.json');
  const steps = new Steps(page, repo);

  await steps.navigateTo('/');
  await steps.click('HomePage', 'category-accessories');

  await steps.clickRandom('AccessoriesPage', 'product-cards');
  await steps.verifyUrlContains('/product/');

  const selectedSize = await steps.selectDropdown('ProductDetailsPage', 'size-selector', {
    type: DropdownSelectType.RANDOM,
  });
  console.log(`Selected size: ${selectedSize}`);

  await steps.verifyCount('ProductDetailsPage', 'gallery-images', { greaterThan: 0 });
  await steps.verifyText('ProductDetailsPage', 'product-title', undefined, { notEmpty: true });
  await steps.verifyImages('ProductDetailsPage', 'gallery-images');
  await steps.waitForState('CheckoutPage', 'confirmation-modal', 'visible');
});
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
import { baseFixture } from 'pw-element-interactions';

export const test = baseFixture(base, 'tests/data/page-repository.json');
export { expect };
```

### 3. Use fixtures in your tests

```ts
// tests/checkout.spec.ts
import { test, expect } from '../fixtures/base';
import { DropdownSelectType } from 'pw-element-interactions';

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

```ts
test('Navigate to Forms category', async ({ page, repo, steps }) => {
  await steps.navigateTo('/');

  const formsLink = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
  await formsLink?.click();

  await steps.verifyAbsence('HomePage', 'categories');
});
```

### 5. Extend with your own fixtures

Because `baseFixture` returns a standard Playwright `test` object, you can layer your own fixtures on top:

```ts
// tests/fixtures/base.ts
import { test as base } from '@playwright/test';
import { baseFixture } from 'pw-element-interactions';
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
* **`backOrForward(direction: 'BACKWARDS' | 'FORWARDS')`** — Navigates the browser history stack in the given direction.
* **`setViewport(width: number, height: number)`** — Resizes the browser viewport to the specified pixel dimensions.

### 🖱️ Interaction

* **`click(pageName, elementName)`** — Clicks an element. Automatically waits for the element to be attached, visible, stable, and actionable.
* **`clickWithoutScrolling(pageName, elementName)`** — Dispatches a native `click` event directly, bypassing Playwright's scrolling and intersection observer checks. Useful for elements obscured by sticky headers or overlays.
* **`clickIfPresent(pageName, elementName)`** — Clicks an element only if it is visible; skips silently otherwise. Ideal for optional elements like cookie banners.
* **`clickRandom(pageName, elementName)`** — Clicks a random element from all matches. Useful for lists or grids.
* **`hover(pageName, elementName)`** — Hovers over an element to trigger dropdowns or tooltips.
* **`scrollIntoView(pageName, elementName)`** — Smoothly scrolls an element into the viewport.
* **`dragAndDrop(pageName, elementName, options: DragAndDropOptions)`** — Drags an element to a target element (`{ target: Locator }`), by coordinate offset (`{ xOffset, yOffset }`), or both.
* **`dragAndDropListedElement(pageName, elementName, elementText, options: DragAndDropOptions)`** — Finds a specific element by its text from a list, then drags it to a destination.
* **`fill(pageName, elementName, text: string)`** — Clears and fills an input field with the provided text.
* **`uploadFile(pageName, elementName, filePath: string)`** — Uploads a file to an `<input type="file">` element.
* **`selectDropdown(pageName, elementName, options?: DropdownSelectOptions)`** — Selects an option from a `<select>` element and returns its `value`. Defaults to `{ type: DropdownSelectType.RANDOM }`. Also supports `VALUE` (exact match) and `INDEX` (zero-based).
* **`typeSequentially(pageName, elementName, text: string, delay?: number)`** — Types text character by character with a configurable delay (default `100ms`). Ideal for OTP inputs or fields with `keyup` listeners.

### 📊 Data Extraction

* **`getText(pageName, elementName)`** — Returns the trimmed text content of an element, or an empty string if null.
* **`getAttribute(pageName, elementName, attributeName: string)`** — Returns the value of an HTML attribute (e.g. `href`, `aria-pressed`), or `null` if it doesn't exist.

### ✅ Verification

* **`verifyPresence(pageName, elementName)`** — Asserts that an element is attached to the DOM and visible.
* **`verifyAbsence(pageName, elementName)`** — Asserts that an element is hidden or detached from the DOM.
* **`verifyText(pageName, elementName, expectedText?, options?: TextVerifyOptions)`** — Asserts element text. Provide `expectedText` for an exact match, or `{ notEmpty: true }` to assert the text is not blank.
* **`verifyCount(pageName, elementName, options: CountVerifyOptions)`** — Asserts element count. Accepts `{ exact: number }`, `{ greaterThan: number }`, or `{ lessThan: number }`.
* **`verifyImages(pageName, elementName, scroll?: boolean)`** — Verifies image rendering: checks visibility, valid `src`, `naturalWidth > 0`, and the browser's native `decode()` promise. Scrolls into view by default.
* **`verifyUrlContains(text: string)`** — Asserts that the current URL contains the expected substring.

### ⏳ Wait

* **`waitForState(pageName, elementName, state?: 'visible' | 'attached' | 'hidden' | 'detached')`** — Waits for an element to reach a specific DOM state. Defaults to `'visible'`.

---

## 🧱 Advanced: Raw Interactions API

To bypass the repository or work with dynamically generated locators, use `ElementInteractions` directly:

```ts
import { ElementInteractions } from 'pw-element-interactions';

const interactions = new ElementInteractions(page);

const customLocator = page.locator('button.dynamic-class');
await interactions.interact.clickWithoutScrolling(customLocator);
await interactions.verify.count(customLocator, { greaterThan: 2 });
```

All core `interact`, `verify`, and `navigate` methods are available on `ElementInteractions`.

---

## 🤝 Contributing

Contributions are welcome! Please read the guidelines below before opening a PR.

### 🧪 Testing locally

Verify your changes end-to-end in a real consumer project using [`yalc`](https://github.com/wclr/yalc):

```bash
# Install yalc globally (one-time)
npm i -g yalc

# In the pw-element-interactions folder
yalc publish

# In your consumer project
yalc add pw-element-interactions
```

Push updates without re-adding:

```bash
yalc publish --push
```

Restore the original npm version when done:

```bash
yalc remove pw-element-interactions
npm install
```

### 📋 PR guidelines

**Architecture.** Every new capability must follow this order:

1. Implement the core method in the appropriate domain class (`interact`, `verify`, `navigate`, etc.).
2. Expose it via a `Steps` wrapper.

PRs that skip step 1 will not be merged.

**Logging.** Core interaction methods must not contain any logs. `Steps` wrappers are responsible for logging what action is being performed.

**Unit tests.** Every new method must include a unit test. Tests run against the [Vue test app](https://github.com/Umutayb/vue-test-app), which is built from its Docker image during CI. If the component you need doesn't exist in the test app, open a PR there first and wait for it to merge before updating this repository.

**Documentation.** Every new `Steps` method must be added to the [API Reference](#️-api-reference-steps) section of this README, following the existing format. PRs without documentation will not be merged.