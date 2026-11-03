/* Effetto assenze: come cambiano le statistiche di un giocatore quando manca un compagno di squadra.
   Per ogni coppia di compagni si confrontano le partite del giocatore giocate CON il compagno e quelle SENZA,
   nella stagione in corso e in quella precedente, solo quando i due erano nella stessa squadra.
   Una partita conta come "senza" solo se il compagno era già arrivato in squadra (dalla sua prima partita con
   quella maglia) e non se n'era andato (fino all'ultima, o fino a oggi se è ancora in rosa). */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* indice per stagione e squadra: partite, e per ogni giocatore le sue partite */
  function index(ctx, team) {
    if (ctx._abs) return ctx._abs;
    const seasons = [ctx.season, ctx.prevSeason].filter(Boolean);
    const T = {};   // "stagione|squadra" -> { games: Map(gid -> data), players: Map(pid -> Map(gid -> riga)) }
    for (const logs of ctx.playerLogs.values()) for (const r of logs) {
      if (!seasons.includes(r.season) || !(r.min > 0)) continue;
      const k = r.season + "|" + team(r);
      const t = T[k] ||= { games: new Map(), players: new Map() };
      t.games.set(r.gid, r.date);
      if (!t.players.has(r.pid)) t.players.set(r.pid, new Map());
      t.players.get(r.pid).set(r.gid, r);
    }
    return (ctx._abs = T);
  }

  /* effetto dell'assenza di y sulle statistiche di x (somme con/senza su tutte le stagioni in comune) */
  function pair(ctx, cfg, x, y) {
    const T = index(ctx, cfg.team);
    const acc = { with: { n: 0, s: {} }, without: { n: 0, s: {} }, yMin: 0, yN: 0 };
    for (const [k, t] of Object.entries(T)) {
      const px = t.players.get(x), py = t.players.get(y);
      if (!px || !py) continue;
      const season = k.split("|")[0], tid = k.slice(season.length + 1);
      const ydates = [...py.values()].map(r => r.date).sort();
      const from = ydates[0];
      const stillThere = season === ctx.season && ctx.playerTeam(y) === tid;
      const to = stillThere ? "9999" : ydates[ydates.length - 1];
      for (const r of py.values()) { acc.yMin += r.min; acc.yN++; }
      for (const [gid, r] of px) {
        if (r.date < from || r.date > to) continue;
        const b = py.has(gid) ? acc.with : acc.without;
        b.n++;
        for (const s of cfg.stats) b.s[s.key] = (b.s[s.key] || 0) + s.get(r);
      }
    }
    if (acc.with.n < cfg.minWith || acc.without.n < cfg.minWithout) return null;
    const avg = (b, k) => b.s[k] / b.n;
    return {
      nWith: acc.with.n, nWithout: acc.without.n, yMin: acc.yN ? acc.yMin / acc.yN : 0,
      stats: cfg.stats.map(s => ({ key: s.key, label: s.label, with: avg(acc.with, s.key), without: avg(acc.without, s.key),
                                   diff: avg(acc.without, s.key) - avg(acc.with, s.key) })),
    };
  }

  /* compagni (della squadra attuale) che contano: abbastanza minuti di media */
  function teammates(ctx, cfg, pid) {
    const tid = ctx.playerTeam(pid);
    const T = index(ctx, cfg.team);
    const ids = new Set();
    for (const [k, t] of Object.entries(T)) {
      if (!t.players.has(pid)) continue;
      if (k.slice(k.indexOf("|") + 1) !== tid) continue;   // solo compagni della squadra attuale
      for (const y of t.players.keys()) if (y !== pid) ids.add(y);
    }
    return { tid, ids: [...ids] };
  }

  const fmt = (v, d) => v.toFixed(d);
  function chips(cfg, st, onlyMain) {
    return st.stats.filter(s => !onlyMain || s.key === cfg.main).map(s => {
      const def = cfg.stats.find(x => x.key === s.key);
      const d = def.dec ?? 1, thr = def.thr ?? 0.5;
      const cls = s.diff >= thr ? "up" : s.diff <= -thr ? "dn" : "";
      return `<span class="abc"><span>${esc(s.label)}</span><b>${fmt(s.without, d)}</b><i class="${cls}">${s.diff > 0 ? "+" : ""}${fmt(s.diff, d)}</i></span>`;
    }).join("");
  }

  const reasonNow = (ctx, cfg, y, tid) => {
    const inj = ctx.injury(y);
    if (inj && /^(out|suspension|injured|infortun|doubtful)/i.test(inj.status || "")) return inj.status;
    const t = index(ctx, cfg.team)[ctx.season + "|" + tid];
    if (!t || !t.players.has(y)) return null;
    const last = [...t.games.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1))[0];
    return last && !t.players.get(y).has(last[0]) && ctx.playerTeam(y) === tid ? "non ha giocato l'ultima partita" : null;
  };

  /* sezione nella scheda giocatore */
  function playerSection(ctx, cfg, pid) {
    const { tid, ids } = teammates(ctx, cfg, pid);
    const list = [];
    for (const y of ids) {
      const st = pair(ctx, cfg, pid, y);
      if (!st || st.yMin < cfg.minRole) continue;
      list.push({ y, name: ctx.names.get(y), st, now: tid ? reasonNow(ctx, cfg, y, tid) : null });
    }
    list.sort((a, b) => (!!b.now - !!a.now) || b.st.yMin - a.st.yMin);
    const body = list.length ? list.slice(0, 10).map(x => `
      <div class="abrow${x.now ? " abnow" : ""}">
        <div class="abhead"><span class="who">${cfg.photo(x.y, x.name)}<span>Senza <b>${esc(x.name)}</b>${x.now ? ` <span class="inj">${esc(x.now)}</span>` : ""}</span></span>
          <small>${x.st.nWithout} partite senza · ${x.st.nWith} con</small></div>
        <div class="abchips">${chips(cfg, x.st)}</div></div>`).join("")
      : `<div class="msg small">Non ci sono ancora abbastanza partite giocate senza un compagno importante (servono almeno ${cfg.minWithout} senza e ${cfg.minWith} con).</div>`;
    const note = `Media a partita quando il compagno <b>non gioca</b> e, accanto, la differenza rispetto alle partite in cui gioca.
      Stagione in corso e precedente, solo quando erano nella stessa squadra. In cima i compagni assenti adesso.
      Con poche partite la differenza può essere casuale.`;
    return Adv.section("absp:" + pid, "Effetto assenze dei compagni", `<div class="ablist">${body}</div>`, note);
  }

  /* sezione nella scheda squadra: chi guadagna dalle assenze di oggi */
  function teamSection(ctx, cfg, tid, absent, playing) {
    const out = [];
    // non contano come assenze vere i giocatori che quest'anno non hanno ancora giocato (nuovi, lungodegenti)
    for (const a of (absent || []).filter(x => !/nessuna (presenza|partita)/i.test(x.reason || ""))) {
      const gains = [];
      for (const x of playing) {
        const st = pair(ctx, cfg, x.id, a.id);
        if (!st) continue;
        const m = st.stats.find(s => s.key === cfg.main);
        gains.push({ x, st, m });
      }
      if (!gains.length) continue;
      gains.sort((p, q) => q.m.diff - p.m.diff);
      out.push(`<div class="abrow abnow"><div class="abhead"><span class="who">${cfg.photo(a.id, a.name)}<span>Senza <b>${esc(a.name)}</b> <span class="inj">${esc(a.reason)}</span></span></span></div>
        <div class="abgain">${gains.slice(0, 4).map(g => `<div><span class="who">${cfg.photo(g.x.id, g.x.name)}<span>${esc(g.x.name)} <small>(${g.st.nWithout} p. senza)</small></span></span>
          <span class="abchips">${chips(cfg, g.st, true)}</span></div>`).join("")}</div></div>`);
    }
    if (!out.length) return "";
    const note = `Per ogni assente della prossima partita, i compagni che ${cfg.mainVerb} di più quando lui non gioca
      (media senza di lui e differenza rispetto a quando gioca). Tocca un giocatore nella tabella sopra per tutti i dettagli.`;
    return Adv.section("abst:" + tid, "Chi guadagna dalle assenze", `<div class="ablist">${out.join("")}</div>`, note);
  }

  const css = `
  .ablist { display: grid; gap: 10px; }
  .abrow { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
  .abrow.abnow { border-color: #5a2525; }
  .abhead { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
  .abhead small { color: var(--muted); font-size: 12px; }
  .abchips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .abc { background: var(--panel2); border-radius: 8px; padding: 4px 8px; display: inline-flex; gap: 6px; align-items: baseline; font-size: 13px; }
  .abc span { color: var(--muted); font-size: 11.5px; }
  .abc b { font-family: var(--mono); }
  .abc i { font-style: normal; font-family: var(--mono); font-size: 12px; color: var(--muted); }
  .abc i.up { color: var(--good); } .abc i.dn { color: var(--bad); }
  .abgain > div { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .abgain .abchips { margin-top: 0; }
  .abgain small { color: var(--muted); }`;
  const stl = document.createElement("style");
  stl.textContent = css;
  document.head.appendChild(stl);

  window.Absence = { playerSection, teamSection, pair };
})();
