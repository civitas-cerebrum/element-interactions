import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';

// platform: 'web' explicitly (the parent run clears E2E_PLATFORM too).
// Fixture errors happen before the body runs, so the expectation is declared on the test itself.
const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', { platform: 'web' });

test.fail('driver is refused on web', async ({ driver }) => {
    void driver;
});
