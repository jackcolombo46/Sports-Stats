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
    Slip.setResults(slipResults());
    run();
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
  /* modi interni: today, picks (voce Oggi) · player, team (Cerca) · compare · table, leaders (Classifiche) · slip, watch (Schedina) */
  const SEARCH_PH = "Cerca un giocatore o una squadra (es. Shengelia, Virtus)…";
  function setMode(m, fromHistory) {
    mode = m;
    Nav.set(m, fromHistory);
    const search = m === "player" || m === "team";
    $("#controls").classList.toggle("hidden", !(search || m === "watch" || m === "compare" || m === "picks"));
    $("#playerBox").classList.toggle("hidden", !(search || m === "watch"));
    $("#team").classList.add("hidden");
    $("#bothBox").classList.add("hidden");
    $("#opp").classList.toggle("hidden", !(m === "player" && selected));
    $("#go").classList.toggle("hidden", !((m === "player" && selected) || (m === "team" && $("#team").value)));
    $("#cmpBox").classList.toggle("hidden", m !== "compare");
    $("#pickBox").classList.toggle("hidden", m !== "picks");
    $("#sugg").classList.add("hidden");
    $("#pq").placeholder = m === "watch" ? "Aggiungi un giocatore da osservare…" : SEARCH_PH;
    $("#pq").value = m === "player" && selected ? selected.name : m === "team" && $("#team").value ? (M.TEAM[$("#team").value] || {}).name || "" : "";
  }
  /* dalla barra di navigazione o dalle linguette; reset = "Cerca" toccato di nuovo: ricerca vuota */
  function go(m, reset, fromHistory) {
    if (reset) { selected = null; $("#team").value = ""; suggList = []; m = "player"; }
    setMode(m, fromHistory);
    run();
  }
  function openPlayer(id, name) {
    selected = { id, name: name || ctx.names.get(id) };
    setMode("player");
    window.scrollTo({ top: 0, behavior: "smooth" });
    run();
  }
  function openTeam(tri) {
    $("#team").value = tri;
    setMode("team");
    window.scrollTo({ top: 0, behavior: "smooth" });
    run();
  }
  /* partita (casa, ospite) → confronto fra le due squadre */
  function openMatch(h, a) {
    $("#cmpKind").value = "teams"; cmpKindSync();
    $("#cmpA").dataset.set = 1; $("#cmpA").value = h; $("#cmpB").value = a;
    setMode("compare");
    window.scrollTo({ top: 0, behavior: "smooth" });
    run();
  }

  // ricerca unica: squadre (in cima) e giocatori
  const nrm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  $("#pq").addEventListener("input", () => {
    selected = null;
    const q = $("#pq").value.trim();
    if (q.length < 2 || !ctx) { suggList = []; return $("#sugg").classList.add("hidden"); }
    const n = nrm(q);
    const teams = mode === "watch" ? [] : M.TEAMS.filter(t => [t.name, t.full, t.tri].some(x => x && nrm(x).includes(n)))
      .slice(0, 3).map(t => ({ isTeam: true, tid: t.tri, name: t.name }));
    suggList = [...teams, ...ctx.searchPlayers(q)];
    suggIdx = -1;
    renderSugg();
  });
  function renderSugg() {
    const box = $("#sugg");
    box.innerHTML = suggList.length ? suggList.map((p, i) => p.isTeam
      ? `<div data-i="${i}" class="${i === suggIdx ? "hl" : ""}">${who(L(p.tid, "s"), esc(p.name))} <small>squadra</small></div>`
      : `<div data-i="${i}" class="${i === suggIdx ? "hl" : ""}">${who(P(p.id, p.name), esc(p.name))} <small>${esc(p.team)} · ${p.games} gare</small></div>`).join("")
      : `<div><small>Nessun risultato</small></div>`;
    box.classList.remove("hidden");
    box.querySelectorAll("[data-i]").forEach(d => d.onmousedown = d.ontouchstart = e => { e.preventDefault(); pick(+d.dataset.i); });
  }
  function pick(i) {
    const s = suggList[i];
    if (!s) return;   // Invio senza risultati
    $("#sugg").classList.add("hidden");
    $("#pq").blur();
    suggList = [];
    if (mode === "watch") { if (!s.isTeam) addWatch(s); $("#pq").value = ""; return renderWatch(); }
    if (s.isTeam) return openTeam(s.tid);
    openPlayer(s.id, s.name);
  }
  $("#pq").addEventListener("keydown", e => {
    if ($("#sugg").classList.contains("hidden")) { if (e.key === "Enter") run(); return; }
    if (e.key === "ArrowDown") { suggIdx = Math.min(suggList.length - 1, suggIdx + 1); renderSugg(); e.preventDefault(); }
    if (e.key === "ArrowUp") { suggIdx = Math.max(0, suggIdx - 1); renderSugg(); e.preventDefault(); }
    if (e.key === "Enter") pick(suggIdx >= 0 ? suggIdx : 0);
    if (e.key === "Escape") $("#sugg").classList.add("hidden");
  });
  $("#pq").addEventListener("blur", () => setTimeout(() => $("#sugg").classList.add("hidden"), 150));
  $("#go").onclick = () => (mode === "team" ? ($("#team").value && openCompare($("#team").value)) : run());
  $("#team").onchange = run;
  $("#cmpA").onchange = $("#cmpB").onchange = run;
  $("#pkKind").onchange = $("#pkGame").onchange = $("#pkStat").onchange = $("#pkMin").onchange = run;
  $("#opp").onchange = () => { if (selected || $("#team").value) run(); };

  function run() {
    if (!ctx) return;
    try {
      if (mode === "today") { $("#out").innerHTML = renderToday(); Today.bind(run, openMatch, () => go("picks")); Slip.bind($("#out")); return bindRows(); }
      if (mode === "table") { $("#out").innerHTML = renderStandings(); return bindRows(); }
      if (mode === "leaders") { $("#out").innerHTML = renderLeaders(); Leaders.bind(run); return bindRows(); }
      if (mode === "gen") { $("#out").innerHTML = Gen.render(picksCfg()); Gen.bind(run); return bindRows(); }
      if (mode === "watch") return renderWatch();
      if (mode === "slip") return showSlip();
      if (mode === "compare") { $("#out").innerHTML = renderCompare(); mountTrend(); Adv.bind($("#out")); Slip.bind($("#out")); return bindRows(); }
      if (mode === "picks") { $("#out").innerHTML = renderPicks(); Adv.bind($("#out")); Slip.bind($("#out")); Picks.bindMore(run, openMatch); return bindRows(); }
      if (mode === "player") {
        if (!selected) { if (suggList.length && $("#pq").value.trim()) return pick(0); $("#out").innerHTML = searchHome(); return bindRows(); }
        $("#out").innerHTML = renderPlayer(playerResult(selected.id));
        $("#addw").onclick = () => { addWatch({ id: selected.id, name: selected.name }); $("#addw").textContent = "✓ tra gli osservati"; };
        $("#toPcmp").onclick = () => openPlayerCompare(selected.id);
      } else {
        const t = $("#team").value;
        if (!t) { $("#out").innerHTML = searchHome(); return bindRows(); }
        $("#out").innerHTML = renderTeam(t);
        const tc = $("#toCmp"); if (tc) tc.onclick = () => openCompare(t);
      }
      Adv.bind($("#out"));
      Thresh.bind($("#out"));
      Slip.bind($("#out"));
      bindRows();
    } catch (e) {
      $("#out").innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  }
  function bindRows() {
    document.querySelectorAll("[data-pid]").forEach(el => el.onclick = e => { if (!e.target.closest("[data-slip]")) openPlayer(+el.dataset.pid, el.dataset.name); });
    document.querySelectorAll("[data-tid]").forEach(el => el.onclick = () => openTeam(el.dataset.tid));
  }

  /* "Cerca" senza niente di scelto: tutte le squadre da toccare */
  function searchHome() {
    return `<h3 style="margin-top:0">Squadre <small class="nt">(oppure cerca un giocatore o una squadra qui sopra)</small></h3>
      <div class="tlist">${M.TEAMS.map(t => `<button class="tbtn" data-tid="${t.tri}">${L(t.tri, "m")}<span>${esc(t.name)}</span></button>`).join("")}</div>`;
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
      openPlayer(+b.dataset.proj);
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
    return Thresh.card({ label: s.label, proj: s.proj, likely: lk, avgs: av, lines: s.lines, def: defLine(s),
      points: trendPoints(d.player.id, s.stat, 10), unit: s.label.toLowerCase(),
      slip: sl ? (line, prob) => Slip.button({ key: `p|${d.game.id}|${d.player.id}|${s.stat}|${line}`, kind: "p",
        gid: d.game.id, utc: d.game.utc, pid: d.player.id, prob, text: `${d.player.name}: ${s.label.toLowerCase()} almeno ${line}`,
        sub: `${slipTeam(d.player.team)} ${d.game.home === false ? "@" : "vs"} ${slipTeam(d.opponent)}` }) : null });
  }


  function renderPlayer(d) {
    const w = d.warnings.map(x => `<div class="warn">⚠ ${esc(x)}</div>`).join("");
    const recent = d.recent.map(g => `<tr><td>${esc(g.date.slice(5))}</td><td>${g.home ? "vs" : "@"} ${esc(g.opp)}</td><td>${g.min}</td><td>${g.pts}</td><td>${g.reb}</td><td>${g.ast}</td><td>${g.fg3m}</td></tr>`).join("");
    const h2h = d.h2h_games.length ? d.h2h_games.map(g => `<tr><td>${esc(g.date)}</td><td>${g.min}</td><td>${g.pts}</td><td>${g.reb}</td><td>${g.ast}</td><td>${g.fg3m}</td></tr>`).join("")
      : `<tr><td colspan="6" style="color:var(--muted)">Nessun precedente nelle ultime stagioni</td></tr>`;
    return `
    <div class="hero">
      <div class="idt">${P(d.player.id, d.player.name, "l")}<div><h2>${esc(d.player.name)}</h2><div class="sub">${L(d.player.team.tri, "s")} ${esc(d.player.team.name)}
        <button class="link" id="addw" data-id="${d.player.id}">${watch.some(w => w.id === d.player.id) ? "✓ tra gli osservati" : "+ Osserva"}</button>
        <button class="link" id="toPcmp">⇄ Confronta</button></div>
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

  // ------------------------------------------------------------ scheda squadra (solo la squadra) e confronto
  /* rosa con le medie della stagione in corso, senza avversario */
  function rosterBlock(tri) {
    const list = ctx.teamPlayers(tri).map(pid => {
      const cur = (ctx.playerLogs.get(pid) || []).filter(g => g.season === ctx.season && g.min > 0);
      if (!cur.length) return null;
      const a = f => cur.reduce((x, g) => x + f(g), 0) / cur.length;
      return { pid, name: ctx.names.get(pid), n: cur.length, min: a(g => g.min), inj: ctx.injury(pid),
               v: { PTS: a(g => g.pts), REB: a(g => g.reb), AST: a(g => g.ast), FG3M: a(g => g.fg3m), STL: a(g => g.stl), BLK: a(g => g.blk), PRA: a(g => g.pts + g.reb + g.ast) } };
    }).filter(Boolean).sort((x, y) => y.min - x.min);
    if (!list.length) return "";
    const rows = list.map(p => {
      const warn = p.inj ? ` <span class="inj" title="${esc(p.inj.status)}">${esc((p.inj.status || "").slice(0, 3))}</span>` : "";
      return `<tr class="click" data-pid="${p.pid}" data-name="${esc(p.name)}"><td>${who(P(p.pid, p.name), esc(p.name) + warn)}</td><td class="hm2">${p.n}</td><td>${p.min.toFixed(1)}</td>${COLS.map(c => `<td${HIDE_M.has(c) ? ' class="hm2"' : ""}>${p.v[c].toFixed(1)}</td>`).join("")}</tr>`;
    }).join("");
    return `<h3>Rosa · medie della stagione <small class="nt">(tocca un nome per il dettaglio)</small></h3>
      <div class="scroll"><table><tr><th>Giocatore</th><th class="hm2">Gare</th><th>Min</th>${COLS.map(c => `<th${HIDE_M.has(c) ? ' class="hm2"' : ""}>${SHORT[c]}</th>`).join("")}</tr>${rows}</table></div>`;
  }

  function renderTeam(tri) {
    const g = ctx.nextGame(tri);
    let absent = [], playing = [];
    if (g) { const r = ctx.projectTeam(tri, g.opp, g.home); absent = r.absent; playing = r.players.map(p => p.player); }
    const out = absent.length ? `<div class="warn">Assenti o in dubbio: ${absent.map(a => `${esc(a.name)} <small>(${esc(a.reason)})</small>`).join(", ")}</div>` : "";
    return `
    <div class="hero"><div class="idt">${L(tri, "l")}<div><h2>${esc(M.TEAM[tri].name)}</h2>
      <div class="sub">${g ? `Prossima partita: ${g.home ? "vs" : "@"} ${esc(g.opp)} · ${esc(fmtDate(g.utc))}` : "Nessuna partita in calendario"}</div>
      <button class="link" id="toCmp">Confronta con un'altra squadra →</button></div></div></div>
    ${BasketAdv.teamTiles(ctx, M, GM, tri)}
    ${rosterBlock(tri)}${out}
    ${BasketAdv.teamSection(ctx, M, GM, tri)}
    ${Absence.teamSection(ctx, ABS, tri, absent, playing)}`;
  }

  /* "Analizza" dalla scheda squadra: va al confronto con quella squadra (avversario di partenza: la prossima partita) */
  function openCompare(tri) {
    if (!$("#cmpA").options.length) cmpOptions();
    const g = ctx.nextGame(tri);
    $("#cmpA").value = tri;
    $("#cmpB").value = g ? g.opp : M.TEAMS.find(t => t.tri !== tri).tri;
    $("#cmpA").dataset.set = 1;
    $("#cmpKind").value = "teams"; cmpKindSync();
    setMode("compare");
    window.scrollTo({ top: 0, behavior: "smooth" });
    run();
  }

  /* giocatori delle due squadre a confronto, statistica per statistica (proiezioni nella partita fra le due) */
  function duel(tA, tB) {
    const cards = tA.leaders.filter(l => l.stat !== "TOV").map(l => {
      const lb = tB.leaders.find(x => x.stat === l.stat) || { players: [] };
      const all = [...l.players.slice(0, 5).map(p => ({ ...p, tri: tA.team.tri })), ...lb.players.slice(0, 5).map(p => ({ ...p, tri: tB.team.tri }))]
        .sort((x, y) => y.proj - x.proj).slice(0, 6);
      return `<div class="card leader"><div class="name">${esc(l.label)}</div><ol>
        ${all.map(p => `<li class="click" data-pid="${p.id}" data-name="${esc(p.name)}"><span>${L(p.tri, "s")} ${who(P(p.id, p.name), esc(p.name))} ${p.likely ? `<small>≥${p.likely.line} ${pct(p.likely.prob)}</small>` : ""}</span><span class="v">${p.proj}</span></li>`).join("")}
      </ol></div>`;
    }).join("");
    return `<h3>Giocatori a confronto · proiezioni nella partita <small class="nt">(i migliori delle due squadre per ogni statistica)</small></h3><div class="grid">${cards}</div>`;
  }


  // ------------------------------------------------------------ occasioni (previsioni più probabili della prossima giornata)
  const PICK_MIN = { PTS: 10, REB: 4, AST: 3, FG3M: 2, STL: 1, BLK: 1, TOV: 2, PRA: 15 };   // soglie minime (sotto sono previsioni banali)
  let BT = null;   // verifica del modello (data/backtest.json), caricata senza far aspettare l'app
  function picksCfg() {
    return {
      backtest: BT, sportName: "LBA",
      ctx, schedule: ctx.schedule, windowH: 60, defMin: 70,
      project: (tri, opp, home) => ctx.projectTeam(tri, opp, home),
      short: id => id, name: id => (M.TEAM[id] || {}).name || id,
      logo: (id, size) => L(id, size), photo: (pid, nm) => P(pid, nm),
      stats: M.ALL_STATS.map(s => [s, M.LABELS[s]]),
      minLine: PICK_MIN,
      sport: "basket",
      teamModel: (h, a) => BasketAdv.gameModel(ctx, M, GM, h, a),
      teamHist: tri => BasketAdv.teamGames(ctx, M, GM, tri),
      teamNote: "Punti attesi da ritmo e rating offensivo/difensivo delle due squadre in questa stagione (vantaggio del campo incluso).",
      el: { kind: $("#pkKind"), game: $("#pkGame"), stat: $("#pkStat"), min: $("#pkMin") },
    };
  }
  function renderPicks() { return Picks.render(picksCfg()); }

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
  const slipBadge = () => Nav.badge(Slip.count());
  Slip.init("lba", slipBadge);
  function showSlip() { $("#out").innerHTML = Slip.render(); Slip.bindPage(showSlip); }
  /* risultati per la schedina: punteggi e tabellini delle partite finite */
  function slipResults() {
    const G = new Map(), PL = new Map();
    for (const logs of ctx.playerLogs.values()) for (const r of logs) {
      const k = String(r.gid);
      let g = G.get(k);
      if (!g) { g = { pts: {}, h: r.home ? r.tri : r.opp, a: r.home ? r.opp : r.tri }; G.set(k, g); }
      g.pts[r.tri] = (g.pts[r.tri] || 0) + (+r.pts || 0);
      PL.set(k + "|" + r.pid, r);
    }
    return {
      game: gid => {
        const g = G.get(gid);
        if (g) return { done: true, h: g.h, a: g.a, hs: g.pts[g.h] || 0, as: g.pts[g.a] || 0 };
        const s = ctx.schedule.find(x => String(x.id) === gid);
        return { done: false, live: !!s && s.state === "in" };
      },
      player: (gid, pid, stat) => { const r = PL.get(gid + "|" + pid); return r && r.min > 0 ? STATV(stat)(r) : null; },
    };
  }

  // ------------------------------------------------------------ confronto fra squadre
  function cmpOptions() {
    const keepA = $("#cmpA").value, keepB = $("#cmpB").value;
    const opts = M.TEAMS.map(t => `<option value="${t.tri}">${esc(t.name)}</option>`).join("");
    $("#cmpA").innerHTML = opts; $("#cmpB").innerHTML = opts;
    if (keepA) $("#cmpA").value = keepA;
    if (keepB) $("#cmpB").value = keepB;
    playerOptions();
  }

  // ------------------------------------------------------------ andamento (grafici) e confronto fra giocatori
  const STATV = s => g => s === "PRA" ? g.pts + g.reb + g.ast : +g[{ PTS: "pts", REB: "reb", AST: "ast", FG3M: "fg3m", STL: "stl", BLK: "blk", TOV: "tov" }[s]] || 0;
  const oppAbbr = o => o, oppName = o => o, teamLbl = tri => tri || "—";
  let TREND = null;   // grafico da disegnare dopo aver messo la pagina (vedi run)
  function trendPoints(pid, s, n) {
    const f = STATV(s);
    return (ctx.playerLogs.get(pid) || []).filter(g => g.min > 0).slice(0, n).reverse().map(g => {
      const v = f(g);
      return { v, label: oppAbbr(g.opp), old: g.season !== ctx.season,
               title: `${g.date.split("-").reverse().join("/")} ${g.home ? "vs" : "@"} ${oppName(g.opp)}: ${v} (${Math.round(g.min)}')` };
    });
  }
  const statLines = s => (s.lines || []).map(l => l.line);
  const defLine = s => (s.likely ? s.likely.line : s.lines && s.lines.length ? s.lines.reduce((a, l) => (Math.abs(l.line - s.proj) < Math.abs(a.line - s.proj) ? l : a)).line : null);
  function playerTrend(d) {
    TREND = { el: "trendBox", title: "Andamento · ultime 20 partite", note: "(verde = soglia raggiunta, rosso = no; barre chiare = stagione scorsa; puntini = media)",
      stats: d.stats.filter(s => s.lines && s.lines.length).map(s => ({ key: s.stat, label: s.label, lines: statLines(s), def: defLine(s) })),
      series: k => [{ name: d.player.name, cls: "sa", points: trendPoints(d.player.id, k, 20) }] };
    return `<div id="trendBox"></div>`;
  }
  function mountTrend() { if (TREND) { Trend.mount(document.getElementById(TREND.el), TREND); TREND = null; } }

  // elenco dei giocatori per i campi del confronto ("Nome · Squadra")
  let PLMAP = new Map();
  function playerOptions() {
    if (!ctx) return;   // all'avvio i dati non sono ancora caricati
    PLMAP = new Map();
    const opts = [];
    for (const [pid, name] of ctx.names) {
      const tm = ctx.playerTeam(pid);
      if (!tm || !(ctx.playerLogs.get(pid) || []).length) continue;
      const v = `${name} · ${teamLbl(tm)}`;
      PLMAP.set(v, pid); opts.push(v);
    }
    $("#cmpPL").innerHTML = opts.sort((a, b) => a.localeCompare(b)).map(v => `<option value="${esc(v)}"></option>`).join("");
  }
  const pidOf = v => {
    if (PLMAP.has(v)) return PLMAP.get(v);
    const n = M.norm ? M.norm(String(v).split(" · ")[0]) : String(v).toLowerCase();
    for (const [k, pid] of PLMAP) if ((M.norm ? M.norm(k.split(" · ")[0]) : k.toLowerCase()) === n) return pid;
    return null;
  };
  const labelOf = pid => [...PLMAP].find(([, p]) => p === pid)?.[0] || ctx.names.get(pid) || "";
  function cmpKindSync() {
    if (!PLMAP.size) playerOptions();
    const pl = $("#cmpKind").value === "players";
    $("#cmpA").classList.toggle("hidden", pl); $("#cmpB").classList.toggle("hidden", pl);
    $("#cmpPA").classList.toggle("hidden", !pl); $("#cmpPB").classList.toggle("hidden", !pl);
  }
  $("#cmpKind").onchange = () => { cmpKindSync(); run(); };
  $("#cmpPA").onchange = $("#cmpPB").onchange = run;

  /* dalla scheda giocatore: apre il confronto con questo giocatore già scelto */
  function openPlayerCompare(pid) {
    if (!PLMAP.size) playerOptions();
    $("#cmpKind").value = "players"; cmpKindSync();
    $("#cmpPA").value = labelOf(pid); $("#cmpPB").value = "";
    setMode("compare");
    window.scrollTo({ top: 0, behavior: "smooth" });
    run();
    setTimeout(() => $("#cmpPB").focus(), 300);
  }

  function pside(pid) {
    const tm = ctx.playerTeam(pid), g = tm && ctx.nextGame(tm);
    let pr = null; try { pr = g ? ctx.project(pid, g.opp, g.home) : null; } catch { pr = null; }
    const logs = (ctx.playerLogs.get(pid) || []).filter(x => x.min > 0);
    return { pid, name: ctx.names.get(pid), tm, g, pr, cur: logs.filter(x => x.season === ctx.season), l10: logs.slice(0, 10) };
  }

  function renderPlayerCompare() {
    if (!PLMAP.size) playerOptions();
    const a = pidOf($("#cmpPA").value), b = pidOf($("#cmpPB").value);
    if (!a || !b) return `<div class="msg">Scrivi o scegli due giocatori nei campi qui sopra (anche della stessa squadra).</div>`;
    if (a === b) return `<div class="msg">Scegli due giocatori diversi.</div>`;
    const S = [pside(a), pside(b)];
    const ST = [["PTS", "Punti", 1], ["REB", "Rimbalzi", 1], ["AST", "Assist", 1], ["FG3M", "Triple", 1], ["STL", "Rubate", 1], ["BLK", "Stoppate", 1], ["TOV", "Palle perse", -1], ["PRA", "Punti+Rimb+Ass", 1]];
    const metrics = [], vals = [{}, {}];
    const add = (key, label, group, fmt, dir, f) => { metrics.push({ key, label, group, fmt, dir }); S.forEach((x, i) => { vals[i][key] = f(x); }); };
    add("pmin", "Minuti attesi", "Prossima partita (proiezione)", "n1", 0, x => (x.pr ? x.pr.minutes : null));
    for (const [k, l, d] of ST) add("p" + k, l, "Prossima partita (proiezione)", "n1", d, x => { const s = x.pr && x.pr.stats.find(y => y.stat === k); return s ? s.proj : null; });
    const avg = (list, f) => (list.length ? list.reduce((t, g) => t + f(g), 0) / list.length : null);
    add("sgp", "Partite", "Media stagione", "n0", 0, x => x.cur.length);
    add("smin", "Minuti", "Media stagione", "n1", 0, x => avg(x.cur, g => g.min));
    for (const [k, l, d] of ST) add("s" + k, l, "Media stagione", "n1", d, x => avg(x.cur, STATV(k)));
    for (const [k, l, d] of ST) add("l" + k, l, "Ultime 10 partite", "n1", d, x => avg(x.l10, STATV(k)));
    const AV = S.map(x => BasketAdv.playerVals(ctx, M, GM, x.pid));
    for (const m of AV[0].metrics) { metrics.push({ ...m, key: "a" + m.key, group: "Avanzate (stagione)" }); AV.forEach((av, i) => { vals[i]["a" + m.key] = av.vals[m.key]; }); }

    const head = x => `<div class="tname">${P(x.pid, x.name, "m")}<span>${esc(x.name)}</span></div>
      <div class="tsub">${x.tm ? L(x.tm, "s") + " " + esc(teamLbl(x.tm)) : "—"}${x.g ? ` · prossima ${x.g.home ? "vs" : "@"} ${esc(oppName(x.g.opp))}` : ""}</div>`;
    const same = S[0].tm && S[0].tm === S[1].tm;
    const note = same
      ? `Stessa squadra: le proiezioni sono contro lo stesso avversario${S[0].g ? ` (${esc(oppName(S[0].g.opp))}, ${esc(fmtDate(S[0].g.utc))})` : ""}.`
      : `Squadre diverse: ognuno è proiettato contro il proprio prossimo avversario.`;
    // grafico: statistiche in comune con le soglie della proiezione
    const ref = (S[0].pr || S[1].pr);
    const stats = ref ? ref.stats.filter(s => s.lines && s.lines.length).map(s => {
      const o = S[1].pr && S[1].pr.stats.find(y => y.stat === s.stat);
      const lines = [...new Set([...statLines(s), ...(o ? statLines(o) : [])])].sort((x, y) => x - y);
      return { key: s.stat, label: s.label, lines, def: defLine(s) };
    }) : [];
    TREND = stats.length ? { el: "trendCmp", title: "Andamento a confronto · ultime 15 partite", note: "(tocca un punto per partita e valore)", stats,
      series: k => S.map((x, i) => ({ name: x.name, cls: i ? "sb" : "sa", points: trendPoints(x.pid, k, 15) })) } : null;
    return `<h3 style="margin-top:0">Confronta giocatori · stagione ${esc(ctx.season)}</h3><div class="advnote" style="margin:0 0 10px">${note}</div>`
      + Adv.compare(metrics, { vals: vals[0], html: head(S[0]) }, { vals: vals[1], html: head(S[1]) })
      + `<div id="trendCmp"></div>`;
  }

  function renderCompare() {
    if ($("#cmpKind").value === "players") return renderPlayerCompare();
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
    // proiezioni dei giocatori nella partita fra le due (in casa di chi gioca davvero, altrimenti campo neutro)
    const home = g && g.opp === b ? g.home : null;
    const tA = ctx.projectTeam(a, b, home), tB = ctx.projectTeam(b, a, home == null ? null : !home);
    const where = home == null ? `<div class="advnote" style="margin:0 0 10px">Non si affrontano a breve: proiezioni a campo neutro.</div>` : "";
    return `<h3 style="margin-top:0">Confronta squadre · stagione ${esc(ctx.season)}</h3>${next}${where}`
      + duel(tA, tB)
      + `<h3>Squadre a confronto</h3>` + BasketAdv.compare(ctx, M, GM, a, b, head)
      + Adv.section("cmpA:" + a, `Proiezioni · ${M.TEAM[a].name} contro ${M.TEAM[b].name}`, teamBlock(tA) + oppChips(ctx.opponentProfile(b)))
      + Adv.section("cmpB:" + b, `Proiezioni · ${M.TEAM[b].name} contro ${M.TEAM[a].name}`, teamBlock(tB) + oppChips(ctx.opponentProfile(a)));
  }

  // ------------------------------------------------------------ oggi, classifiche
  function renderToday() {
    return Today.render({
      ctx, schedule: ctx.schedule, sport: "basket", defMin: 70, tz: "Europe/Rome",
      teamModel: (h, a) => BasketAdv.gameModel(ctx, M, GM, h, a),
      project: (tri, opp, home) => ctx.projectTeam(tri, opp, home),
      short: id => id, name: id => (M.TEAM[id] || {}).name || id,
      logo: (id, size) => L(id, size), photo: (pid, nm) => P(pid, nm),
      minLine: PICK_MIN, skip: new Set(["TOV"]),
    });
  }

  function renderStandings() {
    const all = BasketAdv.standings(ctx, M, GM);
    if (!all.length) return `<div class="msg">Nessuna partita giocata in questa stagione.</div>`;
    const sg = v => (v > 0 ? "+" : "") + v.toFixed(1).replace(".", ",");
    const table = (list, title) => `<h3${title ? "" : ' style="margin-top:0"'}>${title || `Classifica ${esc(ctx.season)} <small class="nt">(calcolata dai risultati · tocca una squadra per la scheda)</small>`}</h3>
      <div class="scroll"><table class="std"><tr><th>Squadra</th><th>G</th><th>V</th><th>P</th><th>%V</th><th class="hm2">Fatti</th><th class="hm2">Subiti</th><th>Diff.</th><th>Forma</th></tr>
      ${list.map((x, i) => `<tr class="click" data-tid="${x.tri}"><td><span class="pos">${i + 1}</span> ${who(L(x.tri, "s"), esc((M.TEAM[x.tri] || {}).name || x.tri))}</td>
        <td>${x.gp}</td><td>${x.w}</td><td>${x.l}</td><td>${Math.round(x.w / x.gp * 100)}%</td><td class="hm2">${(x.pf / x.gp).toFixed(1)}</td><td class="hm2">${(x.pa / x.gp).toFixed(1)}</td>
        <td class="${x.pf > x.pa ? "up" : x.pf < x.pa ? "dn" : ""}">${sg((x.pf - x.pa) / x.gp)}</td><td class="form">${x.form.map(r => `<i class="${r}">${r}</i>`).join("")}</td></tr>`).join("")}</table></div>`;
    return table(all);
  }

  function renderLeaders() {
    return Leaders.render({
      ctx, sport: "lba", seasons: ctx.seasons,
      rows: season => { const out = []; for (const l of ctx.playerLogs.values()) for (const g of l) if (g.season === season && g.min > 0) out.push(g); return out; },
      team: r => r.tri, sums: Leaders.BASKET_SUMS, teamSums: true, cats: Leaders.BASKET,
      modes: [["pg", "A partita"], ["tot", "Totali"]],
      name: pid => ctx.names.get(pid), teamName: t => (M.TEAM[t] || {}).name || t, short: t => t,
      photo: (pid, nm) => P(pid, nm), logo: (t, s) => L(t, s), canOpen: pid => !!ctx.playerTeam(pid),
    });
  }

  // ------------------------------------------------------------ avvio
  teamOptions();
  setMode(Nav.init({ sport: "lba", go }));
  $("#out").innerHTML = `<div class="msg">Caricamento dati…</div>`;
  loadData().catch(e => {
    $("#status").innerHTML = `<span style="color:var(--bad)">Dati non disponibili: ${esc(e.message)}</span>`;
    $("#out").innerHTML = `<div class="err">Non riesco a caricare i dati. Se l'app è appena stata creata, il primo aggiornamento potrebbe essere ancora in corso.</div>`;
  });
})();
