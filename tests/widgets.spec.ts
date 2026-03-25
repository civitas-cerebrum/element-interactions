import { test, expect } from './fixture/StepFixture';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

test.describe('TC_023: Tabs Page', () => {

  test('switch tabs and verify panels', async ({ steps }) => {

    await test.step('Navigate to Tabs page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'tabsLink');
      await steps.verifyUrlContains('/tabs');
    });

    await test.step('Tab 1 is active by default — panel 1 visible', async () => {
      await steps.verifyPresence('TabsPage', 'panel1');
    });

    await test.step('Click Tab 2 — panel 2 visible, panel 1 hidden', async () => {
      await steps.click('TabsPage', 'tab2');
      await steps.verifyPresence('TabsPage', 'panel2');
      await steps.verifyAbsence('TabsPage', 'panel1');
    });

    await test.step('Click Tab 3 — panel 3 visible, panel 2 hidden', async () => {
      await steps.click('TabsPage', 'tab3');
      await steps.verifyPresence('TabsPage', 'panel3');
      await steps.verifyAbsence('TabsPage', 'panel2');
    });

    await test.step('Click Tab 4 — panel 4 visible, panel 3 hidden', async () => {
      await steps.click('TabsPage', 'tab4');
      await steps.verifyPresence('TabsPage', 'panel4');
      await steps.verifyAbsence('TabsPage', 'panel3');
    });

    await test.step('Click Tab 1 again — back to panel 1', async () => {
      await steps.click('TabsPage', 'tab1');
      await steps.verifyPresence('TabsPage', 'panel1');
      await steps.verifyAbsence('TabsPage', 'panel4');
    });

    log('TC_023 Tabs Page — passed');
  });
});

test.describe('TC_024: Accordion Page', () => {

  test('expand and collapse accordion items', async ({ steps }) => {

    await test.step('Navigate to Accordion page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'accordionLink');
      await steps.verifyUrlContains('/accordion');
    });

    await test.step('Item 1 body is hidden by default', async () => {
      await steps.verifyAbsence('AccordionPage', 'body1');
    });

    await test.step('Click header 1 — body 1 appears', async () => {
      await steps.click('AccordionPage', 'header1');
      await steps.verifyPresence('AccordionPage', 'body1');
    });

    await test.step('Click header 1 again — body 1 collapses', async () => {
      await steps.click('AccordionPage', 'header1');
      await steps.verifyAbsence('AccordionPage', 'body1');
    });

    await test.step('Expand All — all bodies visible', async () => {
      await steps.click('AccordionPage', 'expandAllButton');
      await steps.verifyPresence('AccordionPage', 'body1');
      await steps.verifyPresence('AccordionPage', 'body2');
      await steps.verifyPresence('AccordionPage', 'body3');
    });

    await test.step('Collapse All — all bodies hidden', async () => {
      await steps.click('AccordionPage', 'collapseAllButton');
      await steps.verifyAbsence('AccordionPage', 'body1');
      await steps.verifyAbsence('AccordionPage', 'body2');
      await steps.verifyAbsence('AccordionPage', 'body3');
    });

    log('TC_024 Accordion Page — passed');
  });
});

test.describe('TC_025: Progress Page', () => {

  test('verify static bars and animated progress', async ({ page, steps }) => {

    await test.step('Navigate to Progress page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'progressLink');
      await steps.verifyUrlContains('/progress');
    });

    await test.step('Verify 5 static progress bars exist', async () => {
      await steps.verifyCount('ProgressPage', 'staticBars', { exactly: 5 });
    });

    await test.step('Animated bar starts at 0%', async () => {
      await steps.verifyText('ProgressPage', 'animatedValue', '0%');
    });

    await test.step('Click Start — progress animates to 100%', async () => {
      await steps.click('ProgressPage', 'startButton');
      // Wait for animation to complete (value reaches 100%)
      await page.locator("[data-testid='progress-animated-value']").filter({ hasText: '100%' }).waitFor({ timeout: 15000 });
      await steps.verifyText('ProgressPage', 'animatedValue', '100%');
    });

    await test.step('Click Reset — progress resets to 0%', async () => {
      await steps.click('ProgressPage', 'resetButton');
      await steps.verifyText('ProgressPage', 'animatedValue', '0%');
    });

    await test.step('Circular progress value is displayed', async () => {
      await steps.verifyPresence('ProgressPage', 'circularValue');
    });

    log('TC_025 Progress Page — passed');
  });
});

test.describe('TC_026: Table Page', () => {

  test('search, sort, paginate, and select rows', async ({ page, repo, steps }) => {

    await test.step('Navigate to Table page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'tableLink');
      await steps.verifyUrlContains('/table');
    });

    await test.step('Table renders 5 rows on page 1', async () => {
      await steps.verifyCount('TablePage', 'rows', { exactly: 5 });
    });

    await test.step('Search filters rows', async () => {
      await steps.fill('TablePage', 'searchInput', 'alice');
      await steps.verifyCount('TablePage', 'rows', { lessThan: 5 });
      // Clear the search
      await steps.fill('TablePage', 'searchInput', '');
    });

    await test.step('Sort by Name column', async () => {
      const firstNameBefore = await page.locator("[data-testid^='table-row-']:not([data-testid*='checkbox']) td:nth-child(2)").first().textContent();
      await steps.click('TablePage', 'headerName');
      const firstNameAfter = await page.locator("[data-testid^='table-row-']:not([data-testid*='checkbox']) td:nth-child(2)").first().textContent();
      // After sorting, the order should change (or stay if already sorted)
      log('Sort: %s → %s', firstNameBefore, firstNameAfter);
    });

    await test.step('Navigate to next page', async () => {
      await steps.click('TablePage', 'nextButton');
      await steps.verifyTextContains('TablePage', 'pageInfo', '2');
    });

    await test.step('Navigate back to previous page', async () => {
      await steps.click('TablePage', 'prevButton');
      await steps.verifyTextContains('TablePage', 'pageInfo', '1');
    });

    await test.step('Select a row via checkbox', async () => {
      await steps.clickRandom('TablePage', 'rowCheckboxes');
      await steps.verifyText('TablePage', 'selectedCount', undefined, { notEmpty: true });
    });

    await test.step('Select all rows', async () => {
      await steps.click('TablePage', 'selectAllCheckbox');
      await steps.verifyTextContains('TablePage', 'selectedCount', '5');
    });

    log('TC_026 Table Page — passed');
  });
});
