import { test, expect } from './fixture/StepFixture';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

test.describe('TC_007: verifyState - All Playwright element states', () => {

  test('positive state assertions', async ({ page, repo, steps, interactions }) => {

    await test.step('Navigate to Forms page', async () => {
      await steps.navigateTo('/');
      await steps.click('HomePage', 'formsCard');
      await steps.verifyUrlContains('/forms');
    });

    await test.step('visible: title is visible', async () => {
      await steps.verifyState('FormsPage', 'title', 'visible');
    });

    await test.step('attached: title is attached to the DOM', async () => {
      await steps.verifyState('FormsPage', 'title', 'attached');
    });

    await test.step('inViewport: title is in viewport', async () => {
      await steps.verifyState('FormsPage', 'title', 'inViewport');
    });

    await test.step('enabled: submit button is enabled', async () => {
      await steps.verifyState('FormsPage', 'submitButton', 'enabled');
    });

    await test.step('editable: name input is editable', async () => {
      await steps.verifyState('FormsPage', 'nameInput', 'editable');
    });

    await test.step('focused: name input is focused after clicking', async () => {
      await steps.click('FormsPage', 'nameInput');
      await steps.verifyState('FormsPage', 'nameInput', 'focused');
    });

    await test.step('Navigate to Radio Buttons page', async () => {
      await steps.navigateTo('/');
      await steps.click('HomePage', 'elementsCard');
      await steps.verifyUrlContains('/radiobuttons');
    });

    await test.step('disabled: the No radio button is disabled', async () => {
      await steps.verifyState('RadioButtonsPage', 'disabledRadio', 'disabled');
    });

    await test.step('checked: Yes radio is checked after clicking', async () => {
      await steps.click('RadioButtonsPage', 'yesRadio');
      await steps.verifyState('RadioButtonsPage', 'yesRadio', 'checked');
    });

    await test.step('hidden: FormsPage title is hidden on a different page', async () => {
      await steps.verifyState('FormsPage', 'title', 'hidden', 500);
    });

    log('TC_007 verifyState — passed');
  });
});

test.describe('TC_008: navigateTo resolves relative URLs via Playwright baseURL', () => {
  test.use({ baseURL: 'https://civitas-cerebrum.github.io/vue-test-app/' });

  test('navigates with a relative URL', async ({ steps }) => {
    await test.step('Navigate using a relative URL', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Verify the home page loaded', async () => {
      await steps.verifyCount('HomePage', 'categories', { exactly: 8 });
    });

    await test.step('verifyUrlContains escapes regex metacharacters', async () => {
      await steps.verifyUrlContains('vue-test-app/');
    });

    log('TC_008 navigateTo relative URL — passed');
  });
});
