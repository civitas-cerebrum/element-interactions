# Capabilities files

Capabilities for a platform run live only in JSON files in this folder. A test
run picks one with `CAPABILITIES` and the library sends its content exactly as
written: it adds, defaults and rewrites nothing.

```
PLATFORM=<platform> CAPABILITIES=tests/capabilities/<device>.local.json APPIUM_URL=<appium-server-url-with-base-path> \
  npx playwright test -c playwright.platform.config.ts
```

## Files

| File | Targets |
|---|---|
| `android.example.json` | An Android device or emulator through UiAutomator2. Placeholders for the device name and serial; `com.example.app` as the app. Used by the unit tests and as the template of the `android-emulator` job in `.github/workflows/platform.yml`, which writes its own file (`ci-android-emulator.local.json`) with the emulator's values and `com.android.settings`. |
| `ios.example.json` | An iPhone (device or simulator) through XCUITest. Placeholders for the device name and UDID; `com.example.app` as the app. Used by the unit tests and as the template of the `ios-simulator` job, which writes its own file (`ci-ios-simulator.local.json`) with the booted simulator's values and `com.apple.Preferences`. |

The example files are templates: copy one to a new file named
`<name>.local.json` (for example `tests/capabilities/my-iphone.local.json`) and
fill in the real values. `tests/capabilities/*.local.json` is in `.gitignore`,
so a file naming a real device stays out of version control. The CI jobs write
their files under the same naming (`ci-*.local.json`).

## Shape

Each file is ONE flat W3C capabilities object: top-level keys only, no
`alwaysMatch` / `firstMatch` wrapper (a wrapped file is refused).

Required keys:

- `platformName`: `Android` or `iOS`. It must agree with `PLATFORM` (case-insensitive), or the run fails before a session opens.
- `appium:automationName`: `UiAutomator2` (Android) or `XCUITest` (iOS).
- `appium:deviceName`: set it explicitly; tools that open inspection sessions inject their own default otherwise.
- `appium:newCommandTimeout`: set it explicitly (the examples use 300 s) for the same reason.
- The app under test: `appium:appPackage` (and usually `appium:appActivity`) on Android, `appium:bundleId` on iOS, or `appium:app` (a path to the build). Steps that take an optional app id default to it.

Recommended: `appium:udid` for a real device, `appium:noReset: true` to keep
the app's data between sessions, `appium:autoGrantPermissions: false`
(Android) and `appium:autoAcceptAlerts: false` (iOS) so permission dialogs
and alerts stay under the test's control.

A mobile **browser** session (a file with `browserName`) must also set
`"wdio:enforceWebDriverClassic": true`; without it WebdriverIO 10 adds BiDi
capabilities to the session, so the file would no longer be sent as written,
and the fixture refuses it. Native-app files do not need it.

## The Settings specs

`tests/cross-platform` and `tests/live` drive only the built-in Settings app,
read-only. Before any session opens they refuse a capabilities file unless the
app id is the Settings app (`appium:bundleId: com.apple.Preferences` on iOS,
`appium:appPackage: com.android.settings` on Android) and it has no
`appium:app`, `appium:otherApps`, `appium:options` or `browserName` key, no
`appium:fullReset` other than `false` and no `appium:noReset` other than
`true` (`tests/cross-platform/settingsGuard.ts`).

## No secrets

Nothing secret goes into these files, and no server address either:

- The server comes from `APPIUM_URL` (full URL including the base path, for example `http://127.0.0.1:4723` or `http://<appium-server>:4723/wd/hub`).
- Credentials for a remote or cloud server come from `APPIUM_USER` and `APPIUM_KEY`. They are never read from a capabilities file.
- Do not commit real device names, UDIDs, serials or signing team ids.
