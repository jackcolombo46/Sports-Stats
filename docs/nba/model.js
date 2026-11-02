/* Modello di proiezione delle statistiche NBA (gira nel browser).
 *
 * Per ogni statistica:
 *  1. rendimento al minuto, media pesata (recenti contano di più, stagioni passate meno)
 *  2. × minuti attesi (ultime partite di questa stagione)
 *  3. × ritmo previsto della partita
 *  4. × fattore difensivo dell'avversario (quanto concede per 100 possessi vs media NBA,
 *     ridimensionato verso la stagione scorsa a inizio stagione)
 *  5. miscelato con i precedenti diretti contro l'avversario (peso max 30%)
 * Probabilità "almeno X": binomiale negativa con la varianza osservata del giocatore.
 */
(function (root) {
  "use strict";

  const TEAMS = [
    ["ATL", "Atlanta Hawks"], ["BOS", "Boston Celtics"], ["BKN", "Brooklyn Nets"],
    ["CHA", "Charlotte Hornets"], ["CHI", "Chicago Bulls"], ["CLE", "Cleveland Cavaliers"],
    ["DAL", "Dallas Mavericks"], ["DEN", "Denver Nuggets"], ["DET", "Detroit Pistons"],
    ["GSW", "Golden State Warriors"], ["HOU", "Houston Rockets"], ["IND", "Indiana Pacers"],
    ["LAC", "LA Clippers"], ["LAL", "Los Angeles Lakers"], ["MEM", "Memphis Grizzlies"],
    ["MIA", "Miami Heat"], ["MIL", "Milwaukee Bucks"], ["MIN", "Minnesota Timberwolves"],
    ["NOP", "New Orleans Pelicans"], ["NYK", "New York Knicks"], ["OKC", "Oklahoma City Thunder"],
    ["ORL", "Orlando Magic"], ["PHI", "Philadelphia 76ers"], ["PHX", "Phoenix Suns"],
    ["POR", "Portland Trail Blazers"], ["SAC", "Sacramento Kings"], ["SAS", "San Antonio Spurs"],
    ["TOR", "Toronto Raptors"], ["UTA", "Utah Jazz"], ["WAS", "Washington Wizards"],
  ].map(([tri, name]) => ({ tri, name }));
  const TEAM = Object.fromEntries(TEAMS.map(t => [t.tri, t]));

  const STATS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "TOV"];
  const ALL_STATS = [...STATS, "PRA"];
  const LABELS = { PTS: "Punti", REB: "Rimbalzi", AST: "Assist", FG3M: "Triple", STL: "Rubate",
                   BLK: "Stoppate", TOV: "Palle perse", PRA: "Punti+Rimb+Ass" };
  const LINES = {
    PTS: [5, 10, 15, 20, 25, 30, 35, 40, 45], REB: [2, 4, 6, 8, 10, 12, 14, 16],
    AST: [2, 4, 6, 8, 10, 12, 14], FG3M: [1, 2, 3, 4, 5, 6, 7], STL: [1, 2, 3, 4],
    BLK: [1, 2, 3, 4], TOV: [1, 2, 3, 4, 5, 6], PRA: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
  };
  const SHRINK_GAMES = 12, PREV_SEASON_REGRESS = 0.5, RATE_HALF_LIFE = 20, MIN_HALF_LIFE = 4;
  const H2H_MAX_WEIGHT = 0.30, LIKELY_PROB = 0.60;
  const KEY = { PTS: "pts", REB: "reb", AST: "ast", FG3M: "fg3m", STL: "stl", BLK: "blk", TOV: "tov" };

  const norm = s => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const statVal = (g, s) => s === "PRA" ? g.pts + g.reb + g.ast : g[KEY[s]];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const r1 = x => Math.round(x * 10) / 10;
  const r3 = x => Math.round(x * 1000) / 1000;

  function probAtLeast(k, mu, v) {
    if (k <= 0) return 1;
    if (mu <= 0) return 0;
    let p, cdf;
    if (v <= mu * 1.02) {
      p = Math.exp(-mu); cdf = p;
      for (let i = 1; i < k; i++) { p *= mu / i; cdf += p; }
    } else {
      const r = mu * mu / (v - mu), q = r / (r + mu);
      p = Math.exp(r * Math.log(q)); cdf = p;
      for (let i = 1; i < k; i++) { p *= (i - 1 + r) / i * (1 - q); cdf += p; }
    }
    return clamp(1 - cdf, 0, 1);
  }

  function likelyLine(mu, v, thr = LIKELY_PROB) {
    let k = 0, best = null;
    while (k <= 200) {
      const p = probAtLeast(k + 1, mu, v);
      if (p < thr) break;
      k++; best = [k, p];
    }
    return best;
  }

  const poss = t => t.fga + 0.44 * t.fta - t.oreb + t.tov;

  function teamAggregates(logs) {
    const games = new Map();
    for (const r of logs) {
      const key = r.gid + "|" + r.tri;
      let t = games.get(key);
      if (!t) { t = { gid: r.gid, tri: r.tri, pts: 0, reb: 0, oreb: 0, ast: 0, fg3m: 0, stl: 0, blk: 0, tov: 0, fga: 0, fta: 0, min: 0 }; games.set(key, t); }
      for (const k of ["pts", "reb", "oreb", "ast", "fg3m", "stl", "blk", "tov", "fga", "fta", "min"]) t[k] += r[k];
    }
    const byGid = new Map();
    for (const t of games.values()) { if (!byGid.has(t.gid)) byGid.set(t.gid, []); byGid.get(t.gid).push(t); }
    const agg = {};
    let lgPoss = 0, lgMin = 0;
    const lgTot = Object.fromEntries(STATS.map(s => [s, 0]));
    for (const pair of byGid.values()) {
      if (pair.length !== 2) continue;
      const [a, b] = pair;
      const ps = (poss(a) + poss(b)) / 2;
      const mins = Math.max(a.min, b.min) / 5 || 48;
      if (ps <= 0) continue;
      for (const [me, op] of [[a, b], [b, a]]) {
        const g = agg[me.tri] || (agg[me.tri] = { gp: 0, poss: 0, min: 0, allowed: Object.fromEntries(STATS.map(s => [s, 0])) });
        g.gp++; g.poss += ps; g.min += mins;
        for (const s of STATS) g.allowed[s] += op[KEY[s]];
      }
      lgPoss += 2 * ps; lgMin += 2 * mins;
      for (const s of STATS) lgTot[s] += a[KEY[s]] + b[KEY[s]];
    }
    if (lgPoss <= 0) return {};
    const lgPace = lgPoss / lgMin * 48;
    const lg100 = Object.fromEntries(STATS.map(s => [s, lgTot[s] / lgPoss * 100]));
    const out = {};
    for (const [tri, g] of Object.entries(agg)) {
      out[tri] = {
        gp: g.gp, rel_pace: (g.poss / g.min * 48) / lgPace,
        f: Object.fromEntries(STATS.map(s => [s, lg100[s] ? (g.allowed[s] / g.poss * 100) / lg100[s] : 1])),
      };
    }
    return out;
  }

  class Context {
    /* bundle: {season, seasons:[newest..], logs:{season:[row]}, rosters:{pid:{tri}}, schedule:[...],
                injuries:[{id,name,status,comment}], updated_at} */
    constructor(bundle, now) {
      this.season = bundle.season;
      this.seasons = [...bundle.seasons].sort().reverse();
      this.prevSeason = this.seasons[1] || null;
      this.rosters = bundle.rosters || {};
      this.schedule = bundle.schedule || [];
      this.updatedAt = bundle.updated_at;
      this.now = now || new Date();

      this.playerLogs = new Map();
      this.names = new Map();
      for (const s of this.seasons) {
        for (const g0 of bundle.logs[s] || []) {
          const g = { ...g0, season: s };
          if (!this.playerLogs.has(g.pid)) this.playerLogs.set(g.pid, []);
          this.playerLogs.get(g.pid).push(g);
          if (!this.names.has(g.pid) && g.name) this.names.set(g.pid, g.name);
        }
      }
      for (const logs of this.playerLogs.values()) logs.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
      for (const [pid, p] of Object.entries(this.rosters)) if (!this.names.has(+pid) && p.name) this.names.set(+pid, p.name);

      this.injById = new Map(); this.injByName = new Map();
      this.setInjuries(bundle.injuries || []);

      this.teamDates = {};
      for (const g of bundle.logs[this.season] || []) (this.teamDates[g.tri] ||= new Set()).add(g.date);

      this.teamCur = teamAggregates(bundle.logs[this.season] || []);
      this.teamPrev = this.prevSeason ? teamAggregates(bundle.logs[this.prevSeason] || []) : {};
      this.teamCtx = Object.fromEntries(TEAMS.map(t => [t.tri, this._blendTeam(t.tri)]));
      this._ranks = this._computeRanks();
    }

    setInjuries(list) {
      this.injById.clear(); this.injByName.clear();
      for (const i of list) {
        if (i.id) this.injById.set(+i.id, i);
        if (i.name) this.injByName.set(norm(i.name), i);
      }
    }
    injury(pid) { return this.injById.get(pid) || this.injByName.get(norm(this.names.get(pid))) || null; }

    _blendTeam(tri) {
      const cur = this.teamCur[tri], prev = this.teamPrev[tri];
      const gp = cur ? cur.gp : 0, w = gp / (gp + SHRINK_GAMES);
      const f = {};
      for (const s of STATS) {
        const fp = prev ? 1 + PREV_SEASON_REGRESS * (prev.f[s] - 1) : 1;
        const fc = cur ? cur.f[s] : 1;
        f[s] = clamp(w * fc + (1 - w) * fp, 0.75, 1.25);
      }
      const pp = prev ? 1 + PREV_SEASON_REGRESS * (prev.rel_pace - 1) : 1;
      const pc = cur ? cur.rel_pace : 1;
      return { gp, f, rel_pace: w * pc + (1 - w) * pp };
    }

    _computeRanks() {
      const ranks = {};
      for (const s of STATS) {
        [...TEAMS].sort((a, b) => this.teamCtx[b.tri].f[s] - this.teamCtx[a.tri].f[s])
          .forEach((t, i) => ranks[t.tri + "|" + s] = i + 1);
      }
      [...TEAMS].sort((a, b) => this.teamCtx[b.tri].rel_pace - this.teamCtx[a.tri].rel_pace)
        .forEach((t, i) => ranks[t.tri + "|PACE"] = i + 1);
      return ranks;
    }

    opponentProfile(tri) {
      const c = this.teamCtx[tri];
      return {
        team: TEAM[tri], games: c.gp,
        pace: { rel: r3(c.rel_pace), rank: this._ranks[tri + "|PACE"] },
        allowed: STATS.map(s => ({ stat: s, label: LABELS[s], factor: r3(c.f[s]), rank: this._ranks[tri + "|" + s] })),
      };
    }

    playerTeam(pid) {
      const r = this.rosters[String(pid)];
      if (r && TEAM[r.tri]) return r.tri;
      const logs = this.playerLogs.get(pid);
      if (!logs || !logs.length) return null;
      // con le rose disponibili, chi non è in nessuna rosa e non ha giocato quest'anno è fuori dalla NBA
      if (Object.keys(this.rosters).length && logs[0].season !== this.season) return null;
      return logs[0].tri;
    }

    searchPlayers(q, limit = 10) {
      const nq = norm(q);
      if (!nq) return [];
      const res = [];
      for (const [pid, name] of this.names) {
        const nn = norm(name);
        if (!nn.includes(nq)) continue;
        const tri = this.playerTeam(pid);
        if (!tri) continue;
        const cur = (this.playerLogs.get(pid) || []).filter(g => g.season === this.season).length;
        res.push({ score: [nn.startsWith(nq) || nn.includes(" " + nq) ? 0 : 1, -cur, name],
                   item: { id: pid, name, team: tri, games: cur } });
      }
      res.sort((a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1] || a.score[2].localeCompare(b.score[2]));
      return res.slice(0, limit).map(r => r.item);
    }

    teamPlayers(tri) { return [...this.names.keys()].filter(pid => this.playerTeam(pid) === tri); }

    nextGame(tri) {
      let best = null;
      for (const g of this.schedule) {
        if (g.home !== tri && g.away !== tri) continue;
        if (g.stype != null && g.stype !== 2 && g.stype !== 3 && g.stype !== 5) continue;
        const t = new Date(g.utc);
        if (isNaN(t) || t < new Date(this.now - 4 * 3600e3)) continue;
        if (!best || t < best.t) best = { t, g };
      }
      if (!best) return null;
      const home = best.g.home === tri;
      return { id: best.g.id, utc: best.t.toISOString(), home, opp: home ? best.g.away : best.g.home,
               team: tri, live: best.g.state === "in" };
    }

    project(pid, opp, home = null) {
      const logs = (this.playerLogs.get(pid) || []).filter(g => g.min > 0);
      const tri = this.playerTeam(pid);
      if (!logs.length || !tri || !TEAM[opp]) return null;
      const cur = logs.filter(g => g.season === this.season);
      const prev = logs.filter(g => g.season === this.prevSeason);

      const num = Object.fromEntries(ALL_STATS.map(s => [s, 0]));
      let den = 0;
      logs.slice(0, 120).forEach((g, i) => {
        const sw = g.season === this.season ? 1 : g.season === this.prevSeason ? 0.6 : 0.3;
        const w = sw * Math.pow(0.5, i / RATE_HALF_LIFE);
        for (const s of ALL_STATS) num[s] += w * statVal(g, s);
        den += w * g.min;
      });
      const rate = Object.fromEntries(ALL_STATS.map(s => [s, num[s] / den]));

      const wmean = (games, hl) => {
        let sw = 0, sm = 0;
        games.forEach((g, i) => { const w = Math.pow(0.5, i / hl); sw += w; sm += w * g.min; });
        return sm / sw;
      };
      let minutes;
      const mCur = cur.length ? wmean(cur.slice(0, 10), MIN_HALF_LIFE) : null;
      if (cur.length >= 5 || !prev.length) minutes = cur.length ? mCur : wmean(logs.slice(0, 10), MIN_HALF_LIFE);
      else {
        const mPrev = prev.reduce((a, g) => a + g.min, 0) / prev.length;
        minutes = cur.length ? (cur.length * mCur + (5 - cur.length) * mPrev) / 5 : mPrev;
      }

      const own = this.teamCtx[tri], op = this.teamCtx[opp];
      const paceF = clamp((own.rel_pace + op.rel_pace - 1) / own.rel_pace, 0.9, 1.1);

      const h2h = logs.filter(g => g.opp === opp);
      const h2hMin = h2h.reduce((a, g) => a + g.min, 0);
      const last10 = logs.slice(0, 10), sample = logs.slice(0, 40);

      const warnings = [];
      let missed = 0;
      const dates = this.teamDates[tri] || new Set();
      if (cur.length) {
        for (const d of dates) if (d > cur[0].date) missed++;
        if (missed >= 2) warnings.push(`Non gioca da ${missed} partite della squadra.`);
      } else if (dates.size) {
        missed = dates.size;
        warnings.push("Nessuna partita giocata in questa stagione: proiezione basata sulla stagione scorsa.");
      }
      if (logs[0].tri !== tri) warnings.push(`Ha cambiato squadra (prima ${logs[0].tri}): il ruolo potrebbe essere diverso.`);
      if (cur.length < 5) warnings.push(`Solo ${cur.length} partite in questa stagione: dati ancora poco stabili.`);
      const inj = this.injury(pid);
      if (inj) warnings.unshift(`Infortuni: ${inj.status || "in lista"}${inj.comment ? " – " + inj.comment : ""}`);

      const proj = {}, stats = [];
      const avg = (arr, s) => arr.reduce((a, g) => a + statVal(g, s), 0) / arr.length;
      for (const s of ALL_STATS) {
        const base = rate[s] * minutes * paceF;
        const muModel = s === "PRA" ? proj.PTS.model + proj.REB.model + proj.AST.model : base * op.f[s];
        let mu = muModel, h2hAvg = null;
        if (h2h.length && h2hMin > 0) {
          const h2hRate = h2h.reduce((a, g) => a + statVal(g, s), 0) / h2hMin;
          const w = Math.min(H2H_MAX_WEIGHT, h2h.length / (h2h.length + 15));
          mu = (1 - w) * muModel + w * h2hRate * minutes * paceF;
          h2hAvg = avg(h2h, s);
        }
        if (s === "PRA") mu = proj.PTS.mu + proj.REB.mu + proj.AST.mu;
        proj[s] = { model: muModel, mu };

        const vals = sample.map(g => statVal(g, s));
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const varRaw = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, vals.length - 1);
        const phi = mean > 0 ? clamp(varRaw / mean, 1, 5) : 1;
        const v = phi * mu;

        const lines = [];
        for (const L of LINES[s]) {
          const p = probAtLeast(L, mu, v);
          if (p >= 0.02 && p <= 0.98) lines.push({
            line: L, prob: r3(p),
            l10: [last10.filter(g => statVal(g, s) >= L).length, last10.length],
            h2h: [h2h.filter(g => statVal(g, s) >= L).length, h2h.length],
          });
        }
        const ll = likelyLine(mu, v);
        stats.push({
          stat: s, label: LABELS[s], proj: r1(mu),
          season_avg: cur.length ? r1(avg(cur, s)) : null,
          prev_avg: prev.length ? r1(avg(prev, s)) : null,
          l10_avg: r1(avg(last10, s)),
          h2h_avg: h2hAvg != null ? r1(h2hAvg) : null,
          opp_factor: s !== "PRA" ? r3(op.f[s]) : null,
          opp_rank: s !== "PRA" ? this._ranks[opp + "|" + s] : null,
          likely: ll ? { line: ll[0], prob: r3(ll[1]) } : null,
          lines,
        });
      }
      return {
        player: { id: pid, name: this.names.get(pid), team: TEAM[tri] },
        opponent: TEAM[opp], home,
        minutes: r1(minutes), pace_factor: r3(paceF),
        games: { season: cur.length, prev: prev.length, h2h: h2h.length },
        h2h_games: h2h.slice(0, 6).map(g => ({ date: g.date, pts: g.pts, reb: g.reb, ast: g.ast, fg3m: g.fg3m, min: Math.round(g.min) })),
        recent: last10.map(g => ({ date: g.date, opp: g.opp, home: !!g.home, pts: g.pts, reb: g.reb, ast: g.ast, fg3m: g.fg3m, min: Math.round(g.min) })),
        missed, injury: inj, warnings, stats,
      };
    }

    projectTeam(tri, opp, home = null, minMinutes = 10) {
      const out = [], absent = [];
      const hasCur = (this.teamDates[tri] || new Set()).size > 0;
      for (const pid of this.teamPlayers(tri)) {
        const p = this.project(pid, opp, home);
        if (!p) continue;
        const out_ = p.injury && /^(out|suspension)/i.test(p.injury.status || "");
        if (out_ || p.missed >= 3 || (p.games.season === 0 && hasCur)) {
          absent.push({ id: pid, name: p.player.name, reason: out_ ? p.injury.status : p.games.season === 0 ? "nessuna partita quest'anno" : `assente da ${p.missed} partite` });
          continue;
        }
        if (p.minutes < minMinutes) continue;
        out.push(p);
      }
      out.sort((a, b) => b.minutes - a.minutes);
      const st = (p, s) => p.stats.find(x => x.stat === s);
      const leaders = ALL_STATS.map(s => ({
        stat: s, label: LABELS[s],
        players: [...out].sort((a, b) => st(b, s).proj - st(a, s).proj).slice(0, 5)
          .map(p => ({ id: p.player.id, name: p.player.name, proj: st(p, s).proj, likely: st(p, s).likely })),
      }));
      return { team: TEAM[tri], opponent: TEAM[opp], players: out, leaders, absent };
    }
  }

  /* Converte i file {cols, names, rows} in righe-oggetto */
  function decodeLogFile(f) {
    const ix = Object.fromEntries(f.cols.map((c, i) => [c, i]));
    return f.rows.map(r => {
      const o = {};
      for (const c of f.cols) o[c] = r[ix[c]];
      o.name = f.names[String(o.pid)];
      return o;
    });
  }

  const api = { Context, TEAMS, TEAM, STATS, ALL_STATS, LABELS, probAtLeast, likelyLine, decodeLogFile, norm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NBAModel = api;
})(typeof window !== "undefined" ? window : globalThis);
