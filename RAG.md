# pw-element-interactions (RAG Context)

**Purpose:** A Playwright wrapper that decouples element acquisition from interaction. When paired with `pw-element-repository`, it eliminates locator boilerplate by allowing interactions using plain-text `pageName` and `elementName` keys via a unified `Steps` API.

## Setup & Initialization

**Install:** `npm i pw-element-interactions`
**Peer Dependencies:** `@playwright/test`, `pw-element-repository`

**Initialization:**

```ts
import { ElementRepository } from 'pw-element-repository';
import { Steps } from 'pw-element-interactions';

// Inside test:
const repo = new ElementRepository('path/to/locators.json');
const steps = new Steps(page, repo);
```

## `Steps` API Reference

All methods automatically fetch the locator, wait for readiness, and perform the action using the `pageName` and `elementName` string keys from the repository.

### Navigation

* `MapsTo(url: string)`: Navigates to absolute or relative URL.
* `refresh()`: Reloads current page.

### Interaction

* `click(pageName, elementName)`: Standard click; waits for attached, visible, stable, actionable.
* `clickWithoutScrolling(pageName, elementName)`: Native event dispatch; bypasses Playwright's scrolling/intersection checks (good for obscured elements).
* `clickIfPresent(pageName, elementName)`: Safe click; skips without failing if hidden.
* `clickRandom(pageName, elementName)`: Clicks a random element from a resolved list.
* `hover(pageName, elementName)`: Triggers hover state.
* `scrollIntoView(pageName, elementName)`: Smoothly scrolls element into viewport.
* `fill(pageName, elementName, text: string)`: Clears and types text.
* `uploadFile(pageName, elementName, filePath: string)`: Uploads local file to `<input type="file">`.
* `selectDropdown(pageName, elementName, options?: DropdownSelectOptions)`: Selects `<select>` option. Options: `{ type: DropdownSelectType.RANDOM | VALUE | INDEX, value?: string, index?: number }`.
* `dragAndDrop(pageName, elementName, options: DragAndDropOptions)`: Drags to target locator or `{ xOffset, yOffset }`.
* `dragAndDropListedElement(pageName, elementName, elementText: string, options: DragAndDropOptions)`: Finds specific element in list by text, then drags.

### Data Extraction

* `getText(pageName, elementName)`: Returns trimmed text content (or empty string).
* `getAttribute(pageName, elementName, attributeName: string)`: Returns attribute value or `null`.

### Verification

* `verifyPresence(pageName, elementName)`: Asserts attached and visible.
* `verifyAbsence(pageName, elementName)`: Asserts hidden or detached.
* `verifyText(pageName, elementName, expectedText?: string, options?: { notEmpty: true })`: Asserts exact text or non-blank dynamically generated text.
* `verifyCount(pageName, elementName, options: { exact?: number, greaterThan?: number, lessThan?: number })`: Asserts element list length.
* `verifyImages(pageName, elementName, scroll?: boolean)`: Deep assertion (scrolls default true): checks visibility, valid `src`, `naturalWidth > 0`, and native browser `decode()` promise.
* `verifyUrlContains(text: string)`: Asserts substring in active URL.

### Wait

* `waitForState(pageName, elementName, state?: 'visible' | 'attached' | 'hidden' | 'detached')`: Explicit wait (defaults to 'visible').

## Raw Interactions API (Fallback)

To bypass the repository and use raw Playwright Locators dynamically, use the `ElementInteractions` class.

```ts
import { ElementInteractions } from 'pw-element-interactions';
const interactions = new ElementInteractions(page);
// Exposes custom locator methods via: interactions.interact, interactions.verify, interactions.Maps
await interactions.interact.clickWithoutScrolling(page.locator('.dynamic'));
```