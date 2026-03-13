import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { ContextStore } from '@civitas-cerebrum/context-store';
import { ElementRepository } from 'pw-element-repository';
import { test as base } from '@playwright/test';
import { Steps } from '../steps/CommonSteps';

type StepFixture = {
    interactions: ElementInteractions;
    contextStore: ContextStore;
    repo: ElementRepository;
    steps: Steps;

};

export function baseFixture<T extends {}>(
    baseTest: ReturnType<typeof base.extend<T>>,
    locatorPath: string
) {
    return (baseTest as typeof base).extend<StepFixture>({
        repo: async ({ }, use) => {
            await use(new ElementRepository(locatorPath));
        },
        steps: async ({ page }, use) => {
            const repo = new ElementRepository(locatorPath);
            await use(new Steps(page, repo));
        },
        interactions: async ({ page }, use) => {
            await use(new ElementInteractions(page));
        },
        contextStore: async ({ }, use) => {
            await use(new ContextStore());
        },
    });
}