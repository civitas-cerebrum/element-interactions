import { test, expect } from './fixture/StepFixture';
import path from 'path';
import { WebElement } from '@civitas-cerebrum/element-repository';
import type { CountVerifyOptions } from '../src/enum/Options';

test.describe('Fluent API — steps.on()', () => {

  test.describe('Strategy selectors', () => {

    test.beforeEach(async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      await steps.verifyUrlContains('/buttons');
    });

    test('default (no strategy) clicks first element', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').click();
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
    });

    test('.first() explicitly selects first', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').first().click();
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
    });

    test('.nth(0) selects element at index', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').nth(0).click();
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
    });

  });

  test.describe('Strategy selectors — byText and byAttribute', () => {

    test('.byText() selects element by text content', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      // Use byText to find a button by its visible text
      const text = await steps.on('primaryButton', 'ButtonsPage').byText('Primary').getText();
      expect(text).toContain('Primary');
    });

    test('.byAttribute() selects element by attribute', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      const attr = await steps.on('disabledButton', 'ButtonsPage').byAttribute('disabled', '').getAttribute('disabled');
      expect(attr).toBe('');
    });

    // Regression: the ATTRIBUTE strategy used to fall through the resolver's
    // strategy switch to the un-filtered `.first()` path, so `byAttribute`
    // silently resolved the FIRST matching base element and ignored the
    // filter. These tests use a multi-match base ('variantButtons' matches
    // every variant button) with a target that is deliberately NOT the first
    // match — a silent first-match fallback fails both.

    test('.byAttribute() resolves the matching non-first element from a multi-match base', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      const text = await steps.on('variantButtons', 'ButtonsPage').byAttribute('data-testid', 'btn-danger').getText();
      expect(text).toBe('Danger');
    });

    test('.byAttribute() click acts on the filtered element, not the first match', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      await steps.on('variantButtons', 'ButtonsPage').byAttribute('data-testid', 'btn-danger').click();
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Danger');
    });
  });

  test.describe('Terminal — interactions', () => {

    test.beforeEach(async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      await steps.verifyUrlContains('/buttons');
    });

    test('click()', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').click();
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
    });

    test('click({ withoutScrolling: true })', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').click({ withoutScrolling: true });
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
    });

    test('clickIfPresent() returns true for visible', async ({ steps }) => {
      const result = await steps.on('primaryButton', 'ButtonsPage').clickIfPresent();
      expect(result).toBe(true);
    });

    test('clickIfPresent() returns boolean', async ({ steps }) => {
      const result = await steps.on('secondaryButton', 'ButtonsPage').clickIfPresent();
      expect(typeof result).toBe('boolean');
    });

    test('hover()', async ({ steps }) => {
      // The Vue test app's primary button has no JS-observable hover feedback
      // (no tooltip / no result element updated on hover). This is the documented
      // "no observable side-effect" framework-smoke case per contributing.md —
      // the test only proves the hover() call shape doesn't throw. A meaningful
      // hover test lives in enhanced-selectors.spec.ts (hover + tooltip).
      await steps.on('primaryButton', 'ButtonsPage').hover();
      await steps.on('primaryButton', 'ButtonsPage').verifyState('visible');
    });

    test('doubleClick()', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').doubleClick();
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
    });

    test('scrollIntoView()', async ({ steps }) => {
      await steps.on('loadingButton', 'ButtonsPage').scrollIntoView();
      await steps.on('loadingButton', 'ButtonsPage').verifyState('inViewport');
    });

    test('scrollIntoView({ direction, timeout }): the browser scrolls whichever way is needed', async ({ steps }) => {
      await steps.on('loadingButton', 'ButtonsPage').scrollIntoView({ direction: 'up', timeout: 5000 });
      await steps.on('loadingButton', 'ButtonsPage').verifyState('inViewport');
    });

    test('tapAt(offset) clicks inside the element with the mouse', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').tapAt({ x: 5, y: 5 });
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
    });
  });

  test.describe('Terminal — text inputs', () => {

    test.beforeEach(async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'textInputsLink','SidebarNav');
      await steps.verifyUrlContains('/text-inputs');
    });

    test('fill()', async ({ steps }) => {
      await steps.on('textInput', 'TextInputsPage').fill('Fluent API test');
      await steps.on('textInput', 'TextInputsPage').verifyInputValue('Fluent API test');
    });

    test('clearInput()', async ({ steps }) => {
      await steps.on('textInput', 'TextInputsPage').fill('temp');
      await steps.on('textInput', 'TextInputsPage').clearInput();
      await steps.on('textInput', 'TextInputsPage').verifyInputValue('');
    });

    test('typeSequentially()', async ({ steps }) => {
      await steps.on('textInput', 'TextInputsPage').typeSequentially('abc', 50);
      await steps.on('textInput', 'TextInputsPage').verifyInputValue('abc');
    });
  });

  test.describe('Terminal — checkboxes', () => {

    test.beforeEach(async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'checkboxesLink','SidebarNav');
      await steps.verifyUrlContains('/checkboxes');
    });

    test('check()', async ({ steps }) => {
      await steps.on('uncheckedCheckbox', 'CheckboxesPage').check();
      await steps.on('uncheckedCheckbox', 'CheckboxesPage').verifyState('checked');
    });

    test('uncheck()', async ({ steps, repo }) => {
      await steps.on('checkedCheckbox', 'CheckboxesPage').uncheck();
      // verifyState() has no 'unchecked' variant; reach into the Element directly
      // and confirm .isChecked() returns false. This proves the uncheck took
      // effect — a tautological verifyState('enabled') would pass even if
      // uncheck() had silently done nothing.
      const el = await repo.get('checkedCheckbox', 'CheckboxesPage');
      expect(await el.isChecked()).toBe(false);
    });
  });

  test.describe('Terminal — verifications', () => {

    test.beforeEach(async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
    });

    test('verifyPresence()', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').verifyPresence();
    });

    test('isPresent() returns true', async ({ steps }) => {
      const result = await steps.on('primaryButton', 'ButtonsPage').isPresent();
      expect(result).toBe(true);
    });

    test('verifyText() (no args = not empty)', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').verifyText();
    });

    test('verifyTextContains()', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').verifyTextContains('Primary');
    });

    test('verifyAttribute()', async ({ steps }) => {
      await steps.on('disabledButton', 'ButtonsPage').verifyState('disabled');
    });
  });

  test.describe('Terminal — extractions', () => {

    test.beforeEach(async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
    });

    test('getText()', async ({ steps }) => {
      const text = await steps.on('primaryButton', 'ButtonsPage').getText();
      expect(text).toBeTruthy();
    });

    test('getAttribute()', async ({ steps }) => {
      const cls = await steps.on('primaryButton', 'ButtonsPage').getAttribute('class');
      expect(cls).toBeTruthy();
    });

    test('getCount()', async ({ steps }) => {
      const count = await steps.on('primaryButton', 'ButtonsPage').getCount();
      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('Terminal — waiting', () => {

    test.beforeEach(async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
    });

    test('waitForState(visible)', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').waitForState('visible');
    });
  });

  test.describe('Chaining combinations', () => {

    test('strategy + withoutScrolling', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      await steps.on('primaryButton', 'ButtonsPage').first().click({ withoutScrolling: true });
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
    });

    test('nth + verification', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      await steps.on('primaryButton', 'ButtonsPage').nth(0).verifyPresence();
    });

    test('first + extraction', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      const text = await steps.on('primaryButton', 'ButtonsPage').first().getText();
      expect(text).toBeTruthy();
    });
  });

  test.describe('Terminal — dropdown & select', () => {

    test('selectDropdown() selects a random option', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'dropdownLink','SidebarNav');
      const val = await steps.on('singleSelect', 'DropdownSelectPage').selectDropdown();
      expect(val).toBeTruthy();
    });

    test('selectMultiple() selects multiple options', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'dropdownLink','SidebarNav');
      const vals = await steps.on('multiSelect', 'DropdownSelectPage').selectMultiple(['Australia', 'Brazil']);
      expect(vals.length).toBeGreaterThan(0);
    });
  });

  test.describe('Terminal — advanced interactions', () => {

    test('rightClick()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      // The Vue test app's primary button doesn't intercept contextmenu events —
      // the browser shows the native context menu, not a JS-observable result.
      // This is the documented "no observable side-effect" framework-smoke case
      // per contributing.md — proves the rightClick() call shape doesn't throw.
      await steps.on('primaryButton', 'ButtonsPage').rightClick();
      await steps.on('primaryButton', 'ButtonsPage').verifyState('visible');
    });

    test('uploadFile()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'fileUploadLink','SidebarNav');
      const filePath = path.resolve(__dirname, 'fixture/StepFixture.ts');
      await steps.on('singleFileInput', 'FileUploadPage').uploadFile(filePath);
      await steps.verifyTextContains( 'singleFileName','FileUploadPage', 'StepFixture');
    });

    test('uploadFile() — string[] attaches multiple files', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'fileUploadLink','SidebarNav');
      const file1 = path.resolve(__dirname, 'test-files/test-upload.txt');
      const file2 = path.resolve(__dirname, 'fixture/StepFixture.ts');
      await steps.on('multipleFileInput', 'FileUploadPage').uploadFile([file1, file2]);
      await steps.verifyTextContains( 'multipleFileList','FileUploadPage', 'test-upload.txt');
      await steps.verifyTextContains( 'multipleFileList','FileUploadPage', 'StepFixture');
    });

    test('dropFiles() — dispatches drop events with named files', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'fileUploadLink','SidebarNav');
      await steps.on('dropZone', 'FileUploadPage').dropFiles(['report.pdf', 'photo.png']);
      await steps.verifyTextContains( 'dropList','FileUploadPage', 'report.pdf');
      await steps.verifyTextContains( 'dropList','FileUploadPage', 'photo.png');
    });

    test('dragAndDrop() — targeted drop verifies via status text', async ({ steps, repo }) => {
      // Offset-only drags don't land on any drop zone in the Vue test app
      // (status stays 'none'). For a real verification we drag onto the first
      // drop zone and assert the Droppable page's zone count updates —
      // the action's direct observable effect.
      await steps.navigateTo('/');
      await steps.click( 'droppableLink','SidebarNav');
      await steps.verifyTextContains( 'redZoneCount','DroppablePage', '0');
      const redZone = await repo.get('redZone', 'DroppablePage') as WebElement;
      await steps.on('redItem1', 'DroppablePage').dragAndDrop({ target: redZone });
      await steps.verifyTextContains( 'redZoneCount','DroppablePage', '1');
    });

    test('setSliderValue()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'slidersLink','SidebarNav');
      await steps.on('basicSlider', 'SlidersPage').setSliderValue(50);
      await steps.verifyTextContains( 'basicSliderValue','SlidersPage', '50');
    });
  });

  test.describe('Terminal — additional verifications', () => {

    test('verifyAbsence() for hidden element', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'loadingLink','SidebarNav');
      // Skeleton is visible by default; toggle it off, then verify absence
      await steps.on('skeleton', 'LoadingStatesPage').verifyPresence();
      await steps.click( 'skeletonToggle','LoadingStatesPage');
      await steps.on('skeleton', 'LoadingStatesPage').verifyAbsence();
    });

    test('verifyCount()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      // Single resolved element should have count exactly 1
      await steps.on('primaryButton', 'ButtonsPage').verifyCount({ exactly: 1 });
    });

    test('verifyAttribute()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      await steps.on('disabledButton', 'ButtonsPage').verifyAttribute('disabled', '');
    });

    test('verifyInputValue()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'textInputsLink','SidebarNav');
      await steps.on('textInput', 'TextInputsPage').fill('test123');
      await steps.on('textInput', 'TextInputsPage').verifyInputValue('test123');
    });

    test('verifyImages() called on gallery placeholders', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'galleryLink','SidebarNav');
      // Gallery uses placeholder divs (no real <img>), so verifyImages will throw
      await expect(
        steps.on('mountainLandscape', 'GalleryPage').verifyImages(false)
      ).rejects.toThrow(/No images found/);
    });

    test('verifyCssProperty()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      await steps.on('primaryButton', 'ButtonsPage').verifyCssProperty('display', 'flex');
    });

    test('verifyOrder()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      // Click the Name header to sort, then verify order of name cells
      await steps.click( 'headerName','TablePage');
      // getAllTexts reads every name cell; verifyOrder asserts that whole list in order.
      const texts = await steps.on('nameCell', 'TablePage').getAllTexts();
      expect(texts.length).toBeGreaterThanOrEqual(2);
      await steps.on('nameCell', 'TablePage').verifyOrder(texts);
    });

    test('verifyListOrder()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      // Click Name header to sort ascending
      await steps.click( 'headerName','TablePage');
      await steps.on('nameCell', 'TablePage').verifyListOrder('asc');
    });
  });

  test.describe('verifyCount bounds', () => {

    test('every bound and every lower + upper range holds, both forms', async ({ steps }) => {
      await steps.navigateTo('/');
      const n = await steps.getCount('categories', 'HomePage');
      expect(n).toBeGreaterThan(2);
      const passing: CountVerifyOptions[] = [
        { exactly: n }, { greaterThan: n - 1 }, { greaterThanOrEqual: n }, { lessThan: n + 1 }, { lessThanOrEqual: n },
        { greaterThan: n - 1, lessThan: n + 1 }, { greaterThanOrEqual: n, lessThanOrEqual: n },
        { greaterThan: n - 1, lessThanOrEqual: n }, { greaterThanOrEqual: n, lessThan: n + 1 },
      ];
      for (const options of passing) {
        await steps.verifyCount('categories', 'HomePage', options);
        await steps.on('categories', 'HomePage').verifyCount(options);
      }
    });

    test('a range checks its upper bound too, and the failure names the failed bound', async ({ steps }) => {
      await steps.navigateTo('/');
      const n = await steps.getCount('categories', 'HomePage');
      const cases: Array<[CountVerifyOptions, string]> = [
        [{ greaterThan: 1, lessThan: 3 }, `${n} is not < 3`],
        [{ greaterThanOrEqual: n + 1 }, `${n} is not >= ${n + 1}`],
        [{ greaterThanOrEqual: 1, lessThanOrEqual: n - 1 }, `${n} is not <= ${n - 1}`],
      ];
      for (const [options, failed] of cases) {
        for (const run of [
          () => steps.verifyCount('categories', 'HomePage', options, { timeout: 500 }),
          () => steps.on('categories', 'HomePage').timeout(500).verifyCount(options),
        ]) {
          const error = await run().then(() => undefined, (e: Error) => e);
          expect(error, JSON.stringify(options)).toBeDefined();
          // Playwright colours the received value: compare the plain text.
          expect(error!.message.replace(/\u001b\[[0-9;]*m/g, '')).toContain(failed);
        }
      }
    });

    test('a negated count range says "Expected count not ..."', async ({ steps }) => {
      await steps.navigateTo('/');
      const n = await steps.getCount('categories', 'HomePage');
      const error = await steps.expect('categories', 'HomePage').not.count.toBeGreaterThan(n - 1).timeout(500)
        .then(() => undefined, (e: unknown) => e as Error);
      expect(error).toBeDefined();
      const message = error!.message.replace(/\u001b\[[0-9;]*m/g, '');
      expect(message).toContain(`Expected count not > ${n - 1}`);
      expect(message).not.toContain('Expected NOT count');
    });

    test('contradictory, empty or malformed options are refused at once', async ({ steps }) => {
      await steps.navigateTo('/');
      const invalid: Array<[unknown, RegExp]> = [
        [{}, /You must provide 'exactly'/],
        [{ exactly: 8, lessThan: 9 }, /'exactly' cannot be combined with 'lessThan'/],
        [{ greaterThan: 1, greaterThanOrEqual: 2 }, /one lower bound/],
        [{ lessThan: 9, lessThanOrEqual: 8 }, /one upper bound/],
        [{ greaterThan: 3, lessThan: 4 }, /No element count is > 3 and < 4/],
      ];
      for (const [options, message] of invalid) {
        const started = Date.now();
        await expect(steps.verifyCount('categories', 'HomePage', options as CountVerifyOptions)).rejects.toThrow(message);
        await expect(steps.on('categories', 'HomePage').verifyCount(options as CountVerifyOptions)).rejects.toThrow(message);
        expect(Date.now() - started).toBeLessThan(1000);
      }
    });
  });

  test.describe('Terminal — additional extractions', () => {

    test('getAllTexts()', async ({ steps }) => {
      await steps.navigateTo('/');
      const texts = await steps.on('categories', 'HomePage').getAllTexts();
      expect(texts.length).toBeGreaterThan(0);
    });

    test('getCount() and getAllTexts() read every match, as steps.getCount / steps.getAll do', async ({ steps }) => {
      await steps.navigateTo('/');
      const all = await steps.getAll('categories', 'HomePage');
      expect(all.length).toBeGreaterThan(1);
      expect(await steps.on('categories', 'HomePage').getCount()).toBe(await steps.getCount('categories', 'HomePage'));
      expect(await steps.on('categories', 'HomePage').getCount()).toBe(all.length);
      expect(await steps.on('categories', 'HomePage').getAllTexts()).toEqual(all);
      // Collection-level: a strategy selector does not narrow them.
      expect(await steps.on('categories', 'HomePage').nth(1).getCount()).toBe(all.length);
      expect(await steps.on('categories', 'HomePage').first().getAllTexts()).toEqual(all);
    });

    test('getInputValue()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'textInputsLink','SidebarNav');
      await steps.on('textInput', 'TextInputsPage').fill('hello');
      const val = await steps.on('textInput', 'TextInputsPage').getInputValue();
      expect(val).toBe('hello');
    });

    test('getCssProperty()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      const display = await steps.on('primaryButton', 'ButtonsPage').getCssProperty('display');
      expect(display).toBeTruthy();
    });
  });

  test.describe('Raw Interactions methods', () => {

    test('clickIfPresent() on raw Interactions', async ({ interactions, steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      const repo = (steps as any).repo;
      const element = await repo.get('primaryButton', 'ButtonsPage');
      const result = await interactions.interact.clickIfPresent(element);
      expect(result).toBe(true);
    });
  });
});
