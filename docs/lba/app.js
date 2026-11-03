/* Interfaccia: carica i dati da data/, costruisce il modello e disegna i risultati. */
(function () {
  "use strict";
  const GM = 40;   // minuti di una partita
  const M = window.LBAModel;
  const $ = s => document.querySelector(s);
  let ctx = null, mode = "player", selected = null, suggIdx = -1, suggList = [];

  const pct = p => Math.round(p * 100) + "%";
  const color = p => p >= .65 ? "var(--good)" : p >= .4 ? "var(--mid)" : "var(--bad)";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ord = n => n + "ª";
  const fmtDate = utc => utc ? new Date(utc).toLocaleString("it-IT",
    { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";

  // ------------------------------------------------------------ dati
  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }

  // LBA: niente infortuni in tempo reale (legabasket.it non li pubblica)
  async function liveInjuries() { return null; }

  // ------------------------------------------------------------ immagini
  // raccolte da legabasket.it dall'aggiornamento automatico (meta.images); senza immagine restano iniziali e sigla
  let IMGS = { teams: {}, players: {} };
  // il valore salvato è un indirizzo completo oppure il codice immagine di legabasket.it (va unito all'archivio)
  const imgSrc = v => {
    if (!v) return null;
    if (/^https?:\/\//.test(v)) return [v];
    if (!IMGS.cdn) return null;
    const k = encodeURI(String(v).replace(/^\/+/, ""));
    return [`${IMGS.cdn}/variants/${k}/thumb`, `${IMGS.cdn}/${k}`];
  };
  const P = (id, name, size) => Media.player(imgSrc(IMGS.players[id]), name, size);
  const L = (tri, size) => Media.team(imgSrc(IMGS.teams[tri]), tri, size, (M.TEAM[tri] || {}).name);
  const who = (img, text) => `<span class="who">${img}<span>${text}</span></span>`;

  async function loadData() {
    $("#status").textContent = "Caricamento dati…";
    const meta = await getJSON("data/meta.json", { cache: "no-store" });
    getJSON(`data/backtest.json?v=${encodeURIComponent(meta.updated_at || "")}`).then(j => { BT = j; if (mode === "picks") run(); }).catch(() => {});
    IMGS = { teams: {}, players: {}, ...(meta.images || {}) };
    const v = encodeURIComponent(meta.updated_at || "");
    const files = await Promise.all(meta.files.map(f => getJSON(`data/${f}?v=${v}`).then(j => [f, j])));
    const logs = {};
    for (const [f, j] of files) {
      const season = f.split("/").pop().slice(0, 7);
      (logs[season] ||= []).push(...M.decodeLogFile(j));
    }
    // LBA: i dati arrivano solo dall'aggiornamento automatico (ogni 3 ore); niente lettura dal vivo
    const liveNote = "";
    ctx = new M.Context({ ...meta, logs });
    teamOptions();
    cmpOptions();
    const upd = meta.updated_at ? new Date(meta.updated_at).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "?";
    $("#status").innerHTML = liveNote
      ? `Stagione ${esc(ctx.season)} · statistiche al ${esc(upd)} <button id="refresh">Ricarica</button>`
      : `Stagione ${esc(ctx.season)} · statistiche al ${esc(upd)} <button id="refresh">Ricarica</button>`;
    $("#refresh").onclick = async () => { await loadData(); run(); };
    if (selected || $("#team").value) run();
  }

  function teamOptions() {
    const opts = M.TEAMS.map(t => `<option value="${t.tri}">${esc(t.name)}</option>`).join("");
    $("#team").innerHTML = `<option value="">Scegli una squadra…</option>` + opts;
    $("#opp").innerHTML = `<option value="">Avversario: prossima partita</option>` + opts;
  }

  // ------------------------------------------------------------ logica
  function opponent(tri) {
    const o = $("#opp").value;
    if (o) {
      if (o === tri) throw new Error("Avversario uguale alla squadra.");
      return { opp: o, home: null, utc: null, manual: true };
    }
    const g = ctx.nextGame(tri);
    if (!g) throw new Error(`Nessuna partita in calendario nelle prossime 3 settimane per ${M.TEAM[tri].name}. Scegli un avversario dal menu.`);
    return g;
  }

  function playerResult(pid) {
    const tri = ctx.playerTeam(pid);
    if (!tri) throw new Error("Giocatore non trovato.");
    const game = opponent(tri);
    const res = ctx.project(pid, game.opp, game.home);
    if (!res) throw new Error("Nessuna partita disponibile per questo giocatore.");
    res.game = game;
    res.opp_profile = ctx.opponentProfile(game.opp);
    return res;
  }

  function teamResult(tri, both) {
    const game = opponent(tri);
    const res = { game, team: ctx.projectTeam(tri, game.opp, game.home),
                  opp_profile: ctx.opponentProfile(game.opp), own_profile: ctx.opponentProfile(tri) };
    if (both) res.opponent = ctx.projectTeam(game.opp, tri, game.home == null ? null : !game.home);
    return res;
  }

  // ------------------------------------------------------------ UI
  document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x === b));
    mode = b.dataset.mode;
    $("#playerBox").classList.toggle("hidden", mode === "team" || mode === "compare" || mode === "picks");
    $("#team").classList.toggle("hidden", mode !== "team");
    $("#bothBox").classList.toggle("hidden", mode !== "team");
    $("#opp").classList.toggle("hidden", mode === "watch" || mode === "compare" || mode === "picks");
    $("#go").classList.toggle("hidden", mode === "watch" || mode === "compare" || mode === "picks");
    $("#cmpBox").classList.toggle("hidden", mode !== "compare");
    document.querySelector(".controls").classList.toggle("hidden", mode === "slip");
    $("#pickBox").classList.toggle("hidden", mode !== "picks");
    $("#pq").placeholder = mode === "watch" ? "Aggiungi un giocatore da osservare…" : "Cerca un giocatore (es. Ross, Shengelia, Mirotic)…";
    if (mode === "watch") { $("#pq").value = ""; selected = null; }
    if (mode === "watch" || mode === "compare" || mode === "picks" || mode === "slip" || selected || $("#team").value) run();
    else $("#out").innerHTML = `<div class="msg">${mode === "team" ? "Scegli una squadra." : "Cerca un giocatore."}</div>`;
  });

  $("#pq").addEventListener("input", () => {
    selected = null;
    const q = $("#pq").value.trim();
    if (q.length < 2 || !ctx) return $("#sugg").classList.add("hidden");
    suggList = ctx.searchPlayers(q);
    suggIdx = -1;
    renderSugg();
  });
  function renderSugg() {
    const box = $("#sugg");
    box.innerHTML = suggList.length ? suggList.map((p, i) =>
      `<div data-i="${i}" class="${i === suggIdx ? "hl" : ""}">${who(P(p.id, p.name), esc(p.name))} <small>${esc(p.team)} · ${p.games} gare</small></div>`).join("")
      : `<div><small>Nessun giocatore trovato</small></div>`;
    box.classList.remove("hidden");
    box.querySelectorAll("[data-i]").forEach(d => d.onmousedown = d.ontouchstart = e => { e.preventDefault(); pick(+d.dataset.i); });
  }
  function pick(i) {
    if (!suggList[i]) return;   // Invio senza giocatori trovati
    selected = suggList[i];
    $("#pq").value = selected.name;
    $("#sugg").classList.add("hidden");
    $("#pq").blur();
    if (mode === "watch") { addWatch(selected); $("#pq").value = ""; selected = null; suggList = []; }
    run();
  }
  $("#pq").addEventListener("keydown", e => {
    if ($("#sugg").classList.contains("hidden")) { if (e.key === "Enter") run(); return; }
    if (e.key === "ArrowDown") { suggIdx = Math.min(suggList.length - 1, suggIdx + 1); renderSugg(); e.preventDefault(); }
    if (e.key === "ArrowUp") { suggIdx = Math.max(0, suggIdx - 1); renderSugg(); e.preventDefault(); }
    if (e.key === "Enter") pick(suggIdx >= 0 ? suggIdx : 0);
    if (e.key === "Escape") $("#sugg").classList.add("hidden");
  });
  $("#pq").addEventListener("blur", () => setTimeout(() => $("#sugg").classList.add("hidden"), 150));
  $("#go").onclick = run;
  $("#team").onchange = run;
  $("#cmpA").onchange = $("#cmpB").onchange = run;
  $("#pkKind").onchange = $("#pkGame").onchange = $("#pkStat").onchange = $("#pkMin").onchange = run;
  $("#opp").onchange = () => { if (selected || $("#team").value) run(); };

  function run() {
    if (!ctx) return;
    try {
      if (mode === "watch") return renderWatch();
      if (mode === "slip") return showSlip();
      if (mode === "compare") { $("#out").innerHTML = renderCompare(); return; }
      if (mode === "picks") { $("#out").innerHTML = renderPicks(); Adv.bind($("#out")); Slip.bind($("#out")); Picks.bindMore(run, (h, a) => { $("#cmpA").dataset.set = 1; $("#cmpA").value = h; $("#cmpB").value = a; document.querySelector('.tab[data-mode="compare"]').click(); window.scrollTo({ top: 0, behavior: "smooth" }); }); return bindRows(); }
      if (mode === "player") {
        if (!selected) { if (suggList.length) return pick(0); return; }
        $("#out").innerHTML = renderPlayer(playerResult(selected.id));
        $("#addw").onclick = () => { addWatch({ id: selected.id, name: selected.name }); $("#addw").textContent = "✓ tra gli osservati"; };
      } else {
        const t = $("#team").value;
        if (!t) return;
        $("#out").innerHTML = renderTeam(teamResult(t, $("#both").checked));
      }
      Adv.bind($("#out"));
      Slip.bind($("#out"));
      bindRows();
    } catch (e) {
      $("#out").innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  }
  function bindRows() {
    document.querySelectorAll("tr[data-pid]").forEach(tr => tr.onclick = () => {
      selected = { id: +tr.dataset.pid, name: tr.dataset.name };
      document.querySelector('.tab[data-mode="player"]').click();
      $("#pq").value = selected.name;
      window.scrollTo({ top: 0, behavior: "smooth" });
      run();
    });
  }


  // ------------------------------------------------------------ giocatori osservati
  const WKEY = "lbastats.watch";
  let watch = (() => { try { return JSON.parse(localStorage.getItem(WKEY)) || []; } catch { return []; } })();
  const saveWatch = () => { try { localStorage.setItem(WKEY, JSON.stringify(watch)); } catch { /* memoria non disponibile */ } };
  function addWatch(p) { if (!watch.some(w => w.id === p.id)) { watch.push({ id: p.id, name: p.name }); saveWatch(); } }
  function removeWatch(id) { watch = watch.filter(w => w.id !== id); saveWatch(); renderWatch(); }
  function moveWatch(id, d) {
    const i = watch.findIndex(w => w.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= watch.length) return;
    [watch[i], watch[j]] = [watch[j], watch[i]]; saveWatch(); renderWatch();
  }

  const shortDate = d => new Date(d + (d.length === 10 ? "T12:00:00" : "")).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });

  function boxCells(l, avg) {
    const cmp = (v, a) => a == null || a < 0.5 ? "" : v >= a * 1.25 ? "up" : v <= a * 0.75 ? "dn" : "";
    const cells = [
      ["MIN", Math.round(l.min)], ["PT", l.pts, cmp(l.pts, avg.PTS)], ["RB", l.reb, cmp(l.reb, avg.REB)],
      ["AS", l.ast, cmp(l.ast, avg.AST)], ["3P", l.tp ?? l.fg3m, cmp(l.fg3m, avg.FG3M)],
      ["TIRI", l.fg ?? `${l.fga} tent.`], ["TL", l.ft ?? `${l.fta} tent.`],
      ["RUB", l.stl, cmp(l.stl, avg.STL)], ["STP", l.blk, cmp(l.blk, avg.BLK)], ["PP", l.tov],
    ];
    if (l.pm != null) cells.push(["+/-", l.pm]);
    return `<div class="box">${cells.map(([k, v, c]) => `<div class="${c || ""}"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>`;
  }

  function seasonAvg(pid) {
    const cur = (ctx.playerLogs.get(pid) || []).filter(g => g.season === ctx.season && g.min > 0);
    if (!cur.length) return { n: 0 };
    const a = k => cur.reduce((x, g) => x + g[k], 0) / cur.length;
    return { n: cur.length, PTS: a("pts"), REB: a("reb"), AST: a("ast"), FG3M: a("fg3m"), STL: a("stl"), BLK: a("blk"), MIN: a("min") };
  }

  function watchCard(w) {
    const tri = ctx.playerTeam(w.id);
    const logs = (ctx.playerLogs.get(w.id) || []).filter(g => g.min > 0);
    const last = logs[0];
    const live = null;   // LBA: niente partite dal vivo
    const next = tri && ctx.nextGame(tri);
    const avg = seasonAvg(w.id);
    const inj = ctx.injury(w.id);
    let body;
    if (live) body = `<div class="ghead"><span class="live">IN CORSO</span> ${live.home === tri ? "vs" : "@"} ${esc(live.home === tri ? live.away : live.home)}</div><div class="msg small">Carico il tabellino…</div>`;
    else if (last) body = `<div class="ghead">${esc(shortDate(last.date))} · ${last.home ? "vs" : "@"} ${esc(last.opp)}</div>${boxCells(last, avg)}`;
    else body = `<div class="msg small">Nessuna partita giocata nelle ultime stagioni.</div>`;
    const avgLine = avg.n ? `<div class="avg">Media stagione (${avg.n} gare): <b>${avg.PTS.toFixed(1)}</b> pt · <b>${avg.REB.toFixed(1)}</b> rb · <b>${avg.AST.toFixed(1)}</b> as · <b>${avg.FG3M.toFixed(1)}</b> triple · ${avg.MIN.toFixed(0)} min</div>` : "";
    const nextLine = next && !live ? `<div class="avg">Prossima: ${next.home ? "vs" : "@"} <b>${esc(next.opp)}</b> · ${esc(fmtDate(next.utc))}</div>` : "";
    return `<div class="card wcard" id="w-${w.id}">
      <div class="top"><div class="who">${P(w.id, ctx.names.get(w.id) || w.name, "m")}<div><span class="name">${esc(ctx.names.get(w.id) || w.name)}</span> <small class="tm">${tri ? L(tri, "s") : ""} ${esc(tri || "—")}</small>
        ${inj ? `<span class="inj" title="${esc(inj.comment)}">${esc(inj.status)}</span>` : ""}</div></div>
        <div class="wbtn"><button data-up="${w.id}" title="Su">↑</button><button data-dn="${w.id}" title="Giù">↓</button><button data-rm="${w.id}" title="Rimuovi">✕</button></div></div>
      <div class="wbody" data-gid="${live ? live.id : last ? last.gid : ""}" data-live="${live ? 1 : ""}">${body}</div>
      ${avgLine}${nextLine}
      ${tri && next ? `<button class="link" data-proj="${w.id}">Vedi la proiezione per la prossima partita →</button>` : ""}
    </div>`;
  }

  async function enrichWatch() { /* LBA: nessun tabellino dal vivo */ }

  function renderWatch() {
    if (!watch.length) {
      $("#out").innerHTML = `<div class="msg">Nessun giocatore osservato.<br>Cercane uno qui sopra per aggiungerlo: vedrai il tabellino della sua ultima partita
        (o di quella in corso).</div>`;
      return;
    }
    $("#out").innerHTML = `<div class="wtools"><span>${watch.length} ${watch.length === 1 ? "giocatore" : "giocatori"} · <span class="up">verde</span>/<span class="dn">rosso</span> = molto sopra/sotto la sua media</span>
      <button id="wref">Aggiorna tabellini</button></div><div class="wgrid">${watch.map(watchCard).join("")}</div>`;
    $("#wref").onclick = async () => { await loadData(); renderWatch(); };
    document.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => removeWatch(+b.dataset.rm));
    document.querySelectorAll("[data-up]").forEach(b => b.onclick = () => moveWatch(+b.dataset.up, -1));
    document.querySelectorAll("[data-dn]").forEach(b => b.onclick = () => moveWatch(+b.dataset.dn, 1));
    document.querySelectorAll("[data-proj]").forEach(b => b.onclick = () => {
      const id = +b.dataset.proj;
      selected = { id, name: ctx.names.get(id) };
      document.querySelector('.tab[data-mode="player"]').click();
      $("#pq").value = selected.name;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    watch.forEach(enrichWatch);
  }

  // ------------------------------------------------------------ render
  function matchupLine(teamTri, game, oppTri) {
    const where = game.home === false ? "@" : "vs";
    const when = game.manual ? "avversario scelto a mano" : (game.live ? "IN CORSO · " : "") + fmtDate(game.utc);
    return `<div class="vs">${L(teamTri, "s")} ${esc(teamTri)} ${where} ${L(oppTri, "s")} <b>${esc(oppTri)}</b></div><div class="sub">${esc(when)}</div>`;
  }

  function oppChips(prof) {
    const c = prof.allowed.map(a => {
      const d = Math.round((a.factor - 1) * 100);
      const cls = d > 0 ? "up" : d < 0 ? "dn" : "";
      return `<span class="chip">${esc(a.label)}: <b class="${cls}">${d > 0 ? "+" : ""}${d}%</b> <small>(${ord(a.rank)})</small></span>`;
    });
    const pd = Math.round((prof.pace.rel - 1) * 100);
    c.unshift(`<span class="chip">Ritmo: <b class="${pd > 0 ? "up" : pd < 0 ? "dn" : ""}">${pd > 0 ? "+" : ""}${pd}%</b> <small>(${ord(prof.pace.rank)})</small></span>`);
    return `<h3>Cosa concede ${L(prof.team.tri, "s")} ${esc(prof.team.name)} rispetto alla media LBA <small class="nt">(1ª = la più permissiva)</small></h3><div class="opp">${c.join("")}</div>`;
  }

  function statCard(s, d) {
    const lk = s.likely ? `Molto probabile: <b>almeno ${s.likely.line}</b> (${pct(s.likely.prob)})` : `<span style="color:var(--muted)">Nessuna soglia oltre il 60%</span>`;
    const av = [
      s.season_avg != null ? `Stagione <b>${s.season_avg}</b>` : s.prev_avg != null ? `Anno scorso <b>${s.prev_avg}</b>` : "",
      `L10 <b>${s.l10_avg}</b>`,
      s.h2h_avg != null ? `vs avv. <b>${s.h2h_avg}</b>` : "",
    ].filter(Boolean).map(x => `<span>${x}</span>`).join("");
    const sl = d && d.game && d.game.id && !d.game.manual;   // pulsante schedina solo con una partita vera in calendario
    const lines = s.lines.map(l => `
      <div class="ln${sl ? " slp" : ""}"><span>${l.line}+</span>
        <div class="bar"><i style="width:${pct(l.prob)};background:${color(l.prob)}"></i></div>
        <span style="text-align:right">${pct(l.prob)}</span>
        <span class="hr">${l.l10[0]}/${l.l10[1]}</span>${sl ? Slip.button({ key: `p|${d.game.id}|${d.player.id}|${s.stat}|${l.line}`, kind: "p",
          gid: d.game.id, utc: d.game.utc, pid: d.player.id, prob: l.prob, text: `${d.player.name}: ${s.label.toLowerCase()} almeno ${l.line}`,
          sub: `${slipTeam(d.player.team)} ${d.game.home === false ? "@" : "vs"} ${slipTeam(d.opponent)}` }) : ""}</div>`).join("");
    return `<div class="card">
      <div class="top"><span class="name">${esc(s.label)}</span><span class="proj">${s.proj}</span></div>
      <div class="likely">${lk}</div>
      <div class="avgs">${av}</div>
      <div class="ln lnh${sl ? " slp" : ""}"><span>soglia</span><span>probabilità</span><span></span><span class="hr">L10</span>${sl ? "<span></span>" : ""}</div>
      ${lines}</div>`;
  }

  function renderPlayer(d) {
    const w = d.warnings.map(x => `<div class="warn">⚠ ${esc(x)}</div>`).join("");
    const recent = d.recent.map(g => `<tr><td>${esc(g.date.slice(5))}</td><td>${g.home ? "vs" : "@"} ${esc(g.opp)}</td><td>${g.min}</td><td>${g.pts}</td><td>${g.reb}</td><td>${g.ast}</td><td>${g.fg3m}</td></tr>`).join("");
    const h2h = d.h2h_games.length ? d.h2h_games.map(g => `<tr><td>${esc(g.date)}</td><td>${g.min}</td><td>${g.pts}</td><td>${g.reb}</td><td>${g.ast}</td><td>${g.fg3m}</td></tr>`).join("")
      : `<tr><td colspan="6" style="color:var(--muted)">Nessun precedente nelle ultime stagioni</td></tr>`;
    return `
    <div class="hero">
      <div class="idt">${P(d.player.id, d.player.name, "l")}<div><h2>${esc(d.player.name)}</h2><div class="sub">${L(d.player.team.tri, "s")} ${esc(d.player.team.name)}
        <button class="link" id="addw" data-id="${d.player.id}">${watch.some(w => w.id === d.player.id) ? "✓ tra gli osservati" : "+ Osserva"}</button></div>
        ${matchupLine(d.player.team.tri, d.game, d.opponent.tri)}</div></div>
      <div class="kpis">
        <div class="kpi"><b>${d.minutes}</b><span>minuti attesi</span></div>
        <div class="kpi"><b>${d.games.season}</b><span>gare stagione</span></div>
        <div class="kpi"><b>${d.games.h2h}</b><span>precedenti</span></div>
      </div>
    </div>${w}
    <h3>Proiezioni contro ${esc(d.opponent.name)}</h3>
    <div class="grid">${d.stats.map(s => statCard(s, d)).join("")}</div>
    ${oppChips(d.opp_profile)}
    <div class="two">
      <div><h3>Ultime 10 partite</h3><table><tr><th>Data</th><th>Avv.</th><th>Min</th><th>Pt</th><th>Rb</th><th>As</th><th>3P</th></tr>${recent}</table></div>
      <div><h3>Precedenti contro ${esc(d.opponent.tri)}</h3><table><tr><th>Data</th><th>Min</th><th>Pt</th><th>Rb</th><th>As</th><th>3P</th></tr>${h2h}</table></div>
    </div>
    ${BasketAdv.playerSection(ctx, M, GM, d.player.id)}
    ${Absence.playerSection(ctx, ABS, d.player.id)}`;
  }

  const COLS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "PRA"];
  const HIDE_M = new Set(["STL", "BLK"]);   // nascoste su telefono per stare nello schermo
  const SHORT = { PTS: "Pt", REB: "Rb", AST: "As", FG3M: "3P", STL: "Rub", BLK: "Stp", PRA: "P+R+A" };

  function teamBlock(t) {
    const leaders = t.leaders.filter(l => l.stat !== "TOV").map(l => `
      <div class="card leader"><div class="name">${esc(l.label)}</div><ol>
        ${l.players.slice(0, 3).map(p => `<li><span>${who(P(p.id, p.name), esc(p.name))} ${p.likely ? `<small>≥${p.likely.line} ${pct(p.likely.prob)}</small>` : ""}</span><span class="v">${p.proj}</span></li>`).join("")}
      </ol></div>`).join("");
    const rows = t.players.map(p => {
      const m = Object.fromEntries(p.stats.map(s => [s.stat, s]));
      const warn = p.injury ? ` <span class="inj" title="${esc(p.injury.status)}">${esc((p.injury.status || "").slice(0, 3))}</span>` : "";
      return `<tr class="click" data-pid="${p.player.id}" data-name="${esc(p.player.name)}"><td>${who(P(p.player.id, p.player.name), esc(p.player.name) + warn)}</td><td>${p.minutes}</td>${COLS.map(c => `<td${HIDE_M.has(c) ? ' class="hm2"' : ""}>${m[c].proj}</td>`).join("")}</tr>`;
    }).join("");
    const absent = t.absent.length ? `<div class="warn">Esclusi: ${t.absent.map(a => `${esc(a.name)} <small>(${esc(a.reason)})</small>`).join(", ")}</div>` : "";
    return `
      <h3>Chi è più probabile che faccia cosa · ${L(t.team.tri, "s")} ${esc(t.team.name)} contro ${L(t.opponent.tri, "s")} ${esc(t.opponent.tri)}</h3>
      <div class="grid">${leaders}</div>
      <h3>Proiezioni per giocatore <small class="nt">(tocca un nome per il dettaglio)</small></h3>
      <div class="scroll"><table><tr><th>Giocatore</th><th>Min</th>${COLS.map(c => `<th${HIDE_M.has(c) ? ' class="hm2"' : ""}>${SHORT[c]}</th>`).join("")}</tr>${rows}</table></div>${absent}`;
  }

  function renderTeam(d) {
    const t = d.team;
    return `
    <div class="hero"><div class="idt">${L(t.team.tri, "l")}<div><h2>${esc(t.team.name)}</h2>${matchupLine(t.team.tri, d.game, t.opponent.tri)}</div></div></div>
    ${BasketAdv.teamTiles(ctx, M, GM, t.team.tri)}
    ${teamBlock(t)}
    ${oppChips(d.opp_profile)}
    ${d.opponent ? `<div class="sep"></div>${BasketAdv.teamTiles(ctx, M, GM, d.opponent.team.tri)}${teamBlock(d.opponent)}${oppChips(d.own_profile)}` : ""}
    ${BasketAdv.teamSection(ctx, M, GM, t.team.tri)}
    ${Absence.teamSection(ctx, ABS, t.team.tri, t.absent, t.players.map(p => p.player))}`;
  }

  // ------------------------------------------------------------ occasioni (previsioni più probabili della prossima giornata)
  let BT = null;   // verifica del modello (data/backtest.json), caricata senza far aspettare l'app
  function renderPicks() {
    return Picks.render({
      backtest: BT, sportName: "LBA",
      ctx, schedule: ctx.schedule, windowH: 60, defMin: 70,
      project: (tri, opp, home) => ctx.projectTeam(tri, opp, home),
      short: id => id, name: id => (M.TEAM[id] || {}).name || id,
      logo: (id, size) => L(id, size), photo: (pid, nm) => P(pid, nm),
      stats: M.ALL_STATS.map(s => [s, M.LABELS[s]]),
      minLine: { PTS: 10, REB: 4, AST: 3, FG3M: 2, STL: 1, BLK: 1, TOV: 2, PRA: 15 },
      sport: "basket",
      teamModel: (h, a) => BasketAdv.gameModel(ctx, M, GM, h, a),
      teamHist: tri => BasketAdv.teamGames(ctx, M, GM, tri),
      teamNote: "Punti attesi da ritmo e rating offensivo/difensivo delle due squadre in questa stagione (vantaggio del campo incluso).",
      el: { kind: $("#pkKind"), game: $("#pkGame"), stat: $("#pkStat"), min: $("#pkMin") },
    });
  }

  // ------------------------------------------------------------ effetto assenze dei compagni
  const ABS = {
    team: r => r.tri, main: "pts", mainVerb: "segnano", minRole: 18, minWith: 3, minWithout: 2,
    photo: (pid, nm) => P(pid, nm),
    stats: [
      { key: "min", label: "Min", get: r => r.min, thr: 2 },
      { key: "pts", label: "Pt", get: r => r.pts, thr: 1.5 },
      { key: "reb", label: "Rb", get: r => r.reb, thr: 1 },
      { key: "ast", label: "As", get: r => r.ast, thr: 1 },
      { key: "fg3m", label: "3P", get: r => r.fg3m, thr: 0.5 },
      { key: "fga", label: "Tiri", get: r => r.fga, thr: 1.5 },
    ],
  };

  // ------------------------------------------------------------ schedina
  const slipTeam = t => (t ? t.tri : "");
  const slipBadge = () => { const t = document.querySelector('.tab[data-mode="slip"]'); if (t) t.innerHTML = `Schedina${Slip.count() ? `<span class="slipn0">${Slip.count()}</span>` : ""}`; };
  Slip.init("lba", slipBadge);
  function showSlip() { $("#out").innerHTML = Slip.render(); Slip.bindPage(showSlip); }

  // ------------------------------------------------------------ confronto fra squadre
  function cmpOptions() {
    const keepA = $("#cmpA").value, keepB = $("#cmpB").value;
    const opts = M.TEAMS.map(t => `<option value="${t.tri}">${esc(t.name)}</option>`).join("");
    $("#cmpA").innerHTML = opts; $("#cmpB").innerHTML = opts;
    if (keepA) $("#cmpA").value = keepA;
    if (keepB) $("#cmpB").value = keepB;
  }

  function renderCompare() {
    if (!$("#cmpA").options.length) cmpOptions();
    // la prima volta: la squadra scelta (o la prima) contro il suo prossimo avversario
    if (!$("#cmpA").dataset.set) {
      const a = $("#team").value || (selected && ctx.playerTeam(selected.id)) || M.TEAMS[0].tri;
      const g = ctx.nextGame(a);
      $("#cmpA").value = a;
      $("#cmpB").value = g ? g.opp : M.TEAMS.find(t => t.tri !== a).tri;
      $("#cmpA").dataset.set = 1;
    }
    const a = $("#cmpA").value, b = $("#cmpB").value;
    if (a === b) return `<div class="msg">Scegli due squadre diverse.</div>`;
    const g = ctx.nextGame(a);
    const next = g && g.opp === b ? `<div class="advnote" style="margin:0 0 10px">Si affrontano ${esc(fmtDate(g.utc))}${g.home === false ? ` in casa di ${esc(M.TEAM[b].name)}` : g.home ? ` in casa di ${esc(M.TEAM[a].name)}` : ""}.</div>` : "";
    const head = (tri, t) => `<div class="tname">${L(tri, "m")}<span>${esc(M.TEAM[tri].name)}</span></div>
      <div class="tsub">${t ? `${t.w} vinte · ${t.gp - t.w} perse` : "nessuna partita"}</div>`;
    return `<h3 style="margin-top:0">Confronta squadre · stagione ${esc(ctx.season)}</h3>${next}` + BasketAdv.compare(ctx, M, GM, a, b, head);
  }

  // ------------------------------------------------------------ avvio
  teamOptions();
  loadData().catch(e => {
    $("#status").innerHTML = `<span style="color:var(--bad)">Dati non disponibili: ${esc(e.message)}</span>`;
    $("#out").innerHTML = `<div class="err">Non riesco a caricare i dati. Se l'app è appena stata creata, il primo aggiornamento potrebbe essere ancora in corso.</div>`;
  });
})();
