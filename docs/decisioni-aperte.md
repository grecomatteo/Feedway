# Decisioni aperte

Un solo elenco delle scelte che aspettano Matteo, perché nessuna vada persa tra un passaggio e l'altro. Ogni task che apre, cambia o chiude un punto aggiorna questo file nella sua PR.

Per ogni voce: **origine** (il task o la revisione che l'ha sollevata), **opzioni**, **stato**.
Stati: **aperta** (da decidere), **scelta provvisoria** (fatta una scelta prudente, Matteo può cambiarla), **decisa** (resta qui finché non è fatta; poi si toglie con la PR che la chiude).

Ultimo aggiornamento: tappa 4, Task 13 (16 novembre 2026): nuove D-19 e D-20. Prima, nel Task 12 (16 novembre 2026). Chiuse nel Task 12 su indicazione di Matteo: D-05 (una cartella piena si elimina con tutto il contenuto, dopo la conferma), D-06 (la scheda «Libreria» resta dentro la pagina del cliente), D-07 («Libreria» ovunque, anche nel menu e nell'indirizzo).

## Media e caricamento

### D-01 · Tetto ai caricamenti aperti per le agenzie senza limite di spazio
- **Origine:** tappa 4, Task 9, revisione di sicurezza.
- **Il problema:** un'agenzia senza `storage_bytes` e senza `MEDIA_WORKSPACE_MAX_BYTES` è frenata solo dal limite di frequenza (circa 12 GiB ogni 10 minuti per persona). I pezzi restano fino a 24 ore sul volume `media` condiviso.
- **Opzioni:** (a) un tetto all'ingombro dei caricamenti aperti per agenzia, anche senza limiti; (b) un tetto per persona; (c) lasciare così e mettere un avviso sul disco nel runbook.
- **Stato:** aperta.

### D-02 · Decodifica delle foto e delle HEIC dentro il processo del worker
- **Origine:** tappa 4, Task 10, revisione di sicurezza.
- **Il problema:** un file costruito ad arte può far superare il limite di memoria del contenitore. Il worker si riavvia; dopo 3 tentativi il file va in `processing_failed`.
- **Opzioni:** (a) decodifica in un processo figlio con limite di memoria; (b) lasciare così.
- **Stato:** aperta.

### D-03 · Profilo Display P3 delle HEIC
- **Origine:** tappa 4, Task 10.
- **Il problema:** libheif-js non espone il profilo colore: una HEIC P3 esce convertita come se fosse sRGB, con colori un po' spenti.
- **Opzioni:** (a) cambiare decodificatore; (b) accettarlo e scriverlo come limite noto.
- **Stato:** aperta.

### D-04 · SEI dei video HEVC
- **Origine:** tappa 4, Task 10.
- **Il problema:** i SEI dell'HEVC restano, perché portano le informazioni HDR, ma potrebbero portare luogo o ora.
- **Opzioni:** (a) toglierli, perdendo l'HDR; (b) toglierli solo se non c'è HDR; (c) lasciarli.
- **Stato:** aperta.

### D-18 · I file caricati in un post e la libreria
- **Origine:** tappa 4, Task 12, domanda di Matteo (16 novembre 2026). La specifica (§11.8, §11.9) dice che i file caricati direttamente in un post non entrano in libreria e si cancellano `MEDIA_RETENTION_DAYS` (7) giorni dopo la pubblicazione, salvo «salvati in libreria».
- **Decisione di Matteo:** finché il post è programmato i suoi file si vedono nella libreria del cliente; quando il programma ha verificato che la pubblicazione è andata a buon fine, si possono togliere. Resta il pulsante per tenerli («Salva in libreria»).
- **Da precisare nella tappa 6:** se si tolgono subito dopo la verifica o dopo i 7 giorni di `MEDIA_RETENTION_DAYS`; come si distinguono in libreria dai file salvati (per esempio un'etichetta «Nel post del …»).
- **Stato:** decisa, da fare nelle tappe 6 (post) e 7 (pubblicazione e verifica); la specifica §11.8 va aggiornata in quella PR.

### D-19 · Il limite delle foto si controlla solo nel pannello e nel worker
- **Origine:** tappa 4, Task 13.
- **Il problema:** all'inizio di un caricamento il server controlla solo `MEDIA_MAX_VIDEO_BYTES` (300 MB), il limite più alto, come dice l'ADR 021. Il pannello rifiuta subito una foto oltre `MEDIA_MAX_IMAGE_BYTES` (50 MB), ma chi chiama l'API direttamente può caricarla: il worker poi la segna «Non riuscito».
- **Opzioni:** (a) controllare anche il limite delle foto al `POST`, dal tipo dichiarato; (b) lasciare così, perché il worker la blocca comunque.
- **Stato:** scelta provvisoria (b).

### D-20 · Quanti file si caricano insieme
- **Origine:** tappa 4, Task 13.
- **Il problema:** il pannello manda due file alla volta, un pezzo per file. Con più file insieme la connessione si divide e nessuno finisce prima.
- **Opzioni:** (a) due alla volta; (b) uno alla volta; (c) tre o più.
- **Stato:** scelta provvisoria (a), da rivedere con la prova sulla VPS (Task 14).

## Host pubblico (`/m/*`)

### D-08 · Limite di richieste per IP sull'ingresso pubblico
- **Origine:** tappa 4, Task 11 (§15.3).
- **Il problema:** ogni nome ben formato apre una transazione di sistema sul pool del web.
- **Opzioni:** (a) limite per IP sull'ingresso pubblico; (b) cache in memoria dei token non trovati; (c) lasciare così finché non serve.
- **Stato:** aperta.

### D-09 · File di agenzie sospese o di clienti archiviati
- **Origine:** tappa 4, Task 11.
- **Il problema:** oggi le loro copie restano servite da `/m/*`.
- **Opzioni:** (a) non servirle più; (b) servirle finché il post pubblicato le usa; (c) lasciare così.
- **Stato:** aperta.

### D-10 · `robots.txt` e lo scaricatore di Meta
- **Origine:** tappa 4, Task 11.
- **Il problema:** la specifica chiede `robots.txt` che blocca tutto anche sull'host pubblico. Non è provato che lo scaricatore di Meta lo ignori.
- **Opzioni:** se Meta non scarica, lasciare passare `facebookexternalhit` su `/m/`.
- **Stato:** aperta, da verificare con Meta vera (tappa 7).

### D-11 · `/m/*` fuori dalla batteria d'isolamento
- **Origine:** tappa 4, Task 11.
- **Il problema:** `/m/*` non è una rotta dell'API: il token è la sola chiave, e la batteria non lo prova.
- **Opzioni:** (a) aggiungere un caso dedicato alla batteria; (b) lasciare i 17 test di `public-host.int.test.ts`.
- **Stato:** aperta.

### D-12 · L'ETag di `/m/*` è l'id della copia
- **Origine:** tappa 4, Task 11.
- **Il problema:** l'id è un UUID v7 e rivela l'ora di creazione della copia.
- **Opzioni:** (a) un ETag dall'impronta del file; (b) lasciare così.
- **Stato:** aperta.

## Rilascio 0.10.0

### D-13 · `secrets/ts_public_authkey` prima dell'aggiornamento
- **Origine:** tappa 4, Task 11.
- **Il problema:** lo `update.sh` delle versioni precedenti rifiuta la 0.10.0 se manca `secrets/ts_public_authkey`.
- **Cosa fare:** prima dell'aggiornamento sulla VPS, `(umask 077 && printf non-usata > secrets/ts_public_authkey)`. Va nelle note di rilascio e nella guida della prova.
- **Stato:** decisa, da fare nel Task 14.

### D-14 · Guida completa della prova della 0.10.0
- **Origine:** richiesta di Matteo, 16 novembre.
- **Cosa fare:** una guida passo passo con tutto quello che va fatto sulla VPS (D-13, policy e chiave di Tailscale, Funnel, aggiornamento, controlli) e ogni passo della prova.
- **Stato:** decisa, da fare nel Task 14.

## Clienti e profili

### D-15 · Profilo già in un altro cliente
- **Origine:** tappa 4, Task 6a.
- **Il problema:** dalla pagina del cliente si aggiungono solo i profili senza cliente.
- **Opzioni:** (a) proporre anche quelli di altri clienti, con «Sposta qui»; (b) lasciare così.
- **Stato:** aperta.

### D-16 · «Ricollega» con due collegamenti diversi
- **Origine:** tappa 4, Task 6c.
- **Il problema:** «Ricollega» evidenzia il collegamento del primo account del profilo, anche se il secondo viene da un altro.
- **Stato:** aperta.

### D-17 · Contrasto dell'hover del pulsante principale in tema scuro
- **Origine:** tappa 4, Task 6c.
- **Stato:** aperta, da guardare con il Task 13b (temi colore).
