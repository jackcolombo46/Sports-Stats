/* "Ultimi risultati" nella scheda squadra: le ultime partite giocate (dalla più recente) con avversario, casa/trasferta,
   punteggio ed esito, più il riepilogo (vinte, pareggiate, perse). Toccando una partita si apre la scheda dell'avversario. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const SHOW = 5;

  /* games: [{date, opp, home, pf, pa}] in qualsiasi ordine; o: { logo(id, size), name(id), n (quante, default 10) } */
  function block(games, o) {
    const list = [...games].filter(g => g.pf != null && g.pa != null).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, o.n || 10);
    if (!list.length) return `<h3>Ultimi risultati</h3><div class="advnote">Nessuna partita giocata in questa stagione.</div>`;
    const res = g => (g.pf > g.pa ? "V" : g.pf < g.pa ? "P" : "N");
    const cnt = { V: 0, N: 0, P: 0 };
    list.forEach(g => cnt[res(g)]++);
    const sum = [`${cnt.V} ${cnt.V === 1 ? "vinta" : "vinte"}`, cnt.N ? `${cnt.N} ${cnt.N === 1 ? "pareggiata" : "pareggiate"}` : "", `${cnt.P} ${cnt.P === 1 ? "persa" : "perse"}`].filter(Boolean).join(" · ");
    const day = d => new Date(d + "T12:00:00Z").toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    const rows = list.map((g, i) => `<div class="rsr${i >= SHOW ? " rsmore hidden" : ""} click" data-tid="${esc(g.opp)}">
        <span class="rsd">${esc(day(g.date))}</span>
        <span class="rso"><small>${g.home ? "vs" : "@"}</small>${o.logo(g.opp, "s")}<b>${esc(o.name(g.opp))}</b></span>
        <span class="rss">${g.pf}–${g.pa}</span><i class="rsb ${res(g)}">${res(g)}</i></div>`).join("");
    const more = list.length > SHOW ? `<button class="advclose" id="rsMore">Mostra le ultime ${list.length}</button>` : "";
    const strip = [...list].reverse().map(g => `<i class="rsb ${res(g)}">${res(g)}</i>`).join("");
    return `<h3>Ultimi risultati <small class="nt">· ${sum} nelle ultime ${list.length}</small></h3>
      <div class="card rsc"><div class="rsf"><span>Forma</span><span class="rsstrip">${strip}</span><span class="rsnote">dalla più vecchia alla più recente</span></div>${rows}${more}</div>`;
  }

  function bind() {
    const b = document.getElementById("rsMore");
    if (b) b.onclick = () => {
      const open = b.dataset.open !== "1";
      document.querySelectorAll(".rsmore").forEach(r => r.classList.toggle("hidden", !open));
      b.dataset.open = open ? "1" : "0";
      b.textContent = open ? `Mostra solo le ultime ${SHOW}` : `Mostra le ultime ${document.querySelectorAll(".rsr").length}`;
    };
  }

  const css = `
  .rsc { padding: 6px 12px; }
  .rsf { display: flex; align-items: center; gap: 10px; padding: 6px 0 8px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; flex-wrap: wrap; }
  .rsstrip { display: inline-flex; gap: 3px; } .rsnote { font-size: 11px; }
  .rsr { display: grid; grid-template-columns: 92px 1fr auto 26px; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); cursor: pointer; }
  .rsr:last-of-type { border-bottom: 0; }
  .rsr:hover .rso b { color: var(--accent2); }
  .rsd { color: var(--muted); font-size: 12.5px; }
  .rso { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .rso small { color: var(--muted); width: 18px; } .rso b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .rss { font-family: var(--mono); font-weight: 700; }
  .rsb { display: inline-block; width: 22px; height: 22px; line-height: 22px; text-align: center; border-radius: 5px; font-style: normal;
         font-size: 12px; font-weight: 700; color: #0e1116; }
  .rsstrip .rsb { width: 18px; height: 18px; line-height: 18px; font-size: 10.5px; }
  .rsb.V { background: var(--good); } .rsb.P { background: var(--bad); } .rsb.N { background: var(--mid); }
  @media (max-width: 600px) { .rsr { grid-template-columns: 74px 1fr auto 24px; gap: 8px; } .rsd { font-size: 11.5px; } .rsnote { display: none; } }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  window.Results = { block, bind };
})();
