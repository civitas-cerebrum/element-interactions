import { test as base, expect } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { fakeSession } from './fakeSession';

const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG);

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'ios',
    timeout: 1000,
    session: { capabilities: 'tests/capabilities/ios.example.json', provider: fake.provider },
});

test('passes', async ({ steps }) => {
    await steps.verifyText('title', 'LoginPage', 'Sign in');
});

test('fails and gets evidence', async ({ steps }) => {
    test.fail();
    await steps.verifyText('title', 'LoginPage', 'Wrong text');
});

test('evidence errors never mask the failure', async () => {
    test.fail();
    fake.failEvidence = true;
    expect('own failure').toBe('the test failure');
});

test.fail('page is refused', async ({ page }) => {
    await page.title();
});

test.fail('context is refused', async ({ context }) => {
    context.pages();
});

test('passes again, no evidence', async () => {
    fake.failEvidence = false;
});
