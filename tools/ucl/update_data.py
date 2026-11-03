"""Scarica i dati della UEFA Champions League da ESPN e li salva in docs/ucl/data/.

Usa lo stesso programma della Serie A (tools/seriea/update_data.py) con la competizione
"uefa.champions": si scaricano SOLO le partite di Champions League, quindi statistiche di giocatori
e squadre, proiezioni e statistiche avanzate non contengono le partite dei campionati nazionali.
Gira su GitHub Actions (vedi .github/workflows/update-ucl.yml).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "seriea"))
import update_data as soccer  # noqa: E402

if __name__ == "__main__":
    sys.exit(soccer.main(["--league", "uefa.champions", "--data", os.path.join("docs", "ucl", "data"), *sys.argv[1:]]))
