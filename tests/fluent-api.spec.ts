import { test, expect } from './fixture/StepFixture';
import path from 'path';

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
      await steps.on('primaryButton', 'ButtonsPage').hover();
    });

    test('doubleClick()', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').doubleClick();
    });

    test('scrollIntoView()', async ({ steps }) => {
      await steps.on('loadingButton', 'ButtonsPage').scrollIntoView();
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
    });

    test('clearInput()', async ({ steps }) => {
      await steps.on('textInput', 'TextInputsPage').fill('temp');
      await steps.on('textInput', 'TextInputsPage').clearInput();
    });

    test('typeSequentially()', async ({ steps }) => {
      await steps.on('textInput', 'TextInputsPage').typeSequentially('abc', 50);
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
    });

    test('uncheck()', async ({ steps }) => {
      await steps.on('checkedCheckbox', 'CheckboxesPage').uncheck();
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

    test('verifyText({ notEmpty: true })', async ({ steps }) => {
      await steps.on('primaryButton', 'ButtonsPage').verifyText(undefined, { notEmpty: true });
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
      await steps.on('primaryButton', 'ButtonsPage').rightClick();
    });

    test('uploadFile()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'fileUploadLink','SidebarNav');
      const filePath = path.resolve(__dirname, 'fixture/StepFixture.ts');
      await steps.on('singleFileInput', 'FileUploadPage').uploadFile(filePath);
    });

    test('dragAndDrop()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'draggableLink','SidebarNav');
      await steps.on('item1', 'DraggablePage').dragAndDrop({ xOffset: 80, yOffset: 40 });
    });

    test('setSliderValue()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'slidersLink','SidebarNav');
      await steps.on('basicSlider', 'SlidersPage').setSliderValue(50);
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
      const texts = await steps.on('nameCell', 'TablePage').getAllTexts();
      // Verify the first few names are in the order shown
      if (texts.length >= 2) {
        await steps.on('nameCell', 'TablePage').verifyOrder(texts.slice(0, 2));
      }
    });

    test('verifyListOrder()', async ({ steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      // Click Name header to sort ascending
      await steps.click( 'headerName','TablePage');
      await steps.on('nameCell', 'TablePage').verifyListOrder('asc');
    });
  });

  test.describe('Terminal — additional extractions', () => {

    test('getAllTexts()', async ({ steps }) => {
      await steps.navigateTo('/');
      const texts = await steps.on('categories', 'HomePage').getAllTexts();
      expect(texts.length).toBeGreaterThan(0);
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

  test.describe('Deprecated Interactions methods', () => {

    test('clickWithoutScrolling() on raw Interactions', async ({ interactions, steps }) => {
      await steps.navigateTo('/');
      await steps.click( 'buttonsLink','SidebarNav');
      const locator = (await steps.on('primaryButton', 'ButtonsPage').getAttribute('class'))
        ? true : false;
      // Get a locator from the repo and call the deprecated method
      const repo = (steps as any).repo;
      const element = await repo.get('primaryButton', 'ButtonsPage');
      await interactions.interact.clickWithoutScrolling(element);
    });

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
