/* Navigazione comune alle quattro app.
   Barra con 5 voci (in basso sul telefono, in alto sul computer): Oggi, Cerca, Confronta, Classifiche, Schedina.
   Alcune voci hanno due viste (es. Oggi: Partite / Occasioni), mostrate come linguette sotto l'intestazione.
   Il titolo in alto ("NBA Stats ▾") apre il menu per cambiare sport.
   Ogni app chiama Nav.init({ sport, go }) e poi Nav.set(modo) quando cambia pagina da sé (es. tocco su un giocatore). */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const SPORTS = [["nba", "NBA"], ["seriea", "Serie A"], ["ucl", "Champions League"], ["lba", "Serie A basket (LBA)"]];

  const ICON = {
    today: '<path d="M4 6.5h16v13H4z"/><path d="M4 10.5h16M8.5 3.5v5M15.5 3.5v5"/><circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
    compare: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
    ranks: '<path d="M5 20v-6h4v6M10 20V8h4v12M15 20v-9h4v9"/>',
    slip: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z"/><path d="M9 8.5h6M9 12h6"/>',
  };
  // voce → viste (modi interni dell'app) e linguette mostrate
  const SECTIONS = [
    { id: "today", label: "Oggi", modes: ["today", "picks"], subs: [["today", "Partite"], ["picks", "Occasioni"]] },
    { id: "search", label: "Cerca", modes: ["player", "team"] },
    { id: "compare", label: "Confronta", modes: ["compare"] },
    { id: "ranks", label: "Classifiche", modes: ["table", "leaders"], subs: [["table", "Squadre"], ["leaders", "Giocatori"]] },
    { id: "slip", label: "Schedina", modes: ["slip", "watch", "gen"], subs: [["slip", "Schedina"], ["watch", "Osservati"], ["gen", "Generatore"]] },
  ];
  const secOf = m => SECTIONS.find(s => s.modes.includes(m)) || SECTIONS[0];
  const ALL = SECTIONS.flatMap(s => s.modes);

  let go = () => {}, cur = null, last = {}, badgeN = 0;

  function init(cfg) {
    go = cfg.go;
    // menu degli sport sul titolo
    const h1 = document.querySelector("header h1"), sw = document.querySelector("header .switch");
    if (sw) sw.remove();
    if (h1) {
      const wrap = document.createElement("div");
      wrap.className = "sportsel";
      wrap.innerHTML = `<button class="sportbtn" aria-haspopup="true" aria-expanded="false" title="Cambia sport">${h1.innerHTML} <span class="car">▾</span></button>
        <div class="sportmenu hidden" role="menu">${SPORTS.map(([id, name]) =>
          `<a role="menuitem" href="../${id}/"${id === cfg.sport ? ' class="on"' : ""}>${esc(name)}${id === cfg.sport ? " ✓" : ""}</a>`).join("")}
          <a role="menuitem" href="../" class="all">Tutti gli sport</a></div>`;
      h1.replaceWith(wrap);
      const btn = wrap.querySelector(".sportbtn"), menu = wrap.querySelector(".sportmenu");
      const close = () => { menu.classList.add("hidden"); btn.setAttribute("aria-expanded", "false"); };
      btn.onclick = e => { e.stopPropagation(); menu.classList.toggle("hidden"); btn.setAttribute("aria-expanded", String(!menu.classList.contains("hidden"))); };
      document.addEventListener("click", e => { if (!wrap.contains(e.target)) close(); });
      document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    }
    // barra principale
    const nav = document.createElement("nav");
    nav.className = "bnav";
    nav.innerHTML = SECTIONS.map(s => `<button data-sec="${s.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[s.id]}</svg><span>${s.label}</span>${s.id === "slip" ? '<i class="badge hidden"></i>' : ""}</button>`).join("");
    const header = document.querySelector("header");
    header.after(nav);
    nav.querySelectorAll("button").forEach(b => b.onclick = () => {
      const s = SECTIONS.find(x => x.id === b.dataset.sec);
      // toccando di nuovo la voce attiva si torna alla prima vista (es. Cerca: la ricerca vuota)
      const m = cur && secOf(cur).id === s.id ? (s.subs ? s.subs[0][0] : cur) : (last[s.id] || s.modes[0]);
      go(m, s.id === "search" && cur && secOf(cur).id === "search");
      window.scrollTo({ top: 0 });
    });
    badge(badgeN);
    window.addEventListener("popstate", e => { const m = (e.state && e.state.m) || modeFromHash() || "today"; go(m, false, true); });
    return modeFromHash() || "today";
  }

  const modeFromHash = () => { const h = location.hash.slice(1); return ALL.includes(h) ? h : null; };

  /* da chiamare a ogni cambio di vista: evidenzia la voce, mostra le linguette, aggiorna la cronologia (tasto Indietro) */
  function set(m, fromHistory) {
    const s = secOf(m);
    last[s.id] = m;
    document.querySelectorAll(".bnav button").forEach(b => b.classList.toggle("on", b.dataset.sec === s.id));
    const tabs = document.querySelector(".tabs");
    if (tabs) {
      tabs.innerHTML = s.subs ? s.subs.map(([id, lbl]) => `<button class="tab${id === m ? " on" : ""}" data-mode="${id}">${lbl}${id === "slip" && badgeN ? `<span class="slipn0">${badgeN}</span>` : ""}</button>`).join("") : "";
      tabs.classList.toggle("hidden", !s.subs);
      tabs.querySelectorAll(".tab").forEach(b => b.onclick = () => go(b.dataset.mode));
    }
    if (m !== cur && !fromHistory) {
      try { history[cur ? "pushState" : "replaceState"]({ m }, "", "#" + m); } catch { /* cronologia non disponibile */ }
    }
    cur = m;
  }

  /* numero di previsioni nella schedina, sulla voce in basso e sulla linguetta */
  function badge(n) {
    badgeN = n;
    const b = document.querySelector(".bnav .badge");
    if (b) { b.textContent = n; b.classList.toggle("hidden", !n); }
    const t = document.querySelector('.tab[data-mode="slip"]');
    if (t) t.innerHTML = `Schedina${n ? `<span class="slipn0">${n}</span>` : ""}`;
  }

  const css = `
  header { position: relative; }
  .sportsel { position: relative; }
  .sportbtn { background: none; border: 0; color: var(--text); font-family: inherit; font-weight: 700; font-size: 22px; line-height: 1.2; letter-spacing: .5px; padding: 4px 0; cursor: pointer;
              display: inline-flex; align-items: baseline; gap: 6px; }
  .sportbtn span:not(.car) { color: var(--accent); }
  .sportbtn .car { color: var(--muted); font-size: 15px; }
  .sportmenu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; min-width: 230px; background: var(--panel2);
               border: 1px solid var(--line); border-radius: 12px; padding: 6px; box-shadow: 0 12px 30px rgba(0,0,0,.45); }
  .sportmenu a { display: block; padding: 11px 12px; border-radius: 8px; color: var(--text); text-decoration: none; font-weight: 600; }
  .sportmenu a:hover { background: #263040; } .sportmenu a.on { color: var(--accent2); }
  .sportmenu a.all { color: var(--muted); font-weight: 400; border-top: 1px solid var(--line); border-radius: 0 0 8px 8px; margin-top: 4px; }
  .bnav { position: fixed; left: 0; right: 0; bottom: 0; z-index: 25; display: grid; grid-template-columns: repeat(5, 1fr);
          background: rgba(22,27,34,.96); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
          border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom); }
  .bnav button { position: relative; background: none; border: 0; color: var(--muted); cursor: pointer; font-family: inherit; font-weight: 600; font-size: 11px; line-height: 1.2;
                 display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 0 7px; -webkit-tap-highlight-color: transparent; }
  .bnav button svg { width: 23px; height: 23px; }
  .bnav button.on { color: var(--accent2); }
  .bnav .badge { position: absolute; top: 3px; left: calc(50% + 7px); min-width: 17px; padding: 0 4px; border-radius: 9px; background: var(--accent);
                 color: #fff; font-family: inherit; font-weight: 700; font-size: 10.5px; line-height: 17px; font-style: normal; }
  .tlist { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
  .tbtn { display: flex; align-items: center; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
          padding: 8px 10px; color: var(--text); font-family: inherit; font-weight: 600; font-size: 14px; line-height: 1.25; cursor: pointer; text-align: left; }
  .tbtn:hover { border-color: var(--accent); }
  @media (max-width: 600px) { .tlist { grid-template-columns: repeat(2, 1fr); } .tbtn { font-size: 13px; padding: 7px 8px; gap: 7px; } }
  body { padding-bottom: calc(66px + env(safe-area-inset-bottom)); }
  .tabs .tab { flex: 0 1 auto; }
  @media (max-width: 800px) { .tabs { display: flex; } .tabs .tab { flex: 1; } }
  @media (min-width: 801px) {
    .bnav { position: sticky; top: 0; bottom: auto; display: flex; justify-content: center; gap: 6px; margin-top: 14px; padding: 8px;
            border-top: 0; border-bottom: 1px solid var(--line); }
    .bnav button { flex-direction: row; gap: 8px; font-size: 14.5px; padding: 9px 18px; border-radius: 10px; }
    .bnav button svg { width: 19px; height: 19px; }
    .bnav button:hover { color: var(--text); }
    .bnav button.on { background: var(--panel2); box-shadow: inset 0 -2px 0 var(--accent); }
    .bnav .badge { position: static; margin-left: -2px; }
    body { padding-bottom: 0; }
  }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  window.Nav = { init, set, badge, secOf };
})();
