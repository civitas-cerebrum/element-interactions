import { test, expect } from './fixture/StepFixture';
import { WebElement } from '@civitas-cerebrum/element-repository';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ──────────────────────────────────────────────────────────────────────────────
// Listed Element Methods
// ──────────────────────────────────────────────────────────────────────────────

test.describe('TC_051: clickListedElement', () => {

  test('all identification and child-targeting variants', async ({ steps }) => {

    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
    });

    await test.step('Click by text', async () => {
      await steps.clickListedElement( 'rows','TablePage', { text: 'Alice' });
    });

    await test.step('Click by text + child CSS selector', async () => {
      await steps.clickListedElement( 'rows','TablePage', {
        text: 'Alice',
        child: 'td:nth-child(2)'
      });
    });

    await test.step('Click by attribute', async () => {
      await steps.navigateTo('/');
      await steps.clickListedElement( 'categories','HomePage', {
        attribute: { name: 'data-testid', value: 'home-card-forms' }
      });
      await steps.verifyUrlContains('/forms');
    });

    await test.step('Click by attribute + child CSS selector', async () => {
      // Verify the targeting is actually correct by extracting text from the
      // SAME child selector + attribute match, proving the cell we'd click
      // contains the expected row's name — a tautological `verifyPresence` on
      // rows would pass whether this resolution targeted anything or not.
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
      const cellText = await steps.getListedElementData( 'rows','TablePage', {
        attribute: { name: 'data-testid', value: 'table-row-1' },
        child: 'td:nth-child(2)'
      });
      expect(cellText).toBe('Alice Martin');
      await steps.clickListedElement( 'rows','TablePage', {
        attribute: { name: 'data-testid', value: 'table-row-1' },
        child: 'td:nth-child(2)'
      });
    });

    log('TC_051 clickListedElement — passed');
  });
});

test.describe('TC_052: verifyListedElement', () => {

  test('all verification variants', async ({ steps }) => {

    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
    });

    await test.step('Verify presence by text (no assertion fields)', async () => {
      await steps.verifyListedElement( 'rows','TablePage', { text: 'Alice' });
    });

    await test.step('Verify expectedText on matched element (no child)', async () => {
      await steps.navigateTo('/');
      await steps.verifyListedElement( 'categories','HomePage', {
        text: 'Forms',
        expectedText: 'Forms5 components'
      });
    });

    await test.step('Verify expectedText on a child element (text + child + expectedText)', async () => {
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
      await steps.verifyListedElement( 'rows','TablePage', {
        text: 'Alice',
        child: 'td:nth-child(2)',
        expectedText: 'Alice Martin'
      });
    });

    await test.step('Verify expected attribute by text match', async () => {
      await steps.verifyListedElement( 'rows','TablePage', {
        text: 'Alice',
        expected: { name: 'data-testid', value: 'table-row-1' }
      });
    });

    await test.step('Verify expected attribute by attribute match', async () => {
      await steps.navigateTo('/');
      await steps.verifyListedElement( 'categories','HomePage', {
        attribute: { name: 'data-testid', value: 'home-card-forms' },
        expected: { name: 'data-testid', value: 'home-card-forms' }
      });
    });

    await test.step('Verify expectedText on child via attribute match', async () => {
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
      await steps.verifyListedElement( 'rows','TablePage', {
        attribute: { name: 'data-testid', value: 'table-row-1' },
        child: 'td:nth-child(2)',
        expectedText: 'Alice Martin'
      });
    });

    await test.step('Verify presence by attribute (no assertion fields)', async () => {
      await steps.verifyListedElement( 'rows','TablePage', {
        attribute: { name: 'data-testid', value: 'table-row-1' }
      });
    });

    log('TC_052 verifyListedElement — passed');
  });
});

test.describe('TC_053: getListedElementData', () => {

  test('all extraction variants', async ({ steps }) => {

    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
    });

    await test.step('Extract text by text match (no child)', async () => {
      const text = await steps.getListedElementData( 'rows','TablePage', { text: 'Alice' });
      expect(text).toContain('Alice');
    });

    await test.step('Extract text from child by text match (text + child)', async () => {
      const name = await steps.getListedElementData( 'rows','TablePage', {
        text: 'Alice',
        child: 'td:nth-child(2)'
      });
      expect(name).toBe('Alice Martin');
    });

    await test.step('Extract attribute by text match (text + extractAttribute)', async () => {
      const testId = await steps.getListedElementData( 'rows','TablePage', {
        text: 'Alice',
        extractAttribute: 'data-testid'
      });
      expect(testId).toBe('table-row-1');
    });

    await test.step('Extract text by attribute match (attribute only)', async () => {
      const text = await steps.getListedElementData( 'rows','TablePage', {
        attribute: { name: 'data-testid', value: 'table-row-1' }
      });
      expect(text).toContain('Alice');
    });

    await test.step('Extract attribute from child by attribute match (attribute + child + extractAttribute)', async () => {
      await steps.navigateTo('/');
      const testId = await steps.getListedElementData( 'categories','HomePage', {
        text: 'Forms',
        extractAttribute: 'data-testid'
      });
      expect(testId).toBe('home-card-forms');
    });

    await test.step('Extract text from child by attribute match (attribute + child)', async () => {
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
      const name = await steps.getListedElementData( 'rows','TablePage', {
        attribute: { name: 'data-testid', value: 'table-row-1' },
        child: 'td:nth-child(2)'
      });
      expect(name).toBe('Alice Martin');
    });

    log('TC_053 getListedElementData — passed');
  });
});

test.describe('TC_054: getListedElement (raw) — child variants and error cases', () => {

  test('child page-repo reference and error handling', async ({ page, repo, steps, interactions }) => {

    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
    });

    const baseElement = () => new WebElement(page.locator(repo.getSelector('rows', 'TablePage')));

    await test.step('getListedElement with text match', async () => {
      const row = await interactions.interact.getListedElement(baseElement(), { text: 'Alice' }, repo);
      const text = await row.textContent();
      expect(text).toContain('Alice');
    });

    await test.step('getListedElement with attribute match', async () => {
      const row = await interactions.interact.getListedElement(baseElement(), {
        attribute: { name: 'data-testid', value: 'table-row-1' }
      }, repo);
      const text = await row.textContent();
      expect(text).toContain('Alice');
    });

    await test.step('getListedElement with child as page-repo reference', async () => {
      const child = await interactions.interact.getListedElement(baseElement(), {
        text: 'Alice',
        child: { pageName: 'TablePage', elementName: 'rowCheckboxes' }
      }, repo);
      expect(child).toBeTruthy();
    });

    await test.step('getListedElement throws when child is page-repo ref but no repo provided', async () => {
      let errorThrown = false;
      try {
        await interactions.interact.getListedElement(baseElement(), {
          text: 'Alice',
          child: { pageName: 'TablePage', elementName: 'rowCheckboxes' }
        });
      } catch (e: unknown) {
        errorThrown = true;
        expect((e as Error).message).toContain('ElementRepository instance is required');
      }
      expect(errorThrown).toBe(true);
    });

    await test.step('getListedElement throws when neither text nor attribute provided', async () => {
      let errorThrown = false;
      try {
        await interactions.interact.getListedElement(baseElement(), {}, repo);
      } catch (e: unknown) {
        errorThrown = true;
        expect((e as Error).message).toContain('requires "text", "attribute", or "withDescendant"');
      }
      expect(errorThrown).toBe(true);
    });

    log('TC_054 Raw getListedElement — passed');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// TC_089: Listed-element regex + descendant filter (#69)
// ──────────────────────────────────────────────────────────────────────────────

test.describe('TC_089: ListedElementMatch — regex + withDescendant', () => {

  test('regex text match picks any of several candidates', async ({ steps }) => {
    await test.step('clickListedElement with regex alternation navigates to one of the matched categories', async () => {
      // HomePage has Forms / Buttons / Text Inputs / etc. as category cards. Regex alternation
      // must match ONE of them and click it, navigating away from home. If the regex didn't
      // resolve to a real element, `verifyAbsence` below would fail (categories would still be
      // visible on home).
      await steps.navigateTo('/');
      await steps.clickListedElement( 'categories','HomePage', {
        text: { regex: 'Forms|Text Inputs|Buttons', flags: 'i' },
      });
      await steps.verifyAbsence( 'categories','HomePage');
    });

    await test.step('getListedElementData with regex text returns the matched row text', async () => {
      // getListedElementData proves the regex path extracts the right element's text.
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
      const cellText = await steps.getListedElementData( 'rows','TablePage', {
        text: { regex: 'Alice|Bob', flags: 'i' },
        child: 'td:nth-child(2)',
      });
      expect(cellText).toMatch(/Alice|Bob/i);
    });
  });

  test('regex attribute match narrows by attribute value pattern', async ({ steps }) => {
    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
    });

    await test.step('verifyListedElement with regex attribute value', async () => {
      // Table rows carry data-testid="table-row-N" — match any row by /^table-row-/.
      await steps.verifyListedElement( 'rows','TablePage', {
        attribute: { name: 'data-testid', value: { regex: '^table-row-\\d+$' } },
      });
    });
  });

  test('withDescendant filters items by a child repo reference', async ({ steps }) => {
    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
    });

    await test.step('Pick the row whose nameCell text matches "Alice"', async () => {
      // The outer listed element is `rows`; we want "the row whose nameCell descendant
      // contains Alice". Previously this required a manual page.locator().filter() call.
      const cellText = await steps.getListedElementData( 'rows','TablePage', {
        withDescendant: {
          child: { pageName: 'TablePage', elementName: 'nameCell' },
          text: { regex: 'Alice', flags: 'i' },
        },
        child: 'td:nth-child(2)',
      });
      expect(cellText).toBe('Alice Martin');
    });
  });

  test('withDescendant without `text` filters items that merely HAVE the descendant', async ({ steps }) => {
    await test.step('Navigate to Table page', async () => {
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
    });

    await test.step('verifyListedElement — rows that have a nameCell descendant', async () => {
      await steps.verifyListedElement( 'rows','TablePage', {
        withDescendant: { child: { pageName: 'TablePage', elementName: 'nameCell' } },
      });
    });
  });

  test('throws when no matching criterion is provided', async ({ page, repo, interactions }) => {
    await interactions.navigate.toUrl('/table');
    const base = new WebElement(page.locator(repo.getSelector('rows', 'TablePage')));
    let errorThrown = false;
    try {
      await interactions.interact.getListedElement(base, {}, repo);
    } catch (e: unknown) {
      errorThrown = true;
      expect((e as Error).message).toContain('requires "text", "attribute", or "withDescendant"');
    }
    expect(errorThrown).toBe(true);
  });

  test('regex attribute match throws when no candidate matches the pattern', async ({ page, repo, interactions }) => {
    await interactions.navigate.toUrl('/table');
    const base = new WebElement(page.locator(repo.getSelector('rows', 'TablePage')));
    let errorThrown = false;
    try {
      await interactions.interact.getListedElement(base, {
        attribute: { name: 'data-testid', value: { regex: '^nonexistent-row-pattern-' } },
      }, repo);
    } catch (e: unknown) {
      errorThrown = true;
      expect((e as Error).message).toContain('No listed element found with attribute');
    }
    expect(errorThrown).toBe(true);
  });
});
