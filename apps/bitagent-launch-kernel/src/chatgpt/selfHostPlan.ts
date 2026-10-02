import fs from "node:fs/promises";
import { pluginConfig } from "./config.js";

export type SelfHostPlatform = "windows" | "macos" | "linux" | "android";

export type SelfHostStep = {
  id: string;
  title: string;
  detail: string;
  commands?: string[];
  link?: string;
  check?: string;
  // Present when the repository cannot yet supply this step end to end.
  stub?: string;
};

type ModelPackage = {
  packageId: string;
  autoDownload: boolean;
  runtimeOperatorReady: boolean;
  totalArtifactBytes: number;
  safetyReserveBytes: number;
  artifacts: Array<{ role: string; fileName: string; bytes: number; sha256: string; license: string }>;
};

async function readModelPackage(lockPath: string): Promise<ModelPackage | null> {
  try {
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
    return {
      packageId: String(lock.packageId),
      autoDownload: lock.autoDownload === true,
      runtimeOperatorReady: lock.runtimeOperatorReady === true,
      totalArtifactBytes: Number(lock.storage.totalArtifactBytes),
      safetyReserveBytes: Number(lock.storage.safetyReserveBytes),
      artifacts: lock.artifacts.map((artifact: Record<string, unknown>) => ({
        role: String(artifact.role),
        fileName: String(artifact.fileName),
        bytes: Number(artifact.bytes),
        sha256: String(artifact.sha256),
        license: String(artifact.license)
      }))
    };
  } catch {
    return null;
  }
}

function envCommands(platform: SelfHostPlatform) {
  return platform === "windows"
    ? ['$env:UTXO_REF_REPO = "$PWD\\UTXO-Ref"', '$env:TRADELAYER_JS_REPO = "$PWD\\tradelayer.js"']
    : ['export UTXO_REF_REPO="$PWD/UTXO-Ref"', 'export TRADELAYER_JS_REPO="$PWD/tradelayer.js"'];
}

function protocolLibraryStep(platform: SelfHostPlatform): SelfHostStep {
  const { utxoRef, tradelayerJs } = pluginConfig.repos;
  return {
    id: "protocol_libraries",
    title: "Put the two protocol libraries next to BitAgent",
    detail: "BitAgent refuses to start without the UTXO-Ref and tradelayer.js checkouts, because it uses their real encoders instead of copies. Clone them into the same folder as BitAgent, then tell BitAgent where they are.",
    commands: [
      `git clone ${utxoRef}`,
      ...(tradelayerJs ? [`git clone ${tradelayerJs} tradelayer.js`] : []),
      ...envCommands(platform)
    ],
    stub: tradelayerJs
      ? undefined
      : "No public download address for the reviewed tradelayer.js release is recorded yet. Ask the BitAgent operator for it and place it in a folder named tradelayer.js before continuing."
  };
}

function desktopSteps(platform: SelfHostPlatform): SelfHostStep[] {
  const separator = platform === "windows" ? "\\" : "/";
  return [
    {
      id: "prerequisites",
      title: "Install Node.js and Git",
      detail: "BitAgent needs Node.js 20 or newer (22.13 or newer if you also run the optional web surface) and Git. Install both from their official sites, then open a new terminal.",
      link: pluginConfig.installers.nodeJs,
      commands: ["node --version", "git --version"],
      check: "Both commands print a version number."
    },
    {
      id: "download",
      title: "Download BitAgent",
      detail: "This copies the open-source BitAgent code to your computer. Nothing is installed system-wide.",
      commands: [`git clone --recurse-submodules ${pluginConfig.repos.bitagent}`]
    },
    protocolLibraryStep(platform),
    {
      id: "install",
      title: "Install BitAgent's dependencies",
      detail: "Run these in the same terminal so the two library locations stay set.",
      commands: [`cd BitAgent${separator}apps${separator}bitagent-launch-kernel`, "npm install"]
    },
    {
      id: "verify",
      title: "Check that your copy behaves as published",
      detail: "These run the bundled safety checks and the scripted testnet journey on your machine. No funds are involved.",
      commands: ["npm run test:skills", "npm run eval:launch", "npm run demo:launch"]
    },
    {
      id: "start",
      title: "Start BitAgent",
      detail: "BitAgent listens only on your own computer (127.0.0.1). It is not reachable from the internet. Leave this terminal open while you use it.",
      commands: ["npm run launch"],
      check: `The terminal prints: BitAgent launch kernel: ${pluginConfig.localUrls.desktop.replace(/\/$/, "")}`
    },
    {
      id: "open",
      title: "Open BitAgent in your browser",
      detail: "The page should say 'Bitcoin testnet4 demo' and state that BitAgent never asks for a seed phrase, private key, mnemonic, or WIF. If any page ever asks for one, close it.",
      link: pluginConfig.localUrls.desktop
    }
  ];
}

function androidSteps(): SelfHostStep[] {
  return [
    {
      id: "termux",
      title: "Install Termux from F-Droid",
      detail: "Termux is the terminal that runs BitAgent on your phone. Use the F-Droid build, then enable external commands by adding allow-external-apps=true to ~/.termux/termux.properties.",
      link: pluginConfig.installers.termux,
      commands: ["termux-reload-settings", "pkg install nodejs git"]
    },
    {
      id: "hermes",
      title: "Install Hermes",
      detail: "Hermes is the on-phone assistant shell. Read the install script before running it; BitAgent never runs it for you.",
      commands: [`curl -fsSL ${pluginConfig.installers.hermesInstallScript} | bash`, "hermes version", "hermes doctor"]
    },
    {
      id: "download",
      title: "Download BitAgent into Termux",
      detail: "The launcher looks for BitAgent in your Termux home folder.",
      commands: ["cd ~", `git clone --recurse-submodules ${pluginConfig.repos.bitagent}`]
    },
    protocolLibraryStep("android"),
    {
      id: "start",
      title: "Install dependencies and the reviewed launcher",
      detail: "The launcher starts BitAgent on your phone only (127.0.0.1:8787).",
      commands: [
        "cd ~/BitAgent/apps/bitagent-launch-kernel",
        "npm ci",
        'install -m 700 ~/BitAgent/android/termux/bitagent-android "$PREFIX/bin/bitagent-android"',
        "bitagent-android start"
      ],
      check: "The command prints: bitagent-ready http://127.0.0.1:8787"
    },
    {
      id: "open",
      title: "Open BitAgent",
      detail: "Open the address in your phone browser. It should say 'Bitcoin testnet4 demo' and never ask for a seed phrase.",
      link: pluginConfig.localUrls.android
    },
    {
      id: "mobile_app",
      title: "Optional: the TradeLayer Mobile app",
      detail: "The app wraps the same local BitAgent in a wallet shell with Hermes and Model tabs.",
      stub: "There is no signed public APK or store listing yet. Today the app can only be built from source with android/build.ps1, which is a developer task."
    }
  ];
}

export async function buildSelfHostPlan(input: {
  platform: SelfHostPlatform;
  includeLocalModel?: boolean;
  modelLockPath?: string;
}) {
  const android = input.platform === "android";
  const steps = android ? androidSteps() : desktopSteps(input.platform);
  const modelPackage = input.includeLocalModel
    ? await readModelPackage(input.modelLockPath || pluginConfig.androidModelLockPath)
    : undefined;
  return {
    kind: "self_host_plan" as const,
    platform: input.platform,
    localUrl: android ? pluginConfig.localUrls.android : pluginConfig.localUrls.desktop,
    steps,
    stubs: steps.filter((step) => step.stub).map((step) => ({ step: step.id, note: step.stub as string })),
    localModel: input.includeLocalModel
      ? modelPackage
        ? {
          status: "optional_download_available" as const,
          note: "The on-device model is an optional Android download that starts only when you tap Download model. It is verified by exact size and SHA-256, and is not yet loaded for inference or given any wallet authority.",
          ...modelPackage
        }
        : { status: "unavailable" as const, note: "This server has no model package lockfile to report." }
      : undefined,
    safety: [
      "BitAgent never asks for a seed phrase, private key, mnemonic, or WIF.",
      "This release is a testnet/scripted MVP. Funded execution is disabled.",
      "ChatGPT cannot approve, sign, or broadcast. Approvals happen only in your own wallet on your own device."
    ],
    fundedExecutionAllowed: false as const,
    authority: "deterministic_host" as const,
    effect: "none" as const
  };
}
