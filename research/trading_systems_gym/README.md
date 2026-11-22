# BitAgent Trading Systems Gym (TradingMoneyball bridge)

Candidate-only, offline evaluator for trading-system proposals. Located under BitAgent research rather than in the funded workflow. The home TradingMoneyball checkout is private; this public gym imports its **strategy interface** when opted in and does not vendor its configuration, log, database, account data, secrets, or exchange client.

Source anchors inspected on 2026-11-23:

- BitAgent `main` `d234ff5456f43588eb019dc11b1b39130bcf7a3f`: `apps/bitagent-launch-kernel/src/mandates/{types,allocator}.ts`, `docs/strategy-covenant.md`
- TradingMoneyball `main` `62995583d410052d654abcb2bcdf95b6cab7cfe6`: `app/strategy/{base,spec,factory,variant}.py`, `app/data/candles.py`, `app/moneyball/{scoring,allocator}.py`, `strategies/*.json`

The private project uses a `BaseStrategy.compute_signal/compute_exit` protocol, a registry of JSON variants, Fib ribbon/EMA/RSI signals, prove/scratch exits, trailing stops, and Moneyball score/floor/softmax allocation. This gym reuses the names and model boundary. `ribbon_proxy` and other stdlib baselines are intentionally **simplified single-timeframe models**. For the real TMB signal and exit code, use `--tmb-root` + `--tmb-spec` with a valid local checkout and 5-second data.

## CPU smoke run

From the BitAgent root, with Python 3.10+ and no dependencies:

```bash
python research/trading_systems_gym/gym.py --bars 1200 --seed 20261123 --output /tmp/bitagent-gym-dev.json
python -m unittest discover -s research/trading_systems_gym -p 'test_*.py' -v
```

Use `--risk-config research/trading_systems_gym/risk-example.json` to change explicit cost and risk assumptions. For external data, supply CSV with `ts,open,high,low,close,volume_usd,spread_bps`; `ts` is strictly increasing UNIX seconds and volume is quote USD, rather than number of contracts. Bar-close decisions fill at the **next bar open** plus `latency_bars`. The last position closes at the end of the evaluation window and incurs costs. A drawdown circuit breaker forces neutral. Stale bars, excessive spread/participation, position and order caps produce risk rejection receipts. When funding is positive, longs pay and shorts receive. Default funding is zero.

The default synthetic pilot compares flat, 30%-long buy/hold, EMA-cross proxy, Fibonacci ribbon proxy, mean-reversion proxy, and a Moneyball-style weighted mixture. The mixture learns weights **only from development** and freezes them for validation. Five seeded stress tapes contain trends, chop, a crash, a wide-spread liquidity squeeze, and a price gap. All outputs contain the source revision, market hashes, risk assumptions, split boundaries and a content SHA-256 receipt. Synthetic performance is a harness check, not evidence of investable returns.

## Real TradingMoneyball strategy bridge

```bash
python research/trading_systems_gym/gym.py \
  --csv /path/to/5sec_ohlcv.csv \
  --tmb-root /path/to/TradingMoneyball \
  --tmb-spec /path/to/TradingMoneyball/strategies/eth_fib_fast_scalp.json \
  --output /tmp/native-dev.json
```

The bridge imports only the private checkout's **pure strategy modules** and creates `MultiCandles` from chronological observations. It never calls Lighter execution, the app runner, exchange websocket, `.env`, or any account. `pydantic` v2 and any dependencies used by the selected pure strategy module must already exist locally. This pilot supports `fib_ribbon`, `ema_crossover` and `rsi_reversal`. It requires continuous 5-second observations, without a resampler that smuggles 1-minute bars into a 5-second signal. Comparing a live tick-executed strategy against this bar-driven simulator is a *research translation*, not a trade replay. Confirm every native adapter result before using it as evidence.

## Splits and review protocol

Each tape is chronological: 0–60% development, 60–80% validation, 80–100% locked holdout. A strategy sees only previous bars and the current completed bar. Its order can execute from the next open onward. The terminal mark includes closing costs. A separate account starts flat at the beginning of each split; the strategy can read past observations for indicator warmup. Holdout results are omitted unless explicitly invoked with `--unlock-holdout`; after first unlock, freeze all strategy/risk choices and record the receipt.

`annualized_sharpe_approx` uses each synthetic bar as an independent period and is sensitive to sample length and autocorrelation. Fees, spread/slippage, explicit funding, turnover, drawdown, risk rejections, liquidations and closed-trade win rate appear separately. Win-rate is approximate because a scale-out is one close event; net equity PnL includes all costs. Price/volume are simulated, no order book depth or queue priority. Never treat a synthetic win or absent liquidation as a live trading guarantee.

## Authority boundary

The agent proposes a **target delta** and an explanation. A deterministic risk gate decides whether to stage the proposal. The simulator alone updates the account and records fills, with `effect: simulation_only`. The agent cannot call a broker. No wallet keys, funded execution flags, external API connections or transaction methods live here. The result is **not** a valid `bitagent_strategy_proposal_v1` because it lacks a signed/approved Strategy Covenant, adapter/market roots and canonical host validation. Promotion requires using the real BitAgent mandate validators, covenant approval, independent market observations and the wallet-owned approval broker in `apps/bitagent-launch-kernel`.

See the repo skill at `apps/bitagent-launch-kernel/skills/bitagent-trading-systems/SKILL.md`. The gym can be run with no LLM, GPU or paid API. Keep the local private TradingMoneyball checkout and output tapes outside the public repo.
