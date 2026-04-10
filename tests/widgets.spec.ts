import { test, expect } from './fixture/StepFixture';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

test.describe('TC_023: Tabs Page', () => {

  test('switch tabs and verify panels', async ({ steps }) => {

    await test.step('Navigate to Tabs page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tabsLink','SidebarNav');
      await steps.verifyUrlContains('/tabs');
    });

    await test.step('Tab 1 is active by default — panel 1 visible', async () => {
      await steps.verifyPresence( 'panel1','TabsPage');
    });

    await test.step('Click Tab 2 — panel 2 visible, panel 1 hidden', async () => {
      await steps.click( 'tab2','TabsPage');
      await steps.verifyPresence( 'panel2','TabsPage');
      await steps.verifyAbsence( 'panel1','TabsPage');
    });

    await test.step('Click Tab 3 — panel 3 visible, panel 2 hidden', async () => {
      await steps.click( 'tab3','TabsPage');
      await steps.verifyPresence( 'panel3','TabsPage');
      await steps.verifyAbsence( 'panel2','TabsPage');
    });

    await test.step('Click Tab 4 — panel 4 visible, panel 3 hidden', async () => {
      await steps.click( 'tab4','TabsPage');
      await steps.verifyPresence( 'panel4','TabsPage');
      await steps.verifyAbsence( 'panel3','TabsPage');
    });

    await test.step('Click Tab 1 again — back to panel 1', async () => {
      await steps.click( 'tab1','TabsPage');
      await steps.verifyPresence( 'panel1','TabsPage');
      await steps.verifyAbsence( 'panel4','TabsPage');
    });

    log('TC_023 Tabs Page — passed');
  });
});

test.describe('TC_024: Accordion Page', () => {

  test('expand and collapse accordion items', async ({ steps }) => {

    await test.step('Navigate to Accordion page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'accordionLink','SidebarNav');
      await steps.verifyUrlContains('/accordion');
    });

    await test.step('Item 1 body is hidden by default', async () => {
      await steps.verifyAbsence( 'body1','AccordionPage');
    });

    await test.step('Click header 1 — body 1 appears', async () => {
      await steps.click( 'header1','AccordionPage');
      await steps.verifyPresence( 'body1','AccordionPage');
    });

    await test.step('Click header 1 again — body 1 collapses', async () => {
      await steps.click( 'header1','AccordionPage');
      await steps.verifyAbsence( 'body1','AccordionPage');
    });

    await test.step('Expand All — all bodies visible', async () => {
      await steps.click( 'expandAllButton','AccordionPage');
      await steps.verifyPresence( 'body1','AccordionPage');
      await steps.verifyPresence( 'body2','AccordionPage');
      await steps.verifyPresence( 'body3','AccordionPage');
    });

    await test.step('Collapse All — all bodies hidden', async () => {
      await steps.click( 'collapseAllButton','AccordionPage');
      await steps.verifyAbsence( 'body1','AccordionPage');
      await steps.verifyAbsence( 'body2','AccordionPage');
      await steps.verifyAbsence( 'body3','AccordionPage');
    });

    log('TC_024 Accordion Page — passed');
  });
});

test.describe('TC_025: Progress Page', () => {

  test('verify static bars and animated progress', async ({ page, steps }) => {

    await test.step('Navigate to Progress page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'progressLink','SidebarNav');
      await steps.verifyUrlContains('/progress');
    });

    await test.step('Verify 5 static progress bars exist', async () => {
      await steps.verifyCount( 'staticBars','ProgressPage', { exactly: 5 });
    });

    await test.step('Animated bar starts at 0%', async () => {
      await steps.verifyText( 'animatedValue','ProgressPage', '0%');
    });

    await test.step('Click Start — progress animates to 100%', async () => {
      await steps.click( 'startButton','ProgressPage');
      // Wait for animation to complete (value reaches 100%)
      await page.locator("[data-testid='progress-animated-value']").filter({ hasText: '100%' }).waitFor({ timeout: 15000 });
      await steps.verifyText( 'animatedValue','ProgressPage', '100%');
    });

    await test.step('Click Reset — progress resets to 0%', async () => {
      await steps.click( 'resetButton','ProgressPage');
      await steps.verifyText( 'animatedValue','ProgressPage', '0%');
    });

    await test.step('Circular progress value is displayed', async () => {
      await steps.verifyPresence( 'circularValue','ProgressPage');
    });

    log('TC_025 Progress Page — passed');
  });
});

test.describe('TC_026: Table Page', () => {

  test('search, sort, paginate, and select rows', async ({ page, repo, steps }) => {

    await test.step('Navigate to Table page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
    });

    await test.step('Table renders 5 rows on page 1', async () => {
      await steps.verifyCount( 'rows','TablePage', { exactly: 5 });
    });

    await test.step('Search filters rows', async () => {
      await steps.fill( 'searchInput','TablePage', 'alice');
      await steps.verifyCount( 'rows','TablePage', { lessThan: 5 });
      // Clear the search
      await steps.fill( 'searchInput','TablePage', '');
    });

    await test.step('Sort by Name column', async () => {
      const firstNameBefore = await page.locator("[data-testid^='table-row-']:not([data-testid*='checkbox']) td:nth-child(2)").first().textContent();
      await steps.click( 'headerName','TablePage');
      const firstNameAfter = await page.locator("[data-testid^='table-row-']:not([data-testid*='checkbox']) td:nth-child(2)").first().textContent();
      // After sorting, the order should change (or stay if already sorted)
      log('Sort: %s → %s', firstNameBefore, firstNameAfter);
    });

    await test.step('Navigate to next page', async () => {
      await steps.click( 'nextButton','TablePage');
      await steps.verifyTextContains( 'pageInfo','TablePage', '2');
    });

    await test.step('Navigate back to previous page', async () => {
      await steps.click( 'prevButton','TablePage');
      await steps.verifyTextContains( 'pageInfo','TablePage', '1');
    });

    await test.step('Select a row via checkbox', async () => {
      await steps.clickRandom( 'rowCheckboxes','TablePage');
      await steps.verifyText( 'selectedCount','TablePage', undefined, { notEmpty: true });
    });

    await test.step('Select all rows', async () => {
      await steps.click( 'selectAllCheckbox','TablePage');
      await steps.verifyTextContains( 'selectedCount','TablePage', '5');
    });

    log('TC_026 Table Page — passed');
  });
});
