# ADR 021 · Storage a oggetti e caricamento a pezzi

| | |
|---|---|
| **Stato** | Accettata (Matteo, 2026-11-13) |
| **Data** | 2026-11-13 |
| **Specifica** | v9, §6.5, §9.2, §11.1, §16.1, §16.2, §16.6; piano 04, Scelte 3, 4 e 7 |
| **Rapporto con ADR 008** | La completa: ADR 008 (caricamento a pezzi da 20 MB) resta valida, e questa ADR fissa protocollo, posizione dei pezzi e verifica dell'impronta. I «20 MB» di ADR 008 diventano 20 MiB. Lo stato di ADR 008 diventa «Accettata; completata da ADR 021» |

## Contesto
La tappa 4 porta foto e video fino a 300 MB, caricati spesso dal telefono su reti che cadono (ADR 008). In produzione i file restano sul disco della VPS, dietro la porta `Storage`. Il piano generale chiede però che il passaggio a uno storage a oggetti (Cloudflare R2) sia solo configurazione, provato nei test contro Garage (`docs/stack.md`).

Fatti di partenza:
- La porta `Storage` ha `put`, `get`, `delete`, `deletePrefix` e `list`, con l'adattatore su disco e la sua batteria (`storage-contract.testkit.ts`). Non c'è un adattatore S3.
- Il web tiene in memoria il corpo delle richieste (`defineApiRoute`) e lo limita a 1 MB, o 8 MB in multipart.
- La coda pg-boss lascia un lavoro attivo al massimo 15 minuti (`expireInSeconds`, predefinito 900), poi lo riprova. Una conversione video su un solo thread può durare di più.
- La VPS ha 2 core condivisi: le conversioni vanno una alla volta e un'agenzia non deve bloccare le altre (§6.5, §16.6).

**Prova del 2026-11-13** con Garage 2.5.0 (`dxflrs/garage:v2.5.0`, un nodo) e `@aws-sdk/client-s3` 3.1168.0 con `@aws-sdk/lib-storage`, in un contenitore locale, con uno script di prova fuori dal repository (il Task 7 rifà la prova con la batteria della porta). Si sono provati `PutObject`, un caricamento multipart da 25 MB, `GetObject` con `Range`, `ListObjectsV2` e `DeleteObjects`:
- con l'indirizzo per nome (`http://localhost:3900`) le richieste falliscono senza `forcePathStyle`, perché il client cerca `<bucket>.localhost`. Con `forcePathStyle: true` funzionano tutte. Con un indirizzo IP il client passa da solo al percorso, quindi la prova va fatta con un nome, come `garage` nel compose dei test;
- con le impostazioni predefinite dei checksum (CRC32 dalla versione 3.729 del client) funziona tutto anche **senza** `requestChecksumCalculation: 'WHEN_REQUIRED'`. Il piano lo dava «da verificare»: con Garage 2.5.0 non serve;
- la pagina di Cloudflare sull'SDK JS v3 con R2 (letta il 2026-11-13) usa `region: "auto"` e non parla di checksum né di `forcePathStyle`. Su R2 vera non si è provato niente.

## Decisione
**L'adattatore S3 usa `@aws-sdk/client-s3` con `@aws-sdk/lib-storage`. Il caricamento usa un protocollo nostro su HTTP: pezzi da 20 MiB con il loro sha256, scritti sul disco del web fino al completamento, e impronta del file intero calcolata dal server. Le conversioni vanno una alla volta per l'installazione, a turno tra le agenzie.**

### Client S3
- `@aws-sdk/client-s3` e `@aws-sdk/lib-storage`, versione esatta, solo in `packages/infrastructure`. Entrano nel Task 7 con l'adattatore, non prima.
- Configurazione: `endpoint`, `bucket`, `region` (predefinita `auto`, come chiede R2), credenziali e `forcePathStyle` (predefinito vero: Garage lo richiede, R2 lo accetta). I checksum restano quelli predefiniti del client. Se R2 vera li rifiutasse, si aggiunge `requestChecksumCalculation: 'WHEN_REQUIRED'` con un test, senza cambiare questa ADR.
- `put` di lunghezza ignota con `Upload` di `lib-storage`: pezzi da 20 MiB, al più 2 in memoria, e in caso di errore il multipart si annulla (`leavePartsOnError: false`), così non resta niente.
- `get` e `getRange` restituiscono un flusso. `deletePrefix` e `list` paginano (1000 chiavi per pagina).

### Garage nei test
- Garage (`dxflrs/garage`, versione fissata con digest) in un contenitore, come Postgres. È un nodo solo, con un bucket e una chiave creati all'avvio della batteria.
- La batteria della porta (`storage-contract.testkit.ts`) gira sia su disco sia su Garage (Task 7).

### Protocollo di caricamento (Scelta 3)
Le rotte esatte si fissano nel Task 9. Il protocollo è questo:
- `POST` crea la sessione con nome mostrato, dimensione dichiarata e sha256 del primo pezzo. Risponde con l'id del caricamento, la dimensione dei pezzi (20 MiB, cioè 20.971.520 byte) e il loro numero. Lo spazio dichiarato si **prenota** subito contro `storage_bytes` e `MEDIA_WORKSPACE_MAX_BYTES`, in una transazione che blocca la riga dell'agenzia: due caricamenti contemporanei non possono superare insieme il limite.
- `PUT` manda il pezzo `n` come `application/octet-stream`, con l'intestazione `Content-Digest: sha-256=:…:` (RFC 9530). Il server lo scrive a flusso su disco, senza tenerlo in memoria, e confronta l'impronta. Se l'impronta non torna risponde 422 e scarta il pezzo. Lo stesso pezzo con la stessa impronta non cambia niente; con un'impronta diversa da un pezzo già ricevuto risponde 409. Un pezzo oltre la dimensione o oltre il numero dichiarato è rifiutato.
- `GET` dice quali pezzi ci sono. Il browser lo chiama dopo una caduta e manda solo quelli mancanti.
- `POST …/complete` unisce i pezzi in un flusso verso lo `Storage` e calcola intanto lo sha256 del file intero. Poi crea il media in `processing` e accoda `media.process`. È idempotente: una seconda chiamata risponde con lo stesso media.
- `DELETE` annulla, cancella i pezzi e libera lo spazio prenotato.
- Solo la persona che ha creato la sessione può mandare pezzi, chiedere lo stato, completare o annullare, oltre al permesso `media.upload` nello spazio.
- Dopo un ricaricamento della pagina il pannello elenca i caricamenti rimasti a metà. Il file scelto di nuovo si riconosce da nome, dimensione e sha256 del primo pezzo.
- Il tipo vero si legge dai byte nel worker (piano 04, Regole). Al `POST` si controlla solo la dimensione dichiarata contro `MEDIA_MAX_VIDEO_BYTES`, il limite più alto.

### Pezzi sul disco del web (Scelta 4)
- I pezzi stanno in `MEDIA_UPLOAD_DIR` (predefinita `/media/uploads`), dentro il volume `media` ma fuori dallo spazio delle chiavi della porta (`org/`, `users/`). I nomi li genera il server dall'id del caricamento e dal numero del pezzo.
- Il worker non ha bisogno di quella cartella: riceve il file dallo `Storage`.
- Un caricamento non completato si cancella dopo 24 ore con `media.uploads_cleanup`, l'unico lavoro di sistema della tappa.
- Con `STORAGE_DRIVER=s3` i pezzi restano comunque sul disco del web.

### Equità tra agenzie (Scelta 7)
- Un solo `media.process` attivo per l'installazione. Lo garantisce un lock consultivo di Postgres (`pg_try_advisory_lock`, a livello di sessione, su una connessione dedicata per tutta la durata), non solo `localConcurrency: 1`, che vale per un processo solo.
- Il lavoro accodato al completamento porta `organizationId` e `mediaId`, ma serve da sveglia. **Ogni lavoro elabora un solo media**, così la sua durata non cresce con la coda:
  - chi non prende il lock finisce subito senza errore;
  - chi lo prende sceglie il prossimo media in `processing` dall'agenzia servita meno di recente e, dentro l'agenzia, il più vecchio. Lo elabora, libera il lock e, se resta un media in `processing`, accoda una nuova sveglia.
- La scelta attraversa le agenzie, quindi è una lettura di sistema: una sola funzione, che restituisce solo identificativi, entra nella regola ESLint di `runAsSystem`. L'elaborazione di ogni media gira poi in `uow.run({ organizationId })`. **Il piano dice che solo `media.uploads_cleanup` attraversa le agenzie: questa è una seconda eccezione, approvata da Matteo con questa ADR.**
- Il controllo dei media rimasti si fa dopo aver liberato il lock. Così non si perde un file la cui sveglia è arrivata mentre il lock era preso. Se il worker cade a metà, pg-boss fa scadere il lavoro e lo riprova.
- `MEDIA_CONVERSIONS_PER_ORG` (predefinita 1) serve solo se un giorno la concorrenza globale sale.

### Scadenza dei lavori lunghi ed errori che non si riprovano
- `QueueDefinition` ha un'opzione `expireInSeconds`. Per `media.process` è più lunga del tempo massimo di ffmpeg per un media.
- pg-boss la legge alla creazione della coda, e `createQueue` non cambia una coda che esiste già. Per questo `migrate.ts` deve applicare anche alle code esistenti i valori di `QueueDefinition`, con `updateQueue`: così una correzione dopo il primo rilascio ha effetto.
- Allo scadere pg-boss interrompe `job.signal`: ffmpeg e ffprobe si fermano su quel segnale, oltre che sul loro timeout.
- Ogni comando ffmpeg ha un timeout. Il valore di partenza è 2 minuti più 4 volte la durata del video, al massimo 60 minuti: per un reel di 15 minuti fa 60 minuti. Un media ha al più due comandi lunghi, l'anteprima e la correzione, quindi `expireInSeconds` per `media.process` vale 2 ore e 15 minuti. I valori si misurano nel Task 10 e si correggono lì, nel piano.
- Un file rotto, un tipo non ammesso, un blocco di §9.2 o un timeout di ffmpeg **non si riprovano**. Il lavoro non lancia un errore: scrive il media in `failed` o `blocked` con il motivo e finisce. Lanciano un errore, e quindi si riprovano con le regole di `QUEUE_DEFAULTS`, solo i problemi passeggeri: database o storage non raggiungibili, disco pieno.

### Configurazione
- `PUBLIC_HOST` non è una variabile nuova: è l'host di `PUBLIC_URL`. Deve essere diverso da quello di `PANEL_URL`, anche con una porta diversa, perché i cookie non distinguono le porte. Senza `PUBLIC_URL` l'host pubblico è spento e `/m/*` non risponde da nessuna parte. Quale ingresso serve l'host pubblico si decide nel Task 11, dalla porta o dal nodo Tailscale e mai dall'intestazione `Host`.
- Limiti di caricamento, in byte decimali. Il video resta così sotto i 300 MB di Meta. Per le foto il limite di caricamento è più largo di quello di Meta: la variante pubblicabile la ricomprime il worker (§9.2).
  - `MEDIA_MAX_VIDEO_BYTES`: 300.000.000 (§9.2);
  - `MEDIA_MAX_IMAGE_BYTES`: 50.000.000, valore del piano;
  - `MEDIA_MAX_IMAGE_PIXELS`: 50.000.000 (§9.2);
  - `MEDIA_MAX_VIDEO_SECONDS`: 900, il massimo dei reel;
  - `MEDIA_MAX_VIDEO_PIXELS`: 16.777.216, cioè 4096 × 4096 come prodotto di larghezza per altezza. Un 4K verticale (2160 × 3840) ci sta.
- `MEDIA_WORKSPACE_MAX_BYTES` è facoltativa: vuota vuol dire nessun limite oltre `storage_bytes` dell'agenzia.
- `MEDIA_UPLOAD_DIR` vale per default `MEDIA_ROOT/uploads` e non può coincidere con `MEDIA_ROOT`, né stare in `MEDIA_ROOT/org` o `MEDIA_ROOT/users`.
- `STORAGE_DRIVER` vale `disk` (predefinito, e in produzione resta così) o `s3`. Con `s3` servono `S3_BUCKET`, `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY`, anche come `*_FILE`. `S3_ENDPOINT` deve usare http o https.
- Nel compose entrano ora le variabili `MEDIA_*`. `STORAGE_DRIVER` e `S3_*` entrano con l'adattatore nel Task 7, e le chiavi come segreti.
- Le code nuove (`media.process`, `media.delete_files`, `accounts.avatar`, `media.uploads_cleanup`) entrano in `KNOWN_QUEUES` insieme alla loro definizione e al registro del worker, nel task che le introduce. `KNOWN_QUEUES` deve restare uguale a `QUEUE_NAMES`: lo controlla `known-queues.test.ts`.

### Risorse (§16.6)
- Nel compose il worker ha 2 GB e 1,0 CPU, il web 0,5 CPU.
- Il web resta a 1536 MB e si corregge la specifica, che diceva 768 MB. Il motivo viene dalla prova sulla VPS della v0.2.1, non da una misura nuova di questo task: con il web a 512 MiB, una foto profilo HEIC fino a 40 megapixel decodificata nel web faceva uccidere il processo (difetto 1 della prova v0.2.1). Con PR #117 il web è passato a 1536 MiB, con una foto alla volta e senza la cache di libvips. Foto profilo e logo restano elaborati nel web (piano 04, Regole), quindi il margine serve ancora. Il totale passa da circa 4 a circa 5 GB, sempre dentro i 12 GB della VPS.

## Alternative scartate
- **`aws4fetch`**: è molto più leggero, ma il multipart (creazione, pezzi, chiusura, annullamento), la paginazione e la lettura delle risposte XML andrebbero scritti e provati a mano. Sono proprio le parti dove un errore lascia oggetti a metà.
- **Client di MinIO (`minio`)**: è legato a un progetto in sola manutenzione (`docs/stack.md`).
- **tus (`tus-js-client` e un server tus)**: è un protocollo standard con ripresa, ma porta due dipendenze e un server da integrare con permessi, RLS e limiti nostri. I cinque passi del protocollo nostro bastano e si provano con i test d'integrazione.
- **Caricamento diretto sullo storage con indirizzi firmati**: in produzione lo storage è il disco, quindi non c'è un indirizzo da firmare. Con R2 si potrà rivalutare.
- **Pezzi nello `Storage` invece che su disco**: con S3 ogni pezzo sarebbe un oggetto da elencare, unire e pulire, e sarebbe visibile nello spazio delle chiavi. Sul disco del web l'unione è un flusso locale.
- **Limite di conversioni per agenzia con la concorrenza di pg-boss**: `localConcurrency` vale per processo e non sceglie a turno. Un'agenzia con cento video in coda passerebbe comunque prima delle altre.
- **Lasciare il web a 768 MB e spostare la foto profilo nel worker**: richiede di rifare il flusso della foto profilo e del logo in asincrono. È fuori da questa tappa.

## Conseguenze
- Due dipendenze nuove in `packages/infrastructure` (circa 23 MB in `node_modules` insieme, misurati nella cartella di prova). Il worker le impacchetta con esbuild (ADR 014).
- Il web deve ricevere i pezzi a flusso: la rotta dei pezzi esce dal limite di 1 MB e da `defineApiRoute` che tiene il corpo in memoria (Task 9). Il limite di nuxt-security va alzato solo per quella rotta.
- Il volume `media` deve avere spazio libero per almeno un video da 300 MB in arrivo più la sua copia nello `Storage`.
- La lettura di sistema per la scelta a turno allarga di un modulo la regola ESLint di `runAsSystem`.
- Da tenere d'occhio:
  - i timeout di ffmpeg, misurati nel Task 10;
  - la memoria del web con la foto profilo e il logo, nella prova di Matteo (Task 14);
  - checksum e `forcePathStyle` su R2 vera, al passaggio a R2.
- Si riapre se R2 o un altro storage chiede un client diverso, se il caricamento a flusso nel web consuma troppa memoria o se le conversioni una alla volta non bastano.
