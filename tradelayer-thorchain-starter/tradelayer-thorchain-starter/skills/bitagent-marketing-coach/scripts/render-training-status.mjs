#!/usr/bin/env node

function args(values) {
  return Object.fromEntries(values.slice(2).filter((value) => value.startsWith("--")).map((value) => {
    const [key, ...rest] = value.slice(2).split("=");
    return [key, rest.join("=")];
  }));
}

const input = args(process.argv);
const percentValue = Number(input.percent ?? 0);
if (!Number.isFinite(percentValue) || percentValue < 0 || percentValue > 100) {
  throw new Error("--percent must be a number from 0 to 100");
}
const width = 20;
const filled = Math.round((percentValue / 100) * width);
const bar = `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
const fields = {
  phase: input.phase || "planning",
  current_step: input.step || "not-started",
  data_source: input.data || "training/datasets/bitagent-marketing-trajectories-v1",
  ram_budget_gb: input.ram || "auto",
  eta: input.eta || "estimating",
  percent_complete: `${percentValue.toFixed(1)}%`,
  progress_bar: bar,
  best_score: input.score || "n/a"
};

console.log("BitAgent marketing adapter status");
console.log(`${bar} ${fields.percent_complete}`);
for (const [key, value] of Object.entries(fields)) {
  if (key === "progress_bar" || key === "percent_complete") continue;
  console.log(`${key.padEnd(16)} ${value}`);
}
