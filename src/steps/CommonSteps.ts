import { Page } from '@playwright/test';
import { ElementRepository } from 'pw-element-repository';
import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { DropdownSelectOptions, TextVerifyOptions, CountVerifyOptions, DragAndDropOptions } from '../enum/Options';
import { createLogger } from '../logger/Logger';

const logger = (type: string) => createLogger(`${type}`);

const log = {
  navigate: logger('navigate'),
  interact: logger('interact'),
  extract:  logger('extract'),
  verify:   logger('verify'),
  wait:     logger('wait'),
};

/**
 * The `Steps` class serves as a unified Facade for test orchestration.
 * It combines element acquisition (via `pw-element-repository`) with
 * Playwright interactions, navigation, and verifications to keep test files clean,
 * readable, and free of raw locators.
 */
export class Steps {
    private interact;
    private navigate;
    private extract;
    private verify;
    private utils;

    /**
     * Initializes the Steps class with the required Playwright page and element repository.
     * @param page - The current Playwright Page object.
     * @param repo - An initialized instance of `ElementRepository` containing your locators.
     * @param timeout - Optional global timeout override (in milliseconds).
     */
    constructor(
        private page: Page,
        private repo: ElementRepository,
        timeout?: number
    ) {
        const interactions = new ElementInteractions(page, timeout);
        this.interact = interactions.interact;
        this.navigate = interactions.navigate;
        this.extract = interactions.extract;
        this.verify = interactions.verify;
        this.utils = interactions.utils;
    }

    // ==========================================
    // 🧭 NAVIGATION STEPS
    // ==========================================

    async navigateTo(url: string): Promise<void> {
        log.navigate('Navigating to URL: "%s"', url);
        await this.navigate.toUrl(url);
    }

    async refresh(): Promise<void> {
        log.navigate('Refreshing the current page');
        await this.navigate.reload();
    }

    async backOrForward(direction: 'BACKWARDS' | 'FORWARDS'): Promise<void> {
        log.navigate('Navigating browser: "%s"', direction);
        await this.navigate.backOrForward(direction);
    }

    async setViewport(width: number, height: number): Promise<void> {
        log.navigate('Setting viewport to %dx%d', width, height);
        await this.navigate.setViewport(width, height);
    }

    // ==========================================
    // 🖱️ INTERACTION STEPS
    // ==========================================

    async click(pageName: string, elementName: string): Promise<void> {
        log.interact('Clicking on "%s" in "%s"', elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.click(locator);
    }

    async clickWithoutScrolling(pageName: string, elementName: string): Promise<void> {
        log.interact('Clicking (no scroll) on "%s" in "%s"', elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.clickWithoutScrolling(locator);
    }

    async clickRandom(pageName: string, elementName: string): Promise<void> {
        log.interact('Clicking a random element from "%s" in "%s"', elementName, pageName);
        const locator = await this.repo.getRandom(this.page, pageName, elementName);
        await this.interact.click(locator!);
    }

    async clickIfPresent(pageName: string, elementName: string): Promise<void> {
        log.interact('Clicking on "%s" in "%s" (if present)', elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.clickIfPresent(locator);
    }

    async hover(pageName: string, elementName: string): Promise<void> {
        log.interact('Hovering over "%s" in "%s"', elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.hover(locator);
    }

    async scrollIntoView(pageName: string, elementName: string): Promise<void> {
        log.interact('Scrolling "%s" in "%s" into view', elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.scrollIntoView(locator);
    }

    async fill(pageName: string, elementName: string, text: string): Promise<void> {
        log.interact('Filling "%s" in "%s" with text: "%s"', elementName, pageName, text);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.fill(locator, text);
    }

    async uploadFile(pageName: string, elementName: string, filePath: string): Promise<void> {
        log.interact('Uploading file "%s" to "%s" in "%s"', filePath, elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.uploadFile(locator, filePath);
    }

    async selectDropdown(
        pageName: string,
        elementName: string,
        options?: DropdownSelectOptions
    ): Promise<string> {
        log.interact('Selecting dropdown option for "%s" in "%s" using options: %O', elementName, pageName, options ?? 'default (random)');
        const locator = await this.repo.get(this.page, pageName, elementName);
        return await this.interact.selectDropdown(locator, options);
    }

    async dragAndDrop(pageName: string, elementName: string, options: DragAndDropOptions): Promise<void> {
        log.interact('Dragging and dropping "%s" in "%s"', elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.dragAndDrop(locator, options);
    }

    async dragAndDropListedElement(pageName: string, elementName: string, elementText: string, options: DragAndDropOptions): Promise<void> {
        log.interact('Dragging and dropping "%s" in "%s"', elementText, pageName);
        const locator = await this.repo.getByText(this.page, pageName, elementName, elementText);
        await this.interact.dragAndDrop(locator!, options);
    }

    // ==========================================
    // 📊 DATA EXTRACTION STEPS
    // ==========================================

    async getText(pageName: string, elementName: string): Promise<string | null> {
        log.extract('Getting text from "%s" in "%s"', elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
        return await this.extract.getText(locator);
    }

    async getAttribute(pageName: string, elementName: string, attributeName: string): Promise<string | null> {
        log.extract('Getting attribute "%s" from "%s" in "%s"', attributeName, elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
        return await this.extract.getAttribute(locator, attributeName);
    }

    // ==========================================
    // ✅ VERIFICATION STEPS
    // ==========================================

    async verifyPresence(pageName: string, elementName: string): Promise<void> {
        log.verify('Verifying presence of "%s" in "%s"', elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.presence(locator);
    }

    async verifyAbsence(pageName: string, elementName: string): Promise<void> {
        log.verify('Verifying absence of "%s" in "%s"', elementName, pageName);
        const selector = await this.repo.getSelector(pageName, elementName);
        await this.verify.absence(selector);
    }

    async verifyText(pageName: string, elementName: string, expectedText?: string, options?: TextVerifyOptions): Promise<void> {
        const logDetail = options?.notEmpty ? 'is not empty' : `matches: "${expectedText}"`;
        log.verify('Verifying text of "%s" in "%s" %s', elementName, pageName, logDetail);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.text(locator, expectedText, options);
    }

    async verifyCount(pageName: string, elementName: string, options: CountVerifyOptions): Promise<void> {
        log.verify('Verifying count for "%s" in "%s" with options: %O', elementName, pageName, options);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.count(locator, options);
    }

    async verifyImages(pageName: string, elementName: string, scroll: boolean = true): Promise<void> {
        log.verify('Verifying images for "%s" in "%s" (scroll: %s)', elementName, pageName, scroll);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.images(locator, scroll);
    }

    async verifyUrlContains(text: string): Promise<void> {
        log.verify('Verifying current URL contains: "%s"', text);
        await this.verify.urlContains(text);
    }

    // ==========================================
    // ⏳ WAIT STEPS
    // ==========================================

    async waitForState(
        pageName: string,
        elementName: string,
        state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible'
    ): Promise<void> {
        log.wait('Waiting for "%s" in "%s" to be "%s"', elementName, pageName, state);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.utils.waitForState(locator, state);
    }

    async typeSequentially(
        pageName: string,
        elementName: string,
        text: string,
        delay: number = 100
    ): Promise<void> {
        log.interact('Typing "%s" sequentially into "%s" in "%s" (delay: %dms)', text, elementName, pageName, delay);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.typeSequentially(locator, text, delay);
    }
}