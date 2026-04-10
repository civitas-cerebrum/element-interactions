import { test, expect } from './fixture/StepFixture';

test.describe('StepOptions — element resolution + modifiers', () => {

  test.beforeEach(async ({ steps }) => {
    await steps.navigateTo('/');
    await steps.click( 'buttonsLink','SidebarNav');
    await steps.verifyUrlContains('/buttons');
  });

  test('click with default (no options)', async ({ steps }) => {
    await steps.click( 'primaryButton','ButtonsPage');
    await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
  });

  test('click with strategy: first', async ({ steps }) => {
    await steps.click( 'primaryButton','ButtonsPage', { strategy: 'first' });
    await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
  });

  test('click with strategy: index, index: 0', async ({ steps }) => {
    await steps.click( 'primaryButton','ButtonsPage', { strategy: 'index', index: 0 });
    await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
  });

  test('click with withoutScrolling', async ({ steps }) => {
    await steps.click( 'primaryButton','ButtonsPage', { withoutScrolling: true });
    await steps.verifyTextContains( 'resultText','ButtonsPage', 'Primary');
  });

  test('click with ifPresent returns true for visible element', async ({ steps }) => {
    const result = await steps.click( 'primaryButton','ButtonsPage', { ifPresent: true });
    expect(result).toBe(true);
  });

  test('hover with StepOptions', async ({ steps }) => {
    await steps.hover( 'primaryButton','ButtonsPage', { strategy: 'first' });
  });

  test('verifyPresence with StepOptions', async ({ steps }) => {
    await steps.verifyPresence( 'primaryButton','ButtonsPage', { strategy: 'first' });
  });

  test('getText with StepOptions', async ({ steps }) => {
    const text = await steps.getText( 'primaryButton','ButtonsPage', { strategy: 'first' });
    expect(text).toBeTruthy();
  });

  test('getAttribute with StepOptions', async ({ steps }) => {
    const cls = await steps.getAttribute( 'primaryButton','ButtonsPage', 'class', { strategy: 'first' });
    expect(cls).toBeTruthy();
  });

  test('getCount with StepOptions', async ({ steps }) => {
    const count = await steps.getCount( 'primaryButton','ButtonsPage', { strategy: 'first' });
    expect(count).toBeGreaterThan(0);
  });

  test('fill with StepOptions', async ({ steps }) => {
    await steps.navigateTo('/');
    await steps.click( 'textInputsLink','SidebarNav');
    await steps.fill( 'textInput','TextInputsPage', 'StepOptions test', { strategy: 'first' });
  });

  test('check with StepOptions', async ({ steps }) => {
    await steps.navigateTo('/');
    await steps.click( 'checkboxesLink','SidebarNav');
    await steps.check( 'uncheckedCheckbox','CheckboxesPage', { strategy: 'first' });
  });
});
