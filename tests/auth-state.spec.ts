import { test, expect } from './fixture/StepFixture';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ──────────────────────────────────────────────────────────────────────────────
// Category 7: Auth & State
// ──────────────────────────────────────────────────────────────────────────────

test.describe('TC_036: Login Form Page', () => {

  test('validation errors and successful login', async ({ page, steps }) => {

    await test.step('Navigate to Login Form page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'loginFormLink','SidebarNav');
      await steps.verifyUrlContains('/login-form');
    });

    await test.step('Empty submit shows validation errors', async () => {
      await steps.click( 'signInButton','LoginFormPage');
      // Validation errors should appear for empty fields
      const errors = page.locator("[data-testid='login-username-error'], [data-testid='login-password-error']");
      await errors.first().waitFor({ state: 'visible', timeout: 5000 });
    });

    await test.step('Wrong credentials show error', async () => {
      await steps.fill( 'usernameInput','LoginFormPage', 'wrong');
      await steps.fill( 'passwordInput','LoginFormPage', 'wrongpass');
      await steps.click( 'signInButton','LoginFormPage');
      const loginError = page.locator("[data-testid='login-error']");
      await loginError.waitFor({ state: 'visible', timeout: 5000 });
    });

    await test.step('Show/hide password toggle', async () => {
      const passwordField = page.locator('#login-password-input');
      expect(await passwordField.getAttribute('type')).toBe('password');
      await steps.click( 'showPasswordButton','LoginFormPage');
      expect(await passwordField.getAttribute('type')).toBe('text');
      await steps.click( 'showPasswordButton','LoginFormPage');
      expect(await passwordField.getAttribute('type')).toBe('password');
    });

    await test.step('Correct login succeeds', async () => {
      await steps.fill( 'usernameInput','LoginFormPage', 'admin');
      await steps.fill( 'passwordInput','LoginFormPage', 'password123');
      await steps.click( 'signInButton','LoginFormPage');
      const success = page.locator("[data-testid='login-success']");
      await success.waitFor({ state: 'visible', timeout: 5000 });
    });

    log('TC_036 Login Form Page — passed');
  });
});

test.describe('TC_037: Pinia Counter Page', () => {

  test('increment, decrement, reset, and change step', async ({ steps }) => {

    await test.step('Navigate to Pinia Counter page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'piniaCounterLink','SidebarNav');
      await steps.verifyUrlContains('/pinia-counter');
    });

    await test.step('Initial value is 0', async () => {
      await steps.verifyText( 'counterValue','PiniaCounterPage', '0');
    });

    await test.step('Increment increases value', async () => {
      await steps.click( 'incrementButton','PiniaCounterPage');
      await steps.verifyText( 'counterValue','PiniaCounterPage', '1');
    });

    await test.step('Decrement decreases value', async () => {
      await steps.click( 'decrementButton','PiniaCounterPage');
      await steps.verifyText( 'counterValue','PiniaCounterPage', '0');
    });

    await test.step('Increment twice and reset', async () => {
      await steps.click( 'incrementButton','PiniaCounterPage');
      await steps.click( 'incrementButton','PiniaCounterPage');
      await steps.verifyText( 'counterValue','PiniaCounterPage', '2');
      await steps.click( 'resetButton','PiniaCounterPage');
      await steps.verifyText( 'counterValue','PiniaCounterPage', '0');
    });

    await test.step('Change step to 5 and increment', async () => {
      await steps.fill( 'stepInput','PiniaCounterPage', '5');
      await steps.click( 'incrementButton','PiniaCounterPage');
      await steps.verifyText( 'counterValue','PiniaCounterPage', '5');
    });

    await test.step('History tracks operations', async () => {
      await steps.verifyPresence( 'history','PiniaCounterPage');
      await steps.verifyText( 'history','PiniaCounterPage');
    });

    log('TC_037 Pinia Counter Page — passed');
  });
});
