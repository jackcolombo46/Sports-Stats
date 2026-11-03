# Sports Stats

Un'unica web app con le proiezioni statistiche dei giocatori di **NBA**, **Serie A**, **Champions League** e **Serie A di basket (LBA)**
contro il prossimo avversario. All'apertura si sceglie lo sport; da ogni schermata il titolo in alto (es. **NBA Stats ▾**)
apre il menu per passare a un altro sport.
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

## Navigazione

`docs/nav.js`: barra con 5 voci, in basso sul telefono e in alto sul computer. Alcune voci hanno due viste (linguette).

| Voce | Viste | Cosa contiene |
|---|---|---|
| **Oggi** (prima pagina) | Partite · Occasioni | partite del giorno; la vista Occasioni è la vecchia pagina Occasioni |
| **Cerca** | — | ricerca unica di giocatori e squadre; senza ricerca, tutte le squadre da toccare |
| **Confronta** | — | squadre o giocatori, come prima |
| **Classifiche** | Squadre · Giocatori | classifica delle squadre e classifiche dei giocatori per categoria |
| **Schedina** | Schedina · Osservati | la schedina e i giocatori osservati |

Toccando di nuovo **Cerca** si torna alla ricerca vuota. Ogni cambio di pagina finisce nella cronologia del browser,
quindi il tasto Indietro del telefono torna alla pagina precedente invece di chiudere l'app; l'indirizzo
(es. `nba/#leaders`) riapre la stessa pagina. Internamente ogni app ha i modi `today, picks, player, team, compare,
table, leaders, slip, watch` (`setMode`/`go` in `app.js`).

## Oggi

`docs/today.js`: le partite del giorno, oppure, se oggi non si gioca, del primo giorno con partite (sopra si sceglie
fra i prossimi 7 giorni con partite). Per ogni partita:
- previsioni di squadra dallo stesso modello di Occasioni e Confronta: calcio 1-X-2 con i gol attesi, over/under 2,5,
  gol/no gol e risultato più probabile; basket vittoria con i punti attesi, scarto e totale attesi;
- **Da tenere d'occhio**: fino a 4 giocatori con le previsioni più probabili della partita (stesse soglie di Occasioni,
  al massimo 2 dello stesso tipo; esclusi palle perse e parate);
- "+" per la schedina; toccando la partita si apre Confronta.
Le giornate NBA seguono la data americana (le partite in Italia sono di notte), le altre la data italiana.

## Classifiche

- **Squadre**: calcio come prima; basket nuova, calcolata dai tabellini della stagione (vinte, perse, % vittorie, punti
  fatti e subiti a partita, ultime 5; NBA divisa in Est e Ovest; `BasketAdv.standings`).
- **Giocatori** (`docs/leaders.js`): senza categoria i primi 5 di ogni categoria, con una categoria la classifica completa
  (primi 10, poi "Mostra tutti"). Filtri: totali / a partita (calcio anche ogni 90 minuti), minimo di partite (di partenza
  il 35% delle partite del giocatore che ne ha di più), squadra, stagione (in corso o precedenti).
  Categorie basket: punti, rimbalzi, assist, triple, rubate, stoppate, P+R+A, rimbalzi offensivi, palle perse, minuti,
  tiri e liberi tentati, % dal campo / da tre / ai liberi, true shooting, eFG%, usage. Calcio: gol, assist, gol+assist,
  tiri, tiri in porta, xG (se ESPN lo manda), tiri in porta %, gol ogni tiro, falli commessi e subiti, ammonizioni,
  espulsioni, parate, minuti. Le percentuali richiedono un minimo di tentativi; "ogni 90 minuti" esclude chi ha giocato
  poco. Champions League: solo partite di Champions.

## Occasioni

La vista **Oggi → Occasioni** (`docs/picks.js`) elenca le previsioni più probabili per tutti i giocatori della prossima
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

## Squadra e Confronta

- **Squadra** (da Cerca): solo la squadra, senza riferimenti all'avversario: statistiche generali con posizione nel campionato,
  rosa con le medie (basket) o i numeri (calcio) della stagione, statistiche avanzate, effetto assenze.
  "Analizza" (o "Confronta con un'altra squadra") porta a Confronta con la squadra scelta.
- **Confronta**: tutto ciò che dipende dall'avversario. 1-X-2 e gol attesi (calcio), **giocatori a confronto**
  (per ogni statistica i migliori delle due squadre insieme, proiettati nella partita fra le due), tabella delle squadre
  (verde/grigio/rosso) e, a scomparsa, le proiezioni complete di ciascuna squadra e cosa concede l'avversario.
  Se le due squadre si affrontano a breve si usa il campo vero, altrimenti campo neutro.

## Assenze nelle proiezioni

Nei modelli (`likelyAbsent`, `absenceDelta`, oggetto `ABS`): se un compagno con un ruolo vero manca, la proiezione
del giocatore si sposta della differenza "senza − con" il compagno (stagione in corso e precedente, stessa squadra),
ridimensionata con peso `partite_senza / (partite_senza + K)` e solo per la quota di partite recenti in cui il compagno
c'era (la media recente contiene già le sue assenze). Verifica (tarata sulla 2025-26, controllata sulla 2026-27):
- NBA con le assenze vere: piccolo miglioramento (logloss 0,2974 → 0,2962 sulla 2025-26) → **attiva, solo per i
  giocatori "Out" nel bollettino infortuni** (indovinare gli assenti dalle partite saltate non migliora nulla);
- LBA nessun miglioramento, calcio leggermente peggio → **spenta** (`ABS.ON = false`).
Per riprovare: `MODEL_PARAMS = { ABS: { ON, K, MISSED, ROLE } }`.

## Andamento e confronto fra giocatori

- `docs/trend.js`: grafici SVG senza librerie. Nella scheda giocatore, **Andamento**: ultime 20 partite della
  statistica scelta, barre verdi se raggiunge la soglia (scelta fra quelle della proiezione), media, separazione fra
  stagioni.
- **Confronta → Confronta giocatori** (anche dalla scheda giocatore con "⇄ Confronta"): due giocatori qualsiasi,
  anche della stessa squadra, affiancati verde/grigio/rosso: proiezione della prossima partita, stagione, ultime 10,
  statistiche avanzate; sotto, l'andamento dei due sovrapposto. Se sono di squadre diverse ognuno è proiettato contro
  il proprio avversario (la pagina lo dice).
- Calcio: se ESPN manda la colonna xG tutta a zero, le voci xG non compaiono.

## Schedina

`docs/slip.js`: il pulsante **+** accanto alle previsioni (pagina Occasioni, giocatori e squadre, e soglie nella scheda
giocatore) le aggiunge alla scheda **Schedina**. Calcola la probabilità combinata (prodotto delle singole), la quota
giusta (1 / probabilità) e, con le quote del bookmaker (per previsione o totale) e l'importo, il valore atteso:
"conviene" se probabilità × quota > 1. Avvisa quando ci sono previsioni della stessa partita o dello stesso giocatore
(collegate fra loro); due soglie della stessa statistica dello stesso giocatore contano una volta sola (la più alta).
Salvata nel browser, una per sport; le probabilità sono quelle del momento dell'aggiunta.

## Quanto ci azzecca il modello

`tools/backtest/backtest.js` (Node, senza dipendenze) rifà le proiezioni di ogni partita già giocata (stagione in corso e
precedente) con lo stesso `model.js` dell'app, usando **solo i dati precedenti a quella partita**, e le confronta con i
risultati. Valuta sia le proiezioni dei giocatori (tutte le soglie e le "occasioni" che la pagina avrebbe mostrato) sia
le previsioni di squadra (stessi calcoli di `docs/picks.js`). Scrive `docs/<sport>/data/backtest.json`; gira a ogni
aggiornamento automatico (passo "Verifica del modello", da pochi secondi a ~30 s) e l'app lo mostra in fondo alla
pagina Occasioni, sezione **Quanto ci azzecca il modello**. Contano solo i giocatori scesi in campo.

### Taratura del modello LBA

La verifica mostrava che sui giocatori LBA il modello era troppo sicuro di sé (occasioni previste al 79%, riuscite al
69%): le medie erano giuste, ma con poche partite per giocatore le stime individuali sono incerte e la pagina Occasioni
finiva per scegliere i giocatori sovrastimati per caso. In `docs/lba/model.js` (oggetto `TUNE`):
- `PRIOR_MIN = 100`: al rendimento di ogni giocatore si aggiungono 100 minuti "medi" del campionato;
- `PARAM_K = 1`: la varianza include l'incertezza sulla stima del rendimento;
- `SD_MIN = 4`: la varianza include l'incertezza sui minuti (±4 a partita).
Valori scelti sulla stagione 2025-26 e controllati sulla 2026-27, mai usata per tararli (occasioni: prima 79,8% previste
e 64,4% riuscite, dopo 78,2% e 76,6%). Per riprovare altri valori: `MODEL_PARAMS` nel contesto in cui gira il modello.

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
