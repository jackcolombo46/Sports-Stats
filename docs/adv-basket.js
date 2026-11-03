/* Statistiche avanzate del basket (NBA e LBA), calcolate dai tabellini della stagione in corso.
   Possessi = tiri tentati − rimbalzi offensivi + palle perse + 0,44 × liberi tentati (media delle due squadre).
   Le voci che usano tiri segnati e liberi segnati compaiono quando i dati li contengono. */
(function () {
  "use strict";
  const ok = v => v != null && isFinite(v);
  const div = (a, b) => (ok(a) && ok(b) && b > 0 ? a / b : NaN);   // NaN = non calcolabile (diventa "—")
  const K = ["pts", "fga", "fgm", "fg3m", "fg3a", "fta", "ftm", "oreb", "reb", "ast", "tov", "stl", "blk", "min"];
  const zero = () => Object.fromEntries(K.map(k => [k, 0]));
  const add = (a, r) => { for (const k of K) a[k] += r[k] == null ? NaN : +r[k]; return a; };  // NaN = dato mancante
  const fin = v => (ok(v) ? v : null);
  const poss1 = t => t.fga - t.oreb + t.tov + 0.44 * t.fta;

  /* ---------------------------------------------------------- metriche di squadra
     T = totali della squadra, O = degli avversari, P = possessi, M = minuti di gioco (minuti giocatori / 5) */
  function teamMetrics(gameMin) {
    const m = (key, group, label, fmt, dir, val, help) => ({ key, group, label, fmt, dir, val, help });
    return [
      m("gp", "Risultati", "Partite", "n0", 0, x => x.gp),
      m("winp", "Risultati", "% vittorie", "pct", 1, x => div(x.w, x.gp)),
      m("ptsf", "Risultati", "Punti fatti a partita", "n1", 1, x => div(x.T.pts, x.gp)),
      m("ptsa", "Risultati", "Punti subiti a partita", "n1", -1, x => div(x.O.pts, x.gp)),
      m("pace", "Efficienza", `Ritmo (possessi per ${gameMin}')`, "n1", 0, x => div(x.P, x.M) * gameMin,
        `possessi giocati in ${gameMin} minuti: più alto = partite più veloci`),
      m("ortg", "Efficienza", "Rating offensivo", "n1", 1, x => 100 * div(x.T.pts, x.P), "punti segnati ogni 100 possessi"),
      m("drtg", "Efficienza", "Rating difensivo", "n1", -1, x => 100 * div(x.O.pts, x.P), "punti subiti ogni 100 possessi (più basso è meglio)"),
      m("net", "Efficienza", "Net rating", "sn1", 1, x => 100 * (div(x.T.pts, x.P) - div(x.O.pts, x.P)), "rating offensivo meno rating difensivo"),
      m("efg", "Attacco: four factors", "eFG%", "pct", 1, x => div((x.T.fgm) + 0.5 * x.T.fg3m, x.T.fga),
        "percentuale effettiva al tiro: la tripla vale 1,5 canestri"),
      m("tov", "Attacco: four factors", "Palle perse ogni 100 possessi", "n1", -1, x => 100 * div(x.T.tov, x.P)),
      m("orb", "Attacco: four factors", "Rimbalzi offensivi %", "pct", 1, x => div(x.T.oreb, x.T.oreb + x.O.reb - x.O.oreb),
        "rimbalzi offensivi presi su quelli disponibili"),
      m("ftr", "Attacco: four factors", "Liberi segnati per tiro", "n2", 1, x => div((x.T.ftm), x.T.fga), "liberi segnati / tiri dal campo tentati"),
      m("ts", "Tiro", "True shooting %", "pct", 1, x => div(x.T.pts, 2 * (x.T.fga + 0.44 * x.T.fta)), "efficienza al tiro contando anche i liberi"),
      m("p2", "Tiro", "Tiri da 2 %", "pct", 1, x => div((x.T.fgm) - x.T.fg3m, x.T.fga - (x.T.fg3a))),
      m("p3", "Tiro", "Tiri da 3 %", "pct", 1, x => div(x.T.fg3m, (x.T.fg3a))),
      m("pft", "Tiro", "Tiri liberi %", "pct", 1, x => div((x.T.ftm), x.T.fta)),
      m("r3", "Tiro", "Quota di tiri da 3", "pct", 0, x => div((x.T.fg3a), x.T.fga), "tiri da 3 tentati sul totale dei tiri"),
      m("astr", "Tiro", "Canestri assistiti %", "pct", 1, x => div(x.T.ast, (x.T.fgm))),
      m("oefg", "Difesa: four factors avversari", "eFG% concesso", "pct", -1, x => div((x.O.fgm) + 0.5 * x.O.fg3m, x.O.fga)),
      m("otov", "Difesa: four factors avversari", "Palle perse forzate ogni 100 poss.", "n1", 1, x => 100 * div(x.O.tov, x.P)),
      m("drb", "Difesa: four factors avversari", "Rimbalzi difensivi %", "pct", 1, x => div(x.T.reb - x.T.oreb, x.T.reb - x.T.oreb + x.O.oreb),
        "rimbalzi difensivi presi su quelli disponibili"),
      m("oftr", "Difesa: four factors avversari", "Liberi concessi per tiro", "n2", -1, x => div((x.O.ftm), x.O.fga)),
      m("ast100", "Ogni 100 possessi", "Assist", "n1", 1, x => 100 * div(x.T.ast, x.P)),
      m("stl100", "Ogni 100 possessi", "Rubate", "n1", 1, x => 100 * div(x.T.stl, x.P)),
      m("blk100", "Ogni 100 possessi", "Stoppate", "n1", 1, x => 100 * div(x.T.blk, x.P)),
      m("reb100", "Ogni 100 possessi", "Rimbalzi", "n1", 1, x => 100 * div(x.T.reb, x.P)),
    ];
  }

  /* ---------------------------------------------------------- metriche del giocatore
     p = totali del giocatore, T/O = totali di squadra/avversari nelle sue partite, TM = minuti di squadra in quelle partite */
  function playerMetrics(gameMin) {
    const m = (key, group, label, fmt, dir, val, help, lg) => ({ key, group, label, fmt, dir, val, help, lg });
    const per = k => x => 36 * div(x.p[k], x.p.min);
    const share = (a, b) => x => 100 * div(a(x) * (x.TM / 5), x.p.min * b(x));
    return [
      m("gp", "Utilizzo", "Partite", "n0", 0, x => x.gp, null, false),
      m("mpg", "Utilizzo", "Minuti a partita", "n1", 0, x => div(x.p.min, x.gp), null, false),
      m("usg", "Utilizzo", "Usage %", "n1", 0, share(x => x.p.fga + 0.44 * x.p.fta + x.p.tov, x => x.T.fga + 0.44 * x.T.fta + x.T.tov),
        "quota di azioni della squadra che finiscono con un suo tiro, libero o palla persa mentre è in campo (media 20)"),
      m("ts", "Tiro", "True shooting %", "pct", 1, x => div(x.p.pts, 2 * (x.p.fga + 0.44 * x.p.fta)), "efficienza al tiro contando anche i liberi"),
      m("efg", "Tiro", "eFG%", "pct", 1, x => div((x.p.fgm) + 0.5 * x.p.fg3m, x.p.fga), "percentuale effettiva al tiro: la tripla vale 1,5 canestri"),
      m("p2", "Tiro", "Tiri da 2 %", "pct", 1, x => div((x.p.fgm) - x.p.fg3m, x.p.fga - (x.p.fg3a))),
      m("p3", "Tiro", "Tiri da 3 %", "pct", 1, x => div(x.p.fg3m, (x.p.fg3a))),
      m("pft", "Tiro", "Tiri liberi %", "pct", 1, x => div((x.p.ftm), x.p.fta)),
      m("r3", "Tiro", "Quota di tiri da 3", "pct", 0, x => div((x.p.fg3a), x.p.fga), "tiri da 3 tentati sul totale dei tiri"),
      m("ftr", "Tiro", "Liberi tentati per tiro", "n2", 0, x => div(x.p.fta, x.p.fga)),
      m("pts36", "Ogni 36 minuti", "Punti", "n1", 1, per("pts")),
      m("reb36", "Ogni 36 minuti", "Rimbalzi", "n1", 1, per("reb")),
      m("ast36", "Ogni 36 minuti", "Assist", "n1", 1, per("ast")),
      m("fg336", "Ogni 36 minuti", "Triple segnate", "n1", 1, per("fg3m")),
      m("stl36", "Ogni 36 minuti", "Rubate", "n1", 1, per("stl")),
      m("blk36", "Ogni 36 minuti", "Stoppate", "n1", 1, per("blk")),
      m("tov36", "Ogni 36 minuti", "Palle perse", "n1", -1, per("tov")),
      m("astp", "Quote in campo", "Assist %", "n1", 1, x => 100 * div(x.p.ast, (x.p.min / (x.TM / 5)) * (x.T.fgm) - (x.p.fgm)),
        "canestri dei compagni assistiti da lui mentre è in campo", false),
      m("tovp", "Quote in campo", "Palle perse %", "n1", -1, x => 100 * div(x.p.tov, x.p.fga + 0.44 * x.p.fta + x.p.tov),
        "palle perse ogni 100 azioni concluse da lui"),
      m("orbp", "Quote in campo", "Rimbalzi offensivi %", "n1", 1, share(x => x.p.oreb, x => x.T.oreb + x.O.reb - x.O.oreb),
        "rimbalzi offensivi presi su quelli disponibili mentre è in campo"),
      m("drbp", "Quote in campo", "Rimbalzi difensivi %", "n1", 1, share(x => x.p.reb - x.p.oreb, x => x.T.reb - x.T.oreb + x.O.oreb),
        "rimbalzi difensivi presi su quelli disponibili mentre è in campo"),
    ];
  }

  /* ---------------------------------------------------------- aggregati */
  function build(ctx, M, gameMin) {
    if (ctx._advB) return ctx._advB;
    const rows = [];
    for (const logs of ctx.playerLogs.values()) for (const g of logs) if (g.season === ctx.season && g.min > 0) rows.push(g);
    const tg = new Map();   // "gid|tri" -> totali della squadra nella partita
    for (const r of rows) {
      const k = r.gid + "|" + r.tri;
      if (!tg.has(k)) tg.set(k, { gid: r.gid, tri: r.tri, opp: r.opp, ...zero() });
      add(tg.get(k), r);
    }
    const teams = {};
    for (const g of tg.values()) {
      const o = tg.get(g.gid + "|" + g.opp);
      if (!o) continue;
      const t = teams[g.tri] ||= { gp: 0, w: 0, T: zero(), O: zero(), P: 0, M: 0 };
      t.gp++; if (g.pts > o.pts) t.w++;
      add(t.T, g); add(t.O, o);
      t.P += (poss1(g) + poss1(o)) / 2;
      t.M += g.min / 5;
    }
    const TM = teamMetrics(gameMin), PM = playerMetrics(gameMin);
    const teamVals = {};
    for (const [tri, t] of Object.entries(teams)) if (M.TEAM[tri]) teamVals[tri] = Object.fromEntries(TM.map(m => [m.key, fin(m.val(t))]));
    const { ranks, lg } = Adv.ranksAndAvg(TM, teamVals);

    // giocatori: totali propri e della squadra nelle partite giocate
    const byPlayer = new Map();
    for (const r of rows) {
      const t = tg.get(r.gid + "|" + r.tri), o = tg.get(r.gid + "|" + r.opp);
      if (!t || !o) continue;
      const x = byPlayer.get(r.pid) || { gp: 0, p: zero(), T: zero(), O: zero(), TM: 0 };
      x.gp++; add(x.p, r); add(x.T, t); add(x.O, o); x.TM += t.min;
      byPlayer.set(r.pid, x);
    }
    // media del campionato per i giocatori: stessi conti sui totali di tutti
    const L = { gp: 0, p: zero(), T: zero(), O: zero(), TM: 0 };
    for (const t of tg.values()) { const o = tg.get(t.gid + "|" + t.opp); if (o) { add(L.p, t); add(L.T, t); add(L.O, o); L.TM += t.min; } }
    const plg = Object.fromEntries(PM.map(m => [m.key, fin(m.val(L))]));
    const hasMade = rows.length > 0 && rows.every(r => r.fgm != null);
    return (ctx._advB = { TM, PM, teams, teamVals, ranks, lg, byPlayer, plg, hasMade, nGames: tg.size / 2 });
  }

  const NOTE_OLD = "Alcune voci (eFG%, % al tiro, assist %) compariranno dopo il prossimo aggiornamento automatico dei dati.";

  function teamSection(ctx, M, gameMin, tri) {
    const A = build(ctx, M, gameMin);
    if (!A.teamVals[tri]) return Adv.section("team:" + tri, "Statistiche avanzate", `<div class="msg small">Nessuna partita giocata in questa stagione.</div>`);
    const note = `Stagione ${ctx.season}, ${A.teams[tri].gp} partite. Pos. = posizione nel campionato (1ª = la migliore); Media = media delle squadre.` + (A.hasMade ? "" : " " + NOTE_OLD);
    return Adv.section("team:" + tri, "Statistiche avanzate della squadra", Adv.table(A.TM, A.teamVals[tri], A.ranks[tri], A.lg, { hideEmpty: true }), note);
  }

  function playerSection(ctx, M, gameMin, pid) {
    const A = build(ctx, M, gameMin);
    const x = A.byPlayer.get(pid);
    if (!x) return Adv.section("player:" + pid, "Statistiche avanzate", `<div class="msg small">Nessuna partita giocata in questa stagione.</div>`);
    const vals = Object.fromEntries(A.PM.map(m => [m.key, fin(m.val(x))]));
    const note = `Stagione ${ctx.season}, ${x.gp} partite. Media = valore del giocatore medio del campionato.` + (A.hasMade ? "" : " " + NOTE_OLD);
    return Adv.section("player:" + pid, "Statistiche avanzate del giocatore", Adv.table(A.PM, vals, null, A.plg, { hideEmpty: true }), note);
  }

  function compare(ctx, M, gameMin, a, b, head) {
    const A = build(ctx, M, gameMin);
    return Adv.compare(A.TM, { vals: A.teamVals[a] || {}, html: head(a, A.teams[a]) }, { vals: A.teamVals[b] || {}, html: head(b, A.teams[b]) })
      + (A.hasMade ? "" : `<div class="advnote" style="margin-top:10px">${NOTE_OLD}</div>`);
  }

  window.BasketAdv = { build, teamSection, playerSection, compare };
})();
