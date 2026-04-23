# API Reference

The following sections document the full API available for writing tests in Stage 3.

## Table of Contents
- [Setup — Fixtures](#setup--fixtures)
- [Locator Format](#locator-format) (css, xpath, id, text, role+name, regex, iframe)
- [Steps API](#steps-api) (navigation, interaction, extraction, verification, expect matcher tree, visibility, listed elements, waiting, composite, screenshot)
- [Fluent API — steps.on()](#fluent-api--stepson) (strategy selectors, ifVisible, terminal actions, chaining)
- [Accessing the Repository Directly](#accessing-the-repository-directly)
- [Raw Interactions API](#raw-interactions-api)
- [Email API](#email-api) (setup, sending, receiving, marking, cleaning)
- [HTTP API Steps](#http-api-steps) (fixture setup, default & named providers, methods, verifications)

---

## Setup — Fixtures

Read `tests/fixtures/base.ts` first if it exists — do not overwrite without checking.

```ts
// tests/fixtures/base.ts
import { test as base, expect } from '@playwright/test';
import { baseFixture } from '@civitas-cerebrum/element-interactions';

export const test = baseFixture(base, 'tests/data/page-repository.json', {
  timeout: 60000,              // element timeout (default: 30000)
  // repoTimeout: 15000,       // repo resolution timeout (default: 15000)
  // blockedOrigins: /regex/,  // auto-abort matching routes
  // screenshotOnFailure: true, // auto-capture on failure (default: true)
});
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

## Locator Format

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

Supports `css`, `xpath`, `id`, or `text` strategies. Names: PascalCase pages (`CheckoutPage`), camelCase elements (`submitButton`).

### Role + Accessible Name

Use `role` with `name` to locate elements by their ARIA role and accessible name, resolving via `page.getByRole()`:

```json
{
  "elementName": "loginButton",
  "selector": { "role": "button", "name": "Log in" }
}
```

Regex name patterns for multi-language or variant matching:

```json
{
  "elementName": "authButton",
  "selector": { "role": "button", "name": { "regex": "Log in|Iniciar sesión|Anmelden", "flags": "i" } }
}
```

Works with any role: `button`, `textbox`, `switch`, `radio`, `link`, `dialog`, `combobox`, `slider`, `tab`, `img`.
Cross-platform: resolves via UiSelector on Android and predicate strings on iOS.

### Regex Text Selectors

Match elements by regex text content instead of exact strings:

```json
{
  "elementName": "payRestrictionAlert",
  "selector": { "text": { "regex": "Just Eat Pay.*cannot.*be used", "flags": "i" } }
}
```

Usage is identical to any other element — `steps.click()`, `steps.verifyPresence()`, etc.
Cross-platform: resolves via `textMatches()` on Android and `MATCHES` predicate on iOS.

### Iframe-Scoped Pages

Add a `frame` property to scope all elements on a page inside an iframe:

```json
{
  "name": "AdyenCardIframe",
  "frame": { "css": "iframe[title*='card number' i]" },
  "elements": [
    { "elementName": "cardInput", "selector": { "css": "[data-testid='card-input']" } }
  ]
}
```

Usage is unchanged — `await steps.fill('cardInput', 'AdyenCardIframe', '4111...')`.

Frame disambiguation when multiple frames match:

```json
{ "frame": { "css": "iframe[title*='security code' i]" }, "frameIndex": "last" }
```

`frameIndex` accepts `"first"`, `"last"`, or a zero-based number.

Nested frames:

```json
{ "frame": [{ "css": "iframe[title*='PayPal' i]" }, { "css": "iframe.zoid-component" }] }
```

## Steps API

Every method takes `elementName` and `pageName` as its first two arguments, matching keys in your JSON file.

**Imports** — add at the top of your test file as needed:
```ts
import { DropdownSelectType, ListedElementMatch, VerifyListedOptions, GetListedDataOptions, FillFormValue, ScreenshotOptions, EmailFilterType, EmailMarkAction, WebElement } from '@civitas-cerebrum/element-interactions';
```

### Navigation

```ts
await steps.navigateTo('/path');
await steps.refresh();
await steps.backOrForward('back'); // or 'forward'
await steps.setViewport(1280, 720);

// Tab management
const newPage = await steps.switchToNewTab(async () => {
  await steps.click('newTabLink', 'PageName');
});
await steps.closeTab(newPage);
const count = steps.getTabCount();
```

### Interaction

```ts
await steps.click('elementName', 'PageName');
await steps.click('elementName', 'PageName', { force: true });              // dispatch native click (bypasses overlays)
await steps.click('elementName', 'PageName', { withoutScrolling: true });   // click without auto-scroll
const clicked = await steps.clickIfPresent('elementName', 'PageName');      // returns boolean, false if absent
await steps.clickRandom('elementName', 'PageName');
await steps.clickNth('elementName', 'PageName', 2);           // zero-based index
await steps.rightClick('elementName', 'PageName');
await steps.doubleClick('elementName', 'PageName');
await steps.check('elementName', 'PageName');
await steps.uncheck('elementName', 'PageName');
await steps.hover('elementName', 'PageName');
await steps.scrollIntoView('elementName', 'PageName');
await steps.fill('elementName', 'PageName', 'text');
await steps.clearInput('elementName', 'PageName');
await steps.typeSequentially('elementName', 'PageName', 'text', 50); // optional delay ms
await steps.uploadFile('elementName', 'PageName', 'path/to/file.pdf');
await steps.setSliderValue('elementName', 'PageName', 75);
await steps.pressKey('Enter');                                 // 'Escape', 'Tab', 'Control+A', etc.

// Dropdowns
const val = await steps.selectDropdown('elementName', 'PageName');                                              // random (default)
const val2 = await steps.selectDropdown('elementName', 'PageName', { type: DropdownSelectType.VALUE, value: 'xl' });
const val3 = await steps.selectDropdown('elementName', 'PageName', { type: DropdownSelectType.INDEX, index: 2 });
await steps.selectMultiple('multiSelect', 'PageName', ['opt1', 'opt2']);

// Drag and drop — target accepts a Locator or Element from the repository
await steps.dragAndDrop('elementName', 'PageName', { target: otherLocatorOrElement });
await steps.dragAndDrop('elementName', 'PageName', { xOffset: 100, yOffset: 0 });
await steps.dragAndDropListedElement('elementName', 'PageName', 'Item Label', { target: otherLocatorOrElement });
```

**Note:** `click()` automatically retries with a native DOM event when Playwright reports pointer interception — no `{ force: true }` needed in most cases.

### Data Extraction

```ts
const text = await steps.getText('elementName', 'PageName');
const href = await steps.getAttribute('elementName', 'PageName', 'href');
const count = await steps.getCount('elementName', 'PageName');
const inputVal = await steps.getInputValue('elementName', 'PageName');
const color = await steps.getCssProperty('elementName', 'PageName', 'color');

// Bulk extraction
const allTexts = await steps.getAll('listItems', 'PageName');
const allChildTexts = await steps.getAll('tableRows', 'PageName', { child: { pageName: 'TablePage', elementName: 'nameCell' } });
const allHrefs = await steps.getAll('links', 'PageName', { extractAttribute: 'href' });
```

### Verification

```ts
await steps.verifyPresence('elementName', 'PageName');
await steps.verifyAbsence('elementName', 'PageName');
await steps.verifyText('elementName', 'PageName', 'Expected text');
await steps.verifyText('elementName', 'PageName');  // no args = asserts not empty
await steps.verifyTextContains('elementName', 'PageName', 'partial');
await steps.verifyCount('elementName', 'PageName', { exactly: 3 });        // also: greaterThan, lessThan
await steps.verifyState('elementName', 'PageName', 'enabled');              // 'disabled', 'editable', 'checked', 'focused', 'visible', 'hidden', 'attached', 'inViewport'
await steps.verifyAttribute('elementName', 'PageName', 'href', '/path');
await steps.verifyInputValue('elementName', 'PageName', 'expected');
await steps.verifyImages('elementName', 'PageName');
await steps.verifyUrlContains('/dashboard');
await steps.verifyTabCount(2);
await steps.verifyOrder('listItems', 'PageName', ['First', 'Second', 'Third']);
await steps.verifyListOrder('listItems', 'PageName', 'asc');               // or 'desc'
await steps.verifyCssProperty('elementName', 'PageName', 'color', 'rgb(255, 0, 0)');
```

### Expect Matcher Tree

A chain-style assertion API available at both the top level (`steps.expect(el, page)`) and the fluent builder (`steps.on(el, page)`). Each matcher retries against a fresh snapshot until the element timeout expires, then throws with the final snapshot in the error message. `verify*` still works and remains the shortest form for the basic cases it covers — use the matcher tree when you need regex, contains, negation, multi-field conditions, or custom predicates.

**Field matchers — available on both entry points:**

```ts
// Top-level entry — steps.expect(elementName, pageName)
await steps.expect('price', 'ProductPage').text.toBe('$19.99');
await steps.expect('price', 'ProductPage').text.toContain('Premium');
await steps.expect('price', 'ProductPage').text.toMatch(/^\$\d+\.\d{2}$/);
await steps.expect('price', 'ProductPage').text.toStartWith('$');
await steps.expect('price', 'ProductPage').text.toEndWith('USD');

await steps.expect('emailInput', 'LoginPage').value.toBe('user@test.com');
await steps.expect('emailInput', 'LoginPage').value.toMatch(/@/);

await steps.expect('link', 'NavPage').attributes.get('href').toBe('/dashboard');
await steps.expect('link', 'NavPage').attributes.get('class').toContain('active');
await steps.expect('link', 'NavPage').attributes.get('href').toMatch(/\/products\/\d+/);
await steps.expect('btn', 'Page').attributes.toHaveKey('disabled');

await steps.expect('items', 'ListPage').count.toBe(3);
await steps.expect('items', 'ListPage').count.toBeGreaterThan(3);
await steps.expect('items', 'ListPage').count.toBeLessThan(20);
await steps.expect('items', 'ListPage').count.toBeGreaterThanOrEqual(5);
await steps.expect('items', 'ListPage').count.toBeLessThanOrEqual(10);

await steps.expect('banner', 'Page').visible.toBeTrue();
await steps.expect('banner', 'Page').visible.toBe(true);
await steps.expect('spinner', 'Page').visible.toBeFalse();
await steps.expect('submitBtn', 'Page').enabled.toBeTrue();

await steps.expect('banner', 'Page').css('color').toBe('rgb(255, 0, 0)');
await steps.expect('banner', 'Page').css('cursor').toMatch(/pointer|default/);

// Fluent entry — same matchers directly on steps.on()
await steps.on('price', 'ProductPage').text.toBe('$19.99');
await steps.on('row', 'TablePage').nth(2).attributes.get('data-id').toBe('42');
await steps.on('cards', 'ListPage').random().text.toMatch(/\$\d+/);
await steps.on('banner', 'HomePage').ifVisible().text.toContain('Promo');
```

**Chained multi-verification on `steps.on()`:**

Every matcher call enqueues an assertion onto the builder and returns it, so multiple verifications on a single element compose in one expression. `await` executes the queue sequentially; the first failure short-circuits the rest.

```ts
// Chain 8+ verifications on one element in a single expression
await steps.on('primaryButton', 'ButtonsPage')
  .text.toBe('Primary')
  .visible.toBeTrue()
  .enabled.toBeTrue()
  .count.toBe(1)
  .attributes.get('data-testid').toBe('btn-primary')
  .attributes.toHaveKey('data-testid')
  .not.attributes.toHaveKey('disabled')
  .css('cursor').toMatch(/pointer|default|auto/)
  .satisfy(el => el.visible && el.enabled && el.text === 'Primary');

// .not is one-shot — applies to the next matcher only
await steps.on('btn', 'Page')
  .not.text.toBe('Wrong')    // negated
  .count.toBe(1);            // NOT negated

// .throws(msg) attaches to the most recently queued assertion
await steps.on('btn', 'Page')
  .text.toBe('Primary').throws('primary button must have correct label')
  .visible.toBeTrue();

// .timeout(ms) mixes long and short per-matcher in one chain
await steps.on('slowThenFast', 'Page')
  .text.timeout(5000).toBe('Ready')      // this one may take up to 5s
  .visible.timeout(100).toBeTrue()       // this one must be visible within 100ms
  .count.timeout(500).toBe(1);
```

**Per-call timeout override — `.timeout(ms)`:**

Composes anywhere in the chain. Useful for slow widgets or fast-failing assertions without changing the fixture-level default.

```ts
// On ElementAction (fluent)
await steps.on('slowWidget', 'Page').timeout(5000).text.toBe('Ready');

// On ExpectBuilder (top-level)
await steps.expect('slowWidget', 'Page').timeout(5000).text.toBe('Ready');

// On a specific field matcher
await steps.expect('el', 'Page').text.timeout(5000).toBe('x');
await steps.expect('el', 'Page').count.timeout(2000).toBeGreaterThan(3);
await steps.expect('el', 'Page').attributes.get('href').timeout(1000).toBe('/x');

// On the predicate chain — order independent with .throws()
await steps.expect('price', 'Page')
  .satisfy(el => parseFloat(el.text.slice(1)) > 10)
  .timeout(2000)
  .throws('price must be above $10');

// Composes with .not and strategy selectors
await steps.on('item', 'Page').nth(2).timeout(500).text.toBe('x');
await steps.expect('error', 'Page').not.timeout(1000).visible.toBeTrue();
```

**Negation with `.not`:**

```ts
// Flip any matcher via .not — composes on either side of the field accessor
await steps.expect('error', 'Page').not.text.toContain('Crash');
await steps.expect('error', 'Page').text.not.toContain('Crash');
await steps.on('submitBtn', 'Page').enabled.not.toBe(false);
await steps.on('link', 'Page').attributes.not.toHaveKey('disabled');
await steps.on('link', 'Page').attributes.get('href').not.toBe('/wrong');
```

**Predicate escape hatch** — for assertions the matcher tree doesn't cover (multi-field combinations, parsed numeric thresholds, JSON in `data-*`). Use `.satisfy(predicate)` — returns a chainable, awaitable assertion. Add `.throws(message)` for a custom failure message.

```ts
// Top-level
await steps.expect('price', 'ProductPage').satisfy(el => parseFloat(el.text.slice(1)) > 10);
await steps.expect('price', 'ProductPage')
  .satisfy(el => parseFloat(el.text.slice(1)) > 10)
  .throws('price must be above $10');

// Fluent
await steps.on('price', 'ProductPage').satisfy(el => parseFloat(el.text.slice(1)) > 10);
await steps.on('card', 'DashboardPage').satisfy(
  el => el.visible && el.attributes['data-status'] === 'ready' && el.count > 0,
);

// Negated — predicate's expected outcome is flipped
await steps.on('error', 'Page').not.satisfy(el => el.visible);
```

Predicates receive an `ElementSnapshot` — plain data, no async methods:

```ts
interface ElementSnapshot {
    readonly text: string;
    readonly value: string;                         // input value, '' for non-inputs
    readonly attributes: Readonly<Record<string, string>>;
    readonly visible: boolean;
    readonly enabled: boolean;
    readonly count: number;                         // total matches post-strategy
}
```

On predicate timeout, the error message includes the full snapshot pretty-printed so you can see exactly why the assertion failed:

```
expect().satisfy(predicate) failed on ProductPage.price after 30000ms
  snapshot at timeout:
    {
      "text": "12.99 USD",
      "value": "",
      "attributes": { ... },
      "visible": true,
      "enabled": true,
      "count": 1
    }
```

When `.throws(message)` is chained, that message replaces the default header while the snapshot is still appended — so you get both the domain-specific explanation and the raw state.

### Visibility Probe

```ts
// Non-throwing boolean check — never throws, returns true/false
const present = await steps.isPresent('elementName', 'PageName');                   // uses default element timeout

// Non-throwing visibility check with short timeout — returns boolean, never throws
const visible = await steps.isVisible('elementName', 'PageName');                    // default 2000ms timeout
const still = await steps.isVisible('modal', 'PageName', { timeout: 500 });         // custom timeout
const hasOffer = await steps.isVisible('banner', 'PageName', {                      // with text filter
  containsText: '50% off',
});
```

### Listed Elements

```ts
// Click by text or attribute match
await steps.clickListedElement('tableRows', 'PageName', { text: 'John' });
await steps.clickListedElement('tableRows', 'PageName', {
  attribute: { name: 'data-id', value: '5' },
  child: { pageName: 'TablePage', elementName: 'editButton' }
});

// Verify text/attribute of a listed element
await steps.verifyListedElement('entries', 'PageName', {
  text: 'Name',
  child: { pageName: 'TablePage', elementName: 'valueCell' },
  expectedText: 'John Doe'
});

// Extract data from a listed element
const text = await steps.getListedElementData('entries', 'PageName', { text: 'Name' });
const href = await steps.getListedElementData('tableRows', 'PageName', {
  text: 'John',
  child: { pageName: 'TablePage', elementName: 'profileLink' },
  extractAttribute: 'href'
});
```

### Waiting

```ts
await steps.waitForState('elementName', 'PageName');                        // default: 'visible'
await steps.waitForState('elementName', 'PageName', 'hidden');              // also: 'attached', 'detached'
await steps.waitAndClick('elementName', 'PageName');                        // waits for visible, then clicks
await steps.waitForNetworkIdle();
await steps.waitForResponse('/api/data', async () => {
  await steps.click('submitButton', 'PageName');
});
```

### Composite / Workflow

```ts
// Fill multiple fields in one call
await steps.fillForm('FormsPage', {
  nameInput: 'John Doe',
  emailInput: 'john@example.com',
  countrySelect: { type: DropdownSelectType.VALUE, value: 'us' }
});

// Retry an action until a verification passes
await steps.retryUntil(
  async () => { await steps.click('refreshButton', 'PageName'); },
  async () => { await steps.verifyText('status', 'PageName', 'Ready'); },
  3, 1000  // maxRetries, delayMs
);
```

### Screenshot

```ts
const buf = await steps.screenshot();                                       // page screenshot
const buf2 = await steps.screenshot({ fullPage: true, path: 'out.png' });   // full page with save
const buf3 = await steps.screenshot('elementName', 'PageName');             // element screenshot
```

## Fluent API — `steps.on()`

For a chainable alternative to the standard Steps methods, use `steps.on(elementName, pageName)`. It returns an `ElementAction` builder with strategy selectors and terminal actions.

```ts
// Strategy selectors (chainable)
await steps.on('productCards', 'CollectionsPage').first().click();
await steps.on('productCards', 'CollectionsPage').random().click({ withoutScrolling: true });
await steps.on('productCards', 'CollectionsPage').nth(2).click();
await steps.on('categories', 'HomePage').byText('Buttons').click();
await steps.on('items', 'ListPage').byAttribute('data-status', 'active').click();

// Conditional visibility — silently skips if element is not visible
await steps.on('cookieBanner', 'Page').ifVisible().click();
await steps.on('promoPopup', 'Page').ifVisible(500).click();       // custom timeout (ms)
await steps.on('optionalField', 'Page').ifVisible().fill('text');

// Terminal interactions
await steps.on('submitButton', 'LoginPage').click();
await steps.on('submitButton', 'LoginPage').click({ force: true });        // native DOM click
await steps.on('submitButton', 'LoginPage').click({ withoutScrolling: true });
await steps.on('menuItem', 'Nav').hover();
await steps.on('emailInput', 'LoginPage').fill('user@test.com');
await steps.on('checkbox', 'SettingsPage').check();
await steps.on('slider', 'SettingsPage').setSliderValue(75);
await steps.on('fileInput', 'UploadPage').uploadFile('path/to/file.pdf');

// Terminal verifications
await steps.on('title', 'ProductPage').verifyPresence();
await steps.on('title', 'ProductPage').verifyText('Expected Title');
await steps.on('title', 'ProductPage').verifyText();                  // no args = not empty
await steps.on('title', 'ProductPage').verifyTextContains('partial');
await steps.on('items', 'ListPage').verifyCount({ greaterThan: 3 });
await steps.on('disabledBtn', 'Page').verifyState('disabled');
const present = await steps.on('banner', 'Page').isPresent();
const visible = await steps.on('banner', 'Page').isVisible();                 // 2000ms timeout
const vis2 = await steps.on('banner', 'Page').isVisible({ timeout: 500 });   // custom timeout
const vis3 = await steps.on('banner', 'Page').isVisible({ containsText: 'Special' });

// Terminal extractions
const text = await steps.on('price', 'ProductPage').getText();
const href = await steps.on('link', 'NavPage').getAttribute('href');
const count = await steps.on('items', 'ListPage').getCount();

// Waiting
await steps.on('modal', 'Page').waitForState('visible');
```

### Chaining Examples

Combine strategy selectors with actions for concise, readable test flows:

```ts
// Navigate a hover menu — select random item, bypass actionability checks
await steps.on('mainNavItems', 'HomePage').first().hover();
await steps.on('subcategoryItems', 'HomePage').random().click({ withoutScrolling: true });

// Fill a form field then verify it took
await steps.on('emailInput', 'LoginPage').fill('user@test.com');
await steps.on('emailInput', 'LoginPage').verifyInputValue('user@test.com');

// Find a specific item by text, click it, verify navigation
await steps.on('categories', 'HomePage').byText('Accessories').click();
await steps.verifyUrlContains('/accessories');
await steps.on('productCards', 'CollectionsPage').verifyCount({ greaterThan: 0 });

// Verify multiple properties — use element.action() chain for sequencing
const submitBtn = await repo.get('submitButton', 'CheckoutPage');
await submitBtn.action()
  .verifyPresence()
  .verifyText('Place Order')
  .verifyEnabled();

// Extract data from a specific element in a list
const thirdPrice = await steps.on('price', 'CollectionsPage').nth(2).getText();
const isVisible = await steps.on('saleBadge', 'ProductPage').isPresent();
```

## Accessing the Repository Directly

Use `repo` when you need to filter by visible text, iterate all matches, or pick a random item. Repository methods use `(elementName, pageName)` order (no driver arg — driver is bound at construction). Methods return `Element` wrappers with `click()`, `fill()`, `textContent()`, etc. To access the underlying Playwright `Locator`, cast to `WebElement`:

```ts
import { WebElement } from '@civitas-cerebrum/element-interactions';

test('example', async ({ repo, steps }) => {
  await steps.navigateTo('/');
  const link = await repo.getByText('categories', 'HomePage', 'Forms');
  await link?.click();                              // Element.click() works directly

  // Fluent action chain
  const element = await repo.get('elementName', 'PageName');
  await element.action(5000).waitForState('visible').click();

  // When you need the underlying Locator:
  const locator = (element as WebElement).locator;  // access raw Playwright Locator
});
```

```ts
await repo.get('elementName', 'PageName');                         // single Element (first match)
await repo.get('elementName', 'PageName', { strategy: SelectionStrategy.RANDOM }); // with options
await repo.getAll('elementName', 'PageName');                      // array of Elements
await repo.getRandom('elementName', 'PageName');                   // random from matches
await repo.getByText('elementName', 'PageName', 'Text');           // exact match, then contains
await repo.getByAttribute('elementName', 'PageName', 'data-status', 'active');
await repo.getByIndex('elementName', 'PageName', 2);
await repo.getByRole('elementName', 'PageName', 'button');
await repo.getVisible('elementName', 'PageName');
repo.getSelector('elementName', 'PageName');                       // sync, returns selector string
repo.getSelectorRaw('elementName', 'PageName');                    // sync, { strategy, value }
repo.driver;                                                       // bound Page/Browser
```

## Raw Interactions API

Bypass the repository for dynamically generated locators. All methods accept both `Locator` and `Element`:

```ts
import { ElementInteractions } from '@civitas-cerebrum/element-interactions';

const interactions = new ElementInteractions(page);
const locator = page.locator('button.dynamic-class');
await interactions.interact.click(locator, { withoutScrolling: true });
await interactions.verify.count(locator, { greaterThan: 2 });

// Also works with Element from repo
const element = await repo.get('submitButton', 'LoginPage');
await interactions.interact.click(element);
```

All `interact`, `verify`, `extract`, and `navigate` methods are available on `ElementInteractions`.

## Email API

Send and receive emails in tests. Supports plain-text, inline HTML, and HTML file templates.

### Setup

Provide `smtp`, `imap`, or both depending on which features you need:

```ts
export const test = baseFixture(base, 'tests/data/page-repository.json', {
  emailCredentials: {
    smtp: {
      email: process.env.SENDER_EMAIL!,
      password: process.env.SENDER_PASSWORD!,
      host: process.env.SENDER_SMTP_HOST!,
    },
    imap: {
      email: process.env.RECEIVER_EMAIL!,
      password: process.env.RECEIVER_PASSWORD!,
    },
  }
});
```

### Sending

```ts
await steps.sendEmail({ to: 'user@example.com', subject: 'Test', text: 'Hello' });
await steps.sendEmail({ to: 'user@example.com', subject: 'Report', html: '<h1>Results</h1>' });
await steps.sendEmail({ to: 'user@example.com', subject: 'Report', htmlFile: 'emails/report.html' });
```

### Receiving

```ts
import { EmailFilterType } from '@civitas-cerebrum/element-interactions';

const email = await steps.receiveEmail({
  filters: [{ type: EmailFilterType.SUBJECT, value: 'Your OTP' }]
});
await steps.navigateTo('file://' + email.filePath);

const email2 = await steps.receiveEmail({
  filters: [
    { type: EmailFilterType.SUBJECT, value: 'Verification' },
    { type: EmailFilterType.FROM, value: 'noreply@example.com' },
    { type: EmailFilterType.CONTENT, value: 'verification code' },
  ]
});

const allEmails = await steps.receiveAllEmails({
  filters: [{ type: EmailFilterType.FROM, value: 'alerts@example.com' }]
});
```

### Marking Emails

```ts
import { EmailMarkAction } from '@civitas-cerebrum/element-interactions';

await steps.markEmail(EmailMarkAction.READ, {
  filters: [{ type: EmailFilterType.SUBJECT, value: 'OTP' }]
});
await steps.markEmail(EmailMarkAction.FLAGGED, {
  filters: [{ type: EmailFilterType.FROM, value: 'noreply@example.com' }]
});
await steps.markEmail(EmailMarkAction.ARCHIVED, {
  filters: [{ type: EmailFilterType.SUBJECT, value: 'Report' }]
});
await steps.markEmail(EmailMarkAction.UNREAD); // mark all in folder
```

Mark actions: `READ`, `UNREAD`, `FLAGGED`, `UNFLAGGED`, `ARCHIVED`.

### Cleaning the Inbox

```ts
await steps.cleanEmails({
  filters: [{ type: EmailFilterType.FROM, value: 'noreply@example.com' }]
});
await steps.cleanEmails(); // delete all
```

Filter types: `SUBJECT`, `FROM`, `TO`, `CONTENT` (body text/HTML), `SINCE` (Date).

## HTTP API Steps

Direct HTTP calls against one or more backends, co-located with UI tests. Powered by `@civitas-cerebrum/wasapi` — no Playwright `request` fixture required. Use these for contract testing, cross-service setup/teardown, or hybrid UI+API scenarios.

### Fixture Setup

Both `apiBaseUrl` and `apiProviders` are optional. Configure either, both, or neither. Testing multiple backends in the same test is first-class:

```ts
export const test = baseFixture(base, 'tests/data/page-repository.json', {
  apiBaseUrl: 'https://api.example.com',
  apiProviders: {
    billing: 'https://billing.example.com',
    auth:    'https://auth.example.com',
  },
});
```

- `apiBaseUrl` registers the `default` client. Steps called without a provider name use it.
- `apiProviders` registers additional named clients. The first argument of any `api*` step then becomes the provider name.
- Calling an `api*` step with no configuration throws a clear "API client is not configured" error.

### Methods

Every method returns an `ApiResponse<T>` (except `apiHead`, which returns a flat `Record<string, string>` of headers).

```ts
// Default client
const res = await steps.apiGet<User>('/users/42');
const created = await steps.apiPost<User>('/users', { name: 'Ada' });
const updated = await steps.apiPut<User>('/users/42', { name: 'Ada L.' });
const patched = await steps.apiPatch<User>('/users/42', { active: true });
await steps.apiDelete('/users/42');
const headers = await steps.apiHead('/users/42');

// Named provider (first arg)
const invoices = await steps.apiGet<Invoice[]>('billing', '/invoices', { query: { status: 'open' } });
await steps.apiPost('auth', '/login', { email, password });

// Query params, path params, headers
await steps.apiGet('/search', { query: { q: 'hello', page: '2' }, headers: { 'X-Trace': 'abc' } });
await steps.apiPut('/users/:id', { active: false }, { pathParams: { id: '42' } });
```

### ApiResponse Shape

```ts
interface ApiResponse<T> {
  status: number;
  headers: Record<string, string>;
  body: T;          // parsed JSON when content-type is JSON
  rawBody: string;  // raw text always available
  // ...
}
```

Inspect `status`, `headers`, and `body` directly. Assertions have dedicated step helpers:

### Verifications

```ts
await steps.verifyApiStatus(res, 200);
await steps.verifyApiHeader(res, 'content-type');                        // presence
await steps.verifyApiHeader(res, 'content-type', 'application/json');    // exact value (case-insensitive name)
```

For shape/schema verification, combine with Playwright's `expect` on the parsed `body`:

```ts
const res = await steps.apiGet<User>('/users/42');
await steps.verifyApiStatus(res, 200);
expect(res.body).toMatchObject({ id: expect.any(Number), name: expect.any(String) });
```

### When to Use

- ✅ Contract-style tests (status codes, headers, schema shape on real endpoints) — see the `contract-testing` companion skill
- ✅ Cross-service setup/teardown (seed data via API, drive UI through `steps`, tear down via API)
- ✅ Mixed-protocol flows (create resource via API, verify rendering via UI)
- ❌ Deep business-logic validation of internal services (keep those in the service's own test suite)
- ❌ Load testing (wrong tool)
