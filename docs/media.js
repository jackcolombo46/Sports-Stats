/* Foto dei giocatori e loghi delle squadre, condivisi da tutte le app.
   Ogni immagine ha un ripiego: se l'indirizzo non risponde si prova il successivo,
   e se nessuno funziona restano le iniziali (giocatore) o la sigla (squadra). */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const initials = name => String(name || "?").replace(/[^\p{L}\s'-]/gu, "").trim().split(/\s+/)
    .filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";

  // primo errore: prova l'indirizzo di riserva; secondo: nasconde l'immagine e lascia il testo
  window.__imgErr = el => {
    const alt = el.dataset.alt;
    if (alt) { el.dataset.alt = ""; el.src = alt; } else el.classList.add("x");
  };

  function holder(kind, srcs, text, size, title) {
    const list = (Array.isArray(srcs) ? srcs : [srcs]).filter(Boolean);
    const img = list.length
      ? `<img src="${esc(list[0])}" data-alt="${esc(list[1] || "")}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="__imgErr(this)">`
      : "";
    return `<span class="ph ${kind} ${size || "s"}"${title ? ` title="${esc(title)}"` : ""}><i>${esc(text)}</i>${img}</span>`;
  }

  window.Media = {
    /* foto rotonda del giocatore (size: s piccola, m media, l grande) */
    player: (srcs, name, size) => holder("pl", srcs, initials(name), size),
    /* logo della squadra; senza immagine resta la sigla */
    team: (srcs, label, size, title) => holder("tm", srcs, String(label || "?").slice(0, 3).toUpperCase(), size, title),
  };

  const css = `
  .ph { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none;
        vertical-align: middle; overflow: hidden; line-height: 1; }
  .ph i { font-style: normal; font-weight: 700; color: var(--muted); letter-spacing: .3px; }
  .ph img { position: absolute; inset: 0; width: 100%; height: 100%; }
  .ph img.x { display: none; }
  .ph.pl { border-radius: 50%; background: var(--panel2); border: 1px solid var(--line); }
  .ph.pl img { object-fit: cover; object-position: 50% 15%; background: var(--panel2); }
  .ph.tm { border-radius: 6px; }
  .ph.tm img { object-fit: contain; }
  .ph.tm:has(img.x), .ph.tm:not(:has(img)) { background: var(--panel2); border: 1px solid var(--line); }
  .ph.tm:has(img:not(.x)) i { visibility: hidden; }
  /* loghi piccoli senza immagine: niente sigla, si legge già il nome accanto */
  .ph.tm.s:has(img.x), .ph.tm.s:not(:has(img)) { display: none; }
  .ph.s { width: 22px; height: 22px; font-size: 9px; }
  .ph.m { width: 38px; height: 38px; font-size: 13px; }
  .ph.l { width: 84px; height: 84px; font-size: 26px; }
  .ph.tm.s { width: 20px; height: 20px; }
  .ph.tm.l { width: 64px; height: 64px; font-size: 18px; }
  .who { display: inline-flex; align-items: center; gap: 7px; min-width: 0; max-width: 100%; }
  .who > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .hero .idt { display: flex; gap: 14px; align-items: center; }
  .hero .vs .ph { margin: 0 2px; }
  .sugg div .who { flex: 1; }
  .sugg div .ph.pl.s { width: 26px; height: 26px; }
  @media (max-width: 600px) {
    .ph.l { width: 64px; height: 64px; font-size: 20px; }
    .ph.tm.l { width: 50px; height: 50px; }
    .hero .idt { gap: 10px; }
  }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
})();
