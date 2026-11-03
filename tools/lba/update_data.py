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
import urllib.parse
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
# Loghi e foto: nei dati delle partite legabasket.it non mette l'indirizzo dell'immagine ma un codice
# (es. player_p_key nel tabellino, home_logo_key / v_logo_key nella partita). L'immagine è
# {archivio}/variants/{codice}/thumb (o {archivio}/{codice}); l'indirizzo dell'archivio non è documentato:
# find_cdn() lo cerca nelle pagine e negli script del sito e lo verifica scaricando un'immagine vera.
IMAGES = {"teams": {}, "players": {}}   # valori: codice immagine (o indirizzo completo, se il sito lo dà)
IMG_VERSION = 2
_seen_keys = set()


def _img_value(v):
    return v.strip() if isinstance(v, str) and 3 <= len(v.strip()) <= 300 and " " not in v.strip() else None


def _is_player_img(k):
    k = k.lower()
    if "logo" in k or "team" in k:
        return False
    return (k.endswith("_key") and any(w in k for w in ("p_key", "picture", "photo", "image"))) or \
        any(w in k for w in ("image", "photo", "picture", "foto"))


def collect_images(m, hcode, vcode, rows_by_side):
    """m = dati della partita; rows_by_side = {"ht": righe, "vt": righe} del tabellino."""
    for k, v in (m or {}).items():
        kl, v = str(k).lower(), _img_value(v)
        if not v or "logo" not in kl:
            continue
        side = hcode if kl.startswith(("h_", "ht_", "home")) else vcode if kl.startswith(("v_", "vt_", "visitor", "away")) else None
        if side:
            IMAGES["teams"][side] = v
            _seen_keys.add("squadra:" + kl)
    for rows in rows_by_side.values():
        for r in rows or []:
            if not r.get("player_id"):
                continue
            for k, v in r.items():
                v = _img_value(v)
                if v and _is_player_img(str(k)):
                    IMAGES["players"][str(int(r["player_id"]))] = v
                    _seen_keys.add("giocatore:" + str(k).lower())
                    break


def _fetch(url, binary=False):
    """GET semplice; per legabasket.it rispetta i 2 secondi fra le richieste."""
    if "legabasket.it" in url:
        wait = DELAY - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": SITE + "/"})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read()
        return (body, r.headers.get("Content-Type", "")) if binary else body.decode("utf-8", "replace")


def img_urls(base, key):
    if key.startswith(("http://", "https://")):
        return [key]
    key = urllib.parse.quote(key.lstrip("/"), safe="/")
    return [f"{base}/variants/{key}/thumb", f"{base}/{key}"]


def _works(base, key):
    for u in img_urls(base, key):
        try:
            body, ctype = _fetch(u, binary=True)
            if ctype.startswith("image/") and len(body) > 100:
                return True
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError):
            pass
    return False


def _cdn_candidates(text):
    text = text.replace("\\u002F", "/").replace("\\/", "/")
    for m in re.finditer(r"/_next/image\?url=([^&\"' ]+)", text):
        text += " " + urllib.parse.unquote(m.group(1))
    out = re.findall(r"(https?://[A-Za-z0-9.-]+(?:/[A-Za-z0-9._~-]+)*?)/variants/", text)
    # negli script: indirizzi scritti poco prima della parola "variants"
    for m in re.finditer(r"variants", text):
        out += re.findall(r"[\"'`](https?://[^\"'`\s]+?)/?[\"'`]", text[max(0, m.start() - 400):m.start()])
    out += re.findall(r"NEXT_PUBLIC_[A-Z_]*(?:CDN|IMAGE|IMG|MEDIA|ASSET|STORAGE)[A-Z_]*[\"']?\s*[:=]\s*[\"'](https?://[^\"']+)", text)
    out += [u for u in re.findall(r"https?://[A-Za-z0-9.-]+(?:/[A-Za-z0-9._~-]+)*", text)
            if re.search(r"cdn|img|image|media|asset|storage|cloudfront|blob|bucket", u.split("/")[2])]
    seen, res = set(), []
    for u in out:
        u = u.rstrip("/")
        if u not in seen and "legabasket.it/api" not in u:
            seen.add(u)
            res.append(u)
    return res


def find_cdn(key, max_scripts=40):
    tried = set()

    def test(cands):
        for c in cands:
            if c in tried:
                continue
            tried.add(c)
            if _works(c, key):
                return c
        return None

    scripts = []
    for page in (SITE + "/protagonisti/squadre", SITE + "/"):
        try:
            html = _fetch(page)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            log("  immagini, pagina non raggiungibile:", page, e)
            continue
        found = test(_cdn_candidates(html))
        if found:
            return found
        scripts += [x for x in re.findall(r"[\"'](/_next/static/[^\"']+?\.js)[\"']", html) if x not in scripts]
    for src in scripts[:max_scripts]:
        try:
            found = test(_cdn_candidates(_fetch(SITE + src)))
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            continue
        if found:
            return found
    log(f"  immagini: archivio non trovato ({len(tried)} indirizzi provati, {min(len(scripts), max_scripts)} script letti)")
    return None


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
    if old.get("v") != IMG_VERSION:
        old = {}   # formato vecchio: si riparte
    IMAGES["teams"] = {**(old.get("teams") or {}), **IMAGES["teams"]}
    IMAGES["players"] = {**(old.get("players") or {}), **IMAGES["players"]}
    cur_files, schedule = update_current(y, rs, teams, meta)
    if not old.get("scanned"):
        # prima volta: rilegge le ultime partite già salvate solo per prendere foto e loghi
        have_img = set(IMAGES["players"])
        gids = sorted({r[2] for f in cur_files for r in (read_json(os.path.join(DATA, f)) or {}).get("rows", [])
                       if str(r[0]) not in have_img}, key=int)[-64:]
        log(f"Immagini: rileggo {len(gids)} partite già salvate (una volta sola)")
        for gid in gids:
            try:
                match(gid)
            except RuntimeError as e:
                log("  immagini", gid, e)
    log(f"Immagini: {len(IMAGES['teams'])} loghi, {len(IMAGES['players'])} foto; campi trovati: {sorted(_seen_keys) or 'nessuno'}")
    # indirizzo dell'archivio immagini: si riusa quello trovato, altrimenti si cerca (al più una volta al giorno)
    cdn, sample = old.get("cdn"), next(iter(IMAGES["teams"].values()), None) or next(iter(IMAGES["players"].values()), None)
    today_s = dt.date.today().isoformat()
    if sample and not sample.startswith("http") and (not cdn or not _works(cdn, sample)) and old.get("cdn_tried") != today_s:
        log("Immagini: cerco l'indirizzo dell'archivio immagini di legabasket.it...")
        cdn = find_cdn(sample)
        old["cdn_tried"] = today_s
    log(f"Immagini: archivio {cdn or 'non trovato'}")
    meta["images"] = {"v": IMG_VERSION, "cdn": cdn, "cdn_tried": old.get("cdn_tried"),
                      "teams": IMAGES["teams"], "players": IMAGES["players"], "scanned": True}
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
