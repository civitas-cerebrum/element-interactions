import { test, expect } from './fixture/StepFixture';
import { DropdownSelectType } from '../src/enum/Options';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ══════════════════════════════════════════════════
// RAW API COVERAGE TESTS (TC_077 through TC_100)
// ══════════════════════════════════════════════════

test.describe('TC_077: Raw API — interact.clickWithoutScrolling, clickIfPresent', () => {

  test('click methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('clickWithoutScrolling via raw API', async () => {
      await steps.navigateTo('/');
      // Use the dark-mode toggle button — not a link, so dispatchEvent works as a real click
      const btn = page.locator('[data-testid="dark-mode-toggle"]');
      await interactions.interact.clickWithoutScrolling(btn);
      await interactions.verify.presence(btn);
    });

    await test.step('clickIfPresent via raw API', async () => {
      await steps.navigateTo('/');
      const card = page.locator('[data-testid="home-card-forms"]');
      const result = await interactions.interact.clickIfPresent(card);
      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });

    await test.step('clickIfPresent returns false for absent element', async () => {
      const absent = page.locator('[data-testid="does-not-exist-xyz"]');
      const result = await interactions.interact.clickIfPresent(absent);
      expect(result).toBe(false);
    });

    log('TC_077 Raw API interact.clickWithoutScrolling, clickIfPresent — passed');
  });
});

test.describe('TC_078: Raw API — interact.hover, scrollIntoView', () => {

  test('hover and scroll methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('hover via raw API', async () => {
      await steps.navigateTo('/');
      const card = page.locator('[data-testid="home-card-forms"]');
      await interactions.interact.hover(card);
    });

    await test.step('scrollIntoView via raw API', async () => {
      await steps.navigateTo('/');
      // Use last home card which requires scrolling
      const lastCard = page.locator('[data-testid="home-card-longList"]');
      await interactions.interact.scrollIntoView(lastCard);
    });

    log('TC_078 Raw API interact.hover, scrollIntoView — passed');
  });
});

test.describe('TC_079: Raw API — interact.typeSequentially, rightClick, doubleClick', () => {

  test('type and click methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('typeSequentially via raw API', async () => {
      await steps.navigateTo('/text-inputs');
      const input = page.locator('[data-testid="input-text"]');
      await interactions.interact.typeSequentially(input, 'Sequential test', 50);
    });

    await test.step('rightClick via raw API', async () => {
      await steps.navigateTo('/');
      const card = page.locator('[data-testid="home-card-forms"]');
      await interactions.interact.rightClick(card);
    });

    await test.step('doubleClick via raw API', async () => {
      await steps.navigateTo('/');
      const card = page.locator('[data-testid="home-card-forms"]');
      await interactions.interact.doubleClick(card);
    });

    log('TC_079 Raw API interact.typeSequentially, rightClick, doubleClick — passed');
  });
});

test.describe('TC_080: Raw API — interact.check, uncheck', () => {

  test('check/uncheck methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('check via raw API', async () => {
      await steps.navigateTo('/checkboxes');
      const checkbox = page.locator('[data-testid="checkbox-unchecked"]');
      await interactions.interact.check(checkbox);
      const isChecked = await checkbox.isChecked();
      expect(isChecked).toBe(true);
    });

    await test.step('uncheck via raw API', async () => {
      await steps.navigateTo('/checkboxes');
      const checkbox = page.locator('[data-testid="checkbox-unchecked"]');
      await interactions.interact.uncheck(checkbox);
      const isChecked = await checkbox.isChecked();
      expect(isChecked).toBe(false);
    });

    log('TC_080 Raw API interact.check, uncheck — passed');
  });
});

test.describe('TC_081: Raw API — interact.setSliderValue, pressKey', () => {

  test('slider and key methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('setSliderValue via raw API', async () => {
      await steps.navigateTo('/sliders');
      const slider = page.locator('[data-testid="slider-basic"]');
      await interactions.interact.setSliderValue(slider, 75);
    });

    await test.step('pressKey via raw API', async () => {
      await steps.navigateTo('/text-inputs');
      const input = page.locator('[data-testid="input-text"]');
      await input.fill('Test');
      // pressKey takes only the key string — no locator arg
      await interactions.interact.pressKey('Enter');
    });

    log('TC_081 Raw API interact.setSliderValue, pressKey — passed');
  });
});

test.describe('TC_082: Raw API — interact.selectDropdown, selectMultiple', () => {

  test('selection methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('selectDropdown VALUE via raw API', async () => {
      await steps.navigateTo('/dropdown');
      const dropdown = page.locator('[data-testid="dropdown-single"]');
      const selected = await interactions.interact.selectDropdown(dropdown, { type: DropdownSelectType.VALUE, value: 'Australia' });
      expect(selected).toBe('Australia');
    });

    await test.step('selectDropdown INDEX via raw API', async () => {
      await steps.navigateTo('/dropdown');
      const dropdown = page.locator('[data-testid="dropdown-single"]');
      const selected = await interactions.interact.selectDropdown(dropdown, { type: DropdownSelectType.INDEX, index: 0 });
      expect(typeof selected).toBe('string');
    });

    await test.step('selectDropdown RANDOM via raw API', async () => {
      await steps.navigateTo('/dropdown');
      const dropdown = page.locator('[data-testid="dropdown-single"]');
      const selected = await interactions.interact.selectDropdown(dropdown, { type: DropdownSelectType.RANDOM });
      expect(typeof selected).toBe('string');
    });

    await test.step('selectMultiple via raw API', async () => {
      await steps.navigateTo('/dropdown');
      const dropdown = page.locator('[data-testid="dropdown-multi"]');
      const selected = await interactions.interact.selectMultiple(dropdown, ['Australia', 'Canada']);
      expect(selected.length).toBe(2);
    });

    log('TC_082 Raw API interact.selectDropdown, selectMultiple — passed');
  });
});

test.describe('TC_083: Raw API — interact.getByText', () => {

  test('getByText method via raw API', async ({ page, interactions, steps }) => {

    await test.step('getByText via raw API', async () => {
      await steps.navigateTo('/');
      const navLinks = page.locator('[data-testid="nav-sidebar"] a');
      const link = await interactions.interact.getByText(navLinks, 'Text Inputs');
      expect(link).toBeTruthy();
    });

    log('TC_083 Raw API interact.getByText — passed');
  });
});

test.describe('TC_084: Raw API — interact.uploadFile', () => {

  test('uploadFile method via raw API', async ({ page, interactions, steps }) => {

    await test.step('uploadFile via raw API', async () => {
      await steps.navigateTo('/file-upload');
      const fileInput = page.locator('[data-testid="file-input-single"]');
      await interactions.interact.uploadFile(fileInput, 'tests/fixtures/test-file.txt');
    });

    log('TC_084 Raw API interact.uploadFile — passed');
  });
});

test.describe('TC_085: Raw API — interact.getByText (strict mode)', () => {

  test('getByText throws when strict=true and text not found', async ({ page, interactions, steps }) => {

    await test.step('getByText strict=true throws on missing text', async () => {
      await steps.navigateTo('/');
      const baseLocator = page.locator('[data-testid^="home-card-"]');
      await expect(
        interactions.interact.getByText(baseLocator, 'THIS_TEXT_DOES_NOT_EXIST_XYZ', true)
      ).rejects.toThrow('getByText: element with text "THIS_TEXT_DOES_NOT_EXIST_XYZ" not found');
    });

    log('TC_085 Raw API interact.getByText strict mode — passed');
  });
});

test.describe('TC_086: Raw API — interact.clearInput', () => {

  test('clearInput method via raw API', async ({ page, interactions, steps }) => {

    await test.step('clearInput via raw API', async () => {
      await steps.navigateTo('/text-inputs');
      const input = page.locator('[data-testid="input-text"]');
      await input.fill('Test Value');
      await interactions.interact.clearInput(input);
      const val = await input.inputValue();
      expect(val).toBe('');
    });

    log('TC_086 Raw API interact.clearInput — passed');
  });
});

test.describe('TC_090: Raw API — verify.text, textContains, absence', () => {

  test('text verification methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('text via raw API', async () => {
      await steps.navigateTo('/');
      const title = page.locator('h1');
      await interactions.verify.text(title, 'UI Components Test Suite');
    });

    await test.step('textContains via raw API', async () => {
      await steps.navigateTo('/');
      const title = page.locator('h1');
      await interactions.verify.textContains(title, 'Components');
    });

    await test.step('absence via raw API', async () => {
      await steps.navigateTo('/');
      const notFound = page.locator('[data-testid="non-existent-element"]');
      await interactions.verify.absence(notFound);
    });

    log('TC_090 Raw API verify.text, textContains, absence — passed');
  });
});

test.describe('TC_091: Raw API — verify.presence, state', () => {

  test('presence and state verification methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('presence via raw API', async () => {
      await steps.navigateTo('/');
      const title = page.locator('h1');
      await interactions.verify.presence(title);
    });

    await test.step('state via raw API', async () => {
      await steps.navigateTo('/');
      const title = page.locator('h1');
      await interactions.verify.state(title, 'visible');
    });

    log('TC_091 Raw API verify.presence, state — passed');
  });
});

test.describe('TC_092: Raw API — verify.urlContains, attribute', () => {

  test('URL and attribute verification methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('urlContains via raw API', async () => {
      await steps.navigateTo('/');
      // urlContains takes only the expected substring, not (page, path, text)
      await interactions.verify.urlContains('127.0.0.1');
    });

    await test.step('attribute via raw API', async () => {
      await steps.navigateTo('/');
      // home-card-forms IS the <a> tag — no child 'a' needed
      const link = page.locator('[data-testid="home-card-forms"]');
      await interactions.verify.attribute(link, 'href', '/forms');
    });

    log('TC_092 Raw API verify.urlContains, attribute — passed');
  });
});

test.describe('TC_093: Raw API — verify.images, tabCount', () => {

  test('images and tabCount verification methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('images via raw API', async () => {
      // product-carousel has real <img> elements with data-testid="product-thumb-*"
      await steps.navigateTo('/product-carousel');
      const images = page.locator('[data-testid^="product-thumb-"]');
      await interactions.verify.images(images);
    });

    await test.step('tabCount via raw API', async () => {
      await steps.navigateTo('/');
      // tabCount takes only the expected count number
      await interactions.verify.tabCount(1);
    });

    log('TC_093 Raw API verify.images, tabCount — passed');
  });
});

test.describe('TC_094: Raw API — verify.order, listOrder, cssProperty, snapshot', () => {

  test('ordering and snapshot verification methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('order via raw API', async () => {
      await steps.navigateTo('/');
      // Home page category cards appear in a fixed order
      const headings = page.locator('[data-testid^="home-card-"] h3');
      await interactions.verify.order(headings, [
        'Elements',
        'Forms',
        'Alerts, Frame & Windows',
        'Widgets',
        'Interactions',
        'Media',
        'Auth & State',
        'Edge Cases',
      ]);
    });

    await test.step('listOrder via raw API', async () => {
      // Dropdown country options are already in alphabetical (asc) order
      await steps.navigateTo('/dropdown');
      const options = page.locator('[data-testid="dropdown-single"] option:not([value=""])');
      await interactions.verify.listOrder(options, 'asc');
    });

    await test.step('cssProperty via raw API', async () => {
      await steps.navigateTo('/');
      const title = page.locator('h1');
      await interactions.verify.cssProperty(title, 'display', 'block');
    });

    await test.step('snapshot via raw API', async () => {
      await steps.navigateTo('/');
      const title = page.locator('h1');
      await interactions.verify.snapshot(title);
    });

    log('TC_094 Raw API verify.order, listOrder, cssProperty, snapshot — passed');
  });
});

test.describe('TC_095: Raw API — verify.count', () => {

  test('count verification methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('count exactly via raw API', async () => {
      await steps.navigateTo('/');
      // Home page has exactly 8 category cards
      const cards = page.locator('[data-testid^="home-card-"]');
      await interactions.verify.count(cards, { exactly: 8 });
    });

    await test.step('count greaterThan via raw API', async () => {
      await steps.navigateTo('/');
      const cards = page.locator('[data-testid^="home-card-"]');
      await interactions.verify.count(cards, { greaterThan: 5 });
    });

    await test.step('count lessThan via raw API', async () => {
      await steps.navigateTo('/');
      const cards = page.locator('[data-testid^="home-card-"]');
      await interactions.verify.count(cards, { lessThan: 10 });
    });

    log('TC_095 Raw API verify.count — passed');
  });
});

test.describe('TC_096: Raw API — verify.inputValue', () => {

  test('inputValue verification method via raw API', async ({ page, interactions, steps }) => {

    await test.step('inputValue via raw API', async () => {
      await steps.navigateTo('/text-inputs');
      const input = page.locator('[data-testid="input-error"]');
      // inputValue returns void — just verify the assertion passes
      await interactions.verify.inputValue(input, 'invalid@');
    });

    log('TC_096 Raw API verify.inputValue — passed');
  });
});

test.describe('TC_097: Raw API — extract.text, getAttribute', () => {

  test('text extraction methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('text via raw API', async () => {
      await steps.navigateTo('/');
      const title = page.locator('h1');
      const text = await interactions.extract.getText(title);
      expect(text).toContain('UI Components Test Suite');
    });

    await test.step('getAttribute via raw API', async () => {
      await steps.navigateTo('/');
      // home-card-forms IS the <a> element — href is directly on it
      const link = page.locator('[data-testid="home-card-forms"]');
      const href = await interactions.extract.getAttribute(link, 'href');
      expect(href).toContain('forms');
    });

    log('TC_097 Raw API extract.text, getAttribute — passed');
  });
});

test.describe('TC_098: Raw API — extract.getAllTexts with selector', () => {

  test('getAllTexts via raw API', async ({ page, interactions, steps }) => {

    await test.step('getAllTexts with selector via raw API', async () => {
      await steps.navigateTo('/');
      const navLinks = page.locator('[data-testid="nav-sidebar"] a');
      const texts = await interactions.extract.getAllTexts(navLinks);
      expect(texts.length).toBeGreaterThan(0);
    });

    log('TC_098 Raw API extract.getAllTexts with selector — passed');
  });
});

test.describe('TC_099: Raw API — extract.getListedElement', () => {

  test('getListedElement via raw API', async ({ page, interactions, steps }) => {

    await test.step('getListedElement with text via raw API', async () => {
      await steps.navigateTo('/');
      // Home cards are a natural list — "Forms" is in the text of home-card-forms
      const cards = page.locator('[data-testid^="home-card-"]');
      const item = await interactions.interact.getListedElement(cards, { text: 'Forms' });
      expect(item).toBeTruthy();
    });

    await test.step('getListedElement with attribute via raw API', async () => {
      await steps.navigateTo('/');
      const cards = page.locator('[data-testid^="home-card-"]');
      const item = await interactions.interact.getListedElement(cards, { attribute: { name: 'data-testid', value: 'home-card-forms' } });
      expect(item).toBeTruthy();
    });

    await test.step('getListedElement with child via raw API', async () => {
      await steps.navigateTo('/');
      const cards = page.locator('[data-testid^="home-card-"]');
      const item = await interactions.interact.getListedElement(cards, { text: 'Forms', child: 'h3' });
      expect(item).toBeTruthy();
    });

    log('TC_099 Raw API extract.getListedElement — passed');
  });
});

test.describe('TC_100: Raw API — navigate.toUrl, closeTab, getTabCount', () => {

  test('navigation methods via raw API', async ({ page, interactions, steps }) => {

    await test.step('toUrl via raw API', async () => {
      await interactions.navigate.toUrl('/');
      const url = page.url();
      expect(url).toContain('127.0.0.1');
    });

    await test.step('closeTab via raw API', async () => {
      const initialCount = steps.getTabCount();
      const newPage = await interactions.navigate.switchToNewTab(async () => {
        // window.open opens an actual new tab that switchToNewTab can detect
        await page.evaluate(() => window.open('/text-inputs'));
      });
      if (newPage) {
        await interactions.navigate.closeTab(newPage);
        await steps.verifyTabCount(initialCount);
      }
    });

    await test.step('getTabCount via raw API', async () => {
      const count = steps.getTabCount();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    log('TC_100 Raw API navigate.toUrl, closeTab, getTabCount — passed');
  });
});
