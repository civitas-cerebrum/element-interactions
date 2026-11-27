import { PlatformNotSupportedError } from '@civitas-cerebrum/element-repository';
import type {
    Element,
    LongPressOptions,
    PinchOptions,
    ScrollIntoViewOptions,
    SwipeDirection,
    SwipeOptions,
    TapAtOptions,
    TapOffset,
    ZoomOptions,
} from '@civitas-cerebrum/element-repository';
import { requireWebElement } from './requireWebElement';
import { Utils } from '../utils/ElementUtilities';
import type { IGestures, ScreenSwipeOptions } from '../interfaces/IGestures';

/**
 * Gestures for the Playwright family (`web`). Element-level gestures delegate
 * to the element's own primitives (`swipe`, `scrollIntoView`, `longPress`,
 * `tapAt`, `pinch`, `zoom`); a web element's `pinch` / `zoom` throw
 * `PlatformNotSupportedError` from element-repository. The screen-level
 * gestures (`swipeScreen`, `tapAt`) have no element and throw
 * `PlatformNotSupportedError(method, 'web')` here. Every element-level method
 * first checks its element with `requireWebElement`: a platform (Appium)
 * element throws before anything is acted on.
 */
export class PlaywrightGestures implements IGestures {
    private readonly utils: Utils;

    constructor(private readonly timeout: number = 30000) {
        this.utils = new Utils(timeout);
    }

    async swipe(element: Element, direction: SwipeDirection, options?: SwipeOptions): Promise<Element> {
        requireWebElement('PlaywrightGestures.swipe', element);
        return element.swipe(direction, { ...options, timeout: options?.timeout ?? this.timeout });
    }

    async swipeScreen(_direction: SwipeDirection, _options?: ScreenSwipeOptions): Promise<void> {
        throw new PlatformNotSupportedError('swipeScreen', 'web');
    }

    /**
     * The browser scrolls whichever way is needed; `direction` is accepted for
     * symmetry. Same sequence as `Interactions.scrollIntoView` (a short,
     * best-effort attach probe, then the element primitive), so
     * `steps.scrollIntoView` behaves as before on web.
     */
    async scrollIntoView(element: Element, options?: ScrollIntoViewOptions): Promise<Element> {
        requireWebElement('PlaywrightGestures.scrollIntoView', element);
        const timeout = options?.timeout ?? this.timeout;
        await this.utils.softProbe(element, 'attached', timeout);
        return element.scrollIntoView({ ...options, timeout });
    }

    /**
     * In a browser the element is reachable without stepwise scrolling, so this
     * is `scrollIntoView` bounded by `timeout`; it throws if the element never
     * attaches.
     */
    async scrollUntilFound(element: Element, options?: ScrollIntoViewOptions): Promise<Element> {
        requireWebElement('PlaywrightGestures.scrollUntilFound', element);
        return element.scrollIntoView({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    /** Centres the web element in the viewport. */
    async centerElement(element: Element, options?: { timeout?: number }): Promise<Element> {
        requireWebElement('PlaywrightGestures.centerElement', element);
        const timeout = options?.timeout ?? this.timeout;
        await element.scrollIntoView({ timeout });
        await element.locator.evaluate(
            (node) => node.scrollIntoView({ block: 'center', inline: 'center' }),
            undefined,
            { timeout },
        );
        return element;
    }

    async longPress(element: Element, options?: LongPressOptions): Promise<Element> {
        requireWebElement('PlaywrightGestures.longPress', element);
        return element.longPress({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    async tapAt(_x: number, _y: number): Promise<void> {
        throw new PlatformNotSupportedError('tapAt', 'web');
    }

    /** Delegates to `Element.tapAt`: on web a mouse click at `offset` from the element's top-left corner. */
    async tapAtElement(element: Element, offset: TapOffset, options?: TapAtOptions): Promise<Element> {
        requireWebElement('PlaywrightGestures.tapAtElement', element);
        return element.tapAt(offset, { ...options, timeout: options?.timeout ?? this.timeout });
    }

    /** Delegates to `Element.pinch`; a web element throws `PlatformNotSupportedError('pinch', 'web')`. */
    async pinch(element: Element, options?: PinchOptions): Promise<Element> {
        requireWebElement('PlaywrightGestures.pinch', element);
        return element.pinch({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    /** Delegates to `Element.zoom`; a web element throws `PlatformNotSupportedError('zoom', 'web')`. */
    async zoom(element: Element, options?: ZoomOptions): Promise<Element> {
        requireWebElement('PlaywrightGestures.zoom', element);
        return element.zoom({ ...options, timeout: options?.timeout ?? this.timeout });
    }
}
