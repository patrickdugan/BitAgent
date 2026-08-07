import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeTradeLayerActivationScript,
  observeTradeLayerBitcoinActivation,
  verifyTradeLayerBitcoinActivationProof,
  type BitcoinRpcCall
} from "../src/launch/tradelayerBitcoinActivation.js";
import type { TradeLayerListenerObservation } from "../src/launch/tradelayerListenerPreflight.js";

const CODE_HASH = "ab".repeat(32);
const TXID = "78".repeat(32);
const BLOCK_HASH = "56".repeat(32);
const BEST_BLOCK_HASH = "34".repeat(32);
const NOW = new Date("2026-08-06T12:00:00.000Z");

function activationScript(txTypes = [0, 11], codeHash = CODE_HASH): string {
  const payload = Buffer.from(`tl0${txTypes.join(";")},${BigInt(`0x${codeHash}`).toString(36)}`, "ascii");
  if (payload.length > 75) throw new Error("fixture payload unexpectedly requires PUSHDATA1");
  return Buffer.concat([Buffer.from([0x6a, payload.length]), payload]).toString("hex");
}

function observation(): TradeLayerListenerObservation {
  return {
    observationHash: "12".repeat(32),
    listener: { nodeId: "listener-a" },
    bitcoinBackend: { chain: "testnet4", bestBlockHash: BEST_BLOCK_HASH, blocks: 100 },
    tx11: {
      active: true,
      activationBlock: 7,
      codeHash: CODE_HASH,
      activationSource: { kind: "bitcoin_transaction", chainDerived: true, txid: TXID, blockHeight: 7 }
    }
  } as TradeLayerListenerObservation;
}

function rpc(input: {
  confirmations?: number;
  txid?: string;
  scriptHex?: string;
  chain?: string;
  bestBlockHash?: string;
  initialBlockDownload?: boolean;
} = {}): BitcoinRpcCall {
  return async (method, params) => {
    if (method === "getblockchaininfo") {
      assert.deepEqual(params, []);
      return {
        chain: input.chain || "testnet4",
        blocks: 100,
        bestblockhash: input.bestBlockHash || BEST_BLOCK_HASH,
        initialblockdownload: input.initialBlockDownload === true
      };
    }
    if (method === "getblockhash") {
      assert.deepEqual(params, [7]);
      return BLOCK_HASH;
    }
    if (method === "getblockheader") {
      assert.deepEqual(params, [BLOCK_HASH, true]);
      return { hash: BLOCK_HASH, height: 7, confirmations: input.confirmations ?? 9 };
    }
    if (method === "getrawtransaction") {
      assert.deepEqual(params, [TXID, true, BLOCK_HASH]);
      return {
        txid: input.txid || TXID,
        blockhash: BLOCK_HASH,
        vout: [{ scriptPubKey: { type: "nulldata", hex: input.scriptHex || activationScript() } }]
      };
    }
    throw new Error(`unexpected RPC method ${method}`);
  };
}

test("canonical TradeLayer tx0 payload normalizes the base36 code hash", () => {
  const decoded = decodeTradeLayerActivationScript(activationScript());
  assert.match(decoded.payloadHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(decoded.activatedTxTypes, [0, 11]);
  assert.equal(decoded.codeHash, CODE_HASH);
});

test("read-only Bitcoin Core observation binds tx11 activation to an active block", async () => {
  const proof = await observeTradeLayerBitcoinActivation({
    observation: observation(),
    expectedCodeHash: CODE_HASH,
    sourceRpcEndpoint: "http://127.0.0.1:49372",
    rpcCall: rpc(),
    now: NOW
  });
  assert.equal(proof.authority, "read_only_bitcoin_observer");
  assert.equal(proof.effect, "none");
  assert.equal(proof.txid, TXID);
  assert.equal(proof.blockHash, BLOCK_HASH);
  assert.equal(proof.observedBestBlockHash, BEST_BLOCK_HASH);
  assert.equal(proof.observedBestBlockHeight, 100);
  assert.equal(proof.codeHash, CODE_HASH);
  assert.equal(proof.capturedAt, NOW.toISOString());
  assert.equal(verifyTradeLayerBitcoinActivationProof(proof), true);

  const tampered = structuredClone(proof);
  tampered.confirmations = 10;
  assert.equal(verifyTradeLayerBitcoinActivationProof(tampered), false);
});

test("inactive blocks, mismatched transactions, and absent tx11 payloads fail closed", async () => {
  for (const rpcCall of [
    rpc({ confirmations: -1 }),
    rpc({ txid: "90".repeat(32) }),
    rpc({ scriptHex: activationScript([0]) })
  ]) {
    await assert.rejects(() => observeTradeLayerBitcoinActivation({
      observation: observation(),
      expectedCodeHash: CODE_HASH,
      sourceRpcEndpoint: "http://127.0.0.1:49372",
      rpcCall,
      now: NOW
    }));
  }
});

test("wrong-chain, IBD, or listener-tip-divergent Bitcoin RPC sources fail closed", async () => {
  for (const rpcCall of [
    rpc({ chain: "main" }),
    rpc({ initialBlockDownload: true }),
    rpc({ bestBlockHash: "aa".repeat(32) })
  ]) {
    await assert.rejects(() => observeTradeLayerBitcoinActivation({
      observation: observation(),
      expectedCodeHash: CODE_HASH,
      sourceRpcEndpoint: "http://127.0.0.1:49372",
      rpcCall,
      now: NOW
    }), /chain status does not match/);
  }
});

test("non-canonical scripts and unsafe RPC endpoints are rejected", async () => {
  const payload = Buffer.from(`tl011,${BigInt(`0x${CODE_HASH}`).toString(36)}`, "ascii");
  const nonCanonical = Buffer.concat([Buffer.from([0x6a, 0x4c, payload.length]), payload]).toString("hex");
  assert.throws(() => decodeTradeLayerActivationScript(nonCanonical), /non-canonical PUSHDATA1/);
  await assert.rejects(() => observeTradeLayerBitcoinActivation({
    observation: observation(),
    expectedCodeHash: CODE_HASH,
    sourceRpcEndpoint: "http://operator:secret@127.0.0.1:49372",
    rpcCall: rpc(),
    now: NOW
  }), /without a path/);
});
