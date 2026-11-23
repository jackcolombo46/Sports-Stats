"""prova: quali foto esistono davvero (pagine squadra fantacalcio.it) e in che cartella"""
import json, re, sys, urllib.request
sys.path.insert(0, "tools/seriea")
from injuries import fetch
page = fetch("https://www.fantacalcio.it/quotazioni-fantacalcio", as_json=False)
links = sorted(set(re.findall(r"/serie-a/squadre/([a-z0-9-]+)/([a-z0-9-]+)/(\d+)", page)))
teams = sorted({t for t, _, _ in links})
res, found = {}, {}
for t in teams:
    try:
        h = fetch(f"https://www.fantacalcio.it/serie-a/squadre/{t}", as_json=False) or ""
    except Exception as e:
        res[t] = str(e); continue
    imgs = re.findall(r"campioncini/(\d+)/(\w+)/(\d+)\.png", h)
    for f, s, i in imgs:
        found[i] = f
    ids = {i for tt, _, i in links if tt == t}
    res[t] = {"giocatori": len(ids), "con_foto_in_pagina": len(ids & {i for _, _, i in imgs}),
              "cartelle": sorted({f for f, _, _ in imgs})}
def head(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, method="HEAD", headers={"User-Agent": "Mozilla/5.0"}), timeout=15) as r:
            return r.status
    except Exception as e:
        return getattr(e, "code", str(e))
prove = {}
for t, p, i in links[:12]:
    prove[f"{p} ({t}) {i}"] = {f: head(f"https://content.fantacalcio.it/web/campioncini/{f}/medium/{i}.png") for f in ("21", "20", "22")}
json.dump({"squadre": res, "foto_trovate": len(found), "prove": prove}, open("tools/probe/out/foto5.json", "w"), indent=1)
