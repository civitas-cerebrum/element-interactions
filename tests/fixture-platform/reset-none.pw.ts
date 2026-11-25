import * as fs from 'fs';
import { test as base, expect } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { APP_SOURCE, fakeSession } from './fakeSession';

// An app that would never report the foreground: reset 'none' must not ask.
const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'reset-none', { backgroundQueries: Infinity });

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'ios',
    session: { capabilities: 'tests/capabilities/ios.example.json', provider: fake.provider, reset: 'none' },
});

test("reset 'none' neither relaunches the app nor waits for it", async ({ driver }) => {
    if (process.env.EI_FAKE_SESSION_LOG) fs.appendFileSync(process.env.EI_FAKE_SESSION_LOG, 'reset-none body\n');
    expect(await driver.getPageSource()).toBe(APP_SOURCE);
});
