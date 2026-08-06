import { createRequire } from "node:module";
import path from "node:path";
import { buildProceduralTemplateContext } from "../adapters/proceduralAdapter.js";
import { externalRepos } from "../config.js";
import { encodeSegwitAddress, validateBitcoinAddress } from "./bitcoin.js";
import { formatUnits, hashObject } from "./canonical.js";
import { LaunchKernelError } from "./errors.js";

const require = createRequire(import.meta.url);
const reserveVault = require(path.join(
  externalRepos.utxoRef,
  "bitvm3",
  "utxo_referee",
  "taproot_reserve_vault.js"
));
const tradeLayerEncoder = require(path.join(externalRepos.tradelayer, "src", "txEncoder.js"));

export type ReserveIntakePlan = {
  schema: "bitagent_reserve_intake_plan_v1";
  planHash: string;
  network: "bitcoin-testnet4";
  workflowId: string;
  walletSessionId: string;
  walletAddress: string;
  amountSats: string;
  bindingHash: string;
  reserve: {
    address: string;
    scriptPubKeyHex: string;
    operatorXonly: string;
    guardianXonly: string;
    recoveryXonly: string;
    recoveryCsvDelay: number;
    internalXonly: string;
    merkleRoot: string;
  };
  tradeLayer: {
    transactionType: 11;
    propertyId: number;
    payload: string;
    payloadHex: string;
    payloadBytes: number;
    dlcTemplateId: string;
    dlcContractId: string;
    settlementState: string;
    dlcHash: string;
  };
  requiredOutputOrder: [
    { vout: 0; kind: "utxoref_reserve"; amountSats: string; scriptPubKeyHex: string },
    { vout: 1; kind: "tradelayer_op_return"; payloadHex: string },
    { vout: 2; kind: "wallet_change" }
  ];
  preconditions: string[];
};

function canonicalSats(value: string): string {
  const text = String(value).trim();
  if (!/^[1-9][0-9]*$/.test(text)) {
    throw new LaunchKernelError("validation_error", "Reserve amount must be a positive satoshi amount");
  }
  return BigInt(text).toString();
}

function intakeBindingHash(input: {
  workflowId: string;
  walletSessionId: string;
  walletAddress: string;
  amountSats: string;
  propertyId: number;
  dlcTemplateId: string;
  dlcContractId: string;
  settlementState: string;
  dlcHash: string;
}) {
  return hashObject({ schema: "bitagent_reserve_intake_binding_v1", ...input });
}

export function reserveIntakeCore(plan: ReserveIntakePlan) {
  const { planHash: _planHash, ...core } = plan;
  return core;
}

export function verifyReserveIntakePlan(plan: ReserveIntakePlan): boolean {
  try {
    const address = validateBitcoinAddress(plan.reserve.address, plan.network);
    const decoded = require(path.join(
      externalRepos.tradelayer,
      "src",
      "txDecoder.js"
    )).decodeGrantManagedToken(plan.tradeLayer.payload.slice(3));
    const template = reserveVault.buildTaprootReserveVaultTemplate({
      network: plan.network,
      operatorXonly: plan.reserve.operatorXonly,
      guardianXonly: plan.reserve.guardianXonly,
      recoveryXonly: plan.reserve.recoveryXonly,
      recoveryCsvDelay: plan.reserve.recoveryCsvDelay,
      bindingHash: plan.bindingHash,
      internalXonly: plan.reserve.internalXonly
    });
    const expectedBindingHash = intakeBindingHash({
      workflowId: plan.workflowId,
      walletSessionId: plan.walletSessionId,
      walletAddress: plan.walletAddress,
      amountSats: plan.amountSats,
      propertyId: plan.tradeLayer.propertyId,
      dlcTemplateId: plan.tradeLayer.dlcTemplateId,
      dlcContractId: plan.tradeLayer.dlcContractId,
      settlementState: plan.tradeLayer.settlementState,
      dlcHash: plan.tradeLayer.dlcHash
    });
    return plan.schema === "bitagent_reserve_intake_plan_v1"
      && plan.tradeLayer.transactionType === 11
      && plan.tradeLayer.payload.startsWith("tlb")
      && Buffer.from(plan.tradeLayer.payload, "utf8").toString("hex") === plan.tradeLayer.payloadHex
      && Buffer.byteLength(plan.tradeLayer.payload, "utf8") === plan.tradeLayer.payloadBytes
      && plan.tradeLayer.payloadBytes > 0 && plan.tradeLayer.payloadBytes <= 100_000
      && plan.bindingHash === expectedBindingHash
      && address.type === "p2tr"
      && address.scriptPubKeyHex === plan.reserve.scriptPubKeyHex
      && template.p2trScriptPubKey === plan.reserve.scriptPubKeyHex
      && template.merkleRoot === plan.reserve.merkleRoot
      && plan.requiredOutputOrder[0].amountSats === plan.amountSats
      && plan.requiredOutputOrder[0].scriptPubKeyHex === plan.reserve.scriptPubKeyHex
      && plan.requiredOutputOrder[1].payloadHex === plan.tradeLayer.payloadHex
      && Number(decoded?.propertyId) === plan.tradeLayer.propertyId
      && Math.round(Number(decoded?.amountGranted) * 100_000_000).toString() === plan.amountSats
      && decoded?.addressToGrantTo === plan.reserve.address
      && decoded?.dlcTemplateId === plan.tradeLayer.dlcTemplateId
      && decoded?.dlcContractId === plan.tradeLayer.dlcContractId
      && decoded?.settlementState === plan.tradeLayer.settlementState
      && decoded?.dlcHash === plan.tradeLayer.dlcHash
      && hashObject(reserveIntakeCore(plan)) === plan.planHash;
  } catch {
    return false;
  }
}

export function buildReserveIntakePlan(input: {
  workflowId: string;
  walletSessionId: string;
  walletAddress: string;
  amountSats: string;
  operatorXonly: string;
  guardianXonly: string;
  recoveryXonly?: string;
  recoveryCsvDelay?: number;
  propertyId?: number;
  dlcTemplateId?: string;
  dlcContractId?: string;
  settlementState?: string;
  dlcHash?: string;
}): ReserveIntakePlan {
  const network = "bitcoin-testnet4" as const;
  const amountSats = canonicalSats(input.amountSats);
  const walletAddress = validateBitcoinAddress(input.walletAddress, network).address;
  const procedural = buildProceduralTemplateContext();
  const propertyId = Number(input.propertyId ?? procedural.receiptPropertyId);
  if (!Number.isSafeInteger(propertyId) || propertyId <= 0) {
    throw new LaunchKernelError("validation_error", "A positive TradeLayer tlBTC property id is required");
  }
  const dlcTemplateId = String(input.dlcTemplateId || procedural.templateId);
  const dlcContractId = String(input.dlcContractId || procedural.contractId);
  const settlementState = String(input.settlementState || procedural.settlementState).toUpperCase();
  const dlcHash = String(input.dlcHash || procedural.templateHash).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(dlcHash)) {
    throw new LaunchKernelError("validation_error", "The procedural DLC hash must be 32 bytes of hex");
  }
  const recoveryXonly = input.recoveryXonly || input.operatorXonly;
  const recoveryCsvDelay = input.recoveryCsvDelay ?? 2016;
  const bindingHash = intakeBindingHash({
    workflowId: input.workflowId,
    walletSessionId: input.walletSessionId,
    walletAddress,
    amountSats,
    propertyId,
    dlcTemplateId,
    dlcContractId,
    settlementState,
    dlcHash
  });
  const template = reserveVault.buildTaprootReserveVaultTemplate({
    network,
    operatorXonly: input.operatorXonly,
    guardianXonly: input.guardianXonly,
    recoveryXonly,
    recoveryCsvDelay,
    bindingHash
  });
  const outputKey = Buffer.from(String(template.p2trScriptPubKey).slice(4), "hex");
  const reserveAddress = encodeSegwitAddress(outputKey, network, 1);
  const payload = String(tradeLayerEncoder.encodeGrantManagedToken({
    propertyId,
    amountGranted: formatUnits(BigInt(amountSats), 8),
    redeemAddress: reserveAddress,
    dlcTemplateId,
    dlcContractId,
    settlementState,
    dlcHash
  }));
  const payloadHex = Buffer.from(payload, "utf8").toString("hex");
  const core = {
    schema: "bitagent_reserve_intake_plan_v1" as const,
    network,
    workflowId: input.workflowId,
    walletSessionId: input.walletSessionId,
    walletAddress,
    amountSats,
    bindingHash,
    reserve: {
      address: reserveAddress,
      scriptPubKeyHex: String(template.p2trScriptPubKey),
      operatorXonly: input.operatorXonly,
      guardianXonly: input.guardianXonly,
      recoveryXonly,
      recoveryCsvDelay,
      internalXonly: String(template.internalXonly),
      merkleRoot: String(template.merkleRoot)
    },
    tradeLayer: {
      transactionType: 11 as const,
      propertyId: Number(propertyId),
      payload,
      payloadHex,
      payloadBytes: Buffer.byteLength(payload, "utf8"),
      dlcTemplateId,
      dlcContractId,
      settlementState,
      dlcHash
    },
    requiredOutputOrder: [
      { vout: 0 as const, kind: "utxoref_reserve" as const, amountSats, scriptPubKeyHex: String(template.p2trScriptPubKey) },
      { vout: 1 as const, kind: "tradelayer_op_return" as const, payloadHex },
      { vout: 2 as const, kind: "wallet_change" as const }
    ] as ReserveIntakePlan["requiredOutputOrder"],
    preconditions: [
      "TradeLayer transaction type 11 is active at the candidate block height.",
      "The configured property is the intended tlBTC procedural receipt property.",
      "Every synchronized TradeLayer node has the exact template hash and contract state.",
      "The registry contract redeemAddress equals the displayed P2TR reserve address.",
      "The wallet node's current data-carrier policy admits the displayed payload byte length.",
      "The wallet owns the operator/recovery key and the guardian is independently available."
    ]
  };
  const plan = { ...core, planHash: hashObject(core) };
  if (!verifyReserveIntakePlan(plan)) {
    throw new LaunchKernelError("validation_error", "Reserve intake plan failed deterministic self-verification");
  }
  return plan;
}
