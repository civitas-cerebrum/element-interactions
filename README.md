# Playwright Element Interactions

[![NPM Version](https://img.shields.io/npm/v/pw-element-interactions?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/pw-element-interactions)

A robust set of Playwright steps for readable interaction and assertions.

`pw-element-interactions` pairs perfectly with `pw-element-repository` to achieve a fully decoupled test automation architecture. By separating **Element Acquisition** from **Element Interaction**, your test scripts become highly readable, easily maintainable, and completely free of raw locators.

### ✨ The Unified Steps API

With the introduction of the `Steps` class, you can now combine your element repository and interactions into a single, flattened Facade. This eliminates repetitive locator fetching and transforms your tests into clean, plain-English steps.

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
* **Advanced Visual Checks:** Includes a highly reliable `verifyImages` method that evaluates actual browser decoding and `naturalWidth` to ensure images aren't just in the DOM, but are properly rendered.
* **Smart Dropdowns:** Easily select dropdown options by value, index, or completely randomly (skipping disabled or empty options automatically).

---

## 💻 Usage: The `Steps` API (Recommended)

Initialize the `Steps` class by passing the current Playwright `page` object and your `ElementRepository` instance.

### Example Scenario

```ts
import { test } from '@playwright/test';
import { ElementRepository } from 'pw-element-repository';
import { Steps } from 'pw-element-interactions';

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
  const selectedSize = await steps.selectDropdown('ProductDetailsPage', 'size-selector', { type: 'random' });
  console.log(`Selected size: ${selectedSize}`);

  // 6. Advanced Image Verification
  await steps.verifyImages('ProductDetailsPage', 'gallery-images');
});
```

---

## 🛠️ API Reference: `Steps`

The `Steps` class automatically handles fetching the Playwright `Locator` using your `pageName` and `elementName` keys from the repository.

### 🧭 Navigation

* **`MapsTo(url: string)`**: Navigates the browser to the specified absolute or relative URL.
* **`refresh()`**: Reloads the current page.

### 🖱️ Interaction

* **`click(pageName: string, elementName: string)`**: Retrieves an element from the repository and performs a standard click. Automatically waits for actionability.
* **`clickRandom(pageName: string, elementName: string)`**: Retrieves a random element from a resolved list of locators and clicks it. Useful for clicking random items in a list or grid.
* **`clickIfPresent(pageName: string, elementName: string)`**: Retrieves an element and clicks it only if it is visible. Prevents test failures on optional UI elements like cookie banners or promotional pop-ups.
* **`fill(pageName: string, elementName: string, text: string)`**: Retrieves an input field and fills it with the provided text, replacing any existing value.
* **`uploadFile(pageName: string, elementName: string, filePath: string)`**: Retrieves an `<input type="file">` and uploads the file from the provided local `filePath`.
* **`selectDropdown(pageName: string, elementName: string, options?: DropdownSelectOptions)`**: Interacts with `<select>` dropdown elements. Returns the exact `value` attribute of the selected option. Accepts:
* `{ type: 'random' }` *(Default)* - Selects a random, non-disabled option with a valid value.
* `{ type: 'value', value: 'string' }` - Selects by exact value.
* `{ type: 'index', index: 1 }` - Selects by index.



### ✅ Verification

* **`verifyPresence(pageName: string, elementName: string)`**: Asserts that a specified element is attached to the DOM and is visible.
* **`verifyAbsence(pageName: string, elementName: string)`**: Asserts that a specified element is hidden or completely detached from the DOM.
* **`verifyText(pageName: string, elementName: string, expectedText: string)`**: Asserts that the specified element exactly matches the expected text.
* **`verifyImages(pageName: string, elementName: string, scroll?: boolean)`**: Performs a rigorous verification of one or more images. Asserts visibility, checks for a valid `src` attribute, ensures `naturalWidth > 0`, and evaluates the native browser `decode()` promise. Smoothly scrolls into view by default (`scroll: true`).
* **`verifyUrlContains(text: string)`**: Asserts that the active browser URL contains the expected substring.

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
await interactions.verify.state(customLocator, 'enabled');
```

*Note: All core interaction (`interact`), verification (`verify`), and navigation (`Maps`) methods are also available when using `ElementInteractions` directly.*