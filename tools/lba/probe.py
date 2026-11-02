"""Prova temporanea: parametri del calendario LBA."""
import json, re, time, urllib.request, urllib.error
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
S = "https://www.legabasket.it"
def get(path, acc="application/json"):
    time.sleep(1)
    req = urllib.request.Request(S + path, headers={"User-Agent": UA, "Accept": acc, "Referer": S + "/calendario"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e: return e.code, ""
    except Exception as e: return 0, str(e)
def cal(q):
    st, t = get("/api/championships/get-championships-calendar-by-id?" + q)
    try: d = json.loads(t); ms = d.get("matches") or []
    except Exception: d, ms = None, []
    print(f"CAL {q:45s} -> {st} n={len(ms)} numbers={sorted({m.get('number') for m in ms})} keys={list(d.keys()) if isinstance(d, dict) else None}")
    return d
print("== summary"); st, t = get("/api/championships/get-championships-summary-by-id?id=602"); print(st, t[:1500])
d = cal("id=602")
if d:
    for k, v in d.items():
        if k != "matches": print(" ", k, json.dumps(v, ensure_ascii=False)[:600])
    m = (d.get("matches") or [{}])[0]; print(" MATCH KEYS", json.dumps(m, ensure_ascii=False)[:1500])
for q in ("id=602&day_id=4490", "id=602&championships_day_id=4490", "id=602&day=5", "id=602&number=5", "id=602&round=5",
          "id=602&giornata=5", "id=602&page=2", "id=602&all=true", "id=602&team_id=1767", "id=596", "id=596&number=1", "id=596&day=1"):
    cal(q)
print("== JS")
st, h = get("/calendario", "text/html")
for src in re.findall(r'<script[^>]+src="(/_next/[^"]+\.js)"', h):
    st, js = get(src, "*/*")
    for m in re.finditer(r'.{0,400}(get-championships-calendar-by-id|getChampionshipCalendarById|GET_CHAMPIONSHIP_CALENDAR_BY_ID).{0,400}', js):
        print("JS>", m.group(0).replace("\n", " ")[:800]); print()
    if '"/game/' in js or "/protagonisti/squadre" in js:
        for m in re.findall(r'"(/api/[a-z\-/]+)"', js): print("ROUTE", m)
