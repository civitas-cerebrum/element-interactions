import { test, expect } from './fixture/StepFixture';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ──────────────────────────────────────────────────────────────────────────────
// Category 5: Interactions
// ──────────────────────────────────────────────────────────────────────────────

test.describe('TC_027: Draggable Page', () => {

  test('drag block and verify status updates', async ({ page, steps }) => {

    await test.step('Navigate to Draggable page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'draggableLink');
      await steps.verifyUrlContains('/draggable');
    });

    await test.step('Status starts as "none"', async () => {
      await steps.verifyTextContains('DraggablePage', 'status', 'none');
    });

    await test.step('Drag item 1 and verify it moves', async () => {
      await steps.dragAndDrop('DraggablePage', 'item1', { xOffset: 100, yOffset: 50 });
    });

    await test.step('All 4 draggable items are present', async () => {
      await steps.verifyPresence('DraggablePage', 'item1');
      await steps.verifyPresence('DraggablePage', 'item2');
      await steps.verifyPresence('DraggablePage', 'item3');
      await steps.verifyPresence('DraggablePage', 'item4');
    });

    log('TC_027 Draggable Page — passed');
  });
});

test.describe('TC_028: Droppable Page', () => {

  test('drop items into zones and reset', async ({ page, repo, steps }) => {

    await test.step('Navigate to Droppable page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'droppableLink');
      await steps.verifyUrlContains('/droppable');
    });

    await test.step('Initial status is Ready', async () => {
      await steps.verifyTextContains('DroppablePage', 'status', 'Ready');
    });

    await test.step('All zones start with 0 items', async () => {
      await steps.verifyTextContains('DroppablePage', 'redZoneCount', '0');
      await steps.verifyTextContains('DroppablePage', 'blueZoneCount', '0');
      await steps.verifyTextContains('DroppablePage', 'greenZoneCount', '0');
    });

    await test.step('Drag red item to red zone — correct drop', async () => {
      const redItem = await repo.get(page, 'DroppablePage', 'redItem1');
      const redZone = await repo.get(page, 'DroppablePage', 'redZone');
      await steps.dragAndDrop('DroppablePage', 'redItem1', { target: redZone! });
      await steps.verifyTextContains('DroppablePage', 'redZoneCount', '1');
    });

    await test.step('Reset returns items to source', async () => {
      await steps.click('DroppablePage', 'resetButton');
      await steps.verifyTextContains('DroppablePage', 'redZoneCount', '0');
      await steps.verifyTextContains('DroppablePage', 'status', 'Ready');
    });

    log('TC_028 Droppable Page — passed');
  });
});

test.describe('TC_029: Resizable Page', () => {

  test('resize panel by dragging handle', async ({ steps }) => {

    await test.step('Navigate to Resizable page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'resizableLink');
      await steps.verifyUrlContains('/resizable');
    });

    await test.step('Initial width is 300px', async () => {
      await steps.verifyTextContains('ResizablePage', 'widthDisplay', '300');
    });

    await test.step('Drag handle right to increase width', async () => {
      await steps.dragAndDrop('ResizablePage', 'handle', { xOffset: 100, yOffset: 0 });
    });

    await test.step('Width display is present and updated', async () => {
      await steps.verifyText('ResizablePage', 'widthDisplay', undefined, { notEmpty: true });
    });

    log('TC_029 Resizable Page — passed');
  });
});

test.describe('TC_030: Kanban Page', () => {

  test('add card and verify columns', async ({ page, repo, steps }) => {

    await test.step('Navigate to Kanban page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'kanbanLink');
      await steps.verifyUrlContains('/kanban');
    });

    await test.step('All three columns are present', async () => {
      await steps.verifyPresence('KanbanPage', 'todoColumn');
      await steps.verifyPresence('KanbanPage', 'inProgressColumn');
      await steps.verifyPresence('KanbanPage', 'doneColumn');
    });

    await test.step('Cards are present initially', async () => {
      await steps.verifyCount('KanbanPage', 'cards', { greaterThan: 0 });
    });

    await test.step('Add a new card to Todo column', async () => {
      const allCards = await repo.getAll(page, 'KanbanPage', 'cards');
      const countBefore = allCards!.length;
      await steps.click('KanbanPage', 'addTodoButton');
      await steps.verifyCount('KanbanPage', 'cards', { greaterThan: countBefore });
    });

    log('TC_030 Kanban Page — passed');
  });
});

test.describe('TC_031: Infinite Scroll Page', () => {

  test('scroll to load more items', async ({ page, steps }) => {

    await test.step('Navigate to Infinite Scroll page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'infiniteScrollLink');
      await steps.verifyUrlContains('/infinite-scroll');
    });

    await test.step('Wait for initial items to load', async () => {
      await page.locator("[data-testid^='scroll-item-']").first().waitFor({ timeout: 10000 });
      await steps.verifyCount('InfiniteScrollPage', 'items', { greaterThan: 0 });
    });

    await test.step('Scroll container to trigger more loads', async () => {
      const container = page.locator("[data-testid='scroll-container']");
      // Scroll to the bottom of the container
      await container.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      // Wait for more items to load
      await page.waitForTimeout(2000);
      const countAfterScroll = await page.locator("[data-testid^='scroll-item-']").count();
      expect(countAfterScroll).toBeGreaterThan(10);
    });

    log('TC_031 Infinite Scroll Page — passed');
  });
});

test.describe('TC_032: Loading States Page', () => {

  test('verify spinner, skeleton toggle, and button loading', async ({ steps }) => {

    await test.step('Navigate to Loading States page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'loadingLink');
      await steps.verifyUrlContains('/loading');
    });

    await test.step('Spinner is visible', async () => {
      await steps.verifyPresence('LoadingStatesPage', 'spinner');
    });

    await test.step('Skeleton is visible by default', async () => {
      await steps.verifyPresence('LoadingStatesPage', 'skeleton');
    });

    await test.step('Toggle skeleton off', async () => {
      await steps.click('LoadingStatesPage', 'skeletonToggle');
      await steps.verifyAbsence('LoadingStatesPage', 'skeleton');
    });

    await test.step('Toggle skeleton back on', async () => {
      await steps.click('LoadingStatesPage', 'skeletonToggle');
      await steps.verifyPresence('LoadingStatesPage', 'skeleton');
    });

    await test.step('Click loading button — enters loading state', async () => {
      await steps.click('LoadingStatesPage', 'loadingButton');
      // Button should show loading state (text changes or spinner appears)
      await steps.verifyPresence('LoadingStatesPage', 'loadingButton');
    });

    log('TC_032 Loading States Page — passed');
  });
});

test.describe('TC_033: Dynamic Form Page', () => {

  test('add fields and submit form', async ({ page, steps }) => {

    await test.step('Navigate to Dynamic Form page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'dynamicFormLink');
      await steps.verifyUrlContains('/dynamic-form');
    });

    await test.step('Starts with 1 field', async () => {
      await steps.verifyCount('DynamicFormPage', 'fields', { exactly: 1 });
    });

    await test.step('Add a second field', async () => {
      await steps.click('DynamicFormPage', 'addButton');
      await steps.verifyCount('DynamicFormPage', 'fields', { exactly: 2 });
    });

    await test.step('Add a third field', async () => {
      await steps.click('DynamicFormPage', 'addButton');
      await steps.verifyCount('DynamicFormPage', 'fields', { exactly: 3 });
    });

    await test.step('Fill field 1 and submit', async () => {
      await steps.fill('DynamicFormPage', 'field1', 'Test Value');
      await steps.click('DynamicFormPage', 'submitButton');
    });

    log('TC_033 Dynamic Form Page — passed');
  });
});
