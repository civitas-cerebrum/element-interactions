import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { EmailCredentials, EmailClientConfig } from '@civitas-cerebrum/email-client';
import { ContextStore } from '@civitas-cerebrum/context-store';

import { test as base } from '@playwright/test';
import { Steps } from '../steps/CommonSteps';

type StepFixture = {
    interactions: ElementInteractions;
    contextStore: ContextStore;
    repo: ElementRepository;
    steps: Steps;
};

export interface BaseFixtureOptions {
    emailCredentials?: EmailCredentials | EmailClientConfig;
}

export function baseFixture<T extends {}>(
    baseTest: ReturnType<typeof base.extend<T>>,
    locatorPath: string,
    options?: BaseFixtureOptions
) {
    return (baseTest as typeof base).extend<StepFixture>({
        repo: async ({ }, use) => {
            await use(new ElementRepository(locatorPath));
        },
        steps: async ({ page, repo }, use) => {
            await use(new Steps(page, repo, options?.emailCredentials));
        },
        interactions: async ({ page }, use) => {
            await use(new ElementInteractions(page, options?.emailCredentials));
        },
        contextStore: async ({ }, use) => {
            await use(new ContextStore());
        },
        page: async ({ page }, use, testInfo) => {
            await use(page);
            if (testInfo.status !== testInfo.expectedStatus) {
                const screenshot = await page.screenshot({ fullPage: true });
                await testInfo.attach('failure-screenshot', {
                    body: screenshot,
                    contentType: 'image/png',
                });
            }
        },
    });
}