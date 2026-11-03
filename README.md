# Sports Stats

Un'unica web app con le proiezioni statistiche dei giocatori di **NBA**, **Serie A**, **Champions League** e **Serie A di basket (LBA)**
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
docs/ucl/                  app Champions League (stessa interfaccia e modello della Serie A)
tools/nba/update_data.py       scarica i dati NBA da ESPN       → docs/nba/data/
tools/seriea/update_data.py    scarica i dati Serie A da ESPN   → docs/seriea/data/
tools/lba/update_data.py       scarica i dati LBA da legabasket.it → docs/lba/data/
tools/ucl/update_data.py       scarica i dati Champions League da ESPN → docs/ucl/data/
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
- **LBA**: nei dati delle partite legabasket.it dà un *codice immagine* (`player_p_key`, `home_logo_key`, `v_logo_key`),
  salvato in `meta.json` → `images`. L'immagine è `{archivio}/variants/{codice}/thumb`; l'indirizzo dell'archivio non è
  documentato e l'aggiornamento automatico lo cerca da solo nelle pagine del sito (`find_cdn`), verificandolo con
  un'immagine vera. Il log dell'Action riporta le righe "Immagini: ..." con quanti loghi/foto e quale archivio ha trovato.

## Statistiche avanzate e "Confronta squadre"

In fondo alle schede di giocatore e squadra c'è il pulsante **Statistiche avanzate** (chiuso all'apertura).
La scheda **Confronta** mette due squadre una accanto all'altra: verde = meglio, grigio = pari, rosso = peggio
(per punti/gol subiti, palle perse e simili è meglio il valore più basso). Tutto riguarda la stagione in corso.

- `docs/adv.js`: parti comuni (sezione a scomparsa, tabelle, confronto, posizioni e medie del campionato)
- `docs/adv-basket.js`: NBA e LBA, calcolate dai tabellini (possessi, rating offensivo/difensivo, four factors,
  true shooting, usage, quote di rimbalzi e assist...). Servono tiri e liberi segnati: colonne `fgm`, `ftm`, `fg3a`.
- `docs/adv-soccer.js`: calcio (Serie A e Champions League). Statistiche di squadra di ogni partita da ESPN (possesso, passaggi, contrasti...,
  salvate in `tstats` nei file dei log), xG dei giocatori da ESPN (colonna `xg`) e totali di
  [Understat](https://understat.com) in `meta.json` → `xg` (xG, PPDA, passaggi vicino all'area, punti attesi).
  Understat non è un servizio ufficiale: se cambia il sito, `understat_xg` in `tools/seriea/update_data.py` va aggiornato.

Quando i file della stagione in corso sono nel formato vecchio, l'aggiornamento automatico li riscarica da solo.

## Occasioni

La scheda **Occasioni** (`docs/picks.js`) elenca le previsioni più probabili per tutti i giocatori della prossima
giornata, usando le stesse proiezioni delle schede Giocatore e Squadra. Per ogni giocatore e statistica prende la soglia
più alta che supera la probabilità minima scelta e ordina per probabilità; si filtra per partita, statistica e
probabilità minima. `minLine` (in `app.js` di ogni app) esclude le soglie troppo basse (es. "almeno 5 punti"), e
`windowH` è l'ampiezza della giornata in ore (NBA 20, LBA 60, calcio 96).

Con il selettore **Squadre e partite** la stessa pagina mostra le previsioni di squadra, scegliendo per ogni partita e
tipo la più ambiziosa che supera il minimo:
- calcio: risultato (vittoria, vittoria con 2+ gol di scarto, non perde), gol di squadra, porta inviolata,
  over/under, gol/no gol, dai gol attesi del modello (Poisson, come il riquadro 1-X-2);
- basket: vittoria e scarto, punti di squadra e punti totali, da `BasketAdv.gameModel` (possessi attesi × rating
  offensivo/difensivo, avvicinati alla media a inizio stagione, con distribuzione normale: deviazioni standard tipiche
  NBA 13 punti sullo scarto e 19 sul totale, LBA 12 e 16).
"Storico" = quante volte è successo nelle ultime partite di ciascuna squadra in questa stagione.

## Effetto assenze

`docs/absence.js`: per ogni coppia di compagni confronta le partite di un giocatore giocate con e senza il compagno
(stagione in corso e precedente, solo quando erano nella stessa squadra e solo per i compagni che sono ancora in squadra; una partita conta come "senza" solo se il
compagno era già in squadra e non se n'era andato). Due sezioni a scomparsa:
- scheda Giocatore, **Effetto assenze dei compagni**: media senza il compagno e differenza rispetto a quando gioca
  (in cima i compagni assenti adesso); servono almeno 2 partite senza e 3 con, e un compagno con un ruolo vero
  (minuti medi: NBA 20, LBA 18, calcio 45);
- scheda Squadra, **Chi guadagna dalle assenze**: per ogni assente della prossima partita, i compagni che segnano
  (basket) o tirano (calcio) di più senza di lui.
La configurazione (statistiche, soglie) è l'oggetto `ABS` in `app.js` di ogni app. Le proiezioni non cambiano.

## Champions League

L'app `docs/ucl/` usa lo stesso aggiornatore della Serie A con la competizione ESPN `uefa.champions`
(`tools/ucl/update_data.py` chiama `tools/seriea/update_data.py --league uefa.champions --data docs/ucl/data`).
Si scaricano **solo le partite di Champions League**: statistiche, proiezioni, statistiche avanzate e confronti
non contengono le partite dei campionati nazionali. Differenze rispetto alla Serie A:

- squalifica UEFA alla 3ª ammonizione, poi alla 5ª, 7ª, ... (`suspendAt` in `docs/ucl/model.js`)
- la classifica conta solo la fase campionato (settembre-gennaio)
- calendario guardato fino a 50 giorni avanti (fra una giornata e l'altra possono passare settimane)
- niente Understat (non copre la Champions): l'xG è solo quello di ESPN
- lista dei giocatori osservati separata da quella della Serie A

`docs/ucl/app.js` e `docs/ucl/model.js` sono copie di quelli della Serie A con queste modifiche: una correzione
all'interfaccia o al modello del calcio va riportata in entrambe le cartelle.

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
