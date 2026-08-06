import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { externalRepos } from '../src/config.js';
import { encodeSegwitAddress, validateBitcoinAddress } from '../src/launch/bitcoin.js';
import { RemoteWalletExecutionBroker } from '../src/launch/remoteWalletBroker.js';
import { simulateBitcoinWithdrawal } from '../src/launch/tradelayerTool.js';
import type { BitAgentWorkflowState, WalletApproval } from '../src/launch/types.js';

const TOKEN = 'cross-repo-wallet-token-12345';
const NOW = '2026-08-06T09:00:00.000Z';
const ADDRESS = encodeSegwitAddress(Buffer.alloc(20, 31), 'bitcoin-testnet4');
const SCRIPT = validateBitcoinAddress(ADDRESS, 'bitcoin-testnet4').scriptPubKeyHex;

function workflow(wallet: BitAgentWorkflowState['wallet']): BitAgentWorkflowState {
  return {
    id: 'cross_repo_wallet_workflow',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    stage: 'deposit_confirmed',
    currentIntent: 'withdraw_bitcoin',
    wallet,
    deposit: {
      status: 'confirmed',
      address: wallet.bitcoinAddress,
      txid: 'ab'.repeat(32),
      vout: 0,
      amountSats: '250000',
      confirmations: 2,
      requiredConfirmations: 1,
    },
    recoveryInstructions: [],
    events: [],
  };
}

test('BitAgent client interoperates with durable TradeLayer wallet approval routes', async () => {
  const walletRepo = externalRepos.wallet;
  const routeUrl = pathToFileURL(path.join(
    walletRepo, 'packages', 'wallet-server', 'src', 'routes', 'bitagent-wallet.route.ts',
  )).href;
  const serviceUrl = pathToFileURL(path.join(
    walletRepo, 'packages', 'wallet-server', 'src', 'services', 'bitagent-wallet-authority.service.ts',
  )).href;
  const walletRequire = createRequire(path.join(walletRepo, 'package.json'));
  const fastify = walletRequire('fastify') as any;
  const { createBitagentWalletBrokerRoutes } = await import(routeUrl);
  const { BitagentWalletAuthorityService } = await import(serviceUrl);
  const directory = mkdtempSync(path.join(tmpdir(), 'bitagent-wallet-cross-repo-'));
  const statePath = path.join(directory, 'authority.json');
  let now = new Date(NOW);
  const service = new BitagentWalletAuthorityService({
    brokerToken: TOKEN,
    statePath,
    now: () => now,
    publicWalletProvider: {
      async inspect() {
        return {
          network: 'bitcoin-testnet4',
          bitcoinAddress: ADDRESS,
          scriptPubKeyHex: SCRIPT,
          confirmedBalanceSats: '250000',
          observedAt: NOW,
          source: 'cross-repo-mock-bitcoin-core',
        };
      },
      async exactFee() {
        return { networkFeeSats: '600', source: 'operator-fixed-testnet-candidate-fee' };
      },
    },
  });
  const app = fastify({ logger: false, bodyLimit: 64 * 1024 });
  app.register(createBitagentWalletBrokerRoutes(() => service), { prefix: '/v1/wallet/' });

  try {
    const endpoint = await app.listen(0, '127.0.0.1');
    const broker = new RemoteWalletExecutionBroker({ endpoint, authToken: TOKEN });
    const wallet = await broker.connect({
      mode: 'connect',
      network: 'bitcoin-testnet4',
      publicAddress: ADDRESS,
      now,
    });
    assert.deepEqual(await broker.getDepositAddress({ wallet }), {
      address: ADDRESS,
      scriptPubKeyHex: SCRIPT,
    });
    const state = workflow(wallet);
    const fee = await broker.estimateFee({ action: 'withdraw_bitcoin', amountSats: '50000', state });
    assert.deepEqual(fee, { networkFeeSats: '600', source: 'operator-fixed-testnet-candidate-fee' });

    const rejectedSimulation = simulateBitcoinWithdrawal({
      destinationAddress: ADDRESS,
      network: 'bitcoin-testnet4',
      amountSats: '50000',
      balanceSats: '250000',
      networkFeeSats: fee.networkFeeSats,
      now,
      ttlMs: 120_000,
    });
    const rejectedApproval: WalletApproval = {
      id: 'approval_cross_repo_reject',
      action: 'withdraw_bitcoin',
      simulationHash: rejectedSimulation.hash,
      status: 'pending',
      requestedAt: NOW,
    };
    const pending = await broker.authorize({ approval: rejectedApproval, simulation: rejectedSimulation, state });
    assert.equal(pending.status, 'pending');
    rejectedApproval.walletApprovalRequestId = pending.walletApprovalRequestId;
    service.resolveApproval(pending.walletApprovalRequestId, 'reject', { strategyPreflightVerified: false });
    assert.equal((await broker.authorize({
      approval: rejectedApproval, simulation: rejectedSimulation, state,
    })).status, 'rejected');

    const approvedSimulation = simulateBitcoinWithdrawal({
      destinationAddress: ADDRESS,
      network: 'bitcoin-testnet4',
      amountSats: '50001',
      balanceSats: '250000',
      networkFeeSats: fee.networkFeeSats,
      now,
      ttlMs: 120_000,
    });
    const approvedApproval: WalletApproval = {
      id: 'approval_cross_repo_allow',
      action: 'withdraw_bitcoin',
      simulationHash: approvedSimulation.hash,
      status: 'pending',
      requestedAt: NOW,
    };
    const secondPending = await broker.authorize({
      approval: approvedApproval, simulation: approvedSimulation, state,
    });
    assert.equal(secondPending.status, 'pending');
    approvedApproval.walletApprovalRequestId = secondPending.walletApprovalRequestId;
    now = new Date('2026-08-06T09:00:30.000Z');
    service.resolveApproval(secondPending.walletApprovalRequestId, 'approve', {
      strategyPreflightVerified: false,
    });
    const approved = await broker.authorize({
      approval: approvedApproval, simulation: approvedSimulation, state,
    });
    assert.equal(approved.status, 'approved');
    if (approved.status !== 'approved') throw new Error('Expected wallet approval');
    approvedApproval.status = 'approved';
    approvedApproval.walletApprovalToken = approved.walletApprovalToken;
    await assert.rejects(
      broker.execute({ approval: approvedApproval, simulation: approvedSimulation, state, now }),
      /HTTP 423/i,
    );

    const persisted = readFileSync(statePath, 'utf8');
    assert.doesNotMatch(persisted, /wallet_grant_|privateKey|seedPhrase|mnemonic|\"wif\"|psbt/i);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
