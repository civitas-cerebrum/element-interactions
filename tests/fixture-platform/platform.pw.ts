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

// Unexpected failure (no test.fail()): the parent run expects this one to be red.
test('fails and gets evidence', async ({ steps }) => {
    await steps.verifyText('title', 'LoginPage', 'Wrong text');
});

// Expected failure: ended as expected, so no evidence (same trigger as web).
test('expected failure under test.fail() gets no evidence', async ({ steps }) => {
    test.fail();
    await steps.verifyText('title', 'LoginPage', 'Wrong text');
});

// Unexpected pass under test.fail(): did not end as expected, so evidence.
test('unexpected pass under test.fail() gets evidence', async ({ steps }) => {
    test.fail();
    await steps.verifyText('title', 'LoginPage', 'Sign in');
});

// Unexpected failure whose evidence cannot be collected.
test('evidence errors never mask the failure', async () => {
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
