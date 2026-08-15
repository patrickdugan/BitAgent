import { readFile } from "node:fs/promises";
import { SDL } from "@akashnetwork/chain-sdk/sdl";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: node validate-sdl.mjs <deploy.yml>");
const source = await readFile(inputPath, "utf8");
try {
  const sdl = SDL.fromString(source);
  console.log(JSON.stringify({ ok: true, manifest: sdl.manifest() }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
