# Sports Stats

Un'unica web app con le proiezioni statistiche dei giocatori di **NBA**, **Serie A** e **Serie A di basket (LBA)**
contro il prossimo avversario. All'apertura si sceglie lo sport; da ogni schermata il pulsante **⇄ Sport** riporta alla scelta.
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
docs/lba/                  app Serie A di basket (stessa interfaccia e modello dell'NBA, partite da 40')
tools/nba/update_data.py       scarica i dati NBA da ESPN       → docs/nba/data/
tools/seriea/update_data.py    scarica i dati Serie A da ESPN   → docs/seriea/data/
tools/lba/update_data.py       scarica i dati LBA da legabasket.it → docs/lba/data/
.github/workflows/update-nba.yml, update-seriea.yml, update-lba.yml   aggiornamenti automatici, separati
```

Ogni sport ha il suo aggiornamento automatico (NBA e Serie A 3 volte al giorno, LBA ogni 3 ore dalle 12 alle 24): se uno si blocca
l'altro continua. Le liste dei giocatori osservati sono salvate nel browser e restano quelle delle
vecchie app (stesso dominio).

Il funzionamento dei due modelli è descritto nei README dei repository originali. Nel modello Serie A
tutto ciò che è specifico del calcio sta nell'oggetto `SPORT` in `docs/seriea/model.js`; il campionato
scaricato è `LEAGUE` in `tools/seriea/update_data.py`.

## Foto dei giocatori e loghi delle squadre

`docs/media.js` (condiviso) disegna foto e loghi; se un'immagine non si carica restano le iniziali
del giocatore o la sigla della squadra.

- **NBA e Serie A**: immagini dal CDN di ESPN, calcolate dagli id già presenti nei dati
  (`a.espncdn.com/i/headshots/...` e `/i/teamlogos/...`). Per la Serie A ESPN non ha la foto di tutti i giocatori.
- **LBA**: l'aggiornamento automatico cerca nei dati delle partite di legabasket.it i campi che contengono
  immagini e li salva in `meta.json` → `images`. Il log dell'Action riporta quanti loghi/foto ha trovato e in quali campi.

## Statistiche avanzate e "Confronta squadre"

In fondo alle schede di giocatore e squadra c'è il pulsante **Statistiche avanzate** (chiuso all'apertura).
La scheda **Confronta** mette due squadre una accanto all'altra: verde = meglio, grigio = pari, rosso = peggio
(per punti/gol subiti, palle perse e simili è meglio il valore più basso). Tutto riguarda la stagione in corso.

- `docs/adv.js`: parti comuni (sezione a scomparsa, tabelle, confronto, posizioni e medie del campionato)
- `docs/adv-basket.js`: NBA e LBA, calcolate dai tabellini (possessi, rating offensivo/difensivo, four factors,
  true shooting, usage, quote di rimbalzi e assist...). Servono tiri e liberi segnati: colonne `fgm`, `ftm`, `fg3a`.
- `docs/seriea/adv.js`: Serie A. Statistiche di squadra di ogni partita da ESPN (possesso, passaggi, contrasti...,
  salvate in `tstats` nei file dei log), xG dei giocatori da ESPN (colonna `xg`) e totali di
  [Understat](https://understat.com) in `meta.json` → `xg` (xG, PPDA, passaggi vicino all'area, punti attesi).
  Understat non è un servizio ufficiale: se cambia il sito, `understat_xg` in `tools/seriea/update_data.py` va aggiornato.

Quando i file della stagione in corso sono nel formato vecchio, l'aggiornamento automatico li riscarica da solo.

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

## Note sulla Serie A di basket (LBA)

I dati vengono dalle stesse chiamate che usa il sito legabasket.it per le sue pagine (elenco campionati,
tabella riassuntiva della stagione, dettaglio partita con tabellino). Non è un servizio ufficiale per
sviluppatori: se il sito cambia, `tools/lba/update_data.py` va aggiornato. Lo scaricatore aspetta 2 secondi
tra una richiesta e l'altra, come chiede il sito. Le squadre cambiano id e nome (sponsor) ogni stagione:
vengono riconosciute dalla città tramite l'elenco `CLUBS`. Non ci sono infortuni né dati dal vivo:
l'app LBA usa solo gli aggiornamenti automatici.
