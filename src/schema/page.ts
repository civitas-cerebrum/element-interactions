export interface Page {
  waitForSelector(selector: string, options?: any): Promise<any>;
  locator(selector: string): any;
}