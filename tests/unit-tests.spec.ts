import { test, expect } from '@playwright/test';
import { ElementRepository } from 'pw-element-repository';
import { Steps } from '../src/steps/CommonSteps';
import { ElementInteractions } from '../src/interactions/facade/ElementInteractions';
import { DropdownSelectType } from '../src/enum/Options';
import { DateUtilities } from '../src/utils/DateUtilities';
import { ContextStore } from '@civitas-cerebrum/context-store'; 

test.describe('E2E Facade Implementation Suite', () => {

  let repo: ElementRepository;

  test.beforeAll(() => {
    repo = new ElementRepository("tests/data/page-repository.json");
  });


test('TC_001: Complete Form Submission (Core API)', async ({ page }) => {
    const steps = new Steps(page, repo);
    const interactions = new ElementInteractions(page);
    
    // Initialize our new ContextStore
    const context = new ContextStore(); 

    await test.step('🧭 Navigate to the website', async () => {
      await steps.navigateTo('http://127.0.0.1:8080/');
    });

    await test.step('✅ Verify Category Count', async () => {
      await steps.verifyCount('HomePage', 'categories', { exactly: 5 });
    });

    await test.step('✅ Open Forms Page and verify navigation', async () => {
      const formsCategory = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
      await interactions.interact.click(formsCategory!);
      await steps.verifyAbsence('HomePage', 'categories');
    });

    await test.step('✅ Verify Page Title', async () => {
      await steps.verifyUrlContains('/forms');
      await steps.verifyText('FormsPage', 'title', 'Forms Page');
    });

    await test.step('📝 Fill Standard Inputs', async () => {
      // Use the put method to store values
      context.put('Name', 'Automated Tester');
      context.put('Email', 'AutomatedTester@email.com');
      context.put('Mobile', '0000000000');
      context.put('Current Address', 'Prinsenstraat, 1015 DB Amsterdam');

      // Use the get method to retrieve them
      await steps.fill('FormsPage', 'nameInput', context.get('Name'));
      await steps.fill('FormsPage', 'emailInput', context.get('Email'));
      await steps.fill('FormsPage', 'mobileInput', context.get('Mobile'));
      await steps.fill('FormsPage', 'addressInput', context.get('Current Address'));
    });

    await test.step('🎲 Select a Random Enabled Gender', async () => {
      const gender = await steps.selectDropdown('FormsPage', 'genderDropdown', {
        type: DropdownSelectType.RANDOM
      });
      context.put('Gender', gender);
    });

    await test.step('📅 Handle Date Picker and Data Extraction', async () => {
      await steps.click('FormsPage', 'dateOfBirthInput');
      await steps.waitForState('FormsPage', 'todayCell', 'visible');
      await steps.verifyPresence('FormsPage', 'todayCell');
      await steps.click('FormsPage', 'todayCell');

      let dobValue = await steps.getText('FormsPage', 'spSelectionPreview');
      dobValue = DateUtilities.reformatDateString(dobValue!, 'yyyy-M-d');
      
      context.put('Date of Birth', dobValue);

      await steps.verifyPresence('FormsPage', 'datePickerSubmitButton');
      await steps.click('FormsPage', 'datePickerSubmitButton');
      await steps.click('FormsPage', 'hobbiesInput');
    });

    await test.step('🚀 Submit Form and Verify Modal', async () => {
      await steps.click('FormsPage', 'submitButton');
      await steps.verifyPresence('FormsPage', 'table');

      const modal = await repo.get(page, 'FormsPage', 'table');
      const verifyRaw = steps['verify'];

      // Use context.entries() to iterate over the stored key-value pairs!
      for (const [key, expectedValue] of context.entries()) {
        const row = modal.locator('tr').filter({ hasText: key });
        const actualValueElement = row.locator('td').nth(1);

        await verifyRaw.text(actualValueElement, expectedValue);
      }
    });

    console.log('✅ TEST PASSED: TC_001 Complete Form Submission');
});

  test('TC_002: Drag and Drop Interactions', async ({ page }) => {
    const steps = new Steps(page, repo);
    const interactions = new ElementInteractions(page);

    await test.step('🧭 Navigate to Interactions and open Sortable tool', async () => {
      await steps.navigateTo('http://127.0.0.1:8080/');

      const interactionsCategory = await repo.getByText(page, 'HomePage', 'categories', 'Interactions');
      await interactions.interact.click(interactionsCategory!);

      await steps.verifyUrlContains('/interactions');

      const sortableTool = await repo.getByText(page, 'InteractionsPage', 'tools', 'Sortable');
      await interactions.interact.click(sortableTool!);

      await steps.verifyUrlContains('/sortable');
    });

    await test.step('🔄 Drag Item A to the Second List', async () => {
      const dropZone = await repo.getByText(page, 'SortablePage', 'dropZones', 'Second List');

      await steps.dragAndDropListedElement('SortablePage', 'sortableItems', 'Item A', { target: dropZone! });

      await steps['verify'].textContains(dropZone!, 'Item A');
    });

    console.log('✅ TEST PASSED: TC_002 Drag and Drop Interactions');
  });

  test('TC_003: Negative Assertions - Expecting Verifications to Fail', async ({ page }) => {
    const steps = new Steps(page, repo, 2500);
    
    await test.step('🧭 Navigate to the website', async () => {
      await steps.navigateTo('http://127.0.0.1:8080/');
    });

    await test.step('🚫 verifyAbsence on a visible element should throw', async () => {
      let errorCaught = false;
      try {
        await steps.verifyAbsence('HomePage', 'categories');
      } catch (error) {
        errorCaught = true;
        console.log('✅ Caught expected error: verifyAbsence failed correctly.');
      }
      expect(errorCaught).toBeTruthy();
    });

    await test.step('🚫 verifyCount with an incorrect number should throw', async () => {
      let errorCaught = false;
      try {
        await steps.verifyCount('HomePage', 'categories', { exactly: 99 });
      } catch (error) {
        errorCaught = true;
        console.log('✅ Caught expected error: verifyCount failed correctly.');
      }
      expect(errorCaught).toBeTruthy();
    });
    
    console.log('✅ TEST PASSED: TC_003 Negative Assertions');
  });

  test('TC_004: Negative State Validations - Missing Elements & Text Mismatches', async ({ page }) => {
    const steps = new Steps(page, repo, 2500);
    const interactions = new ElementInteractions(page);

    await test.step('🧭 Navigate to Forms Page', async () => {
      await steps.navigateTo('http://127.0.0.1:8080/');
      const formsCategory = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
      await interactions.interact.click(formsCategory!);
    });

    await test.step('🚫 verifyPresence on a missing element should throw', async () => {
      let errorCaught = false;
      try {
        // The results 'table' only appears AFTER submission. Asserting presence now should fail.
        await steps.verifyPresence('FormsPage', 'table');
      } catch (error) {
        errorCaught = true;
        console.log('✅ Caught expected error: verifyPresence failed correctly.');
      }
      expect(errorCaught).toBeTruthy();
    });

    await test.step('🚫 verifyText with wrong string should throw', async () => {
      let errorCaught = false;
      try {
        // Actual text is 'Forms Page'
        await steps.verifyText('FormsPage', 'title', 'Completely Wrong Title');
      } catch (error) {
        errorCaught = true;
        console.log('✅ Caught expected error: verifyText failed correctly.');
      }
      expect(errorCaught).toBeTruthy();
    });

    console.log('✅ TEST PASSED: TC_004 Negative State Validations');
  });

  test('TC_005: Wait For State - Warning behavior on incorrect state', async ({ page }) => {
    const steps = new Steps(page, repo);
    
    await test.step('🧭 Navigate to the website', async () => {
      await steps.navigateTo('http://127.0.0.1:8080/');
    });

    await test.step('⚠️ waitForState should swallow the error and log a warning', async () => {
      let errorCaught = false;
      
      // Note: Because of our Utils update, this will wait the full default timeout 
      // before proceeding. You may want to lower the timeout dynamically if your API allows it.
      console.log('⏳ Intentionally waiting for a timeout to trigger the warning mechanism...');
      try {
        // 'categories' are visible. Waiting for 'hidden' will time out.
        await steps.waitForState('HomePage', 'categories', 'hidden');
      } catch (error) {
        errorCaught = true;
      }
      
      // We expect NO error to be caught because the Utils class swallows it.
      expect(errorCaught).toBeFalsy();
      console.log('✅ waitForState safely swallowed the timeout error and proceeded.');
    });

    console.log('✅ TEST PASSED: TC_005 Wait For State Warning Behavior');
  });

});