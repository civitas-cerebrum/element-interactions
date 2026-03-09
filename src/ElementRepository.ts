import * as fs from 'fs';
import * as path from 'path';

import { PageRepository } from './schema/repository';
import { Page } from './schema/page';
import { pickRandomIndex } from './utils/math';

export class ElementRepository {
  private pageData: PageRepository;
  private defaultTimeout: number;

  /**
   * Initializes the repository with a path to a JSON file.
   * @param filePath Path to the JSON file (relative to the project root).
   * @param defaultTimeout Default wait timeout in milliseconds (defaults to 15000).
   */
  constructor(filePath: string, defaultTimeout?: number);

  /**
   * Initializes the repository with pre-parsed JSON data.
   * @param data The parsed JSON object matching the PageObjectSchema.
   * @param defaultTimeout Default wait timeout in milliseconds (defaults to 15000).
   */
  constructor(data: PageRepository, defaultTimeout?: number);

  constructor(dataOrPath: string | PageRepository, defaultTimeout: number = 15000) {
    if (typeof dataOrPath === 'string') {
      const absolutePath = path.resolve(process.cwd(), dataOrPath);
      const rawData = fs.readFileSync(absolutePath, 'utf-8');
      this.pageData = JSON.parse(rawData);
    } else {
      this.pageData = dataOrPath;
    }

    this.defaultTimeout = defaultTimeout;
  }

  /**
   * Updates the default timeout for all subsequent element retrievals.
   * @param timeout The new timeout in milliseconds.
   */
  public setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * Retrieves a single Playwright Locator based on the externalized JSON mapping.
   * @param page The Playwright Page instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @returns A promise that resolves to a dynamically typed Playwright Locator.
   */
  public async get<P extends Page>(page: P, pageName: string, elementName: string): Promise<ReturnType<P['locator']>> {
    const selector = this.getSelector(pageName, elementName);
    await page.waitForSelector(selector, { timeout: this.defaultTimeout }).catch(() => { });
    return page.locator(selector);
  }

  /**
   * Retrieves an array of Playwright Locators matching the mapped selector.
   * @param page The Playwright Page instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @returns A promise that resolves to an array of dynamically typed Playwright Locators.
   */
  public async getAll<P extends Page>(page: P, pageName: string, elementName: string): Promise<ReturnType<P['locator']>[]> {
    const locator = await this.get(page, pageName, elementName);
    return locator.all();
  }

  /**
   * Randomly selects one element from a list of locators matching the given selector.
   * Automatically waits for the randomly selected element to be attached and visible.
   * @param page The Playwright Page instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @param strict If true, throws an error if no elements are found. Defaults to false.
   * @returns A promise that resolves to a randomly selected Playwright Locator, or null if none are found.
   */
  public async getRandom<P extends Page>(page: P, pageName: string, elementName: string, strict: boolean = false): Promise<ReturnType<P['locator']> | null> {
    const baseLocator = await this.get(page, pageName, elementName);
    const count = await baseLocator.count();

    if (count === 0) {
      const msg = `No elements found for '${elementName}' on '${pageName}'`;
      if (strict) throw new Error(msg);
      console.warn(msg);
      return null;
    }

    const index = pickRandomIndex(count);
    const randomElement = baseLocator.nth(index);

    await Promise.all([
      randomElement.waitFor({ state: 'attached', timeout: this.defaultTimeout }),
      randomElement.waitFor({ state: 'visible', timeout: this.defaultTimeout })
    ]);

    return randomElement;
  }

  /**
   * Filters a locator list and returns the first element that contains the specified text.
   * @param page The Playwright Page instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @param desiredText The string of text to search for within the elements.
   * @param strict If true, throws an error if the element is not found. Defaults to false.
   * @returns A promise that resolves to the matched Playwright Locator, or null if not found.
   */
  public async getByText<P extends Page>(page: P, pageName: string, elementName: string, desiredText: string, strict: boolean = false): Promise<ReturnType<P['locator']> | null> {
    const baseLocator = await this.get(page, pageName, elementName);
    const locator = baseLocator.filter({ hasText: desiredText }).first();

    if ((await locator.count()) === 0) {
      const msg = `Element '${elementName}' on '${pageName}' with text "${desiredText}" not found.`;
      if (strict) throw new Error(msg);
      console.warn(msg);
      return null;
    }

    return locator;
  }

  /**
   * Internal helper method to parse the JSON schema and return a Playwright-friendly selector string.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @returns The raw string selector formatted for Playwright (e.g., 'css=...', 'xpath=...').
   */
  public getSelector(pageName: string, elementName: string): string {
    const page = this.pageData.pages.find((p) => p.name === pageName);
    if (!page) throw new Error(`ElementRepository: Page '${pageName}' not found.`);

    const element = page.elements.find((e) => e.elementName === elementName);
    if (!element) throw new Error(`ElementRepository: Element '${elementName}' not found on page '${pageName}'.`);

    const selector = element.selector;
    if (!selector || Object.keys(selector).length === 0) {
      throw new Error(`ElementRepository: Invalid selector for '${elementName}'.`);
    }

    const key = Object.keys(selector)[0] as string;
    const value = selector[key] as string;

    switch (key.toLowerCase()) {
      case 'xpath': return `xpath=${value}`;
      case 'text': return `text=${value}`;
      case 'id': return `#${value}`;
      case 'css': return `css=${value}`;
      default: return value;
    }
  }
}