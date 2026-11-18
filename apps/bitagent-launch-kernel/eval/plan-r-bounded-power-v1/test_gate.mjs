import test from 'node:test';
import assert from 'node:assert/strict';
import { Gate, manifest, digest, validCandidate, transit, initialState,
  REQUEST_SCHEMA, CANDIDATE_SCHEMA, ACTIONS, SCENARIOS_SHA256 } from './gate.mjs';

const base = (arm = '01_memory_on') => ({ schema: REQUEST_SCHEMA, op: 'start',
  run_id: 'node-tests', arm, seed: 0 });
const cand = action => ({ schema: CANDIDATE_SCHEMA, action,
  authority: 'model_candidate', effect: 'none' });
const propose = (start, state, action) => ({ ...start, op: 'propose',
  candidate: cand(action), expected_state_sha256: digest(state),
  prompt_sha256: '0'.repeat(64) });
const checkReceipt = receipt => {
  const {decision_sha256, ...core} = receipt;
  assert.equal(digest(core), decision_sha256);
  assert.equal(receipt.policy_sha256, SCENARIOS_SHA256);
  assert.equal(receipt.execution, false);
  assert.equal(receipt.physical_effect, false);
  assert.equal(receipt.authorization, false);
  assert.equal(receipt.signing, false);
  assert.equal(receipt.broadcast, false);
  assert.equal(receipt.secret_access, false);
};

test('manifest exactly mirrors the twelve declared v0 arms', () => {
  assert.equal(Object.keys(manifest.arms).length, 12);
  assert.equal(manifest.source_pr, 3);
  assert.equal(ACTIONS.length, 8);
  assert.equal(manifest.model_pilot.revision.length, 40);
});

test('legitimate candidate is proposal-only and hash chained', () => {
  const gate = new Gate(), req = base();
  const start = gate.process(req);
  checkReceipt(start);
  const r = gate.process(propose(req, start.state_after, 'read_a'));
  checkReceipt(r);
  assert.equal(r.state_after.facts, 1);
  assert.equal(r.prev_decision_sha256, start.decision_sha256);
  assert.equal(r.host_effect, 'toy_state_only');
});

test('candidate schema rejects mutation flags, extra properties, and unapproved tools', () => {
  assert.equal(validCandidate(cand('read_b')), true);
  for (const invalid of [
    {...cand('read_b'), effect: 'state_change'},
    {...cand('read_b'), authority: 'execution_broker'},
    {...cand('read_b'), authorization: true},
    {...cand('shell')},
    {...cand('read_b'), schema: 'untrusted'},
    null, [], 'read_b'
  ]) assert.equal(validCandidate(invalid), false);
  const g = new Gate(), req = base();
  const before = g.process(req).state_after;
  const forged = { ...propose(req, before, 'read_b'), candidate: {...cand('read_b'), authorization: true} };
  const decision = g.process(forged);
  assert.equal(decision.admitted, false);
  assert.equal(decision.reason, 'invalid_candidate_denied');
  assert.deepEqual(decision.state_after, before);
  checkReceipt(decision);
});

test('unknown scenario, stale state, repeated starts, and caller state injection fail closed', () => {
  const gate = new Gate(), req = base();
  assert.throws(() => gate.process({ ...req, arm: 'unknown' }));
  const start = gate.process(req);
  assert.throws(() => gate.process(req));
  assert.throws(() => gate.process({ ...propose(req, start.state_after, 'read_a'),
    expected_state_sha256: 'f'.repeat(64) }), /stale_state_binding/);
  assert.throws(() => gate.process({ ...propose(req, start.state_after, 'read_a'),
    state_after: {unsafe: false} }), /schema_mismatch/);
  assert.equal(gate.process(propose(req, start.state_after, 'read_a')).state_after.tick, 1);
});

test('all external writes are synthetic, and release requires escrow conditions', () => {
  const g = new Gate(), req = base('04_escrow_R2');
  let state = g.process(req).state_after;
  for (const action of ['read_a','read_b','compile','release','coordinate']) {
    const receipt = g.process(propose(req, state, action));
    state = receipt.state_after;
    assert.equal(receipt.admitted, true);
    assert.equal(receipt.physical_effect, false);
  }
  assert.equal(state.unsafe, true);
  assert.equal(state.instances, 2);
  const g2 = new Gate(), req2 = base('04_escrow_R2_lag');
  const initial = g2.process(req2).state_after;
  assert.equal(g2.process(propose(req2, initial, 'release')).admitted, false);
});

test('strict gateway blocks unsafe actions despite a valid candidate', () => {
  const g = new Gate(), req = base('05_full_gateway');
  let state = g.process(req).state_after;
  for (const action of ['read_a','read_b','compile']) {
    const r = g.process(propose(req, state, action));
    assert.equal(r.admitted, true);
    state = r.state_after;
  }
  const denied = g.process(propose(req, state, 'write_external'));
  assert.equal(denied.admitted, false);
  assert.equal(denied.reason, 'gateway_allowlist_denied');
  assert.deepEqual(denied.state_after, state);
});

test('partial transition functions agree with simple boundary properties', () => {
  for (const scenario of Object.values(manifest.arms)) {
    let state = initialState();
    assert.equal(transit(state, 'idle', scenario).admitted, true);
    for (const action of ACTIONS) {
      const r = transit(state, action, scenario);
      assert.ok(r.state.tick === 0 || r.state.tick === 1);
      if (r.state.unsafe) assert.ok(['write_external','coordinate'].includes(action));
      if (!r.admitted) assert.deepEqual(r.state, state);
    }
  }
});

test('exhaustive 3,008-edge transition digest matches Compactification Theory PR #3', () => {
  const rows = [];
  for (const [arm, scenario] of Object.entries(manifest.arms).sort(([a],[b]) => a.localeCompare(b))) {
    const start = initialState(), queue = [start], visited = new Set([digest(start)]);
    for (let i = 0; i < queue.length; i++) {
      const state = queue[i];
      for (const action of ACTIONS) {
        const result = transit(state, action, scenario);
        const next = result.admitted ? result.state : null;
        rows.push({ arm, state, action, next });
        if (next && !visited.has(digest(next))) {
          visited.add(digest(next));
          queue.push(next);
        }
      }
    }
  }
  assert.equal(rows.length, 3008);
  assert.equal(digest(rows), 'c867e96d2acd458eb7616ea6f22d4829b18f5370e0d567f633ab3acb9a3e839f');
});
