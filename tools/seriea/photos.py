"""Foto dei giocatori di Serie A da fantacalcio.it (ESPN ha la foto solo di pochi calciatori: 27 su 504 nella prova).

La pagina delle quotazioni elenca tutti i giocatori di Serie A con il loro codice fantacalcio.it
(/serie-a/squadre/<squadra>/<nome>/<codice>); la foto è content.fantacalcio.it/web/campioncini/<stagione>/medium/<codice>.png.
Il nome (dal link, es. "martinez-l") si cerca nella rosa ESPN della stessa squadra, come per gli indisponibili.
"""
import re

from injuries import _player_id, _team_id, fetch, log

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
