import fs from "node:fs/promises";
import path from "node:path";
import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import type { BitcoinCoreBrokerRpc } from "./types.js";
import { TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS } from "./tradelayerActivationCandidateBroker.js";

type Outpoint = { txid: string; vout: number };
type RecordStatus =
  | "pending_approval"
  | "execution_requested"
  | "submitted"
  | "mempool"
  | "confirmed"
  | "cancelled"
  | "failed_released"
  | "submission_unknown";

type WalletUtxo = Outpoint & {
  address?: string;
  amount?: number;
  confirmations?: number;
  spendable?: boolean;
  solvable?: boolean;
  safe?: boolean;
};

type DecodedTransaction = {
  txid?: string;
  vin?: Outpoint[];
  vout?: Array<{
    n?: number;
    value?: number;
    scriptPubKey?: { address?: string; addresses?: string[] };
  }>;
};

type DecodedPsbt = {
  fee?: number;
  tx?: DecodedTransaction;
  inputs?: Array<{
    witness_utxo?: {
      amount?: number;
      scriptPubKey?: { address?: string; addresses?: string[] };
    };
  }>;
};

export type TradeLayerAdminFundingRequest = {
  schema: "bitagent_tradelayer_admin_funding_request_v1";
  network: "testnet4";
  requestId: string;
  wallet: string;
  source: Outpoint & { address: string; valueSats: string };
  destinationAddress: string;
  feeRateSatVb: number;
  maxFeeSats: string;
  expiresAt: string;
  policyFingerprint: string;
  requestHash: string;
};

export type PreparedTradeLayerAdminFundingCandidate = {
  schema: "bitagent_tradelayer_admin_funding_candidate_v1";
  authority: "wallet_user";
  effect: "none_candidate_only";
  request: TradeLayerAdminFundingRequest;
  preparedAt: string;
  unsignedTxid: string;
  unsignedPsbtHash: string;
  input: Outpoint & { address: string; valueSats: string };
  destinationOutput: { vout: 0; address: string; valueSats: string };
  feeSats: string;
  approvalRequired: true;
  signingPerformed: false;
  broadcastPerformed: false;
  approvalHash: string;
};

type PrivateFundingCandidate = {
  schema: "bitagent_tradelayer_admin_funding_private_candidate_v1";
  publicCandidate: PreparedTradeLayerAdminFundingCandidate;
  rawPsbt: string;
  envelopeHash: string;
};

type FundingResult = {
  schema: "bitagent_tradelayer_admin_funding_result_v1";
  status: "submitted" | "mempool" | "confirmed";
  txid: string;
  confirmations: number;
  approvalHash: string;
  requestHash: string;
  observedAt: string;
  receiptHash: string;
};

type FundingFailure = {
  message: string;
  broadcastMayHaveOccurred: boolean;
  inputLockDisposition: "released" | "retained";
  signingPerformed: boolean;
  failedAt: string;
};

type FundingRecord = {
  schema: "bitagent_tradelayer_admin_funding_record_v1";
  approvalHash: string;
  status: RecordStatus;
  candidate: PrivateFundingCandidate;
  result?: FundingResult;
  failure?: FundingFailure;
  createdAt: string;
  updatedAt: string;
  recordHash: string;
};

type FundingDocument = {
  schema: "bitagent_tradelayer_admin_funding_store_v1";
  records: Record<string, FundingRecord>;
  documentHash: string;
};

export type TradeLayerAdminFundingApprovalView = {
  schema: "bitagent_tradelayer_admin_funding_approval_v1";
  status: RecordStatus;
  explanation: string;
  exactEffects: {
    network: "testnet4";
    wallet: string;
    input: PreparedTradeLayerAdminFundingCandidate["input"];
    destinationOutput: PreparedTradeLayerAdminFundingCandidate["destinationOutput"];
    feeRateSatVb: number;
    feeSats: string;
    maxFeeSats: string;
    unsignedTxid: string;
    unsignedPsbtHash: string;
    approvalHash: string;
  };
  approval: {
    exactApprovalHash: string;
    expiresAt: string;
    expired: boolean;
    decisionStatus: "pending" | "expired" | "approved" | "cancelled" | "recovery";
  };
  walletActions: {
    signingPerformed: boolean | null;
    broadcastStatus: "not_performed" | "submitted" | "unknown";
  };
  result?: FundingResult;
  failure?: FundingFailure;
  recoveryInstructions: string[];
};

function btcToSats(value: number | undefined, label: string): bigint {
  if (!Number.isFinite(value)) {
    throw new IntegrationBoundaryError("signer_broker_error", `Admin funding transaction is missing ${label}`);
  }
  return BigInt(Math.round(Number(value) * 100_000_000));
}

function satsToBtc(value: string): number {
  return Number(BigInt(value)) / 100_000_000;
}

function outputAddress(output: NonNullable<DecodedTransaction["vout"]>[number]): string | undefined {
  return output.scriptPubKey?.address || output.scriptPubKey?.addresses?.[0];
}

function outpointKey(outpoint: Outpoint): string {
  return `${outpoint.txid}:${outpoint.vout}`;
}

function requestMaterial(request: TradeLayerAdminFundingRequest) {
  const { requestHash: _requestHash, ...material } = request;
  return material;
}

function approvalMaterial(candidate: PreparedTradeLayerAdminFundingCandidate) {
  return {
    requestHash: candidate.request.requestHash,
    preparedAt: candidate.preparedAt,
    unsignedTxid: candidate.unsignedTxid,
    unsignedPsbtHash: candidate.unsignedPsbtHash,
    input: candidate.input,
    destinationOutput: candidate.destinationOutput,
    feeSats: candidate.feeSats
  };
}

function envelopeMaterial(candidate: PrivateFundingCandidate) {
  return {
    approvalHash: candidate.publicCandidate.approvalHash,
    rawPsbtHash: canonicalHash(candidate.rawPsbt)
  };
}

function recordMaterial(record: FundingRecord) {
  const { recordHash: _recordHash, ...material } = record;
  return material;
}

function documentMaterial(document: FundingDocument) {
  const { documentHash: _documentHash, ...material } = document;
  return material;
}

function validateRequest(
  request: TradeLayerAdminFundingRequest,
  expectedPolicyFingerprint: string,
  now: Date,
  allowExpired = false
): void {
  const expires = Date.parse(request.expiresAt);
  if (
    request.schema !== "bitagent_tradelayer_admin_funding_request_v1" ||
    request.network !== "testnet4" ||
    canonicalHash(requestMaterial(request)) !== request.requestHash ||
    request.policyFingerprint !== expectedPolicyFingerprint ||
    !request.requestId.trim() ||
    !request.wallet.trim() ||
    !/^[a-f0-9]{64}$/.test(request.source.txid) ||
    !Number.isSafeInteger(request.source.vout) ||
    request.source.vout < 0 ||
    !/^[1-9][0-9]*$/.test(request.source.valueSats) ||
    !request.source.address.trim() ||
    request.source.address === TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS ||
    request.destinationAddress !== TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS ||
    !Number.isSafeInteger(request.feeRateSatVb) ||
    request.feeRateSatVb < 1 ||
    request.feeRateSatVb > 10 ||
    !/^[1-9][0-9]*$/.test(request.maxFeeSats) ||
    BigInt(request.maxFeeSats) >= BigInt(request.source.valueSats) - 546n ||
    !Number.isFinite(expires) ||
    (!allowExpired && expires <= now.getTime())
  ) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer admin funding request is invalid or expired");
  }
}

function validateCandidate(
  candidate: PreparedTradeLayerAdminFundingCandidate,
  expectedPolicyFingerprint: string,
  now: Date,
  allowExpired = false
): void {
  validateRequest(candidate.request, expectedPolicyFingerprint, now, allowExpired);
  if (
    candidate.schema !== "bitagent_tradelayer_admin_funding_candidate_v1" ||
    candidate.authority !== "wallet_user" ||
    candidate.effect !== "none_candidate_only" ||
    candidate.approvalRequired !== true ||
    candidate.signingPerformed !== false ||
    candidate.broadcastPerformed !== false ||
    canonicalHash(approvalMaterial(candidate)) !== candidate.approvalHash ||
    candidate.input.txid !== candidate.request.source.txid ||
    candidate.input.vout !== candidate.request.source.vout ||
    candidate.input.address !== candidate.request.source.address ||
    candidate.input.valueSats !== candidate.request.source.valueSats ||
    candidate.destinationOutput.vout !== 0 ||
    candidate.destinationOutput.address !== TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS ||
    BigInt(candidate.destinationOutput.valueSats) + BigInt(candidate.feeSats) !== BigInt(candidate.input.valueSats) ||
    BigInt(candidate.feeSats) > BigInt(candidate.request.maxFeeSats) ||
    !/^[a-f0-9]{64}$/.test(candidate.unsignedTxid) ||
    !/^[a-f0-9]{64}$/.test(candidate.approvalHash)
  ) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer admin funding candidate does not match its exact effects");
  }
}

function validatePrivateCandidate(
  candidate: PrivateFundingCandidate,
  expectedPolicyFingerprint: string,
  now: Date,
  allowExpired = false
): void {
  validateCandidate(candidate.publicCandidate, expectedPolicyFingerprint, now, allowExpired);
  if (
    candidate.schema !== "bitagent_tradelayer_admin_funding_private_candidate_v1" ||
    !candidate.rawPsbt ||
    canonicalHash(candidate.rawPsbt) !== candidate.publicCandidate.unsignedPsbtHash ||
    canonicalHash(envelopeMaterial(candidate)) !== candidate.envelopeHash
  ) {
    throw new IntegrationBoundaryError("signer_broker_error", "Private admin funding envelope failed integrity validation");
  }
}

async function releaseLock(rpc: BitcoinCoreBrokerRpc, outpoint: Outpoint): Promise<void> {
  if (!await rpc.call<boolean>("lockunspent", true, [outpoint])) {
    throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core refused to release the admin funding input");
  }
  const locked = await rpc.call<Outpoint[]>("listlockunspent");
  if (locked.some((item) => outpointKey(item) === outpointKey(outpoint))) {
    throw new IntegrationBoundaryError("signer_broker_error", "Admin funding input remains locked after release");
  }
}

async function validateNetwork(rpc: BitcoinCoreBrokerRpc): Promise<void> {
  const info = await rpc.call<{ chain?: string; blocks?: number; headers?: number; initialblockdownload?: boolean }>(
    "getblockchaininfo"
  );
  if (
    info.chain !== "testnet4" ||
    info.initialblockdownload === true ||
    !Number.isSafeInteger(info.blocks) ||
    info.blocks !== info.headers
  ) {
    throw new IntegrationBoundaryError("signer_broker_error", "Admin funding requires a synchronized Bitcoin testnet4 node");
  }
}

function validateDecodedCandidate(
  decoded: DecodedPsbt,
  request: TradeLayerAdminFundingRequest
): { txid: string; feeSats: string; destinationValueSats: string } {
  const vins = decoded.tx?.vin || [];
  const outputs = decoded.tx?.vout || [];
  const input = decoded.inputs?.[0]?.witness_utxo;
  const inputAddress = input?.scriptPubKey?.address || input?.scriptPubKey?.addresses?.[0];
  const fee = btcToSats(decoded.fee, "fee");
  const destinationValue = btcToSats(outputs[0]?.value, "destination value");
  if (
    !decoded.tx?.txid ||
    !/^[a-f0-9]{64}$/.test(decoded.tx.txid) ||
    vins.length !== 1 ||
    vins[0]?.txid !== request.source.txid ||
    vins[0]?.vout !== request.source.vout ||
    btcToSats(input?.amount, "input value") !== BigInt(request.source.valueSats) ||
    inputAddress !== request.source.address ||
    outputs.length !== 1 ||
    outputs[0]?.n !== 0 ||
    outputAddress(outputs[0]) !== TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS ||
    destinationValue <= 546n ||
    destinationValue + fee !== BigInt(request.source.valueSats) ||
    fee <= 0n ||
    fee > BigInt(request.maxFeeSats)
  ) {
    throw new IntegrationBoundaryError("signer_broker_error", "Decoded admin funding PSBT differs from the requested one-input/one-output transfer");
  }
  return { txid: decoded.tx.txid, feeSats: fee.toString(), destinationValueSats: destinationValue.toString() };
}

export function createTradeLayerAdminFundingRequest(input: {
  requestId: string;
  wallet: string;
  source: Outpoint & { address: string; valueSats: string };
  feeRateSatVb: number;
  maxFeeSats: string;
  expiresAt: string;
  policyFingerprint: string;
}): TradeLayerAdminFundingRequest {
  const material = {
    schema: "bitagent_tradelayer_admin_funding_request_v1" as const,
    network: "testnet4" as const,
    requestId: input.requestId,
    wallet: input.wallet,
    source: input.source,
    destinationAddress: TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS,
    feeRateSatVb: input.feeRateSatVb,
    maxFeeSats: input.maxFeeSats,
    expiresAt: input.expiresAt,
    policyFingerprint: input.policyFingerprint
  };
  return { ...material, requestHash: canonicalHash(material) };
}

export class TradeLayerAdminFundingCandidateBroker {
  constructor(
    private readonly rpc: BitcoinCoreBrokerRpc,
    private readonly expectedPolicyFingerprint: string
  ) {}

  async preparePrivate(
    request: TradeLayerAdminFundingRequest,
    now = new Date()
  ): Promise<PrivateFundingCandidate> {
    validateRequest(request, this.expectedPolicyFingerprint, now);
    await validateNetwork(this.rpc);
    for (const address of [request.source.address, request.destinationAddress]) {
      const info = await this.rpc.call<{ ismine?: boolean; iswatchonly?: boolean }>("getaddressinfo", address);
      if (!info.ismine || info.iswatchonly) {
        throw new IntegrationBoundaryError("signer_broker_error", "Admin funding source and destination must both be spendable by the loaded wallet");
      }
    }
    const utxos = await this.rpc.call<WalletUtxo[]>("listunspent", 1, 9_999_999, [request.source.address], false);
    const source = utxos.find((item) => item.txid === request.source.txid && item.vout === request.source.vout);
    if (
      !source ||
      source.address !== request.source.address ||
      btcToSats(source.amount, "source value") !== BigInt(request.source.valueSats) ||
      source.spendable === false ||
      source.solvable === false ||
      source.safe === false ||
      !Number.isSafeInteger(source.confirmations) ||
      Number(source.confirmations) < 1
    ) {
      throw new IntegrationBoundaryError("signer_broker_error", "Exact admin funding source is not confirmed, safe, and spendable");
    }
    const outpoint = { txid: request.source.txid, vout: request.source.vout };
    let reserved = false;
    try {
      const funded = await this.rpc.call<{ psbt?: string }>(
        "walletcreatefundedpsbt",
        [outpoint],
        [{ [TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS]: satsToBtc(request.source.valueSats) }],
        0,
        {
          add_inputs: false,
          fee_rate: request.feeRateSatVb,
          lockUnspents: true,
          include_unsafe: false,
          subtractFeeFromOutputs: [0],
          replaceable: false
        },
        true
      );
      reserved = true;
      if (!funded.psbt) throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core did not return an admin funding PSBT");
      const effects = validateDecodedCandidate(await this.rpc.call<DecodedPsbt>("decodepsbt", funded.psbt), request);
      const publicCandidate = {
        schema: "bitagent_tradelayer_admin_funding_candidate_v1" as const,
        authority: "wallet_user" as const,
        effect: "none_candidate_only" as const,
        request,
        preparedAt: now.toISOString(),
        unsignedTxid: effects.txid,
        unsignedPsbtHash: canonicalHash(funded.psbt),
        input: request.source,
        destinationOutput: {
          vout: 0 as const,
          address: TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS,
          valueSats: effects.destinationValueSats
        },
        feeSats: effects.feeSats,
        approvalRequired: true as const,
        signingPerformed: false as const,
        broadcastPerformed: false as const,
        approvalHash: ""
      } satisfies PreparedTradeLayerAdminFundingCandidate;
      publicCandidate.approvalHash = canonicalHash(approvalMaterial(publicCandidate));
      const privateCandidate = {
        schema: "bitagent_tradelayer_admin_funding_private_candidate_v1" as const,
        publicCandidate,
        rawPsbt: funded.psbt,
        envelopeHash: ""
      } satisfies PrivateFundingCandidate;
      privateCandidate.envelopeHash = canonicalHash(envelopeMaterial(privateCandidate));
      return privateCandidate;
    } catch (error) {
      if (reserved) await releaseLock(this.rpc, outpoint);
      throw error;
    }
  }

  async cancelPrivate(candidate: PrivateFundingCandidate, now = new Date()): Promise<void> {
    validatePrivateCandidate(candidate, this.expectedPolicyFingerprint, now, true);
    await releaseLock(this.rpc, candidate.publicCandidate.input);
  }
}

class FundingExecutionError extends Error {
  constructor(
    message: string,
    readonly broadcastMayHaveOccurred: boolean,
    readonly inputLockDisposition: "released" | "retained",
    readonly signingPerformed: boolean
  ) {
    super(message);
  }
}

export class TradeLayerAdminFundingExecutionBroker {
  constructor(
    private readonly rpc: BitcoinCoreBrokerRpc,
    private readonly expectedPolicyFingerprint: string
  ) {}

  async execute(candidate: PrivateFundingCandidate, approvalHash: string, now = new Date()): Promise<FundingResult> {
    validatePrivateCandidate(candidate, this.expectedPolicyFingerprint, now);
    if (approvalHash !== candidate.publicCandidate.approvalHash) {
      throw new FundingExecutionError("Admin funding approval hash mismatch", false, "retained", false);
    }
    const publicCandidate = candidate.publicCandidate;
    let submissionAttempted = false;
    let signingPerformed = false;
    try {
      await validateNetwork(this.rpc);
      validateDecodedCandidate(await this.rpc.call<DecodedPsbt>("decodepsbt", candidate.rawPsbt), publicCandidate.request);
      const processed = await this.rpc.call<{ psbt?: string; complete?: boolean }>("walletprocesspsbt", candidate.rawPsbt, true, "ALL", true);
      if (!processed.psbt || processed.complete !== true) {
        throw new Error("Wallet did not sign the exact admin funding PSBT");
      }
      signingPerformed = true;
      const finalized = await this.rpc.call<{ hex?: string; complete?: boolean }>("finalizepsbt", processed.psbt, true);
      if (!finalized.hex || finalized.complete !== true) throw new Error("Wallet did not finalize the admin funding transaction");
      const decoded = await this.rpc.call<DecodedTransaction>("decoderawtransaction", finalized.hex);
      const output = decoded.vout?.[0];
      if (
        decoded.txid !== publicCandidate.unsignedTxid ||
        decoded.vin?.length !== 1 ||
        decoded.vin[0]?.txid !== publicCandidate.input.txid ||
        decoded.vin[0]?.vout !== publicCandidate.input.vout ||
        decoded.vout?.length !== 1 ||
        outputAddress(output!) !== publicCandidate.destinationOutput.address ||
        btcToSats(output?.value, "final destination value").toString() !== publicCandidate.destinationOutput.valueSats
      ) {
        throw new Error("Final admin funding transaction differs from the approved exact effects");
      }
      const admission = await this.rpc.call<Array<{ allowed?: boolean; txid?: string; reject_reason?: string; fees?: { base?: number } }>>(
        "testmempoolaccept",
        [finalized.hex]
      );
      const accepted = admission[0];
      if (
        !accepted?.allowed ||
        accepted.txid !== publicCandidate.unsignedTxid ||
        btcToSats(accepted.fees?.base, "mempool fee").toString() !== publicCandidate.feeSats
      ) {
        throw new Error(`Admin funding transaction failed mempool admission: ${accepted?.reject_reason || "unknown"}`);
      }
      submissionAttempted = true;
      const txid = await this.rpc.call<string>("sendrawtransaction", finalized.hex);
      if (txid !== publicCandidate.unsignedTxid) throw new Error("Bitcoin Core returned a different admin funding txid");
      const material = {
        schema: "bitagent_tradelayer_admin_funding_result_v1" as const,
        status: "submitted" as const,
        txid,
        confirmations: 0,
        approvalHash,
        requestHash: publicCandidate.request.requestHash,
        observedAt: now.toISOString()
      };
      return { ...material, receiptHash: canonicalHash(material) };
    } catch (error) {
      if (submissionAttempted) {
        throw new FundingExecutionError("Admin funding submission outcome is unknown; do not retry", true, "retained", signingPerformed);
      }
      await releaseLock(this.rpc, publicCandidate.input);
      throw new FundingExecutionError(
        error instanceof Error ? error.message : "Admin funding failed before broadcast",
        false,
        "released",
        signingPerformed
      );
    }
  }

  async reconcile(candidate: PrivateFundingCandidate, now = new Date()): Promise<FundingResult> {
    validatePrivateCandidate(candidate, this.expectedPolicyFingerprint, now, true);
    let observed: { txid?: string; confirmations?: number };
    try {
      observed = await this.rpc.call("getrawtransaction", candidate.publicCandidate.unsignedTxid, true);
    } catch {
      throw new IntegrationBoundaryError("recovery_error", "Admin funding transaction was not positively observed; do not retry");
    }
    if (observed.txid !== candidate.publicCandidate.unsignedTxid) {
      throw new IntegrationBoundaryError("recovery_error", "Admin funding reconciliation observed a different transaction");
    }
    const confirmations = Math.max(0, Number(observed.confirmations || 0));
    const status = confirmations > 0 ? "confirmed" as const : "mempool" as const;
    const material = {
      schema: "bitagent_tradelayer_admin_funding_result_v1" as const,
      status,
      txid: candidate.publicCandidate.unsignedTxid,
      confirmations,
      approvalHash: candidate.publicCandidate.approvalHash,
      requestHash: candidate.publicCandidate.request.requestHash,
      observedAt: now.toISOString()
    };
    return { ...material, receiptHash: canonicalHash(material) };
  }
}

function approvalView(record: FundingRecord, now = new Date()): TradeLayerAdminFundingApprovalView {
  const candidate = record.candidate.publicCandidate;
  const expired = Date.parse(candidate.request.expiresAt) <= now.getTime();
  const decisionStatus = record.status === "pending_approval"
    ? (expired ? "expired" : "pending")
    : record.status === "cancelled"
      ? "cancelled"
      : ["submitted", "mempool", "confirmed"].includes(record.status)
        ? "approved"
        : "recovery";
  const resultObserved = ["submitted", "mempool", "confirmed"].includes(record.status);
  return {
    schema: "bitagent_tradelayer_admin_funding_approval_v1",
    status: record.status,
    explanation: "Move one confirmed local testnet4 UTXO to the wallet-controlled TradeLayer protocol-admin address so a later tx11 activation can be simulated from the required sender.",
    exactEffects: {
      network: "testnet4",
      wallet: candidate.request.wallet,
      input: candidate.input,
      destinationOutput: candidate.destinationOutput,
      feeRateSatVb: candidate.request.feeRateSatVb,
      feeSats: candidate.feeSats,
      maxFeeSats: candidate.request.maxFeeSats,
      unsignedTxid: candidate.unsignedTxid,
      unsignedPsbtHash: candidate.unsignedPsbtHash,
      approvalHash: candidate.approvalHash
    },
    approval: {
      exactApprovalHash: candidate.approvalHash,
      expiresAt: candidate.request.expiresAt,
      expired,
      decisionStatus
    },
    walletActions: {
      signingPerformed: record.failure
        ? record.failure.signingPerformed
        : resultObserved
          ? true
          : record.status === "execution_requested" || record.status === "submission_unknown"
            ? null
            : false,
      broadcastStatus: resultObserved
        ? "submitted"
        : record.status === "submission_unknown" || record.status === "execution_requested"
          ? "unknown"
          : "not_performed"
    },
    result: record.result,
    failure: record.failure,
    recoveryInstructions: record.status === "pending_approval"
      ? (expired ? ["Do not approve an expired candidate.", "Cancel it and create a fresh simulation."] : ["Approve only this exact approval hash or cancel it."])
      : record.status === "submission_unknown" || record.status === "execution_requested"
        ? ["Do not retry.", "Reconcile only by positive observation of the exact unsigned txid."]
        : []
  };
}

export class FileTradeLayerAdminFundingStore {
  private queue = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly expectedPolicyFingerprint: string
  ) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private empty(): FundingDocument {
    const document = { schema: "bitagent_tradelayer_admin_funding_store_v1" as const, records: {}, documentHash: "" };
    document.documentHash = canonicalHash(documentMaterial(document));
    return document;
  }

  private validateRecord(record: FundingRecord): void {
    validatePrivateCandidate(record.candidate, this.expectedPolicyFingerprint, new Date(record.createdAt), true);
    if (
      record.schema !== "bitagent_tradelayer_admin_funding_record_v1" ||
      record.approvalHash !== record.candidate.publicCandidate.approvalHash ||
      canonicalHash(recordMaterial(record)) !== record.recordHash
    ) {
      throw new IntegrationBoundaryError("signer_broker_error", "Admin funding store record failed integrity validation");
    }
  }

  private async read(): Promise<FundingDocument> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.empty();
      throw error;
    }
    let document: FundingDocument;
    try {
      document = JSON.parse(text) as FundingDocument;
    } catch {
      throw new IntegrationBoundaryError("signer_broker_error", "Admin funding private store is unreadable");
    }
    if (
      document.schema !== "bitagent_tradelayer_admin_funding_store_v1" ||
      !document.records ||
      canonicalHash(documentMaterial(document)) !== document.documentHash
    ) {
      throw new IntegrationBoundaryError("signer_broker_error", "Admin funding private store integrity check failed");
    }
    for (const record of Object.values(document.records)) this.validateRecord(record);
    return document;
  }

  private async write(document: FundingDocument): Promise<void> {
    document.documentHash = canonicalHash(documentMaterial(document));
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, this.filePath);
  }

  private async update(approvalHash: string, mutate: (record: FundingRecord) => void): Promise<TradeLayerAdminFundingApprovalView> {
    return this.serialize(async () => {
      const document = await this.read();
      const record = document.records[approvalHash];
      if (!record) throw new IntegrationBoundaryError("signer_broker_error", "Admin funding candidate was not found");
      mutate(record);
      record.recordHash = canonicalHash(recordMaterial(record));
      this.validateRecord(record);
      await this.write(document);
      return approvalView(record);
    });
  }

  async create(candidate: PrivateFundingCandidate, now = new Date()): Promise<TradeLayerAdminFundingApprovalView> {
    return this.serialize(async () => {
      validatePrivateCandidate(candidate, this.expectedPolicyFingerprint, now);
      const document = await this.read();
      const approvalHash = candidate.publicCandidate.approvalHash;
      const existing = document.records[approvalHash];
      if (existing) return approvalView(existing, now);
      const record = {
        schema: "bitagent_tradelayer_admin_funding_record_v1" as const,
        approvalHash,
        status: "pending_approval" as const,
        candidate: structuredClone(candidate),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        recordHash: ""
      } satisfies FundingRecord;
      record.recordHash = canonicalHash(recordMaterial(record));
      document.records[approvalHash] = record;
      await this.write(document);
      return approvalView(record, now);
    });
  }

  async loadPrivate(approvalHash: string): Promise<PrivateFundingCandidate> {
    return this.serialize(async () => {
      const record = (await this.read()).records[approvalHash];
      if (!record) throw new IntegrationBoundaryError("signer_broker_error", "Admin funding candidate was not found");
      return structuredClone(record.candidate);
    });
  }

  async status(approvalHash: string, now = new Date()): Promise<TradeLayerAdminFundingApprovalView> {
    return this.serialize(async () => {
      const record = (await this.read()).records[approvalHash];
      if (!record) throw new IntegrationBoundaryError("signer_broker_error", "Admin funding candidate was not found");
      return approvalView(record, now);
    });
  }

  async markExecutionRequested(approvalHash: string, now = new Date()): Promise<void> {
    await this.update(approvalHash, (record) => {
      if (record.status !== "pending_approval") throw new IntegrationBoundaryError("signer_broker_error", "Only pending admin funding can execute");
      if (Date.parse(record.candidate.publicCandidate.request.expiresAt) <= now.getTime()) {
        throw new IntegrationBoundaryError("signer_broker_error", "Admin funding approval expired");
      }
      record.status = "execution_requested";
      record.updatedAt = now.toISOString();
    });
  }

  async markCancelled(approvalHash: string, now = new Date()): Promise<TradeLayerAdminFundingApprovalView> {
    return this.update(approvalHash, (record) => {
      if (record.status !== "pending_approval") throw new IntegrationBoundaryError("signer_broker_error", "Only pending admin funding can be cancelled");
      record.status = "cancelled";
      record.updatedAt = now.toISOString();
    });
  }

  async markResult(approvalHash: string, result: FundingResult, now = new Date()): Promise<TradeLayerAdminFundingApprovalView> {
    return this.update(approvalHash, (record) => {
      if (!["execution_requested", "submission_unknown", "submitted", "mempool"].includes(record.status)) {
        throw new IntegrationBoundaryError("signer_broker_error", "Admin funding result transition is invalid");
      }
      record.status = result.status;
      record.result = structuredClone(result);
      delete record.failure;
      record.updatedAt = now.toISOString();
    });
  }

  async markFailure(approvalHash: string, failure: FundingFailure, now = new Date()): Promise<TradeLayerAdminFundingApprovalView> {
    return this.update(approvalHash, (record) => {
      if (record.status !== "execution_requested" && record.status !== "submission_unknown") {
        throw new IntegrationBoundaryError("signer_broker_error", "Admin funding failure transition is invalid");
      }
      record.status = failure.broadcastMayHaveOccurred ? "submission_unknown" : "failed_released";
      record.failure = structuredClone(failure);
      record.updatedAt = now.toISOString();
    });
  }
}

export class TradeLayerAdminFundingOperator {
  constructor(
    private readonly candidateBroker: TradeLayerAdminFundingCandidateBroker,
    private readonly executionBroker: TradeLayerAdminFundingExecutionBroker,
    private readonly store: FileTradeLayerAdminFundingStore
  ) {}

  async prepare(request: TradeLayerAdminFundingRequest, now = new Date()): Promise<TradeLayerAdminFundingApprovalView> {
    const candidate = await this.candidateBroker.preparePrivate(request, now);
    try {
      return await this.store.create(candidate, now);
    } catch (error) {
      await this.candidateBroker.cancelPrivate(candidate, now);
      throw error;
    }
  }

  status(approvalHash: string, now = new Date()): Promise<TradeLayerAdminFundingApprovalView> {
    return this.store.status(approvalHash, now);
  }

  async cancel(approvalHash: string, now = new Date()): Promise<TradeLayerAdminFundingApprovalView> {
    const view = await this.store.status(approvalHash, now);
    if (view.status !== "pending_approval") throw new IntegrationBoundaryError("signer_broker_error", "Only pending admin funding can be cancelled");
    const candidate = await this.store.loadPrivate(approvalHash);
    await this.candidateBroker.cancelPrivate(candidate, now);
    return this.store.markCancelled(approvalHash, now);
  }

  async approveAndExecute(approvalHash: string, now = new Date()): Promise<TradeLayerAdminFundingApprovalView> {
    const view = await this.store.status(approvalHash, now);
    if (view.status !== "pending_approval" || view.approval.expired) {
      throw new IntegrationBoundaryError("signer_broker_error", "Only a current pending admin funding approval can execute");
    }
    const candidate = await this.store.loadPrivate(approvalHash);
    await this.store.markExecutionRequested(approvalHash, now);
    try {
      return await this.store.markResult(approvalHash, await this.executionBroker.execute(candidate, approvalHash, now), now);
    } catch (error) {
      if (error instanceof FundingExecutionError) {
        await this.store.markFailure(approvalHash, {
          message: error.message,
          broadcastMayHaveOccurred: error.broadcastMayHaveOccurred,
          inputLockDisposition: error.inputLockDisposition,
          signingPerformed: error.signingPerformed,
          failedAt: now.toISOString()
        }, now);
      }
      throw error;
    }
  }

  async reconcile(approvalHash: string, now = new Date()): Promise<TradeLayerAdminFundingApprovalView> {
    const view = await this.store.status(approvalHash, now);
    if (!["execution_requested", "submission_unknown", "submitted", "mempool"].includes(view.status)) {
      throw new IntegrationBoundaryError("recovery_error", "Admin funding state is not eligible for reconciliation");
    }
    const candidate = await this.store.loadPrivate(approvalHash);
    return this.store.markResult(approvalHash, await this.executionBroker.reconcile(candidate, now), now);
  }
}
