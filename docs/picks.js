/* "Occasioni": le previsioni più probabili per tutti i giocatori delle prossime partite.
   Usa le stesse proiezioni delle schede Giocatore/Squadra (projectTeam del modello di ogni app).
   Per ogni giocatore e statistica si prende la soglia più alta con probabilità >= minimo scelto
   (es. "almeno 25 punti" al 76% invece di "almeno 5 punti" al 99%), poi si ordina per probabilità. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = p => Math.round(p * 100) + "%";
  const MAX_ROWS = 60;
  const state = { all: false };

  /* partite della prossima giornata: dalla prima partita non ancora iniziata, entro windowH ore */
  function nextGames(schedule, windowH) {
    const now = Date.now();
    const up = (schedule || []).filter(g => g.state !== "in" && g.state !== "post" && new Date(g.utc) > now - 600e3 &&
      (g.stype == null || g.stype === 2 || g.stype === 3 || g.stype === 5)).sort((a, b) => (a.utc < b.utc ? -1 : 1));
    if (!up.length) return [];
    const t0 = new Date(up[0].utc).getTime();
    return up.filter(g => new Date(g.utc).getTime() <= t0 + windowH * 3600e3);
  }

  /* tutte le soglie di tutti i giocatori (una volta per caricamento dei dati) */
  function collect(cfg) {
    const key = cfg.games.map(g => g.id).join(",");
    if (cfg.ctx._picks && cfg.ctx._picks.key === key) return cfg.ctx._picks.items;
    const items = [];
    for (const g of cfg.games) {
      for (const [tid, opp, home] of [[g.home, g.away, true], [g.away, g.home, false]]) {
        let res;
        try { res = cfg.project(tid, opp, home); } catch { continue; }
        for (const p of (res && res.players) || []) {
          for (const s of p.stats || []) {
            if (cfg.skip && cfg.skip.has(s.stat)) continue;
            const lo = (cfg.minLine || {})[s.stat] || 0;   // soglie troppo basse = previsioni banali
            const lines = (s.lines || []).filter(l => l.prob != null && l.line >= lo);
            if (lines.length) items.push({ gid: g.id, utc: g.utc, tid, opp, home, pid: p.player.id, name: p.player.name,
                                           minutes: p.minutes, stat: s.stat, label: s.label, proj: s.proj, lines });
          }
        }
      }
    }
    cfg.ctx._picks = { key, items };
    return items;
  }

  function fill(sel, opts, keep) {
    const v = keep ?? sel.value;
    sel.innerHTML = opts.map(([val, txt]) => `<option value="${esc(val)}">${esc(txt)}</option>`).join("");
    if (opts.some(o => String(o[0]) === String(v))) sel.value = v;
  }

  const when = utc => new Date(utc).toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const whenShort = utc => new Date(utc).toLocaleString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" });


  function headOf(cfg, games, gid, teams) {
    const day = utc => when(utc).replace(/,? \d\d:\d\d$/, "");
    const first = games[0], last = games[games.length - 1];
    const span = day(first.utc) === day(last.utc) ? day(first.utc) : `${day(first.utc)} – ${day(last.utc)}`;
    const note = teams
      ? `Per ogni partita e tipo di previsione la più ambiziosa che supera la probabilità scelta (es. "Over 2,5" invece di "Over 1,5" se supera il minimo).
         Storico = quante volte è successo nelle ultime partite di ciascuna squadra in questa stagione. Tocca una partita per il confronto fra le due squadre. ${cfg.teamNote || ""}`
      : `Per ogni giocatore e statistica la soglia più alta che supera la probabilità scelta. U10 = quante volte l'ha raggiunta nelle ultime 10 partite.
         Tocca un giocatore per la proiezione completa.`;
    return `<h3 style="margin-top:0">Migliori occasioni · ${esc(span)} <small class="nt">(${gid ? "1 partita" : games.length + (games.length === 1 ? " partita" : " partite")})</small></h3>
      <div class="advnote">${note}</div>`;
  }

  /* cfg: { ctx, schedule, windowH, project(tid, opp, home), name(tid), short(tid), logo(tid, size), photo(pid, name, size),
            stats: [[codice, etichetta]], skip: Set, minLine: {codice: soglia minima}, defMin, el: {game, stat, min} } */
  function render(cfg) {
    const games = nextGames(cfg.schedule, cfg.windowH);
    if (!games.length) return `<div class="msg">Nessuna partita in programma nei prossimi giorni.</div>`;
    cfg.games = games;
    if (!cfg.el.kind.options.length) fill(cfg.el.kind, [["players", "Giocatori"], ["teams", "Squadre e partite"]], "players");
    const teams = cfg.el.kind.value === "teams";
    if (cfg.el.kind.dataset.last !== cfg.el.kind.value) { cfg.el.stat.value = ""; cfg.el.kind.dataset.last = cfg.el.kind.value; }

    // filtri
    fill(cfg.el.game, [["", `Tutte le partite (${games.length})`], ...games.map(g => [g.id, `${cfg.short(g.home)} – ${cfg.short(g.away)} · ${whenShort(g.utc)}`])]);
    if (!cfg.el.min.options.length) fill(cfg.el.min, [50, 55, 60, 65, 70, 75, 80, 85, 90].map(v => [v, `Probabilità almeno ${v}%`]), cfg.defMin);
    const gid = cfg.el.game.value, min = +cfg.el.min.value / 100;
    const head = headOf(cfg, games, gid, teams);
    if (teams) return renderTeams(cfg, games, head, gid, min) + backtest(cfg.backtest, true, cfg.sportName);

    const items = collect(cfg);
    fill(cfg.el.stat, [["", "Tutte le statistiche"], ...cfg.stats.filter(([s]) => items.some(i => i.stat === s))]);
    const stat = cfg.el.stat.value;

    const picks = [];
    for (const it of items) {
      if ((gid && it.gid !== gid) || (stat && it.stat !== stat)) continue;
      const ok = it.lines.filter(l => l.prob >= min);
      if (!ok.length) continue;
      const best = ok.reduce((a, b) => (b.line > a.line ? b : a));
      picks.push({ ...it, line: best.line, prob: best.prob, l10: best.l10 });
    }
    picks.sort((a, b) => b.prob - a.prob || b.line - a.line);

    if (!picks.length) return head + `<div class="msg">Nessuna previsione sopra il ${Math.round(min * 100)}%: prova ad abbassare la probabilità minima.</div>`;

    const shown = state.all ? picks : picks.slice(0, MAX_ROWS);
    const rows = shown.map(p => {
      const l10 = p.l10 && p.l10[1] ? `${p.l10[0]}/${p.l10[1]}` : "–";
      const l10c = p.l10 && p.l10[1] ? (p.l10[0] / p.l10[1] >= 0.7 ? "up" : p.l10[0] / p.l10[1] < 0.5 ? "dn" : "") : "";
      return `<tr class="click" data-pid="${p.pid}" data-name="${esc(p.name)}">
        <td><span class="who">${cfg.photo(p.pid, p.name)}<span>${esc(p.name)}<small class="pkm">${cfg.logo(p.tid, "s")} ${esc(cfg.short(p.tid))} ${p.home ? "vs" : "@"} ${esc(cfg.short(p.opp))}${gid ? "" : " · " + esc(whenShort(p.utc))}</small></span></span></td>
        <td class="pkl">${esc(p.label)} <b>${p.line}+</b><small class="pkm">proiezione ${p.proj}</small></td>
        <td class="pkp" style="--p:${Math.round(p.prob * 100)}%">${pct(p.prob)}</td>
        <td class="${l10c}">${l10}</td></tr>`;
    }).join("");
    const more = picks.length > MAX_ROWS
      ? `<button class="advclose" id="pkMore">${state.all ? "Mostra solo le prime " + MAX_ROWS : `Mostra tutte (${picks.length})`}</button>` : "";
    return head + `<div class="scroll"><table class="pkt"><tr><th>Giocatore</th><th>Previsione</th><th>Prob.</th><th>U10</th></tr>${rows}</table></div>${more}` + backtest(cfg.backtest, false, cfg.sportName);
  }


  /* ======================================================== occasioni di squadra */
  const erf = x => { const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y; };
  const cdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
  const ge = (x, mu, sd) => 1 - cdf((x - 0.5 - mu) / sd);   // P(valore intero >= x)
  const le = (x, mu, sd) => cdf((x + 0.5 - mu) / sd);       // P(valore intero <= x)
  const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
  const cnt = (list, f) => list.length ? [list.filter(f).length, list.length] : null;

  /* calcio: dai gol attesi delle due squadre (Poisson, come il riquadro 1-X-2 della scheda squadra) */
  function soccerMarkets(g, m, sh, sa, hh, ha) {
    const P = [];
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) P.push([i, j, pois(i, m.lh) * pois(j, m.la)]);
    const pr = f => P.reduce((a, [i, j, p]) => a + (f(i, j) ? p : 0), 0);
    const both = (f) => [cnt(hh, x => f(x.pf, x.pa)), cnt(ha, x => f(x.pf, x.pa))];
    const mk = (market, group, lines) => ({ market, group, lines });
    const out = [];
    for (const [side, name, hist, me] of [["h", sh, hh, (i, j) => [i, j]], ["a", sa, ha, (i, j) => [j, i]]]) {
      const f = (cond) => (i, j) => cond(...me(i, j));
      out.push(mk(`res-${side}`, "Risultato", [
        { text: `${name} vince con 2+ gol di scarto`, prob: pr(f((x, y) => x - y >= 2)), test: f((x, y) => x - y >= 2), hist: [cnt(hist, x => x.pf - x.pa >= 2)] },
        { text: `Vince ${name}`, prob: pr(f((x, y) => x > y)), test: f((x, y) => x > y), hist: [cnt(hist, x => x.pf > x.pa)] },
        { text: `${name} non perde`, prob: pr(f((x, y) => x >= y)), test: f((x, y) => x >= y), hist: [cnt(hist, x => x.pf >= x.pa)] }]));
      out.push(mk(`gol-${side}`, "Gol di squadra", [1, 2, 3].map(k =>
        ({ text: `${name} segna almeno ${k} gol`, prob: pr(f(x => x >= k)), test: f(x => x >= k), hist: [cnt(hist, x => x.pf >= k)] }))));
      out.push(mk(`cs-${side}`, "Porta inviolata", [
        { text: `${name} non subisce gol`, prob: pr(f((x, y) => y === 0)), test: f((x, y) => y === 0), hist: [cnt(hist, x => x.pa === 0)] }]));
    }
    out.push(mk("ov", "Gol totali", [1.5, 2.5, 3.5, 4.5].map(k =>
      ({ text: `Over ${k} (almeno ${Math.ceil(k)} gol)`, prob: pr((i, j) => i + j > k), test: (i, j) => i + j > k, hist: both((a, b) => a + b > k) }))));
    out.push(mk("un", "Gol totali", [4.5, 3.5, 2.5, 1.5].map(k =>
      ({ text: `Under ${k} (al massimo ${Math.floor(k)} gol)`, prob: pr((i, j) => i + j < k), test: (i, j) => i + j < k, hist: both((a, b) => a + b < k) }))));
    out.push(mk("gg", "Gol / No gol", [{ text: "Gol (segnano entrambe)", prob: pr((i, j) => i > 0 && j > 0), test: (i, j) => i > 0 && j > 0, hist: both((a, b) => a > 0 && b > 0) }]));
    out.push(mk("ng", "Gol / No gol", [{ text: "No gol (almeno una non segna)", prob: pr((i, j) => !i || !j), test: (i, j) => !i || !j, hist: both((a, b) => !a || !b) }]));
    return out;
  }

  /* basket: punti attesi delle due squadre e variabilità tipica (distribuzione normale) */
  function basketMarkets(g, m, sh, sa, hh, ha) {
    const out = [], mk = (market, group, lines) => ({ market, group, lines });
    const diff = m.ph - m.pa, tot = m.ph + m.pa;
    const both = f => [cnt(hh, x => f(x.pf, x.pa)), cnt(ha, x => f(x.pf, x.pa))];
    const steps = (mu, w) => { const a = Math.floor((mu - w) / 5) * 5, r = []; for (let x = a; x <= mu + w; x += 5) r.push(x); return r; };
    for (const [side, name, hist, d, pts, me] of [["h", sh, hh, diff, m.ph, (i, j) => [i, j]], ["a", sa, ha, -diff, m.pa, (i, j) => [j, i]]]) {
      const f = cond => (i, j) => cond(...me(i, j));
      out.push(mk(`res-${side}`, "Risultato", [15, 10, 5].map(k =>
        ({ text: `${name} vince con ${k}+ punti di scarto`, prob: ge(k, d, m.sd.diff), test: f((x, y) => x - y >= k), hist: [cnt(hist, x => x.pf - x.pa >= k)] }))
        .concat([{ text: `Vince ${name}`, prob: 1 - cdf((0 - d) / m.sd.diff), test: f((x, y) => x > y), hist: [cnt(hist, x => x.pf > x.pa)] }])));
      out.push(mk(`pt-${side}`, "Punti di squadra", steps(pts, 25).reverse().map(k =>
        ({ text: `${name} segna almeno ${k} punti`, prob: ge(k, pts, m.sd.team), test: f(x => x >= k), hist: [cnt(hist, x => x.pf >= k)] }))));
      out.push(mk(`pu-${side}`, "Punti di squadra", steps(pts, 25).map(k =>
        ({ text: `${name} segna al massimo ${k} punti`, prob: le(k, pts, m.sd.team), test: f(x => x <= k), hist: [cnt(hist, x => x.pf <= k)] }))));
    }
    out.push(mk("ov", "Punti totali", steps(tot, 35).reverse().map(k =>
      ({ text: `Almeno ${k} punti in totale`, prob: ge(k, tot, m.sd.tot), test: (i, j) => i + j >= k, hist: both((a, b) => a + b >= k) }))));
    out.push(mk("un", "Punti totali", steps(tot, 35).map(k =>
      ({ text: `Al massimo ${k} punti in totale`, prob: le(k, tot, m.sd.tot), test: (i, j) => i + j <= k, hist: both((a, b) => a + b <= k) }))));
    return out;
  }

  function teamItems(cfg) {
    const key = "T" + cfg.games.map(g => g.id).join(",");
    if (cfg.ctx._picksT && cfg.ctx._picksT.key === key) return cfg.ctx._picksT.items;
    const items = [];
    for (const g of cfg.games) {
      let m; try { m = cfg.teamModel(g.home, g.away); } catch { m = null; }
      if (!m) continue;
      const fn = cfg.sport === "basket" ? basketMarkets : soccerMarkets;
      for (const mk of fn(g, m, cfg.short(g.home), cfg.short(g.away), cfg.teamHist(g.home), cfg.teamHist(g.away)))
        items.push({ ...mk, gid: g.id, utc: g.utc, home: g.home, away: g.away });
    }
    cfg.ctx._picksT = { key, items };
    return items;
  }

  function renderTeams(cfg, games, head, gid, min) {
    const items = teamItems(cfg);
    const groups = [...new Set(items.map(i => i.group))];
    fill(cfg.el.stat, [["", "Tutti i tipi di previsione"], ...groups.map(x => [x, x])]);
    const grp = cfg.el.stat.value;
    const picks = [];
    for (const it of items) {
      if ((gid && it.gid !== gid) || (grp && it.group !== grp)) continue;
      const ok = it.lines.filter(l => l.prob >= min && l.prob < 0.995);
      if (!ok.length) continue;
      const best = ok.reduce((a, b) => (b.prob < a.prob ? b : a));   // la più ambiziosa che supera il minimo
      picks.push({ ...it, ...best });
    }
    picks.sort((a, b) => b.prob - a.prob);
    if (!picks.length) return head + `<div class="msg">Nessuna previsione sopra il ${Math.round(min * 100)}%: prova ad abbassare la probabilità minima.</div>`;
    const shown = state.all ? picks : picks.slice(0, MAX_ROWS);
    const h = (c) => c ? `${c[0]}/${c[1]}` : "–";
    const rows = shown.map(p => {
      const hist = p.hist.length === 2
        ? `${esc(cfg.short(p.home))} ${h(p.hist[0])}<br>${esc(cfg.short(p.away))} ${h(p.hist[1])}` : h(p.hist[0]);
      const rate = p.hist.filter(Boolean).map(c => c[0] / c[1]);
      const hc = rate.length ? (Math.min(...rate) >= 0.7 ? "up" : Math.max(...rate) < 0.5 ? "dn" : "") : "";
      return `<tr class="click" data-cmp="${esc(p.home)}|${esc(p.away)}">
        <td class="pkl"><b class="pkt1">${esc(p.text)}</b>
          <small class="pkm">${cfg.logo(p.home, "s")} ${esc(cfg.short(p.home))} – ${cfg.logo(p.away, "s")} ${esc(cfg.short(p.away))} · ${esc(whenShort(p.utc))} · ${esc(p.group)}</small></td>
        <td class="pkp" style="--p:${Math.round(p.prob * 100)}%">${pct(p.prob)}</td>
        <td class="pkh ${hc}">${hist}</td></tr>`;
    }).join("");
    const more = picks.length > MAX_ROWS
      ? `<button class="advclose" id="pkMore">${state.all ? "Mostra solo le prime " + MAX_ROWS : `Mostra tutte (${picks.length})`}</button>` : "";
    return head + `<div class="scroll"><table class="pkt"><tr><th>Previsione</th><th>Prob.</th><th>Storico</th></tr>${rows}</table></div>${more}`;
  }


  /* ======================================================== quanto ci azzecca il modello
     bt = data/backtest.json (tools/backtest/backtest.js): proiezioni ricostruite per le partite già giocate
     usando solo i dati precedenti, confrontate con i risultati. */
  function backtest(bt, teams, sportName) {
    if (!bt) return "";
    const P = x => (x == null ? "–" : (x * 100).toFixed(1) + "%");
    const N = n => n.toLocaleString("it-IT");
    const verdict = (p, h) => {
      if (p == null || h == null) return "";
      const d = h - p;
      return Math.abs(d) <= 0.03 ? `<span class="up">in linea</span>` : d > 0 ? `<span class="up">meglio del previsto (+${(d * 100).toFixed(1)})</span>`
        : `<span class="dn">peggio del previsto (${(d * 100).toFixed(1)})</span>`;
    };
    const part = teams ? bt.teams : bt.players, rec = teams ? bt.teamsRecent : bt.recent;
    if (!part || !part.picks || !part.picks.n) return "";
    const row = (label, b) => b && b.n ? `<tr><td>${esc(label)}</td><td>${N(b.n)}</td><td>${P(b.p)}</td><td class="${b.hit - b.p >= -0.03 ? "up" : "dn"}">${P(b.hit)}</td></tr>` : "";
    const groups = teams
      ? Object.values(part.byMarket).map(b => row(b.label, b.picks)).join("")
      : Object.values(part.picks.byStat).sort((a, b) => b.n - a.n).map(b => row(b.label, b)).join("");
    const calib = part.calib.filter(b => b.n >= 30).map(b => `<tr><td>${Math.round(b.lo * 100)}–${Math.round(b.lo * 100) + 10}%</td><td>${N(b.n)}</td>
      <td class="pkp" style="--p:${Math.round(b.hit * 100)}%">${P(b.hit)}</td></tr>`).join("");
    const body = `
      <div class="btsum">
        <div><b>${P(part.picks.hit)}</b><span>occasioni riuscite</span><small>previste in media ${P(part.picks.p)} · ${N(part.picks.n)} casi</small>${verdict(part.picks.p, part.picks.hit)}</div>
        ${rec && rec.n ? `<div><b>${P(rec.hit)}</b><span>ultimi 30 giorni</span><small>previste ${P(rec.p)} · ${N(rec.n)} casi</small>${verdict(rec.p, rec.hit)}</div>` : ""}
      </div>
      <h3>Occasioni per ${teams ? "tipo di previsione" : "statistica"}</h3>
      <div class="scroll"><table class="pkt"><tr><th>${teams ? "Tipo" : "Statistica"}</th><th>Casi</th><th>Prevista</th><th>Riuscita</th></tr>${groups}</table></div>
      <h3>Tutte le previsioni, per probabilità data <small class="nt">(un modello affidabile ha la colonna "Successo" vicina alla probabilità)</small></h3>
      <div class="scroll"><table class="pkt"><tr><th>Probabilità data</th><th>Previsioni</th><th>Successo reale</th></tr>${calib}</table></div>`;
    const note = `Per ogni partita già giocata (${(bt.seasons || []).join(" e ")}, ${N(bt.n_games)} partite di ${esc(sportName)}) le proiezioni sono state rifatte
      con lo stesso modello dell'app usando <b>solo i dati disponibili prima di quella partita</b>, e confrontate con com'è andata.
      "Occasioni" = quello che questa pagina avrebbe mostrato con la probabilità minima di partenza (${bt.sport === "nba" || bt.sport === "lba" ? 70 : 65}%).
      ${teams ? "" : "Contano solo i giocatori scesi in campo: se uno non gioca o esce subito la previsione non vale, come nell'app."}
      Calcolato all'ultimo aggiornamento dei dati.`;
    return Adv.section("bt:" + (teams ? "t" : "p"), "Quanto ci azzecca il modello", body, note);
  }

  /* openMatch(casa, ospite): toccando una partita si apre il confronto fra le due squadre */
  function bindMore(rerun, openMatch) {
    const b = document.getElementById("pkMore");
    if (b) b.onclick = () => { state.all = !state.all; rerun(); };
    if (openMatch) document.querySelectorAll("tr[data-cmp]").forEach(tr => tr.onclick = () => openMatch(...tr.dataset.cmp.split("|")));
  }

  const css = `
  .pksel { display: flex; gap: 10px; flex: 1 1 100%; flex-wrap: wrap; }
  .pksel select { flex: 1 1 180px; }
  table.pkt td:first-child { max-width: none; white-space: normal; overflow: visible; }
  table.pkt td { vertical-align: middle; }
  table.pkt .pkm { display: block; color: var(--muted); font-size: 11.5px; font-family: inherit; margin-top: 2px; font-weight: 400; }
  table.pkt .pkm .ph { width: 14px; height: 14px; }
  table.pkt td.pkl { text-align: left; font-family: inherit; }
  table.pkt td.pkl b { font-family: var(--mono); color: var(--accent2); }
  table.pkt td.pkl b.pkt1 { color: var(--text); font-family: inherit; font-weight: 600; }
  table.pkt td.pkh { white-space: nowrap; }
  .btsum { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
  .btsum > div { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; display: grid; gap: 2px; }
  .btsum b { font-family: var(--mono); font-size: 26px; color: var(--accent2); }
  .btsum span { font-weight: 600; } .btsum small { color: var(--muted); font-size: 12px; }
  table.pkt td.pkh { font-size: 12px; line-height: 1.5; }
  table.pkt td.pkp { font-weight: 700; background: linear-gradient(90deg, rgba(62,207,142,.18) var(--p), transparent var(--p)); }
  @media (max-width: 600px) {
    .tabs { display: grid; grid-template-columns: repeat(3, 1fr); }
    table.pkt td, table.pkt th { padding: 7px 4px; }
    table.pkt .who .ph.pl.s { display: none; }
  }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  window.Picks = { render, bindMore, nextGames, soccerMarkets, basketMarkets, backtest };
})();
