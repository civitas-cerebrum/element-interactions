# Changelog

## 0.4.0 — 2026-11-23

Platform testing: the same `Steps` API on native Android and iOS apps through
Appium and WebdriverIO. Web behaviour is unchanged except for the items under
**Breaking** and **Fixed**. See the README section "Platform testing (Android, iOS)".

### Breaking

- **Depends on `@civitas-cerebrum/element-repository` `^0.4.0`** (was `^0.3.4`).
  Its `webdriverio` peer moves to `^10` (element-repository 0.3.4 declared
  `^9.27`), so the effective `webdriverio` range for platform runs is `^10`.
  **Migration:** upgrade both packages together; a project that depends on
  element-repository directly moves that range to `^0.4.0`.
- **Deep imports moved** from `dist/interactions/*` to `dist/playwright/*`:
  `interactions/Interaction` → `playwright/PlaywrightInteractions`,
  `interactions/Verification` → `playwright/PlaywrightVerifications`,
  `interactions/Extraction` → `playwright/PlaywrightExtractions`,
  `interactions/Navigation` → `playwright/PlaywrightNavigation`,
  `interactions/BrowserRequest` → `playwright/BrowserRequest`,
  `interactions/facade/ElementInteractions` → `playwright/ElementInteractions`.
  The package root exports keep their names (`Interactions`, `Verifications`,
  `Extractions`, `Navigation`, `ElementInteractions`, `BrowserRequest`).
  **Migration:** import from the package root instead of a deep path:
  ```ts
  import { Interactions, Verifications } from '@civitas-cerebrum/element-interactions';
  ```
- **Element parameters widened to `Element`.** The methods of `Interactions`,
  `Verifications`, `Extractions` and `Navigation`, and `Utils.softProbe` /
  `Utils.waitForState`, take element-repository's `Element` instead of
  `WebElement`; on web a non-web element is refused with an error. Code that
  passes `WebElement`s compiles unchanged, but a subclass that overrides one of
  these methods with a `WebElement` parameter no longer type-checks.
  **Migration:** type the overriding parameter as `Element` and narrow with
  `isWeb(element)` where the override needs `element.locator`.
- **`ExpectContext` (exported type) is family-neutral.** `resolveElement()` and
  `resolveAll()` return `Promise<Element>` (was `Promise<WebElement>`), and
  `verify` is typed `IVerifications` (was `Verifications`).
  `resolveElement(timeout?)` and `captureSnapshot(timeout?)` take an optional
  `timeout`, the matcher's own (a `.timeout(ms)` on the matcher), so a device
  family can fit one resolution inside it; calls without it are unchanged, and
  an object implementing `ExpectContext` may ignore it. Likewise
  `steps.on(...).probeTarget()` on the exported `ElementAction` resolves to
  `Element` (was `WebElement`). Code that reads `.locator` from a resolved
  element, or calls a `Verifications`-only method through `ctx.verify`, no
  longer compiles.
  **Migration:** narrow the element first (the same for `probeTarget()`):
  ```ts
  const el = await ctx.resolveElement();
  if (isWeb(el)) { /* el.locator is available here */ }
  ```
- **Fatal driver errors are no longer retried or disguised on web.** Matcher
  predicates (`satisfy`) fail at once on an error matching the fatal driver
  patterns (an invalid selector, an invalid or terminated session, a refused
  or reset connection) where 0.3.12 retried until the timeout. The list-entry
  check of `getAll` on a `"list": true` entry rethrows such an error as is
  instead of reporting `found 0`.
  **Migration:** none for passing suites. A test that relied on such an error
  being retried, or on the `found 0` message for it, fixes the underlying error.
- **Missing-page error text changed.** The web fixture's `repo` is built with
  `{ platform: 'web' }`, so a page name resolves to its web block even when the
  file also holds android / ios blocks. A page with no entry now throws
  `ElementRepository: page '<name>' has no entry for platform 'web'. Available: <platforms>.`
  (was `ElementRepository: Page '<name>' not found.`).
  **Migration:** update assertions on the old text, e.g. match
  `/has no entry for platform/`.
- **`baseFixture` has an explicit return type**, `BaseFixtureTest`, and a new
  `driver` fixture (the WebdriverIO session on a device; on web requesting it
  throws `PlatformNotSupportedError('driver', 'web')`). Code that spelled out
  the old inferred type, or that extends the result with a fixture of its own
  named `driver`, is affected.
  **Migration:** use `BaseFixtureTest` where the type is written out; rename a
  custom `driver` fixture.
- **The `interactions` fixture is typed `ElementInteractions | PlatformInteractions`**
  (it is a `PlatformInteractions` on a device run). The members both share
  (`interact`, `verify`, `extract`, `navigate`, `email`) work as before, but a
  result they typed `WebElement` is now typed `Element` through the fixture,
  e.g. `interactions.interact.getListedElement(...)`, so reading `.locator`
  from it no longer compiles.
  **Migration:** to use a member only one side has, narrow first, e.g.
  `if (interactions instanceof ElementInteractions) { await interactions.request.get(url); }`;
  narrow a returned element with `isWeb(element)` before reading `.locator`.
- **The published `.d.ts` declares an empty global `WebdriverIO.Browser`
  interface**, so the typings compile without `webdriverio`; it merges with
  WebdriverIO's own interface when that is installed, and with any global
  `WebdriverIO.Browser` a project declares itself.
  **Migration:** TypeScript users of the Appium API add
  `import type {} from 'webdriverio'` (or `"types": ["webdriverio"]`) to see
  the full driver type.
- **`baseFixture` reads `E2E_PLATFORM`.** A set, non-empty `E2E_PLATFORM` that
  is not a platform name makes `baseFixture()` throw, naming the variable.
  `E2E_CAPABILITIES` names the capabilities file of a platform run. The
  unprefixed `PLATFORM` and `CAPABILITIES` are never read, so ambient values
  cannot affect a run.
  **Migration:** none for web projects that do not set `E2E_PLATFORM`.
- **`getAll` honours an empty-string `child`** (`child: ''`) instead of
  ignoring it.
  **Migration:** drop `child: ''` from calls that meant "no child".
- **A per-call timeout is honoured on web: `verifyState`, the `.timeout(ms)`
  chain and the `StepOptions` `timeout` of the verification steps.** `steps.verifyState(el, page, state, timeout)`
  and `steps.on(el, page).timeout(ms)` before `verifyState` / `verifyOrder` /
  `verifyListOrder` / `verifyImages` used to wait for the default timeout (30 s
  unless configured), whatever was passed. The same holds for a `{ timeout }`
  in the `StepOptions` of `verifyPresence`, `verifyAllPresent`, `verifyText`,
  `verifyTextContains`, `verifyCount`, `verifyAttribute`, `verifyInputValue`,
  `verifyOrder`, `verifyListOrder`, `verifyImages`, `verifyCssProperty`,
  `verifyHtml`, `verifyHtmlContains` and `verifyHtmlMatches`, which was
  ignored (`verifyAbsence` already honoured it). A check that passed only
  because it waited longer than its stated timeout now fails at that timeout.
  **Migration:** none for calls without a timeout (but see `verifyListOrder`
  below). If a step now fails at its own short timeout, raise that timeout (or
  drop it to use the default).
- **`verifyListOrder` on web polls until its timeout.** It used to read the
  list once and fail at once on an unsorted list. It now re-reads the list
  every 100 ms until it is sorted or the timeout (the configured element
  timeout, 30 s unless configured) runs out, so an unsorted list fails only
  after that timeout, and a list that becomes sorted within it now passes.
  **Migration:** an unsorted list now fails after the step timeout; pass a
  short timeout where a fast failure is wanted:
  `await steps.on(elementName, pageName).timeout(2000).verifyListOrder('asc')`
  or `await steps.verifyListOrder(elementName, pageName, 'asc', { timeout: 2000 })`.
- **The fluent `getCount()` and `getAllTexts()` read the whole collection on web.**
  `steps.on(el, page).getCount()` returned 1 and `getAllTexts()` a one-item
  array for an entry with several matches; they now return the number and the
  texts of every match, and a strategy selector on the chain (`.nth(i)`,
  `.byText(...)`, ...) no longer narrows them.
  **Migration:** none where the whole collection was meant. To read one match,
  narrow and read it: `await steps.on(el, page).nth(i).getText()`.
- **`verifyCount` checks the upper bound of a range and refuses contradictory options.**
  On web, `verifyCount(el, page, { greaterThan: 1, lessThan: 3 })` passed for
  any count above 1; it now fails unless the count is also below 3. Options
  that combine `exactly` with a bound (`{ exactly: 3, greaterThan: 1 }`, which
  used to assert `exactly` alone), give two lower or two upper bounds, or
  describe a range no count satisfies now throw at once.
  **Migration:** none for calls whose bounds were all meant. Fix a range whose
  upper bound the count exceeds, and drop the extra bound next to `exactly`.
- **`verifyAbsence` on a `.byText()` chain asserts on the selection, on web and on a device.**
  `steps.on(el, page).byText('No such row').verifyAbsence()` (and
  `steps.verifyAbsence(el, page, { strategy: 'text', text })`) ignored the
  text and asserted that no match of the whole entry was shown, so it failed
  while any other item was on screen. It now passes when the match the
  selection picks is hidden or when no match has the text, and fails while that
  match is shown. It checks only the match the selection picks (on web the
  first element containing the text; on a device an exact text match, else the
  first containing match), so a hidden first match passes even while a later
  match with the same text is shown. A fatal driver error still fails at once
  on a device, and on a device only a clean "not found" reads as absent
  (element-repository's `TextNotFoundError` with `cleanMiss`): a selection
  whose final pass met a transient driver error (a failed `$$`, a stale text
  read) is polled again, for `verifyAbsence`, `not.visible` and
  `visible.toBeFalse()` alike. Other strategy selectors and plain entries keep
  asserting on every match. To assert that no element with the text is shown, use the plain
  entry with an attribute- or text-specific selector in the repository.
  **Migration:** to assert that no match of the entry is shown, drop the
  `.byText()` from the chain: `await steps.on(el, page).verifyAbsence()`.

### Added

- **Platform testing.** `baseFixture(test, repo, { platform, session })`:
  `platform` is `'web' | 'android' | 'ios' | 'macos' | 'windows'` (default
  `E2E_PLATFORM`, else `web`; an empty value counts as unset). On `android` /
  `ios` the fixture opens one WebdriverIO session per worker from a
  capabilities file, relaunches the app under test before every test
  (`session.reset`, default `'relaunch'`; `'none'` skips it) and starts the
  test only once the app is in the foreground (`session.relaunchTimeout`,
  default 15000 ms; otherwise the setup fails naming the app id, the platform
  and the last app state; a dead session fails at once), calls
  `session.onSessionStarted` once, and closes the session at worker teardown
  (time-boxed, never masking a test error). No browser starts; `page` /
  `context` throw `PlatformNotSupportedError`. A failed test gets
  `failure-screenshot` (image/png) and `page-source` (text/xml) attachments,
  each time-boxed. `macos` / `windows` are declared but not implemented: the
  session start throws `Platform "<p>" is declared but not implemented yet.`
- **Platform: the relaunch retries an iOS launch timeout once.** When
  WebDriverAgent answers the fixture's between-tests `mobile: activateApp`
  with "Timed out attempting to launch app", the activation is retried once,
  logged as a warning naming the app id, the platform and the error. The
  retried activation and the foreground wait after it share
  `session.relaunchTimeout`; a second failure fails the setup, and no other
  error is retried. The user-facing `resetApp` / `activateApp` / `launchApp`
  steps never retry. A relaunch failure names its phase (terminate, activate,
  foreground wait), the app id, the platform and the budget.
- **Platform: setup evidence.** A platform test whose setup fails (relaunch,
  foreground wait, `onSessionStarted`) gets a `setup-error` (text/plain)
  attachment with the error and the last app state, plus `failure-screenshot`
  and `page-source` when the device still answers; each is time-boxed and
  never replaces the setup error. A failing `onSessionStarted` fails the test
  that needs the session, in its setup and with this evidence, rather than the
  worker fixture; the session is still closed at worker teardown.
- **Platform: `session.startTimeout`** (ms, default 600000): the worker
  fixture's own timeout for opening the session (the provider's start plus
  `onSessionStarted`), independent of the test timeout, so a cold real-device
  start (WebDriverAgent build, UiAutomator2 server install) has room. A start
  that does not answer fails shortly before it expires (a tenth of the
  budget, at most 5 s, is kept back) with an error naming the server URL
  without credentials, the platform and the budget, instead of Playwright's
  generic fixture timeout; a session that still arrives is closed. A failed
  start names the same, keeping the provider's error.
- **Environment variables**, the complete list: `E2E_PLATFORM`,
  `E2E_CAPABILITIES`, `APPIUM_URL`, `APPIUM_USER`, `APPIUM_KEY`, documented in
  `.env.example`. Empty values count as unset. `resolvePlatform(option?, env?)`
  applies the platform rule in configs and fixtures.
- **Session layer**: `AppiumSessionProvider` (dynamic `import('webdriverio')`
  on first start, WebdriverIO implicit wait 0, capabilities sent as a deep copy
  of the file) and the types `SessionProvider`, `SessionOptions`,
  `ServerOptions`, `SessionStartContext`, `AppiumSessionProviderOptions`,
  `AppiumClientOptions`, `WebdriverioLogLevel`, `WebdriverioModule`.
  A capabilities file is one flat W3C object: `platformName` must match the
  platform, wrapped files are refused, and a `browserName` file must set
  `"wdio:enforceWebDriverClassic": true`. The server is its own URL (base path only if it has
  one) or an object; credentials come from `APPIUM_USER` / `APPIUM_KEY`.
- **Types of the steps and option shapes**: `StepsOptions` (the options of
  `new Steps(...)`), `ElementActionFamily` (the family a `steps.on(...)` chain
  acts through), `VerifyOptions` (the `{ negated?, timeout?, errorMessage? }`
  every `Verifications` method accepts) and `VisualMatchPrimitiveOptions` (the
  resolved options `Verifications.visuallyMatches` takes). The web classes are
  also exported under their family names: `PlaywrightInteractions`,
  `PlaywrightVerifications`, `PlaywrightExtractions`, `PlaywrightNavigation`
  (the same classes as `Interactions`, `Verifications`, `Extractions`,
  `Navigation`).
- **Family interfaces**: `IInteractions`, `IVerifications`, `IExtractions`,
  `INavigation`, `IUtils`, `IGestures`, `IDevice`, `IInteractionFactory`, with
  the types `Direction` (an alias of element-repository's `SwipeDirection`),
  `Orientation`, `PermissionState`, `VerifiableState`, `DeviceVerifyOptions`,
  `ScreenSwipeOptions`, `ScrollStepOptions` and `EntryTarget`. The element gestures of
  `IGestures` resolve to the element, as element-repository's primitives do.
- **Gesture types re-exported from element-repository**: `SwipeDirection`,
  `SwipeOptions`, `ScrollIntoViewOptions`, `LongPressOptions`, `TapOffset`,
  `TapAtOptions`, `PinchOptions`, `ZoomOptions`. The package defines no copy of
  its own.
- **Factories**: `PlaywrightFactory(page)` and `AppiumFactory(driver, platform,
  { timeout, appId })`, with the `PlaywrightFactoryOptions`,
  `AppiumFactoryOptions` and `AppiumDriver` types. `new Steps(factory, repo,
  options)` is the factory form; `new Steps(repo, options)` keeps building web
  Steps. The Appium family's classes and per-platform rules are internal and
  reached through the factory, and so are the web family's gesture and device
  members. `PlatformInteractions` is the `interactions` fixture on a device.
  On a device a plain entry's `verifyAbsence` retries a failed lookup or a
  failed read of a match (a list redrawn while shown leaves every handle
  stale) rather than reading it as absent.
- **Errors catchable by type**: `MissingAppIdError` (an app step without an app
  id), `PollTimeoutError` (a polling device verification ran out of time; it
  carries `timeout`, `lastValue` and `lastError`) and `ProbeTimeoutError` (the
  `lastError` when a device probe did not answer within its share of the
  timeout), except list-entry `verifyPresence`, which throws a plain `Error`
  (same message as on web) with the `PollTimeoutError` as `cause`.
- **Platform steps**: `launchApp`, `activateApp`, `terminateApp`,
  `backgroundApp`, `resetApp`, `installApp`, `removeApp`, `openDeepLink`;
  `swipe`, `swipeScreen`, `scrollUntilFound`, `longPress`, `tapAt`, `pinch`,
  `zoom`, and `scrollIntoView` gains `{ direction, maxSwipes }`; every element
  gesture step takes `StepOptions` too. The fluent chain gains `swipe`,
  `scrollUntilFound`, `longPress`, `tapAt(offset, options?)`, `pinch` and
  `zoom`, and its `scrollIntoView` takes the scroll options too.
  `scrollUntilFound` is element-repository's `scrollIntoView` sweep with the
  timeout always given (stops at the timeout or after `maxSwipes` swipes).
  On a device an element already on screen returns at once; otherwise, only
  when a soft keyboard is shown, the keyboard is hidden first (best-effort),
  then the sweep runs with fixed swipes up to `maxSwipes` (default 20),
  bounded by the step timeout (default 30 s; pass a larger `timeout` for long
  lists, and allow for the first gesture of a fresh iOS session taking tens of
  seconds).
  `pressBack` (android only), `hideKeyboard`, `setOrientation`, `acceptAlert`,
  `dismissAlert`, `setPermission`; `getContexts`, `switchContext`; polling
  `verifyAppInForeground`, `verifyOrientation`, `verifyKeyboardShown`,
  `verifyContext`; `getPageSource`. `steps.platform` names the active platform.
- **`hideKeyboard(options?)` hides any soft keyboard through element-repository's `dismissKeyboard`.**
  It runs element-repository's dismissal steps on iOS and Android (on iOS
  including the keyboards without a Done key, such as a login form's Return
  key), checks the keyboard after every step and returns `true` when a shown
  keyboard is gone, `false` (nothing else sent) only when no keyboard was
  shown. A "no keyboard" answer is checked again with `mobile:
  isKeyboardShown`; when that check reports a keyboard or fails, the step
  throws `hideKeyboard: the keyboard state could not be confirmed and nothing
  was sent: ...`. `options.tapElement` (`{ pageName, elementName }`, a
  repository entry) names a neutral element that iOS taps first; without it
  **iOS may press the keyboard's action key, which can submit a form or run a
  search**. `options.timeout` is one budget for the whole step: the
  `tapElement` resolution spends from it and the dismissal gets what is left;
  a dismissal step already started runs to its end, so the call can end up to
  one step after the budget. A keyboard still shown after every step throws
  element-repository's `KeyboardStillShownError`, re-exported from the
  package root, as is the `HideKeyboardOptions` type.
- **A scroll container for `scrollIntoView` / `scrollUntilFound`.** The steps
  and the fluent terminals take `ScrollStepOptions`:
  element-repository's `ScrollIntoViewOptions` with `container?: string`, the
  element name (on the target's page) of the scrollable ancestor, e.g.
  `steps.scrollUntilFound('productName2', 'ProductCarouselPage', { direction: 'right', container: 'carousel' })`.
  The step resolves it through the repository (the active platform's entry)
  and passes the element on as `ScrollIntoViewOptions.container`; on a device
  element-repository then sweeps inside the container's rect with a
  paging-safe drag (85% to 15% of its extent), which a carousel or side list
  that does not cross the window centre needs. A name the page does not
  define fails before any swipe:
  `scrollIntoView: container "<name>" on page "<page>" could not be resolved: ...`.
  On web the container is resolved the same way and Playwright ignores it.
- **Platform paths** for `"list": true` entries, `child` / `withDescendant` on
  listed elements, `verifyAbsence`, `isVisible` / `ifVisible` probes and the
  matcher tree on device platforms. Listed-element `text` and
  `withDescendant.text` match as on web (case-insensitive substring, whitespace
  normalised, first item in list order; a RegExp tested as is), while
  `repo.getByText` on a device prefers an exact match.
- **Visible text on iOS** is the element's `label`, falling back to its
  `value` (never `name`; on a text field, secure text field, text view or
  search field the `value` wins), not WebdriverIO's raw `getText()`, which
  answers `value` first. The rule is element-repository's
  (`Element.textContent()`); every device text read goes through it. Android
  reads the element's text; a container whose own text is empty (a list row)
  reads its descendants' text, hints left out, joined with single spaces in
  document order (`Item 1 Alpha`), in `getText`, `verifyText*`, `getAll`,
  listed-element `text` and the text strategy alike. iOS follows the same
  rule: an element whose `label` and `value` are empty (not a text input, a
  static text or an image) reads its descendants' static text joined with
  single spaces. On a device `getText`
  returns `''` (never `null`) when an element has no text.
- **`doubleClick` on a device is a native double tap** on the element's
  centre (element-repository: `mobile: doubleTap` on iOS,
  `mobile: doubleClickGesture` on Android), so a 2-tap gesture recogniser and
  a button counting taps see two taps; an element that is not found fails
  `doubleClick: "<selector>" not found within N ms` before anything is sent.
- **Checked state on a device** (`verifyState(..., 'checked')`, `check`,
  `uncheck`) is element-repository's: Android reads the `checked` attribute,
  iOS a switch's or toggle's `value` and other elements' `selected` state.
  `check` / `uncheck` tap only when the state differs and confirm the new
  state within the step timeout; they fail with `is still unchecked after
  clicking` / `is still checked after clicking`, and refuse without a tap an
  Android radio button being unchecked, a control that is not checkable, and
  a control still disabled at the timeout. `getAttribute` on a device returns
  `null` for a missing attribute (UiAutomator2 answers `"null"`) and for one
  the driver does not know on either platform (XCUITest and UiAutomator2
  answer with an "attribute is unknown" error), so a misspelt name reads as
  missing and `attributes.not.toHaveKey(name)` passes on a device; other
  driver errors still fail at once.
- Platform verifications, list presence, listed-element steps and probes fail
  at once on a fatal driver error (a dead session, an invalid selector, a lost
  connection) instead of at the timeout; such an error never reads as absent.
- Re-exported from element-repository: `Platform`, `DriverFamily`, `PLATFORMS`,
  `isPlatformName`, `familyOf`, `PlatformNotSupportedError` (one class across
  both packages, so `instanceof` works).
- **Step classification.** Web-only steps throw
  `PlatformNotSupportedError(<step>, <platform>)` on a device; platform-only
  steps throw it on web. Element gestures `swipe` / `longPress` /
  `scrollUntilFound` work on web through the element's mouse primitive;
  `pinch` / `zoom` throw on web.
- **Cross-platform spec** (`tests/cross-platform`): one spec that runs
  unchanged on web (in the default suite) and on Android / iOS
  (`playwright.platform.config.ts`), plus example capabilities files in
  `tests/capabilities/`.
- **Live device specs** (`tests/live`, run with `playwright.platform.config.ts`):
  `ios-settings.spec.ts` against the built-in Settings app, read-only, and
  `android-testapp.spec.ts` against the project's Android test app
  `com.civitas.testapp` (already installed; nothing is installed or removed):
  app lifecycle, the app's own dialogs, the keyboard, orientation (restored to
  portrait), contexts, screen swipes, scrolling, lists, checkboxes and
  switches, `pressBack` and web-only refusals. Both were run on a real device;
  the README section "What is verified" lists what each covers.
- **Device-app guard** (`tests/cross-platform/appGuard.ts`): before a device
  session opens, the capabilities file is checked against an allow-list, so
  each device platform drives only its one app (the Settings app on iOS, the
  test app on Android): no install, no second app, no browser, no full reset,
  `noReset: true`, no auto-granted permissions or auto-handled alerts.
  Unit-tested in the default suite.
- **CI workflow** `.github/workflows/platform.yml`: the cross-platform spec on
  an Android emulator and an iOS simulator, started manually
  (`workflow_dispatch`).
- `webdriverio@^10` is an **optional** peer dependency: install it only for
  platform runs. It is imported on first use; web users never load it.
  WebdriverIO 10 requires Node `>=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1`.

### Changed

- The web-only `baseFixture` options (`blockedOrigins`, `mutationInjection`,
  `interceptionRetry`, `screenshotOnFailure: { fullPage }`) throw on a platform
  run instead of being ignored.
- The package description and keywords cover native Android and iOS testing.
- The README states a limitation of `.byText()` on long lists: one text
  pass reads every candidate serially (measured on the iOS simulator: about
  3.8 s for 16 cells, about 17 s for 100 by the same figures; on a real
  Android phone: 3.05 to 3.57 s cold and 2.46 to 2.68 s warm for 11 cells),
  what that means with the default timeouts, and the selector-based
  alternatives.

### Fixed

- **`verifyState` honours its per-call timeout.** `steps.verifyState(el, page,
  state, timeout)` and `steps.on(el, page).timeout(ms).verifyState(state)`
  waited for the default timeout (30 s unless configured) on web and on a
  device, whatever `timeout` was passed. The same applies to `.timeout(ms)` on
  `verifyOrder` (web and device), `verifyListOrder` (web and device) and
  `verifyImages` (web). On web, `verifyListOrder` now polls until its timeout
  instead of reading the list once; a sorted list passes on the first read as
  before (the default polling of web `verifyListOrder` is listed under
  Breaking). The chain's default is the configured timeout. The
  `Verifications.order` / `listOrder` primitives take an optional
  `VerifyOptions`, and `Verifications.images` an optional `timeout`.
- **A `StepOptions` timeout reaches every verification step that takes
  `StepOptions`.** `verifyPresence`, `verifyAllPresent`, `verifyText`,
  `verifyTextContains`, `verifyCount`, `verifyAttribute`, `verifyInputValue`,
  `verifyOrder`, `verifyListOrder`, `verifyImages`, `verifyCssProperty`,
  `verifyHtml`, `verifyHtmlContains` and `verifyHtmlMatches` applied the
  `StepOptions` strategy but dropped its `timeout`, so
  `steps.verifyListOrder(el, page, 'desc', { timeout: 500 })` waited for the
  default timeout (30 s unless configured), on web and on a device. They now
  use the given `timeout`, exactly as `steps.on(el, page).timeout(ms)` does;
  without one they keep the configured timeout.
- **A web-only terminal behind a visibility gate is refused on a device.**
  `steps.on(el, page).isVisible().hover()`, `steps.isVisible(el, page).hover()`
  and the same gate before `rightClick`, `uploadFile`, `selectDropdown`,
  `setSliderValue` or `selectMultiple` used to probe the element first and, when
  it was not shown, return without doing anything; behind a shown element the
  refusal came only after the probe. They now throw
  `PlatformNotSupportedError(step, platform)` before anything is sent to the
  device, like the ungated step. Web is unchanged.
- **The fluent `getCount()` and `getAllTexts()` read every match.**
  `steps.on(el, page).getCount()` answered 1 and `getAllTexts()` only the first
  match's text, on web and on a device, because both resolved the first match.
  They now read the entry's whole collection, like `steps.getCount` /
  `steps.getAll` and the chain's `.count` matchers, whatever strategy selector
  the chain carries.
- **`verifyCount` accepts every documented bound and checks both ends of a range.**
  `steps.verifyCount(...)` and `steps.on(el, page).verifyCount(...)` refused
  `{ greaterThanOrEqual }` / `{ lessThanOrEqual }` at runtime although the
  typings and the README accept them, and `{ greaterThan, lessThan }` checked
  only `greaterThan`, on web and on a device. Every given bound is now checked
  at the same time; `CountVerifyOptions` also types a mixed range
  (`{ greaterThan, lessThanOrEqual }`, `{ greaterThanOrEqual, lessThan }`).
  The failure names the bound the last count broke (`6 is not < 3`), and
  contradictory or empty options throw at once, before the element is resolved.
- **`byText` under a polling terminal finds a later item on a device.**
  `steps.on(el, page).byText('Green 2').verifyText('Green 2')` (and a matcher,
  a `satisfy()` snapshot or `verifyState` after `.byText()`) timed out on a
  device when the item was not the first: every poll gave the text strategy a
  1 ms budget, and element-repository's text lookup stopped reading candidates
  at its deadline, so each poll read only the first item. element-repository
  0.4.0's text strategy reads every candidate of a pass it has started (the
  budget only decides whether another pass starts), so every poll, snapshot and
  visibility-probe attempt keeps its one-check budget and still reads the whole
  list. A text that matches nothing still fails with `with text "..." not
  found`. A list whose single read pass takes longer than the step's timeout
  does not answer within it: the step fails (`No answer was obtained`) and the cut-off
  pass is never read as "not found", "absent" or "not visible". Web is not
  affected.
- **`not.visible` passes on a device for an element no lookup finds.**
  `steps.on(el, page).byText('No such row').not.visible.toBeTrue()` timed out
  on a device: every poll read the element's displayed state, the lookup threw
  `with text "..." not found`, and a poll with no answer never passed. A
  negated `visible` matcher now reads an element that is not found as not
  visible, as web's `not.toBeVisible()` does; a fatal driver error still fails
  at once, and a probe that does not answer is never read as an answer.
  `visible.toBeTrue()` still fails with the lookup's reason. Web is not affected.
- **A poll whose last probe does not answer keeps the earlier real error.**
  When a probe failed for a reason (an element not found) and a later one did
  not answer before the deadline, the timeout message named only the
  unanswered probe; it now gives the reason, followed by
  `; the last probe did not answer within N ms`.
- **A poll whose last probe does not answer after one that did leads with the
  last value.** The timeout message named the unanswered probe as its last
  error (`Last value: true. Last error: the probe did not answer within N ms`);
  it now gives the value, with the unanswered probe as a note after it:
  `Last value: true; the last probe did not answer within N ms.` A failing
  device absence, `hidden`, negated `visible`, negated presence or negated
  `inViewport` check also says what the value means: `Expected element to be
  absent (not displayed): timed out after 8000 ms. The element was still
  displayed on the last answered poll (Last value: true).` `lastError` is
  unchanged. A poll in which every probe answered with an error keeps
  `(no value; every probe failed)`. Web messages are not affected.
- **A device poll in which no probe answered says so.** When every probe ran
  out of its share of the timeout (a driver call or a lookup pass longer than
  the timeout, or a driver that stopped answering), the message read like a
  failed check: `Last value: (no value; every probe failed). Last error: the
  probe did not answer within N ms`. It now says no check finished, how long
  the probe was given, and what may have caused it: `... timed out after
  3000 ms. No answer was obtained: no check finished within the timeout. The
  probe was still running when its 3000 ms ran out: one check (a driver call
  or a lookup pass) takes longer than the 3000 ms timeout, or the driver
  stopped answering. Allow more time with a longer timeout.` An element check
  (a `verify*` step, a matcher, `verifyCount`, list presence, a listed-element
  lookup) adds: `For an element check, one lookup pass may be slower than the
  timeout: use a longer `.timeout(ms)` or a selector that matches fewer
  elements (a `byText` selection reads the text of every candidate).` A device
  check (`verifyOrientation`, `verifyKeyboardShown`, `verifyContext`,
  `verifyAppInForeground`) does not. A `"list": true` entry's
  `verifyPresence` keeps its lead (`verifyPresence: '<page>.<name>' is a list
  entry ("list": true) — expected at least one visible match within Nms.`)
  and follows it with the no-answer text instead of `found 0 match(es) and
  none visible`, since no poll counted any match. The verdict is unchanged (the step still
  fails); `lastValue` is `undefined` and `lastError` is still the
  `ProbeTimeoutError`. Web messages are not affected.
- **A device poll never runs two of its probes at once.** When a probe ran out
  of its share of the timeout, the poll could start one more probe beside it
  if the probe's timer fired a moment before the clock read the deadline, so
  two lookup passes of the same check ran together and both kept going after
  the step failed. A probe that runs out of time now ends the poll at once
  (it was already given all the time left); the verdict and the message are
  unchanged.
- **A device check that times out no longer holds up the next test with its
  leftover lookup.** A check that timed out during a slow lookup pass (a
  `.byText()` pass over a long list) left the pass running; the next test's
  relaunch made every element it held stale, WebdriverIO looked each one up
  again, and that traffic (measured on the iOS simulator: about 65 s, 53 list
  lookups) left the next test's own checks without an answer. The platform
  fixture now waits for such lookups after the test body, before the failure
  evidence and the next relaunch, and again before each relaunch and at
  worker teardown, so each one ends on the app launch it started on. **A
  failing device test may take a little longer** (about one driver command, or the commands of one element read in flight
  (a container's text read reads its descendants), since the check stops its
  lookup: see the next item). The wait is
  capped at 10000 ms, and when there is something to wait for the fixture
  first extends the test's timeout by that cap, so the wait never makes a
  test run out of time (a timeout of `0` stays as it is). Lookups still
  running at the cap are named in a console warning and a `warning`
  annotation on the test, and the run carries on. The wait never fails a test
  nor replaces its error. Device checks (`verifyOrientation`,
  `verifyKeyboardShown`, `verifyContext`, `verifyAppInForeground`) are waited
  for too.
- **A device check that times out stops its lookup.** Every poll probe gets
  an abort signal of its own, aborted when the poll gives up on it and once
  the poll is done with it. The device checks pass it to every repository
  lookup they make (element-repository's lookup `signal`) and check it
  between their own reads, so a check that timed out starts no driver
  command afterwards. The fixture aborts the lookups again before it waits
  for them, so **the wait after a failing device test is normally about one
  driver command, or the commands of one element read in flight (a
  container's text read reads its descendants)**, no longer the rest of a lookup pass (the cap stays
  10000 ms). What still finishes after the timeout: the driver command in
  flight, and a read already running on an element a lookup returned (a
  returned element does not carry the signal). An aborted lookup is never an
  answer: it never reads as absent or not visible and is never a poll's last
  error. `EntryTarget`'s resolvers take an optional `signal` after the
  attach budget.
- **A negated count range on a device is worded as on web**: `Expected count
  not > 5`, no longer `Expected NOT count > 5`.

## 0.3.12 — 2026-11-01

### Added

- **`baseFixture({ mutationInjection })`** — the browser-level hook a behavioural
  mutation runner (e.g. `achilles-mutate`) needs, so a project using this package
  writes none itself. With the option on, an opted-in payload is forwarded to every
  page and child frame of the test's context: `E2E_MUTATION_INIT` as an init script,
  `E2E_MUTATION_CSS` as a constructable stylesheet adopted from an init script of its
  own. Accepts `true` or `{ strict: true }`. Default `false`.

  Three things it refuses to do quietly, because the number this feature exists to
  produce is corrupted by a silent no-op — an injection that never applied leaves the
  suite green, and the runner writes down "mutant survived", a coverage gap nobody
  actually has:

  - **It will not inject on ambient environment alone.** `E2E_MUTATION_RUN` (`1`/
    `true`/`yes`) is a required opt-in; without it a payload is ignored and reported
    (`log.warn` plus a `mutation-injection-ignored` annotation). A value left behind
    by an earlier mutation run in the same CI job, exported by a shell profile, or
    committed to a `.env` — which this package's `dotenv` call loads — can no longer
    mutate a normal run and have the failure blamed on the application.
  - **It will not mutate a run without saying so.** Activation logs a warning and
    pushes a `mutation-injection` annotation, the same pattern as `deadline-click`
    in 0.3.9, so a report always shows whether the run under inspection was mutated.
  - **It will not accept an injection it cannot prove applied.** Malformed
    `E2E_MUTATION_INIT` is caught in Node (it used to throw only inside the page),
    CSS is checked for parsing to at least one rule and for being adopted by the
    document, and every page load is sampled; problems become
    `mutation-injection-error` annotations, or test failures under
    `{ strict: true }`. CSS that applies but matches no element is reported as a
    `mutation-injection-warning`.

- `forwardMutationInjection(context, injection?, options?)` and
  `readMutationInjection(env?)` are exported for suites that drive a context
  themselves, alongside `MUTATION_RUN_VAR` and the types `MutationInjection`,
  `MutationInjectionOptions` and `MutationInjectionHandle`. `forwardMutationInjection`
  now returns a handle whose `verify()` resolves to the list of problems found during
  the run (empty when the injection is proven to have applied). An explicit
  `injection` argument needs no opt-in — passing it *is* the opt-in.
- `steps.forPage(page)` — returns a `Steps` bound to another `Page` of the same
  test (a popup, a new tab, a second window), so a test never constructs an
  `ElementRepository` itself to drive one. Repository names resolve on the bound
  page exactly as they do on the main page. Everything except the page is
  shared: the repository data and its live resolution timeout (a later
  `repo.setDefaultTimeout` is seen), the step timeout, `interceptionRetry`, the
  API and SQL client registries (one connection pool, closed once by the owning
  fixture), the email client, and the `tester:*` debug logging. The original
  `Steps` stays bound to its own page — nothing is switched. Pairs with
  `switchToNewTab`:
  `const popupSteps = steps.forPage(await steps.switchToNewTab(() => steps.click('walletButton', 'CheckoutPage')))`.
  Throws if the given page is already closed (a self-closing popup, rather than
  a target-closed error blamed on the next element), and if the repository
  cannot be rebound onto it.
- **`"list": true` entries** (element-repository 0.3.3's entry flag): a
  collection whose contract is "at least one match". Reached without a
  narrowing strategy, `verifyPresence` passes when ANY match is visible (not
  only the first), and `getAll` waits for at least one match and throws when
  there is none instead of returning `[]`; the wait honours a per-call
  `{ timeout }` in both directions. `.nth()`, `.random()`, `.byText()`,
  `.byAttribute()`, `.visible()`, `ifVisible()`, a scoped `findBy*` and a
  `getAll` strategy opt out. Entries without the flag are unchanged.

### Changed

- `steps.switchToNewTab(action)` accepts a value-returning `action`
  (`() => Promise<unknown>`). The documented form passes `steps.click(...)`,
  which resolves `boolean | void` and so did not satisfy the previous
  `() => Promise<void>` under `tsc --strict`. Same treatment `waitForUrl`
  already had; callers passing a `void` action are unaffected. Also on
  `Navigation.switchToNewTab`.
- **`verifyAbsence` semantics for `fallback` entries.** It no longer asserts on
  `repo.getSelector(...)` — the first plain-string strategy of the entry, which
  drops an accessible `name`, cannot express a regex and ignores a page's
  `frame`, so for a role+name entry it failed while any sibling of that role was
  shown and for a regex-text or frame-scoped entry it asserted on a selector
  that could never match anything and passed silently. The entry is now resolved
  through the repository, and the assertion runs on the first VISIBLE match of
  the resolved node's match set: absent when every match is hidden or none
  exists, present when any match is shown. A `fallback` entry is asserted on the
  variant the repository resolves — the first chain node that exists, the node
  an action on the entry would target — so a primary that exists but is hidden
  is absent even while the fallback is visible. The resolution gets a short
  attach slice per chain node instead of the repository's 15s default, derived
  from the chain's effective timeout (an eighth of it, clamped to 250–1000ms),
  so `steps.verifyAbsence(el, page, { timeout })` and
  `steps.on(el, page).timeout(ms).verifyAbsence()` now reach both the slice and
  the underlying `toBeHidden`, where previously neither honoured a
  caller-supplied timeout. A `fallback` entry whose resolved node matches
  several elements is asserted on that node's whole match set (absent only when
  every match is hidden); this needs element-repository 0.3.4, whose `ALL`
  resolution no longer walks past a multi-match node.
- `@civitas-cerebrum/element-repository` floor `^0.3.1` → `^0.3.4`. 0.3.3
  ships the `list` / `provisional` entry flags and the ATTRIBUTE strategy;
  0.3.4 stops the `ALL` strategy from walking past a multi-match `fallback`
  primary, so a list entry with a fallback, and `verifyAbsence` on one, are
  judged on the primary.

### Fixed

- **The mutation CSS no longer has three ways to apply nothing at all.** It used to
  be attached with `page.addStyleTag` from a `page.on('load')` handler, with the
  result discarded (`.catch(() => {})`). Under a `Content-Security-Policy:
  style-src 'self'` header the style element lands and the rules never apply; when
  `load` never fires — a hanging subresource or a long-poll, exactly the timing the
  README advertised — nothing was attached at all; a test asserting at
  `domcontentloaded` or straight after an action-triggered navigation saw a clean
  page; and a genuine rejection (CSP refusal, closed page, navigation) was swallowed.
  The CSS is now adopted through CSSOM (`new CSSStyleSheet()` + `replaceSync`, then
  `document.adoptedStyleSheets`) from an init script: CSP-exempt, in place before the
  document's first script, and covering child frames, which the style-tag route never
  reached. Failures are logged, annotated, and — in strict mode — fatal.
- **A visibility gate no longer skips an element that attaches part-way into the
  probe.** A repository `fallback` chain resolves to whichever node is attached
  *while the walk runs*, so a single resolution is a point-in-time answer. An
  entry whose primary hydrates a second into the probe was therefore answered on
  the fallback the walk had already settled for — the probe reported `false`,
  `.visible().click()` skipped silently, and the test went green having clicked
  nothing, even though the action behind the gate resolves with the repository
  default and would have found the primary. The probe now re-resolves the entry
  across its budget, so a late primary is picked up.
- **A long `fallback` chain no longer reports a visible element hidden.** The
  probe gave the repository an attach slice of `timeout / 8` per chain node, but
  a walk costs `(2N-1)` slices, so from five nodes on the walk consumed the
  whole budget and the node it landed on was left a 1ms visibility wait — which
  reported an element that had been visible since page load as hidden. The slice
  is now a fixed duration rather than a fraction of the budget, and the node the
  walk lands on is looked at with no wait at all before any remaining budget is
  consulted.
- **A visibility probe honours the chain's strategy selector.** `.nth(i)`,
  `.byText(...)` and `.byAttribute(...)` were dropped when building the probe
  target, so every probe answered for the entry's first match. On a list whose
  first row was hidden, `steps.on('rows', page).nth(1).isVisible().click()`
  reported `false` and skipped a click on a perfectly visible second row.
- **`verifyAbsence` no longer misdiagnoses an ordinary single-match primary.**
  It resolves the entry twice (default and `ALL`) to detect a multi-match node
  the strict `ALL` walk would step over. The two walks ran back to back, so they
  looked at two different moments in the page's life: a single-match primary
  that attached between them made them land on different nodes, and the
  divergence was reported as "a fallback entry whose resolved selector matches
  several elements" — a diagnosis of a selector neither node had. The two
  resolutions now run concurrently and a divergence is confirmed by a second
  round before it is blamed on a multi-match selector.
- **`verifyAbsence` no longer leaks an `ElementHandle`.** The handle backing the
  multi-match cross-check was disposed only on the success path, so every
  `evaluateAll` that threw left a handle alive in the browser process for the
  lifetime of the page. Disposal now runs in a `finally`, and a cross-check that
  fails for reasons of the page's own churn (the node detaching mid-evaluation,
  a navigation tearing the execution context down) is retried rather than
  reported as an assertion failure.
- **`.byAttribute(...)` selects the filtered element.** On the strategy path the
  repository returned the unfiltered first match, so
  `steps.on('variantButtons', page).byAttribute('data-testid', 'btn-danger')`
  acted on the first button; element-repository 0.3.3 implements the strategy.
  The `byAttribute` tests now use a multi-match base and a non-first target.

## 0.3.11 — 2026-11-01

### Fixed

- **No more nodemailer / ip-address advisories in the installed tree.**
  `@civitas-cerebrum/email-client` `^0.0.9` → `^0.0.10`, which moves to
  nodemailer `^10.3.1` (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w,
  GHSA-85x2-q946-cp5h), mailparser `^3.14.1` and imapflow `^1.7.8`. The local
  `nodemailer` override follows to `^10.3.1`. Full `npm audit`: 0
  vulnerabilities.
- `ip-address` (GHSA-rxp7-6hxx-x8q5) arrives through imapflow → socks
  `^10.1.1`, so a fresh install resolves the patched 10.7.5. The ≥10.7.4
  floor in email-client is an `overrides` entry, which npm does not apply to
  consumers: a consumer lockfile that already holds ≤10.7.3 keeps it until
  refreshed (`npm update ip-address`).

## 0.3.10 — 2026-11-01

### Fixed

- **No more `glob` / `minimatch` advisories in the installed tree.**
  `@civitas-cerebrum/wasapi` `^0.0.3` → `^0.0.5`. wasapi 0.0.5 moved
  `@civitas-cerebrum/test-coverage` to its devDependencies, so consumers no
  longer install test-coverage's glob 10 / minimatch 9 (GHSA-3g3m-2fjr-6pw4,
  GHSA-g3hv-75wg-m249). The scoped `glob` override on test-coverage is
  dropped: the dev dependency is now `^0.1.2`, which ships glob 14 itself.

## 0.3.9 — 2026-08-12

### Fixed

- **A timed-out click is never re-dispatched.** The 5s-capped first click
  attempt used to be blind-retried with the full timeout after any
  non-interception error — including a timeout raised *after* the click's input
  had already been dispatched, which delivered a second physical click. Failed
  attempts are now classified: interception → unchanged `dispatchEvent('click')`
  fallback; timeout after input dispatch → accepted as delivered (`log.warn` +
  a `deadline-click` annotation), never clicked again; timeout still waiting for
  actionability → continues on the *remaining* budget, so total elapsed stays
  within the caller's `timeout`; anything else → rethrown. Timeout detection is
  class-based (`errors.TimeoutError`), not message-substring sniffing.

## 0.3.8 — 2026-07-28

### Added

- `steps.navigateTo(url, options?)` now **returns the navigation `Response`**
  (`Promise<Response | null>`) — the last redirect's response, or `null` when no
  network request was triggered (same-document hash nav). Consumers asserting
  `res.status()` on 404 / redirect contracts no longer need raw `page.goto`.
  Backward compatible — callers that ignore the return value are unaffected.
  Also surfaced on `Navigation.toUrl`.
- `steps.waitForLoadState(state, options?)` — a standalone page-lifecycle wait
  for use **after an action** that does not navigate. Accepts the new exported
  `LoadState` type (`'load' | 'domcontentloaded' | 'networkidle'`) and an
  optional `{ timeout }`. Complements `waitForNetworkIdle` (which is fixed to
  `'networkidle'`). Also surfaced on `Navigation.waitForLoadState`.
- `steps.getLocalStorageKeys()` / `steps.getSessionStorageKeys()` — return every
  key currently set in `window.localStorage` / `window.sessionStorage` as a
  `string[]`. The enumerating companions to `getLocalStorage` / `getSessionStorage`,
  completing the storage surface (get/set/remove/clear already existed). Also on
  `Extractions`.
- `steps.getPageText()` — returns the rendered page text (`document.body.innerText`),
  the text companion to `getPageHtml`, for page-level text assertions (e.g. a 404
  body) without dropping to `page.locator('body').innerText()`. Also on `Extractions`.
- `steps.on(el, page).visible()` — a new strategy selector on the fluent
  `ElementAction` builder that resolves to the visible match among duplicates
  (via `repo.getVisible(..., true)`), then composes with terminal actions /
  verifications exactly like `.first()`. Throws if no visible match exists.
  Distinct from `.ifVisible()` / `.isVisible()` (which conditionally skip when
  hidden) — `.visible()` selects the visible one and proceeds. Disambiguates
  responsive duplicate elements.
- **Page-level verification family** — document-scoped mirrors of the element
  verification surface, so page-wide copy / title checks no longer drop to
  raw Playwright `page.*`:
  - `steps.verifyPageContainsText(text: string | RegExp, options?)` — web-first
    assert the document body contains `text`. Mirrored on
    `Verifications.pageContainsText`.
  - `steps.verifyPageNotContainsText(text: string | RegExp, options?)` — negated
    companion; "not a 404" / no-error-copy body checks. Text-level — raw markup
    never appears in rendered text, so for markup-level assertions use
    `verifyPageHtmlContains(html, { negated: true })` instead.
    Mirrored on `Verifications.pageNotContainsText`.
  - `steps.verifyPageTitle(title: string | RegExp, options?)` — wraps
    `expect(page).toHaveTitle`. Mirrored on `Verifications.pageTitle`.
  All three accept `{ timeout?, errorMessage? }`.
- **Scoped child queries on the fluent builder** — query "X within a named
  element" without exposing the parent `Locator`. Each resolves the parent
  (`steps.on(name, page)`) and returns a scoped `ElementAction` that composes
  with every existing terminal (`.count`, `.verifyState`, `.click`, `.getText`,
  `.first()` / `.nth()`, the matcher tree, …):
  - `steps.on(el, page).findByRole(role, options?: { name?, exact? })` — scopes
    `parent.getByRole(role, options)`.
  - `steps.on(el, page).findByText(text: string | RegExp, options?: { exact? })`
    — scopes `parent.getByText(text, options)`.
  - `steps.on(el, page).findBySelector(css: string)` — scopes
    `parent.locator(css)`.
- Window/script family (complementary-steps RFC, phase 2) — controlled access to
  window-level JS state without dropping to raw `page.evaluate`:
  - `steps.getWindowProperty<T>(path)` — read a `window` value by dotted path
    (e.g. `'__XSS_FIRED'`, `'dataLayer.length'`, `'document.title'`); returns
    `undefined` for a missing path. Mirrored on `Extractions.getWindowProperty`.
  - `steps.setWindowProperty(path, value)` — set a `window` value by dotted path,
    creating intermediate objects as needed. Mirrored on `Extractions.setWindowProperty`.
  - `steps.verifyWindowProperty(path, options)` — retrying (`expect.poll`)
    assertion; pick one matcher: `equals` | `contains` | `matches` (RegExp) |
    `present` | `truthy` | `greaterThan` | `lessThan`, with
    `{ negated?, timeout?, errorMessage? }` modifiers. New exported type
    `WindowVerifyOptions`. Backed by `Verifications.windowProperty`.
  - `steps.evaluateScript<T>(fn, arg?)` — the single labelled escape hatch over
    `page.evaluate`, typed and logged; prefer the targeted steps. Mirrored on
    `Extractions.evaluateScript`.
- Session-aware HTTP request family (complementary-steps RFC, phase 2) — backed by
  Playwright's `page.request` (`APIRequestContext`), which shares the browser
  context's cookies/session (distinct from the wasapi `api*` external-service client):
  - `steps.requestGet/Post/Put/Patch/Delete/Head(url, opts?)` — thin wrappers over
    `page.request.<verb>`. `opts: { maxRedirects?, headers?, params?, data?, form?,
    failOnStatusCode?, timeout? }` (default `failOnStatusCode: false` so status assertions work
    on 4xx/5xx). Return a typed `BrowserResponse` (`{ status, ok, url, headers,
    statusText, json<T>(), text(), body() }`).
  - `steps.verifyRequestStatus(res, code)`, `steps.verifyRequestHeader(res, name,
    value?)` (case-insensitive name; presence when value omitted), and
    `steps.verifyRequestOk(res)` (2xx) — simple throw helpers.
  - New `BrowserRequest` class wired through `ElementInteractions.request`; new
    exported types `BrowserResponse` and `BrowserRequestOptions`.
- Timing family (complementary-steps RFC, phase 3) — deliberate, intent-revealing
  timing control without dropping to raw `page.waitForTimeout` / hand-rolled loops:
  - `steps.pace(ms)` — a deliberate pause, named `pace` (NOT `wait`) to signal
    intentional timing rather than a missing wait-for-state; prefer `waitForState`
    / `waitForUrl` / web-first assertions whenever you are actually waiting for a
    condition. Throws on a negative/non-finite duration. Mirrored on `Utils.pace`.
  - `steps.repeat(action, times, { intervalMs? })` — runs `action` `times` times in
    sequence (passing the zero-based index), collects each result, and with
    `intervalMs` paces BETWEEN iterations (never before the first or after the
    last). The intent-revealing form of "do X rapidly N times". Throws when
    `times` is not a non-negative integer. Mirrored on `Utils.repeat`.
- Dispatch / keys / geometry (complementary-steps RFC, phase 3):
  - `steps.dispatchEvent(element, page, type, eventInit?)` — dispatches a synthetic
    DOM event on a named element WITHOUT actionability checks (custom events,
    firing `input`/`change` on widgets that swallow synthetic typing); prefer
    `click`/`fill`/`pressKey` for real user input. Mirrored on `Interactions.dispatchEvent`.
  - `steps.pressKeys(keys)` — presses a multi-key chord, joining the parts with `+`
    (`['Control', 'A']` → `Control+A`); the intent-revealing companion to
    `pressKey` for shortcuts. Throws on an empty array. Mirrored on `Interactions.pressKeys`.
  - `steps.getBoundingBox(element, page)` — returns the element's
    `{ x, y, width, height }` (CSS pixels, main-frame relative) or `null` when it
    is not rendered (short-circuits on zero matches rather than blocking on
    `boundingBox()`'s own auto-wait). Mirrored on `Extractions.getBoundingBox`.

### Security

- Clear the high-severity `npm audit` findings published since 0.3.7: in-range
  lockfile bump for `linkify-it` (GHSA-v245-v573-v5vm, via `mailparser`), and a
  scoped override lifting `@civitas-cerebrum/test-coverage`'s `glob` to `^13`,
  clearing `brace-expansion` GHSA-mh99-v99m-4gvg (which has no in-range fix —
  every `brace-expansion` ≤ 5.0.7 is affected).

## 0.3.7 — 2026-06-12

### Security

- Bump the `nodemailer` override `^8.0.11` → `^9.0.1`. The earlier pin fell inside
  the GHSA-p6gq-j5cr-w38f advisory range (`nodemailer <= 9.0.0` — message-level
  `raw` option bypasses `disableFileAccess`/`disableUrlAccess`, enabling file read
  / SSRF); `9.0.1` is the patched release. Clears `npm audit --audit-level=high`.

### Breaking

- `steps.waitForState` / `Utils.waitForState` now **throw on timeout** instead of
  logging a warning and continuing. Both return `Promise<boolean>` (`true` = state
  reached; `false` only in optional mode).
  **Migration:** intentional probes ("is the banner there?") add `{ optional: true }`
  to keep the soft behavior — the call then resolves `false` instead of rejecting:
  ```ts
  await steps.waitForState('confirmationModal', 'CheckoutPage', 'visible');                       // throws on timeout
  const open = await steps.waitForState('promoBanner', 'HomePage', 'visible', { optional: true }); // probe
  ```
  Internal pre-action waits (`click`, `fill`, `hover`, drag, extraction attached-waits,
  `getListedElement`, `waitAndClick`) now fail earlier with an element-qualified
  `did not reach state '<state>'` error instead of falling through to the primitive's
  opaque timeout. `waitAndClick` deliberately does not forward `optional`.

### Added

- `steps.navigateTo(url, { waitUntil })` — the navigation now accepts a
  `waitUntil` lifecycle state (`'load'` default, `'domcontentloaded'`,
  `'networkidle'`, `'commit'`), threaded into `page.goto`. Pass
  `'domcontentloaded'` for SPA navigations that stall a cold WebKit/Safari on the
  full `load` event (the WebKit-hang root cause). Default behaviour is unchanged.
  New exported type `WaitUntilState`. Mirrored on `Navigation.toUrl(url, waitUntil?)`.
- `steps.getUrl()` / `steps.getCurrentPath()` — synchronous getters for the live
  page URL (full href) and its `pathname`. The value-returning companions to
  `verifyUrlContains`. Mirrored on `Navigation.getUrl()` / `getCurrentPath()`.
- `steps.waitForUrl(url, action?, options?)` — waits until the page URL matches a
  glob string, RegExp, or `(url: URL) => boolean` predicate. When `action` is
  given, the wait is armed concurrently with the action (`Promise.all`) so a fast
  client-side route change cannot complete in the act→wait gap — the race-safe
  form for rapid navigations. `options` is `{ timeout?, waitUntil? }`. Mirrored on
  `Navigation.waitForUrl`.
- `steps.setLocalStorage(key, value)` / `steps.setSessionStorage(key, value)` —
  the mutating companions to `getLocalStorage` / `getSessionStorage`. Seed
  persisted state a test depends on, or drive resilience checks with deliberately
  malformed values (e.g. corrupt JSON). Matches the native `setItem` contract.
  Mirrored on `Extractions.setLocalStorage` / `setSessionStorage`.
- `steps.removeLocalStorage(key)` / `steps.removeSessionStorage(key)` and
  `steps.clearLocalStorage()` / `steps.clearSessionStorage()` — complete the
  storage surface: drop a single key (no-op when absent) or empty a store.
  Match the native `removeItem` / `clear` contracts. Mirrored on `Extractions`.
- `steps.waitForNetworkIdle({ timeout, optional })` — the idle wait now accepts a
  per-call `timeout` override (previously it relied on Playwright's default
  timeout) and `optional: true`, which resolves quietly on a `TimeoutError`
  instead of throwing (best-effort settling where lingering long-poll/analytics
  traffic should not fail the test; real failures still throw). No-arg behaviour
  is unchanged. New exported type `WaitForNetworkIdleOptions`.
- `StepOptions.timeout` — per-call timeout override on `waitForState` (falls back to
  the instance timeout), and `StepOptions.optional` — the soft-probe switch above.
- `BaseFixtureOptions.interceptionRetry` (default `true`) — set `false` so clicks
  intercepted by an overlaying element **fail** with the original
  `intercepts pointer events` error instead of silently falling back to
  `dispatchEvent('click')`. Recommended for adversarial / bug-discovery suites where
  stuck modals and cookie walls are bugs, not noise. Threaded
  `BaseFixture` → `Steps` / `ElementInteractions` → `Interactions`, like `timeout`.
- When the interception fallback does fire, it is now report-visible: a Playwright
  test annotation `{ type: 'interception-fallback', description }` naming
  `PageName.elementName` is pushed (visible in HTML reports), plus a `warn` log with
  the first line of the original error. The element identity travels via the new
  `ClickOptions.subject` string, set by every click entry point that knows the names.
- `typecheck:tests` script (`tsc -p tsconfig.tests.json`) — the test suite is now
  typechecked and runs as part of `test:unit`; raw-`Locator` drift in specs is a
  compile error.
- `check:publishable` script — fails on any `file:`/`link:` dependency; wired into
  `prepublishOnly` so an unpublishable state can never reach `npm publish` again.

### Fixed

- `@civitas-cerebrum/sql-client` is resolved from the npm registry (`^0.1.0`); the
  previous `file:../sql-client` dependency made the package unpublishable.
- Honest docs for `force` / `withoutScrolling` (`ClickOptions` / `StepOptions` JSDoc,
  README, API reference): both dispatch a DOM `'click'` event directly — no pointer
  simulation, no actionability checks. NOT Playwright's `force: true`; rename pending
  in a future major.
- README truth pass:
  - "Advanced: Raw Interactions API" rewritten to the `WebElement`-only reality
    (raw `Locator`s were dropped in 0.2.6; `new WebElement(locator)` is the documented
    bridging seam) and now lists the sanctioned escape hatches
    (`(element as WebElement).locator`, the `page` fixture).
  - `getText` contract corrected: returns `null` when the element has no text content.
  - `verifyCount` documents the `greaterThanOrEqual` / `lessThanOrEqual` variants and
    range combinations.
  - Matcher list includes `html` and `outerHtml`.
  - `waitForState` documented with both modes (throwing default + `optional` probe).
  - Coverage claim relabeled: the CI gate is **API (method-invocation) coverage**,
    not line/branch coverage.
