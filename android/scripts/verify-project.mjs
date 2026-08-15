import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const manifest = read("app/src/main/AndroidManifest.xml");
const permissions = [...manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(permissions, [
  "android.permission.INTERNET",
  "com.termux.permission.RUN_COMMAND"
]);
assert.match(manifest, /<package android:name="com\.termux"/);
assert.match(manifest, /TermuxResultReceiver/);
for (const prohibited of [
  "READ_CONTACTS", "WRITE_CONTACTS", "READ_SMS", "SEND_SMS", "READ_CALL_LOG",
  "WRITE_CALL_LOG", "READ_PHONE_STATE", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION",
  "MANAGE_EXTERNAL_STORAGE", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE",
  "BIND_ACCESSIBILITY_SERVICE", "BIND_NOTIFICATION_LISTENER_SERVICE"
]) {
  assert.doesNotMatch(manifest, new RegExp(prohibited));
}
assert.match(manifest, /android:usesCleartextTraffic="false"/);
assert.match(manifest, /android:allowBackup="false"/);

const javaRoot = path.join(root, "app/src/main/java");
const javaFiles = [];
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".java")) javaFiles.push(full);
  }
};
walk(javaRoot);
const java = javaFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
assert.doesNotMatch(java, /addJavascriptInterface|@JavascriptInterface/);
assert.doesNotMatch(java, /HF_TOKEN|HUGGING_FACE_HUB_TOKEN|Authorization\s*:/i);
assert.doesNotMatch(java, /android\.util\.Log|System\.(out|err)\.print/);
assert.doesNotMatch(java, /RUN_COMMAND_STDIN|addJavascriptInterface|@JavascriptInterface/);
for (const required of [
  "setAllowFileAccess(false)",
  "setAllowContentAccess(false)",
  "setAllowFileAccessFromFileURLs(false)",
  "setAllowUniversalAccessFromFileURLs(false)",
  "MIXED_CONTENT_NEVER_ALLOW",
  "request.deny()",
  "handler.cancel()",
  "callback.backToSafety(true)",
  "WebViewAssetLoader"
]) {
  assert.ok(java.includes(required), `missing WebView control: ${required}`);
}
for (const required of [
  'AUTO_DOWNLOAD = false',
  'RUNTIME_OPERATOR_READY = false',
  'getNoBackupFilesDir()',
  '284a335aa3fb2ced3b1b01fcb40b08aa783e3b70832767f0dd2e3fdfa134bd54',
  '9a11fe2cecf795f53dbea490b9897b28f3d3346a9f69a71ce28bbb195f7de704',
  'setInstanceFollowRedirects(false)',
  'ModelDownloadPolicy.isAllowedHuggingFaceUri',
  'ArtifactIntegrity.hex(digest.digest())'
]) {
  assert.ok(java.includes(required), `missing model distribution control: ${required}`);
}

const assetsRoot = path.join(root, "app/src/main/assets");
const assetFiles = [];
const walkAssets = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walkAssets(full);
    else assetFiles.push(full);
  }
};
walkAssets(assetsRoot);
for (const file of assetFiles) {
  assert.doesNotMatch(file.toLowerCase(), /\.(gguf|safetensors|bin)$/);
}

const appGradle = read("app/build.gradle");
assert.match(appGradle, /compileSdk\s*=\s*36/);
assert.match(appGradle, /targetSdk\s*=\s*36/);
assert.match(appGradle, /minSdk\s*=\s*24/);
assert.match(appGradle, /androidx\.webkit:webkit:1\.16\.0/);
assert.match(appGradle, /androidx\.core:core:1\.17\.0/);
assert.match(appGradle, /Release builds require -PbitagentUrl=/);
assert.match(appGradle, /deviceLoopback/);
assert.match(appGradle, /\['127\.0\.0\.1', 'localhost'\]/);

const modelPackage = JSON.parse(read("model-package.lock.json"));
assert.equal(modelPackage.schema, "bitagent.android_model_package.v1");
assert.equal(modelPackage.autoDownload, false);
assert.equal(modelPackage.runtimeOperatorReady, false);
assert.equal(modelPackage.storage.location, "app_private_no_backup");
assert.equal(modelPackage.storage.safetyReserveBytes, 268435456);
assert.equal(
  modelPackage.artifacts.reduce((total, artifact) => total + artifact.bytes, 0),
  modelPackage.storage.totalArtifactBytes
);
for (const artifact of modelPackage.artifacts) {
  assert.equal(new URL(artifact.url).protocol, "https:");
  assert.equal(new URL(artifact.url).hostname, "huggingface.co");
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
  assert.ok(java.includes(artifact.revision), `Android manifest missing revision ${artifact.revision}`);
  assert.ok(java.includes(artifact.sha256), `Android manifest missing digest ${artifact.sha256}`);
  assert.ok(java.includes(String(artifact.bytes).replace(/(?=(\d{3})+$)/g, "_")) ||
    java.includes(String(artifact.bytes)), `Android manifest missing byte length ${artifact.bytes}`);
}

const rootGradle = read("build.gradle");
assert.match(rootGradle, /com\.android\.application' version '9\.2\.1'/);

const packager = read("scripts/package-tlweb.mjs");
assert.match(packager, /source maps cannot enter the APK/);
assert.match(packager, /legacy signing utility cannot enter the APK/);
assert.match(packager, /generated asset path component cannot be a symbolic link/);
assert.match(packager, /tradelayer_mobile_web_package_v1/);

const css = read("app/src/main/assets/tlweb/mobile-overrides.css");
assert.match(css, /min-width:\s*0\s*!important/);
assert.match(css, /safe-area-inset/);
assert.match(css, /@media \(max-width: 800px\)/);
assert.match(css, /min-height:\s*44px/);

const releaseNetwork = read("app/src/main/res/xml/network_security_config.xml");
assert.match(releaseNetwork, />127\.0\.0\.1</);
assert.match(releaseNetwork, />localhost</);
assert.doesNotMatch(releaseNetwork, />10\.0\.2\.2</);
assert.doesNotMatch(releaseNetwork, /cleartextTrafficPermitted="true"[^]*includeSubdomains="true"/);

const fallback = read("app/src/main/assets/mobile/agent-unavailable.html");
assert.match(fallback, /BitAgent proposes and simulates/);
assert.match(fallback, /Content-Security-Policy/);

const termuxLauncher = read("termux/bitagent-android");
const termuxSkill = read("termux/hermes-skill/SKILL.md");
const termuxClient = read("termux/hermes-skill/scripts/bitagent_candidate.py");
assert.match(termuxLauncher, /127\.0\.0\.1/);
assert.match(termuxLauncher, /install-hermes-skill/);
assert.doesNotMatch(termuxLauncher, /wallet\.resolve_approval|action\.execute/);
assert.match(termuxSkill, /candidate-only/i);
assert.match(termuxSkill, /must never approve, sign, execute, broadcast/i);
assert.match(termuxClient, /BASE_URL = "http:\/\/127\.0\.0\.1:8787"/);
assert.doesNotMatch(termuxClient, /wallet\.resolve_approval|action\.execute/);

console.log(JSON.stringify({
  ok: true,
  schema: "tradelayer_mobile_source_security_v1",
  permissions,
  nativeFinancialBridge: false,
  termuxCommandBridge: true,
  arbitraryTermuxCommands: false,
  compileSdk: 36,
  targetSdk: 36,
  minSdk: 24,
  webkit: "1.16.0",
  modelBundled: false,
  modelAutoDownload: false,
  modelRuntimeOperatorReady: false
}, null, 2));
