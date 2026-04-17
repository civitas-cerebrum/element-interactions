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
      await steps.click( 'buttonsLink','SidebarNav');
      await steps.verifyUrlContains('/buttons');
    });

    await test.step('refresh reloads the page', async () => {
      await steps.refresh();
      await steps.verifyPresence( 'primaryButton','ButtonsPage');
    });

    await test.step('Navigate to a second page then backOrForward', async () => {
      await steps.click( 'textInputsLink','SidebarNav');
      await steps.verifyUrlContains('/text-inputs');
      await steps.backOrForward('back');
      await steps.verifyUrlContains('/buttons');
      await steps.backOrForward('forward');
      await steps.verifyUrlContains('/text-inputs');
    });

    await test.step('scrollIntoView scrolls an element into view', async () => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      await steps.verifyUrlContains('/buttons');
      await steps.scrollIntoView( 'loadingButton','ButtonsPage');
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
      await steps.click( 'buttonsLink','SidebarNav');
      await steps.verifyUrlContains('/buttons');
    });

    await test.step('clickWithoutScrolling clicks without scrolling', async () => {
      await steps.clickWithoutScrolling( 'primaryButton','ButtonsPage');
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
    });

    await test.step('clickIfPresent clicks a present element', async () => {
      await steps.clickIfPresent( 'secondaryButton','ButtonsPage');
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Secondary');
    });

    await test.step('clickIfPresent does nothing for a missing element', async () => {
      await steps.clickIfPresent( 'title','FormsPage'); // not on this page
    });

    await test.step('getText returns element text content', async () => {
      const text = await steps.getText( 'resultText','ButtonsPage');
      expect(text).toContain('Secondary');
    });

    await test.step('getAttribute returns an attribute value', async () => {
      const testId = await steps.getAttribute( 'disabledButton','ButtonsPage', 'data-testid');
      expect(testId).toBe('btn-disabled');
    });

    await test.step('verifyAttribute asserts an attribute value', async () => {
      await steps.verifyAttribute( 'disabledButton','ButtonsPage', 'data-testid', 'btn-disabled');
    });

    log('TC_042 Click Variants & Data Extraction — passed');
  });
});

test.describe('TC_043: Steps - Tab Management', () => {

  test('closeTab and getTabCount', async ({ page, steps }) => {

    await test.step('Navigate to Alerts page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'alertsLink','SidebarNav');
      await steps.verifyUrlContains('/alerts');
    });

    await test.step('getTabCount returns 1 initially', async () => {
      const count = steps.getTabCount();
      expect(count).toBe(1);
    });

    await test.step('Open new tab and close it via steps.closeTab', async () => {
      const newPage = await steps.switchToNewTab(async () => {
        await steps.click( 'newTabButton','AlertsPage');
      });
      expect(steps.getTabCount()).toBe(2);

      await steps.closeTab(newPage);
      expect(steps.getTabCount()).toBe(1);
    });

    log('TC_043 Tab Management — passed');
  });
});

test.describe('TC_044: Repo - getRandom & setDefaultTimeout', () => {

  test('getRandom picks a random element, setDefaultTimeout sets timeout', async ({ repo, steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('setDefaultTimeout changes the repo default timeout', async () => {
      repo.setDefaultTimeout(10000);
      // Just verify it does not throw
    });

    await test.step('getRandom returns one of the category cards', async () => {
      const randomCard = await repo.getRandom('categories', 'HomePage');
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
      await steps.click( 'productCarouselLink','SidebarNav');
      await steps.verifyUrlContains('/product-carousel');
    });

    await test.step('verifyImages on the active carousel slide', async () => {
      await steps.verifyImages( 'firstCarouselImage','ProductCarouselPage');
    });

    await test.step('verifyImages on the product grid thumbnails', async () => {
      await steps.verifyImages( 'productThumbnails','ProductCarouselPage');
    });

    log('TC_046 verifyImages — passed');
  });
});

test.describe('TC_047: Steps - isPresent boolean visibility check', () => {

  test('isPresent returns true for visible elements and false for absent ones', async ({ steps }) => {

    await test.step('Navigate to Buttons page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      await steps.verifyUrlContains('/buttons');
    });

    await test.step('isPresent returns true for a visible element', async () => {
      const result = await steps.isPresent( 'primaryButton','ButtonsPage');
      expect(result).toBe(true);
    });

    await test.step('isPresent returns false for an element on a different page', async () => {
      const result = await steps.isPresent( 'nameInput','FormsPage');
      expect(result).toBe(false);
    });

    log('TC_047 isPresent — passed');
  });
});

test.describe('TC_087: Steps - expect matcher tree (top-level)', () => {

  test('top-level steps.expect(el, page) exposes the matcher tree', async ({ steps }) => {
    await steps.navigateTo('/');
    await steps.click('buttonsLink', 'SidebarNav');
    await steps.verifyUrlContains('/buttons');

    await test.step('text.toBe passes on exact match', async () => {
      await steps.expect('primaryButton', 'ButtonsPage').text.toBe('Primary');
    });

    await test.step('text.toMatch passes on regex', async () => {
      await steps.expect('primaryButton', 'ButtonsPage').text.toMatch(/^Prim/);
    });

    await test.step('count.toBeGreaterThan works', async () => {
      await steps.expect('primaryButton', 'ButtonsPage').count.toBeGreaterThan(0);
    });

    await test.step('.not flips outcome', async () => {
      await steps.expect('primaryButton', 'ButtonsPage').not.text.toBe('Nope');
    });

    await test.step('.toBe(predicate) — positive case', async () => {
      await steps.expect('primaryButton', 'ButtonsPage').toBe(el => el.text === 'Primary' && el.visible);
    });

    await test.step('.toBe(predicate).throws(message) — custom failure message', async () => {
      // positive path: predicate passes, throws() never triggers
      await steps.expect('primaryButton', 'ButtonsPage')
        .toBe(el => el.enabled)
        .throws('should be enabled');
    });

    log('TC_087 expect matcher tree — passed');
  });
});

test.describe('TC_048: Steps - navigateTo with query params', () => {
  test.use({ baseURL: 'https://civitas-cerebrum.github.io/vue-test-app/' });

  test('navigateTo appends query parameters to the URL', async ({ steps }) => {

    await test.step('Navigate with query params', async () => {
      await steps.navigateTo('/', { query: { tab: 'settings', lang: 'en' } });
    });

    await test.step('URL contains the appended query params', async () => {
      await steps.verifyUrlContains('tab=settings');
      await steps.verifyUrlContains('lang=en');
    });

    log('TC_048 navigateTo query params — passed');
  });
});
