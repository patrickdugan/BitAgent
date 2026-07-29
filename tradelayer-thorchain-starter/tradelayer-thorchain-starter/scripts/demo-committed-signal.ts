import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { ScriptedSignalExecutionBroker } from "../src/signals/broker.js";
import { computeSourceTreeCommitment } from "../src/signals/codebaseVerifier.js";
import { buildSignalRiskPolicy, createCommittedSignalKernel } from "../src/signals/factory.js";
import { createAlgorithmicTradeSignal } from "../src/signals/signalValidator.js";
import { InMemorySignalWorkflowStore } from "../src/signals/store.js";
import { CommittedSignalToolRegistry } from "../src/signals/tools.js";

async function main() {
  const codebasePath = path.resolve(process.env.SIGNAL_CODEBASE_REPO || "C:\\projects\\Trading Algos");
  const commitment = await computeSourceTreeCommitment(codebasePath);
  const producerKeys = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = producerKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const policy = buildSignalRiskPolicy([{
    codebaseId: "local-trading-algorithms",
    kind: "sha256_source_tree",
    digest: commitment.digest,
    rootPath: codebasePath
  }], {
    approvedProducers: [{
      producerKeyId: "scripted-demo-producer",
      codebaseId: "local-trading-algorithms",
      publicKeyPem
    }]
  });
  const now = new Date();
  const signal = createAlgorithmicTradeSignal({
    schema: "bitagent_tradelayer_signal_v1",
    signalId: `demo-signal-${now.getTime()}`,
    codebase: {
      codebaseId: "local-trading-algorithms",
      kind: "sha256_source_tree",
      digest: commitment.digest
    },
    producerKeyId: "scripted-demo-producer",
    strategyId: "committed-limit-signal-v1",
    strategyVersion: "1",
    market: "TLBTC/TLUSD",
    side: "sell_tlbtc",
    amountSats: "50000",
    limitPriceUsd: "65000.00",
    postOnly: true,
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 120_000).toISOString(),
    inputSnapshotHash: "44".repeat(32)
  }, (payloadHash) =>
    crypto.sign(null, Buffer.from(payloadHash, "hex"), producerKeys.privateKey).toString("base64")
  );
  const workflowId = `signal-demo-${now.getTime()}`;
  const kernel = createCommittedSignalKernel({
    policy,
    store: new InMemorySignalWorkflowStore(),
    broker: new ScriptedSignalExecutionBroker(),
    now: () => new Date(now)
  });
  const tools = new CommittedSignalToolRegistry(kernel);
  await tools.call("bitagent.signal.start", { workflowId });
  await tools.call("bitagent.signal.ingest", { workflowId, signal });
  const simulation = await tools.call("bitagent.signal.simulate", { workflowId });
  await tools.call("bitagent.signal.request_approval", { workflowId });
  await tools.call("bitagent.signal.resolve_approval", { workflowId, decision: "approve" });
  const execution = await tools.call("bitagent.signal.execute", { workflowId });
  const verification = await tools.call("bitagent.signal.verify", { workflowId });
  console.log(JSON.stringify({
    mode: "scripted-testnet4-only",
    codebaseCommitment: {
      kind: "sha256_source_tree",
      digest: commitment.digest,
      fileCount: commitment.files.length
    },
    simulation,
    execution,
    verification,
    state: await tools.call("bitagent.signal.get", { workflowId })
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
