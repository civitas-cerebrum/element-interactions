import { ElementChain, ElementType } from '@civitas-cerebrum/element-repository';
import type {
    Element,
    ElementActionOptions,
    LongPressOptions,
    PinchOptions,
    ScrollIntoViewOptions,
    SwipeDirection,
    SwipeOptions,
    TapOffset,
    ZoomOptions,
} from '@civitas-cerebrum/element-repository';

/**
 * A device-platform `Element` that RE-RESOLVES on every call: each primitive
 * first runs `resolve()` (a fresh repository resolution) and then acts on the
 * element it returns.
 *
 * The Appium family's verifications poll an element's getters until their
 * timeout. Handed an element resolved once, that poll would keep reading the
 * node the repository picked at that moment: a `fallback` walk that settled
 * on the fallback before the primary appeared, or a TEXT / ATTRIBUTE / INDEX
 * pick bound to a raw element that has since been redrawn. Handed this
 * wrapper, every poll resolves again, which is what the web path gets from
 * Playwright's lazy locators and what the visibility probe does by hand.
 *
 * The derived elements (`first`, `nth`, `locateChild`, `filter`) re-resolve
 * too: they derive from a fresh resolution on every call.
 */
export class ReResolvingElement implements Element {
    readonly _type = ElementType.PLATFORM;

    constructor(private readonly resolve: () => Promise<Element>) {}

    get selector(): string | undefined { return undefined; }

    private async target(): Promise<Element> {
        return this.resolve();
    }

    private derived(step: (el: Element) => Element): ReResolvingElement {
        return new ReResolvingElement(async () => step(await this.target()));
    }

    action(timeout?: number): ElementChain { return new ElementChain(this, timeout); }

    async click(options?: ElementActionOptions): Promise<Element> { return (await this.target()).click(options); }
    async fill(text: string, options?: ElementActionOptions): Promise<Element> { return (await this.target()).fill(text, options); }
    async clear(options?: ElementActionOptions): Promise<Element> { return (await this.target()).clear(options); }
    async check(options?: ElementActionOptions): Promise<Element> { return (await this.target()).check(options); }
    async uncheck(options?: ElementActionOptions): Promise<Element> { return (await this.target()).uncheck(options); }
    async hover(options?: ElementActionOptions): Promise<Element> { return (await this.target()).hover(options); }
    async doubleClick(options?: ElementActionOptions): Promise<Element> { return (await this.target()).doubleClick(options); }
    async scrollIntoView(options?: ScrollIntoViewOptions): Promise<Element> { return (await this.target()).scrollIntoView(options); }
    async swipe(direction: SwipeDirection, options?: SwipeOptions): Promise<Element> { return (await this.target()).swipe(direction, options); }
    async longPress(options?: LongPressOptions): Promise<void> { return (await this.target()).longPress(options); }
    async tapAt(offset: TapOffset, options?: ElementActionOptions): Promise<void> { return (await this.target()).tapAt(offset, options); }
    async pinch(options?: PinchOptions): Promise<void> { return (await this.target()).pinch(options); }
    async zoom(options?: ZoomOptions): Promise<void> { return (await this.target()).zoom(options); }
    async pressSequentially(text: string, delay?: number, options?: ElementActionOptions): Promise<Element> {
        return (await this.target()).pressSequentially(text, delay, options);
    }
    async setInputFiles(filePath: string | string[], options?: ElementActionOptions): Promise<Element> {
        return (await this.target()).setInputFiles(filePath, options);
    }
    async dispatchEvent(event: string): Promise<Element> { return (await this.target()).dispatchEvent(event); }
    async isVisible(): Promise<boolean> { return (await this.target()).isVisible(); }
    async isEnabled(): Promise<boolean> { return (await this.target()).isEnabled(); }
    async isChecked(): Promise<boolean> { return (await this.target()).isChecked(); }
    async raw(): Promise<string | null> { return (await this.target()).raw(); }
    async textContent(): Promise<string | null> { return (await this.target()).textContent(); }
    async getAttribute(name: string): Promise<string | null> { return (await this.target()).getAttribute(name); }
    async inputValue(): Promise<string> { return (await this.target()).inputValue(); }
    async getCssProperty(property: string): Promise<string> { return (await this.target()).getCssProperty(property); }
    async boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
        return (await this.target()).boundingBox();
    }
    async screenshot(options?: { path?: string }): Promise<Buffer> { return (await this.target()).screenshot(options); }
    async getTagName(): Promise<string> { return (await this.target()).getTagName(); }
    async exists(): Promise<boolean> { return (await this.target()).exists(); }
    async dragTo(
        target: Element,
        options?: { timeout?: number; sourcePosition?: { x: number; y: number }; targetPosition?: { x: number; y: number } },
    ): Promise<Element> {
        return (await this.target()).dragTo(target, options);
    }
    locateChild(selector: string): Element { return this.derived(el => el.locateChild(selector)); }
    async count(): Promise<number> { return (await this.target()).count(); }
    async all(): Promise<Element[]> { return (await this.target()).all(); }
    first(): Element { return this.derived(el => el.first()); }
    nth(index: number): Element { return this.derived(el => el.nth(index)); }
    filter(options: { hasText?: string | RegExp }): Element { return this.derived(el => el.filter(options)); }
    async waitFor(options?: { state?: string; timeout?: number }): Promise<void> { return (await this.target()).waitFor(options); }
}
