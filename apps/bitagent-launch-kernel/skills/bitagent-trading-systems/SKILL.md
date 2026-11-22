---
name: bitagent-trading-systems
summary: "Offline, candidate-only testing of trading strategies using BitAgent's deterministic risk boundary and the TradingMoneyball strategy-spec interface."
description: "Use for comparing a Bitcoin/TradeLayer or Lighter trading-system hypothesis, testing Fibonacci ribbon/EMA/reversion strategies and portfolio allocation, producing time-respecting paper simulation receipts, or planning supervised local model proposals. Never place funded or testnet orders."
---

# BitAgent trading systems gym

Evaluate one trading hypothesis as **a paper candidate**, following `research/trading_systems_gym/README.md` and `gym.py`. The skills for approval and wallet state remain under `bitagent-hermes-launch` and `tradelayer-collateral-lifecycle`.

## Read before proposing

1. Read BitAgent `apps/bitagent-launch-kernel/docs/strategy-covenant.md` and current `src/mandates/types.ts` and `allocator.ts` before claiming a proposal could be bridged to TradeLayer.
2. Consult the pinned TradingMoneyball source paths listed in the gym README. Use `app/strategy/base.py`, `spec.py`, `factory.py`, `variant.py`, and `app/moneyball/` as the strategy-side authority. Never read or copy TradingMoneyball `.env`, tokens, events.sqlite, output.log, account IDs, or PnL claims into public evidence.
3. Make a short task card: strategy ID/version, research hypothesis, provenance, bar cadence, asset/venue, fee/slippage/impact/funding assumptions, risk caps, split boundaries, and the comparison baseline.

## Experiment loop

- Start with `python research/trading_systems_gym/gym.py --output /tmp/bitagent-gym-dev.json` and run its stdlib tests. Use CPU only.
- The policy emits `{target_bps, reason, source, effect: none}`. The separate risk checker validates notional, liquidity, fees, drawdown and staleness. Only the simulator books a fill. Preserve rejected proposals and expose reasons without editing them into success.
- Run flat, buy/hold and same-data indicator baselines. For Moneyball weighting, fit the development-only softmax/floor, then freeze weights before validation. Maintain distinct strategy IDs and hash each source, config, dataset, and receipt.
- Propose new indicators, regime filters, trailing/prove/scratch exit rules, or a learned agent policy only in a fresh development run. Treat any model endpoint as an *offline proposal source*. Default LLM rollout budget is zero; when approved for later work, prefer an existing local server and a strict 12k-token inclusive context, never a paid fallback.
- Keep heldout evaluation sealed until all choices are frozen. Invoke `--unlock-holdout` once for confirmation, record unchanged config, then disclose any holdout-driven changes as exploratory work requiring new untouched seeds.
- Review spread/slippage and participation sensitivity, crash/gap behaviour, walk-forward consistency, risk-gate bypasses, exposure concentration, drawdown, turnover and approximate Sharpe. Report absolute benchmark metrics, even when they beat the candidate.

## Canonical evidence

Return the JSON receipt with experiment seed, Git source SHAs, scenario and market hashes, risk config, split and allocator weights, net PnL, annualized Sharpe caveat, drawdown, fees, funding, turnover, risk rejections and liquidations. `effect` must remain `none` or `simulation_only`. Never mutate source market data during policy decisions; each decision sees a causal prefix ending at the last completed bar and can fill no earlier than the following bar.

## Disallowed authority

No wallet secrets, account signers, external trade APIs, exchange websocket subscriptions, broker execution, UTXO actions, funded orders, impersonated approvals, or attempts to activate `fundedExecutionAllowed`. An independent operator must validate proposal roots through the existing Strategy Covenant allocator and wallet approval flow before any separate execution experiment. A gym score and an unsigned proposal never grant that authority.

## Stop conditions

Stop the experiment and mark `HOLD` for invalid OHLC, non-finite prices or scores, a stale tape, unknown strategy type, missing local TMB checkout, a cost or leverage cap violation, data leakage, a mutable holdout, or an unavailable deterministic risk checker. Report the exact blocker instead of silently substituting a live venue or another strategy.
