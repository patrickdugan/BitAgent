import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { BitcoinChainSource, BitcoinTransactionEvidence } from "./types.js";

const execFileAsync = promisify(execFile);

function cliPath(bitcoinBin?: string): string {
  if (bitcoinBin) return path.join(bitcoinBin, process.platform === "win32" ? "bitcoin-cli.exe" : "bitcoin-cli");
  return process.platform === "win32" ? "bitcoin-cli.exe" : "bitcoin-cli";
}

function opReturnPayload(decoded: { vout?: Array<{ scriptPubKey?: { type?: string; asm?: string } }> }): string | undefined {
  const output = decoded.vout?.find((item) => item.scriptPubKey?.type === "nulldata");
  const tokens = output?.scriptPubKey?.asm?.split(/\s+/) || [];
  return tokens.find((token) => /^[a-f0-9]+$/i.test(token) && token.length % 2 === 0)?.toLowerCase();
}

export class BitcoinCliChainSource implements BitcoinChainSource {
  constructor(
    private readonly config: {
      bitcoinBin?: string;
      datadir?: string;
      wallet: string;
      rpcConnect?: string;
      rpcPort?: string;
      sourceId?: string;
    }
  ) {}

  private async command(args: string[]): Promise<string> {
    const baseArgs = ["-chain=testnet4", `-rpcwallet=${this.config.wallet}`, ...args];
    if (this.config.rpcPort) {
      if (!/^[1-9][0-9]{0,4}$/.test(this.config.rpcPort)) throw new Error("BTCTEST_RPC_PORT must be a decimal TCP port");
      baseArgs.unshift(`-rpcport=${this.config.rpcPort}`);
    }
    if (this.config.rpcConnect) baseArgs.unshift(`-rpcconnect=${this.config.rpcConnect}`);
    if (this.config.datadir) baseArgs.unshift(`-datadir=${this.config.datadir}`);
    const result = await execFileAsync(cliPath(this.config.bitcoinBin), baseArgs, {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024
    });
    return result.stdout.trim();
  }

  async observeTransaction(txid: string): Promise<BitcoinTransactionEvidence> {
    const observedAt = new Date().toISOString();
    const source = this.config.sourceId || "bitcoin-core-testnet4";
    try {
      const walletTx = JSON.parse(await this.command(["gettransaction", txid, "true"])) as {
        confirmations?: number;
        blockhash?: string;
        hex?: string;
      };
      const confirmations = Number(walletTx.confirmations || 0);
      const decoded = walletTx.hex
        ? (JSON.parse(await this.command(["decoderawtransaction", walletTx.hex])) as Parameters<typeof opReturnPayload>[0])
        : {};
      return {
        txid,
        state: confirmations < 0 ? "reorged" : confirmations === 0 ? "mempool" : "confirmed",
        confirmations,
        blockHash: walletTx.blockhash,
        payloadHex: opReturnPayload(decoded),
        observedAt,
        source
      };
    } catch {
      return { txid, state: "missing", confirmations: 0, observedAt, source };
    }
  }
}
