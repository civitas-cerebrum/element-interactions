import { test } from '@playwright/test';
import { DateUtilities } from '../src/utils/DateUtilities';
import { ElementRepository } from 'pw-element-repository';
import { Steps } from '../src/steps/CommonSteps'; // Updated import

test.describe('E2E Form Submission Suite', () => {

  let repo: ElementRepository;

  test.beforeAll(() => {
    // Initialize the repository once per worker to save JSON read operations
    repo = new ElementRepository("tests/data/page-repository.json");
  });

  test('TC_001: Complete Form Submission', async ({ page }) => {
    // Initialize the unified Steps Facade
    const steps = new Steps(page, repo);
    
    // 💡 Dictionary to track our expected values for the final modal verification
    const entries: Record<string, string> = {};

    await test.step('🧭 Navigate to the website and open Forms', async () => {
      await steps.navigateTo('http://127.0.0.1:8080/');

      // Using repo directly here because getByText is a specialized repository method
      const formsCategory = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
      await formsCategory!.click(); 
    });

    await test.step('✅ Verify Page Title', async () => {
      await steps.verifyText('FormsPage', 'title', 'Forms Page');
    });

    await test.step('📝 Fill Standard Inputs', async () => {
      // Store expected values
      entries['Name'] = 'Automated Tester';
      entries['Email'] = 'AutomatedTester@email.com';
      entries['Mobile'] = '0000000000';
      entries['Current Address'] = 'Prinsenstraat, 1015 DB Amsterdam';

      // Replaced manual get + fill with single steps
      await steps.fill('FormsPage', 'nameInput', entries['Name']);
      await steps.fill('FormsPage', 'emailInput', entries['Email']);
      await steps.fill('FormsPage', 'mobileInput', entries['Mobile']);
      await steps.fill('FormsPage', 'addressInput', entries['Current Address']);
    });

    await test.step('🎲 Select a Random Enabled Gender', async () => {
      entries['Gender'] = await steps.selectDropdown('FormsPage', 'genderDropdown');
    });

    await test.step('📅 Handle Date Picker and Hobbies', async () => {
      await steps.click('FormsPage', 'dateOfBirthInput');

      await steps.verifyPresence('FormsPage', 'todayCell');
      await steps.click('FormsPage', 'todayCell');

      // Drop down to repo for textContent extraction
      const spSelectionPreview = await repo.get(page, 'FormsPage', 'spSelectionPreview');
      let dobValue = await spSelectionPreview.textContent();
      
      dobValue = DateUtilities.reformatDateString(dobValue!.trim(), 'yyyy-M-d');
      entries['Date of Birth'] = dobValue; 

      await steps.verifyPresence('FormsPage', 'datePickerSubmitButton');
      await steps.click('FormsPage', 'datePickerSubmitButton');

      // Note: If you want to use `clickWithoutScrolling` here, you might want to 
      // add that method to your `Steps` class too! 
      await steps.click('FormsPage', 'hobbiesInput'); 
    });

    await test.step('🚀 Submit Form and Verify Modal', async () => {
      await steps.click('FormsPage', 'submitButton');
      await steps.verifyPresence('FormsPage', 'table');

      // Drop down to raw Playwright for complex, dynamic row filtering
      const modal = await repo.get(page, 'FormsPage', 'table');
      for (const [key, expectedValue] of Object.entries(entries)) {
        const row = modal.locator('tr').filter({ hasText: key });
        const actualValueElement = row.locator('td').nth(1);   

        // We can reuse the verifications engine directly if needed, or Playwright's expect
        await steps['verify'].text(actualValueElement, expectedValue); 
      }
    });

    console.log('✅ TEST PASSED: TC_001 Complete Form Submission');
  });

});