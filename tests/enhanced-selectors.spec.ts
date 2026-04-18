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
      await steps.verifyInputValue('emailTextbox', 'EnhancedSelectorsPage', 'test@example.com');
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
  // #70 — Unified isVisible() dual-behavior (probe + gate)
  // ============================================================

  test('#70: isVisible — probe mode via top-level Steps API (backwards compat with old boolean return)', async ({ steps }) => {
    // `await steps.isVisible(...)` still resolves to boolean at runtime.
    const ok: boolean = await steps.isVisible('promoBanner', 'EnhancedSelectorsPage');
    expect(ok).toBe(true);

    const hidden: boolean = await steps.isVisible('alwaysHidden', 'EnhancedSelectorsPage', { timeout: 500 });
    expect(hidden).toBe(false);
  });

  test('#70: isVisible — probe via fluent API also resolves to boolean', async ({ steps }) => {
    const ok: boolean = await steps.on('promoBanner', 'EnhancedSelectorsPage').isVisible();
    expect(ok).toBe(true);
  });

  test('#70: isVisible — gate path skips click on hidden element silently', async ({ steps }) => {
    await test.step('Gate on hidden element — click is skipped', async () => {
      await steps.isVisible('alwaysHidden', 'EnhancedSelectorsPage', { timeout: 500 }).click();
      // No error — click was gated.
    });

    await test.step('Gate on visible element — click executes', async () => {
      await steps.isVisible('toggleBannerBtn', 'EnhancedSelectorsPage').click();
    });

    await test.step('Banner toggled off after the gate-passed click', async () => {
      const stillVisible = await steps.isVisible('promoBanner', 'EnhancedSelectorsPage', { timeout: 500 });
      expect(stillVisible).toBe(false);
    });
  });

  test('#70: isVisible — containsText filter applies to both probe and action gate', async ({ steps }) => {
    await test.step('Probe — containsText matches', async () => {
      const match = await steps.isVisible('promoBanner', 'EnhancedSelectorsPage', { containsText: '50% off' });
      expect(match).toBe(true);
    });

    await test.step('Probe — containsText does not match', async () => {
      const noMatch = await steps.isVisible('promoBanner', 'EnhancedSelectorsPage', { containsText: 'nonexistent-copy' });
      expect(noMatch).toBe(false);
    });
  });

  test('#70: isVisible — matcher tree (fluent) silently skips when hidden', async ({ steps }) => {
    // Hidden element — the matcher tree assertion should NOT throw because the
    // visibility gate inherited from the chain makes the assertion skip.
    await steps.on('alwaysHidden', 'EnhancedSelectorsPage').isVisible({ timeout: 500 }).text.toBe('anything');
  });

  test('#70: isVisible — containsText filter gates the action (not just the probe)', async ({ steps }) => {
    // clickIfPresent has an observable return value (true when executed, fallback
    // false when the gate skips) that distinguishes "action ran" from "action
    // skipped" without relying on DOM side effects. Proves containsText drives
    // the gate decision, not just the boolean probe.
    await test.step('containsText matches → gate executes, clickIfPresent returns true', async () => {
      const ran = await steps
        .isVisible('promoBanner', 'EnhancedSelectorsPage', { containsText: '50% off' })
        .clickIfPresent();
      expect(ran).toBe(true);
    });

    await test.step('containsText does not match → gate skips, clickIfPresent returns false', async () => {
      const skipped = await steps
        .isVisible('promoBanner', 'EnhancedSelectorsPage', { containsText: 'nonexistent-copy' })
        .clickIfPresent();
      expect(skipped).toBe(false);
    });
  });

  test('#70: isVisible — fluent probe honors containsText filter', async ({ steps }) => {
    // Probe coverage so far only exercises containsText via the top-level
    // `steps.isVisible(...)`. Verify the fluent `steps.on(...).isVisible(opts)`
    // entry point applies the same filter — symmetry matters because the two
    // entry points share implementation but wire the options differently.
    const match = await steps
      .on('promoBanner', 'EnhancedSelectorsPage')
      .isVisible({ containsText: '50% off' });
    expect(match).toBe(true);

    const noMatch = await steps
      .on('promoBanner', 'EnhancedSelectorsPage')
      .isVisible({ containsText: 'nonexistent-copy' });
    expect(noMatch).toBe(false);
  });

  test('#70: isVisible — probe on hidden element respects caller timeout (no 15s repo wait)', async ({ steps }) => {
    // VisibleChain.probe() constructs a WebElement directly from
    // `repo.getSelector(...)` to avoid the 15s repository-resolution default
    // that `repo.get(...)` would otherwise impose. Without this fast path, a
    // `{ timeout: 500 }` probe on a hidden element would still pay the full
    // 15s wait. Lock the invariant with a wall-clock assertion: the probe
    // should resolve within a small multiple of its requested timeout.
    const start = Date.now();
    const result = await steps.isVisible('alwaysHidden', 'EnhancedSelectorsPage', { timeout: 500 });
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(3000);
  });

  test('#70: isVisible — matcher tree .count proxy silently skips when hidden', async ({ steps }) => {
    // Extends matcher-tree coverage beyond `.text` — `.count` is a numeric
    // assertion proxy, a distinct code path from string comparators. A hidden
    // element should short-circuit the assertion without throwing, same as
    // `.text.toBe(...)` does.
    await steps.on('alwaysHidden', 'EnhancedSelectorsPage').isVisible({ timeout: 500 }).count.toBe(999);
  });

  test('#70: isVisible — gateReturning fallbacks for selectDropdown and selectMultiple', async ({ steps }) => {
    // Three action methods go through `gateReturning()` with a non-boolean
    // fallback — clickIfPresent → false is covered above. The other two
    // (selectDropdown → '', selectMultiple → []) share the same helper but
    // different fallback types. Calling them on a hidden non-dropdown element
    // also doubles as proof that the gate skips BEFORE the underlying action
    // executes — otherwise selectDropdown on a hidden <div> would throw.
    const value = await steps
      .isVisible('alwaysHidden', 'EnhancedSelectorsPage', { timeout: 500 })
      .selectDropdown();
    expect(value).toBe('');

    const values = await steps
      .isVisible('alwaysHidden', 'EnhancedSelectorsPage', { timeout: 500 })
      .selectMultiple(['anything']);
    expect(values).toEqual([]);
  });

  test('#70: isVisible — remaining action-method and matcher-tree proxies skip cleanly on hidden element', async ({ steps }) => {
    // Sweep every VisibleChain entry point that the #70 block has not
    // individually exercised. A hidden element must make all of them no-op
    // without throwing — if any proxy were wired incorrectly (wrong signature,
    // missing await, forwarding to the underlying action outside the gate),
    // the call would throw against `alwaysHidden` instead of returning silently.
    const chain = () => steps.isVisible('alwaysHidden', 'EnhancedSelectorsPage', { timeout: 500 });

    // void action-method proxies
    await chain().clearInput();
    await chain().dragAndDrop({ target: { x: 0, y: 0 } });
    await chain().setSliderValue(50);
    await chain().typeSequentially('ignored', 10);
    await chain().uploadFile('/tmp/ignored.txt');

    // matcher-tree proxies — gated via conditionalVisible, so the assertion
    // short-circuits on hidden.
    await chain().css('display').toBe('impossible-value');
    await chain().satisfy(() => false);
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
      await steps.verifyInputValue('iframeInput', 'SimpleIframe', 'Hello from outside!');
    });
  });

  test('#62: iframe — second iframe (card form)', async ({ steps }) => {
    await test.step('Fill card number inside card iframe', async () => {
      await steps.fill('cardNumberInput', 'CardIframe', '4111111111111111');
    });

    await test.step('Fill expiry inside card iframe', async () => {
      await steps.fill('expiryInput', 'CardIframe', '12/28');
      await steps.verifyInputValue('expiryInput', 'CardIframe', '12/28');
    });
  });
});
