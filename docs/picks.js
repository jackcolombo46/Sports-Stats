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

  /* cfg: { ctx, schedule, windowH, project(tid, opp, home), name(tid), short(tid), logo(tid, size), photo(pid, name, size),
            stats: [[codice, etichetta]], skip: Set, minLine: {codice: soglia minima}, defMin, el: {game, stat, min} } */
  function render(cfg) {
    const games = nextGames(cfg.schedule, cfg.windowH);
    if (!games.length) return `<div class="msg">Nessuna partita in programma nei prossimi giorni.</div>`;
    cfg.games = games;
    const items = collect(cfg);

    // filtri
    fill(cfg.el.game, [["", `Tutte le partite (${games.length})`], ...games.map(g => [g.id, `${cfg.short(g.home)} – ${cfg.short(g.away)} · ${whenShort(g.utc)}`])]);
    fill(cfg.el.stat, [["", "Tutte le statistiche"], ...cfg.stats.filter(([s]) => items.some(i => i.stat === s))]);
    if (!cfg.el.min.options.length) fill(cfg.el.min, [50, 55, 60, 65, 70, 75, 80, 85, 90].map(v => [v, `Probabilità almeno ${v}%`]), cfg.defMin);
    const gid = cfg.el.game.value, stat = cfg.el.stat.value, min = +cfg.el.min.value / 100;

    const picks = [];
    for (const it of items) {
      if ((gid && it.gid !== gid) || (stat && it.stat !== stat)) continue;
      const ok = it.lines.filter(l => l.prob >= min);
      if (!ok.length) continue;
      const best = ok.reduce((a, b) => (b.line > a.line ? b : a));
      picks.push({ ...it, line: best.line, prob: best.prob, l10: best.l10 });
    }
    picks.sort((a, b) => b.prob - a.prob || b.line - a.line);

    const first = games[0], last = games[games.length - 1];
    const span = new Date(first.utc).toDateString() === new Date(last.utc).toDateString()
      ? when(first.utc).replace(/,? \d\d:\d\d$/, "") : `${when(first.utc).replace(/,? \d\d:\d\d$/, "")} – ${when(last.utc).replace(/,? \d\d:\d\d$/, "")}`;
    const head = `<h3 style="margin-top:0">Migliori occasioni · ${esc(span)} <small class="nt">(${gid ? "1 partita" : games.length + (games.length === 1 ? " partita" : " partite")})</small></h3>
      <div class="advnote">Per ogni giocatore e statistica la soglia più alta che supera la probabilità scelta. U10 = quante volte l'ha raggiunta nelle ultime 10 partite.
      Tocca un giocatore per la proiezione completa.</div>`;
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
    return head + `<div class="scroll"><table class="pkt"><tr><th>Giocatore</th><th>Previsione</th><th>Prob.</th><th>U10</th></tr>${rows}</table></div>${more}`;
  }

  function bindMore(rerun) {
    const b = document.getElementById("pkMore");
    if (b) b.onclick = () => { state.all = !state.all; rerun(); };
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
  table.pkt td.pkp { font-weight: 700; background: linear-gradient(90deg, rgba(62,207,142,.18) var(--p), transparent var(--p)); }
  @media (max-width: 600px) {
    .tabs { display: grid; grid-template-columns: repeat(3, 1fr); }
    table.pkt td, table.pkt th { padding: 7px 4px; }
    table.pkt .who .ph.pl.s { display: none; }
  }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  window.Picks = { render, bindMore, nextGames };
})();
