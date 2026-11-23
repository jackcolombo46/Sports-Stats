"""Prova: foto dei giocatori di Serie A (ESPN e fantacalcio.it). Non tocca l'app."""
import json, os, re, time, urllib.request, urllib.error, random
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"); os.makedirs(OUT, exist_ok=True)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
def get(url, head=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA}, method="HEAD" if head else "GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, (None if head else r.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:
        return str(e)[:60], None
meta = json.load(open("docs/seriea/data/meta.json"))
ros = meta["rosters"]
# giocatori che hanno giocato quest'anno
played = set()
for f in meta["files"]:
    if not os.path.basename(f).startswith(meta["season"]): continue
    d = json.load(open("docs/seriea/data/" + f)); ix = {c: i for i, c in enumerate(d["cols"])}
    played |= {str(r[ix["pid"]]) for r in d["rows"] if r[ix["min"]] > 0}
res = {"giocatori_stagione": len(played)}
# 1. ESPN: immagine del cdn (come fa l'app) per tutti
ok = 0; miss = []
for pid in sorted(played):
    s, _ = get(f"https://a.espncdn.com/i/headshots/soccer/players/full/{pid}.png", head=True)
    if s == 200: ok += 1
    else: miss.append(pid)
    time.sleep(0.05)
res["espn_cdn"] = {"con_foto": ok, "senza": len(miss), "esempi_senza": [(p, (ros.get(p) or {}).get("name")) for p in miss[:15]]}
print("ESPN", ok, len(miss), flush=True)
# 2. fantacalcio.it: pagina di una squadra / di un giocatore, cerco l'indirizzo delle immagini
pages = {}
for url in ("https://www.fantacalcio.it/serie-a/squadre/inter", "https://www.fantacalcio.it/serie-a/squadre/inter/rosa",
            "https://www.fantacalcio.it/quotazioni-fantacalcio", "https://www.fantacalcio.it/statistiche-serie-a"):
    s, b = get(url)
    t = (b or b"").decode("utf-8", "replace")
    imgs = sorted(set(re.findall(r'https?://content\.fantacalcio\.it/web/[^"\'\s>]+\.(?:png|jpg|webp)', t)))
    players = [x for x in imgs if "campioncin" in x or "player" in x.lower() or "calciator" in x]
    pages[url] = {"status": s, "len": len(t), "immagini": len(imgs), "giocatori": players[:12], "altre": imgs[:6]}
    print(url, s, len(imgs), len(players), flush=True)
res["fantacalcio"] = pages
json.dump(res, open(os.path.join(OUT, "foto.json"), "w"), ensure_ascii=False, indent=1)
