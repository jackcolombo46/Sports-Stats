"""Scarica i dati NBA da ESPN e li salva in docs/nba/data/ per la pagina web.

Gira su GitHub Actions (vedi .github/workflows/update-data.yml). Usa solo la
libreria standard di Python.

File prodotti:
  docs/nba/data/meta.json                 stagioni, elenco file, calendario, rose, infortuni
  docs/nba/data/logs/<stagione>.json      stagioni passate (scaricate una volta sola)
  docs/nba/data/logs/<stagione>_<mese>.json  stagione in corso, un file per mese
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "docs", "nba", "data")
LOGS = os.path.join(DATA, "logs")

BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")

# sigle ESPN -> sigle NBA
ALIAS = {"GS": "GSW", "NY": "NYK", "SA": "SAS", "NO": "NOP", "UTAH": "UTA", "WSH": "WAS",
         "PHO": "PHX", "BRK": "BKN", "NOR": "NOP", "UTH": "UTA", "GSW": "GSW"}
NBA_TRI = {"ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND",
           "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX",
           "POR", "SAC", "SAS", "TOR", "UTA", "WAS"}

COLS = ["pid", "tri", "gid", "date", "opp", "home", "min", "pts", "reb", "oreb", "ast",
        "fg3m", "stl", "blk", "tov", "fga", "fta", "fgm", "ftm", "fg3a"]
NEW_COLS = ("fgm", "ftm", "fg3a")   # colonne aggiunte per le statistiche avanzate: i file della stagione in corso senza queste colonne vengono riscaricati


def log(*a):
    print(*a, flush=True)


def tri(abbr):
    t = ALIAS.get(abbr, abbr)
    return t if t in NBA_TRI else None


def get(path, retries=4):
    url = path if path.startswith("http") else BASE + path
    err = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, TimeoutError, ValueError, ConnectionError) as e:
            err = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"ESPN non risponde: {url}: {err}")


# ------------------------------------------------------------ stagioni

def season_start_year(today):
    return today.year if today.month >= 8 else today.year - 1


def season_str(y):
    return f"{y}-{str(y + 1)[-2:]}"


def daterange(a, b):
    d = a
    while d <= b:
        yield d
        d += dt.timedelta(days=1)


# ------------------------------------------------------------ scoreboard

def parse_event(ev, day):
    comp = (ev.get("competitions") or [{}])[0]
    teams = {}
    for c in comp.get("competitors", []):
        t = tri((c.get("team") or {}).get("abbreviation", ""))
        if t:
            teams[c.get("homeAway")] = t
    if "home" not in teams or "away" not in teams:
        return None
    st = ((comp.get("status") or ev.get("status") or {}).get("type") or {})
    stype = (ev.get("season") or {}).get("type")
    return {"id": str(ev["id"]), "date": day.isoformat(), "utc": ev.get("date"),
            "home": teams["home"], "away": teams["away"],
            "state": st.get("state"), "completed": bool(st.get("completed")),
            "stype": stype}


def scoreboard(day):
    d = get(f"scoreboard?dates={day.strftime('%Y%m%d')}&limit=100")
    return [e for e in (parse_event(ev, day) for ev in d.get("events", [])) if e]


# ------------------------------------------------------------ box score

def _num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return 0.0


def _made_att(s):
    m = re.match(r"\s*(\d+)\s*-\s*(\d+)", str(s or ""))
    return (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)


def _minutes(s):
    s = str(s or "")
    if ":" in s:
        a, b = s.split(":")[:2]
        return _num(a) + _num(b) / 60
    return _num(s)


def parse_summary(summary, ev):
    """Restituisce le righe (una per giocatore che ha giocato) di una partita."""
    rows, names = [], {}
    for side in (summary.get("boxscore") or {}).get("players", []):
        t = tri((side.get("team") or {}).get("abbreviation", ""))
        if not t:
            continue
        home = t == ev["home"]
        opp = ev["away"] if home else ev["home"]
        for block in side.get("statistics", []):
            labels = [str(x).upper() for x in (block.get("labels") or block.get("names") or [])]
            idx = {lab: i for i, lab in enumerate(labels)}
            if "MIN" not in idx or "PTS" not in idx:
                continue
            for a in block.get("athletes", []):
                stats = a.get("stats") or []
                if a.get("didNotPlay") or len(stats) < len(labels):
                    continue
                v = lambda k: stats[idx[k]] if k in idx else None  # noqa: E731
                mins = _minutes(v("MIN"))
                if mins <= 0:
                    continue
                ath = a.get("athlete") or {}
                pid = int(ath["id"])
                names[pid] = ath.get("displayName") or ath.get("shortName") or str(pid)
                fgm, fga = _made_att(v("FG"))
                fg3m, fg3a = _made_att(v("3PT"))
                ftm, fta = _made_att(v("FT"))
                rows.append([pid, t, ev["id"], ev["date"], opp, 1 if home else 0, round(mins, 1),
                             _num(v("PTS")), _num(v("REB")), _num(v("OREB")), _num(v("AST")),
                             fg3m, _num(v("STL")), _num(v("BLK")), _num(v("TO")), fga, fta, fgm, ftm, fg3a])
    return rows, names


def fetch_games(events, workers=4):
    def one(ev):
        try:
            return parse_summary(get(f"summary?event={ev['id']}"), ev)
        except RuntimeError as e:
            log("  saltata", ev["id"], e)
            return [], {}
    out_rows, out_names = [], {}
    with ThreadPoolExecutor(workers) as ex:
        for i, (rows, names) in enumerate(ex.map(one, events), 1):
            out_rows += rows
            out_names.update(names)
            if i % 100 == 0:
                log(f"  {i}/{len(events)} partite")
    return out_rows, out_names


# ------------------------------------------------------------ file

def read_json(path, default=None):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def write_logs(path, rows, names):
    rows.sort(key=lambda r: (r[3], r[2], r[0]))
    used = {r[0] for r in rows}
    write_json(path, {"cols": COLS, "names": {str(k): v for k, v in names.items() if k in used},
                      "rows": rows})


def season_events(y, until):
    """Tutte le partite di stagione regolare concluse di una stagione."""
    start, end = dt.date(y, 10, 1), min(dt.date(y + 1, 6, 30), until)
    evs = []
    for day in daterange(start, end):
        evs += [e for e in scoreboard(day) if e["completed"] and e["stype"] == 2]
    return evs


# ------------------------------------------------------------ passi

def backfill_past(y_cur, n_past, download=True):
    files = []
    for k in range(n_past, 0, -1):
        s = season_str(y_cur - k)
        path = os.path.join(LOGS, f"{s}.json")
        if os.path.exists(path):
            files.append(f"logs/{s}.json")
            continue
        if not download:
            continue
        files.append(f"logs/{s}.json")
        log(f"Stagione {s}: scarico il calendario...")
        evs = season_events(y_cur - k, dt.date.today())
        log(f"Stagione {s}: {len(evs)} partite, scarico i box score...")
        rows, names = fetch_games(evs)
        write_logs(path, rows, names)
        log(f"Stagione {s}: salvate {len(rows)} righe")
    return files


def update_current(y_cur, today):
    s = season_str(y_cur)
    # partite già salvate
    have, by_month = set(), {}
    for fn in sorted(os.listdir(LOGS)) if os.path.isdir(LOGS) else []:
        if fn.startswith(s + "_"):
            d = read_json(os.path.join(LOGS, fn))
            by_month[fn[len(s) + 1:-5]] = d
            have |= {r[2] for r in d["rows"]}
    if any(not all(c in d["cols"] for c in NEW_COLS) for d in by_month.values()):
        # i file vecchi restano finché il nuovo download non va a buon fine
        log(f"Stagione {s}: file nel formato vecchio, riscarico la stagione in corso")
        have, stale = set(), True
    else:
        stale = False
    last = None if stale else max((r[3] for d in by_month.values() for r in d["rows"]), default=None)
    start = dt.date(y_cur, 10, 1) if not last else dt.date.fromisoformat(last) - dt.timedelta(days=3)
    log(f"Stagione {s}: controllo le partite dal {start} al {today}")
    evs = []
    for day in daterange(start, today):
        evs += [e for e in scoreboard(day) if e["completed"] and e["stype"] == 2 and e["id"] not in have]
    log(f"Stagione {s}: {len(evs)} partite nuove")
    if evs:
        rows, names = fetch_games(evs)
        if stale and rows:
            by_month = {}
        for r in rows:
            m = r[3][:7]
            d = by_month.setdefault(m, {"cols": COLS, "names": {}, "rows": []})
            d["rows"].append(r)
            d["names"][str(r[0])] = names.get(r[0], d["names"].get(str(r[0])))
        for m, d in by_month.items():
            write_logs(os.path.join(LOGS, f"{s}_{m}.json"), d["rows"], {int(k): v for k, v in d["names"].items()})
    return [f"logs/{s}_{m}.json" for m in sorted(by_month)]


def upcoming(today, days=14):
    games = []
    for day in daterange(today - dt.timedelta(days=1), today + dt.timedelta(days=days)):
        try:
            games += [{"id": e["id"], "utc": e["utc"], "home": e["home"], "away": e["away"],
                       "state": e["state"], "stype": e["stype"]}
                      for e in scoreboard(day) if e["state"] in ("pre", "in")]
        except RuntimeError as e:
            log("  calendario:", e)
    return games


def rosters():
    out = {}
    d = get("teams")
    teams = d["sports"][0]["leagues"][0]["teams"]
    for t in teams:
        team = t["team"]
        tr = tri(team.get("abbreviation", ""))
        if not tr:
            continue
        r = get(f"teams/{team['id']}/roster")
        aths = r.get("athletes", [])
        if aths and isinstance(aths[0], dict) and "items" in aths[0]:  # formato raggruppato
            aths = [x for g in aths for x in g["items"]]
        for a in aths:
            out[str(a["id"])] = {"tri": tr, "name": a.get("displayName"),
                                 "pos": (a.get("position") or {}).get("abbreviation")}
    return out


def injuries():
    d = get("injuries")
    out = []
    for team in d.get("injuries", []):
        for inj in team.get("injuries", []):
            a = inj.get("athlete") or {}
            pid = a.get("id")
            if not pid:
                for l in a.get("links", []):
                    m = re.search(r"/id/(\d+)", l.get("href", ""))
                    if m:
                        pid = m.group(1)
                        break
            out.append({"id": str(pid) if pid else None, "name": a.get("displayName"),
                        "status": inj.get("status") or (inj.get("type") or {}).get("description"),
                        "comment": inj.get("shortComment") or "", "date": inj.get("date")})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--past", type=int, default=2, help="stagioni passate da tenere")
    ap.add_argument("--skip-past", action="store_true", help="non scaricare stagioni passate mancanti")
    args = ap.parse_args()
    today = dt.date.today()
    y = season_start_year(today)
    os.makedirs(LOGS, exist_ok=True)
    meta = read_json(os.path.join(DATA, "meta.json"), {}) or {}

    past_files = backfill_past(y, args.past, download=not args.skip_past)
    cur_files = update_current(y, today)
    meta.update({"season": season_str(y), "seasons": [season_str(y - k) for k in range(args.past + 1)],
                 "files": past_files + cur_files})
    for name, fn in (("schedule", upcoming), ("rosters", rosters), ("injuries", injuries)):
        try:
            meta[name] = fn(today) if name == "schedule" else fn()
        except Exception as e:  # noqa: BLE001  - si tiene il dato precedente
            log(f"ATTENZIONE {name}: {e}")
    meta["updated_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    write_json(os.path.join(DATA, "meta.json"), meta)
    # rimuove file di stagioni troppo vecchie
    keep = {os.path.basename(f) for f in meta["files"]}
    for fn in os.listdir(LOGS):
        if fn.endswith(".json") and fn not in keep:
            os.remove(os.path.join(LOGS, fn))
    log("Fatto:", meta["updated_at"], len(meta["files"]), "file,",
        len(meta.get("schedule", [])), "partite in calendario")


if __name__ == "__main__":
    sys.exit(main())
