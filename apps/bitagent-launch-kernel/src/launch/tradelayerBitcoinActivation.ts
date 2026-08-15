import { hashObject } from "./canonical.js";
import { LaunchKernelError } from "./errors.js";
import type { TradeLayerListenerObservation } from "./tradelayerListenerPreflight.js";

type PublicRecord = Record<string, unknown>;

export type BitcoinRpcCall = (method: string, params: unknown[]) => Promise<unknown>;

export type TradeLayerBitcoinActivationProof = {
  schema: "bitagent_tradelayer_bitcoin_activation_proof_v1";
  proofHash: string;
  authority: "read_only_bitcoin_observer";
  effect: "none";
  listenerObservationHash: string;
  listenerNodeId: string;
  sourceRpcEndpoint: string;
  chain: "testnet4";
  capturedAt: string;
  observedBestBlockHash: string;
  observedBestBlockHeight: number;
  txid: string;
  blockHash: string;
  blockHeight: number;
  confirmations: number;
  inActiveChain: true;
  payloadHash: string;
  activatedTxTypes: number[];
  codeHash: string;
};

function record(value: unknown, label: string): PublicRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchKernelError("provider_unavailable", `Bitcoin Core ${label} response is malformed`);
  }
  return value as PublicRecord;
}

function lowercaseHex(value: unknown, bytes: number, label: string): string {
  const text = String(value || "").trim().toLowerCase();
  if (!new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(text)) {
    throw new LaunchKernelError("provider_unavailable", `Bitcoin Core ${label} is invalid`);
  }
  return text;
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new LaunchKernelError("provider_unavailable", `Bitcoin Core ${label} is invalid`);
  }
  return number;
}

function rpcEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new LaunchKernelError("validation_error", "Bitcoin Core endpoint must be an absolute URL", error);
  }
  const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!["http:", "https:"].includes(url.protocol)
    || (url.protocol === "http:" && !loopback.has(url.hostname))
    || url.username || url.password || url.search || url.hash
    || (url.pathname !== "/" && url.pathname !== "")) {
    throw new LaunchKernelError(
      "validation_error",
      "Bitcoin Core endpoint must be loopback HTTP or credential-free HTTPS without a path"
    );
  }
  return url.toString().replace(/\/$/, "");
}

function base36HashToHex(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(normalized)) return normalized;
  if (!/^[0-9a-z]{1,52}$/.test(normalized)) return null;
  let number = 0n;
  for (const character of normalized) {
    const digit = parseInt(character, 36);
    if (!Number.isSafeInteger(digit) || digit < 0 || digit >= 36) return null;
    number = number * 36n + BigInt(digit);
  }
  const hex = number.toString(16);
  return hex.length <= 64 ? hex.padStart(64, "0") : null;
}

function pushedData(scriptHex: string): Buffer {
  if (!/^(?:[a-f0-9]{2})+$/i.test(scriptHex)) {
    throw new LaunchKernelError("provider_unavailable", "Activation OP_RETURN script is invalid hex");
  }
  const script = Buffer.from(scriptHex, "hex");
  if (script.length < 3 || script[0] !== 0x6a) {
    throw new LaunchKernelError("provider_unavailable", "Activation output is not OP_RETURN");
  }
  let cursor = 1;
  const opcode = script[cursor++]!;
  let length: number;
  if (opcode >= 1 && opcode <= 75) {
    length = opcode;
  } else if (opcode === 0x4c && cursor < script.length) {
    length = script[cursor++]!;
    if (length < 76) {
      throw new LaunchKernelError("provider_unavailable", "Activation OP_RETURN uses non-canonical PUSHDATA1");
    }
  } else {
    throw new LaunchKernelError("provider_unavailable", "Activation OP_RETURN push opcode is unsupported");
  }
  if (cursor + length !== script.length) {
    throw new LaunchKernelError("provider_unavailable", "Activation OP_RETURN length or trailing data is invalid");
  }
  return script.subarray(cursor);
}

export function decodeTradeLayerActivationScript(scriptHex: string): {
  payloadHash: string;
  activatedTxTypes: number[];
  codeHash: string;
} {
  const data = pushedData(scriptHex);
  const payload = data.toString("latin1");
  if (!/^[\x20-\x7e]+$/.test(payload) || !payload.startsWith("tl0")) {
    throw new LaunchKernelError("provider_unavailable", "Activation OP_RETURN is not a printable TradeLayer tx0 payload");
  }
  const fields = payload.slice(3).split(",");
  if (fields.length !== 2 || !fields[0] || !fields[1]) {
    throw new LaunchKernelError("provider_unavailable", "TradeLayer activation payload fields are invalid");
  }
  const activatedTxTypes = fields[0]!.split(";").map((value) => {
    if (!/^(?:0|[1-9][0-9]?)$/.test(value)) {
      throw new LaunchKernelError("provider_unavailable", "TradeLayer activation transaction type is invalid");
    }
    const txType = Number(value);
    if (!Number.isSafeInteger(txType) || txType < 0 || txType > 35) {
      throw new LaunchKernelError("provider_unavailable", "TradeLayer activation transaction type is out of range");
    }
    return txType;
  });
  if (new Set(activatedTxTypes).size !== activatedTxTypes.length) {
    throw new LaunchKernelError("provider_unavailable", "TradeLayer activation transaction types contain duplicates");
  }
  const codeHash = base36HashToHex(fields[1]!);
  if (!codeHash) throw new LaunchKernelError("provider_unavailable", "TradeLayer activation code hash is invalid");
  return { payloadHash: hashObject(payload), activatedTxTypes, codeHash };
}

function proofCore(proof: TradeLayerBitcoinActivationProof) {
  const { proofHash: _proofHash, ...core } = proof;
  return core;
}

export function verifyTradeLayerBitcoinActivationProof(proof: TradeLayerBitcoinActivationProof): boolean {
  try {
    const capturedAt = new Date(proof.capturedAt);
    return proof.schema === "bitagent_tradelayer_bitcoin_activation_proof_v1"
      && proof.authority === "read_only_bitcoin_observer"
      && proof.effect === "none"
      && proof.chain === "testnet4"
      && proof.inActiveChain === true
      && Number.isSafeInteger(proof.blockHeight) && proof.blockHeight >= 0
      && Number.isSafeInteger(proof.confirmations) && proof.confirmations >= 1
      && /^[a-f0-9]{64}$/.test(proof.listenerObservationHash)
      && /^[A-Za-z0-9._:-]{3,128}$/.test(proof.listenerNodeId)
      && rpcEndpoint(proof.sourceRpcEndpoint) === proof.sourceRpcEndpoint
      && Number.isFinite(capturedAt.getTime()) && capturedAt.toISOString() === proof.capturedAt
      && /^[a-f0-9]{64}$/.test(proof.observedBestBlockHash)
      && Number.isSafeInteger(proof.observedBestBlockHeight) && proof.observedBestBlockHeight >= 0
      && /^[a-f0-9]{64}$/.test(proof.txid)
      && /^[a-f0-9]{64}$/.test(proof.blockHash)
      && /^[a-f0-9]{64}$/.test(proof.codeHash)
      && /^[a-f0-9]{64}$/.test(proof.payloadHash)
      && proof.activatedTxTypes.length > 0
      && proof.activatedTxTypes.includes(11)
      && new Set(proof.activatedTxTypes).size === proof.activatedTxTypes.length
      && proof.activatedTxTypes.every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 35)
      && /^[a-f0-9]{64}$/.test(proof.proofHash)
      && hashObject(proofCore(proof)) === proof.proofHash;
  } catch {
    return false;
  }
}

export async function observeTradeLayerBitcoinActivation(input: {
  observation: TradeLayerListenerObservation;
  expectedCodeHash: string;
  sourceRpcEndpoint: string;
  rpcCall: BitcoinRpcCall;
  now?: Date;
}): Promise<TradeLayerBitcoinActivationProof> {
  const source = input.observation.tx11.activationSource;
  const expectedCodeHash = lowercaseHex(input.expectedCodeHash, 32, "expected activation code hash");
  if (source.kind !== "bitcoin_transaction" || source.chainDerived !== true
    || input.observation.tx11.activationBlock === null
    || source.blockHeight !== input.observation.tx11.activationBlock) {
    throw new LaunchKernelError("provider_unavailable", "Listener lacks exact chain-derived tx11 activation provenance");
  }
  const sourceRpcEndpoint = rpcEndpoint(input.sourceRpcEndpoint);
  const chainInfo = record(await input.rpcCall("getblockchaininfo", []), "chain status");
  const observedBestBlockHash = lowercaseHex(chainInfo.bestblockhash, 32, "best block hash");
  const observedBestBlockHeight = safeInteger(chainInfo.blocks, "best block height");
  if (chainInfo.chain !== "testnet4" || chainInfo.initialblockdownload === true
    || observedBestBlockHash !== input.observation.bitcoinBackend.bestBlockHash
    || observedBestBlockHeight !== input.observation.bitcoinBackend.blocks) {
    throw new LaunchKernelError("provider_unavailable", "Bitcoin RPC chain status does not match the listener testnet4 backend");
  }
  const blockHash = lowercaseHex(
    await input.rpcCall("getblockhash", [source.blockHeight]),
    32,
    "activation block hash"
  );
  const [rawHeader, rawTransaction] = await Promise.all([
    input.rpcCall("getblockheader", [blockHash, true]),
    input.rpcCall("getrawtransaction", [source.txid, true, blockHash])
  ]);
  const header = record(rawHeader, "activation block header");
  const transaction = record(rawTransaction, "activation transaction");
  const headerHeight = safeInteger(header.height, "activation block height");
  const confirmations = safeInteger(header.confirmations, "activation confirmations", 1);
  if (headerHeight !== source.blockHeight
    || (header.hash !== undefined && lowercaseHex(header.hash, 32, "activation header hash") !== blockHash)
    || lowercaseHex(transaction.txid, 32, "activation transaction id") !== source.txid
    || lowercaseHex(transaction.blockhash, 32, "activation transaction block hash") !== blockHash) {
    throw new LaunchKernelError("provider_unavailable", "Bitcoin activation transaction does not match listener provenance");
  }
  const outputs = Array.isArray(transaction.vout) ? transaction.vout : [];
  const decoded = outputs.flatMap((output) => {
    const script = record(record(output, "activation output").scriptPubKey, "activation script");
    if (script.type !== "nulldata") return [];
    try {
      return [decodeTradeLayerActivationScript(String(script.hex || ""))];
    } catch {
      return [];
    }
  }).filter((candidate) => candidate.activatedTxTypes.includes(11));
  if (decoded.length !== 1) {
    throw new LaunchKernelError("provider_unavailable", "Bitcoin transaction must contain exactly one tx11 activation payload");
  }
  const activation = decoded[0]!;
  if (activation.codeHash !== expectedCodeHash
    || input.observation.tx11.codeHash !== expectedCodeHash) {
    throw new LaunchKernelError("provider_unavailable", "Bitcoin tx11 activation code hash does not match the release");
  }
  const core = {
    schema: "bitagent_tradelayer_bitcoin_activation_proof_v1" as const,
    authority: "read_only_bitcoin_observer" as const,
    effect: "none" as const,
    listenerObservationHash: input.observation.observationHash,
    listenerNodeId: input.observation.listener.nodeId,
    sourceRpcEndpoint,
    chain: "testnet4" as const,
    capturedAt: (input.now || new Date()).toISOString(),
    observedBestBlockHash,
    observedBestBlockHeight,
    txid: source.txid,
    blockHash,
    blockHeight: source.blockHeight,
    confirmations,
    inActiveChain: true as const,
    payloadHash: activation.payloadHash,
    activatedTxTypes: activation.activatedTxTypes,
    codeHash: activation.codeHash
  };
  return { ...core, proofHash: hashObject(core) };
}
