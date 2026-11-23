import * as fs from 'fs';
import * as path from 'path';
import type { Platform } from '@civitas-cerebrum/element-repository';

/** A capabilities file read by {@link loadCapabilities}. */
export interface LoadedCapabilities {
    /** The path as given (option or `E2E_CAPABILITIES`), used in every message. */
    file: string;
    /** The absolute path that was read. */
    resolvedPath: string;
    /** Exactly the file's JSON object: nothing added, defaulted or rewritten. */
    capabilities: Record<string, unknown>;
}

/**
 * Reads the capabilities JSON file of a platform run.
 *
 * - `file` is ALWAYS a path; `undefined` falls back to `env.E2E_CAPABILITIES` (an
 *   empty value counts as unset). An inline object is rejected: capabilities
 *   live only in files.
 * - The file is a FLAT W3C capabilities object: a file wrapped in
 *   `alwaysMatch` / `firstMatch` is rejected.
 * - The returned `capabilities` is the file's JSON object as parsed. The
 *   library adds, defaults and rewrites nothing.
 * - The file must contain `platformName`, and it must name `platform`
 *   (compared case-insensitively). Every error names the file, and the key
 *   when one is at fault.
 *
 * @param file - Path to the JSON file, absolute or relative to the working directory.
 * @param platform - The active platform the file must declare.
 * @param env - Environment to read `E2E_CAPABILITIES` from (default `process.env`).
 */
export function loadCapabilities(file: unknown, platform: Platform, env: NodeJS.ProcessEnv = process.env): LoadedCapabilities {
    const given = file === undefined ? env.E2E_CAPABILITIES : file;
    if (given === undefined || given === '') {
        throw new Error(
            `No capabilities file for platform "${platform}": set session.capabilities to the path of a JSON capabilities `
            + 'file (for example tests/capabilities/<device>.json), or set E2E_CAPABILITIES.',
        );
    }
    if (typeof given !== 'string') {
        throw new Error(
            `session.capabilities must be the path to a JSON capabilities file, got ${given === null ? 'null' : typeof given}. `
            + 'Inline capability objects are not accepted: capabilities live only in files (tests/capabilities/<device>.json).',
        );
    }

    const resolvedPath = path.resolve(process.cwd(), given);
    let text: string;
    try {
        text = fs.readFileSync(resolvedPath, 'utf-8');
    } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') {
            throw new Error(`Capabilities file "${given}" was not found (resolved to ${resolvedPath}).`);
        }
        throw new Error(`Capabilities file "${given}" could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`Capabilities file "${given}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Capabilities file "${given}" must contain one JSON object of W3C capabilities.`);
    }
    const capabilities = parsed as Record<string, unknown>;
    const wrappers = ['alwaysMatch', 'firstMatch'].filter(key => key in capabilities);
    if (wrappers.length > 0) {
        throw new Error(
            `Capabilities file "${given}" has ${wrappers.map(k => `"${k}"`).join(' and ')}: capabilities files are flat W3C objects `
            + '(top-level keys such as "platformName" and "appium:automationName", no alwaysMatch / firstMatch wrapper). '
            + 'Move the keys to the top level of the file.',
        );
    }

    const platformName = capabilities.platformName;
    if (typeof platformName !== 'string' || platformName.trim() === '') {
        throw new Error(`Capabilities file "${given}" is missing the required key "platformName".`);
    }
    if (platformName.toLowerCase() !== platform.toLowerCase()) {
        throw new Error(
            `Capabilities file "${given}" has "platformName": "${platformName}", but the platform is "${platform}". `
            + 'Point session.capabilities (or E2E_CAPABILITIES) at a file for this platform, or change the platform.',
        );
    }
    return { file: given, resolvedPath, capabilities };
}
