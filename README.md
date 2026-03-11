# Playwright Element Interactions

[![NPM Version](https://img.shields.io/npm/v/pw-element-interactions?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/pw-element-interactions)

A robust, readable interaction and assertion wrapper for Playwright. 

`pw-element-interactions` pairs perfectly with `pw-element-repository` to achieve a fully decoupled test automation architecture. By separating **Element Acquisition** from **Element Interaction**, your test scripts become highly readable, easily maintainable, and completely free of raw locators.

## 📦 Installation

Install the package via your preferred package manager:

```bash
npm i pw-element-interactions

```

**Peer Dependencies:**
This package requires `@playwright/test` to be installed in your project.

## 🚀 What is it good for?

* **Separation of Concerns:** Keep your interaction logic and assertions entirely detached from how elements are found on the page.
* **Readable Tests:** Abstract away Playwright boilerplate into semantic, English-like methods (`click`, `verifyPresence`, `fill`).
* **Advanced Visual Checks:** Includes a highly reliable `verifyImages` method that evaluates actual browser decoding and `naturalWidth` to ensure images aren't just in the DOM, but are properly rendered.
* **Safe Interactions:** Built-in methods like `clickIfPresent` and `clickWithoutScrolling` (using native `dispatchEvent`) to bypass common UI flakiness like sticky headers or overlapping modals.
* **Smart Dropdowns:** Easily select dropdown options by value, index, or completely randomly (skipping disabled or empty options automatically).

## 💻 Usage

Initialize the `ElementInteractions` class by passing the current Playwright `page` object. Use it in tandem with your locator strategy (like `pw-element-repository`) to orchestrate your tests.

### Example Scenario

```typescript
import { test } from '@playwright/test';
import { Interactions } from 'pw-element-interactions';
import { ElementRepository } from 'pw-element-repository';

test('Add random product and verify image gallery', async ({ page }) => {
  // 1. Initialize Interactions
  const interactions = new ElementInteractions(page);
  const repo = new ElementRepository('tests/data/locators.json', 15000);

  // 2. Navigate
  await interactions.navigate.navigateToUrl('/');

  // 3. Acquire & Interact
  const categoryLink = await repo.get(page, 'HomePage', 'category-accessories');
  await interactions.interact.click(categoryLink);

  // 4. Randomized Acquisition & Safe Interaction
  const randomProduct = await repo.getRandom(page, 'AccessoriesPage', 'product-cards');
  await interactions.interact.click(randomProduct);

  await interactions.verify.verifyUrlContains('/product/');

  // 5. Smart Dropdown Interaction
  const sizeDropdown = await repo.get(page, 'ProductDetailsPage', 'size-selector');
  const selectedSize = await interactions.interact.selectDropdown(sizeDropdown, { type: 'random' });
  console.log(`Selected size: ${selectedSize}`);

  // 6. Advanced Image Verification
  const productGallery = await repo.get(page, 'ProductDetailsPage', 'gallery-images');
  await interactions.verify.verifyImages(productGallery, 'Product PDP Gallery', true);
});

```

## 🛠️ API Reference

### 🧭 Navigation & Browser Management

* **`MapsToUrl(url)`**: Navigates the browser to the specified URL.
* **`refreshPage()`**: Reloads the current page.
* **`MapsBrowser(direction)`**: Navigates history (`'BACKWARDS'` or `'FORWARDS'`).
* **`setWindowSize(width, height)`**: Sets the browser viewport dimensions.

### 🖱️ Element Interactions

All interaction methods accept a Playwright `Locator` object.

* **`click(locator)`**: Standard click. Automatically waits for actionability.
* **`clickWithoutScrolling(locator)`**: Dispatches a native `'click'` event. Bypasses intersection observers and sticky headers.
* **`clickIfPresent(locator)`**: Safely clicks an element only if it is visible, preventing failures on optional elements (like cookie banners).
* **`fill(locator, text)`**: Clears the input and types the provided text.
* **`uploadFile(locator, filePath)`**: Uploads a file to a specific `<input type="file">`.
* **`selectDropdown(locator, options?)`**: Unified method to interact with `<select>` elements. Returns the selected value. Accepts an options object (`DropdownSelectOptions`):
* `{ type: 'random' }` (Default) - Selects a random, non-disabled option with a valid value.
* `{ type: 'value', value: 'string' }` - Selects by exact value.
* `{ type: 'index', index: 1 }` - Selects by index.



### ✅ Verifications & Assertions

All verification methods automatically utilize Playwright's auto-retrying `expect` under the hood.

* **`verifyText(locator, expectedText)`**: Asserts exact text match.
* **`verifyTextContains(locator, expectedText)`**: Asserts the element contains a substring.
* **`verifyPresence(locator)`**: Asserts the element is visible in the DOM.
* **`verifyAbsence(locator)`**: Asserts the element is hidden or detached.
* **`verifyElementState(locator, state)`**: Asserts whether an element is `'enabled'` or `'disabled'`.
* **`verifyAttribute(locator, attributeName, expectedValue)`**: Asserts the value of an HTML attribute (e.g., `href`, `class`).
* **`verifyUrlContains(text)`**: Asserts the active browser URL contains a specific substring.
* **`verifyImages(imagesLocator, contextName?, scroll?)`**: Robust image verification. Scrolls into view, checks visibility, asserts the `src` is populated, checks `naturalWidth > 0`, and evaluates the native `HTMLImageElement.decode()` promise to guarantee the image is not a broken 404 link.