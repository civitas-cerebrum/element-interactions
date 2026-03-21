---
name: pw-element-interactions
description: >
  Use this skill whenever writing, editing, or generating Playwright tests! Triggers on any mention of
  Playwright tests, pw-element-interactions or pw-element-repository packages, the Steps API, ElementRepository, ElementInteractions, baseFixture,
  ContextStore, page-repository.json, or any request to write, fix, or add to a Playwright test in this project.
---

# pw-element-interactions — Agent Skill

A two-package Playwright framework that fully decouples **element acquisition** (`pw-element-repository`) from **element interaction** (`pw-element-interactions`). Tests reference elements by plain strings (`'HomePage'`, `'submitButton'`); raw selectors never appear in test code.

---

## 🚨 ABSOLUTE RULES — READ BEFORE DOING ANYTHING ELSE

These rules are non-negotiable and override any perceived helpfulness or initiative:

### 1. NEVER write tests unless explicitly asked
- NEVER create, write, or scaffold a test file unless the user has directly asked for it in this conversation.
- NEVER infer that tests are needed from context, file structure, or prior messages.
- If unsure whether the user wants a test written, **ask first. Do not write first.**
- When asked to write tests, ALWAYS start by producing a brief plan — test file(s), scenarios, and locators needed — and wait for the user to approve it before writing anything.
- If the plan covers more than one test file, suggest splitting into separate sessions (one per file) before proceeding.

### 2. NEVER edit `page-repository.json` without explicit permission
- NEVER add, modify, or delete entries in `page-repository.json` (or any locator JSON file) without the user explicitly approving the change.
- If new locators are needed, **show the user exactly what you intend to add** and wait for a clear "yes" before touching the file.

### 3. NEVER invent selectors — use Playwright MCP to inspect the live site
- NEVER guess or invent CSS selectors, XPath, IDs, or text values.
- ALWAYS use the Playwright MCP to navigate to the page and inspect the real DOM before adding any locator.
- If the Playwright MCP is not connected, stop and tell the user: *"I need the Playwright MCP to inspect the site. Please add it to your Claude Code MCP settings and restart."* Do not proceed until it is available.

### 4. NEVER invent type definitions or API shapes
- NEVER create `.d.ts` stubs or type shims for `pw-element-interactions` or `pw-element-repository`.
- If a type is missing, report the problem to the user and ask how to proceed. Do not work around it silently.

### 5. ALWAYS inspect a screenshot when a test fails
- The base fixture automatically captures a `failure-screenshot` on every failed test — run `npx playwright show-report` and open the report in a browser using Playwright MCP or a browser MCP to view it.
- Ensure `reporter: 'html'` is set in `playwright.config.ts` — this is required for `failure-screenshot` attachments to appear in the report.
- If the report is not accessible, use the Playwright MCP to take a screenshot of the current page state manually.
- NEVER attempt to fix a failing test based solely on the error message or stack trace — always verify visually first.
- Describe what you see in the screenshot to the user, then propose a fix based on the visual evidence.
- If the screenshot suggests a selector problem, re-inspect the live DOM via Playwright MCP before touching `page-repository.json`.
- After a fully passing run, do NOT open the report unless the user asks.

### 6. Before creating or modifying `playwright.config.ts`, read the existing file first — do not overwrite it.

---

## 1. Adding Locators

All selectors live in `tests/data/page-repository.json`.

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
- `elementName` — camelCase element identifier, e.g. `submitButton`, `galleryImages`

---

## 2. Setup — Fixtures

Before writing `tests/fixtures/base.ts`, **read it first if it already exists** — do not overwrite it without checking. The `baseFixture` automatically includes screenshot-on-failure capture, so no extension is needed:

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
  await steps.navigateTo('https://example.com/');
  await steps.click('HomePage', 'submitButton');
});
```

---

## 3. Steps API

Every method takes `pageName` and `elementName` as its first two arguments, matching keys in your JSON file.

### 🧭 Navigation

Relative URLs are resolved against `baseURL` from `playwright.config.ts`. If a relative URL is passed and `baseURL` is not configured, an error will be thrown.

```ts
await steps.navigateTo('https://example.com/path');
await steps.refresh();
await steps.backOrForward('BACKWARDS'); // or 'FORWARDS'
await steps.setViewport(1280, 720);
```

### 🖱️ Interaction

```ts
await steps.click('PageName', 'elementName');
await steps.clickWithoutScrolling('PageName', 'elementName');
await steps.clickIfPresent('PageName', 'elementName');
await steps.clickRandom('PageName', 'elementName');
await steps.hover('PageName', 'elementName');
await steps.scrollIntoView('PageName', 'elementName');
await steps.fill('PageName', 'elementName', 'my input');
await steps.typeSequentially('PageName', 'elementName', 'my input');
await steps.typeSequentially('PageName', 'elementName', 'my input', 50); // custom delay ms
await steps.uploadFile('PageName', 'elementName', 'tests/fixtures/file.pdf');
await steps.dragAndDrop('PageName', 'elementName', { target: otherLocator });
await steps.dragAndDrop('PageName', 'elementName', { xOffset: 100, yOffset: 0 });
await steps.dragAndDropListedElement('PageName', 'elementName', 'Item Label', { target: otherLocator });
```

For dropdown selection, import `DropdownSelectType` at the top of your test file:

```ts
import { DropdownSelectType } from 'pw-element-interactions';
```

Then use it in your test:

```ts
const value1 = await steps.selectDropdown('PageName', 'elementName');                                                          // random (default)
const value2 = await steps.selectDropdown('PageName', 'elementName', { type: DropdownSelectType.RANDOM });                     // explicit random
const value3 = await steps.selectDropdown('PageName', 'elementName', { type: DropdownSelectType.VALUE, value: 'xl' });         // by value
const value4 = await steps.selectDropdown('PageName', 'elementName', { type: DropdownSelectType.INDEX, index: 2 });            // by index
```

### 📊 Data Extraction

```ts
const text = await steps.getText('PageName', 'elementName');
const href  = await steps.getAttribute('PageName', 'elementName', 'href');
```

### ✅ Verification

```ts
await steps.verifyPresence('PageName', 'elementName');
await steps.verifyAbsence('PageName', 'elementName');
await steps.verifyText('PageName', 'elementName', 'Expected text');
await steps.verifyText('PageName', 'elementName', undefined, { notEmpty: true });
await steps.verifyCount('PageName', 'elementName', { exact: 3 });
await steps.verifyCount('PageName', 'elementName', { greaterThan: 0 });
await steps.verifyCount('PageName', 'elementName', { lessThan: 10 });
await steps.verifyImages('PageName', 'elementName');
await steps.verifyImages('PageName', 'elementName', false); // skip scroll-into-view
await steps.verifyUrlContains('/dashboard');
```

### ⏳ Waiting

```ts
await steps.waitForState('PageName', 'elementName');           // default: 'visible'
await steps.waitForState('PageName', 'elementName', 'hidden');
await steps.waitForState('PageName', 'elementName', 'attached');
await steps.waitForState('PageName', 'elementName', 'detached');
```

---

## 4. Accessing the Repository Directly

Use `repo` when you need to filter by visible text, iterate all matches, or pick a random item:

```ts
test('navigate to Forms', async ({ page, repo, steps }) => {
  await steps.navigateTo('https://example.com/');
  const formsLink = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
  await formsLink?.click();
  await steps.verifyAbsence('HomePage', 'categories');
});
```

### Repository API

```ts
await repo.get(page, 'PageName', 'elementName');
await repo.getAll(page, 'PageName', 'elementName');
await repo.getRandom(page, 'PageName', 'elementName');
await repo.getByText(page, 'PageName', 'elementName', 'Desired Text');
repo.getSelector('PageName', 'elementName'); // sync, returns raw selector string
```

---

### ⚠️ NEVER use index-based element access — always target by context

NEVER access elements by hardcoded index (e.g. `elements[1]`, `elements[3]`). Order can change and will silently break tests. Always identify elements by visible text, labels, attributes, or sibling content:

```ts
// ❌ Fragile — breaks if order changes
const nameCell = tableRows[1]?.locator('td:first-child');

// ✅ Robust — finds the element by its meaningful label
const nameRow = await repo.getByText(page, 'FormsPage', 'submissionEntries', 'Name');
const nameValue = await nameRow?.locator('td:nth-child(2)').textContent();
expect(nameValue?.trim()).toBe(testData.name);
```

Before writing any verification logic against a list or table, inspect the live page via Playwright MCP to understand the structure and identify the most stable way to target each element. If no meaningful context exists to distinguish elements, stop and ask the user how to proceed.

---

## 5. Workflow

- After any fix, feature, or test is confirmed working, run a `git commit` with a clear message before moving on.
- Do not batch multiple successes into a single commit.