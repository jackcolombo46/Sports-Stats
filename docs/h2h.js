/* "Scontri diretti" nella pagina Confronta squadre: le ultime partite fra le due squadre (stagione in corso e precedenti
   salvate), con il riepilogo delle vittorie, il punteggio medio e, per ogni partita, i migliori (basket) o i marcatori (calcio). */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const dec = v => (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
  const MAX = 10;

  /* games: [{date, season, home (true = in casa di A), pa, pb, notesA, notesB}]; o: { a, b, name(id), logo(id, size), sport } */
  function block(games, o) {
    const list = [...games].filter(g => g.pa != null && g.pb != null).sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, MAX);
    const title = `<h3>Scontri diretti</h3>`;
    if (!list.length) return title + `<div class="card h2c"><div class="advnote" style="margin:0">Nessuna partita fra le due squadre nelle stagioni salvate.</div></div>`;
    const wa = list.filter(g => g.pa > g.pb).length, wb = list.filter(g => g.pb > g.pa).length, d = list.length - wa - wb;
    const avgA = list.reduce((s, g) => s + g.pa, 0) / list.length, avgB = list.reduce((s, g) => s + g.pb, 0) / list.length;
    const pct = v => `${Math.round(v / list.length * 100)}%`;
    const unit = o.sport === "soccer" ? "gol" : "punti";
    const sum = `<div class="h2s">
        <div class="h2t">${o.logo(o.a, "m")}<b>${esc(o.name(o.a))}</b></div>
        <div class="h2n"><span class="h2w">${wa}</span><small>${wa === 1 ? "vittoria" : "vittorie"}</small></div>
        ${o.sport === "soccer" ? `<div class="h2n"><span class="h2w h2d">${d}</span><small>${d === 1 ? "pareggio" : "pareggi"}</small></div>` : ""}
        <div class="h2n"><span class="h2w">${wb}</span><small>${wb === 1 ? "vittoria" : "vittorie"}</small></div>
        <div class="h2t h2tb"><b>${esc(o.name(o.b))}</b>${o.logo(o.b, "m")}</div></div>
      <div class="h2bar"><i style="width:${pct(wa)};background:var(--good)"></i><i style="width:${pct(d)};background:var(--mid)"></i><i style="width:${pct(wb)};background:var(--bad)"></i></div>
      <div class="h2avg">Media ${unit}: <b>${dec(avgA)}</b> – <b>${dec(avgB)}</b>${o.sport === "soccer" ? ` · totale medio ${dec(avgA + avgB)} gol` : ` · scarto medio ${avgA >= avgB ? esc(o.name(o.a)) : esc(o.name(o.b))} +${dec(Math.abs(avgA - avgB))}`}</div>`;
    const day = d => new Date(d + "T12:00:00Z").toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
    const rows = list.map(g => {
      const r = g.pa > g.pb ? "V" : g.pa < g.pb ? "P" : "N";
      const host = g.home ? o.a : o.b;
      const notes = [g.notesA, g.notesB].some(Boolean)
        ? `<div class="h2x"><span>${esc(g.notesA || "–")}</span><span>${esc(g.notesB || "–")}</span></div>` : "";
      return `<div class="h2r"><div class="h2top"><span class="h2d0">${esc(day(g.date))}<small>in casa di ${esc(o.name(host))}</small></span>
          <span class="h2sc"><b class="${r === "V" ? "up" : r === "P" ? "dn" : ""}">${g.pa}</b> – <b class="${r === "P" ? "up" : r === "V" ? "dn" : ""}">${g.pb}</b></span>
          <i class="rsb ${r}">${r}</i></div>${notes}</div>`;
    }).join("");
    return `${title}<div class="card h2c">${sum}<div class="h2head"><span>Partita</span><span>${esc(o.name(o.a))} – ${esc(o.name(o.b))}</span><span></span></div>${rows}
      <div class="advnote" style="margin:8px 0 0">Ultime ${list.length} partite fra le due squadre nelle stagioni salvate (V/N/P dal punto di vista di ${esc(o.name(o.a))}).
      ${o.sport === "soccer" ? "Sotto il risultato i marcatori." : "Sotto il risultato i migliori marcatori delle due squadre."}</div></div>`;
  }

  const css = `
  .h2c { padding: 12px 14px; }
  .h2s { display: grid; grid-template-columns: 1fr auto auto auto 1fr; gap: 12px; align-items: center; }
  .h2t { display: flex; align-items: center; gap: 8px; min-width: 0; } .h2t b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .h2tb { justify-content: flex-end; text-align: right; }
  .h2n { display: grid; justify-items: center; } .h2n small { color: var(--muted); font-size: 10.5px; }
  .h2w { font-family: var(--mono); font-size: 24px; font-weight: 700; line-height: 1.1; } .h2w.h2d { color: var(--muted); }
  .h2bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; margin: 10px 0 6px; background: var(--panel2); }
  .h2bar i { display: block; height: 100%; }
  .h2avg { color: var(--muted); font-size: 12.5px; } .h2avg b { color: var(--text); font-family: var(--mono); }
  .h2head { display: grid; grid-template-columns: 1fr auto 26px; gap: 10px; color: var(--muted); font-size: 11px; text-transform: uppercase;
            letter-spacing: .6px; margin-top: 12px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
  .h2r { padding: 8px 0; border-bottom: 1px solid var(--line); } .h2r:last-of-type { border-bottom: 0; }
  .h2top { display: grid; grid-template-columns: 1fr auto 26px; gap: 10px; align-items: center; }
  .h2d0 { font-size: 13px; } .h2d0 small { display: block; color: var(--muted); font-size: 11px; }
  .h2sc { font-family: var(--mono); font-size: 16px; } .h2sc b.up { color: var(--good); } .h2sc b.dn { color: var(--bad); }
  .h2x { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 4px; color: var(--muted); font-size: 11.5px; }
  .h2x span:last-child { text-align: right; }
  @media (max-width: 600px) { .h2s { gap: 8px; } .h2t b { display: none; } .h2w { font-size: 20px; } }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  window.H2H = { block };
})();
