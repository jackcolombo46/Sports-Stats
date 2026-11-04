/* Interfaccia: carica i dati da data/, costruisce il modello e disegna i risultati. */
(function () {
  "use strict";
  const M = window.SportModel;
  SoccerAdv.configure({ name: "Champions League", understat: false });
  const $ = s => document.querySelector(s);
  let ctx = null, mode = "player", selected = null, suggIdx = -1, suggList = [];

  const pct = p => Math.round(p * 100) + "%";
  const color = p => p >= .65 ? "var(--good)" : p >= .4 ? "var(--mid)" : "var(--bad)";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ord = n => n + "ª";
  const fmtDate = utc => utc ? new Date(utc).toLocaleString("it-IT",
    { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
  const T = tid => (ctx && ctx.TEAM[tid]) || { tid, abbr: "?", name: "?", short: "?" };
  const fx = x => x == null ? "–" : Number.isInteger(x) ? String(x) : x.toFixed(x < 10 ? 2 : 1).replace(/0$/, "");

  // ------------------------------------------------------------ dati
  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }

  // ------------------------------------------------------------ partite nuove direttamente da ESPN
  const STAT_KEYS = { totalGoals: "gol", goalAssists: "ast", totalShots: "sh", shotsOnTarget: "sot", foulsCommitted: "fc",
                      foulsSuffered: "fs", yellowCards: "yc", redCards: "rc", saves: "sv", goalsConceded: "gc", expectedGoals: "xg" };
  let ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/";
  const num = x => { if (x && typeof x === "object") x = x.value ?? x.displayValue; const n = parseFloat(x); return isNaN(n) ? 0 : n; };
  const flag = x => x && typeof x === "object" ? !!(x.didSub ?? x.value) : !!x;
  const minute = c => {
    if (c && typeof c === "object") return c.displayValue ? minute(c.displayValue) : c.value != null ? Math.min(90, Math.floor(num(c.value) / 60)) : null;
    const m = /^\s*(\d+)/.exec(String(c || "")); return m ? Math.min(90, +m[1]) : null;
  };
  const ymd = d => d.toISOString().slice(0, 10);

  // ------------------------------------------------------------ immagini (ESPN)
  const CDN = "https://a.espncdn.com";
  const crop = (path, w, h) => `${CDN}/combiner/i?img=${path}&w=${w}&h=${h}`;
  const P = (id, name, size) => {
    const p = `/i/headshots/soccer/players/full/${id}.png`;
    return Media.player([crop(p, 160, 116), CDN + p], name, size);
  };
  const L = (tid, size) => {
    const p = `/i/teamlogos/soccer/500/${tid}.png`;
    return Media.team([crop(p, 96, 96), CDN + p], T(tid).abbr, size, T(tid).name);
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
    const sides = {}, score = {};
    for (const c of comp.competitors || []) { const id = String((c.team || {}).id || ""); if (id) { sides[c.homeAway] = id; score[c.homeAway] = c.score; } }
    if (!sides.home || !sides.away) return null;
    const st = ((comp.status || ev.status || {}).type) || {};
    const sc = x => { const n = parseInt(x && typeof x === "object" ? x.value ?? x.displayValue : x); return isNaN(n) ? null : n; };
    return { id: String(ev.id), date: day, utc: ev.date, home: sides.home, away: sides.away, hg: sc(score.home), ag: sc(score.away),
             state: st.state, completed: !!st.completed, detail: st.shortDetail || "" };
  }

  function eventMinutes(sum) {
    const out = {};
    for (let e of [...(sum.keyEvents || []), ...(sum.commentary || [])]) {
      e = e.play || e;
      const typ = String(((e.type || {}).text) || ((e.type || {}).type) || "").toLowerCase();
      if (!typ.includes("substitution") && !typ.includes("red")) continue;
      const m = minute(e.clock); if (m == null) continue;
      const ids = (e.participants || []).map(p => String((p.athlete || {}).id));
      if (typ.includes("red")) { if (ids[0]) (out[ids[0]] ||= {}).out = m; }
      else for (const id of ids) ((out[id] ||= {}).subs ||= []).push(m);
    }
    return out;
  }

  function playerMinutes(p, em0) {
    const starter = flag(p.starter), subIn = flag(p.subbedIn), subOut = flag(p.subbedOut);
    if (!starter && !subIn) return 0;
    let tIn = null, tOut = null;
    for (const pl of p.plays || []) {
      const m = minute(pl.clock); if (m == null) continue;
      if (pl.substitution) { if (subIn && !starter && tIn == null) tIn = m; else if (subOut) tOut = m; }
      if (pl.redCard) tOut = tOut == null ? m : Math.min(tOut, m);
    }
    const em = em0[String((p.athlete || {}).id)] || {};
    const subs = [...new Set(em.subs || [])].sort((a, b) => a - b);
    if (subIn && !starter && tIn == null && subs.length) tIn = subs[0];
    if (subOut && tOut == null && subs.length && (starter || subs.length > 1)) tOut = subs[subs.length - 1];
    if (em.out != null) tOut = tOut == null ? em.out : Math.min(tOut, em.out);
    const start = starter ? 0 : tIn ?? 70, end = tOut ?? (subOut && starter ? 70 : 90);
    return Math.max(1, Math.min(90, end) - start);
  }

  function statsOf(p) {
    const o = Object.fromEntries(Object.values(STAT_KEYS).map(k => [k, 0]));
    let st = p.stats || [];
    if (!Array.isArray(st)) st = Object.entries(st).map(([name, value]) => ({ name, value }));
    for (const s of st) { const k = STAT_KEYS[s.name || s.abbreviation]; if (k) o[k] = num(s.value ?? s.displayValue); }
    if (!st.some(s => (s.name || s.abbreviation) === "expectedGoals")) delete o.xg;   // xG non presente
    return o;
  }

  /* statistiche di squadra della partita (possesso, passaggi, contrasti...): {tid: {nome: valore}} */
  function teamStats(sum) {
    const out = {};
    for (const t of ((sum.boxscore || {}).teams || [])) {
      const tid = String((t.team || {}).id || ""), st = {};
      for (const x of t.statistics || []) {
        const v = parseFloat(String(x.value ?? x.displayValue ?? "").replace("%", ""));
        if (x.name && isFinite(v)) st[x.name] = v;
      }
      if (tid && Object.keys(st).length) out[tid] = st;
    }
    return out;
  }

  function parseSummary(sum, ev) {
    const rows = [], em = eventMinutes(sum);
    for (const side of sum.rosters || []) {
      const tid = String((side.team || {}).id || "");
      if (tid !== ev.home && tid !== ev.away) continue;
      const home = tid === ev.home;
      for (const p of side.roster || []) {
        const min = playerMinutes(p, em);
        const ath = p.athlete || {};
        if (min <= 0 || !ath.id) continue;
        const pos = String((p.position || {}).abbreviation || "").toUpperCase();
        rows.push({ pid: +ath.id, name: ath.displayName || ath.shortName, tid, gid: ev.id, date: ev.date,
                    opp: home ? ev.away : ev.home, home: home ? 1 : 0, min, start: flag(p.starter) ? 1 : 0,
                    gk: /^(G|GK)$/.test(pos) ? 1 : 0, ...statsOf(p) });
      }
    }
    return rows;
  }

  /* Scarica le partite concluse dopo l'ultimo aggiornamento automatico e aggiorna il calendario. */
  async function liveGames(meta, curGames) {
    const have = new Set(curGames.map(g => g.gid));
    const last = curGames.reduce((a, g) => g.date > a ? g.date : a, "");
    const now = new Date();
    const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    let d = last ? new Date(last + "T00:00:00Z") : new Date(end);
    if (end - d > 10 * 864e5) d = new Date(end - 10 * 864e5);
    const days = [];
    for (; d <= end; d = new Date(+d + 864e5)) days.push(ymd(d));
    const boards = await Promise.all(days.map(day =>
      espn(`scoreboard?dates=${day.replace(/-/g, "")}&limit=100`).then(b => [day, b]).catch(() => [day, null])));
    const events = [], states = new Map();
    for (const [day, b] of boards) {
      if (!b) continue;
      for (const raw of b.events || []) {
        const ev = parseEvent(raw, day);
        if (!ev || states.has(ev.id)) continue;
        states.set(ev.id, ev);
        if (ev.completed && !have.has(ev.id)) events.push(ev);
      }
    }
    const schedule = (meta.schedule || []).map(g => states.has(g.id) ? { ...g, state: states.get(g.id).state } : g)
      .filter(g => g.state !== "post");
    const rows = [], games = [];
    for (let i = 0; i < events.length; i += 4) {
      const chunk = await Promise.all(events.slice(i, i + 4).map(ev =>
        espn(`summary?event=${ev.id}`).then(s => [ev, parseSummary(s, ev), teamStats(s)]).catch(() => null)));
      for (const c of chunk) if (c) { rows.push(...c[1]); TSTATS[c[0].id] = c[2]; games.push({ gid: c[0].id, date: c[0].date, home: c[0].home, away: c[0].away, hg: c[0].hg, ag: c[0].ag }); }
    }
    return { rows, games, schedule, live: [...states.values()].filter(e => e.state === "in"), ok: boards.some(([, b]) => b) };
  }

  let liveNow = [];
  let TSTATS = {}, XG = null;   // statistiche di squadra per partita e xG di Understat (statistiche avanzate)
  async function loadData() {
    $("#status").textContent = "Caricamento dati…";
    const meta = await getJSON("data/meta.json", { cache: "no-store" });
    getJSON(`data/backtest.json?v=${encodeURIComponent(meta.updated_at || "")}`).then(j => { BT = j; if (mode === "picks") run(); }).catch(() => {});
    if (meta.league) ESPN = `https://site.api.espn.com/apis/site/v2/sports/soccer/${meta.league}/`;
    const v = encodeURIComponent(meta.updated_at || "");
    const files = await Promise.all(meta.files.map(f => getJSON(`data/${f}?v=${v}`).then(j => [f, j])));
    const logs = {}, games = {}, teams = {};
    TSTATS = {}; XG = meta.xg || null;
    for (const [f, j] of files) {
      Object.assign(TSTATS, j.tstats || {});
      const season = f.split("/").pop().slice(0, 7);
      const d = M.decodeLogFile(j);
      (logs[season] ||= []).push(...d.rows);
      (games[season] ||= []).push(...d.games);
      Object.assign(teams, d.teams);
    }
    Object.assign(teams, meta.teams || {});
    $("#status").textContent = "Cerco partite nuove su ESPN…";
    let liveNote = "";
    try {
      const lv = await liveGames(meta, games[meta.season] || []);
      if (lv.ok) {
        if (lv.rows.length) { (logs[meta.season] ||= []).push(...lv.rows); (games[meta.season] ||= []).push(...lv.games); }
        meta.schedule = lv.schedule;
        liveNow = lv.live;
        liveNote = lv.games.length ? ` (+${lv.games.length} ${lv.games.length === 1 ? "partita appena finita" : "partite appena finite"})` : " a ora";
      }
    } catch { /* restano i dati dell'ultimo aggiornamento automatico */ }
    ctx = new M.Context({ ...meta, teams, logs, games });
    teamOptions();
    cmpOptions();
    const upd = meta.updated_at ? new Date(meta.updated_at).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "?";
    $("#status").innerHTML = liveNote
      ? `Stagione ${esc(ctx.season)} · statistiche aggiornate${esc(liveNote)} <button id="refresh">Ricarica</button>`
      : `Stagione ${esc(ctx.season)} · statistiche al ${esc(upd)} <button id="refresh">Ricarica</button>`;
    $("#refresh").onclick = async () => { await loadData(); run(); };
    Slip.setResults(slipResults());
    run();
  }

  function teamOptions() {
    const keepT = $("#team").value, keepO = $("#opp").value;
    const opts = ctx.TEAMS.map(t => `<option value="${t.tid}">${esc(t.name)}</option>`).join("");
    $("#team").innerHTML = `<option value="">Scegli una squadra…</option>` + opts;
    $("#opp").innerHTML = `<option value="">Avversario: prossima partita</option>` + opts;
    $("#team").value = keepT; $("#opp").value = keepO;
  }

  // ------------------------------------------------------------ logica
  function opponent(tid) {
    const o = $("#opp").value;
    if (o) {
      if (o === tid) throw new Error("Avversario uguale alla squadra.");
      return { opp: o, home: null, utc: null, manual: true };
    }
    const g = ctx.nextGame(tid);
    if (!g) throw new Error(`Nessuna partita in calendario nei prossimi 50 giorni per ${T(tid).name}. Scegli un avversario dal menu.`);
    return g;
  }

  function playerResult(pid) {
    const tid = ctx.playerTeam(pid);
    if (!tid) throw new Error("Giocatore non trovato.");
    const game = opponent(tid);
    const res = ctx.project(pid, game.opp, game.home);
    if (!res) throw new Error("Nessuna partita disponibile per questo giocatore.");
    res.game = game;
    res.opp_profile = ctx.opponentProfile(game.opp);
    return res;
  }

  function teamResult(tid, both) {
    const game = opponent(tid);
    const res = { game, team: ctx.projectTeam(tid, game.opp, game.home),
                  opp_profile: ctx.opponentProfile(game.opp), own_profile: ctx.opponentProfile(tid) };
    if (both) res.opponent = ctx.projectTeam(game.opp, tid, game.home == null ? null : !game.home);
    return res;
  }

  // ------------------------------------------------------------ UI
  /* modi interni: today, picks (voce Oggi) · player, team (Cerca) · compare · table, leaders (Classifiche) · slip, watch (Schedina) */
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
    $("#pq").placeholder = m === "watch" ? "Aggiungi un giocatore da osservare…" : "Cerca un giocatore o una squadra (es. Mbappé, Bayern)…";
    $("#pq").value = m === "player" && selected ? selected.name : m === "team" && $("#team").value ? T($("#team").value).name : "";
  }
  /* dalla barra di navigazione o dalle linguette; reset = "Cerca" toccato di nuovo: ricerca vuota */
  function go(m, reset, fromHistory) {
    if (reset) { selected = null; $("#team").value = ""; suggList = []; m = "player"; }
    setMode(m, fromHistory);
    run();
  }
  function openTeam(tid) {
    $("#team").value = tid; $("#opp").value = "";
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
  $("#pq").addEventListener("input", () => {
    selected = null;
    const q = $("#pq").value.trim();
    if (q.length < 2 || !ctx) { suggList = []; return $("#sugg").classList.add("hidden"); }
    const n = M.norm(q);
    const teams = mode === "watch" ? [] : ctx.TEAMS.filter(t => [t.name, t.short, t.abbr].some(x => x && M.norm(x).includes(n)))
      .slice(0, 3).map(t => ({ isTeam: true, tid: t.tid, name: t.name }));
    suggList = [...teams, ...ctx.searchPlayers(q)];
    suggIdx = -1;
    renderSugg();
  });
  function renderSugg() {
    const box = $("#sugg");
    box.innerHTML = suggList.length ? suggList.map((p, i) => p.isTeam
      ? `<div data-i="${i}" class="${i === suggIdx ? "hl" : ""}">${who(L(p.tid, "s"), esc(p.name))} <small>squadra</small></div>`
      : `<div data-i="${i}" class="${i === suggIdx ? "hl" : ""}">${who(P(p.id, p.name), esc(p.name))} <small>${esc(T(p.team).short)} · ${p.games} pres.</small></div>`).join("")
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
      if (mode === "leaders") { $("#out").innerHTML = renderLeaders(); Leaders.bind(run); return bindRows(); }
      if (mode === "gen") { $("#out").innerHTML = Gen.render(picksCfg()); Gen.bind(run); return bindRows(); }
      if (mode === "watch") return renderWatch();
      if (mode === "table") { $("#out").innerHTML = renderTable(); return bindRows(); }
      if (mode === "slip") return showSlip();
      if (mode === "compare") { $("#out").innerHTML = renderCompare(); mountTrend(); Adv.bind($("#out")); Slip.bind($("#out")); return bindRows(); }
      if (mode === "picks") { $("#out").innerHTML = renderPicks(); Adv.bind($("#out")); Slip.bind($("#out")); Picks.bindMore(run, openMatch); return bindRows(); }
      if (mode === "player") {
        if (!selected) { if (suggList.length && $("#pq").value.trim()) return pick(0); $("#out").innerHTML = searchHome(); return bindRows(); }
        $("#out").innerHTML = renderPlayer(playerResult(selected.id));
        $("#addw").onclick = () => { addWatch({ id: selected.id, name: selected.name }); $("#addw").textContent = "✓ tra gli osservati"; };
        $("#toPcmp").onclick = () => openPlayerCompare(selected.id);
        mountTrend();
      } else {
        const t = $("#team").value;
        if (!t) { $("#out").innerHTML = searchHome(); return bindRows(); }
        $("#out").innerHTML = renderTeam(t);
        const tc = $("#toCmp"); if (tc) tc.onclick = () => openCompare(t);
      }
      Adv.bind($("#out"));
      Slip.bind($("#out"));
      bindRows();
    } catch (e) {
      $("#out").innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  }
  function openPlayer(id, name) {
    selected = { id, name: name || ctx.names.get(id) };
    setMode("player");
    $("#pq").value = name;
    window.scrollTo({ top: 0, behavior: "smooth" });
    run();
  }
  function bindRows() {
    document.querySelectorAll("[data-pid]").forEach(el => el.onclick = e => { if (!e.target.closest("[data-slip]")) openPlayer(+el.dataset.pid, el.dataset.name); });
    document.querySelectorAll("[data-tid]").forEach(el => el.onclick = () => openTeam(el.dataset.tid));
  }

  /* "Cerca" senza niente di scelto: tutte le squadre da toccare */
  function searchHome() {
    const list = [...ctx.TEAMS].sort((a, b) => a.name.localeCompare(b.name));
    return `<h3 style="margin-top:0">Squadre <small class="nt">(oppure cerca un giocatore o una squadra qui sopra)</small></h3>
      <div class="tlist">${list.map(t => `<button class="tbtn" data-tid="${t.tid}">${L(t.tid, "m")}<span>${esc(t.name)}</span></button>`).join("")}</div>`;
  }

  // ------------------------------------------------------------ giocatori osservati
  const WKEY = "uclstats.watch";
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

  function boxCells(l, avg, keeper) {
    const cmp = (v, a) => a == null || a < 0.3 ? "" : v >= a * 1.5 ? "up" : v <= a * 0.5 ? "dn" : "";
    const cards = l.rc ? "🟥" : l.yc ? "🟨" : "–";
    const cells = keeper
      ? [["MIN", l.min], ["PARATE", l.sv, cmp(l.sv, avg.sv)], ["GOL SUB.", l.gc], ["FALLI", l.fc], ["CART.", cards]]
      : [["MIN", l.min], ["GOL", l.gol, l.gol > 0 ? "up" : ""], ["ASSIST", l.ast, l.ast > 0 ? "up" : ""],
         ["TIRI", l.sh, cmp(l.sh, avg.sh)], ["IN PORTA", l.sot, cmp(l.sot, avg.sot)],
         ["FALLI", l.fc], ["F. SUBITI", l.fs, cmp(l.fs, avg.fs)], ["CART.", cards]];
    return `<div class="box">${cells.map(([k, v, c]) => `<div class="${c || ""}"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>`;
  }

  function seasonAvg(pid) {
    const cur = (ctx.playerLogs.get(pid) || []).filter(g => g.season === ctx.season && g.min > 0);
    if (!cur.length) return { n: 0 };
    const a = k => cur.reduce((x, g) => x + g[k], 0) / cur.length;
    const t = k => cur.reduce((x, g) => x + g[k], 0);
    return { n: cur.length, gol: t("gol"), ast: t("ast"), sh: a("sh"), sot: a("sot"), fs: a("fs"), sv: a("sv"), min: a("min"), yc: t("yc") };
  }

  function watchCard(w) {
    const tid = ctx.playerTeam(w.id);
    const logs = (ctx.playerLogs.get(w.id) || []).filter(g => g.min > 0);
    const last = logs[0];
    const live = tid && liveNow.find(g => g.home === tid || g.away === tid);
    const next = tid && ctx.nextGame(tid);
    const avg = seasonAvg(w.id);
    const keeper = ctx.isKeeper(w.id);
    const inj = ctx.injury(w.id);
    let body;
    if (live) body = `<div class="ghead"><span class="live">IN CORSO</span> ${live.home === tid ? "vs" : "@"} ${esc(T(live.home === tid ? live.away : live.home).short)}</div><div class="msg small">Carico il tabellino…</div>`;
    else if (last) body = `<div class="ghead">${esc(shortDate(last.date))} · ${last.home ? "vs" : "@"} ${esc(T(last.opp).short)}</div>${boxCells(last, avg, keeper)}`;
    else body = `<div class="msg small">Nessuna presenza nelle ultime stagioni.</div>`;
    const avgLine = avg.n ? (keeper
      ? `<div class="avg">Stagione (${avg.n} pres.): <b>${avg.sv.toFixed(1)}</b> parate a partita · ${avg.min.toFixed(0)} min</div>`
      : `<div class="avg">Stagione (${avg.n} pres.): <b>${avg.gol}</b> gol · <b>${avg.ast}</b> assist · <b>${avg.sh.toFixed(1)}</b> tiri a partita · <b>${avg.yc}</b> gialli · ${avg.min.toFixed(0)} min</div>`) : "";
    const nextLine = next && !live ? `<div class="avg">Prossima: ${next.home ? "vs" : "@"} <b>${esc(T(next.opp).short)}</b> · ${esc(fmtDate(next.utc))}</div>` : "";
    return `<div class="card wcard" id="w-${w.id}">
      <div class="top"><div class="who">${P(w.id, ctx.names.get(w.id) || w.name, "m")}<div><span class="name">${esc(ctx.names.get(w.id) || w.name)}</span> <small class="tm">${tid ? L(tid, "s") : ""} ${esc(tid ? T(tid).short : "—")}</small>
        ${inj ? `<span class="inj" title="${esc(inj.comment)}">${esc(inj.status)}</span>` : ""}</div></div>
        <div class="wbtn"><button data-up="${w.id}" title="Su">↑</button><button data-dn="${w.id}" title="Giù">↓</button><button data-rm="${w.id}" title="Rimuovi">✕</button></div></div>
      <div class="wbody" data-gid="${live ? live.id : ""}" data-live="${live ? 1 : ""}">${body}</div>
      ${avgLine}${nextLine}
      ${tid && next ? `<button class="link" data-proj="${w.id}">Vedi la proiezione per la prossima partita →</button>` : ""}
    </div>`;
  }

  async function enrichWatch(w) {
    const el = document.querySelector(`#w-${w.id} .wbody`);
    if (!el || !el.dataset.gid) return;
    try {
      const sum = await espn(`summary?event=${el.dataset.gid}`);
      const comp = ((sum.header || {}).competitions || [])[0] || {};
      const cs = comp.competitors || [];
      const h = cs.find(c => c.homeAway === "home") || {}, a = cs.find(c => c.homeAway === "away") || {};
      const ev = { id: el.dataset.gid, date: "", home: String((h.team || {}).id), away: String((a.team || {}).id) };
      const line = parseSummary(sum, ev).find(r => r.pid === w.id);
      const st = ((comp.status || {}).type) || {};
      let html = `<div class="ghead"><span class="live">IN CORSO</span> ${esc(T(ev.home).short)} ${esc(h.score ?? "")}-${esc(a.score ?? "")} ${esc(T(ev.away).short)} · ${esc(st.shortDetail || "")}</div>`;
      html += line ? boxCells(line, {}, ctx.isKeeper(w.id)) : `<div class="msg small">Non è ancora entrato in campo.</div>`;
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
    document.querySelectorAll("[data-proj]").forEach(b => b.onclick = () => openPlayer(+b.dataset.proj, ctx.names.get(+b.dataset.proj)));
    watch.forEach(enrichWatch);
  }

  // ------------------------------------------------------------ render
  function matchupLine(tid, game, opp) {
    const where = game.home === false ? "@" : "vs";
    const when = game.manual ? "avversario scelto a mano (campo neutro)" : (game.live ? "IN CORSO · " : "") + fmtDate(game.utc) + (game.home ? " · in casa" : " · in trasferta");
    return `<div class="vs">${L(tid, "s")} ${esc(T(tid).short)} ${where} ${L(opp, "s")} <b>${esc(T(opp).short)}</b></div><div class="sub">${esc(when)}</div>`;
  }

  function matchBox(tid, opp, m, home) {
    const [h, a, lh, la, ph, pa] = home === false ? [opp, tid, m.xg_opp, m.xg, m.loss, m.win] : [tid, opp, m.xg, m.xg_opp, m.win, m.loss];
    return `<div class="match">
      <div class="mrow"><span>${L(h, "s")} ${esc(T(h).short)}</span><b>${lh.toFixed(1)}</b><small>gol attesi</small><b>${la.toFixed(1)}</b><span>${esc(T(a).short)} ${L(a, "s")}</span></div>
      <div class="odds"><div><span>1</span><b>${pct(ph)}</b></div><div><span>X</span><b>${pct(m.draw)}</b></div><div><span>2</span><b>${pct(pa)}</b></div>
        <div><span>Over 2,5</span><b>${pct(m.over25)}</b></div><div><span>Gol/Gol</span><b>${pct(m.btts)}</b></div></div></div>`;
  }

  function oppChips(prof) {
    const chip = (label, f, rank) => {
      const d = Math.round((f - 1) * 100);
      return `<span class="chip">${esc(label)}: <b class="${d > 0 ? "up" : d < 0 ? "dn" : ""}">${d > 0 ? "+" : ""}${d}%</b> <small>(${ord(rank)})</small></span>`;
    };
    const c = [chip("Gol subiti", prof.goals.factor, prof.goals.rank), ...prof.allowed.map(a => chip(a.label + " avversari", a.factor, a.rank))];
    return `<h3>Cosa concede ${L(prof.team.tid, "s")} ${esc(prof.team.name)} rispetto alla media <small class="nt">(1ª = la più permissiva)</small></h3><div class="opp">${c.join("")}</div>`;
  }

  function statCard(s, d) {
    if (s.stat === "CS") return `<div class="card">
      <div class="top"><span class="name">${esc(s.label)}</span><span class="proj">${pct(s.p1)}</span></div>
      <div class="likely">Gol attesi dell'avversario: <b>${s.xg_opp.toFixed(2)}</b></div>
      <div class="avgs"><span>Clean sheet in stagione <b>${s.season_tot ?? 0}</b></span></div></div>`;
    const yes = s.stat === "YC";
    const lk = yes ? `Probabilità di ammonizione: <b>${pct(s.p1)}</b>`
      : s.likely ? `Molto probabile: <b>almeno ${s.likely.line}</b> (${pct(s.likely.prob)})` : `Almeno 1: <b style="color:${color(s.p1)}">${pct(s.p1)}</b>`;
    const av = [
      s.season_avg != null ? `Stagione <b>${fx(s.season_avg)}</b>${s.season_tot != null && ["GOL", "AST", "GA", "YC"].includes(s.stat) ? ` <small>(tot. ${s.season_tot})</small>` : ""}` : s.prev_avg != null ? `Anno scorso <b>${fx(s.prev_avg)}</b>` : "",
      `Ult. 10 <b>${fx(s.l10_avg)}</b>`,
      s.h2h_avg != null ? `vs avv. <b>${fx(s.h2h_avg)}</b>` : "",
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
      <div class="top"><span class="name">${esc(s.label)}</span><span class="proj">${yes ? pct(s.p1) : s.proj.toFixed(2)}</span></div>
      <div class="likely">${lk}</div>
      <div class="avgs">${av}</div>
      ${yes ? "" : `<div class="ln lnh${sl ? " slp" : ""}"><span>soglia</span><span>probabilità</span><span></span><span class="hr">U10</span>${sl ? "<span></span>" : ""}</div>${lines}`}</div>`;
  }

  function renderPlayer(d) {
    const w = d.warnings.map(x => `<div class="warn">⚠ ${esc(x)}</div>`).join("");
    const k = d.player.keeper;
    const cards = g => g.rc ? "🟥" : g.yc ? "🟨" : "";
    const recent = d.recent.map(g => `<tr><td>${esc(g.date.slice(5))}</td><td>${g.home ? "vs" : "@"} ${esc(T(g.opp).abbr)}</td><td>${g.min}${g.start ? "" : "<small>*</small>"}</td>${k
      ? `<td>${g.sv}</td><td>${g.gc}</td>` : `<td>${g.gol}</td><td>${g.ast}</td><td>${g.sh}</td><td>${g.sot}</td><td class="hm2">${g.fc}</td>`}<td>${cards(g)}</td></tr>`).join("");
    const h2h = d.h2h_games.length ? d.h2h_games.map(g => `<tr><td>${esc(g.date)}</td><td>${g.min}</td>${k ? `<td>${g.sv}</td>` : `<td>${g.gol}</td><td>${g.ast}</td><td>${g.sh}</td><td>${g.sot}</td>`}<td>${g.yc ? "🟨" : ""}</td></tr>`).join("")
      : `<tr><td colspan="7" style="color:var(--muted)">Nessun precedente nelle ultime stagioni</td></tr>`;
    const head = k ? "<th>Par</th><th>GS</th>" : `<th>Gol</th><th>As</th><th>Tiri</th><th>InP</th><th class="hm2">Falli</th>`;
    const head2 = k ? "<th>Par</th>" : "<th>Gol</th><th>As</th><th>Tiri</th><th>InP</th>";
    return `
    <div class="hero">
      <div class="idt">${P(d.player.id, d.player.name, "l")}<div><h2>${esc(d.player.name)}</h2><div class="sub">${L(d.player.team.tid, "s")} ${esc(d.player.team.name)}${k ? " · portiere" : ""}
        <button class="link" id="addw" data-id="${d.player.id}">${watch.some(x => x.id === d.player.id) ? "✓ tra gli osservati" : "+ Osserva"}</button>
        <button class="link" id="toPcmp">⇄ Confronta</button></div>
        ${matchupLine(d.player.team.tid, d.game, d.opponent.tid)}</div></div>
      <div class="kpis">
        <div class="kpi"><b>${d.minutes}'</b><span>minuti attesi</span></div>
        <div class="kpi"><b>${d.starts5}/${Math.min(5, d.games.season)}</b><span>titolare ult. 5</span></div>
        <div class="kpi"><b>${d.games.season}</b><span>presenze</span></div>
        <div class="kpi"><b>${d.yc}</b><span>gialli</span></div>
      </div>
    </div>${w}
    ${matchBox(d.player.team.tid, d.opponent.tid, d.match, d.home)}
    <h3>Proiezioni contro ${esc(d.opponent.name)} <small class="nt">(se gioca i minuti attesi)</small></h3>
    <div class="grid">${d.stats.map(s => statCard(s, d)).join("")}</div>
    ${playerTrend(d)}
    ${oppChips(d.opp_profile)}
    <div class="two">
      <div><h3>Ultime 10 presenze <small class="nt">(* = entrato dalla panchina)</small></h3><div class="scroll"><table><tr><th>Data</th><th>Avv.</th><th>Min</th>${head}<th></th></tr>${recent}</table></div></div>
      <div><h3>Precedenti contro ${esc(d.opponent.short)}</h3><div class="scroll"><table><tr><th>Data</th><th>Min</th>${head2}<th></th></tr>${h2h}</table></div></div>
    </div>
    ${SoccerAdv.playerSection(ctx, TSTATS, XG, d.player.id)}
    ${Absence.playerSection(ctx, ABS, d.player.id)}`;
  }

  function teamBlock(t) {
    const leaders = t.leaders.map(l => `
      <div class="card leader"><div class="name">${esc(l.label)}</div><ol>
        ${l.players.slice(0, 3).map(p => `<li data-pid="${p.id}" data-name="${esc(p.name)}" class="click"><span>${who(P(p.id, p.name), esc(p.name))}</span><span class="v">${
          l.stat === "GOL" || l.stat === "AST" || l.stat === "YC" ? pct(p.p1) : p.proj.toFixed(1)}</span></li>`).join("")}
      </ol></div>`).join("");
    const st = (p, s) => p.stats.find(x => x.stat === s);
    const rows = t.players.filter(p => !p.player.keeper).map(p => {
      const warn = p.injury ? ` <span class="inj" title="${esc(p.injury.status)}">${esc((p.injury.status || "").slice(0, 3))}</span>` : "";
      return `<tr class="click" data-pid="${p.player.id}" data-name="${esc(p.player.name)}"><td>${who(P(p.player.id, p.player.name), esc(p.player.name) + warn)}</td><td class="hm2">${p.minutes}'</td>
        <td>${pct(st(p, "GOL").p1)}</td><td>${pct(st(p, "AST").p1)}</td><td>${st(p, "SH").proj.toFixed(1)}</td><td>${st(p, "SOT").proj.toFixed(1)}</td>
        <td class="hm2">${st(p, "FC").proj.toFixed(1)}</td><td>${st(p, "FS").proj.toFixed(1)}</td><td>${pct(st(p, "YC").p1)}</td></tr>`;
    }).join("");
    const gks = t.players.filter(p => p.player.keeper).map(p =>
      `<span class="chip click" data-pid="${p.player.id}" data-name="${esc(p.player.name)}">🧤 ${P(p.player.id, p.player.name)} ${esc(p.player.name)}: <b>${st(p, "SV").proj.toFixed(1)}</b> parate · porta inviolata <b>${pct(st(p, "CS").p1)}</b></span>`).join("");
    const absent = t.absent.length ? `<div class="warn">Esclusi: ${t.absent.map(a => `${esc(a.name)} <small>(${esc(a.reason)})</small>`).join(", ")}</div>` : "";
    return `
      <h3>Chi è più probabile che faccia cosa · ${L(t.team.tid, "s")} ${esc(t.team.name)} contro ${L(t.opponent.tid, "s")} ${esc(t.opponent.short)}</h3>
      <div class="grid">${leaders}</div>
      <h3>Proiezioni per giocatore <small class="nt">(tocca un nome per il dettaglio · % = probabilità di almeno 1)</small></h3>
      <div class="scroll"><table><tr><th>Giocatore</th><th class="hm2">Min</th><th>Gol</th><th>Ass.</th><th>Tiri</th><th>InP</th><th class="hm2">Falli</th><th>F.sub</th><th>Giallo</th></tr>${rows}</table></div>
      ${gks ? `<div class="opp" style="margin-top:10px">${gks}</div>` : ""}${absent}`;
  }

  // ------------------------------------------------------------ scheda squadra (solo la squadra) e confronto
  /* rosa con i numeri della stagione in corso, senza avversario */
  function rosterBlock(tid) {
    const list = ctx.teamPlayers(tid).map(pid => {
      const cur = (ctx.playerLogs.get(pid) || []).filter(g => g.season === ctx.season && g.min > 0);
      if (!cur.length) return null;
      const t = k => cur.reduce((x, g) => x + (+g[k] || 0), 0);
      return { pid, name: ctx.names.get(pid), n: cur.length, st: cur.filter(g => g.start).length, min: t("min") / cur.length,
               gol: t("gol"), ast: t("ast"), sh: t("sh"), sot: t("sot"), yc: t("yc"), sv: t("sv"), keeper: ctx.isKeeper(pid), inj: ctx.injury(pid) };
    }).filter(Boolean).sort((x, y) => (x.keeper - y.keeper) || y.n * y.min - x.n * x.min);
    if (!list.length) return "";
    const rows = list.map(p => {
      const warn = p.inj ? ` <span class="inj" title="${esc(p.inj.status)}">${esc((p.inj.status || "").slice(0, 3))}</span>` : "";
      return `<tr class="click" data-pid="${p.pid}" data-name="${esc(p.name)}"><td>${who(P(p.pid, p.name), (p.keeper ? "🧤 " : "") + esc(p.name) + warn)}</td>
        <td>${p.n}<small class="hm2"> (${p.st})</small></td><td class="hm2">${Math.round(p.min)}'</td><td>${p.gol}</td><td>${p.ast}</td><td>${p.sh}</td><td class="hm2">${p.sot}</td><td>${p.yc}</td><td class="hm2">${p.keeper ? p.sv : ""}</td></tr>`;
    }).join("");
    return `<h3>Rosa · numeri della stagione <small class="nt">(presenze, tra parentesi da titolare · tocca un nome per il dettaglio)</small></h3>
      <div class="scroll"><table><tr><th>Giocatore</th><th>Pres.</th><th class="hm2">Min</th><th>Gol</th><th>Ass.</th><th>Tiri</th><th class="hm2">InP</th><th>Gialli</th><th class="hm2">Parate</th></tr>${rows}</table></div>`;
  }

  function renderTeam(tid) {
    const g = ctx.nextGame(tid);
    let absent = [], playing = [];
    if (g) { const r = ctx.projectTeam(tid, g.opp, g.home); absent = r.absent; playing = r.players.map(p => p.player); }
    const out = absent.length ? `<div class="warn">Assenti o in dubbio: ${absent.map(a => `${esc(a.name)} <small>(${esc(a.reason)})</small>`).join(", ")}</div>` : "";
    return `
    <div class="hero"><div class="idt">${L(tid, "l")}<div><h2>${esc(T(tid).name)}</h2>
      <div class="sub">${g ? `Prossima partita: ${g.home ? "vs" : "@"} ${esc(T(g.opp).short)} · ${esc(fmtDate(g.utc))}` : "Nessuna partita in calendario"}</div>
      <button class="link" id="toCmp">Confronta con un'altra squadra →</button></div></div></div>
    ${SoccerAdv.teamTiles(ctx, TSTATS, XG, tid)}
    ${rosterBlock(tid)}${out}
    ${SoccerAdv.teamSection(ctx, TSTATS, XG, tid)}
    ${Absence.teamSection(ctx, ABS, tid, absent, playing)}`;
  }

  /* "Analizza" dalla scheda squadra: va al confronto con quella squadra (avversario di partenza: la prossima partita) */
  function openCompare(tid) {
    const g = ctx.nextGame(tid);
    $("#cmpA").value = tid;
    $("#cmpB").value = g ? g.opp : ctx.TEAMS.find(t => t.tid !== tid).tid;
    $("#cmpA").dataset.set = 1;
    $("#cmpKind").value = "teams"; cmpKindSync();
    setMode("compare");
    window.scrollTo({ top: 0, behavior: "smooth" });
    run();
  }

  /* giocatori delle due squadre a confronto, statistica per statistica (proiezioni nella partita fra le due) */
  function duel(tA, tB) {
    const cards = tA.leaders.map(l => {
      const lb = tB.leaders.find(x => x.stat === l.stat) || { players: [] };
      const pctStat = l.stat === "GOL" || l.stat === "AST" || l.stat === "YC";
      const all = [...l.players.slice(0, 5).map(p => ({ ...p, tid: tA.team.tid })), ...lb.players.slice(0, 5).map(p => ({ ...p, tid: tB.team.tid }))]
        .sort((x, y) => y.proj - x.proj).slice(0, 6);
      return `<div class="card leader"><div class="name">${esc(l.label)}</div><ol>
        ${all.map(p => `<li data-pid="${p.id}" data-name="${esc(p.name)}" class="click"><span>${L(p.tid, "s")} ${who(P(p.id, p.name), esc(p.name))}</span><span class="v">${pctStat ? pct(p.p1) : p.proj.toFixed(1)}</span></li>`).join("")}
      </ol></div>`;
    }).join("");
    return `<h3>Giocatori a confronto · proiezioni nella partita <small class="nt">(i migliori delle due squadre per ogni statistica · % = probabilità di almeno 1)</small></h3><div class="grid">${cards}</div>`;
  }

  function renderTable() {
    const rows = ctx.standings().map((x, i) => `<tr class="click" data-tid="${x.team.tid}"><td><span class="pos">${i + 1}</span> ${who(L(x.team.tid, "s"), esc(x.team.name))}</td>
      <td>${x.gp}</td><td class="hm">${x.w}</td><td class="hm">${x.d}</td><td class="hm">${x.l}</td><td class="hm">${x.gf}:${x.ga}</td><td>${x.gf - x.ga > 0 ? "+" : ""}${x.gf - x.ga}</td><td><b>${x.pts}</b></td>
      <td class="form">${x.form.map(r => `<i class="${r}">${r}</i>`).join("")}</td></tr>`).join("");
    return `<h3>Classifica fase campionato ${esc(ctx.season)} <small class="nt">(solo partite della fase a 36 squadre, calcolata dai risultati · tocca una squadra per la scheda)</small></h3>
      <div class="scroll"><table class="std"><tr><th>Squadra</th><th>G</th><th class="hm">V</th><th class="hm">N</th><th class="hm">P</th><th class="hm">Gol</th><th>DR</th><th>Pt</th><th>Forma</th></tr>${rows}</table></div>`;
  }

  // ------------------------------------------------------------ occasioni (previsioni più probabili della prossima giornata)
  const PICK_MIN = { SH: 2, FC: 2, FS: 2, SV: 2 };   // soglie minime (sotto sono previsioni banali)
  let BT = null;   // verifica del modello (data/backtest.json), caricata senza far aspettare l'app
  function picksCfg() {
    return {
      backtest: BT, sportName: "Champions League",
      ctx, schedule: ctx.schedule, windowH: 96, defMin: 65,
      project: (tid, opp, home) => ctx.projectTeam(tid, opp, home),
      short: id => T(id).short, name: id => T(id).name,
      logo: (id, size) => L(id, size), photo: (pid, nm) => P(pid, nm),
      stats: M.ALL_STATS.map(s => [s, M.LABELS[s]]),
      minLine: PICK_MIN,
      sport: "soccer",
      teamModel: (h, a) => { const m = ctx.matchup(h, a, true); return { lh: m.xg, la: m.xg_opp }; },
      teamHist: tid => ctx.games.filter(g => (g.home === tid || g.away === tid) && g.hg != null)
        .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10)
        .map(g => (g.home === tid ? { pf: g.hg, pa: g.ag } : { pf: g.ag, pa: g.hg })),
      teamNote: "Gol attesi dallo stesso modello del riquadro 1-X-2 della scheda Squadra.",
      el: { kind: $("#pkKind"), game: $("#pkGame"), stat: $("#pkStat"), min: $("#pkMin") },
    };
  }
  function renderPicks() { return Picks.render(picksCfg()); }

  // ------------------------------------------------------------ effetto assenze dei compagni
  const ABS = {
    team: r => r.tid, main: "sh", mainVerb: "tirano", minRole: 45, minWith: 3, minWithout: 2,
    photo: (pid, nm) => P(pid, nm),
    stats: [
      { key: "min", label: "Min", get: r => r.min, dec: 0, thr: 10 },
      { key: "sh", label: "Tiri", get: r => r.sh, dec: 2, thr: 0.4 },
      { key: "sot", label: "In porta", get: r => r.sot, dec: 2, thr: 0.25 },
      { key: "gol", label: "Gol", get: r => r.gol, dec: 2, thr: 0.15 },
      { key: "ast", label: "Assist", get: r => r.ast, dec: 2, thr: 0.1 },
    ],
  };

  // ------------------------------------------------------------ schedina
  const slipTeam = t => (t ? t.short || t.name : "");
  const slipBadge = () => Nav.badge(Slip.count());
  Slip.init("ucl", slipBadge);
  function showSlip() { $("#out").innerHTML = Slip.render(); Slip.bindPage(showSlip); }
  /* risultati per la schedina: punteggi e tabellini delle partite finite */
  function slipResults() {
    const G = new Map(), PL = new Map();
    for (const g of ctx.games) if (g.hg != null && g.ag != null) G.set(String(g.gid), g);
    for (const logs of ctx.playerLogs.values()) for (const r of logs) PL.set(String(r.gid) + "|" + r.pid, r);
    return {
      game: gid => {
        const g = G.get(gid);
        if (g) return { done: true, h: T(g.home).short, a: T(g.away).short, hs: g.hg, as: g.ag };
        const s = ctx.schedule.find(x => String(x.id) === gid);
        return { done: false, live: (!!s && s.state === "in") || liveNow.some(e => String(e.id) === gid) };
      },
      player: (gid, pid, stat) => { const r = PL.get(gid + "|" + pid); return r && r.min > 0 ? STATV(stat)(r) : null; },
    };
  }

  // ------------------------------------------------------------ confronto fra squadre
  function cmpOptions() {
    const keepA = $("#cmpA").value, keepB = $("#cmpB").value;
    const opts = ctx.TEAMS.map(t => `<option value="${t.tid}">${esc(t.name)}</option>`).join("");
    $("#cmpA").innerHTML = opts; $("#cmpB").innerHTML = opts;
    if (keepA) $("#cmpA").value = keepA;
    if (keepB) $("#cmpB").value = keepB;
    playerOptions();
  }

  // ------------------------------------------------------------ andamento (grafici) e confronto fra giocatori
  const STATV = s => g => { const k = M.SPORT.key, dv = M.SPORT.derived; return dv[s] ? dv[s].reduce((a, x) => a + (+g[k[x]] || 0), 0) : +g[k[s]] || 0; };
  const oppAbbr = o => T(o).abbr, oppName = o => T(o).short, teamLbl = tid => (tid ? T(tid).short : "—");
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
    setMode("compare"); run();
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    const keeper = ctx.isKeeper(a) && ctx.isKeeper(b);
    const PJ = keeper
      ? [["SV", "Parate attese", "n2", 1, "proj"], ["YC", "Prob. ammonizione", "pct", -1, "p1"]]
      : [["GOL", "Prob. di segnare", "pct", 1, "p1"], ["AST", "Prob. di assist", "pct", 1, "p1"], ["GA", "Prob. gol o assist", "pct", 1, "p1"],
         ["SH", "Tiri attesi", "n2", 1, "proj"], ["SOT", "Tiri in porta attesi", "n2", 1, "proj"], ["FS", "Falli subiti attesi", "n2", 1, "proj"],
         ["FC", "Falli commessi attesi", "n2", -1, "proj"], ["YC", "Prob. ammonizione", "pct", -1, "p1"]];
    const SE = keeper
      ? [["sv", "Parate a partita", 1, "pg"], ["gc", "Gol subiti a partita", -1, "pg"], ["yc", "Ammonizioni", -1, "tot"]]
      : [["gol", "Gol", 1, "tot"], ["ast", "Assist", 1, "tot"], ["sh", "Tiri a partita", 1, "pg"], ["sot", "Tiri in porta a partita", 1, "pg"],
         ["fs", "Falli subiti a partita", 1, "pg"], ["fc", "Falli commessi a partita", -1, "pg"], ["yc", "Ammonizioni", -1, "tot"]];
    const metrics = [], vals = [{}, {}];
    const add = (key, label, group, fmt, dir, f) => { metrics.push({ key, label, group, fmt, dir }); S.forEach((x, i) => { vals[i][key] = f(x); }); };
    for (const [k, l, fm, d, fld] of PJ) add("p" + k, l, "Prossima partita (proiezione)", fm, d, x => { const s = x.pr && x.pr.stats.find(y => y.stat === k); return s ? s[fld] : null; });
    add("sgp", "Presenze", "Stagione", "n0", 0, x => x.cur.length);
    add("smin", "Minuti a presenza", "Stagione", "n0", 0, x => (x.cur.length ? x.cur.reduce((t, g) => t + g.min, 0) / x.cur.length : null));
    for (const [k, l, d, how] of SE) add("s" + k, l, "Stagione", how === "tot" ? "n0" : "n2", d,
      x => (x.cur.length ? x.cur.reduce((t, g) => t + (+g[k] || 0), 0) / (how === "tot" ? 1 : x.cur.length) : null));
    for (const [k, l, d] of SE.filter(z => z[3] === "pg" || z[0] === "gol" || z[0] === "ast"))
      add("l" + k, l.replace(" a partita", "") + " a partita", "Ultime 10 presenze", "n2", d, x => (x.l10.length ? x.l10.reduce((t, g) => t + (+g[k] || 0), 0) / x.l10.length : null));
    const AV = S.map(x => SoccerAdv.playerVals(ctx, TSTATS, XG, x.pid, keeper));
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
    if (!$("#cmpA").dataset.set) {
      const a = $("#team").value || (selected && ctx.playerTeam(selected.id)) || ctx.TEAMS[0].tid;
      const g = ctx.nextGame(a);
      $("#cmpA").value = a;
      $("#cmpB").value = g ? g.opp : ctx.TEAMS.find(t => t.tid !== a).tid;
      $("#cmpA").dataset.set = 1;
    }
    const a = $("#cmpA").value, b = $("#cmpB").value;
    if (a === b) return `<div class="msg">Scegli due squadre diverse.</div>`;
    const g = ctx.nextGame(a);
    const next = g && g.opp === b ? `<div class="advnote" style="margin:0 0 10px">Si affrontano ${esc(fmtDate(g.utc))} in casa di ${esc(T(g.home ? a : b).name)}.</div>` : "";
    const head = (tid, t) => `<div class="tname">${L(tid, "m")}<span>${esc(T(tid).name)}</span></div>
      <div class="tsub">${t ? `${t.w}V ${t.d}N ${t.l}P · ${t.pts} punti` : "nessuna partita"}</div>`;
    // proiezioni nella partita fra le due (in casa di chi gioca davvero, altrimenti campo neutro)
    const home = g && g.opp === b ? g.home : null;
    const tA = ctx.projectTeam(a, b, home), tB = ctx.projectTeam(b, a, home == null ? null : !home);
    const where = home == null ? `<div class="advnote" style="margin:0 0 10px">Non si affrontano a breve: proiezioni a campo neutro.</div>` : "";
    return `<h3 style="margin-top:0">Confronta squadre · stagione ${esc(ctx.season)}</h3>${next}${where}`
      + matchBox(a, b, tA.match, home)
      + duel(tA, tB)
      + `<h3>Squadre a confronto</h3>` + SoccerAdv.compare(ctx, TSTATS, XG, a, b, head)
      + Adv.section("cmpA:" + a, `Proiezioni · ${T(a).name} contro ${T(b).name}`, teamBlock(tA) + oppChips(ctx.opponentProfile(b)))
      + Adv.section("cmpB:" + b, `Proiezioni · ${T(b).name} contro ${T(a).name}`, teamBlock(tB) + oppChips(ctx.opponentProfile(a)));
  }

  // ------------------------------------------------------------ oggi, classifiche giocatori
  function renderToday() {
    return Today.render({
      ctx, schedule: ctx.schedule, sport: "soccer", defMin: 65, tz: "Europe/Rome",
      teamModel: (h, a) => { const m = ctx.matchup(h, a, true); return { lh: m.xg, la: m.xg_opp }; },
      project: (tid, opp, home) => ctx.projectTeam(tid, opp, home),
      short: id => T(id).short, name: id => T(id).name,
      logo: (id, size) => L(id, size), photo: (pid, nm) => P(pid, nm),
      minLine: PICK_MIN, skip: new Set(["SV"]),
    });
  }

  function renderLeaders() {
    return Leaders.render({
      ctx, sport: "ucl", seasons: ctx.seasons, noteExtra: "(solo partite di Champions League)",
      rows: season => { const out = []; for (const l of ctx.playerLogs.values()) for (const g of l) if (g.season === season && g.min > 0) out.push(g); return out; },
      team: r => r.tid, sums: Leaders.SOCCER_SUMS, cats: Leaders.SOCCER,
      modes: [["pg", "A partita"], ["p90", "Ogni 90 minuti"], ["tot", "Totali"]],
      name: pid => ctx.names.get(pid), teamName: t => T(t).name, short: t => T(t).short,
      photo: (pid, nm) => P(pid, nm), logo: (t, s) => L(t, s), canOpen: pid => !!ctx.playerTeam(pid),
    });
  }

  // ------------------------------------------------------------ avvio
  setMode(Nav.init({ sport: "ucl", go }));
  $("#out").innerHTML = `<div class="msg">Caricamento dati…</div>`;
  loadData().catch(e => {
    $("#status").innerHTML = `<span style="color:var(--bad)">Dati non disponibili: ${esc(e.message)}</span>`;
    $("#out").innerHTML = `<div class="err">Non riesco a caricare i dati. Se l'app è appena stata creata, il primo aggiornamento potrebbe essere ancora in corso.</div>`;
  });
})();
