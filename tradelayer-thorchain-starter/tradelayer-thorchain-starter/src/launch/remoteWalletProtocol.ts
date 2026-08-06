import { LaunchKernelError } from "./errors.js";
import { validateBitcoinAddress } from "./bitcoin.js";
import type { BitAgentWorkflowState, LaunchErrorCode } from "./types.js";

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
