"""Opt-in read-only import of TradingMoneyball strategy code from a local checkout.

This module never imports app.main, app.runner.live_executor, Lighter adapters,
.env, the event database, or any exchange connection. Requires pydantic v2.
Data input must contain genuine 5-second observations; runner supplies that gate.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Sequence
from gym import Bar, PositionView, Proposal


class NativeTMB:
    name = 'tmb_native'

    def __init__(self, repo: Path, spec_path: Path, size_bps: int = 3000):
        root = repo.resolve(strict=True)
        spec_path = spec_path.resolve(strict=True)
        if not (root / 'app' / 'strategy' / 'base.py').is_file():
            raise ValueError('TradingMoneyball checkout missing app/strategy/base.py')
        if spec_path.parent != (root / 'strategies').resolve():
            raise ValueError('strategy spec must be in TradingMoneyball/strategies')
        if not (0 <= size_bps <= 7000):
            raise ValueError('invalid strategy notional')
        data = json.loads(spec_path.read_text(encoding='utf-8'))
        # StrategySpec validates this config against TMB's own type/range schema.
        # Python module name "app" is intentionally restricted to this checkout.
        if 'app' in sys.modules:
            path = str(getattr(sys.modules['app'], '__path__', [''])[0])
            if not str(Path(path).resolve()).startswith(str(root)):
                raise RuntimeError('conflicting Python app package already imported')
        sys.path.insert(0, str(root))
        from app.strategy.spec import StrategySpec
        from app.strategy.factory import create_strategy
        from app.strategy.base import Position
        import importlib
        from app.data.candles import MultiCandles
        self.spec = StrategySpec.model_validate(data)
        allowed = {'fib_ribbon':'variant', 'ema_crossover':'ema_crossover', 'rsi_reversal':'rsi_reversal'}
        if self.spec.strategy_type not in allowed:
            raise ValueError('unsupported native strategy type: '+self.spec.strategy_type)
        # Load one reviewed pure strategy module, not the runner or execution stack.
        importlib.import_module('app.strategy.'+allowed[self.spec.strategy_type])
        self.strategy = create_strategy(self.spec)
        self.Position = Position
        self.candles = MultiCandles()
        for name,seconds in (('5s',5),('1m',60),('5m',300),('15m',900),('1h',3600)):
            self.candles.add(name,seconds,max_candles=1000)
        self.size_bps=size_bps
        self._last_ts = -1
        self._cooldown_until = -1

    def _ingest(self, bars: Sequence[Bar]):
        for bar in bars:
            if bar.ts <= self._last_ts:
                continue
            self.candles.on_tick(bar.ts,bar.close, size=bar.volume_usd / bar.close)
            self._last_ts=bar.ts

    def warm_start(self, bars: Sequence[Bar]):
        self._ingest(bars)

    def on_fill(self, ts: int, qty: float):
        if qty != 0:
            self._cooldown_until = ts + self.spec.cooldown_sec

    def decide(self, history: Sequence[Bar], position: PositionView) -> Proposal:
        self._ingest(history)
        b = history[-1]
        if position.qty:
            side = 'LONG' if position.qty > 0 else 'SHORT'
            snapshot = self.Position(side=side,entry_price=position.entry_price,
                                     entry_ts=position.entry_ts,size=abs(position.qty),
                                     high_water=position.high_water,low_water=position.low_water)
            sig = self.strategy.compute_exit(self.candles,b.close,b.ts,snapshot)
            if sig.should_exit:
                return Proposal(0,'native TMB exit: '+sig.exit_type,self.name)
            return Proposal(position.target_bps,'native TMB position hold',self.name)
        if b.ts < self._cooldown_until:
            return Proposal(0,'native TMB cooldown',self.name)
        sig = self.strategy.compute_signal(self.candles,b.close,b.ts)
        if not sig.is_entry or sig.strength < self.spec.entry_min_strength:
            return Proposal(0,'native TMB flat',self.name)
        if (self.spec.side_mode == 'LONG_ONLY' and sig.is_short) or (self.spec.side_mode == 'SHORT_ONLY' and sig.is_long):
            return Proposal(0,'native TMB side mode',self.name)
        throttle = sig.metadata.get('throttle',1.0)
        if not isinstance(throttle,(float,int)) or not (0 <= throttle <= 1):
            raise ValueError('native TMB returned invalid throttle')
        return Proposal(round(self.size_bps * throttle)*(1 if sig.is_long else -1),
                        'native TMB '+self.spec.strategy_type,self.name)
