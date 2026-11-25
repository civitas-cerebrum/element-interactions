import * as fs from 'fs';
import { test as base, expect } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { APP_SOURCE, fakeSession } from './fakeSession';

// After each activation the app stays in the background for three app-state queries.
const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'foreground', { backgroundQueries: 3 });
const log = (line: string) => { if (process.env.EI_FAKE_SESSION_LOG) fs.appendFileSync(process.env.EI_FAKE_SESSION_LOG, `foreground ${line}\n`); };

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'android',
    session: { capabilities: 'tests/capabilities/android.example.json', provider: fake.provider },
});

// getPageSource does not poll: it shows whatever is in the foreground right now.
test('the body starts with the app in the foreground: its first read sees the app', async ({ driver }) => {
    log('body');
    expect(await driver.getPageSource()).toBe(APP_SOURCE);
});

test('the next test waits for the foreground again after its own relaunch', async ({ driver }) => {
    log('body');
    expect(await driver.getPageSource()).toBe(APP_SOURCE);
});
