import { test, expect } from '@playwright/test';
import { Page as PlaywrightPage } from 'playwright-core';
import { ElementRepository } from '../src/ElementRepository';

const repo = new ElementRepository('./tests/locators.json');

test.describe('Type Compatibility Tests', () => {

  test('TC_002: Should accept an explicitly typed Page from @playwright/test', async ({ page }) => {
    const typedPage: PlaywrightPage = page;
    
    await typedPage.goto('https://example.com');
    const heading = await repo.get(typedPage, 'ExamplePage', 'main-heading');
    
    await expect(heading).toBeVisible();

    console.log('--------------------------------------------------');
    console.log('✅ TEST PASSED: TC_002: Should accept an explicitly typed Page from @playwright/test');
    console.log('👉 Context: Explicit PlaywrightPage casting');
    console.log('👉 Target: "ExamplePage" -> "main-heading"');
    console.log(`👉 Status: Element is visible and type-compatible`);
    console.log('--------------------------------------------------');
  });

  test('TC_003: Should work with a Wrapped Page (Dependency Injection)', async ({ page }) => {
    class CustomPageWrapper {
      constructor(public page: PlaywrightPage) {}
      
      locator(selector: string) { 
        return this.page.locator(selector); 
      }
      
      async waitForSelector(selector: string, options?: any) { 
        return this.page.waitForSelector(selector, options); 
      }
    }

    const wrapped = new CustomPageWrapper(page);
    await page.goto('https://example.com');

    const heading = await repo.get(wrapped, 'ExamplePage', 'main-heading');
    
    await expect(heading).toBeVisible();

    console.log('--------------------------------------------------');
    console.log('✅ TEST PASSED: TC_003: Should work with a Wrapped Page (Dependency Injection)');
    console.log('👉 Context: Structural Typing via CustomPageWrapper');
    console.log('👉 Target: "ExamplePage" -> "main-heading"');
    console.log(`👉 Status: Wrapper methods correctly invoked by Repository`);
    console.log('--------------------------------------------------');
  });
});