# Decisioni aperte

Un solo elenco delle scelte che aspettano Matteo, perché nessuna vada persa tra un passaggio e l'altro. Ogni task che apre, cambia o chiude un punto aggiorna questo file nella sua PR.

Per ogni voce: **origine** (il task o la revisione che l'ha sollevata), **opzioni**, **stato**.
Stati: **aperta** (da decidere), **scelta provvisoria** (fatta una scelta prudente, Matteo può cambiarla), **decisa** (resta qui finché non è fatta; poi si toglie con la PR che la chiude).

Ultimo aggiornamento: correzioni media dopo la prova della 0.10.0 (17 novembre 2026): chiuse D-03 (le HEIC in Display P3 si convertono in sRGB), D-41 (un pezzo fermo riparte dopo 30 s e al cambio di rete; `ECONNRESET` come avviso), D-42 (avviso del file doppio con l'impronta sha256) e D-43 (i file «Non riuscito» si cancellano dopo 24 ore); aggiornata D-39 (timeout da pixel al secondo, preset più veloce, consiglio nel pannello, worker a 1,5 CPU, «Riprova»); D-44 con una proposta. Prima, esiti della prova della 0.10.0 sulla VPS (17 novembre 2026, esiti nelle consegne della tappa 4, punti R-n ed E-n): decise D-03 (conversione in sRGB) e D-25 (rosso più freddo); aggiornate D-27, D-29, D-30, D-34; nuove D-39…D-45. Prima, correzioni della revisione retroattiva delle tappe 1–3 (17 novembre 2026): nuove D-35 (rotazione della chiave di cifratura e del segreto di Better Auth, tappa 11), D-36 (versione Graph predefinita), D-37 (conservazione dei contatori) e D-38 (rafforzamenti rimandati alla tappa 11). Prima, revisione UI della tappa 4 (16 novembre 2026): D-31 aggiornata, la revisione è fatta (`design/reviews/2026-11-16-revisione-ui-tappa-4.md`) e resta solo la tela. Prima, rilascio della 0.10.0 (Task 14, 16 novembre 2026): chiuse D-13 (il segnaposto `secrets/ts_public_authkey` è nella guida della prova e, dalla 0.10.0, in `update.sh`) e D-14 (guida completa della prova scritta). Prima, nelle correzioni della revisione finale della tappa 4 (16 novembre 2026): nuove D-27 (caricamento), D-29 e D-30, voci rimandate D-31…D-34; aggiornate D-02 (riavvio del worker) e D-08 (limite di letture dell'host pubblico, con la PR dei video); chiusa D-26 (copia `master` delle foto fino a 4096 px, senza GPS, scelta B di Matteo). Prima, nel Task 13b (16 novembre 2026): chiusa D-17 (l'hover del pulsante principale ha ora un colore suo, `brand-hover`, con 4,5:1 in ogni tema); nuove D-22, D-23, D-24 e D-25. Prima, nel Task 13 (16 novembre 2026): nuove D-19, D-20 e D-21. Prima, nel Task 12 (16 novembre 2026). Chiuse nel Task 12 su indicazione di Matteo: D-05 (una cartella piena si elimina con tutto il contenuto, dopo la conferma), D-06 (la scheda «Libreria» resta dentro la pagina del cliente), D-07 («Libreria» ovunque, anche nel menu e nell'indirizzo).

## Media e caricamento

### D-01 · Tetto ai caricamenti aperti per le agenzie senza limite di spazio
- **Origine:** tappa 4, Task 9, revisione di sicurezza.
- **Il problema:** un'agenzia senza `storage_bytes` e senza `MEDIA_WORKSPACE_MAX_BYTES` è frenata solo dal limite di frequenza (circa 12 GiB ogni 10 minuti per persona). I pezzi restano fino a 24 ore sul volume `media` condiviso.
- **Opzioni:** (a) un tetto all'ingombro dei caricamenti aperti per agenzia, anche senza limiti; (b) un tetto per persona; (c) lasciare così e mettere un avviso sul disco nel runbook.
- **Stato:** aperta.

### D-02 · Decodifica delle foto e delle HEIC dentro il processo del worker
- **Origine:** tappa 4, Task 10, revisione di sicurezza.
- **Il problema:** un file costruito ad arte può far superare il limite di memoria del contenitore. Il worker si riavvia; dopo 3 tentativi il file va in `processing_failed`.
- **Legata alla revisione della tappa 4 (P2):** dalla 0.10.0 un riavvio pulito (aggiornamento, `restart`) non consuma tentativi e la conversione riparte appena il worker torna; un crash vero sì, ed è voluto, così un file che uccide il worker si ferma dopo 3 volte.
- **Opzioni:** (a) decodifica in un processo figlio con limite di memoria; (b) lasciare così.
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

### D-21 · Caricamenti in corso e cambio di pagina nel pannello
- **Origine:** tappa 4, Task 13, revisione della PR.
- **Il problema:** i caricamenti vivono nella pagina della libreria. Se si va su un'altra pagina del pannello (o si cambia cliente) si fermano e diventano «rimasti a metà»: si riprendono scegliendo di nuovo il file. Chiudere o ricaricare la scheda chiede invece conferma al browser.
- **Opzioni:** (a) chiedere conferma anche prima di cambiare pagina; (b) tenere i caricamenti vivi in tutto il pannello, con un piccolo indicatore fisso (serve anche all'editor del post, tappa 6); (c) lasciare così.
- **Stato:** scelta provvisoria (c); (b) è la proposta per la tappa 6.

### D-27 · Un pezzo deve arrivare entro 300 secondi
- **Origine:** revisione finale della tappa 4 (P1 bis).
- **Il problema:** il server del pannello è quello di Nitro, che lascia il limite di Node: una richiesta deve arrivare tutta in 300 secondi. Con pezzi da 20 MiB, sotto circa 70 KB/s in invio (0,56 Mbit/s) un pezzo non arriva mai, e il pannello lo riprova.
- **Cosa fa oggi il pannello:** se lo stesso pezzo cade due volte di fila dopo almeno 4 minuti di invio, scrive «La rete è troppo lenta per questo file» e continua a provare.
- **Opzioni:** (a) pezzi più piccoli, per esempio 8 MiB (cambia il protocollo dell'ADR 021, quindi serve una nuova ADR); (b) alzare il limite del server del pannello (Nitro non lo permette in modo pulito); (c) lasciare così, con l'avviso.
- **Prova della 0.10.0:** il 4G debole non è stato provato. In un passaggio Wi-Fi → 5G su tre il caricamento non è ripartito da solo e serviva «Riprendi» (R-5, D-41).
- **Stato:** scelta provvisoria (c), da misurare su 4G debole in una prova successiva.

### D-29 · Video con un errore di decodifica
- **Origine:** revisione finale della tappa 4 (P6).
- **Il problema:** un video da telefono può dare qualche errore innocuo al decoder. Prima bastava una riga d'errore per rifiutarlo come illeggibile.
- **Cosa fa ora il worker:** dopo un errore conta i fotogrammi: la copia d'anteprima deve averli tutti, come il file (contati senza decodificare). Un fotogramma oltre il limite di pixel rifiuta sempre il video, perché la copia da pubblicare prende i fotogrammi così come sono (revisione di sicurezza).
- **Opzioni:** (a) tutti i fotogrammi, nessun margine; (b) un piccolo margine fisso (per esempio 2 fotogrammi), mai una percentuale; (c) un elenco di messaggi ammessi.
- **Prova della 0.10.0:** 6 video veri dall'iPhone (4K30, 4K60, 1440p60), nessuno rifiutato. Android non provato.
- **Stato:** scelta provvisoria (a). Se un video vero, anche Android, viene rifiutato per pochi fotogrammi persi, (b).

### D-30 · iPhone in modalità «Più compatibile»
- **Origine:** revisione finale della tappa 4 (P14), dagli handoff dei Task 10 e 13.
- **Il problema:** con «Formati → Più compatibile» l'iPhone salva foto JPEG e video H.264, e quando li manda può convertire una HEIC in JPEG da sé. Quello che arriva a Feedway non è allora il file della fotocamera. Nella prova va scelto «Attuale» nel selettore di iOS, e il codec va controllato nel dettaglio del file.
- **Opzioni:** (a) scriverlo nella guida per le agenzie; (b) non fare niente, perché Feedway converte comunque.
- **Prova della 0.10.0:** con «Attuale» arriva il file della fotocamera (HEVC 4K, non ricompresso).
- **Stato:** aperta: resta da scegliere se scriverlo nella guida per le agenzie.

## Host pubblico (`/m/*`)

### D-08 · Limite di richieste per IP sull'ingresso pubblico
- **Origine:** tappa 4, Task 11 (§15.3).
- **Il problema:** ogni nome ben formato apre una transazione di sistema sul pool del web.
- **Fatto con la revisione della tappa 4 (P3):** al massimo 3 letture insieme dall'ingresso pubblico; oltre, la risposta è 503 con `Retry-After: 5`, che Meta riprova. Il pannello non resta più senza connessioni.
- **Opzioni rimaste:** (a) limite per IP sull'ingresso pubblico (dietro Funnel l'IP del client non è affidabile, da verificare); (b) cache in memoria dei token non trovati; (c) lasciare così.
- **Stato:** scelta provvisoria (c), da rivedere nella tappa 7, quando Meta scarica davvero.

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

## Lavoro rimandato ad altre tappe

### D-31 · Tela Pencil ferma al 10 novembre
- **Origine:** revisione finale della tappa 4 (P8). La revisione UI è fatta (`design/reviews/2026-11-16-revisione-ui-tappa-4.md`), ma Pencil non era disponibile in quella sessione.
- **Il problema:** `design/feedway-ui.pen` non ha ancora Libreria, caricamento, dettaglio del file, temi colore e logo.
- **Stato:** decisa, da fare all'inizio della tappa 6, dopo la revisione UI della tappa 4 (la tappa 6 ridisegna parte di queste schermate).

### D-32 · I file di un'agenzia eliminata
- **Origine:** revisione finale della tappa 4 (P13).
- **Il problema:** l'eliminazione di un'agenzia non esiste ancora. Quando arriverà, dovrà cancellare anche `org/<id>/` dall'archivio dei file (libreria, logo, foto dei clienti) oltre alle righe del database.
- **Stato:** decisa, da fare nella tappa che introduce l'eliminazione delle agenzie.

### D-33 · Nessun backup dei file della libreria fino alla tappa 11
- **Origine:** revisione finale della tappa 4 (P9), specifica §16.4.
- **Il problema:** il backup di oggi copre il database, non i file. Finché la tappa 11 non c'è, la libreria non va usata come unica copia del materiale dei clienti. Scritto nel runbook dei media.
- **Stato:** decisa, da fare nella tappa 11.

### D-34 · Foto delle Pagine a 256 px e scaricamenti in modalità di prova
- **Origine:** revisione finale della tappa 4 (P13).
- **Cosa è cambiato:** il pannello chiede a Meta le foto delle Pagine larghe 256 px (`picture.width(256).height(256)`), invece dei circa 50 px di prima. Provato solo con `tools/meta-mock`: **non verificato su Meta vera**.
- **Da sapere:** anche con `META_MODE=dry-run` le foto dei profili si scaricano dalla CDN di Meta. Non è una chiamata ad account Meta, sono immagini pubbliche.
- **Prova della 0.10.0:** le foto degli account Instagram sono vere e nitide (WebP 256×256). La Pagina Facebook di prova non ha foto (salvata l'immagine predefinita).
- **Stato:** da verificare con una Pagina Facebook vera con la sua foto.

### D-35 · Cambiare la chiave di cifratura e il segreto di Better Auth senza perdere dati
- **Origine:** revisione retroattiva delle tappe 1–3 (A3), specifica §15, ADR 007 e 012.
- **Il problema:** il portachiavi conosce una sola versione della chiave di cifratura (`PLATFORM_KEY_VERSION = 1`): cambiarla rende illeggibili token Meta, App Secret e password SMTP. `BETTER_AUTH_SECRETS` (`2:nuovo,1:vecchio`, provata nel contratto V1b) non arriva al container, quindi cambiare il segreto chiude le sessioni e rende illeggibile la 2FA. Oggi il runbook [cambiare i segreti](runbooks/rotazione-segreti.md) dice come limitare i danni.
- **Opzioni:** (a) `APP_ENCRYPTION_KEYS` con più versioni e un comando `fw` che ricifra le chiavi delle agenzie e i segreti della piattaforma con la nuova, più un file segreto facoltativo per `BETTER_AUTH_SECRETS` nel compose (con il segnaposto in `update.sh`, come per `ts_public_authkey`); (b) lasciare così e cambiare i segreti solo con la procedura d'emergenza del runbook.
- **Stato:** scelta provvisoria (a), da fare nella tappa 11 (sicurezza e operazioni); Matteo può cambiarla.

### D-36 · Versione della Graph API predefinita
- **Origine:** revisione retroattiva delle tappe 1–3 (A8).
- **Il problema:** `META_GRAPH_VERSION` vale `v25.0` se non è impostata, mentre l'app Meta della prova risulta abilitata a v26 e v27: probabilmente Meta porta le chiamate alla versione minima dell'app senza dirlo, e le risposte possono non essere quelle che simula `tools/meta-mock`. Le date di ritiro note (`META_GRAPH_SUNSETS`) sono solo di v24 e v25, quindi per le versioni nuove l'avviso di ritiro (§8.4) parte solo se si imposta `META_GRAPH_VERSION_SUNSET`. **Non verificato su Meta vera.**
- **Opzioni:** (a) alla prossima prova su Meta vera, leggere la versione che Meta usa davvero e portare il valore predefinito e le date di ritiro a quella; (b) lasciare v25.0 e impostare la versione solo da `.env`.
- **Stato:** aperta, da verificare nella prossima prova su Meta vera.

### D-37 · Per quanto restano i contatori dei limiti e gli errori di accesso
- **Origine:** revisione retroattiva delle tappe 1–3 (A4).
- **Cosa è stato scelto:** i contatori fermi da **2 giorni** si cancellano nella conservazione notturna (il doppio della finestra più lunga in uso, 24 ore per gli inviti); gli accessi sbagliati si dimenticano dopo **24 ore** senza nuovi errori. Scritto nella specifica §15.7, nel registro dei trattamenti e nell'informativa.
- **Da sapere:** un limite nuovo con una finestra più lunga di 2 giorni verrebbe accorciato in silenzio dalla pulizia: va alzato anche `RETENTION.rateLimitCountersMs`.
- **Opzioni:** (a) 2 giorni e 24 ore; (b) valori diversi, scelti da Matteo.
- **Stato:** scelta provvisoria (a).

### D-38 · Rafforzamenti trovati dalla revisione di sicurezza, rimandati
- **Origine:** revisione di sicurezza della PR delle correzioni delle tappe 1–3.
- **I punti:** (1) il ritardo degli accessi sbagliati legge il contatore e poi lo aggiorna in due passi: N tentativi in parallelo da IP diversi passano insieme nella stessa finestra (il limite per IP resta 10 al minuto); (2) il rilascio unisce le immagini amd64 e arm64 per tag e non per digest, e `update.sh` non controlla la firma dei tag; (3) l'immagine pubblicata con `docker push` non ha più l'attestazione di provenienza che aggiungeva `build-push-action`.
- **Opzioni:** (a) farli nella tappa 11 (sicurezza e operazioni): prenotazione atomica del tentativo con un solo `UPDATE … RETURNING`, manifest per digest con `actions/attest-build-provenance`, verifica dei tag; (b) prima, se Matteo lo chiede.
- **Stato:** scelta provvisoria (a).

## Dalla prova della 0.10.0

### D-39 · Video 4K a 60 fps oltre il tempo di conversione
- **Origine:** prova della 0.10.0 (R-1, alta).
- **Il problema:** il timeout di ffmpeg è 2 minuti più 4 volte la durata, ma un 4K60 HEVC richiede circa 26 s di lavoro per secondo di video con `-threads 1`. IMG_0233.mov (23 s) è finito in «Non riuscito» al 46% dopo 213 s. Un 1080p richiede circa 2,5 s per secondo e rientra.
- **Opzioni:** (a) usare tutte le CPU del contenitore per l'anteprima; (b) timeout proporzionale a pixel e fps, non solo alla durata; (c) anteprima e copia da pubblicare in un solo passaggio; (d) preset più veloce per l'anteprima; (e) nuovo tentativo automatico con impostazioni rapide; (f) nel pannello «Riprova» e il consiglio «esportalo in 1080p o a 30 fps». Si possono combinare.

- **Fatto (PR delle correzioni media):** (b) timeout dell'anteprima da 2 minuti più la durata per max(4, pixel al secondo / 10 milioni), al massimo 60 minuti: per il file della prova circa 21 minuti invece di 212 s; (d) preset `superfast`; (f) il consiglio «esportalo in 1080p o a 30 fps» nel motivo del timeout e il pulsante «Riprova» nel dettaglio del file, per `timeout` e `processing_failed` (gli unici che tengono l'originale). Misurato in locale su un 4K60 HEVC a 10 bit: due core dimezzano il tempo, il preset conta meno del 5%.
- **Decisa (a), Matteo, 17 novembre:** worker a 1,5 CPU e 2 thread per l'anteprima, per non bloccare il pannello con 2 CPU; §16.6 aggiornata. Da controllare nella prossima prova: il pannello resta fluido mentre converte un 4K.
- **Stato:** fatta, da verificare nella prossima prova; (c) anteprima e copia in un passaggio, (e) nuovo tentativo automatico con impostazioni rapide, solo se la prossima prova mostra che non basta. Da controllare nella prova: il 4K60 di 23 s arriva a «Pronto» e il pannello resta fluido mentre converte.
### D-40 · Copia per le Reels oltre i limiti di Meta
- **Origine:** prova della 0.10.0 (R-2, alta prima della pubblicazione vera).
- **Il problema:** la copia `reel` è un remux dell'originale: un 4K iPhone resterebbe HEVC 3840×2160 a circa 36 Mbit/s, oltre i limiti delle Reels via API (larghezza massima 1920, bitrate massimo circa 25 Mbit/s, **da ricontrollare sulla documentazione Meta**). Da Funnel, a circa 21 Mbit/s, non si guarda fluido.
- **Opzioni:** (a) remux se dentro i limiti, altrimenti conversione a 1080×1920, H.264 High, 8–12 Mbit/s, fps originali fino a 60, AAC 48 kHz, faststart; (b) come (a), più una copia ad alta qualità tenuta da parte; (c) conversione sempre.
- **Stato:** scelta provvisoria (a), proposta da Matteo; da fare prima della tappa 7 (pubblicazione). Resta da decidere (b).

### D-44 · `avatar_url` di Meta che resta accanto alla copia
- **Origine:** prova della 0.10.0 (R-11).
- **Il problema:** in `social_accounts` resta `avatar_url`, il link di Meta che scade, anche dove c'è la copia `avatar_key`.
- **Cosa si è visto (correzioni media):** il link non esce mai dal server: le API danno solo l'indirizzo della copia di Feedway (`avatarUrl` nei contratti è la copia, o null). La colonna serve alla sincronizzazione per capire se la foto è cambiata (un link nuovo, o una foto mai copiata) e al lavoro `accounts.avatar` per scaricarla.
- **Opzioni:** (a) svuotarla dopo la copia: ogni sincronizzazione riscaricherebbe tutte le foto da Meta, perché non saprebbe più se sono cambiate; (b) sostituirla con l'impronta sha256 del link (una colonna nuova e una migrazione in due rilasci); (c) lasciarla così, è un dato interno di una foto pubblica.
- **Proposta:** (c), oppure (b) insieme alla prossima migrazione di `social_accounts`. Non fatto niente nel codice.
- **Stato:** aperta, aspetta Matteo.
### D-45 · Ritocchi del pannello dalla prova
- **Origine:** prova della 0.10.0 (R-9, R-10, R-12, E-1, E-3).
- **Cosa:** libreria con vista griglia/elenco e miniature regolabili, nomi meno tagliati (E-1); messaggi che spariscono da soli dopo 4–5 s (E-3); barra di scorrimento verticale accanto alle schede del cliente anche con spazio (R-10); spazio vuoto tra la barra e il menu delle impostazioni (R-12); stato d'errore visibile in Panoramica (R-9).
- **Stato:** decisa, da fare con la revisione grafica dopo la prova.

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

## Temi colore (Task 13b)

### D-22 · Quali temi e con quali colori
- **Origine:** tappa 4, Task 13b.
- **La scelta:** cinque temi: Feedway (i colori di oggi, predefinito), Blu, Verde, Viola, Grafite (senza tinta, l'accento è il colore del testo). Ognuno tinge carta, superfici e filetti della sua tinta con la stessa luminosità di Feedway. Nei temi colorati l'accento è chiaro con l'etichetta scura di giorno e scuro con l'etichetta bianca di notte: così non si confonde con i colori di stato (verde «confermato», blu «programmato»), che di giorno sono scuri e di notte chiari. Schermate in `schermate/tappa-4-temi/`.
- **Opzioni:** (a) tenere questi; (b) cambiare tinte o aggiungerne (per esempio un rosa, che però va tenuto lontano dal rosso di «con problema»); (c) togliere Grafite.
- **Stato:** scelta provvisoria, aspetta lo sguardo di Matteo sulle schermate.

### D-23 · Bordi dei campi più scuri anche in Feedway
- **Origine:** tappa 4, Task 13b (il piano chiede bordi dei campi di almeno 3:1).
- **Il problema:** il bordo dei campi era `border-strong` (#CFCAC0 su bianco, circa 1,6:1). Per il criterio 1.4.11 delle WCAG il bordo di un campo che si riconosce solo da lì deve avere 3:1.
- **La scelta:** un token nuovo, `field-border` (#7F7B74 di giorno, #83807A di notte in Feedway), per i campi, le tendine e i pulsanti con il contorno (`--ui-border-accented`). È l'unico cambio visibile per chi resta su Feedway: i campi hanno un bordo più deciso.
- **Opzioni:** (a) tenere; (b) un grigio intermedio, sempre ≥ 3:1.
- **Stato:** scelta provvisoria.

### D-24 · Il colore si salva subito, il tema chiaro/scuro con «Salva»
- **Origine:** tappa 4, Task 13b.
- **Il problema:** il piano chiede che il cambio di colori si veda subito: la scelta dei colori si salva al clic, mentre chiaro/scuro/automatico e il fuso restano nel modulo con «Salva».
- **Opzioni:** (a) lasciare così; (b) anche chiaro/scuro al clic, come il pulsante sole/luna del menu, e «Salva» solo per il fuso.
- **Stato:** scelta provvisoria (a).

### D-25 · Arancio e rosso di «con problema» nel tema scuro di Feedway
- **Origine:** tappa 4, Task 13b (test «gli stati non si confondono con l'accento»).
- **Il problema:** nel tema scuro di Feedway l'arancio #FF762E e il rosso chiaro di «con problema» #FF8A80 sono la coppia più vicina di tutti i temi (distanza OKLab 0,078; la soglia del test è 0,075). Lo stato ha sempre icona e parola, ma i due colori si somigliano.
- **Opzioni:** (a) lasciare così; (b) un rosso più freddo per gli errori di notte (per esempio verso il rosa), cambiando un colore del brand kit scuro.
- **Prova della 0.10.0 (R-9):** Matteo trova il rosso di «Non riuscito» troppo vicino all'arancio, e in Panoramica un file non riuscito è un riquadro grigio senza segno d'errore.
- **Stato:** decisa (b), oppure un badge con sfondo rosso; da fare con la revisione grafica dopo la prova.
