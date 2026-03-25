import { test, expect } from './fixture/StepFixture';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ══════════════════════════════════════════════════════════════════════════════
// 100% API Coverage Tests
// ══════════════════════════════════════════════════════════════════════════════

test.describe('TC_041: Steps - Navigation, Viewport & Scroll', () => {

  test('backOrForward, refresh, setViewport, scrollIntoView, pressKey', async ({ page, steps }) => {

    await test.step('Navigate to Buttons page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'buttonsLink');
      await steps.verifyUrlContains('/buttons');
    });

    await test.step('refresh reloads the page', async () => {
      await steps.refresh();
      await steps.verifyPresence('ButtonsPage', 'primaryButton');
    });

    await test.step('Navigate to a second page then backOrForward', async () => {
      await steps.click('SidebarNav', 'textInputsLink');
      await steps.verifyUrlContains('/text-inputs');
      await steps.backOrForward('back');
      await steps.verifyUrlContains('/buttons');
      await steps.backOrForward('forward');
      await steps.verifyUrlContains('/text-inputs');
    });

    await test.step('scrollIntoView scrolls an element into view', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'buttonsLink');
      await steps.verifyUrlContains('/buttons');
      await steps.scrollIntoView('ButtonsPage', 'loadingButton');
    });

    await test.step('pressKey sends a keyboard event', async () => {
      await steps.pressKey('Tab');
    });

    await test.step('setViewport changes the viewport size', async () => {
      await steps.setViewport(800, 600);
      const size = page.viewportSize();
      expect(size?.width).toBe(800);
      expect(size?.height).toBe(600);
    });

    log('TC_041 Steps Navigation & Viewport — passed');
  });
});

test.describe('TC_042: Steps - Click Variants & Data Extraction', () => {

  test('clickIfPresent, clickWithoutScrolling, getText, getAttribute, verifyAttribute', async ({ steps }) => {

    await test.step('Navigate to Buttons page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'buttonsLink');
      await steps.verifyUrlContains('/buttons');
    });

    await test.step('clickWithoutScrolling clicks without scrolling', async () => {
      await steps.clickWithoutScrolling('ButtonsPage', 'primaryButton');
      await steps.verifyTextContains('ButtonsPage', 'resultText', 'Primary');
    });

    await test.step('clickIfPresent clicks a present element', async () => {
      await steps.clickIfPresent('ButtonsPage', 'secondaryButton');
      await steps.verifyTextContains('ButtonsPage', 'resultText', 'Secondary');
    });

    await test.step('clickIfPresent does nothing for a missing element', async () => {
      await steps.clickIfPresent('FormsPage', 'title'); // not on this page
    });

    await test.step('getText returns element text content', async () => {
      const text = await steps.getText('ButtonsPage', 'resultText');
      expect(text).toContain('Secondary');
    });

    await test.step('getAttribute returns an attribute value', async () => {
      const testId = await steps.getAttribute('ButtonsPage', 'disabledButton', 'data-testid');
      expect(testId).toBe('btn-disabled');
    });

    await test.step('verifyAttribute asserts an attribute value', async () => {
      await steps.verifyAttribute('ButtonsPage', 'disabledButton', 'data-testid', 'btn-disabled');
    });

    log('TC_042 Click Variants & Data Extraction — passed');
  });
});

test.describe('TC_043: Steps - Tab Management', () => {

  test('closeTab and getTabCount', async ({ page, steps }) => {

    await test.step('Navigate to Alerts page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'alertsLink');
      await steps.verifyUrlContains('/alerts');
    });

    await test.step('getTabCount returns 1 initially', async () => {
      const count = steps.getTabCount();
      expect(count).toBe(1);
    });

    await test.step('Open new tab and close it via steps.closeTab', async () => {
      const newPage = await steps.switchToNewTab(async () => {
        await steps.click('AlertsPage', 'newTabButton');
      });
      expect(steps.getTabCount()).toBe(2);

      await steps.closeTab(newPage);
      expect(steps.getTabCount()).toBe(1);
    });

    log('TC_043 Tab Management — passed');
  });
});

test.describe('TC_044: Repo - getRandom & setDefaultTimeout', () => {

  test('getRandom picks a random element, setDefaultTimeout sets timeout', async ({ page, repo, steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('setDefaultTimeout changes the repo default timeout', async () => {
      repo.setDefaultTimeout(10000);
      // Just verify it does not throw
    });

    await test.step('getRandom returns one of the category cards', async () => {
      const randomCard = await repo.getRandom(page, 'HomePage', 'categories');
      expect(randomCard).toBeTruthy();
      const text = await randomCard!.textContent();
      expect(text).toBeTruthy();
    });

    log('TC_044 Repo getRandom & setDefaultTimeout — passed');
  });
});

test.describe('TC_045: ContextStore - Full API', () => {

  test('has, remove, clear, getBoolean, getNumber, items, merge', async ({ contextStore }) => {

    await test.step('has returns false for missing key', () => {
      expect(contextStore.has('nonexistent')).toBe(false);
    });

    await test.step('put + has returns true', () => {
      contextStore.put('key1', 'value1');
      expect(contextStore.has('key1')).toBe(true);
    });

    await test.step('remove deletes a key', () => {
      contextStore.remove('key1');
      expect(contextStore.has('key1')).toBe(false);
    });

    await test.step('getBoolean returns correct boolean', () => {
      contextStore.put('flag', 'true');
      expect(contextStore.getBoolean('flag')).toBe(true);
      contextStore.put('flag2', 'false');
      expect(contextStore.getBoolean('flag2')).toBe(false);
      expect(contextStore.getBoolean('missing', false)).toBe(false);
    });

    await test.step('getNumber returns correct number', () => {
      contextStore.put('count', '42');
      expect(contextStore.getNumber('count')).toBe(42);
      expect(contextStore.getNumber('missing', 0)).toBe(0);
    });

    await test.step('items returns a Set of keys', () => {
      contextStore.clear();
      contextStore.put('a', '1');
      contextStore.put('b', '2');
      const keys = contextStore.items();
      expect(keys.has('a')).toBe(true);
      expect(keys.has('b')).toBe(true);
      expect(keys.size).toBe(2);
    });

    await test.step('merge merges a record into the store', () => {
      contextStore.clear();
      contextStore.merge({ x: '10', y: '20' });
      expect(contextStore.get('x')).toBe('10');
      expect(contextStore.get('y')).toBe('20');
    });

    await test.step('clear removes all entries', () => {
      contextStore.clear();
      expect(contextStore.items().size).toBe(0);
    });

    log('TC_045 ContextStore Full API — passed');
  });
});

test.describe('TC_046: verifyImages - Image Verification', () => {

  test('verifyImages on product carousel and thumbnail grid', async ({ page, repo, steps }) => {

    await test.step('Navigate to Product Carousel page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'productCarouselLink');
      await steps.verifyUrlContains('/product-carousel');
    });

    await test.step('verifyImages on the active carousel slide', async () => {
      await steps.verifyImages('ProductCarouselPage', 'firstCarouselImage');
    });

    await test.step('verifyImages on the product grid thumbnails', async () => {
      await steps.verifyImages('ProductCarouselPage', 'productThumbnails');
    });

    log('TC_046 verifyImages — passed');
  });
});
