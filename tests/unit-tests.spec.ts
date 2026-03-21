import { test, expect } from './fixture/StepFixture';
import { ElementRepository } from 'pw-element-repository';
import { Steps } from '../src/steps/CommonSteps';
import { DropdownSelectType } from '../src/enum/Options';
import { DateUtilities } from '../src/utils/DateUtilities';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

test.describe('E2E Facade Implementation Suite', () => {

  let repo: ElementRepository;

  test.beforeAll(() => {
    repo = new ElementRepository("tests/data/page-repository.json");
  });

  test('TC_001: Complete Form Submission (Core API)', async ({ page, repo, steps, interactions, contextStore }) => {

    await test.step('Navigate to the website', async () => {
      await steps.navigateTo('http://127.0.0.1:8080/');
    });

    await test.step('Verify Category Count', async () => {
      await steps.verifyCount('HomePage', 'categories', { exactly: 5 });
    });

    await test.step('Open Forms Page and verify navigation', async () => {
      const formsCategory = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
      await interactions.interact.click(formsCategory!);
      await steps.verifyAbsence('HomePage', 'categories');
    });

    await test.step('Verify Page Title', async () => {
      await steps.verifyUrlContains('/forms');
      await steps.verifyText('FormsPage', 'title', 'Forms Page');
    });

    await test.step('Fill Standard Inputs', async () => {
      contextStore.put('Name', 'Automated Tester');
      contextStore.put('Email', 'AutomatedTester@email.com');
      contextStore.put('Mobile', '0000000000');
      contextStore.put('Current Address', 'Prinsenstraat, 1015 DB Amsterdam');

      await steps.fill('FormsPage', 'nameInput', contextStore.get('Name'));
      await steps.fill('FormsPage', 'emailInput', contextStore.get('Email'));
      await steps.fill('FormsPage', 'mobileInput', contextStore.get('Mobile'));
      await steps.fill('FormsPage', 'addressInput', contextStore.get('Current Address'));
    });

    await test.step('Select a Random Enabled Gender', async () => {
      const gender = await steps.selectDropdown('FormsPage', 'genderDropdown', {
        type: DropdownSelectType.RANDOM
      });
      contextStore.put('Gender', gender);
    });

    await test.step('Handle Date Picker and Data Extraction', async () => {
      await steps.click('FormsPage', 'dateOfBirthInput');
      await steps.waitForState('FormsPage', 'todayCell', 'visible');
      await steps.verifyPresence('FormsPage', 'todayCell');
      await steps.click('FormsPage', 'todayCell');

      let dobValue = await steps.getText('FormsPage', 'spSelectionPreview');
      dobValue = DateUtilities.reformatDateString(dobValue!, 'yyyy-M-d');

      contextStore.put('Date of Birth', dobValue);

      await steps.verifyPresence('FormsPage', 'datePickerSubmitButton');
      await steps.click('FormsPage', 'datePickerSubmitButton');
      await steps.click('FormsPage', 'hobbiesInput');
    });

    await test.step('Submit Form and Verify Modal', async () => {
      await steps.click('FormsPage', 'submitButton');
      await steps.verifyPresence('FormsPage', 'table');

      const modal = await repo.get(page, 'FormsPage', 'table');
      const verifyRaw = steps['verify'];

      for (const [key, expectedValue] of contextStore.entries()) {
        const row = modal.locator('tr').filter({ hasText: key });
        const actualValueElement = row.locator('td').nth(1);

        await verifyRaw.text(actualValueElement, expectedValue);
      }
    });

    log('TC_001 Complete Form Submission — passed');
  });

  test('TC_002: Drag and Drop Interactions', async ({ page, steps, interactions }) => {

    await test.step('Navigate to Interactions and open Sortable tool', async () => {
      await steps.navigateTo('http://127.0.0.1:8080/');

      const interactionsCategory = await repo.getByText(page, 'HomePage', 'categories', 'Interactions');
      await interactions.interact.click(interactionsCategory!);

      await steps.verifyUrlContains('/interactions');

      const sortableTool = await repo.getByText(page, 'InteractionsPage', 'tools', 'Sortable');
      await interactions.interact.click(sortableTool!);

      await steps.verifyUrlContains('/sortable');
    });

    await test.step('Drag Item A to the Second List', async () => {
      const dropZone = await repo.getByText(page, 'SortablePage', 'dropZones', 'Second List');

      await steps.dragAndDropListedElement('SortablePage', 'sortableItems', 'Item A', { target: dropZone! });

      await steps['verify'].textContains(dropZone!, 'Item A');
    });

    log('TC_002 Drag and Drop Interactions — passed');
  });

  test('TC_003: Negative Assertions - Expecting Verifications to Fail', async ({ page }) => {
    const steps = new Steps(page, repo, 2500);

    await test.step('Navigate to the website', async () => {
      await steps.navigateTo('http://127.0.0.1:8080/');
    });

    await test.step('verifyAbsence on a visible element should throw', async () => {
      let errorCaught = false;
      try {
        await steps.verifyAbsence('HomePage', 'categories');
      } catch (error) {
        errorCaught = true;
        log('Caught expected error: verifyAbsence failed correctly');
      }
      expect(errorCaught).toBeTruthy();
    });

    await test.step('verifyCount with an incorrect number should throw', async () => {
      let errorCaught = false;
      try {
        await steps.verifyCount('HomePage', 'categories', { exactly: 99 });
      } catch (error) {
        errorCaught = true;
        log('Caught expected error: verifyCount failed correctly');
      }
      expect(errorCaught).toBeTruthy();
    });

    log('TC_003 Negative Assertions — passed');
  });

  test('TC_004: Wait For State - Warning behavior on incorrect state', async ({ page }) => {
    const steps = new Steps(page, repo, 2500);

    await test.step('Navigate to the website', async () => {
      await steps.navigateTo('http://127.0.0.1:8080/');
    });

    await test.step('waitForState should swallow the error and log a warning', async () => {
      let errorCaught = false;

      log('Intentionally waiting for a timeout to trigger the warning mechanism...');
      try {
        await steps.waitForState('HomePage', 'categories', 'hidden');
      } catch (error) {
        errorCaught = true;
      }

      expect(errorCaught).toBeFalsy();
      log('waitForState safely swallowed the timeout error and proceeded');
    });

    log('TC_004 Wait For State Warning Behavior — passed');
  });

});