# Tappa 7 · Pubblicazione: i post escono su Instagram e Facebook

> **Per chi esegue:** usa superpowers:executing-plans. Le regole di `AGENTS.md` prevalgono: un solo agente per task e un revisore separato per ogni PR. Il formato è leggero (piano generale §1): per ogni task trovi obiettivo, file, firme, test e criteri di fine; il codice si scrive nella PR. **I task sono raggruppati in thread** (vedi «Come si divide il lavoro»): ogni thread finisce con un handoff in `/mnt/project-files/handoff/tappa-7/` e chiede al coordinatore il thread successivo. Come esempi si prendono il modulo `posts` (tabelle, repository, casi d'uso, rotte) e i lavori del modulo `media` (`media.process`, `process-turn.ts`). Se specifica, piano e codice non sono d'accordo, fermati e segnala.

**Obiettivo:** un post programmato esce davvero, all'ora giusta, su ogni account scelto, senza doppioni anche se il worker si riavvia a metà. Chi lavora vede l'esito di ogni destinazione («Pubblicato», con il link, oppure «Non uscito» con il motivo e «Riprova»), può pubblicare subito, e il pannello segnala ciò che non è uscito. Insieme entrano le correzioni rimaste dalla prova della 0.12.0 (D-80) e dal ridisegno (D-98, D-99).

Requisiti: RF-50, RF-51, RF-52; criteri CS1, CS3, CS4.

**Specifica:**
- §8.5 flussi di pubblicazione, §8.6 client Meta (rallentamento sopra l'80%), §8.7 limiti;
- §9.2 il paragrafo sul worker, §9.3 macchina a stati, §9.4 lavori in coda, §9.5 errori e tentativi, §9.6 verifica;
- §10.2 righe «Programmare e pubblicare», «Riprovare pubblicazioni fallite» e «Modificare/annullare post di altri»; §10.4 utente declassato o disattivato con post programmati;
- §11.2 punto 6 («Pubblica ora»), §11.9 modifica e annullamento di un post in preparazione;
- §12.2 eventi (si scrivono nell'outbox; le notifiche li leggono nella tappa 8);
- §13 `post_targets`, `target_attempts`, `outbox_events`;
- §6.5 lavori con `organizationId`, limite di lavori pesanti per organizzazione, organizzazione sospesa;
- brief `design/brief-feedway/03-BRIEF-APP.md`; schermate `11` (Pubblica subito), `13` (esito del post), `02` e `14` (non uscito) in `design/tavole/2026-11-19-nuova-tela/`.

**ADR:** 006 (ogni azione è una rotta), 019 (`PlatformPublisher` implementata da `platforms/meta`; il modulo dei post non sa quale piattaforma c'è dietro un account), 021 (scadenza dei lavori).

**Stato di partenza** (codice di `main` al 2026-11-20, dopo la #272):
- già fatto:
  - `post_targets` ha già le colonne della pubblicazione (`variant`, `step`, `meta_ids`, `external_post_id`, `permalink`, `attempts`, `next_attempt_at`, `last_error_*`, `published_at`, `verified_at`, `verification`), vuote; gli stati sono solo `draft`, `scheduled`, `cancelled` (`domain/src/posts/transitions.ts`, `postStatusOf`);
  - `checkPost` con `purpose: 'publish'` (D-54): la data passata non blocca, quota e reel delle 24 ore si contano attorno all'ora del post, `postId` escluso dallo storico; `postgresPublishingHistory` con l'impronta (piano 06 P3);
  - il client della Graph API (`infrastructure/src/platforms/meta/graph-client.ts`) con `appsecret_proof`, timeout, classificazione degli errori (`errors.ts`, `transient | permanent | uncertain`), lettura di `X-App-Usage` e `X-Business-Use-Case-Usage`, `content_publishing_limit`, modalità `live | mock | dry-run`, registrazione delle risposte vere. Il client fa **solo GET**, ripete da solo gli errori `meta_unavailable` e non riceve un `AbortSignal` da fuori;
  - `tools/meta-mock` con collegamenti, account, `content_publishing_limit` e scenari d'errore, **senza** le chiamate di pubblicazione (oggi risponde «Unsupported» a ogni richiesta che non è GET);
  - le copie pubbliche dei file: `ig_feed` (JPEG) e `reel` (MP4) con `public_token`, servite da `/m/*`; una sola copia per scopo (`media_variants_one_per_purpose`), senza stato proprio, con la chiave `mediaVariantKey(org, media, purpose, ext)`; `cover` e `master` per l'editor;
  - il limite di conversioni contemporanee per organizzazione (`media/process-turn.ts`, che sceglie il turno tra le agenzie con `runAsSystem`), da imitare per i lavori pesanti della pubblicazione;
  - `posts.status` è una colonna salvata, con lo stesso vincolo di `post_targets.status` (`POST_STATUSES`) e l'indice `posts_workspace_status_idx`; il proprietario di un post nei permessi è `created_by` (`ownerId` in `application/src/posts/common.ts`);
  - archiviare un cliente riporta in bozza i suoi programmati (D-70); i permessi `post.publish` e `post.manage_others`;
  - «Pubblica subito» si vede, spento con «Presto» (piano 06 P1); i componenti del ridisegno hanno già le varianti «Pubblicato» e «N non uscito» (piano del ridisegno, «Funzioni che le schermate mostrano e che non esistono»).
- non c'è ancora: la macchina a stati completa, i lavori `target.*` e `scheduler.reconcile`, `PlatformPublisher`, `target_attempts`, `outbox_events`, le copie con ritaglio, copertina dal fotogramma e bande del reel, la pagina dell'esito.

**Dipendenze nuove:** nessuna. ffmpeg e sharp ci sono già; il finto Graph API cresce con le chiamate nuove.

## Aggiornamenti rispetto alla specifica

Da riportare nella specifica nella PR del task che li introduce.

| # | Specifica | Piano | Motivo |
|---|---|---|---|
| P1 | §9.3 `packages/domain/publishing` come modulo a sé | La macchina a stati sta in `domain/src/publishing/` (funzioni pure), ma casi d'uso, repository e lavori restano nel **modulo `posts`** (`application/src/posts/publishing/`) | `post_targets` è una tabella di `posts`: un modulo `publishing` separato dovrebbe leggere e scrivere le tabelle di un altro modulo, o passare da funzioni pubbliche in tutte e due le direzioni |
| P2 | §11.9: modificare o annullare un post aggiorna i lavori; P7 della tappa 6: «Riporta in bozza» finché nessuna destinazione è in `preparing` | Si modifica, si riporta in bozza e si annulla **finché nessuna destinazione è in `publishing`**. In `preparing` o `ready` la modifica riporta le destinazioni a `scheduled` e scarta ciò che è già pronto su Meta: i container di Instagram scadono da soli in 24 ore, le foto e i video di Facebook caricati senza pubblicarli (`published=false`) si cancellano con una chiamata | Chi corregge un errore di battitura 10 minuti prima dell'uscita non deve trovarsi bloccato; un container scartato costa una creazione su 400 al giorno |
| P3 | §9.4: lavori creati «nella stessa transazione» della modifica | I lavori partono **dopo il commit**, con una chiave di unicità `<targetId>:<passo>:<generazione>`, dove `post_targets.generation` cresce a **ogni** mossa della destinazione e a ogni nuova lettura dello stato del container (`wait`), così un secondo `prepare` dopo una modifica, un nuovo controllo del video e i giri di verifica a 10 e 30 minuti hanno ognuno la sua chiave (`dedupeKey` tiene anche i lavori finiti); il riconciliatore ogni minuto ricrea quelli mancanti; ogni gestore rilegge la destinazione con `FOR UPDATE` e non fa nulla se il passo non serve più | `JobQueue.send` non scrive nella transazione dell'applicazione (pg-boss usa la sua connessione); il risultato per chi usa il pannello è lo stesso, con al massimo un minuto di ritardo se il processo cade tra commit e invio |
| P4 | §11.2 punto 3, §9.2: copie da pubblicare; tappa 4: una copia per scopo | Le copie con una ricetta (ritaglio, fotogramma della copertina, bande o ritaglio del reel, storia) sono **varianti del file con una ricetta**: colonna `media_variants.recipe` (testo, impronta della ricetta, `''` per le copie di oggi) e unicità su `(organization_id, media_id, purpose, recipe)`. Le fa il lavoro `media.publish_copies` **alla programmazione**, non 15 minuti prima | Il modulo `media` resta il solo a possedere file, chiavi e token pubblici; fatte alla programmazione, un video che non si converte si vede ore prima, non all'ultimo minuto (D-74) |
| P5 | §9.3 «paused → (Manager)» | Riprendere o annullare un post in pausa chiede `post.manage_others` (Manager in su) | È il permesso che la matrice §10.2 dà già a chi gestisce i post degli altri |
| P6 | §10.2 «Riprovare pubblicazioni fallite: Publisher solo propri»; §9.3 pausa per l'autore | «Propri» sono i post creati dalla persona (`created_by`, come `ownerId` di oggi). La pausa guarda invece chi ha programmato (`scheduled_by`), perché è a suo nome che il post esce: `publishNow` e ogni «Programma» scrivono `scheduled_by`; «Riprendi» lo sostituisce con chi riprende, così un post fermato perché il suo autore è stato declassato non torna subito in pausa | La proprietà resta quella dei permessi della tappa 6; chi pubblica è chi ha dato l'ultimo via |

## Regole della tappa

- **Modulo `posts`** (P1): `domain/src/publishing/` (stati, transizioni, stato del post, calendario dei tentativi e delle verifiche, ritardo massimo), `application/src/posts/publishing/` (casi d'uso del worker e del pannello), `infrastructure/src/db/posts/` (repository della pubblicazione), `contracts/src/api/` (DTO estesi), rotte in `apps/web/server/api/v1/orgs/[org]/workspaces/[id]/posts/[postId]/`. File e account solo con le funzioni pubbliche di `media` e `accounts`; Meta solo con `PlatformPublisher`.
- **`PlatformPublisher`** (`application/src/ports/platform-publisher.ts`): una porta, un'implementazione per piattaforma in `infrastructure/src/platforms/meta/`. Firma essenziale (si fissa nel Task 4, P2 del piano generale §6):
  ```ts
  interface PlatformPublisher {
    prepare(target: PublishTarget, files: PublishFiles, signal: AbortSignal): Promise<StepResult>
    publish(target: PublishTarget, signal: AbortSignal): Promise<StepResult>
    findPublished(target: PublishTarget, since: Date): Promise<FoundPost | null>
    verify(target: PublishTarget): Promise<VerifyResult>
  }
  ```
  `StepResult` porta gli id ricevuti (`metaIds`), `done | wait` (container ancora in elaborazione) e l'uso letto dalle intestazioni; un errore è un `PublishError` con `kind` (`transient | permanent | uncertain`), `code` di Feedway e codice Meta. Gli id si salvano dopo **ogni** chiamata, prima della successiva (§8.5), così si riprende dal punto esatto.
- **Ogni passo in transazione:** il gestore apre `uow.run({ organizationId, userId: null })`, legge la destinazione con `SELECT … FOR UPDATE`, controlla che il passo serva ancora, poi chiude la transazione **prima** di chiamare Meta e ne apre una nuova per salvare l'esito (nessuna chiamata di rete con una riga bloccata). Lo stato `publishing` si scrive **prima** della chiamata che pubblica: un riavvio a metà lascia `publishing`, che il riconciliatore tratta come esito incerto (`unknown`), mai come «da rifare».
- **Doppioni impossibili:** una destinazione con `external_post_id` non si pubblica più; «Riprova» parte dal passo fallito; un esito incerto cerca il post sull'account (§9.5) prima di qualsiasi nuovo tentativo.
- **Lavori:** `target.prepare`, `target.publish`, `target.reconcile`, `target.verify` (ambito `organization`, dati `{ organizationId, targetId }`), `media.publish_copies` (ambito `organization`, `{ organizationId, postId }`), `scheduler.reconcile` (ambito `system`, ogni minuto, `singleton`). Leggono le destinazioni di tutte le agenzie con `runAsSystem` solo tre file, aggiunti a `RUN_AS_SYSTEM_ALLOWED`: `scheduler.reconcile` (`application/src/posts/publishing/reconcile.ts`), la scelta del turno tra le agenzie (`application/src/posts/publishing/turn.ts`, come `process-turn.ts`) e la pulizia delle copie (`application/src/media/publish-copies-cleanup.ts`, Scelta 5); poi ogni lavoro che creano porta il suo `organizationId`.
- **Lavori pesanti per organizzazione:** al massimo 3 destinazioni insieme in `prepare` per organizzazione e 1 per account, con lo stesso schema di `process-turn.ts`; le altre aspettano il turno senza contare come tentativo. `publish` è una chiamata breve (il file è già da Meta) e non entra in questo limite, così **CS1** (5 destinazioni alle 18:00, uscite entro un minuto) regge anche con 5 destinazioni della stessa agenzia: la preparazione parte 15 minuti prima e ha il tempo di finire.
- **Rallentamento (§8.6), per account e per organizzazione:** sopra l'80% di `X-Business-Use-Case-Usage` di un account, i passi di quell'account si spostano di quanto Meta indica (`estimated_time_to_regain_access`), al massimo 5 minuti; sopra l'80% di `X-App-Usage`, che vale per tutta l'app dell'agenzia, si spostano i passi di tutti i suoi account. `publish` si sposta solo sopra il 95%, per non mancare l'ora. L'uso letto si salva sul collegamento (`account_connections.usage`, jsonb, con l'ora della lettura; migrazione del Task 3), mai in memoria.
- **Pausa:** prima di `prepare` e di `publish` il gestore controlla che chi ha programmato (`posts.scheduled_by`) sia attivo e abbia ancora `post.publish` sul cliente, e che l'organizzazione non sia sospesa. Se no, la destinazione va in `paused`. Con l'organizzazione sospesa non si scrive nessun evento verso i suoi canali.
- **Eventi:** ogni esito che la tappa 8 notificherà si scrive in `outbox_events` nella stessa transazione, uno per riga di §12.2: `post.target_confirmed` (una destinazione), `post.confirmed` (tutte), `post.target_failed`, `post.target_problem`, `post.paused`, `post.file_wont_publish` (D-74), `account.quota_low` (quota di Instagram sotto il 10%, una volta per finestra). Il carico porta solo id e codici, mai testi o token.
- **Isolamento:** `target_attempts` e `outbox_events` hanno `organization_id` e RLS (`outbox_events` ammette `null` = piattaforma, leggibile solo da `runAsSystem`); ogni rotta nuova entra in `cross-organization.int.test.ts` e `access-matrix.int.test.ts`; ogni lavoro nuovo in `apps/worker/src/handlers/isolation.int.test.ts`.
- **Meta:** nessun test contro Meta vera; tutto passa da `tools/meta-mock`, che impara le chiamate di §8.5 e gli scenari dei passi. Ciò che non è provato su Meta vera si scrive «non verificato» e va nella guida della prova.
- **Interfaccia:** ogni pagina nuova o toccata segue lo stile del ridisegno (`DESIGN.md`, «Regole del ridisegno per ogni pagina» e «Tela nuova direzione»), con stati vuoto, caricamento, errore e successo, 390 px con la tastiera, axe verde, tema chiaro e scuro. Per ogni cambiamento visibile Matteo vede prima e dopo con il motivo; gli screenshot principali vanno allegati.
- **Commit e PR** con l'ambito `posts`, `media`, `meta` o `web`.
- **Test:** `docs/convenzioni.md` §Test; E2E solo dei file toccati durante il lavoro, `pnpm verify:ci` una volta prima del push.

## Scelte di questa tappa

Ognuna ha la sua voce in `docs/decisioni-aperte.md`. La 1 aspetta Matteo; le altre sono provvisorie, e Matteo può cambiarle prima del task che le usa.

1. **D-77, programmati rimasti indietro** (da decidere da Matteo, consiglio **(c)**): (a) la migrazione della 0.13.0 riporta in bozza i programmati con l'ora passata, con `post.unscheduled` di origine `system`; (b) il worker non **inizia** una pubblicazione più di 15 minuti dopo l'ora del post: la destinazione va in `failed` con il codice `too_late` («Non uscito: l'ora era passata da più di 15 minuti») e «Riprova», che pubblica **subito** (la soglia si conta dall'ora del «Riprova», non da quella del post, che resta per la storia). I tentativi di una pubblicazione già iniziata (1, 5, 15 minuti) non contano. (c) tutte e due: (a) pulisce le prove della 0.12, (b) evita che un worker fermo per ore pubblichi in ritardo un'offerta del pranzo.
2. **Pubblica subito** (§11.2 punto 6, schermata `11`): il segmento si accende; «Pubblica su N account» apre «Pubblicare adesso?» con le destinazioni e il tipo, e la frase «Dopo non si può annullare: il post si può solo togliere dal profilo». Il caso d'uso `publishNow` controlla con `purpose: 'save'` senza `scheduled_in_past`, scrive `scheduledAt = now` e manda `target.prepare` subito. Richiede `post.publish`.
3. **Stato del post dalle destinazioni** (§9.3), in quest'ordine, senza contare le destinazioni annullate: una in `paused` → «In pausa»; una in `preparing`, `ready`, `publishing`, `retrying` o `unknown` → «In pubblicazione»; una in `failed` → «N non uscito» se altre sono uscite o ancora in programma, «Non uscito» se nessuna; una in `problem` → «Con problema» (il post esiste ma Meta non lo conferma); tutte in `published`, `verifying` o `confirmed` → «Pubblicato»; poi le regole di oggi (`scheduled`, `cancelled`, `draft`). Un fallimento non si nasconde mai dietro «Programmato». «In verifica» non è uno stato del post negli elenchi: si legge solo nella pagina dell'esito, sulla riga della destinazione.
4. **Copie alla programmazione** (P4): «Programma», «Salva modifiche» e «Pubblica subito» mandano `media.publish_copies`; una copia che non si fa è un blocco al momento della preparazione e un evento `post.file_wont_publish`. Il worker ricontrolla il post 3 ore prima dell'uscita (e subito, se mancano meno di 3 ore) con `checkPost` `purpose: 'publish'`: se ci sono blocchi scrive l'evento, così la tappa 8 avvisa in tempo (D-74).
5. **File dopo la pubblicazione** (D-18, la parte rimasta): i file originali restano nella libreria del cliente con l'etichetta «Pubblicato il …», finché qualcuno non li elimina; le **copie da pubblicare** (quelle con una ricetta) si tolgono 7 giorni (`MEDIA_RETENTION_DAYS`) dopo che il post è concluso: ogni destinazione `confirmed` o `cancelled`, oppure `failed` o `problem` da 7 giorni senza un «Riprova»; così «Riprova» le trova ancora. Una copia di una ricetta vecchia (il post è stato modificato) che nessun post programmato usa più si toglie con la stessa pulizia, il lavoro di sistema giornaliero `media.publish_copies_cleanup` (Task 7). «Salva in libreria» non serve più: i file del post sono già nella libreria.
6. **Pagina dell'esito** (schermata `13`): un post uscito o in pubblicazione si apre in sola lettura: file, testo, etichette, tipo e autore a sinistra; a destra «Esito», una riga per destinazione con pallino, stato, «Apri su Instagram/Facebook» (permalink) o il motivo tradotto, e «Riprova» o «Segna come verificato»; sotto «Attività», dal registro e dai tentativi. **«Modifica per Facebook» della schermata non si fa in questa tappa**: cambiare file o testo di una sola destinazione già fallita è un lavoro a sé (voce nuova in decisioni aperte); il motivo dice cosa cambiare, e da «Duplica» (tappa 9) si rifà il post. Finché c'è una destinazione in corso, la pagina si aggiorna da sola ogni 10 secondi (le notifiche arrivano con la tappa 8).
7. **Esito incerto** (§9.5): la ricerca legge gli ultimi 25 post dell'account e prende quello con il testo della destinazione (confronto dopo `publishedCaption`, spazi normalizzati) pubblicato tra l'inizio del passo e 10 minuti dopo; per una storia, che non ha testo, l'ultimo media di tipo storia nello stesso intervallo. Tre ricerche a 2, 5 e 15 minuti; senza risultato la destinazione va in `failed` con `uncertain_not_found` e «Riprova» avverte «Controlla il profilo prima: Meta potrebbe averlo pubblicato».
8. **Da sistemare** (Oggi, pallino del selettore, colonna «Collegamento» dei clienti): un post «Non uscito», «Con problema» o «In pausa» entra tra le cose da sistemare con il colore rosso (non uscito) o ambra (in pausa), come nelle schermate `02`, `04` e `14`.

## Come si divide il lavoro

Dieci task, ognuno una PR (o due dove il task lo dice), in sette thread più la revisione di fine tappa.

| Thread | Task | Dipende da | Perché insieme |
|---|---|---|---|
| A · Correzioni ereditate | Piano (questo file) e Task 1 · Correzioni rimaste dalla prova della 0.12.0 e dal ridisegno | — | Lavoro sul pannello già fatto, indipendente dalla pubblicazione |
| B · Dominio e dati | Task 2 · Macchina a stati e regole della pubblicazione; Task 3 · Tabelle, repository e outbox | D-77 decisa | Niente interfaccia; il Task 3 usa le transizioni del Task 2 |
| C · Meta | Task 4 · `PlatformPublisher` e Instagram nel finto Graph API; Task 5 · Facebook, e il nome del Business (B11 b) | B | Stesso client, stesso finto Graph API |
| D · Copie | Task 6 · Copie da pubblicare: ritaglio, fotogramma, bande, storia | B | Solo `media`, con ffmpeg e sharp |
| E · Worker | Task 7 · Preparazione, pubblicazione e riconciliatore; Task 8 · Esito incerto, verifica, «Riprova» e pausa | C, D | Gli stessi gestori e la stessa prova del riavvio |
| F · Pannello | Task 9 · «Pubblica subito», pagina dell'esito, stati nelle liste e «Da sistemare» | E | Tutta l'interfaccia della tappa, con gli stessi E2E |
| — | Revisione di fine tappa (thread separato, istruzioni del progetto) | A–F | |
| G · Rilascio | Task 10 · Correzioni della revisione, rilascio 0.13.0 e guida della prova con la prima pubblicazione vera | revisione | |

- **A, B e (dopo B) C e D possono andare in parallelo**: C e D toccano moduli diversi. E aspetta C e D fusi; F aspetta E.
- **Dentro un thread** i task vanno in ordine, una PR alla volta: si fonde la prima, poi si parte dalla `main` aggiornata. `pnpm verify:ci` una volta prima di ogni push.
- **Se il contesto non basta**, il thread fa il suo primo task, scrive l'handoff e chiede al coordinatore un thread nuovo per il secondo.
- **A fine thread** l'handoff in `/mnt/project-files/handoff/tappa-7/HANDOFF-thread-<lettera>.md` (fatto, PR, scelte prese, cosa resta, non verificato, cosa serve al thread dopo), poi la richiesta al coordinatore del thread successivo.
- **Rilascio:** la tappa esce come **0.13.0** (D-83). Il rilascio 0.12.1 del ridisegno è di un altro thread: nessun task di questa tappa tocca versioni, changelog o PR di release-please prima del Task 10.

## Review Focus

Oltre al piano generale §8:
1. **Riavvii a metà:** il worker ucciso dopo la creazione del container, dopo `media_publish` ma prima di salvare l'id, durante l'attesa del video: nessun post doppio, nessun post perso; la destinazione riprende dal passo giusto o va in `unknown` (Task 7 e 8).
2. **Il passo che serve ancora:** un post modificato, riportato in bozza o annullato mentre il lavoro è in coda; un lavoro arrivato due volte; un lavoro del passo vecchio dopo un «Riprova»: il gestore non fa niente (Task 7).
3. **Ora legale e ritardo:** un post alle 02:30 del 28/03/2027, un worker fermo da 20 minuti (D-77), la verifica che attraversa il cambio d'ora (Task 2 e 7).
4. **Permessi che cambiano:** chi ha programmato declassato a Editor, disattivato o tolto dal cliente; l'agenzia sospesa: `paused`, mai una pubblicazione a nome di chi non può più (Task 8).
5. **Isolamento:** un `targetId` di un'altra agenzia nei dati di un lavoro, una rotta «Riprova» con l'id di un altro cliente, l'outbox letto da un'agenzia: «non trovato» o vuoto (Task 3, 7, 9).
6. **Segreti:** il token della Pagina ricavato a ogni pubblicazione non finisce in log, tentativi, outbox o registrazioni (Task 4, 5, 7).

---

## Task 1 · Correzioni rimaste dalla prova della 0.12.0 e dal ridisegno

**Obiettivo:** chiudere i difetti della prova della 0.12.0 che Matteo ha mandato alla tappa 7 (D-80) e i resti del ridisegno, prima che la pubblicazione cambi l'editor.

**Cosa fa:**
- **D-80.1, file in preparazione:** finché un file è `uploading` o `processing`, le regole del post che dipendono da lui (numero di file del carosello, file misti, file che non escono su un account) non lo contano come scartato: il riepilogo dice «In attesa del file N» e il solo blocco è `media_processing` di quel file. Regola in `domain/src/rules/` con il suo test e la riga nella tabella dei casi (`pnpm rules:table`).
- **D-80.2, gruppo di account:** scegliere un gruppo **sostituisce** la scelta dei profili con i suoi account (oggi li aggiunge). Prima e dopo a Matteo con il motivo, poi si procede.
- **D-80.3, firma:** inserita a metà testo va a capo prima e dopo.
- **D-80.5, cliente archiviato:** la barra dice «Il cliente è archiviato: non si programmano post», non «Controlli non riusciti».
- **D-80.6:** già fatto nel ridisegno (B12, il titolo della scheda è «Modifica il post»): si verifica e si chiude.
- **D-98, resti:** il peso del file in «Sostituisci» (il DTO del file porta `sizeBytes`); lo stato di errore di «Profili» del cliente come nella tavola degli stati.
- **D-99, pagine fuori dal pannello con la barra vecchia** (`/`, `/conferma-email`, `/sicurezza/non-sono-stato-io`, `/piattaforma/email`): passano al guscio delle pagine prima del pannello, come Accedi e `/agenzie` (regola «ogni pagina segue il ridisegno»).

- **Resti del rilascio 0.12.1** (D-83: la 0.12.1 è uscita senza revisione di fine tappa, e le correzioni rimaste vengono qui): in `DESIGN.md` la tabella dei token senza `paper` e `groove` (tolti in R9) e con le regole di R10 che mancano (etichette, un solo arancio per pagina, soglie delle colonne); i punti 4 e 6 di «Cosa resta» dell'handoff di R10 già chiusi da D-99 si verificano e si segnano.

**Test:** unit delle regole (file in preparazione in un carosello, in un post misto, su Facebook); componente o E2E del gruppo che sostituisce, della firma a metà testo e del cliente archiviato; E2E delle pagine portate nel guscio (390 e 1440, chiaro e scuro, axe).

**Fine:** `pnpm verify` verde; D-80 tolta (resta solo la nota per le guide), D-98 e D-99 aggiornate; Matteo ha visto prima e dopo.

## Task 2 · Macchina a stati e regole della pubblicazione

**Obiettivo:** tutte le regole di §9.3, §9.5 e §9.6 come funzioni pure, provate prima del codice.

**File:** `packages/domain/src/publishing/` (`target-status.ts`, `transitions.ts`, `post-status.ts`, `schedule.ts`, `errors.ts`, `index.ts`); `domain/src/posts/transitions.ts` resta per le mosse del pannello e usa le nuove.

**Firme:**
- `TargetStatus = 'draft' | 'scheduled' | 'preparing' | 'ready' | 'publishing' | 'retrying' | 'unknown' | 'published' | 'verifying' | 'confirmed' | 'problem' | 'failed' | 'paused' | 'cancelled'`;
- `canMoveTarget(from, to, by: 'panel' | 'worker'): boolean`;
- `postStatusOf(targets)` esteso (Scelta 3) e `PostStatus` del post con `publishing | partial | failed | problem | published | paused` (oltre a `draft`, `scheduled`, `cancelled`);
- `nextAttemptAt(failedAt, attempt): Date | null` (1, 5, 15 minuti, poi `null` = `failed`); `verifyAt(publishedAt, round)` (3, 10, 30 minuti); `prepareAt(scheduledAt, now)` (15 minuti prima, subito se ne mancano meno); `isTooLate(scheduledAt, now)` (D-77 b, 15 minuti, solo per il primo avvio); `recheckAt(scheduledAt, now)` (3 ore prima, Scelta 4);
- `publishErrorMessage(code)`: i messaggi di §9.5 come chiavi di traduzione (`publishing.errors.*`), con i codici Meta della tabella e `too_late`, `uncertain_not_found`, `file_wont_publish`, `author_lost_permission`, `organization_suspended`.

**Test (unit):** ogni transizione ammessa e una rifiutata per ogni stato; il pannello non porta mai una destinazione oltre `scheduled` e non tocca `publishing`; `postStatusOf` per ogni combinazione della Scelta 3; tentativi e verifiche con le ore esatte, anche attraverso il cambio d'ora (2026-10-25 e 2027-03-28); `isTooLate` al minuto 15 e 16; `prepareAt` con 20, 15, 3 minuti e con l'ora passata.

**Fine:** specifica §9.3 aggiornata con P1 e con gli stati del pannello; `pnpm verify` verde.

## Task 3 · Tabelle, repository e outbox

**Obiettivo:** i dati della pubblicazione con l'isolamento, e le letture che servono al worker con un indice.

**Migrazione `0019_publishing.sql`:**
- `post_targets.status` ammette gli stati del Task 2 (vincolo); `posts.status` ammette gli stati del post del Task 2, e ogni mossa di una destinazione ricalcola e salva lo stato del post nella stessa transazione (`postStatusOf`); `post_targets.generation` (intero, 0) per le chiavi dei lavori (P3); indice `(status, next_attempt_at)` per il riconciliatore e `(organization_id, account_id, published_at)` per la ricerca dell'esito incerto e i reel delle 24 ore;
- `target_attempts` (§13: `id, organization_id, workspace_id, target_id, step, outcome, meta_error_code, duration_ms, created_at`), chiave esterna composta verso `post_targets`, RLS;
- `outbox_events` (§13: `id, organization_id` facoltativo, `type, payload, created_at, dispatched_at`), RLS con la riga di piattaforma visibile solo al sistema, indice `(dispatched_at) WHERE dispatched_at IS NULL`;
- `media_variants.recipe` (testo, `''` predefinito) e unicità `(organization_id, media_id, purpose, recipe)` al posto di `media_variants_one_per_purpose` (P4); `media_variants.status` (`ready` predefinito per le copie di oggi, poi `pending | ready | failed`) e `failure` (codice); `mediaVariantKey` riceve la ricetta, così due ricette dello stesso scopo non scrivono sulla stessa chiave;
- `account_connections.usage` (jsonb, facoltativo: l'ultimo uso letto da Meta e la sua ora, Regole «Rallentamento»);
- **D-77 (a)**, se Matteo la sceglie: i programmati con l'ora passata tornano in bozza, con una riga d'audit `post.unscheduled` di origine `system`.

**Firme:** (nessuna tabella in più oltre a queste) `PublishingRepository` in `application/src/ports/posts.ts` (o un file suo): `lockTarget(tx, targetId)`, `saveStep(tx, targetId, patch)`, `recordAttempt(tx, attempt)`, `dueTargets(tx, now, limit)` (solo il riconciliatore, con `runAsSystem`), `targetsOfPost(tx, postId)`, `publishedNear(tx, accountId, from, to)`; porta `Outbox` con `record(tx, event)`.

**Test:** integrazione del repository (blocco con `FOR UPDATE` e due transazioni, `dueTargets` con l'indice, un tentativo salvato senza dati sensibili); RLS e `cross-organization` per le due tabelle nuove; la migrazione D-77 (a) su un database con programmati passati, futuri e bozze; le copie di oggi (`recipe = ''`, `status = 'ready'`) restano trovate dal token pubblico; `posts.status` segue le destinazioni in ogni mossa.

**Fine:** `pnpm verify` verde; specifica §13 aggiornata (`recipe`, indici).

## Task 4 · `PlatformPublisher` e Instagram

**Obiettivo:** pubblicare su Instagram tutti i tipi di §8.5 contro il finto Graph API, con gli id salvati passo per passo.

**File:** `application/src/ports/platform-publisher.ts`; `infrastructure/src/platforms/meta/publisher.ts` e `instagram-publish.ts`; `tools/meta-mock` (`src/publishing.ts`, scenari nuovi, README); `docs/platforms/meta.md` §Pubblicazione.

**Cosa fa:**
- il client impara le richieste POST con corpo (oggi fa solo GET), senza ripetizione automatica sulle chiamate che pubblicano (`media_publish`, e in Facebook `photos`, `feed`, la fine di `video_reels`): un timeout lì è un esito incerto, mai un secondo tentativo nascosto; ogni richiesta riceve l'`AbortSignal` del lavoro;
- foto, carosello (elementi `is_carousel_item`, attesa dei video `FINISHED`, contenitore `CAROUSEL`), reel (`REELS`, `cover_url` o `thumb_offset`, `share_to_feed`), storia; `status_code` letto al massimo una volta al minuto (§8.7): `prepare` risponde `wait` e il worker ripianifica;
- container scaduto (oltre 24 ore o `EXPIRED`): si ricrea da capo;
- quota da `content_publishing_limit` prima di `media_publish`: senza quota la destinazione va in `retrying` con l'ora in cui la finestra si libera;
- `findPublished` e `verify` (§9.6) per Instagram;
- errori di pubblicazione nella classificazione (`9007`, `9004`, `2207026`, `2207020` container scaduto, `24` e i codici della tabella di §9.5) e in `docs/platforms/meta.md`.

**Finto Graph API:** `POST /{ig}/media`, `GET /{container}?fields=status_code`, `POST /{ig}/media_publish`, `GET /{ig}/media`, `GET /{media-id}` (`content_publishing_limit` c'è già, e impara la quota che scende a ogni pubblicazione); il mock scarica davvero i file da `image_url`/`video_url` (prova che l'host pubblico risponde); scenari `container_in_progress` (N letture), `container_error`, `container_expired`, `publish_timeout_but_created` (l'esito incerto), `quota_exhausted`, `media_download_failed`.

**Test:** integrazione contro il mock per ogni tipo e ogni scenario; nessun token in `calls()` registrate né nei log (oscuramento); `appsecret_proof` su ogni chiamata.

**Fine:** `pnpm verify` verde; tutto ciò che è scritto a mano nel mock è segnato «non verificato» nel README.

## Task 5 · Facebook, e il nome del Business

**Obiettivo:** pubblicare su una Pagina tutti i tipi di §8.5, con il token della Pagina ricavato a ogni pubblicazione.

**Cosa fa:**
- token della Pagina da `GET /{page}?fields=access_token` con il token del collegamento, mai salvato, mai nei log;
- foto (`/{page}/photos`), multi-foto (`published=false` poi `/{page}/feed` con `attached_media`), reel (`/{page}/video_reels` a fasi con `file_url`), video (`/{page}/videos`), storia foto (`/{page}/photo_stories`) e video (`/{page}/video_stories` a sessione);
- reel di Facebook: 30 ogni 24 ore contati dal nostro database (già nei controlli), copertina **non verificata** (§11.2): si manda solo se la documentazione lo consente, altrimenti l'avviso `cover_on_facebook` resta;
- `findPublished` e `verify` per Facebook (§9.6);
- **B11 (b)** della revisione di fedeltà del ridisegno (`handoff/ridisegno/REVISIONE-fedelta.md` nella cartella condivisa, tabella B: la (a) è stata fatta nel ridisegno, la (b) rimandata alla tappa 7 perché è un dato nuovo da Meta): al collegamento con l'utente di sistema si salva il nome del Business (`account_connections.business_name`, facoltativo, migrazione `0020_connection_business_name.sql` nella stessa PR) e la pagina Meta lo mostra al posto di «Utente di sistema Meta»; non verificato su Meta vera finché la prova non lo legge. È qui e non nel Task 1 perché usa la stessa lettura del Business che serve al token della Pagina.

**Finto Graph API:** le chiamate qui sopra, `GET /{page}/published_posts` e `GET /{video-id}?fields=status`; scenari `duplicate_post` (506), `video_processing` (N letture), `video_error`, `page_token_missing`; `DELETE /{object}` per le foto e i video caricati senza pubblicarli, scartati da una modifica (P2).

**Test:** integrazione contro il mock per ogni tipo; il token della Pagina non compare in nessuna registrazione; un collegamento senza nome del Business mostra la riga come oggi.

**Fine:** `pnpm verify` verde; `docs/platforms/meta.md` con i passi di Facebook e ciò che resta da provare.

## Task 6 · Copie da pubblicare

**Obiettivo:** ogni destinazione ha i file che Meta scaricherà, già pronti e pubblici, con le scelte del post applicate.

**File:** `application/src/media/publish-copies.ts` (funzione pubblica `requestPublishCopies(tx, postFiles)` e `publishCopiesOf(tx, postId)`), `apps/worker/src/handlers/media-publish-copies.ts`, `infrastructure/src/media/` (ricette ffmpeg e sharp).

**Ricette** (ognuna con la sua impronta in `recipe`):
- foto con ritaglio (D-61): il riquadro in frazioni applicato al `master`, poi le regole «prima Instagram» di D-51 (JPEG sRGB, al massimo 1440 px di larghezza);
- copia per Facebook solo se la copia di Instagram supera i limiti di Facebook (D-51);
- copertina del reel dal fotogramma (`cover_offset_ms`, P6 della tappa 6) o dall'immagine caricata con il suo ritaglio: JPEG 9:16 sotto 8 MB;
- reel non 9:16: `keep` usa la copia `reel`, `pad` aggiunge le bande, `crop_center` ritaglia al centro (D-61, D-99);
- storia: foto e video nella misura della storia.

Il lavoro rispetta il limite di conversioni per organizzazione di `process-turn.ts`; una ricetta già fatta non si rifà; un fallimento lascia la copia `failed` con il motivo, e il controllo `purpose: 'publish'` lo vede come blocco.

**Test:** integrazione con i file di prova (`test-media.ts`): misure, profilo colore e peso di ogni ricetta; il ritaglio di una foto in un carosello riordinato resta sulla sua foto; il fotogramma all'ultimo fotogramma vero; due richieste della stessa ricetta fanno una copia sola; il token pubblico della copia risponde da `/m/*`.

**Fine:** `pnpm verify` verde; D-61 e D-60 aggiornate (le copie ora applicano le scelte).

## Task 7 · Preparazione, pubblicazione e riconciliatore

**Obiettivo:** i lavori che portano un post programmato fino a `published`, senza doppioni.

**Cosa fa:**
- `schedulePost`, `saveScheduled`, `unschedulePost`, `cancelPost`, l'archiviazione (D-70) e `publishNow` mandano o tolgono i lavori dopo il commit (P3) e `media.publish_copies` (Scelta 4); la modifica in `preparing`/`ready` riporta le destinazioni a `scheduled` (P2);
- `target.prepare`: controllo `purpose: 'publish'`, pausa (Regole), copie pronte, poi `PlatformPublisher.prepare`; `wait` ripianifica tra un minuto;
- `target.publish` all'ora: `isTooLate` (D-77 b), stato `publishing` scritto prima della chiamata, poi `published` con `external_post_id` e il primo `target.verify`;
- errori: temporaneo → `retrying` con `nextAttemptAt`; definitivo → `failed` con il codice; incerto → `unknown` e `target.reconcile` (Task 8);
- `scheduler.reconcile` ogni minuto: ricrea i lavori mancanti per `scheduled` vicine, `preparing`/`ready` ferme, `retrying` scadute, `publishing` rimaste dopo un riavvio (→ `unknown`), `verifying` senza lavoro; e il ricontrollo delle 3 ore (Scelta 4);
- limite dei lavori pesanti e rallentamento (Regole); un tentativo per passo in `target_attempts`; eventi nell'outbox;
- `media.publish_copies_cleanup`, lavoro di sistema ogni notte (Scelta 5): toglie le copie dei post conclusi da 7 giorni e quelle delle ricette che nessun post programmato usa più.

**Test:** integrazione con il mock: ogni tipo arriva a `published`; **il riavvio a metà** (gestore interrotto dopo ogni passo, poi il riconciliatore) non crea doppioni, contando le `media_publish` del mock; un post modificato, riportato in bozza o annullato con il lavoro in coda; due lavori uguali; post alle 02:30 del cambio d'ora; worker fermo 20 minuti (D-77); 4 destinazioni della stessa agenzia e una di un'altra (limite e equità); **CS1**: 5 destinazioni della stessa agenzia programmate alle 18:00 escono tutte entro le 18:01, anche con l'uso di Meta all'85%; il rallentamento per account e per organizzazione; la pulizia delle copie (post concluso, ricetta vecchia, copia ancora usata da un «Riprova» possibile); isolamento dei lavori nuovi.

**Fine:** `pnpm verify` verde; `known-queues` aggiornato; specifica §9.4 con P3, §11.8 e §11.9 con la Scelta 5 (i file del post restano in libreria, si tolgono le copie).

## Task 8 · Esito incerto, verifica, «Riprova» e pausa

**Obiettivo:** ogni destinazione finisce in uno stato chiaro, e chi lavora sa cosa fare.

**Cosa fa:**
- `target.reconcile` (Scelta 7): cerca il post, poi `published` o `failed` con `uncertain_not_found`;
- `target.verify` a 3, 10 e 30 minuti (§9.6): `confirmed` con il permalink, oppure `problem`;
- «Riprova» senza doppioni: da `failed` riparte dal passo fallito, e da `too_late` pubblica subito (Scelta 1); da `problem`, dove il post ha già un `external_post_id`, prima rilegge Meta (`verify`, poi `findPublished`) e ripubblica solo se Meta dice che il post non c'è o è in errore; se il post c'è, la destinazione va in `confirmed`;
- annullare una sola destinazione (§11.9, «poi si annullano solo le destinazioni non ancora pubblicate»): `cancelTarget` per una destinazione in `scheduled`, `preparing`, `ready`, `retrying`, `paused` o `failed`, con lo stesso permesso dell'annullamento del post;
- casi d'uso e rotte del pannello: `retryTarget` e `markVerified` (da `problem`), con la riga «Riprovare pubblicazioni fallite» di §10.2: Manager in su per ogni post, il Publisher solo per i propri post (P6: `post.publish` con il proprietario `created_by`, `post.manage_others` per gli altri), `cancelTarget`, `resumePaused` e `cancelPaused` (P5, `post.manage_others`; «Riprendi» scrive chi riprende in `scheduled_by` e chiede una nuova ora se quella vecchia è passata); ogni azione con la sua voce d'audit (`post.retried`, `post.verified_manually`, `post.resumed`, `post.target_cancelled`) e la frase nel registro;
- pausa: utente declassato, disattivato o tolto dal cliente; organizzazione sospesa (nessun evento); la sospensione tolta non riprende da sola: serve un Manager.

**Test:** integrazione: incerto trovato e non trovato; verifica che passa, che resta in elaborazione fino a 30 minuti e che non trova il post; «Riprova» dopo ogni tipo di errore senza doppioni, compreso `problem` con il post che su Meta c'è e `too_late`; una destinazione annullata mentre l'altra è già uscita; pausa per ogni causa di §10.4 e ripresa; `access-matrix` delle rotte nuove (Viewer ed Editor 403, altro cliente 404).

**Fine:** `pnpm verify` verde; specifica §9.5 e §9.6 con le scelte; le voci d'audit nuove in `AUDIT_DATA_KEYS` e `it.json`.

## Task 9 · «Pubblica subito», pagina dell'esito e stati nel pannello

**Obiettivo:** chi lavora vede cosa è uscito e cosa no, dove già guarda.

**Cosa fa (stile del ridisegno, schermate `02`, `04`, `11`, `13`, `14`, `16`, `17`):**
- editor: «Pubblica subito» acceso con la conferma (Scelta 2); un post in pubblicazione o uscito non si apre nell'editor ma nella pagina dell'esito;
- pagina dell'esito (Scelta 6) con «Riprova», «Segna come verificato», «Riprendi» e «Annulla» per la pausa, l'aggiornamento ogni 10 secondi e l'attività;
- stati con i colori di `DESIGN.md` in «Post» del cliente (filtro «Pubblicati» al posto di «Annullati» quando ce ne sono, D-89.18), «In uscita» e «Da sistemare» di Oggi (Scelta 8), «Prossimo post» e colonna «Collegamento» dei clienti, pallino rosso del selettore (D-87.3);
- la libreria dice «Pubblicato il …» (Scelta 5).

**Test:** E2E con il mock: pubblica subito una foto e vedi «Pubblicato» con il link; un Facebook che fallisce mostra «1 non uscito», il motivo e «Riprova», poi «Pubblicato»; un post in pausa per un Manager e per un Publisher; il telefono (390) con la pagina dell'esito; axe, chiaro e scuro. Screenshot prima e dopo per Matteo.

**Fine:** `pnpm verify` verde; D-84 aggiornata (esiti, «Riprova», pagina del post e «Pubblica subito» fatti); D-89.18 e D-87.3 aggiornate.

## Task 10 · Correzioni della revisione, rilascio 0.13.0 e guida della prova

**Obiettivo:** la 0.13.0 installata sulla VPS e provata da Matteo, con la prima pubblicazione vera fatta insieme.

**Cosa fa:**
- le correzioni scelte da Matteo sulla revisione di fine tappa;
- la PR di rilascio 0.13.0 (release-please, `Release-As` se serve) e le note «Cosa provare»;
- la guida della prova in `/mnt/project-files/handoff/tappa-7/GUIDA-prova-0.13.0.md`, completa per la VPS (prerequisiti, Funnel attivo perché Meta scarichi i file, `update.sh v0.13.0`, controlli di salute e dei log) e per ogni passo: il riavvio del worker a metà con il finto Graph API, poi la prima pubblicazione vera su ogni tipo e su tutti e due i social con gli account di prova, la data di domani dove serve (D-80, nota per le guide);
- le verifiche su Meta vera rimaste aperte, come passi della guida: D-10 (lo scaricatore di Meta e `robots.txt`; se non scarica, la correzione è far passare `facebookexternalhit` su `/m/`), D-08, D-40, D-46, D-47, D-48, D-55, D-59, D-62, D-75 (b), la copertina del reel su Facebook, il nome del Business (B11 b), un reel 16:9 «così com'è» (D-99);
- le prove rimaste della 0.12.0 (D-82);
- le risposte vere registrate (`META_RECORD_DIR`) diventano le risposte del finto Graph API.

**Fine:** criteri del piano generale §7; il piano della tappa 8 scritto sul codice reale.

## Fuori da questa tappa

- Notifiche, email, Telegram e centro notifiche: tappa 8, che legge l'outbox scritto qui (compresa l'email di D-74).
- Calendario, «Duplica», fuso dell'agenzia per tutti (D-78) e l'elenco dei post per data (D-79): tappa 9.
- «Modifica per Facebook» su una destinazione fallita (Scelta 6): voce in decisioni aperte.
- Pulizia notturna generale dei media e backup: tappa 11. Questa tappa toglie solo le copie da pubblicare (Scelta 5).
