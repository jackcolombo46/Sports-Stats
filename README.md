# Sports Stats

Un'unica web app con le proiezioni statistiche dei giocatori di **NBA** e **Serie A** contro il prossimo
avversario. All'apertura si sceglie lo sport; da ogni schermata il pulsante **⇄ Sport** riporta alla scelta.
Funziona dal telefono e dal computer e si installa come app (una sola icona per entrambi gli sport).

App: https://jackcolombo46.github.io/Sports-Stats/

Nasce dall'unione di [NBA-Stats](https://github.com/jackcolombo46/NBA-Stats) e
[SerieA-Stats](https://github.com/jackcolombo46/SerieA-Stats).

## Struttura

```
docs/index.html            schermata di scelta dello sport
docs/manifest.webmanifest  installazione unica (icona e nome comuni)
docs/nba/                  app NBA     (index.html, app.js, model.js, data/)
docs/seriea/               app Serie A (index.html, app.js, model.js, data/)
tools/nba/update_data.py       scarica i dati NBA da ESPN       → docs/nba/data/
tools/seriea/update_data.py    scarica i dati Serie A da ESPN   → docs/seriea/data/
.github/workflows/update-nba.yml, update-seriea.yml   aggiornamenti automatici, separati
```

Ogni sport ha il suo aggiornamento automatico (3 volte al giorno, orari diversi): se uno si blocca
l'altro continua. Le liste dei giocatori osservati sono salvate nel browser e restano quelle delle
vecchie app (stesso dominio).

Il funzionamento dei due modelli è descritto nei README dei repository originali. Nel modello Serie A
tutto ciò che è specifico del calcio sta nell'oggetto `SPORT` in `docs/seriea/model.js`; il campionato
scaricato è `LEAGUE` in `tools/seriea/update_data.py`.

## Aggiungere uno sport

1. `tools/<sport>/update_data.py` che scrive in `docs/<sport>/data/`
2. `docs/<sport>/` con l'interfaccia (link `../manifest.webmanifest` e pulsante `⇄ Sport` verso `../`)
3. `.github/workflows/update-<sport>.yml`
4. un riquadro in `docs/index.html`

## Prima configurazione

1. **Settings → Pages**: Source "Deploy from a branch", branch `main`, cartella `/docs`.
2. Gli aggiornamenti automatici partono al primo push; si possono lanciare a mano da **Actions**.

Gli aggiornamenti programmati si fermano se il repository resta senza attività per 60 giorni
(es. in estate): basta riattivarli dalla tab Actions.
