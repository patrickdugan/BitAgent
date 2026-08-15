import fs from "node:fs/promises";
import path from "node:path";
import { runStrategyCovenantBenchmark } from "../src/mandates/benchmark.js";

const iterationsArgument = process.argv.find((argument) => argument.startsWith("--iterations="));
const iterations = iterationsArgument ? Number(iterationsArgument.split("=")[1]) : 250;
const report = runStrategyCovenantBenchmark({ iterations });
const outputPath = path.resolve(".runtime", "strategy-covenant", "latency-benchmark.json");
await fs.mkdir(path.dirname(outputPath), { recursive: true });
const temporary = `${outputPath}.${process.pid}.tmp`;
await fs.writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
await fs.rename(temporary, outputPath);
console.log(JSON.stringify({ outputPath, ...report }, null, 2));
