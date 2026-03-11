import { test } from '@playwright/test';
import { DateUtilities } from '../src/utils/DateUtilities';
import { ElementInteractions } from '../src/ElementInteractions';
import { ElementRepository } from 'pw-element-repository';

test.describe('E2E Form Submission Suite', () => {

  let repo: ElementRepository;

  test.beforeAll(() => {
    // Initialize the repository once per worker to save JSON read operations
    repo = new ElementRepository("tests/data/page-repository.json");
  });

  test('TC_001: Complete Form Submission from Scratch', async ({ page }) => {
    // Initialize the Interactions Facade for this specific page context
    const steps = new ElementInteractions(page);
    
    // 💡 Dictionary to track our expected values for the final modal verification
    const entries: Record<string, string> = {};

    await test.step('🧭 Navigate to the website and open Forms', async () => {
      await steps.navigate.toUrl('http://127.0.0.1:8080/');

      const formsCategory = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
      await steps.interactions.click(formsCategory!);
    });

    await test.step('✅ Verify Page Title', async () => {
      const title = await repo.get(page, 'FormsPage', 'title');
      await steps.verify.text(title, 'Forms Page');
    });

    await test.step('📝 Fill Standard Inputs', async () => {
      const nameInput = await repo.get(page, 'FormsPage', 'nameInput');
      const emailInput = await repo.get(page, 'FormsPage', 'emailInput');
      const mobileInput = await repo.get(page, 'FormsPage', 'mobileInput');
      const addressInput = await repo.get(page, 'FormsPage', 'addressInput');

      // Store expected values
      entries['Name'] = 'Automated Tester';
      entries['Email'] = 'AutomatedTester@email.com';
      entries['Mobile'] = '0000000000';
      entries['Current Address'] = 'Prinsenstraat, 1015 DB Amsterdam';

      await steps.interactions.fill(nameInput, entries['Name']);
      await steps.interactions.fill(emailInput, entries['Email']);
      await steps.interactions.fill(mobileInput, entries['Mobile']);
      await steps.interactions.fill(addressInput, entries['Current Address']);
    });

    await test.step('🎲 Select a Random Enabled Gender', async () => {
      const genderDropdown = await repo.get(page, 'FormsPage', 'genderDropdown');

      const selectedGender = await steps.interactions.selectDropdown(genderDropdown);
      entries['Gender'] = selectedGender; // Store the randomly selected value
    });

    await test.step('📅 Handle Date Picker and Hobbies', async () => {
      const dobInput = await repo.get(page, 'FormsPage', 'dateOfBirthInput');
      await steps.interactions.click(dobInput);

      const todayCell = await repo.get(page, 'FormsPage', 'todayCell');
      await steps.verify.presence(todayCell);
      await steps.interactions.click(todayCell);

      // Store the date value directly from the input for verification
      var dobValue = await repo.get(page, 'FormsPage', 'spSelectionPreview').then(input => input.textContent());
      dobValue = DateUtilities.reformatDateString(dobValue!.trim(), 'yyyy-M-d');
      entries['Date of Birth'] = dobValue; 

      const dobSubmit = await repo.get(page, 'FormsPage', 'datePickerSubmitButton');
      await steps.verify.presence(dobSubmit);
      await steps.interactions.click(dobSubmit);

      const hobbiesInput = await repo.get(page, 'FormsPage', 'hobbiesInput');
      await steps.interactions.clickWithoutScrolling(hobbiesInput);
    });

    await test.step('🚀 Submit Form and Verify Modal', async () => {
      const submitButton = await repo.get(page, 'FormsPage', 'submitButton');
      await steps.interactions.click(submitButton);

      const modal = await repo.get(page, 'FormsPage', 'table');
      await steps.verify.presence(modal);

      for (const [key, expectedValue] of Object.entries(entries)) {
        const row = modal.locator('tr').filter({ hasText: key });
        const actualValueElement = row.locator('td').nth(1);   

        await steps.verify.text(actualValueElement, expectedValue);
      }
    });

    console.log('✅ TEST PASSED: TC_001 Complete Form Submission');
  });

});