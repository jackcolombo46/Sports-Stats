/* Statistiche del giocatore dalla cronaca delle partite (vedi tools/pbp/update_pbp.py):
   - basket "Per quarto": media a partita di ogni statistica nel 1°, 2°, 3°, 4° quarto (e supplementari) e minuti per quarto;
   - calcio "Minuti della partita": in quali fasce di 15 minuti segna, tira, fa assist, commette o subisce falli, viene ammonito,
     confrontate con i minuti in campo in quella fascia (chi entra dalla panchina gioca solo i finali).
   I file si scaricano solo quando si apre la sezione. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const dec = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace(".", ",");
  const FILES = new Map();     // url → promessa del json
  const state = { stat: { basket: "pts", soccer: "G" }, season: null };
  let CUR = null;              // configurazione della sezione mostrata

  const BSTATS = [["pts", "Punti", "punti"], ["reb", "Rimbalzi", "rimbalzi"], ["ast", "Assist", "assist"], ["fg3m", "Triple", "triple"],
                  ["stl", "Rubate", "rubate"], ["blk", "Stoppate", "stoppate"], ["tov", "Palle perse", "palle perse"], ["min", "Minuti", "minuti"]];
  const SSTATS = [["G", "Gol", "gol"], ["SH", "Tiri", "tiri"], ["T", "Tiri in porta", "tiri in porta"], ["A", "Assist", "assist"],
                  ["F", "Falli commessi", "falli commessi"], ["W", "Falli subiti", "falli subiti"], ["Y", "Ammonizioni", "ammonizioni"]];
  const BUCKETS = [[1, 15, "1-15'"], [16, 30, "16-30'"], [31, 45, "31-45'+"], [46, 60, "46-60'"], [61, 75, "61-75'"], [76, 90, "76-90'+"], [91, 120, "Suppl."]];

  function load(url) {
    if (!FILES.has(url)) FILES.set(url, fetch(url, { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null));
    return FILES.get(url);
  }

  /* cfg: { sport: "basket"|"soccer", pid, name, seasons:[{season, teams:[...], games:n}], gameLen } */
  function section(cfg) {
    CUR = cfg;
    const title = cfg.sport === "basket" ? "Statistiche per quarto" : "Minuti della partita";
    const note = cfg.sport === "basket"
      ? "Medie a partita in ogni quarto, ricavate dalla cronaca delle partite (azione per azione). I minuti per quarto sono ricostruiti dai cambi."
      : "In quali momenti della partita compie le sue azioni, dalla telecronaca di ogni partita. Fasce di 15 minuti; i recuperi contano nell'ultima fascia del tempo.";
    return Adv.section("splits", title, `<div id="splitsBody"><div class="advnote">Caricamento…</div></div>`, note);
  }

  /* dopo aver messo la pagina: carica i dati se la sezione è aperta, o quando la si apre */
  function mount() {
    const body = document.getElementById("splitsBody");
    if (!body || !CUR) return;
    const btn = body.closest(".advwrap").querySelector("[data-adv]");
    const go = () => { if (btn.getAttribute("aria-expanded") === "true") draw(CUR); };
    btn.addEventListener("click", () => setTimeout(go, 0));
    go();
  }

  async function draw(cfg) {
    const body = document.getElementById("splitsBody");
    if (!body) return;
    const seasons = cfg.seasons.filter(s => s.teams.length);
    if (!seasons.length) { body.innerHTML = `<div class="advnote">Nessuna partita giocata nelle ultime due stagioni.</div>`; return; }
    const season = seasons.some(s => s.season === state.season) ? state.season : seasons[0].season;
    const S = seasons.find(s => s.season === season);
    const files = await Promise.all(S.teams.map(t => load(`data/pbp/${season}/${t}.json`)));
    if (cfg !== CUR || !document.getElementById("splitsBody")) return;   // nel frattempo si è cambiata pagina
    const sel = seasons.length > 1 ? `<select id="splSeason" class="splsel">${seasons.map(s => `<option value="${s.season}"${s.season === season ? " selected" : ""}>Stagione ${s.season}</option>`).join("")}</select>` : "";
    body.innerHTML = cfg.sport === "basket" ? basket(cfg, files, S, sel) : soccer(cfg, files, S, sel);
    const ss = document.getElementById("splSeason");
    if (ss) ss.onchange = () => { state.season = ss.value; draw(cfg); };
    body.querySelectorAll("[data-spl]").forEach(b => b.onclick = () => { state.stat[cfg.sport] = b.dataset.spl; draw(cfg); });
  }

  const chips = (list, cur) => `<div class="thchips">${list.map(([k, l]) => `<button class="thc${k === cur ? " on" : ""}" data-spl="${k}" style="--c:var(--line)">${esc(l)}</button>`).join("")}</div>`;
  const pp = n => `${n} ${n === 1 ? "partita" : "partite"}`;
  const coverage = (n, tot) => (n < tot ? ` Cronaca disponibile per ${n} partite su ${tot}: le altre si aggiungono con i prossimi aggiornamenti.` : "");

  function bars(labels, vals, fmt, sub) {
    const max = Math.max(...vals, 0.0001);
    const best = vals.indexOf(Math.max(...vals));
    return `<div class="splbars">${labels.map((l, i) => `<div class="splb${i === best && vals[i] > 0 ? " best" : ""}">
      <span class="splv">${fmt(vals[i])}</span><div class="splcol"><i style="height:${Math.max(2, vals[i] / max * 100)}%"></i></div>
      <span class="spll">${esc(l)}</span>${sub ? `<span class="spls">${sub[i]}</span>` : ""}</div>`).join("")}</div>`;
  }

  // ---------------------------------------------------------- basket
  function basket(cfg, files, S, sel) {
    const per = {}, games = new Set();
    for (const f of files) {
      if (!f) continue;
      const ix = Object.fromEntries(f.cols.map((c, i) => [c, i]));
      for (const r of f.rows) {
        if (String(r[ix.pid]) !== String(cfg.pid)) continue;
        games.add(r[ix.gid]);
        const p = per[r[ix.per]] ||= { min: 0, pts: 0, reb: 0, ast: 0, fg3m: 0, stl: 0, blk: 0, tov: 0 };
        for (const k in p) p[k] += +r[ix[k]] || 0;
      }
    }
    const n = games.size;
    if (!n) return `${sel}<div class="advnote">La cronaca delle sue partite di questa stagione non è ancora stata scaricata: arriva con i prossimi aggiornamenti automatici.</div>`;
    const P = [1, 2, 3, 4].concat(per[5] ? [5] : []);
    const lbl = p => (p === 5 ? "Suppl." : p + "° q.");
    const avg = (p, k) => (per[p] ? per[p][k] : 0) / n;
    const k = state.stat.basket;
    const st = BSTATS.find(x => x[0] === k);
    const vals = P.map(p => avg(p, k));
    const tot = vals.reduce((a, b) => a + b, 0);
    const best = P[vals.indexOf(Math.max(...vals))];
    const rate = P.map(p => (per[p] && per[p].min > 0 ? per[p][k] / per[p].min * 10 : 0));
    const sub = k === "min" ? null : rate.map(v => `${dec(v)} ogni 10'`);
    const regular = P.filter(p => p <= 4), half2 = [3, 4].reduce((a, p) => a + avg(p, k), 0);
    const say = tot > 0 ? (k === "min"
      ? `Gioca in media <b>${dec(tot)} minuti</b>: di più nel <b>${lbl(best).replace(" q.", " quarto")}</b> (${dec(avg(best, k))}).`
      : `Nel <b>${lbl(best).replace(" q.", " quarto")}</b> fa il <b>${Math.round(avg(best, k) / tot * 100)}%</b> dei suoi ${st[2]} (${dec(avg(best, k))} a partita).
         Secondo tempo: ${Math.round(half2 / tot * 100)}% del totale.`) : `Nessun valore registrato per questa statistica.`;
    const table = `<div class="scroll"><table class="spltab"><tr><th>Quarto</th>${BSTATS.map(([, l]) => `<th>${esc(l === "Palle perse" ? "Perse" : l)}</th>`).join("")}</tr>
      ${P.map(p => `<tr><td>${lbl(p)}</td>${BSTATS.map(([kk]) => {
        const v = avg(p, kk), mx = Math.max(...regular.map(q => avg(q, kk)));
        return `<td class="${p <= 4 && v === mx && v > 0 ? (kk === "tov" ? "dn" : "up") : ""}">${dec(v)}</td>`; }).join("")}</tr>`).join("")}
      <tr class="spltot"><td>Partita</td>${BSTATS.map(([kk]) => `<td>${dec(P.reduce((a, p) => a + avg(p, kk), 0))}</td>`).join("")}</tr></table></div>`;
    return `${sel}${chips(BSTATS.map(([a, b]) => [a, b]), k)}
      ${bars(P.map(lbl), vals, v => dec(v), sub)}
      <p class="thx">${say}</p>
      <h4 class="splh">Tutte le statistiche, media a partita</h4>${table}
      <div class="advnote">${pp(n)} con la cronaca.${coverage(n, S.games)} "ogni 10'" = quanto produce per 10 minuti in campo in quel quarto. Supplementari: media su tutte le partite.</div>`;
  }

  // ---------------------------------------------------------- calcio
  function soccer(cfg, files, S, sel) {
    const ev = BUCKETS.map(() => ({ G: 0, A: 0, T: 0, S: 0, B: 0, F: 0, W: 0, Y: 0, R: 0 }));
    const minIn = BUCKETS.map(() => 0);
    const all = { G: [], SH: [], T: [], A: [], F: [], W: [], Y: [] };
    let n = 0, extra = false;
    const bucketOf = m => (m <= 45 ? Math.min(2, Math.floor((Math.max(m, 1) - 1) / 15)) : m <= 90 ? Math.min(5, 3 + Math.floor((m - 46) / 15)) : 6);
    for (const f of files) {
      if (!f) continue;
      for (const g of Object.values(f.games || {})) {
        const x = g[String(cfg.pid)];
        if (!x) continue;
        n++;
        const [tin, tout, evs] = x;
        if (tout > 90) extra = true;
        BUCKETS.forEach(([a, b], i) => { minIn[i] += Math.max(0, Math.min(tout, b) - Math.max(tin, a - 1)); });
        for (const e of (evs || "").split(",")) {
          const m = /^(\d+)([A-Z])$/.exec(e);
          if (!m) continue;
          const min = +m[1], c = m[2], bi = bucketOf(min);
          ev[bi][c]++;
          if (all[c]) all[c].push(min);
          if (c === "T" || c === "S" || c === "B") all.SH.push(min);
        }
      }
    }
    if (!n) return `${sel}<div class="advnote">La telecronaca delle sue partite di questa stagione non è ancora stata scaricata: arriva con i prossimi aggiornamenti automatici.</div>`;
    const B = extra ? BUCKETS : BUCKETS.slice(0, 6);
    const k = state.stat.soccer;
    const st = SSTATS.find(x => x[0] === k);
    const cnt = i => (k === "SH" ? ev[i].T + ev[i].S + ev[i].B : ev[i][k]);
    const vals = B.map((_, i) => cnt(i));
    const tot = vals.reduce((a, b) => a + b, 0);
    const sub = B.map((_, i) => (minIn[i] >= 45 ? `${dec(cnt(i) / minIn[i] * 90, 2)} /90'` : "–"));
    const h1 = vals.slice(0, 3).reduce((a, b) => a + b, 0), h2 = tot - h1;
    const late = vals.slice(4).reduce((a, b) => a + b, 0);
    const ms = all[k] || [];
    const avgMin = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
    const best = vals.indexOf(Math.max(...vals));
    const say = tot > 0
      ? `${tot} ${st[2]} in ${pp(n)}: <b>${h1}</b> nel primo tempo e <b>${h2}</b> nel secondo; <b>${late}</b> dopo il 60° (${Math.round(late / tot * 100)}%).
         La fascia con più ${st[2]} è <b>${B[best][2]}</b>${avgMin != null ? `; minuto medio <b>${avgMin}'</b>` : ""}.`
      : `Nessuna azione di questo tipo in ${pp(n)}.`;
    return `${sel}${chips(SSTATS.map(([a, b]) => [a, b]), k)}
      ${bars(B.map(b => b[2]), vals, v => String(v), sub)}
      <p class="thx">${say}</p>
      <h4 class="splh">Minuti in campo per fascia (media a partita)</h4>
      ${bars(B.map(b => b[2]), B.map((_, i) => minIn[i] / n), v => `${Math.round(v)}'`)}
      <div class="advnote">${pp(n)} con la telecronaca.${coverage(n, S.games)} "/90'" = quante ne fa ogni 90 minuti passati in campo in quella fascia
        (serve almeno 45' in totale nella fascia): così chi entra dalla panchina non sembra uno "da finale" solo perché gioca solo il finale.</div>`;
  }

  const css = `
  .splsel { margin-bottom: 8px; }
  .splbars { display: flex; gap: 6px; align-items: flex-end; margin: 6px 0 4px; }
  .splb { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
  .splcol { width: 100%; max-width: 54px; height: 96px; display: flex; align-items: flex-end; background: var(--panel2); border-radius: 6px; overflow: hidden; }
  .splcol i { display: block; width: 100%; background: #3b6ea8; border-radius: 6px 6px 0 0; }
  .splb.best .splcol i { background: var(--accent); }
  .splv { font-family: var(--mono); font-size: 12.5px; font-weight: 700; }
  .splb.best .splv { color: var(--accent2); }
  .spll { color: var(--text); font-size: 11.5px; white-space: nowrap; }
  .spls { color: var(--muted); font-size: 10.5px; white-space: nowrap; font-family: var(--mono); }
  .splh { margin: 14px 0 6px; font-size: 13px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .6px; }
  table.spltab td.up { color: var(--good); font-weight: 700; }
  table.spltab tr.spltot td { border-top: 1px solid var(--line); color: var(--muted); }
  @media (max-width: 600px) { .splbars { gap: 4px; } .spll { font-size: 10.5px; } .spls { font-size: 9.5px; } }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  window.Splits = { section, mount };
})();
