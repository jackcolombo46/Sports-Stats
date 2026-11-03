/* Statistiche avanzate: parti comuni a tutte le app.
   - section(): blocco "Statistiche avanzate" chiuso, si apre con un pulsante
   - table():   tabella di una squadra o di un giocatore (valore, posizione, media del campionato)
   - compare(): confronto fra due squadre (verde = meglio, rosso = peggio, grigio = pari)
   Una metrica è { key, label, group, fmt, dir, help, val(entità) }:
   dir 1 = più alto è meglio, -1 = più basso è meglio, 0 = nessun giudizio (es. il ritmo). */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ok = v => v != null && isFinite(v);

  const FMT = {
    pct: v => (v * 100).toFixed(1) + "%",
    pv: v => v.toFixed(1) + "%",
    n0: v => Math.round(v).toString(),
    n1: v => v.toFixed(1),
    n2: v => v.toFixed(2),
    sn1: v => (v > 0 ? "+" : "") + v.toFixed(1),
    sn2: v => (v > 0 ? "+" : "") + v.toFixed(2),
    spct: v => (v > 0 ? "+" : "") + (v * 100).toFixed(1) + "%",
  };
  const show = (m, v) => ok(v) ? (FMT[m.fmt] || FMT.n1)(v) : "—";
  const ord = n => n + "ª";

  // le sezioni aperte restano aperte passando da un giocatore all'altro (solo finché la pagina è aperta)
  const open = new Set();

  function groupsOf(metrics) {
    const out = [];
    for (const m of metrics) {
      let g = out.find(x => x.title === m.group);
      if (!g) out.push(g = { title: m.group, items: [] });
      g.items.push(m);
    }
    return out;
  }

  function legend(metrics) {
    const items = metrics.filter(m => m.help).map(m => `<li><b>${esc(m.label)}</b>: ${esc(m.help)}</li>`).join("");
    return items ? `<details class="advleg"><summary>Cosa significano</summary><ul>${items}</ul></details>` : "";
  }

  /* blocco a scomparsa; id distingue giocatore/squadra per ricordare se era aperto */
  function section(id, title, body, note) {
    const on = open.has(id.split(":")[0]);
    return `<div class="advwrap">
      <button class="advbtn" data-adv="${esc(id)}" aria-expanded="${on}"><span class="arw">${on ? "▾" : "▸"}</span> ${esc(title)}<span class="advhint">${on ? "nascondi" : "mostra"}</span></button>
      <div class="advbody${on ? "" : " hidden"}">${note ? `<div class="advnote">${note}</div>` : ""}${body}
        <button class="advclose" data-advclose>▴ Chiudi</button></div></div>`;
  }

  function setOpen(b, on) {
    const kind = b.dataset.adv.split(":")[0];
    b.nextElementSibling.classList.toggle("hidden", !on);
    on ? open.add(kind) : open.delete(kind);
    b.setAttribute("aria-expanded", on);
    b.querySelector(".arw").textContent = on ? "▾" : "▸";
    b.querySelector(".advhint").textContent = on ? "nascondi" : "mostra";
  }

  function bind(root) {
    const r = root || document;
    r.querySelectorAll("[data-adv]").forEach(b => b.onclick = () => setOpen(b, b.getAttribute("aria-expanded") !== "true"));
    // pulsante in fondo: chiude e riporta al pulsante in alto
    r.querySelectorAll("[data-advclose]").forEach(c => c.onclick = () => {
      const b = c.closest(".advwrap").querySelector("[data-adv]");
      setOpen(b, false);
      b.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  /* rows: valori dell'entità {key: v}; ranks: {key: [posizione, totale]}; lg: {key: media} */
  function table(metrics, vals, ranks, lg, opts = {}) {
    const showRank = !!ranks, showLg = !!lg;
    const head = `<tr><th>Statistica</th><th>${esc(opts.valueLabel || "Valore")}</th>${showRank ? "<th>Pos.</th>" : ""}${showLg ? `<th>${esc(opts.lgLabel || "Media")}</th>` : ""}</tr>`;
    const body = groupsOf(metrics).map(g => {
      const rows = g.items.filter(m => !opts.hideEmpty || ok(vals[m.key])).map(m => {
        const r = ranks && ranks[m.key];
        const rk = r && m.dir ? `${ord(r[0])}<small>/${r[1]}</small>` : "";
        const cls = r && m.dir ? (r[0] <= Math.ceil(r[1] / 4) ? "up" : r[0] > r[1] - Math.ceil(r[1] / 4) ? "dn" : "") : "";
        return `<tr><td>${esc(m.label)}</td><td class="${cls}">${show(m, vals[m.key])}</td>${showRank ? `<td class="rk">${rk}</td>` : ""}${showLg ? `<td class="lg">${m.lg === false ? "" : show(m, lg[m.key])}</td>` : ""}</tr>`;
      }).join("");
      return rows ? `<tr class="grp"><th colspan="${2 + showRank + showLg}">${esc(g.title)}</th></tr>${rows}` : "";
    }).join("");
    return `<div class="scroll"><table class="advt">${head}${body}</table></div>${legend(metrics)}`;
  }

  /* confronto: a, b = {name, html (intestazione), vals} */
  function compare(metrics, a, b) {
    let wa = 0, wb = 0;
    const body = groupsOf(metrics).map(g => {
      const rows = g.items.filter(m => ok(a.vals[m.key]) || ok(b.vals[m.key])).map(m => {
        const va = a.vals[m.key], vb = b.vals[m.key];
        let ca = "", cb = "";
        if (m.dir && ok(va) && ok(vb)) {
          if (show(m, va) === show(m, vb)) ca = cb = "eq";
          else {
            const better = (va - vb) * m.dir > 0;
            ca = better ? "gd" : "bd"; cb = better ? "bd" : "gd";
            better ? wa++ : wb++;
          }
        }
        return `<tr><td class="ca ${ca}">${show(m, va)}</td><td class="cl">${esc(m.label)}</td><td class="cb ${cb}">${show(m, vb)}</td></tr>`;
      }).join("");
      return rows ? `<tr class="grp"><th colspan="3">${esc(g.title)}</th></tr>${rows}` : "";
    }).join("");
    return `<div class="cmphead"><div>${a.html}</div><div class="cmpscore"><b class="gd">${wa}</b><span>voci a favore</span><i>–</i><b class="gd">${wb}</b></div><div>${b.html}</div></div>
      <div class="cmplegend"><span class="gd">■</span> meglio <span class="eq">■</span> pari <span class="bd">■</span> peggio
        <small>(per punti/gol subiti, palle perse e simili è meglio il valore più basso; le voci senza colore non indicano un vantaggio)</small></div>
      <table class="cmpt">${body}</table>${legend(metrics)}`;
  }

  /* posizione in classifica di ogni metrica (solo quelle con un verso) e media del campionato */
  function ranksAndAvg(metrics, all) {
    const ranks = {}, lg = {};
    const ids = Object.keys(all);
    for (const m of metrics) {
      const vals = ids.map(id => [id, all[id][m.key]]).filter(x => ok(x[1]));
      if (vals.length) lg[m.key] = vals.reduce((s, x) => s + x[1], 0) / vals.length;
      if (!m.dir) continue;
      vals.sort((x, y) => (y[1] - x[1]) * m.dir);
      vals.forEach(([id, v], i) => {
        const pos = vals.findIndex(x => (FMT[m.fmt] || FMT.n1)(x[1]) === (FMT[m.fmt] || FMT.n1)(v)) + 1;  // pari merito
        (ranks[id] ||= {})[m.key] = [pos || i + 1, vals.length];
      });
    }
    return { ranks, lg };
  }

  const css = `
  .advwrap { margin-top: 30px; }
  .tls { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 8px; }
  .tl { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; display: grid; gap: 1px; }
  .tl span { color: var(--muted); font-size: 11.5px; line-height: 1.25; }
  .tl b { font-family: var(--mono); font-size: 19px; }
  .tl small { color: var(--muted); font-size: 11px; }
  .tl.rec b { color: var(--accent2); }
  @media (max-width: 600px) { .tls { grid-template-columns: repeat(3, 1fr); gap: 6px; } .tl { padding: 7px 8px; } .tl b { font-size: 16px; } }
  .advbtn { width: 100%; text-align: left; background: var(--panel); color: var(--text); border: 1px solid var(--line);
            border-radius: 12px; padding: 12px 16px; font: inherit; font-weight: 700; cursor: pointer; }
  .advbtn { display: flex; align-items: center; gap: 8px; }
  .advbtn .advhint { margin-left: auto; color: var(--accent2); font-weight: 600; font-size: 13px; }
  .advbtn:hover, .advbtn[aria-expanded="true"] { border-color: var(--accent); }
  .advclose { display: block; width: 100%; margin-top: 14px; background: var(--panel2); color: var(--text);
              border: 1px solid var(--line); border-radius: 10px; padding: 10px; font: inherit; font-weight: 600; cursor: pointer; }
  .advclose:hover { border-color: var(--accent); }
  .advbody { margin-top: 10px; }
  .advnote { color: var(--muted); font-size: 12.5px; margin: 0 0 10px; }
  table.advt tr.grp th, table.cmpt tr.grp th { text-align: left; background: var(--panel2); color: var(--accent2);
            font-size: 11.5px; padding-top: 9px; padding-bottom: 9px; }
  table.advt td:first-child { max-width: none; white-space: normal; overflow: visible; }
  table.advt td.rk small { color: var(--muted); }
  table.advt td.lg { color: var(--muted); }
  .advleg { margin-top: 10px; color: var(--muted); font-size: 12.5px; }
  .advleg summary { cursor: pointer; color: var(--accent2); }
  .advleg ul { margin: 8px 0 0; padding-left: 18px; line-height: 1.5; }
  .advleg b { color: var(--text); font-weight: 600; }
  .cmpsel { display: flex; gap: 10px; flex: 1 1 100%; flex-wrap: wrap; align-items: center; }
  .cmpsel select { flex: 1 1 200px; }
  .cmpsel #cmpKind { flex: 1 1 100%; }
  .cmpsel input { flex: 1 1 200px; }
  .cmpsel .vsx { color: var(--muted); font-weight: 700; }
  .cmphead { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center;
             background: linear-gradient(120deg, #1d2430, #161b22 60%); border: 1px solid var(--line);
             border-radius: 14px; padding: 16px 18px; }
  .cmphead > div:first-child { text-align: left; } .cmphead > div:last-child { text-align: right; }
  .cmphead .tname { display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 700; }
  .cmphead > div:last-child .tname { flex-direction: row-reverse; }
  .cmphead .tsub { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .cmpscore { text-align: center; display: flex; gap: 8px; align-items: baseline; }
  .cmpscore i { display: none; font-style: normal; color: var(--muted); }
  .cmpscore b { font-family: var(--mono); font-size: 24px; }
  .cmpscore span { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  .cmplegend { color: var(--muted); font-size: 12.5px; margin: 12px 0 10px; }
  .cmplegend small { display: block; margin-top: 3px; }
  table.cmpt td { font-family: var(--mono); }
  table.cmpt td.cl { text-align: center; font-family: inherit; color: var(--text); }
  table.cmpt td.ca { text-align: left; width: 26%; } table.cmpt td.cb { text-align: right; width: 26%; }
  table.cmpt td.ca:first-child { max-width: none; white-space: nowrap; }
  .gd { color: var(--good); font-weight: 700; } .bd { color: var(--bad); } .eq { color: var(--muted); }
  table.cmpt td.gd { background: rgba(62, 207, 142, .08); } table.cmpt td.bd { background: rgba(239, 93, 93, .07); }
  @media (max-width: 600px) {
    .cmphead { padding: 12px; gap: 6px; }
    .cmphead .tname { font-size: 15px; gap: 6px; flex-direction: column; align-items: flex-start; }
    .cmphead > div:last-child .tname { flex-direction: column; align-items: flex-end; }
    .cmphead .tsub { font-size: 11.5px; }
    .cmpscore { gap: 4px; } .cmpscore span { display: none; } .cmpscore i { display: inline; }
    .cmpscore b { font-size: 20px; }
    table.cmpt td { padding: 7px 5px; font-size: 12.5px; } table.cmpt td.cl { font-size: 12px; }
  }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  /* riquadri compatti (statistiche generali in cima alla scheda squadra): head = riquadro iniziale (es. record) */
  function tiles(title, metrics, keys, vals, ranks, head) {
    const byKey = Object.fromEntries(metrics.map(m => [m.key, m]));
    const cells = keys.map(k => byKey[k]).filter(m => m && ok(vals[m.key])).map(m => {
      const r = ranks && ranks[m.key];
      const cls = r && m.dir ? (r[0] <= Math.ceil(r[1] / 4) ? "up" : r[0] > r[1] - Math.ceil(r[1] / 4) ? "dn" : "") : "";
      return `<div class="tl" title="${esc(m.help || m.label)}"><span>${esc(m.label)}</span><b class="${cls}">${show(m, vals[m.key])}</b>${r && m.dir ? `<small>${ord(r[0])} su ${r[1]}</small>` : ""}</div>`;
    }).join("");
    return `<h3>${esc(title)} <small class="nt">(stagione in corso · posizione nel campionato, verde = fra le migliori)</small></h3>
      <div class="tls">${head || ""}${cells}</div>`;
  }

  window.Adv = { FMT, section, bind, table, compare, ranksAndAvg, ok, tiles };
})();
