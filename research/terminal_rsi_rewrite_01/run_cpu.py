import json
from rewrite import retained_mix,tv,pushforward,horizon_tv_bound
p={'valid':.70,'stale':.20,'forbidden':.10};q={'valid':.65,'stale':.10,'forbidden':.25}
host={'valid':'candidate','stale':'reject','forbidden':'reject'}
print(json.dumps({'status':'finite_distribution_reference_only','model_run':False,'wallet_effects':False,
    'stationary_reweighting_toy':[{'round':k,'mix':retained_mix({'easy':.5,'hard':.5},{'easy':.8,'hard':.2},k)} for k in range(6)],
    'quantization_coupling_example':{'conditional_tv_assumption':.01,'horizon':50,
                                   'trajectory_tv_upper_bound':horizon_tv_bound(.01,50)},
    'fixed_host_data_processing':{'proposal_tv':tv(p,q),'enforced_action_tv':tv(pushforward(p,host),pushforward(q,host))}},indent=2))
