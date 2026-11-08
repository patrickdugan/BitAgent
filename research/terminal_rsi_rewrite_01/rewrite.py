"""Finite-distribution rewrite and host-map references. No wallet/runtime access."""
import math
from typing import Mapping

def distribution(p:Mapping[str,float])->dict[str,float]:
    if not p or any(not math.isfinite(x) or x<0 for x in p.values()):raise ValueError('Invalid weights')
    total=sum(p.values())
    if total<=0:raise ValueError('Empty support')
    return {k:v/total for k,v in p.items()}

def retained_mix(prior:Mapping[str,float],acceptance:Mapping[str,float],rounds:int=1)->dict[str,float]:
    if set(prior)!=set(acceptance) or type(rounds) is not int or rounds<0:raise ValueError('Invalid dimensions/rounds')
    if any(not math.isfinite(a) or not 0<=a<=1 for a in acceptance.values()):raise ValueError('Invalid acceptance probability')
    p=distribution(prior)
    for _ in range(rounds):p=distribution({k:p[k]*acceptance[k] for k in p})
    return p

def tv(p:Mapping[str,float],q:Mapping[str,float])->float:
    p=distribution(p);q=distribution(q)
    return .5*sum(abs(p.get(k,0)-q.get(k,0)) for k in p.keys()|q.keys())

def pushforward(p:Mapping[str,float],host:Mapping[str,str])->dict[str,float]:
    p=distribution(p)
    if not p.keys()<=host.keys():raise ValueError('Host map is incomplete')
    out={}
    for k,v in p.items():out[host[k]]=out.get(host[k],0)+v
    return out

def horizon_tv_bound(delta:float,horizon:int)->float:
    """Requires a uniform conditional per-decision TV bound at matched histories."""
    if not math.isfinite(delta) or not 0<=delta<=1 or type(horizon) is not int or horizon<0:
        raise ValueError('Invalid bound inputs')
    if horizon==0:return 0.0
    if delta==1:return 1.0
    return -math.expm1(horizon*math.log1p(-delta))

def balanced_supported_mix(acceptance:Mapping[str,float])->dict[str,float]:
    if not acceptance or any(not math.isfinite(a) or not 0<a<=1 for a in acceptance.values()):
        raise ValueError('Balanced replay needs positive verified support in every family')
    return {k:1/len(acceptance) for k in acceptance}
