import path from "node:path";
import { writeAtomicStatusFile } from "../src/launch/atomicStatusFile.js";
import {
  applyDagRuntimePromotion,
  assessDagRuntimePromotion
} from "../src/launch/dagRuntimePromotion.js";

const args = process.argv.slice(2);
const command = args[0] || "assess";
const value = (name: string, fallback?: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const configPath = path.resolve(value("--config", "config/bitagent-dag-runtime-promotion.json")!);
const outputPath = value("--output");

if (!new Set(["assess", "apply"]).has(command)) {
  throw new Error("usage: promote-dag-runtime.ts assess|apply [--config path] [--output path]");
}
const result = command === "apply"
  ? await applyDagRuntimePromotion(configPath, value("--approval-sha256") || "")
  : await assessDagRuntimePromotion(configPath);
if (outputPath) await writeAtomicStatusFile(path.resolve(outputPath), result);
console.log(JSON.stringify(result, null, 2));
