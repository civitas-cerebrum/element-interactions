# pw-element-interactions — AI Reference

## Setup
```ts
npm i pw-element-interactions  // peer deps: @playwright/test, pw-element-repository
```

```ts
const repo = new ElementRepository('tests/data/locators.json');
const steps = new Steps(page, repo);
// All steps resolve elements via (pageName: string, elementName: string)
```

## Steps API

### Navigation
- `navigateTo(url: string)`
- `refresh()`
- `backOrForward(direction: 'BACKWARDS' | 'FORWARDS')`
- `setViewport(width: number, height: number)`

### Interaction
- `click(pageName, elementName)`
- `clickWithoutScrolling(pageName, elementName)` — bypasses scroll/overlay checks
- `clickIfPresent(pageName, elementName)` — no-op if hidden
- `clickRandom(pageName, elementName)` — picks random from matched list
- `hover(pageName, elementName)`
- `scrollIntoView(pageName, elementName)`
- `fill(pageName, elementName, text: string)` — clears then types
- `uploadFile(pageName, elementName, filePath: string)`
- `dragAndDrop(pageName, elementName, options: DragAndDropOptions)` — `{ target: Locator }` or `{ xOffset, yOffset }`
- `dragAndDropListedElement(pageName, elementName, elementText: string, options: DragAndDropOptions)` — find by text then drag
- `selectDropdown(pageName, elementName, options?: DropdownSelectOptions)` — returns selected value
  - `{ type: DropdownSelectType.RANDOM }` (default)
  - `{ type: DropdownSelectType.VALUE, value: string }`
  - `{ type: DropdownSelectType.INDEX, index: number }`

### Data Extraction
- `getText(pageName, elementName)` — returns trimmed string or `''`
- `getAttribute(pageName, elementName, attributeName: string)` — returns string or `null`

### Verification
- `verifyPresence(pageName, elementName)`
- `verifyAbsence(pageName, elementName)`
- `verifyText(pageName, elementName, expectedText?: string, options?: { notEmpty: true })`
- `verifyCount(pageName, elementName, options: { exact: number } | { greaterThan: number } | { lessThan: number })`
- `verifyImages(pageName, elementName, scroll?: boolean)` — checks src, naturalWidth, decode()
- `verifyUrlContains(text: string)`

### Wait
- `waitForState(pageName, elementName, state?: 'visible' | 'attached' | 'hidden' | 'detached')` — default: `'visible'`

---

## Raw API (no repo)
```ts
const interactions = new ElementInteractions(page);
const loc = page.locator('button.dynamic-class');
await interactions.interact.clickWithoutScrolling(loc);
await interactions.verify.count(loc, { greaterThan: 2 });
// namespaces: interact, verify, navigate
```

### Example Scenario

```ts
import { test } from '@playwright/test';
import { ElementRepository } from 'pw-element-repository';
import { Steps, DropdownSelectType } from 'pw-element-interactions';

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
  const selectedSize = await steps.selectDropdown('ProductDetailsPage', 'size-selector', { 
    type: DropdownSelectType.RANDOM 
  });
  console.log(`Selected size: ${selectedSize}`);

  // 6. Flexible Assertions & Data Extraction
  await steps.verifyCount('ProductDetailsPage', 'gallery-images', { greaterThan: 0 });
  await steps.verifyText('ProductDetailsPage', 'product-title', undefined, { notEmpty: true });
  
  // 7. Advanced Image Verification
  await steps.verifyImages('ProductDetailsPage', 'gallery-images');
  
  // 8. Explicit Waits
  await steps.waitForState('CheckoutPage', 'confirmation-modal', 'visible');
});
```