"""Prova degli indisponibili (non scrive i dati dell'app): Serie A da fantacalcio.it, Champions con la regola."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "seriea"))
import update_data as U
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"); os.makedirs(OUT, exist_ok=True)
res = {}
for league, data in (("ita.1", "docs/seriea/data"), ("uefa.champions", "docs/ucl/data")):
    U.configure(league, data)
    meta = json.load(open(os.path.join(data, "meta.json")))
    cur = [f for f in meta["files"] if os.path.basename(f).startswith(meta["season"])]
    try:
        res[league] = U.extra_injuries(meta, meta["teams"], cur)
    except Exception as e:
        res[league] = {"errore": str(e)}
json.dump(res, open(os.path.join(OUT, "indisponibili.json"), "w"), ensure_ascii=False, indent=1)
