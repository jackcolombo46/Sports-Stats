"""Scarica i dati della UEFA Europa League da ESPN e li salva in docs/uel/data/.

Usa lo stesso programma della Serie A (tools/seriea/update_data.py) con la competizione "uefa.europa":
si scaricano SOLO le partite di Europa League.
Gira su GitHub Actions (vedi .github/workflows/update-uel.yml).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "seriea"))
import update_data as soccer  # noqa: E402

if __name__ == "__main__":
    sys.exit(soccer.main(["--league", "uefa.europa", "--data", os.path.join("docs", "uel", "data"), *sys.argv[1:]]))
