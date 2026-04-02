import { test, expect } from './fixture/StepFixture';
import { Steps } from '../src/steps/CommonSteps';
import { DropdownSelectType } from '../src/enum/Options';
import { WebElement } from '@civitas-cerebrum/element-repository';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

test.describe('E2E Facade Implementation Suite', () => {

  test('TC_001: Complete Form Submission (Core API)', async ({ page, repo, steps, interactions, contextStore }) => {

    await test.step('Navigate to the website', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Verify Category Count', async () => {
      await steps.verifyCount('HomePage', 'categories', { exactly: 8 });
    });

    await test.step('Open Forms Page and verify navigation', async () => {
      await steps.click('HomePage', 'formsCard');
      await steps.verifyAbsence('HomePage', 'categories');
    });

    await test.step('Verify Page Title', async () => {
      await steps.verifyUrlContains('/forms');
      await steps.verifyText('FormsPage', 'title', 'Submission Form');
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

      await steps.verifyPresence('FormsPage', 'datePickerSubmitButton');
      await steps.click('FormsPage', 'datePickerSubmitButton');

      const now = new Date();
      const dobValue = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      contextStore.put('Date of Birth', dobValue);

      await steps.click('FormsPage', 'hobbiesInput');
    });

    await test.step('Submit Form and Verify Modal via verifyListedElement', async () => {
      await steps.click('FormsPage', 'submitButton');
      await steps.verifyPresence('FormsPage', 'table');

      for (const [key, expectedValue] of contextStore.entries()) {
        await steps.verifyListedElement('FormsPage', 'submissionRows', {
          text: key,
          child: { pageName: 'FormsPage', elementName: 'submissionValue' },
          expectedText: expectedValue
        });
      }
    });

    log('TC_001 Complete Form Submission — passed');
  });

  test('TC_002: Drag and Drop Interactions', async ({ page, steps, repo, interactions }) => {

    await test.step('Navigate to Sortable page via homepage', async () => {
      await steps.navigateTo('/');
      await steps.click('HomePage', 'interactionsCard');
      await steps.verifyUrlContains('/sortable');
    });

    await test.step('Drag Item A to the Second List', async () => {
      const dropZone = await repo.getByText(page, 'SortablePage', 'dropZones', 'Second List');

      await steps.dragAndDropListedElement('SortablePage', 'sortableItems', 'Item A', { target: dropZone! });

      await interactions.verify.textContains((dropZone as WebElement).locator, 'Item A');
    });

    log('TC_002 Drag and Drop Interactions — passed');
  });

  test('TC_003: Negative Assertions - Expecting Verifications to Fail', async ({ page, repo }) => {

    const steps = new Steps(page, repo, { timeout: 1000 }); // Shorten timeout for negative assertions

    await test.step('Navigate to the website', async () => {
      await steps.navigateTo('/');
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

  test('TC_004: Wait For State - Warning behavior on incorrect state', async ({ page, repo }) => {
    const steps = new Steps(page, repo, { timeout: 500 });

    await test.step('Navigate to the website', async () => {
      await steps.navigateTo('/');
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

  test('TC_005: Click Random - Category Navigation', async ({ steps }) => {

    await test.step('Navigate to the website', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Click a random category and verify navigation', async () => {
      await steps.clickRandom('HomePage', 'categories');
      await steps.verifyAbsence('HomePage', 'categories');
    });

    log('TC_005 Click Random — passed');
  });

  test('TC_006: Verify Count - greaterThan and lessThan', async ({ page, repo }) => {
    const steps = new Steps(page, repo, { timeout: 3000 });

    await test.step('Navigate to the website', async () => {
      await steps.navigateTo('/');
    });

    await test.step('verifyCount with greaterThan (positive)', async () => {
      await steps.verifyCount('HomePage', 'categories', { greaterThan: 3 });
    });

    await test.step('verifyCount with lessThan (positive)', async () => {
      await steps.verifyCount('HomePage', 'categories', { lessThan: 10 });
    });

    await test.step('verifyCount with greaterThan polls until timeout (negative)', async () => {
      const start = Date.now();
      let errorCaught = false;
      try {
        await steps.verifyCount('HomePage', 'categories', { greaterThan: 8 });
      } catch {
        errorCaught = true;
      }
      const elapsed = Date.now() - start;
      expect(errorCaught).toBeTruthy();
      expect(elapsed).toBeGreaterThan(2500);
      log('greaterThan polling confirmed: timed out after %dms', elapsed);
    });

    log('TC_006 Verify Count greaterThan/lessThan — passed');
  });

});
