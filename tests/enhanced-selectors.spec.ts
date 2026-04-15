import { test, expect } from './fixture/StepFixture';

test.describe('Enhanced Selectors — Issue Fixes #61-#65', () => {

  test.beforeEach(async ({ steps }) => {
    await steps.navigateTo('/enhanced-selectors');
  });

  // ============================================================
  // #61 — Role + Accessible-Name Locator Support
  // ============================================================

  test('#61: role + accessible name — click button by role and name', async ({ steps }) => {
    await test.step('Click the "Log in" button via role selector', async () => {
      await steps.click('loginButton', 'EnhancedSelectorsPage');
    });

    await test.step('Verify the role-click result', async () => {
      await steps.verifyText('roleResult', 'EnhancedSelectorsPage', 'Clicked: login');
    });
  });

  test('#61: role + accessible name — click different named buttons', async ({ steps }) => {
    await test.step('Click "Sign up" button via role selector', async () => {
      await steps.click('signupButton', 'EnhancedSelectorsPage');
      await steps.verifyText('roleResult', 'EnhancedSelectorsPage', 'Clicked: signup');
    });

    await test.step('Click "Continue" button via role selector', async () => {
      await steps.click('continueButton', 'EnhancedSelectorsPage');
      await steps.verifyText('roleResult', 'EnhancedSelectorsPage', 'Clicked: continue');
    });
  });

  test('#61: role + regex name — match button by regex pattern', async ({ steps }) => {
    await test.step('Click first auth button matching regex pattern', async () => {
      await steps.click('authButton', 'EnhancedSelectorsPage');
    });

    await test.step('Verify a button was clicked', async () => {
      await steps.verifyPresence('roleResult', 'EnhancedSelectorsPage');
    });
  });

  test('#61: role + name — textbox with label', async ({ steps }) => {
    await test.step('Fill email textbox resolved by role + accessible name', async () => {
      await steps.fill('emailTextbox', 'EnhancedSelectorsPage', 'test@example.com');
    });
  });

  test('#61: role + name — switch element', async ({ steps }) => {
    await test.step('Check notification switch via role selector', async () => {
      await steps.check('notificationSwitch', 'EnhancedSelectorsPage');
    });

    await test.step('Verify switch is ON', async () => {
      await steps.verifyTextContains('switchResult', 'EnhancedSelectorsPage', 'ON');
    });
  });

  // ============================================================
  // #64 — Regex / Pattern Support for Text Selector
  // ============================================================

  test('#64: regex text selector — match dynamic alert message', async ({ steps }) => {
    await test.step('Verify pay restriction alert is visible via regex text', async () => {
      await steps.verifyPresence('payRestrictionAlert', 'EnhancedSelectorsPage');
    });

    await test.step('Get text from regex-matched element', async () => {
      const text = await steps.getText('payRestrictionAlert', 'EnhancedSelectorsPage');
      expect(text).toContain('Just Eat Pay');
    });
  });

  test('#64: regex text selector — match version string pattern', async ({ steps }) => {
    await test.step('Verify version alert matches regex pattern', async () => {
      await steps.verifyPresence('versionAlert', 'EnhancedSelectorsPage');
    });

    await test.step('Extract version text', async () => {
      const text = await steps.getText('versionAlert', 'EnhancedSelectorsPage');
      expect(text).toMatch(/Version \d+\.\d+\.\d+/);
    });
  });

  // ============================================================
  // #65 — Force Click for Pointer-Intercepted Elements
  // ============================================================

  test('#65: force click — auto-retry on pointer interception', async ({ steps }) => {
    await test.step('Click intercepted button (auto-retry with force)', async () => {
      await steps.click('interceptedButton', 'EnhancedSelectorsPage');
    });

    await test.step('Verify the force click result appeared', async () => {
      await steps.verifyPresence('forceClickResult', 'EnhancedSelectorsPage');
      await steps.verifyText('forceClickResult', 'EnhancedSelectorsPage', 'Force click successful!');
    });
  });

  test('#65: force click — explicit force option', async ({ steps }) => {
    await test.step('Click intercepted button with explicit force: true', async () => {
      await steps.click('interceptedButton', 'EnhancedSelectorsPage', { force: true });
    });

    await test.step('Verify click succeeded', async () => {
      await steps.verifyText('forceClickResult', 'EnhancedSelectorsPage', 'Force click successful!');
    });
  });

  test('#65: force click — toggle behind interceptor', async ({ steps }) => {
    await test.step('Check intercepted toggle with force', async () => {
      await steps.click('interceptedToggle', 'EnhancedSelectorsPage', { force: true });
    });

    await test.step('Verify toggle state changed', async () => {
      await steps.verifyTextContains('toggleResult', 'EnhancedSelectorsPage', 'ON');
    });
  });

  test('#65: fluent API — force click via steps.on()', async ({ steps }) => {
    await test.step('Click intercepted button via fluent API with force', async () => {
      await steps.on('interceptedButton', 'EnhancedSelectorsPage').click({ force: true });
    });

    await test.step('Verify result', async () => {
      await steps.verifyText('forceClickResult', 'EnhancedSelectorsPage', 'Force click successful!');
    });
  });

  // ============================================================
  // #63 — Non-Throwing steps.isVisible() Probe
  // ============================================================

  test('#63: isVisible — returns true for visible element', async ({ steps }) => {
    const visible = await steps.isVisible('promoBanner', 'EnhancedSelectorsPage');
    expect(visible).toBe(true);
  });

  test('#63: isVisible — returns false for hidden element', async ({ steps }) => {
    const visible = await steps.isVisible('alwaysHidden', 'EnhancedSelectorsPage');
    expect(visible).toBe(false);
  });

  test('#63: isVisible — returns false after element is removed', async ({ steps }) => {
    await test.step('Hide the banner', async () => {
      await steps.click('toggleBannerBtn', 'EnhancedSelectorsPage');
    });

    await test.step('Verify isVisible returns false', async () => {
      const visible = await steps.isVisible('promoBanner', 'EnhancedSelectorsPage');
      expect(visible).toBe(false);
    });
  });

  test('#63: isVisible — containsText filter matches', async ({ steps }) => {
    const visible = await steps.isVisible('promoBanner', 'EnhancedSelectorsPage', {
      containsText: '50% off',
    });
    expect(visible).toBe(true);
  });

  test('#63: isVisible — containsText filter rejects non-matching text', async ({ steps }) => {
    const visible = await steps.isVisible('promoBanner', 'EnhancedSelectorsPage', {
      containsText: 'nonexistent text',
    });
    expect(visible).toBe(false);
  });

  test('#63: isVisible — respects short timeout for missing elements', async ({ steps }) => {
    const start = Date.now();
    const visible = await steps.isVisible('delayedElement', 'EnhancedSelectorsPage', {
      timeout: 500,
    });
    const elapsed = Date.now() - start;
    expect(visible).toBe(false);
    expect(elapsed).toBeLessThan(3000); // should not wait the full default timeout
  });

  test('#63: isVisible — never throws', async ({ steps }) => {
    // Should not throw even for completely nonexistent elements
    const visible = await steps.isVisible('delayedElement', 'EnhancedSelectorsPage', {
      timeout: 100,
    });
    expect(visible).toBe(false);
  });

  test('#63: fluent API — isVisible via steps.on()', async ({ steps }) => {
    const visible = await steps.on('promoBanner', 'EnhancedSelectorsPage').isVisible();
    expect(visible).toBe(true);

    const hidden = await steps.on('alwaysHidden', 'EnhancedSelectorsPage').isVisible();
    expect(hidden).toBe(false);
  });

  test('#63: ifVisible — conditional click on visible element', async ({ steps }) => {
    await test.step('Click banner via ifVisible (should succeed)', async () => {
      await steps.on('toggleBannerBtn', 'EnhancedSelectorsPage').ifVisible().click();
    });

    await test.step('Banner should now be hidden', async () => {
      const visible = await steps.isVisible('promoBanner', 'EnhancedSelectorsPage', { timeout: 500 });
      expect(visible).toBe(false);
    });
  });

  test('#63: ifVisible — conditional click on hidden element silently skips', async ({ steps }) => {
    await test.step('Try clicking hidden element via ifVisible (should skip)', async () => {
      await steps.on('alwaysHidden', 'EnhancedSelectorsPage').ifVisible(500).click();
      // No error thrown — action was skipped
    });

    await test.step('Try filling hidden element via ifVisible (should skip)', async () => {
      await steps.on('alwaysHidden', 'EnhancedSelectorsPage').ifVisible(500).fill('text');
      // No error thrown — action was skipped
    });
  });

  // ============================================================
  // #62 — Iframe / Cross-Frame Scope
  // ============================================================

  test('#62: iframe — read text inside iframe', async ({ steps }) => {
    await test.step('Verify iframe title text', async () => {
      await steps.verifyText('iframeTitle', 'SimpleIframe', 'Inside the iframe');
    });
  });

  test('#62: iframe — click inside iframe', async ({ steps }) => {
    await test.step('Click button inside iframe', async () => {
      await steps.click('iframeButton', 'SimpleIframe');
    });

    await test.step('Verify click result inside iframe', async () => {
      await steps.verifyText('iframeResult', 'SimpleIframe', 'Clicked!');
    });
  });

  test('#62: iframe — fill input inside iframe', async ({ steps }) => {
    await test.step('Fill input inside iframe', async () => {
      await steps.fill('iframeInput', 'SimpleIframe', 'Hello from outside!');
    });
  });

  test('#62: iframe — second iframe (card form)', async ({ steps }) => {
    await test.step('Fill card number inside card iframe', async () => {
      await steps.fill('cardNumberInput', 'CardIframe', '4111111111111111');
    });

    await test.step('Fill expiry inside card iframe', async () => {
      await steps.fill('expiryInput', 'CardIframe', '12/28');
    });
  });
});
