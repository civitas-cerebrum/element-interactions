import { ElementChain, ElementType } from '@civitas-cerebrum/element-repository';
import type {
    ClickOptions,
    Element,
    ElementActionOptions,
    LongPressOptions,
    PinchOptions,
    ScrollIntoViewOptions,
    SwipeDirection,
    SwipeOptions,
    TapAtOptions,
    TapOffset,
    ZoomOptions,
} from '@civitas-cerebrum/element-repository';
import { stopIfAborted } from '../utils/poll';

/**
 * A device-platform `Element` that RE-RESOLVES on every call: each primitive
 * first runs `resolve()` (a fresh repository resolution) and then acts on the
 * element it returns. It exists FOR VERIFICATIONS ONLY: `ElementAction` hands
 * it to the Appium family's verifications and matchers, never to an action
 * step, and it is not part of the public API.
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
 * too: they derive from a fresh resolution on every call. The getters and the
 * one-element primitives delegate to the element a fresh resolution returns.
 * `dragTo` cannot work on it: a platform drag needs a native element bound on
 * both ends, and this wrapper is not one, so it throws a clear error instead
 * of the driver's own (a missing internal method on the drop target).
 *
 * `selector` is `undefined`: one entry may resolve to a different selector on
 * every call (a `fallback` chain), so no single selector describes it.
 * {@link description} names the entry in error messages instead.
 *
 * A poll's probe binds its abort signal with {@link withSignal}: every
 * resolution then passes it to the repository lookup (which stops starting
 * driver calls once it is aborted), and the read after a resolution does not
 * start once it is aborted. The element a resolution returns does not carry
 * the signal, so a read already running on it finishes.
 */
export class ReResolvingElement implements Element {
    readonly _type = ElementType.PLATFORM;

    /**
     * @param resolve - A fresh resolution of the entry; called on every primitive.
     * @param description - Names the entry in error messages (e.g. `'LoginPage.submit'`).
     * @param selecting - The resolution picks one match by its text (a `.byText()` chain): a
     *   failed resolution means "no match" only when it is the text strategy's clean "not found".
     * @param signal - Passed to every resolution; once aborted, no read starts after one.
     */
    constructor(
        private readonly resolve: (signal?: AbortSignal) => Promise<Element>,
        readonly description: string = 'a re-resolving element',
        readonly selecting: boolean = false,
        private readonly signal?: AbortSignal,
    ) {}

    get selector(): string | undefined { return undefined; }

    /** The same element, its resolutions and reads stopped by `signal` (a poll probe's). */
    withSignal(signal: AbortSignal): ReResolvingElement {
        return new ReResolvingElement(this.resolve, this.description, this.selecting, signal);
    }

    private async target(): Promise<Element> {
        const element = await this.resolve(this.signal);
        stopIfAborted(this.signal, `a read of ${this.description}`);
        return element;
    }

    private derived(step: (el: Element) => Element): ReResolvingElement {
        return new ReResolvingElement(async signal => step(await this.resolve(signal)), this.description, this.selecting, this.signal);
    }

    action(timeout?: number): ElementChain { return new ElementChain(this, timeout); }

    async click(options?: ClickOptions): Promise<Element> { return (await this.target()).click(options); }
    async fill(text: string, options?: ElementActionOptions): Promise<Element> { return (await this.target()).fill(text, options); }
    async clear(options?: ElementActionOptions): Promise<Element> { return (await this.target()).clear(options); }
    async check(options?: ElementActionOptions): Promise<Element> { return (await this.target()).check(options); }
    async uncheck(options?: ElementActionOptions): Promise<Element> { return (await this.target()).uncheck(options); }
    async hover(options?: ElementActionOptions): Promise<Element> { return (await this.target()).hover(options); }
    async doubleClick(options?: ElementActionOptions): Promise<Element> { return (await this.target()).doubleClick(options); }
    async scrollIntoView(options?: ScrollIntoViewOptions): Promise<Element> { return (await this.target()).scrollIntoView(options); }
    async swipe(direction: SwipeDirection, options?: SwipeOptions): Promise<Element> { return (await this.target()).swipe(direction, options); }
    async longPress(options?: LongPressOptions): Promise<Element> { return (await this.target()).longPress(options); }
    async tapAt(offset: TapOffset, options?: TapAtOptions): Promise<Element> { return (await this.target()).tapAt(offset, options); }
    async pinch(options?: PinchOptions): Promise<Element> { return (await this.target()).pinch(options); }
    async zoom(options?: ZoomOptions): Promise<Element> { return (await this.target()).zoom(options); }
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
    async rawText(): Promise<string | null> { return (await this.target()).rawText(); }
    async getAttribute(name: string): Promise<string | null> { return (await this.target()).getAttribute(name); }
    async inputValue(): Promise<string> { return (await this.target()).inputValue(); }
    async getCssProperty(property: string): Promise<string> { return (await this.target()).getCssProperty(property); }
    async boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
        return (await this.target()).boundingBox();
    }
    async screenshot(options?: { path?: string }): Promise<Buffer> { return (await this.target()).screenshot(options); }
    async getTagName(): Promise<string> { return (await this.target()).getTagName(); }
    async exists(): Promise<boolean> { return (await this.target()).exists(); }
    /** Not supported: a re-resolving element is for verifications only (see the class comment). */
    async dragTo(
        _target: Element,
        _options?: { timeout?: number; sourcePosition?: { x: number; y: number }; targetPosition?: { x: number; y: number } },
    ): Promise<Element> {
        throw new Error(
            `dragTo: ${this.description} is a re-resolving element, used by verifications only; ` +
            'drag a repository element (steps.dragAndDrop) instead.',
        );
    }
    locateChild(selector: string): Element { return this.derived(el => el.locateChild(selector)); }
    async count(): Promise<number> { return (await this.target()).count(); }
    async all(): Promise<Element[]> { return (await this.target()).all(); }
    first(): Element { return this.derived(el => el.first()); }
    nth(index: number): Element { return this.derived(el => el.nth(index)); }
    filter(options: { hasText?: string | RegExp }): Element { return this.derived(el => el.filter(options)); }
    async waitFor(options?: { state?: string; timeout?: number; signal?: AbortSignal }): Promise<void> {
        const signal = options?.signal ?? this.signal;
        return (await this.target()).waitFor(signal ? { ...options, signal } : options);
    }
}

/**
 * `target` with a poll probe's `signal` bound, when it is a
 * {@link ReResolvingElement} (its resolutions pass it to the repository);
 * any other element as it is: an element already resolved does not carry a
 * signal, so the probe checks it between its reads itself.
 */
export function withProbeSignal(target: Element, signal: AbortSignal): Element {
    return target instanceof ReResolvingElement ? target.withSignal(signal) : target;
}
