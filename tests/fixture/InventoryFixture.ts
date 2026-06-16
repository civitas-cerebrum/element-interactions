import { test as base, expect } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';

/**
 * Fixture for the inventory-SQL-verification specs: the bookhive backend (Mongo,
 * via OpenAPI) for driving inventory operations, AND a projection Postgres read-model
 * (5433/bookhive_live) for asserting relational post-conditions with the SQL steps.
 */
const apiBaseUrl = process.env.BOOKHIVE_API_URL ?? 'http://localhost:8080';
const dbUrl = process.env.INVENTORY_DB_URL ?? 'postgres://bookhive:bookhive@localhost:5433/bookhive_live';

export const test = baseFixture(base, 'tests/data/page-repository.json', {
    apiBaseUrl,
    dbUrl,
});

export { expect };
