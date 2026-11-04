/* "Generatore": per ogni categoria la schedina più probabile della prossima giornata.
   Parte dalle stesse occasioni della pagina Occasioni (per giocatore e statistica la soglia più alta sopra la probabilità
   minima; per partita e tipo la previsione più ambiziosa), le ordina per probabilità e prende:
   - modo "numero": le N più probabili;
   - modo "quota": le più probabili finché la quota giusta (1 / probabilità combinata) arriva alla quota obiettivo.
   Regole: al massimo una previsione per giocatore; nelle schedine di squadra una per partita (due previsioni di squadra
   della stessa partita sarebbero legate o in contrasto, es. "Vince Inter" e "Como non perde"). */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = p => (p * 100).toFixed(p < 0.1 ? 1 : 0).replace(".", ",") + "%";
  const q2 = v => v.toFixed(2).replace(".", ",");
  const state = { mode: "n", n: 3, q: 3, min: null, sport: null };
  const QUOTE = [1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 20];
  let LAST = {};   // schedine mostrate (per il pulsante "Aggiungi")

  function build(list, keyOf) {
    const sorted = [...list].sort((a, b) => b.prob - a.prob || (b.line || 0) - (a.line || 0));
    const used = new Set(), legs = [];
    let P = 1;
    for (const x of sorted) {
      const k = keyOf(x);
      if (used.has(k)) continue;
      if (state.mode === "n" && legs.length >= state.n) break;
      if (state.mode === "q" && legs.length && 1 / P >= state.q) break;
      used.add(k); legs.push(x); P *= x.prob;
    }
    const short = state.mode === "n" ? legs.length < state.n : 1 / P < state.q;
    return { legs, P, short };
  }

  function sel(id, opts, val) {
    return `<select id="${id}">${opts.map(([v, t]) => `<option value="${v}"${String(v) === String(val) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  }

  /* cfg = configurazione della pagina Occasioni dell'app (picksCfg) */
  function render(cfg) {
    if (state.sport !== cfg.sportName) Object.assign(state, { min: cfg.defMin, sport: cfg.sportName });
    const min = state.min / 100;
    const pool = Picks.pool(cfg, min);
    if (!pool.games.length) return `<div class="msg">Nessuna partita in programma nei prossimi giorni.</div>`;
    const day = utc => new Date(utc).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
    const g0 = pool.games[0], g1 = pool.games[pool.games.length - 1];
    const span = day(g0.utc) === day(g1.utc) ? day(g0.utc) : `${day(g0.utc)} – ${day(g1.utc)}`;
    const when = utc => new Date(utc).toLocaleString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" });

    const filters = `<div class="ldsel">
      ${sel("genMode", [["n", "Per numero"], ["q", "Per quota"]], state.mode)}
      ${state.mode === "n" ? sel("genN", [2, 3, 4, 5, 6].map(v => [v, `${v} previsioni`]), state.n)
        : sel("genQ", QUOTE.map(v => [v, `Quota almeno ${q2(v)}`]), state.q)}
      ${sel("genMin", [50, 55, 60, 65, 70, 75, 80, 85, 90].map(v => [v, `Ogni previsione almeno ${v}%`]), state.min)}</div>`;

    // categorie: tutte insieme, poi una per statistica (giocatori) e una per tipo (squadre)
    const cats = [];
    const pk = x => x.pid, gk = x => x.gid;
    if (pool.players.length) cats.push({ id: "p*", title: "Giocatori · tutte le statistiche", list: pool.players, key: pk });
    for (const [s, lbl] of cfg.stats) { const l = pool.players.filter(x => x.stat === s); if (l.length) cats.push({ id: "p:" + s, title: lbl, list: l, key: pk }); }
    if (pool.teams.length) cats.push({ id: "t*", title: "Squadre · tutti i tipi", list: pool.teams, key: gk });
    for (const grp of [...new Set(pool.teams.map(x => x.group))]) cats.push({ id: "t:" + grp, title: grp, list: pool.teams.filter(x => x.group === grp), key: gk });

    LAST = {};
    const cards = cats.map(c => {
      const r = build(c.list, c.key);
      if (!r.legs.length) return "";
      const items = r.legs.map(x => Picks.slipItem(cfg, x));
      LAST[c.id] = items;
      const allIn = items.every(i => window.Slip && Slip.has(i.key));
      const legs = r.legs.map((x, i) => {
        const it = items[i];
        const who = x.pid != null
          ? `<span class="who">${cfg.photo(x.pid, x.name)}<span>${esc(x.name)}: ${esc(x.label.toLowerCase())} <b>${x.line}+</b><small class="pkm">${cfg.logo(x.tid, "s")} ${esc(it.sub)} · ${esc(when(x.utc))}</small></span></span>`
          : `<span><span class="gtx">${esc(x.text)}</span><small class="pkm">${cfg.logo(x.home, "s")} ${esc(cfg.short(x.home))} – ${cfg.logo(x.away, "s")} ${esc(cfg.short(x.away))} · ${esc(when(x.utc))}</small></span>`;
        return `<li${x.pid != null ? ` class="click" data-pid="${x.pid}" data-name="${esc(x.name)}"` : ""}>${who}<span class="v">${pct(x.prob)}</span></li>`;
      }).join("");
      const note = r.short ? `<div class="gnote">${state.mode === "n" ? `Solo ${r.legs.length} ${r.legs.length === 1 ? "previsione" : "previsioni"} sopra il ${state.min}% in questa categoria.`
        : `Con le previsioni sopra il ${state.min}% non arriva alla quota ${q2(state.q)}.`}</div>` : "";
      return `<div class="card gen">
        <div class="gh"><b>${esc(c.title)}</b><span class="gp"><b>${pct(r.P)}</b><small>quota giusta ${q2(1 / r.P)}</small></span></div>
        <ol>${legs}</ol>${note}
        <button class="genadd${allIn ? " on" : ""}" data-gen="${esc(c.id)}">${allIn ? "✓ Nella schedina" : `Aggiungi alla schedina (${items.length})`}</button></div>`;
    }).join("");

    const head = `<h3 style="margin-top:0">Generatore di schedine · ${esc(span)} <small class="nt">(${pool.games.length} ${pool.games.length === 1 ? "partita" : "partite"})</small></h3>`;
    const how = `Per ogni categoria la schedina più probabile della prossima giornata, dalle stesse previsioni della pagina Occasioni.
      ${state.mode === "n" ? `Prende le ${state.n} previsioni più probabili` : `Aggiunge le previsioni più probabili finché la quota giusta arriva almeno a ${q2(state.q)}`}
      con al massimo una previsione per giocatore (e, per le squadre, una per partita).
      La percentuale in alto è la probabilità che siano giuste tutte (prodotto delle singole): quota giusta = 1 / probabilità.
      Più giocatori della stessa partita possono essere legati fra loro (se la partita va in un certo modo vanno bene o male insieme).`;
    return head + filters + `<div class="advnote" style="margin:8px 0 12px">${how}</div>`
      + (cards ? `<div class="grid gengrid">${cards}</div>` : `<div class="msg">Nessuna previsione sopra il ${state.min}%: prova ad abbassare la probabilità minima.</div>`);
  }

  function bind(rerun) {
    const on = (id, f) => { const el = document.getElementById(id); if (el) el.onchange = () => { f(el.value); rerun(); }; };
    on("genMode", v => { state.mode = v; });
    on("genN", v => { state.n = +v; });
    on("genQ", v => { state.q = +v; });
    on("genMin", v => { state.min = +v; });
    document.querySelectorAll("[data-gen]").forEach(b => b.onclick = () => {
      const list = LAST[b.dataset.gen] || [];
      Slip.addAll(list);
      b.classList.add("on"); b.textContent = "✓ Nella schedina";
    });
  }

  const css = `
  .gengrid { grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); }
  .gen { display: grid; gap: 6px; align-content: start; }
  .gen .gh { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .gen .gh > b { font-size: 15px; }
  .gen .gp { text-align: right; display: grid; } .gen .gp b { font-family: var(--mono); font-size: 22px; color: var(--accent2); line-height: 1.1; }
  .gen .gp small { color: var(--muted); font-size: 11.5px; white-space: nowrap; }
  .gen ol { margin: 0; padding-left: 18px; display: grid; gap: 6px; }
  .gen li { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13.5px; }
  .gen li .v { font-family: var(--mono); color: var(--accent2); }
  .gen li b { color: var(--accent2); font-family: var(--mono); }
  .gen li.click { cursor: pointer; } .gen li.click:hover .who { color: var(--accent2); }
  .gen .pkm { display: block; color: var(--muted); font-size: 11.5px; } .gen .pkm .ph { width: 13px; height: 13px; }
  .gen .gtx { font-weight: 600; }
  .gnote { color: var(--mid); font-size: 12.5px; }
  .genadd { margin-top: 4px; background: var(--accent); color: #fff; border: 0; border-radius: 8px; padding: 9px 12px; font-family: inherit;
            font-weight: 700; font-size: 14px; cursor: pointer; }
  .genadd.on { background: var(--panel2); color: var(--good); border: 1px solid var(--good); }
  @media (max-width: 600px) { .gengrid { grid-template-columns: 1fr; } }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  window.Gen = { render, bind };
})();
