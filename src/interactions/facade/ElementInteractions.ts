import { Page } from '@playwright/test';
import { Interactions } from '../Interaction';
import { Navigation } from '../Navigation';
import { Verifications } from '../Verification';

export class ElementInteractions {
    public navigate: Navigation;
    public interact: Interactions;
    public verify: Verifications;

    constructor(page: Page) {
        this.navigate = new Navigation(page);
        this.interact = new Interactions(page);
        this.verify = new Verifications(page);
    }
}