import { test, expect } from './fixture/StepFixture';
import { DropdownSelectType, ScreenshotOptions } from '../src/enum/Options';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ──────────────────────────────────────────────────────────────────────────────
// New Methods — TC_055 through TC_071
// ──────────────────────────────────────────────────────────────────────────────

test.describe('TC_055: fillForm — fill multiple fields in one call', () => {

  test('fills text inputs and selects a dropdown', async ({ steps }) => {

    await test.step('Navigate to Forms page', async () => {
      await steps.navigateTo('/');
      await steps.click('HomePage', 'formsCard');
      await steps.verifyUrlContains('/forms');
    });

    await test.step('Fill form with text fields and dropdown', async () => {
      await steps.fillForm('FormsPage', {
        nameInput: 'Fill Form Test',
        emailInput: 'fillform@test.com',
        mobileInput: '1234567890',
        genderDropdown: { type: DropdownSelectType.VALUE, value: 'Male' }
      });
    });

    await test.step('Verify all fields were filled', async () => {
      await steps.verifyInputValue('FormsPage', 'nameInput', 'Fill Form Test');
      await steps.verifyInputValue('FormsPage', 'emailInput', 'fillform@test.com');
      await steps.verifyInputValue('FormsPage', 'mobileInput', '1234567890');
    });

    log('TC_055 fillForm — passed');
  });
});

test.describe('TC_056: clearInput — clear an input field', () => {

  test('fills then clears an input', async ({ steps }) => {

    await test.step('Navigate to Text Inputs page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'textInputsLink');
      await steps.verifyUrlContains('/text-inputs');
    });

    await test.step('Fill text input', async () => {
      await steps.fill('TextInputsPage', 'textInput', 'Some text to clear');
      await steps.verifyInputValue('TextInputsPage', 'textInput', 'Some text to clear');
    });

    await test.step('Clear input and verify it is empty', async () => {
      await steps.clearInput('TextInputsPage', 'textInput');
      await steps.verifyInputValue('TextInputsPage', 'textInput', '');
    });

    log('TC_056 clearInput — passed');
  });
});

test.describe('TC_057: getInputValue — read input values', () => {

  test('reads pre-populated and user-entered values', async ({ steps }) => {

    await test.step('Navigate to Text Inputs page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'textInputsLink');
      await steps.verifyUrlContains('/text-inputs');
    });

    await test.step('Read pre-populated error input value', async () => {
      const value = await steps.getInputValue('TextInputsPage', 'errorInput');
      expect(value).toBe('invalid@');
    });

    await test.step('Read pre-populated success input value', async () => {
      const value = await steps.getInputValue('TextInputsPage', 'successInput');
      expect(value).toBe('valid@example.com');
    });

    await test.step('Fill and read back a value', async () => {
      await steps.fill('TextInputsPage', 'emailInput', 'test@example.org');
      const value = await steps.getInputValue('TextInputsPage', 'emailInput');
      expect(value).toBe('test@example.org');
    });

    log('TC_057 getInputValue — passed');
  });
});

test.describe('TC_058: getCount — count elements', () => {

  test('counts categories on home page', async ({ steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('getCount returns 8 categories', async () => {
      const count = await steps.getCount('HomePage', 'categories');
      expect(count).toBe(8);
    });

    log('TC_058 getCount — passed');
  });
});

test.describe('TC_059: getAll — bulk text extraction', () => {

  test('extracts texts and attributes from table rows', async ({ steps }) => {

    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'tableLink');
      await steps.verifyUrlContains('/table');
    });

    await test.step('getAll — basic text extraction from rows', async () => {
      const texts = await steps.getAll('TablePage', 'rows');
      expect(texts.length).toBe(5);
      expect(texts[0]).toContain('Alice Martin');
    });

    await test.step('getAll — with child selector', async () => {
      const names = await steps.getAll('TablePage', 'rows', { child: { pageName: 'TablePage', elementName: 'nameCell' } });
      expect(names).toEqual(['Alice Martin', 'Bob Chen', 'Carol White', 'David Kim', 'Eve Torres']);
    });

    await test.step('getAll — with extractAttribute', async () => {
      const testIds = await steps.getAll('TablePage', 'rowCheckboxes', { extractAttribute: 'data-testid' });
      expect(testIds.length).toBe(5);
      expect(testIds[0]).toContain('table-row-checkbox-');
    });

    log('TC_059 getAll — passed');
  });
});

test.describe('TC_060: getCssProperty — read computed styles', () => {

  test('reads CSS properties from elements', async ({ steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Read display property of page title', async () => {
      const display = await steps.getCssProperty('HomePage', 'pageTitle', 'display');
      expect(display).toBeTruthy();
    });

    await test.step('Read font-size of page title', async () => {
      const fontSize = await steps.getCssProperty('HomePage', 'pageTitle', 'font-size');
      expect(fontSize).toMatch(/\d+px/);
    });

    log('TC_060 getCssProperty — passed');
  });
});

test.describe('TC_061: verifyCssProperty — assert computed styles', () => {

  test('asserts CSS property values', async ({ steps }) => {

    await test.step('Navigate to Text Inputs page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'textInputsLink');
      await steps.verifyUrlContains('/text-inputs');
    });

    await test.step('Verify display property of text input', async () => {
      const display = await steps.getCssProperty('TextInputsPage', 'textInput', 'display');
      await steps.verifyCssProperty('TextInputsPage', 'textInput', 'display', display);
    });

    log('TC_061 verifyCssProperty — passed');
  });
});

test.describe('TC_062: waitAndClick — wait then click', () => {

  test('waits for visible state then clicks', async ({ steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('waitAndClick on forms card (default: visible)', async () => {
      await steps.waitAndClick('HomePage', 'formsCard');
      await steps.verifyUrlContains('/forms');
    });

    log('TC_062 waitAndClick — passed');
  });
});

test.describe('TC_063: clickNth — click by index', () => {

  test('clicks an element at a specific index', async ({ steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Click the second category card (index 1)', async () => {
      await steps.clickNth('HomePage', 'categories', 1);
      // Should navigate to one of the category pages
      await steps.verifyAbsence('HomePage', 'categories');
    });

    log('TC_063 clickNth — passed');
  });
});

test.describe('TC_064: selectMultiple — select multiple options', () => {

  test('selects multiple values in a multi-select', async ({ steps }) => {

    await test.step('Navigate to Dropdown page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'dropdownLink');
      await steps.verifyUrlContains('/dropdown');
    });

    await test.step('Select multiple countries', async () => {
      const selected = await steps.selectMultiple('DropdownSelectPage', 'multiSelect', ['Australia', 'Canada', 'France']);
      expect(selected).toContain('Australia');
      expect(selected).toContain('Canada');
      expect(selected).toContain('France');
    });

    log('TC_064 selectMultiple — passed');
  });
});

test.describe('TC_065: verifyListOrder — assert sort direction', () => {

  test('verifies ascending sort on table names', async ({ page, steps }) => {

    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'tableLink');
      await steps.verifyUrlContains('/table');
    });

    await test.step('Default name order is ascending — verify with verifyListOrder', async () => {
      await steps.verifyListOrder('TablePage', 'nameCell', 'asc');
    });

    await test.step('Click Name header twice to sort descending', async () => {
      await steps.click('TablePage', 'headerName');
      await steps.click('TablePage', 'headerName');
    });

    await test.step('Verify descending order with verifyListOrder', async () => {
      await steps.verifyListOrder('TablePage', 'nameCell', 'desc');
    });

    log('TC_065 verifyListOrder — passed');
  });
});

test.describe('TC_066: retryUntil — retry action until verification', () => {

  test('retries clicking until expected state', async ({ steps }) => {

    await test.step('Navigate to Checkboxes page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'checkboxesLink');
      await steps.verifyUrlContains('/checkboxes');
    });

    await test.step('retryUntil — click checkbox until checked', async () => {
      // First uncheck if already checked
      await steps.uncheck('CheckboxesPage', 'uncheckedCheckbox');
      // Now retry click until it becomes checked
      await steps.retryUntil(
        async () => { await steps.check('CheckboxesPage', 'uncheckedCheckbox'); },
        async () => { await steps.verifyState('CheckboxesPage', 'uncheckedCheckbox', 'checked'); },
        3,
        500
      );
    });

    log('TC_066 retryUntil — passed');
  });
});

test.describe('TC_067: screenshot — page and element screenshots', () => {

  test('captures page and element screenshots', async ({ steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Page screenshot (no options)', async () => {
      const buffer = await steps.screenshot();
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    await test.step('Page screenshot with fullPage option', async () => {
      const buffer = await steps.screenshot({ fullPage: true });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    await test.step('Element screenshot', async () => {
      const buffer = await steps.screenshot('HomePage', 'pageTitle');
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    log('TC_067 screenshot — passed');
  });
});

test.describe('TC_068: waitForNetworkIdle — wait for network quiet', () => {

  test('waits for network idle after navigation', async ({ steps }) => {

    await test.step('Navigate and wait for network idle', async () => {
      await steps.navigateTo('/');
      await steps.waitForNetworkIdle();
    });

    await test.step('Page is fully loaded after network idle', async () => {
      await steps.verifyPresence('HomePage', 'pageTitle');
      await steps.verifyCount('HomePage', 'categories', { exactly: 8 });
    });

    log('TC_068 waitForNetworkIdle — passed');
  });
});

test.describe('TC_069: verifyOrder — assert exact element text order', () => {

  test('verifies exact text order of table name cells', async ({ steps }) => {

    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'tableLink');
      await steps.verifyUrlContains('/table');
    });

    await test.step('Verify exact order of names using verifyOrder', async () => {
      await steps.verifyOrder('TablePage', 'nameCell', ['Alice Martin', 'Bob Chen', 'Carol White', 'David Kim', 'Eve Torres']);
    });

    log('TC_069 verifyOrder — passed');
  });
});

// ─── TC_070: verifySnapshot ───
test.describe('TC_070: verifySnapshot — visual regression screenshot', () => {

  test('captures and compares element snapshot', async ({ steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Verify snapshot of page title element', async () => {
      await steps.verifySnapshot('HomePage', 'pageTitle');
    });

    log('TC_070 verifySnapshot — passed');
  });
});

// ─── TC_071: waitForResponse ───
test.describe('TC_071: waitForResponse — wait for network response', () => {

  test('waits for a network response during navigation', async ({ steps }) => {

    await test.step('Navigate to home and wait for response on table page load', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Wait for response when navigating to table page', async () => {
      await steps.waitForResponse(/table/, async () => {
        await steps.navigateTo('/table');
      });
    });

    await test.step('Verify table page loaded', async () => {
      await steps.verifyUrlContains('/table');
      await steps.verifyPresence('TablePage', 'table');
    });

    log('TC_071 waitForResponse — passed');
  });
});
