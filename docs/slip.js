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
  let HKEY = "slipHist", hist = [], RES = null;

  const load = () => {
    try { const j = JSON.parse(localStorage.getItem(KEY)) || {}; items = j.items || []; meta = { stake: "", total: "", ...(j.meta || {}) }; }
    catch { items = []; }
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ items, meta })); } catch { /* memoria non disponibile */ } onChange(); };

  /* sport: chiave per il salvataggio; changed: chiamata quando cambia (per il contatore sulla scheda) */
  function init(sport, changed) {
    KEY = sport + ".slip"; HKEY = sport + ".slipHist"; onChange = changed || (() => {}); load();
    try { hist = JSON.parse(localStorage.getItem(HKEY)) || []; } catch { hist = []; }
    onChange();
  }
  const saveHist = () => { try { localStorage.setItem(HKEY, JSON.stringify(hist)); } catch { /* memoria non disponibile */ } };

  /* ---------------------------------------------------------- risultati
     r (dall'app, dopo il caricamento dei dati):
       game(gid)  → { done: true, h, a, hs, as } (finita: sigle e punteggio di casa e ospite) | { done: false, live }
       player(gid, pid, stat) → valore nella partita, null se non ha giocato */
  function setResults(r) { RES = r; }
  const FINAL = new Set(["win", "loss", "void", "unk"]);

  /* previsioni di squadra: il testo è sempre uno di quelli generati da Occasioni / Oggi */
  function evalTeam(t, g) {
    const side = n => (n === g.h ? [g.hs, g.as] : n === g.a ? [g.as, g.hs] : null);
    const tot = g.hs + g.as;
    const one = (re, f) => { const m = re.exec(t); if (!m) return undefined; const sd = side(m[1]); return sd ? f(sd, m) : null; };
    let m, r;
    if (t === "Pareggio") return g.hs === g.as;
    if ((r = one(/^Vince (.+)$/, s => s[0] > s[1])) !== undefined) return r;
    if ((r = one(/^(.+) vince con (\d+)\+ (?:gol|punti) di scarto$/, (s, m) => s[0] - s[1] >= +m[2])) !== undefined) return r;
    if ((r = one(/^(.+) non perde$/, s => s[0] >= s[1])) !== undefined) return r;
    if ((r = one(/^(.+) segna almeno (\d+) (?:gol|punti)$/, (s, m) => s[0] >= +m[2])) !== undefined) return r;
    if ((r = one(/^(.+) segna al massimo (\d+) punti$/, (s, m) => s[0] <= +m[2])) !== undefined) return r;
    if ((r = one(/^(.+) non subisce gol$/, s => s[1] === 0)) !== undefined) return r;
    if ((m = /^Over ([\d.]+)/.exec(t))) return tot > +m[1];
    if ((m = /^Under ([\d.]+)/.exec(t))) return tot < +m[1];
    if (/^Gol \(/.test(t)) return g.hs > 0 && g.as > 0;
    if (/^No gol/.test(t)) return !g.hs || !g.as;
    if ((m = /^Almeno (\d+) punti in totale$/.exec(t))) return tot >= +m[1];
    if ((m = /^Al massimo (\d+) punti in totale$/.exec(t))) return tot <= +m[1];
    return null;
  }

  /* esito di una previsione: st = win | loss | void (non ha giocato) | unk | live | todo | wait */
  function outcome(i) {
    if (!RES) return i.res || null;
    let g = null; try { g = RES.game(String(i.gid)); } catch { g = null; }
    if (!g || !g.done) {
      if (i.res && FINAL.has(i.res.st)) return i.res;   // nello storico: esito già salvato, dati non più caricati
      return { st: g && g.live ? "live" : new Date(i.utc) > Date.now() ? "todo" : "wait" };
    }
    const score = `${g.h} ${g.hs}-${g.as} ${g.a}`;
    if (i.kind === "p") {
      const [, gid, pid, stat, line] = i.key.split("|");
      const v = RES.player(gid, pid, stat);
      if (v == null) return { st: "void", det: "non ha giocato" };
      const lbl = (/:\s*(.+?)\s+almeno\s+\d+$/.exec(i.text) || [, ""])[1];
      return { st: v >= +line ? "win" : "loss", det: `${Math.round(v * 100) / 100} ${lbl}`.trim(), score };
    }
    const ok = evalTeam(i.text, g);
    return { st: ok == null ? "unk" : ok ? "win" : "loss", det: `finita ${score}` };
  }
  const BADGE = { win: ["win", "✓ Indovinata"], loss: ["loss", "✗ Sbagliata"], void: ["void", "Nulla"], unk: ["void", "Finita"],
                  live: ["live", "In corso"], todo: ["todo", "Da giocare"], wait: ["todo", "In attesa del risultato"] };
  const badge = r => (r ? `<span class="slipres ${BADGE[r.st][0]}">${BADGE[r.st][1]}${r.det ? ` · <b>${esc(r.det)}</b>` : ""}</span>` : "");

  /* stato di una schedina (previsioni escluse dal calcolo non contano) */
  function slipState(list, m) {
    const act = list.filter(i => !i.off).map(i => ({ i, r: outcome(i) }));
    const n = st => act.filter(x => x.r && x.r.st === st).length;
    const win = n("win"), loss = n("loss"), voids = n("void") + n("unk");
    const open = act.length - win - loss - voids;
    const state = loss ? "lost" : !open && win ? "won" : !open ? "void" : "open";
    // vincita: prodotto delle quote delle previsioni non annullate (o quota totale, se non ce ne sono di annullate)
    const valid = act.filter(x => !x.r || (x.r.st !== "void" && x.r.st !== "unk"));
    const allOdds = valid.length && valid.every(x => num(x.i.odds));
    const Q = voids ? (allOdds ? valid.reduce((a, x) => a * num(x.i.odds), 1) : null)
      : num(m.total) || (allOdds ? valid.reduce((a, x) => a * num(x.i.odds), 1) : null);
    const stake = num(m.stake);
    return { act, win, loss, voids, open, state, Q, stake, pay: state === "won" && stake && Q ? stake * Q : state === "lost" ? 0 : null };
  }
  const STATE = { won: ["up", "Schedina vinta"], lost: ["dn", "Schedina persa"], open: ["", "Schedina aperta"], void: ["", "Schedina annullata"] };
  const eur = v => v.toFixed(2).replace(".", ",") + " €";
  function stateLine(S) {
    const parts = [`${S.win} ${S.win === 1 ? "indovinata" : "indovinate"}`, `${S.loss} ${S.loss === 1 ? "sbagliata" : "sbagliate"}`];
    if (S.voids) parts.push(`${S.voids} null${S.voids === 1 ? "a" : "e"}`);
    if (S.open) parts.push(`${S.open} da giocare`);
    const [cls, txt] = STATE[S.state];
    const money = S.state === "won" && S.pay ? ` · vincita <b>${eur(S.pay)}</b>` : S.state === "lost" && S.stake ? ` · persi ${eur(S.stake)}` : "";
    return `<div class="slipst ${cls}"><b>${txt}</b><span>${parts.join(" · ")}${money}</span></div>`;
  }
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
    if (!items.length) return `<div class="msg">La schedina è vuota.<br>Aggiungi previsioni con il pulsante <b>+</b> nella pagina <b>Oggi</b>
      (partite e occasioni) o nelle soglie della scheda di un giocatore.</div>` + history();
    const rows = [...items].sort((a, b) => (a.utc < b.utc ? -1 : 1)).map(i => {
      const fair = 1 / i.prob, o = num(i.odds);
      const val = o ? (o > fair ? `<span class="up">quota sopra il giusto</span>` : `<span class="dn">quota sotto il giusto</span>`) : "";
      const r = outcome(i);
      return `<div class="slipit${i.off ? " off" : ""}${r ? " r-" + BADGE[r.st][0] : ""}">
        <div class="sliptx"><b>${esc(i.text)}</b><small>${esc(i.sub)} · ${esc(new Date(i.utc).toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</small>${badge(r)}</div>
        <div class="slipn"><span>Prob.</span><b>${pct(i.prob)}</b></div>
        <div class="slipn"><span>Quota giusta</span><b>${q2(fair)}</b></div>
        <label class="slipq"><span>Quota</span><input inputmode="decimal" data-odds="${esc(i.key)}" value="${esc(i.odds)}" placeholder="es. 1,80"></label>
        <div class="slipact"><button data-off="${esc(i.key)}" title="${i.off ? "Rimetti nel calcolo" : "Escludi dal calcolo senza togliere"}">${i.off ? "↺" : "⏸"}</button><button data-rm="${esc(i.key)}" title="Togli">✕</button></div>
        <div class="slipval">${val}</div></div>`;
    }).join("");
    return `<h3 style="margin-top:0">Schedina</h3>
      <div class="advnote">Probabilità stimate dal modello al momento dell'aggiunta. Quota giusta = 1 / probabilità: se il bookmaker paga di più,
        la giocata conviene in media. La probabilità combinata è il prodotto delle singole.</div>
      ${stateLine(slipState(items, meta))}
      <div class="sliplist">${rows}</div>
      <div class="slipopt">
        <label><span>Quota totale <small>(se diversa dal prodotto, es. con bonus)</small></span><input inputmode="decimal" id="slipTotal" value="${esc(meta.total)}" placeholder="facoltativa"></label>
        <label><span>Importo €</span><input inputmode="decimal" id="slipStake" value="${esc(meta.stake)}" placeholder="facoltativo"></label>
        <button id="slipArch" class="pri" title="Sposta la schedina nello storico e la svuota">Salva nello storico</button>
        <button id="slipClear">Svuota schedina</button>
      </div>
      <div id="slipSum">${summary()}</div>` + history();
  }

  /* ---------------------------------------------------------- storico delle schedine salvate */
  function history() {
    if (!hist.length) return `<h3>Storico schedine</h3><div class="advnote">Qui finiscono le schedine salvate con "Salva nello storico":
      esito, quote, vincite e quante previsioni hai indovinato nel tempo.</div>`;
    let changed = false;
    const H = hist.map(h => {
      // aggiorna gli esiti salvati quando arrivano i risultati
      for (const i of h.items) { const r = outcome(i); if (r && FINAL.has(r.st) && (!i.res || i.res.st !== r.st || i.res.det !== r.det)) { i.res = r; changed = true; } }
      return { h, S: slipState(h.items, h.meta) };
    });
    if (changed) saveHist();
    const closed = H.filter(x => x.S.state === "won" || x.S.state === "lost");
    const staked = closed.filter(x => x.S.stake), spent = staked.reduce((a, x) => a + x.S.stake, 0);
    const won = staked.reduce((a, x) => a + (x.S.pay || 0), 0);
    const preds = H.flatMap(x => x.S.act).filter(x => x.r && (x.r.st === "win" || x.r.st === "loss"));
    const hit = preds.filter(x => x.r.st === "win").length, expP = preds.reduce((a, x) => a + x.i.prob, 0) / (preds.length || 1);
    const tiles = `<div class="slipsum">
      <div><span>Schedine</span><b>${hist.length}</b><small>${H.filter(x => x.S.state === "won").length} vinte · ${H.filter(x => x.S.state === "lost").length} perse · ${H.filter(x => x.S.state === "open").length} aperte</small></div>
      <div><span>Previsioni indovinate</span><b>${preds.length ? pct(hit / preds.length) : "–"}</b><small>${hit} su ${preds.length}${preds.length ? ` · il modello diceva ${pct(expP)}` : ""}</small></div>
      ${spent ? `<div><span>Giocati / vinti</span><b>${eur(spent)}</b><small>vinti ${eur(won)}</small></div>
      <div><span>Saldo</span><b class="${won - spent >= 0 ? "up" : "dn"}">${won - spent >= 0 ? "+" : ""}${eur(won - spent)}</b><small>sulle schedine chiuse con importo</small></div>` : ""}</div>`;
    const list = H.map(({ h, S }) => {
      const [cls, txt] = STATE[S.state];
      const when = new Date(h.at).toLocaleString("it-IT", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
      const money = S.state === "won" && S.pay ? `+${eur(S.pay)}` : S.state === "lost" && S.stake ? `−${eur(S.stake)}` : S.stake ? eur(S.stake) : "";
      return `<details class="sliph"><summary><span class="slipst ${cls}"><b>${txt.replace("Schedina ", "")}</b></span>
          <span class="shm">${S.act.length} previsioni${S.Q ? ` · quota ${q2(S.Q)}` : ""} · ${S.win}/${S.act.length - S.voids} indovinate<small>salvata il ${esc(when)}</small></span>
          <span class="shv ${cls}">${money}</span></summary>
        <div class="sliphl">${h.items.map(i => { const r = outcome(i); return `<div class="${i.off ? "off" : ""}"><b>${esc(i.text)}</b>
          <small>${esc(i.sub)} · prob. ${pct(i.prob)}${num(i.odds) ? ` · quota ${q2(num(i.odds))}` : ""}${i.off ? " · esclusa dal calcolo" : ""}</small>${badge(r)}</div>`; }).join("")}</div>
        <div class="sliphb"><button data-hback="${h.id}">Rimetti nella schedina</button><button data-hrm="${h.id}">Elimina</button></div></details>`;
    }).join("");
    return `<h3>Storico schedine</h3>${tiles}<div class="sliphist">${list}</div>`;
  }
  function archive() {
    if (!items.length) return;
    hist.unshift({ id: Date.now(), at: new Date().toISOString(), meta: { ...meta }, items: items.map(i => { const r = outcome(i); return { ...i, res: r && FINAL.has(r.st) ? r : null }; }) });
    saveHist();
    items = []; meta = { stake: "", total: "" }; save();
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
    const a = document.getElementById("slipArch");
    if (a) a.onclick = () => { archive(); rerender(); };
    document.querySelectorAll("[data-hrm]").forEach(b => b.onclick = () => {
      if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Tocca di nuovo per eliminare"; return; }
      hist = hist.filter(h => String(h.id) !== b.dataset.hrm); saveHist(); rerender();
    });
    document.querySelectorAll("[data-hback]").forEach(b => b.onclick = () => {
      const h = hist.find(x => String(x.id) === b.dataset.hback); if (!h) return;
      if (items.length) archive();   // la schedina attuale non va persa: finisce nello storico
      items = h.items.map(({ res, ...i }) => i); meta = { ...h.meta };
      hist = hist.filter(x => x !== h); saveHist(); save(); rerender(); window.scrollTo({ top: 0 });
    });
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
             font-family: inherit; font-weight: 700; font-size: 15px; line-height: 1; cursor: pointer; padding: 0; flex: none; }
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
  .sliphl .slipres { justify-self: start; }
  .slipres { display: table; margin-top: 5px; padding: 2px 8px; border-radius: 6px; font-size: 12px; background: var(--panel2); color: var(--muted); }
  .slipres b { font-weight: 700; }
  .slipres.win { background: rgba(62,207,142,.16); color: var(--good); } .slipres.loss { background: rgba(239,93,93,.16); color: var(--bad); }
  .slipres.live { background: rgba(239,93,93,.9); color: #fff; }
  .slipit.r-win { border-color: rgba(62,207,142,.6); box-shadow: inset 3px 0 0 var(--good); }
  .slipit.r-loss { border-color: rgba(239,93,93,.6); box-shadow: inset 3px 0 0 var(--bad); }
  .slipst { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; margin: 10px 0; padding: 10px 12px; border-radius: 12px; background: var(--panel); border: 1px solid var(--line); }
  .slipst b { font-size: 16px; } .slipst span { color: var(--muted); font-size: 13px; } .slipst span b { font-size: 13px; color: var(--text); }
  .slipst.up { border-color: var(--good); } .slipst.up b { color: var(--good); } .slipst.dn { border-color: var(--bad); } .slipst.dn > b { color: var(--bad); }
  .slipopt button.pri { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
  .sliphist { display: grid; gap: 8px; margin-top: 10px; }
  .sliph { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
  .sliph summary { display: grid; grid-template-columns: 74px 1fr auto; gap: 10px; align-items: center; padding: 10px 12px; cursor: pointer; list-style: none; }
  .sliph summary::-webkit-details-marker { display: none; }
  .sliph summary .slipst { margin: 0; padding: 0; border: 0; background: none; }
  .sliph .shm { font-size: 13.5px; } .sliph .shm small { display: block; color: var(--muted); font-size: 11.5px; }
  .sliph .shv { font-family: var(--mono); font-weight: 700; } .shv.up { color: var(--good); } .shv.dn { color: var(--bad); }
  .sliphl { display: grid; gap: 8px; padding: 0 12px 10px; border-top: 1px solid var(--line); padding-top: 10px; }
  .sliphl > div { display: grid; } .sliphl > div.off { opacity: .5; } .sliphl small { color: var(--muted); font-size: 12px; }
  .sliphb { display: flex; gap: 8px; justify-content: flex-end; padding: 0 12px 12px; }
  .sliphb button { background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; cursor: pointer; font: inherit; font-size: 13px; }
  .slipsum b.up { color: var(--good); } .slipsum b.dn { color: var(--bad); }
  @media (max-width: 600px) {
    .sliph summary { grid-template-columns: 62px 1fr auto; gap: 8px; }
    .slipit { grid-template-columns: 1fr 1fr 1fr; }
    .sliptx { grid-column: 1 / -1; } .slipact { grid-column: 3; grid-row: 3; justify-content: flex-end; }
    .slipq { grid-column: 1 / 3; grid-row: 3; }
  }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  /* aggiunge più previsioni insieme (quelle già presenti restano); restituisce quante sono state aggiunte */
  function addAll(list) {
    let n = 0;
    for (const it of list) if (!has(it.key)) { items.push({ ...it, odds: "", added: new Date().toISOString() }); n++; }
    if (n) save();
    return n;
  }

  window.Slip = { init, button, bind, render, bindPage, has, count, setResults, evalTeam, addAll };
})();
