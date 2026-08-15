import { getUtxoRefExports } from "../adapters/utxoRefAdapter.js";
import { LaunchKernelError } from "./errors.js";
import type { BitcoinDepositState, PublicWalletConnection } from "./types.js";

type ObserveInput = {
  workflowId: string;
  wallet: PublicWalletConnection;
  address: string;
  scriptPubKeyHex: string;
  txid: string;
  vout: number;
  amountSats: string;
  blockHeight: number | null;
  currentHeight: number;
  requiredConfirmations: number;
  now: Date;
};

function validate(input: ObserveInput) {
  if (!/^[0-9a-f]{64}$/i.test(input.txid)) throw new Error("txid must be 32-byte hex");
  if (!Number.isInteger(input.vout) || input.vout < 0) throw new Error("vout must be non-negative");
  if (!/^[0-9a-f]+$/i.test(input.scriptPubKeyHex) || input.scriptPubKeyHex.length % 2) {
    throw new Error("scriptPubKeyHex must be even-length hex");
  }
  if (BigInt(input.amountSats) <= 0n) throw new Error("amountSats must be positive");
  if (!Number.isInteger(input.currentHeight) || input.currentHeight < 0) {
    throw new Error("currentHeight must be non-negative");
  }
}

export function observeBitcoinDeposit(input: ObserveInput): BitcoinDepositState {
  try {
    validate(input);
    const utxoRef = getUtxoRefExports();
    const indexer = new utxoRef.ReceiptDepositIndexer({
      network: input.wallet.network,
      minConfirmations: input.requiredConfirmations
    });
    const depositId = `${input.workflowId}:${input.txid}:${input.vout}`;
    const record = indexer.observeDeposit({
      depositId,
      accountId: input.wallet.walletSessionId || input.workflowId,
      txid: input.txid.toLowerCase(),
      vout: input.vout,
      amountSats: input.amountSats,
      blockHeight: input.blockHeight,
      targetScriptPubKey: input.scriptPubKeyHex.toLowerCase()
    }, input.currentHeight);

    let fundingRoot: string | undefined;
    if (record.status === "confirmed") {
      indexer.buildLedgerCreditEvent(depositId);
      const fundingSet = utxoRef.v2.settlement.buildFundingSetV2([{
        txid: record.txid,
        vout: record.vout,
        amountSats: record.amountSats,
        scriptPubKeyHex: input.scriptPubKeyHex
      }]);
      fundingRoot = fundingSet.fundingRoot;
    }

    return {
      status: record.status === "confirmed" ? "confirmed" : "unconfirmed",
      address: input.address,
      scriptPubKeyHex: input.scriptPubKeyHex.toLowerCase(),
      txid: record.txid,
      vout: record.vout,
      amountSats: record.amountSats.toString(),
      blockHeight: record.blockHeight,
      confirmations: record.confirmations,
      requiredConfirmations: input.requiredConfirmations,
      utxoRef: fundingRoot,
      observedAt: input.now.toISOString()
    };
  } catch (error) {
    throw new LaunchKernelError("validation_error", "UTXO-Ref rejected the Bitcoin deposit observation", error);
  }
}
