---
name: pw-element-interactions
description: >
  Use this skill whenever writing, editing, or generating Playwright tests! Triggers on any mention of
  Playwright tests, pw-element-interactions or pw-element-repository packages, the Steps API, ElementRepository, ElementInteractions, baseFixture,
  ContextStore, page-repository.json, or any request to write, fix, or add to a Playwright test in this project.
---

# pw-element-interactions — Agent Skill

A two-package Playwright framework that decouples **element acquisition** (`pw-element-repository`) from **element interaction** (`pw-element-interactions`). Tests reference elements by plain strings (`'HomePage'`, `'submitButton'`); raw selectors never appear in test code.

---

## 🚨 ABSOLUTE RULES — STOP AND READ BEFORE ANY ACTION

**STOP. Do not write any code until you have read and understood every rule below.**
These rules are non-negotiable. They override helpfulness, initiative, and assumptions. If you are unsure about any rule, ask the user. Do not guess.

### 1. Do NOT write tests unless the user explicitly asks you to
- "Explicitly" means the user said something like "write a test" or "add a test." Do not infer it.
- If you are not 100% certain the user wants a test, **ask**. Do not write.
- When asked: produce a plan first (files, scenarios, locators). Wait for approval. Then write.

### 2. Do NOT edit `page-repository.json` without explicit permission
- Show the user the exact JSON you want to add. Wait for "yes." Then edit.
- No silent additions. No "I'll just add this one locator."

### 3. Do NOT invent selectors — inspect the live site first
- You do not know what selectors exist on the page. Do not guess.
- Use the Playwright MCP to navigate to the page and inspect the real DOM.
- If the Playwright MCP is not available, **stop completely** and tell the user.

### 4. Do NOT invent type definitions
- If a type is missing, tell the user. Do not create `.d.ts` stubs or workarounds.

### 5. Prefer element repository entries over inline selectors
- When possible, add selectors to `page-repository.json` and reference them by name.
- Use `{ child: { pageName: 'PageName', elementName: 'elementName' } }` over `{ child: 'td:nth-child(2)' }`.
- This is a preference, not a hard ban — inline selectors are acceptable when a repo entry would be overkill.

### 6. When a test fails: look at the screenshot FIRST
- The base fixture captures a `failure-screenshot` on every failure.
- Run `npx playwright show-report` and look at the screenshot before doing anything else.
- Do NOT guess what went wrong from the error message alone. The screenshot tells you what actually happened.
- If the screenshot shows a selector problem, re-inspect the live DOM before changing locators.

### 7. Before modifying `playwright.config.ts`, read the existing file first

### Workflow
- **Run the tests** to validate your work. Do not skip this.
- **Commit** after every confirmed success. Do not batch.

---

## 1. Adding Locators

All selectors live in `tests/data/page-repository.json`. Verify selectors against the live DOM via Playwright MCP before adding — never guess.

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

Supports `css`, `xpath`, `id`, or `text` strategies. Names: PascalCase pages (`CheckoutPage`), camelCase elements (`submitButton`).

---

## 2. Setup — Fixtures

Read `tests/fixtures/base.ts` first if it exists — do not overwrite without checking.

```ts
// tests/fixtures/base.ts
import { test as base, expect } from '@playwright/test';
import { baseFixture } from 'pw-element-interactions';

export const test = baseFixture(base, 'tests/data/page-repository.json');
export { expect };
```

| Fixture | Type | Description |
|---|---|---|
| `steps` | `Steps` | The full Steps API |
| `repo` | `ElementRepository` | Direct repository access for advanced locator queries |
| `interactions` | `ElementInteractions` | Raw interactions API for custom locators |
| `contextStore` | `ContextStore` | Shared in-memory key-value store for passing data between steps within a test |

`baseFixture` attaches a full-page `failure-screenshot` to the HTML report on every failed test automatically.

**Extending with custom fixtures** — `baseFixture` returns a standard Playwright `test` object, so use `.extend<T>()` as usual.

---

## 3. Steps API

Every method takes `pageName` and `elementName` as its first two arguments, matching keys in your JSON file.

**Imports** — add at the top of your test file as needed:
```ts
import { DropdownSelectType, ListedElementOptions, FillFormValue, ScreenshotOptions } from 'pw-element-interactions';
```

### 🧭 Navigation

```ts
await steps.navigateTo('/path');
await steps.refresh();
await steps.backOrForward('BACKWARDS'); // or 'FORWARDS'
await steps.setViewport(1280, 720);

// Tab management
const newPage = await steps.switchToNewTab(async () => {
  await steps.click('PageName', 'newTabLink');
});
await steps.closeTab(newPage);
const count = steps.getTabCount();
```

### 🖱️ Interaction

```ts
await steps.click('PageName', 'elementName');
await steps.clickWithoutScrolling('PageName', 'elementName');
await steps.clickIfPresent('PageName', 'elementName');
await steps.clickRandom('PageName', 'elementName');
await steps.clickNth('PageName', 'elementName', 2);           // zero-based index
await steps.rightClick('PageName', 'elementName');
await steps.doubleClick('PageName', 'elementName');
await steps.check('PageName', 'elementName');
await steps.uncheck('PageName', 'elementName');
await steps.hover('PageName', 'elementName');
await steps.scrollIntoView('PageName', 'elementName');
await steps.fill('PageName', 'elementName', 'text');
await steps.clearInput('PageName', 'elementName');
await steps.typeSequentially('PageName', 'elementName', 'text', 50); // optional delay ms
await steps.uploadFile('PageName', 'elementName', 'path/to/file.pdf');
await steps.setSliderValue('PageName', 'elementName', 75);
await steps.pressKey('Enter');                                 // 'Escape', 'Tab', 'Control+A', etc.

// Dropdowns
const val = await steps.selectDropdown('PageName', 'elementName');                                              // random (default)
const val2 = await steps.selectDropdown('PageName', 'elementName', { type: DropdownSelectType.VALUE, value: 'xl' });
const val3 = await steps.selectDropdown('PageName', 'elementName', { type: DropdownSelectType.INDEX, index: 2 });
await steps.selectMultiple('PageName', 'multiSelect', ['opt1', 'opt2']);

// Drag and drop
await steps.dragAndDrop('PageName', 'elementName', { target: otherLocator });
await steps.dragAndDrop('PageName', 'elementName', { xOffset: 100, yOffset: 0 });
await steps.dragAndDropListedElement('PageName', 'elementName', 'Item Label', { target: otherLocator });
```

### 📊 Data Extraction

```ts
const text = await steps.getText('PageName', 'elementName');
const href = await steps.getAttribute('PageName', 'elementName', 'href');
const count = await steps.getCount('PageName', 'elementName');
const inputVal = await steps.getInputValue('PageName', 'elementName');
const color = await steps.getCssProperty('PageName', 'elementName', 'color');

// Bulk extraction
const allTexts = await steps.getAll('PageName', 'listItems');
const allChildTexts = await steps.getAll('PageName', 'tableRows', { child: { pageName: 'TablePage', elementName: 'nameCell' } });
const allHrefs = await steps.getAll('PageName', 'links', { extractAttribute: 'href' });
```

### ✅ Verification

```ts
await steps.verifyPresence('PageName', 'elementName');
await steps.verifyAbsence('PageName', 'elementName');
await steps.verifyText('PageName', 'elementName', 'Expected text');
await steps.verifyText('PageName', 'elementName', undefined, { notEmpty: true });
await steps.verifyTextContains('PageName', 'elementName', 'partial');
await steps.verifyCount('PageName', 'elementName', { exactly: 3 });        // also: greaterThan, lessThan
await steps.verifyState('PageName', 'elementName', 'enabled');              // 'disabled', 'editable', 'checked', 'focused', 'visible', 'hidden', 'attached', 'inViewport'
await steps.verifyAttribute('PageName', 'elementName', 'href', '/path');
await steps.verifyInputValue('PageName', 'elementName', 'expected');
await steps.verifyImages('PageName', 'elementName');
await steps.verifyUrlContains('/dashboard');
await steps.verifyTabCount(2);
await steps.verifyOrder('PageName', 'listItems', ['First', 'Second', 'Third']);
await steps.verifyListOrder('PageName', 'listItems', 'asc');               // or 'desc'
await steps.verifyCssProperty('PageName', 'elementName', 'color', 'rgb(255, 0, 0)');
await steps.verifySnapshot('PageName', 'elementName');
await steps.verifySnapshot('PageName', 'elementName', 'custom-name.png');
```

### 📋 Listed Elements

```ts
// Click by text or attribute match
await steps.clickListedElement('PageName', 'tableRows', { text: 'John' });
await steps.clickListedElement('PageName', 'tableRows', {
  attribute: { name: 'data-id', value: '5' },
  child: { pageName: 'TablePage', elementName: 'editButton' }
});

// Verify text/attribute of a listed element
await steps.verifyListedElement('PageName', 'entries', {
  text: 'Name',
  child: { pageName: 'TablePage', elementName: 'valueCell' },
  expectedText: 'John Doe'
});

// Extract data from a listed element
const text = await steps.getListedElementData('PageName', 'entries', { text: 'Name' });
const href = await steps.getListedElementData('PageName', 'tableRows', {
  text: 'John',
  child: { pageName: 'TablePage', elementName: 'profileLink' },
  extractAttribute: 'href'
});
```

### ⏳ Waiting

```ts
await steps.waitForState('PageName', 'elementName');                        // default: 'visible'
await steps.waitForState('PageName', 'elementName', 'hidden');              // also: 'attached', 'detached'
await steps.waitAndClick('PageName', 'elementName');                        // waits for visible, then clicks
await steps.waitForNetworkIdle();
await steps.waitForResponse('/api/data', async () => {
  await steps.click('PageName', 'submitButton');
});
```

### 🔄 Composite / Workflow

```ts
// Fill multiple fields in one call
await steps.fillForm('FormsPage', {
  nameInput: 'John Doe',
  emailInput: 'john@example.com',
  countrySelect: { type: DropdownSelectType.VALUE, value: 'us' }
});

// Retry an action until a verification passes
await steps.retryUntil(
  async () => { await steps.click('PageName', 'refreshButton'); },
  async () => { await steps.verifyText('PageName', 'status', 'Ready'); },
  3, 1000  // maxRetries, delayMs
);
```

### 📸 Screenshot

```ts
const buf = await steps.screenshot();                                       // page screenshot
const buf2 = await steps.screenshot({ fullPage: true, path: 'out.png' });   // full page with save
const buf3 = await steps.screenshot('PageName', 'elementName');             // element screenshot
```

---

## 4. Accessing the Repository Directly

Use `repo` when you need to filter by visible text, iterate all matches, or pick a random item:

```ts
test('example', async ({ page, repo, steps }) => {
  await steps.navigateTo('/');
  const link = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
  await link?.click();
});
```

```ts
await repo.get(page, 'PageName', 'elementName');
await repo.getAll(page, 'PageName', 'elementName');
await repo.getRandom(page, 'PageName', 'elementName');
await repo.getByText(page, 'PageName', 'elementName', 'Text');
await repo.getByAttribute(page, 'PageName', 'elementName', 'data-status', 'active');
await repo.getByAttribute(page, 'PageName', 'elementName', 'href', '/path', { exact: false });
await repo.getByIndex(page, 'PageName', 'elementName', 2);
await repo.getByRole(page, 'PageName', 'elementName', 'button');
await repo.getVisible(page, 'PageName', 'elementName');
repo.getSelector('PageName', 'elementName');        // sync, returns raw selector string
repo.setDefaultTimeout(10000);
```

---

## 5. Raw Interactions API

Bypass the repository for dynamically generated locators:

```ts
import { ElementInteractions } from 'pw-element-interactions';

const interactions = new ElementInteractions(page);
const locator = page.locator('button.dynamic-class');
await interactions.interact.clickWithoutScrolling(locator);
await interactions.verify.count(locator, { greaterThan: 2 });
```

All `interact`, `verify`, and `navigate` methods are available on `ElementInteractions`.
