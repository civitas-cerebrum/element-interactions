import { Page } from '@playwright/test';
import { Interactions } from './interactions/Interaction';
import { Navigation } from './interactions/Navigation';
import { Verifications } from './interactions/Verification';

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