# Playwright Element Interactions

[![NPM Version](https://img.shields.io/npm/v/pw-element-interactions?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/pw-element-interactions)

A robust set of Playwright steps for readable interaction and assertions.

`pw-element-interactions` pairs perfectly with `pw-element-repository` to achieve a fully decoupled test automation architecture. By separating **Element Acquisition** from **Element Interaction**, your test scripts become highly readable, easily maintainable, and completely free of raw locators.

### ✨ The Unified Steps API

With the introduction of the `Steps` class, you can now combine your element repository and interactions into a single, flattened Facade. This eliminates repetitive locator fetching and transforms your tests into clean, plain-English steps.

### 🤖 AI-Friendly Test Development & Boilerplate Reduction

Stop writing the same three lines of code for every single interaction. This library handles the fetching, waiting, and acting automatically.

Because the API is highly semantic and completely decoupled from the DOM, it is an **ideal framework for AI coding assistants**. AI models can easily generate robust test flows using plain-English strings (`'CheckoutPage'`, `'submitButton'`) without hallucinating complex CSS selectors, writing flaky interactions, or forgetting critical `waitFor` states.

**Before (Raw Playwright):**

```ts
// 1. Hardcode or manage raw locators inside your test
const submitBtn = page.locator('button[data-test="submit-order"]');

// 2. Explicitly wait for DOM stability and visibility
await submitBtn.waitFor({ state: 'visible', timeout: 30000 });

// 3. Perform the interaction
await submitBtn.click();
```

**Now (with pw-element-interactions):**

```ts
// 1. Locate, wait, and interact in a single, readable, AI-friendly line
await steps.click('CheckoutPage', 'submitButton');
```

---

## 📦 Installation

Install the package via your preferred package manager:

```bash
npm i pw-element-interactions
```

**Peer Dependencies:**
This package requires `@playwright/test` to be installed in your project. If you are using the `Steps` API, you will also need `pw-element-repository`.

---

## 🚀 What is it good for?

* **Zero Locator Boilerplate:** The new `Steps` API fetches elements and interacts with them in a single method call.
* **Separation of Concerns:** Keep your interaction logic entirely detached from how elements are found on the page.
* **Readable Tests:** Abstract away Playwright boilerplate into semantic methods (`clickIfPresent`, `verifyPresence`, `selectDropdown`).
* **Standardized Waiting:** Easily wait for elements to reach specific DOM states (visible, hidden, attached, detached) with built-in utility methods.
* **Advanced Visual Checks:** Includes a highly reliable `verifyImages` method that evaluates actual browser decoding and `naturalWidth` to ensure images aren't just in the DOM, but are properly rendered.
* **Smart Dropdowns:** Easily select dropdown options by value, index, or completely randomly (skipping disabled or empty options automatically).
* **Flexible Verifications:** Easily verify exact text, non-empty text, or dynamic element counts (greater than, less than, or exact).
* **Advanced Drag & Drop:** Seamlessly drag elements to other elements, drop them at specific coordinate offsets, or combine both strategies natively.

---

## 💻 Usage: The `Steps` API (Recommended)

Initialize the `Steps` class by passing the current Playwright `page` object and your `ElementRepository` instance.

### Example Scenario

```ts
import { test } from '@playwright/test';
import { ElementRepository } from 'pw-element-repository';
import { Steps, DropdownSelectType } from 'pw-element-interactions';

test('Add random product and verify image gallery', async ({ page }) => {
  // 1. Initialize Repository & Steps
  const repo = new ElementRepository('tests/data/locators.json');
  const steps = new Steps(page, repo);

  // 2. Navigate
  await steps.navigateTo('/');

  // 3. Direct Interaction (Fetches and clicks in one line)
  await steps.click('HomePage', 'category-accessories');

  // 4. Randomized Acquisition & Action
  await steps.clickRandom('AccessoriesPage', 'product-cards');
  await steps.verifyUrlContains('/product/');

  // 5. Smart Dropdown Interaction
  const selectedSize = await steps.selectDropdown('ProductDetailsPage', 'size-selector', { 
    type: DropdownSelectType.RANDOM 
  });
  console.log(`Selected size: ${selectedSize}`);

  // 6. Flexible Assertions & Data Extraction
  await steps.verifyCount('ProductDetailsPage', 'gallery-images', { greaterThan: 0 });
  await steps.verifyText('ProductDetailsPage', 'product-title', undefined, { notEmpty: true });
  
  // 7. Advanced Image Verification
  await steps.verifyImages('ProductDetailsPage', 'gallery-images');
  
  // 8. Explicit Waits
  await steps.waitForState('CheckoutPage', 'confirmation-modal', 'visible');
});
```

---

## 🔧 Fixtures: Zero-Setup Tests (Recommended)

For larger projects, manually initializing `repo` and `steps` inside every test quickly becomes repetitive. `pw-element-interactions` ships a `baseFixture` factory that injects all core dependencies automatically via Playwright's fixture system.

### What's included

| Fixture | Type | Description |
|---|---|---|
| `steps` | `Steps` | The full Steps API, ready to use |
| `repo` | `ElementRepository` | Direct repository access for advanced locator queries |
| `interactions` | `ElementInteractions` | Raw interactions API for custom locators |
| `contextStore` | `ContextStore` | Shared in-memory store for passing data between steps |

### 1. Create your fixture file

Call `baseFixture` once, passing your own `test` base and the path to your locator repository:

```ts
// tests/fixtures/base.ts
import { test as base, expect } from '@playwright/test';
import { baseFixture } from 'pw-element-interactions';

export const test = baseFixture(base, 'tests/data/page-repository.json');
export { expect };
```

### 2. Use fixtures in your tests

Import `test` from your fixture file. All four fixtures are available as named parameters — no setup code required:

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

### 3. Access `repo` directly when needed

For advanced queries like resolving a locator by visible text, destructure `repo` alongside `steps`:

```ts
test('Navigate to Forms category', async ({ page, repo, steps }) => {
  await steps.navigateTo('/');

  const formsLink = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
  await formsLink?.click();

  await steps.verifyAbsence('HomePage', 'categories');
});
```

### 4. Extend with your own fixtures

Because `baseFixture` returns a standard Playwright `test` object, you can chain your own fixtures on top of it cleanly:

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

All fixtures are then available together in any test:

```ts
test('Authenticated flow', async ({ steps, authService }) => {
  await authService.login('user@test.com', 'secret');
  await steps.verifyUrlContains('/dashboard');
});
```

---

## 🛠️ API Reference: `Steps`

The `Steps` class automatically handles fetching the Playwright `Locator` using your `pageName` and `elementName` keys from the repository.

### 🧭 Navigation

* **`navigateTo(url: string)`**: Navigates the browser to the specified absolute or relative URL.
* **`refresh()`**: Reloads the current page.
* **`backOrForward(direction: 'BACKWARDS' | 'FORWARDS')`**: Navigates the browser history stack either backwards or forwards. Mirrors the behavior of the browser's native Back and Forward buttons.
* **`setViewport(width: number, height: number)`**: Resizes the browser viewport to the specified pixel dimensions. Useful for simulating different device screen sizes or responsive breakpoints.

### 🖱️ Interaction

* **`click(pageName: string, elementName: string)`**: Retrieves an element from the repository and performs a standard Playwright click. Automatically waits for the element to be attached, visible, stable, and actionable.
* **`clickWithoutScrolling(pageName: string, elementName: string)`**: Dispatches a native `click` event directly to the element, bypassing Playwright's default scrolling and intersection observer checks. Highly useful for clicking elements obscured by sticky headers or transparent overlays.
* **`clickIfPresent(pageName: string, elementName: string)`**: Checks if an element is visible before attempting to click it. Safely skips the action without failing the test if the element is hidden. Great for optional elements like cookie banners.
* **`clickRandom(pageName: string, elementName: string)`**: Retrieves a random element from a resolved list of locators and clicks it. Useful for clicking random items in a list or grid.
* **`hover(pageName: string, elementName: string)`**: Retrieves an element and hovers over it. Useful for triggering dropdowns or tooltips.
* **`scrollIntoView(pageName: string, elementName: string)`**: Retrieves an element and smoothly scrolls it into the viewport if it is not already visible.
* **`dragAndDrop(pageName: string, elementName: string, options: DragAndDropOptions)`**: Drags an element to a specified destination. Supports dropping onto another element (`{ target: Locator }`), dragging by coordinates (`{ xOffset: number, yOffset: number }`), or dropping onto a target at a specific offset.
* **`dragAndDropListedElement(pageName: string, elementName: string, elementText: string, options: DragAndDropOptions)`**: Finds a specific element by its text from a list of elements and drags it to a specified destination based on the provided options.
* **`fill(pageName: string, elementName: string, text: string)`**: Clears any existing value in the target input field and types the provided text.
* **`uploadFile(pageName: string, elementName: string, filePath: string)`**: Uploads a local file from the provided `filePath` to an `<input type="file">` element.
* **`selectDropdown(pageName: string, elementName: string, options?: DropdownSelectOptions)`**: Selects an option from a `<select>` element and returns its `value`. Defaults to a random, non-disabled option (`{ type: DropdownSelectType.RANDOM }`). Alternatively, select by exact value (`{ type: DropdownSelectType.VALUE, value: '...' }`) or zero-based index (`{ type: DropdownSelectType.INDEX, index: 1 }`).
* **`typeSequentially(pageName: string, elementName: string, text: string, delay?: number)`**: Types the provided text into an element character by character with a configurable delay between key presses (defaults to `100ms`). Ideal for OTP inputs, search bars, or any field with `keyup` listeners that do not respond correctly to bulk `fill()` operations.

### 📊 Data Extraction

* **`getText(pageName: string, elementName: string)`**: Safely retrieves and trims the text content of a specified element. Returns an empty string if null.
* **`getAttribute(pageName: string, elementName: string, attributeName: string)`**: Retrieves the value of a specified HTML attribute (e.g., `href`, `aria-pressed`) from an element. Returns `null` if the attribute doesn't exist.

### ✅ Verification

* **`verifyPresence(pageName: string, elementName: string)`**: Asserts that a specified element is attached to the DOM and is visible.
* **`verifyAbsence(pageName: string, elementName: string)`**: Asserts that a specified element is hidden or completely detached from the DOM.
* **`verifyText(pageName: string, elementName: string, expectedText?: string, options?: TextVerifyOptions)`**: Asserts the text of an element. Provide `expectedText` for an exact match, or pass `{ notEmpty: true }` in the options to simply assert that the dynamically generated text is not blank.
* **`verifyCount(pageName: string, elementName: string, options: CountVerifyOptions)`**: Asserts the number of elements matching the locator. Accepts a configuration object to evaluate: `{ exact: number }`, `{ greaterThan: number }`, or `{ lessThan: number }`.
* **`verifyImages(pageName: string, elementName: string, scroll?: boolean)`**: Performs a rigorous verification of one or more images. Asserts visibility, checks for a valid `src` attribute, ensures `naturalWidth > 0`, and evaluates the native browser `decode()` promise. Smoothly scrolls into view by default (`scroll: true`).
* **`verifyUrlContains(text: string)`**: Asserts that the active browser URL contains the expected substring.

### ⏳ Wait

* **`waitForState(pageName: string, elementName: string, state?: 'visible' | 'attached' | 'hidden' | 'detached')`**: Waits for an element to reach a specific state in the DOM. Defaults to `'visible'`.

---

## 🧱 Advanced Usage: Raw Interactions API

If you need to bypass the repository or interact with custom locators dynamically generated in your tests, you can use the underlying `ElementInteractions` class directly.

```ts
import { ElementInteractions } from 'pw-element-interactions';

// Initialize
const interactions = new ElementInteractions(page);

// Pass Playwright Locators directly
const customLocator = page.locator('button.dynamic-class');
await interactions.interact.clickWithoutScrolling(customLocator);
await interactions.verify.count(customLocator, { greaterThan: 2 });
```

*Note: All core interaction (`interact`), verification (`verify`), and navigation (`navigate`) methods are also available when using `ElementInteractions` directly.*

---

## 🤝 Contributing

Contributions are welcome! Please read the rules below carefully before opening a PR — they exist to keep the architecture clean, the test suite reliable, and the codebase consistent.

<<<<<<< Updated upstream
### Framework Design
=======
### 🧪 Testing Locally Before Opening a PR

Before pushing changes, verify your implementation works end-to-end in a real consumer project using [`yalc`](https://github.com/wclr/yalc) — a local package publishing tool that mirrors the npm install flow without actually publishing.

```bash
# 1. Install yalc globally (one-time setup)
npm i -g yalc

# 2. In the pw-element-interactions folder — publish to the local yalc store
yalc publish

# 3. In your consumer project — add the locally published package
yalc add pw-element-interactions
```

After making further changes, push updates to the consumer project without re-adding:

```bash
# In pw-element-interactions
yalc publish --push
```

To restore the original npm version when you're done:

```bash
# In your consumer project
yalc remove pw-element-interactions
npm install
```

### 📋 PR Guidelines
>>>>>>> Stashed changes

PRs must respect the layered architecture of this library. Every new capability follows a strict implementation order:

1. **Implement in the appropriate class first.** The core method must be added to the correct underlying class (`interact`, `verify`, `navigate`, or similar) before it is exposed anywhere else. Do not add a method only to `Steps` or `ElementInteractions` without first placing the logic in the right domain class.
2. **Then expose it via `Steps`.** Once the core method exists in its proper class, add the corresponding wrapper to the `Steps` (CommonSteps) class so it is accessible through the unified API.

PRs that skip step 1 and add convenience methods without a properly placed underlying implementation will not be merged.

### 🪵 Logging

The logging responsibility is clearly divided and must be respected:

* **Interaction methods must not contain any logs.** Keep them focused purely on the mechanics of the action.
* **`Steps` methods are responsible for logging.** Every `Steps` wrapper should log what action is being performed, providing observability at the right level of abstraction.

### 🧬 Unit Tests

Every new interaction method must be accompanied by a unit test.

Unit tests are run against the proprietary Vue test application at [https://github.com/Umutayb/vue-test-app](https://github.com/Umutayb/vue-test-app). This app is built from its Docker image during the CI pipeline to serve as the test target. All new tests must use this app.

If the component or UI element needed to test a new interaction does not exist in the Vue test app, **you must add it there first**:

1. Open a PR against `vue-test-app` to add the required component.
2. Wait for that PR to be merged.
3. Only then open or update the PR in this repository that adds the interaction and its test.

PRs that require a missing component but do not have a corresponding merged `vue-test-app` PR will not be merged.

### 📝 Documentation

Every new `Steps` method must be documented in the [API Reference](#️-api-reference-steps) section of this README. Add your method to the appropriate group (Navigation, Interaction, Data Extraction, Verification, or Wait) following the existing format: method signature, a plain-English description of what it does, and any relevant parameter or return value notes. PRs that add a public method without a corresponding README entry will not be merged.