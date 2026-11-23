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

# diagnosi della pagina fantacalcio.it
import re, injuries as INJ
page = INJ.fetch(INJ.FC_URL, as_json=False)
open(os.path.join(OUT, "fc_page.html"), "w").write(page or "")
meta = json.load(open("docs/seriea/data/meta.json"))
diag = []
for card in re.split(r'<div id="team-\d+"', page or "")[1:]:
    m = re.search(r'class="team-name">([^<]+)<', card)
    labels = [(INJ.plain(seg.split("<", 1)[0]), len(re.findall(r'<strong class="item-name">', seg))) for seg in re.split(r'<strong class="label[^"]*">', card)[1:]]
    diag.append({"team": m.group(1) if m else None, "tid": INJ._team_id(m.group(1), meta["teams"]) if m else None, "labels": labels,
                 "items": len(re.findall(r'item-name', card))})
json.dump(diag, open(os.path.join(OUT, "fc_diag.json"), "w"), ensure_ascii=False, indent=1)
