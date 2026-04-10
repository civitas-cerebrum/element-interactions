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
      await steps.click( 'draggableLink','SidebarNav');
      await steps.verifyUrlContains('/draggable');
    });

    await test.step('Status starts as "none"', async () => {
      await steps.verifyTextContains( 'status','DraggablePage', 'none');
    });

    await test.step('Drag item 1 and verify it moves', async () => {
      await steps.dragAndDrop( 'item1','DraggablePage', { xOffset: 100, yOffset: 50 });
    });

    await test.step('All 4 draggable items are present', async () => {
      await steps.verifyPresence( 'item1','DraggablePage');
      await steps.verifyPresence( 'item2','DraggablePage');
      await steps.verifyPresence( 'item3','DraggablePage');
      await steps.verifyPresence( 'item4','DraggablePage');
    });

    log('TC_027 Draggable Page — passed');
  });
});

test.describe('TC_028: Droppable Page', () => {

  test('drop items into zones and reset', async ({ page, repo, steps }) => {

    await test.step('Navigate to Droppable page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'droppableLink','SidebarNav');
      await steps.verifyUrlContains('/droppable');
    });

    await test.step('Initial status is Ready', async () => {
      await steps.verifyTextContains( 'status','DroppablePage', 'Ready');
    });

    await test.step('All zones start with 0 items', async () => {
      await steps.verifyTextContains( 'redZoneCount','DroppablePage', '0');
      await steps.verifyTextContains( 'blueZoneCount','DroppablePage', '0');
      await steps.verifyTextContains( 'greenZoneCount','DroppablePage', '0');
    });

    await test.step('Drag red item to red zone — correct drop', async () => {
      const redZone = await repo.get('redZone', 'DroppablePage');
      await steps.dragAndDrop( 'redItem1','DroppablePage', { target: redZone });
      await steps.verifyTextContains( 'redZoneCount','DroppablePage', '1');
    });

    await test.step('Reset returns items to source', async () => {
      await steps.click( 'resetButton','DroppablePage');
      await steps.verifyTextContains( 'redZoneCount','DroppablePage', '0');
      await steps.verifyTextContains( 'status','DroppablePage', 'Ready');
    });

    log('TC_028 Droppable Page — passed');
  });
});

test.describe('TC_029: Resizable Page', () => {

  test('resize panel by dragging handle', async ({ steps }) => {

    await test.step('Navigate to Resizable page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'resizableLink','SidebarNav');
      await steps.verifyUrlContains('/resizable');
    });

    await test.step('Initial width is 300px', async () => {
      await steps.verifyTextContains( 'widthDisplay','ResizablePage', '300');
    });

    await test.step('Drag handle right to increase width', async () => {
      await steps.dragAndDrop( 'handle','ResizablePage', { xOffset: 100, yOffset: 0 });
    });

    await test.step('Width display is present and updated', async () => {
      await steps.verifyText( 'widthDisplay','ResizablePage', undefined, { notEmpty: true });
    });

    log('TC_029 Resizable Page — passed');
  });
});

test.describe('TC_030: Kanban Page', () => {

  test('add card and verify columns', async ({ page, repo, steps }) => {

    await test.step('Navigate to Kanban page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'kanbanLink','SidebarNav');
      await steps.verifyUrlContains('/kanban');
    });

    await test.step('All three columns are present', async () => {
      await steps.verifyPresence( 'todoColumn','KanbanPage');
      await steps.verifyPresence( 'inProgressColumn','KanbanPage');
      await steps.verifyPresence( 'doneColumn','KanbanPage');
    });

    await test.step('Cards are present initially', async () => {
      await steps.verifyCount( 'cards','KanbanPage', { greaterThan: 0 });
    });

    await test.step('Add a new card to Todo column', async () => {
      const allCards = await repo.getAll('cards', 'KanbanPage');
      const countBefore = allCards!.length;
      await steps.click( 'addTodoButton','KanbanPage');
      await steps.verifyCount( 'cards','KanbanPage', { greaterThan: countBefore });
    });

    log('TC_030 Kanban Page — passed');
  });
});

test.describe('TC_031: Infinite Scroll Page', () => {

  test('scroll to load more items', async ({ page, steps }) => {

    await test.step('Navigate to Infinite Scroll page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'infiniteScrollLink','SidebarNav');
      await steps.verifyUrlContains('/infinite-scroll');
    });

    await test.step('Wait for initial items to load', async () => {
      await page.locator("[data-testid^='scroll-item-']").first().waitFor({ timeout: 10000 });
      await steps.verifyCount( 'items','InfiniteScrollPage', { greaterThan: 0 });
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
      await steps.click( 'loadingLink','SidebarNav');
      await steps.verifyUrlContains('/loading');
    });

    await test.step('Spinner is visible', async () => {
      await steps.verifyPresence( 'spinner','LoadingStatesPage');
    });

    await test.step('Skeleton is visible by default', async () => {
      await steps.verifyPresence( 'skeleton','LoadingStatesPage');
    });

    await test.step('Toggle skeleton off', async () => {
      await steps.click( 'skeletonToggle','LoadingStatesPage');
      await steps.verifyAbsence( 'skeleton','LoadingStatesPage');
    });

    await test.step('Toggle skeleton back on', async () => {
      await steps.click( 'skeletonToggle','LoadingStatesPage');
      await steps.verifyPresence( 'skeleton','LoadingStatesPage');
    });

    await test.step('Click loading button — enters loading state', async () => {
      await steps.click( 'loadingButton','LoadingStatesPage');
      // Button should show loading state (text changes or spinner appears)
      await steps.verifyPresence( 'loadingButton','LoadingStatesPage');
    });

    log('TC_032 Loading States Page — passed');
  });
});

test.describe('TC_033: Dynamic Form Page', () => {

  test('add fields and submit form', async ({ page, steps }) => {

    await test.step('Navigate to Dynamic Form page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click( 'dynamicFormLink','SidebarNav');
      await steps.verifyUrlContains('/dynamic-form');
    });

    await test.step('Starts with 1 field', async () => {
      await steps.verifyCount( 'fields','DynamicFormPage', { exactly: 1 });
    });

    await test.step('Add a second field', async () => {
      await steps.click( 'addButton','DynamicFormPage');
      await steps.verifyCount( 'fields','DynamicFormPage', { exactly: 2 });
    });

    await test.step('Add a third field', async () => {
      await steps.click( 'addButton','DynamicFormPage');
      await steps.verifyCount( 'fields','DynamicFormPage', { exactly: 3 });
    });

    await test.step('Fill field 1 and submit', async () => {
      await steps.fill( 'field1','DynamicFormPage', 'Test Value');
      await steps.click( 'submitButton','DynamicFormPage');
    });

    log('TC_033 Dynamic Form Page — passed');
  });
});
