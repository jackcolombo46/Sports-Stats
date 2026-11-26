"""Scarica i dati della Premier League da ESPN e li salva in docs/epl/data/.

Usa lo stesso programma della Serie A (tools/seriea/update_data.py) con la competizione "eng.1":
si scaricano SOLO le partite di Premier League.
Gira su GitHub Actions (vedi .github/workflows/update-epl.yml).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "seriea"))
import update_data as soccer  # noqa: E402

if __name__ == "__main__":
    sys.exit(soccer.main(["--league", "eng.1", "--data", os.path.join("docs", "epl", "data"), *sys.argv[1:]]))
