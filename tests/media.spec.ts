import { test, expect } from './fixture/StepFixture';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ──────────────────────────────────────────────────────────────────────────────
// Category 6: Media
// ──────────────────────────────────────────────────────────────────────────────

test.describe('TC_034: Gallery Page', () => {

  test('verify gallery images and lightbox', async ({ page, steps }) => {

    await test.step('Navigate to Gallery page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'galleryLink');
      await steps.verifyUrlContains('/gallery');
    });

    await test.step('8 gallery items rendered', async () => {
      const items = page.locator("[data-testid^='gallery-item-']");
      await expect(items).toHaveCount(8);
    });

    await test.step('Click image to open lightbox', async () => {
      await page.locator("[data-testid='gallery-item-1']").click();
      const overlay = page.locator("[data-testid='gallery-overlay']");
      await overlay.waitFor({ state: 'visible', timeout: 5000 });
    });

    await test.step('Close lightbox', async () => {
      const closeButton = page.locator("[data-testid='gallery-close']");
      await closeButton.click();
      const overlay = page.locator("[data-testid='gallery-overlay']");
      await overlay.waitFor({ state: 'hidden', timeout: 5000 });
    });

    log('TC_034 Gallery Page — passed');
  });
});

test.describe('TC_035: Carousel Page', () => {

  test('navigate slides with buttons and dots', async ({ steps }) => {

    await test.step('Navigate to Carousel page via sidebar', async () => {
      await steps.navigateTo('/');
      await steps.click('SidebarNav', 'carouselLink');
      await steps.verifyUrlContains('/carousel');
    });

    await test.step('First slide visible on load', async () => {
      await steps.verifyPresence('CarouselPage', 'slide1');
    });

    await test.step('Click Next — slide advances', async () => {
      await steps.click('CarouselPage', 'nextButton');
      await steps.verifyPresence('CarouselPage', 'slide2');
    });

    await test.step('Click Previous — goes back', async () => {
      await steps.click('CarouselPage', 'prevButton');
      await steps.verifyPresence('CarouselPage', 'slide1');
    });

    await test.step('Click dot 2 — jumps to slide 2', async () => {
      await steps.click('CarouselPage', 'dot2');
      await steps.verifyPresence('CarouselPage', 'slide2');
    });

    await test.step('Autoplay toggle is present', async () => {
      await steps.verifyPresence('CarouselPage', 'autoplayButton');
    });

    log('TC_035 Carousel Page — passed');
  });
});
