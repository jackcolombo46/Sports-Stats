"""Scarica i dati dell'EuroLeague dall'API pubblica usata dal sito euroleaguebasketball.net e li salva in docs/eurolega/data/.

Gira su GitHub Actions (vedi .github/workflows/update-eurolega.yml). Usa solo la libreria standard.
I file hanno lo stesso formato dell'app LBA, così l'interfaccia e il modello sono gli stessi.

Fonti:
  api-live.euroleague.net/v2/competitions/E/seasons/E<anno>/games    calendario e risultati di una stagione
  api-live.euroleague.net/v2/competitions/E/seasons/E<anno>/people   rose (foto dei giocatori)
  live.euroleague.net/api/Boxscore?gamecode=<n>&seasoncode=E<anno>   tabellino di una partita
Codice partita nei nostri file: anno * 1000 + numero della partita (es. 2026001), unico fra le stagioni.

File prodotti:
  docs/eurolega/data/meta.json                    stagioni, elenco file, calendario, rose, squadre, immagini
  docs/eurolega/data/logs/<stagione>.json         stagioni passate (scaricate una volta sola)
  docs/eurolega/data/logs/<stagione>_<mese>.json  stagione in corso, un file per mese
"""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "docs", "eurolega", "data")
LOGS = os.path.join(DATA, "logs")
API = "https://api-live.euroleague.net/v2/competitions/E/seasons/"
LIVE = "https://live.euroleague.net/api/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
DELAY = 0.6
COLS = ["pid", "tri", "gid", "date", "opp", "home", "min", "pts", "reb", "oreb", "ast",
        "fg3m", "stl", "blk", "tov", "fga", "fta", "fgm", "ftm", "fg3a"]


def log(*a):
    print(*a, flush=True)


_last = [0.0]


def get(url, retries=3):
    err = None
    for i in range(retries):
        wait = DELAY - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err = e
        except (urllib.error.URLError, TimeoutError, ValueError, ConnectionError) as e:
            err = e
        time.sleep(3 * (i + 1))
    raise RuntimeError(f"EuroLeague non risponde: {url}: {err}")


def season_start_year(today):
    return today.year if today.month >= 8 else today.year - 1


def season_str(y):
    return f"{y}-{str(y + 1)[-2:]}"


def gid_of(y, code):
    return str(y * 1000 + int(code))


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
    write_json(path, {"cols": COLS, "names": {str(k): v for k, v in names.items() if int(k) in used}, "rows": rows})


def nice_name(n):
    """'MOTLEY, JOHNATHAN' → 'Johnathan Motley'"""
    n = (n or "").strip()
    if "," in n:
        last, first = [x.strip() for x in n.split(",", 1)]
        n = f"{first} {last}".strip()
    return n.title()


# ------------------------------------------------------------ calendario e squadre

TEAMS, IMAGES = {}, {"teams": {}, "players": {}}


def season_games(y):
    """[{gid, code, utc, date, home, away, played, hs, as, round, phase}] di una stagione"""
    d = get(f"{API}E{y}/games") or {}
    out = []
    for g in d.get("data") or []:
        loc, road = g.get("local") or {}, g.get("road") or {}
        hc, ac = (loc.get("club") or {}), (road.get("club") or {})
        if not hc.get("code") or not ac.get("code"):
            continue
        for c in (hc, ac):
            TEAMS[c["code"]] = {"name": c.get("name") or c["code"],
                                "short": c.get("editorialName") or c.get("abbreviatedName") or c["code"]}
            crest = (c.get("images") or {}).get("crest")
            if crest:
                IMAGES["teams"][c["code"]] = crest
        utc = g.get("utcDate") or ""
        out.append({"gid": gid_of(y, g["gameCode"]), "code": int(g["gameCode"]),
                    "utc": (utc[:16] + "Z") if utc else None, "date": (g.get("localDate") or g.get("date") or "")[:10],
                    "home": hc["code"], "away": ac["code"], "played": bool(g.get("played")),
                    "hs": loc.get("score"), "as": road.get("score"), "round": g.get("round"),
                    "phase": ((g.get("phaseType") or {}).get("code"))})
    return sorted(out, key=lambda g: g["code"])


def player_images(y):
    d = get(f"{API}E{y}/people") or {}
    n = 0
    for p in d.get("data") or []:
        if p.get("type") != "J":
            continue
        per = p.get("person") or {}
        im = per.get("images") or {}
        url = im.get("headshot") or im.get("action") or next((v for v in im.values() if isinstance(v, str) and v.startswith("http")), None)
        try:
            pid = int(str(per.get("code") or "").strip().lstrip("P"))
        except ValueError:
            continue
        if url:
            IMAGES["players"][str(pid)] = url
            n += 1
    log(f"Foto: {n} giocatori")


def _img(im):
    im = im or {}
    return im.get("headshot") or im.get("action") or next((v for v in im.values() if isinstance(v, str) and v.startswith("http")), None)


def images_from_games(y, games, want, limit=40):
    """foto dalle statistiche delle partite (il campo person.images dei giocatori), dalla più recente,
    finché mancano foto per i giocatori della stagione (al massimo `limit` partite per giro)"""
    n = 0
    for g in sorted((g for g in games if g["played"]), key=lambda g: g["code"], reverse=True):
        if not (want - set(IMAGES["players"])) or n >= limit:
            break
        n += 1
        try:
            d = get(f"{API}E{y}/games/{g['code']}/stats") or {}
        except RuntimeError:
            continue
        for side in ("local", "road"):
            for p in ((d.get(side) or {}).get("players")) or []:
                per = (p.get("player") or {}).get("person") or {}
                code = str(per.get("code") or "").strip().lstrip("P")
                url = _img(per.get("images"))
                if code.isdigit() and url:
                    IMAGES["players"][str(int(code))] = url
    log(f"Foto: lette {n} partite, {len(IMAGES['players'])} giocatori con foto")


# ------------------------------------------------------------ tabellino

def minutes(s):
    try:
        m, sec = str(s).split(":")
        return round(int(m) + int(sec) / 60, 1)
    except ValueError:
        return 0.0


def boxscore(y, g):
    d = get(f"{LIVE}Boxscore?gamecode={g['code']}&seasoncode=E{y}")
    rows, names = [], {}
    stats = (d or {}).get("Stats") or []
    if len(stats) != 2:
        return rows, names
    for side, tri, opp, home in ((stats[0], g["home"], g["away"], 1), (stats[1], g["away"], g["home"], 0)):
        for r in side.get("PlayersStats") or []:
            mins = minutes(r.get("Minutes"))
            pid_s = str(r.get("Player_ID") or "").strip().lstrip("P")
            if mins <= 0 or not pid_s.isdigit():
                continue
            pid = int(pid_s)
            names[pid] = nice_name(r.get("Player"))
            n = lambda k: r.get(k) or 0  # noqa: E731
            rows.append([pid, tri, g["gid"], g["date"], opp, home, mins,
                         n("Points"), n("TotalRebounds"), n("OffensiveRebounds"), n("Assistances"), n("FieldGoalsMade3"),
                         n("Steals"), n("BlocksFavour"), n("Turnovers"),
                         n("FieldGoalsAttempted2") + n("FieldGoalsAttempted3"), n("FreeThrowsAttempted"),
                         n("FieldGoalsMade2") + n("FieldGoalsMade3"), n("FreeThrowsMade"), n("FieldGoalsAttempted3")])
    return rows, names


def fetch_games(y, games):
    rows, names = [], {}
    for i, g in enumerate(games, 1):
        try:
            r, n = boxscore(y, g)
        except RuntimeError as e:
            log("  saltata", g["gid"], e)
            continue
        rows += r
        names.update(n)
        if i % 25 == 0:
            log(f"  {i}/{len(games)} partite")
    return rows, names


# ------------------------------------------------------------ passi

def backfill_past(y_cur, n_past, download=True):
    files = []
    for k in range(n_past, 0, -1):
        y = y_cur - k
        s = season_str(y)
        path = os.path.join(LOGS, f"{s}.json")
        if os.path.exists(path):
            files.append(f"logs/{s}.json")
            continue
        if not download:
            continue
        games = [g for g in season_games(y) if g["played"]]
        log(f"Stagione {s}: {len(games)} partite, scarico i tabellini...")
        rows, names = fetch_games(y, games)
        if rows:
            write_logs(path, rows, names)
            files.append(f"logs/{s}.json")
        log(f"Stagione {s}: salvate {len(rows)} righe")
    return files


def update_current(y):
    s = season_str(y)
    have, by_month = set(), {}
    for fn in sorted(os.listdir(LOGS)) if os.path.isdir(LOGS) else []:
        if fn.startswith(s + "_"):
            d = read_json(os.path.join(LOGS, fn))
            by_month[fn[len(s) + 1:-5]] = d
            have |= {r[2] for r in d["rows"]}
    games = season_games(y)
    new = [g for g in games if g["played"] and g["gid"] not in have]
    log(f"Stagione {s}: {len(games)} partite in calendario, {len(new)} nuove da scaricare")
    rows, names = fetch_games(y, new)
    for r in rows:
        d = by_month.setdefault(r[3][:7], {"cols": COLS, "names": {}, "rows": []})
        d["rows"].append(r)
        d["names"][str(r[0])] = names.get(r[0], d["names"].get(str(r[0])))
    if rows:
        for m, d in by_month.items():
            write_logs(os.path.join(LOGS, f"{s}_{m}.json"), d["rows"], {int(k): v for k, v in d["names"].items()})
    now = dt.datetime.now(dt.timezone.utc)
    soon = now + dt.timedelta(days=21)
    schedule = []
    for g in games:
        if g["played"] or not g["utc"]:
            continue
        t = dt.datetime.strptime(g["utc"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)
        if t < now - dt.timedelta(hours=4) or t > soon:
            continue
        schedule.append({"id": g["gid"], "utc": g["utc"], "home": g["home"], "away": g["away"],
                         "state": "in" if t < now else "pre", "stype": 2, "round": g["round"]})
    schedule.sort(key=lambda g: g["utc"])
    current = sorted({g["home"] for g in games} | {g["away"] for g in games})
    return [f"logs/{s}_{m}.json" for m in sorted(by_month)], schedule, current, games


def rosters_from_logs(y):
    """Squadra attuale di ogni giocatore = squadra dell'ultima partita giocata in questa stagione."""
    s = season_str(y)
    out = {}
    for fn in sorted(os.listdir(LOGS)):
        if not fn.startswith(s + "_"):
            continue
        d = read_json(os.path.join(LOGS, fn))
        for r in sorted(d["rows"], key=lambda r: r[3]):
            out[str(r[0])] = {"tri": r[1], "name": d["names"].get(str(r[0])), "pos": None}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--past", type=int, default=2, help="stagioni passate da tenere")
    ap.add_argument("--skip-past", action="store_true", help="non scaricare stagioni passate mancanti")
    args = ap.parse_args()
    y = season_start_year(dt.date.today())
    os.makedirs(LOGS, exist_ok=True)
    meta = read_json(os.path.join(DATA, "meta.json"), {}) or {}
    TEAMS.update(meta.get("teams") or {})
    old = meta.get("images") or {}
    IMAGES["teams"].update(old.get("teams") or {})
    IMAGES["players"].update(old.get("players") or {})
    past_files = backfill_past(y, args.past, download=not args.skip_past)
    cur_files, schedule, current, games = update_current(y)
    try:
        player_images(y)
    except RuntimeError as e:
        log("ATTENZIONE foto:", e)
    images_from_games(y, games, set(rosters_from_logs(y)))
    meta.update({"league": "EuroLeague", "season": season_str(y), "seasons": [season_str(y - k) for k in range(args.past + 1)],
                 "files": past_files + cur_files, "schedule": schedule, "rosters": rosters_from_logs(y),
                 "injuries": [], "teams": TEAMS, "current_teams": current,
                 "images": {"v": 1, "teams": IMAGES["teams"], "players": IMAGES["players"]}})
    meta["updated_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    write_json(os.path.join(DATA, "meta.json"), meta)
    keep = {os.path.basename(f) for f in meta["files"]}
    for fn in os.listdir(LOGS):
        if fn.endswith(".json") and fn not in keep:
            os.remove(os.path.join(LOGS, fn))
    log("Fatto:", meta["updated_at"], len(meta["files"]), "file,", len(schedule), "partite in calendario,",
        len(meta["rosters"]), "giocatori,", len(current), "squadre")


if __name__ == "__main__":
    sys.exit(main())
