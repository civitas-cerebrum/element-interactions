#!/usr/bin/env node
// compile-schemas.mjs
// Compiles every JSON Schema under schemas/subagent-returns/ via Ajv,
// surfacing any compile-time error. Replaces the prior `ajv-cli compile`
// invocation, which pulled in `fast-json-patch <3.1.1` with a HIGH-severity
// prototype-pollution advisory (GHSA-8gh8-hqwg-xf34). Uses the same Ajv
// configuration as the runtime validator + the fixture script so all three
// consumers agree on strictness.

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const dir = 'schemas/subagent-returns';

const ajv = new Ajv({
  strict: true,
  allErrors: true,
  loadSchema: false,
  allowUnionTypes: true,
  strictSchema: false,
});
addFormats(ajv);

// The handover envelope is referenced by every role schema's $ref; add it
// first so subsequent compiles can resolve `$ref: handover.schema.json`.
const handover = JSON.parse(readFileSync(join(dir, 'handover.schema.json'), 'utf8'));
ajv.addSchema(handover);

const schemaFiles = readdirSync(dir).filter(
  (f) => f.endsWith('.schema.json') && f !== 'handover.schema.json',
);

let failures = 0;
for (const file of schemaFiles) {
  const role = basename(file, '.schema.json');
  try {
    const schema = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    ajv.compile(schema);
    console.log(`✓ ${role}`);
  } catch (err) {
    failures += 1;
    console.error(`✗ ${role}: ${err.message}`);
  }
}

// Also compile the onboarding-status schema (lives one directory up).
try {
  const onboardingPath = 'schemas/onboarding-status.schema.json';
  const schema = JSON.parse(readFileSync(onboardingPath, 'utf8'));
  ajv.compile(schema);
  console.log('✓ onboarding-status');
} catch (err) {
  failures += 1;
  console.error(`✗ onboarding-status: ${err.message}`);
}

if (failures > 0) {
  console.error(`\n${failures} schema(s) failed to compile.`);
  process.exit(1);
}
