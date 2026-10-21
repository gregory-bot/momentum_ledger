from momentum.simulator import generate_match
from momentum.pipeline import MatchPipeline
from collections import Counter
m,ev=generate_match()
p=MatchPipeline(m)
for _ in p.run(ev): pass
print(Counter(i.kind for i in p.insights))
bad=0
for i in p.insights:
    for f in i.facts.values():
        try: r=p.ledger.evaluate(f.query)
        except Exception as ex: print('ERR',i.id,f.key,ex); bad+=1; continue
        if isinstance(f.value,(int,float)) and not isinstance(f.value,bool):
            ok = abs(round(r,f.precision)-f.value) <= 10**-f.precision/2+1e-9
        else: ok = r==f.value
        if not ok: bad+=1; print('MISMATCH',i.id,f.key,f.value,r)
print('bad',bad)
for i in p.insights:
    if i.kind in('regime_shift','tactical_story','momentum_swing'): print(i.minute,i.kind,i.team,{k:f.display for k,f in i.facts.items() if not k.startswith('team') or k=='team'})
