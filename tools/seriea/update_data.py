"""Scarica i dati della Serie A da ESPN e li salva in docs/seriea/data/ per la pagina web.

Gira su GitHub Actions (vedi .github/workflows/update-data.yml). Usa solo la
libreria standard di Python.

File prodotti:
  docs/seriea/data/meta.json                    stagioni, elenco file, squadre, calendario, rose, infortuni
  docs/seriea/data/logs/<stagione>.json         stagioni passate (scaricate una volta sola)
  docs/seriea/data/logs/<stagione>_<mese>.json  stagione in corso, un file per mese

Ogni file di log contiene:
  rows   una riga per giocatore sceso in campo (colonne in COLS)
  games  una riga per partita (colonne in GAME_COLS), serve per gol fatti/subiti e clean sheet
  teams  nomi e sigle delle squadre presenti nel file
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
DATA = os.path.join(ROOT, "docs", "seriea", "data")
LOGS = os.path.join(DATA, "logs")

LEAGUE = "ita.1"   # Serie A. Per altri campionati: eng.1, esp.1, ger.1, fra.1 ...
BASE = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{LEAGUE}/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")

COLS = ["pid", "tid", "gid", "date", "opp", "home", "min", "start", "gk",
        "gol", "ast", "sh", "sot", "fc", "fs", "yc", "rc", "sv", "gc", "xg"]
GAME_COLS = ["gid", "date", "home", "away", "hg", "ag"]

# nomi delle statistiche ESPN -> colonne
STAT_KEYS = {
    "totalGoals": "gol", "goalAssists": "ast", "totalShots": "sh", "shotsOnTarget": "sot",
    "foulsCommitted": "fc", "foulsSuffered": "fs", "yellowCards": "yc", "redCards": "rc",
    "saves": "sv", "goalsConceded": "gc", "expectedGoals": "xg",
}
FULL = 90


def log(*a):
    print(*a, flush=True)


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
    # la Serie A inizia a metà/fine agosto e finisce a fine maggio
    return today.year if today.month >= 7 else today.year - 1


def season_str(y):
    return f"{y}-{str(y + 1)[-2:]}"


def daterange(a, b):
    d = a
    while d <= b:
        yield d
        d += dt.timedelta(days=1)


def season_bounds(y):
    return dt.date(y, 8, 1), dt.date(y + 1, 6, 30)


# ------------------------------------------------------------ scoreboard

def _team(c):
    t = c.get("team") or {}
    tid = str(t.get("id") or "")
    if not tid:
        return None
    return tid, {"abbr": t.get("abbreviation") or "", "name": t.get("displayName") or t.get("name") or "",
                 "short": t.get("shortDisplayName") or t.get("name") or ""}


def parse_event(ev, day):
    comp = (ev.get("competitions") or [{}])[0]
    sides, teams, score = {}, {}, {}
    for c in comp.get("competitors", []):
        t = _team(c)
        if not t:
            continue
        sides[c.get("homeAway")] = t[0]
        teams[t[0]] = t[1]
        score[c.get("homeAway")] = c.get("score")
    if "home" not in sides or "away" not in sides:
        return None
    st = ((comp.get("status") or ev.get("status") or {}).get("type") or {})

    def sc(x):
        if isinstance(x, dict):
            x = x.get("value", x.get("displayValue"))
        try:
            return int(float(x))
        except (TypeError, ValueError):
            return None
    return {"id": str(ev["id"]), "date": day.isoformat(), "utc": ev.get("date"),
            "home": sides["home"], "away": sides["away"], "teams": teams,
            "hg": sc(score.get("home")), "ag": sc(score.get("away")),
            "state": st.get("state"), "completed": bool(st.get("completed")),
            "detail": st.get("shortDetail") or st.get("detail") or ""}


def scoreboard(day):
    d = get(f"scoreboard?dates={day.strftime('%Y%m%d')}&limit=100")
    return [e for e in (parse_event(ev, day) for ev in d.get("events", [])) if e]


def scoreboards(days, workers=6):
    out = []
    with ThreadPoolExecutor(workers) as ex:
        for evs in ex.map(lambda d: _safe_scoreboard(d), days):
            out += evs
    seen, uniq = set(), []
    for e in out:   # una partita può comparire in due giorni (fusi orari)
        if e["id"] not in seen:
            seen.add(e["id"])
            uniq.append(e)
    return uniq


def _safe_scoreboard(day):
    try:
        return scoreboard(day)
    except RuntimeError as e:
        log("  calendario", day, e)
        return []


# ------------------------------------------------------------ tabellino

def _num(x):
    if isinstance(x, dict):
        x = x.get("value", x.get("displayValue"))
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _minute(clock):
    """'67'' -> 67, '90'+3'' -> 90, {'value': 4020} (secondi) -> 67"""
    if isinstance(clock, dict):
        dv = clock.get("displayValue")
        if dv:
            return _minute(dv)
        v = clock.get("value")
        return min(FULL, int(_num(v) // 60)) if v is not None else None
    m = re.match(r"\s*(\d+)", str(clock or ""))
    return min(FULL, int(m.group(1))) if m else None


def _flag(x):
    """ESPN usa a volte booleani, a volte oggetti {didSub: true}."""
    if isinstance(x, dict):
        return bool(x.get("didSub", x.get("value", False)))
    return bool(x)


def _stats(entry):
    out = {v: 0 for v in STAT_KEYS.values()}
    st = entry.get("stats") or []
    if isinstance(st, dict):
        st = [{"name": k, "value": v} for k, v in st.items()]
    for s in st:
        k = STAT_KEYS.get(s.get("name") or s.get("abbreviation"))
        if k:
            v = _num(s.get("value", s.get("displayValue")))
            out[k] = int(v) if v == int(v) else round(v, 3)
    return out


def _event_minutes(summary):
    """Minuti delle sostituzioni e delle espulsioni dagli eventi chiave: {pid: {"in": m, "out": m}}"""
    out = {}
    events = (summary.get("keyEvents") or []) + (summary.get("commentary") or [])
    for e in events:
        e = e.get("play", e) if isinstance(e, dict) else {}
        typ = str(((e.get("type") or {}).get("text") or (e.get("type") or {}).get("type") or "")).lower()
        if "substitution" not in typ and "red" not in typ:
            continue
        m = _minute(e.get("clock"))
        if m is None:
            continue
        ids = [str((p.get("athlete") or {}).get("id")) for p in e.get("participants") or []]
        if "red" in typ:
            for pid in ids[:1]:
                out.setdefault(pid, {})["out"] = m
        else:
            for pid in ids:  # chi entra e chi esce: lo distingue chi ha subbedIn/subbedOut
                out.setdefault(pid, {}).setdefault("subs", []).append(m)
    return out


def player_minutes(p, ev_min):
    starter = _flag(p.get("starter"))
    sub_in, sub_out = _flag(p.get("subbedIn")), _flag(p.get("subbedOut"))
    if not starter and not sub_in:
        return 0
    pid = str((p.get("athlete") or {}).get("id"))
    t_in, t_out = None, None
    for pl in p.get("plays") or []:   # alcuni tabellini hanno gli eventi sul giocatore
        m = _minute(pl.get("clock"))
        if m is None:
            continue
        if pl.get("substitution"):
            if sub_in and not starter and t_in is None:
                t_in = m
            elif sub_out:
                t_out = m
        if pl.get("redCard"):
            t_out = m if t_out is None else min(t_out, m)
    em = ev_min.get(pid, {})
    subs = sorted(set(em.get("subs", [])))
    if sub_in and not starter and t_in is None and subs:
        t_in = subs[0]
    if sub_out and t_out is None and subs and (starter or len(subs) > 1):
        t_out = subs[-1]
    if "out" in em:
        t_out = em["out"] if t_out is None else min(t_out, em["out"])
    start = 0 if starter else (t_in if t_in is not None else 70)
    end = t_out if t_out is not None else (70 if sub_out and starter else FULL)
    return max(1, min(FULL, end) - start)


def parse_summary(summary, ev):
    """Righe (una per giocatore sceso in campo) e nomi di una partita."""
    rows, names = [], {}
    ev_min = _event_minutes(summary)
    for side in summary.get("rosters") or []:
        tid = str((side.get("team") or {}).get("id") or "")
        if tid not in (ev["home"], ev["away"]):
            continue
        home = tid == ev["home"]
        opp = ev["away"] if home else ev["home"]
        for p in side.get("roster") or []:
            mins = player_minutes(p, ev_min)
            if mins <= 0:
                continue
            ath = p.get("athlete") or {}
            if not ath.get("id"):
                continue
            pid = int(ath["id"])
            names[pid] = ath.get("displayName") or ath.get("shortName") or str(pid)
            pos = str((p.get("position") or {}).get("abbreviation") or "").upper()
            s = _stats(p)
            gk = 1 if pos in ("G", "GK", "POR") else 0
            rows.append([pid, tid, ev["id"], ev["date"], opp, 1 if home else 0, mins,
                         1 if _flag(p.get("starter")) else 0, gk,
                         s["gol"], s["ast"], s["sh"], s["sot"], s["fc"], s["fs"],
                         s["yc"], s["rc"], s["sv"], s["gc"], s["xg"]])
    return rows, names


def team_stats(summary):
    """Statistiche di squadra della partita (possesso, tiri, passaggi, ...): {tid: {nome ESPN: valore}}"""
    out = {}
    for t in (summary.get("boxscore") or {}).get("teams") or []:
        tid = str((t.get("team") or {}).get("id") or "")
        if not tid:
            continue
        st = {}
        for x in t.get("statistics") or []:
            name = x.get("name")
            raw = x.get("value", x.get("displayValue"))
            if isinstance(raw, str):
                raw = raw.replace("%", "").strip()
            try:
                v = float(raw)
            except (TypeError, ValueError):
                continue
            if name:
                st[name] = int(v) if v == int(v) else round(v, 3)
        if st:
            out[tid] = st
    return out


def score_from_summary(summary, ev):
    hg, ag = ev.get("hg"), ev.get("ag")
    comp = (((summary.get("header") or {}).get("competitions")) or [{}])[0]
    for c in comp.get("competitors") or []:
        tid = str((c.get("team") or {}).get("id") or "")
        try:
            v = int(float(c.get("score")))
        except (TypeError, ValueError):
            continue
        if tid == ev["home"]:
            hg = v
        elif tid == ev["away"]:
            ag = v
    return hg, ag


def fetch_games(events, workers=4):
    def one(ev):
        try:
            s = get(f"summary?event={ev['id']}")
            rows, names = parse_summary(s, ev)
            hg, ag = score_from_summary(s, ev)
            return rows, names, [ev["id"], ev["date"], ev["home"], ev["away"], hg, ag], team_stats(s)
        except RuntimeError as e:
            log("  saltata", ev["id"], e)
            return [], {}, None, {}
    out_rows, out_names, out_games, out_ts = [], {}, [], {}
    with ThreadPoolExecutor(workers) as ex:
        for i, (rows, names, game, ts) in enumerate(ex.map(one, events), 1):
            out_rows += rows
            out_names.update(names)
            if game and game[4] is not None:
                out_games.append(game)
                if ts:
                    out_ts[game[0]] = ts
            if i % 50 == 0:
                log(f"  {i}/{len(events)} partite")
    keys = sorted({k for ts in out_ts.values() for t in ts.values() for k in t})
    if keys:
        log("  statistiche di squadra ESPN:", ", ".join(keys))
    if any(r[-1] for r in out_rows):
        log("  xG dei giocatori presente")
    return out_rows, out_names, out_games, out_ts


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


def write_logs(path, rows, names, games, teams, tstats=None):
    rows.sort(key=lambda r: (r[3], r[2], r[0]))
    games.sort(key=lambda g: (g[1], g[0]))
    used = {r[0] for r in rows}
    tids = {g[2] for g in games} | {g[3] for g in games} | {r[1] for r in rows}
    gids = {g[0] for g in games}
    write_json(path, {"cols": COLS, "game_cols": GAME_COLS,
                      "names": {str(k): v for k, v in names.items() if int(k) in used},
                      "teams": {t: teams[t] for t in sorted(tids) if t in teams},
                      "rows": rows, "games": games,
                      "tstats": {g: v for g, v in sorted((tstats or {}).items()) if g in gids}})


def season_events(y, until):
    start, end = season_bounds(y)
    evs = scoreboards(list(daterange(start, min(end, until))))
    return [e for e in evs if e["completed"]]


def merge_teams(teams, evs):
    for e in evs:
        teams.update(e["teams"])


# ------------------------------------------------------------ passi

def backfill_past(y_cur, n_past, teams, download=True):
    files = []
    for k in range(n_past, 0, -1):
        s = season_str(y_cur - k)
        path = os.path.join(LOGS, f"{s}.json")
        if os.path.exists(path):
            files.append(f"logs/{s}.json")
            continue
        if not download:
            continue
        log(f"Stagione {s}: scarico il calendario...")
        evs = season_events(y_cur - k, dt.date.today())
        merge_teams(teams, evs)
        log(f"Stagione {s}: {len(evs)} partite, scarico i tabellini...")
        rows, names, games, ts = fetch_games(evs)
        if not rows:
            log(f"Stagione {s}: nessun dato, salto")
            continue
        write_logs(path, rows, names, games, teams, ts)
        files.append(f"logs/{s}.json")
        log(f"Stagione {s}: salvate {len(rows)} righe, {len(games)} partite")
    return files


def update_current(y_cur, today, teams):
    s = season_str(y_cur)
    have, by_month = set(), {}
    for fn in sorted(os.listdir(LOGS)) if os.path.isdir(LOGS) else []:
        if fn.startswith(s + "_"):
            d = read_json(os.path.join(LOGS, fn))
            by_month[fn[len(s) + 1:-5]] = d
            have |= {g[0] for g in d.get("games", [])}
            teams.update(d.get("teams", {}))
    # file senza statistiche di squadra / xG (formato vecchio): si riscarica la stagione in corso
    stale = any("tstats" not in d or "xg" not in d.get("cols", []) for d in by_month.values())
    if stale:
        log(f"Stagione {s}: file nel formato vecchio, riscarico la stagione in corso")
        have = set()
    last = None if stale else max((g[1] for d in by_month.values() for g in d.get("games", [])), default=None)
    start = season_bounds(y_cur)[0] if not last else dt.date.fromisoformat(last) - dt.timedelta(days=3)
    log(f"Stagione {s}: controllo le partite dal {start} al {today}")
    evs = [e for e in scoreboards(list(daterange(start, today))) if e["completed"] and e["id"] not in have]
    merge_teams(teams, evs)
    log(f"Stagione {s}: {len(evs)} partite nuove")
    if evs:
        rows, names, games, ts = fetch_games(evs)
        if stale and rows:
            by_month = {}
        empty = lambda: {"cols": COLS, "game_cols": GAME_COLS, "names": {}, "teams": {}, "rows": [], "games": [], "tstats": {}}  # noqa: E731
        for g in games:
            d = by_month.setdefault(g[1][:7], empty())
            d["games"].append(g)
            if g[0] in ts:
                d.setdefault("tstats", {})[g[0]] = ts[g[0]]
        for r in rows:
            d = by_month.setdefault(r[3][:7], empty())
            d["rows"].append(r)
            d["names"][str(r[0])] = names.get(r[0], d["names"].get(str(r[0])))
        for m, d in by_month.items():
            write_logs(os.path.join(LOGS, f"{s}_{m}.json"), d["rows"],
                       {int(k): v for k, v in d["names"].items()}, d["games"], teams, d.get("tstats"))
    return [f"logs/{s}_{m}.json" for m in sorted(by_month)]


def upcoming(today, teams, days=21):
    evs = scoreboards(list(daterange(today - dt.timedelta(days=1), today + dt.timedelta(days=days))))
    merge_teams(teams, evs)
    return sorted(({"id": e["id"], "utc": e["utc"], "home": e["home"], "away": e["away"], "state": e["state"]}
                   for e in evs if e["state"] in ("pre", "in")), key=lambda g: g["utc"] or "")


def rosters(teams):
    """Rose attuali e infortuni segnalati da ESPN (quando presenti)."""
    out, inj = {}, []
    d = get("teams")
    lt = d["sports"][0]["leagues"][0]["teams"]
    cur = []
    for t in lt:
        team = t["team"]
        tid = str(team["id"])
        cur.append(tid)
        teams[tid] = {"abbr": team.get("abbreviation") or "", "name": team.get("displayName") or "",
                      "short": team.get("shortDisplayName") or team.get("name") or ""}
        try:
            r = get(f"teams/{tid}/roster")
        except RuntimeError as e:
            log("  rosa", tid, e)
            continue
        aths = r.get("athletes", [])
        if aths and isinstance(aths[0], dict) and "items" in aths[0]:  # formato raggruppato
            aths = [x for g in aths for x in g["items"]]
        for a in aths:
            out[str(a["id"])] = {"tid": tid, "name": a.get("displayName"),
                                 "pos": (a.get("position") or {}).get("abbreviation")}
            for i in a.get("injuries") or []:
                inj.append({"id": str(a["id"]), "name": a.get("displayName"),
                            "status": i.get("status") or (i.get("type") or {}).get("description") or "Infortunato",
                            "comment": i.get("shortComment") or ""})
                break
    return out, inj, cur


# ------------------------------------------------------------ Understat (xG, PPDA, punti attesi)
UNDERSTAT = "https://understat.com/"
UNDERSTAT_LEAGUE = "Serie_A"
# parole tolte dai nomi per confrontare quelli di Understat con quelli di ESPN
_NAME_NOISE = {"ac", "as", "ss", "ssc", "fc", "cfc", "us", "uc", "calcio", "hellas", "bc", "1913", "1907", "1909"}
_NAME_ALIAS = {"internazionale": "inter", "parmacalcio": "parma"}


def _team_key(name):
    import unicodedata
    n = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    words = [w for w in re.split(r"[^a-z0-9]+", n) if w and w not in _NAME_NOISE]
    k = "".join(words)
    return _NAME_ALIAS.get(k, k)


def _understat_get(url, ajax):
    h = {"User-Agent": UA, "Referer": f"{UNDERSTAT}league/{UNDERSTAT_LEAGUE}"}
    if ajax:
        h.update({"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"})
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def understat_teams(y):
    """{titolo Understat: [partite]} della stagione che inizia nell'anno y."""
    try:
        d = json.loads(_understat_get(f"{UNDERSTAT}getLeagueData/{UNDERSTAT_LEAGUE}/{y}", True))
        if isinstance(d, dict) and d.get("teams"):
            return {t["title"]: t.get("history") or [] for t in d["teams"].values()}
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError, ConnectionError) as e:
        log("  Understat (dati):", e)
    # formato vecchio: i dati sono dentro la pagina come JSON.parse('...')
    html = _understat_get(f"{UNDERSTAT}league/{UNDERSTAT_LEAGUE}/{y}", False)
    m = re.search(r"teamsData\s*=\s*JSON\.parse\('(.*?)'\)", html)
    if not m:
        raise RuntimeError("dati delle squadre non trovati nella pagina")
    raw = re.sub(r"\\x([0-9a-fA-F]{2})", lambda g: chr(int(g.group(1), 16)), m.group(1))
    d = json.loads(raw)
    return {t["title"]: t.get("history") or [] for t in d.values()}


def understat_xg(y, teams, cur):
    """Totali di stagione per squadra (id ESPN): xG, xGA, xG senza rigori, PPDA, passaggi in area, punti attesi."""
    data = understat_teams(y)
    by_key = {_team_key(teams[t].get("name")): t for t in cur if t in teams}
    by_key.update({_team_key(teams[t].get("short")): t for t in cur if t in teams})
    out, missing = {}, []
    for title, hist in data.items():
        k = _team_key(title)
        tid = by_key.get(k) or next((v for kk, v in by_key.items() if kk and (kk in k or k in kk)), None)
        if not tid:
            missing.append(title)
            continue
        f = lambda key: sum(float(h.get(key) or 0) for h in hist)  # noqa: E731
        pp = lambda key, sub: sum(float((h.get(key) or {}).get(sub) or 0) for h in hist)  # noqa: E731
        out[tid] = {"gp": len(hist), "xg": round(f("xG"), 2), "xga": round(f("xGA"), 2),
                    "npxg": round(f("npxG"), 2), "npxga": round(f("npxGA"), 2),
                    "ppda_att": pp("ppda", "att"), "ppda_def": pp("ppda", "def"),
                    "oppda_att": pp("ppda_allowed", "att"), "oppda_def": pp("ppda_allowed", "def"),
                    "deep": f("deep"), "deep_allowed": f("deep_allowed"), "xpts": round(f("xpts"), 2)}
    if missing:
        log("  Understat: squadre non riconosciute:", ", ".join(missing))
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
    teams = dict(meta.get("teams") or {})

    past_files = backfill_past(y, args.past, teams, download=not args.skip_past)
    cur_files = update_current(y, today, teams)
    meta.update({"league": LEAGUE, "season": season_str(y),
                 "seasons": [season_str(y - k) for k in range(args.past + 1)],
                 "files": past_files + cur_files})
    try:
        meta["schedule"] = upcoming(today, teams)
    except Exception as e:  # noqa: BLE001  - si tiene il dato precedente
        log(f"ATTENZIONE calendario: {e}")
    try:
        meta["rosters"], meta["injuries"], meta["current_teams"] = rosters(teams)
    except Exception as e:  # noqa: BLE001
        log(f"ATTENZIONE rose: {e}")
    try:
        xg = understat_xg(y, teams, meta.get("current_teams") or list(teams))
        meta["xg"] = {"source": "understat", "season": season_str(y), "teams": xg}
        log(f"Understat: {len(xg)} squadre")
    except Exception as e:  # noqa: BLE001  - si tiene il dato precedente
        log(f"ATTENZIONE Understat: {e}")
    meta["teams"] = teams
    meta["updated_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    write_json(os.path.join(DATA, "meta.json"), meta)
    keep = {os.path.basename(f) for f in meta["files"]}
    for fn in os.listdir(LOGS):
        if fn.endswith(".json") and fn not in keep:
            os.remove(os.path.join(LOGS, fn))
    log("Fatto:", meta["updated_at"], len(meta["files"]), "file,",
        len(meta.get("schedule", [])), "partite in calendario,", len(meta.get("rosters", {})), "giocatori in rosa")


if __name__ == "__main__":
    sys.exit(main())
