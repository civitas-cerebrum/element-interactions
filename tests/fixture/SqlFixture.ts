import { test as base, expect } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';

// bookhive-postgres is brought up by docker-compose.sql.yml (localhost:5432).
const dbUrl = process.env.SQL_TEST_URL ?? 'postgres://bookhive:bookhive@localhost:5432/bookhive';

export const test = baseFixture(base, 'tests/data/page-repository.json', {
    dbUrl,
    dbProviders: {
        // a second named handle onto the same DB, to exercise provider routing
        analytics: dbUrl,
    },
});

export { expect };
