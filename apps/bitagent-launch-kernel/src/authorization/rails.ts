import crypto from "node:crypto";

import { AuthorizationError } from "./canonical.js";
import type { AmountUnit, AuthorizationInstrument, OnchainChain, OnchainNetwork } from "./types.js";

type Code = AuthorizationError["code"];

const ADDRESS_PARAMETERS: Record<string, { hrp: string; base58Versions: number[] }> = {
  "bitcoin:mainnet": { hrp: "bc", base58Versions: [0x00, 0x05] },
  "bitcoin:testnet": { hrp: "tb", base58Versions: [0x6f, 0xc4] },
  "bitcoin:testnet4": { hrp: "tb", base58Versions: [0x6f, 0xc4] },
  "bitcoin:signet": { hrp: "tb", base58Versions: [0x6f, 0xc4] },
  "bitcoin:regtest": { hrp: "bcrt", base58Versions: [0x6f, 0xc4] },
  "litecoin:mainnet": { hrp: "ltc", base58Versions: [0x30, 0x32, 0x05] },
  "litecoin:testnet": { hrp: "tltc", base58Versions: [0x6f, 0x3a, 0xc4] },
  "litecoin:regtest": { hrp: "rltc", base58Versions: [0x6f, 0x3a, 0xc4] }
};

export function supportsOnchainNetwork(chain: OnchainChain, network: OnchainNetwork): boolean {
  return Boolean(ADDRESS_PARAMETERS[`${chain}:${network}`]);
}

// ---- bech32 / bech32m (BIP173, BIP350) ----------------------------------------------------

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32M_CONSTANT = 0x2bc830a3;

function polymod(values: number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let bit = 0; bit < 5; bit += 1) if ((top >>> bit) & 1) checksum ^= BECH32_GENERATOR[bit];
  }
  return checksum;
}

function expandHrp(hrp: string): number[] {
  const codes = [...hrp].map((character) => character.charCodeAt(0));
  return [...codes.map((code) => code >> 5), 0, ...codes.map((code) => code & 31)];
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  const maxValue = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from) return null;
    accumulator = (accumulator << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      result.push((accumulator >> bits) & maxValue);
    }
  }
  if (pad) {
    if (bits) result.push((accumulator << (to - bits)) & maxValue);
  } else if (bits >= from || ((accumulator << (to - bits)) & maxValue)) {
    return null;
  }
  return result;
}

function isSegwitAddress(address: string, expectedHrp: string): boolean {
  if (address.length > 90) return false;
  const lower = address.toLowerCase();
  if (address !== lower && address !== address.toUpperCase()) return false;
  const separator = lower.lastIndexOf("1");
  if (separator < 1 || separator + 7 > lower.length || lower.slice(0, separator) !== expectedHrp) return false;
  const data: number[] = [];
  for (const character of lower.slice(separator + 1)) {
    const index = BECH32_CHARSET.indexOf(character);
    if (index < 0) return false;
    data.push(index);
  }
  const version = data[0];
  if (version > 16) return false;
  const expected = version === 0 ? 1 : BECH32M_CONSTANT;
  if (polymod([...expandHrp(expectedHrp), ...data]) !== expected) return false;
  const program = convertBits(data.slice(1, -6), 5, 8, false);
  if (!program || program.length < 2 || program.length > 40) return false;
  return version !== 0 || program.length === 20 || program.length === 32;
}

/** Encodes a segwit address. Used by tooling and tests to build destinations. */
export function encodeSegwitAddress(hrp: string, version: number, program: Uint8Array): string {
  const converted = convertBits([...program], 8, 5, true);
  if (!converted || version < 0 || version > 16) throw new AuthorizationError("invalid_configuration", "invalid witness program");
  const data = [version, ...converted];
  const constant = version === 0 ? 1 : BECH32M_CONSTANT;
  const mod = polymod([...expandHrp(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ constant;
  const checksum = Array.from({ length: 6 }, (_, index) => (mod >> (5 * (5 - index))) & 31);
  return `${hrp}1${[...data, ...checksum].map((value) => BECH32_CHARSET[value]).join("")}`;
}

// ---- base58check --------------------------------------------------------------------------

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58CheckVersion(address: string): number | null {
  if (address.length < 26 || address.length > 35) return null;
  let value = 0n;
  for (const character of address) {
    const index = BASE58_ALPHABET.indexOf(character);
    if (index < 0) return null;
    value = value * 58n + BigInt(index);
  }
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const leadingZeros = address.length - address.replace(/^1+/, "").length;
  const raw = Buffer.concat([Buffer.alloc(leadingZeros), value === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex")]);
  if (raw.length !== 25) return null;
  const payload = raw.subarray(0, 21);
  const digest = crypto.createHash("sha256").update(crypto.createHash("sha256").update(payload).digest()).digest();
  return digest.subarray(0, 4).equals(raw.subarray(21)) ? payload[0] : null;
}

/**
 * Validates an address for the instrument's chain and network and returns its canonical
 * spelling (bech32 lowercased; base58 unchanged). Mixed-case bech32 is rejected.
 */
export function normalizeOnchainAddress(chain: OnchainChain, network: OnchainNetwork, address: string, code: Code): string {
  const parameters = ADDRESS_PARAMETERS[`${chain}:${network}`];
  if (!parameters) throw new AuthorizationError(code, `${chain} ${network} is not a supported network`);
  if (typeof address !== "string" || address.length < 14 || address.length > 90) {
    throw new AuthorizationError(code, "address has an invalid length");
  }
  if (address.toLowerCase().startsWith(`${parameters.hrp}1`)) {
    if (!isSegwitAddress(address, parameters.hrp)) throw new AuthorizationError(code, "address fails bech32 validation");
    return address.toLowerCase();
  }
  const version = base58CheckVersion(address);
  if (version === null || !parameters.base58Versions.includes(version)) {
    throw new AuthorizationError(code, `address is not a valid ${chain} ${network} address`);
  }
  return address;
}

// ---- Lightning and card identifiers -------------------------------------------------------

const NODE_ID = /^0[23][0-9a-f]{64}$/;

/** Format check only; the host's Lightning node verifies invoice signatures against this key. */
export function normalizeNodeId(value: unknown, label: string, code: Code): string {
  if (typeof value !== "string" || !NODE_ID.test(value.toLowerCase())) {
    throw new AuthorizationError(code, `${label} must be a 33-byte compressed public key in hex`);
  }
  return value.toLowerCase();
}

export const MERCHANT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export const MCC = /^[0-9]{4}$/;
export const CURRENCY = /^[A-Z]{3}$/;

/** Rejects anything shaped like a primary account number so PANs never enter a signed receipt. */
export function looksLikePan(value: string): boolean {
  return /^[0-9]{12,19}$/.test(value.replace(/[ -]/g, ""));
}

export function expectedAmountUnit(instrument: AuthorizationInstrument): { asset: string; unit: AmountUnit } {
  if (instrument.rail === "card") return { asset: instrument.currency, unit: "minor" };
  if (instrument.rail === "lightning") return { asset: "BTC", unit: "msat" };
  return { asset: instrument.chain === "bitcoin" ? "BTC" : "LTC", unit: "sat" };
}
