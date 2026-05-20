import { test, expect } from './fixture/StepFixture';
import { DropdownSelectType, ScreenshotOptions } from '../src/enum/Options';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ──────────────────────────────────────────────────────────────────────────────
// New Methods — TC_055 through TC_071
// ──────────────────────────────────────────────────────────────────────────────

test.describe('TC_055: fillForm — fill multiple fields in one call', () => {

  test('fills text inputs and selects a dropdown', async ({ steps }) => {

    await test.step('Navigate to Forms page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'formsCard','HomePage');
      await steps.verifyUrlContains('/forms');
    });

    await test.step('Fill form with text fields and dropdown', async () => {
      await steps.fillForm('FormsPage', {
        nameInput: 'Fill Form Test',
        emailInput: 'fillform@test.com',
        mobileInput: '1234567890',
        genderDropdown: { type: DropdownSelectType.VALUE, value: 'Male' }
      });
    });

    await test.step('Verify all fields were filled', async () => {
      await steps.verifyInputValue( 'nameInput','FormsPage', 'Fill Form Test');
      await steps.verifyInputValue( 'emailInput','FormsPage', 'fillform@test.com');
      await steps.verifyInputValue( 'mobileInput','FormsPage', '1234567890');
    });

    log('TC_055 fillForm — passed');
  });
});

test.describe('TC_056: clearInput — clear an input field', () => {

  test('fills then clears an input', async ({ steps }) => {

    await test.step('Navigate to Text Inputs page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'textInputsLink','SidebarNav');
      await steps.verifyUrlContains('/text-inputs');
    });

    await test.step('Fill text input', async () => {
      await steps.fill( 'textInput','TextInputsPage', 'Some text to clear');
      await steps.verifyInputValue( 'textInput','TextInputsPage', 'Some text to clear');
    });

    await test.step('Clear input and verify it is empty', async () => {
      await steps.clearInput( 'textInput','TextInputsPage');
      await steps.verifyInputValue( 'textInput','TextInputsPage', '');
    });

    log('TC_056 clearInput — passed');
  });
});

test.describe('TC_057: getInputValue — read input values', () => {

  test('reads pre-populated and user-entered values', async ({ steps }) => {

    await test.step('Navigate to Text Inputs page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'textInputsLink','SidebarNav');
      await steps.verifyUrlContains('/text-inputs');
    });

    await test.step('Read pre-populated error input value', async () => {
      const value = await steps.getInputValue( 'errorInput','TextInputsPage');
      expect(value).toBe('invalid@');
    });

    await test.step('Read pre-populated success input value', async () => {
      const value = await steps.getInputValue( 'successInput','TextInputsPage');
      expect(value).toBe('valid@example.com');
    });

    await test.step('Fill and read back a value', async () => {
      await steps.fill( 'emailInput','TextInputsPage', 'test@example.org');
      const value = await steps.getInputValue( 'emailInput','TextInputsPage');
      expect(value).toBe('test@example.org');
    });

    log('TC_057 getInputValue — passed');
  });
});

test.describe('TC_058: getCount — count elements', () => {

  test('counts categories on home page', async ({ steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('getCount returns 8 categories', async () => {
      const count = await steps.getCount( 'categories','HomePage');
      expect(count).toBe(8);
    });

    log('TC_058 getCount — passed');
  });
});

test.describe('TC_059: getAll — bulk text extraction', () => {

  test('extracts texts and attributes from table rows', async ({ steps }) => {

    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
    });

    await test.step('getAll — basic text extraction from rows', async () => {
      const texts = await steps.getAll( 'rows','TablePage');
      expect(texts.length).toBe(5);
      expect(texts[0]).toContain('Alice Martin');
    });

    await test.step('getAll — with child selector', async () => {
      const names = await steps.getAll( 'rows','TablePage', { child: { pageName: 'TablePage', elementName: 'nameCell' } });
      expect(names).toEqual(['Alice Martin', 'Bob Chen', 'Carol White', 'David Kim', 'Eve Torres']);
    });

    await test.step('getAll — with extractAttribute', async () => {
      const testIds = await steps.getAll( 'rowCheckboxes','TablePage', { extractAttribute: 'data-testid' });
      expect(testIds.length).toBe(5);
      expect(testIds[0]).toContain('table-row-checkbox-');
    });

    log('TC_059 getAll — passed');
  });
});

test.describe('TC_060: getCssProperty — read computed styles', () => {

  test('reads CSS properties from elements', async ({ steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Read display property of page title', async () => {
      const display = await steps.getCssProperty( 'pageTitle','HomePage', 'display');
      expect(display).toBeTruthy();
    });

    await test.step('Read font-size of page title', async () => {
      const fontSize = await steps.getCssProperty( 'pageTitle','HomePage', 'font-size');
      expect(fontSize).toMatch(/\d+px/);
    });

    log('TC_060 getCssProperty — passed');
  });
});

test.describe('TC_061: verifyCssProperty — assert computed styles', () => {

  test('asserts CSS property values', async ({ steps }) => {

    await test.step('Navigate to Text Inputs page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'textInputsLink','SidebarNav');
      await steps.verifyUrlContains('/text-inputs');
    });

    await test.step('Verify display property of text input', async () => {
      const display = await steps.getCssProperty( 'textInput','TextInputsPage', 'display');
      await steps.verifyCssProperty( 'textInput','TextInputsPage', 'display', display);
    });

    log('TC_061 verifyCssProperty — passed');
  });
});

test.describe('TC_062: waitAndClick — wait then click', () => {

  test('waits for visible state then clicks', async ({ steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('waitAndClick on forms card (default: visible)', async () => {
      await steps.waitAndClick( 'formsCard','HomePage');
      await steps.verifyUrlContains('/forms');
    });

    log('TC_062 waitAndClick — passed');
  });
});

test.describe('TC_063: clickNth — click by index', () => {

  test('clicks an element at a specific index', async ({ steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Click the second category card (index 1)', async () => {
      await steps.clickNth( 'categories','HomePage', 1);
      // Should navigate to one of the category pages
      await steps.verifyAbsence( 'categories','HomePage');
    });

    log('TC_063 clickNth — passed');
  });
});

test.describe('TC_064: selectMultiple — select multiple options', () => {

  test('selects multiple values in a multi-select', async ({ steps }) => {

    await test.step('Navigate to Dropdown page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'dropdownLink','SidebarNav');
      await steps.verifyUrlContains('/dropdown');
    });

    await test.step('Select multiple countries', async () => {
      const selected = await steps.selectMultiple( 'multiSelect','DropdownSelectPage', ['Australia', 'Canada', 'France']);
      expect(selected).toContain('Australia');
      expect(selected).toContain('Canada');
      expect(selected).toContain('France');
    });

    log('TC_064 selectMultiple — passed');
  });
});

test.describe('TC_065: verifyListOrder — assert sort direction', () => {

  test('verifies ascending sort on table names', async ({ page, steps }) => {

    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
    });

    await test.step('Default name order is ascending — verify with verifyListOrder', async () => {
      await steps.verifyListOrder( 'nameCell','TablePage', 'asc');
    });

    await test.step('Click Name header twice to sort descending', async () => {
      await steps.click( 'headerName','TablePage');
      await steps.click( 'headerName','TablePage');
    });

    await test.step('Verify descending order with verifyListOrder', async () => {
      await steps.verifyListOrder( 'nameCell','TablePage', 'desc');
    });

    log('TC_065 verifyListOrder — passed');
  });
});

test.describe('TC_066: retryUntil — retry action until verification', () => {

  test('retries clicking until expected state', async ({ steps }) => {

    await test.step('Navigate to Checkboxes page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'checkboxesLink','SidebarNav');
      await steps.verifyUrlContains('/checkboxes');
    });

    await test.step('retryUntil — click checkbox until checked', async () => {
      // First uncheck if already checked
      await steps.uncheck( 'uncheckedCheckbox','CheckboxesPage');
      // Now retry click until it becomes checked
      await steps.retryUntil(
        async () => { await steps.check( 'uncheckedCheckbox','CheckboxesPage'); },
        async () => { await steps.verifyState( 'uncheckedCheckbox','CheckboxesPage', 'checked'); },
        3,
        500
      );
    });

    log('TC_066 retryUntil — passed');
  });
});

test.describe('TC_067: screenshot — page and element screenshots', () => {

  test('captures page and element screenshots', async ({ steps }) => {

    await test.step('Navigate to home page', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Page screenshot (no options)', async () => {
      const buffer = await steps.screenshot();
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    await test.step('Page screenshot with fullPage option', async () => {
      const buffer = await steps.screenshot({ fullPage: true });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    await test.step('Element screenshot', async () => {
      const buffer = await steps.screenshot( 'pageTitle','HomePage');
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    log('TC_067 screenshot — passed');
  });
});

test.describe('TC_068: waitForNetworkIdle — wait for network quiet', () => {

  test('waits for network idle after navigation', async ({ steps }) => {

    await test.step('Navigate and wait for network idle', async () => {
      await steps.navigateTo('/');
      await steps.waitForNetworkIdle();
    });

    await test.step('Page is fully loaded after network idle', async () => {
      await steps.verifyPresence( 'pageTitle','HomePage');
      await steps.verifyCount( 'categories','HomePage', { exactly: 8 });
    });

    log('TC_068 waitForNetworkIdle — passed');
  });
});

test.describe('TC_069: verifyOrder — assert exact element text order', () => {

  test('verifies exact text order of table name cells', async ({ steps }) => {

    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
    });

    await test.step('Verify exact order of names using verifyOrder', async () => {
      await steps.verifyOrder( 'nameCell','TablePage', ['Alice Martin', 'Bob Chen', 'Carol White', 'David Kim', 'Eve Torres']);
    });

    log('TC_069 verifyOrder — passed');
  });
});


// ─── TC_071: waitForResponse ───
test.describe('TC_071: waitForResponse — wait for network response', () => {

  test('waits for a network response during navigation', async ({ steps }) => {

    await test.step('Navigate to home and wait for response on table page load', async () => {
      await steps.navigateTo('/');
    });

    await test.step('Wait for response when navigating to table page', async () => {
      await steps.waitForResponse(/table/, async () => {
        await steps.navigateTo('/table');
      });
    });

    await test.step('Verify table page loaded', async () => {
      await steps.verifyUrlContains('/table');
      await steps.verifyPresence( 'table','TablePage');
    });

    log('TC_071 waitForResponse — passed');
  });
});


// ─── TC_072: expectNoRequest ───
//
// Exercises the proposal's stated use case: a client-side block (HTML5
// `required`) must short-circuit form submission before any XHR fires.
// Tests are self-contained — they route a small validated form into the
// browser and stub the form's submit endpoint, so they don't depend on the
// vue-test-app having any particular validated form.
test.describe('TC_072: expectNoRequest — HTML5 form block', () => {

  const FORM_HTML = `<!DOCTYPE html>
<html>
  <body>
    <form id="signup-form">
      <input id="email-input" name="email" type="email" required />
      <button id="submit-btn" type="submit">Sign up</button>
    </form>
    <script>
      // HTML5 validation runs BEFORE the submit event fires, so this handler
      // only runs when the form is valid. preventDefault keeps the page from
      // navigating to the fetch response.
      document.getElementById('signup-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await fetch('/api/signup', {
          method: 'POST',
          body: new URLSearchParams(new FormData(e.target)),
        });
      });
    </script>
  </body>
</html>`;

  async function mountForm(page: import('@playwright/test').Page) {
    // Serve the form HTML on a routed path so the form's relative POST target
    // (`/api/signup`) resolves against a real page URL — `page.setContent` on
    // about:blank can't issue relative fetches.
    await page.route('**/expectNoRequest-test-form', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: FORM_HTML }),
    );
    // Stub the form's submit endpoint so the POST has somewhere to land.
    // Registered before expectNoRequest so its handler runs AFTER ours
    // (Playwright dispatches last-added first) — our observer calls
    // route.continue() and this handler then fulfills.
    await page.route('**/api/signup', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' }),
    );
    await page.goto('/expectNoRequest-test-form');
  }

  test('passes when HTML5 required blocks an empty form submit', async ({ page, steps }) => {

    await test.step('Mount the validated form', async () => {
      await mountForm(page);
    });

    await test.step('Submit the empty form — HTML5 should block, no POST should fire', async () => {
      // Email field left empty → HTML5 `required` rejects → submit event
      // never fires → no fetch is issued. expectNoRequest must pass.
      await steps.expectNoRequest('**/api/signup', async () => {
        await page.click('#submit-btn');
      }, { timeout: 500 });
    });

    log('TC_072 expectNoRequest (HTML5 block) — passed');
  });

  test('throws loudly when the same submit is allowed through', async ({ page, steps }) => {

    await test.step('Mount the validated form and fill the required field', async () => {
      await mountForm(page);
      await page.fill('#email-input', 'user@example.com');
    });

    await test.step('Submit the filled form — POST fires, expectNoRequest must reject', async () => {
      let captured: Error | undefined;
      try {
        await steps.expectNoRequest('**/api/signup', async () => {
          await page.click('#submit-btn');
        }, { timeout: 500 });
      } catch (e) {
        captured = e as Error;
      }

      expect(captured, 'expectNoRequest should reject when the matching POST fires').toBeDefined();
      expect(captured!.message).toMatch(/expectNoRequest failed:/);
      // Failure message must name the offending request so the user sees
      // which call slipped through — the assertion's main load-bearing UX.
      expect(captured!.message).toMatch(/POST .*\/api\/signup/);
    });

    log('TC_072 expectNoRequest (allowed-through, throws) — passed');
  });

  test('honors the `methods` filter — non-listed methods are ignored', async ({ page, steps }) => {

    await test.step('Mount the validated form and fill the required field', async () => {
      await mountForm(page);
      await page.fill('#email-input', 'user@example.com');
    });

    await test.step('Submit fires a POST — assertion scoped to GET should pass', async () => {
      // Submit fires POST /api/signup. Restricting methods to GET means the
      // POST is ignored by the filter — the bucket stays empty, assertion passes.
      await steps.expectNoRequest('**/api/signup', async () => {
        await page.click('#submit-btn');
      }, { timeout: 500, methods: ['GET'] });
    });

    log('TC_072 expectNoRequest (methods filter) — passed');
  });

  test('redactQuery scrubs query strings from the failure message', async ({ page, steps }) => {

    const SECRET = 'TOKEN_SECRET_REDACT_TEST_PAYLOAD';

    await test.step('Mount the form page and stub a separate signed-download endpoint', async () => {
      await mountForm(page);
      // Glob `**/api/signed-download**` so the query string doesn't prevent
      // the stub from fulfilling.
      await page.route('**/api/signed-download**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' }),
      );
    });

    await test.step('With redactQuery: true — the secret must NOT appear in the error', async () => {
      let scrubbed: Error | undefined;
      try {
        await steps.expectNoRequest(/\/api\/signed-download/, async () => {
          await page.evaluate((u) => fetch(u), `/api/signed-download?token=${SECRET}`);
        }, { timeout: 500, redactQuery: true });
      } catch (e) {
        scrubbed = e as Error;
      }
      expect(scrubbed, 'expectNoRequest should reject when the matching fetch fires').toBeDefined();
      expect(scrubbed!.message).not.toContain(SECRET);
      expect(scrubbed!.message).toMatch(/\?…\(redacted\)/);
    });

    await test.step('Without redactQuery (default) — the full URL is shown, proving the opt-in is the only safe path for secret-bearing URLs', async () => {
      let plain: Error | undefined;
      try {
        await steps.expectNoRequest(/\/api\/signed-download/, async () => {
          await page.evaluate((u) => fetch(u), `/api/signed-download?token=${SECRET}`);
        }, { timeout: 500 });
      } catch (e) {
        plain = e as Error;
      }
      expect(plain, 'expectNoRequest should reject when the matching fetch fires').toBeDefined();
      expect(plain!.message).toContain(SECRET);
    });

    log('TC_072 expectNoRequest (redactQuery) — passed');
  });
});
