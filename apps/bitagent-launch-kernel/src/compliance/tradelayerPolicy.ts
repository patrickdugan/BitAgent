import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { externalRepos } from "../config.js";
import { complianceHash } from "./policy.js";
import type { ProductCategory } from "./types.js";

export type TradeLayerValidityPolicyManifest = {
  schema: "bitagent_tradelayer_validity_policy_manifest_v1";
  authority: "tradelayer_validity_js";
  effect: "none";
  policy_version: string;
  validity_file: string;
  validity_sha256: string;
  clearlist_file: string;
  clearlist_sha256: string;
  source_hash: string;
  fallback_banned_countries: string[];
  country_attestation_list_id: 0;
  country_attestation_kind: "SELF_CERTIFIED_TWO_LETTER_CODE";
  contract_trading_rule_detected: boolean;
  dynamic_banlist_reader: "PRESENT" | "KNOWN_ARRAY_SHAPE_BUG";
};

export type TradeLayerJurisdictionSnapshot = {
  schema: "bitagent_tradelayer_jurisdiction_snapshot_v1";
  status: "OK" | "UNKNOWN" | "ERROR";
  wallet_address: string;
  country_code?: string;
  country_attestation_block?: number | null;
  effective_banlist?: string[];
  observed_at: string;
  source_id: string;
  source_receipt_hash?: string;
};

export type TradeLayerProtocolPolicyReceipt = {
  schema: "bitagent_tradelayer_protocol_policy_receipt_v1";
  authority: "tradelayer_validity_js";
  effect: "none";
  status: "ALLOW" | "REQUIRE_REVIEW" | "BLOCK";
  product: ProductCategory;
  wallet_address_hash: string;
  country_code: string | null;
  effective_banlist: string[];
  policy_version: string;
  source_hash: string;
  snapshot_receipt_hash: string | null;
  reason_codes: string[];
  receipt_hash: string;
};

const COUNTRY = /^[A-Z]{2}$/;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeCountries(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const values = [...new Set(input.map((value) => String(value).trim().toUpperCase()))];
  return values.length > 0 && values.every((value) => COUNTRY.test(value)) ? values.sort() : null;
}

function parseFallbackBanlist(source: string): string[] {
  const match = source.match(/const\s+bannedCountries\s*=\s*\[([^\]]*)\]\s*;/);
  if (!match) throw new Error("TradeLayer validity.js fallback bannedCountries constant was not found");
  const tokens = [...match[1]!.matchAll(/["']([A-Za-z]{2})["']/g)].map((item) => item[1]);
  const normalized = normalizeCountries(tokens);
  if (!normalized) throw new Error("TradeLayer validity.js fallback ban list is invalid");
  const residue = match[1]!.replace(/["'][A-Za-z]{2}["']/g, "").replace(/[\s,]/g, "");
  if (residue) throw new Error("TradeLayer validity.js fallback ban list contains an unsupported expression");
  return normalized;
}

export async function readTradeLayerValidityPolicyManifest(
  repoPath = externalRepos.tradelayer
): Promise<TradeLayerValidityPolicyManifest> {
  const validityFile = path.resolve(repoPath, "src", "validity.js");
  const clearlistFile = path.resolve(repoPath, "src", "clearlist.js");
  const [validitySource, clearlistSource] = await Promise.all([
    fs.readFile(validityFile, "utf8"),
    fs.readFile(clearlistFile, "utf8")
  ]);
  const fallback = parseFallbackBanlist(validitySource);
  const contractRuleDetected = /ClearList\.getBanlist\(\)/.test(validitySource)
    && /ClearList\.getCountryCodeByAddress\(sender\)/.test(validitySource)
    && /cannot trade contracts from a banned country or lacking country code attestation/.test(validitySource);
  if (!contractRuleDetected) {
    throw new Error("TradeLayer contract jurisdiction rule could not be verified in validity.js");
  }
  const hasBanlistReader = /static\s+async\s+getBanlist\s*\(/.test(clearlistSource);
  if (!hasBanlistReader || !/static\s+async\s+getCountryCodeByAddress\s*\(/.test(clearlistSource)) {
    throw new Error("TradeLayer clearlist jurisdiction readers could not be verified");
  }
  const knownArrayBug = /findAsync\(\{\s*_id:\s*['"]globalBanlist['"]\s*\}\)[\s\S]{0,180}return\s+banlist\.data/.test(clearlistSource);
  const validitySha = sha256(validitySource);
  const clearlistSha = sha256(clearlistSource);
  const sourceHash = complianceHash({ validitySha, clearlistSha, fallback, contractRuleDetected });
  return {
    schema: "bitagent_tradelayer_validity_policy_manifest_v1",
    authority: "tradelayer_validity_js",
    effect: "none",
    policy_version: `tradelayer-validity-${sourceHash.slice(0, 16)}`,
    validity_file: validityFile,
    validity_sha256: validitySha,
    clearlist_file: clearlistFile,
    clearlist_sha256: clearlistSha,
    source_hash: sourceHash,
    fallback_banned_countries: fallback,
    country_attestation_list_id: 0,
    country_attestation_kind: "SELF_CERTIFIED_TWO_LETTER_CODE",
    contract_trading_rule_detected: true,
    dynamic_banlist_reader: knownArrayBug ? "KNOWN_ARRAY_SHAPE_BUG" : "PRESENT"
  };
}

export function evaluateTradeLayerProtocolPolicy(input: {
  manifest: TradeLayerValidityPolicyManifest;
  snapshot: TradeLayerJurisdictionSnapshot;
  product: ProductCategory;
  expected_current_location_country?: string;
}): TradeLayerProtocolPolicyReceipt {
  const country = String(input.snapshot.country_code || "").trim().toUpperCase();
  const effective = input.snapshot.effective_banlist === undefined
    ? input.manifest.fallback_banned_countries
    : normalizeCountries(input.snapshot.effective_banlist);
  const reasons: string[] = [];
  let status: TradeLayerProtocolPolicyReceipt["status"] = "REQUIRE_REVIEW";

  if (input.snapshot.status !== "OK") {
    reasons.push(`TRADELAYER_JURISDICTION_SNAPSHOT_${input.snapshot.status}`);
  } else if (!COUNTRY.test(country)) {
    reasons.push("TRADELAYER_COUNTRY_ATTESTATION_MISSING_OR_INVALID");
  } else if (!effective) {
    reasons.push("TRADELAYER_BANLIST_INVALID");
  } else if (input.expected_current_location_country
    && input.expected_current_location_country.trim().toUpperCase() !== country) {
    reasons.push("TRADELAYER_ATTESTATION_LOCATION_MISMATCH");
  } else if (effective.includes(country)) {
    status = "BLOCK";
    reasons.push("TRADELAYER_COUNTRY_BANNED");
  } else {
    status = "ALLOW";
    reasons.push("TRADELAYER_PROTOCOL_JURISDICTION_RULE_PASSED", "NOT_A_LEGAL_PERMISSION");
  }

  const material = {
    schema: "bitagent_tradelayer_protocol_policy_receipt_v1" as const,
    authority: "tradelayer_validity_js" as const,
    effect: "none" as const,
    status,
    product: input.product,
    wallet_address_hash: complianceHash(input.snapshot.wallet_address),
    country_code: COUNTRY.test(country) ? country : null,
    effective_banlist: effective || [],
    policy_version: input.manifest.policy_version,
    source_hash: input.manifest.source_hash,
    snapshot_receipt_hash: input.snapshot.source_receipt_hash || null,
    reason_codes: reasons
  };
  return { ...material, receipt_hash: complianceHash(material) };
}
