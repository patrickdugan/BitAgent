# TradeLayer Mobile

This Android application packages the reviewed TL Web production distribution
and presents BitAgent in a separate tab. It contains no native signing,
broadcast, wallet-secret, RPC, or JavaScript bridge. Its optional Hermes tab
uses Termux's permission-gated `RUN_COMMAND` service for a fixed command
allowlist; it cannot accept a command from web content or a model.

The APK also contains a native Model tab, but no model weights. A model download
begins only when the user taps **Download model** and the device has the pinned
1,245,983,520-byte payload plus a 256 MiB storage reserve available in app-private
storage. Final and partial files live under the app's no-backup directory and can
be deleted from the same screen without storage permission.

The lockfile is `model-package.lock.json`. It pins:

- `prism-ml/Bonsai-8B-gguf@48516770dd04643643e9f9019a2a349cf26c5dbd`;
- `AlephFunk/bitagent-bonsai8b-dagv2-lora-v3@ee2937fb58d87bbd155cd205c43dc8103b51eac2`.

The downloader accepts only HTTPS Hugging Face delivery hosts and verifies each
artifact's exact byte count and SHA-256 before it becomes local package state.
No Hugging Face token is included in the APK. The repository manifest still
marks the adapter `operatorReady: false`, so this slice reports the package as
downloaded and verified but does not load it for inference or grant it wallet
authority.

## Build

The local toolchain is pinned in `toolchain.lock.json` and installed under
`D:\Android`. The Gradle build discovers TL Web at
`C:\projects\TL-Web-main\packages\web-ui\dist`; override it with
`-PtlWebDistDir=<path>` or `TL_WEB_DIST_DIR`.

```powershell
cd C:\projects\BitAgent\BitAgent\android
.\build.ps1
```

The debug APK is emitted at `app\build\outputs\apk\debug\app-debug.apk`.
Each build verifies TL Web's CSP and asset allowlist, rejects source maps and
legacy browser-signing utilities, rewrites the base path in generated build
output only, adds the phone CSS layer, and packages
`tlweb-package-manifest.json` with exact file hashes and Git provenance.
It also runs JVM unit tests, Android lint with warnings as errors, builds the
instrumentation-test APK, and inspects the final app APK's SDK levels,
permissions, signature, required assets, and excluded artifacts.

## Run BitAgent during development

Start the existing BitAgent launch kernel on the host at port 8787. The debug
APK uses the Android-emulator host alias:

```powershell
cd C:\projects\BitAgent\BitAgent\tradelayer-thorchain-starter\tradelayer-thorchain-starter
npm run launch
```

For a physical device, configure an HTTPS development endpoint:

```powershell
.\gradlew.bat assembleDebug -PbitagentUrl=https://your-agent-host.example
```

The currently recorded Sites deployment is owner-only and returns HTTP 401, so
it is not a production mobile endpoint.

## Run Hermes + BitAgent on a phone

See [TERMUX.md](TERMUX.md) for the complete phone setup. The short version is:

1. install Termux from F-Droid and set `allow-external-apps=true`;
2. install Hermes through its official Termux installer;
3. provision this repository and `npm ci` inside Termux;
4. install `android/termux/bitagent-android` into `$PREFIX/bin`;
5. grant TradeLayer Mobile the Termux `RUN_COMMAND` additional permission; and
6. use the Hermes tab to check Hermes, install the candidate-only BitAgent
   skill, start the loopback service, and connect the BitAgent tab.

Release builds allow cleartext only to `127.0.0.1` and `localhost` for this
on-device bridge. Remote origins still require HTTPS, and emulator host alias
`10.0.2.2` remains debug-only.

## Release

Release configuration requires either an origin-only HTTPS BitAgent URL or the
device-loopback Termux service:

```powershell
.\build.ps1 -Release -BitAgentUrl https://agent.tradelayer.org
# or
.\build.ps1 -Release -BitAgentUrl http://127.0.0.1:8787
```

That produces an unsigned release artifact. Store delivery additionally
requires an operator-owned signing key and Play Console configuration; signing
material must not be stored in this repository or exposed to BitAgent.

## Device verification

The installed test device is `medium_phone`, using the API 36 Google Play
x86_64 image. The SDK, image, emulator binary, AVD configuration, and emulator
user-data image all live on `D:`:

```powershell
$env:ANDROID_AVD_HOME = "D:\Android\avd"
& "D:\Android\Sdk\emulator\emulator.exe" `
  -avd medium_phone -no-window -no-audio -no-boot-anim `
  -gpu swiftshader_indirect -no-snapshot
```

With that emulator or another Android 7+ device connected:

```powershell
.\gradlew.bat connectedDebugAndroidTest
```

The instrumentation suite confirms the merged manifest requests only Internet,
Termux `RUN_COMMAND`, and AndroidX's app-private signature permission, and that both WebViews deny
file/content access and mixed content. It also confirms no model weights are in
the APK, launch never starts a download, and model deletion stays inside the
app-private no-backup boundary. Geolocation denial is covered by the source
security verifier because Android exposes a setter but no public getter.
