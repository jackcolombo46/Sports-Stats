/* Modello di proiezione delle statistiche dei calciatori di Serie A (gira nel browser).
 *
 * Per ogni statistica del giocatore:
 *  1. rendimento ogni 90 minuti, media pesata (partite recenti contano di più, stagioni passate meno)
 *  2. × minuti attesi (ultime presenze di questa stagione)
 *  3. × fattore avversario: quanto l'avversario concede di quella statistica rispetto alla media
 *     del campionato (ridimensionato verso la stagione scorsa a inizio stagione)
 *  4. × fattore casa/trasferta (calcolato sui dati del campionato)
 *  5. miscelato con i precedenti diretti contro l'avversario (peso max 25%)
 * Probabilità "almeno X": Poisson / binomiale negativa con la varianza osservata del giocatore.
 *
 * Per la partita: gol attesi delle due squadre (attacco × difesa avversaria × casa/trasferta),
 * da cui probabilità 1-X-2 e clean sheet (Poisson).
 *
 * La parte specifica del calcio è in SPORT: per un altro sport basta cambiare quella.
 */
(function (root) {
  "use strict";

  const SPORT = {
    name: "Serie A",
    stats: ["GOL", "AST", "SH", "SOT", "FC", "FS", "YC", "SV"],
    derived: { GA: ["GOL", "AST"] },
    labels: { GOL: "Gol", AST: "Assist", GA: "Gol + assist", SH: "Tiri", SOT: "Tiri in porta",
              FC: "Falli commessi", FS: "Falli subiti", YC: "Ammonizione", SV: "Parate" },
    short: { GOL: "Gol", AST: "As", GA: "G+A", SH: "Tiri", SOT: "In porta", FC: "Falli", FS: "F.sub", YC: "Amm", SV: "Par" },
    key: { GOL: "gol", AST: "ast", SH: "sh", SOT: "sot", FC: "fc", FS: "fs", YC: "yc", SV: "sv" },
    lines: { GOL: [1, 2, 3], AST: [1, 2], GA: [1, 2, 3], SH: [1, 2, 3, 4, 5, 6], SOT: [1, 2, 3, 4],
             FC: [1, 2, 3, 4], FS: [1, 2, 3, 4, 5], YC: [1], SV: [1, 2, 3, 4, 5, 6, 7] },
    outfield: ["GOL", "AST", "GA", "SH", "SOT", "FC", "FS", "YC"],
    keeper: ["SV", "FC", "YC"],
    full: 90,
    // ammonizioni che fanno scattare la squalifica in Serie A (5ª, 10ª, 14ª, 17ª, poi ogni 2)
    suspendAt: n => n === 5 || n === 10 || n === 14 || (n >= 17 && (n - 17) % 2 === 0),
  };
  const STATS = SPORT.stats;
  const ALL_STATS = [...STATS, ...Object.keys(SPORT.derived)];
  const LABELS = SPORT.labels;

  const SHRINK_GAMES = 8, PREV_SEASON_REGRESS = 0.5, RATE_HALF_LIFE = 15, MIN_HALF_LIFE = 3;
  const PRIOR_MIN = 300, H2H_MAX_WEIGHT = 0.25, LIKELY_PROB = 0.60, MAX_GOALS = 10;

  const norm = s => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const statVal = (g, s) => SPORT.derived[s] ? SPORT.derived[s].reduce((a, k) => a + g[SPORT.key[k]], 0) : g[SPORT.key[s]];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const r1 = x => Math.round(x * 10) / 10;
  const r2 = x => Math.round(x * 100) / 100;
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
    while (k <= 50) {
      const p = probAtLeast(k + 1, mu, v);
      if (p < thr) break;
      k++; best = [k, p];
    }
    return best;
  }

  const poisson = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };

  /* Esito della partita da due medie gol (Poisson indipendenti). */
  function matchOdds(lh, la) {
    let h = 0, d = 0, a = 0, over = 0, btts = 0;
    for (let i = 0; i <= MAX_GOALS; i++) for (let j = 0; j <= MAX_GOALS; j++) {
      const p = poisson(i, lh) * poisson(j, la);
      if (i > j) h += p; else if (i === j) d += p; else a += p;
      if (i + j >= 3) over += p;
      if (i > 0 && j > 0) btts += p;
    }
    const t = h + d + a;
    return { home: r3(h / t), draw: r3(d / t), away: r3(a / t), over25: r3(over), btts: r3(btts),
             cs_home: r3(Math.exp(-la)), cs_away: r3(Math.exp(-lh)) };
  }

  /* Quanto concede ogni squadra (statistiche fatte dagli avversari) rispetto alla media del campionato,
     più gol fatti/subiti a partita e vantaggio del fattore campo. */
  function teamAggregates(logs, games) {
    const sums = new Map();
    for (const r of logs) {
      const key = r.gid + "|" + r.tid;
      let t = sums.get(key);
      if (!t) { t = { gid: r.gid, tid: r.tid, home: r.home }; for (const s of STATS) t[s] = 0; sums.set(key, t); }
      for (const s of STATS) t[s] += r[SPORT.key[s]];
    }
    const byGid = new Map();
    for (const t of sums.values()) { if (!byGid.has(t.gid)) byGid.set(t.gid, []); byGid.get(t.gid).push(t); }
    const agg = {}, lg = Object.fromEntries(STATS.map(s => [s, 0])), ha = Object.fromEntries(STATS.map(s => [s, [0, 0]]));
    let lgN = 0;
    for (const pair of byGid.values()) {
      if (pair.length !== 2) continue;
      for (const [me, op] of [[pair[0], pair[1]], [pair[1], pair[0]]]) {
        const g = agg[me.tid] || (agg[me.tid] = { gp: 0, allowed: Object.fromEntries(STATS.map(s => [s, 0])) });
        g.gp++;
        for (const s of STATS) { g.allowed[s] += op[s]; lg[s] += op[s]; ha[s][op.home ? 0 : 1] += op[s]; }
        lgN++;
      }
    }
    const out = { teams: {}, home: {} };
    for (const s of STATS) {
      const [h, a] = ha[s];
      out.home[s] = h > 0 && a > 0 ? clamp(Math.sqrt(h / a), 0.85, 1.15) : 1;
    }
    for (const [tid, g] of Object.entries(agg)) {
      out.teams[tid] = { gp: g.gp, f: Object.fromEntries(STATS.map(s => [s, lg[s] ? (g.allowed[s] / g.gp) / (lg[s] / lgN) : 1])) };
    }
    // gol dai risultati
    let gh = 0, ga = 0, n = 0;
    const gl = {};
    for (const g of games) {
      if (g.hg == null || g.ag == null) continue;
      gh += g.hg; ga += g.ag; n++;
      for (const [tid, f, a] of [[g.home, g.hg, g.ag], [g.away, g.ag, g.hg]]) {
        const x = gl[tid] || (gl[tid] = { gp: 0, gf: 0, ga: 0 }); x.gp++; x.gf += f; x.ga += a;
      }
    }
    out.goals = { avg: n ? (gh + ga) / (2 * n) : 1.35, home_adv: n && ga ? clamp(Math.sqrt(gh / ga), 0.9, 1.2) : 1.1, teams: gl };
    return out;
  }

  class Context {
    /* bundle: {season, seasons, logs:{season:[row]}, games:{season:[game]}, teams:{tid:{abbr,name,short}},
                current_teams:[tid], rosters:{pid:{tid,pos}}, schedule:[...], injuries:[...], updated_at} */
    constructor(bundle, now) {
      this.season = bundle.season;
      this.seasons = [...bundle.seasons].sort().reverse();
      this.prevSeason = this.seasons[1] || null;
      this.rosters = bundle.rosters || {};
      this.schedule = bundle.schedule || [];
      this.updatedAt = bundle.updated_at;
      this.now = now || new Date();

      const allTeams = bundle.teams || {};
      let cur = bundle.current_teams && bundle.current_teams.length ? bundle.current_teams : null;
      if (!cur) {
        const s = new Set();
        for (const g of (bundle.games || {})[this.season] || []) { s.add(g.home); s.add(g.away); }
        for (const g of this.schedule) { s.add(g.home); s.add(g.away); }
        cur = [...s];
      }
      this.TEAM = {};
      for (const [tid, t] of Object.entries(allTeams)) this.TEAM[tid] = { tid, abbr: t.abbr || tid, name: t.name || t.abbr || tid, short: t.short || t.name || tid };
      this.TEAMS = cur.filter(t => this.TEAM[t]).map(t => this.TEAM[t]).sort((a, b) => a.name.localeCompare(b.name));
      this.current = new Set(this.TEAMS.map(t => t.tid));

      this.playerLogs = new Map();
      this.names = new Map();
      for (const s of this.seasons) {
        for (const g0 of (bundle.logs || {})[s] || []) {
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

      const curGames = (bundle.games || {})[this.season] || [];
      this.games = curGames;
      this.teamDates = {};
      for (const g of curGames) { (this.teamDates[g.home] ||= new Set()).add(g.date); (this.teamDates[g.away] ||= new Set()).add(g.date); }

      this.aggCur = teamAggregates((bundle.logs || {})[this.season] || [], curGames);
      this.aggPrev = this.prevSeason ? teamAggregates((bundle.logs || {})[this.prevSeason] || [], (bundle.games || {})[this.prevSeason] || []) : null;
      this.homeF = {};
      for (const s of STATS) {
        const n = this.aggCur.teams && Object.keys(this.aggCur.teams).length;
        this.homeF[s] = n >= 10 || !this.aggPrev ? this.aggCur.home[s] : this.aggPrev.home[s];
      }
      // media del campionato ogni minuto, per ruolo (serve a stabilizzare chi ha giocato poco)
      this.leagueRate = { gk: {}, out: {} };
      for (const role of ["gk", "out"]) {
        const rows = [this.season, this.prevSeason].flatMap(s => (bundle.logs || {})[s] || []).filter(r => (role === "gk") === !!r.gk);
        const mins = rows.reduce((a, r) => a + r.min, 0);
        for (const s of ALL_STATS) this.leagueRate[role][s] = mins ? rows.reduce((a, r) => a + statVal(r, s), 0) / mins : 0;
      }
      this.teamCtx = Object.fromEntries(Object.keys(this.TEAM).map(t => [t, this._blendTeam(t)]));
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

    _blendTeam(tid) {
      const cur = this.aggCur.teams[tid], prev = this.aggPrev && this.aggPrev.teams[tid];
      const gp = cur ? cur.gp : 0, w = gp / (gp + SHRINK_GAMES);
      const f = {};
      for (const s of STATS) {
        const fp = prev ? 1 + PREV_SEASON_REGRESS * (prev.f[s] - 1) : 1;
        const fc = cur ? cur.f[s] : 1;
        f[s] = clamp(w * fc + (1 - w) * fp, 0.7, 1.4);
      }
      // attacco e difesa: gol fatti/subiti a partita rispetto alla media
      const gC = this.aggCur.goals, gP = this.aggPrev && this.aggPrev.goals;
      const rel = (G, k) => { const t = G && G.teams[tid]; return t && t.gp ? (t[k] / t.gp) / G.avg : null; };
      const mix = k => {
        const c = rel(gC, k), p = rel(gP, k);
        const pp = p != null ? 1 + PREV_SEASON_REGRESS * (p - 1) : (gP ? (k === "gf" ? 0.85 : 1.15) : 1); // neopromosse
        const wg = (gC.teams[tid] ? gC.teams[tid].gp : 0) / ((gC.teams[tid] ? gC.teams[tid].gp : 0) + SHRINK_GAMES);
        return clamp(c != null ? wg * c + (1 - wg) * pp : pp, 0.4, 2.2);
      };
      return { gp, f, att: mix("gf"), def: mix("ga") };
    }

    _computeRanks() {
      const ranks = {};
      for (const s of STATS) {
        [...this.TEAMS].sort((a, b) => this.teamCtx[b.tid].f[s] - this.teamCtx[a.tid].f[s])
          .forEach((t, i) => ranks[t.tid + "|" + s] = i + 1);
      }
      [...this.TEAMS].sort((a, b) => this.teamCtx[b.tid].def - this.teamCtx[a.tid].def)
        .forEach((t, i) => ranks[t.tid + "|GA"] = i + 1);
      return ranks;
    }

    /* Gol attesi e probabilità 1-X-2. home: true se tid gioca in casa, null se non si sa. */
    matchup(tid, opp, home = null) {
      const a = this.teamCtx[tid], b = this.teamCtx[opp];
      const G = Object.keys(this.aggCur.goals.teams).length >= 10 || !this.aggPrev ? this.aggCur.goals : this.aggPrev.goals;
      const avg = G.avg || 1.35, ha = G.home_adv || 1.1;
      const hf = home == null ? 1 : home ? ha : 1 / ha;
      const lt = avg * a.att * b.def * hf, lo = avg * b.att * a.def / hf;
      const o = matchOdds(lt, lo);
      return { xg: r2(lt), xg_opp: r2(lo), win: o.home, draw: o.draw, loss: o.away, over25: o.over25, btts: o.btts,
               clean_sheet: o.cs_home, clean_sheet_opp: o.cs_away };
    }

    opponentProfile(tid) {
      const c = this.teamCtx[tid];
      const show = ["SH", "SOT", "FC", "FS", "YC"];
      return {
        team: this.TEAM[tid], games: c.gp,
        goals: { factor: r3(c.def), rank: this._ranks[tid + "|GA"] },
        allowed: show.map(s => ({ stat: s, label: LABELS[s], factor: r3(c.f[s]), rank: this._ranks[tid + "|" + s] })),
      };
    }

    isKeeper(pid) {
      const r = this.rosters[String(pid)];
      if (r && r.pos) return /^(G|GK)$/i.test(r.pos);
      const logs = this.playerLogs.get(pid) || [];
      return logs.length > 0 && logs.slice(0, 10).filter(g => g.gk).length > logs.slice(0, 10).length / 2;
    }

    playerTeam(pid) {
      const r = this.rosters[String(pid)];
      if (r && this.current.has(r.tid)) return r.tid;
      const logs = this.playerLogs.get(pid);
      if (!logs || !logs.length) return null;
      if (Object.keys(this.rosters).length && logs[0].season !== this.season) return null;
      return this.current.has(logs[0].tid) ? logs[0].tid : null;
    }

    searchPlayers(q, limit = 10) {
      const nq = norm(q);
      if (!nq) return [];
      const res = [];
      for (const [pid, name] of this.names) {
        const nn = norm(name);
        if (!nn.includes(nq)) continue;
        const tid = this.playerTeam(pid);
        if (!tid) continue;
        const cur = (this.playerLogs.get(pid) || []).filter(g => g.season === this.season).length;
        res.push({ score: [nn.startsWith(nq) || nn.includes(" " + nq) ? 0 : 1, -cur, name],
                   item: { id: pid, name, team: tid, abbr: this.TEAM[tid].abbr, games: cur } });
      }
      res.sort((a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1] || a.score[2].localeCompare(b.score[2]));
      return res.slice(0, limit).map(r => r.item);
    }

    teamPlayers(tid) { return [...this.names.keys()].filter(pid => this.playerTeam(pid) === tid); }

    nextGame(tid) {
      let best = null;
      for (const g of this.schedule) {
        if (g.home !== tid && g.away !== tid) continue;
        const t = new Date(g.utc);
        if (isNaN(t) || t < new Date(this.now - 3 * 3600e3)) continue;
        if (!best || t < best.t) best = { t, g };
      }
      if (!best) return null;
      const home = best.g.home === tid;
      return { id: best.g.id, utc: best.t.toISOString(), home, opp: home ? best.g.away : best.g.home,
               team: tid, live: best.g.state === "in" };
    }

    seasonCards(pid) {
      return (this.playerLogs.get(pid) || []).filter(g => g.season === this.season).reduce((a, g) => a + g.yc, 0);
    }

    project(pid, opp, home = null) {
      const logs = (this.playerLogs.get(pid) || []).filter(g => g.min > 0);
      const tid = this.playerTeam(pid);
      if (!logs.length || !tid || !this.TEAM[opp]) return null;
      const cur = logs.filter(g => g.season === this.season);
      const prev = logs.filter(g => g.season === this.prevSeason);
      const keeper = this.isKeeper(pid);

      // rendimento ogni 90'
      const num = Object.fromEntries(ALL_STATS.map(s => [s, 0]));
      let den = 0;
      logs.slice(0, 80).forEach((g, i) => {
        const sw = g.season === this.season ? 1 : g.season === this.prevSeason ? 0.6 : 0.3;
        const w = sw * Math.pow(0.5, i / RATE_HALF_LIFE);
        for (const s of ALL_STATS) num[s] += w * statVal(g, s);
        den += w * g.min;
      });
      // pochi minuti: il rendimento viene tirato verso la media del campionato per il ruolo
      const lr = this.leagueRate[keeper ? "gk" : "out"];
      const rate = Object.fromEntries(ALL_STATS.map(s => [s, (num[s] + PRIOR_MIN * lr[s]) / (den + PRIOR_MIN)]));

      const wmean = (games, hl) => {
        let sw = 0, sm = 0;
        games.forEach((g, i) => { const w = Math.pow(0.5, i / hl); sw += w; sm += w * g.min; });
        return sm / sw;
      };
      let minutes;
      const mCur = cur.length ? wmean(cur.slice(0, 6), MIN_HALF_LIFE) : null;
      if (cur.length >= 4 || !prev.length) minutes = cur.length ? mCur : wmean(logs.slice(0, 6), MIN_HALF_LIFE);
      else {
        const mPrev = prev.reduce((a, g) => a + g.min, 0) / prev.length;
        minutes = cur.length ? (cur.length * mCur + (4 - cur.length) * mPrev) / 4 : mPrev;
      }
      minutes = clamp(minutes, 1, SPORT.full);
      const starts5 = cur.slice(0, 5).filter(g => g.start).length;

      const op = this.teamCtx[opp];
      const m = this.matchup(tid, opp, home);
      const h2h = logs.filter(g => g.opp === opp);
      const h2hMin = h2h.reduce((a, g) => a + g.min, 0);
      const last10 = logs.slice(0, 10), sample = logs.slice(0, 30);

      const warnings = [];
      let missed = 0;
      const dates = this.teamDates[tid] || new Set();
      if (cur.length) {
        for (const d of dates) if (d > cur[0].date) missed++;
        if (missed >= 2) warnings.push(`Non gioca da ${missed} partite della squadra.`);
      } else if (dates.size) {
        missed = dates.size;
        warnings.push("Nessuna presenza in questa stagione: proiezione basata sulla stagione scorsa.");
      }
      if (logs[0].tid !== tid) warnings.push(`Ha cambiato squadra (prima ${this.TEAM[logs[0].tid] ? this.TEAM[logs[0].tid].name : "altra squadra"}): il ruolo potrebbe essere diverso.`);
      if (cur.length && cur.length < 4) warnings.push(`Solo ${cur.length} presenze in questa stagione: dati ancora poco stabili.`);
      if (cur.length && starts5 <= 1 && cur.length >= 3) warnings.push("Entra spesso dalla panchina: i minuti sono incerti.");
      const yc = this.seasonCards(pid);
      let suspended = false;
      if (cur.length && missed === 0) {
        if (cur[0].rc > 0) { warnings.unshift("Espulso nell'ultima partita: probabilmente squalificato."); suspended = true; }
        else if (cur[0].yc > 0 && SPORT.suspendAt(yc)) { warnings.unshift(`Ha raggiunto ${yc} ammonizioni nell'ultima partita: probabilmente squalificato.`); suspended = true; }
      }
      if (!suspended && SPORT.suspendAt(yc + 1)) warnings.push(`Diffidato (${yc} ammonizioni): con un altro giallo salta la partita successiva.`);
      const inj = this.injury(pid);
      if (inj) warnings.unshift(`Infortunio: ${inj.status || "in lista"}${inj.comment ? " – " + inj.comment : ""}`);

      const proj = {}, stats = [];
      const avg = (arr, s) => arr.reduce((a, g) => a + statVal(g, s), 0) / arr.length;
      const shown = keeper ? SPORT.keeper : SPORT.outfield;
      for (const s of ALL_STATS) {
        let muModel, mu, h2hAvg = null;
        if (SPORT.derived[s]) {
          muModel = SPORT.derived[s].reduce((a, k) => a + proj[k].model, 0);
          mu = SPORT.derived[s].reduce((a, k) => a + proj[k].mu, 0);
        } else {
          const hf = home == null ? 1 : home ? this.homeF[s] : 1 / this.homeF[s];
          // i gol seguono i gol attesi della squadra più che i "gol concessi" generici
          const of = s === "GOL" || s === "AST" ? op.def : op.f[s];
          muModel = rate[s] * minutes * of * hf;
          mu = muModel;
          if (h2h.length && h2hMin > 0) {
            const h2hRate = h2h.reduce((a, g) => a + statVal(g, s), 0) / Math.max(h2hMin, 270);
            const w = Math.min(H2H_MAX_WEIGHT, h2h.length / (h2h.length + 10));
            mu = (1 - w) * muModel + w * h2hRate * minutes * hf;
            h2hAvg = avg(h2h, s);
          }
        }
        if (SPORT.derived[s] && h2h.length) h2hAvg = avg(h2h, s);
        proj[s] = { model: muModel, mu };
        if (!shown.includes(s)) continue;

        const vals = sample.map(g => statVal(g, s));
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const varRaw = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, vals.length - 1);
        const phi = mean > 0 ? clamp(varRaw / mean, 1, 3) : 1;
        const v = phi * mu;

        const lines = [];
        for (const L of SPORT.lines[s]) {
          const p = probAtLeast(L, mu, v);
          if (p >= 0.01 && p <= 0.99) lines.push({
            line: L, prob: r3(p),
            l10: [last10.filter(g => statVal(g, s) >= L).length, last10.length],
            h2h: [h2h.filter(g => statVal(g, s) >= L).length, h2h.length],
          });
        }
        const ll = likelyLine(mu, v);
        stats.push({
          stat: s, label: LABELS[s], proj: r2(mu), p1: r3(probAtLeast(1, mu, v)),
          season_avg: cur.length ? r2(avg(cur, s)) : null,
          prev_avg: prev.length ? r2(avg(prev, s)) : null,
          l10_avg: r2(avg(last10, s)),
          h2h_avg: h2hAvg != null ? r2(h2hAvg) : null,
          season_tot: cur.length ? cur.reduce((a, g) => a + statVal(g, s), 0) : null,
          opp_factor: !SPORT.derived[s] ? r3(s === "GOL" || s === "AST" ? op.def : op.f[s]) : null,
          likely: ll ? { line: ll[0], prob: r3(ll[1]) } : null,
          lines,
        });
      }
      if (keeper) stats.unshift({ stat: "CS", label: "Porta inviolata", proj: null, p1: m.clean_sheet,
                                   season_avg: null, prev_avg: null, l10_avg: null, h2h_avg: null, lines: [], likely: null,
                                   season_tot: cur.filter(g => g.gc === 0 && g.min >= 60).length, xg_opp: m.xg_opp });
      return {
        player: { id: pid, name: this.names.get(pid), team: this.TEAM[tid], keeper },
        opponent: this.TEAM[opp], home, match: m,
        minutes: Math.round(minutes), starts5, yc,
        games: { season: cur.length, prev: prev.length, h2h: h2h.length },
        h2h_games: h2h.slice(0, 6).map(g => ({ date: g.date, min: g.min, gol: g.gol, ast: g.ast, sh: g.sh, sot: g.sot, yc: g.yc, sv: g.sv })),
        recent: last10.map(g => ({ date: g.date, opp: g.opp, home: !!g.home, min: g.min, start: !!g.start, gol: g.gol, ast: g.ast, sh: g.sh, sot: g.sot, fc: g.fc, yc: g.yc, rc: g.rc, sv: g.sv, gc: g.gc })),
        missed, injury: inj, suspended, warnings, stats,
      };
    }

    projectTeam(tid, opp, home = null, minMinutes = 25) {
      const out = [], absent = [];
      const hasCur = (this.teamDates[tid] || new Set()).size > 0;
      for (const pid of this.teamPlayers(tid)) {
        const p = this.project(pid, opp, home);
        if (!p) continue;
        const out_ = p.injury && /^(out|suspension|injured|infortun)/i.test(p.injury.status || "");
        if (out_ || p.suspended || p.missed >= 3 || (p.games.season === 0 && hasCur)) {
          absent.push({ id: pid, name: p.player.name,
                        reason: out_ ? p.injury.status : p.suspended ? "probabile squalifica" : p.games.season === 0 ? "nessuna presenza quest'anno" : `assente da ${p.missed} partite` });
          continue;
        }
        if (p.minutes < minMinutes) continue;
        out.push(p);
      }
      out.sort((a, b) => (a.player.keeper - b.player.keeper) || b.minutes - a.minutes);
      const st = (p, s) => p.stats.find(x => x.stat === s);
      const leaders = ["GOL", "AST", "SH", "SOT", "FS", "YC", "SV"].map(s => ({
        stat: s, label: s === "GOL" ? "Marcatore" : s === "YC" ? "Ammonizione" : LABELS[s],
        players: out.filter(p => st(p, s)).sort((a, b) => st(b, s).proj - st(a, s).proj).slice(0, 5)
          .map(p => ({ id: p.player.id, name: p.player.name, proj: st(p, s).proj, p1: st(p, s).p1, likely: st(p, s).likely })),
      })).filter(l => l.players.length);
      return { team: this.TEAM[tid], opponent: this.TEAM[opp], match: this.matchup(tid, opp, home), players: out, leaders, absent };
    }

    /* Classifica dai risultati della stagione in corso. */
    standings() {
      const t = {};
      for (const tid of this.current) t[tid] = { team: this.TEAM[tid], gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] };
      const games = [...this.games].sort((a, b) => a.date < b.date ? -1 : 1);
      for (const g of games) {
        if (g.hg == null || g.ag == null) continue;
        for (const [me, f, a] of [[g.home, g.hg, g.ag], [g.away, g.ag, g.hg]]) {
          const x = t[me]; if (!x) continue;
          x.gp++; x.gf += f; x.ga += a;
          const r = f > a ? "V" : f === a ? "N" : "P";
          if (r === "V") { x.w++; x.pts += 3; } else if (r === "N") { x.d++; x.pts += 1; } else x.l++;
          x.form.push(r);
        }
      }
      return Object.values(t).map(x => ({ ...x, form: x.form.slice(-5) }))
        .sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.team.name.localeCompare(b.team.name));
    }
  }

  /* Converte i file {cols, names, rows, game_cols, games} in oggetti */
  function decodeLogFile(f) {
    const ix = Object.fromEntries(f.cols.map((c, i) => [c, i]));
    const rows = f.rows.map(r => {
      const o = {};
      for (const c of f.cols) o[c] = r[ix[c]];
      o.tid = String(o.tid); o.opp = String(o.opp);
      o.name = f.names[String(o.pid)];
      return o;
    });
    const gc = f.game_cols || ["gid", "date", "home", "away", "hg", "ag"];
    const games = (f.games || []).map(g => Object.fromEntries(gc.map((c, i) => [c, c === "home" || c === "away" || c === "gid" ? String(g[i]) : g[i]])));
    return { rows, games, teams: f.teams || {} };
  }

  const api = { Context, SPORT, STATS, ALL_STATS, LABELS, probAtLeast, likelyLine, matchOdds, decodeLogFile, norm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SportModel = api;
})(typeof window !== "undefined" ? window : globalThis);
