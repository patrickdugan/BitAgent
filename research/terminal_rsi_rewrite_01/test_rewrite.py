import random,unittest
from rewrite import retained_mix,tv,pushforward,horizon_tv_bound,balanced_supported_mix,distribution
class RewriteTests(unittest.TestCase):
    def test_single_round_censoring(self):
        q=retained_mix({'easy':.5,'hard':.5},{'easy':.8,'hard':.2})
        self.assertAlmostEqual(q['easy'],.8)
    def test_repeated_stationary_censoring(self):
        q=retained_mix({'easy':.5,'hard':.5},{'easy':.8,'hard':.2},5)
        self.assertAlmostEqual(q['hard'],1/1025)
    def test_stratification(self):
        self.assertEqual(balanced_supported_mix({'easy':.8,'hard':.2}),{'easy':.5,'hard':.5})
    def test_support_gap_fails_closed(self):
        with self.assertRaises(ValueError):balanced_supported_mix({'easy':1,'hard':0})
        with self.assertRaises(ValueError):retained_mix({'a':1},{'a':0})
    def test_data_processing_200_random_pairs(self):
        rng=random.Random(905);host={str(k):str(k//3) for k in range(12)}
        for _ in range(200):
            p={str(k):rng.random() for k in range(12)};q={str(k):rng.random() for k in range(12)}
            self.assertLessEqual(tv(pushforward(p,host),pushforward(q,host)),tv(p,q)+1e-12)
    def test_horizon_bound(self):
        self.assertAlmostEqual(horizon_tv_bound(.01,50),1-.99**50)
        self.assertLessEqual(horizon_tv_bound(.01,50),.5)
        self.assertEqual(horizon_tv_bound(1,0),0)
        self.assertEqual(horizon_tv_bound(1,2),1)
    def test_weight_norm_does_not_control_action_flip(self):
        # An arbitrarily small scalar edit can flip a deterministic argmax.
        self.assertEqual(tv({'approve':1},{'reject':1}),1)
    def test_invalid_host_and_probabilities(self):
        with self.assertRaises(ValueError):pushforward({'a':1},{})
        with self.assertRaises(ValueError):distribution({'a':-1})
        with self.assertRaises(ValueError):horizon_tv_bound(.1,-1)
        with self.assertRaises(ValueError):retained_mix({'a':1},{'a':2})
if __name__=='__main__':unittest.main()
