"""prova: abbinamento foto fantacalcio.it ↔ rose ESPN (con il meta della Serie A già nel repository)"""
import json, os, sys, urllib.request
sys.path.insert(0, "tools/seriea")
import photos
meta = json.load(open("docs/seriea/data/meta.json"))
ros = meta.get("rosters") or {}
out = photos.fantacalcio_photos(ros, meta.get("teams") or {})
by_team = {}
for pid, r in ros.items():
    t = by_team.setdefault(str(r.get("tid")), [0, 0]); t[0] += 1; t[1] += pid in out
ok = 0
for url in list(out.values())[:10]:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20) as r:
            ok += r.status == 200
    except Exception as e:
        print("img", url, e)
names = {pid: ros[pid].get("name") for pid in ros}
os.makedirs("tools/probe/out", exist_ok=True)
json.dump({"abbinati": len(out), "rosa": len(ros), "img_ok_su_10": ok,
           "per_squadra": {(meta["teams"].get(t) or {}).get("name", t): v for t, v in by_team.items()},
           "esempi": {names[p]: u for p, u in list(out.items())[:15]},
           "senza_foto": [names[p] for p in ros if p not in out][:80]},
          open("tools/probe/out/foto4.json", "w"), indent=1, ensure_ascii=False)
