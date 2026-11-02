"""Prova temporanea 2: stagioni passate e dettaglio partita."""
import json, time, urllib.request, urllib.error
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
S = "https://www.legabasket.it/api/championships/"
def get(path):
    time.sleep(1); t0 = time.time()
    req = urllib.request.Request(S + path, headers={"User-Agent": UA, "Accept": "application/json", "Referer": "https://www.legabasket.it/calendario"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, json.loads(r.read()), time.time() - t0
    except Exception as e: return getattr(e, "code", 0), None, time.time() - t0
st, d, _ = get("get-championships?current=true")
print("RS/PO recent:", [(c["id"], c["year"], c["ctype_code"], c["name"]) for c in d["competitions"] if c["year"] >= 2023 and c.get("championship_series_id") == 1])
for cid in (602, 596, 567):
    st, d, dt = get(f"get-championships-summary-by-id?id={cid}")
    tab = (d or {}).get("summary_table") or {}
    games = [g for h in tab.values() for g in h.values()]
    played = [g for g in games if g.get("score") not in (None, "0-0")]
    print(f"SUMMARY {cid}: HTTP {st} {dt:.1f}s teams={len(tab)} games={len(games)} played={len(played)} sample={games[:1]}")
for gid in (25394, 25401, 24800, 25420):
    st, d, dt = get(f"get-championships-matches-by-id?id={gid}")
    if not d: print("MATCH", gid, st); continue
    m = d.get("match", {}); sc = d.get("scores") or {}
    print(f"MATCH {gid}: HTTP {st} {dt:.1f}s top={list(d.keys())} status={m.get('game_status')} {m.get('competition_name')} {m.get('match_datetime')} "
          f"h={m.get('h_team_id')} {m.get('h_club_code')} v={m.get('v_team_id')} {m.get('v_club_code')} {m.get('home_final_score')}-{m.get('visitor_final_score')} "
          f"rows={len((sc.get('ht') or {}).get('rows') or [])}/{len((sc.get('vt') or {}).get('rows') or [])} quarter={sc.get('quarter')} live={m.get('live_match_data')} q={m.get('quarter')}")
