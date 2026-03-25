import { test, expect } from './fixture/StepFixture';
import { ElementInteractions } from '../src/interactions/facade/ElementInteractions';
import { DropdownSelectType } from '../src/enum/Options';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ══════════════════════════════════════════════════
// NEGATIVE TEST CASES
// ══════════════════════════════════════════════════

test.describe('Negative Tests', () => {
  // Use a short timeout (2s) so negative tests don't wait 30s each
  const NEGATIVE_TIMEOUT = 2000;

  test('TC_077: click on missing element throws', async ({ page }) => {
    const fast = new ElementInteractions(page, NEGATIVE_TIMEOUT);
    await page.goto('/');
    const missing = page.locator('[data-testid="does-not-exist"]');
    await expect(async () => {
      await fast.interact.click(missing);
    }).rejects.toThrow();
    log('TC_077 Negative click non-existent — passed');
  });

  test('TC_078: verifyText rejects incorrect text', async ({ page, steps }) => {
    const fast = new ElementInteractions(page, NEGATIVE_TIMEOUT);
    await steps.navigateTo('/');
    const title = page.locator('h1');
    await expect(async () => {
      await fast.verify.text(title, 'This Text Does Not Exist On Page');
    }).rejects.toThrow();
    log('TC_078 Negative verifyText wrong text — passed');
  });

  test('TC_079: verifyAbsence rejects visible element', async ({ page, steps }) => {
    const fast = new ElementInteractions(page, NEGATIVE_TIMEOUT);
    await steps.navigateTo('/');
    const title = page.locator('h1');
    await expect(async () => {
      await fast.verify.absence(title);
    }).rejects.toThrow();
    log('TC_079 Negative verifyAbsence on visible — passed');
  });

  test('TC_080: verifyCount rejects incorrect count', async ({ page, steps }) => {
    const fast = new ElementInteractions(page, NEGATIVE_TIMEOUT);
    await steps.navigateTo('/');
    const categories = page.locator('.sidebar-section');
    await expect(async () => {
      await fast.verify.count(categories, { exactly: 999 });
    }).rejects.toThrow();
    log('TC_080 Negative verifyCount wrong count — passed');
  });

  test('TC_081: fill rejects disabled input', async ({ page, steps }) => {
    const fast = new ElementInteractions(page, NEGATIVE_TIMEOUT);
    await steps.navigateTo('/text-inputs');
    const disabled = page.locator('[data-testid="input-disabled"]');
    await expect(async () => {
      await fast.interact.fill(disabled, 'should fail');
    }).rejects.toThrow();
    log('TC_081 Negative fill disabled input — passed');
  });

  test('TC_082: selectDropdown rejects nonexistent value', async ({ page, steps }) => {
    const fast = new ElementInteractions(page, NEGATIVE_TIMEOUT);
    await steps.navigateTo('/dropdown');
    await expect(async () => {
      await fast.interact.selectDropdown(
        page.locator('[data-testid="dropdown-single"]'),
        { type: DropdownSelectType.VALUE, value: 'nonexistent-value-xyz' }
      );
    }).rejects.toThrow();
    log('TC_082 Negative selectDropdown invalid value — passed');
  });

  test('TC_083: clicking non-matching listed element throws', async ({ page, steps }) => {
    const fast = new ElementInteractions(page, NEGATIVE_TIMEOUT);
    await steps.navigateTo('/table');
    const rows = page.locator('[data-testid^="table-row-"]');
    const result = await fast.interact.getListedElement(rows, { text: 'Nonexistent Person XYZ' });
    // The locator resolves but points to nothing — clicking it should throw
    await expect(async () => {
      await fast.interact.click(result);
    }).rejects.toThrow();
    log('TC_083 Negative clicking non-matching listed element — passed');
  });

  test('TC_084: getListedElement requires text or attribute', async ({ page, steps }) => {
    const fast = new ElementInteractions(page, NEGATIVE_TIMEOUT);
    await steps.navigateTo('/table');
    const rows = page.locator('[data-testid^="table-row-"]');
    await expect(async () => {
      await fast.interact.getListedElement(rows, {} as any);
    }).rejects.toThrow('requires either "text" or "attribute"');
    log('TC_084 Negative getListedElement missing criteria — passed');
  });

  test('TC_085: dragAndDrop rejects missing options', async ({ page, steps }) => {
    const fast = new ElementInteractions(page, NEGATIVE_TIMEOUT);
    await steps.navigateTo('/draggable');
    const draggable = page.locator('[data-testid="draggable-box"]');
    await expect(async () => {
      await fast.interact.dragAndDrop(draggable, {} as any);
    }).rejects.toThrow();
    log('TC_085 Negative dragAndDrop missing options — passed');
  });

  test('TC_086: getByText strict throws when not found', async ({ page, steps }) => {
    const fast = new ElementInteractions(page, NEGATIVE_TIMEOUT);
    await steps.navigateTo('/table');
    const rows = page.locator('[data-testid^="table-row-"]');
    await expect(async () => {
      await fast.interact.getByText(rows, 'TablePage', 'rows', 'Nonexistent Name', true);
    }).rejects.toThrow('not found');
    log('TC_086 Negative getByText strict — passed');
  });
});
