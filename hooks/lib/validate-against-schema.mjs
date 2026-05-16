#!/usr/bin/env node
// validate-against-schema.mjs
// Usage: node validate-against-schema.mjs <role> <data-file>
// Exits 0 if data validates against schemas/subagent-returns/<role>.schema.json,
// 1 (+ prints errors to stderr) if not.
// Exit 2 for usage / schema-not-found errors.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const [,, role, dataFile] = process.argv;
if (!role || !dataFile) {
  console.error('Usage: validate-against-schema.mjs <role> <data-file>');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
// hooks/lib/ -> hooks/ -> repo root. Schemas are at root/schemas/subagent-returns/.
const schemasDir = resolve(here, '..', '..', 'schemas', 'subagent-returns');
const schemaPath = join(schemasDir, `${role}.schema.json`);
if (!existsSync(schemaPath)) {
  console.error(`No schema for role: ${role} (expected ${schemaPath})`);
  process.exit(2);
}

// `allowUnionTypes` accommodates pragmatic schema relaxations (e.g. the
// handover envelope's `cycle` accepts integer-or-string because subagents
// emit both shapes in practice). Strict mode otherwise refuses to compile
// union types. `strictSchema: false` keeps Ajv tolerant of vendor keywords
// (e.g. `$comment` blocks, descriptive metadata) without crashing.
const ajv = new Ajv({
  strict: true,
  allErrors: true,
  allowUnionTypes: true,
  strictSchema: false,
});
addFormats(ajv);
const handover = JSON.parse(readFileSync(join(schemasDir, 'handover.schema.json'), 'utf8'));
ajv.addSchema(handover);

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const validate = ajv.compile(schema);

const raw = readFileSync(dataFile, 'utf8');
let data;
try { data = parseYaml(raw); }
catch (e) { console.error('YAML parse failed:', e.message); process.exit(1); }

if (!validate(data)) {
  console.error('Schema validation failed for role', role + ':');
  for (const err of validate.errors ?? []) {
    console.error(`  ${err.instancePath || '/'} ${err.message}`);
  }
  process.exit(1);
}
process.exit(0);
