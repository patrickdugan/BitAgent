import type { TradeLayerTestnetArtifact } from "../economy/types.js";
import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import type {
  BitcoinCoreBrokerRpc,
  BrokerBroadcastReceipt,
  PreparedBrokerBatch,
  PreparedPsbtStep,
  TestnetBrokerRequest,
  TradeLayerPsbtStepRequest
} from "./types.js";

type DecodedPsbt = {
  fee?: number;
  inputs?: Array<{
    witness_utxo?: {
      amount?: number;
      scriptPubKey?: { address?: string; addresses?: string[] };
    };
  }>;
  tx?: {
    vin?: Array<{ txid?: string; vout?: number }>;
    vout?: Array<{
      value?: number;
      scriptPubKey?: { type?: string; asm?: string; address?: string; addresses?: string[] };
    }>;
  };
};

type SpendableUtxo = {
  txid?: string;
  vout?: number;
  amount?: number;
  spendable?: boolean;
  solvable?: boolean;
  safe?: boolean;
};

function requestMaterial(request: Omit<TestnetBrokerRequest, "requestHash">) {
  return request;
}

function validateRequest(request: TestnetBrokerRequest, expectedPolicyFingerprint: string, now: Date): void {
  const { requestHash: _ignored, ...material } = request;
  if (request.schema !== "tradelayer_testnet_broker_request_v1" || request.network !== "testnet4") {
    throw new IntegrationBoundaryError("signer_broker_error", "Broker request must target Bitcoin testnet4");
  }
  if (canonicalHash(material) !== request.requestHash) {
    throw new IntegrationBoundaryError("signer_broker_error", "Broker request fingerprint mismatch");
  }
  if (request.policyFingerprint !== expectedPolicyFingerprint) {
    throw new IntegrationBoundaryError("signer_broker_error", "Broker policy fingerprint mismatch");
  }
  if (!Number.isFinite(Date.parse(request.expiresAt)) || Date.parse(request.expiresAt) <= now.getTime()) {
    throw new IntegrationBoundaryError("signer_broker_error", "Broker request expired");
  }
  if (!/^[1-9][0-9]*$/.test(request.maxTotalFeeSats) || request.steps.length === 0) {
    throw new IntegrationBoundaryError("signer_broker_error", "Broker request has invalid fee cap or no steps");
  }
  if (!request.senderAddress.trim()) throw new IntegrationBoundaryError("signer_broker_error", "Broker sender address is required");
  if (canonicalHash(request.steps) !== request.planHash) {
    throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer plan hash mismatch");
  }
  for (const step of request.steps) {
    const payload = Buffer.from(step.payloadHex, "hex").toString("utf8");
    if (step.txType !== 5 || step.phase !== "vwap-trade" || !payload.startsWith("tl5")) {
      throw new IntegrationBoundaryError("signer_broker_error", "Broker request contains a non-tx5 payload", step);
    }
  }
}

function payloadFromAsm(asm?: string): string | undefined {
  return asm?.split(/\s+/).find((token) => /^[a-f0-9]+$/i.test(token) && token.length % 2 === 0)?.toLowerCase();
}

function btcToSats(value: number | undefined): bigint {
  if (!Number.isFinite(value)) throw new IntegrationBoundaryError("signer_broker_error", "Decoded PSBT is missing its fee");
  return BigInt(Math.round(Number(value) * 100_000_000));
}

async function validateDecodedPsbt(input: {
  rpc: BitcoinCoreBrokerRpc;
  decoded: DecodedPsbt;
  expectedPayloadHex: string;
  expectedSenderAddress: string;
}): Promise<{
  feeSats: bigint;
  inputUtxos: PreparedPsbtStep["inputUtxos"];
  inputAddresses: string[];
  walletChangeOutputs: PreparedPsbtStep["walletChangeOutputs"];
  walletChangeAddresses: string[];
}> {
  const outputs = input.decoded.tx?.vout || [];
  const dataOutputs = outputs.filter((output) => output.scriptPubKey?.type === "nulldata");
  if (dataOutputs.length !== 1 || payloadFromAsm(dataOutputs[0]?.scriptPubKey?.asm) !== input.expectedPayloadHex.toLowerCase()) {
    throw new IntegrationBoundaryError("signer_broker_error", "PSBT does not contain exactly the approved TradeLayer payload");
  }
  const vins = input.decoded.tx?.vin || [];
  const inputUtxos = (input.decoded.inputs || []).map((psbtInput, index) => {
    const script = psbtInput.witness_utxo?.scriptPubKey;
    const address = script?.address || script?.addresses?.[0];
    if (!address) throw new IntegrationBoundaryError("signer_broker_error", "PSBT input lacks a verifiable witness address");
    const vin = vins[index];
    if (!vin?.txid || !Number.isInteger(vin.vout) || vin.vout! < 0) {
      throw new IntegrationBoundaryError("signer_broker_error", "PSBT input lacks a verifiable funding outpoint");
    }
    return {
      txid: vin.txid,
      vout: vin.vout!,
      valueSats: btcToSats(psbtInput.witness_utxo?.amount).toString(),
      address
    };
  });
  const inputAddresses = inputUtxos.map((utxo) => utxo.address);
  if (inputAddresses.length === 0 || inputAddresses.some((address) => address !== input.expectedSenderAddress)) {
    throw new IntegrationBoundaryError("signer_broker_error", "PSBT inputs are not exclusively controlled by the approved TradeLayer sender", {
      expected: input.expectedSenderAddress,
      observed: inputAddresses
    });
  }
  const walletChangeOutputs: PreparedPsbtStep["walletChangeOutputs"] = [];
  for (const output of outputs.filter((candidate) => candidate.scriptPubKey?.type !== "nulldata")) {
    const address = output.scriptPubKey?.address || output.scriptPubKey?.addresses?.[0];
    if (!address) throw new IntegrationBoundaryError("signer_broker_error", "PSBT contains an unrecognized non-data output");
    const info = await input.rpc.call<{ ismine?: boolean; iswatchonly?: boolean }>("getaddressinfo", address);
    if (!info.ismine || info.iswatchonly || address !== input.expectedSenderAddress) {
      throw new IntegrationBoundaryError("signer_broker_error", "PSBT sends value to a non-wallet destination", { address });
    }
    walletChangeOutputs.push({ address, valueSats: btcToSats(output.value).toString() });
  }
  return {
    feeSats: btcToSats(input.decoded.fee),
    inputUtxos,
    inputAddresses,
    walletChangeOutputs,
    walletChangeAddresses: walletChangeOutputs.map((output) => output.address)
  };
}

export function createTestnetBrokerRequest(input: {
  artifact: TradeLayerTestnetArtifact;
  requestId: string;
    wallet: string;
    senderAddress?: string;
  policyFingerprint: string;
  maxTotalFeeSats: string;
  expiresAt: string;
}): TestnetBrokerRequest {
  const steps = input.artifact.steps.flatMap<TradeLayerPsbtStepRequest>((candidate) => {
    const step = candidate as TradeLayerTestnetArtifact["steps"][number] & {
      txType?: number;
      tradePrintId?: string;
      side?: string;
      payloadHex?: string;
    };
    if (step.phase !== "vwap-trade") return [];
    if (
      step.txType !== 5 ||
      !step.tradePrintId ||
      (step.side !== "sell-tlbtc" && step.side !== "sell-tlusd") ||
      !step.payloadHex
    ) {
      throw new IntegrationBoundaryError("signer_broker_error", "TradeLayer artifact contains an invalid VWAP step", step);
    }
    return [{
      label: step.label,
      phase: "vwap-trade",
      txType: 5,
      tradePrintId: step.tradePrintId,
      side: step.side,
      payloadHex: step.payloadHex.toLowerCase()
    }];
  });
  const material = requestMaterial({
    schema: "tradelayer_testnet_broker_request_v1",
    requestId: input.requestId,
    network: "testnet4",
    wallet: input.wallet,
    senderAddress: input.senderAddress || input.artifact.adminAddress,
    policyFingerprint: input.policyFingerprint,
    maxTotalFeeSats: input.maxTotalFeeSats,
    expiresAt: input.expiresAt,
    planHash: canonicalHash(steps),
    steps
  });
  return { ...material, requestHash: canonicalHash(material) };
}

export class TestnetSignerBroker {
  constructor(
    private readonly rpc: BitcoinCoreBrokerRpc,
    private readonly expectedPolicyFingerprint: string
  ) {}

  private async validateNetwork(): Promise<void> {
    const info = await this.rpc.call<{ chain?: string }>("getblockchaininfo");
    if (info.chain !== "testnet4") {
      throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core broker is not connected to testnet4", info);
    }
  }

  async prepare(request: TestnetBrokerRequest, now: Date = new Date()): Promise<PreparedBrokerBatch> {
    validateRequest(request, this.expectedPolicyFingerprint, now);
    await this.validateNetwork();
    const senderInfo = await this.rpc.call<{ ismine?: boolean; iswatchonly?: boolean }>("getaddressinfo", request.senderAddress);
    if (!senderInfo.ismine || senderInfo.iswatchonly) {
      throw new IntegrationBoundaryError("signer_broker_error", "Approved TradeLayer sender is not spendable by the broker wallet");
    }
    const preparedSteps: PreparedPsbtStep[] = [];
    let totalFeeSats = 0n;

    for (const step of request.steps) {
      const candidates = await this.rpc.call<SpendableUtxo[]>(
        "listunspent",
        1,
        9_999_999,
        [request.senderAddress],
        false
      );
      const selected = [...candidates]
        .filter((candidate) =>
          typeof candidate.txid === "string" &&
          Number.isInteger(candidate.vout) &&
          Number.isFinite(candidate.amount) &&
          candidate.spendable !== false &&
          candidate.solvable !== false &&
          candidate.safe !== false
        )
        .sort((left, right) =>
          Number(right.amount) - Number(left.amount) ||
          String(left.txid).localeCompare(String(right.txid)) ||
          Number(left.vout) - Number(right.vout)
        )[0];
      if (!selected?.txid || !Number.isInteger(selected.vout)) {
        throw new IntegrationBoundaryError(
          "signer_broker_error",
          "Approved TradeLayer sender has no confirmed safe spendable UTXO"
        );
      }
      const funded = await this.rpc.call<{ psbt?: string }>(
        "walletcreatefundedpsbt",
        [{ txid: selected.txid, vout: selected.vout }],
        [{ data: step.payloadHex }],
        0,
        {
          add_inputs: false,
          fee_rate: 2,
          lockUnspents: true,
          include_unsafe: false,
          changeAddress: request.senderAddress
        },
        true
      );
      if (!funded.psbt) throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core did not return a funded PSBT");
      const decoded = await this.rpc.call<DecodedPsbt>("decodepsbt", funded.psbt);
      const checked = await validateDecodedPsbt({
        rpc: this.rpc,
        decoded,
        expectedPayloadHex: step.payloadHex,
        expectedSenderAddress: request.senderAddress
      });
      totalFeeSats += checked.feeSats;
      preparedSteps.push({
        ...step,
        psbt: funded.psbt,
        unsignedPsbtHash: canonicalHash(funded.psbt),
        feeSats: checked.feeSats.toString(),
        inputUtxos: checked.inputUtxos,
        inputAddresses: checked.inputAddresses,
        walletChangeOutputs: checked.walletChangeOutputs,
        walletChangeAddresses: checked.walletChangeAddresses
      });
    }
    if (totalFeeSats > BigInt(request.maxTotalFeeSats)) {
      throw new IntegrationBoundaryError("signer_broker_error", "Prepared PSBT batch exceeds its aggregate fee cap", {
        totalFeeSats: totalFeeSats.toString(),
        maxTotalFeeSats: request.maxTotalFeeSats
      });
    }
    const preparedAt = now.toISOString();
    const approvalHash = canonicalHash({
      requestHash: request.requestHash,
      preparedAt,
      totalFeeSats: totalFeeSats.toString(),
      steps: preparedSteps.map((step) => ({
        label: step.label,
        payloadHex: step.payloadHex,
        unsignedPsbtHash: step.unsignedPsbtHash,
        feeSats: step.feeSats,
        inputUtxos: step.inputUtxos,
        inputAddresses: step.inputAddresses,
        walletChangeOutputs: step.walletChangeOutputs,
        walletChangeAddresses: step.walletChangeAddresses
      }))
    });
    return {
      schema: "tradelayer_testnet_prepared_batch_v1",
      request,
      preparedAt,
      totalFeeSats: totalFeeSats.toString(),
      preparedSteps,
      approvalHash
    };
  }

  async signAndBroadcast(input: {
    prepared: PreparedBrokerBatch;
    approvalHash: string;
    now?: Date;
  }): Promise<BrokerBroadcastReceipt> {
    const now = input.now || new Date();
    validateRequest(input.prepared.request, this.expectedPolicyFingerprint, now);
    await this.validateNetwork();
    if (input.approvalHash !== input.prepared.approvalHash) {
      throw new IntegrationBoundaryError("signer_broker_error", "Prepared batch approval hash mismatch");
    }
    const transactions: BrokerBroadcastReceipt["transactions"] = [];
    for (const step of input.prepared.preparedSteps) {
      if (canonicalHash(step.psbt) !== step.unsignedPsbtHash) {
        throw new IntegrationBoundaryError("signer_broker_error", "Prepared PSBT changed after approval", { label: step.label });
      }
      const decoded = await this.rpc.call<DecodedPsbt>("decodepsbt", step.psbt);
      const checked = await validateDecodedPsbt({
        rpc: this.rpc,
        decoded,
        expectedPayloadHex: step.payloadHex,
        expectedSenderAddress: input.prepared.request.senderAddress
      });
      if (checked.feeSats.toString() !== step.feeSats) {
        throw new IntegrationBoundaryError("signer_broker_error", "Prepared PSBT fee changed after approval", { label: step.label });
      }
      const processed = await this.rpc.call<{ psbt?: string; complete?: boolean }>("walletprocesspsbt", step.psbt, true, "ALL", true);
      if (!processed.psbt || !processed.complete) {
        throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core wallet did not fully sign the approved PSBT", { label: step.label });
      }
      const finalized = await this.rpc.call<{ hex?: string; complete?: boolean }>("finalizepsbt", processed.psbt, true);
      if (!finalized.hex || !finalized.complete) {
        throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core could not finalize the approved PSBT", { label: step.label });
      }
      const acceptance = await this.rpc.call<Array<{ allowed?: boolean; reject_reason?: string }>>("testmempoolaccept", [finalized.hex]);
      if (!acceptance[0]?.allowed) {
        throw new IntegrationBoundaryError("signer_broker_error", "Bitcoin Core rejected the approved transaction", acceptance[0]);
      }
      const txid = await this.rpc.call<string>("sendrawtransaction", finalized.hex);
      transactions.push({
        label: step.label,
        tradePrintId: step.tradePrintId,
        side: step.side,
        txid,
        feeSats: step.feeSats,
        payloadHex: step.payloadHex
      });
    }
    const receiptCore = {
      schema: "tradelayer_testnet_broadcast_receipt_v1" as const,
      requestHash: input.prepared.request.requestHash,
      approvalHash: input.prepared.approvalHash,
      broadcastAt: now.toISOString(),
      transactions
    };
    return { ...receiptCore, receiptHash: canonicalHash(receiptCore) };
  }
}
