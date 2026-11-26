"""Foto dei giocatori di Serie A da fantacalcio.it (ESPN ha la foto solo di pochi calciatori: 27 su 504 nella prova).

La pagina delle quotazioni elenca tutti i giocatori di Serie A con il loro codice fantacalcio.it
(/serie-a/squadre/<squadra>/<nome>/<codice>); la foto è content.fantacalcio.it/web/campioncini/<stagione>/medium/<codice>.png.
Il nome (dal link, es. "martinez-l") si cerca nella rosa ESPN della stessa squadra, come per gli indisponibili.
"""
import re

from injuries import _player_id, _team_id, fetch, log, plain

LIST_URL = "https://www.fantacalcio.it/quotazioni-fantacalcio"
TEAM_URL = "https://www.fantacalcio.it/serie-a/squadre/inter"
IMG = "https://content.fantacalcio.it/web/campioncini/{folder}/medium/{fid}.png"


def fantacalcio_photos(rosters, teams):
    page = fetch(LIST_URL, as_json=False)
    if not page:
        raise RuntimeError("pagina delle quotazioni non disponibile")
    # cartella delle foto della stagione (es. 21), letta da una pagina squadra
    folder = "21"
    try:
        m = re.search(r"campioncini/(\d+)/", fetch(TEAM_URL, as_json=False) or "")
        folder = m.group(1) if m else folder
    except RuntimeError:
        pass
    by_team = {}
    for pid, r in rosters.items():
        by_team.setdefault(str(r.get("tid")), []).append((pid, r.get("name") or ""))
    links = sorted(set(re.findall(r"/serie-a/squadre/([a-z0-9-]+)/([a-z0-9-]+)/(\d+)", page)))
    out, miss = {}, []
    team_ids = {}
    for tslug, pslug, fid in links:
        if tslug not in team_ids:
            team_ids[tslug] = _team_id(tslug.replace("-", " "), teams)
        tid = team_ids[tslug]
        ros, toks = by_team.get(str(tid), []), pslug.split("-")
        pid = _player_id(" ".join(toks), ros) if tid else None
        if not pid and tid and len(toks) > 1 and len(toks[-1]) <= 4:   # "pessina-mas" = Pessina Massimo
            pid = _player_id(" ".join(toks[:-1]) + f" {toks[-1][0]}.", ros)
        if pid:
            out[str(pid)] = IMG.format(folder=folder, fid=fid)
        else:
            miss.append(f"{pslug} ({tslug})")
    log(f"Foto Serie A (fantacalcio.it): {len(out)} giocatori su {len(links)} in elenco"
        + (f"; non abbinati {len(miss)}: {miss[:15]}" if miss else ""))
    return out


# ------------------------------------------------------------ Champions League: foto ufficiali UEFA
# Le formazioni di ogni partita UEFA (match.uefa.com) hanno nome, squadra e foto di ogni giocatore.
# I giocatori già letti si tengono in un file (uefa_players.json) così si scaricano solo le partite nuove.
UEFA_MATCHES = ("https://match.uefa.com/v5/matches?competitionId={comp}&seasonYear={year}"
                "&limit=100&offset={off}&order=ASC&status=FINISHED")
UEFA_LINEUPS = "https://match.uefa.com/v5/matches/{mid}/lineups"
UEFA_COMP = {"uefa.champions": 1, "uefa.europa": 14, "uefa.europa.conf": 2019}


def _uefa_players(league, season_start, cache):
    comp = UEFA_COMP.get(league)
    if not comp:
        return cache
    done = set(cache.setdefault("matches", []))
    players = cache.setdefault("players", {})
    ids, off = [], 0
    while True:
        page = fetch(UEFA_MATCHES.format(comp=comp, year=season_start + 1, off=off)) or []
        ids += [str(m["id"]) for m in page if m.get("id")]
        if len(page) < 100 or off > 2000:
            break
        off += 100
    new = [m for m in ids if m not in done]
    for mid in new:
        try:
            lu = fetch(UEFA_LINEUPS.format(mid=mid)) or {}
        except RuntimeError as e:
            log(f"  formazione {mid}: {e}")
            continue
        for side in ("homeTeam", "awayTeam"):
            t = lu.get(side) or {}
            team = ((t.get("team") or {}).get("internationalName")) or ""
            for grp in ("field", "bench"):
                for e in t.get(grp) or []:
                    p = e.get("player") or {}
                    if p.get("id") and p.get("imageUrl"):
                        fn = ((p.get("translations") or {}).get("firstName") or {}).get("EN") or ""
                        ln = ((p.get("translations") or {}).get("lastName") or {}).get("EN") or ""
                        players[str(p["id"])] = [p.get("internationalName") or "", fn, ln, team, p["imageUrl"]]
        done.add(mid)
    cache["matches"] = sorted(done)
    log(f"Formazioni UEFA: {len(new)} partite nuove, {len(players)} giocatori in archivio")
    return cache


def _words(s):
    return [w for w in plain(s).split() if w]


def uefa_photos(rosters, teams, league, season_start, cache):
    """{pid ESPN: foto UEFA}. Abbinamento per nome (completo, poi cognome + iniziale), la squadra decide i casi dubbi."""
    cache = _uefa_players(league, season_start, cache)
    tname = {str(t): plain((v or {}).get("name") or "") for t, v in teams.items()}
    full, last = {}, {}
    for pid, r in rosters.items():
        w = _words(r.get("name"))
        if not w:
            continue
        full.setdefault(" ".join(w), []).append(pid)
        full.setdefault(" ".join(sorted(w)), []).append(pid)   # stesso nome in altro ordine (es. Kim Min-Jae)
        last.setdefault(w[-1], []).append(pid)

    def by_team(cands, team):
        tw = set(_words(team)) - {"fc", "cf", "ac", "sc", "fk", "club", "de", "sk"}
        best = [c for c in cands if tw & set(tname.get(str(rosters[c].get("tid")), "").split())]
        return best if best else cands

    out = {}
    for uid, (iname, fn, ln, team, img) in cache["players"].items():
        cands = (full.get(" ".join(_words(iname))) or full.get(" ".join(_words(f"{fn} {ln}")))
                 or full.get(" ".join(sorted(_words(iname)))) or [])
        cands = list(dict.fromkeys(cands))
        if not cands:
            lw, fw = _words(ln) or _words(iname)[-1:], _words(fn)
            if lw:
                cands = [c for c in last.get(lw[-1], []) if not fw or _words(rosters[c]["name"])[0][:1] == fw[0][:1]
                         or len(_words(rosters[c]["name"])) == 1]
        if len(cands) > 1:
            cands = by_team(cands, team)
        if len(cands) == 1:
            out[str(cands[0])] = img
    log(f"Foto UEFA: {len(out)} giocatori su {len(rosters)} nelle rose")
    return out, cache


# ------------------------------------------------------------ Premier League: foto dal sito ufficiale
# L'elenco dei giocatori del sito della Premier League ha nome, squadra e codice; la foto è
# resources.premierleague.com/premierleague25/photos/players/110x140/<codice>.png (ESPN ne ha pochissime).
PL_PLAYERS = ("https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v1/competitions/8/seasons/{year}/players"
              "?_limit=100{nxt}")
PL_IMG = "https://resources.premierleague.com/premierleague25/photos/players/110x140/{pid}.png"


def premier_photos(rosters, teams, season_start):
    import urllib.parse
    plist, nxt = [], ""
    for _ in range(40):
        page = fetch(PL_PLAYERS.format(year=season_start, nxt=f"&_next={urllib.parse.quote(nxt)}" if nxt else "")) or {}
        plist += page.get("data") or []
        nxt = (page.get("pagination") or {}).get("_next")
        if not nxt:
            break
    by_team = {}
    for pid, r in rosters.items():
        by_team.setdefault(str(r.get("tid")), []).append((pid, r.get("name") or ""))
    out, miss, tids = {}, [], {}
    for p in plist:
        team = p.get("currentTeam") or {}
        key = team.get("id")
        if key not in tids:
            tids[key] = _team_id(team.get("abbr") or "", teams) or _team_id(team.get("name") or "", teams) \
                or _team_id(team.get("shortName") or "", teams)
        ros = by_team.get(str(tids[key]), [])
        nm = p.get("name") or {}
        first, last = (nm.get("firstName") or "").strip(), (nm.get("lastName") or "").strip()
        tries = [nm.get("display") or nm.get("knownName") or "", f"{first} {last}", last]
        if last and first:
            tries.append(f"{last.split()[-1]} {first[0]}.")
        pid = next((x for x in (_player_id(t, ros) for t in tries if t.strip()) if x), None) if ros else None
        code = (p.get("id") or {}).get("playerId")
        if pid and code:
            out[str(pid)] = PL_IMG.format(pid=code)
        elif ros:
            miss.append(f"{first} {last} ({team.get('shortName')})")
    log(f"Foto Premier League (sito ufficiale): {len(out)} giocatori su {len(rosters)} nelle rose; "
        f"elenco {len(plist)}" + (f"; non abbinati {len(miss)}: {miss[:12]}" if miss else ""))
    return out
