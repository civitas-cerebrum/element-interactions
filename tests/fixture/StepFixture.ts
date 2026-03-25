import { test as base, expect } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { isEmailConfigured, loadEmailConfig } from '../../src/config/config';

// Safely evaluate if email credentials exist before initializing the fixture
const emailCredentials = isEmailConfigured() ? loadEmailConfig() : undefined;

export const test = baseFixture(base, 'tests/data/page-repository.json', {
    emailCredentials,
});

export { expect };