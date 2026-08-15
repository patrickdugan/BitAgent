import type { BitcoinCoreBrokerRpc } from "./types.js";

type WalletUtxo = {
  address?: string;
  amount?: number;
  spendable?: boolean;
  solvable?: boolean;
  safe?: boolean;
};

type LockedOutpoint = { txid?: string; vout?: number };

export type Testnet4WalletSnapshot = {
  schema: "bitagent_testnet4_wallet_readonly_snapshot_v1";
  observedAt: string;
  authority: "read_only_observer";
  effect: "none";
  chain: {
    network: string;
    height: number;
    headers: number;
    initialBlockDownload: boolean;
    verificationProgress: number;
  };
  wallet: {
    name: string;
    privateKeysEnabled: boolean;
    descriptors: boolean;
    confirmedBalanceSats: string;
    unconfirmedBalanceSats: string;
    txcount: number;
  };
  protocolAdmin: {
    isMine: boolean;
    isWatchOnly: boolean;
    solvable: boolean;
  };
  locks: {
    count: number;
    trackedOutpointLocked?: boolean;
  };
  available: {
    safeConfirmedCount: number;
    adminUtxoCount: number;
    adminSats: string;
    nonAdminUtxoCount: number;
    nonAdminSats: string;
  };
  secretMaterialRead: false;
  signingPerformed: false;
  broadcastPerformed: false;
};

function btcToSats(value: unknown): bigint {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error("Bitcoin wallet snapshot contains an invalid amount");
  }
  return BigInt(Math.round(number * 100_000_000));
}

export async function inspectTestnet4Wallet(input: {
  rpc: BitcoinCoreBrokerRpc;
  wallet: string;
  protocolAdminAddress: string;
  trackedOutpoint?: { txid: string; vout: number };
}): Promise<Testnet4WalletSnapshot> {
  const [chain, wallet, balances, admin, locks, utxos] = await Promise.all([
    input.rpc.call<Record<string, unknown>>("getblockchaininfo"),
    input.rpc.call<Record<string, unknown>>("getwalletinfo"),
    input.rpc.call<Record<string, unknown>>("getbalances"),
    input.rpc.call<Record<string, unknown>>(
      "getaddressinfo",
      input.protocolAdminAddress
    ),
    input.rpc.call<LockedOutpoint[]>("listlockunspent"),
    input.rpc.call<WalletUtxo[]>("listunspent", 1, 9_999_999, [], false),
  ]);
  const safe = utxos.filter(
    (utxo) =>
      utxo.spendable !== false &&
      utxo.solvable !== false &&
      utxo.safe !== false
  );
  const adminUtxos = safe.filter(
    (utxo) => utxo.address === input.protocolAdminAddress
  );
  const nonAdminUtxos = safe.filter(
    (utxo) => utxo.address !== input.protocolAdminAddress
  );
  const sum = (items: WalletUtxo[]) =>
    items.reduce((total, item) => total + btcToSats(item.amount), 0n).toString();
  const trackedOutpointLocked = input.trackedOutpoint
    ? locks.some(
        (outpoint) =>
          outpoint.txid === input.trackedOutpoint?.txid &&
          outpoint.vout === input.trackedOutpoint?.vout
      )
    : undefined;
  const mine = (balances.mine || {}) as Record<string, unknown>;

  return {
    schema: "bitagent_testnet4_wallet_readonly_snapshot_v1",
    observedAt: new Date().toISOString(),
    authority: "read_only_observer",
    effect: "none",
    chain: {
      network: String(chain.chain || ""),
      height: Number(chain.blocks || 0),
      headers: Number(chain.headers || 0),
      initialBlockDownload: chain.initialblockdownload === true,
      verificationProgress: Number(chain.verificationprogress || 0),
    },
    wallet: {
      name: input.wallet,
      privateKeysEnabled: wallet.private_keys_enabled === true,
      descriptors: wallet.descriptors === true,
      confirmedBalanceSats: btcToSats(mine.trusted).toString(),
      unconfirmedBalanceSats: btcToSats(mine.untrusted_pending).toString(),
      txcount: Number(wallet.txcount || 0),
    },
    protocolAdmin: {
      isMine: admin.ismine === true,
      isWatchOnly: admin.iswatchonly === true,
      solvable: admin.solvable === true,
    },
    locks: {
      count: locks.length,
      ...(trackedOutpointLocked === undefined ? {} : { trackedOutpointLocked }),
    },
    available: {
      safeConfirmedCount: safe.length,
      adminUtxoCount: adminUtxos.length,
      adminSats: sum(adminUtxos),
      nonAdminUtxoCount: nonAdminUtxos.length,
      nonAdminSats: sum(nonAdminUtxos),
    },
    secretMaterialRead: false,
    signingPerformed: false,
    broadcastPerformed: false,
  };
}
