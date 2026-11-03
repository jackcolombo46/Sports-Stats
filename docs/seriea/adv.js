/* Statistiche avanzate della Serie A, stagione in corso.
   Fonti: tabellini dei giocatori e risultati (ESPN), statistiche di squadra di ogni partita (ESPN: possesso,
   passaggi, contrasti...), xG di ogni giocatore (ESPN, quando presente) e totali di Understat (xG, PPDA, punti attesi). */
(function () {
  "use strict";
  const ok = v => v != null && isFinite(v);
  const div = (a, b) => (ok(a) && ok(b) && b > 0 ? a / b : NaN);
  const fin = v => (ok(v) ? v : null);
  const RK = ["gol", "ast", "sh", "sot", "fc", "fs", "yc", "rc", "sv", "gc"];
  const zero = () => Object.fromEntries(RK.map(k => [k, 0]));
  const addR = (a, r) => { for (const k of RK) a[k] += +r[k] || 0; return a; };

  /* ---------------------------------------------------------- squadre */
  function teamMetrics() {
    const m = (key, group, label, fmt, dir, val, help) => ({ key, group, label, fmt, dir, val, help });
    const pg = f => x => div(f(x), x.gp);
    const ts = name => x => div(x.ts[name], x.tsN[name]);          // media a partita di una statistica ESPN
    const tsr = (a, b) => x => div(x.ts[a], x.ts[b]);              // rapporto fra due statistiche ESPN
    const us = (f, perGame = true) => x => x.us ? (perGame ? div(f(x.us), x.us.gp) : f(x.us)) : NaN;
    const xg = x => x.xgN ? div(x.xg, x.xgN) : us(u => u.xg)(x);
    const xga = x => x.xgN ? div(x.xga, x.xgN) : us(u => u.xga)(x);
    return [
      m("gp", "Risultati", "Partite", "n0", 0, x => x.gp),
      m("ppg", "Risultati", "Punti a partita", "n2", 1, pg(x => x.pts)),
      m("gf", "Risultati", "Gol fatti a partita", "n2", 1, pg(x => x.gf)),
      m("ga", "Risultati", "Gol subiti a partita", "n2", -1, pg(x => x.ga)),
      m("gd", "Risultati", "Differenza reti a partita", "sn2", 1, pg(x => x.gf - x.ga)),
      m("cs", "Risultati", "Porta inviolata", "pct", 1, pg(x => x.cs), "partite senza gol subiti"),
      m("xg", "Expected goals (xG)", "xG a partita", "n2", 1, xg, "gol attesi dalle occasioni create, in base alla qualità dei tiri"),
      m("xga", "Expected goals (xG)", "xG concessi a partita", "n2", -1, xga, "gol attesi dalle occasioni concesse agli avversari"),
      m("xgd", "Expected goals (xG)", "Differenza xG a partita", "sn2", 1, x => xg(x) - xga(x)),
      m("gfx", "Expected goals (xG)", "Gol fatti meno xG a partita", "sn2", 1,
        x => x.xgN ? div(x.xgGf - x.xg, x.xgN) : us(u => x.gf * u.gp / x.gp - u.xg)(x), "positivo = segna più di quanto le occasioni farebbero pensare"),
      m("gax", "Expected goals (xG)", "Gol subiti meno xG concessi a partita", "sn2", -1,
        x => x.xgN ? div(x.xgGa - x.xga, x.xgN) : us(u => x.ga * u.gp / x.gp - u.xga)(x), "negativo = subisce meno di quanto concede (portiere, fortuna)"),
      m("npxg", "Expected goals (xG)", "xG su azione a partita", "n2", 1, us(u => u.npxg), "xG senza i rigori (Understat)"),
      m("npxga", "Expected goals (xG)", "xG su azione concessi a partita", "n2", -1, us(u => u.npxga), "xG concessi senza i rigori (Understat)"),
      m("xpts", "Expected goals (xG)", "Punti attesi a partita", "n2", 1, us(u => u.xpts), "punti che la squadra avrebbe in media con gli xG di ogni partita (Understat)"),
      m("ppda", "Pressing", "PPDA", "n1", -1, us(u => div(u.ppda_att, u.ppda_def), false),
        "passaggi lasciati fare all'avversario nella sua metà campo per ogni intervento difensivo: più basso = pressing più alto (Understat)"),
      m("oppda", "Pressing", "PPDA degli avversari", "n1", 0, us(u => div(u.oppda_att, u.oppda_def), false),
        "lo stesso valore misurato sugli avversari: più alto = la squadra viene pressata meno (Understat)"),
      m("deep", "Pressing", "Passaggi vicino all'area a partita", "n1", 1, us(u => u.deep), "passaggi riusciti a circa 18 metri dalla porta, cross esclusi (Understat)"),
      m("deepa", "Pressing", "Passaggi vicino all'area concessi", "n1", -1, us(u => u.deep_allowed)),
      m("pos", "Gioco", "Possesso palla", "pv", 1, ts("possessionPct")),
      m("pas", "Gioco", "Passaggi a partita", "n0", 1, ts("totalPasses")),
      m("pasp", "Gioco", "Precisione passaggi", "pct", 1, tsr("accuratePasses", "totalPasses")),
      m("lb", "Gioco", "Lanci lunghi a partita", "n1", 0, ts("totalLongBalls")),
      m("lbp", "Gioco", "Precisione lanci lunghi", "pct", 1, tsr("accurateLongBalls", "totalLongBalls")),
      m("cr", "Gioco", "Cross a partita", "n1", 0, ts("totalCrosses")),
      m("crp", "Gioco", "Precisione cross", "pct", 1, tsr("accurateCrosses", "totalCrosses")),
      m("cor", "Gioco", "Calci d'angolo a partita", "n1", 1, ts("wonCorners")),
      m("off", "Gioco", "Fuorigioco a partita", "n1", 0, ts("offsides")),
      m("sh", "Tiri", "Tiri a partita", "n1", 1, pg(x => x.R.sh)),
      m("sot", "Tiri", "Tiri in porta a partita", "n1", 1, pg(x => x.R.sot)),
      m("sotp", "Tiri", "Tiri in porta sul totale", "pct", 1, x => div(x.R.sot, x.R.sh)),
      m("conv", "Tiri", "Gol per tiro", "pct", 1, x => div(x.gf, x.R.sh), "gol segnati ogni 100 tiri"),
      m("sha", "Tiri", "Tiri subiti a partita", "n1", -1, pg(x => x.RO.sh)),
      m("sota", "Tiri", "Tiri in porta subiti a partita", "n1", -1, pg(x => x.RO.sot)),
      m("svp", "Tiri", "Parate sui tiri in porta subiti", "pct", 1, x => 1 - div(x.ga, x.RO.sot)),
      m("tk", "Difesa e disciplina", "Contrasti a partita", "n1", 1, ts("totalTackles")),
      m("tkp", "Difesa e disciplina", "Contrasti vinti", "pct", 1, tsr("effectiveTackles", "totalTackles")),
      m("int", "Difesa e disciplina", "Intercetti a partita", "n1", 1, ts("interceptions")),
      m("clr", "Difesa e disciplina", "Respinte a partita", "n1", 0, ts("totalClearance")),
      m("blk", "Difesa e disciplina", "Tiri respinti a partita", "n1", 1, ts("blockedShots")),
      m("fc", "Difesa e disciplina", "Falli commessi a partita", "n1", -1, pg(x => x.R.fc)),
      m("fs", "Difesa e disciplina", "Falli subiti a partita", "n1", 0, pg(x => x.R.fs)),
      m("yc", "Difesa e disciplina", "Ammonizioni a partita", "n2", -1, pg(x => x.R.yc)),
      m("rc", "Difesa e disciplina", "Espulsioni", "n0", -1, x => x.R.rc),
    ];
  }

  /* ---------------------------------------------------------- giocatori */
  function playerMetrics(keeper) {
    const m = (key, group, label, fmt, dir, val, help, lg) => ({ key, group, label, fmt, dir, val, help, lg });
    const p90 = k => x => 90 * div(x.s[k], x.min);
    const use = [
      m("gp", "Utilizzo", "Presenze", "n0", 0, x => x.gp, null, false),
      m("st", "Utilizzo", "Da titolare", "pct", 0, x => div(x.starts, x.gp), null, false),
      m("mpg", "Utilizzo", "Minuti a presenza", "n0", 0, x => div(x.min, x.gp), null, false),
    ];
    if (keeper) return [...use,
      m("sv90", "Portiere", "Parate ogni 90'", "n2", 1, p90("sv")),
      m("svp", "Portiere", "Parate sui tiri in porta", "pct", 1, x => div(x.s.sv, x.s.sv + x.s.gc), "parate / (parate + gol subiti)"),
      m("gc90", "Portiere", "Gol subiti ogni 90'", "n2", -1, p90("gc")),
      m("csp", "Portiere", "Porta inviolata", "pct", 1, x => div(x.cs, x.full), "partite giocate per almeno 60' senza subire gol"),
      m("yc90", "Portiere", "Ammonizioni ogni 90'", "n2", -1, p90("yc")),
    ];
    return [...use,
      m("g90", "Ogni 90 minuti", "Gol", "n2", 1, p90("gol")),
      m("a90", "Ogni 90 minuti", "Assist", "n2", 1, p90("ast")),
      m("ga90", "Ogni 90 minuti", "Gol + assist", "n2", 1, x => 90 * div(x.s.gol + x.s.ast, x.min)),
      m("xg90", "Ogni 90 minuti", "xG", "n2", 1, x => 90 * div(x.xg, x.xgMin), "gol attesi dai suoi tiri"),
      m("sh90", "Ogni 90 minuti", "Tiri", "n2", 1, p90("sh")),
      m("sot90", "Ogni 90 minuti", "Tiri in porta", "n2", 1, p90("sot")),
      m("fc90", "Ogni 90 minuti", "Falli commessi", "n2", -1, p90("fc")),
      m("fs90", "Ogni 90 minuti", "Falli subiti", "n2", 1, p90("fs")),
      m("yc90", "Ogni 90 minuti", "Ammonizioni", "n2", -1, p90("yc")),
      m("sotp", "Efficienza", "Tiri in porta sul totale", "pct", 1, x => div(x.s.sot, x.s.sh)),
      m("conv", "Efficienza", "Gol per tiro", "pct", 1, x => div(x.s.gol, x.s.sh)),
      m("gxg", "Efficienza", "Gol meno xG", "sn2", 1, x => x.xgMin ? x.xgGol - x.xg : NaN, "positivo = segna più di quanto dicono le occasioni", false),
      m("mpgol", "Efficienza", "Minuti per gol", "n0", -1, x => div(x.min, x.s.gol), null, false),
    ];
  }

  /* ---------------------------------------------------------- aggregati */
  function build(ctx, tstats, xgMeta) {
    if (ctx._advS) return ctx._advS;
    const rows = [];
    for (const logs of ctx.playerLogs.values()) for (const g of logs) if (g.season === ctx.season && g.min > 0) rows.push(g);
    const byGT = new Map();   // "gid|tid" -> righe dei giocatori
    for (const r of rows) { const k = r.gid + "|" + r.tid; if (!byGT.has(k)) byGT.set(k, []); byGT.get(k).push(r); }
    const sumGT = (gid, tid) => (byGT.get(gid + "|" + tid) || []).reduce(addR, zero());
    const xgGT = (gid, tid) => {
      const rs = byGT.get(gid + "|" + tid) || [];
      return rs.length && rs.every(r => r.xg != null) ? rs.reduce((a, r) => a + (+r.xg || 0), 0) : null;
    };
    const us = (xgMeta && xgMeta.season === ctx.season && xgMeta.teams) || {};
    const T = {};
    const team = tid => T[tid] ||= { gp: 0, pts: 0, gf: 0, ga: 0, cs: 0, w: 0, d: 0, l: 0, R: zero(), RO: zero(),
                                     ts: {}, tsN: {}, xgN: 0, xg: 0, xga: 0, xgGf: 0, xgGa: 0, us: us[tid] || null };
    for (const g of ctx.games) {
      if (g.hg == null || g.ag == null) continue;
      for (const [tid, oid, f, a] of [[g.home, g.away, g.hg, g.ag], [g.away, g.home, g.ag, g.hg]]) {
        const t = team(tid);
        t.gp++; t.gf += f; t.ga += a; if (!a) t.cs++;
        if (f > a) { t.w++; t.pts += 3; } else if (f === a) { t.d++; t.pts += 1; } else t.l++;
        addR(t.R, sumGT(g.gid, tid)); addR(t.RO, sumGT(g.gid, oid));
        const x1 = xgGT(g.gid, tid), x2 = xgGT(g.gid, oid);
        if (x1 != null && x2 != null && (x1 > 0 || x2 > 0)) { t.xgN++; t.xg += x1; t.xga += x2; t.xgGf += f; t.xgGa += a; }
        const st = ((tstats || {})[g.gid] || {})[tid];
        if (st) for (const [k, v] of Object.entries(st)) if (ok(v)) { t.ts[k] = (t.ts[k] || 0) + v; t.tsN[k] = (t.tsN[k] || 0) + 1; }
      }
    }
    const TM = teamMetrics();
    const teamVals = {};
    for (const [tid, t] of Object.entries(T)) if (ctx.current.has(tid)) teamVals[tid] = Object.fromEntries(TM.map(m => [m.key, fin(m.val(t))]));
    const { ranks, lg } = Adv.ranksAndAvg(TM, teamVals);

    // giocatori
    const byPlayer = new Map();
    const lgP = { 0: { gp: 0, starts: 0, min: 0, s: zero(), xg: 0, xgMin: 0, xgGol: 0, cs: 0, full: 0 }, 1: null };
    lgP[1] = JSON.parse(JSON.stringify(lgP[0]));
    for (const r of rows) {
      const x = byPlayer.get(r.pid) || { gp: 0, starts: 0, min: 0, s: zero(), xg: 0, xgMin: 0, xgGol: 0, cs: 0, full: 0, gkGames: 0 };
      for (const y of [x, lgP[r.gk ? 1 : 0]]) {
        y.gp++; y.starts += r.start ? 1 : 0; y.min += r.min; addR(y.s, r);
        if (r.xg != null) { y.xg += +r.xg || 0; y.xgMin += r.min; y.xgGol += +r.gol || 0; }
        if (r.min >= 60) { y.full++; if (!r.gc) y.cs++; }
      }
      if (r.gk) x.gkGames++;
      byPlayer.set(r.pid, x);
    }
    const PM = { 0: playerMetrics(false), 1: playerMetrics(true) };
    const plg = { 0: Object.fromEntries(PM[0].map(m => [m.key, fin(m.val(lgP[0]))])), 1: Object.fromEntries(PM[1].map(m => [m.key, fin(m.val(lgP[1]))])) };
    const hasTs = Object.values(T).some(t => Object.keys(t.ts).length);
    const hasXg = Object.values(T).some(t => t.xgN || t.us);
    return (ctx._advS = { TM, T, teamVals, ranks, lg, byPlayer, PM, plg, hasTs, hasXg });
  }

  function note(A) {
    const miss = [];
    if (!A.hasTs) miss.push("possesso/passaggi/contrasti");
    if (!A.hasXg) miss.push("xG/pressing");
    return miss.length ? ` Le voci su ${miss.join(" e ")} compariranno dopo il prossimo aggiornamento automatico dei dati.` : "";
  }

  function teamSection(ctx, tstats, xgMeta, tid) {
    const A = build(ctx, tstats, xgMeta);
    if (!A.teamVals[tid]) return Adv.section("team:" + tid, "Statistiche avanzate", `<div class="msg small">Nessuna partita giocata in questa stagione.</div>`);
    const t = A.T[tid];
    const nt = `Stagione ${ctx.season}, ${t.gp} partite (${t.w}V ${t.d}N ${t.l}P). Pos. = posizione in Serie A (1ª = la migliore); Media = media delle squadre.` + note(A);
    return Adv.section("team:" + tid, "Statistiche avanzate della squadra", Adv.table(A.TM, A.teamVals[tid], A.ranks[tid], A.lg, { hideEmpty: true }), nt);
  }

  function playerSection(ctx, tstats, xgMeta, pid) {
    const A = build(ctx, tstats, xgMeta);
    const x = A.byPlayer.get(pid);
    if (!x) return Adv.section("player:" + pid, "Statistiche avanzate", `<div class="msg small">Nessuna presenza in questa stagione.</div>`);
    const k = x.gkGames * 2 > x.gp ? 1 : 0;
    const vals = Object.fromEntries(A.PM[k].map(m => [m.key, fin(m.val(x))]));
    const nt = `Stagione ${ctx.season}, ${x.gp} presenze, ${Math.round(x.min)} minuti. Media = valore medio dei ${k ? "portieri" : "giocatori di movimento"} della Serie A.`;
    return Adv.section("player:" + pid, "Statistiche avanzate del giocatore", Adv.table(A.PM[k], vals, null, A.plg[k], { hideEmpty: true }), nt);
  }

  function compare(ctx, tstats, xgMeta, a, b, head) {
    const A = build(ctx, tstats, xgMeta);
    const n = note(A);
    return Adv.compare(A.TM, { vals: A.teamVals[a] || {}, html: head(a, A.T[a]) }, { vals: A.teamVals[b] || {}, html: head(b, A.T[b]) })
      + (n ? `<div class="advnote" style="margin-top:10px">${n.trim()}</div>` : "");
  }

  window.SoccerAdv = { build, teamSection, playerSection, compare };
})();
