---
name: pw-element-interactions
description: >
  Use this skill whenever writing or generating Playwright tests in a project that uses
  pw-element-interactions. Triggers on any request to write a
  test, add a locator, create a page object, use the Steps API, or interact with elements
  using this stack. Also use when asked to add entries to a page-repository JSON file,
  use fixtures, select dropdowns, verify elements, wait for states, or perform any
  browser interaction through this framework. Always consult this skill before generating
  test code or locator JSON — do not guess API shapes or invent method signatures.
---

# pw-element-interactions — Test Authoring Reference

This framework separates **where elements are defined** from **how they are used**. Selectors live in a JSON file; tests reference elements by readable string keys. No raw CSS or XPath ever appears in test code.

---

## 0. Understanding the Website Structure

Before writing tests or adding locators for an unfamiliar page or component, use the **Playwright MCP** to inspect the live site. This is the only reliable way to discover real selectors, element hierarchy, and page behaviour — do not guess or invent selectors from memory.

Typical uses:
- Navigating to a page and reading its DOM to find the right CSS selector or text for a new locator entry
- Verifying that an element is actually present and visible before writing an assertion
- Understanding the flow between pages before writing a multi-step test

If the Playwright MCP is not connected, ask the user to install it before proceeding:

```
I need the Playwright MCP to inspect the site and find accurate selectors.
Please install it by adding the following to your Claude Code MCP settings:

{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}

Then restart Claude Code and try again.
```

Do not attempt to write locators or test steps for unknown pages without first using the Playwright MCP to confirm the structure.

---

## 1. Adding Locators

All selectors are stored in a single JSON file (commonly `tests/data/page-repository.json`). Each page groups its elements by name. Provide as many selector strategies as you like — the repository uses the first one that resolves:

```json
{
  "pages": [
    {
      "name": "HomePage",
      "elements": [
        {
          "elementName": "submitButton",
          "selector": {
            "css": "button[data-test='submit']",
            "xpath": "//button[@data-test='submit']",
            "id": "submit-btn",
            "text": "Submit"
          }
        }
      ]
    }
  ]
}
```

**Naming conventions:**
- `name` — PascalCase page identifier, e.g. `CheckoutPage`, `ProductDetailsPage`
- `elementName` — camelCase element identifier, e.g. `submitButton`, `gallery-images`

---

## 2. Setup

### Option A — Fixtures (recommended)

Define once in a fixture file; every test gets `steps`, `repo`, `interactions`, and `contextStore` for free:

```ts
// tests/fixtures/base.ts
import { test as base } from '@playwright/test';
import { baseFixture } from 'pw-element-interactions';

export const test = baseFixture(base, 'tests/data/page-repository.json');
export { expect } from '@playwright/test';
```

```ts
// tests/checkout.spec.ts
import { test } from '../fixtures/base';

test('complete checkout', async ({ steps }) => {
  await steps.navigateTo('/checkout');
  await steps.click('CheckoutPage', 'submitButton');
});
```

### Option B — Manual initialisation

```ts
import { ElementRepository } from 'pw-element-repository';
import { Steps } from 'pw-element-interactions';

const repo  = new ElementRepository('tests/data/page-repository.json', 15000);
const steps = new Steps(page, repo);
```

---

## 3. Steps API

Every method takes `pageName` and `elementName` as its first two arguments, matching keys in your JSON file.

### 🧭 Navigation

```ts
await steps.navigateTo('/path');
await steps.refresh();
await steps.backOrForward('BACKWARDS'); // or 'FORWARDS'
await steps.setViewport(1280, 720);
```

### 🖱️ Interaction

```ts
// Standard click — waits for visible, stable, actionable
await steps.click('PageName', 'elementName');

// Click without scrolling — use for elements behind sticky headers or overlays
await steps.clickWithoutScrolling('PageName', 'elementName');

// Click only if the element is visible — silently skips if not (e.g. cookie banners)
await steps.clickIfPresent('PageName', 'elementName');

// Click a random element from a matched list (e.g. product cards)
await steps.clickRandom('PageName', 'elementName');

// Hover to trigger a tooltip or dropdown
await steps.hover('PageName', 'elementName');

// Scroll element into view
await steps.scrollIntoView('PageName', 'elementName');

// Clear and type text
await steps.fill('PageName', 'elementName', 'my input');

// Type character by character — use for OTP inputs or fields with keyup listeners
await steps.typeSequentially('PageName', 'elementName', 'my input');
await steps.typeSequentially('PageName', 'elementName', 'my input', 50); // custom delay ms

// Upload a file
await steps.uploadFile('PageName', 'elementName', 'tests/fixtures/file.pdf');

// Select from a <select> dropdown — returns the selected value
import { DropdownSelectType } from 'pw-element-interactions';

const value = await steps.selectDropdown('PageName', 'elementName');                                         // random (default)
const value = await steps.selectDropdown('PageName', 'elementName', { type: DropdownSelectType.RANDOM });
const value = await steps.selectDropdown('PageName', 'elementName', { type: DropdownSelectType.VALUE, value: 'xl' });
const value = await steps.selectDropdown('PageName', 'elementName', { type: DropdownSelectType.INDEX, index: 2 });

// Drag and drop
await steps.dragAndDrop('PageName', 'elementName', { target: otherLocator });
await steps.dragAndDrop('PageName', 'elementName', { xOffset: 100, yOffset: 0 });

// Drag a specific listed item by its text
await steps.dragAndDropListedElement('PageName', 'elementName', 'Item Label', { target: otherLocator });
```

### 📊 Data Extraction

```ts
const text = await steps.getText('PageName', 'elementName');        // trimmed text; '' if null
const href  = await steps.getAttribute('PageName', 'elementName', 'href'); // null if absent
```

### ✅ Verification

```ts
// Presence / absence
await steps.verifyPresence('PageName', 'elementName');
await steps.verifyAbsence('PageName', 'elementName');

// Text — exact match or non-empty check
await steps.verifyText('PageName', 'elementName', 'Expected text');
await steps.verifyText('PageName', 'elementName', undefined, { notEmpty: true });

// Count
await steps.verifyCount('PageName', 'elementName', { exact: 3 });
await steps.verifyCount('PageName', 'elementName', { greaterThan: 0 });
await steps.verifyCount('PageName', 'elementName', { lessThan: 10 });

// Images — checks visibility, valid src, naturalWidth > 0, and browser decode()
await steps.verifyImages('PageName', 'elementName');
await steps.verifyImages('PageName', 'elementName', false); // skip scroll-into-view

// URL
await steps.verifyUrlContains('/dashboard');
```

### ⏳ Waiting

```ts
await steps.waitForState('PageName', 'elementName');               // default: 'visible'
await steps.waitForState('PageName', 'elementName', 'hidden');
await steps.waitForState('PageName', 'elementName', 'attached');
await steps.waitForState('PageName', 'elementName', 'detached');
```

---

## 4. Accessing the Repository Directly

When you need more than a simple locator lookup — filtering by visible text, iterating all matches, or picking a random item — use `repo` directly alongside `steps`:

```ts
test('navigate to Forms', async ({ page, repo, steps }) => {
  await steps.navigateTo('/');

  // Resolve a locator by the visible text it contains
  const formsLink = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
  await formsLink?.click();

  await steps.verifyAbsence('HomePage', 'categories');
});
```

### Repository API

```ts
// Single locator — waits for DOM attachment
await repo.get(page, 'PageName', 'elementName');

// All matching locators — use for iteration
await repo.getAll(page, 'PageName', 'elementName');

// A random locator from the matched set — waits for visibility
await repo.getRandom(page, 'PageName', 'elementName');

// First locator whose visible text contains the given string
await repo.getByText(page, 'PageName', 'elementName', 'Desired Text');

// Sync — returns the raw selector string, e.g. "css=.btn"
repo.getSelector('PageName', 'elementName');
```

---

## 5. Complete Test Example

```ts
import { test } from '../fixtures/base';
import { DropdownSelectType } from 'pw-element-interactions';

test('add product to cart and verify', async ({ page, repo, steps }) => {
  await steps.navigateTo('/');

  // Click a category by its visible label
  const accessories = await repo.getByText(page, 'HomePage', 'categories', 'Accessories');
  await accessories?.click();

  // Pick a random product
  await steps.clickRandom('AccessoriesPage', 'productCards');
  await steps.verifyUrlContains('/product/');

  // Select a size from the dropdown
  const size = await steps.selectDropdown('ProductPage', 'sizeSelector', {
    type: DropdownSelectType.RANDOM,
  });
  console.log(`Selected size: ${size}`);

  // Verify the image gallery loaded correctly
  await steps.verifyCount('ProductPage', 'galleryImages', { greaterThan: 0 });
  await steps.verifyImages('ProductPage', 'galleryImages');

  // Verify product title is not blank
  await steps.verifyText('ProductPage', 'productTitle', undefined, { notEmpty: true });

  // Add to cart and wait for confirmation
  await steps.click('ProductPage', 'addToCartButton');
  await steps.waitForState('ProductPage', 'confirmationModal', 'visible');
});
```

---

## 6. Extending Fixtures

Add your own fixtures on top of the base without losing `steps`, `repo`, or `contextStore`:

```ts
// tests/fixtures/base.ts
import { test as base } from '@playwright/test';
import { baseFixture } from 'pw-element-interactions';
import { AuthService } from '../services/AuthService';

type MyFixtures = { authService: AuthService };

export const test = baseFixture(base, 'tests/data/page-repository.json')
  .extend<MyFixtures>({
    authService: async ({ page }, use) => {
      await use(new AuthService(page));
    },
  });

export { expect } from '@playwright/test';
```

```ts
test('authenticated flow', async ({ steps, authService }) => {
  await authService.login('user@test.com', 'secret');
  await steps.verifyUrlContains('/dashboard');
});
```