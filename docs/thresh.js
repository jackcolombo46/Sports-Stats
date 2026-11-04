/* Scheda di una statistica del giocatore con le soglie "una alla volta":
   si tocca una soglia (es. 25+) e si vedono la probabilità del modello, quante volte l'ha raggiunta nelle ultime partite,
   il grafico di quelle partite con la linea della soglia e una frase che lo riassume. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = p => Math.round(p * 100) + "%";
  const color = p => (p >= 0.65 ? "var(--good)" : p >= 0.4 ? "var(--mid)" : "var(--bad)");
  const num = v => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10).replace(".", ","));

  function chart(points, line) {
    const W = 340, H = 88, top = 30, n = points.length || 1, BW = W - 30, w = BW / n;   // a destra lo spazio per l'etichetta della soglia
    const max = Math.max(line * 1.35, ...points.map(p => p.v), 1);
    const y = v => top + H - (v / max) * H;
    let s = "";
    points.forEach((p, i) => {
      const ok = p.v >= line, x = i * w + Math.min(5, w * 0.15), bw = w - 2 * Math.min(5, w * 0.15), bh = Math.max(2, (p.v / max) * H);
      s += `<g><title>${esc(p.title || "")}</title><rect x="${x}" y="${top + H - bh}" width="${bw}" height="${bh}" rx="3" fill="${ok ? "var(--good)" : "var(--bad)"}" opacity="${ok ? 1 : 0.55}"/>
        <text x="${x + bw / 2}" y="${top + H - bh - 4}" text-anchor="middle" class="thv">${num(p.v)}</text>
        <text x="${x + bw / 2}" y="${top + H + 13}" text-anchor="middle" class="thl">${esc(p.label || "")}</text></g>`;
    });
    // separazione fra stagione scorsa e stagione in corso
    const k = points.findIndex(p => !p.old);
    if (k > 0) s += `<line x1="${k * w}" x2="${k * w}" y1="2" y2="${top + H}" stroke="var(--muted)" stroke-dasharray="2 3"/>
      ${k * w > 80 ? `<text x="${k * w - 4}" y="10" text-anchor="end" class="thl">stagione scorsa</text>` : ""}<text x="${k * w + 4}" y="10" class="thl">in corso</text>`;
    const ly = y(line);
    s += `<line x1="0" x2="${BW + 4}" y1="${ly}" y2="${ly}" stroke="var(--accent2)" stroke-width="1.5" stroke-dasharray="5 4"/>
      <text x="${W}" y="${ly + 4}" text-anchor="end" class="thv tha">${line}+</text>
      <text x="0" y="${top + H + 28}" class="thl">${n} partite fa</text><text x="${BW}" y="${top + H + 28}" text-anchor="end" class="thl">ultima</text>`;
    return `<svg class="thg" viewBox="0 0 ${W} ${top + H + 32}" role="img">${s}</svg>`;
  }

  /* o: { label, proj (testo), likely (html), avgs (html), lines:[{line, prob}], def (soglia di partenza),
          points:[{v, label, title, old}] dalla più vecchia alla più recente, unit (es. "punti"), slip(line) → html del pulsante } */
  function card(o) {
    const lines = (o.lines || []).filter(l => l.prob != null);
    const head = `<div class="top"><span class="name">${esc(o.label)}</span><span class="proj">${o.proj}</span></div>
      <div class="likely">${o.likely}</div><div class="avgs">${o.avgs}</div>`;
    if (!lines.length) return `<div class="card">${head}</div>`;
    // soglia di partenza: quella indicata o la più vicina
    const want = o.def != null ? o.def : 0;
    const def = lines.reduce((a, l) => (Math.abs(l.line - want) < Math.abs(a.line - want) ? l : a)).line;
    const N = o.points.length;
    const chips = lines.map(l => `<button class="thc${l.line === def ? " on" : ""}" data-thl="${l.line}" style="--c:${color(l.prob)}">${l.line}+</button>`).join("");
    const panels = lines.map(l => {
      const h = o.points.filter(p => p.v >= l.line).length;
      const say = N
        ? `Il modello dà il <b>${pct(l.prob)}</b> di probabilità che faccia almeno ${l.line} ${esc(o.unit)}. Nelle ultime ${N} partite ci è arrivato <b>${h} ${h === 1 ? "volta" : "volte"}</b>.`
        : `Il modello dà il <b>${pct(l.prob)}</b> di probabilità che faccia almeno ${l.line} ${esc(o.unit)}. Non ha ancora partite giocate.`;
      return `<div class="thp${l.line === def ? "" : " hidden"}" data-thp="${l.line}">
        <div class="tht">
          <div><span>Probabilità del modello</span><b style="color:${color(l.prob)}">${pct(l.prob)}</b></div>
          <div><span>Ultime ${N || 10} partite</span><b>${N ? `${h}/${N}` : "–"}</b></div>
          ${o.slip ? `<div class="ths">${o.slip(l.line, l.prob)}</div>` : ""}
        </div>
        ${N ? chart(o.points, l.line) : ""}
        <p class="thx">${say}</p></div>`;
    }).join("");
    return `<div class="card thcard">${head}<div class="thchips">${chips}</div>${panels}</div>`;
  }

  /* collega le soglie (da chiamare dopo aver messo la pagina) */
  function bind(root) {
    (root || document).querySelectorAll(".thcard").forEach(c => c.querySelectorAll("[data-thl]").forEach(b => b.onclick = () => {
      c.querySelectorAll("[data-thl]").forEach(x => x.classList.toggle("on", x === b));
      c.querySelectorAll("[data-thp]").forEach(p => p.classList.toggle("hidden", p.dataset.thp !== b.dataset.thl));
    }));
  }

  const css = `
  .thchips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
  .thc { background: var(--panel2); border: 1px solid var(--line); color: var(--text); border-radius: 999px; padding: 5px 11px; min-width: 46px;
         font-family: var(--mono); font-size: 13px; cursor: pointer; box-shadow: inset 0 -2px 0 var(--c); }
  .thc.on { border-color: var(--accent); background: #263040; color: var(--accent2); font-weight: 700; }
  .tht { display: flex; gap: 8px; align-items: stretch; }
  .tht > div:not(.ths) { flex: 1; background: var(--panel2); border-radius: 10px; padding: 8px 10px; display: grid; gap: 2px; }
  .tht span { color: var(--muted); font-size: 11.5px; }
  .tht b { font-family: var(--mono); font-size: 24px; line-height: 1.1; }
  .ths { display: flex; align-items: center; }
  .ths .slipbtn { width: 34px; height: 34px; font-size: 18px; }
  .thg { width: 100%; height: auto; display: block; margin-top: 8px; }
  .thg .thv { fill: var(--text); font-size: 11px; font-family: var(--mono); }
  .thg .tha { fill: var(--accent2); font-weight: 700; }
  .thg .thl { fill: var(--muted); font-size: 10px; }
  .thx { margin: 6px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
  .thx b { color: var(--text); }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  window.Thresh = { card, bind };
})();
