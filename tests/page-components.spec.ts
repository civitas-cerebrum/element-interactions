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
      await steps.click( 'buttonsLink','SidebarNav');
      await steps.verifyUrlContains('/buttons');
    });

    await test.step('Click Primary button and verify result', async () => {
      await steps.click( 'primaryButton','ButtonsPage');
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
    });

    await test.step('Click Secondary button and verify result', async () => {
      await steps.click( 'secondaryButton','ButtonsPage');
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Secondary');
    });

    await test.step('Click Danger button and verify result', async () => {
      await steps.click( 'dangerButton','ButtonsPage');
      await steps.verifyTextContains( 'resultText','ButtonsPage', 'Danger');
    });

    await test.step('Verify disabled button is disabled', async () => {
      await steps.verifyState( 'disabledButton','ButtonsPage', 'disabled');
    });

    await test.step('Verify loading button is disabled', async () => {
      await steps.verifyState( 'loadingButton','ButtonsPage', 'disabled');
    });

    await test.step('Verify size variants are visible', async () => {
      await steps.verifyPresence( 'smallButton','ButtonsPage');
      await steps.verifyPresence( 'mediumButton','ButtonsPage');
      await steps.verifyPresence( 'largeButton','ButtonsPage');
    });

    log('TC_009 Buttons Page — passed');
  });
});

test.describe('TC_010: Text Inputs Page', () => {

  test('fill inputs and verify values display', async ({ steps }) => {

    await test.step('Navigate to Text Inputs page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'textInputsLink','SidebarNav');
      await steps.verifyUrlContains('/text-inputs');
    });

    await test.step('Fill text input and verify', async () => {
      await steps.fill( 'textInput','TextInputsPage', 'hello world');
      await steps.verifyInputValue( 'textInput','TextInputsPage', 'hello world');
    });

    await test.step('Fill email input and verify', async () => {
      await steps.fill( 'emailInput','TextInputsPage', 'test@example.com');
      await steps.verifyInputValue( 'emailInput','TextInputsPage', 'test@example.com');
    });

    await test.step('Fill number input and verify', async () => {
      await steps.fill( 'numberInput','TextInputsPage', '42');
      await steps.verifyInputValue( 'numberInput','TextInputsPage', '42');
    });

    await test.step('Fill textarea and verify', async () => {
      await steps.fill( 'textareaInput','TextInputsPage', 'multi-line text');
      await steps.verifyInputValue( 'textareaInput','TextInputsPage', 'multi-line text');
    });

    await test.step('Verify disabled input is disabled', async () => {
      await steps.verifyState( 'disabledInput','TextInputsPage', 'disabled');
    });

    await test.step('Verify values display updates', async () => {
      await steps.verifyText( 'valuesDisplay','TextInputsPage', undefined, { notEmpty: true });
    });

    await test.step('Type sequentially in text input', async () => {
      await steps.fill( 'textInput','TextInputsPage', '');
      await steps.typeSequentially( 'textInput','TextInputsPage', 'typed');
      await steps.verifyInputValue( 'textInput','TextInputsPage', 'typed');
    });

    log('TC_010 Text Inputs Page — passed');
  });
});

test.describe('TC_011: Checkboxes & Toggles Page', () => {

  test('check, uncheck, and toggle interactions', async ({ page, repo, steps }) => {

    await test.step('Navigate to Checkboxes page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'checkboxesLink','SidebarNav');
      await steps.verifyUrlContains('/checkboxes');
    });

    await test.step('Check the unchecked checkbox', async () => {
      await steps.check( 'uncheckedCheckbox','CheckboxesPage');
      await steps.verifyState( 'uncheckedCheckbox','CheckboxesPage', 'checked');
    });

    await test.step('Uncheck the checked checkbox', async () => {
      await steps.uncheck( 'checkedCheckbox','CheckboxesPage');
    });

    await test.step('Verify disabled checkbox is disabled', async () => {
      await steps.verifyState( 'disabledCheckbox','CheckboxesPage', 'disabled');
    });

    await test.step('Verify disabled-checked checkbox is both checked and disabled', async () => {
      await steps.verifyState( 'disabledCheckedCheckbox','CheckboxesPage', 'checked');
      await steps.verifyState( 'disabledCheckedCheckbox','CheckboxesPage', 'disabled');
    });

    await test.step('Toggle switches via label click (hidden inputs)', async () => {
      // Toggle inputs are display:none; click the parent <label> instead
      const toggleOffLabel = page.locator(repo.getSelector('toggleOff', 'CheckboxesPage')).locator('..');
      const toggleOnLabel = page.locator(repo.getSelector('toggleOn', 'CheckboxesPage')).locator('..');
      await toggleOffLabel.click();
      await toggleOnLabel.click();
    });

    await test.step('Verify state summary updates', async () => {
      await steps.verifyText( 'stateSummary','CheckboxesPage', undefined, { notEmpty: true });
    });

    log('TC_011 Checkboxes & Toggles — passed');
  });
});

test.describe('TC_012: Sliders Page', () => {

  test('set slider values and verify display', async ({ steps }) => {

    await test.step('Navigate to Sliders page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'slidersLink','SidebarNav');
      await steps.verifyUrlContains('/sliders');
    });

    await test.step('Set basic slider to 75 and verify value', async () => {
      await steps.setSliderValue( 'basicSlider','SlidersPage', 75);
      await steps.verifyTextContains( 'basicSliderValue','SlidersPage', '75');
    });

    await test.step('Set stepped slider to 50 and verify value', async () => {
      await steps.setSliderValue( 'steppedSlider','SlidersPage', 50);
      await steps.verifyTextContains( 'steppedSliderValue','SlidersPage', '50');
    });

    await test.step('Verify disabled slider is disabled', async () => {
      await steps.verifyState( 'disabledSlider','SlidersPage', 'disabled');
    });

    await test.step('Verify range slider values display', async () => {
      await steps.verifyText( 'rangeValue','SlidersPage', undefined, { notEmpty: true });
    });

    log('TC_012 Sliders Page — passed');
  });
});

test.describe('TC_013: Drag Progress Page', () => {

  test('drag progress controls and preset buttons', async ({ steps }) => {

    await test.step('Navigate to Drag Progress page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'dragProgressLink','SidebarNav');
      await steps.verifyUrlContains('/drag-progress');
    });

    await test.step('Click Set 50% button and verify', async () => {
      await steps.click( 'setHalfButton','DragProgressPage');
      await steps.verifyTextContains( 'progressValue','DragProgressPage', '50');
    });

    await test.step('Click Set 100% button and verify', async () => {
      await steps.click( 'setFullButton','DragProgressPage');
      await steps.verifyTextContains( 'progressValue','DragProgressPage', '100');
    });

    await test.step('Click Reset button and verify', async () => {
      await steps.click( 'resetButton','DragProgressPage');
      await steps.verifyTextContains( 'progressValue','DragProgressPage', '0');
    });

    await test.step('Verify progress track and handle are present', async () => {
      await steps.verifyPresence( 'progressTrack','DragProgressPage');
      await steps.verifyPresence( 'progressHandle','DragProgressPage');
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
      await steps.click( 'dropdownLink','SidebarNav');
      await steps.verifyUrlContains('/dropdown');
    });

    await test.step('Select a random option from the single select', async () => {
      const selected = await steps.selectDropdown( 'singleSelect','DropdownSelectPage');
      expect(selected).toBeTruthy();
    });

    await test.step('Verify single select value is displayed', async () => {
      await steps.verifyText( 'singleValue','DropdownSelectPage', undefined, { notEmpty: true });
    });

    await test.step('Select by value from single select', async () => {
      await steps.selectDropdown( 'singleSelect','DropdownSelectPage', {
        type: DropdownSelectType.VALUE,
        value: 'Canada'
      });
      await steps.verifyTextContains( 'singleValue','DropdownSelectPage', 'Canada');
    });

    await test.step('Open custom dropdown and verify list appears', async () => {
      await steps.click( 'customDropdownButton','DropdownSelectPage');
      await steps.verifyPresence( 'customDropdownList','DropdownSelectPage');
    });

    log('TC_014 Dropdown Page — passed');
  });
});

test.describe('TC_015: File Upload Page', () => {

  test('single file upload', async ({ steps }) => {

    await test.step('Navigate to File Upload page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'fileUploadLink','SidebarNav');
      await steps.verifyUrlContains('/file-upload');
    });

    await test.step('Upload a single file and verify filename displayed', async () => {
      await steps.uploadFile( 'singleFileInput','FileUploadPage', 'tests/test-files/test-upload.txt');
      await steps.verifyTextContains( 'singleFileName','FileUploadPage', 'test-upload.txt');
    });

    log('TC_015 File Upload Page — passed');
  });
});

test.describe('TC_016: Autocomplete Page', () => {

  test('type to filter and select suggestion', async ({ page, steps }) => {

    await test.step('Navigate to Autocomplete page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'autocompleteLink','SidebarNav');
      await steps.verifyUrlContains('/autocomplete');
    });

    await test.step('Type "Uni" to trigger suggestions', async () => {
      await steps.typeSequentially( 'searchInput','AutocompletePage', 'Uni', 50);
    });

    await test.step('Click "United States" suggestion', async () => {
      const suggestion = page.locator('li').filter({ hasText: 'United States' }).first();
      await suggestion.click();
    });

    await test.step('Verify selected value', async () => {
      await steps.verifyTextContains( 'selectedValue','AutocompletePage', 'United States');
    });

    await test.step('Clear and verify reset', async () => {
      await steps.click( 'clearButton','AutocompletePage');
      await steps.verifyInputValue( 'searchInput','AutocompletePage', '');
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
      await steps.click( 'alertsLink','SidebarNav');
      await steps.verifyUrlContains('/alerts');
    });

    await test.step('Click Me triggers alert with "Single click!"', async () => {
      let dialogMessage = '';
      page.once('dialog', async (dialog) => {
        dialogMessage = dialog.message();
        await dialog.accept();
      });
      await steps.click( 'clickMeButton','AlertsPage');
      expect(dialogMessage).toBe('Single click!');
    });

    await test.step('Right Click Me triggers alert with "Right click!"', async () => {
      let dialogMessage = '';
      page.once('dialog', async (dialog) => {
        dialogMessage = dialog.message();
        await dialog.accept();
      });
      await steps.rightClick( 'rightClickButton','AlertsPage');
      expect(dialogMessage).toBe('Right click!');
    });

    await test.step('Double Click Me triggers alert with "Double click!"', async () => {
      let dialogMessage = '';
      page.once('dialog', async (dialog) => {
        dialogMessage = dialog.message();
        await dialog.accept();
      });
      await steps.doubleClick( 'doubleClickButton','AlertsPage');
      expect(dialogMessage).toBe('Double click!');
    });

    log('TC_017 Alerts Page Click Types — passed');
  });
});

test.describe('TC_018: Alerts Page - New Tab', () => {

  test('new tab opens and can be closed', async ({ page, steps }) => {

    await test.step('Navigate to Alerts page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'alertsLink','SidebarNav');
      await steps.verifyUrlContains('/alerts');
    });

    await test.step('Click New Tab and switch to it', async () => {
      const newPage = await steps.switchToNewTab(async () => {
        await steps.click( 'newTabButton','AlertsPage');
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
      await steps.click( 'modalLink','SidebarNav');
      await steps.verifyUrlContains('/modal');
    });

    await test.step('Open modal and verify overlay appears', async () => {
      await steps.click( 'openButton','ModalPage');
      await steps.verifyPresence( 'overlay','ModalPage');
    });

    await test.step('Click Confirm and verify status', async () => {
      await steps.click( 'confirmButton','ModalPage');
      await steps.verifyAbsence( 'overlay','ModalPage');
      await steps.verifyTextContains( 'status','ModalPage', 'confirmed');
    });

    await test.step('Reopen modal and cancel', async () => {
      await steps.click( 'openButton','ModalPage');
      await steps.verifyPresence( 'overlay','ModalPage');
      await steps.click( 'cancelButton','ModalPage');
      await steps.verifyAbsence( 'overlay','ModalPage');
      await steps.verifyTextContains( 'status','ModalPage', 'cancelled');
    });

    log('TC_019 Modal Page — passed');
  });
});

test.describe('TC_020: Toast Page', () => {

  test('trigger toast notifications', async ({ steps }) => {

    await test.step('Navigate to Toast page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'toastLink','SidebarNav');
      await steps.verifyUrlContains('/toast');
    });

    await test.step('Trigger success toast and verify it appears', async () => {
      await steps.click( 'successButton','ToastPage');
      await steps.verifyPresence( 'container','ToastPage');
    });

    await test.step('Trigger error toast', async () => {
      await steps.click( 'errorButton','ToastPage');
    });

    await test.step('Trigger warning toast', async () => {
      await steps.click( 'warningButton','ToastPage');
    });

    log('TC_020 Toast Page — passed');
  });
});

test.describe('TC_021: Tooltip & Popover Page', () => {

  test('hover shows tooltip, click shows popover', async ({ steps }) => {

    await test.step('Navigate to Tooltip page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tooltipLink','SidebarNav');
      await steps.verifyUrlContains('/tooltip');
    });

    await test.step('Hover to show tooltip', async () => {
      await steps.hover( 'tooltipTrigger1','TooltipPage');
      await steps.verifyPresence( 'tooltipContent1','TooltipPage');
    });

    await test.step('Click to show popover', async () => {
      await steps.click( 'popoverTrigger1','TooltipPage');
      await steps.verifyPresence( 'popoverContent1','TooltipPage');
    });

    log('TC_021 Tooltip & Popover Page — passed');
  });
});

test.describe('TC_022: Drawer Page', () => {

  test('open and close drawers', async ({ steps }) => {

    await test.step('Navigate to Drawer page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'drawerLink','SidebarNav');
      await steps.verifyUrlContains('/drawer');
    });

    await test.step('Open left drawer and verify status', async () => {
      await steps.click( 'openLeftButton','DrawerPage');
      await steps.verifyTextContains( 'status','DrawerPage', 'left');
    });

    await test.step('Close drawer via close button', async () => {
      await steps.click( 'closeButton','DrawerPage');
      await steps.verifyTextContains( 'status','DrawerPage', 'closed');
    });

    await test.step('Open right drawer and close via overlay click', async () => {
      await steps.click( 'openRightButton','DrawerPage');
      await steps.verifyTextContains( 'status','DrawerPage', 'right');
      await steps.click( 'overlay','DrawerPage');
      await steps.verifyTextContains( 'status','DrawerPage', 'closed');
    });

    log('TC_022 Drawer Page — passed');
  });
});
