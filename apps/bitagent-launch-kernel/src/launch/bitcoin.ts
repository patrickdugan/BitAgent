import crypto from "node:crypto";
import { LaunchKernelError } from "./errors.js";

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < 5; index++) {
      if ((top >>> index) & 1) checksum ^= generators[index];
    }
  }
  return checksum >>> 0;
}

function expandHrp(hrp: string) {
  return [
    ...Array.from(hrp, (character) => character.charCodeAt(0) >>> 5),
    0,
    ...Array.from(hrp, (character) => character.charCodeAt(0) & 31)
  ];
}

function convertBits(values: number[], from: number, to: number, pad: boolean) {
  let accumulator = 0;
  let bits = 0;
  const output: number[] = [];
  const maxValue = (1 << to) - 1;
  for (const value of values) {
    if (value < 0 || value >>> from !== 0) throw new Error("invalid base conversion value");
    accumulator = (accumulator << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      output.push((accumulator >>> bits) & maxValue);
    }
  }
  if (pad) {
    if (bits) output.push((accumulator << (to - bits)) & maxValue);
  } else if (bits >= from || ((accumulator << (to - bits)) & maxValue)) {
    throw new Error("invalid base conversion padding");
  }
  return output;
}

function decodeBech32(address: string) {
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
    throw new Error("mixed-case bech32 address");
  }
  const normalized = address.toLowerCase();
  const separator = normalized.lastIndexOf("1");
  if (separator < 1 || separator + 7 > normalized.length || normalized.length > 90) {
    throw new Error("invalid bech32 separator or length");
  }
  const hrp = normalized.slice(0, separator);
  const data = Array.from(normalized.slice(separator + 1), (character) => {
    const value = BECH32.indexOf(character);
    if (value < 0) throw new Error("invalid bech32 character");
    return value;
  });
  const check = polymod([...expandHrp(hrp), ...data]);
  const encoding = check === BECH32_CONST ? "bech32" : check === BECH32M_CONST ? "bech32m" : null;
  if (!encoding) throw new Error("invalid bech32 checksum");
  const payload = data.slice(0, -6);
  const version = payload[0];
  if (version === undefined || version > 16) throw new Error("invalid witness version");
  const program = Buffer.from(convertBits(payload.slice(1), 5, 8, false));
  if (program.length < 2 || program.length > 40) throw new Error("invalid witness program length");
  if (version === 0 && ![20, 32].includes(program.length)) throw new Error("invalid v0 program length");
  if (version === 0 && encoding !== "bech32") throw new Error("v0 requires bech32 checksum");
  if (version > 0 && encoding !== "bech32m") throw new Error("v1+ requires bech32m checksum");
  return { hrp, version, program };
}

function decodeBase58(address: string) {
  let value = 0n;
  for (const character of address) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) throw new Error("invalid base58 character");
    value = value * 58n + BigInt(digit);
  }
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let decoded = hex ? Buffer.from(hex, "hex") : Buffer.alloc(0);
  let leading = 0;
  while (address[leading] === "1") leading++;
  decoded = Buffer.concat([Buffer.alloc(leading), decoded]);
  if (decoded.length !== 25) throw new Error("invalid base58 address length");
  const body = decoded.subarray(0, 21);
  const expected = decoded.subarray(21);
  const checksum = crypto.createHash("sha256")
    .update(crypto.createHash("sha256").update(body).digest())
    .digest()
    .subarray(0, 4);
  if (!checksum.equals(expected)) throw new Error("invalid base58 checksum");
  return { version: body[0], hash: body.subarray(1) };
}

export function validateBitcoinAddress(
  address: string,
  network: "bitcoin" | "bitcoin-testnet4"
) {
  try {
    if (/^(bc1|tb1)/i.test(address)) {
      const decoded = decodeBech32(address);
      const expectedHrp = network === "bitcoin" ? "bc" : "tb";
      if (decoded.hrp !== expectedHrp) throw new Error("address network mismatch");
      const opcode = decoded.version === 0 ? 0 : 0x50 + decoded.version;
      return {
        address: address.toLowerCase(),
        network,
        type: decoded.version === 1 && decoded.program.length === 32 ? "p2tr" : `witness_v${decoded.version}`,
        scriptPubKeyHex: Buffer.concat([
          Buffer.from([opcode, decoded.program.length]),
          decoded.program
        ]).toString("hex")
      };
    }

    const decoded = decodeBase58(address);
    const versions = network === "bitcoin" ? [0, 5] : [111, 196];
    if (!versions.includes(decoded.version)) throw new Error("address network mismatch");
    const p2sh = decoded.version === versions[1];
    return {
      address,
      network,
      type: p2sh ? "p2sh" : "p2pkh",
      scriptPubKeyHex: p2sh
        ? `a914${decoded.hash.toString("hex")}87`
        : `76a914${decoded.hash.toString("hex")}88ac`
    };
  } catch (error) {
    throw new LaunchKernelError(
      "malformed_address",
      `Invalid ${network === "bitcoin" ? "Bitcoin mainnet" : "Bitcoin testnet4"} address`,
      error
    );
  }
}

export function encodeSegwitAddress(
  program: Buffer,
  network: "bitcoin" | "bitcoin-testnet4",
  version = 0
) {
  const hrp = network === "bitcoin" ? "bc" : "tb";
  const values = [version, ...convertBits([...program], 8, 5, true)];
  const constant = version === 0 ? BECH32_CONST : BECH32M_CONST;
  const checkInput = [...expandHrp(hrp), ...values, 0, 0, 0, 0, 0, 0];
  const mod = polymod(checkInput) ^ constant;
  const checksum = Array.from({ length: 6 }, (_, index) => (mod >>> (5 * (5 - index))) & 31);
  return `${hrp}1${[...values, ...checksum].map((value) => BECH32[value]).join("")}`;
}
