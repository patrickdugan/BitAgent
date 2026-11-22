"""Offline stdlib tests: python -m unittest discover -s research/trading_systems_gym -p 'test_*.py' -v"""
import argparse
import csv
import json
import math
from pathlib import Path
import tempfile
import unittest

from gym import Bar, Baseline, Proposal, Risk, Account, digest, fill, fit_moneyball, load_csv, risk_check, run, simulate, synthetic, time_splits


class GymTests(unittest.TestCase):
    def setUp(self):
        self.bars = synthetic(11, 'trend', 240)
        self.risk = Risk()

    def test_repeatability_and_seed_isolation(self):
        self.assertEqual(self.bars, synthetic(11, 'trend', 240))
        self.assertNotEqual(self.bars, synthetic(12, 'trend', 240))
        self.assertNotEqual(digest([x.close for x in self.bars]), digest([x.close for x in synthetic(12, 'trend', 240)]))

    def test_price_validation(self):
        with self.assertRaises(ValueError):
            Bar(1, 1, 1, 1, math.nan, 20, 4)
        with self.assertRaises(ValueError):
            Bar(1, 2, 2, 3, 1, 20, 4)

    def test_timestamp_validation(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'bad.csv'
            with p.open('w',newline='') as f:
                w=csv.writer(f);w.writerow(['ts','open','high','low','close','volume_usd','spread_bps'])
                for i in range(120):w.writerow([100 if i==45 else i,100,100,100,100,100000,3])
            with self.assertRaises(ValueError):
                load_csv(p)

    def test_zero_trade_flat(self):
        m=simulate(self.bars,0,240,Baseline('flat'),self.risk,60)
        self.assertEqual(m['orders'],0)
        self.assertEqual(m['net_pnl_usd'],0)
        self.assertEqual(m['bankruptcies'],0)

    def test_costs_reduce_return_on_constant_market(self):
        bars=[Bar(1700000000+i*60,100,100,100,100,100000,4) for i in range(120)]
        m=simulate(bars,0,120,Baseline('buy_hold'),self.risk,60)
        self.assertLess(m['net_pnl_usd'],0)
        self.assertGreater(m['fees_usd'],0)
        self.assertGreater(m['spread_slippage_usd'],0)
        self.assertEqual(m['liquidations'],0)

    def test_funding_long_vs_short(self):
        flat=[Bar(1700000000+i*60,100,100,100,100,100000,0) for i in range(140)]
        positive=Risk(fee_bps=0,slippage_bps=0,impact_bps=0,funding_bps_per_bar=0.5)
        nofund=Risk(fee_bps=0,slippage_bps=0,impact_bps=0,funding_bps_per_bar=0)
        a=simulate(flat,0,140,Baseline('buy_hold'),positive,60)
        b=simulate(flat,0,140,Baseline('buy_hold'),nofund,60)
        self.assertLess(a['net_pnl_usd'],b['net_pnl_usd'])
        self.assertGreater(a['funding_usd_signed'],0)

    def test_position_limit_fails_closed(self):
        a=Account(10000)
        self.assertEqual(risk_check(9000,self.bars[0],a,self.risk,100,10000),'position_limit')
        self.assertIsNone(risk_check(3000,self.bars[0],a,self.risk,100,10000))

    def test_no_lookahead_causal_prefix(self):
        # Changing bars beyond the split must leave earlier results identical.
        a=simulate(self.bars,0,144,Baseline('ema_cross'),self.risk,60)
        modified=list(self.bars)
        for i in range(144,240):
            b=modified[i];modified[i]=Bar(b.ts,b.open,b.high,b.low,b.close*0.5,b.volume_usd,b.spread_bps) if b.close*0.5>=b.low else b
        z=simulate(modified,0,144,Baseline('ema_cross'),self.risk,60)
        self.assertEqual(a,z)

    def test_splits_disjoint(self):
        a=time_splits(1000)
        self.assertEqual(a['development'],(0,600))
        self.assertEqual(a['validation'],(600,800))
        self.assertEqual(a['holdout'],(800,1000))

    def test_locked_holdout_default(self):
        args=argparse.Namespace(csv=None,tmb_spec=None,tmb_root=None,seed=3,bars=180,risk_config=None,unlock_holdout=False)
        a=run(args)
        self.assertEqual(a['manifest']['holdout_unlocked'],False)
        self.assertFalse(any('holdout' in x for x in a['results'].values()))
        self.assertIn('moneyball_blend',a['results']['trend']['validation'])
        self.assertEqual(a,run(args))
        args.unlock_holdout=True
        b=run(args)
        self.assertIn('holdout',b['results']['trend'])
        self.assertEqual(a['results']['trend']['development'],b['results']['trend']['development'])
        self.assertEqual(a['manifest']['moneyball_weights_dev_only'],b['manifest']['moneyball_weights_dev_only'])

    def test_high_spread_reject(self):
        q=Bar(1,100,100,100,100,100000,200)
        self.assertEqual(risk_check(3000,q,Account(10000),self.risk,100,10000),'cost_ceiling')

    def test_single_bar_future_execution(self):
        # One bar means no orders, even if the strategy wants to trade.
        a=simulate(self.bars,0,1,Baseline('buy_hold'),self.risk,60)
        self.assertEqual(a['orders'],0)

    def test_policy_proposal_cannot_claim_effect(self):
        class BadPolicy:
            name='bad'
            def decide(self,history,position):return Proposal(1000,'bad','bad','executed')
        with self.assertRaises(ValueError):
            simulate(self.bars,0,4,BadPolicy(),self.risk,60)


if __name__=='__main__':
    unittest.main()
