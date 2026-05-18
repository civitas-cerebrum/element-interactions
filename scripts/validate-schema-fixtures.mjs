#!/usr/bin/env node
// validate-schema-fixtures.mjs
// For each schemas/subagent-returns/<role>.schema.json, verifies that
// fixtures/<role>-valid.yaml passes and fixtures/<role>-invalid.yaml
// fails. Also validates the schemas/onboarding-status.schema.json fixtures
// under schemas/onboarding-status.fixtures/ (every valid-*.json must
// validate; every invalid-*.json must fail). Exits non-zero on any mismatch.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse } from 'yaml';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const dir = 'schemas/subagent-returns';
const fixturesDir = join(dir, 'fixtures');
// `allowUnionTypes` accommodates the handover envelope's `cycle` union
// (integer | string), which the spec deliberately permits. `strictSchema:
// false` keeps Ajv tolerant of vendor keywords.
const ajv = new Ajv({
  strict: true,
  allErrors: true,
  loadSchema: false,
  allowUnionTypes: true,
  strictSchema: false,
});
addFormats(ajv);

const handover = JSON.parse(readFileSync(join(dir, 'handover.schema.json'), 'utf8'));
ajv.addSchema(handover);

const schemaFiles = readdirSync(dir).filter(f => f.endsWith('.schema.json') && f !== 'handover.schema.json');

let failures = 0;
for (const file of schemaFiles) {
  const role = basename(file, '.schema.json');
  const schema = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const validate = ajv.compile(schema);

  const validPath = join(fixturesDir, `${role}-valid.yaml`);
  const invalidPath = join(fixturesDir, `${role}-invalid.yaml`);

  const validData = parse(readFileSync(validPath, 'utf8'));
  if (!validate(validData)) {
    console.error(`FAIL: ${validPath} did not validate against ${file}`);
    console.error(validate.errors);
    failures++;
  } else {
    console.log(`OK:   ${validPath} validates against ${file}`);
  }

  const invalidData = parse(readFileSync(invalidPath, 'utf8'));
  if (validate(invalidData)) {
    console.error(`FAIL: ${invalidPath} unexpectedly validated against ${file}`);
    failures++;
  } else {
    console.log(`OK:   ${invalidPath} correctly fails ${file}`);
  }
}

// ---------------------------------------------------------------------------
// Onboarding-status ledger fixtures
// ---------------------------------------------------------------------------
// Validates the onboarding-status.schema.json fixtures. Convention:
//   schemas/onboarding-status.fixtures/valid-*.json   must validate
//   schemas/onboarding-status.fixtures/invalid-*.json must fail
const onboardingSchemaPath = 'schemas/onboarding-status.schema.json';
const onboardingFixturesDir = 'schemas/onboarding-status.fixtures';
if (existsSync(onboardingSchemaPath) && existsSync(onboardingFixturesDir)) {
  const onboardingSchema = JSON.parse(readFileSync(onboardingSchemaPath, 'utf8'));
  // Use a fresh Ajv instance — the onboarding-status schema is a
  // standalone document, not a member of the subagent-return collection.
  const ajvOnboarding = new Ajv({
    strict: true,
    allErrors: true,
    loadSchema: false,
    allowUnionTypes: true,
    strictSchema: false,
  });
  addFormats(ajvOnboarding);
  const validateOnboarding = ajvOnboarding.compile(onboardingSchema);

  for (const f of readdirSync(onboardingFixturesDir).filter(n => n.endsWith('.json'))) {
    const full = join(onboardingFixturesDir, f);
    const data = JSON.parse(readFileSync(full, 'utf8'));
    const expectValid = f.startsWith('valid-');
    const ok = validateOnboarding(data);
    if (expectValid && !ok) {
      console.error(`FAIL: ${full} did not validate against ${onboardingSchemaPath}`);
      console.error(validateOnboarding.errors);
      failures++;
    } else if (!expectValid && ok) {
      console.error(`FAIL: ${full} unexpectedly validated against ${onboardingSchemaPath}`);
      failures++;
    } else {
      console.log(`OK:   ${full} ${expectValid ? 'validates' : 'correctly fails'} against ${onboardingSchemaPath}`);
    }
  }
}

process.exit(failures === 0 ? 0 : 1);
