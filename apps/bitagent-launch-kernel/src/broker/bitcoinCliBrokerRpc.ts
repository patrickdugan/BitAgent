import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { BitcoinCoreBrokerRpc } from "./types.js";

const execFileAsync = promisify(execFile);

export type BitcoinCliBrokerConfig = {
  bitcoinBin?: string;
  datadir?: string;
  wallet: string;
  rpcConnect?: string;
  rpcPort?: string;
};

function cliPath(bitcoinBin?: string): string {
  if (bitcoinBin) return path.join(bitcoinBin, process.platform === "win32" ? "bitcoin-cli.exe" : "bitcoin-cli");
  return process.platform === "win32" ? "bitcoin-cli.exe" : "bitcoin-cli";
}

export function buildBitcoinCliBrokerArgs(
  config: BitcoinCliBrokerConfig,
  method: string,
  params: unknown[]
): string[] {
  if (config.rpcPort && !/^[1-9][0-9]{0,4}$/.test(config.rpcPort)) {
    throw new Error("BTCTEST_RPC_PORT must be a decimal TCP port");
  }
  const encodedParams = params.map((param) => (typeof param === "string" ? param : JSON.stringify(param)));
  // A configured datadir may already select testnet4 in bitcoin.conf. Passing
  // a second chain selector makes Bitcoin Core reject the CLI invocation.
  // Effectful brokers independently validate getblockchaininfo.chain before
  // constructing or reserving anything.
  const args = config.datadir ? [] : ["-chain=testnet4"];
  if (config.datadir) args.push(`-datadir=${config.datadir}`);
  if (config.rpcConnect) args.push(`-rpcconnect=${config.rpcConnect}`);
  if (config.rpcPort) args.push(`-rpcport=${config.rpcPort}`);
  args.push(`-rpcwallet=${config.wallet}`, method, ...encodedParams);
  return args;
}

export class BitcoinCliBrokerRpc implements BitcoinCoreBrokerRpc {
  constructor(private readonly config: BitcoinCliBrokerConfig) {}

  async call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    const args = buildBitcoinCliBrokerArgs(this.config, method, params);
    const result = await execFileAsync(cliPath(this.config.bitcoinBin), args, {
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024
    });
    const output = result.stdout.trim();
    if (!output) return undefined as T;
    try {
      return JSON.parse(output) as T;
    } catch {
      return output as T;
    }
  }
}
