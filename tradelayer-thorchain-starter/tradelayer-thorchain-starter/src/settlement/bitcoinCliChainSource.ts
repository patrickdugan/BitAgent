import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  BitcoinChainSource,
  BitcoinTransactionEvidence,
  BitcoinWithdrawalObservation,
  BitcoinWithdrawalReadSource
} from "./types.js";

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

function btcAmountToSats(value: string | number, field: string): bigint {
  const text = typeof value === "number" ? value.toFixed(8) : String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,8}))?$/.exec(text);
  if (!match) throw new Error(`${field} must be a Bitcoin amount with at most eight decimals`);
  const fraction = (match[3] || "").padEnd(8, "0");
  const sats = BigInt(match[2]) * 100_000_000n + BigInt(fraction || "0");
  return match[1] ? -sats : sats;
}

function isMissingWalletTransaction(error: unknown): boolean {
  const item = error as { message?: unknown; stderr?: unknown } | null;
  const text = `${String(item?.message || "")} ${String(item?.stderr || "")}`;
  return /invalid or non-wallet transaction id/i.test(text);
}

type DecodedBitcoinTransaction = {
  txid?: string;
  vout?: Array<{
    n?: number;
    value?: string | number;
    scriptPubKey?: {
      hex?: string;
      address?: string;
      type?: string;
      asm?: string;
    };
  }>;
};

export class BitcoinCliChainSource implements BitcoinChainSource, BitcoinWithdrawalReadSource {
  readonly network = "bitcoin-testnet4" as const;

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

  get source(): string {
    return this.config.sourceId || "bitcoin-core-testnet4";
  }

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
    const source = this.source;
    let raw: string;
    try {
      raw = await this.command(["gettransaction", txid, "true"]);
    } catch (error) {
      if (!isMissingWalletTransaction(error)) throw error;
      return { txid, state: "missing", confirmations: 0, observedAt, source };
    }
    const walletTx = JSON.parse(raw) as {
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
  }

  async observeWithdrawal(txid: string): Promise<BitcoinWithdrawalObservation> {
    const observedAt = new Date().toISOString();
    let raw: string;
    try {
      raw = await this.command(["gettransaction", txid, "true"]);
    } catch (error) {
      if (!isMissingWalletTransaction(error)) throw error;
      return {
        txid,
        network: this.network,
        state: "missing",
        confirmations: 0,
        outputs: [],
        observedAt,
        source: this.source
      };
    }
    const walletTx = JSON.parse(raw) as {
      txid?: string;
      confirmations?: number;
      blockhash?: string;
      hex?: string;
      amount?: string | number;
      fee?: string | number;
    };
    if (!walletTx.hex) throw new Error("Bitcoin Core wallet transaction did not include raw transaction hex");
    const decoded = JSON.parse(await this.command(["decoderawtransaction", walletTx.hex])) as DecodedBitcoinTransaction;
    const confirmations = Number(walletTx.confirmations || 0);
    if (!Number.isInteger(confirmations)) throw new Error("Bitcoin Core returned invalid confirmations");
    const amountSats = walletTx.amount === undefined ? undefined : btcAmountToSats(walletTx.amount, "amount");
    const signedFeeSats = walletTx.fee === undefined ? undefined : btcAmountToSats(walletTx.fee, "fee");
    const walletNetSats = amountSats === undefined
      ? undefined
      : amountSats + (signedFeeSats || 0n);

    return {
      txid: String(decoded.txid || walletTx.txid || txid).toLowerCase(),
      network: this.network,
      state: confirmations < 0 ? "reorged" : confirmations === 0 ? "mempool" : "confirmed",
      confirmations,
      blockHash: walletTx.blockhash,
      outputs: (decoded.vout || []).map((output, index) => {
        if (output.value === undefined) throw new Error(`Bitcoin output ${index} lacks a value`);
        if (!output.scriptPubKey?.hex || !/^[a-f0-9]+$/i.test(output.scriptPubKey.hex)) {
          throw new Error(`Bitcoin output ${index} lacks a canonical scriptPubKey`);
        }
        const vout = output.n ?? index;
        if (!Number.isInteger(vout) || vout < 0) throw new Error(`Bitcoin output ${index} has an invalid vout`);
        return {
          vout,
          valueSats: btcAmountToSats(output.value, `output ${index}`).toString(),
          scriptPubKeyHex: output.scriptPubKey.hex.toLowerCase(),
          address: output.scriptPubKey.address
        };
      }),
      feeSats: signedFeeSats === undefined ? undefined : (signedFeeSats < 0n ? -signedFeeSats : signedFeeSats).toString(),
      walletNetDebitSats: walletNetSats !== undefined && walletNetSats < 0n ? (-walletNetSats).toString() : undefined,
      observedAt,
      source: this.source
    };
  }
}
