"""Candidate-only, deterministic trading-system evaluation gym. Python stdlib only.

Decision at bar close t; simulated fill at a future bar open. No exchange client,
network request, wallet access, signing or order submission exists in this module.
"""
from __future__ import annotations

import argparse
import csv
from dataclasses import asdict, dataclass, field
import hashlib
import json
import math
from pathlib import Path
import random
import statistics
from typing import Protocol, Sequence

SCHEMA = 'bitagent_trading_gym_v1'
SCENARIOS = ('trend', 'chop', 'crash', 'thin', 'gap')


def canonical(obj: object) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(obj: object) -> str:
    return hashlib.sha256(canonical(obj)).hexdigest()


@dataclass(frozen=True)
class Bar:
    ts: int
    open: float
    high: float
    low: float
    close: float
    volume_usd: float
    spread_bps: float

    def __post_init__(self):
        vals = (self.open, self.high, self.low, self.close, self.volume_usd, self.spread_bps)
        if any(not math.isfinite(v) for v in vals):
            raise ValueError('nonfinite market data')
        if min(self.open, self.high, self.low, self.close) <= 0 or self.volume_usd < 0 or self.spread_bps < 0:
            raise ValueError('invalid market data')
        if self.low > min(self.open, self.close) or self.high < max(self.open, self.close):
            raise ValueError('OHLC inconsistency')


@dataclass(frozen=True)
class Proposal:
    target_bps: int
    reason: str
    source: str
    effect: str = 'none'


@dataclass(frozen=True)
class PositionView:
    qty: float
    entry_price: float
    entry_ts: int
    high_water: float
    low_water: float
    equity: float
    target_bps: int


class Policy(Protocol):
    name: str
    def decide(self, history: Sequence[Bar], position: PositionView) -> Proposal: ...


class Baseline:
    def __init__(self, name: str, weights: dict[str, float] | None = None):
        self.name = name
        self.weights = weights

    def decide(self, history: Sequence[Bar], position: PositionView) -> Proposal:
        closes = [b.close for b in history]
        if self.name == 'flat':
            target, why = 0, 'flat baseline'
        elif self.name == 'buy_hold':
            target, why = 3000, 'constant 30% long benchmark'
        elif self.name == 'ema_cross':
            if len(closes) < 55:
                target, why = 0, 'EMA warmup'
            else:
                fast, slow = ema(closes, 8), ema(closes, 21)
                trend = ema(closes, 55)
                target = 3000 if fast > slow and closes[-1] > trend else (-3000 if fast < slow and closes[-1] < trend else 0)
                why = 'EMA 8/21/55 proxy'
        elif self.name == 'ribbon_proxy':
            if len(closes) < 55:
                target, why = 0, 'ribbon warmup'
            else:
                avgs = [sum(closes[-p:]) / p for p in (5, 8, 13, 21, 34, 55)]
                bull = all(x > y for x, y in zip(avgs, avgs[1:]))
                bear = all(x < y for x, y in zip(avgs, avgs[1:]))
                throttle = 0.5 if closes[-1] < avgs[4] else 1.0
                target = round((3000 if bull else -3000 if bear else 0) * throttle)
                why = 'single-timeframe Fibonacci ribbon proxy'
        elif self.name == 'mean_revert':
            if len(closes) < 30:
                target, why = 0, 'reversion warmup'
            else:
                window = closes[-30:]
                sd = statistics.pstdev(window)
                z = (closes[-1] - statistics.mean(window)) / sd if sd > 0 else 0
                target = -3000 if z >= 1.5 else (3000 if z <= -1.5 else 0)
                why = '30-bar mean reversion proxy'
        elif self.name == 'moneyball_blend':
            if self.weights is None:
                raise ValueError('blend requires development-fitted weights')
            constituents = [Baseline(x) for x in self.weights]
            target = round(sum(self.weights[x] * constituents[i].decide(history, position).target_bps for i, x in enumerate(self.weights)))
            why = 'frozen development-only softmax weights'
        else:
            raise ValueError('unknown baseline ' + self.name)
        return Proposal(target, why, self.name)


def ema(xs: Sequence[float], n: int) -> float:
    alpha = 2 / (n + 1)
    value = xs[0]
    for x in xs[1:]:
        value = alpha * x + (1 - alpha) * value
    return value


def synthetic(seed: int, scenario: str, n: int = 1200, cadence_sec: int = 60) -> list[Bar]:
    if scenario not in SCENARIOS:
        raise ValueError('unknown scenario')
    if n < 120 or cadence_sec < 1:
        raise ValueError('invalid synthetic horizon')
    rng = random.Random(seed)
    close = 100.0
    result = []
    for i in range(n):
        phase = i / n
        drift = (0.00028 if phase < 0.5 else -0.00018) if scenario == 'trend' else 0.0
        noise = rng.gauss(0, 0.0025)
        if scenario == 'chop':
            drift = -(close - 100) / 100 * 0.16
            noise *= 1.15
        if scenario == 'crash' and 0.69 < phase < 0.74:
            drift -= 0.013
            noise *= 1.8
        gap = -0.10 if scenario == 'gap' and i == round(0.71 * n) else 0.0
        o = close * (1 + gap)
        c = max(0.1, o * (1 + drift + noise))
        high = max(o, c) * (1 + abs(rng.gauss(0, 0.0005)))
        low = min(o, c) * (1 - min(0.1, abs(rng.gauss(0, 0.0005))))
        thin = scenario == 'thin' and 0.58 < phase < 0.82
        spread = 65.0 if thin else 3.0
        vol = 1800.0 if thin else 125000.0
        result.append(Bar(1700000000 + i * cadence_sec, o, high, low, c, vol, spread))
        close = c
    return result


def load_csv(path: Path) -> list[Bar]:
    with path.open(newline='', encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        required = {'ts', 'open', 'high', 'low', 'close', 'volume_usd', 'spread_bps'}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError('CSV must have: ' + ', '.join(sorted(required)))
        out = [Bar(int(r['ts']), *(float(r[k]) for k in ('open','high','low','close','volume_usd','spread_bps'))) for r in reader]
    if len(out) < 120 or any(b.ts <= a.ts for a,b in zip(out, out[1:])):
        raise ValueError('not enough bars or nonmonotonic timestamps')
    return out


@dataclass(frozen=True)
class Risk:
    initial_equity: float = 10000.0
    fee_bps: float = 4.0
    slippage_bps: float = 2.0
    impact_bps: float = 30.0
    funding_bps_per_bar: float = 0.0
    max_target_bps: int = 7000
    max_order_fraction_nav: float = 0.75
    max_participation: float = 0.10
    max_total_cost_bps: float = 50.0
    max_drawdown_bps: float = 3500.0
    maintenance_margin_fraction: float = 0.10
    latency_bars: int = 0
    max_market_gap_seconds: int = 300

    def __post_init__(self):
        floats = (self.initial_equity, self.fee_bps, self.slippage_bps, self.impact_bps, self.funding_bps_per_bar, self.max_order_fraction_nav, self.max_participation, self.max_total_cost_bps, self.max_drawdown_bps, self.maintenance_margin_fraction)
        if any(not math.isfinite(v) for v in floats) or self.initial_equity <= 0 or any(v < 0 for v in floats[1:]) or self.max_target_bps < 0 or self.max_target_bps > 10000 or self.latency_bars < 0 or self.max_market_gap_seconds < 1 or not (0 < self.max_participation <= 1) or not (0 < self.max_order_fraction_nav <= 1) or not (0 < self.maintenance_margin_fraction <= 1):
            raise ValueError('invalid risk configuration')


@dataclass
class Account:
    cash: float
    qty: float = 0.0
    entry_price: float = 0.0
    entry_ts: int = 0
    high_water: float = 0.0
    low_water: float = 0.0
    fees: float = 0.0
    execution_cost: float = 0.0
    funding: float = 0.0
    turnover: float = 0.0
    orders: int = 0
    rejects: int = 0
    liquidations: int = 0
    closed_trades: int = 0
    winning_trades: int = 0
    bankruptcies: int = 0
    events: list[dict] = field(default_factory=list)

    def equity(self, price: float) -> float:
        return self.cash + self.qty * price

    def view(self, price: float) -> PositionView:
        eq = self.equity(price)
        return PositionView(self.qty, self.entry_price, self.entry_ts, self.high_water, self.low_water, eq,
                            round(self.qty * price / eq * 10000) if eq > 0 else 0)


def quote_cost(bar: Bar, amount_usd: float, risk: Risk) -> float:
    participation = amount_usd / max(bar.volume_usd, 1e-9)
    return bar.spread_bps / 2 + risk.slippage_bps + risk.impact_bps * participation


def risk_check(target_bps: int, bar: Bar, account: Account, risk: Risk, price: float, peak: float, override: bool = False) -> str | None:
    eq = account.equity(price)
    if eq <= 0:
        return 'bankrupt'
    if not isinstance(target_bps, int) or isinstance(target_bps, bool):
        return 'noninteger_target'
    if abs(target_bps) > risk.max_target_bps:
        return 'position_limit'
    if peak > 0 and (peak - eq) / peak * 10000 >= risk.max_drawdown_bps and target_bps != 0:
        return 'drawdown_circuit_breaker'
    desired_qty = target_bps / 10000 * eq / price
    delta_usd = abs(desired_qty - account.qty) * price
    if not override:
        if delta_usd > eq * risk.max_order_fraction_nav + 1e-8:
            return 'order_nav_limit'
        if delta_usd > bar.volume_usd * risk.max_participation + 1e-8:
            return 'liquidity_limit'
        if delta_usd > 1e-9 and (quote_cost(bar, delta_usd, risk) + risk.fee_bps > risk.max_total_cost_bps):
            return 'cost_ceiling'
    return None


def fill(account: Account, bar: Bar, target_bps: int, risk: Risk, price: float, reason: str, force: bool = False) -> bool:
    eq = account.equity(price)
    if eq <= 0:
        return False
    desired_qty = target_bps / 10000 * eq / price
    dq = desired_qty - account.qty
    if abs(dq * price) < 1e-7:
        return False
    spread_slip_bps = quote_cost(bar, abs(dq) * price, risk)
    if force:
        spread_slip_bps += 10  # deterministic emergency unwind penalty
    execution_price = price * (1 + math.copysign(spread_slip_bps / 10000, dq))
    gross_notional = abs(dq) * execution_price
    fee = gross_notional * risk.fee_bps / 10000
    old_qty = account.qty
    if old_qty != 0 and old_qty * dq < 0:
        closed_qty = min(abs(old_qty), abs(dq))
        realized = (execution_price - account.entry_price) * closed_qty * math.copysign(1, old_qty)
        account.closed_trades += 1
        if realized - fee * (closed_qty / abs(dq)) > 0:
            account.winning_trades += 1
    account.cash -= dq * execution_price + fee
    account.qty += dq
    if abs(account.qty) < 1e-12:
        account.qty = 0.0
    if account.qty == 0:
        account.entry_price = 0.0
        account.entry_ts = 0
        account.high_water = account.low_water = 0.0
    elif old_qty * account.qty <= 0:
        account.entry_price = execution_price
        account.entry_ts = bar.ts
        account.high_water = account.low_water = price
    elif old_qty * dq > 0:
        account.entry_price = (abs(old_qty) * account.entry_price + abs(dq) * execution_price) / abs(account.qty)
    account.fees += fee
    account.execution_cost += abs(dq) * abs(execution_price - price)
    account.turnover += gross_notional
    account.orders += 1
    account.events.append({'type':'simulated_fill','ts':bar.ts,'target_bps':target_bps,'qty':round(dq,9),
                           'price':round(execution_price,7),'fee':round(fee,7),'reason':reason,'effect':'simulation_only'})
    return True


def simulate(bars: Sequence[Bar], start: int, end: int, policy: Policy, risk: Risk, cadence_sec: int) -> dict:
    if not (0 <= start < end <= len(bars)):
        raise ValueError('invalid split')
    account = Account(risk.initial_equity)
    peak = risk.initial_equity
    curve = [risk.initial_equity]
    exposures = []
    pending: tuple[int,int,str] | None = None
    if hasattr(policy, 'warm_start'):
        policy.warm_start(bars[:start])
    for i in range(start, end):
        b = bars[i]
        if pending and pending[0] <= i:
            _, tgt, why = pending
            check = risk_check(tgt, b, account, risk, b.open, peak)
            if check:
                account.rejects += 1
                account.events.append({'type':'execution_rejected','ts':b.ts,'reason':check,'effect':'none'})
            elif fill(account, b, tgt, risk, b.open, why):
                if hasattr(policy, 'on_fill'):
                    policy.on_fill(b.ts, account.qty)
            pending = None
        # Positive funding: longs pay, shorts receive. No market funding is inferred.
        f = account.qty * b.close * risk.funding_bps_per_bar / 10000
        account.cash -= f
        account.funding += f
        if account.qty > 0:
            account.high_water = max(account.high_water, b.close)
        elif account.qty < 0:
            account.low_water = min(account.low_water, b.close)
        eq = account.equity(b.close)
        notional = abs(account.qty * b.close)
        if eq <= notional * risk.maintenance_margin_fraction and account.qty != 0:
            fill(account, b, 0, risk, b.close, 'forced_liquidation', force=True)
            account.liquidations += 1
            pending = None
            eq = account.equity(b.close)
        if eq <= 0:
            account.bankruptcies += 1
            account.events.append({'type':'bankruptcy','ts':b.ts,'effect':'simulation_only'})
            curve.append(eq)
            break
        peak = max(peak, eq)
        curve.append(eq)
        exposures.append(notional / eq)
        if i >= end - 1 or pending:
            continue
        if i > start and b.ts - bars[i-1].ts > risk.max_market_gap_seconds:
            account.rejects += 1
            account.events.append({'type':'stale_tape','ts':b.ts,'effect':'none'})
            continue
        view = account.view(b.close)
        proposal = policy.decide(bars[max(0, i-512):i+1], view)
        if proposal.effect != 'none' or proposal.source != policy.name:
            raise ValueError('invalid proposal authority/source')
        if not isinstance(proposal.target_bps, int) or isinstance(proposal.target_bps,bool):
            account.rejects += 1
            continue
        target = proposal.target_bps
        if peak > 0 and (peak-eq)/peak*10000 >= risk.max_drawdown_bps:
            target = 0
        rejection = risk_check(target, b, account, risk, b.close, peak)
        if rejection:
            account.rejects += 1
            account.events.append({'type':'proposal_rejected','ts':b.ts,'reason':rejection,'effect':'none'})
            continue
        if abs(target - view.target_bps) >= 1:
            when = i + 1 + risk.latency_bars
            if when < end:
                pending = (when, target, proposal.reason)
                account.events.append({'type':'candidate','ts':b.ts,'target_bps':target,'reason':proposal.reason,
                                       'source':proposal.source,'execute_bar':when,'effect':'none'})
    if account.qty and account.equity(bars[end-1].close) > 0:
        fill(account, bars[end-1], 0, risk, bars[end-1].close, 'end_of_window', force=True)
        curve[-1] = account.equity(bars[end-1].close)
    if not exposures:
        exposures = [0.0]
    if len(curve) < 2:
        curve = [risk.initial_equity, account.equity(bars[end-1].close)]
    ret = [(b / a - 1) for a,b in zip(curve,curve[1:]) if a > 0 and b > 0]
    average = statistics.mean(ret) if ret else 0
    vol = statistics.pstdev(ret) if len(ret) > 1 else 0
    sharpe = (average / vol * math.sqrt(365 * 86400 / cadence_sec)) if vol > 0 else None
    running_peak = curve[0]
    dd = 0.0
    for v in curve:
        running_peak = max(running_peak, v)
        if running_peak > 0:
            dd = max(dd, (running_peak-v)/running_peak)
    last = curve[-1]
    return {'net_pnl_usd':round(last-risk.initial_equity,5),'net_return_pct':round((last/risk.initial_equity-1)*100,6),
            'max_drawdown_pct':round(dd*100,6),'annualized_sharpe_approx':round(sharpe,5) if sharpe is not None else None,
            'orders':account.orders,'closed_trades':account.closed_trades,
            'win_rate_closed_pct_approx':round(account.winning_trades/account.closed_trades*100,3) if account.closed_trades else None,
            'fees_usd':round(account.fees,5),'spread_slippage_usd':round(account.execution_cost,5),
            'funding_usd_signed':round(account.funding,5),'turnover_usd':round(account.turnover,5),
            'avg_gross_exposure':round(statistics.mean(exposures),6),'peak_gross_exposure':round(max(exposures),6),
            'risk_rejections':account.rejects,'liquidations':account.liquidations,'bankruptcies':account.bankruptcies,
            'events':account.events}


def time_splits(n: int) -> dict[str, tuple[int,int]]:
    if n < 120:
        raise ValueError('at least 120 bars')
    a, b = round(n*0.60), round(n*0.80)
    return {'development':(0,a),'validation':(a,b),'holdout':(b,n)}


def fit_moneyball(dev_results: dict[str, dict[str,dict]], floor: float=0.08, temperature: float=1.0) -> dict[str,float]:
    names = ('buy_hold','ema_cross','ribbon_proxy','mean_revert')
    if floor < 0 or floor * len(names) > 1 or temperature <= 0:
        raise ValueError('invalid allocator hyperparameters')
    scores = {}
    for name in names:
        m = [dev_results[scenario][name] for scenario in SCENARIOS]
        # Normalized percentage-point score; original Moneyball score uses PnL-DD and wins.
        scores[name] = statistics.mean(x['net_return_pct'] - 0.5*x['max_drawdown_pct'] for x in m)
    largest = max(scores.values())
    exps = {k:math.exp((v-largest)/temperature) for k,v in scores.items()}
    total = sum(exps.values())
    return {k:round(floor+(1-floor*len(names))*v/total,10) for k,v in exps.items()}


def read_risk(path: Path | None) -> Risk:
    if path is None:
        return Risk()
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or any(k not in Risk.__dataclass_fields__ for k in data):
        raise ValueError('unsupported risk setting')
    return Risk(**data)


def run(args: argparse.Namespace) -> dict:
    if args.csv and args.tmb_spec is None:
        datasets = {'external_csv':load_csv(Path(args.csv))}
    elif args.csv:
        datasets = {'external_csv':load_csv(Path(args.csv))}
    else:
        if args.tmb_spec:
            raise ValueError('native TradingMoneyball needs a 5-second CSV, not synthetic 1-minute ticks')
        datasets = {name:synthetic(args.seed + k*1009, name, args.bars) for k,name in enumerate(SCENARIOS)}
    risk = read_risk(Path(args.risk_config) if args.risk_config else None)
    names = ('flat','buy_hold','ema_cross','ribbon_proxy','mean_revert')
    results: dict[str,dict] = {}
    scenarios = tuple(datasets)
    cadence_map = {}
    raw_hashes = {}
    for scenario,bars in datasets.items():
        gaps = [bars[i].ts-bars[i-1].ts for i in range(1,len(bars))]
        cadence = min(gaps)
        cadence_map[scenario] = cadence
        raw_hashes[scenario] = digest([asdict(b) for b in bars])
        if args.tmb_spec and (cadence > 5 or any(dt != 5 for dt in gaps)):
            raise ValueError('native TMB bridge needs evenly spaced 5-second bars')
        splits = time_splits(len(bars))
        results[scenario] = {}
        for split,(start,end) in splits.items():
            if split == 'holdout' and not args.unlock_holdout:
                continue
            results[scenario][split] = {}
            for name in names:
                result = simulate(bars,start,end,Baseline(name),risk,cadence)
                result.pop('events')  # traces stored only in opted-in artifact replay
                results[scenario][split][name] = result
            if args.tmb_spec:
                from native_tmb import NativeTMB
                policy = NativeTMB(Path(args.tmb_root),Path(args.tmb_spec))
                native = simulate(bars,start,end,policy,risk,cadence)
                native.pop('events')
                results[scenario][split]['tmb_native'] = native
    if args.csv:
        # Local CSV is a separate experiment; no comparison across uncommitted datasets.
        weights = None
    else:
        dev = {s:results[s]['development'] for s in scenarios}
        weights = fit_moneyball(dev)
        for scenario,bars in datasets.items():
            for split,(start,end) in time_splits(len(bars)).items():
                if split=='holdout' and not args.unlock_holdout:
                    continue
                blend = simulate(bars,start,end,Baseline('moneyball_blend',weights),risk,cadence_map[scenario])
                blend.pop('events')
                results[scenario][split]['moneyball_blend'] = blend
    manifest = {'schema':SCHEMA,'mode':'paper_simulation','BitAgent_target':'Strategy Covenant candidate-only',
                'TradingMoneyball_source':'patrickdugan/TradingMoneyball',
                'TradingMoneyball_source_sha':'62995583d410052d654abcb2bcdf95b6cab7cfe6',
                'BitAgent_base_sha':'d234ff5456f43588eb019dc11b1b39130bcf7a3f',
                'seed':args.seed,'bars_per_scenario':len(next(iter(datasets.values()))),
                'scenarios':list(scenarios),'cadence_sec':cadence_map,'market_data_hashes':raw_hashes,
                'risk':asdict(risk),'split':'chronological 60% development / 20% validation / 20% locked holdout',
                'holdout_unlocked':bool(args.unlock_holdout),'moneyball_weights_dev_only':weights,
                'tmb_native':bool(args.tmb_spec),'authority':{'effect':'none','signingPerformed':False,'broadcastPerformed':False}}
    out = {'manifest':manifest,'results':results}
    out['manifest']['receipt_sha256'] = digest(out)
    return out


def main():
    p = argparse.ArgumentParser(description='BitAgent trading system gym; candidate-only')
    p.add_argument('--seed',type=int,default=20261123)
    p.add_argument('--bars',type=int,default=1200)
    p.add_argument('--csv',help='opt-in local OHLCV bars with 7 required columns')
    p.add_argument('--risk-config',help='JSON override for risk and cost assumptions')
    p.add_argument('--unlock-holdout',action='store_true',help='final confirmation only; never tune on holdout')
    p.add_argument('--tmb-root',help='local checkout of private TradingMoneyball repo')
    p.add_argument('--tmb-spec',help='local TradingMoneyball strategy spec JSON')
    p.add_argument('--output',default='')
    a=p.parse_args()
    if bool(a.tmb_spec) != bool(a.tmb_root):
        p.error('--tmb-spec and --tmb-root must appear together')
    result = run(a)
    data=json.dumps(result,sort_keys=True,indent=2,allow_nan=False)+'\n'
    if a.output:
        target=Path(a.output);target.parent.mkdir(parents=True,exist_ok=True);target.write_text(data,encoding='utf-8')
        print(f'{SCHEMA}: wrote {target} sha256={result["manifest"]["receipt_sha256"]}')
    else:
        print(data)


if __name__ == '__main__':
    main()
