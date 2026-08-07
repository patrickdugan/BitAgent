import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import type { BitcoinCoreBrokerRpc } from "./types.js";

type Outpoint = { txid: string; vout: number };

type SpendableUtxo = Outpoint & {
  amount?: number;
  spendable?: boolean;
  solvable?: boolean;
  safe?: boolean;
};

type DecodedPsbt = {
  fee?: number;
  inputs?: Array<{
    witness_utxo?: {
      amount?: number;
      scriptPubKey?: { address?: string; addresses?: string[] };
    };
  }>;
  tx?: {
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
};

export type TradeLayerActivationPayload = {
  txType: 0;
  activatedTxTypes: [11];
  codeHash: string;
  payloadUtf8: string;
  payloadHex: string;
  payloadBytes: number;
};

export type TradeLayerActivationBrokerRequest = {
  schema: "bitagent_tradelayer_activation_broker_request_v1";
  network: "testnet4";
  requestId: string;
  wallet: string;
  senderAddress: string;
  releaseId: string;
  releaseStatus: "candidate_not_deployed";
  deploymentCommit: string;
  sourceVerificationHash: string;
  activation: TradeLayerActivationPayload;
  policyFingerprint: string;
  maxFeeSats: string;
  expiresAt: string;
  requestHash: string;
};

export type PreparedTradeLayerActivationCandidate = {
  schema: "bitagent_tradelayer_activation_candidate_v1";
  authority: "wallet_user";
  effect: "none_candidate_only";
  request: TradeLayerActivationBrokerRequest;
  preparedAt: string;
  unsignedTxid: string;
  unsignedPsbtHash: string;
  feeSats: string;
  inputUtxos: Array<Outpoint & { valueSats: string; address: string }>;
  dataOutput: { vout: 0; valueSats: "0"; payloadHex: string; payloadBytes: number };
  changeOutput: { vout: 1; address: string; valueSats: string };
  approvalRequired: true;
  signingPerformed: false;
  broadcastPerformed: false;
  approvalHash: string;
};

export type TradeLayerActivationCancellationReceipt = {
  schema: "bitagent_tradelayer_activation_cancellation_v1";
  status: "cancelled_after_candidate_test";
  requestHash: string;
  approvalHash: string;
  cancelledAt: string;
  inputOutpoints: Outpoint[];
  inputLockReleased: true;
  signingPerformed: false;
  broadcastPerformed: false;
  receiptHash: string;
};

function btcToSats(value: number | undefined, label: string): bigint {
  if (!Number.isFinite(value)) {
    throw new IntegrationBoundaryError("signer_broker_error", `Decoded activation PSBT is missing ${label}`);
  }
  return BigInt(Math.round(Number(value) * 100_000_000));
}

function outputAddress(output: NonNullable<NonNullable<DecodedPsbt["tx"]>["vout"]>[number]): string | undefined {
  return output.scriptPubKey?.address || output.scriptPubKey?.addresses?.[0];
}

function payloadFromAsm(asm?: string): string | undefined {
  return asm?.split(/\s+/).find((token) => /^[a-f0-9]+$/i.test(token) && token.length % 2 === 0)?.toLowerCase();
}

function outpointKey(outpoint: Outpoint): string {
  return `${outpoint.txid}:${outpoint.vout}`;
}

export function buildTradeLayerTx11ActivationPayload(codeHash: string): TradeLayerActivationPayload {
  const normalized = codeHash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer activation code hash must be 32-byte lowercase hex");
  }
  const payloadUtf8 = `tl011,${BigInt(`0x${normalized}`).toString(36)}`;
  const payload = Buffer.from(payloadUtf8, "ascii");
  if (payload.length > 80) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer activation payload exceeds the Bitcoin data-carrier limit");
  }
  return {
    txType: 0,
    activatedTxTypes: [11],
    codeHash: normalized,
    payloadUtf8,
    payloadHex: payload.toString("hex"),
    payloadBytes: payload.length
  };
}

function requestCore(request: TradeLayerActivationBrokerRequest) {
  const { requestHash: _requestHash, ...core } = request;
  return core;
}

function candidateApprovalMaterial(candidate: PreparedTradeLayerActivationCandidate) {
  return {
    requestHash: candidate.request.requestHash,
    preparedAt: candidate.preparedAt,
    unsignedTxid: candidate.unsignedTxid,
    unsignedPsbtHash: candidate.unsignedPsbtHash,
    feeSats: candidate.feeSats,
    inputUtxos: candidate.inputUtxos,
    dataOutput: candidate.dataOutput,
    changeOutput: candidate.changeOutput
  };
}

function validateRequest(
  request: TradeLayerActivationBrokerRequest,
  expectedPolicyFingerprint: string,
  now: Date,
  allowExpired = false
): void {
  if (request.schema !== "bitagent_tradelayer_activation_broker_request_v1" || request.network !== "testnet4") {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer activation request must target Bitcoin testnet4");
  }
  if (canonicalHash(requestCore(request)) !== request.requestHash) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer activation request fingerprint mismatch");
  }
  if (request.policyFingerprint !== expectedPolicyFingerprint) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer activation policy fingerprint mismatch");
  }
  const expiresAt = Date.parse(request.expiresAt);
  if (!Number.isFinite(expiresAt) || (!allowExpired && expiresAt <= now.getTime())) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer activation request expired");
  }
  if (
    request.releaseStatus !== "candidate_not_deployed" ||
    !request.releaseId.trim() ||
    !/^[a-f0-9]{40}$/.test(request.deploymentCommit) ||
    !/^[a-f0-9]{64}$/.test(request.sourceVerificationHash) ||
    !/^[1-9][0-9]*$/.test(request.maxFeeSats) ||
    !request.wallet.trim() ||
    !request.senderAddress.trim()
  ) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer activation release, wallet, or fee identity is invalid");
  }
  const exact = buildTradeLayerTx11ActivationPayload(request.activation.codeHash);
  if (canonicalHash(exact) !== canonicalHash(request.activation)) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer activation payload differs from the exact tx11 release payload");
  }
}

function validateCandidate(
  candidate: PreparedTradeLayerActivationCandidate,
  expectedPolicyFingerprint: string,
  now: Date
): Outpoint[] {
  validateRequest(candidate.request, expectedPolicyFingerprint, now, true);
  if (
    candidate.schema !== "bitagent_tradelayer_activation_candidate_v1" ||
    candidate.authority !== "wallet_user" ||
    candidate.effect !== "none_candidate_only" ||
    candidate.approvalRequired !== true ||
    candidate.signingPerformed !== false ||
    candidate.broadcastPerformed !== false
  ) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer activation candidate authority boundary is invalid");
  }
  if (canonicalHash(candidateApprovalMaterial(candidate)) !== candidate.approvalHash) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer activation candidate approval fingerprint mismatch");
  }
  if (
    !/^[a-f0-9]{64}$/.test(candidate.unsignedTxid) ||
    !/^[0-9]+$/.test(candidate.feeSats) ||
    BigInt(candidate.feeSats) > BigInt(candidate.request.maxFeeSats) ||
    candidate.inputUtxos.length !== 1
  ) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer activation candidate transaction metadata is invalid");
  }
  return candidate.inputUtxos.map(({ txid, vout }) => ({ txid, vout }));
}

async function releaseInputLocks(rpc: BitcoinCoreBrokerRpc, outpoints: Outpoint[]): Promise<void> {
  if (!outpoints.length) return;
  if (!await rpc.call<boolean>("lockunspent", true, outpoints)) {
    throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core refused to release activation candidate inputs");
  }
  const locked = await rpc.call<Outpoint[]>("listlockunspent");
  const lockedKeys = new Set(locked.map(outpointKey));
  const remaining = outpoints.filter((outpoint) => lockedKeys.has(outpointKey(outpoint)));
  if (remaining.length) {
    throw new IntegrationBoundaryError("signer_broker_error", "Activation candidate inputs remain locked after cancellation", { remaining });
  }
}

export function createTradeLayerActivationBrokerRequest(input: {
  requestId: string;
  wallet: string;
  senderAddress: string;
  releaseId: string;
  deploymentCommit: string;
  codeHash: string;
  sourceVerificationHash: string;
  policyFingerprint: string;
  maxFeeSats: string;
  expiresAt: string;
}): TradeLayerActivationBrokerRequest {
  const core = {
    schema: "bitagent_tradelayer_activation_broker_request_v1" as const,
    network: "testnet4" as const,
    requestId: input.requestId,
    wallet: input.wallet,
    senderAddress: input.senderAddress,
    releaseId: input.releaseId,
    releaseStatus: "candidate_not_deployed" as const,
    deploymentCommit: input.deploymentCommit,
    sourceVerificationHash: input.sourceVerificationHash,
    activation: buildTradeLayerTx11ActivationPayload(input.codeHash),
    policyFingerprint: input.policyFingerprint,
    maxFeeSats: input.maxFeeSats,
    expiresAt: input.expiresAt
  };
  return { ...core, requestHash: canonicalHash(core) };
}

/** Candidate-only simulation broker. It intentionally has no signing or broadcast method. */
export class TradeLayerActivationCandidateBroker {
  constructor(
    private readonly rpc: BitcoinCoreBrokerRpc,
    private readonly expectedPolicyFingerprint: string
  ) {}

  private async validateNetwork(): Promise<void> {
    const info = await this.rpc.call<{ chain?: string; initialblockdownload?: boolean; blocks?: number; headers?: number }>(
      "getblockchaininfo"
    );
    if (
      info.chain !== "testnet4" ||
      info.initialblockdownload === true ||
      !Number.isSafeInteger(info.blocks) ||
      !Number.isSafeInteger(info.headers) ||
      info.blocks !== info.headers
    ) {
      throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core activation broker requires a fully synchronized testnet4 node", info);
    }
  }

  async prepare(
    request: TradeLayerActivationBrokerRequest,
    now: Date = new Date()
  ): Promise<PreparedTradeLayerActivationCandidate> {
    validateRequest(request, this.expectedPolicyFingerprint, now);
    await this.validateNetwork();
    const sender = await this.rpc.call<{ ismine?: boolean; iswatchonly?: boolean }>("getaddressinfo", request.senderAddress);
    if (!sender.ismine || sender.iswatchonly) {
      throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer activation sender is not spendable by the broker wallet");
    }
    const minimumInputSats = BigInt(request.maxFeeSats) + 546n;
    const candidates = await this.rpc.call<SpendableUtxo[]>("listunspent", 1, 9_999_999, [request.senderAddress], false);
    const selected = [...candidates]
      .filter((candidate) =>
        /^[a-f0-9]{64}$/.test(candidate.txid) &&
        Number.isInteger(candidate.vout) &&
        Number.isFinite(candidate.amount) &&
        btcToSats(candidate.amount, "candidate input amount") >= minimumInputSats &&
        candidate.spendable !== false && candidate.solvable !== false && candidate.safe !== false
      )
      .sort((left, right) => Number(left.amount) - Number(right.amount) || left.txid.localeCompare(right.txid))[0];
    if (!selected) {
      throw new IntegrationBoundaryError("signer_broker_error", "Approved sender has no confirmed input large enough for activation fee and change");
    }
    const selectedOutpoint = { txid: selected.txid, vout: selected.vout };
    let lockReserved = false;
    try {
      const funded = await this.rpc.call<{ psbt?: string }>(
        "walletcreatefundedpsbt",
        [selectedOutpoint],
        [{ data: request.activation.payloadHex }],
        0,
        {
          add_inputs: false,
          fee_rate: 2,
          lockUnspents: true,
          include_unsafe: false,
          changeAddress: request.senderAddress,
          changePosition: 1
        },
        true
      );
      lockReserved = true;
      if (!funded.psbt) {
        throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core did not return an activation PSBT");
      }
      const decoded = await this.rpc.call<DecodedPsbt>("decodepsbt", funded.psbt);
      const outputs = decoded.tx?.vout || [];
      const [data, change] = outputs;
      if (
        outputs.length !== 2 ||
        data?.n !== 0 ||
        data.scriptPubKey?.type !== "nulldata" ||
        btcToSats(data.value, "data output amount") !== 0n ||
        payloadFromAsm(data.scriptPubKey.asm) !== request.activation.payloadHex
      ) {
        throw new IntegrationBoundaryError("signer_broker_error", "Activation PSBT vout 0 does not match the exact approved tx11 payload");
      }
      const changeAddress = change && outputAddress(change);
      if (change?.n !== 1 || changeAddress !== request.senderAddress || btcToSats(change.value, "change amount") <= 0n) {
        throw new IntegrationBoundaryError("signer_broker_error", "Activation PSBT vout 1 is not positive change to the approved sender");
      }
      const changeInfo = await this.rpc.call<{ ismine?: boolean; iswatchonly?: boolean }>("getaddressinfo", changeAddress);
      if (!changeInfo.ismine || changeInfo.iswatchonly) {
        throw new IntegrationBoundaryError("signer_broker_error", "Activation change is not controlled by the broker wallet");
      }
      const vins = decoded.tx?.vin || [];
      const inputUtxos = (decoded.inputs || []).map((input, index) => {
        const vin = vins[index];
        const address = input.witness_utxo?.scriptPubKey?.address || input.witness_utxo?.scriptPubKey?.addresses?.[0];
        if (!vin?.txid || !Number.isInteger(vin.vout) || !address) {
          throw new IntegrationBoundaryError("signer_broker_error", "Activation PSBT input lacks a verifiable outpoint or address");
        }
        return {
          txid: vin.txid,
          vout: vin.vout,
          valueSats: btcToSats(input.witness_utxo?.amount, "input amount").toString(),
          address
        };
      });
      if (
        inputUtxos.length !== 1 ||
        inputUtxos[0]?.txid !== selected.txid ||
        inputUtxos[0]?.vout !== selected.vout ||
        inputUtxos[0]?.address !== request.senderAddress
      ) {
        throw new IntegrationBoundaryError("signer_broker_error", "Activation PSBT inputs differ from the exact approved wallet input");
      }
      const feeSats = btcToSats(decoded.fee, "fee");
      if (feeSats > BigInt(request.maxFeeSats)) {
        throw new IntegrationBoundaryError("signer_broker_error", "Activation PSBT exceeds its exact fee cap");
      }
      if (!decoded.tx?.txid || !/^[a-f0-9]{64}$/.test(decoded.tx.txid)) {
        throw new IntegrationBoundaryError("signer_broker_error", "Activation PSBT lacks a deterministic unsigned transaction id");
      }
      const candidate = {
        schema: "bitagent_tradelayer_activation_candidate_v1" as const,
        authority: "wallet_user" as const,
        effect: "none_candidate_only" as const,
        request,
        preparedAt: now.toISOString(),
        unsignedTxid: decoded.tx.txid,
        unsignedPsbtHash: canonicalHash(funded.psbt),
        feeSats: feeSats.toString(),
        inputUtxos,
        dataOutput: {
          vout: 0 as const,
          valueSats: "0" as const,
          payloadHex: request.activation.payloadHex,
          payloadBytes: request.activation.payloadBytes
        },
        changeOutput: {
          vout: 1 as const,
          address: request.senderAddress,
          valueSats: btcToSats(change.value, "change amount").toString()
        },
        approvalRequired: true as const,
        signingPerformed: false as const,
        broadcastPerformed: false as const,
        approvalHash: ""
      } satisfies PreparedTradeLayerActivationCandidate;
      candidate.approvalHash = canonicalHash(candidateApprovalMaterial(candidate));
      return candidate;
    } catch (error) {
      if (lockReserved) {
        try {
          await releaseInputLocks(this.rpc, [selectedOutpoint]);
        } catch (cleanupError) {
          throw new IntegrationBoundaryError("signer_broker_error", "Activation preparation failed and its input lock could not be released", {
            preparationError: error instanceof Error ? error.message : String(error),
            cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          });
        }
      }
      throw error;
    }
  }

  async cancelPrepared(
    candidate: PreparedTradeLayerActivationCandidate,
    now: Date = new Date()
  ): Promise<TradeLayerActivationCancellationReceipt> {
    const inputOutpoints = validateCandidate(candidate, this.expectedPolicyFingerprint, now);
    await this.validateNetwork();
    await releaseInputLocks(this.rpc, inputOutpoints);
    const core = {
      schema: "bitagent_tradelayer_activation_cancellation_v1" as const,
      status: "cancelled_after_candidate_test" as const,
      requestHash: candidate.request.requestHash,
      approvalHash: candidate.approvalHash,
      cancelledAt: now.toISOString(),
      inputOutpoints,
      inputLockReleased: true as const,
      signingPerformed: false as const,
      broadcastPerformed: false as const
    };
    return { ...core, receiptHash: canonicalHash(core) };
  }
}
