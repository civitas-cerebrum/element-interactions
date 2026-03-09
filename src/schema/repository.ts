export interface Selector {
  [key: string]: string;
}

export interface Element {
  elementName: string;
  selector: Selector;
}

export interface PageObject {
  name: string;
  elements: Element[];
}

export interface PageRepository {
  pages: PageObject[];
}
