import { canonicalHash } from "../survival/policy.js";
import type { BitcoinCoreBrokerRpc } from "./types.js";
import {
  validatePreparedTradeLayerActivationCandidate,
  validatePrivateTradeLayerActivationCandidate,
  type PreparedTradeLayerActivationCandidate,
  type PrivateTradeLayerActivationCandidate
} from "./tradelayerActivationCandidateBroker.js";

type Outpoint = { txid: string; vout: number };

type DecodedTransaction = {
  txid?: string;
  vin?: Outpoint[];
  vout?: Array<{
    value?: number;
    n?: number;
    scriptPubKey?: {
      type?: string;
      asm?: string;
      address?: string;
      addresses?: string[];
    };
  }>;
};

type DecodedPsbt = {
  fee?: number;
  inputs?: Array<{
    witness_utxo?: {
      amount?: number;
      scriptPubKey?: { address?: string; addresses?: string[] };
    };
  }>;
  tx?: DecodedTransaction;
};

export type TradeLayerActivationSubmissionReceipt = {
  schema: "bitagent_tradelayer_activation_submission_v1";
  requestHash: string;
  approvalHash: string;
  txid: string;
  submittedAt: string;
  mempoolAccepted: true;
  signingPerformed: true;
  broadcastPerformed: true;
  receiptHash: string;
};

export type TradeLayerActivationReconciliationReceipt = {
  schema: "bitagent_tradelayer_activation_reconciliation_v1";
  requestHash: string;
  approvalHash: string;
  txid: string;
  observedAt: string;
  confirmations: number;
  status: "mempool" | "confirmed";
  positiveObservation: true;
  retryAuthorized: false;
  receiptHash: string;
};

const ACTIVATION_EXECUTION_ERROR = Symbol.for("bitagent.tradelayer.activation-execution-error");

export class TradeLayerActivationExecutionError extends Error {
  constructor(
    public readonly code:
      | "signature_rejected"
      | "execution_validation_failed"
      | "mempool_rejected"
      | "submission_unknown",
    message: string,
    public readonly broadcastMayHaveOccurred = false,
    public readonly inputLockDisposition: "retained" | "released" | "unknown" = "unknown"
  ) {
    super(message);
    Object.setPrototypeOf(this, TradeLayerActivationExecutionError.prototype);
    Object.defineProperty(this, ACTIVATION_EXECUTION_ERROR, { value: true });
  }
}

export function isTradeLayerActivationExecutionError(
  error: unknown
): error is TradeLayerActivationExecutionError {
  return error instanceof TradeLayerActivationExecutionError || Boolean(
    error && typeof error === "object" && (error as Record<PropertyKey, unknown>)[ACTIVATION_EXECUTION_ERROR] === true
  );
}

function btcToSats(value: unknown, label: string): bigint {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 21_000_000) {
    throw new TradeLayerActivationExecutionError(
      "execution_validation_failed",
      `Bitcoin Core returned an invalid activation ${label}`
    );
  }
  return BigInt(Math.round(amount * 100_000_000));
}

function outputAddress(output: NonNullable<DecodedTransaction["vout"]>[number]): string {
  return String(output.scriptPubKey?.address || output.scriptPubKey?.addresses?.[0] || "");
}

function opReturnPayload(output: NonNullable<DecodedTransaction["vout"]>[number]): string {
  const tokens = String(output.scriptPubKey?.asm || "").trim().split(/\s+/);
  return tokens[0] === "OP_RETURN" && /^[a-f0-9]+$/i.test(tokens[1] || "")
    ? tokens[1]!.toLowerCase()
    : "";
}

function outpointKey(outpoint: Outpoint): string {
  return `${outpoint.txid}:${outpoint.vout}`;
}

function receipt<T extends { receiptHash: string }>(value: Omit<T, "receiptHash">): T {
  return { ...value, receiptHash: canonicalHash(value) } as T;
}

async function requireSynchronizedTestnet4(rpc: BitcoinCoreBrokerRpc): Promise<void> {
  const info = await rpc.call<{
    chain?: string;
    blocks?: number;
    headers?: number;
    initialblockdownload?: boolean;
  }>("getblockchaininfo");
  if (
    info.chain !== "testnet4" ||
    info.initialblockdownload === true ||
    !Number.isSafeInteger(info.blocks) ||
    !Number.isSafeInteger(info.headers) ||
    info.blocks !== info.headers
  ) {
    throw new TradeLayerActivationExecutionError(
      "execution_validation_failed",
      "Activation execution requires a fully synchronized Bitcoin testnet4 node",
      false,
      "retained"
    );
  }
}

async function releaseInputLocks(rpc: BitcoinCoreBrokerRpc, outpoints: Outpoint[]): Promise<void> {
  if (!await rpc.call<boolean>("lockunspent", true, outpoints)) {
    throw new TradeLayerActivationExecutionError(
      "execution_validation_failed",
      "Bitcoin Core refused to release activation inputs after a definite non-broadcast failure"
    );
  }
  const locked = await rpc.call<Outpoint[]>("listlockunspent");
  const lockedKeys = new Set(locked.map(outpointKey));
  if (outpoints.some((outpoint) => lockedKeys.has(outpointKey(outpoint)))) {
    throw new TradeLayerActivationExecutionError(
      "execution_validation_failed",
      "Activation inputs remain locked after a definite non-broadcast failure"
    );
  }
}

async function verifyDecodedPsbt(
  rpc: BitcoinCoreBrokerRpc,
  decoded: DecodedPsbt,
  candidate: PreparedTradeLayerActivationCandidate
): Promise<void> {
  if (decoded.tx?.txid !== candidate.unsignedTxid || btcToSats(decoded.fee, "fee") !== BigInt(candidate.feeSats)) {
    throw new TradeLayerActivationExecutionError(
      "execution_validation_failed",
      "Activation PSBT txid or fee differs from the approved candidate"
    );
  }
  const inputs = decoded.inputs || [];
  const vins = decoded.tx.vin || [];
  if (inputs.length !== 1 || vins.length !== 1) {
    throw new TradeLayerActivationExecutionError(
      "execution_validation_failed",
      "Activation PSBT input count differs from the approved candidate"
    );
  }
  const inputAddress = String(
    inputs[0]?.witness_utxo?.scriptPubKey?.address ||
    inputs[0]?.witness_utxo?.scriptPubKey?.addresses?.[0] || ""
  );
  const expectedInput = candidate.inputUtxos[0]!;
  if (
    vins[0]?.txid !== expectedInput.txid ||
    vins[0]?.vout !== expectedInput.vout ||
    inputAddress !== expectedInput.address ||
    btcToSats(inputs[0]?.witness_utxo?.amount, "input amount") !== BigInt(expectedInput.valueSats)
  ) {
    throw new TradeLayerActivationExecutionError(
      "execution_validation_failed",
      "Activation PSBT input differs from the approved candidate"
    );
  }
  const outputs = decoded.tx.vout || [];
  const [data, change] = outputs;
  if (
    outputs.length !== 2 ||
    data?.n !== 0 ||
    data.scriptPubKey?.type !== "nulldata" ||
    btcToSats(data.value, "data output") !== 0n ||
    opReturnPayload(data) !== candidate.dataOutput.payloadHex ||
    change?.n !== 1 ||
    outputAddress(change) !== candidate.changeOutput.address ||
    btcToSats(change.value, "change output") !== BigInt(candidate.changeOutput.valueSats)
  ) {
    throw new TradeLayerActivationExecutionError(
      "execution_validation_failed",
      "Activation PSBT outputs differ from the approved candidate"
    );
  }
  const changeInfo = await rpc.call<{ ismine?: boolean; iswatchonly?: boolean }>(
    "getaddressinfo",
    candidate.changeOutput.address
  );
  if (!changeInfo.ismine || changeInfo.iswatchonly) {
    throw new TradeLayerActivationExecutionError(
      "execution_validation_failed",
      "Activation change is no longer controlled by the wallet"
    );
  }
}

function verifyFinalTransaction(
  decoded: DecodedTransaction,
  candidate: PreparedTradeLayerActivationCandidate
): void {
  const input = candidate.inputUtxos[0]!;
  const [data, change] = decoded.vout || [];
  if (
    decoded.txid !== candidate.unsignedTxid ||
    decoded.vin?.length !== 1 ||
    decoded.vin[0]?.txid !== input.txid ||
    decoded.vin[0]?.vout !== input.vout ||
    decoded.vout?.length !== 2 ||
    data?.n !== 0 ||
    data.scriptPubKey?.type !== "nulldata" ||
    btcToSats(data.value, "final data output") !== 0n ||
    opReturnPayload(data) !== candidate.dataOutput.payloadHex ||
    change?.n !== 1 ||
    outputAddress(change) !== candidate.changeOutput.address ||
    btcToSats(change.value, "final change output") !== BigInt(candidate.changeOutput.valueSats)
  ) {
    throw new TradeLayerActivationExecutionError(
      "execution_validation_failed",
      "Signed activation transaction differs from the approved candidate"
    );
  }
}

export class TradeLayerActivationExecutionBroker {
  constructor(
    private readonly rpc: BitcoinCoreBrokerRpc,
    private readonly expectedPolicyFingerprint: string
  ) {}

  async execute(input: {
    candidate: PrivateTradeLayerActivationCandidate;
    approvalHash: string;
    now?: Date;
  }): Promise<TradeLayerActivationSubmissionReceipt> {
    const now = input.now || new Date();
    const outpoints = validatePrivateTradeLayerActivationCandidate(
      input.candidate,
      this.expectedPolicyFingerprint,
      now
    );
    const candidate = input.candidate.publicCandidate;
    if (input.approvalHash !== candidate.approvalHash) {
      throw new TradeLayerActivationExecutionError(
        "execution_validation_failed",
        "Activation approval hash differs from the exact wallet candidate",
        false,
        "retained"
      );
    }
    await requireSynchronizedTestnet4(this.rpc);
    try {
      const decoded = await this.rpc.call<DecodedPsbt>("decodepsbt", input.candidate.rawPsbt);
      await verifyDecodedPsbt(this.rpc, decoded, candidate);
    } catch (error) {
      await releaseInputLocks(this.rpc, outpoints);
      if (isTradeLayerActivationExecutionError(error)) {
        throw new TradeLayerActivationExecutionError(
          error.code,
          error.message,
          false,
          "released"
        );
      }
      throw new TradeLayerActivationExecutionError(
        "execution_validation_failed",
        "Activation PSBT could not be revalidated before signing",
        false,
        "released"
      );
    }

    let finalizedHex: string;
    try {
      const processed = await this.rpc.call<{ psbt?: string; complete?: boolean }>(
        "walletprocesspsbt",
        input.candidate.rawPsbt,
        true,
        "ALL",
        true
      );
      if (!processed.psbt || !processed.complete) throw new Error("wallet signature incomplete");
      const finalized = await this.rpc.call<{ hex?: string; complete?: boolean }>(
        "finalizepsbt",
        processed.psbt,
        true
      );
      if (!finalized.hex || !finalized.complete) throw new Error("wallet finalization incomplete");
      finalizedHex = finalized.hex;
    } catch {
      await releaseInputLocks(this.rpc, outpoints);
      throw new TradeLayerActivationExecutionError(
        "signature_rejected",
        "The wallet did not sign the exact approved activation candidate",
        false,
        "released"
      );
    }

    try {
      verifyFinalTransaction(
        await this.rpc.call<DecodedTransaction>("decoderawtransaction", finalizedHex),
        candidate
      );
    } catch (error) {
      await releaseInputLocks(this.rpc, outpoints);
      if (isTradeLayerActivationExecutionError(error)) {
        throw new TradeLayerActivationExecutionError(
          error.code,
          error.message,
          false,
          "released"
        );
      }
      throw new TradeLayerActivationExecutionError(
        "execution_validation_failed",
        "Signed activation transaction could not be decoded and revalidated",
        false,
        "released"
      );
    }

    let acceptance: Array<{
      allowed?: boolean;
      txid?: string;
      reject_reason?: string;
      fees?: { base?: number };
    }>;
    try {
      acceptance = await this.rpc.call("testmempoolaccept", [finalizedHex]);
    } catch {
      await releaseInputLocks(this.rpc, outpoints);
      throw new TradeLayerActivationExecutionError(
        "mempool_rejected",
        "Bitcoin Core mempool policy could not accept the approved activation",
        false,
        "released"
      );
    }
    const result = acceptance[0];
    if (
      !result?.allowed ||
      (result.txid !== undefined && result.txid !== candidate.unsignedTxid) ||
      (result.fees?.base !== undefined && btcToSats(result.fees.base, "mempool fee") !== BigInt(candidate.feeSats))
    ) {
      await releaseInputLocks(this.rpc, outpoints);
      throw new TradeLayerActivationExecutionError(
        "mempool_rejected",
        "Bitcoin Core rejected or changed the exact approved activation",
        false,
        "released"
      );
    }

    let txid: string;
    try {
      txid = String(await this.rpc.call<string>("sendrawtransaction", finalizedHex)).toLowerCase();
    } catch {
      throw new TradeLayerActivationExecutionError(
        "submission_unknown",
        "Activation submission outcome is unknown; retain the input and reconcile positively",
        true,
        "retained"
      );
    }
    if (txid !== candidate.unsignedTxid) {
      throw new TradeLayerActivationExecutionError(
        "submission_unknown",
        "Bitcoin Core returned a different activation txid; retain the input and reconcile",
        true,
        "retained"
      );
    }
    return receipt<TradeLayerActivationSubmissionReceipt>({
      schema: "bitagent_tradelayer_activation_submission_v1",
      requestHash: candidate.request.requestHash,
      approvalHash: candidate.approvalHash,
      txid,
      submittedAt: now.toISOString(),
      mempoolAccepted: true,
      signingPerformed: true,
      broadcastPerformed: true
    });
  }

  async reconcile(
    candidate: PreparedTradeLayerActivationCandidate,
    now: Date = new Date()
  ): Promise<TradeLayerActivationReconciliationReceipt> {
    validatePreparedTradeLayerActivationCandidate(
      candidate,
      this.expectedPolicyFingerprint,
      now,
      true
    );
    await requireSynchronizedTestnet4(this.rpc);
    let observed: { txid?: string; confirmations?: number };
    try {
      observed = await this.rpc.call("getrawtransaction", candidate.unsignedTxid, true);
    } catch {
      throw new TradeLayerActivationExecutionError(
        "submission_unknown",
        "Activation is not positively observed; retain the input and do not authorize retry",
        true,
        "retained"
      );
    }
    const confirmations = Number(observed.confirmations || 0);
    if (
      observed.txid !== candidate.unsignedTxid ||
      !Number.isSafeInteger(confirmations) ||
      confirmations < 0
    ) {
      throw new TradeLayerActivationExecutionError(
        "submission_unknown",
        "Activation observation is invalid; retain the input and do not authorize retry",
        true,
        "retained"
      );
    }
    return receipt<TradeLayerActivationReconciliationReceipt>({
      schema: "bitagent_tradelayer_activation_reconciliation_v1",
      requestHash: candidate.request.requestHash,
      approvalHash: candidate.approvalHash,
      txid: candidate.unsignedTxid,
      observedAt: now.toISOString(),
      confirmations,
      status: confirmations > 0 ? "confirmed" : "mempool",
      positiveObservation: true,
      retryAuthorized: false
    });
  }
}
