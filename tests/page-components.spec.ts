import { test, expect } from './fixture/StepFixture';
import { DropdownSelectType } from '../src/enum/Options';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ==========================================
// Phase 3: Elements Category Tests
// ==========================================

test.describe('TC_009: Buttons Page', () => {

  test('button clicks update result text', async ({ steps }) => {

    await test.step('Navigate to Buttons page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'buttonsLink');
      await steps.verifyUrlContains('/buttons');
    });

    await test.step('Click Primary button and verify result', async () => {
      await steps.click('ButtonsPage', 'primaryButton');
      await steps.verifyTextContains('ButtonsPage', 'resultText', 'Primary');
    });

    await test.step('Click Secondary button and verify result', async () => {
      await steps.click('ButtonsPage', 'secondaryButton');
      await steps.verifyTextContains('ButtonsPage', 'resultText', 'Secondary');
    });

    await test.step('Click Danger button and verify result', async () => {
      await steps.click('ButtonsPage', 'dangerButton');
      await steps.verifyTextContains('ButtonsPage', 'resultText', 'Danger');
    });

    await test.step('Verify disabled button is disabled', async () => {
      await steps.verifyState('ButtonsPage', 'disabledButton', 'disabled');
    });

    await test.step('Verify loading button is disabled', async () => {
      await steps.verifyState('ButtonsPage', 'loadingButton', 'disabled');
    });

    await test.step('Verify size variants are visible', async () => {
      await steps.verifyPresence('ButtonsPage', 'smallButton');
      await steps.verifyPresence('ButtonsPage', 'mediumButton');
      await steps.verifyPresence('ButtonsPage', 'largeButton');
    });

    log('TC_009 Buttons Page — passed');
  });
});

test.describe('TC_010: Text Inputs Page', () => {

  test('fill inputs and verify values display', async ({ steps }) => {

    await test.step('Navigate to Text Inputs page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'textInputsLink');
      await steps.verifyUrlContains('/text-inputs');
    });

    await test.step('Fill text input and verify', async () => {
      await steps.fill('TextInputsPage', 'textInput', 'hello world');
      await steps.verifyInputValue('TextInputsPage', 'textInput', 'hello world');
    });

    await test.step('Fill email input and verify', async () => {
      await steps.fill('TextInputsPage', 'emailInput', 'test@example.com');
      await steps.verifyInputValue('TextInputsPage', 'emailInput', 'test@example.com');
    });

    await test.step('Fill number input and verify', async () => {
      await steps.fill('TextInputsPage', 'numberInput', '42');
      await steps.verifyInputValue('TextInputsPage', 'numberInput', '42');
    });

    await test.step('Fill textarea and verify', async () => {
      await steps.fill('TextInputsPage', 'textareaInput', 'multi-line text');
      await steps.verifyInputValue('TextInputsPage', 'textareaInput', 'multi-line text');
    });

    await test.step('Verify disabled input is disabled', async () => {
      await steps.verifyState('TextInputsPage', 'disabledInput', 'disabled');
    });

    await test.step('Verify values display updates', async () => {
      await steps.verifyText('TextInputsPage', 'valuesDisplay', undefined, { notEmpty: true });
    });

    await test.step('Type sequentially in text input', async () => {
      await steps.fill('TextInputsPage', 'textInput', '');
      await steps.typeSequentially('TextInputsPage', 'textInput', 'typed');
      await steps.verifyInputValue('TextInputsPage', 'textInput', 'typed');
    });

    log('TC_010 Text Inputs Page — passed');
  });
});

test.describe('TC_011: Checkboxes & Toggles Page', () => {

  test('check, uncheck, and toggle interactions', async ({ page, repo, steps }) => {

    await test.step('Navigate to Checkboxes page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'checkboxesLink');
      await steps.verifyUrlContains('/checkboxes');
    });

    await test.step('Check the unchecked checkbox', async () => {
      await steps.check('CheckboxesPage', 'uncheckedCheckbox');
      await steps.verifyState('CheckboxesPage', 'uncheckedCheckbox', 'checked');
    });

    await test.step('Uncheck the checked checkbox', async () => {
      await steps.uncheck('CheckboxesPage', 'checkedCheckbox');
    });

    await test.step('Verify disabled checkbox is disabled', async () => {
      await steps.verifyState('CheckboxesPage', 'disabledCheckbox', 'disabled');
    });

    await test.step('Verify disabled-checked checkbox is both checked and disabled', async () => {
      await steps.verifyState('CheckboxesPage', 'disabledCheckedCheckbox', 'checked');
      await steps.verifyState('CheckboxesPage', 'disabledCheckedCheckbox', 'disabled');
    });

    await test.step('Toggle switches via label click (hidden inputs)', async () => {
      // Toggle inputs are display:none; click the parent <label> instead
      const toggleOffLabel = page.locator(repo.getSelector('CheckboxesPage', 'toggleOff')).locator('..');
      const toggleOnLabel = page.locator(repo.getSelector('CheckboxesPage', 'toggleOn')).locator('..');
      await toggleOffLabel.click();
      await toggleOnLabel.click();
    });

    await test.step('Verify state summary updates', async () => {
      await steps.verifyText('CheckboxesPage', 'stateSummary', undefined, { notEmpty: true });
    });

    log('TC_011 Checkboxes & Toggles — passed');
  });
});

test.describe('TC_012: Sliders Page', () => {

  test('set slider values and verify display', async ({ steps }) => {

    await test.step('Navigate to Sliders page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'slidersLink');
      await steps.verifyUrlContains('/sliders');
    });

    await test.step('Set basic slider to 75 and verify value', async () => {
      await steps.setSliderValue('SlidersPage', 'basicSlider', 75);
      await steps.verifyTextContains('SlidersPage', 'basicSliderValue', '75');
    });

    await test.step('Set stepped slider to 50 and verify value', async () => {
      await steps.setSliderValue('SlidersPage', 'steppedSlider', 50);
      await steps.verifyTextContains('SlidersPage', 'steppedSliderValue', '50');
    });

    await test.step('Verify disabled slider is disabled', async () => {
      await steps.verifyState('SlidersPage', 'disabledSlider', 'disabled');
    });

    await test.step('Verify range slider values display', async () => {
      await steps.verifyText('SlidersPage', 'rangeValue', undefined, { notEmpty: true });
    });

    log('TC_012 Sliders Page — passed');
  });
});

test.describe('TC_013: Drag Progress Page', () => {

  test('drag progress controls and preset buttons', async ({ steps }) => {

    await test.step('Navigate to Drag Progress page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'dragProgressLink');
      await steps.verifyUrlContains('/drag-progress');
    });

    await test.step('Click Set 50% button and verify', async () => {
      await steps.click('DragProgressPage', 'setHalfButton');
      await steps.verifyTextContains('DragProgressPage', 'progressValue', '50');
    });

    await test.step('Click Set 100% button and verify', async () => {
      await steps.click('DragProgressPage', 'setFullButton');
      await steps.verifyTextContains('DragProgressPage', 'progressValue', '100');
    });

    await test.step('Click Reset button and verify', async () => {
      await steps.click('DragProgressPage', 'resetButton');
      await steps.verifyTextContains('DragProgressPage', 'progressValue', '0');
    });

    await test.step('Verify progress track and handle are present', async () => {
      await steps.verifyPresence('DragProgressPage', 'progressTrack');
      await steps.verifyPresence('DragProgressPage', 'progressHandle');
    });

    log('TC_013 Drag Progress Page — passed');
  });
});

// ==========================================
// Phase 3: Forms Category Tests
// ==========================================

test.describe('TC_014: Dropdown Page', () => {

  test('native single select and custom dropdown', async ({ steps }) => {

    await test.step('Navigate to Dropdown page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'dropdownLink');
      await steps.verifyUrlContains('/dropdown');
    });

    await test.step('Select a random option from the single select', async () => {
      const selected = await steps.selectDropdown('DropdownSelectPage', 'singleSelect');
      expect(selected).toBeTruthy();
    });

    await test.step('Verify single select value is displayed', async () => {
      await steps.verifyText('DropdownSelectPage', 'singleValue', undefined, { notEmpty: true });
    });

    await test.step('Select by value from single select', async () => {
      await steps.selectDropdown('DropdownSelectPage', 'singleSelect', {
        type: DropdownSelectType.VALUE,
        value: 'Canada'
      });
      await steps.verifyTextContains('DropdownSelectPage', 'singleValue', 'Canada');
    });

    await test.step('Open custom dropdown and verify list appears', async () => {
      await steps.click('DropdownSelectPage', 'customDropdownButton');
      await steps.verifyPresence('DropdownSelectPage', 'customDropdownList');
    });

    log('TC_014 Dropdown Page — passed');
  });
});

test.describe('TC_015: File Upload Page', () => {

  test('single file upload', async ({ steps }) => {

    await test.step('Navigate to File Upload page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'fileUploadLink');
      await steps.verifyUrlContains('/file-upload');
    });

    await test.step('Upload a single file and verify filename displayed', async () => {
      await steps.uploadFile('FileUploadPage', 'singleFileInput', 'tests/test-files/test-upload.txt');
      await steps.verifyTextContains('FileUploadPage', 'singleFileName', 'test-upload.txt');
    });

    log('TC_015 File Upload Page — passed');
  });
});

test.describe('TC_016: Autocomplete Page', () => {

  test('type to filter and select suggestion', async ({ page, steps }) => {

    await test.step('Navigate to Autocomplete page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'autocompleteLink');
      await steps.verifyUrlContains('/autocomplete');
    });

    await test.step('Type "Uni" to trigger suggestions', async () => {
      await steps.typeSequentially('AutocompletePage', 'searchInput', 'Uni', 50);
    });

    await test.step('Click "United States" suggestion', async () => {
      const suggestion = page.locator('li').filter({ hasText: 'United States' }).first();
      await suggestion.click();
    });

    await test.step('Verify selected value', async () => {
      await steps.verifyTextContains('AutocompletePage', 'selectedValue', 'United States');
    });

    await test.step('Clear and verify reset', async () => {
      await steps.click('AutocompletePage', 'clearButton');
      await steps.verifyInputValue('AutocompletePage', 'searchInput', '');
    });

    log('TC_016 Autocomplete Page — passed');
  });
});

// ==========================================
// Phase 3: Alerts, Frame & Windows Category Tests
// ==========================================

test.describe('TC_017: Alerts Page - Click Types', () => {

  test('click, right-click, and double-click trigger native alerts', async ({ page, steps }) => {

    await test.step('Navigate to Alerts page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'alertsLink');
      await steps.verifyUrlContains('/alerts');
    });

    await test.step('Click Me triggers alert with "Single click!"', async () => {
      let dialogMessage = '';
      page.once('dialog', async (dialog) => {
        dialogMessage = dialog.message();
        await dialog.accept();
      });
      await steps.click('AlertsPage', 'clickMeButton');
      expect(dialogMessage).toBe('Single click!');
    });

    await test.step('Right Click Me triggers alert with "Right click!"', async () => {
      let dialogMessage = '';
      page.once('dialog', async (dialog) => {
        dialogMessage = dialog.message();
        await dialog.accept();
      });
      await steps.rightClick('AlertsPage', 'rightClickButton');
      expect(dialogMessage).toBe('Right click!');
    });

    await test.step('Double Click Me triggers alert with "Double click!"', async () => {
      let dialogMessage = '';
      page.once('dialog', async (dialog) => {
        dialogMessage = dialog.message();
        await dialog.accept();
      });
      await steps.doubleClick('AlertsPage', 'doubleClickButton');
      expect(dialogMessage).toBe('Double click!');
    });

    log('TC_017 Alerts Page Click Types — passed');
  });
});

test.describe('TC_018: Alerts Page - New Tab', () => {

  test('new tab opens and can be closed', async ({ page, steps }) => {

    await test.step('Navigate to Alerts page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'alertsLink');
      await steps.verifyUrlContains('/alerts');
    });

    await test.step('Click New Tab and switch to it', async () => {
      const newPage = await steps.switchToNewTab(async () => {
        await steps.click('AlertsPage', 'newTabButton');
      });
      await steps.verifyTabCount(2);
      await newPage.close();
    });

    await test.step('Verify back to single tab', async () => {
      await steps.verifyTabCount(1);
    });

    log('TC_018 Alerts Page New Tab — passed');
  });
});

test.describe('TC_019: Modal Page', () => {

  test('open modal, confirm, and verify status', async ({ steps }) => {

    await test.step('Navigate to Modal page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'modalLink');
      await steps.verifyUrlContains('/modal');
    });

    await test.step('Open modal and verify overlay appears', async () => {
      await steps.click('ModalPage', 'openButton');
      await steps.verifyPresence('ModalPage', 'overlay');
    });

    await test.step('Click Confirm and verify status', async () => {
      await steps.click('ModalPage', 'confirmButton');
      await steps.verifyAbsence('ModalPage', 'overlay');
      await steps.verifyTextContains('ModalPage', 'status', 'confirmed');
    });

    await test.step('Reopen modal and cancel', async () => {
      await steps.click('ModalPage', 'openButton');
      await steps.verifyPresence('ModalPage', 'overlay');
      await steps.click('ModalPage', 'cancelButton');
      await steps.verifyAbsence('ModalPage', 'overlay');
      await steps.verifyTextContains('ModalPage', 'status', 'cancelled');
    });

    log('TC_019 Modal Page — passed');
  });
});

test.describe('TC_020: Toast Page', () => {

  test('trigger toast notifications', async ({ steps }) => {

    await test.step('Navigate to Toast page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'toastLink');
      await steps.verifyUrlContains('/toast');
    });

    await test.step('Trigger success toast and verify it appears', async () => {
      await steps.click('ToastPage', 'successButton');
      await steps.verifyPresence('ToastPage', 'container');
    });

    await test.step('Trigger error toast', async () => {
      await steps.click('ToastPage', 'errorButton');
    });

    await test.step('Trigger warning toast', async () => {
      await steps.click('ToastPage', 'warningButton');
    });

    log('TC_020 Toast Page — passed');
  });
});

test.describe('TC_021: Tooltip & Popover Page', () => {

  test('hover shows tooltip, click shows popover', async ({ steps }) => {

    await test.step('Navigate to Tooltip page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'tooltipLink');
      await steps.verifyUrlContains('/tooltip');
    });

    await test.step('Hover to show tooltip', async () => {
      await steps.hover('TooltipPage', 'tooltipTrigger1');
      await steps.verifyPresence('TooltipPage', 'tooltipContent1');
    });

    await test.step('Click to show popover', async () => {
      await steps.click('TooltipPage', 'popoverTrigger1');
      await steps.verifyPresence('TooltipPage', 'popoverContent1');
    });

    log('TC_021 Tooltip & Popover Page — passed');
  });
});

test.describe('TC_022: Drawer Page', () => {

  test('open and close drawers', async ({ steps }) => {

    await test.step('Navigate to Drawer page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'drawerLink');
      await steps.verifyUrlContains('/drawer');
    });

    await test.step('Open left drawer and verify status', async () => {
      await steps.click('DrawerPage', 'openLeftButton');
      await steps.verifyTextContains('DrawerPage', 'status', 'left');
    });

    await test.step('Close drawer via close button', async () => {
      await steps.click('DrawerPage', 'closeButton');
      await steps.verifyTextContains('DrawerPage', 'status', 'closed');
    });

    await test.step('Open right drawer and close via overlay click', async () => {
      await steps.click('DrawerPage', 'openRightButton');
      await steps.verifyTextContains('DrawerPage', 'status', 'right');
      await steps.click('DrawerPage', 'overlay');
      await steps.verifyTextContains('DrawerPage', 'status', 'closed');
    });

    log('TC_022 Drawer Page — passed');
  });
});
