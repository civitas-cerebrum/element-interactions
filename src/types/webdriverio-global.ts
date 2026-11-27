/**
 * Declares the global `WebdriverIO.Browser` interface as an empty interface,
 * so the published declarations (which name `WebdriverIO.Browser` as the
 * Appium driver type) compile for a project that does not install
 * `webdriverio`: web users install nothing new.
 *
 * When `webdriverio` is installed, its own global `interface Browser` merges
 * with this empty one and the full type wins; nothing here adds a member.
 */
export {};

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace WebdriverIO {
        // eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type
        interface Browser {}
    }
}
