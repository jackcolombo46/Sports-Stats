/* Verifica del modello ("quanto ci azzecca"): per ogni giornata già giocata si ricostruiscono le proiezioni
   con lo stesso modello dell'app usando SOLO i dati precedenti a quella giornata, e si confrontano con i risultati.
   Uso: node tools/backtest/backtest.js <nba|lba|seriea|ucl>   →   docs/<sport>/data/backtest.json
   Nessuna dipendenza esterna; gira su GitHub Actions dopo l'aggiornamento dei dati. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");

const SPORT = process.argv[2];
const ROOT = path.resolve(__dirname, "..", "..");
const DOCS = path.join(ROOT, "docs");
const DATA = path.join(DOCS, SPORT, "data");
const BASKET = SPORT === "nba" || SPORT === "lba";
const GM = SPORT === "nba" ? 48 : 40;
const t0 = Date.now();

// carica i file dell'app in un finto browser
const sb = { console, Math, Date, JSON, document: { head: { appendChild() {} }, createElement: () => ({}) } };
sb.window = sb; sb.globalThis = sb;
vm.createContext(sb);
const load = f => vm.runInContext(fs.readFileSync(path.join(DOCS, f), "utf8"), sb, { filename: f });
load(`${SPORT}/model.js`);
load("adv.js"); load("picks.js");
if (BASKET) load("adv-basket.js");
const M = sb.NBAModel || sb.LBAModel || sb.SportModel;

// dati
const meta = JSON.parse(fs.readFileSync(path.join(DATA, "meta.json"), "utf8"));
const logs = {}, games = {}, teamsBySeason = {};
for (const f of meta.files) {
  const j = JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
  const season = path.basename(f).slice(0, 7);
  const d = M.decodeLogFile(j);
  const rows = Array.isArray(d) ? d : d.rows;
  (logs[season] ||= []).push(...rows);
  if (!Array.isArray(d)) (games[season] ||= []).push(...d.games);
}
const seasons = Object.keys(logs).sort();
const teamOf = r => (BASKET ? r.tri : r.tid);
for (const s of seasons) teamsBySeason[s] = [...new Set(logs[s].map(teamOf))];

// partite da verificare: stagione in corso e precedente (la più vecchia serve solo come storico)
const target = seasons.slice(-2).filter(s => seasons.indexOf(s) > 0 || seasons.length === 1);
const MIN_DATE_GAMES = BASKET ? 1 : 1;

const r3 = x => Math.round(x * 1000) / 1000;
const bins = () => Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, n: 0, p: 0, hit: 0 }));
const out = { sport: SPORT, generated_at: new Date().toISOString(), seasons: target, players: { calib: bins(), byStat: {}, picks: { n: 0, p: 0, hit: 0, byStat: {} } },
              teams: { calib: bins(), byMarket: {}, picks: { n: 0, p: 0, hit: 0 } }, n_games: 0, n_dates: 0,
              recent: { n: 0, p: 0, hit: 0, from: null }, teamsRecent: { n: 0, p: 0, hit: 0 } };
const add = (b, p, hit) => { b.n++; b.p += p; b.hit += hit ? 1 : 0; };
const binOf = (calib, p) => calib[Math.min(9, Math.floor(p * 10))];
const MIN_LINE = {
  nba: { PTS: 10, REB: 4, AST: 4, FG3M: 2, STL: 1, BLK: 1, TOV: 2, PRA: 20 },
  lba: { PTS: 10, REB: 4, AST: 3, FG3M: 2, STL: 1, BLK: 1, TOV: 2, PRA: 15 },
  seriea: { SH: 2, FC: 2, FS: 2, SV: 2 }, ucl: { SH: 2, FC: 2, FS: 2, SV: 2 },
}[SPORT];
const PICK_MIN = BASKET ? 0.70 : 0.65;
const statOf = (r, s) => {
  if (BASKET) return s === "PRA" ? r.pts + r.reb + r.ast : r[{ PTS: "pts", REB: "reb", AST: "ast", FG3M: "fg3m", STL: "stl", BLK: "blk", TOV: "tov" }[s]];
  const k = M.SPORT.key, d = M.SPORT.derived[s];
  return d ? d.reduce((a, x) => a + r[k[x]], 0) : r[k[s]];
};
const recentFrom = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

for (const season of target) {
  const prev = seasons[seasons.indexOf(season) - 1];
  const rows = logs[season];
  const dates = [...new Set(rows.map(r => r.date))].sort();
  for (const date of dates) {
    const before = { [season]: rows.filter(r => r.date < date) };
    if (prev) before[prev] = logs[prev];
    if (!before[season].length && !prev) continue;
    const bundle = { season, seasons: [season, prev].filter(Boolean), logs: before, rosters: {}, injuries: [], schedule: [] };
    if (!BASKET) {
      bundle.games = { [season]: (games[season] || []).filter(g => g.date < date), ...(prev ? { [prev]: games[prev] || [] } : {}) };
      bundle.teams = Object.fromEntries(Object.entries(meta.teams || {}).map(([k, v]) => [k, v]));
      bundle.current_teams = teamsBySeason[season];
    } else if (SPORT === "lba") { bundle.teams = meta.teams; bundle.current_teams = teamsBySeason[season]; }
    let ctx;
    try { ctx = new M.Context(bundle); } catch (e) { continue; }
    out.n_dates++;
    const today = rows.filter(r => r.date === date);
    const gids = [...new Set(today.map(r => r.gid))];
    out.n_games += gids.length;
    const isRecent = date >= recentFrom;
    for (const gid of gids) {
      const gr = today.filter(r => r.gid === gid);
      // squadre: stessi calcoli della pagina Occasioni (Squadre e partite)
      let H, A, hs, as;
      if (BASKET) {
        H = (gr.find(r => r.home) || {}).tri; A = (gr.find(r => !r.home) || {}).tri;
        hs = gr.filter(r => r.tri === H).reduce((a, r) => a + r.pts, 0); as = gr.filter(r => r.tri === A).reduce((a, r) => a + r.pts, 0);
      } else {
        const g = (games[season] || []).find(x => x.gid === gid);
        if (g) { H = g.home; A = g.away; hs = g.hg; as = g.ag; }
      }
      if (H && A && hs != null && as != null) {
        let mk = null;
        try {
          if (BASKET) { const m = sb.BasketAdv.gameModel(ctx, M, GM, H, A); if (m) mk = sb.Picks.basketMarkets({}, m, H, A, [], []); }
          else { const m = ctx.matchup(H, A, true); mk = sb.Picks.soccerMarkets({}, { lh: m.xg, la: m.xg_opp }, H, A, [], []); }
        } catch { mk = null; }
        for (const market of mk || []) {
          const bm = out.teams.byMarket[market.group] ||= { label: market.group, n: 0, p: 0, hit: 0, picks: { n: 0, p: 0, hit: 0 } };
          for (const l of market.lines) {
            const hit = !!l.test(hs, as);
            add(binOf(out.teams.calib, l.prob), l.prob, hit); add(bm, l.prob, hit);
          }
          const ok = market.lines.filter(l => l.prob >= PICK_MIN && l.prob < 0.995);
          if (ok.length) {
            const best = ok.reduce((a, b) => (b.prob < a.prob ? b : a));
            const hit = !!best.test(hs, as);
            add(out.teams.picks, best.prob, hit); add(bm.picks, best.prob, hit);
            if (isRecent) add(out.teamsRecent, best.prob, hit);
          }
        }
      }
      // giocatori
      for (const r of gr) {
        if (ctx.playerTeam(r.pid) !== teamOf(r)) continue;   // appena trasferito: non confrontabile
        let p; try { p = ctx.project(r.pid, r.opp, !!r.home); } catch { p = null; }
        if (!p) continue;
        for (const st of p.stats) {
          const real = statOf(r, st.stat);
          if (real == null) continue;
          const bs = out.players.byStat[st.stat] ||= { label: st.label, n: 0, p: 0, hit: 0, brier: 0 };
          for (const l of st.lines || []) {
            const hit = real >= l.line;
            add(binOf(out.players.calib, l.prob), l.prob, hit);
            add(bs, l.prob, hit); bs.brier += (l.prob - (hit ? 1 : 0)) ** 2;
          }
          // la "occasione" che la pagina avrebbe mostrato: soglia più alta sopra il minimo
          const ok = (st.lines || []).filter(l => l.prob >= PICK_MIN && l.line >= ((MIN_LINE || {})[st.stat] || 0));
          if (ok.length) {
            const best = ok.reduce((a, b) => (b.line > a.line ? b : a));
            const hit = real >= best.line;
            add(out.players.picks, best.prob, hit);
            add(out.players.picks.byStat[st.stat] ||= { label: st.label, n: 0, p: 0, hit: 0 }, best.prob, hit);
            if (isRecent) add(out.recent, best.prob, hit);
          }
        }
      }
    }
  }
  if (out.recent.n) out.recent.from = recentFrom;
}

const fin = b => ({ ...b, p: b.n ? r3(b.p / b.n) : null, hit: b.n ? r3(b.hit / b.n) : null, ...(b.brier != null ? { brier: b.n ? r3(b.brier / b.n) : null } : {}) });
out.players.calib = out.players.calib.map(fin);
for (const k of Object.keys(out.players.byStat)) out.players.byStat[k] = fin(out.players.byStat[k]);
const pb = out.players.picks.byStat;
out.players.picks = { ...fin(out.players.picks), byStat: Object.fromEntries(Object.entries(pb).map(([k, v]) => [k, fin(v)])) };
out.recent = fin(out.recent);
out.teamsRecent = fin(out.teamsRecent);
out.teams.calib = out.teams.calib.map(fin);
out.teams.picks = fin(out.teams.picks);
for (const k of Object.keys(out.teams.byMarket)) { const b = out.teams.byMarket[k]; out.teams.byMarket[k] = { ...fin(b), picks: fin(b.picks) }; }
out.recent_from = recentFrom;
out.seconds = Math.round((Date.now() - t0) / 1000);
fs.writeFileSync(path.join(DATA, "backtest.json"), JSON.stringify(out));
console.log(`${SPORT}: ${out.n_dates} giornate, ${out.n_games} partite in ${out.seconds}s; occasioni giocatori ${out.players.picks.n} (previste ${out.players.picks.p}, riuscite ${out.players.picks.hit}); squadre ${out.teams.picks.n} (previste ${out.teams.picks.p}, riuscite ${out.teams.picks.hit})`);
