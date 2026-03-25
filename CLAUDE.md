---
name: element-interactions
description: >
  Use this skill whenever writing, editing, or generating Playwright tests that use the
  @civitas-cerebrum/element-interactions or @civitas-cerebrum/element-repository packages. Triggers on any mention of
  these packages, the Steps API, ElementRepository, ElementInteractions, baseFixture,
  ContextStore, page-repository.json, or any request to write, fix, or add to a
  Playwright test in this project.
---

# @civitas-cerebrum/element-interactions — Development Instructions

> **This file (`CLAUDE.md`) contains development-time rules and instructions for contributors working on this codebase.**
> It is NOT the consumer-facing skill file. The skill file at `~/.claude/skills/element-interactions/SKILL.md` (or skills directory in project root) is what gets loaded when writing tests with this framework — it documents the API for consumption. Keep both files in sync when adding new methods or rules, but maintain this distinction: CLAUDE.md = how to develop, skill file = how to use.

A two-package Playwright framework that fully decouples **element acquisition** (`@civitas-cerebrum/element-repository`) from **element interaction** (`@civitas-cerebrum/element-interactions`). Tests reference elements by plain strings (`'HomePage'`, `'submitButton'`); raw selectors never appear in test code.

---

## 🚨 ABSOLUTE RULES — READ BEFORE DOING ANYTHING ELSE

These rules are non-negotiable and override any perceived helpfulness or initiative:

### 1. NEVER write tests unless explicitly asked
- NEVER create, write, or scaffold a test file unless the user has directly asked for it in this conversation.
- NEVER infer that tests are needed from context, file structure, or prior messages.
- If unsure whether the user wants a test written, **ask first. Do not write first.**
- When asked to write tests, ALWAYS respond: *"What scenarios would you like me to cover?"* and wait for an explicit answer before writing a single line.

### 2. NEVER edit `page-repository.json` without explicit permission
- NEVER add, modify, or delete entries in `page-repository.json` (or any locator JSON file) without the user explicitly approving the change.
- If new locators are needed, **show the user exactly what you intend to add** and wait for a clear "yes" before touching the file.

### 3. NEVER invent selectors — use Playwright MCP to inspect the live site
- NEVER guess or invent CSS selectors, XPath, IDs, or text values.
- ALWAYS use the Playwright MCP to navigate to the page and inspect the real DOM before adding any locator.
- If the Playwright MCP is not connected, stop and tell the user: *"I need the Playwright MCP to inspect the site. Please add it to your Claude Code MCP settings and restart."* Do not proceed until it is available.

### 4. NEVER invent type definitions or API shapes
- NEVER create `.d.ts` stubs or type shims for `@civitas-cerebrum/element-interactions` or `@civitas-cerebrum/element-repository`.
- If a type is missing, report the problem to the user and ask how to proceed. Do not work around it silently.

### 5. Commit after every confirmed success
- After any fix, feature, or test is confirmed working, run a `git commit` with a clear message before moving on.
- Do not batch multiple successes into a single commit.

### 6. ALWAYS prefer element repository entries — NEVER use inline selectors in test code
- NEVER write raw CSS/XPath selectors inline in tests or Steps API calls.
- Always add selectors to `page-repository.json` and reference them via the repo.
- Use `{ child: { pageName: 'PageName', elementName: 'elementName' } }` instead of `{ child: 'td:nth-child(2)' }`.

### 7. ALWAYS inspect a screenshot when a test fails
- The base fixture automatically captures a `failure-screenshot` on every failed test — run `npx playwright show-report` and open the report in a browser using Playwright MCP or a browser MCP to view it.
- If the report is not accessible, use the Playwright MCP to take a screenshot of the current page state manually.
- NEVER attempt to fix a failing test based solely on the error message or stack trace — always verify visually first.
- Describe what you see in the screenshot to the user, then propose a fix based on the visual evidence.
- If the screenshot suggests a selector problem, re-inspect the live DOM via Playwright MCP before touching `page-repository.json`.
- After a fully passing run, do NOT open the report unless the user asks.

---

## 1. Playwright Config

Before creating or modifying `playwright.config.ts`, **read the existing file first** — do not overwrite it. The required shape is:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: 'html',
  use: {
    baseURL: 'https://actual-project-url.com', // read from existing config or ask the user
    headless: true,
  },
});
```

Key points:
- `reporter: 'html'` is required for `failure-screenshot` attachments to be viewable — use Playwright MCP or a browser MCP to open the report after running `npx playwright show-report`
- `baseURL` must match the real target site — read it from the existing config, never invent it
- If a test fails and screenshots are missing from the report, check that `reporter: 'html'` is set

---

## 2. Adding Locators

All selectors live in `tests/data/page-repository.json`. Always verify selectors against the live DOM via Playwright MCP before adding them — never guess.

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

Each selector object supports `css`, `xpath`, `id`, or `text` as the locator strategy.

**Naming conventions:**
- `name` — PascalCase page identifier, e.g. `CheckoutPage`, `ProductDetailsPage`
- `elementName` — camelCase element identifier, e.g. `submitButton`, `galleryImages`

---

## 3. Setup — Fixtures

Before writing `tests/fixtures/base.ts`, **read it first if it already exists** — do not overwrite it without checking. The base fixture provides automatic screenshot-on-failure via `baseFixture`:

```ts
// tests/fixtures/base.ts
import { test as base, expect } from '@playwright/test';
import { baseFixture } from '@civitas-cerebrum/element-interactions';

export const test = baseFixture(base, 'tests/data/page-repository.json');
export { expect };
```

### Included fixtures

| Fixture | Type | Description |
|---|---|---|
| `steps` | `Steps` | The full Steps API, ready to use |
| `repo` | `ElementRepository` | Direct repository access for advanced locator queries |
| `interactions` | `ElementInteractions` | Raw interactions API for custom locators |
| `contextStore` | `ContextStore` | Shared in-memory store for passing data between steps |

`baseFixture` also attaches a full-page `failure-screenshot` to the Playwright HTML report on every failed test automatically.

### Basic test file

```ts
// tests/example.spec.ts
import { test, expect } from '../fixtures/base';

test('example', async ({ steps }) => {
  await steps.navigateTo('/');
  await steps.click('HomePage', 'submitButton');
});
```

### Extending with custom fixtures

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

---

## 4. Steps API

Every method takes `pageName` and `elementName` as its first two arguments, matching keys in your JSON file.

### 🧭 Navigation

```ts
await steps.navigateTo('/path');
await steps.refresh();
await steps.backOrForward('back'); // or 'forward'
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
const clicked = await steps.clickIfPresent('PageName', 'elementName'); // returns boolean
await steps.clickRandom('PageName', 'elementName');
await steps.rightClick('PageName', 'elementName');
await steps.doubleClick('PageName', 'elementName');
await steps.check('PageName', 'elementName');
await steps.uncheck('PageName', 'elementName');
await steps.hover('PageName', 'elementName');
await steps.scrollIntoView('PageName', 'elementName');
await steps.fill('PageName', 'elementName', 'my input');
await steps.typeSequentially('PageName', 'elementName', 'my input');
await steps.typeSequentially('PageName', 'elementName', 'my input', 50); // custom delay ms
await steps.uploadFile('PageName', 'elementName', 'tests/fixtures/file.pdf');
await steps.setSliderValue('PageName', 'elementName', 75);
await steps.pressKey('Enter'); // or 'Escape', 'Tab', etc.

import { DropdownSelectType } from '@civitas-cerebrum/element-interactions';
// pick randomly (default)
const value1 = await steps.selectDropdown('PageName', 'elementName');
// explicit random
const value2 = await steps.selectDropdown('PageName', 'elementName', { type: DropdownSelectType.RANDOM });
// by value
const value3 = await steps.selectDropdown('PageName', 'elementName', { type: DropdownSelectType.VALUE, value: 'xl' });
// by index
const value4 = await steps.selectDropdown('PageName', 'elementName', { type: DropdownSelectType.INDEX, index: 2 });

await steps.dragAndDrop('PageName', 'elementName', { target: otherLocator });
await steps.dragAndDrop('PageName', 'elementName', { xOffset: 100, yOffset: 0 });
await steps.dragAndDropListedElement('PageName', 'elementName', 'Item Label', { target: otherLocator });
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
await steps.verifyCount('PageName', 'elementName', { exactly: 3 });
await steps.verifyCount('PageName', 'elementName', { greaterThan: 0 });
await steps.verifyCount('PageName', 'elementName', { lessThan: 10 });
await steps.verifyImages('PageName', 'elementName');
await steps.verifyImages('PageName', 'elementName', false); // skip scroll-into-view
await steps.verifyTextContains('PageName', 'elementName', 'partial text');
await steps.verifyState('PageName', 'elementName', 'enabled');  // 'disabled', 'editable', 'checked', 'focused', 'visible', 'hidden', 'attached', 'inViewport'
await steps.verifyAttribute('PageName', 'elementName', 'href', '/expected-path');
await steps.verifyUrlContains('/dashboard');
await steps.verifyInputValue('PageName', 'elementName', 'expected value');
await steps.verifyTabCount(2);
```

### 📋 Listed Elements

```ts
import { ListedElementMatch, VerifyListedOptions, GetListedDataOptions } from '@civitas-cerebrum/element-interactions';

// Click a listed element by text
await steps.clickListedElement('PageName', 'tableRows', { text: 'John' });

// Click a child inside a listed element matched by attribute
await steps.clickListedElement('PageName', 'tableRows', {
  attribute: { name: 'data-id', value: '5' },
  child: 'button.edit'
});

// Verify text of a child in a listed element
await steps.verifyListedElement('PageName', 'entries', {
  text: 'Name',
  child: 'td:nth-child(2)',
  expectedText: 'John Doe'
});

// Verify an attribute on a listed element
await steps.verifyListedElement('PageName', 'tableRows', {
  attribute: { name: 'data-id', value: '5' },
  expected: { name: 'class', value: 'active' }
});

// Extract text from a listed element
const text = await steps.getListedElementData('PageName', 'entries', { text: 'Name' });

// Extract an attribute from a child in a listed element
const href = await steps.getListedElementData('PageName', 'tableRows', {
  text: 'John',
  child: 'a.profile-link',
  extractAttribute: 'href'
});
```

### ⏳ Waiting

```ts
await steps.waitForState('PageName', 'elementName');           // default: 'visible'
await steps.waitForState('PageName', 'elementName', 'hidden');
await steps.waitForState('PageName', 'elementName', 'attached');
await steps.waitForState('PageName', 'elementName', 'detached');
await steps.waitForNetworkIdle();
await steps.waitForResponse('/api/data', async () => {
  await steps.click('PageName', 'submitButton');
});
await steps.waitAndClick('PageName', 'elementName');           // waits for visible, then clicks
await steps.waitAndClick('PageName', 'elementName', 'attached');
```

### 🔄 Composite / Workflow

```ts
import { FillFormValue } from '@civitas-cerebrum/element-interactions';

// Fill multiple fields on the same page in one call
await steps.fillForm('FormsPage', {
  nameInput: 'John Doe',
  emailInput: 'john@example.com',
  countrySelect: { type: DropdownSelectType.VALUE, value: 'us' }
});

// Retry an action until a verification passes
await steps.retryUntil(
  async () => { await steps.click('PageName', 'refreshButton'); },
  async () => { await steps.verifyText('PageName', 'status', 'Ready'); },
  3,    // maxRetries (default: 3)
  1000  // delayMs between attempts (default: 1000)
);

await steps.clearInput('PageName', 'searchField');
await steps.selectMultiple('PageName', 'multiSelect', ['opt1', 'opt2', 'opt3']);
await steps.clickNth('PageName', 'elementName', 2); // zero-based index
```

### 📊 Additional Data Extraction

```ts
const allTexts = await steps.getAll('PageName', 'listItems');
const allChildTexts = await steps.getAll('PageName', 'tableRows', { child: 'td.name' });
const allHrefs = await steps.getAll('PageName', 'links', { extractAttribute: 'href' });
const count = await steps.getCount('PageName', 'elementName');
const inputVal = await steps.getInputValue('PageName', 'emailInput');
const color = await steps.getCssProperty('PageName', 'elementName', 'color');
```

### ✅ Additional Verification

```ts
await steps.verifyOrder('PageName', 'listItems', ['First', 'Second', 'Third']);
await steps.verifyListOrder('PageName', 'listItems', 'asc');  // or 'desc'
await steps.verifyCssProperty('PageName', 'elementName', 'color', 'rgb(255, 0, 0)');
```

### 📸 Screenshot

```ts
import { ScreenshotOptions } from '@civitas-cerebrum/element-interactions';

// Full page screenshot
const buffer1 = await steps.screenshot();
const buffer2 = await steps.screenshot({ fullPage: true, path: 'screenshots/full.png' });

// Element screenshot
const buffer3 = await steps.screenshot('PageName', 'elementName');
const buffer4 = await steps.screenshot('PageName', 'elementName', { path: 'screenshots/element.png' });
```

---

## 5. Accessing the Repository Directly

Use `repo` when you need to filter by visible text, iterate all matches, or pick a random item:

```ts
test('navigate to Forms', async ({ page, repo, steps }) => {
  await steps.navigateTo('/');
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
await repo.getByAttribute(page, 'PageName', 'elementName', 'data-status', 'active');
await repo.getByAttribute(page, 'PageName', 'elementName', 'href', '/path', { exact: false }); // partial match
await repo.getByIndex(page, 'PageName', 'elementName', 2);    // zero-based index
await repo.getByRole(page, 'PageName', 'elementName', 'button'); // explicit HTML role attribute
await repo.getVisible(page, 'PageName', 'elementName');        // first visible match
repo.getSelector('PageName', 'elementName');                    // sync, returns raw selector string
repo.setDefaultTimeout(10000);                                  // change default wait timeout
```

---

## 6. Raw Interactions API

To bypass the repository or work with dynamically generated locators, use `ElementInteractions` directly:

```ts
import { ElementInteractions } from '@civitas-cerebrum/element-interactions';

const interactions = new ElementInteractions(page);

const customLocator = page.locator('button.dynamic-class');
await interactions.interact.clickWithoutScrolling(customLocator);
await interactions.verify.count(customLocator, { greaterThan: 2 });
```

All core `interact`, `verify`, and `navigate` methods are available on `ElementInteractions`.

---

## 7. Email API

Send and receive emails in tests. Supports plain-text, inline HTML, and HTML file templates.

### Setup

```ts
// tests/fixtures/base.ts
import { test as base } from '@playwright/test';
import { baseFixture } from '@civitas-cerebrum/element-interactions';

export const test = baseFixture(base, 'tests/data/page-repository.json', {
  emailCredentials: {
    senderEmail: process.env.SENDER_EMAIL!,
    senderPassword: process.env.SENDER_PASSWORD!,
    senderSmtpHost: process.env.SENDER_SMTP_HOST!,
    receiverEmail: process.env.RECEIVER_EMAIL!,
    receiverPassword: process.env.RECEIVER_PASSWORD!,
    // receiverImapHost: 'imap.gmail.com',  // default
    // receiverImapPort: 993,               // default
  }
});
```

### Sending Emails

```ts
import { EmailSendOptions } from '@civitas-cerebrum/element-interactions';

// Simple text email
await steps.sendEmail({ to: 'user@example.com', subject: 'Test', text: 'Hello' });

// Inline HTML email
await steps.sendEmail({ to: 'user@example.com', subject: 'Report', html: '<h1>Results</h1>' });

// HTML file template (e.g. test report)
await steps.sendEmail({ to: 'user@example.com', subject: 'Report', htmlFile: 'emails/report.html' });
```

### Receiving Emails

Use composable filters to search for emails. Combine as many filters as needed — all filters are applied with AND logic. Filtering tries exact match first, then falls back to partial case-insensitive match (with a warning log).

```ts
import { EmailFilterType } from '@civitas-cerebrum/element-interactions';
// Note: EmailFilterType and other email types can also be imported from '@civitas-cerebrum/email-client'

// Single filter — get the latest matching email
const email = await steps.receiveEmail({
  filters: [{ type: EmailFilterType.SUBJECT, value: 'Your OTP' }]
});
await steps.navigateTo('file://' + email.filePath);

// Multiple filters — combine subject, sender, and content
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

### Cleaning the Inbox

```ts
// Delete emails matching filters
await steps.cleanEmails({
  filters: [{ type: EmailFilterType.FROM, value: 'noreply@example.com' }]
});

// Delete all emails in the inbox
await steps.cleanEmails();
```

### Email Filter Types

| Type | Value | Description |
|---|---|---|
| `EmailFilterType.SUBJECT` | `string` | Filter by email subject |
| `EmailFilterType.FROM` | `string` | Filter by sender address |
| `EmailFilterType.TO` | `string` | Filter by recipient address |
| `EmailFilterType.CONTENT` | `string` | Filter by email body (HTML or plain text) |
| `EmailFilterType.SINCE` | `Date` | Only include emails after this date |

### Email Receive Options

| Option | Type | Default | Description |
|---|---|---|---|
| `filters` | `EmailFilter[]` | — | **Required.** Array of filters to apply (AND logic) |
| `folder` | `string` | `'INBOX'` | IMAP folder to search |
| `waitTimeout` | `number` | `30000` | Max ms to poll for the email |
| `pollInterval` | `number` | `3000` | Ms between poll attempts |
| `downloadDir` | `string` | `os.tmpdir()/pw-emails` | Where to save downloaded HTML |