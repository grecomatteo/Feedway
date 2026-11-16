# Decisioni aperte

Un solo elenco delle scelte che aspettano Matteo, perché nessuna vada persa tra un passaggio e l'altro. Ogni task che apre, cambia o chiude un punto aggiorna questo file nella sua PR.

Per ogni voce: **origine** (il task o la revisione che l'ha sollevata), **opzioni**, **stato**.
Stati: **aperta** (da decidere), **scelta provvisoria** (fatta una scelta prudente, Matteo può cambiarla), **decisa** (resta qui finché non è fatta; poi si toglie con la PR che la chiude).

Ultimo aggiornamento: tappa 4, Task 12 (16 novembre 2026).

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

### D-05 · Cartella eliminata con dentro dei file
- **Origine:** tappa 4, Task 12. Il piano dice «si cancella solo se è vuota, oppure con una conferma», senza dire cosa succede al contenuto.
- **Opzioni:** (a) con la conferma, file e sottocartelle passano nella cartella sopra, nessun file si cancella; (b) con la conferma si cancellano anche i file.
- **Stato:** scelta provvisoria (a), la più prudente.

### D-06 · Libreria del cliente: scheda dentro la pagina del cliente
- **Origine:** tappa 4, Task 12. Il piano dice che la scheda «Libreria» «apre questa pagina nel contesto del cliente».
- **Opzioni:** (a) la scheda mostra la stessa libreria dentro la pagina del cliente, con le schede sopra (`/<agenzia>/spazi/<cliente>/libreria`); (b) la scheda porta a `/<agenzia>/media?spazio=<cliente>`.
- **Stato:** scelta provvisoria (a): su telefono la libreria si apre solo da lì, e restare nella pagina del cliente evita di perdere le schede.

### D-07 · Nome della voce: «Media» o «Libreria»
- **Origine:** tappa 4, Task 12. Il piano chiama la voce del menu «Media»; la scheda del cliente e il titolo della pagina dicono «Libreria».
- **Opzioni:** (a) «Media» nel menu e «Libreria» nella pagina, come nel piano; (b) «Libreria» ovunque.
- **Stato:** scelta provvisoria (a), come nel piano.

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
