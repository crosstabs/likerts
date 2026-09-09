"""Illustrative Likerts USD economics; run python3 economics/model.py. No external dependencies."""
import csv, json, math
from pathlib import Path
OUT = Path(__file__).resolve().parent
DEFAULT = dict(price=0.01, setup_fee=5, payment_pct=0.029, payment_fixed=0.30,
               variable_ex_email=0.0004, emails_per_response=1, email_unit=0.0001,
               infra=200, sso=0, support=20, overhead=10000, customers=100,
               setup_cost=1)

def evaluate(responses, **overrides):
    a = DEFAULT | overrides
    revenue = responses*a['price']
    payment = revenue*a['payment_pct'] + (a['payment_fixed'] if responses else 0)
    variable = responses*(a['variable_ex_email'] + a['emails_per_response']*a['email_unit'])
    infra_margin = revenue-payment-variable-a['infra']-a['sso']
    contribution = infra_margin-a['support']
    allocated = contribution-a['overhead']/a['customers']
    return dict(responses=responses,revenue=revenue,payment=payment,variable=variable,
                infrastructure_margin=infra_margin,contribution=contribution,after_overhead=allocated)

def threshold(fixed, margin=0, **overrides):
    a = DEFAULT | overrides
    net = a['price']*(1-a['payment_pct']-margin)-a['variable_ex_email']-a['emails_per_response']*a['email_unit']
    return math.ceil((fixed+a['payment_fixed'])/net - 1e-9) if net>0 else None

def main():
    assert abs(evaluate(100000)['contribution']-700.7)<1e-8
    assert evaluate(0)['payment']==0
    assert threshold(220)==23920
    assert evaluate(threshold(220))['contribution']>=0
    assert evaluate(threshold(220)-1)['contribution']<0
    assert threshold(220,emails_per_response=100) is None
    rows = [evaluate(n,infra=f) | {'infra':f} for f in (75,200,500) for n in (0,100,1000,10000,100000,1000000)]
    with (OUT/'scenarios.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
    summary = {'assumptions':DEFAULT,'break_even':{str(f):{'infrastructure':threshold(f),'with_support':threshold(f+20),'with_overhead':threshold(f+120),'80pct_contribution':threshold(f+20,.8)} for f in (75,200,500)},
               'setup_net_after_processing':5*(1-.029)-.30,
               'setup_net_after_assumed_provisioning':5*(1-.029)-.30-1,
               'base_sso_125_break_even':threshold(345),
               'fleet_100_at_100k_each':100*evaluate(100000)['contribution']-10000,
               'fleet_10_at_100k_90_idle':10*evaluate(100000)['contribution']+90*evaluate(0)['contribution']-10000,
               'scenarios':rows}
    (OUT/'results.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k not in ('assumptions','scenarios')},indent=2))
if __name__=='__main__': main()
