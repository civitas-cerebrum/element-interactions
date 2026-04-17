import { Page, Locator } from '@playwright/test';
import { Utils } from '../utils/ElementUtilities';
import { ScreenshotOptions } from '../enum/Options';
import { Element, WebElement } from '@civitas-cerebrum/element-repository';

type Target = Locator | Element;

function toElement(target: Target): Element {
    if ('_type' in target) return target as Element;
    return new WebElement(target as Locator);
}

export class Extractions {
    private ELEMENT_TIMEOUT: number;
    private utils: Utils;

    constructor(private page: Page, timeout: number = 30000) {
        this.ELEMENT_TIMEOUT = timeout;
        this.utils = new Utils(this.ELEMENT_TIMEOUT);
    }

    /** Safely retrieves and trims the text content of an element. */
    async getText(target: Target): Promise<string | null> {
        const element = toElement(target);
        await this.utils.waitForState(element, 'attached');
        const text = await element.textContent();
        return text?.trim() ?? null;
    }

    /** Retrieves the value of a specified attribute. */
    async getAttribute(target: Target, attributeName: string): Promise<string | null> {
        const element = toElement(target);
        await this.utils.waitForState(element, 'attached');
        return element.getAttribute(attributeName);
    }

    /** Retrieves the trimmed text content of every element matching the locator. */
    async getAllTexts(target: Target): Promise<string[]> {
        const element = toElement(target);
        const all = await element.all();
        const texts = await Promise.all(all.map(e => e.textContent()));
        return texts.map(t => (t ?? '').trim());
    }

    /** Retrieves the current value of an input, textarea, or select element. */
    async getInputValue(target: Target): Promise<string> {
        const element = toElement(target);
        await this.utils.waitForState(element, 'attached');
        return element.inputValue();
    }

    /** Returns the number of DOM elements matching the target. */
    async getCount(target: Target): Promise<number> {
        const element = toElement(target);
        return element.count();
    }

    /** Retrieves a computed CSS property value from an element. */
    async getCssProperty(target: Target, property: string): Promise<string> {
        const element = toElement(target);
        await this.utils.waitForState(element, 'attached');
        return element.getCssProperty(property);
    }

    /** Captures a screenshot of the full page or a specific element. */
    async screenshot(target?: Target, options?: ScreenshotOptions): Promise<Buffer> {
        if (target) {
            const element = toElement(target);
            return element.screenshot({ path: options?.path });
        }
        return await this.page.screenshot({
            fullPage: options?.fullPage,
            path: options?.path,
        }) as Buffer;
    }
}
