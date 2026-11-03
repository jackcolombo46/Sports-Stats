/* Schedina: raccoglie previsioni (giocatori o squadre) da Occasioni e dalle schede giocatore,
   calcola la probabilità combinata e, con le quote del bookmaker, se la giocata conviene.
   Salvata nel browser (una schedina per sport). Le probabilità sono quelle del momento in cui si aggiunge. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = p => (p * 100).toFixed(1).replace(".", ",") + "%";
  const num = v => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) && n > 0 ? n : null; };
  const q2 = v => v.toFixed(2).replace(".", ",");
  let KEY = "slip", items = [], meta = { stake: "", total: "" }, onChange = () => {};

  const load = () => {
    try { const j = JSON.parse(localStorage.getItem(KEY)) || {}; items = j.items || []; meta = { stake: "", total: "", ...(j.meta || {}) }; }
    catch { items = []; }
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ items, meta })); } catch { /* memoria non disponibile */ } onChange(); };

  /* sport: chiave per il salvataggio; changed: chiamata quando cambia (per il contatore sulla scheda) */
  function init(sport, changed) { KEY = sport + ".slip"; onChange = changed || (() => {}); load(); onChange(); }
  const has = key => items.some(i => i.key === key);
  const count = () => items.length;

  /* item: { key, kind: "p"|"t", gid, utc, text, sub, prob, pid? } */
  function toggle(item) {
    if (has(item.key)) items = items.filter(i => i.key !== item.key);
    else items.push({ ...item, odds: "", added: new Date().toISOString() });
    save();
    return has(item.key);
  }

  /* pulsante "+" da mettere accanto a una previsione */
  function button(item) {
    if (!item || !item.gid) return "";
    const on = has(item.key);
    return `<button class="slipbtn${on ? " on" : ""}" data-slip="${esc(JSON.stringify(item))}" title="${on ? "Togli dalla schedina" : "Aggiungi alla schedina"}">${on ? "✓" : "+"}</button>`;
  }

  /* collega i pulsanti presenti nella pagina (il clic non apre la riga sotto) */
  function bind(root) {
    (root || document).querySelectorAll("[data-slip]").forEach(b => b.onclick = e => {
      e.stopPropagation(); e.preventDefault();
      const on = toggle(JSON.parse(b.dataset.slip));
      b.classList.toggle("on", on); b.textContent = on ? "✓" : "+";
      b.title = on ? "Togli dalla schedina" : "Aggiungi alla schedina";
    });
  }

  /* ---------------------------------------------------------- pagina Schedina */
  /* stesso giocatore, stessa statistica, stessa partita: "almeno 3" contiene già "almeno 2" → conta solo la soglia più alta */
  function effective(live) {
    const best = {}, dropped = [];
    for (const i of live) {
      if (i.kind !== "p") continue;
      const [, gid, pid, stat, line] = i.key.split("|"), g = `${gid}|${pid}|${stat}`;
      if (!best[g] || +line > best[g].line) best[g] = { line: +line, key: i.key };
    }
    const use = live.filter(i => {
      if (i.kind !== "p") return true;
      const [, gid, pid, stat] = i.key.split("|");
      const keep = best[`${gid}|${pid}|${stat}`].key === i.key;
      if (!keep) dropped.push(i);
      return keep;
    });
    return { use, dropped };
  }

  function summary() {
    const all = items.filter(i => !i.off);
    if (!all.length) return "";
    const { use: live, dropped } = effective(all);
    const P = live.reduce((a, i) => a * i.prob, 1);
    const allOdds = all.every(i => num(i.odds));
    const Qprod = allOdds ? all.reduce((a, i) => a * num(i.odds), 1) : null;   // il bookmaker paga tutte le selezioni
    const Q = num(meta.total) || Qprod;
    const stake = num(meta.stake);
    let verdict = "";
    if (Q) {
      const ev = P * Q - 1;
      verdict = `<div class="slipv ${ev > 0 ? "up" : "dn"}"><b>${ev > 0 ? "Conviene" : "Non conviene"}</b>
        <span>valore atteso ${ev > 0 ? "+" : ""}${(ev * 100).toFixed(1).replace(".", ",")}% della puntata${stake ? ` (${ev > 0 ? "+" : ""}${(ev * stake).toFixed(2).replace(".", ",")} €)` : ""}</span>
        <small>${ev > 0 ? "La quota paga più di quanto vale la probabilità stimata." : `Servirebbe una quota di almeno ${q2(1 / P)}.`}</small></div>`;
    } else verdict = `<div class="slipv"><span>Inserisci le quote del bookmaker (di ogni previsione o quella totale) per sapere se conviene.</span></div>`;
    // previsioni collegate: stessa partita o stesso giocatore
    const byG = {}, byP = {};
    for (const i of live) { (byG[i.gid] ||= []).push(i); if (i.pid) (byP[i.pid] ||= []).push(i); }
    const warn = [];
    if (dropped.length)
      warn.push(`${dropped.map(i => `<b>${esc(i.text)}</b>`).join(", ")}: già compres${dropped.length > 1 ? "e" : "a"} in una soglia più alta dello stesso giocatore, quindi non abbassa la probabilità combinata.`);
    if (Object.values(byP).some(l => l.length > 1))
      warn.push("Ci sono più previsioni sullo <b>stesso giocatore</b>: sono molto legate fra loro (se gioca bene le prende tutte), quindi la probabilità vera è più alta del prodotto e il calcolo è prudente.");
    else if (Object.values(byG).some(l => l.length > 1))
      warn.push("Ci sono più previsioni della <b>stessa partita</b>: possono essere legate fra loro e la probabilità vera può essere un po' diversa dal prodotto.");
    if (live.some(i => new Date(i.utc) < Date.now()))
      warn.push("Alcune partite sono già iniziate o finite: la probabilità è quella di prima della partita.");
    return `<div class="slipsum">
        <div><span>Previsioni</span><b>${all.length}</b></div>
        <div><span>Probabilità combinata</span><b>${pct(P)}</b></div>
        <div><span>Quota giusta</span><b>${q2(1 / P)}</b><small>sotto questa non conviene</small></div>
        <div><span>Quota ${num(meta.total) ? "inserita" : "totale"}</span><b>${Q ? q2(Q) : "–"}</b>${stake && Q ? `<small>vincita ${(stake * Q).toFixed(2).replace(".", ",")} €</small>` : ""}</div>
      </div>${verdict}${warn.map(w => `<div class="warn">⚠ ${w}</div>`).join("")}`;
  }

  function render() {
    if (!items.length) return `<div class="msg">La schedina è vuota.<br>Aggiungi previsioni con il pulsante <b>+</b> nella pagina <b>Occasioni</b>
      o nelle soglie della scheda di un giocatore.</div>`;
    const now = Date.now();
    const rows = [...items].sort((a, b) => (a.utc < b.utc ? -1 : 1)).map(i => {
      const fair = 1 / i.prob, o = num(i.odds);
      const val = o ? (o > fair ? `<span class="up">quota sopra il giusto</span>` : `<span class="dn">quota sotto il giusto</span>`) : "";
      const started = new Date(i.utc) < now;
      return `<div class="slipit${i.off ? " off" : ""}">
        <div class="sliptx"><b>${esc(i.text)}</b><small>${esc(i.sub)} · ${esc(new Date(i.utc).toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}${started ? ' · <span class="dn">iniziata</span>' : ""}</small></div>
        <div class="slipn"><span>Prob.</span><b>${pct(i.prob)}</b></div>
        <div class="slipn"><span>Quota giusta</span><b>${q2(fair)}</b></div>
        <label class="slipq"><span>Quota</span><input inputmode="decimal" data-odds="${esc(i.key)}" value="${esc(i.odds)}" placeholder="es. 1,80"></label>
        <div class="slipact"><button data-off="${esc(i.key)}" title="${i.off ? "Rimetti nel calcolo" : "Escludi dal calcolo senza togliere"}">${i.off ? "↺" : "⏸"}</button><button data-rm="${esc(i.key)}" title="Togli">✕</button></div>
        <div class="slipval">${val}</div></div>`;
    }).join("");
    return `<h3 style="margin-top:0">Schedina</h3>
      <div class="advnote">Probabilità stimate dal modello al momento dell'aggiunta. Quota giusta = 1 / probabilità: se il bookmaker paga di più,
        la giocata conviene in media. La probabilità combinata è il prodotto delle singole.</div>
      <div class="sliplist">${rows}</div>
      <div class="slipopt">
        <label><span>Quota totale <small>(se diversa dal prodotto, es. con bonus)</small></span><input inputmode="decimal" id="slipTotal" value="${esc(meta.total)}" placeholder="facoltativa"></label>
        <label><span>Importo €</span><input inputmode="decimal" id="slipStake" value="${esc(meta.stake)}" placeholder="facoltativo"></label>
        <button id="slipClear">Svuota schedina</button>
      </div>
      <div id="slipSum">${summary()}</div>`;
  }

  /* da chiamare dopo aver messo render() nella pagina; rerender ridisegna tutto */
  function bindPage(rerender) {
    const upd = () => { save(); const s = document.getElementById("slipSum"); if (s) s.innerHTML = summary(); };
    document.querySelectorAll("[data-odds]").forEach(inp => inp.oninput = () => {
      const it = items.find(i => i.key === inp.dataset.odds); if (!it) return;
      it.odds = inp.value; upd();
      const o = num(inp.value), v = inp.closest(".slipit").querySelector(".slipval");
      v.innerHTML = o ? (o > 1 / it.prob ? `<span class="up">quota sopra il giusto</span>` : `<span class="dn">quota sotto il giusto</span>`) : "";
    });
    const t = document.getElementById("slipTotal"), s = document.getElementById("slipStake");
    if (t) t.oninput = () => { meta.total = t.value; upd(); };
    if (s) s.oninput = () => { meta.stake = s.value; upd(); };
    document.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { items = items.filter(i => i.key !== b.dataset.rm); save(); rerender(); });
    document.querySelectorAll("[data-off]").forEach(b => b.onclick = () => { const it = items.find(i => i.key === b.dataset.off); if (it) it.off = !it.off; save(); rerender(); });
    const c = document.getElementById("slipClear");
    if (c) c.onclick = () => { if (confirmClear(c)) { items = []; meta = { stake: "", total: "" }; save(); rerender(); } };
  }
  // doppio tocco per svuotare (niente finestre di conferma del browser)
  function confirmClear(b) {
    if (b.dataset.sure) return true;
    b.dataset.sure = 1; b.textContent = "Tocca di nuovo per svuotare";
    setTimeout(() => { if (document.body.contains(b)) { delete b.dataset.sure; b.textContent = "Svuota schedina"; } }, 3000);
    return false;
  }

  const css = `
  .slipbtn { width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--accent); background: transparent; color: var(--accent2);
             font: 700 15px/1 inherit; cursor: pointer; padding: 0; flex: none; }
  .slipbtn.on { background: var(--accent); color: #fff; }
  .ln.slp { grid-template-columns: 44px 1fr 42px 42px 26px; }
  .tab .slipn0 { display: inline-block; min-width: 18px; margin-left: 5px; padding: 0 5px; border-radius: 9px; background: var(--accent); color: #fff; font-size: 11px; line-height: 18px; }
  .sliplist { display: grid; gap: 8px; }
  .slipit { display: grid; grid-template-columns: 1fr auto auto 96px auto; gap: 10px; align-items: center; background: var(--panel);
            border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
  .slipit.off { opacity: .45; }
  .sliptx b { display: block; } .sliptx small { color: var(--muted); font-size: 12px; }
  .slipn { text-align: center; } .slipn span, .slipq span { display: block; color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; }
  .slipn b { font-family: var(--mono); }
  .slipq input { width: 100%; padding: 6px 8px; }
  .slipact { display: flex; gap: 4px; }
  .slipact button, .slipopt button { background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; cursor: pointer; font: inherit; }
  .slipval { grid-column: 1 / -1; font-size: 12px; } .slipval:empty { display: none; }
  .slipopt { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; margin: 14px 0; }
  .slipopt label { display: grid; gap: 4px; flex: 1 1 160px; font-size: 12.5px; color: var(--muted); }
  .slipopt small { font-size: 11px; }
  .slipsum { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .slipsum > div { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; display: grid; gap: 2px; }
  .slipsum span { color: var(--muted); font-size: 12px; } .slipsum b { font-family: var(--mono); font-size: 22px; color: var(--accent2); }
  .slipsum small { color: var(--muted); font-size: 11.5px; }
  .slipv { margin-top: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; display: grid; gap: 3px; }
  .slipv.up { border-color: var(--good); } .slipv.dn { border-color: var(--bad); }
  .slipv b { font-size: 18px; } .slipv span { color: var(--text); } .slipv small { color: var(--muted); }
  @media (max-width: 600px) {
    .slipit { grid-template-columns: 1fr 1fr 1fr; }
    .sliptx { grid-column: 1 / -1; } .slipact { grid-column: 3; grid-row: 3; justify-content: flex-end; }
    .slipq { grid-column: 1 / 3; grid-row: 3; }
  }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  window.Slip = { init, button, bind, render, bindPage, has, count };
})();
