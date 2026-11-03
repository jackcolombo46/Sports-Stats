"""Scarica i dati della Serie A di basket (LBA) da legabasket.it e li salva in docs/lba/data/.

Gira su GitHub Actions (vedi .github/workflows/update-lba.yml). Usa solo la libreria standard.
I file hanno lo stesso formato dell'app NBA, così l'interfaccia e il modello sono gli stessi.

Fonte: le stesse chiamate che usa il sito legabasket.it per le sue pagine
  get-championships                 elenco dei campionati (id della regular season di ogni anno)
  get-championships-summary-by-id   tutte le partite di una stagione (casa/trasferta, id, risultato)
  get-championships-matches-by-id   una partita: data, squadre, stato e tabellino dei giocatori
Il sito chiede 2 secondi tra una richiesta e l'altra (robots.txt): li rispettiamo.

File prodotti:
  docs/lba/data/meta.json                    stagioni, elenco file, calendario, rose, squadre
  docs/lba/data/logs/<stagione>.json         stagioni passate (scaricate una volta sola)
  docs/lba/data/logs/<stagione>_<mese>.json  stagione in corso, un file per mese
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "docs", "lba", "data")
LOGS = os.path.join(DATA, "logs")

SITE = "https://www.legabasket.it"
API = SITE + "/api/championships/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
DELAY = 2.0          # secondi tra una richiesta e l'altra (Crawl-delay di legabasket.it)
SERIES_A = 1         # championship_series_id della Serie A
KNOWN_RS = {2024: 567, 2025: 596, 2026: 602}   # riserva se l'elenco dei campionati non risponde

COLS = ["pid", "tri", "gid", "date", "opp", "home", "min", "pts", "reb", "oreb", "ast",
        "fg3m", "stl", "blk", "tov", "fga", "fta", "fgm", "ftm", "fg3a"]
NEW_COLS = ("fgm", "ftm", "fg3a")   # colonne aggiunte per le statistiche avanzate: i file della stagione in corso senza queste colonne vengono riscaricati

# Le squadre cambiano id ogni stagione e nome con lo sponsor: le riconosciamo dalla città/club.
CLUBS = [  # (sigla, nome breve, parole chiave nel nome ufficiale)
    ("VIR", "Virtus Bologna", ["virtus", "bologna"]), ("MIL", "Olimpia Milano", ["milano"]),
    ("TOR", "Tortona", ["tortona"]), ("VEN", "Venezia", ["venezia"]), ("REG", "Reggio Emilia", ["reggio"]),
    ("BCR", "BC Roma", ["bc roma"]), ("MAX", "Maxima Roma", ["maxima"]), ("TRN", "Trento", ["trent"]),
    ("TRI", "Trieste", ["trieste"]), ("TRV", "Treviso", ["treviso"]), ("BRE", "Brescia", ["brescia"]),
    ("SAS", "Sassari", ["sassari"]), ("NAP", "Napoli", ["napoli"]), ("VAR", "Varese", ["varese"]),
    ("CAN", "Cantù", ["cantu"]), ("UDI", "Udine", ["udine"]), ("SCA", "Scafati", ["scafati"]),
    ("PIS", "Pistoia", ["pistoia"]), ("CRE", "Cremona", ["cremona"]), ("VRN", "Verona", ["verona"]),
    ("PES", "Pesaro", ["pesaro"]), ("TPS", "Trapani", ["trapani"]), ("BRI", "Brindisi", ["brindisi"]),
    ("TRT", "Torino", ["torino"]), ("FOR", "Forlì", ["forli"]), ("CAS", "Caserta", ["caserta"]),
    ("AVE", "Avellino", ["avellino"]), ("CAP", "Capo d'Orlando", ["orlando"]), ("CHI", "Chiusi", ["chiusi"]),
]


def log(*a):
    print(*a, flush=True)


_last = [0.0]


def get(path, retries=3):
    url = path if path.startswith("http") else API + path
    err = None
    for i in range(retries):
        wait = DELAY - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json",
                                                       "Referer": SITE + "/calendario"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, TimeoutError, ValueError, ConnectionError) as e:
            err = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"legabasket.it non risponde: {url}: {err}")


def plain(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def club(name):
    n = plain(name)
    for code, short, keys in CLUBS:
        if all(k in n for k in keys) if code == "VIR" else any(k in n for k in keys):
            return code, short
    word = re.sub(r"[^a-z ]", "", n).split()
    w = word[-1] if word else "squadra"
    return w[:3].upper(), w.title()


# ------------------------------------------------------------ immagini
# Loghi delle squadre e foto dei giocatori, se legabasket.it li include nei dati della partita.
# I nomi dei campi non sono documentati: si cercano i valori che sembrano indirizzi di immagini.
IMAGES = {"teams": {}, "players": {}}
_IMG_EXT = re.compile(r"\.(png|jpe?g|webp|svg|gif)(\?|$)", re.I)
_IMG_KEY = ("logo", "image", "img", "photo", "foto", "picture", "avatar", "pic")
_seen_keys = set()


def _img_url(key, val):
    if not isinstance(val, str) or len(val) < 5 or " " in val.strip():
        return None
    v = val.strip()
    if not (_IMG_EXT.search(v) or any(k in key.lower() for k in _IMG_KEY)) or "/" not in v:
        return None
    if v.startswith("//"):
        return "https:" + v
    if v.startswith("/"):
        return SITE + v
    if v.startswith("http"):
        return v.replace("http://", "https://", 1)
    return SITE + "/" + v


def _images_in(obj, depth=0):
    """[(chiave, url)] di tutti i valori-immagine in un dizionario (anche annidato)."""
    out = []
    if isinstance(obj, dict) and depth < 3:
        for k, v in obj.items():
            u = _img_url(str(k), v)
            if u:
                out.append((str(k).lower(), u))
            elif isinstance(v, dict):
                out += [(f"{k}.{kk}".lower(), uu) for kk, uu in _images_in(v, depth + 1)]
    return out


def collect_images(m, hcode, vcode, rows_by_side):
    """m = dati della partita; rows_by_side = {"ht": righe, "vt": righe} del tabellino."""
    for key, url in _images_in(m):
        side = hcode if key.startswith(("h_", "ht_", "home")) else vcode if key.startswith(("v_", "vt_", "visitor", "away")) else None
        if side and ("logo" in key or "team" in key):
            IMAGES["teams"][side] = url
            _seen_keys.add("squadra:" + key)
    for rows in rows_by_side.values():
        for r in rows or []:
            if not r.get("player_id"):
                continue
            imgs = [(k, u) for k, u in _images_in(r) if "team" not in k and "logo" not in k]
            if imgs:
                IMAGES["players"][str(int(r["player_id"]))] = imgs[0][1]
                _seen_keys.add("giocatore:" + imgs[0][0])


# ------------------------------------------------------------ stagioni

def season_start_year(today):
    return today.year if today.month >= 8 else today.year - 1


def season_str(y):
    return f"{y}-{str(y + 1)[-2:]}"


def regular_seasons():
    """{anno: id del campionato di regular season}"""
    out = dict(KNOWN_RS)
    try:
        d = get(f"get-championships?cs_id={SERIES_A}&items=1000")
        for c in d.get("competitions", []):
            if c.get("ctype_code") == "RS" and c.get("championship_series_id") == SERIES_A:
                out[int(c["year"])] = int(c["id"])
    except RuntimeError as e:
        log("ATTENZIONE elenco campionati:", e)
    return out


def season_games(cid):
    """Tutte le partite di una stagione dalla tabella riassuntiva: [{gid, hid, vid, hname, vname, played}]"""
    d = get(f"get-championships-summary-by-id?id={cid}")
    games = []
    for h in (d.get("summary_table") or {}).values():
        for g in h.values():
            sc = str(g.get("score") or "0-0")
            games.append({"gid": str(g["match_id"]), "hname": g.get("ht_name"), "vname": g.get("vt_name"),
                          "played": sc not in ("0-0", "")})
    return sorted(games, key=lambda g: int(g["gid"]))


# ------------------------------------------------------------ partita

def _local_date(iso):
    return (iso or "")[:10]


def _utc(iso):
    try:
        return dt.datetime.fromisoformat(iso).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    except (TypeError, ValueError):
        return None


def match(gid):
    """Dati di una partita: info + righe dei giocatori (se giocata)."""
    d = get(f"get-championships-matches-by-id?id={gid}")
    m = d.get("match") or {}
    hcode, hshort = club(m.get("h_team_name"))
    vcode, vshort = club(m.get("v_team_name"))
    info = {"id": str(gid), "utc": _utc(m.get("match_datetime")), "date": _local_date(m.get("match_datetime")),
            "home": hcode, "away": vcode, "status": str(m.get("game_status")),
            "hs": m.get("home_final_score"), "vs": m.get("visitor_final_score"), "round": m.get("number"),
            "teams": {hcode: {"name": m.get("h_team_name"), "short": hshort},
                      vcode: {"name": m.get("v_team_name"), "short": vshort}}}
    rows, names = [], {}
    sc = d.get("scores") or {}
    collect_images(m, hcode, vcode, {side: (sc.get(side) or {}).get("rows") for side in ("ht", "vt")})
    if info["status"] == "2":
        for side, tri, opp, home in (("ht", hcode, vcode, 1), ("vt", vcode, hcode, 0)):
            for r in (sc.get(side) or {}).get("rows") or []:
                secs = r.get("sec") or 0
                if secs <= 0 or not r.get("player_id"):
                    continue
                pid = int(r["player_id"])
                names[pid] = f"{(r.get('player_name') or '').strip()} {(r.get('player_surname') or '').strip().title()}".strip()
                n = lambda k: r.get(k) or 0  # noqa: E731
                rows.append([pid, tri, str(gid), info["date"], opp, home, round(secs / 60, 1),
                             n("pun"), n("rimbalzi_t"), n("rimbalzi_o"), n("ass"), n("t3_r"), n("palle_r"),
                             n("stoppate_dat"), n("palle_p"), n("t2_t") + n("t3_t"), n("tl_t"),
                             n("t2_r") + n("t3_r"), n("tl_r"), n("t3_t")])
    return info, rows, names


def fetch_games(gids):
    out_rows, out_names, infos = [], {}, []
    for i, gid in enumerate(gids, 1):
        try:
            info, rows, names = match(gid)
        except RuntimeError as e:
            log("  saltata", gid, e)
            continue
        infos.append(info)
        out_rows += rows
        out_names.update(names)
        if i % 25 == 0:
            log(f"  {i}/{len(gids)} partite")
    return infos, out_rows, out_names


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
    write_json(path, {"cols": COLS, "names": {str(k): v for k, v in names.items() if int(k) in used}, "rows": rows})


# ------------------------------------------------------------ passi

def backfill_past(y_cur, n_past, rs, teams, download=True):
    files = []
    for k in range(n_past, 0, -1):
        y = y_cur - k
        s = season_str(y)
        path = os.path.join(LOGS, f"{s}.json")
        if os.path.exists(path):
            files.append(f"logs/{s}.json")
            continue
        if not download or y not in rs:
            continue
        games = [g for g in season_games(rs[y]) if g["played"]]
        log(f"Stagione {s}: {len(games)} partite, scarico i tabellini (circa {len(games) * DELAY / 60:.0f} minuti)...")
        infos, rows, names = fetch_games([g["gid"] for g in games])
        for i in infos:
            teams.update(i["teams"])
        if rows:
            write_logs(path, rows, names)
            files.append(f"logs/{s}.json")
        log(f"Stagione {s}: salvate {len(rows)} righe")
    return files


def update_current(y, rs, teams, meta):
    s = season_str(y)
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
    cache = {g["id"]: g for g in meta.get("games_cache", []) if g.get("season") == s}
    if y not in rs:
        log(f"Stagione {s}: campionato non ancora disponibile")
        return [f"logs/{s}_{m}.json" for m in sorted(by_month)], []
    games = season_games(rs[y])
    new = [g["gid"] for g in games if g["played"] and g["gid"] not in have]
    log(f"Stagione {s}: {len(games)} partite in calendario, {len(new)} nuove da scaricare")
    infos, rows, names = fetch_games(new)
    if stale and rows:
        by_month = {}
    for i in infos:
        teams.update(i["teams"])
        cache[i["id"]] = {**{k: i[k] for k in ("id", "utc", "home", "away", "status", "round")}, "season": s}
    for r in rows:
        m = r[3][:7]
        d = by_month.setdefault(m, {"cols": COLS, "names": {}, "rows": []})
        d["rows"].append(r)
        d["names"][str(r[0])] = names.get(r[0], d["names"].get(str(r[0])))
    if rows:
        for m, d in by_month.items():
            write_logs(os.path.join(LOGS, f"{s}_{m}.json"), d["rows"], {int(k): v for k, v in d["names"].items()})

    # calendario: data e ora delle partite non ancora giocate (si aggiornano quelle delle prossime settimane)
    now = dt.datetime.now(dt.timezone.utc)
    soon = now + dt.timedelta(days=21)
    todo = []
    for g in games:
        if g["played"]:
            continue
        c = cache.get(g["gid"])
        t = dt.datetime.strptime(c["utc"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc) if c and c.get("utc") else None
        if c is None or t is None or t <= soon:
            todo.append(g["gid"])
    log(f"Calendario: aggiorno {len(todo)} partite")
    for gid in todo:
        try:
            info, _, _ = match(gid)
        except RuntimeError as e:
            log("  calendario", gid, e)
            continue
        teams.update(info["teams"])
        cache[gid] = {**{k: info[k] for k in ("id", "utc", "home", "away", "status", "round")}, "season": s}
    played = {g["gid"] for g in games if g["played"]}
    schedule = []
    for gid, c in cache.items():
        if gid in played or not c.get("utc"):
            continue
        t = dt.datetime.strptime(c["utc"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)
        if t < now - dt.timedelta(hours=4) or t > soon:
            continue
        schedule.append({"id": gid, "utc": c["utc"], "home": c["home"], "away": c["away"],
                         "state": "in" if c.get("status") == "1" else "pre", "stype": 2, "round": c.get("round")})
    schedule.sort(key=lambda g: g["utc"])
    meta["games_cache"] = sorted(cache.values(), key=lambda g: int(g["id"]))
    return [f"logs/{s}_{m}.json" for m in sorted(by_month)], schedule


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
    today = dt.date.today()
    y = season_start_year(today)
    os.makedirs(LOGS, exist_ok=True)
    meta = read_json(os.path.join(DATA, "meta.json"), {}) or {}
    teams = dict(meta.get("teams") or {})
    rs = regular_seasons()
    log("Campionati di regular season:", {k: v for k, v in sorted(rs.items()) if k >= y - args.past})

    past_files = backfill_past(y, args.past, rs, teams, download=not args.skip_past)
    old = meta.get("images") or {}
    IMAGES["teams"] = {**(old.get("teams") or {}), **IMAGES["teams"]}
    IMAGES["players"] = {**(old.get("players") or {}), **IMAGES["players"]}
    cur_files, schedule = update_current(y, rs, teams, meta)
    if not old.get("scanned"):
        # prima volta: rilegge le ultime partite già salvate solo per prendere foto e loghi
        gids = sorted({r[2] for f in cur_files for r in (read_json(os.path.join(DATA, f)) or {}).get("rows", [])}, key=int)[-64:]
        log(f"Immagini: rileggo {len(gids)} partite già salvate (una volta sola)")
        for gid in gids:
            try:
                match(gid)
            except RuntimeError as e:
                log("  immagini", gid, e)
    log(f"Immagini: {len(IMAGES['teams'])} loghi, {len(IMAGES['players'])} foto; campi trovati: {sorted(_seen_keys) or 'nessuno'}")
    meta["images"] = {"teams": IMAGES["teams"], "players": IMAGES["players"], "scanned": True}
    meta.update({"league": "LBA", "season": season_str(y), "seasons": [season_str(y - k) for k in range(args.past + 1)],
                 "files": past_files + cur_files, "schedule": schedule, "rosters": rosters_from_logs(y),
                 "injuries": [], "teams": teams,
                 "current_teams": sorted({g["home"] for g in meta.get("games_cache", [])} | {g["away"] for g in meta.get("games_cache", [])})})
    meta["updated_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    write_json(os.path.join(DATA, "meta.json"), meta)
    keep = {os.path.basename(f) for f in meta["files"]}
    for fn in os.listdir(LOGS):
        if fn.endswith(".json") and fn not in keep:
            os.remove(os.path.join(LOGS, fn))
    log("Fatto:", meta["updated_at"], len(meta["files"]), "file,", len(schedule), "partite in calendario,",
        len(meta["rosters"]), "giocatori,", len(meta["current_teams"]), "squadre")


if __name__ == "__main__":
    sys.exit(main())
