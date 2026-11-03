/* Grafici dell'andamento (SVG, senza librerie).
   - bars():  ultime partite di un giocatore, barre verdi se raggiunge la soglia, linea tratteggiata della soglia
   - lines(): due giocatori sovrapposti (stessa statistica), dalla partita più vecchia alla più recente
   - mount(): pulsanti per scegliere statistica e soglia, ridisegna il grafico al tocco */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = v => (Math.round(v * 10) / 10).toString().replace(".", ",");
  const fmtT = v => (Math.round(v * 100) / 100).toString().replace(".", ",");
  const niceMax = m => { if (m <= 1) return 1; const s = [1, 2, 2.5, 5, 10]; const p = Math.pow(10, Math.floor(Math.log10(m))); for (const k of s) if (k * p >= m) return k * p; return 10 * p; };

  /* points: [{ v, label, title, old }] dalla più vecchia alla più recente */
  function bars(points, line) {
    const W = 400, H = 200, L = 26, R = 6, T = 10, B = 36;
    const n = points.length;
    if (!n) return `<div class="msg small">Nessuna partita da mostrare.</div>`;
    const max = niceMax(Math.max(line || 0, ...points.map(p => p.v)) * 1.08);
    const y = v => T + (H - T - B) * (1 - v / max);
    const bw = (W - L - R) / n;
    const ticks = [0, max / 2, max].map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="tg"/><text x="${L - 4}" y="${y(t) + 3}" class="ty">${fmtT(t)}</text>`).join("");
    const avg = points.reduce((a, p) => a + p.v, 0) / n;
    const rects = points.map((p, i) => {
      const x = L + i * bw + bw * 0.14, w = bw * 0.72, hit = line != null && p.v >= line;
      const h = Math.max(1.5, y(0) - y(p.v));
      return `<g><title>${esc(p.title)}</title><rect x="${x}" y="${y(0) - h}" width="${w}" height="${h}" rx="2" class="${line == null ? "bn" : hit ? "bh" : "bm"}${p.old ? " bo" : ""}"/>
        ${n <= 20 ? `<text x="${x + w / 2}" y="${y(p.v) - 3}" class="tv">${fmt(p.v)}</text>` : ""}
        <text x="${x + w / 2}" y="${H - B + (n > 12 && i % 2 ? 24 : 12)}" class="tx">${esc(p.label)}</text></g>`;   // su due righe se sono tante
    }).join("");
    const firstCur = points.findIndex(p => !p.old);
    const sep = firstCur > 0 ? `<line x1="${L + firstCur * bw}" x2="${L + firstCur * bw}" y1="${T}" y2="${H - B}" class="ts"/><text x="${L + firstCur * bw + 3}" y="${T + 8}" class="tsl">stagione in corso</text>` : "";
    const thr = line != null ? `<line x1="${L}" x2="${W - R}" y1="${y(line)}" y2="${y(line)}" class="tl1"/><text x="${W - R}" y="${y(line) - 3}" class="tll">soglia ${fmt(line)}</text>` : "";
    const av = `<line x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}" class="ta"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="trsvg" role="img">${ticks}${sep}${rects}${av}${thr}</svg>`;
  }

  /* series: [{ name, cls, points: [{v, title}] }] (dalla più vecchia alla più recente), allineate a destra */
  function lines(series, line) {
    const W = 400, H = 190, L = 26, R = 12, T = 10, B = 22;
    const n = Math.max(...series.map(s => s.points.length), 0);
    if (!n) return `<div class="msg small">Nessuna partita da mostrare.</div>`;
    const max = niceMax(Math.max(line || 0, ...series.flatMap(s => s.points.map(p => p.v))) * 1.08);
    const y = v => T + (H - T - B) * (1 - v / max);
    const x = i => L + (W - L - R) * (n === 1 ? 0.5 : i / (n - 1));
    const ticks = [0, max / 2, max].map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="tg"/><text x="${L - 4}" y="${y(t) + 3}" class="ty">${fmtT(t)}</text>`).join("");
    const paths = series.map(s => {
      const off = n - s.points.length;
      const pts = s.points.map((p, i) => [x(i + off), y(p.v), p]);
      return `<path d="${pts.map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ")}" class="tp ${s.cls}"/>
        ${pts.map(q => `<circle cx="${q[0]}" cy="${q[1]}" r="3.2" class="tc ${s.cls}"><title>${esc(s.name)} · ${esc(q[2].title)}</title></circle>`).join("")}`;
    }).join("");
    const thr = line != null ? `<line x1="${L}" x2="${W - R}" y1="${y(line)}" y2="${y(line)}" class="tl1"/><text x="${W - R}" y="${y(line) - 3}" class="tll">soglia ${fmt(line)}</text>` : "";
    const xl = `<text x="${L}" y="${H - 6}" class="tx" text-anchor="start">${n} partite fa</text><text x="${W - R}" y="${H - 6}" class="tx" text-anchor="end">ultima</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="trsvg" role="img">${ticks}${thr}${paths}${xl}</svg>`;
  }

  /* cfg: { title, stats: [{ key, label, lines: [num], def }], start, series(key) -> [{ name, cls, points }], note }
     una serie → barre; due serie → linee sovrapposte */
  function mount(el, cfg) {
    if (!el || !cfg.stats.length) return;
    let key = cfg.start && cfg.stats.some(s => s.key === cfg.start) ? cfg.start : cfg.stats[0].key;
    const thr = {};
    const draw = () => {
      const st = cfg.stats.find(s => s.key === key);
      const line = thr[key] !== undefined ? thr[key] : st.def;
      const ser = cfg.series(key);
      const chart = ser.length === 1 ? bars(ser[0].points, line) : lines(ser, line);
      const sums = ser.map(s => {
        const vals = s.points.map(p => p.v), cur = s.points.filter(p => !p.old).map(p => p.v);
        const hit = line != null ? vals.filter(v => v >= line).length : null;
        return `<span class="trs ${s.cls}">${ser.length > 1 ? `<b>${esc(s.name)}</b> · ` : ""}media ${fmt(vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length))}${hit != null ? ` · soglia raggiunta <b>${hit}/${vals.length}</b>` : ""}${cur.length && cur.length < vals.length && ser.length === 1 ? ` (in questa stagione ${cur.filter(v => v >= line).length}/${cur.length})` : ""}</span>`;
      }).join("");
      el.innerHTML = `<h3>${esc(cfg.title)} ${cfg.note ? `<small class="nt">${esc(cfg.note)}</small>` : ""}</h3>
        <div class="trchips">${cfg.stats.map(s => `<button data-k="${esc(s.key)}" class="${s.key === key ? "on" : ""}">${esc(s.label)}</button>`).join("")}</div>
        <div class="trbox">${chart}
          <div class="trfoot">${sums}
            ${st.lines.length ? `<label>Soglia <select data-thr>${st.lines.map(l => `<option value="${l}"${l === line ? " selected" : ""}>${l}+</option>`).join("")}</select></label>` : ""}</div></div>`;
      el.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { key = b.dataset.k; draw(); });
      const sel = el.querySelector("[data-thr]");
      if (sel) sel.onchange = () => { thr[key] = +sel.value; draw(); };
    };
    draw();
  }

  const css = `
  .trchips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .trchips button { background: var(--panel); color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 5px 11px; font: inherit; font-size: 13px; cursor: pointer; }
  .trchips button.on { color: var(--text); border-color: var(--accent); background: var(--panel2); }
  .trbox { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px 10px 8px; }
  .trsvg { width: 100%; height: auto; display: block; }
  .trsvg .tg { stroke: var(--line); stroke-width: 1; } .trsvg .ty { fill: var(--muted); font-size: 9px; text-anchor: end; }
  .trsvg .tx { fill: var(--muted); font-size: 8.5px; text-anchor: middle; } .trsvg .tv { fill: var(--text); font-size: 8.5px; text-anchor: middle; }
  .trsvg .bh { fill: var(--good); } .trsvg .bm { fill: #7a3b3b; } .trsvg .bn { fill: var(--accent); } .trsvg .bo { opacity: .45; }
  .trsvg .tl1 { stroke: var(--accent2); stroke-width: 1.5; stroke-dasharray: 5 4; } .trsvg .tll { fill: var(--accent2); font-size: 9px; text-anchor: end; }
  .trsvg .ta { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 1 3; }
  .trsvg .ts { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 2 2; } .trsvg .tsl { fill: var(--muted); font-size: 8.5px; }
  .trsvg .tp { fill: none; stroke-width: 2; } .trsvg .tc { stroke: var(--panel); stroke-width: 1; }
  .trsvg .tp.sa { stroke: var(--accent); } .trsvg .tc.sa { fill: var(--accent); }
  .trsvg .tp.sb { stroke: var(--mid); } .trsvg .tc.sb { fill: var(--mid); }
  .trfoot { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; justify-content: space-between; font-size: 12.5px; color: var(--muted); margin-top: 6px; }
  .trfoot b { color: var(--text); } .trs.sa b:first-child { color: var(--accent2); } .trs.sb b:first-child { color: var(--mid); }
  .trfoot select { padding: 4px 8px; font-size: 13px; }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  window.Trend = { bars, lines, mount };
})();
