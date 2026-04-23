import { test as base, expect } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { isEmailConfigured, loadEmailConfig } from '../../src/config/config';

// Safely evaluate if email credentials exist before initializing the fixture
const emailCredentials = isEmailConfigured() ? loadEmailConfig() : undefined;

// BookHive backend is brought up alongside vue-test-site by docker-compose
// (service `bookhive-backend`, mapped to localhost:8080). Used by API-step
// coverage tests; unused by UI tests, which pay nothing.
const bookhiveApiUrl = process.env.BOOKHIVE_API_URL ?? 'http://localhost:8080';

export const test = baseFixture(base, 'tests/data/page-repository.json', {
    emailCredentials,
    apiBaseUrl: bookhiveApiUrl,
    apiProviders: {
        bookhive: bookhiveApiUrl,
    },
});

export { expect };