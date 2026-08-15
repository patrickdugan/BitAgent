# TradeLayer Mobile Android design

## Product boundary

The Android application packages the reviewed production output from
`C:\projects\TL-Web-main\packages\web-ui\dist` and presents BitAgent as a
separate, explicitly labelled application surface. TL Web remains the source of
truth for balances, markets, order envelopes, agent mandates, settlement
proposals, and wallet prompts. BitAgent remains a candidate-only planner: it may
explain and propose, but it does not gain a native signing, approval, broadcast,
wallet-secret, or RPC bridge.

The first release is a thin native shell rather than a fork of TL Web. This is
intentional: the TL Web checkout contains active uncommitted product work, and
copying its Angular sources into BitAgent would create a second wallet UI. A
deterministic Gradle task instead consumes a selected TL Web `dist`, verifies its
security properties, rewrites only its base path, adds a mobile CSS overlay, and
records the exact packaged-file hashes in the APK.

## Runtime architecture

```text
Android Activity
  +-- TradeLayer tab
  |     +-- WebViewAssetLoader HTTPS virtual origin
  |     +-- packaged TL Web production assets
  |     +-- mobile-only responsive CSS overlay
  |     +-- existing TL Web wallet/collator approval flows
  +-- BitAgent tab
        +-- separately configured HTTPS BitAgent deployment
        +-- candidate -> simulation -> exact display -> wallet approval
        +-- no JavaScript-to-native financial bridge
```

Debug builds default the BitAgent tab to `http://10.0.2.2:8787`, so an emulator
can reach `npm run launch` on the development host. Release builds require an
explicit HTTPS `bitagentUrl` Gradle property; a missing or non-HTTPS production
endpoint fails the release configuration gate.

## Android and dependency baseline

- package: `org.tradelayer.mobile`
- minimum SDK: 24, matching AndroidX WebKit 1.16.0
- compile/target SDK: 36
- Android Gradle Plugin: 9.2.1
- Gradle: 9.4.1
- JDK/toolchain: 17
- AndroidX Activity: 1.13.0 for predictive-back dispatch
- UI: platform Views and Java, avoiding a parallel UI framework
- local content: AndroidX `WebViewAssetLoader`, never `file://`

The toolchain is installed under `D:\Android`; the project-local
`local.properties` points to `D:\Android\Sdk` and remains untracked.

## WebView security contract

- JavaScript and DOM storage are enabled only because TL Web requires them.
- File access, content access, file-URL cross-origin access, mixed content,
  geolocation, WebView permissions, client certificates, and pop-up windows are
  denied.
- Safe Browsing is enabled. TLS errors fail closed.
- No `addJavascriptInterface` or equivalent native wallet bridge exists.
- The packaged TL Web WebView may navigate only inside its virtual asset origin.
  External HTTPS links leave the app for the operating-system browser.
- The BitAgent WebView may navigate only within its configured origin. Other
  HTTPS links leave the app; non-HTTPS links are rejected outside the explicit
  emulator-only debug exception.
- Third-party cookies are disabled. Web contents debugging is debug-only.
- The source manifest requests only `INTERNET`. AndroidX contributes one
  package-specific `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` protected at
  signature level. The merged APK contains no contact, SMS, call-log, storage,
  location, accessibility, notification-listener, or wallet-secret permission.
- Predictive back is routed through AndroidX's `OnBackPressedDispatcher`; it
  traverses only the visible WebView history and otherwise closes the Activity.

## Mobile presentation contract

The packaging overlay removes TL Web's 45-rem body floor, respects display
cutouts and safe areas, converts top-level Angular Material grids to a single
column on phone widths, makes dialogs fit the viewport, preserves horizontal
scrolling for dense market tables, and enforces 44-pixel touch targets. It does
not alter transaction bytes, routes, endpoint IDs, order fields, wallet
permissions, agent mandates, or serialization.

## Source and release gates

Every APK build must:

1. find an explicit or discovered TL Web production `dist`;
2. reject source maps, legacy browser-signing utilities, unreviewed algorithm
   directories, or a missing content-security policy;
3. copy the output into generated Android assets without modifying TL Web;
4. rewrite `<base href="/">` to the APK asset path and inject the mobile CSS;
5. emit a JSON manifest containing every packaged path, byte length, SHA-256,
   source Git commit, and source dirty-state flag;
6. run Android lint, JVM unit tests, source security tests, and APK inspection;
7. require a separately supplied release signing configuration before store
   distribution. Debug signing is not a production identity.

## Known deployment dependencies

- A public authenticated BitAgent HTTPS deployment is not currently available;
  the existing Sites deployment returns HTTP 401. Local/debug operation uses the
  host endpoint, and production release remains gated on a real HTTPS URL.
- The workstation has insufficient free `D:` space for an emulator system image
  (about 0.85 GiB remained after build caches settled). Build tools are installed
  there; device/emulator instrumentation must use an existing device or a
  system image on a volume with additional space. Installer archives and the
  known partial JDK backup remain because this environment rejected cleanup.
- Native wallet handoff and deep links require a separate signed URI contract.
  Until then, TL Web's existing wallet approval surfaces remain authoritative.
