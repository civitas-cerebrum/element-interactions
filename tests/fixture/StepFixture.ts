import { test as base, expect } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { isEmailConfigured, loadEmailConfig } from '../../src/config/config';

// Safely evaluate if email credentials exist before initializing the fixture
const emailCredentials = isEmailConfigured() ? loadEmailConfig() : undefined;

// The test backend used by the API-step coverage tests is brought up via
// docker-compose and mapped to localhost:8080. Override APP_API_URL to point
// at a different backend in CI. Unused by UI tests, which pay nothing.
const appApiUrl = process.env.APP_API_URL ?? 'http://localhost:8080';

export const test = baseFixture(base, 'tests/data/page-repository.json', {
    emailCredentials,
    apiBaseUrl: appApiUrl,
    apiProviders: {
        app: appApiUrl,
    },
});

export { expect };