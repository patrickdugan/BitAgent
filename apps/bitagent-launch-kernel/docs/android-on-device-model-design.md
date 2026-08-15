# Android on-device model distribution

Status: implementation design for the smallest mobile vertical slice

## Outcome

The Android APK remains model-free. A user may open a native Model screen, see
the exact download size and authority limits, and explicitly download a fixed
BitAgent package from Hugging Face when the phone has enough app-private
storage. Downloading a package does not activate it and does not grant it any
wallet, signing, execution, secret-reading, or broadcast capability.

The package selected by the current repository runtime manifest is:

| Artifact | Authoritative source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Bonsai-8B Q1_0 base | `prism-ml/Bonsai-8B-gguf@48516770dd04643643e9f9019a2a349cf26c5dbd` | 1,158,654,496 | `284a335aa3fb2ced3b1b01fcb40b08aa783e3b70832767f0dd2e3fdfa134bd54` |
| BitAgent DAG v3 F16 LoRA | `AlephFunk/bitagent-bonsai8b-dagv2-lora-v3@ee2937fb58d87bbd155cd205c43dc8103b51eac2` | 87,329,024 | `9a11fe2cecf795f53dbea490b9897b28f3d3346a9f69a71ce28bbb195f7de704` |

Total payload size is 1,245,983,520 bytes. The base repository declares
Apache-2.0 and remains the authoritative distributor of the base model.

## User flow

1. Installation and first launch perform no model download.
2. The native Model tab shows package size, available storage, data-use warning,
   model provenance, and candidate-only authority.
3. The user taps **Download model**.
4. The app rechecks available storage. It requires all missing artifact bytes
   plus a deterministic 256 MiB safety reserve.
5. The app downloads only the URLs compiled into the release manifest. It
   follows HTTPS redirects only to Hugging Face delivery hosts.
6. Each artifact streams to a `.part` file in the app's no-backup directory.
   Byte length and SHA-256 must match before an atomic same-directory rename.
7. The screen reports **Downloaded and verified; runtime not yet enabled**.
8. The user can cancel an in-progress download or delete all model files from
   the same screen.

There are no storage permissions, broad file access, hidden background
downloads, or Hugging Face credentials in the APK. Public artifacts are used so
the phone never needs the operator's Hugging Face token.

## Storage and failure policy

Files live under `Context.getNoBackupFilesDir()/models/bitagent-bonsai-v3`.
They are excluded from Android backup and are not visible to either WebView.
The store writes only the two fixed artifact names and their `.part` files.

The initial free-space requirement is:

```text
missing_artifact_bytes + 268_435_456 bytes
```

Verified artifacts do not count as missing. A partial file reduces neither the
preflight requirement nor the integrity requirement; this intentionally keeps
enough room for a clean retry. Network, cancellation, size, redirect, and hash
failures leave no verified artifact. A retry may resume a partial transfer only
when the server honors the exact byte range; otherwise it restarts that artifact.

## Trust and authority boundary

The package is data, not an Android executable. The downloader never accepts a
model ID, URL, filename, prompt, adapter selection, or expected hash from web
content or the language model. Contact names and invitation data have no path
to this manifest.

The existing mobile boundary remains:

```text
model candidate
  -> deterministic host validation and simulation
  -> exact wallet display
  -> human wallet approval
  -> host execution
  -> deterministic verification
```

The repository manifest currently says `operatorReady: false` and grants the
adapter candidate-only authority. Consequently this slice deliberately does not
load the downloaded files into an inference engine. A later native-runtime slice
must separately pin and review the inference library, memory limits, prompt
packet router, output schema validation, and lifecycle controls before changing
the UI from downloaded to runnable.

## Test obligations

- the APK contains no `.gguf`, `.safetensors`, or model binary;
- no storage, SMS, contacts, call-log, accessibility, or wallet capability is
  added to the Android manifest;
- package byte totals, reserve calculations, URL allowlist, filename rules, and
  hashes are deterministic;
- a wrong size or digest cannot become a verified artifact;
- no download begins from app startup or WebView content;
- deletion removes final and partial model files without touching other app data;
- model presence never changes WebView permissions or recipient/wallet state.

## Deferred deployment flags

- Select and security-review a native on-device GGUF runtime for Android.
- Measure RAM, thermal, battery, and token latency on representative arm64 phones;
  free storage alone does not imply the device can run an 8B model acceptably.
- Complete the repository's GPU/mobile promotion gates and explicit operator
  approval before enabling inference.
- Add an app-update policy for manifest rotation and safe removal of superseded
  packages.
- Confirm model/adapter export, consumer disclosure, and AI-product obligations
  for each deployment jurisdiction.
