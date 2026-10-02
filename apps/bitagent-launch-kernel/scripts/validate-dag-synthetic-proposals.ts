import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import { validateDagCandidate } from "../src/launch/dagCandidate.js";
import type { buildDagCandidateTask } from "../src/launch/dagCandidate.js";

type DagTask = ReturnType<typeof buildDagCandidateTask>;

function argument(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`Missing ${prefix}<value>`);
  return path.resolve(value);
}

function rows(bytes: Buffer): Record<string, any>[] {
  return bytes.toString("utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  const taskPath = argument("tasks");
  const proposalPath = argument("proposals");
  const output = argument("output");
  const taskBytes = await fs.readFile(taskPath);
  const proposalBytes = await fs.readFile(proposalPath);
  const tasks = rows(taskBytes);
  const proposals = rows(proposalBytes);
  if (tasks.length === 0 || proposals.length !== tasks.length) {
    throw new Error("Expected one proposal for every nonempty task row");
  }
  const byId = new Map<string, Record<string, any>>();
  for (const proposal of proposals) {
    if (proposal.schema !== "hermes.bitagent_synthetic_proposal.v1"
      || typeof proposal.scenario_id !== "string"
      || byId.has(proposal.scenario_id)) {
      throw new Error("Malformed or duplicate proposal scenario");
    }
    byId.set(proposal.scenario_id, proposal);
  }
  const results = tasks.map((row) => {
    if (row.schema !== "bitagent.synthetic_testnet4_dag_task.v1"
      || row.split !== "unreviewed_synthetic"
      || row.provenance?.effects !== false
      || row.provenance?.signing !== false
      || row.provenance?.broadcast !== false) {
      throw new Error("Task provenance or authority drift");
    }
    const proposal = byId.get(row.scenario_id);
    if (!proposal || proposal.task_id !== row.task.packet.task_id) {
      throw new Error(`Missing or stale proposal: ${row.scenario_id}`);
    }
    if (proposal.model_authority !== "candidate_only_no_effect"
      || proposal.optimizer_eligible !== false
      || typeof proposal.generated_text_sha256 !== "string") {
      throw new Error(`Proposal authority or provenance drift: ${row.scenario_id}`);
    }
    if (proposal.unsafe_output_redacted === true) {
      if (proposal.generated_text !== null || proposal.candidate !== null || proposal.parsed !== false) {
        throw new Error(`Unsafe proposal not fully redacted: ${row.scenario_id}`);
      }
    } else {
      if (typeof proposal.generated_text !== "string"
        || sha256(proposal.generated_text) !== proposal.generated_text_sha256) {
        throw new Error(`Proposal text hash mismatch: ${row.scenario_id}`);
      }
      let parsedText: unknown;
      try { parsedText = JSON.parse(proposal.generated_text); } catch { parsedText = null; }
      if (proposal.parsed === true && !isDeepStrictEqual(parsedText, proposal.candidate)) {
        throw new Error(`Proposal candidate differs from generated text: ${row.scenario_id}`);
      }
    }
    const receipt = validateDagCandidate({
      task: row.task as DagTask,
      proposed: proposal.candidate ?? null
    });
    if (receipt.authorization !== false || receipt.signing !== false
      || receipt.execution !== false || receipt.broadcast !== false
      || receipt.secret_access !== false || receipt.effects.length !== 0) {
      throw new Error("BitAgent DAG validator authority drift");
    }
    return {
      schema: "bitagent.synthetic_testnet4_dag_validation.v1",
      scenario_id: row.scenario_id,
      task_id: row.task.packet.task_id,
      family: row.task.packet.family,
      condition: row.task.packet.workflow_state.condition,
      generated_text_sha256: proposal.generated_text_sha256,
      parsed: proposal.parsed === true,
      accepted: receipt.ok,
      checks: receipt.checks,
      canonical_candidate: receipt.candidate,
      normalization_applied: receipt.normalization.applied,
      authority: "candidate_only_no_effect",
      optimizer_eligible: false
    };
  });
  const report = {
    schema: "bitagent.synthetic_testnet4_dag_batch_receipt.v1",
    task_file_sha256: sha256(taskBytes),
    proposal_file_sha256: sha256(proposalBytes),
    cases: results.length,
    parsed: results.filter((row) => row.parsed).length,
    accepted: results.filter((row) => row.accepted).length,
    candidate_only: true,
    wallet_or_chain_effect: false,
    optimizer_eligible: false,
    results
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ output, cases: report.cases, parsed: report.parsed,
    accepted: report.accepted, wallet_or_chain_effect: false }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
