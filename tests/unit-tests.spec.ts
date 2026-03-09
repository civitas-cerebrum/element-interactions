import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/ElementRepository';

test.describe('Type Compatibility Tests', () => {

  test('TC_001: Should format selectors correctly', async () => {
    const mockData = {
      pages: [{
        name: 'LoginPage',
        elements: [{ elementName: 'Submit', selector: { xpath: '//button' } }]
      }]
    };
    
    const repo = new ElementRepository(mockData);

    const mockPage = {
      locator: (s: string) => ({ selector: s }),
      waitForSelector: async () => { }
    } as any;

    await test.step('Retrieve and validate selector formatting', async () => {
      const locator = await repo.get(mockPage, 'LoginPage', 'Submit');
      
      expect(locator.selector).toBe('xpath=//button');

      console.log('--------------------------------------------------');
      console.log('✅ TEST PASSED: TC_001: Should format selectors correctly');
      console.log(`👉 Found Page: "LoginPage"`);
      console.log(`👉 Element: "Submit"`);
      console.log(`👉 Resulting Selector: "${locator.selector}"`);
      console.log('--------------------------------------------------');
    });
  });
});