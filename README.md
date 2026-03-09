# Playwright Element Repository

[![NPM Version](https://img.shields.io/npm/v/pw-element-repository?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/pw-element-repository)

A lightweight, robust package that decouples your Playwright UI selectors from your test code. By externalizing locators into a central JSON repository, you make your test automation framework cleaner, easier to maintain, and accessible to non-developers.

## 📦 Installation

Install the package via your preferred package manager:

```bash
npm i pw-element-repository
```

**Peer Dependencies:**
This package requires `@playwright/test` or `playwright` to be installed in your project.

## 🚀 What is it good for?

* **Zero Hardcoded Selectors:** Keep your Page Objects and Step Definitions completely free of complex DOM queries.
* **Dynamic Parsing:** Automatically converts your JSON configuration into native Playwright CSS, XPath, ID, or Text selectors.
* **Smart Locators:** Built-in methods for handling arrays, randomized element selection (great for catalog/PLP testing), and text-filtering.
* **Soft Waiting:** Seamlessly waits for elements to attach and become visible before returning a locator to prevent flake.

## 🏗️ Configuration

Create a JSON file in your project to hold your selectors. The file must adhere to the standard schema:

**`locators.json`**

```json
{
  "pages": [
    {
      "name": "HomePage",
      "elements": [
        {
          "elementName": "search-input",
          "selector": { "css": "input[name='search']" }
        },
        {
          "elementName": "submit-button",
          "selector": { "id": "btn-submit" }
        }
      ]
    },
    {
      "name": "ProductList",
      "elements": [
        {
          "elementName": "product-cards",
          "selector": { "xpath": "//article[@class='product']" }
        }
      ]
    }
  ]
}

```

## 💻 Usage

You can initialize the `ElementRepository` either by passing the **file path** to your JSON, or by passing the **parsed JSON object** directly.

### Initialization

```typescript
import { test } from '@playwright/test';
import { ElementRepository } from 'pw-element-repository';

// Option A: Pass the path to your JSON (relative to your project root)
const repo = new ElementRepository('tests/data/locators.json', 15000);

// Option B: Import the JSON directly (requires resolveJsonModule in tsconfig)
import locatorData from '../data/locators.json';
const repo = new ElementRepository(locatorData, 15000);

```

### Retrieving Elements

The repository exposes clean, asynchronous methods that return Playwright `Locator` objects, ready for interaction.

```typescript
test('Search and select random product', async ({ page }) => {
  await page.goto('/');

  // 1. Get a standard element
  const searchInput = await repo.get(page, 'HomePage', 'search-input');
  await searchInput.fill('Trousers');

  const submitBtn = await repo.get(page, 'HomePage', 'submit-button');
  await submitBtn.click();

  // 2. Select a random element from a list
  const randomProduct = await repo.getRandom(page, 'ProductList', 'product-cards');
  await randomProduct?.click();
  
  // 3. Find a specific element by text within a list
  const specificProduct = await repo.getByText(page, 'ProductList', 'product-cards', 'Blue Chinos');
  await specificProduct?.click();
});

```

## 🛠️ API Reference

### `get(page, pageName, elementName)`

Returns a single Playwright Locator. Waits for the selector to attach to the DOM based on your configured timeout.

### `getAll(page, pageName, elementName)`

Returns an array of resolved Locator handles (`Locator[]`). Useful when you need to iterate over multiple elements.

### `getRandom(page, pageName, elementName, strict?)`

Counts the matching elements and randomly selects one. Safely waits for the specific randomized element to become visible.

### `getByText(page, pageName, elementName, desiredText, strict?)`

Returns the first Locator matching the mapped selector that also contains the `desiredText`.

### `getSelector(pageName, elementName)`

Returns the raw string selector mapped to the given element (e.g., "css=input[name='search']" or "xpath=//div"). This is a synchronous method primarily useful for debugging, custom logging, or passing raw selector strings directly into native Playwright APIs that require strings instead of Locator objects.