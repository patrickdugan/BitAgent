import type { SupportedIntent } from "./types.js";

const SECRET_PATTERNS = [
  /\b(seed phrase|mnemonic|private key|wif)\b/i,
  /\b(?:[a-z]+\s+){11,23}[a-z]+\b/i,
  /\b[KL5][1-9A-HJ-NP-Za-km-z]{50,51}\b/
];

export function containsSecretMaterial(text: string) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function identifyIntent(text: string): SupportedIntent | "unsupported" {
  const normalized = text.toLowerCase();
  if (/\b(autonomous|autonomously|every asset|all assets|portfolio optimization|leverage|options|perpetual|second strategy|new strategy|another strategy)\b/.test(normalized)) {
    return "unsupported";
  }
  if (/\b(withdraw|send back|cash out|send my bitcoin)\b/.test(normalized)) return "withdraw_bitcoin";
  if (/\b(strategy|starter strategy|use (part|some|my)|put .* bitcoin)\b/.test(normalized)) {
    return "starter_strategy";
  }
  if (/\b(deposit|receive bitcoin|fund (my )?wallet|bitcoin address)\b/.test(normalized)) {
    return "deposit_bitcoin";
  }
  return "unsupported";
}

export function extractAmountSats(text: string): string | undefined {
  const sats = text.match(/\b(\d[\d,_]*)\s*(?:sat|sats|satoshi|satoshis)\b/i);
  if (sats) return BigInt(sats[1].replace(/[,_]/g, "")).toString();
  const btc = text.match(/\b(\d+(?:\.\d{1,8})?)\s*(?:btc|bitcoin)\b/i);
  if (!btc) return undefined;
  const [whole, fraction = ""] = btc[1].split(".");
  return (BigInt(whole) * 100000000n + BigInt((fraction + "00000000").slice(0, 8))).toString();
}

export function extractBitcoinAddress(text: string) {
  return text.match(/\b(?:bc1|tb1)[a-zA-HJ-NP-Z0-9]{20,90}\b/i)?.[0]
    || text.match(/\b[123mn][1-9A-HJ-NP-Za-km-z]{24,61}\b/)?.[0];
}
