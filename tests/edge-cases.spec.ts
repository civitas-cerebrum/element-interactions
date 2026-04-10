import { test, expect } from './fixture/StepFixture';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ──────────────────────────────────────────────────────────────────────────────
// Category 8: Edge Cases
// ──────────────────────────────────────────────────────────────────────────────

test.describe('TC_038: Long List Page', () => {

  test('renders 200 items with search filtering', async ({ page, steps }) => {

    await test.step('Navigate to Long List page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'longListLink','SidebarNav');
      await steps.verifyUrlContains('/long-list');
    });

    await test.step('200 items are rendered', async () => {
      await steps.verifyCount( 'listItems','LongListPage', { exactly: 200 });
    });

    await test.step('Search filters the list', async () => {
      await steps.fill( 'searchInput','LongListPage', 'Item 1');
      await steps.verifyCount( 'listItems','LongListPage', { lessThan: 200 });
    });

    await test.step('Clear search restores full list', async () => {
      await steps.fill( 'searchInput','LongListPage', '');
      await steps.verifyCount( 'listItems','LongListPage', { exactly: 200 });
    });

    log('TC_038 Long List Page — passed');
  });
});

test.describe('TC_039: Multi-step Form Page', () => {

  test('navigate through form steps', async ({ page, steps }) => {

    await test.step('Navigate to Multi-step Form page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'multistepLink','SidebarNav');
      await steps.verifyUrlContains('/multistep');
    });

    await test.step('Starts at step 1', async () => {
      await steps.verifyTextContains( 'currentStep','MultiStepFormPage', '1');
    });

    await test.step('Fill step 1 and go to step 2', async () => {
      await steps.fill( 'firstNameInput','MultiStepFormPage', 'John');
      await steps.fill( 'lastNameInput','MultiStepFormPage', 'Doe');
      await steps.click( 'nextButton','MultiStepFormPage');
      await steps.verifyTextContains( 'currentStep','MultiStepFormPage', '2');
    });

    await test.step('Fill step 2 and go to step 3', async () => {
      await steps.fill( 'emailInput','MultiStepFormPage', 'john@example.com');
      await steps.fill( 'phoneInput','MultiStepFormPage', '555-1234');
      await steps.click( 'nextButton','MultiStepFormPage');
      await steps.verifyTextContains( 'currentStep','MultiStepFormPage', '3');
    });

    await test.step('Step 3 has message input', async () => {
      await steps.verifyPresence( 'messageInput','MultiStepFormPage');
    });

    await test.step('Go back to step 2 and return', async () => {
      await steps.click( 'prevButton','MultiStepFormPage');
      await steps.verifyTextContains( 'currentStep','MultiStepFormPage', '2');
      await steps.click( 'nextButton','MultiStepFormPage');
      await steps.verifyTextContains( 'currentStep','MultiStepFormPage', '3');
    });

    await test.step('Fill message and submit — summary appears', async () => {
      await steps.fill( 'messageInput','MultiStepFormPage', 'Test message');
      await steps.click( 'submitButton','MultiStepFormPage');
      const submitted = page.locator('h2:has-text("Submitted!")');
      await submitted.waitFor({ state: 'visible', timeout: 5000 });
    });

    log('TC_039 Multi-step Form Page — passed');
  });
});

test.describe('TC_040: State Viewer Page', () => {

  test('switch between states', async ({ steps }) => {

    await test.step('Navigate to State Viewer page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'stateViewerLink','SidebarNav');
      await steps.verifyUrlContains('/state-viewer');
    });

    await test.step('Click Empty state button', async () => {
      await steps.click( 'emptyButton','StateViewerPage');
      await steps.verifyPresence( 'emptyView','StateViewerPage');
      await steps.verifyTextContains( 'currentState','StateViewerPage', 'empty');
    });

    await test.step('Click Loading state button', async () => {
      await steps.click( 'loadingButton','StateViewerPage');
      await steps.verifyPresence( 'loadingView','StateViewerPage');
      await steps.verifyTextContains( 'currentState','StateViewerPage', 'loading');
    });

    await test.step('Click Error state button', async () => {
      await steps.click( 'errorButton','StateViewerPage');
      await steps.verifyPresence( 'errorView','StateViewerPage');
      await steps.verifyTextContains( 'currentState','StateViewerPage', 'error');
    });

    await test.step('Click Populated state button', async () => {
      await steps.click( 'populatedButton','StateViewerPage');
      await steps.verifyTextContains( 'currentState','StateViewerPage', 'populated');
    });

    log('TC_040 State Viewer Page — passed');
  });
});
