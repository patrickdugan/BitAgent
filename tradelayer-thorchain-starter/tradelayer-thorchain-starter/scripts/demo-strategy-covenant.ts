import path from "node:path";
import { buildStrategyCandidate } from "../src/mandates/allocator.js";
import { createStrategyBenchmarkScenario } from "../src/mandates/benchmark.js";
import { FileStrategyReceiptStore } from "../src/mandates/receiptStore.js";
import { buildCommittedSignalDraft } from "../src/mandates/signalBridge.js";
import { createStrategyDecisionReceipt, verifyStrategyCandidate } from "../src/mandates/verifier.js";

const scenario = createStrategyBenchmarkScenario(new Date("2026-08-05T12:00:00.000Z"));
const candidate = buildStrategyCandidate(scenario);
const verification = verifyStrategyCandidate({ ...scenario, candidate });
if (!verification.verified) throw new Error(`Candidate verification failed: ${verification.reasonCodes.join(", ")}`);
const receipt = createStrategyDecisionReceipt({
  candidate,
  covenant: scenario.covenant,
  proposals: scenario.proposals,
  verification
});
const signalDraft = buildCommittedSignalDraft({
  candidate,
  verification,
  covenant: scenario.covenant,
  codebase: {
    codebaseId: "scripted-covenant-allocator",
    kind: "sha256_source_tree",
    digest: scenario.covenant.runtime.allocatorHash
  },
  producerKeyId: "scripted-signal-producer",
  now: scenario.now
});
const store = new FileStrategyReceiptStore(path.resolve(".runtime", "strategy-covenant", "receipts"));
const receiptPath = await store.save(receipt);

console.log(JSON.stringify({
  mode: "scripted_candidate_only",
  covenantHash: scenario.covenant.covenantHash,
  candidate,
  verification,
  receipt,
  signalDraft,
  receiptPath,
  nextAuthority: candidate.nextAuthority,
  signingPerformed: false,
  broadcastPerformed: false
}, null, 2));
