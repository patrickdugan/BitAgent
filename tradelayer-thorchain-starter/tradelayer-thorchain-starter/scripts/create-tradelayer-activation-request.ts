import fs from "node:fs/promises";
import path from "node:path";
import { createReleaseBoundActivationRequest } from "../src/launch/tradelayerActivationRequest.js";
import { validateTx11ReleaseManifest } from "../src/launch/tradelayerRelease.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function required(value: string | undefined, message: string): string {
  if (!value?.trim()) throw new Error(message);
  return value;
}

function positiveInteger(value: string, name: string, max?: number): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (max !== undefined && parsed > max)) {
    throw new Error(`${name} is outside its permitted range`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const manifestPath = path.resolve(arg("manifest") || path.join(root, "config", "tradelayer-tx11-release.json"));
  const receiptPath = path.resolve(arg("source-receipt") || path.join(root, ".runtime", "testnet-agent", "tx11-launch-source.json"));
  const outputPath = path.resolve(arg("output") || path.join(root, ".runtime", "testnet-agent", "tradelayer-activation", "request.json"));
  const now = new Date();
  const expiresMinutes = positiveInteger(arg("expires-minutes") || "15", "--expires-minutes", 60);
  const maxSourceAgeSeconds = positiveInteger(arg("max-source-age-seconds") || "900", "--max-source-age-seconds", 3600);
  const maxFeeSats = required(arg("max-fee-sats"), "--max-fee-sats=<integer sats> is required");
  positiveInteger(maxFeeSats, "--max-fee-sats");
  const policyFingerprint = arg("policy-fingerprint") || process.env.TL_ACTIVATION_POLICY_FINGERPRINT;
  if (policyFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(policyFingerprint)) {
    throw new Error("Policy fingerprint must be lowercase 64-hex");
  }

  const manifest = validateTx11ReleaseManifest(JSON.parse(await fs.readFile(manifestPath, "utf8")));
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  const request = createReleaseBoundActivationRequest({
    receipt,
    manifest,
    requestId: arg("request-id") || `tx11-${now.toISOString().replace(/[-:.TZ]/g, "")}`,
    wallet: arg("wallet") || process.env.BTCTEST_WALLET || "utxoref-testnet",
    senderAddress: required(arg("sender-address"), "--sender-address=<owned testnet4 address> is required"),
    policyFingerprint,
    maxFeeSats,
    expiresAt: new Date(now.getTime() + expiresMinutes * 60_000).toISOString(),
    now,
    maxSourceAgeMs: maxSourceAgeSeconds * 1000
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(request, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({
    authority: "read_only_request_builder",
    effect: "writes_public_request_only",
    request,
    operatorPolicyEnvironment: `TL_ACTIVATION_POLICY_FINGERPRINT=${request.policyFingerprint}`,
    output: path.relative(root, outputPath)
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "TradeLayer activation request generation failed");
  process.exitCode = 1;
});
