/* Interfaccia: carica i dati da data/, costruisce il modello e disegna i risultati. */
(function () {
  "use strict";
  const GM = 48;   // minuti di una partita
  const M = window.NBAModel;
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

  async function liveInjuries() {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const d = await getJSON("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
                              { signal: ctrl.signal, cache: "no-store" });
      const out = [];
      for (const team of d.injuries || []) for (const inj of team.injuries || []) {
        const a = inj.athlete || {};
        let id = a.id;
        if (!id) for (const l of a.links || []) { const m = /\/id\/(\d+)/.exec(l.href || ""); if (m) { id = m[1]; break; } }
        out.push({ id: id ? String(id) : null, name: a.displayName,
                   status: inj.status || (inj.type || {}).description, comment: inj.shortComment || "" });
      }
      return out.length ? out : null;
    } catch { return null; } finally { clearTimeout(t); }
  }


  // ------------------------------------------------------------ partite nuove direttamente da ESPN
  const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/";
  const ALIAS = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS", PHO: "PHX", BRK: "BKN", NOR: "NOP" };
  const triOf = a => { const t = ALIAS[a] || a; return M.TEAM[t] ? t : null; };
  const num = x => { const n = parseFloat(x); return isNaN(n) ? 0 : n; };
  const madeAtt = x => { const m = /(\d+)\s*-\s*(\d+)/.exec(String(x || "")); return m ? [+m[1], +m[2]] : [0, 0]; };
  const ymd = d => d.toISOString().slice(0, 10);

  // ------------------------------------------------------------ immagini (ESPN)
  const CDN = "https://a.espncdn.com";
  const LOGO_ABBR = { GSW: "gs", NYK: "ny", SAS: "sa", NOP: "no", UTA: "utah", WAS: "wsh" };
  const crop = (path, w, h) => `${CDN}/combiner/i?img=${path}&w=${w}&h=${h}`;
  const P = (id, name, size) => {
    const p = `/i/headshots/nba/players/full/${id}.png`;
    return Media.player([crop(p, 160, 116), CDN + p], name, size);
  };
  const L = (tri, size) => {
    const p = `/i/teamlogos/nba/500/${(LOGO_ABBR[tri] || tri || "").toLowerCase()}.png`;
    return Media.team([crop(p, 96, 96), CDN + p], tri, size, (M.TEAM[tri] || {}).name);
  };
  const who = (img, text) => `<span class="who">${img}<span>${text}</span></span>`;

  async function espn(path, ms = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { return await getJSON(ESPN + path, { signal: ctrl.signal, cache: "no-store" }); }
    finally { clearTimeout(t); }
  }

  function parseEvent(ev, day) {
    const comp = (ev.competitions || [{}])[0];
    const teams = {};
    for (const c of comp.competitors || []) { const t = triOf((c.team || {}).abbreviation); if (t) teams[c.homeAway] = t; }
    if (!teams.home || !teams.away) return null;
    const st = ((comp.status || ev.status || {}).type) || {};
    return { id: String(ev.id), date: day, utc: ev.date, home: teams.home, away: teams.away,
             state: st.state, completed: !!st.completed, stype: (ev.season || {}).type };
  }

  function parseSummary(sum, ev) {
    const rows = [];
    for (const side of ((sum.boxscore || {}).players || [])) {
      const tri = triOf((side.team || {}).abbreviation);
      if (!tri) continue;
      const home = tri === ev.home, opp = home ? ev.away : ev.home;
      for (const block of side.statistics || []) {
        const labels = (block.labels || block.names || []).map(x => String(x).toUpperCase());
        const ix = Object.fromEntries(labels.map((l, i) => [l, i]));
        if (!("MIN" in ix) || !("PTS" in ix)) continue;
        for (const a of block.athletes || []) {
          const st = a.stats || [];
          if (a.didNotPlay || st.length < labels.length) continue;
          const v = k => k in ix ? st[ix[k]] : null;
          const m = String(v("MIN") || "");
          const min = m.includes(":") ? num(m.split(":")[0]) + num(m.split(":")[1]) / 60 : num(m);
          if (min <= 0) continue;
          const ath = a.athlete || {};
          rows.push({ pid: +ath.id, name: ath.displayName || ath.shortName, tri, gid: ev.id, date: ev.date, opp,
                      home: home ? 1 : 0, min: Math.round(min * 10) / 10, pts: num(v("PTS")), reb: num(v("REB")),
                      oreb: num(v("OREB")), ast: num(v("AST")), fg3m: madeAtt(v("3PT"))[0], stl: num(v("STL")),
                      blk: num(v("BLK")), tov: num(v("TO")), fga: madeAtt(v("FG"))[1], fta: madeAtt(v("FT"))[1],
                      fgm: madeAtt(v("FG"))[0], ftm: madeAtt(v("FT"))[0], fg3a: madeAtt(v("3PT"))[1] });
        }
      }
    }
    return rows;
  }

  /* Scarica le partite concluse dopo l'ultimo aggiornamento automatico e aggiorna il calendario. */
  async function liveGames(meta, curLogs) {
    const have = new Set(curLogs.map(r => r.gid));
    const last = curLogs.reduce((a, r) => r.date > a ? r.date : a, "");
    // data di oggi negli USA (ESPN ragiona con le date americane)
    const todayUS = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const end = new Date(Date.UTC(todayUS.getFullYear(), todayUS.getMonth(), todayUS.getDate()));
    let d = last ? new Date(last + "T00:00:00Z") : new Date(end);
    if (end - d > 10 * 864e5) d = new Date(end - 10 * 864e5);   // al massimo 10 giorni indietro
    const days = [];
    for (; d <= end; d = new Date(+d + 864e5)) days.push(ymd(d));
    const boards = await Promise.all(days.map(day =>
      espn(`scoreboard?dates=${day.replace(/-/g, "")}&limit=100`).then(b => [day, b]).catch(() => [day, null])));
    const events = [];
    const states = new Map();
    for (const [day, b] of boards) {
      if (!b) continue;
      for (const raw of b.events || []) {
        const ev = parseEvent(raw, day);
        if (!ev) continue;
        states.set(ev.id, ev);
        if (ev.completed && ev.stype === 2 && !have.has(ev.id)) events.push(ev);
      }
    }
    // aggiorna lo stato delle partite in calendario (in corso / finite)
    const schedule = (meta.schedule || []).map(g => states.has(g.id) ? { ...g, state: states.get(g.id).state } : g)
      .filter(g => g.state !== "post");
    const rows = [];
    for (let i = 0; i < events.length; i += 4) {
      const chunk = await Promise.all(events.slice(i, i + 4).map(ev =>
        espn(`summary?event=${ev.id}`).then(s => parseSummary(s, ev)).catch(() => null)));
      for (const r of chunk) if (r) rows.push(...r);
    }
    return { rows, games: new Set(rows.map(r => r.gid)).size, schedule, ok: boards.some(([, b]) => b) };
  }

  async function loadData() {
    $("#status").textContent = "Caricamento dati…";
    const meta = await getJSON("data/meta.json", { cache: "no-store" });
    getJSON(`data/backtest.json?v=${encodeURIComponent(meta.updated_at || "")}`).then(j => { BT = j; if (mode === "picks") run(); }).catch(() => {});
    const v = encodeURIComponent(meta.updated_at || "");
    const files = await Promise.all(meta.files.map(f => getJSON(`data/${f}?v=${v}`).then(j => [f, j])));
    const logs = {};
    for (const [f, j] of files) {
      const season = f.split("/").pop().slice(0, 7);
      (logs[season] ||= []).push(...M.decodeLogFile(j));
    }
    // partite finite dopo l'ultimo aggiornamento automatico: le scarico subito da ESPN
    $("#status").textContent = "Cerco partite nuove su ESPN…";
    let liveNote = "";
    try {
      const lv = await liveGames(meta, logs[meta.season] || []);
      if (lv.ok) {
        if (lv.rows.length) (logs[meta.season] ||= []).push(...lv.rows);
        meta.schedule = lv.schedule;
        liveNote = lv.games ? ` (+${lv.games} ${lv.games === 1 ? "partita appena finita" : "partite appena finite"})` : " a ora";
      }
    } catch { /* restano i dati dell'ultimo aggiornamento automatico */ }
    ctx = new M.Context({ ...meta, logs });
    let injSrc = "ultimo aggiornamento";
    const live = await liveInjuries();
    if (live) { ctx.setInjuries(live); injSrc = "in tempo reale"; }
    const upd = meta.updated_at ? new Date(meta.updated_at).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "?";
    $("#status").innerHTML = liveNote
      ? `Stagione ${esc(ctx.season)} · statistiche aggiornate${esc(liveNote)} · infortuni ${esc(injSrc)} <button id="refresh">Ricarica</button>`
      : `Stagione ${esc(ctx.season)} · statistiche al ${esc(upd)} · infortuni ${esc(injSrc)} <button id="refresh">Ricarica</button>`;
    $("#refresh").onclick = async () => { await loadData(); run(); };
    if (selected || $("#team").value) run();
  }

  function teamOptions() {
    const opts = M.TEAMS.map(t => `<option value="${t.tri}">${esc(t.name)}</option>`).join("");
    $("#team").innerHTML = `<option value="">Scegli una squadra…</option>` + opts;
    $("#opp").innerHTML = `<option value="">Avversario: prossima partita</option>` + opts;
    cmpOptions();
  }

  // ------------------------------------------------------------ logica
  function opponent(tri) {
    const o = $("#opp").value;
    if (o) {
      if (o === tri) throw new Error("Avversario uguale alla squadra.");
      return { opp: o, home: null, utc: null, manual: true };
    }
    const g = ctx.nextGame(tri);
    if (!g) throw new Error(`Nessuna partita in calendario nei prossimi 14 giorni per ${M.TEAM[tri].name}. Scegli un avversario dal menu.`);
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
    $("#pq").placeholder = mode === "watch" ? "Aggiungi un giocatore da osservare…" : "Cerca un giocatore (es. Jokic, Tatum, Doncic)…";
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
  const WKEY = "nbaprops.watch";
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
      ["MIN", l.min], ["PT", l.pts, cmp(l.pts, avg.PTS)], ["RB", l.reb, cmp(l.reb, avg.REB)],
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
    const live = tri && ctx.schedule.find(g => g.state === "in" && (g.home === tri || g.away === tri));
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

  function fullLine(sum, pid) {
    for (const side of ((sum.boxscore || {}).players || [])) {
      for (const block of side.statistics || []) {
        const labels = (block.labels || block.names || []).map(x => String(x).toUpperCase());
        const ix = Object.fromEntries(labels.map((l, i) => [l, i]));
        for (const a of block.athletes || []) {
          if (+(a.athlete || {}).id !== pid) continue;
          const st = a.stats || [];
          if (a.didNotPlay || !st.length) return { dnp: true, reason: a.reason || "" };
          const v = k => k in ix ? st[ix[k]] : "–";
          return { min: v("MIN"), pts: num(v("PTS")), reb: num(v("REB")), ast: num(v("AST")), fg: v("FG"), tp: v("3PT"),
                   fg3m: madeAtt(v("3PT"))[0], ft: v("FT"), stl: num(v("STL")), blk: num(v("BLK")), tov: num(v("TO")), pm: v("+/-") };
        }
      }
    }
    return null;
  }

  function gameHeader(sum, tri) {
    const comp = ((sum.header || {}).competitions || [])[0] || {};
    let me = null, op = null;
    for (const c of comp.competitors || []) { if (triOf((c.team || {}).abbreviation) === tri) me = c; else op = c; }
    const st = ((comp.status || {}).type) || {};
    if (!me || !op) return "";
    const where = me.homeAway === "home" ? "vs" : "@";
    const oppTri = triOf((op.team || {}).abbreviation) || "";
    const score = `${me.score ?? ""}-${op.score ?? ""}`;
    const det = String(st.shortDetail || "").replace(/Halftime/i, "Intervallo").replace(/End of /i, "Fine ")
      .replace(/(\d)(st|nd|rd|th)\b/g, "$1° quarto").replace(/OT/g, "suppl.");
    if (st.state === "in") return `<span class="live">IN CORSO</span> ${where} ${esc(oppTri)} · ${esc(score)} · ${esc(det)}`;
    const res = st.completed ? (me.winner ? `<b class="up">V</b> ${esc(score)}` : `<b class="dn">S</b> ${esc(score)}`) : "";
    const date = comp.date ? new Date(comp.date).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }) : "";
    return `${esc(date)} · ${where} ${esc(oppTri)} · ${res}`;
  }

  async function enrichWatch(w) {
    const el = document.querySelector(`#w-${w.id} .wbody`);
    if (!el || !el.dataset.gid) return;
    try {
      const sum = await espn(`summary?event=${el.dataset.gid}`);
      const tri = ctx.playerTeam(w.id);
      const line = fullLine(sum, w.id);
      const head = gameHeader(sum, tri);
      let html = `<div class="ghead">${head}</div>`;
      if (!line) html += `<div class="msg small">${el.dataset.live ? "Non è ancora entrato in campo." : "Tabellino non disponibile."}</div>`;
      else if (line.dnp) html += `<div class="msg small">Non ha giocato${line.reason ? ": " + esc(line.reason) : ""}.</div>`;
      else html += boxCells(line, el.dataset.live ? {} : seasonAvg(w.id));  // niente confronti a partita in corso
      if (document.body.contains(el)) el.innerHTML = html;
    } catch { /* restano i dati salvati */ }
  }

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
    return `<h3>Cosa concede ${L(prof.team.tri, "s")} ${esc(prof.team.name)} rispetto alla media NBA <small class="nt">(1ª = la più permissiva)</small></h3><div class="opp">${c.join("")}</div>`;
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
    ${teamBlock(t)}
    ${oppChips(d.opp_profile)}
    ${d.opponent ? `<div class="sep"></div>${teamBlock(d.opponent)}${oppChips(d.own_profile)}` : ""}
    ${BasketAdv.teamSection(ctx, M, GM, t.team.tri)}
    ${Absence.teamSection(ctx, ABS, t.team.tri, t.absent, t.players.map(p => p.player))}`;
  }

  // ------------------------------------------------------------ occasioni (previsioni più probabili della prossima giornata)
  let BT = null;   // verifica del modello (data/backtest.json), caricata senza far aspettare l'app
  function renderPicks() {
    return Picks.render({
      backtest: BT, sportName: "NBA",
      ctx, schedule: ctx.schedule, windowH: 20, defMin: 70,
      project: (tri, opp, home) => ctx.projectTeam(tri, opp, home),
      short: id => id, name: id => (M.TEAM[id] || {}).name || id,
      logo: (id, size) => L(id, size), photo: (pid, nm) => P(pid, nm),
      stats: M.ALL_STATS.map(s => [s, M.LABELS[s]]),
      minLine: { PTS: 10, REB: 4, AST: 4, FG3M: 2, STL: 1, BLK: 1, TOV: 2, PRA: 20 },
      sport: "basket",
      teamModel: (h, a) => BasketAdv.gameModel(ctx, M, GM, h, a),
      teamHist: tri => BasketAdv.teamGames(ctx, M, GM, tri),
      teamNote: "Punti attesi da ritmo e rating offensivo/difensivo delle due squadre in questa stagione (vantaggio del campo incluso).",
      el: { kind: $("#pkKind"), game: $("#pkGame"), stat: $("#pkStat"), min: $("#pkMin") },
    });
  }

  // ------------------------------------------------------------ effetto assenze dei compagni
  const ABS = {
    team: r => r.tri, main: "pts", mainVerb: "segnano", minRole: 20, minWith: 3, minWithout: 2,
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
  Slip.init("nba", slipBadge);
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
