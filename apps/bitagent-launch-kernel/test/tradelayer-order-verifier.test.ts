import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  observeStarterTradeLayerOrder,
  RelayerTradeLayerOrderReadSource,
  verifyTradeLayerOrderObservation,
  type StarterOrderExpectation,
  type TradeLayerOrderReadSource
} from "../src/settlement/tradelayerOrderVerifier.js";

const txid = "ab".repeat(32);
const checkedAt = new Date("2026-08-06T07:00:00.000Z");
const expected: StarterOrderExpectation = {
  txid,
  address: "tb1q-order-owner",
  offeredPropertyId: 1,
  desiredPropertyId: 2,
  amountOffered: "0.001",
  amountExpected: "65",
  postOnly: true
};

class FixtureSource implements TradeLayerOrderReadSource {
  readonly source = "fixture-tradelayer-listener";

  constructor(private readonly fixture: {
    sync?: unknown;
    transaction?: unknown;
    orderbook?: unknown;
    history?: unknown;
  } = {}) {}

  async getSyncStatus() {
    return this.fixture.sync ?? {
      initialized: true,
      phase: "realtime",
      currentHeight: 100,
      targetHeight: 100,
      processedHeight: 100
    };
  }

  async getTransaction() {
    return this.fixture.transaction ?? {
      txid,
      valid: true,
      senderAddress: expected.address,
      propertyIdOffered: expected.offeredPropertyId,
      propertyIdDesired: expected.desiredPropertyId,
      amountOffered: expected.amountOffered,
      amountExpected: expected.amountExpected,
      post: true,
      block: 100
    };
  }

  async getOrderbook() {
    return this.fixture.orderbook ?? {
      buy: [],
      sell: [{
        fullTxid: txid,
        txid: `${txid.slice(0, 3)}${txid.slice(-4)}`,
        sender: expected.address,
        offeredPropertyId: expected.offeredPropertyId,
        desiredPropertyId: expected.desiredPropertyId,
        amountOffered: expected.amountOffered,
        amountExpected: expected.amountExpected
      }]
    };
  }

  async getTokenTradeHistory() {
    return this.fixture.history ?? [];
  }
}

test("read-only TradeLayer verifier binds an exact valid tx5 to the open full-txid order", async () => {
  const result = await observeStarterTradeLayerOrder({ source: new FixtureSource(), expected, now: checkedAt });

  assert.equal(result.status, "verified");
  assert.equal(result.positionOrOrderState, "open");
  assert.equal(result.transactionProcessed, true);
  assert.equal(result.transactionValid, true);
  assert.equal(result.exactTransactionMatched, true);
  assert.equal(result.openOrderMatched, true);
  assert.equal(result.fillMatched, false);
  assert.equal(verifyTradeLayerOrderObservation(result), true);

  const tampered = structuredClone(result);
  tampered.positionOrOrderState = "filled";
  assert.equal(verifyTradeLayerOrderObservation(tampered), false);
});

test("a legacy truncated order identity remains pending instead of becoming a fabricated verification", async () => {
  const result = await observeStarterTradeLayerOrder({
    source: new FixtureSource({
      orderbook: {
        buy: [],
        sell: [{
          txid: `${txid.slice(0, 3)}${txid.slice(-4)}`,
          sender: expected.address,
          offeredPropertyId: 1,
          desiredPropertyId: 2,
          amountOffered: "0.001",
          amountExpected: "65"
        }]
      }
    }),
    expected,
    now: checkedAt
  });

  assert.equal(result.status, "pending");
  assert.equal(result.exactTransactionMatched, true);
  assert.equal(result.openOrderMatched, false);
  assert.match(result.reason, /no exact full-txid/i);
});

test("an exact address trade-history identity verifies a filled starter order", async () => {
  const result = await observeStarterTradeLayerOrder({
    source: new FixtureSource({
      orderbook: { buy: [], sell: [] },
      history: [{
        takerTxId: txid,
        buyer: expected.address,
        offeredPropertyId: 1,
        desiredPropertyId: 2,
        amountOffered: "0.001",
        amountExpected: "65"
      }]
    }),
    expected,
    now: checkedAt
  });

  assert.equal(result.status, "verified");
  assert.equal(result.positionOrOrderState, "filled");
  assert.equal(result.fillMatched, true);
});

test("transaction mismatches and unsynchronized listeners fail closed", async () => {
  const mismatch = await observeStarterTradeLayerOrder({
    source: new FixtureSource({
      transaction: {
        txid,
        valid: true,
        senderAddress: expected.address,
        propertyIdOffered: 1,
        propertyIdDesired: 2,
        amountOffered: "0.002",
        amountExpected: "65",
        post: true
      }
    }),
    expected,
    now: checkedAt
  });
  assert.equal(mismatch.status, "failed");
  assert.equal(mismatch.exactTransactionMatched, false);

  const stale = await observeStarterTradeLayerOrder({
    source: new FixtureSource({
      sync: {
        initialized: true,
        phase: "realtime",
        currentHeight: 90,
        targetHeight: 100,
        processedHeight: 90
      }
    }),
    expected,
    now: checkedAt
  });
  assert.equal(stale.status, "pending");
  assert.equal(stale.sync.lag, 10);
  assert.match(stale.reason, /not synchronized/i);
});

test("relayer source uses the local public RPC routes with deterministic arguments", async () => {
  const calls: Array<{ path: string; params: unknown[] }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { params: unknown[] };
    calls.push({ path: request.url || "", params: body.params });
    response.setHeader("content-type", "application/json");
    if (request.url === "/rpc/tl_getsyncstatus") {
      return response.end(JSON.stringify({ data: {
        initialized: true,
        phase: "realtime",
        currentHeight: 100,
        targetHeight: 100,
        processedHeight: 100
      } }));
    }
    if (request.url === "/rpc/tl_gettransaction") {
      return response.end(JSON.stringify({ data: {
        txid,
        valid: true,
        senderAddress: expected.address,
        propertyIdOffered: 1,
        propertyIdDesired: 2,
        amountOffered: "0.001",
        amountExpected: "65",
        post: true
      } }));
    }
    if (request.url === "/rpc/tl_getorderbook") {
      return response.end(JSON.stringify({ result: {
        buy: [],
        sell: [{
          fullTxid: txid,
          sender: expected.address,
          offeredPropertyId: 1,
          desiredPropertyId: 2,
          amountOffered: "0.001",
          amountExpected: "65"
        }]
      } }));
    }
    if (request.url === "/rpc/tl_tokentradehistoryforaddress") return response.end("[]");
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address() as AddressInfo;
    const result = await observeStarterTradeLayerOrder({
      source: new RelayerTradeLayerOrderReadSource(`http://127.0.0.1:${port}`),
      expected,
      now: checkedAt
    });
    assert.equal(result.status, "verified");
    assert.deepEqual(calls, [
      { path: "/rpc/tl_getsyncstatus", params: [] },
      { path: "/rpc/tl_gettransaction", params: [txid] },
      { path: "/rpc/tl_getorderbook", params: [1, 2] },
      { path: "/rpc/tl_tokentradehistoryforaddress", params: [1, 2, expected.address] }
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
