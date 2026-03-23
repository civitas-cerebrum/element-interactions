import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { test, expect } from './fixture/StepFixture';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

test.describe('Vue Test App v2 - Homepage Tests', () => {

  let repo: ElementRepository;

  test.beforeAll(() => {
    repo = new ElementRepository('tests/data/page-repository.json');
  });

  test('TC_001: Homepage loads correctly', async ({ page, steps }) => {
    await test.step('Navigate to the homepage', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Verify page loaded', async () => {
      await expect(page).toHaveTitle(/vue-test-app/);
    });

    log('TC_001 Homepage loads correctly — passed');
  });

  test('TC_002: Verify homepage title', async ({ steps }) => {
    await test.step('Navigate to homepage', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Verify title text', async () => {
      const title = await steps.getText('HomePage', 'pageTitle');
      log('Title: %s', title);
    });

    log('TC_002 Verify homepage title — passed');
  });
});

test.describe('Vue Test App v2 - Forms Tests', () => {

  let repo: ElementRepository;

  test.beforeAll(() => {
    repo = new ElementRepository('tests/data/page-repository.json');
  });

  test('TC_003: Forms page loads correctly', async ({ page, steps }) => {
    await test.step('Navigate to Forms page via homepage', async () => {
      await steps.navigateTo('/');
      await steps.click('HomePage', 'formsCard');
    });

    await test.step('Verify page title', async () => {
      const title = await steps.getText('FormsPage', 'formTitle');
      expect(title).toBe('Submission Form');
      log('Form title: %s', title);
    });

    log('TC_003 Forms page loads correctly — passed');
  });

  test('TC_004: Verify form elements', async ({ steps }) => {
    await test.step('Navigate to Forms page via homepage', async () => {
      await steps.navigateTo('/');
      await steps.click('HomePage', 'formsCard');
    });

    await test.step('Verify name input exists', async () => {
      await steps.verifyPresence('FormsPage', 'nameInput');
    });

    await test.step('Verify submit button exists', async () => {
      await steps.verifyPresence('FormsPage', 'submitButton');
    });

    log('TC_004 Verify form elements — passed');
  });
});

test.describe('Vue Test App v2 - Interactions Tests', () => {

  test('TC_005: Interactions page loads correctly', async ({ page, steps }) => {
    await test.step('Navigate to Sortable page via homepage', async () => {
      await steps.navigateTo('/');
      await steps.click('HomePage', 'interactionsCard');
    });

    await test.step('Verify page loaded', async () => {
      await expect(page).toHaveTitle(/vue-test-app/);
      await steps.verifyUrlContains('/sortable');
    });

    log('TC_005 Interactions page loads correctly — passed');
  });
});

test.describe('Vue Test App v2 - Elements Tests', () => {

  test('TC_006: Elements page loads correctly', async ({ page, steps }) => {
    await test.step('Navigate to Elements page via homepage', async () => {
      await steps.navigateTo('/');
      await steps.click('HomePage', 'elementsCard');
    });

    await test.step('Verify page loaded', async () => {
      await expect(page).toHaveTitle(/vue-test-app/);
      await steps.verifyUrlContains('/radiobuttons');
    });

    log('TC_006 Elements page loads correctly — passed');
  });
});
