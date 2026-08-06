import type { ReserveIntakePlan } from "../launch/reserveIntake.js";
import { verifyReserveIntakePlan } from "../launch/reserveIntake.js";
import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import type { BitcoinCoreBrokerRpc } from "./types.js";

type Outpoint = { txid: string; vout: number };

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
        hex?: string;
        address?: string;
        addresses?: string[];
      };
    }>;
  };
};

type SpendableUtxo = Outpoint & {
  amount?: number;
  spendable?: boolean;
  solvable?: boolean;
  safe?: boolean;
};

type DecodedOutput = NonNullable<NonNullable<DecodedPsbt["tx"]>["vout"]>[number];

export type ReserveIntakeBrokerRequest = {
  schema: "bitagent_reserve_intake_broker_request_v1";
  requestId: string;
  network: "testnet4";
  wallet: string;
  senderAddress: string;
  policyFingerprint: string;
  maxFeeSats: string;
  expiresAt: string;
  plan: ReserveIntakePlan;
  requestHash: string;
};

export type PreparedReserveIntakeCandidate = {
  schema: "bitagent_reserve_intake_candidate_v1";
  request: ReserveIntakeBrokerRequest;
  preparedAt: string;
  unsignedTxid: string;
  unsignedPsbtHash: string;
  feeSats: string;
  inputUtxos: Array<Outpoint & { valueSats: string; address: string }>;
  reserveOutput: { vout: 0; address: string; scriptPubKeyHex: string; valueSats: string };
  dataOutput: { vout: 1; payloadHex: string; payloadBytes: number };
  changeOutput: { vout: 2; address: string; valueSats: string };
  approvalHash: string;
};

export type ReserveIntakeCancellationReceipt = {
  schema: "bitagent_reserve_intake_cancellation_v1";
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
    throw new IntegrationBoundaryError("signer_broker_error", `Decoded reserve PSBT is missing ${label}`);
  }
  return BigInt(Math.round(Number(value) * 100_000_000));
}

function satsToBtc(value: string): number {
  const sats = BigInt(value);
  if (sats > 2_100_000_000_000_000n) {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve amount exceeds Bitcoin's maximum supply");
  }
  return Number(sats) / 100_000_000;
}

function outputAddress(output: DecodedOutput): string | undefined {
  return output.scriptPubKey?.address || output.scriptPubKey?.addresses?.[0];
}

function payloadFromAsm(asm?: string): string | undefined {
  return asm?.split(/\s+/).find((token) => /^[a-f0-9]+$/i.test(token) && token.length % 2 === 0)?.toLowerCase();
}

function outpointKey(outpoint: Outpoint): string {
  return `${outpoint.txid}:${outpoint.vout}`;
}

function requestCore(request: ReserveIntakeBrokerRequest) {
  const { requestHash: _requestHash, ...core } = request;
  return core;
}

function candidateApprovalMaterial(candidate: PreparedReserveIntakeCandidate) {
  return {
    requestHash: candidate.request.requestHash,
    preparedAt: candidate.preparedAt,
    unsignedTxid: candidate.unsignedTxid,
    unsignedPsbtHash: candidate.unsignedPsbtHash,
    feeSats: candidate.feeSats,
    inputUtxos: candidate.inputUtxos,
    reserveOutput: candidate.reserveOutput,
    dataOutput: candidate.dataOutput,
    changeOutput: candidate.changeOutput
  };
}

function validateRequest(
  request: ReserveIntakeBrokerRequest,
  expectedPolicyFingerprint: string,
  now: Date,
  allowExpired = false
): void {
  if (request.schema !== "bitagent_reserve_intake_broker_request_v1" || request.network !== "testnet4") {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake request must target Bitcoin testnet4");
  }
  if (canonicalHash(requestCore(request)) !== request.requestHash) {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake request fingerprint mismatch");
  }
  if (request.policyFingerprint !== expectedPolicyFingerprint) {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake policy fingerprint mismatch");
  }
  if (!verifyReserveIntakePlan(request.plan)) {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake plan failed deterministic verification");
  }
  if (request.plan.network !== "bitcoin-testnet4" || request.plan.walletAddress !== request.senderAddress) {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake plan does not match the approved sender");
  }
  const expiresAt = Date.parse(request.expiresAt);
  if (!Number.isFinite(expiresAt) || (!allowExpired && expiresAt <= now.getTime())) {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake request expired");
  }
  if (!/^[1-9][0-9]*$/.test(request.maxFeeSats)) {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake request has an invalid fee cap");
  }
}

function validateCandidate(
  candidate: PreparedReserveIntakeCandidate,
  expectedPolicyFingerprint: string,
  now: Date
): Outpoint[] {
  validateRequest(candidate.request, expectedPolicyFingerprint, now, true);
  if (candidate.schema !== "bitagent_reserve_intake_candidate_v1") {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake candidate has an invalid schema");
  }
  if (canonicalHash(candidateApprovalMaterial(candidate)) !== candidate.approvalHash) {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake candidate approval fingerprint mismatch");
  }
  if (!/^[a-f0-9]{64}$/i.test(candidate.unsignedTxid) || !/^[0-9]+$/.test(candidate.feeSats)) {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake candidate has invalid transaction metadata");
  }
  if (BigInt(candidate.feeSats) > BigInt(candidate.request.maxFeeSats) || candidate.inputUtxos.length === 0) {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake candidate exceeds its fee cap or has no inputs");
  }
  return candidate.inputUtxos.map(({ txid, vout }) => ({ txid, vout }));
}

async function releaseInputLocks(rpc: BitcoinCoreBrokerRpc, inputOutpoints: Outpoint[]): Promise<void> {
  if (inputOutpoints.length === 0) return;
  if (!await rpc.call<boolean>("lockunspent", true, inputOutpoints)) {
    throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core refused to release reserve candidate inputs");
  }
  const locked = await rpc.call<Outpoint[]>("listlockunspent");
  const lockedKeys = new Set(locked.map(outpointKey));
  const remaining = inputOutpoints.filter((outpoint) => lockedKeys.has(outpointKey(outpoint)));
  if (remaining.length > 0) {
    throw new IntegrationBoundaryError("signer_broker_error", "Reserve candidate inputs remain locked after cancellation", { remaining });
  }
}

export function createReserveIntakeBrokerRequest(input: {
  requestId: string;
  wallet: string;
  senderAddress: string;
  policyFingerprint: string;
  maxFeeSats: string;
  expiresAt: string;
  plan: ReserveIntakePlan;
}): ReserveIntakeBrokerRequest {
  const core = {
    schema: "bitagent_reserve_intake_broker_request_v1" as const,
    requestId: input.requestId,
    network: "testnet4" as const,
    wallet: input.wallet,
    senderAddress: input.senderAddress,
    policyFingerprint: input.policyFingerprint,
    maxFeeSats: input.maxFeeSats,
    expiresAt: input.expiresAt,
    plan: input.plan
  };
  return { ...core, requestHash: canonicalHash(core) };
}

/** Candidate-only broker: intentionally exposes no signing or broadcast method. */
export class ReserveIntakeCandidateBroker {
  constructor(
    private readonly rpc: BitcoinCoreBrokerRpc,
    private readonly expectedPolicyFingerprint: string
  ) {}

  private async validateNetwork(): Promise<void> {
    const info = await this.rpc.call<{ chain?: string }>("getblockchaininfo");
    if (info.chain !== "testnet4") {
      throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core reserve broker is not connected to testnet4", info);
    }
  }

  async prepare(request: ReserveIntakeBrokerRequest, now: Date = new Date()): Promise<PreparedReserveIntakeCandidate> {
    validateRequest(request, this.expectedPolicyFingerprint, now);
    await this.validateNetwork();
    const senderInfo = await this.rpc.call<{ ismine?: boolean; iswatchonly?: boolean }>("getaddressinfo", request.senderAddress);
    if (!senderInfo.ismine || senderInfo.iswatchonly) {
      throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake sender is not spendable by the broker wallet");
    }
    const amountSats = BigInt(request.plan.amountSats);
    const minimumInputSats = amountSats + BigInt(request.maxFeeSats) + 546n;
    const candidates = await this.rpc.call<SpendableUtxo[]>("listunspent", 1, 9_999_999, [request.senderAddress], false);
    const selected = [...candidates]
      .filter((candidate) =>
        typeof candidate.txid === "string" && /^[a-f0-9]{64}$/i.test(candidate.txid) &&
        Number.isInteger(candidate.vout) && Number.isFinite(candidate.amount) &&
        btcToSats(candidate.amount, "candidate input amount") >= minimumInputSats &&
        candidate.spendable !== false && candidate.solvable !== false && candidate.safe !== false
      )
      .sort((left, right) => Number(left.amount) - Number(right.amount) || left.txid.localeCompare(right.txid))[0];
    if (!selected) {
      throw new IntegrationBoundaryError("signer_broker_error", "Approved sender has no confirmed input large enough for reserve amount, fee cap, and change");
    }
    const selectedOutpoint = { txid: selected.txid, vout: selected.vout };
    let lockReserved = false;
    try {
      const funded = await this.rpc.call<{ psbt?: string }>(
        "walletcreatefundedpsbt",
        [selectedOutpoint],
        [
          { [request.plan.reserve.address]: satsToBtc(request.plan.amountSats) },
          { data: request.plan.tradeLayer.payloadHex }
        ],
        0,
        {
          add_inputs: false,
          fee_rate: 2,
          lockUnspents: true,
          include_unsafe: false,
          changeAddress: request.senderAddress,
          changePosition: 2
        },
        true
      );
      lockReserved = true;
      if (!funded.psbt) throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core did not return a reserve intake PSBT");
      const decoded = await this.rpc.call<DecodedPsbt>("decodepsbt", funded.psbt);
      const outputs = decoded.tx?.vout || [];
      if (outputs.length !== 3) {
        throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake PSBT must contain exactly reserve, data, and change outputs");
      }
      const [reserve, data, change] = outputs;
      if (
        reserve?.n !== 0 || outputAddress(reserve) !== request.plan.reserve.address ||
        reserve.scriptPubKey?.hex?.toLowerCase() !== request.plan.reserve.scriptPubKeyHex.toLowerCase() ||
        btcToSats(reserve.value, "reserve output amount") !== amountSats
      ) {
        throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake PSBT vout 0 does not match the approved UTXORef reserve");
      }
      if (
        data?.n !== 1 || data.scriptPubKey?.type !== "nulldata" || btcToSats(data.value, "data output amount") !== 0n ||
        payloadFromAsm(data.scriptPubKey.asm) !== request.plan.tradeLayer.payloadHex.toLowerCase()
      ) {
        throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake PSBT vout 1 does not match the approved TradeLayer tx11 payload");
      }
      const changeAddress = change && outputAddress(change);
      if (change?.n !== 2 || changeAddress !== request.senderAddress || btcToSats(change.value, "change output amount") <= 0n) {
        throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake PSBT vout 2 is not positive change to the approved sender");
      }
      const changeInfo = await this.rpc.call<{ ismine?: boolean; iswatchonly?: boolean }>("getaddressinfo", changeAddress);
      if (!changeInfo.ismine || changeInfo.iswatchonly) {
        throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake change is not controlled by the broker wallet");
      }
      const vins = decoded.tx?.vin || [];
      const inputUtxos = (decoded.inputs || []).map((psbtInput, index) => {
        const vin = vins[index];
        const address = psbtInput.witness_utxo?.scriptPubKey?.address || psbtInput.witness_utxo?.scriptPubKey?.addresses?.[0];
        if (!vin?.txid || !Number.isInteger(vin.vout) || !address) {
          throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake PSBT input lacks a verifiable outpoint or address");
        }
        return {
          txid: vin.txid,
          vout: vin.vout,
          valueSats: btcToSats(psbtInput.witness_utxo?.amount, "input amount").toString(),
          address
        };
      });
      if (
        inputUtxos.length !== 1 || inputUtxos[0]?.txid !== selected.txid || inputUtxos[0]?.vout !== selected.vout ||
        inputUtxos[0]?.address !== request.senderAddress
      ) {
        throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake PSBT inputs differ from the exact approved wallet input");
      }
      const feeSats = btcToSats(decoded.fee, "fee");
      if (feeSats > BigInt(request.maxFeeSats)) {
        throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake PSBT exceeds its exact fee cap");
      }
      if (!decoded.tx?.txid || !/^[a-f0-9]{64}$/i.test(decoded.tx.txid)) {
        throw new IntegrationBoundaryError("signer_broker_error", "Reserve intake PSBT lacks a deterministic unsigned transaction id");
      }
      const candidate = {
        schema: "bitagent_reserve_intake_candidate_v1" as const,
        request,
        preparedAt: now.toISOString(),
        unsignedTxid: decoded.tx.txid,
        unsignedPsbtHash: canonicalHash(funded.psbt),
        feeSats: feeSats.toString(),
        inputUtxos,
        reserveOutput: {
          vout: 0 as const,
          address: request.plan.reserve.address,
          scriptPubKeyHex: request.plan.reserve.scriptPubKeyHex,
          valueSats: amountSats.toString()
        },
        dataOutput: {
          vout: 1 as const,
          payloadHex: request.plan.tradeLayer.payloadHex,
          payloadBytes: request.plan.tradeLayer.payloadBytes
        },
        changeOutput: {
          vout: 2 as const,
          address: request.senderAddress,
          valueSats: btcToSats(change.value, "change output amount").toString()
        },
        approvalHash: ""
      } satisfies PreparedReserveIntakeCandidate;
      candidate.approvalHash = canonicalHash(candidateApprovalMaterial(candidate));
      return candidate;
    } catch (error) {
      if (lockReserved) {
        try {
          await releaseInputLocks(this.rpc, [selectedOutpoint]);
        } catch (cleanupError) {
          throw new IntegrationBoundaryError("signer_broker_error", "Reserve preparation failed and its input lock could not be released", {
            preparationError: error instanceof Error ? error.message : String(error),
            cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          });
        }
      }
      throw error;
    }
  }

  async cancelPrepared(
    candidate: PreparedReserveIntakeCandidate,
    now: Date = new Date()
  ): Promise<ReserveIntakeCancellationReceipt> {
    const inputOutpoints = validateCandidate(candidate, this.expectedPolicyFingerprint, now);
    await this.validateNetwork();
    await releaseInputLocks(this.rpc, inputOutpoints);
    const core = {
      schema: "bitagent_reserve_intake_cancellation_v1" as const,
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
