/**
 * Defines the strategy for selecting an option from a dropdown element.
 */
export enum DropdownSelectType {
    /** Selects a completely random, non-disabled option with a valid value. */
    RANDOM = 'random',
    /** Selects an option based on its zero-based index in the dropdown. */
    INDEX = 'index',
    /** Selects an option based on its exact 'value' attribute. */
    VALUE = 'value'
}

/**
 * Configuration options for the `selectDropdown` method.
 */
export interface DropdownSelectOptions {
    /** The selection strategy to use. Defaults to RANDOM. */
    type?: DropdownSelectType;
    /** The specific value attribute to select (Required if type is VALUE). */
    value?: string;
    /** The index of the option to select (Required if type is INDEX). */
    index?: number;
}

/**
 * Configuration options for the `text` verification method.
 */
export interface TextVerifyOptions {
    /** If true, asserts that the element has text content, ignoring 'expectedText' */
    notEmpty?: boolean;
}

/**
 * Configuration options for the `count` verification method.
 */
export interface CountVerifyOptions {
    /** Asserts that the element count exactly matches this value */
    exact?: number;
    /** Asserts that the element count is strictly greater than this value */
    greaterThan?: number;
    /** Asserts that the element count is strictly less than this value */
    lessThan?: number;
}