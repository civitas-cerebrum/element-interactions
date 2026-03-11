import { Page } from '@playwright/test';
import { ElementRepository } from 'pw-element-repository';
import { ElementInteractions } from '../ElementInteractions';
import { DropdownSelectOptions } from '../interactions/Interaction';

export class Steps {
    private interact;
    private navigate;
    private verify;

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

    async navigateTo(url: string): Promise<void> {
        await this.navigate.toUrl(url);
    }

    async refresh(): Promise<void> {
        await this.navigate.reload();
    }

    // ==========================================
    // 🖱️ INTERACTION STEPS
    // ==========================================

    async click(pageName: string, elementName: string): Promise<void> {
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.click(locator);
    }

    async clickRandom(pageName: string, elementName: string): Promise<void> {
        const locator = await this.repo.getRandom(this.page, pageName, elementName);
        await this.interact.click(locator!);
    }

    async clickIfPresent(pageName: string, elementName: string): Promise<void> {
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.clickIfPresent(locator);
    }

    async fill(pageName: string, elementName: string, text: string): Promise<void> {
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.fill(locator, text);
    }

    async uploadFile(pageName: string, elementName: string, filePath: string): Promise<void> {
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.uploadFile(locator, filePath);
    }

    async selectDropdown(
        pageName: string, 
        elementName: string, 
        options?: DropdownSelectOptions
    ): Promise<string> {
        const locator = await this.repo.get(this.page, pageName, elementName);
        return await this.interact.selectDropdown(locator, options);
    }

    // ==========================================
    // ✅ VERIFICATION STEPS
    // ==========================================

    async verifyPresence(pageName: string, elementName: string): Promise<void> {
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.presence(locator);
    }

    async verifyAbsence(pageName: string, elementName: string): Promise<void> {
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.absence(locator);
    }

    async verifyText(pageName: string, elementName: string, expectedText: string): Promise<void> {
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.text(locator, expectedText);
    }

    async verifyImages(pageName: string, elementName: string, scroll: boolean = true): Promise<void> {
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.images(locator, scroll);
    }

    async verifyUrlContains(text: string): Promise<void> {
        await this.verify.urlContains(text);
    }
}