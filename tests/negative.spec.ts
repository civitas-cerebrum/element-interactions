import { test, expect } from './fixture/StepFixture';
import { ElementInteractions } from '../src/interactions/facade/ElementInteractions';
import { DropdownSelectType } from '../src/enum/Options';
import { createLogger } from '../src/logger/Logger';
import { WebElement } from '@civitas-cerebrum/element-repository';

const log = createLogger('tests');

// ══════════════════════════════════════════════════
// NEGATIVE TEST CASES
//
// The raw ElementInteractions API is WebElement-only. Targets are resolved
// through the repository: present elements via `repo.get(...)`, and the
// deliberately-absent element via the suite's absent-element pattern —
// `new WebElement(page.locator(repo.getSelector(...)))` — which skips
// repo.get's attachment wait so the *interaction* is what rejects.
// ══════════════════════════════════════════════════

test.describe('Negative Tests', () => {
  // Use a short timeout (2s) so negative tests don't wait 30s each
  const NEGATIVE_TIMEOUT = 2000;

  test('TC_077: click on missing element throws', async ({ page, repo }) => {
    const fast = new ElementInteractions(page, { timeout: NEGATIVE_TIMEOUT });
    await page.goto('/');
    const missing = new WebElement(page.locator(repo.getSelector('missingElement', 'HomePage')));
    await expect(async () => {
      await fast.interact.click(missing);
    }).rejects.toThrow();
    log('TC_077 Negative click non-existent — passed');
  });

  test('TC_078: verifyText rejects incorrect text', async ({ page, repo, steps }) => {
    const fast = new ElementInteractions(page, { timeout: NEGATIVE_TIMEOUT });
    await steps.navigateTo('/');
    const title = await repo.get('pageTitle', 'HomePage') as WebElement;
    await expect(async () => {
      await fast.verify.text(title, 'This Text Does Not Exist On Page');
    }).rejects.toThrow();
    log('TC_078 Negative verifyText wrong text — passed');
  });

  test('TC_079: verifyAbsence rejects visible element', async ({ page, repo, steps }) => {
    const fast = new ElementInteractions(page, { timeout: NEGATIVE_TIMEOUT });
    await steps.navigateTo('/');
    const title = await repo.get('pageTitle', 'HomePage') as WebElement;
    await expect(async () => {
      await fast.verify.absence(title);
    }).rejects.toThrow();
    log('TC_079 Negative verifyAbsence on visible — passed');
  });

  test('TC_080: verifyCount rejects incorrect count', async ({ page, repo, steps }) => {
    const fast = new ElementInteractions(page, { timeout: NEGATIVE_TIMEOUT });
    await steps.navigateTo('/');
    const categories = await repo.get('categories', 'HomePage') as WebElement;
    await expect(async () => {
      await fast.verify.count(categories, { exactly: 999 });
    }).rejects.toThrow();
    log('TC_080 Negative verifyCount wrong count — passed');
  });

  test('TC_081: fill rejects disabled input', async ({ page, repo, steps }) => {
    const fast = new ElementInteractions(page, { timeout: NEGATIVE_TIMEOUT });
    await steps.navigateTo('/text-inputs');
    const disabled = await repo.get('disabledInput', 'TextInputsPage') as WebElement;
    await expect(async () => {
      await fast.interact.fill(disabled, 'should fail');
    }).rejects.toThrow();
    log('TC_081 Negative fill disabled input — passed');
  });

  test('TC_082: selectDropdown rejects nonexistent value', async ({ page, repo, steps }) => {
    const fast = new ElementInteractions(page, { timeout: NEGATIVE_TIMEOUT });
    await steps.navigateTo('/dropdown');
    const dropdown = await repo.get('singleSelect', 'DropdownSelectPage') as WebElement;
    await expect(async () => {
      await fast.interact.selectDropdown(
        dropdown,
        { type: DropdownSelectType.VALUE, value: 'nonexistent-value-xyz' }
      );
    }).rejects.toThrow();
    log('TC_082 Negative selectDropdown invalid value — passed');
  });

  test('TC_083: resolving a non-matching listed element throws', async ({ page, repo, steps }) => {
    const fast = new ElementInteractions(page, { timeout: NEGATIVE_TIMEOUT });
    await steps.navigateTo('/table');
    const rows = await repo.get('rows', 'TablePage') as WebElement;
    // 0.3.7: getListedElement's own visibility wait now throws instead of
    // handing back a locator that points to nothing (the click used to be
    // the first place this surfaced).
    await expect(async () => {
      await fast.interact.getListedElement(rows, { text: 'Nonexistent Person XYZ' });
    }).rejects.toThrow(/did not reach state 'visible'/);
    log('TC_083 Negative resolving non-matching listed element — passed');
  });

  test('TC_084: getListedElement requires text or attribute', async ({ page, repo, steps }) => {
    const fast = new ElementInteractions(page, { timeout: NEGATIVE_TIMEOUT });
    await steps.navigateTo('/table');
    const rows = await repo.get('rows', 'TablePage') as WebElement;
    await expect(async () => {
      await fast.interact.getListedElement(rows, {} as any);
    }).rejects.toThrow('requires "text", "attribute", or "withDescendant"');
    log('TC_084 Negative getListedElement missing criteria — passed');
  });

  test('TC_085: dragAndDrop rejects missing options', async ({ page, repo, steps }) => {
    const fast = new ElementInteractions(page, { timeout: NEGATIVE_TIMEOUT });
    await steps.navigateTo('/draggable');
    const draggable = await repo.get('item1', 'DraggablePage') as WebElement;
    await expect(async () => {
      await fast.interact.dragAndDrop(draggable, {} as any);
    }).rejects.toThrow();
    log('TC_085 Negative dragAndDrop missing options — passed');
  });

  test('TC_086: getByText strict throws when not found', async ({ page, repo, steps }) => {
    const fast = new ElementInteractions(page, { timeout: NEGATIVE_TIMEOUT });
    await steps.navigateTo('/table');
    const rows = await repo.get('rows', 'TablePage') as WebElement;
    await expect(async () => {
      await fast.interact.getByText(rows, 'Nonexistent Name', true);
    }).rejects.toThrow('not found');
    log('TC_086 Negative getByText strict — passed');
  });

  test('TC_088: Verifications.expectEqual/expectNotEqual throw on mismatch and match respectively', async ({ page }) => {
    const fast = new ElementInteractions(page, { timeout: NEGATIVE_TIMEOUT });

    expect(() => {
      fast.verify.expectEqual('hello', 'world');
    }).toThrow();

    expect(() => {
      fast.verify.expectNotEqual('hello', 'hello');
    }).toThrow();

    log('TC_088 Negative expectEqual/expectNotEqual — passed');
  });
});
