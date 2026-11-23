"""Prova 3: elenco completo dei giocatori di fantacalcio.it (quotazioni / rose). Non tocca l'app."""
import os, re, json, urllib.request
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"); os.makedirs(OUT, exist_ok=True)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
res = {}
for name, url in (("quotazioni", "https://www.fantacalcio.it/quotazioni-fantacalcio"), ("rosa_inter", "https://www.fantacalcio.it/serie-a/squadre/inter/rosa"),
                  ("statistiche", "https://www.fantacalcio.it/statistiche-serie-a")):
    t = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=40).read().decode("utf-8", "replace")
    links = sorted(set(re.findall(r'/serie-a/squadre/([a-z0-9-]+)/([a-z0-9-]+)/(\d+)', t)))
    res[name] = {"len": len(t), "link_giocatori": len(links), "squadre": len({l[0] for l in links}), "esempi": links[:8],
                 "campioncini": sorted(set(re.findall(r'campioncini/(\d+)/', t)))}
    print(name, res[name]["link_giocatori"], res[name]["squadre"], flush=True)
json.dump(res, open(os.path.join(OUT, "foto3.json"), "w"), ensure_ascii=False, indent=1)
