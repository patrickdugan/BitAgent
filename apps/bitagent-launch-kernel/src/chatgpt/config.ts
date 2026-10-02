import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const kernelRoot = path.resolve(moduleDir, "..", "..");
export const repoRoot = path.resolve(kernelRoot, "..", "..");

function envText(name: string, fallback: string) {
  return String(process.env[name] || "").trim() || fallback;
}

function envList(name: string, fallback: string[]) {
  const value = String(process.env[name] || "").trim();
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : fallback;
}

// Every externally-derived URL, origin, and identifier used by the ChatGPT
// plugin lives here. Nothing below is a secret.
export const pluginConfig = {
  name: "bitagent",
  title: "BitAgent",
  version: "0.1.0",
  host: envText("BITAGENT_CHATGPT_HOST", "127.0.0.1"),
  port: Number(envText("BITAGENT_CHATGPT_PORT", "8791")),
  // Browser origins allowed to call /mcp. ChatGPT's server-to-server calls
  // carry no Origin header; this list only limits browser-initiated requests.
  allowedOrigins: envList("BITAGENT_CHATGPT_ALLOWED_ORIGINS", [
    "https://chatgpt.com",
    "https://chat.openai.com"
  ]),
  widgetUri: "ui://bitagent/journey-v1.html",
  widgetPath: path.join(kernelRoot, "chatgpt-ui", "widget.html"),
  previewPath: path.join(kernelRoot, "chatgpt-ui", "preview.html"),
  repos: {
    bitagent: envText("BITAGENT_PLUGIN_REPO_URL", "https://github.com/patrickdugan/BitAgent.git"),
    utxoRef: envText("BITAGENT_PLUGIN_UTXO_REF_URL", "https://github.com/patrickdugan/UTXO-Ref.git"),
    // No public clone URL for the reviewed tradelayer.js release is recorded in
    // this repository. Until an operator sets one, the self-host plan says so.
    tradelayerJs: envText("BITAGENT_PLUGIN_TRADELAYER_JS_URL", "")
  },
  localUrls: {
    desktop: "http://127.0.0.1:8790/",
    android: "http://127.0.0.1:8787/"
  },
  installers: {
    nodeJs: "https://nodejs.org/en/download",
    git: "https://git-scm.com/downloads",
    termux: "https://f-droid.org/packages/com.termux/",
    hermesInstallScript: "https://hermes-agent.nousresearch.com/install.sh"
  },
  androidModelLockPath: path.join(repoRoot, "android", "model-package.lock.json"),
  practice: {
    maxWorkflows: 500,
    maxDepositSats: 100_000_000n
  }
} as const;

// Provisional product guardrails for the money-management dialogue. They are
// operator-tunable policy, not market advice; see docs/chatgpt-plugin.md.
export const moneyGuardrails = {
  policyId: "bitagent-chatgpt-money-guardrails-v1",
  minimumEmergencyFundMonths: 3,
  maxStrategyShareBps: 2_500,
  defaultStrategyShareBps: 1_000,
  // Covers the scripted reserve-intake (900), starter-order (900), and
  // withdrawal (600) network fees with headroom.
  feeBufferSats: 3_000n
} as const;

// Compliance state is UNKNOWN on this surface, so leverage permission is NONE:
// research drafts may not exceed 1x gross exposure.
export const researchGuardrails = {
  maxGrossLeverageBps: 10_000,
  maxScenarios: 12,
  // The scripted evaluation fee, used when a scenario does not declare one.
  defaultNetworkFeeSats: "900"
} as const;
