import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  observeStarterTradeLayerOrder,
  RelayerTradeLayerOrderReadSource
} from "../src/settlement/tradelayerOrderVerifier.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function propertyId(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

async function main() {
  const endpoint = arg("endpoint") || process.env.TRADELAYER_RELAYER_URL;
  const txid = arg("txid");
  const address = arg("address") || process.env.TRADELAYER_AGENT_ADDRESS;
  const amountOffered = arg("amount-offered");
  const amountExpected = arg("amount-expected");
  const outputPath = arg("output");
  if (!endpoint || !txid || !address || !amountOffered || !amountExpected || !outputPath) {
    throw new Error(
      "--endpoint, --txid, --address, --amount-offered, --amount-expected, and --output are required"
    );
  }
  const result = await observeStarterTradeLayerOrder({
    source: new RelayerTradeLayerOrderReadSource(endpoint),
    expected: {
      txid,
      address,
      offeredPropertyId: propertyId(arg("offered-property"), "--offered-property"),
      desiredPropertyId: propertyId(arg("desired-property"), "--desired-property"),
      amountOffered,
      amountExpected,
      postOnly: true
    }
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: result.status === "verified",
    status: result.status,
    positionOrOrderState: result.positionOrOrderState || null,
    output: path.resolve(outputPath),
    evidenceHash: result.evidenceHash,
    reason: result.reason
  }));
  if (result.status !== "verified") process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
