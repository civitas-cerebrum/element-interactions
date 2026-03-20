---
name: pw-element-interactions-dev
description: >
  Use this skill whenever writing, editing, or generating Playwright tests that use the
  pw-element-interactions or pw-element-repository packages. Triggers on any mention of
  these packages, the Steps API, ElementRepository, ElementInteractions, baseFixture,
  ContextStore, or when asked to add/update locators in a page-repository JSON file.
  Also use when writing new interaction methods, Steps wrappers, or unit tests for this
  framework. Always consult this skill before generating any test code, locator JSON, or
  interaction implementation for this stack — do not rely on memory or guess API shapes.
---

# pw-element-interactions — Agent Skill

A two-package Playwright framework that fully decouples **element acquisition** (`pw-element-repository`) from **element interaction** (`pw-element-interactions`). Tests reference elements by plain strings (`'HomePage'`, `'submitButton'`); raw selectors never appear in test code.

---

## Package Overview

| Package | Role |
|---|---|
| `pw-element-repository` | Reads a JSON locator file; resolves `pageName` + `elementName` → Playwright `Locator` |
| `pw-element-interactions` | Wraps Playwright actions and assertions; exposes them via the `Steps` facade |

Install both:
```bash
npm i pw-element-interactions pw-element-repository
```

---

## 1. Locator Repository (`pw-element-repository`)

### JSON Schema

Selectors live in a single JSON file. Each page has a name and a list of named elements. Each element can carry one or more selector strategies — the repository picks the first one it finds:

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

### Initialisation

```ts
import { ElementRepository } from 'pw-element-repository';

// Second argument is the global timeout in ms (defaults to 15000)
const repo = new ElementRepository('tests/data/page-repository.json', 15000);
```

### API — all methods are async and return a Playwright `Locator` (or array) unless noted

```ts
// Single locator — waits for DOM attachment
await repo.get(page, 'HomePage', 'submitButton');

// All matching locators — for iteration
await repo.getAll(page, 'HomePage', 'productCards');

// A random locator from the matched set — waits for visibility
await repo.getRandom(page, 'HomePage', 'productCards', strict?);

// First locator whose visible text contains desiredText
await repo.getByText(page, 'HomePage', 'categories', 'Forms', strict?);

// Sync — returns the raw selector string, e.g. "css=.btn"
repo.getSelector('HomePage', 'submitButton');
```

### Usage Example

```ts
await test.step('Navigate to Forms via category link', async () => {
  const repo = new ElementRepository('tests/data/page-repository.json');
  const formsLink = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
  await formsLink?.click();
  await steps.verifyAbsence('HomePage', 'categories');
});
```

---

## 2. Steps API (`pw-element-interactions`)

`Steps` is the primary interface. It combines repository lookup and interaction in a single call, and owns all logging.

### Initialisation

```ts
import { ElementRepository } from 'pw-element-repository';
import { Steps } from 'pw-element-interactions';

const repo  = new ElementRepository('tests/data/page-repository.json');
const steps = new Steps(page, repo);
```

### Fixtures (recommended for larger projects)

Use `baseFixture` to inject `steps`, `repo`, `interactions`, and `contextStore` automatically:

```ts
// tests/fixtures/base.ts
import { test as base } from '@playwright/test';
import { baseFixture } from 'pw-element-interactions';

export const test = baseFixture(base, 'tests/data/page-repository.json');
export { expect } from '@playwright/test';
```

```ts
// tests/example.spec.ts
import { test } from '../fixtures/base';

test('example', async ({ steps }) => {
  await steps.navigateTo('/');
  await steps.click('HomePage', 'submitButton');
});
```

### Full API Reference

#### 🧭 Navigation
| Method | Description |
|---|---|
| `navigateTo(url)` | Navigate to an absolute or relative URL |
| `refresh()` | Reload the current page |
| `backOrForward(direction)` | `'BACKWARDS'` or `'FORWARDS'` through browser history |
| `setViewport(width, height)` | Resize the browser viewport |

#### 🖱️ Interaction
| Method | Description |
|---|---|
| `click(pageName, elementName)` | Click — waits for visible, stable, actionable |
| `clickWithoutScrolling(pageName, elementName)` | Dispatches a native click event, bypassing scroll checks. Use for elements hidden behind sticky headers or overlays |
| `clickIfPresent(pageName, elementName)` | Clicks only if visible; silently skips if not. Ideal for optional elements like cookie banners |
| `clickRandom(pageName, elementName)` | Clicks a random element from a matched list |
| `hover(pageName, elementName)` | Hover over an element (tooltips, dropdowns) |
| `scrollIntoView(pageName, elementName)` | Smoothly scroll element into the viewport |
| `fill(pageName, elementName, text)` | Clear and type text into an input |
| `typeSequentially(pageName, elementName, text, delay?)` | Type text character by character with a configurable delay (default `100ms`). Use for OTP inputs, search bars, or fields with `keyup` listeners that do not respond to `fill()` |
| `uploadFile(pageName, elementName, filePath)` | Upload a local file to an `<input type="file">` |
| `selectDropdown(pageName, elementName, options?)` | Select from a `<select>`. Options: `{ type: RANDOM }` (default), `{ type: VALUE, value: '...' }`, `{ type: INDEX, index: 1 }`. Returns the selected value |
| `dragAndDrop(pageName, elementName, options)` | Drag to a target element, coordinate offset, or both |
| `dragAndDropListedElement(pageName, elementName, elementText, options)` | Find an element in a list by text, then drag it |

#### 📊 Data Extraction
| Method | Description |
|---|---|
| `getText(pageName, elementName)` | Trimmed text content; returns `''` if null |
| `getAttribute(pageName, elementName, attributeName)` | HTML attribute value (e.g. `href`, `aria-pressed`); returns `null` if absent |

#### ✅ Verification
| Method | Description |
|---|---|
| `verifyPresence(pageName, elementName)` | Asserts element is attached and visible |
| `verifyAbsence(pageName, elementName)` | Asserts element is hidden or detached |
| `verifyText(pageName, elementName, expectedText?, options?)` | Exact text match, or `{ notEmpty: true }` to assert non-blank dynamic text |
| `verifyCount(pageName, elementName, options)` | Assert element count: `{ exact }`, `{ greaterThan }`, or `{ lessThan }` |
| `verifyImages(pageName, elementName, scroll?)` | Full image health check: visibility, valid `src`, `naturalWidth > 0`, browser `decode()` |
| `verifyUrlContains(text)` | Assert the current URL contains a substring |

#### ⏳ Wait
| Method | Description |
|---|---|
| `waitForState(pageName, elementName, state?)` | Wait for `'visible'` (default), `'attached'`, `'hidden'`, or `'detached'` |

---

## 3. Raw Interactions API

Use `ElementInteractions` to interact with locators created directly in test code, without going through the repository:

```ts
import { ElementInteractions } from 'pw-element-interactions';

const interactions = new ElementInteractions(page);
const customLocator = page.locator('button.dynamic-class');

await interactions.interact.clickWithoutScrolling(customLocator);
await interactions.verify.count(customLocator, { greaterThan: 2 });
```

---

## 4. Contributing — Rules to Follow When Generating Code

When adding new methods, always respect these rules:

### Architecture order
1. Implement the core logic in the correct domain class (`interact`, `verify`, `navigate`, etc.) first.
2. Then add a `Steps` wrapper that calls it.  
   Never add only a `Steps` method without the underlying class method.

### Logging
- **Interaction methods must not log anything.** Pure mechanics only.
- **`Steps` wrappers are responsible for all logging.** Every wrapper should emit a `[Step] ->` log describing the action being taken.

### Unit tests
- Every new interaction requires a unit test.
- Tests must target the Vue test app at [https://github.com/Umutayb/vue-test-app](https://github.com/Umutayb/vue-test-app) (built via Docker in CI).
- If the required UI component does not exist in the Vue test app, open a PR there first, get it merged, then proceed with the interaction PR.

### Documentation
- Every new `Steps` method must be added to the API Reference section of `README.md`, in the correct group, following the existing format.