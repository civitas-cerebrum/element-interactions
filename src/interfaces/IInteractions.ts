import type { Element } from '@civitas-cerebrum/element-repository';
import type {
    ActionTimeoutOptions,
    ClickOptions,
    DragAndDropOptions,
    DropdownSelectOptions,
    ListedElementMatch,
} from '../enum/Options';

/**
 * Element interactions: the full contract every driver family implements.
 *
 * Elements are element-repository's neutral {@link Element}. A family that
 * cannot perform a method throws `PlatformNotSupportedError(method, platform)`;
 * nothing warns and continues.
 *
 * Web-only on the Appium family (throws `PlatformNotSupportedError`):
 * `uploadFile`, `dropFiles`, `selectDropdown`, `selectMultiple`, `hover`,
 * `rightClick`, `setSliderValue`, `dispatchEvent`, `pressKey`, `pressKeys`.
 */
export interface IInteractions {
    /** Clicks the element. Resolves `false` when `ifPresent` is set and the element is absent. */
    click(element: Element, options?: ClickOptions): Promise<boolean | void>;
    /** Clicks the element if it is present; resolves whether it clicked. */
    clickIfPresent(element: Element, options?: ActionTimeoutOptions): Promise<boolean>;
    fill(element: Element, text: string): Promise<void>;
    /** Web only. */
    uploadFile(element: Element, filePath: string | string[], options?: ActionTimeoutOptions): Promise<void>;
    /** Web only. */
    dropFiles(element: Element, filenames: string[], options?: { mimeType?: string } & ActionTimeoutOptions): Promise<void>;
    /** Web only. */
    selectDropdown(element: Element, options?: DropdownSelectOptions): Promise<string>;
    /** Web only. */
    hover(element: Element): Promise<void>;
    scrollIntoView(element: Element): Promise<void>;
    dragAndDrop(element: Element, options: DragAndDropOptions): Promise<void>;
    getByText(base: Element, desiredText: string, strict?: boolean): Promise<Element | null>;
    typeSequentially(element: Element, text: string, delay?: number): Promise<void>;
    /** Web only. */
    rightClick(element: Element, options?: ActionTimeoutOptions): Promise<void>;
    doubleClick(element: Element): Promise<void>;
    check(element: Element): Promise<void>;
    uncheck(element: Element): Promise<void>;
    /** Web only. */
    setSliderValue(element: Element, value: number, options?: ActionTimeoutOptions): Promise<void>;
    /** Web only (keyboard of the browser page). */
    pressKey(key: string): Promise<void>;
    /** Web only (keyboard of the browser page). */
    pressKeys(keys: string[]): Promise<void>;
    /** Web only (DOM events). */
    dispatchEvent(element: Element, type: string, eventInit?: Record<string, unknown>): Promise<void>;
    clearInput(element: Element): Promise<void>;
    /** Web only. */
    selectMultiple(element: Element, values: string[], options?: ActionTimeoutOptions): Promise<string[]>;
    getListedElement(
        base: Element,
        options: ListedElementMatch,
        repo?: { getSelector(elementName: string, pageName: string): string },
    ): Promise<Element>;
}
