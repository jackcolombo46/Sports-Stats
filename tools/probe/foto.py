"""prova: da cosa dipende il 403 delle foto (user agent, referer)"""
import json, urllib.request
UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
def get(u, h):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=15) as r:
            return [r.status, len(r.read()), r.headers.get("Content-Type"), r.headers.get("Access-Control-Allow-Origin")]
    except Exception as e:
        return getattr(e, "code", str(e))
out = {}
for i in ("4887", "2764", "6916"):
    u = f"https://content.fantacalcio.it/web/campioncini/21/medium/{i}.png"
    out[i] = {"ua_corto": get(u, {"User-Agent": "Mozilla/5.0"}),
              "ua_browser": get(u, {"User-Agent": UA}),
              "ua_browser_referer_app": get(u, {"User-Agent": UA, "Referer": "https://jackcolombo46.github.io/"}),
              "ua_browser_referer_fc": get(u, {"User-Agent": UA, "Referer": "https://www.fantacalcio.it/"}),
              "small_ua_browser": get(u.replace("/medium/", "/small/"), {"User-Agent": UA}),
              "small_v": get(u.replace("/medium/", "/small/") + "?v=963", {"User-Agent": UA, "Referer": "https://jackcolombo46.github.io/"})}
json.dump(out, open("tools/probe/out/foto6.json", "w"), indent=1)
