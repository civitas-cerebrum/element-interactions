import { test, expect } from './fixture/StepFixture';
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
      await steps.navigateTo('/');
      await steps.click( 'tableLink','SidebarNav');
      await steps.verifyUrlContains('/table');
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

    await test.step('getListedElement with text match', async () => {
      const baseLocator = page.locator(repo.getSelector('rows', 'TablePage'));
      const row = await interactions.interact.getListedElement(baseLocator, { text: 'Alice' }, repo);
      const text = await row.textContent();
      expect(text).toContain('Alice');
    });

    await test.step('getListedElement with attribute match', async () => {
      const baseLocator = page.locator(repo.getSelector('rows', 'TablePage'));
      const row = await interactions.interact.getListedElement(baseLocator, {
        attribute: { name: 'data-testid', value: 'table-row-1' }
      }, repo);
      const text = await row.textContent();
      expect(text).toContain('Alice');
    });

    await test.step('getListedElement with child as page-repo reference', async () => {
      const baseLocator = page.locator(repo.getSelector('rows', 'TablePage'));
      const child = await interactions.interact.getListedElement(baseLocator, {
        text: 'Alice',
        child: { pageName: 'TablePage', elementName: 'rowCheckboxes' }
      }, repo);
      expect(child).toBeTruthy();
    });

    await test.step('getListedElement throws when child is page-repo ref but no repo provided', async () => {
      const baseLocator = page.locator(repo.getSelector('rows', 'TablePage'));
      let errorThrown = false;
      try {
        await interactions.interact.getListedElement(baseLocator, {
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
      const baseLocator = page.locator(repo.getSelector('rows', 'TablePage'));
      let errorThrown = false;
      try {
        await interactions.interact.getListedElement(baseLocator, {}, repo);
      } catch (e: unknown) {
        errorThrown = true;
        expect((e as Error).message).toContain('requires either "text" or "attribute"');
      }
      expect(errorThrown).toBe(true);
    });

    log('TC_054 Raw getListedElement — passed');
  });
});
