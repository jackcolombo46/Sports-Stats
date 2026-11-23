"""Prova 2: pagina squadra di fantacalcio.it (nomi accanto alle foto) e elenco squadre. Non tocca l'app."""
import os, re, urllib.request
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"); os.makedirs(OUT, exist_ok=True)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
for name, url in (("inter", "https://www.fantacalcio.it/serie-a/squadre/inter"), ("squadre", "https://www.fantacalcio.it/serie-a/squadre")):
    try:
        t = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read().decode("utf-8", "replace")
    except Exception as e:
        t = "ERRORE " + str(e)
    open(os.path.join(OUT, name + ".html"), "w").write(t)
for size in ("small", "medium", "big", "large"):
    try:
        r = urllib.request.urlopen(urllib.request.Request(f"https://content.fantacalcio.it/web/campioncini/21/{size}/2764.png", headers={"User-Agent": UA}, method="HEAD"), timeout=20)
        print(size, r.status, r.headers.get("Content-Length"))
    except Exception as e:
        print(size, e)
