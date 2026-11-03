/* "Oggi": le partite del giorno (o del primo giorno in cui si gioca), una scheda per partita con
   - le previsioni di squadra dallo stesso modello di Occasioni/Confronta (calcio: 1-X-2, gol attesi, over/under, gol/no gol;
     basket: vittoria, punteggio atteso, scarto e totale),
   - i giocatori da tenere d'occhio: le previsioni più probabili della partita, come in Occasioni.
   Toccando la partita si apre il confronto fra le due squadre. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = p => Math.round(p * 100) + "%";
  const dec = (x, d = 1) => x.toFixed(d).replace(".", ",");
  const sbtn = item => (window.Slip ? Slip.button(item) : "");
  const state = { day: null };

  // ---------------------------------------------------------- probabilità
  const erf = x => { const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y; };
  const cdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
  const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };

  function soccer(m) {
    const P = [];
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) P.push([i, j, pois(i, m.lh) * pois(j, m.la)]);
    const pr = f => P.reduce((a, [i, j, p]) => a + (f(i, j) ? p : 0), 0);
    const top = P.reduce((a, b) => (b[2] > a[2] ? b : a));
    return { h: pr((i, j) => i > j), d: pr((i, j) => i === j), a: pr((i, j) => i < j), o25: pr((i, j) => i + j > 2.5),
             gg: pr((i, j) => i > 0 && j > 0), top };
  }
  function basket(m) {
    const d = m.ph - m.pa, h = 1 - cdf(-d / m.sd.diff);
    return { h, a: 1 - h, ph: m.ph, pa: m.pa, diff: d, tot: m.ph + m.pa };
  }

  // ---------------------------------------------------------- giornate
  const dayKey = (utc, tz) => new Date(utc).toLocaleDateString("en-CA", tz ? { timeZone: tz } : {});
  function gameDays(cfg) {
    const now = Date.now();
    const games = (cfg.schedule || []).filter(g => g.state !== "post" && (g.state === "in" || new Date(g.utc) > now - 3 * 3600e3) &&
      (g.stype == null || g.stype === 2 || g.stype === 3 || g.stype === 5)).sort((a, b) => (a.utc < b.utc ? -1 : 1));
    const days = new Map();
    for (const g of games) {
      const k = dayKey(g.utc, cfg.tz);
      if (!days.has(k)) { if (days.size >= 7) break; days.set(k, []); }
      days.get(k).push(g);
    }
    return days;
  }
  function dayLabel(k, tz, long) {
    const today = dayKey(Date.now(), tz), tom = dayKey(Date.now() + 864e5, tz);
    const d = new Date(k + "T12:00:00Z");
    const full = d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    if (k === today) return long ? `oggi, ${full}` : "Oggi";
    if (k === tom) return long ? `domani, ${full}` : "Domani";
    return long ? full : d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }

  const wd = (k, add) => new Date(Date.parse(k + "T12:00:00Z") + add * 864e5).toLocaleDateString("it-IT", { weekday: "long", timeZone: "UTC" });

  // ---------------------------------------------------------- giocatori da tenere d'occhio (stesse soglie di Occasioni)
  function playerPicks(cfg, g, min) {
    const cache = cfg.ctx._todayP ||= new Map();
    if (!cache.has(g.id)) {
      const items = [];
      for (const [tid, opp, home] of [[g.home, g.away, true], [g.away, g.home, false]]) {
        let res; try { res = cfg.project(tid, opp, home); } catch { continue; }
        for (const p of (res && res.players) || []) for (const s of p.stats || []) {
          if (cfg.skip && cfg.skip.has(s.stat)) continue;
          const lo = (cfg.minLine || {})[s.stat] || 0;
          const lines = (s.lines || []).filter(l => l.prob != null && l.line >= lo && l.prob < 0.995);
          if (lines.length) items.push({ tid, opp, home, pid: p.player.id, name: p.player.name, stat: s.stat, label: s.label, proj: s.proj, lines });
        }
      }
      cache.set(g.id, items);
    }
    const best = [];
    for (const it of cache.get(g.id)) {
      const ok = it.lines.filter(l => l.prob >= min);
      if (!ok.length) continue;
      const b = ok.reduce((a, x) => (x.line > a.line ? x : a));
      best.push({ ...it, line: b.line, prob: b.prob });
    }
    best.sort((a, b) => b.prob - a.prob || b.line - a.line);
    const seen = new Set(), out = [];
    const perStat = {};   // al massimo 2 previsioni dello stesso tipo, per varietà
    for (const b of best) {
      if (seen.has(b.pid) || (perStat[b.stat] || 0) >= 2) continue;
      seen.add(b.pid); perStat[b.stat] = (perStat[b.stat] || 0) + 1; out.push(b);
      if (out.length === 4) break;
    }
    return out;
  }

  // ---------------------------------------------------------- scheda di una partita
  function card(cfg, g, min) {
    const cache = cfg.ctx._todayM ||= new Map();
    if (!cache.has(g.id)) { let m = null; try { m = cfg.teamModel(g.home, g.away); } catch { m = null; } cache.set(g.id, m); }
    const m = cache.get(g.id);
    const sh = cfg.short(g.home), sa = cfg.short(g.away);
    const tsub = `${sh} – ${sa}`;
    const T = (text, prob) => sbtn({ key: `t|${g.id}|${text}`, kind: "t", gid: g.id, utc: g.utc, prob, text, sub: tsub });
    const time = g.state === "in" ? `<span class="live">IN CORSO</span>`
      : new Date(g.utc).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    const when = cfg.tz ? `${new Date(g.utc).toLocaleDateString("it-IT", { weekday: "short", day: "numeric" })} · ` : "";
    let rows = "", extra = "";
    if (m && cfg.sport === "soccer") {
      const s = soccer(m);
      const row = (tid, p, xg, text) => `<div class="tgr"><span class="tgn">${cfg.logo(tid, "m")}<b>${esc(cfg.name(tid))}</b></span>
        <span class="tgx" title="gol attesi">${dec(xg)}</span><span class="tgp" style="--p:${pct(p)}">${pct(p)}</span>${T(text, p)}</div>`;
      rows = row(g.home, s.h, m.lh, `Vince ${sh}`)
        + `<div class="tgr tgd"><span class="tgn">Pareggio</span><span class="tgx"></span><span class="tgp" style="--p:${pct(s.d)}">${pct(s.d)}</span>${T("Pareggio", s.d)}</div>`
        + row(g.away, s.a, m.la, `Vince ${sa}`);
      const o = s.o25 >= 0.5 ? ["Over 2.5 (almeno 3 gol)", s.o25, "Over 2,5"] : ["Under 2.5 (al massimo 2 gol)", 1 - s.o25, "Under 2,5"];
      const gg = s.gg >= 0.5 ? ["Gol (segnano entrambe)", s.gg, "Gol"] : ["No gol (almeno una non segna)", 1 - s.gg, "No gol"];
      extra = `<div class="tgm"><span class="chip">${o[2]} <b>${pct(o[1])}</b>${T(o[0], o[1])}</span>
        <span class="chip">${gg[2]} <b>${pct(gg[1])}</b>${T(gg[0], gg[1])}</span>
        <span class="chip">Più probabile <b>${s.top[0]}-${s.top[1]}</b> <small>${pct(s.top[2])}</small></span></div>`;
    } else if (m) {
      const s = basket(m);
      const row = (tid, p, pts, text) => `<div class="tgr"><span class="tgn">${cfg.logo(tid, "m")}<b>${esc(cfg.name(tid))}</b></span>
        <span class="tgx" title="punti attesi">${Math.round(pts)}</span><span class="tgp" style="--p:${pct(p)}">${pct(p)}</span>${T(text, p)}</div>`;
      rows = row(g.home, s.h, s.ph, `Vince ${sh}`) + row(g.away, s.a, s.pa, `Vince ${sa}`);
      const fav = s.diff >= 0 ? sh : sa;
      extra = `<div class="tgm"><span class="chip">Scarto atteso <b>${esc(fav)} +${Math.round(Math.abs(s.diff))}</b></span>
        <span class="chip">Totale atteso <b>${Math.round(s.tot)}</b> punti</span></div>`;
    } else {
      rows = `<div class="tgr"><span class="tgn">${cfg.logo(g.home, "m")}<b>${esc(cfg.name(g.home))}</b></span></div>
              <div class="tgr"><span class="tgn">${cfg.logo(g.away, "m")}<b>${esc(cfg.name(g.away))}</b></span></div>
              <div class="advnote">Dati delle squadre non sufficienti per una previsione.</div>`;
    }
    const pk = playerPicks(cfg, g, min);
    const players = pk.length ? `<div class="tgpl"><div class="tgh2">Da tenere d'occhio</div>${pk.map(p => `
      <div class="tgpr click" data-pid="${p.pid}" data-name="${esc(p.name)}"><span class="who">${cfg.photo(p.pid, p.name)}<span>${esc(p.name)}<small class="pkm">${esc(cfg.short(p.tid))}</small></span></span>
        <span class="tgpk">${esc(p.label)} <b>${p.line}+</b></span><span class="tgp" style="--p:${pct(p.prob)}">${pct(p.prob)}</span>${sbtn({ key: `p|${g.id}|${p.pid}|${p.stat}|${p.line}`, kind: "p",
          gid: g.id, utc: g.utc, pid: p.pid, prob: p.prob, text: `${p.name}: ${p.label.toLowerCase()} almeno ${p.line}`, sub: `${cfg.short(p.tid)} ${p.home ? "vs" : "@"} ${cfg.short(p.opp)}` })}</div>`).join("")}</div>` : "";
    return `<div class="card tg">
      <div class="tgh" data-match="${esc(g.home)}|${esc(g.away)}"><span class="tgt">${when}${time}</span><span class="tgc">Confronto completo →</span></div>
      <div class="tgb" data-match="${esc(g.home)}|${esc(g.away)}"><div class="tgr tgl"><span></span><span class="tgx">${cfg.sport === "soccer" ? "gol att." : "punti att."}</span><span class="tgp0">vittoria</span><span></span></div>${rows}</div>
      ${extra}${players}</div>`;
  }

  /* cfg: { ctx, schedule, tz, sport, teamModel(h, a), project(tid, opp, home), short, name, logo, photo, minLine, skip, defMin, tzNote } */
  function render(cfg) {
    const days = gameDays(cfg);
    if (!days.size) return `<div class="msg">Nessuna partita in programma nei prossimi giorni.</div>`;
    if (!state.day || !days.has(state.day)) state.day = days.keys().next().value;
    const games = days.get(state.day);
    const min = (cfg.defMin || 65) / 100;
    const chips = [...days].map(([k, l]) => `<button class="tday${k === state.day ? " on" : ""}" data-day="${k}">${dayLabel(k, cfg.tz)}<small>${l.length}</small></button>`).join("");
    const isToday = state.day === dayKey(Date.now(), cfg.tz);
    const title = isToday ? "Partite di oggi" : state.day === days.keys().next().value ? "Oggi non si gioca · prossime partite" : "Partite";
    const note = `Percentuali dal modello dell'app (lo stesso di Occasioni e Confronta). "Da tenere d'occhio" = le previsioni dei giocatori più probabili
      della partita, sopra il ${cfg.defMin}%. Tocca una partita per il confronto completo, un giocatore per la sua scheda, "+" per la schedina.${cfg.tzNote ? " " + cfg.tzNote : ""}`;
    return `<div class="tdays">${chips}</div>
      <h3 style="margin-top:14px">${title} <small class="nt">· ${esc(dayLabel(state.day, cfg.tz, true))}${cfg.night ? ` (in Italia la notte tra ${esc(wd(state.day, 0))} e ${esc(wd(state.day, 1))})` : ""} · ${games.length} ${games.length === 1 ? "partita" : "partite"}</small></h3>
      <div class="advnote" style="margin:0 0 12px">${note}</div>
      <div class="tgrid">${games.map(g => card(cfg, g, min)).join("")}</div>
      <button class="advclose" id="toPicks">Tutte le occasioni della giornata →</button>`;
  }

  /* rerun(): ridisegna; openMatch(casa, ospite): confronto; openPicks(): vista Occasioni */
  function bind(rerun, openMatch, openPicks) {
    document.querySelectorAll(".tday").forEach(b => b.onclick = () => { state.day = b.dataset.day; rerun(); });
    document.querySelectorAll("[data-match]").forEach(el => el.onclick = e => {
      if (e.target.closest("[data-slip]")) return;
      openMatch(...el.dataset.match.split("|"));
    });
    const tp = document.getElementById("toPicks");
    if (tp) tp.onclick = openPicks;
  }

  /* da chiamare quando i dati vengono ricaricati */
  function reset(ctx) { if (ctx) { ctx._todayP = null; ctx._todayM = null; } }

  const css = `
  .tdays { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .tdays::-webkit-scrollbar { display: none; }
  .tday { flex: 0 0 auto; background: var(--panel); border: 1px solid var(--line); color: var(--muted); border-radius: 999px;
          padding: 7px 14px; font-family: inherit; font-weight: 600; font-size: 13.5px; line-height: 1.2; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
  .tday small { background: var(--panel2); border-radius: 9px; padding: 0 6px; font-size: 11px; color: var(--muted); }
  .tday.on { color: var(--text); border-color: var(--accent); }
  .tgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px; }
  .tg { display: grid; gap: 8px; padding: 12px 14px; }
  .tgh { display: flex; justify-content: space-between; align-items: center; cursor: pointer; color: var(--muted); font-size: 13px; }
  .tgh .tgt { font-family: var(--mono); color: var(--text); font-weight: 600; }
  .tgc { color: var(--accent2); font-size: 12.5px; }
  .tgb { cursor: pointer; display: grid; gap: 4px; }
  .tgr { display: grid; grid-template-columns: 1fr 52px 64px 30px; gap: 8px; align-items: center; min-height: 30px; }
  .tgr .tgn { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .tgr .tgn b { line-height: 1.2; overflow-wrap: anywhere; }
  .tgr.tgd .tgn { color: var(--muted); font-size: 13px; padding-left: 4px; }
  .tgr.tgl { min-height: 0; color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; }
  .tgr.tgl .tgx, .tgp0 { text-align: center; font-family: inherit; }
  .tgx { font-family: var(--mono); text-align: center; color: var(--muted); }
  .tgp { font-family: var(--mono); font-weight: 700; text-align: center; border-radius: 6px; padding: 3px 0;
         background: linear-gradient(90deg, rgba(62,207,142,.22) var(--p), var(--panel2) var(--p)); }
  .tgm { display: flex; flex-wrap: wrap; gap: 6px; }
  .tgm .chip { display: inline-flex; align-items: center; gap: 5px; }
  .tgm .chip b { font-family: var(--mono); }
  .tgm .chip .slipbtn { margin-left: 2px; }
  .tgpl { border-top: 1px solid var(--line); padding-top: 8px; display: grid; gap: 5px; }
  .tgh2 { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .8px; }
  .tgpr { display: grid; grid-template-columns: 1fr auto 52px 30px; gap: 8px; align-items: center; cursor: pointer; font-size: 13.5px; }
  .tgpr .who { min-width: 0; } .tgpr .who > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tgpr .pkm { display: block; color: var(--muted); font-size: 11px; }
  .tgpk { color: var(--muted); font-size: 12.5px; white-space: nowrap; } .tgpk b { color: var(--accent2); font-family: var(--mono); }
  .tgpr:hover .who { color: var(--accent2); }
  @media (max-width: 600px) {
    .tgrid { grid-template-columns: 1fr; }
    .tgr { grid-template-columns: 1fr 44px 56px 30px; gap: 6px; }
    .tgpr { grid-template-columns: 1fr auto 46px 30px; gap: 6px; font-size: 13px; }
  }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  window.Today = { render, bind, reset };
})();
