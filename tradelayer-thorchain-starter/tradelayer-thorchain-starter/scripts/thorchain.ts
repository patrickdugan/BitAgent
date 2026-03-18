import * as dotenv from "dotenv";
dotenv.config();

export type QuoteResponse = {
  inbound_address: string;
  memo: string;
  recommended_min_amount_in?: string;
  expiry?: number;
  fees?: {
    asset: string;
    affiliate: string;
    outbound: string;
    liquidity: string;
    total: string;
    total_bps: number;
    slippage_bps: number;
  };
  router?: string;
};

export type InboundAddress = {
  chain: string;
  address: string;
  router?: string;
  gas_rate: string;
  halted: boolean;
};

export const THORNODE_URL = process.env.THORNODE_URL || "https://thornode.ninerealms.com";

export async function getInboundAddress(chain: string): Promise<InboundAddress> {
  const res = await fetch(`${THORNODE_URL}/thorchain/inbound_addresses`);
  if (!res.ok) throw new Error(`inbound_addresses failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as InboundAddress[];
  const entry = data.find((x) => x.chain.toUpperCase() === chain.toUpperCase());
  if (!entry) throw new Error(`No inbound address for chain ${chain}`);
  if (entry.halted) throw new Error(`THORChain reports ${chain} as halted`);
  return entry;
}

export async function getSwapQuote(args: {
  fromAsset: string;
  toAsset: string;
  amount1e8: string;
  destination: string;
  affiliate?: string;
  affiliateBps?: string;
  streamingInterval?: string;
  streamingQuantity?: string;
}) {
  const params = new URLSearchParams({
    from_asset: args.fromAsset,
    to_asset: args.toAsset,
    amount: args.amount1e8,
    destination: args.destination,
    streaming_interval: args.streamingInterval || "1",
    streaming_quantity: args.streamingQuantity || "0"
  });

  if (args.affiliate && args.affiliateBps && args.affiliateBps !== "0") {
    params.set("affiliate", args.affiliate);
    params.set("affiliate_bps", args.affiliateBps);
  }

  const res = await fetch(`${THORNODE_URL}/thorchain/quote/swap?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`swap quote failed: ${res.status} ${body}`);
  }
  return (await res.json()) as QuoteResponse;
}

export function toThorchain1e8(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const native = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
  if (decimals === 8) return native;
  if (decimals > 8) return native / 10n ** BigInt(decimals - 8);
  return native * 10n ** BigInt(8 - decimals);
}

export function fromTokenUnits(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}
