import fs from "node:fs/promises";
import path from "node:path";
import { ChainsigEvmAdapter } from "../src/adapters/nearChainSignatureEvmAdapter.js";
import { ChainsigSolanaAdapter } from "../src/adapters/nearChainSignatureSolanaAdapter.js";

const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
const nearAccount = process.env.NEAR_TESTNET_ACCOUNT || "bitagent.testnet";

const evmClient = {
  estimateGas: async () => 21_000n,
  estimateFeesPerGas: async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }),
  getTransactionCount: async () => 7,
  getChainId: async () => 11_155_111,
  sendRawTransaction: async () => {
    throw new Error("Broadcast is disabled in local preparation mode");
  }
};

const solanaConnection = {
  getLatestBlockhash: async () => ({
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 1
  }),
  getFeeForMessage: async () => ({ value: 5_000 }),
  sendRawTransaction: async () => {
    throw new Error("Broadcast is disabled in local preparation mode");
  }
};

const evm = await new ChainsigEvmAdapter({
  network: "sepolia",
  nearNetwork: "testnet",
  publicClient: evmClient
}).prepareTransfer({
  nearAccount,
  derivationPath: "bitagent/ethereum/0",
  to: "0x1111111111111111111111111111111111111111",
  valueWei: "1000000000000000",
  expiresAt
});

const solana = await new ChainsigSolanaAdapter({
  network: "devnet",
  nearNetwork: "testnet",
  solanaConnection
}).prepareTransfer({
  nearAccount,
  derivationPath: "bitagent/solana/0",
  to: "11111111111111111111111111111111",
  valueLamports: "1000000",
  expiresAt
});

const artifact = {
  kind: "bitagent_multichain_testnet_unsigned_plans",
  generatedAt: new Date().toISOString(),
  signingRequested: false,
  broadcastRequested: false,
  warning: "RPC values are deterministic local fixtures. Refresh fees, nonce, blockhash, and quote before any wallet approval.",
  evm,
  solana
};
const output = path.resolve(".runtime", "multichain-testnet-plans.json");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, evm: evm.simulationHash, solana: solana.simulationHash, signingRequested: false, broadcastRequested: false }, null, 2));
