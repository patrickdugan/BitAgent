import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { launchToolSchemas } from "../src/launch/tools.js";
import { committedSignalToolSchemas } from "../src/signals/tools.js";
import { financialSurvivalToolSchemas } from "../src/survival/tools.js";
import { reserveOperatorToolSchemas } from "../src/launch/operatorTools.js";
import { complianceToolSchemas } from "../src/compliance/tools.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(root, "skills");
const skillNames = [
  "agent-financial-survival",
  "bitagent-compliance",
  "bitagent-marketing-coach",
  "tradelayer-collateral-lifecycle"
] as const;

type ResourceManifest = {
  schema: string;
  skill: string;
  context: Record<string, number | boolean | string>;
  authority: Record<string, boolean | string>;
  phasePackets: Array<{
    phase: string;
    tools?: string[];
    entrypoints?: string[];
    resources?: string[];
  }>;
  resources?: Array<{ id: string }>;
  entrypoints?: Array<{ id: string; source: string; effect: string }>;
  tools?: Array<{ id: string; name: string; source: string; effect: string }>;
  mcpStatus?: string;
};

async function loadManifest(skill: (typeof skillNames)[number]) {
  const filePath = path.join(
    skillsRoot,
    skill,
    "references",
    "mcp-12k-resource-manifest.json"
  );
  return {
    filePath,
    value: JSON.parse(await fs.readFile(filePath, "utf8")) as ResourceManifest
  };
}

function assertContextBudget(manifest: ResourceManifest) {
  const context = manifest.context;
  assert.equal(context.mode, "mcp_intensive_12k");
  assert.equal(context.hardContextTokens, 12000);
  const inclusive = [
    "fixedOverheadMaxTokens",
    "toolSchemaMaxTokens",
    "workingPacketMaxTokens",
    "toolResultReserveTokens",
    "outputReserveTokens",
    "safetyMarginTokens"
  ].reduce((sum, key) => sum + Number(context[key]), 0);
  assert.ok(inclusive <= Number(context.hardContextTokens));
  assert.equal(context.rawResultsInline, false);
  assert.equal(context.rawTranscriptsInline, false);
  assert.ok(Number(context.maxToolRounds) <= 3);
  assert.ok(Number(context.maxToolCalls) <= 6);
  assert.ok(Number(context.maxActiveTools) <= 5);
}

test("all local BitAgent skills are complete and declare bounded MCP 12k resources", async () => {
  for (const skill of skillNames) {
    const skillText = await fs.readFile(path.join(skillsRoot, skill, "SKILL.md"), "utf8");
    assert.doesNotMatch(skillText, /\[TODO|TODO:/i, `${skill} still contains scaffold text`);
    assert.match(skillText, /MCP-intensive 12k mode/);

    const { value } = await loadManifest(skill);
    assert.equal(value.schema, "bitagent.skill_mcp12k_resource_manifest.v1");
    assert.equal(value.skill, skill);
    assertContextBudget(value);
    assert.equal(value.authority.candidateOnly, true);
    for (const key of ["approval", "signing", "broadcast", "execution"]) {
      assert.equal(value.authority[key], false, `${skill} grants ${key}`);
    }
    assert.ok(value.phasePackets.length >= 3);
    for (const packet of value.phasePackets) {
      assert.ok(packet.phase.length > 0);
      assert.ok((packet.tools || packet.entrypoints || []).length <= 3);
      assert.ok((packet.resources || []).length <= 5);
    }
  }
});
test("lifecycle MCP packets expose only implemented candidate tools and known resources", async () => {
  const { value } = await loadManifest("tradelayer-collateral-lifecycle");
  const knownTools = new Set([
    ...Object.keys(launchToolSchemas),
    ...Object.keys(committedSignalToolSchemas),
    ...Object.keys(reserveOperatorToolSchemas)
  ]);
  const resourceIds = new Set((value.resources || []).map((resource) => resource.id));
  for (const packet of value.phasePackets) {
    for (const toolName of packet.tools || []) {
      assert.ok(knownTools.has(toolName), `${packet.phase} exposes unknown tool ${toolName}`);
      assert.doesNotMatch(toolName, /request_approval|resolve_approval|\.execute$/);
    }
    for (const resourceId of packet.resources || []) {
      assert.ok(resourceIds.has(resourceId), `${packet.phase} references unknown resource ${resourceId}`);
    }
  }
});

test("financial-survival short-context mode exposes only its deterministic wrappers", async () => {
  const { value } = await loadManifest("agent-financial-survival");
  assert.equal(value.mcpStatus, "ready_deterministic_wrapper");
  const entrypoints = new Map((value.entrypoints || []).map((entrypoint) => [entrypoint.id, entrypoint]));
  assert.deepEqual([...entrypoints.keys()].sort(), ["assess", "evaluate", "journal_verify"]);

  for (const entrypoint of entrypoints.values()) {
    assert.equal(entrypoint.effect, "none");
    const [relativePath, exportName] = entrypoint.source.split("#");
    const source = await fs.readFile(path.join(root, relativePath), "utf8");
    assert.match(source, new RegExp(`export (?:async )?function ${exportName}\\b`));
  }

  const declaredTools = new Map((value.tools || []).map((tool) => [tool.name, tool]));
  assert.deepEqual([...declaredTools.keys()].sort(), Object.keys(financialSurvivalToolSchemas).sort());
  for (const tool of declaredTools.values()) assert.equal(tool.effect, "none");
  for (const packet of value.phasePackets) {
    for (const tool of packet.tools || []) assert.ok(declaredTools.has(tool));
  }
});

test("compliance short-context mode exposes only read-only deterministic policy tools", async () => {
  const { value } = await loadManifest("bitagent-compliance");
  assert.equal(value.mcpStatus, "ready_deterministic_wrapper");
  const declaredTools = new Map((value.tools || []).map((tool) => [tool.name, tool]));
  assert.deepEqual([...declaredTools.keys()].sort(), Object.keys(complianceToolSchemas).sort());
  for (const tool of declaredTools.values()) assert.equal(tool.effect, "none");
  for (const packet of value.phasePackets) {
    for (const tool of packet.tools || []) assert.ok(declaredTools.has(tool));
  }
});
