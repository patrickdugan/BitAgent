import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = path.join(root, "skills", "bitagent-marketing-coach");

test("marketing coach skill is narrow, wired to compliance, and free of scaffold placeholders", async () => {
  const skill = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
  const metadata = await fs.readFile(path.join(skillDir, "agents", "openai.yaml"), "utf8");
  assert.match(skill, /^---\nname: bitagent-marketing-coach\n/);
  assert.match(skill, /bitagent-compliance/);
  assert.match(skill, /WhatsApp/);
  assert.match(skill, /P2P perpetuals or economically/);
  assert.match(skill, /0\.05 basis points/);
  assert.match(skill, /npm run eval:marketing-cues/);
  assert.doesNotMatch(skill, /\bTODO\b/);
  assert.match(metadata, /\$bitagent-marketing-coach/);
});

test("training status helper renders the stable Hermes telemetry fields", () => {
  const output = execFileSync(process.execPath, [
    path.join(skillDir, "scripts", "render-training-status.mjs"),
    "--phase=eval",
    "--step=heldout",
    "--data=fixture",
    "--ram=12",
    "--eta=4m",
    "--percent=50",
    "--score=0.98"
  ], { encoding: "utf8" });
  assert.match(output, /\[##########----------\] 50\.0%/);
  assert.match(output, /phase\s+eval/);
  assert.match(output, /current_step\s+heldout/);
  assert.match(output, /data_source\s+fixture/);
  assert.match(output, /ram_budget_gb\s+12/);
  assert.match(output, /eta\s+4m/);
  assert.match(output, /best_score\s+0\.98/);
});
