import { test, expect } from './fixture/StepFixture';
import { DropdownSelectType } from '../src/enum/Options';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ══════════════════════════════════════════════════
// RAW API COVERAGE TESTS (Advanced / ElementInteractions)
// ══════════════════════════════════════════════════

test.describe('TC_072: Raw API — interact.clearInput & interact.selectMultiple', () => {

  test('clearInput and selectMultiple via raw interactions', async ({ page, interactions, steps }) => {

    await test.step('Navigate to text inputs page', async () => {
      await steps.navigateTo('/text-inputs');
    });

    await test.step('Fill then clear input via raw API', async () => {
      const locator = page.locator('[data-testid="input-text"]');
      await interactions.interact.fill(locator, 'to be cleared');
      await interactions.interact.clearInput(locator);
      const val = await locator.inputValue();
      expect(val).toBe('');
    });

    await test.step('Navigate to dropdown page for selectMultiple', async () => {
      await steps.navigateTo('/dropdown');
    });

    await test.step('Select multiple options via raw API', async () => {
      const locator = page.locator('[data-testid="dropdown-multi"]');
      const selected = await interactions.interact.selectMultiple(locator, ['Australia', 'Canada']);
      expect(selected.length).toBe(2);
    });

    log('TC_072 Raw interact.clearInput & interact.selectMultiple — passed');
  });
});

test.describe('TC_073: Raw API — verify.cssProperty, verify.order, verify.listOrder', () => {

  test('css property and order verifications via raw interactions', async ({ page, interactions, steps }) => {

    await test.step('Navigate to table page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'tableLink');
    });

    await test.step('Verify CSS property via raw API', async () => {
      const heading = page.locator('h1');
      await interactions.verify.cssProperty(heading, 'display', 'block');
    });

    await test.step('Verify order via raw API', async () => {
      const nameCells = page.locator('[data-testid^="table-row-"] td:nth-child(2)');
      await interactions.verify.order(nameCells, ['Alice Martin', 'Bob Chen', 'Carol White', 'David Kim', 'Eve Torres']);
    });

    await test.step('Verify listOrder ascending via raw API', async () => {
      const nameCells = page.locator('[data-testid^="table-row-"] td:nth-child(2)');
      await interactions.verify.listOrder(nameCells, 'asc');
    });

    log('TC_073 Raw verify.cssProperty, verify.order, verify.listOrder — passed');
  });
});

test.describe('TC_074: Raw API — verify.snapshot', () => {

  test('snapshot via raw interactions', async ({ page, interactions, steps }) => {

    await test.step('Navigate to home', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Verify snapshot via raw API', async () => {
      const heading = page.locator('h1');
      await interactions.verify.snapshot(heading, 'raw-api-heading.png');
    });

    log('TC_074 Raw verify.snapshot — passed');
  });
});

test.describe('TC_075: Raw API — extract.getAllTexts, extract.getCount, extract.getCssProperty, extract.getInputValue', () => {

  test('extraction methods via raw interactions', async ({ page, interactions, steps }) => {

    await test.step('Navigate to table page', async () => {
      await steps.navigateTo('/table');
    });

    await test.step('getAllTexts via raw API', async () => {
      const nameCells = page.locator('[data-testid^="table-row-"] td:nth-child(2)');
      const texts = await interactions.extract.getAllTexts(nameCells);
      expect(texts.length).toBe(5);
      expect(texts[0]).toBe('Alice Martin');
    });

    await test.step('getCount via raw API', async () => {
      const nameCells = page.locator('[data-testid^="table-row-"] td:nth-child(2)');
      const count = await interactions.extract.getCount(nameCells);
      expect(count).toBe(5);
    });

    await test.step('getCssProperty via raw API', async () => {
      const heading = page.locator('h1');
      const display = await interactions.extract.getCssProperty(heading, 'display');
      expect(display).toBe('block');
    });

    await test.step('Navigate to text inputs page for getInputValue', async () => {
      await steps.navigateTo('/text-inputs');
    });

    await test.step('getInputValue via raw API', async () => {
      const input = page.locator('[data-testid="input-text"]');
      await interactions.interact.fill(input, 'raw-test-value');
      const val = await interactions.extract.getInputValue(input);
      expect(val).toBe('raw-test-value');
    });

    log('TC_075 Raw extract methods — passed');
  });
});

test.describe('TC_076: Raw API — extract.screenshot, navigate.waitForNetworkIdle, navigate.waitForResponse', () => {

  test('navigation utilities via raw interactions', async ({ page, interactions, steps }) => {

    await test.step('Navigate to home', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Page screenshot via raw API', async () => {
      const buf = await interactions.extract.screenshot();
      expect(buf).toBeTruthy();
      expect(buf.length).toBeGreaterThan(0);
    });

    await test.step('Element screenshot via raw API', async () => {
      const heading = page.locator('h1');
      const buf = await interactions.extract.screenshot(heading);
      expect(buf).toBeTruthy();
    });

    await test.step('waitForNetworkIdle via raw API', async () => {
      await interactions.navigate.waitForNetworkIdle();
    });

    await test.step('waitForResponse via raw API', async () => {
      const response = await interactions.navigate.waitForResponse(/table/, async () => {
        await steps.navigateTo('/table');
      });
      expect(response).toBeTruthy();
    });

    log('TC_076 Raw navigate methods — passed');
  });
});
