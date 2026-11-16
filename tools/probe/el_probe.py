"""Prova: API EuroLeague (calendario, tabellino, cronaca, immagini). Salva campioni in tools/probe/out/."""
import json, os, time, urllib.request
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"); os.makedirs(OUT, exist_ok=True)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
def fetch(url):
    time.sleep(1)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        b = r.read()
    try: return json.loads(b)
    except Exception: return {"_testo": b.decode("utf-8", "replace")[:3000]}
def shape(x, d=0, maxd=5):
    if d > maxd: return type(x).__name__
    if isinstance(x, dict): return {k: shape(v, d+1, maxd) for k, v in list(x.items())[:70]}
    if isinstance(x, list): return [f"lista di {len(x)}", shape(x[0], d+1, maxd)] if x else "lista vuota"
    return x if isinstance(x, (int, float, bool)) or x is None else str(x)[:90]
res = {}
urls = {
 "games_E2026": "https://api-live.euroleague.net/v2/competitions/E/seasons/E2026/games",
 "games_E2025": "https://api-live.euroleague.net/v2/competitions/E/seasons/E2025/games",
 "box_E2026_1": "https://live.euroleague.net/api/Boxscore?gamecode=1&seasoncode=E2026",
 "pbp_E2026_1": "https://live.euroleague.net/api/PlaybyPlay?gamecode=1&seasoncode=E2026",
 "header_E2026_1": "https://live.euroleague.net/api/Header?gamecode=1&seasoncode=E2026",
 "v3_game_E2026_1": "https://api-live.euroleague.net/v3/competitions/E/seasons/E2026/games/1",
 "clubs_E2026": "https://api-live.euroleague.net/v2/competitions/E/seasons/E2026/clubs",
 "people_E2026": "https://api-live.euroleague.net/v2/competitions/E/seasons/E2026/people",
 "v3_players_stats": "https://api-live.euroleague.net/v3/competitions/E/seasons/E2026/statistics/players/traditional?SeasonMode=Single&statisticMode=perGame&limit=3",
 "v2_game_stats_1": "https://api-live.euroleague.net/v2/competitions/E/seasons/E2026/games/1/stats",
}
for k, u in urls.items():
    try:
        d = fetch(u)
        res[k] = {"url": u, "struttura": shape(d), "campione": json.dumps(d, ensure_ascii=False)[:5000]}
    except Exception as e:
        res[k] = {"url": u, "errore": str(e)[:200]}
    print(k, "errore" in res[k])
json.dump(res, open(os.path.join(OUT, "eurolega.json"), "w"), ensure_ascii=False, indent=1)
