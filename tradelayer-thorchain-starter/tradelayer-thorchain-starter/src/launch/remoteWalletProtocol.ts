import { LaunchKernelError } from "./errors.js";
import { hashObject } from "./canonical.js";
import { validateBitcoinAddress } from "./bitcoin.js";
import { verifyReserveIntakePlan, type ReserveIntakePlan } from "./reserveIntake.js";
import type {
  BitAgentWorkflowState,
  LaunchErrorCode,
  WalletReserveIntakeCandidate,
  WalletWithdrawalCandidate
} from "./types.js";

export const TXID_PATTERN = /^[a-f0-9]{64}$/;
export const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._:~-]{8,256}$/;
export const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{16,2048}$/;
export const REQUIRED_WALLET_CAPABILITIES = ["deposit", "strategy", "withdraw", "psbt_approval"] as const;

const FORBIDDEN_RESPONSE_KEYS = new Set([
  "mnemonic", "seed", "seedphrase", "privatekey", "wif", "xprv", "tprv",
  "rawtx", "signedtx", "signedhex", "finalhex", "psbt", "psbthex",
  "signature", "signatures", "secret", "authtoken", "bearertoken"
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchKernelError("provider_unavailable", `Wallet broker returned invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function candidateScript(value: unknown, label: string): string {
  const text = String(value || "").toLowerCase();
  if (!/^(?:[a-f0-9]{2}){2,520}$/.test(text)) {
    throw new LaunchKernelError("provider_unavailable", `Wallet broker returned invalid ${label}`);
  }
  return text;
}

export function boundedWalletText(
  value: unknown,
  label: string,
  pattern = OPAQUE_ID_PATTERN
): string {
  const text = String(value || "");
  if (!pattern.test(text)) {
    throw new LaunchKernelError("provider_unavailable", `Wallet broker returned invalid ${label}`);
  }
  return text;
}

export function canonicalWalletSats(
  value: unknown,
  label: string,
  errorCode: LaunchErrorCode = "provider_unavailable"
): string {
  const text = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    throw new LaunchKernelError(errorCode, `Wallet broker returned invalid ${label}`);
  }
  return text;
}

export function validatedProviderBitcoinAddress(
  value: unknown,
  network: "bitcoin" | "bitcoin-testnet4"
) {
  try {
    return validateBitcoinAddress(String(value || ""), network);
  } catch {
    throw new LaunchKernelError("provider_unavailable", "Wallet broker returned an invalid Bitcoin address");
  }
}

export function walletIsoTime(value: unknown, label: string): string {
  const text = String(value || "");
  if (!text || !Number.isFinite(Date.parse(text))) {
    throw new LaunchKernelError("provider_unavailable", `Wallet broker returned invalid ${label}`);
  }
  return new Date(text).toISOString();
}

function assertNoSecretFields(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(assertNoSecretFields);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (FORBIDDEN_RESPONSE_KEYS.has(normalized)) {
      throw new LaunchKernelError(
        "provider_unavailable",
        "Wallet broker response contained prohibited secret or signed-transaction material"
      );
    }
    assertNoSecretFields(child);
  }
}

export function walletRequestContext(state: BitAgentWorkflowState) {
  if (state.wallet.status !== "connected" || !state.wallet.walletSessionId || !state.wallet.bitcoinAddress) {
    throw new LaunchKernelError("wallet_not_connected", "A connected public wallet session is required");
  }
  return {
    workflowId: state.id,
    walletSessionId: state.wallet.walletSessionId,
    network: state.wallet.network,
    bitcoinAddress: state.wallet.bitcoinAddress
  };
}

export function validatedWithdrawalCandidate(input: {
  value: unknown;
  workflowId: string;
  walletSessionId: string;
  network: "bitcoin" | "bitcoin-testnet4";
  walletAddress: string;
  destinationAddress: string;
  amountSats: string;
  networkFeeSats: string;
}): WalletWithdrawalCandidate {
  const candidate = record(input.value, "withdrawal candidate");
  if (candidate.schema !== "bitagent_wallet_withdrawal_candidate_v1"
    || input.network !== "bitcoin-testnet4"
    || candidate.network !== input.network
    || candidate.workflowId !== input.workflowId
    || candidate.walletSessionId !== input.walletSessionId
    || candidate.signingPerformed !== false
    || candidate.broadcastPerformed !== false) {
    throw new LaunchKernelError("state_conflict", "Wallet withdrawal candidate authority binding is invalid");
  }

  const inputUtxos = Array.isArray(candidate.inputUtxos) ? candidate.inputUtxos : [];
  if (inputUtxos.length !== 1) {
    throw new LaunchKernelError("provider_unavailable", "Wallet withdrawal candidate must expose one exact input");
  }
  const rawInput = record(inputUtxos[0], "withdrawal candidate input");
  const inputAddress = validatedProviderBitcoinAddress(rawInput.address, input.network);
  const walletAddress = validatedProviderBitcoinAddress(input.walletAddress, input.network);
  const parsedInput = {
    txid: boundedWalletText(rawInput.txid, "withdrawal input txid", TXID_PATTERN),
    vout: Number(rawInput.vout),
    valueSats: canonicalWalletSats(rawInput.valueSats, "withdrawal input value"),
    address: inputAddress.address,
    scriptPubKeyHex: candidateScript(rawInput.scriptPubKeyHex, "withdrawal input script")
  };
  if (!Number.isSafeInteger(parsedInput.vout) || parsedInput.vout < 0
    || parsedInput.address !== walletAddress.address
    || parsedInput.scriptPubKeyHex !== inputAddress.scriptPubKeyHex) {
    throw new LaunchKernelError("state_conflict", "Wallet withdrawal candidate input is not the connected wallet input");
  }

  const rawDestination = record(candidate.destinationOutput, "withdrawal destination output");
  const destination = validatedProviderBitcoinAddress(rawDestination.address, input.network);
  const requestedDestination = validatedProviderBitcoinAddress(input.destinationAddress, input.network);
  const destinationOutput = {
    vout: Number(rawDestination.vout) as 0,
    address: destination.address,
    scriptPubKeyHex: candidateScript(rawDestination.scriptPubKeyHex, "withdrawal destination script"),
    valueSats: canonicalWalletSats(rawDestination.valueSats, "withdrawal destination value")
  };
  if (destinationOutput.vout !== 0
    || destinationOutput.address !== requestedDestination.address
    || destinationOutput.scriptPubKeyHex !== requestedDestination.scriptPubKeyHex
    || destinationOutput.valueSats !== canonicalWalletSats(input.amountSats, "amountSats", "validation_error")) {
    throw new LaunchKernelError("state_conflict", "Wallet withdrawal candidate destination differs from the request");
  }

  const rawChange = record(candidate.changeOutput, "withdrawal change output");
  const change = validatedProviderBitcoinAddress(rawChange.address, input.network);
  const changeOutput = {
    vout: Number(rawChange.vout) as 1,
    address: change.address,
    scriptPubKeyHex: candidateScript(rawChange.scriptPubKeyHex, "withdrawal change script"),
    valueSats: canonicalWalletSats(rawChange.valueSats, "withdrawal change value")
  };
  if (changeOutput.vout !== 1
    || changeOutput.address !== walletAddress.address
    || changeOutput.scriptPubKeyHex !== walletAddress.scriptPubKeyHex
    || BigInt(changeOutput.valueSats) <= 0n) {
    throw new LaunchKernelError("state_conflict", "Wallet withdrawal candidate change is not positive wallet-owned change");
  }

  const preparedAt = walletIsoTime(candidate.preparedAt, "withdrawal preparedAt");
  const expiresAt = walletIsoTime(candidate.expiresAt, "withdrawal expiresAt");
  const feeRateSatVb = Number(candidate.feeRateSatVb);
  const feeSats = canonicalWalletSats(candidate.feeSats, "withdrawal fee");
  if (preparedAt !== candidate.preparedAt || expiresAt !== candidate.expiresAt
    || Date.parse(expiresAt) <= Date.parse(preparedAt)
    || !Number.isSafeInteger(feeRateSatVb) || feeRateSatVb < 1 || feeRateSatVb > 1000
    || feeSats !== canonicalWalletSats(input.networkFeeSats, "networkFeeSats")
    || BigInt(feeSats) <= 0n
    || BigInt(parsedInput.valueSats) !== BigInt(destinationOutput.valueSats)
      + BigInt(changeOutput.valueSats) + BigInt(feeSats)) {
    throw new LaunchKernelError("state_conflict", "Wallet withdrawal candidate fee or arithmetic is invalid");
  }

  const core = {
    schema: "bitagent_wallet_withdrawal_candidate_v1" as const,
    workflowId: input.workflowId,
    walletSessionId: input.walletSessionId,
    network: "bitcoin-testnet4" as const,
    preparedAt,
    expiresAt,
    unsignedTxid: boundedWalletText(candidate.unsignedTxid, "unsigned txid", TXID_PATTERN),
    unsignedPsbtHash: boundedWalletText(candidate.unsignedPsbtHash, "unsigned PSBT hash", TXID_PATTERN),
    inputUtxos: [parsedInput],
    destinationOutput,
    changeOutput,
    feeSats,
    feeRateSatVb,
    signingPerformed: false as const,
    broadcastPerformed: false as const
  };
  const candidateHash = hashObject(core);
  const candidateId = `withdrawal_candidate_${candidateHash.slice(0, 32)}`;
  if (candidate.candidateHash !== candidateHash || candidate.candidateId !== candidateId) {
    throw new LaunchKernelError("state_conflict", "Wallet withdrawal candidate hash is invalid");
  }
  return { candidateId, candidateHash, ...core };
}

export function validatedReserveIntakeCandidate(input: {
  value: unknown;
  plan: ReserveIntakePlan;
  workflowId: string;
  walletSessionId: string;
  network: "bitcoin" | "bitcoin-testnet4";
  walletAddress: string;
  amountSats: string;
  networkFeeSats: string;
}): WalletReserveIntakeCandidate {
  const candidate = record(input.value, "reserve intake candidate");
  const plan = input.plan;
  if (!verifyReserveIntakePlan(plan)
    || candidate.schema !== "bitagent_wallet_reserve_intake_candidate_v1"
    || input.network !== "bitcoin-testnet4"
    || candidate.network !== input.network
    || candidate.workflowId !== input.workflowId
    || candidate.walletSessionId !== input.walletSessionId
    || candidate.planHash !== plan.planHash
    || candidate.bindingHash !== plan.bindingHash
    || candidate.signingPerformed !== false
    || candidate.broadcastPerformed !== false) {
    throw new LaunchKernelError("state_conflict", "Wallet reserve candidate authority binding is invalid");
  }

  const rawInputs = Array.isArray(candidate.inputUtxos) ? candidate.inputUtxos : [];
  if (rawInputs.length !== 1) {
    throw new LaunchKernelError("provider_unavailable", "Wallet reserve candidate must expose one exact input");
  }
  const rawInput = record(rawInputs[0], "reserve candidate input");
  const connectedWallet = validatedProviderBitcoinAddress(input.walletAddress, input.network);
  const inputAddress = validatedProviderBitcoinAddress(rawInput.address, input.network);
  const parsedInput = {
    txid: boundedWalletText(rawInput.txid, "reserve input txid", TXID_PATTERN),
    vout: Number(rawInput.vout),
    valueSats: canonicalWalletSats(rawInput.valueSats, "reserve input value"),
    address: inputAddress.address,
    scriptPubKeyHex: candidateScript(rawInput.scriptPubKeyHex, "reserve input script")
  };
  if (!Number.isSafeInteger(parsedInput.vout) || parsedInput.vout < 0
    || parsedInput.address !== connectedWallet.address
    || parsedInput.scriptPubKeyHex !== inputAddress.scriptPubKeyHex) {
    throw new LaunchKernelError("state_conflict", "Wallet reserve candidate input is not the connected wallet input");
  }

  const rawReserve = record(candidate.reserveOutput, "reserve output");
  const reserve = validatedProviderBitcoinAddress(rawReserve.address, input.network);
  const reserveOutput = {
    vout: Number(rawReserve.vout) as 0,
    address: reserve.address,
    scriptPubKeyHex: candidateScript(rawReserve.scriptPubKeyHex, "reserve output script"),
    valueSats: canonicalWalletSats(rawReserve.valueSats, "reserve output value")
  };
  if (reserveOutput.vout !== 0
    || reserveOutput.address !== plan.reserve.address
    || reserveOutput.scriptPubKeyHex !== plan.reserve.scriptPubKeyHex.toLowerCase()
    || reserveOutput.valueSats !== canonicalWalletSats(input.amountSats, "amountSats", "validation_error")
    || reserveOutput.valueSats !== plan.amountSats) {
    throw new LaunchKernelError("state_conflict", "Wallet reserve output differs from the exact plan");
  }

  const rawData = record(candidate.dataOutput, "reserve data output");
  const dataOutput = {
    vout: Number(rawData.vout) as 1,
    payloadHex: String(rawData.payloadHex || "").toLowerCase(),
    payloadBytes: Number(rawData.payloadBytes)
  };
  if (dataOutput.vout !== 1
    || !/^(?:[a-f0-9]{2})+$/.test(dataOutput.payloadHex)
    || dataOutput.payloadHex !== plan.tradeLayer.payloadHex.toLowerCase()
    || dataOutput.payloadBytes !== plan.tradeLayer.payloadBytes) {
    throw new LaunchKernelError("state_conflict", "Wallet reserve data output differs from the exact tx11 plan");
  }

  const rawChange = record(candidate.changeOutput, "reserve change output");
  const change = validatedProviderBitcoinAddress(rawChange.address, input.network);
  const changeOutput = {
    vout: Number(rawChange.vout) as 2,
    address: change.address,
    scriptPubKeyHex: candidateScript(rawChange.scriptPubKeyHex, "reserve change script"),
    valueSats: canonicalWalletSats(rawChange.valueSats, "reserve change value")
  };
  if (changeOutput.vout !== 2
    || changeOutput.address !== connectedWallet.address
    || changeOutput.scriptPubKeyHex !== connectedWallet.scriptPubKeyHex
    || BigInt(changeOutput.valueSats) <= 0n) {
    throw new LaunchKernelError("state_conflict", "Wallet reserve change is not positive wallet-owned change");
  }

  const preparedAt = walletIsoTime(candidate.preparedAt, "reserve preparedAt");
  const expiresAt = walletIsoTime(candidate.expiresAt, "reserve expiresAt");
  const feeRateSatVb = Number(candidate.feeRateSatVb);
  const feeSats = canonicalWalletSats(candidate.feeSats, "reserve fee");
  if (preparedAt !== candidate.preparedAt || expiresAt !== candidate.expiresAt
    || Date.parse(expiresAt) <= Date.parse(preparedAt)
    || !Number.isSafeInteger(feeRateSatVb) || feeRateSatVb < 1 || feeRateSatVb > 1000
    || feeSats !== canonicalWalletSats(input.networkFeeSats, "networkFeeSats")
    || BigInt(feeSats) <= 0n
    || BigInt(parsedInput.valueSats) !== BigInt(reserveOutput.valueSats)
      + BigInt(changeOutput.valueSats) + BigInt(feeSats)) {
    throw new LaunchKernelError("state_conflict", "Wallet reserve candidate fee or arithmetic is invalid");
  }

  const core = {
    schema: "bitagent_wallet_reserve_intake_candidate_v1" as const,
    workflowId: input.workflowId,
    walletSessionId: input.walletSessionId,
    network: "bitcoin-testnet4" as const,
    preparedAt,
    expiresAt,
    planHash: plan.planHash,
    bindingHash: plan.bindingHash,
    unsignedTxid: boundedWalletText(candidate.unsignedTxid, "reserve unsigned txid", TXID_PATTERN),
    unsignedPsbtHash: boundedWalletText(candidate.unsignedPsbtHash, "reserve unsigned PSBT hash", TXID_PATTERN),
    inputUtxos: [parsedInput],
    reserveOutput,
    dataOutput,
    changeOutput,
    feeSats,
    feeRateSatVb,
    signingPerformed: false as const,
    broadcastPerformed: false as const
  };
  const candidateHash = hashObject(core);
  const candidateId = `reserve_candidate_${candidateHash.slice(0, 32)}`;
  if (candidate.candidateHash !== candidateHash || candidate.candidateId !== candidateId) {
    throw new LaunchKernelError("state_conflict", "Wallet reserve candidate hash is invalid");
  }
  return { candidateId, candidateHash, ...core };
}

export class RemoteWalletHttpClient {
  readonly source: string;
  private readonly authToken: string;
  private readonly timeoutMs: number;

  constructor(config: { endpoint: string; authToken: string; timeoutMs?: number }) {
    const endpoint = new URL(config.endpoint);
    const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(endpoint.hostname);
    if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) {
      throw new Error("Wallet broker endpoint must use HTTPS or loopback HTTP");
    }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error("Wallet broker endpoint cannot contain credentials, query, or fragment");
    }
    this.source = endpoint.toString().replace(/\/$/, "");
    this.authToken = String(config.authToken || "").trim();
    if (!OPAQUE_TOKEN_PATTERN.test(this.authToken)) {
      throw new Error("Wallet broker bearer token must be an opaque 16-2048 character value");
    }
    this.timeoutMs = config.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 60_000) {
      throw new Error("Wallet broker timeout must be between 100 and 60000 milliseconds");
    }
  }

  async call(path: string, body: unknown): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.source}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.authToken}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: controller.signal
      });
      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (Number.isFinite(declaredLength) && declaredLength > 65_536) {
        throw new LaunchKernelError("provider_unavailable", "Wallet broker response is too large");
      }
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > 65_536) {
        throw new LaunchKernelError("provider_unavailable", "Wallet broker response is too large");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new LaunchKernelError("provider_unavailable", "Wallet broker did not return JSON");
      }
      assertNoSecretFields(parsed);
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403
          ? "Wallet broker authentication failed"
          : `Wallet broker request failed with HTTP ${response.status}`;
        throw new LaunchKernelError("provider_unavailable", message);
      }
      const outer = record(parsed, "response");
      return record(Object.prototype.hasOwnProperty.call(outer, "data") ? outer.data : outer, "response data");
    } catch (error) {
      if (error instanceof LaunchKernelError) throw error;
      throw new LaunchKernelError("provider_unavailable", "Wallet broker is temporarily unavailable", error);
    } finally {
      clearTimeout(timer);
    }
  }
}
