"""Cronaca delle partite (play-by-play) → statistiche per quarto (basket) e per minuto (calcio).

Gira su GitHub Actions dopo l'aggiornamento dei tabellini (vedi .github/workflows/update-<sport>.yml).
Legge le partite già salvate in docs/<sport>/data/logs/ (stagione in corso e precedente), scarica la cronaca di
quelle non ancora fatte (al massimo --max per giro, così il recupero delle partite passate avviene un po' alla volta)
e salva, per stagione e squadra:

  docs/<sport>/data/pbp/<stagione>/<squadra>.json
    basket: {"cols": [gid, pid, per, min, pts, reb, ast, fg3m, stl, blk, tov], "rows": [...]}
            per = 1..4 quarti, 5 = supplementari (tutti insieme); min = minuti giocati nel quarto (ricostruiti dai cambi)
    calcio: {"games": {gid: {pid: [entrato, uscito, "eventi"]}}}
            eventi = "13G,13T,52S,70F" (minuto + codice): G gol, A assist, T tiro in porta, S tiro fuori, B tiro respinto,
            F fallo commesso, W fallo subito, Y ammonizione, R espulsione. Minuti dei recuperi: 45 e 90 (primo tempo 1-45).
  docs/<sport>/data/pbp/<stagione>/done.json   partite già lette (e quelle senza cronaca)

Fonti: ESPN summary (campo "plays" per l'NBA, "commentary" e "rosters" per il calcio), legabasket.it
get-championships-matches-play-by-play (LBA, 2 secondi fra le richieste).
"""
import argparse
import collections
import datetime as dt
import glob
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
SPORTS = {
    "nba": {"kind": "basket", "src": "espn", "path": "basketball/nba", "team": "tri", "per_len": 720, "ot_len": 300},
    "lba": {"kind": "basket", "src": "lba", "team": "tri", "per_len": 600, "ot_len": 300},
    "seriea": {"kind": "soccer", "src": "espn", "path": "soccer/ita.1", "team": "tid"},
    "ucl": {"kind": "soccer", "src": "espn", "path": "soccer/uefa.champions", "team": "tid"},
}
BCOLS = ["gid", "pid", "per", "min", "pts", "reb", "ast", "fg3m", "stl", "blk", "tov"]
REPORT = {"games": 0, "errors": 0, "check": collections.Counter(), "types": collections.Counter()}


def log(*a):
    print(*a, flush=True)


_last = [0.0]


def fetch(url, delay=0.0, retries=3):
    err = None
    for i in range(retries):
        wait = delay - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json",
                                                       "Referer": "https://www.legabasket.it/"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err = e
        except (urllib.error.URLError, TimeoutError, ValueError, ConnectionError) as e:
            err = e
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"{url}: {err}")


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, path)


def plain(s):
    return re.sub(r"[^a-z0-9 ]", "", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()).strip()


# ------------------------------------------------------------ partite salvate

def saved_games(data, team_key, n_seasons):
    """{stagione: {gid: {"date": d, "players": {pid: squadra}, "rows": {pid: riga}}}} per le ultime n stagioni"""
    meta = read_json(os.path.join(data, "meta.json"), {})
    seasons = (meta.get("seasons") or [])[:n_seasons]
    out = {}
    for f in meta.get("files") or []:
        season = os.path.basename(f).split("_")[0].replace(".json", "")
        if season not in seasons:
            continue
        j = read_json(os.path.join(data, f), {})
        cols = j.get("cols") or []
        if not cols:
            continue
        ix = {c: i for i, c in enumerate(cols)}
        for r in j.get("rows") or []:
            g = out.setdefault(season, {}).setdefault(str(r[ix["gid"]]), {"date": r[ix["date"]], "players": {}, "rows": {}})
            pid = str(r[ix["pid"]])
            g["players"][pid] = str(r[ix[team_key]])
            g["rows"][pid] = {c: r[i] for c, i in ix.items()}
    return out


# ------------------------------------------------------------ basket: minuti per quarto

def minutes_by_period(events, per_len, ot_len):
    """events: [(periodo, secondi trascorsi, tipo, pid)] tipo = "in" | "out" | "act". → {(pid, per): secondi}"""
    out = collections.Counter()
    by_per = collections.defaultdict(list)
    for e in events:
        by_per[e[0]].append(e)
    for per, evs in by_per.items():
        length = per_len if per <= 4 else ot_len
        on, known = {}, set()
        for _, t, typ, pid in evs:     # già in ordine di gioco
            t = max(0, min(length, t))
            if typ == "in":
                if pid not in known:
                    known.add(pid)
                if pid not in on:
                    on[pid] = t
            elif typ == "out":
                if pid not in known:     # uscito senza essere entrato: era in campo dall'inizio del quarto
                    known.add(pid)
                    out[(pid, per)] += t
                elif pid in on:
                    out[(pid, per)] += t - on.pop(pid)
            else:
                if pid not in known:     # prima azione senza ingresso: era in campo dall'inizio
                    known.add(pid)
                    on[pid] = 0
                elif pid not in on:      # azione da fuori campo (es. tecnico in panchina): la ignoro
                    pass
        for pid, t0 in on.items():
            out[(pid, per)] += length - t0
    return out


def clock_secs(dv):
    """'11:44' → 704 secondi rimasti; '45.2' → 45"""
    dv = str(dv or "")
    m = re.match(r"^(\d+):(\d+)", dv)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    try:
        return float(dv)
    except ValueError:
        return 0.0


def basket_rows(gid, stats, mins, valid):
    rows = []
    keys = set(stats) | set(mins)
    for pid, per in sorted(keys):
        if pid not in valid:
            continue
        s = stats.get((pid, per), collections.Counter())
        m = round(mins.get((pid, per), 0) / 60, 1)
        if not m and not any(s.values()):
            continue
        rows.append([gid, int(pid), per, m, s["pts"], s["reb"], s["ast"], s["fg3m"], s["stl"], s["blk"], s["tov"]])
    return rows


def nba_game(cfg, gid):
    s = fetch(f"https://site.api.espn.com/apis/site/v2/sports/{cfg['path']}/summary?event={gid}")
    plays = (s or {}).get("plays") or []
    if not plays:
        return None
    stats = collections.defaultdict(collections.Counter)
    events = []
    for p in plays:
        per = min(5, int(((p.get("period") or {}).get("number")) or 1))
        length = cfg["per_len"] if per <= 4 else cfg["ot_len"]
        t = length - clock_secs((p.get("clock") or {}).get("displayValue"))
        ids = [str((x.get("athlete") or {}).get("id")) for x in p.get("participants") or [] if (x.get("athlete") or {}).get("id")]
        typ = str((p.get("type") or {}).get("text") or "")
        txt = str(p.get("text") or "").lower()
        REPORT["types"][typ] += 1
        if not ids:
            continue
        if typ == "Substitution":
            if len(ids) >= 2:
                events.append((per, t, "in", ids[0]))
                events.append((per, t, "out", ids[1]))
            continue
        events.append((per, t, "act", ids[0]))
        if p.get("scoringPlay") and p.get("scoreValue"):
            v = int(p["scoreValue"])
            stats[(ids[0], per)]["pts"] += v
            if v == 3:
                stats[(ids[0], per)]["fg3m"] += 1
            if len(ids) > 1 and "assist" in txt:
                stats[(ids[1], per)]["ast"] += 1
                events.append((per, t, "act", ids[1]))
        elif "rebound" in typ.lower():
            stats[(ids[0], per)]["reb"] += 1
        elif "turnover" in typ.lower():
            stats[(ids[0], per)]["tov"] += 1
            if len(ids) > 1 and "steal" in txt:
                stats[(ids[1], per)]["stl"] += 1
                events.append((per, t, "act", ids[1]))
        elif p.get("shootingPlay") and len(ids) > 1 and "block" in txt:
            stats[(ids[1], per)]["blk"] += 1
            events.append((per, t, "act", ids[1]))
    return stats, minutes_by_period(events, cfg["per_len"], cfg["ot_len"])


def lba_game(cfg, gid):
    d = fetch(f"https://www.legabasket.it/api/championships/get-championships-matches-play-by-play?id={gid}", delay=2.0)
    acts = (((d or {}).get("pbp") or {}).get("actions")) or []
    if not acts:
        return None
    acts = sorted(acts, key=lambda a: a.get("order") or 0)
    stats = collections.defaultdict(collections.Counter)
    events = []
    for a in acts:
        desc = plain(a.get("description"))
        REPORT["types"][desc] += 1
        pid = a.get("player_id")
        if not pid:
            continue
        pid = str(pid)
        per = min(5, int(a.get("period") or 1))
        t = int(a.get("minute") or 0) * 60 + int(a.get("seconds") or 0)
        if "entra" in desc:
            events.append((per, t, "in", pid)); continue
        if "esce" in desc:
            events.append((per, t, "out", pid)); continue
        events.append((per, t, "act", pid))
        st = stats[(pid, per)]
        made = "segnat" in desc or "realizzat" in desc
        if made and "3 punti" in desc:
            st["pts"] += 3; st["fg3m"] += 1
        elif made and "2 punti" in desc:
            st["pts"] += 2
        elif made and ("libero" in desc or "liberi" in desc):
            st["pts"] += 1
        elif "rimbalzo" in desc:
            st["reb"] += 1
        elif "assist" in desc:
            st["ast"] += 1
        elif "palla persa" in desc or "perdita" in desc:
            st["tov"] += 1
        elif "palla recuperata" in desc or "recupero" in desc:
            st["stl"] += 1
        elif "stoppata" in desc and "subit" not in desc:
            st["blk"] += 1
    return stats, minutes_by_period(events, cfg["per_len"], cfg["ot_len"])


def check_basket(stats, mins, rows):
    """confronto con il tabellino: punti, rimbalzi, assist e minuti per giocatore"""
    tot = collections.defaultdict(collections.Counter)
    for (pid, per), s in stats.items():
        tot[pid].update(s)
    tmin = collections.Counter()
    for (pid, per), v in mins.items():
        tmin[pid] += v / 60
    for pid, r in rows.items():
        for k in ("pts", "reb", "ast", "stl", "blk", "tov", "fg3m"):
            REPORT["check"][f"{k} {'ok' if tot[pid][k] == (r.get(k) or 0) else 'diverso'}"] += 1
        REPORT["check"][f"min {'ok' if abs(tmin[pid] - (r.get('min') or 0)) <= 2 else 'diverso'}"] += 1


# ------------------------------------------------------------ calcio: minuti delle azioni

def soccer_minute(e):
    """'45'+2'' → (45, tempo); '67'' → 67; i recuperi del secondo tempo restano 90"""
    dv = str(((e.get("time") or {}).get("displayValue")) or ((e.get("clock") or {}).get("displayValue")) or "")
    m = re.match(r"\s*(\d+)", dv)
    if not m:
        v = ((e.get("clock") or {}).get("value")) or ((e.get("time") or {}).get("value"))
        return int(float(v) // 60) + 1 if v else None
    return int(m.group(1))


def soccer_game(cfg, gid, valid):
    s = fetch(f"https://site.api.espn.com/apis/site/v2/sports/{cfg['path']}/summary?event={gid}")
    if not s:
        return None
    names, players = {}, {}
    full = 120 if any(((c.get("play") or {}).get("period") or {}).get("number", 0) >= 3 for c in s.get("commentary") or []) else 90
    for side in s.get("rosters") or []:
        for p in side.get("roster") or []:
            ath = p.get("athlete") or {}
            pid = str(ath.get("id") or "")
            if not pid:
                continue
            for n in (ath.get("displayName"), ath.get("shortName"), ath.get("fullName")):
                if n:
                    names.setdefault(plain(n), pid)
            starter = bool(p.get("starter"))
            subs = sorted({soccer_minute(x) for x in p.get("plays") or [] if x.get("substitution")} - {None})
            reds = [soccer_minute(x) for x in p.get("plays") or [] if x.get("redCard")]
            sub_in = bool(p.get("subbedIn")) if not isinstance(p.get("subbedIn"), dict) else bool(p["subbedIn"].get("didSub"))
            sub_out = bool(p.get("subbedOut")) if not isinstance(p.get("subbedOut"), dict) else bool(p["subbedOut"].get("didSub"))
            if starter:
                t_in = 0
                t_out = subs[0] if sub_out and subs else full
            elif sub_in and subs:
                t_in = subs[0]
                t_out = subs[1] if sub_out and len(subs) > 1 else full
            else:
                continue
            if reds and reds[0] is not None:
                t_out = min(t_out, reds[0])
            players[pid] = [t_in, t_out, []]
    if not players:
        return None

    def who(part):
        a = (part or {}).get("athlete") or {}
        if a.get("id"):
            return str(a["id"])
        n = plain(a.get("displayName"))
        if n in names:
            return names[n]
        last = n.split(" ")[-1] if n else ""   # a volte il nome è scritto in modo diverso: provo col cognome (se unico)
        cand = {v for k, v in names.items() if k.split(" ")[-1] == last} if last else set()
        return cand.pop() if len(cand) == 1 else None

    for c in s.get("commentary") or []:
        p = c.get("play") or {}
        typ = str((p.get("type") or {}).get("text") or "").lower()
        if not typ:
            continue
        REPORT["types"][typ] += 1
        m = soccer_minute(c)
        if m is None:
            continue
        parts = p.get("participants") or []
        ids = [who(x) for x in parts]
        txt = str(c.get("text") or p.get("text") or "")
        codes = []
        if ("goal" in typ and "own" not in typ and "disallowed" not in typ) or typ == "penalty - scored":
            codes = [(0, "G"), (0, "T")] + ([(1, "A")] if "assisted by" in txt.lower() else [])
        elif typ == "shot on target":
            codes = [(0, "T")]
        elif typ == "shot off target" or "penalty - missed" in typ or "hit woodwork" in typ:
            codes = [(0, "S")]
        elif typ == "shot blocked":
            codes = [(0, "B")]
        elif typ == "foul":
            codes = [(0, "F"), (1, "W")]
        elif typ == "yellow card":
            codes = [(0, "Y")]
        elif "red card" in typ:
            codes = [(0, "R")]
        for i, code in codes:
            if i < len(ids) and ids[i] in players:
                players[ids[i]][2].append(f"{m}{code}")
            elif i < len(ids):
                REPORT["check"]["evento senza giocatore"] += 1
    return {pid: [v[0], v[1], ",".join(v[2])] for pid, v in players.items() if pid in valid}


def check_soccer(res, rows):
    for pid, r in rows.items():
        ev = res.get(pid)
        if not ev:
            REPORT["check"]["giocatore mancante"] += 1
            continue
        codes = collections.Counter(re.sub(r"\d+", "", x) for x in ev[2].split(",") if x)
        for k, c in (("gol", ["G"]), ("ast", ["A"]), ("sh", ["T", "S", "B"]), ("sot", ["T"]), ("fc", ["F"]), ("fs", ["W"]), ("yc", ["Y"])):
            v = sum(codes[x] for x in c)
            REPORT["check"][f"{k} {'ok' if v == (r.get(k) or 0) else 'diverso'}"] += 1
        REPORT["check"][f"min {'ok' if abs((ev[1] - ev[0]) - (r.get('min') or 0)) <= 3 else 'diverso'}"] += 1


# ------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sport", required=True, choices=SPORTS)
    ap.add_argument("--max", type=int, default=150, help="partite da scaricare al massimo in questo giro")
    ap.add_argument("--seasons", type=int, default=2)
    ap.add_argument("--report", help="file dove salvare il confronto con i tabellini")
    a = ap.parse_args()
    cfg = SPORTS[a.sport]
    data = os.path.join(ROOT, "docs", a.sport, "data")
    games = saved_games(data, cfg["team"], a.seasons)
    budget = a.max
    t0 = time.time()
    for season in sorted(games, reverse=True):     # prima la stagione in corso
        sdir = os.path.join(data, "pbp", season)
        done = read_json(os.path.join(sdir, "done.json"), {"done": [], "missing": {}})
        done_set = set(done["done"])
        todo = sorted((g for g in games[season] if g not in done_set), key=lambda g: games[season][g]["date"], reverse=True)
        if not todo:
            continue
        files = {}

        def team_file(team):
            if team not in files:
                files[team] = read_json(os.path.join(sdir, f"{team}.json"),
                                        {"cols": BCOLS, "rows": []} if cfg["kind"] == "basket" else {"games": {}})
            return files[team]

        n_new = 0
        for gid in todo:
            if budget <= 0:
                break
            g = games[season][gid]
            # partita senza cronaca: riprovo al massimo 3 volte (in giri diversi)
            if done["missing"].get(gid, 0) >= 3:
                continue
            budget -= 1
            try:
                if cfg["kind"] == "basket":
                    r = nba_game(cfg, gid) if cfg["src"] == "espn" else lba_game(cfg, gid)
                else:
                    r = soccer_game(cfg, gid, g["players"])
            except Exception as e:  # noqa: BLE001 — una partita che non risponde non deve fermare le altre
                log("  errore", gid, e)
                REPORT["errors"] += 1
                continue
            if not r:
                done["missing"][gid] = done["missing"].get(gid, 0) + 1
                continue
            REPORT["games"] += 1
            if cfg["kind"] == "basket":
                stats, mins = r
                check_basket(stats, mins, g["rows"])
                for row in basket_rows(int(gid) if gid.isdigit() else gid, stats, mins, g["players"]):
                    team_file(g["players"][str(row[1])])["rows"].append(row)
            else:
                check_soccer(r, g["rows"])
                by_team = collections.defaultdict(dict)
                for pid, v in r.items():
                    by_team[g["players"][pid]][pid] = v
                for team, pl in by_team.items():
                    team_file(team)["games"][gid] = pl
            done["done"].append(gid)
            done["missing"].pop(gid, None)
            n_new += 1
        for team, obj in files.items():
            write_json(os.path.join(sdir, f"{team}.json"), obj)
        write_json(os.path.join(sdir, "done.json"), done)
        log(f"{a.sport} {season}: {n_new} partite nuove, {len(todo) - n_new} da fare")
    log(f"fatto in {time.time() - t0:.0f}s · partite {REPORT['games']} · errori {REPORT['errors']}")
    log("confronto con i tabellini:", dict(REPORT["check"]))
    if a.report:
        write_json(a.report, {"games": REPORT["games"], "errors": REPORT["errors"], "check": dict(REPORT["check"]),
                              "types": REPORT["types"].most_common()})


if __name__ == "__main__":
    sys.exit(main())
