import { test } from '@playwright/test';
import { ElementRepository } from 'pw-element-repository';
import { Steps } from '../src/steps/CommonSteps';
import { ElementInteractions } from '../src/interactions/facade/ElementInteractions';
import { DropdownSelectType } from '../src/enum/Options';
import { DateUtilities } from '../src/utils/DateUtilities';

test.describe('E2E Facade Implementation Suite', () => {

  let repo: ElementRepository;

  test.beforeAll(() => {
    repo = new ElementRepository("tests/data/page-repository.json");
  });

  test('TC_001: Complete Form Submission (Core API)', async ({ page }) => {
    const steps = new Steps(page, repo);
    const interactions = new ElementInteractions(page);
    const entries: Record<string, string> = {}; //TODO create a node package for streamlining contextual data storage in tests like this instead of using a plain object

    await test.step('🧭 Navigate to the website', async () => {
      await steps.navigateTo('http://127.0.0.1:8080/');
    });

    await test.step('✅ Verify Category Count', async () => {
      await steps.verifyCount('HomePage', 'categories', { exactly: 5 });
    });

    await test.step('✅ Open Forms Page and verify navigation', async () => {
      // Using repo directly here because getByText is a specialized repository method
      const formsCategory = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
      await interactions.interact.click(formsCategory!);
      await steps.verifyAbsence('HomePage', 'categories');
    });

    await test.step('✅ Verify Page Title', async () => {
      await steps.verifyText('FormsPage', 'title', 'Forms Page');
    });

    await test.step('📝 Fill Standard Inputs', async () => {
      entries['Name'] = 'Automated Tester';
      entries['Email'] = 'AutomatedTester@email.com';
      entries['Mobile'] = '0000000000';
      entries['Current Address'] = 'Prinsenstraat, 1015 DB Amsterdam';

      await steps.fill('FormsPage', 'nameInput', entries['Name']);
      await steps.fill('FormsPage', 'emailInput', entries['Email']);
      await steps.fill('FormsPage', 'mobileInput', entries['Mobile']);
      await steps.fill('FormsPage', 'addressInput', entries['Current Address']);
    });

    await test.step('🎲 Select a Random Enabled Gender', async () => {
      entries['Gender'] = await steps.selectDropdown('FormsPage', 'genderDropdown', {
        type: DropdownSelectType.RANDOM
      });
    });

    await test.step('📅 Handle Date Picker and Data Extraction', async () => {
      await steps.click('FormsPage', 'dateOfBirthInput');

      await steps.waitForState('FormsPage', 'todayCell', 'visible');
      await steps.verifyPresence('FormsPage', 'todayCell');
      await steps.click('FormsPage', 'todayCell');

      let dobValue = await steps.getText('FormsPage', 'spSelectionPreview');

      dobValue = DateUtilities.reformatDateString(dobValue!, 'yyyy-M-d');
      entries['Date of Birth'] = dobValue;

      await steps.verifyPresence('FormsPage', 'datePickerSubmitButton');
      await steps.click('FormsPage', 'datePickerSubmitButton');

      await steps.click('FormsPage', 'hobbiesInput');
    });

    await test.step('🚀 Submit Form and Verify Modal', async () => {
      await steps.click('FormsPage', 'submitButton');
      await steps.verifyPresence('FormsPage', 'table');

      const modal = await repo.get(page, 'FormsPage', 'table');
      const verifyRaw = steps['verify'];

      for (const [key, expectedValue] of Object.entries(entries)) {
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

      const sortableTool = await repo.getByText(page, 'InteractionsPage', 'tools', 'Sortable');
      await interactions.interact.click(sortableTool!);
    });

    await test.step('🔄 Drag Item A to the Second List', async () => {
      const dropZone = await repo.getByText(page, 'SortablePage', 'dropZones', 'Second List');

      await steps.dragAndDropListedElement('SortablePage', 'sortableItems', 'Item A', { target: dropZone! });

      await steps['verify'].textContains(dropZone!, 'Item A');
    });

    console.log('✅ TEST PASSED: TC_002 Drag and Drop Interactions');
  });

});