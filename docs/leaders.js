/* "Classifiche" dei giocatori per categoria (punti, rimbalzi, gol, tiri, …), calcolate dai tabellini salvati.
   Filtri: categoria, totali / a partita (/ ogni 90' nel calcio), minimo di partite, squadra, stagione.
   Senza categoria scelta mostra i primi 5 di ogni categoria; con una categoria la classifica completa (primi 10, poi "Mostra tutti"). */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const state = { cat: "", mode: null, min: null, team: "", season: null, all: false, sport: null };
  const TOP = 10, TOP_CARD = 5;

  /* totali per giocatore di una stagione (con i totali della squadra nelle sue partite, per le voci come l'usage) */
  function aggregate(cfg, season) {
    const cache = cfg.ctx._ld ||= {};
    if (cache[season]) return cache[season];
    const rows = cfg.rows(season);
    const F = cfg.sums;
    const tg = new Map();
    if (cfg.teamSums) for (const r of rows) {
      const k = r.gid + "|" + cfg.team(r);
      const t = tg.get(k) || Object.fromEntries(F.map(f => [f, 0]));
      for (const f of F) t[f] += +r[f] || 0;
      tg.set(k, t);
    }
    const by = new Map();
    for (const r of rows) {
      let x = by.get(r.pid);
      if (!x) { x = { pid: r.pid, gp: 0, last: "", team: null, T: cfg.teamSums ? Object.fromEntries(F.map(f => [f, 0])) : null, ...Object.fromEntries(F.map(f => [f, 0])) }; by.set(r.pid, x); }
      x.gp++;
      for (const f of F) x[f] += +r[f] || 0;
      if (r.date >= x.last) { x.last = r.date; x.team = cfg.team(r); }
      if (cfg.teamSums) { const t = tg.get(r.gid + "|" + cfg.team(r)); for (const f of F) x.T[f] += t[f]; }
    }
    const list = [...by.values()];
    return (cache[season] = { list, rows, maxGp: list.reduce((a, x) => Math.max(a, x.gp), 0) });
  }

  const fmtv = (cat, mode, v) => {
    if (v == null || !isFinite(v)) return "–";
    if (cat.fmt === "pct") return (v * 100).toFixed(1).replace(".", ",") + "%";
    if (cat.fmt === "n1") return v.toFixed(1).replace(".", ",");
    if (cat.ratio || mode === "tot") return cat.totDec && mode === "tot" ? v.toFixed(cat.totDec).replace(".", ",") : String(Math.round(v));
    return v.toFixed(cat.dec ?? 1).replace(".", ",");
  };
  const modeVal = (cat, mode, x) => {
    const v = cat.val(x);
    if (cat.ratio || mode === "tot") return v;
    if (mode === "p90" && !cat.perGame) return x.min > 0 ? v * 90 / x.min : null;
    return v / x.gp;
  };

  function ranking(cfg, A, cat, mode, minGp) {
    const out = [];
    for (const x of A.list) {
      if (x.gp < minGp) continue;
      if (state.team && x.team !== state.team) continue;
      if (cat.qual && !cat.qual(x)) continue;
      if (mode === "p90" && !cat.ratio && !cat.perGame && x.min < 45 * Math.max(minGp, 2)) continue;   // pochi minuti: i valori ogni 90' sarebbero gonfiati
      const v = modeVal(cat, mode, x);
      if (v == null || !isFinite(v) || (!cat.ratio && v <= 0)) continue;
      out.push({ x, v });
    }
    out.sort((a, b) => b.v - a.v || b.x.gp - a.x.gp);
    // posizioni a pari merito
    let pos = 0, prev = null;
    out.forEach((r, i) => { const k = fmtv(cat, mode, r.v); if (k !== prev) pos = i + 1; prev = k; r.pos = pos; });
    return out;
  }

  function sel(id, opts, val) {
    return `<select id="${id}">${opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(val) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  }

  /* cfg: { ctx, sport, seasons, rows(season), team(row), sums, teamSums, cats:[{key,label,group,val,ratio,qual,fmt,dec,has,att}],
            modes:[[id,label]], name(pid), teamName(id), short(id), photo(pid,name), logo(id,size), canOpen(pid) } */
  function render(cfg) {
    if (state.sport !== cfg.sport) Object.assign(state, { cat: "", mode: cfg.modes[0][0], min: null, team: "", season: cfg.seasons[0], all: false, sport: cfg.sport });
    if (!cfg.seasons.includes(state.season)) state.season = cfg.seasons[0];
    const A = aggregate(cfg, state.season);
    if (!A.list.length) return `<div class="msg">Nessuna partita giocata in questa stagione.</div>`;
    const cats = cfg.cats.filter(c => !c.has || c.has(A.rows));
    if (state.cat && !cats.some(c => c.key === state.cat)) state.cat = "";
    const cat = cats.find(c => c.key === state.cat);
    const auto = state.mode === "tot" && !(cat && cat.ratio) ? 1 : Math.max(1, Math.round(A.maxGp * 0.35));
    const minGp = state.min ?? auto;
    const mins = [...new Set([1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 40, 50, 60, auto, minGp])].filter(v => v <= Math.max(A.maxGp, minGp)).sort((a, b) => a - b);
    const teams = [...new Set(A.list.map(x => x.team))].filter(Boolean).map(t => [t, cfg.teamName(t)]).sort((a, b) => a[1].localeCompare(b[1]));
    if (state.team && !teams.some(t => t[0] === state.team)) state.team = "";

    const groups = [...new Set(cats.map(c => c.group))];
    const catOpts = `<select id="ldCat"><option value="">Tutte le categorie</option>${groups.map(g => `<optgroup label="${esc(g)}">${cats.filter(c => c.group === g)
      .map(c => `<option value="${c.key}"${c.key === state.cat ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</optgroup>`).join("")}</select>`;
    const filters = `<div class="ldsel">${catOpts}
      ${sel("ldMode", cfg.modes, state.mode)}
      ${sel("ldMin", mins.map(v => [v, v === 1 ? "Tutti (almeno 1 partita)" : `Almeno ${v} partite`]), minGp)}
      ${sel("ldTeam", [["", "Tutte le squadre"], ...teams], state.team)}
      ${sel("ldSeason", cfg.seasons.map((s, i) => [s, i ? `Stagione ${s}` : `Stagione ${s} (in corso)`]), state.season)}</div>`;
    const modeLbl = (cfg.modes.find(m => m[0] === state.mode) || [, ""])[1].toLowerCase();
    const note = `Calcolate dai tabellini della stagione ${esc(state.season)}${cfg.noteExtra ? " " + cfg.noteExtra : ""}.
      Le percentuali e le voci "a partita" contano solo chi ha giocato almeno ${minGp} ${minGp === 1 ? "partita" : "partite"}${state.mode === "p90" ? " e abbastanza minuti" : ""};
      le percentuali al tiro richiedono anche un minimo di tentativi. Tocca un giocatore per la sua scheda.`;
    const pl = (x, extra) => {
      const nm = cfg.name(x.pid) || "?";
      const open = cfg.canOpen(x.pid) ? ` class="click" data-pid="${x.pid}" data-name="${esc(nm)}"` : "";
      return { open, html: `<span class="who">${cfg.photo(x.pid, nm)}<span>${esc(nm)}<small class="pkm">${x.team ? cfg.logo(x.team, "s") + " " + esc(cfg.short(x.team)) : ""}${extra || ""}</small></span></span>` };
    };

    if (!cat) {
      const cards = cats.map(c => {
        const r = ranking(cfg, A, c, state.mode, minGp).slice(0, TOP_CARD);
        if (!r.length) return "";
        return `<div class="card leader ldc"><div class="name"><button class="ldgo" data-cat="${c.key}">${esc(c.label)} <small>${c.ratio ? "" : esc(modeLbl)}</small> →</button></div><ol>
          ${r.map(({ x, v }) => { const p = pl(x); return `<li${p.open}><span>${p.html}</span><span class="v">${fmtv(c, state.mode, v)}</span></li>`; }).join("")}</ol></div>`;
      }).join("");
      return `<h3 style="margin-top:0">Classifiche giocatori</h3>${filters}<div class="advnote" style="margin:8px 0 12px">${note}</div>
        <div class="grid">${cards || `<div class="msg">Nessun giocatore con questi filtri.</div>`}</div>`;
    }

    const r = ranking(cfg, A, cat, state.mode, minGp);
    if (!r.length) return `<h3 style="margin-top:0">${esc(cat.label)}</h3>${filters}<div class="msg">Nessun giocatore con questi filtri: prova ad abbassare il minimo di partite.</div>`;
    const shown = state.all ? r : r.slice(0, TOP);
    const secLbl = cat.ratio ? (cat.attLabel || "") : state.mode === "tot" ? "A partita" : "Totale";
    const sec = x => cat.ratio ? (cat.att ? String(Math.round(cat.att(x))) : "") : state.mode === "tot" ? fmtv({ ...cat, ratio: false }, "pg", cat.val(x) / x.gp) : String(Math.round(cat.val(x)));
    const rows = shown.map(({ x, v, pos }) => {
      const p = pl(x);
      return `<tr${p.open}><td><span class="pos">${pos}</span> ${p.html}</td><td>${x.gp}</td><td class="hm2">${Math.round(x.min / x.gp)}</td>
        <td class="hm2">${sec(x)}</td><td class="ldv">${fmtv(cat, state.mode, v)}</td></tr>`;
    }).join("");
    const more = r.length > TOP ? `<button class="advclose" id="ldMore">${state.all ? `Mostra solo i primi ${TOP}` : `Mostra tutti (${r.length})`}</button>` : "";
    return `<h3 style="margin-top:0">${esc(cat.label)} <small class="nt">· ${cat.ratio ? "percentuale" : esc(modeLbl)} · ${r.length} giocatori</small></h3>${filters}
      <div class="advnote" style="margin:8px 0 12px">${cat.help ? esc(cat.help) + ". " : ""}${note}</div>
      <div class="scroll"><table class="ldt"><tr><th>Giocatore</th><th>Gare</th><th class="hm2">Min</th><th class="hm2">${esc(secLbl)}</th><th>${esc(cat.short || cat.label)}</th></tr>${rows}</table></div>${more}
      <button class="advclose" id="ldBack">← Tutte le categorie</button>`;
  }

  function bind(rerun) {
    const on = (id, f) => { const el = document.getElementById(id); if (el) el.onchange = () => { f(el.value); state.all = false; rerun(); }; };
    on("ldCat", v => { state.cat = v; });
    on("ldMode", v => { state.mode = v; state.min = null; });
    on("ldMin", v => { state.min = +v; });
    on("ldTeam", v => { state.team = v; });
    on("ldSeason", v => { state.season = v; state.min = null; });
    document.querySelectorAll(".ldgo").forEach(b => b.onclick = () => { state.cat = b.dataset.cat; state.all = false; rerun(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    const m = document.getElementById("ldMore"); if (m) m.onclick = () => { state.all = !state.all; rerun(); };
    const bk = document.getElementById("ldBack"); if (bk) bk.onclick = () => { state.cat = ""; state.all = false; rerun(); };
  }

  function reset(ctx) { if (ctx) ctx._ld = null; }

  /* ---------------------------------------------------------- categorie già pronte */
  const div = (a, b) => (b > 0 ? a / b : null);
  const hasMade = rows => rows.some(r => r.fgm != null && r.fgm > 0);
  const BASKET = [
    { key: "pts", group: "Statistiche", label: "Punti", short: "Pt", val: x => x.pts },
    { key: "reb", group: "Statistiche", label: "Rimbalzi", short: "Rb", val: x => x.reb },
    { key: "ast", group: "Statistiche", label: "Assist", short: "As", val: x => x.ast },
    { key: "fg3m", group: "Statistiche", label: "Triple segnate", short: "3P", val: x => x.fg3m },
    { key: "stl", group: "Statistiche", label: "Rubate", short: "Rub", val: x => x.stl },
    { key: "blk", group: "Statistiche", label: "Stoppate", short: "Stp", val: x => x.blk },
    { key: "pra", group: "Statistiche", label: "Punti + rimbalzi + assist", short: "P+R+A", val: x => x.pts + x.reb + x.ast },
    { key: "oreb", group: "Statistiche", label: "Rimbalzi offensivi", short: "Rb off.", val: x => x.oreb },
    { key: "tov", group: "Statistiche", label: "Palle perse", short: "PP", val: x => x.tov },
    { key: "min", group: "Statistiche", label: "Minuti", short: "Min", val: x => x.min, perGame: true },
    { key: "fga", group: "Tiro", label: "Tiri tentati", short: "Tiri", val: x => x.fga },
    { key: "fta", group: "Tiro", label: "Tiri liberi tentati", short: "TL", val: x => x.fta },
    { key: "fgp", group: "Tiro", label: "% dal campo", short: "%", ratio: true, fmt: "pct", has: hasMade, val: x => div(x.fgm, x.fga),
      qual: x => x.fga >= 3 * x.gp && x.fga >= 20, att: x => x.fga, attLabel: "Tiri" },
    { key: "p3", group: "Tiro", label: "% da tre", short: "%", ratio: true, fmt: "pct", val: x => div(x.fg3m, x.fg3a),
      qual: x => x.fg3a >= 1.5 * x.gp && x.fg3a >= 10, att: x => x.fg3a, attLabel: "Tiri da 3" },
    { key: "ftp", group: "Tiro", label: "% ai liberi", short: "%", ratio: true, fmt: "pct", has: hasMade, val: x => div(x.ftm, x.fta),
      qual: x => x.fta >= 1.2 * x.gp && x.fta >= 10, att: x => x.fta, attLabel: "Liberi" },
    { key: "ts", group: "Avanzate", label: "True shooting %", short: "TS%", ratio: true, fmt: "pct", val: x => div(x.pts, 2 * (x.fga + 0.44 * x.fta)),
      qual: x => x.fga >= 4 * x.gp && x.fga >= 20, att: x => x.fga, attLabel: "Tiri", help: "Efficienza al tiro contando triple e liberi" },
    { key: "efg", group: "Avanzate", label: "eFG%", short: "eFG%", ratio: true, fmt: "pct", has: hasMade, val: x => div(x.fgm + 0.5 * x.fg3m, x.fga),
      qual: x => x.fga >= 4 * x.gp && x.fga >= 20, att: x => x.fga, attLabel: "Tiri", help: "Percentuale effettiva al tiro: la tripla vale 1,5 canestri" },
    { key: "usg", group: "Avanzate", label: "Usage %", short: "USG%", ratio: true, fmt: "n1",
      val: x => div(100 * (x.fga + 0.44 * x.fta + x.tov) * (x.T.min / 5), x.min * (x.T.fga + 0.44 * x.T.fta + x.T.tov)),
      qual: x => x.min >= 12 * x.gp, att: x => x.min / x.gp, attLabel: "Min/gara",
      help: "Quota delle azioni della squadra concluse dal giocatore (tiro, liberi o palla persa) mentre è in campo" },
  ];
  const BASKET_SUMS = ["min", "pts", "reb", "oreb", "ast", "fg3m", "fg3a", "stl", "blk", "tov", "fga", "fgm", "fta", "ftm"];
  const SOCCER = [
    { key: "gol", group: "Attacco", label: "Gol", short: "Gol", dec: 2, val: x => x.gol },
    { key: "ast", group: "Attacco", label: "Assist", short: "As", dec: 2, val: x => x.ast },
    { key: "ga", group: "Attacco", label: "Gol + assist", short: "G+A", dec: 2, val: x => x.gol + x.ast },
    { key: "sh", group: "Attacco", label: "Tiri", short: "Tiri", dec: 1, val: x => x.sh },
    { key: "sot", group: "Attacco", label: "Tiri in porta", short: "In porta", dec: 2, val: x => x.sot },
    { key: "xg", group: "Attacco", label: "Gol attesi (xG)", short: "xG", dec: 2, totDec: 1, val: x => x.xg, has: rows => rows.some(r => r.xg > 0) },
    { key: "sotp", group: "Precisione", label: "Tiri in porta %", short: "%", ratio: true, fmt: "pct", val: x => div(x.sot, x.sh),
      qual: x => x.sh >= 8 && x.sh >= x.gp, att: x => x.sh, attLabel: "Tiri" },
    { key: "conv", group: "Precisione", label: "Gol ogni tiro", short: "%", ratio: true, fmt: "pct", val: x => div(x.gol, x.sh),
      qual: x => x.sh >= 8 && x.sh >= x.gp, att: x => x.sh, attLabel: "Tiri", help: "Gol segnati diviso tiri tentati" },
    { key: "fc", group: "Disciplina", label: "Falli commessi", short: "Falli", dec: 1, val: x => x.fc },
    { key: "fs", group: "Disciplina", label: "Falli subiti", short: "F. sub.", dec: 1, val: x => x.fs },
    { key: "yc", group: "Disciplina", label: "Ammonizioni", short: "Amm.", dec: 2, val: x => x.yc },
    { key: "rc", group: "Disciplina", label: "Espulsioni", short: "Esp.", dec: 2, val: x => x.rc },
    { key: "sv", group: "Portieri", label: "Parate", short: "Parate", dec: 1, val: x => x.sv },
    { key: "min", group: "Utilizzo", label: "Minuti giocati", short: "Min", dec: 0, val: x => x.min, perGame: true },
  ];
  const SOCCER_SUMS = ["min", "gol", "ast", "sh", "sot", "fc", "fs", "yc", "rc", "sv", "xg"];

  const css = `
  .ldsel { display: flex; gap: 8px; flex-wrap: wrap; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px; }
  .ldsel select { flex: 1 1 170px; }
  .ldc .name { margin-bottom: 2px; }
  .ldgo { background: none; border: 0; padding: 0; color: var(--text); font: inherit; font-weight: 700; cursor: pointer; text-align: left; }
  .ldgo small { color: var(--muted); font-weight: 400; } .ldgo:hover { color: var(--accent2); }
  .ldc li.click { cursor: pointer; } .ldc li.click:hover .who { color: var(--accent2); }
  .ldc .pkm, .ldt .pkm { display: block; color: var(--muted); font-size: 11px; font-family: inherit; }
  .ldc .pkm .ph, .ldt .pkm .ph { width: 13px; height: 13px; }
  table.ldt td:first-child { white-space: normal; max-width: none; }
  table.ldt td.ldv { font-weight: 700; color: var(--accent2); }
  table.ldt .pos { display: inline-block; min-width: 22px; color: var(--muted); font-family: var(--mono); }
  table.ldt tr.click { cursor: pointer; }
  @media (max-width: 600px) { .ldsel select { flex: 1 1 calc(50% - 8px); min-width: 0; } .ldsel select#ldCat { flex-basis: 100%; } }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  window.Leaders = { render, bind, reset, BASKET, BASKET_SUMS, SOCCER, SOCCER_SUMS };
})();
