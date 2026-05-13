#!/usr/bin/env node
// validate-schema-fixtures.mjs
// For each schemas/subagent-returns/<role>.schema.json, verifies that
// fixtures/<role>-valid.yaml passes and fixtures/<role>-invalid.yaml
// fails. Exits non-zero on any mismatch.

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse } from 'yaml';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const dir = 'schemas/subagent-returns';
const fixturesDir = join(dir, 'fixtures');
const ajv = new Ajv({ strict: true, allErrors: true, loadSchema: false });
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

process.exit(failures === 0 ? 0 : 1);
