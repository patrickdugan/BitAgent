import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { externalRepos } from '../src/config.js';
import { encodeSegwitAddress, validateBitcoinAddress } from '../src/launch/bitcoin.js';
import { hashObject } from '../src/launch/canonical.js';
import { RemoteWalletExecutionBroker } from '../src/launch/remoteWalletBroker.js';
import { simulateBitcoinWithdrawal } from '../src/launch/tradelayerTool.js';
import type { BitAgentWorkflowState, WalletApproval } from '../src/launch/types.js';

const TOKEN = 'cross-repo-wallet-token-12345';
const NOW = '2026-08-06T09:00:00.000Z';
const ADDRESS = encodeSegwitAddress(Buffer.alloc(20, 31), 'bitcoin-testnet4');
const SCRIPT = validateBitcoinAddress(ADDRESS, 'bitcoin-testnet4').scriptPubKeyHex;
const DESTINATION = encodeSegwitAddress(Buffer.alloc(20, 32), 'bitcoin-testnet4');
const DESTINATION_SCRIPT = validateBitcoinAddress(DESTINATION, 'bitcoin-testnet4').scriptPubKeyHex;

function withdrawalCandidate(input: any) {
  const feeSats = '600';
  const core = {
    schema: 'bitagent_wallet_withdrawal_candidate_v1' as const,
    workflowId: input.workflowId,
    walletSessionId: input.walletSessionId,
    network: 'bitcoin-testnet4' as const,
    preparedAt: NOW,
    expiresAt: '2026-08-06T09:05:00.000Z',
    unsignedTxid: hashObject({ unsigned: input.amountSats }),
    unsignedPsbtHash: hashObject(`private-unsigned-psbt-${input.amountSats}`),
    inputUtxos: [{
      txid: 'cd'.repeat(32),
      vout: 1,
      valueSats: '250000',
      address: ADDRESS,
      scriptPubKeyHex: SCRIPT,
    }],
    destinationOutput: {
      vout: 0 as const,
      address: input.destinationAddress,
      scriptPubKeyHex: DESTINATION_SCRIPT,
      valueSats: input.amountSats,
    },
    changeOutput: {
      vout: 1 as const,
      address: ADDRESS,
      scriptPubKeyHex: SCRIPT,
      valueSats: (250000n - BigInt(input.amountSats) - BigInt(feeSats)).toString(),
    },
    feeSats,
    feeRateSatVb: 2,
    signingPerformed: false as const,
    broadcastPerformed: false as const,
  };
  const candidateHash = hashObject(core);
  return {
    candidateId: `withdrawal_candidate_${candidateHash.slice(0, 32)}`,
    candidateHash,
    ...core,
  };
}

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

test('BitAgent client interoperates with durable TradeLayer wallet withdrawal candidates and approvals', async () => {
  const walletRepo = externalRepos.wallet;
  const routeUrl = pathToFileURL(path.join(
    walletRepo, 'packages', 'wallet-server', 'src', 'routes', 'bitagent-wallet.route.ts',
  )).href;
  const serviceUrl = pathToFileURL(path.join(
    walletRepo, 'packages', 'wallet-server', 'src', 'services', 'bitagent-wallet-authority.service.ts',
  )).href;
  const walletRequire = createRequire(path.join(walletRepo, 'package.json'));
  const fastify = walletRequire('fastify') as any;
  const { createBitagentWalletBrokerRoutes, createBitagentWalletOperatorRoutes } = await import(routeUrl);
  const { BitagentWalletAuthorityService } = await import(serviceUrl);
  const directory = mkdtempSync(path.join(tmpdir(), 'bitagent-wallet-cross-repo-'));
  const statePath = path.join(directory, 'authority.json');
  let now = new Date(NOW);
  let cancellationCount = 0;
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
        return { networkFeeSats: '600', source: 'unused-operator-fee' };
      },
    },
    requireWithdrawalCandidate: true,
    withdrawalCandidateProvider: {
      async prepare(input: any) {
        return {
          publicCandidate: withdrawalCandidate(input),
          rawPsbt: `private-unsigned-psbt-${input.amountSats}`,
        };
      },
      async cancel(candidate: any) {
        cancellationCount++;
        const core = {
          schema: 'bitagent_wallet_withdrawal_candidate_cancellation_v1' as const,
          candidateId: candidate.publicCandidate.candidateId,
          candidateHash: candidate.publicCandidate.candidateHash,
          cancelledAt: now.toISOString(),
          inputOutpoints: candidate.publicCandidate.inputUtxos.map(({ txid, vout }: any) => ({ txid, vout })),
          inputLockReleased: true as const,
          signingPerformed: false as const,
          broadcastPerformed: false as const,
        };
        return { ...core, receiptHash: hashObject(core) };
      },
    } as any,
    withdrawalExecutionProvider: {
      async execute(candidate: any) {
        const core = {
          schema: 'bitagent_wallet_withdrawal_submission_v1' as const,
          candidateId: candidate.publicCandidate.candidateId,
          candidateHash: candidate.publicCandidate.candidateHash,
          txid: candidate.publicCandidate.unsignedTxid,
          submittedAt: now.toISOString(),
          mempoolAccepted: true as const,
          signingPerformed: true as const,
          broadcastPerformed: true as const,
        };
        return { ...core, receiptHash: hashObject(core) };
      },
    },
    executionReleaseId: 'ef'.repeat(32),
  });
  const app = fastify({ logger: false, bodyLimit: 64 * 1024 });
  app.register(createBitagentWalletBrokerRoutes(() => service), { prefix: '/v1/wallet/' });
  app.register(createBitagentWalletOperatorRoutes(() => service, async () => ({
    connectionStatus: 'unavailable',
    preflight: { status: 'failed' },
    release: { status: 'candidate_not_deployed' },
  })), { prefix: '/api/bitagent/wallet-authority/' });

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
    const fee = await broker.estimateFee({
      action: 'withdraw_bitcoin', amountSats: '50000', destinationAddress: DESTINATION, state,
    });
    assert.equal(fee.networkFeeSats, '600');
    assert.equal(fee.source, 'bitcoin-core-decoded-unsigned-psbt');
    assert.match(String(fee.candidate?.candidateHash), /^[a-f0-9]{64}$/);
    const publicStatus = await app.inject({
      method: 'GET', url: '/api/bitagent/wallet-authority/status',
    });
    assert.equal(publicStatus.statusCode, 200);
    assert.equal(publicStatus.json().data.executionAvailable, true);
    assert.equal(publicStatus.json().data.withdrawalCandidates[0].candidate.candidateHash,
      fee.candidate?.candidateHash);
    assert.equal(publicStatus.json().data.withdrawalCandidates[0].rawPsbt, undefined);
    assert.doesNotMatch(publicStatus.body, /private-unsigned-psbt/i);

    const rejectedSimulation = simulateBitcoinWithdrawal({
      destinationAddress: DESTINATION,
      network: 'bitcoin-testnet4',
      amountSats: '50000',
      balanceSats: '250000',
      networkFeeSats: fee.networkFeeSats,
      walletCandidate: fee.candidate,
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
    await service.resolveApproval(pending.walletApprovalRequestId, 'reject', { strategyPreflightVerified: false });
    assert.equal((await broker.authorize({
      approval: rejectedApproval, simulation: rejectedSimulation, state,
    })).status, 'rejected');

    const secondFee = await broker.estimateFee({
      action: 'withdraw_bitcoin', amountSats: '50001', destinationAddress: DESTINATION, state,
    });
    const approvedSimulation = simulateBitcoinWithdrawal({
      destinationAddress: DESTINATION,
      network: 'bitcoin-testnet4',
      amountSats: '50001',
      balanceSats: '250000',
      networkFeeSats: secondFee.networkFeeSats,
      walletCandidate: secondFee.candidate,
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
    await service.resolveApproval(secondPending.walletApprovalRequestId, 'approve', {
      strategyPreflightVerified: false,
    });
    const approved = await broker.authorize({
      approval: approvedApproval, simulation: approvedSimulation, state,
    });
    assert.equal(approved.status, 'approved');
    if (approved.status !== 'approved') throw new Error('Expected wallet approval');
    approvedApproval.status = 'approved';
    approvedApproval.walletApprovalToken = approved.walletApprovalToken;
    const execution = await broker.execute({
      approval: approvedApproval, simulation: approvedSimulation, state, now,
    });
    assert.equal(execution.status, 'submitted');
    assert.equal(execution.txid, approvedSimulation.walletCandidate?.unsignedTxid);

    assert.equal(cancellationCount, 1);
    const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.doesNotMatch(JSON.stringify(persisted), /wallet_grant_|privateKey|seedPhrase|mnemonic|\"wif\"/i);
    assert.ok(Object.values(persisted.withdrawalCandidates).every((candidate: any) =>
      candidate.rawPsbt === undefined));
    assert.ok(Object.values(persisted.withdrawalCandidates).some((candidate: any) =>
      candidate.status === 'cancelled' && candidate.cancellation.inputLockReleased === true));
    assert.ok(Object.values(persisted.withdrawalCandidates).some((candidate: any) =>
      candidate.status === 'submitted'
      && candidate.submission.txid === approvedSimulation.walletCandidate?.unsignedTxid));
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
