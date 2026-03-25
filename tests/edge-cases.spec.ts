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
      await steps.click('SidebarNav', 'longListLink');
      await steps.verifyUrlContains('/long-list');
    });

    await test.step('200 items are rendered', async () => {
      await steps.verifyCount('LongListPage', 'listItems', { exactly: 200 });
    });

    await test.step('Search filters the list', async () => {
      await steps.fill('LongListPage', 'searchInput', 'Item 1');
      await steps.verifyCount('LongListPage', 'listItems', { lessThan: 200 });
    });

    await test.step('Clear search restores full list', async () => {
      await steps.fill('LongListPage', 'searchInput', '');
      await steps.verifyCount('LongListPage', 'listItems', { exactly: 200 });
    });

    log('TC_038 Long List Page — passed');
  });
});

test.describe('TC_039: Multi-step Form Page', () => {

  test('navigate through form steps', async ({ page, steps }) => {

    await test.step('Navigate to Multi-step Form page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'multistepLink');
      await steps.verifyUrlContains('/multistep');
    });

    await test.step('Starts at step 1', async () => {
      await steps.verifyTextContains('MultiStepFormPage', 'currentStep', '1');
    });

    await test.step('Fill step 1 and go to step 2', async () => {
      await steps.fill('MultiStepFormPage', 'firstNameInput', 'John');
      await steps.fill('MultiStepFormPage', 'lastNameInput', 'Doe');
      await steps.click('MultiStepFormPage', 'nextButton');
      await steps.verifyTextContains('MultiStepFormPage', 'currentStep', '2');
    });

    await test.step('Fill step 2 and go to step 3', async () => {
      await steps.fill('MultiStepFormPage', 'emailInput', 'john@example.com');
      await steps.fill('MultiStepFormPage', 'phoneInput', '555-1234');
      await steps.click('MultiStepFormPage', 'nextButton');
      await steps.verifyTextContains('MultiStepFormPage', 'currentStep', '3');
    });

    await test.step('Step 3 has message input', async () => {
      await steps.verifyPresence('MultiStepFormPage', 'messageInput');
    });

    await test.step('Go back to step 2 and return', async () => {
      await steps.click('MultiStepFormPage', 'prevButton');
      await steps.verifyTextContains('MultiStepFormPage', 'currentStep', '2');
      await steps.click('MultiStepFormPage', 'nextButton');
      await steps.verifyTextContains('MultiStepFormPage', 'currentStep', '3');
    });

    await test.step('Fill message and submit — summary appears', async () => {
      await steps.fill('MultiStepFormPage', 'messageInput', 'Test message');
      await steps.click('MultiStepFormPage', 'submitButton');
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
      await steps.click('SidebarNav', 'stateViewerLink');
      await steps.verifyUrlContains('/state-viewer');
    });

    await test.step('Click Empty state button', async () => {
      await steps.click('StateViewerPage', 'emptyButton');
      await steps.verifyPresence('StateViewerPage', 'emptyView');
      await steps.verifyTextContains('StateViewerPage', 'currentState', 'empty');
    });

    await test.step('Click Loading state button', async () => {
      await steps.click('StateViewerPage', 'loadingButton');
      await steps.verifyPresence('StateViewerPage', 'loadingView');
      await steps.verifyTextContains('StateViewerPage', 'currentState', 'loading');
    });

    await test.step('Click Error state button', async () => {
      await steps.click('StateViewerPage', 'errorButton');
      await steps.verifyPresence('StateViewerPage', 'errorView');
      await steps.verifyTextContains('StateViewerPage', 'currentState', 'error');
    });

    await test.step('Click Populated state button', async () => {
      await steps.click('StateViewerPage', 'populatedButton');
      await steps.verifyTextContains('StateViewerPage', 'currentState', 'populated');
    });

    log('TC_040 State Viewer Page — passed');
  });
});
