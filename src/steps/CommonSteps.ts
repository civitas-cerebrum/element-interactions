import { Page } from '@playwright/test';
import { ElementRepository } from 'pw-element-repository';
import { ElementInteractions } from '../ElementInteractions';
import { DropdownSelectOptions } from '../interactions/Interaction';

/**
 * The `Steps` class serves as a unified Facade for test orchestration.
 * It combines element acquisition (via `pw-element-repository`) with 
 * Playwright interactions, navigation, and verifications to keep test files clean, 
 * readable, and free of raw locators.
 */
export class Steps {
    private interact;
    private navigate;
    private verify;

    /**
     * Initializes the Steps class with the required Playwright page and element repository.
     * * @param page - The current Playwright Page object.
     * @param repo - An initialized instance of `ElementRepository` containing your locators.
     */
    constructor(
        private page: Page,
        private repo: ElementRepository
    ) {
        const interactions = new ElementInteractions(page);
        this.interact = interactions.interact;
        this.navigate = interactions.navigate;
        this.verify = interactions.verify;
    }

    // ==========================================
    // 🧭 NAVIGATION STEPS
    // ==========================================

    /**
     * Navigates the browser to the specified URL.
     * * @param url - The absolute or relative URL to navigate to.
     */
    async navigateTo(url: string): Promise<void> {
        console.log(`[Step] -> Navigating to URL: "${url}"`);
        await this.navigate.toUrl(url);
    }

    /**
     * Reloads the current page.
     */
    async refresh(): Promise<void> {
        console.log(`[Step] -> Refreshing the current page`);
        await this.navigate.reload();
    }

    // ==========================================
    // 🖱️ INTERACTION STEPS
    // ==========================================

    /**
     * Retrieves an element from the repository and performs a standard click.
     * * @param pageName - The page or component grouping name in your repository.
     * @param elementName - The specific element name in your repository.
     */
    async click(pageName: string, elementName: string): Promise<void> {
        console.log(`[Step] -> Clicking on '${elementName}' in '${pageName}'`);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.click(locator);
    }

    /**
     * Retrieves a random element from a resolved list of locators and clicks it.
     * Useful for clicking random items in a list or grid (e.g., product cards).
     * * @param pageName - The page or component grouping name in your repository.
     * @param elementName - The specific element name in your repository representing multiple elements.
     */
    async clickRandom(pageName: string, elementName: string): Promise<void> {
        console.log(`[Step] -> Clicking a random element from '${elementName}' in '${pageName}'`);
        const locator = await this.repo.getRandom(this.page, pageName, elementName);
        await this.interact.click(locator!);
    }

    /**
     * Retrieves an element and clicks it only if it is visible. 
     * Prevents test failures on optional elements like cookie banners or promotional pop-ups.
     * * @param pageName - The page or component grouping name in your repository.
     * @param elementName - The specific element name in your repository.
     */
    async clickIfPresent(pageName: string, elementName: string): Promise<void> {
        console.log(`[Step] -> Clicking on '${elementName}' in '${pageName}' (if present)`);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.clickIfPresent(locator);
    }

    /**
     * Retrieves an input field and fills it with the provided text, replacing any existing value.
     * * @param pageName - The page or component grouping name in your repository.
     * @param elementName - The specific element name in your repository.
     * @param text - The text to type into the input field.
     */
    async fill(pageName: string, elementName: string, text: string): Promise<void> {
        console.log(`[Step] -> Filling '${elementName}' in '${pageName}' with text: "${text}"`);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.fill(locator, text);
    }

    /**
     * Retrieves an input element of type `file` and sets its files.
     * * @param pageName - The page or component grouping name in your repository.
     * @param elementName - The specific element name in your repository.
     * @param filePath - The local file path of the file to be uploaded.
     */
    async uploadFile(pageName: string, elementName: string, filePath: string): Promise<void> {
        console.log(`[Step] -> Uploading file "${filePath}" to '${elementName}' in '${pageName}'`);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.uploadFile(locator, filePath);
    }

    /**
     * Retrieves a `<select>` dropdown element and selects an option based on the provided strategy.
     * Defaults to selecting a random, non-disabled option if no strategy is specified.
     * @param pageName - The page or component grouping name in your repository.
     * @param elementName - The specific element name in your repository.
     * @param options - Configuration specifying whether to select by 'random', 'index', or 'value'.
     * @returns The exact value attribute of the selected option.
     */
    async selectDropdown(
        pageName: string, 
        elementName: string, 
        options?: DropdownSelectOptions
    ): Promise<string> {
        const optLog = options ? JSON.stringify(options) : 'default (random)';
        console.log(`[Step] -> Selecting dropdown option for '${elementName}' in '${pageName}' using options: ${optLog}`);
        const locator = await this.repo.get(this.page, pageName, elementName);
        return await this.interact.selectDropdown(locator, options);
    }

    // ==========================================
    // ✅ VERIFICATION STEPS
    // ==========================================

    /**
     * Asserts that a specified element is attached to the DOM and is visible.
     * * @param pageName - The page or component grouping name in your repository.
     * @param elementName - The specific element name in your repository.
     */
    async verifyPresence(pageName: string, elementName: string): Promise<void> {
        console.log(`[Step] -> Verifying presence of '${elementName}' in '${pageName}'`);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.presence(locator);
    }

    /**
     * Asserts that a specified element is hidden or completely detached from the DOM.
     * * @param pageName - The page or component grouping name in your repository.
     * @param elementName - The specific element name in your repository.
     */
    async verifyAbsence(pageName: string, elementName: string): Promise<void> {
        console.log(`[Step] -> Verifying absence of '${elementName}' in '${pageName}'`);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.absence(locator);
    }

    /**
     * Asserts that the specified element exactly matches the expected text.
     * * @param pageName - The page or component grouping name in your repository.
     * @param elementName - The specific element name in your repository.
     * @param expectedText - The exact string expected inside the element.
     */
    async verifyText(pageName: string, elementName: string, expectedText: string): Promise<void> {
        console.log(`[Step] -> Verifying text of '${elementName}' in '${pageName}' matches: "${expectedText}"`);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.text(locator, expectedText);
    }

    /**
     * Performs a rigorous verification of one or more images. 
     * Asserts visibility, checks for a valid 'src' attribute, ensures a positive 'naturalWidth', 
     * and evaluates the native browser `decode()` promise to ensure the image isn't broken.
     * * @param pageName - The page or component grouping name in your repository.
     * @param elementName - The specific element name in your repository.
     * @param scroll - Whether to smoothly scroll the image(s) into view before verifying (default: true).
     */
    async verifyImages(pageName: string, elementName: string, scroll: boolean = true): Promise<void> {
        console.log(`[Step] -> Verifying images for '${elementName}' in '${pageName}' (Scroll: ${scroll})`);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.images(locator, scroll);
    }

    /**
     * Asserts that the current browser URL contains the expected substring.
     * * @param text - The substring expected to be present within the active URL.
     */
    async verifyUrlContains(text: string): Promise<void> {
        console.log(`[Step] -> Verifying current URL contains: "${text}"`);
        await this.verify.urlContains(text);
    }
}