"""Indisponibili del calcio (ESPN non li pubblica per il calcio).

- Serie A: pagina "Indisponibili" di fantacalcio.it (infortunati e squalificati per squadra, con una descrizione).
  Il nome scritto in breve ("Gonzalez N.") viene cercato nella rosa ESPN della stessa squadra.
- Champions League (e ogni competizione senza fonte): regola sulle ultime partite della squadra in TUTTE le
  competizioni (campionato, coppe, Champions), dalle partite ESPN:
    · fuori dai convocati (né titolare né in panchina) nelle ultime 2 partite  → "Assente"
    · uscito nei primi 30 minuti dell'ultima partita (senza espulsione)         → "In dubbio"
Formato di ogni voce (come per l'NBA): {"id", "name", "status", "comment", "source"}.
Stati: "Infortunato", "Squalificato", "Indisponibile", "Assente" (esclusi dalle previsioni), "In dubbio" (solo avviso).
"""
import html
import json
import re
import time
import unicodedata
import urllib.error
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/"


def log(*a):
    print(*a, flush=True)


def plain(s):
    s = unicodedata.normalize("NFKD", html.unescape(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s).strip()


def fetch(url, as_json=True, retries=3):
    err = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json" if as_json else "text/html",
                                                       "Accept-Language": "it-IT,it;q=0.9"})
            with urllib.request.urlopen(req, timeout=40) as r:
                b = r.read().decode("utf-8", "replace")
            return json.loads(b) if as_json else b
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                return None
            err = e
        except (urllib.error.URLError, TimeoutError, ValueError, ConnectionError) as e:
            err = e
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"{url}: {err}")


# ------------------------------------------------------------ Serie A: fantacalcio.it

FC_URL = "https://www.fantacalcio.it/indisponibili-serie-a"
FC_ALIAS = {"inter": "internazionale", "milan": "ac milan", "roma": "as roma", "verona": "hellas verona", "napoli": "ssc napoli"}
DOUBT = re.compile(r"da valutare|in dubbio|tornat\w* ad allenarsi|tornat\w* in gruppo|convocabil|verso il recupero|recuperat|"
                   r"potrebbe (tornare|rientrare|esserci)|a disposizione|in gruppo|parzialmente|differenziat", re.I)


def _team_id(fc_name, teams):
    n = plain(fc_name)
    n = FC_ALIAS.get(n, n)
    for tid, t in teams.items():
        names = {plain(t.get("name")), plain(t.get("short")), plain(t.get("abbr"))}
        if n in names:
            return tid
    for tid, t in teams.items():
        if any(n and (n in x or x in n) for x in (plain(t.get("name")), plain(t.get("short"))) if x and len(x) > 2):
            return tid
    return None


def _player_id(fc_name, roster):
    """roster: [(pid, nome completo)] della squadra. 'Gonzalez N.' → cognome 'gonzalez', iniziale 'n'."""
    toks = [t for t in re.split(r"\s+", html.unescape(fc_name).strip()) if t]
    initials = [plain(t)[0] for t in toks if re.fullmatch(r"\w\.?", t, re.U) or (t.endswith(".") and len(t) <= 3)]
    words = [plain(t) for t in toks if not (re.fullmatch(r"\w\.?", t, re.U) or (t.endswith(".") and len(t) <= 3))]
    words = [w for w in words if w]
    if not words:
        return None
    cand = []
    for pid, full in roster:
        f = " " + plain(full) + " "
        if all((" " + w + " ") in f or (len(w) >= 5 and w in f) for w in words):
            cand.append((pid, plain(full)))
    if len(cand) > 1 and initials:
        cand = [c for c in cand if c[1][:1] == initials[0]] or cand
    if len(cand) > 1:   # stesso cognome: preferisco chi ha il cognome come ultima parola
        last = [c for c in cand if c[1].split()[-1] == words[-1]]
        cand = last if len(last) == 1 else cand
    return cand[0][0] if len(cand) == 1 else None


def fantacalcio_seriea(rosters, teams):
    page = fetch(FC_URL, as_json=False)
    if not page:
        raise RuntimeError("pagina non disponibile")
    by_team = {}
    for pid, r in rosters.items():
        by_team.setdefault(str(r.get("tid")), []).append((pid, r.get("name") or ""))
    out, miss_t, miss_p = [], [], []
    for card in re.split(r'<div id="team-\d+"', page)[1:]:
        m = re.search(r'class="team-name">([^<]+)<', card)
        if not m:
            continue
        tid = _team_id(m.group(1), teams)
        if not tid:
            miss_t.append(m.group(1))
            continue
        for seg in re.split(r'<strong class="label[^"]*">', card)[1:]:
            label = plain(seg.split("<", 1)[0])
            if "diffidat" in label:
                continue
            for name, desc in re.findall(r'<strong class="item-name">([^<]+)</strong>(.*?)</li>', seg, re.S):
                text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", desc))).strip()
                pid = _player_id(name, by_team.get(tid, []))
                if not pid:
                    miss_p.append(f"{name.strip()} ({m.group(1)})")
                    continue
                status = ("Squalificato" if "squalific" in label else
                          ("In dubbio" if DOUBT.search(text) else "Infortunato") if "infortun" in label else "Indisponibile")
                out.append({"id": str(pid), "name": rosters[pid].get("name"), "status": status,
                            "comment": text[:240], "source": "fantacalcio.it"})
    log(f"Indisponibili Serie A (fantacalcio.it): {len(out)} giocatori"
        + (f"; squadre non riconosciute: {miss_t}" if miss_t else "")
        + (f"; giocatori non trovati in rosa: {len(miss_p)} {miss_p[:12]}" if miss_p else ""))
    return out


# ------------------------------------------------------------ regola delle ultime partite (tutte le competizioni)

def _team_events(tid, league):
    """partite giocate dalla squadra in tutte le competizioni, dalla più recente: [(data, id, slug competizione, nome)]"""
    evs = {}
    urls = [f"{ESPN}all/teams/{tid}/schedule", f"{ESPN}{league}/teams/{tid}/schedule"]
    t = fetch(f"{ESPN}{league}/teams/{tid}") or {}
    team = t.get("team") or {}
    slug = ((team.get("defaultLeague") or {}).get("slug") or ((team.get("nextEvent") or [{}])[0].get("league") or {}).get("slug"))
    if slug and slug != league:
        urls.append(f"{ESPN}{slug}/teams/{tid}/schedule")
    for u in urls:
        d = fetch(u) or {}
        for e in d.get("events") or []:
            comp = (e.get("competitions") or [{}])[0]
            done = ((comp.get("status") or e.get("status") or {}).get("type") or {}).get("completed")
            if not done:
                continue
            lg = (e.get("league") or {}).get("slug") or (comp.get("league") or {}).get("slug") or (u.split("/soccer/")[1].split("/")[0])
            if lg == "all":
                lg = league
            evs[e["id"]] = (e.get("date") or "", e["id"], lg, (e.get("league") or {}).get("abbreviation") or e.get("shortName") or "")
    return sorted(evs.values(), reverse=True)


def _squad(summary, tid):
    """convocati della squadra nella partita: {pid: minuto in cui è uscito (se uscito), espulso}"""
    for side in summary.get("rosters") or []:
        if str((side.get("team") or {}).get("id")) != str(tid):
            continue
        sq = {}
        for p in side.get("roster") or []:
            pid = str((p.get("athlete") or {}).get("id") or "")
            if not pid:
                continue
            out_min, red = None, False
            starter = bool(p.get("starter"))
            subs = []
            for x in p.get("plays") or []:
                dv = str(((x.get("clock") or {}).get("displayValue")) or "")
                mm = re.match(r"\s*(\d+)", dv)
                if x.get("substitution") and mm:
                    subs.append(int(mm.group(1)))
                if x.get("redCard"):
                    red = True
            so = p.get("subbedOut")
            so = so.get("didSub") if isinstance(so, dict) else so
            if starter and so and subs:
                out_min = subs[0]
            sq[pid] = (out_min, red, starter)
        return sq
    return None


def recent_absences(rosters, current, league, played, names):
    """played: {pid} di chi ha giocato quest'anno nella competizione (gli altri non interessano)"""
    by_team = {}
    for pid, r in rosters.items():
        if pid in played:
            by_team.setdefault(str(r.get("tid")), []).append(pid)
    out = []
    for tid in current:
        pids = by_team.get(str(tid)) or []
        if not pids:
            continue
        try:
            evs = _team_events(tid, league)[:2]
            squads = []
            for date, eid, lg, label in evs:
                s = fetch(f"{ESPN}{lg}/summary?event={eid}") or {}
                sq = _squad(s, tid)
                if sq is not None:
                    squads.append((date[:10], label, sq))
        except RuntimeError as e:
            log("  partite della squadra", tid, e)
            continue
        if len(squads) < 2:
            continue
        when = ", ".join(f"{d[8:10]}/{d[5:7]}" + (f" {lb}" if lb else "") for d, lb, _ in squads)
        for pid in pids:
            if all(pid not in sq for _, _, sq in squads):
                out.append({"id": pid, "name": names.get(pid) or rosters[pid].get("name"), "status": "Assente",
                            "comment": f"Fuori dai convocati nelle ultime 2 partite della squadra ({when})", "source": "regola"})
                continue
            last = squads[0][2].get(pid)
            if last and last[0] is not None and last[0] <= 30 and not last[1]:
                out.append({"id": pid, "name": names.get(pid) or rosters[pid].get("name"), "status": "In dubbio",
                            "comment": f"Uscito al {last[0]}' nell'ultima partita ({squads[0][0][8:10]}/{squads[0][0][5:7]}): possibile infortunio",
                            "source": "regola"})
    log(f"Indisponibili (regola ultime partite): {sum(1 for x in out if x['status'] == 'Assente')} assenti, "
        f"{sum(1 for x in out if x['status'] == 'In dubbio')} in dubbio")
    return out
