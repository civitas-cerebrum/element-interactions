import { Page} from '@playwright/test';

export class Navigation {
    constructor(private page: Page) {}

    async toUrl(url: string): Promise<void> {
        console.log(`[Navigate] -> Navigating to URL: ${url}`);
        await this.page.goto(url);
    }

    async reload(): Promise<void> {
        console.log(`[Navigate] -> Refreshing the current page`);
        await this.page.reload();
    }

    async backOrForward(direction: 'BACKWARDS' | 'FORWARDS'): Promise<void> {
        console.log(`[Navigate] -> Moving browser history ${direction.toLowerCase()}`);
        if (direction === 'BACKWARDS') {
            await this.page.goBack();
        } else {
            await this.page.goForward();
        }
    }

    async setViewport(width: number, height: number): Promise<void> {
        console.log(`[Navigate] -> Setting viewport size to ${width}x${height}`);
        await this.page.setViewportSize({ width, height });
    }
}