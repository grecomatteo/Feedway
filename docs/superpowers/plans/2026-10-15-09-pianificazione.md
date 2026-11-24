# Tappa 9 · Pianificazione: il mese di ogni cliente in un colpo d'occhio, e il piano prima dei post

> **Per chi esegue:** usa superpowers:executing-plans. Le regole di `AGENTS.md` prevalgono: un solo agente per task e un revisore separato per ogni PR. Il formato è leggero (piano generale §1): per ogni task trovi obiettivo, file, firme, test e criteri di fine; il codice si scrive nella PR. **I task sono raggruppati in thread** (vedi «Come si divide il lavoro»): ogni thread finisce con un handoff in `/mnt/project-files/handoff/tappa-9/` e chiede al coordinatore il thread successivo. Come esempi si prendono il modulo `posts` (tabelle, repository, casi d'uso, rotte), le letture di «Oggi» (`application/src/posts/agenda.ts`, già per intervallo di date fino a 42 giorni) e il modulo `notifications` della tappa 8 (tipi di notifica e sezioni del riepilogo registrati dal modulo). Se specifica, piano e codice non sono d'accordo, fermati e segnala.

**Obiettivo:** chi lavora vede il mese di tutti i clienti, o di uno, in un calendario che si legge da lontano, sposta un post trascinandolo e prepara un mese intero in pochi minuti: con le fasce orarie, in blocco da file o da un foglio, duplicando. Prima dei post c'è il **piano editoriale**: chi decide il mese lo scrive in Feedway, e chi carica vede nel calendario cosa preparare e per quando. Insieme entrano:
- l'elenco dei post rifatto (richiesta di design 2 di Matteo, D-120), che diventa la vista «Elenco» del calendario;
- l'ordine dell'elenco per l'ora del post (D-79) e il fuso dell'agenzia leggibile da tutti (D-78);
- la griglia di Instagram riordinabile.

Requisiti: RF-40, RF-41, RF-42, RF-43, RF-46.

**Specifica:**
- §11.4 calendario, §11.5 griglia Instagram, §11.6 programmazione in blocco e fasce orarie, §11.12 piano editoriale;
- §7.3 moduli che registrano voci del calendario, permessi, tipi di notifica e sezioni del riepilogo; moduli attivabili per organizzazione;
- §9.2 ora inesistente o doppia; §9.4 lavori `bulk.import` e `plan.due_soon`;
- §10.2 permessi (`plan.view`, `plan.edit`, `plan.prepare`; fasce con «Gestire etichette, modelli, fasce orarie, gruppi di account»);
- §12.2 «Programmazione in blocco completata» e «Contenuto pianificato da preparare entro domani»; §12.4 la sezione del piano nel riepilogo;
- §13 `time_slots`, `bulk_imports`, `plan_items`;
- §14.6 contesto (tutti i clienti, un cliente, un profilo);
- brief `design/brief-feedway/03-BRIEF-APP.md`; la schermata `07-calendario` della tela nuova (`design/tavole/2026-11-19-nuova-tela/`); `design/proposta-piano-editoriale.md` (dove differisce, fa fede la specifica).

**ADR:** 006 (ogni azione è una rotta), 019 (modulo piattaforma, per la griglia di Instagram). Nessuna ADR nuova prevista: se un task trova che serve una libreria (trascinamento, fogli Excel, CSV), si ferma e la scrive (P6).

**Stato di partenza** (codice di `main` al 2026-11-24, con la tappa 8 quasi chiusa):
- già fatto:
  - **Post:** tabelle `posts` (con `scheduled_at`, `timezone` copiato dall'agenzia, `type`, `status`, `version`), `post_targets`, `post_media`, `post_labels`, `post_notes`, `labels`, `caption_templates`, `account_groups`; `workspaces.default_post_time`. Funzioni pubbliche di `application/src/posts/index.ts`: `createDraft(tx, actor, input)` (dentro la transazione del chiamante), `getStatuses(tx, organizationId, postIds)`, `schedulePost(deps, actor, input, request)` (apre la sua transazione, manda i lavori dopo il commit e lancia un errore se un controllo blocca), `unschedulePost`, `cancelPost`, `updatePost` con la versione (409 se cambiata; anche lui con la sua transazione), `listPosts` (cursore `before` sulla data di creazione, fino a 100 per pagina);
  - **Letture per periodo:** `agenda.ts` legge i post di un intervallo fino a `AGENDA_MAX_DAYS = 42` («un mese come lo mostra il calendario»), filtrati sui clienti che la persona vede, con miniature (`getMediaForPosts`), stati e problemi; `fileTitle` e `postTitle` danno il titolo di un post senza testo (D-120.7);
  - **Scheda «Post» del cliente** (`pages/[org]/spazi/[slug]/post/index.vue`): elenco con filtro per stato e ricerca, letto fino a 10 pagine da 100, ordinato per data di creazione (D-79);
  - **Guscio:** «Calendario» nel menu e nella barra del telefono c'è, spento con «Presto» (`AppSidebar.vue`, `MobileNav.vue`); la scheda «Calendario» del cliente è diventata «Post» nella tappa 6 (piano 06, P2);
  - **Editor:** `spazi/[slug]/post/nuovo` legge `?profilo=`; non legge ancora giorno, ora, tipo né file dall'indirizzo. Il fuso dell'agenzia lo leggono solo Owner e Admin (`GET …/settings`, D-78);
  - **Moduli:** `ModuleDefinition` ha permessi, code, `notificationKinds`, `digestSections` e `onUserAnonymized`; le voci del calendario e del menu «arrivano quando servono» (commento in `module-definition.ts`). `organizations.settings` è un jsonb senza la chiave `modules`: nessun modulo si accende o spegne per agenzia;
  - **Permessi:** unione chiusa `Permission` in `domain/src/authz/permissions.ts`, con `WORKSPACE_PERMISSIONS`, i ruoli in `roles.ts` e la matrice in `matrix.fixture.ts` (`ModulePermissions`, di cui parla il piano generale §4, nel codice non c'è: un modulo aggiunge i suoi permessi a quei file, e `modules.test.ts` controlla chi li registra); le fasce orarie rientrano in `workspace.content_settings.manage` (la scheda «Impostazioni dei contenuti», `spazi/[slug]/contenuti.vue`);
  - **Notifiche (tappa 8):** registro dei tipi per modulo (tipi in `domain/src/<modulo>/events.ts`, messaggi in `application/src/<modulo>/notification-messages.ts`), regole dei destinatari `scheduler | workspace_managers | org_admins | platform_admins` (`domain/src/notifications/recipients.ts`), e `eligibleUser` che all'invio rilegge se la persona **vede** ancora il cliente (non un permesso preciso), sezioni del riepilogo con `order` (posts 10, 20, 30; accounts 50: il piano va a 40, come dice il codice);
  - **Meta:** `listInstagramMedia` (`graph-client.ts`) legge gli ultimi media di un account con `id, caption, timestamp, media_type, media_product_type, permalink`, senza `media_url` né `thumbnail_url`, e lo usa solo il worker tramite `PlatformPublisher` (la ricerca dell'esito incerto, `instagram-publish.ts`): in `application` non c'è una porta per leggere i media. Il web oggi non esce su internet (`docker/compose.yml`: `internal, edge, public`); la PR #328 della tappa 8 lo mette su `egress`, e il Task 12 ne dipende;
  - **Zip nel browser:** la tappa 7 apre gli zip con il browser, senza librerie (D-110.3): lo stesso lettore può aprire un `.xlsx`, che è uno zip di XML (P6).
- non c'è ancora: il calendario, il registro delle voci del calendario, i filtri nell'indirizzo, il trascinamento, la libreria a richiesta, le fasce orarie, la programmazione in blocco, «Duplica», la griglia di Instagram, il modulo `plan`, l'accensione dei moduli per agenzia.

**Dipendenze nuove:** nessuna prevista. Il trascinamento usa gli eventi del browser (HTML drag and drop e pointer events), il CSV e l'`.xlsx` si leggono con codice nostro (P6).

## Aggiornamenti rispetto alla specifica

Da riportare nella specifica nella PR del task che li introduce.

| # | Specifica | Piano | Motivo |
|---|---|---|---|
| P1 | §11.4: il calendario segue il contesto; §7.3 voci del calendario dei moduli | **Una lettura sola** per il calendario: `GET /api/v1/orgs/[org]/calendar?from&to&…filtri`, al massimo 42 giorni (la griglia di un mese), che unisce i post dei clienti visibili e le voci dei moduli registrati (`calendarEntries`, dentro `uow.run({ organizationId, userId })`). La vista «Elenco» usa la stessa lettura, a pagine di 42 giorni, più le **bozze senza data** in una lettura a parte | Un mese si disegna con una richiesta; i moduli (il piano, le attività della 1.5) aggiungono voci senza toccare il calendario |
| P2 | §7.3 «Moduli attivabili per organizzazione (`organizations.settings.modules`)» | La chiave `modules` nasce qui, con un solo modulo spegnibile, `plan`, **acceso per tutte le agenzie** finché non c'è un motivo per spegnerlo. Si cambia con un comando della CLI del worker (`set-modules <agenzia> --plan off`, accanto a `set-limits`), non dal pannello. Con il modulo spento: niente voce di menu, niente schede nel calendario, niente sezione del riepilogo, 404 sulle rotte | La specifica chiede che si possa spegnere; nessuno oggi lo vuole spento, e una scelta dell'agenzia sarebbe una pagina in più da disegnare |
| P3 | §9.4 `plan.due_soon`: «uno per contenuto, creato o sostituito nella stessa transazione di ogni modifica» | **Nessun lavoro per contenuto.** Un lavoro di sistema `plan.due_scan` ogni 5 minuti, con il lock consultivo, scrive l'evento `plan.due_soon` (outbox, `dedupe_key` `<contenuto>:<istante di riferimento>`) per i contenuti non preparati con `dueNotificationAt <= adesso < istante di riferimento` (il momento della notifica è 24 ore prima dell'istante di riferimento, o le 9:00 del giorno prima senza ora): così parte subito anche un contenuto creato o spostato dopo il suo momento, e uno arrivato mentre il worker era fermo. Il lavoro usa `runAsSystem` solo per elencare le agenzie attive con il modulo acceso, poi legge i contenuti e scrive gli eventi in `uow.run({ organizationId, userId: null })` per ognuna (il modello di `eslint.config.mjs`). Il dispatcher della tappa 8 fa il resto. Il piano generale §5 (passo 7) cambia con questa PR | `JobQueue.send` non entra nelle transazioni del pannello (piano 07, P3); la scansione rilegge sempre lo stato di adesso, regge i riavvii, e un contenuto spostato cambia la chiave da solo; la `dedupe_key` evita le ripetizioni |
| P4 | §11.5: la griglia «con i post già pubblicati letti dall'API» | Le miniature dei post pubblicati passano **dal server** (`…/grid/{accountId}/media/{mediaId}/thumbnail`), che le scarica da Meta a richiesta con `media_url`/`thumbnail_url` e non le salva; l'elenco (con `media_url` e `thumbnail_url` in **una** chiamata, al massimo 30 media) si rilegge da Meta a ogni apertura della griglia, senza cache in memoria (scalabilità §6.4); la miniatura rilegge solo quel media. Il server scarica solo l'indirizzo che Meta dà per **quel** media, dopo aver controllato che il media sia dell'Instagram di quell'account (il token dell'utente di sistema vede tutti gli account dell'agenzia), con un elenco di host ammessi (CDN di Instagram e Facebook), solo immagini, al massimo 5 MB. La chiamata a Meta passa da un metodo nuovo della porta della piattaforma (ADR 019), fuori dalla transazione, e conta nel rallentamento (D-111) | Gli indirizzi del CDN di Meta scadono e la CSP del pannello non li ammette; nessuno stato in memoria |
| P5 | §11.6 «In blocco»: «tabella modificabile» | La tabella vive **nel browser** finché si preme «Programma»: allora il server crea `bulk_imports` con le righe e manda `bulk.import` (ambito `organization`), che crea i post **una riga per transazione**: una funzione pubblica nuova di `posts`, `createScheduled(tx, actor, input)`, crea la bozza e, se i controlli passano, la programma **nella stessa transazione** del chiamante, restituendo i lavori da mandare dopo il commit (come `scheduleSaved` e `sendAfterSchedule` di `schedule.ts`); l'esito della riga si scrive in `rows` nella stessa transazione. Un riavvio riprende dalla prima riga senza esito, senza doppioni. «Annulla» lo controlla il server (10 secondi dalla fine): riporta in bozza i programmati e cancella le bozze nate da quell'importazione solo se la versione è quella salvata in `rows` alla creazione; un post già in preparazione o oltre resta, e il riepilogo lo dice | Un'importazione di 100 righe non tiene aperta una richiesta; ogni riga è ripetibile e una riga che fallisce non ferma le altre |
| P6 | §11.6 «Da CSV/Excel» | CSV (separatore `,` o `;`, UTF-8 con o senza BOM) e `.xlsx` (solo il primo foglio, solo i valori) letti **nel browser** con codice nostro: l'`.xlsx` con il lettore di zip della tappa 7 e un parser XML del browser (`DOMParser`). Niente `.xls` vecchio. Se il formato vero di Excel di Matteo non si legge, il task si ferma e propone un'ADR | Nessuna dipendenza per un file di poche righe; il server riceve righe già validate dallo schema, mai un file |
| P7 | §11.4 «Trascinamento per spostare un post» | Al computer si trascina; sul telefono e da tastiera si usa «Sposta…» dal menu della scheda (giorno e ora). Lo spostamento è `PATCH` del post con la **versione** (409 se un'altra persona l'ha cambiato) e gli stessi controlli di «Programma»; «Annulla» per 5 secondi riporta giorno e ora di prima con la versione nuova | Il trascinamento sul telefono si confonde con lo scorrimento; la versione evita di sovrascrivere il lavoro di un altro |

## Regole della tappa

- **Moduli:**
  - `calendar` (nuovo): letture del calendario e della vista Elenco, registro delle voci (`calendarEntries`), filtri, griglia di Instagram. `domain/src/calendar/`, `application/src/calendar/`, `contracts/src/api/calendar.ts`, rotte in `apps/web/server/api/v1/orgs/[org]/calendar/`. Nessuna tabella: legge i post con le funzioni pubbliche di `posts` e gli account con quelle di `accounts`.
  - `posts` (esistente) guadagna fasce orarie (`time_slots`), programmazione in blocco (`bulk_imports`, `bulk.import`) e «Duplica»: sono post e impostazioni del cliente, non un modulo a sé.
  - `plan` (nuovo): `domain/src/plan/`, `application/src/plan/`, `infrastructure/src/db/plan/`, `contracts/src/api/plan.ts`, rotte in `apps/web/server/api/v1/orgs/[org]/plan/`, pagina `pages/[org]/piano.vue`. Dipende da `posts`, mai il contrario: una regola di dependency-cruiser lo verifica (`posts` non importa `plan`).
- **Registro delle voci del calendario** (§7.3, piano generale §6):
  ```ts
  interface CalendarEntrySource {
    id: string // 'plan'
    entries(tx: Tx, query: { workspaceIds: readonly string[]; from: LocalDate; to: LocalDate }): Promise<CalendarEntry[]>
    /** the posts the module marks («dal piano»), looked up by post, not by day */
    markedPostIds?(tx: Tx, postIds: readonly string[]): Promise<ReadonlySet<string>>
  }
  interface CalendarEntry {
    source: string
    id: string
    workspaceId: string
    localDate: LocalDate
    localTime: LocalTime | null
    title: string
    kind: string // il tipo che il pannello disegna: 'plan' per le schede tratteggiate
    data: Record<string, unknown> // ciò che serve alla scheda, dichiarato dal modulo
  }
  ```
  `ModuleDefinition` guadagna `calendarEntries?: CalendarEntrySource`. Il calendario chiede le voci solo ai moduli accesi per l'agenzia (P2) e solo per i clienti visibili.
- **Contesto e indirizzo:** il calendario sta in `/[org]/calendario` (tutti i clienti) e nella scheda «Calendario» del cliente (`/[org]/spazi/[slug]/calendario`, che prende il posto di «Post»: l'indirizzo vecchio `…/post` porta lì con un redirect, solo l'elenco: `post/nuovo` e `post/[postId]` restano). Il contesto di un profilo (§14.6, `?profilo=`) restringe il calendario agli account di quel profilo, e un cliente o un profilo che la persona non vede riporta a «Tutti i clienti» come il resto del pannello. Vista, periodo, filtri e «Mostra: Post · Piano · Entrambi» stanno nell'indirizzo (`?vista=mese&da=2026-12-01&stato=…`), così un indirizzo copiato riapre lo stesso calendario. Mese predefinito al computer, Elenco sotto i 768 px (§11.4).
- **Date e fusi:** il calendario conta i giorni nel **fuso dell'agenzia** (D-58), anche per un post salvato con un altro `timezone`; i limiti di un periodo si calcolano come istanti all'inizio e alla fine dei giorni in quel fuso (giorni da 23 e 25 ore), mai sommando 24 ore. Il fuso ora si legge da una risposta che vedono tutti (D-78, Task 2). Un post alle 02:30 del 25/10/2026 (ora doppia) e del 28/03/2027 (ora inesistente) sta nel suo giorno; fasce e piano usano la regola di §9.2 già in `domain/src/time/`.
- **Permessi:** ogni lettura filtra sui clienti visibili (`workspace.view`); spostare chiede `post.publish` sul post (come «Programma»), creare dal «+» `post.draft`; fasce orarie `workspace.content_settings.manage`; piano `plan.view`, `plan.edit`, `plan.prepare` registrati dal modulo `plan` (§10.2: `plan.view` a chi vede il cliente, `plan.edit` fino a Publisher, `plan.prepare` fino a Editor). Una risorsa non visibile dà 404.
- **Isolamento:** `time_slots`, `bulk_imports` e `plan_items` hanno `organization_id` e RLS (`org_isolation`), con indici che iniziano con `organization_id`. Ogni rotta nuova entra in `cross-organization.int.test.ts` e `access-matrix.int.test.ts`; `bulk.import` (ambito `organization`) e `plan.due_scan` (sistema) in `apps/worker/src/handlers/isolation.int.test.ts`, con i loro casi in `CASES` (code di un'agenzia) e `SYSTEM_CASES`.
- **`runAsSystem`:** solo `application/src/plan/due-scan.ts`, aggiunto a `RUN_AS_SYSTEM_ALLOWED`.
- **Code:** `bulk.import` (organizzazione, `{ organizationId, bulkImportId, userId }`, chiave `bulkImportId`) e `plan.due_scan` (sistema, `singleton`, ogni 5 minuti) in `REGISTRY`, `KNOWN_QUEUES` e nei loro test.
- **Il piano non esce mai dove non deve:** la nota per chi prepara si legge solo nel Piano editoriale (scelta 11); non va nel calendario principale, nelle notifiche, nel riepilogo né nel link cliente (tappa 10). I campi esposti di una voce del piano sono dichiarati uno per uno, con un test.
- **Meta:** solo la griglia legge da Meta, con il finto Graph API nei test (`tools/meta-mock` guadagna `media_url` e `thumbnail_url`). Ciò che non è provato su Meta vera si scrive «non verificato» e va nella guida della prova.
- **Interfaccia:** ogni pagina nuova o toccata segue lo stile del ridisegno (`DESIGN.md`, «Regole del ridisegno per ogni pagina» e «Tela nuova direzione»), con stati vuoto, caricamento, errore e successo, 390 px con la tastiera, axe verde, tema chiaro e scuro. Le schermate che la tela non ha ancora (settimana, elenco, piano, griglia, fasce, in blocco) si disegnano **prima** (Task 1). Per ogni cambiamento visibile Matteo vede prima e dopo con il motivo.
- **Commit e PR** con l'ambito `scheduling` (calendario, piano, fasce, in blocco, griglia: è già in `commitlint.config`), oppure `posts`, `accounts`, `notifications`, `web` o `worker`.
- **Test:** `docs/convenzioni.md` §Test; E2E solo dei file toccati durante il lavoro, `pnpm verify:ci` una volta prima del push.

## Scelte di questa tappa

Hanno la loro voce in `docs/decisioni-aperte.md`: **D-123**, nuova con il piano, provvisoria. Matteo può cambiare ogni punto prima del task che lo usa. D-78, D-79 e la richiesta 2 di D-120 si chiudono nei task che le fanno.

1. **Le tavole prima del codice** (Task 1): settimana, elenco, piano editoriale, scheda del piano, griglia, fasce orarie, tabella in blocco e «Duplica» si disegnano sulla tela nuova (`design/feedway-ui-v2.pen`) con Pencil, che non c'è nel cloud: il Task 1 gira sul computer di Matteo (Remote Control). Matteo le approva prima dei Task 3, 4, 7, 9, 10 e 12; i task di dominio e dati (2, 5, 6, 8, 11) partono subito.
2. **L'elenco dei post** (D-120 richiesta 2, D-79): la vista «Elenco» del calendario sostituisce la scheda «Post». Gruppi per giorno sotto «Oggi», «Domani», «Questa settimana», «Più avanti» e, guardando indietro, «Ieri», «Questa settimana», «Prima»; dentro ogni giorno l'ordine è l'ora del post. Le **bozze senza data** stanno in una sezione «Bozze» separata, in cima, con «Elimina le bozze vuote» (senza testo, senza file e senza account, solo le proprie o tutte per chi ha `post.manage_others`, con conferma). I filtri si combinano (stato, account, piattaforma, tipo, autore, etichetta) e c'è la ricerca nel testo.
3. **Le bozze con una data nel calendario:** compaiono nel loro giorno con il bordo tratteggiato grigio e «bozza», come nella schermata `07-calendario`. Le voci del piano sono **diverse** dalle bozze (§11.12: tratteggiate e semitrasparenti, con il tipo e «Da preparare»): la differenza la decide il Task 1, e se le due si confondono la bozza perde il tratteggio.
4. **«+» su ogni giorno** (§11.4): apre l'editor con il giorno e l'orario predefinito del cliente (o la prossima fascia libera, se il cliente ha fasce); da «Tutti i clienti» chiede prima il cliente (la pagina `post/nuovo` che c'è già). Non c'è sui giorni passati.
5. **Libreria a richiesta** (§11.4): pulsante «Libreria» solo dentro un cliente, a chi può caricare; il pannello laterale è la libreria della tappa 7 in piccolo (cartelle, ricerca, filtro per uso). Trascinare un file su un giorno, o «Usa in un post», apre l'editor con quel file e quel giorno. Sul telefono il pulsante non c'è.
6. **Fasce orarie** (§11.6): nella scheda «Impostazioni dei contenuti» del cliente, come righe «giorno della settimana + ora», più «Copia lun–ven». La **prossima fascia libera** è la prima fascia futura del cliente in cui il cliente non ha già un post programmato a quell'ora esatta; nell'editor un pulsante «Prossima fascia libera» accanto a «Quando».
7. **In blocco da file:** fino a **50 file** per volta; un file è un post, oppure «Unisci in un carosello» le righe scelte (2–10 file). La tabella ha miniatura, tipo, testo, account (uno o un gruppo salvato), giorno e ora; «Distribuisci sulle fasce libere» riempie le date dalle fasce, in ordine. «Programma» crea i programmati che passano i controlli e lascia in bozza gli altri (§11.6), con il riepilogo «18 programmati, 2 da sistemare» e «Annulla» (P5). L'importazione finita scrive `bulk.completed` per la notifica nel pannello (§12.2, solo pannello) a chi l'ha avviata: una regola di destinatari nuova, `initiator` (`bulk_imports.created_by`).
8. **CSV ed Excel** (P6): colonne `data`, `ora`, `testo`, `account`, `file`, più `testo_instagram` e `testo_facebook` facoltative; nomi delle colonne anche come la specifica e in inglese (`date`, `time`, `caption`, `account`, `file`, `caption_instagram`, `caption_facebook`). Data `GG/MM/AAAA` o `AAAA-MM-GG`, ora `HH:MM`; `account` è lo username Instagram o il nome della Pagina, più account separati da `|`. I file si abbinano per nome a quelli caricati nella stessa tabella o già in libreria (cartella scelta). Un modello da scaricare con una riga d'esempio. Gli errori si dicono per riga, prima di «Programma».
9. **«Duplica»** (§11.6, anche sulla pagina dell'esito, D-113): copia un post su altre date (fino a 31) e su altri clienti dove la persona può scrivere, con testi per piattaforma e tipo. Nello stesso cliente tiene anche file, etichette e gruppi; **su un altro cliente** i file e le etichette non passano (la libreria e le etichette sono del cliente, e i controlli dei file leggono solo quella del cliente), e la copia lo dice: si aggiungono nell'editor. Gli account si scelgono di nuovo per ogni altro cliente. «Duplica» è sincrono, fino a 31 date × 5 clienti, in una transazione; Le copie nascono **bozze**; «Duplica e programma» le programma alla stessa ora se passano i controlli.
10. **Griglia di Instagram** (§11.5): nella scheda «Calendario» del cliente, come quarta vista «Griglia» accanto a Mese, Settimana ed Elenco (§14.7 non ha una scheda «Griglia»), un account Instagram alla volta; 3 colonne con le miniature 3:4 (verificate nella tappa 6), i programmati dei prossimi 30 giorni in cima al loro posto, sopra gli ultimi 30 pubblicati. Riordinare si fa **solo tra i programmati**: trascinando, gli orari si scambiano (conferma, «Annulla»), con le regole di P7. Un pubblicato non si sposta. Le storie non ci sono (non stanno nella griglia).
11. **Piano editoriale** (§11.12): come la specifica, con queste scelte:
    - la **nota** la vede chi lavora nell'agenzia e vede il cliente, Viewer compreso, ma solo nel Piano editoriale e nel suo modulo; non va nel calendario principale, nelle notifiche, nel riepilogo né al cliente (tappa 10);
    - un contenuto **preparato** (post presente e non annullato) non è più una scheda tratteggiata nel calendario: c'è solo il post, con «dal piano»; il segno si legge per `post_id` (la voce del piano con quel post), non per giorno, così resta anche se il post esce in un altro giorno (regola 3);
    - il modulo si chiama `plan`, acceso per tutte le agenzie (P2);
    - il modulo breve si apre al clic sul giorno, salva con Invio e resta aperto per il successivo; tipo con le quattro voci di §13 (reel, carosello, foto, storia);
    - il tratto «Mancano meno di 36 ore» e «In ritardo» si calcolano con `Clock` dalla funzione dell'istante di riferimento, nel pannello ogni minuto;
    - la notifica «da preparare entro domani» va a chi ha `plan.prepare` nel cliente, nel pannello e su Telegram (§12.2), e la sezione «Da preparare» del riepilogo ha `order: 40`;
    - **stampa del piano:** non qui. La stampa (schede piene, loghi) arriva nella tappa 10 con il foglio di stampa del calendario cliente (piano generale, tappa 9).
12. **Rilascio:** la tappa esce come **0.15.0**.

## Come si divide il lavoro

Tredici task, ognuno una PR (o più dove il task lo dice), in otto thread più la revisione di fine tappa.

| Thread | Task | Dipende da | Perché insieme |
|---|---|---|---|
| A · Tavole | Task 1 · Le tavole della tappa sulla tela | — (sul computer di Matteo, con Pencil) | Tutte le schermate nuove, approvate insieme |
| B · Calendario | Task 2 · Registro, letture e filtri; Task 3 · Calendario mese, settimana ed elenco | il 3 anche A | La lettura e la pagina che la usa |
| C · Spostare e libreria | Task 4 · Trascinamento, «+» e libreria a richiesta | B, A | Tutte le azioni dirette sul calendario |
| D · Piano, dati | Task 5 · Dominio e tabella del piano; Task 6 · Casi d'uso, API e «Prepara» | il 5 nessuno; il 6 il Task 2 (registro e moduli accesi) e il Task 9 (prossima fascia libera) | Niente interfaccia; il 6 usa il 5 |
| E · Piano, pagine | Task 7 · Piano editoriale, schede nel calendario ed editor; Task 8 · Notifica e riepilogo | D, B, A | L'interfaccia del piano e i suoi avvisi |
| F · Fasce e blocco | Task 9 · Fasce orarie e prossima fascia libera; Task 10 · In blocco da file e «Duplica»; Task 11 · CSV ed Excel | il 10 anche A; l'11 il 10 | Stesso flusso «molti post in una volta» |
| G · Griglia | Task 12 · Griglia di Instagram riordinabile | B, A | Unica lettura da Meta della tappa |
| — | Revisione di fine tappa (thread separato, istruzioni del progetto) | A–G | |
| H · Rilascio | Task 13 · Correzioni della revisione, rilascio 0.15.0 e guida della prova | revisione | |

- **A, il Task 2, il Task 5 e il Task 9 possono andare in parallelo:** toccano parti diverse. Il Task 6 parte dopo il 2 e il 9, come il piano generale vuole il calendario con il registro prima del piano.
- **Dentro un thread** i task vanno in ordine, una PR alla volta: si fonde la prima, poi si parte dalla `main` aggiornata. `pnpm verify:ci` una volta prima di ogni push.
- **Se il contesto non basta**, il thread fa il suo primo task, scrive l'handoff e chiede al coordinatore un thread nuovo per il secondo.
- **A fine thread** l'handoff in `/mnt/project-files/handoff/tappa-9/HANDOFF-thread-<lettera>.md` (fatto, PR, scelte prese, cosa resta, non verificato, cosa serve al thread dopo), poi la richiesta al coordinatore del thread successivo.
- **Rilascio:** nessun task tocca versioni, changelog o PR di release-please prima del Task 13.

## Review Focus

Oltre al piano generale §8:
1. **Ora legale:** un post e una voce del piano alle 02:30 del 25/10/2026 e del 28/03/2027 nel giorno giusto del mese e della settimana; una fascia alle 02:30 in quei giorni; «Distribuisci sulle fasce libere» a cavallo del cambio; l'istante di riferimento del piano senza ora (23:59) e la notifica alle 9:00 del giorno prima (Task 2, 5, 8, 9, 10).
2. **Due persone sullo stesso post:** uno spostamento con la versione vecchia dà 409 e non sovrascrive; lo scambio della griglia tra due post di cui uno appena cambiato non ne sposta nessuno (Task 4, 12).
3. **Riavvii a metà:** `bulk.import` ucciso alla riga 7 di 20 riparte dall'8 senza doppioni; «Annulla» dopo un riavvio; `plan.due_scan` su due worker, una notifica sola (Task 8, 10).
4. **Isolamento:** una voce del piano, una fascia o un'importazione di un'altra agenzia per id; il calendario di «Tutti i clienti» di un Manager di un solo cliente; la griglia di un account non assegnato a un cliente visibile: «non trovato» o vuoto (Task 2, 6, 9, 10, 12).
5. **La nota del piano:** non compare nel calendario, nelle notifiche, nel riepilogo, nella risposta di un Viewer; un test sui campi esposti (Task 6, 7, 8).
6. **Il piano e i post:** «Prepara» due volte lo stesso contenuto (una bozza sola); il post annullato o cancellato (il contenuto torna «Da preparare»); il contenuto tolto (il post resta); la bozza abbandonata cancellata dopo 30 giorni (`ON DELETE SET NULL`) (Task 6).
7. **Moduli spenti:** con `plan` spento, nessuna voce nel calendario, niente menu, niente sezione del riepilogo, 404 sulle rotte, `plan.due_scan` che salta l'agenzia (Task 2, 6, 8).

---

## Task 1 · Le tavole della tappa sulla tela

**Obiettivo:** le schermate nuove disegnate e approvate da Matteo prima del codice che le costruisce.

**Cosa fa:** sulla tela nuova (`design/feedway-ui-v2.pen`), con i componenti e le variabili che ci sono, telefono e computer, chiaro e scuro dove la tela già lo fa:
- calendario: **settimana** (miniature grandi, ore in colonna), **elenco** (scelta 2, con «Bozze» e i gruppi), il mese della schermata `07` con la barra dei filtri, i filtri rapidi e «Mostra: Post · Piano · Entrambi»; il «+» su un giorno; il pannello «Libreria» aperto; il menu di una scheda con «Sposta…» e «Duplica»;
- la scheda tratteggiata del piano nei tre stati (da preparare, meno di 36 ore, in ritardo) accanto a una bozza e a un post, per la scelta 3;
- **Piano editoriale:** la finestra «Per quale cliente fai il piano?», il mese da riempire, il modulo breve, la scheda «Preparato» con il collegamento al post; sul telefono l'elenco dei giorni con «+»;
- **editor** da un contenuto del piano: la nota in evidenza, l'avviso sul tipo, «Previsto dal piano il 20»; il pulsante «Prossima fascia libera»;
- **fasce orarie** nelle «Impostazioni dei contenuti»;
- **in blocco:** la tabella da file, «Distribuisci sulle fasce libere», l'importazione da CSV o Excel con gli errori per riga, il riepilogo con «Annulla»; **«Duplica»**;
- **griglia di Instagram** con i programmati e lo scambio.

Le tavole esportate vanno in `design/tavole/2026-11-xx-tappa-9/` e in `/mnt/project-files/design-revisione/`; le regole nuove in `DESIGN.md` («Calendario», «Piano editoriale», «In blocco»).

**Fine:** Matteo approva le tavole (o le cambia); `DESIGN.md` aggiornato; D-123 punto 1 chiuso.

## Task 2 · Registro, letture e filtri

**Obiettivo:** una lettura che dà tutto ciò che un periodo del calendario mostra, filtrata e nel fuso giusto.

**Cosa fa:**
- **Dominio** `domain/src/calendar/`: `CalendarFilters` (clienti, account, piattaforma, tipo, stato, autore, etichetta, filtro rapido, «Mostra»), `parseCalendarQuery`/`toCalendarQuery` (indirizzo ⇄ filtri, valori sconosciuti ignorati), `monthGrid(month, weekStart)` (6×7 giorni, lunedì primo), `weekOf(date)`, `quickFilter(name, now, timeZone)` → stati e intervallo («Da pubblicare», «Pubblicati», «Con problema», «Da preparare», «Oggi», «Questa settimana»);
- **Registro** `calendarEntries` in `ModuleDefinition` e `calendarEntrySources()` in `modules.ts` (P1, «Registro delle voci»), con `enabledModules(organization)` (P2) che legge `organizations.settings.modules` (manca → tutti accesi);
- **Lettura** `getCalendar(deps, actor, query)` in `application/src/calendar/read.ts`: post del periodo (programmati, in pubblicazione, usciti, in pausa, bozze con data; non gli annullati salvo filtro) dei clienti visibili, con miniatura (niente per il Viewer, D-72), ora locale, account, stato, etichette, autore e «dal piano» (le voci dei moduli possono dichiarare i post che segnano, `markedPostIds`: il piano li cerca per `post_id`, non per giorno, così un post uscito in un altro giorno resta segnato); più le voci dei moduli accesi. Al massimo 42 giorni, 2.000 voci (oltre, `truncated: true`). Una funzione pubblica nuova di `posts`, `listPostsInRange(tx, { workspaceIds, from, to, timeZone, filters })` (giorni locali trasformati in istanti ai bordi dei giorni dell'agenzia), con l'indice `posts_workspace_status_idx` che c'è;
- **Elenco:** `getDrafts(deps, actor, { workspaceIds })` per le bozze senza data e `deleteEmptyDrafts` (scelta 2);
- **Fuso per tutti** (D-78): `timezone` dell'agenzia in `GET /api/v1/me` per ogni membership (o nell'organizzazione corrente), e l'editor lo legge da lì;
- **Contratti e rotte:** `GET /api/v1/orgs/[org]/calendar`, `GET …/calendar/drafts`, `POST …/calendar/drafts/delete-empty`, in OpenAPI.

**Test:**
- unit: indirizzo ⇄ filtri andata e ritorno; griglia di febbraio 2027 e di novembre 2026; filtri rapidi alle 23:59 e alle 00:00 di Roma; il giorno di un post alle 02:30 dei due cambi d'ora;
- integrazione: un Manager di un cliente non vede gli altri; il Viewer senza miniature; un modulo spento non dà voci; 2.001 voci → `truncated`; «Elimina le bozze vuote» non tocca le bozze altrui di chi non ha `post.manage_others` né una bozza con un file;
- batteria d'isolamento per le tre rotte.

**Fine:** `pnpm verify` verde; specifica §11.4 e §7.3 aggiornate con P1 e P2; D-78 chiusa.

## Task 3 · Calendario mese, settimana ed elenco

**Obiettivo:** il calendario si apre dal menu e dalla pagina del cliente, e si legge come nelle tavole.

**Due PR:** (1) mese e settimana con i filtri; (2) elenco, scheda del cliente e guscio.

**Cosa fa:**
- `pages/[org]/calendario.vue` e `pages/[org]/spazi/[slug]/calendario.vue`, con `CalendarView` (barra: frecce, periodo, «Oggi», viste; filtri; filtri rapidi) e i componenti `CalendarMonth`, `CalendarWeek`, `CalendarList`, `CalendarCard` (miniatura, ora, icone degli account, pallino dello stato, etichette; bozza tratteggiata), con `useCalendar` che legge e scrive l'indirizzo;
- mese con «+N» quando un giorno non ha posto e il giorno che si apre in un foglio; settimana con le miniature grandi e le ore; elenco come la scelta 2, a pagine di 42 giorni con «Mostra altri»;
- clic su una scheda: il post (editor o pagina dell'esito, come oggi dall'elenco);
- guscio: «Calendario» acceso nel menu e nella barra del telefono (D-84); la scheda «Calendario» del cliente al posto di «Post», con il redirect da `…/post`; «Apri il calendario» accanto a «In uscita» in Oggi (D-88);
- telefono: Elenco predefinito, mese leggibile con i pallini, filtri in un foglio.

**Test:** componenti della griglia e della scheda; E2E `calendar.spec.ts` (mese, settimana, elenco, filtri nell'indirizzo che sopravvivono a una ricarica, contesto di un cliente, Viewer), 390 e 1440, chiaro e scuro, axe; E2E della scheda «Post» spostati sull'elenco.

**Fine:** `pnpm verify` verde; D-79 e la richiesta 2 di D-120 chiuse; Matteo ha visto prima e dopo.

## Task 4 · Trascinamento, «+» e libreria a richiesta

**Obiettivo:** dal calendario si sposta un post e se ne inizia uno nuovo senza passare da altre pagine.

**Cosa fa:**
- **Spostare** (P7): trascinamento al computer tra giorni (mese) e tra giorni e ore (settimana); «Sposta…» nel menu della scheda per telefono e tastiera. Lo spostamento usa `updatePost` con la versione e i controlli di «Programma»: se un controllo blocca, il post non si sposta e la scheda dice perché. «Annulla» per 5 secondi. Un post già uscito, in pubblicazione o con un account uscito non si sposta (R6 della tappa 7);
- **«+» sul giorno** (scelta 4): `spazi/[slug]/post/nuovo?giorno=2026-12-03&ora=18:00` e `post/nuovo?giorno=…` da «Tutti i clienti»; l'editor legge giorno, ora, `file` (uno o più id) e `tipo` dall'indirizzo;
- **Libreria a richiesta** (scelta 5): pulsante e pannello laterale nel calendario del cliente; un file trascinato su un giorno o «Usa in un post» apre l'editor con file e giorno.

**Test:** unit della regola «si può spostare»; integrazione dello spostamento con la versione vecchia (409) e con un controllo che blocca; E2E trascinamento e «Sposta…» con «Annulla», il «+» su oggi e su un giorno passato (non c'è), la libreria che porta un file nell'editor; axe e tastiera.

**Fine:** `pnpm verify` verde; Matteo ha visto prima e dopo.

## Task 5 · Dominio e tabella del piano

**Obiettivo:** le sei regole di §11.12 come funzioni pure, e la tabella con RLS (passi 1 e 2 del piano generale).

**Cosa fa:**
- `domain/src/plan/`: `PlanItem`, `PLAN_ITEM_TYPES` (`photo | carousel | reel | story`), `planTitle` (1–80), `referenceInstant(localDate, localTime | null, timeZone)` (23:59 senza ora; regola di §9.2), `planItemState(item, post, now)` → `to_prepare | due_soon | late | prepared`, `dueNotificationAt(item, timeZone)` (24 ore prima, o le 9:00 del giorno prima senza ora), `plannedVsPost(item, post)` per «Previsto dal piano il 20»; gli eventi `PLAN_EVENT_TYPES = ['plan.due_soon']` in `domain/src/plan/events.ts`, uniti a `OUTBOX_EVENT_TYPES`;
- **migrazione:** `plan_items` (`id`, `organization_id`, `workspace_id`, `local_date`, `local_time` null, `type`, `title`, `note`, `post_id` null e unico, `created_by`, `updated_by`, `version`, `created_at`, `updated_at`), chiave esterna composta verso `workspaces` e verso `posts` con `ON DELETE SET NULL (post_id)`, indice `(organization_id, workspace_id, local_date)`, RLS `org_isolation`; i vincoli `check` dei tipi in `outbox_events`, `notifications`, `notification_deliveries` e `notification_prefs` (vengono tutti da `OUTBOX_EVENT_TYPES`) con il tipo nuovo; `version` e `updated_at` di `plan_items` vanno anche nella specifica §13;
- **repository** in `infrastructure/src/db/plan/` (`listInRange`, `find`, `create`, `update` con versione, `remove`, `linkPost`), porta in `application/src/ports/plan.ts`.

**Test:** unit dell'istante di riferimento e dello stato alle 02:30 dei due cambi d'ora, senza ora, 36 ore e un secondo prima, un secondo dopo; integrazione della RLS con due agenzie, del `SET NULL` cancellando il post, dell'unicità di `post_id`.

**Fine:** `pnpm verify` verde; voce nella batteria di isolamento (tabella); `docs/moduli.md` con il modulo `plan`.

## Task 6 · Casi d'uso, API e «Prepara»

**Obiettivo:** il piano si scrive, si legge e diventa un post (passi 3 e 4 del piano generale).

**Cosa fa:**
- **Permessi** `plan.view`, `plan.edit`, `plan.prepare` aggiunti come gli altri (`Permission`, `WORKSPACE_PERMISSIONS`, `roles.ts`, `matrix.fixture.ts`, il `module.ts` del modulo; `modules.test.ts` controlla chi li registra) e in `docs/moduli.md`;
- **casi d'uso** in `application/src/plan/`: `listPlan(range, workspaceId)`, `createPlanItem`, `updatePlanItem` (versione), `movePlanItem`, `removePlanItem` (il post resta, regola 4), `preparePlanItem` che chiama `createDraft(tx, actor, …)` di `posts` e salva il collegamento **nella stessa transazione** (giorno e ora → istante con §9.2; senza ora l'orario predefinito del cliente, poi la prossima fascia libera del Task 9 se c'è, poi le 18:00 come l'editor); un contenuto con il post annullato o cancellato si prepara di nuovo e sostituisce il collegamento. Lo stato si legge con `getStatuses`;
- **voce del calendario** `calendarEntries` del modulo: tipo, titolo, giorno, ora, stato e id del post; **mai la nota** (campi dichiarati uno per uno); i contenuti preparati non danno voce, solo `markedPostIds` per il segno «dal piano»; `GET …/plan` dà la nota a chi vede il cliente (scelta 11);
- **rotte** `GET/POST /api/v1/orgs/[org]/plan`, `PATCH/DELETE …/plan/[id]`, `POST …/plan/[id]/prepare`, 404 con il modulo spento; OpenAPI;
- **dependency-cruiser:** `posts` non importa `plan`.

**Test:** integrazione: Editor prepara ma non pianifica, Viewer legge; «Prepara» due volte (una bozza, la seconda risponde con quella); post annullato → «Da preparare» e «Prepara» di nuovo; contenuto tolto, post intatto; la voce del calendario senza `note` (test sui campi); modulo spento → 404; batteria d'isolamento e matrice per ogni rotta.

**Fine:** `pnpm verify` verde; specifica §11.12 e §10.2 coerenti con il codice.

## Task 7 · Piano editoriale, schede nel calendario ed editor

**Obiettivo:** si pianifica un mese di seguito, e chi carica vede cosa preparare (passi 5 e 6 del piano generale).

**Due PR:** (1) la pagina del piano; (2) le schede nel calendario e l'editor.

**Cosa fa:**
- `pages/[org]/piano.vue`, voce «Piano editoriale» nel menu sotto «Calendario» (solo con il modulo acceso e `plan.view` in almeno un cliente); la finestra della scelta del cliente da «Tutti i clienti»; il mese da riempire, il modulo breve (Invio salva e resta aperto), sposta trascinando con «Annulla» e «Sposta» nel menu, modifica e togli; «Preparato» con il collegamento; sul telefono l'elenco dei giorni con «+»;
- nel calendario principale le schede tratteggiate (scelta 3) con lo stato che cambia ogni minuto, il selettore «Mostra» e il filtro rapido «Da preparare»; dalla scheda «Apri nel piano» e «Prepara questo contenuto»;
- **editor:** `…/post/nuovo?piano=<id>` chiama «Prepara» e apre la bozza; la nota in evidenza; l'avviso (senza blocco) se i file scelti non sono del tipo pianificato; «Previsto dal piano il 20» quando il giorno del post è un altro; il segno «dal piano» sulla scheda del post.

**Test:** componenti del modulo breve (Invio, errori, ora svuotata); E2E `plan.spec.ts`: pianificare tre contenuti di seguito, spostarne uno, prepararne uno e vederlo diventare post nel calendario, annullare il post e vedere tornare «Da preparare»; Viewer in sola lettura; 390 e 1440, chiaro e scuro, axe, tastiera.

**Fine:** `pnpm verify` verde; Matteo ha visto prima e dopo.

## Task 8 · Notifica e riepilogo

**Obiettivo:** nessun contenuto del piano arriva al giorno senza che qualcuno lo sappia (passo 7 del piano generale).

**Cosa fa:**
- `plan.due_scan` (P3) in `application/src/plan/due-scan.ts` (in `RUN_AS_SYSTEM_ALLOWED`), con il lock: per ogni agenzia attiva con il modulo acceso, i contenuti non preparati con `dueNotificationAt` tra un'ora fa e adesso → evento `plan.due_soon` con `dedupe_key`;
- `NotificationKind` di `plan.due_soon`: destinatari chi ha `plan.prepare` nel cliente: regola nuova `workspace_preparers` in `domain/src/notifications/recipients.ts`, che conta i membri del cliente con un ruolo che lo concede **e** Owner e Admin dell'agenzia (non solo `workspace_members`, come fa `managersOf`); canali pannello e Telegram, livello `warning`; il messaggio con tipo, titolo, giorno e ora e il link al piano, **senza la nota**; all'invio `eligibleUser` rilegge anche il **permesso** `plan.prepare` (oggi rilegge solo se la persona vede il cliente), così un Editor diventato Viewer non la riceve;
- `DigestSection` `plan.to_prepare` (`order: 40`): i contenuti da preparare entro domani del destinatario;
- testi in `it.json` → `notify.kinds.plan_due_soon` e `digest.*`.

**Test:** integrazione del worker: un contenuto alle 10:00 di domani notifica alle 10:00 di oggi, un contenuto senza ora per domani notifica alle 9:00 di oggi, uno creato dopo il suo momento notifica subito, uno con il worker fermo due ore notifica alla ripartenza, uno preparato no, uno spostato notifica di nuovo con la data nuova, due worker → un evento; un Editor del cliente la riceve, uno di un altro cliente no; il riepilogo con la sezione e senza la nota; modulo spento → niente. Batteria d'isolamento (`SYSTEM_CASES`).

**Fine:** `pnpm verify` verde; specifica §9.4 e §12.2 aggiornate con P3; `docs/moduli.md`.

## Task 9 · Fasce orarie e prossima fascia libera

**Obiettivo:** ogni cliente ha i suoi orari abituali, e l'editor propone il primo libero (§11.6, RF-42).

**Cosa fa:**
- **migrazione** `time_slots` (`id`, `organization_id`, `workspace_id`, `weekday` 1–7, `local_time`), unico su `(workspace_id, weekday, local_time)`, RLS;
- **dominio** `domain/src/posts/time-slots.ts`: `nextFreeSlot(slots, occupied, after, timeZone)` e `distributeOnSlots(slots, occupied, count, from, timeZone)` (scelta 6, §9.2 per le ore del cambio);
- **casi d'uso e rotte** `GET/PUT …/workspaces/[id]/time-slots` (`workspace.content_settings.manage` per scrivere) e `GET …/workspaces/[id]/next-free-slot?dopo=`; la sezione «Fasce orarie» nelle «Impostazioni dei contenuti»; «Prossima fascia libera» nell'editor.

**Test:** unit: fascia occupata saltata, nessuna fascia (null), la settimana che ricomincia, le 02:30 dei due cambi; integrazione: permessi, isolamento, matrice; E2E della sezione e del pulsante dell'editor.

**Fine:** `pnpm verify` verde; Matteo ha visto prima e dopo.

## Task 10 · In blocco da file e «Duplica»

**Obiettivo:** cinquanta file diventano un mese di post in una schermata, e un post si copia su altre date o altri clienti (§11.6, RF-43).

**Due PR:** (1) server: `bulk_imports`, `bulk.import`, «Duplica»; (2) pannello: la tabella, il riepilogo e «Duplica».

**Cosa fa:**
- **migrazione** `bulk_imports` (`id`, `organization_id`, `workspace_id`, `created_by`, `source` `files | csv | duplicate`, `rows` jsonb con l'esito di ogni riga, `status` `pending | running | done | undone`, `summary`, `created_at`, `finished_at`), RLS;
- **`createScheduled(tx, actor, input)`** in `posts` (P5): bozza e programmazione nella transazione del chiamante, con i lavori da mandare dopo il commit;
- **`bulk.import`** (P5): una riga per transazione con `createScheduled`, l'esito e la versione del post scritti in `rows` nella stessa transazione; l'esito di ogni riga (`scheduled`, `draft` con i controlli che bloccano, `failed` con il codice); evento `bulk.completed` con il suo `NotificationKind` (pannello, regola nuova `initiator`) e i vincoli `check` dei tipi in una migrazione; `undoBulkImport` (P5, finestra e versione controllate dal server);
- **rotte** `POST …/workspaces/[id]/bulk-imports` (righe validate da Zod: al massimo 50), `GET …/bulk-imports/[importId]`, `POST …/bulk-imports/[importId]/undo`; `POST …/posts/[postId]/duplicate` (scelta 9);
- **pannello:** «In blocco» dal calendario del cliente e da «Nuovo post»; caricamento con l'avanzamento per file e totale (`useUploads` che c'è), la tabella modificabile, «Unisci in un carosello», «Distribuisci sulle fasce libere», «Programma», il riepilogo con «Annulla»; «Duplica» nel menu della scheda del calendario e sulla pagina dell'esito.

**Test:** integrazione del worker: 20 righe con 2 bloccate (18 programmati, 2 bozze), il worker ucciso alla riga 7, «Annulla» con una bozza già toccata (resta); «Duplica» su un cliente dove la persona non scrive (404), con i testi per piattaforma, e su un altro cliente senza file né etichette; batteria d'isolamento (`ORG_CASES`) e matrice; E2E della tabella con 5 file e del riepilogo, axe.

**Fine:** `pnpm verify` verde; D-101 riletta (con «Duplica» l'opzione (a) è completa); Matteo ha visto prima e dopo.

## Task 11 · CSV ed Excel

**Obiettivo:** un foglio preparato altrove diventa righe della stessa tabella (§11.6 punto 2).

**Cosa fa:** `apps/web/app/utils/sheet-import.ts` (P6, scelta 8): CSV con le virgolette, `;` o `,`, BOM; `.xlsx` con il lettore di zip della tappa 7 (il primo foglio letto da `workbook.xml` e dalle sue relazioni, non per nome; `sharedStrings.xml` e `inlineStr`; date come numeri di serie di Excel, anche con `date1904` di Numbers e di Excel per Mac); colonne in italiano o in inglese; abbinamento dei file per nome e degli account per username o nome della Pagina; errori per riga; il modello da scaricare. Le righe entrano nella tabella del Task 10, che le manda come sempre.

**Test:** unit con file veri di esempio in `apps/web/tests/fixtures/` (CSV di Excel italiano con `;`, CSV di Google Fogli, `.xlsx` di Excel e di Numbers), date come testo e come numero, una riga con un account sconosciuto, un file che manca; E2E dell'importazione con il modello.

**Fine:** `pnpm verify` verde; il modello nella guida della prova.

## Task 12 · Griglia di Instagram riordinabile

**Obiettivo:** prima di programmare, si vede come starà il profilo, e si cambia l'ordine trascinando (§11.5, RF-41).

**Cosa fa:**
- **Meta** (P4, ADR 019): un metodo nuovo della porta della piattaforma (`PlatformConnector.listGridMedia(credentials, account, { limit: 30 })` e `getGridMedia(credentials, account, mediaId)`), fatto da `platforms/meta` con un insieme di campi suo (`igMediaFields` resta com'è: lo usa la ricerca dell'esito incerto); finto Graph API con `media_url` e `thumbnail_url`. Account e token si leggono in una transazione, la chiamata a Meta è fuori; conta nel rallentamento (D-111);
- **miniatura** passata dal server (P4): il media deve essere dell'Instagram di quell'account, l'indirizzo è quello che dà Meta, host ammessi, solo immagini, al massimo 5 MB, `Cache-Control: private, max-age=300`;
- **lettura** `getGrid` in `application/src/calendar/grid.ts`: i programmati dei prossimi 30 giorni (`listPostsInRange`) con la loro copia per il feed, sopra i pubblicati;
- **scambio:** una funzione pubblica nuova di `posts`, `swapScheduledTimes(tx, actor, a, b)`, con le due versioni, il lucchetto della programmazione, i controlli e i lavori dopo il commit, in una transazione: gli orari si scambiano solo se entrambi passano, altrimenti nessuno; la rotta `POST …/calendar/grid/swap` la chiama; «Annulla»;
- **pannello:** scheda «Griglia» del cliente, un selettore dell'account, 3 colonne 3:4, trascinamento solo tra i programmati, «Scambia con…» da tastiera e telefono.

**Dipende da** PR #328 della tappa 8 (il web sulla rete `egress`).

**Test:** integrazione con il finto Graph API (token scaduto: la griglia mostra i programmati e dice che i pubblicati non si leggono; un `mediaId` di un altro account dello stesso token dà 404; un indirizzo fuori dagli host ammessi non si scarica), lo scambio con una versione vecchia (nessuno si sposta), l'isolamento della rotta della miniatura; E2E della griglia e dello scambio, axe.

**Fine:** `pnpm verify` verde; «non verificato su Meta vera» nella guida; Matteo ha visto prima e dopo.

## Task 13 · Correzioni della revisione, rilascio 0.15.0 e guida della prova

**Obiettivo:** la 0.15.0 installata sulla VPS e provata da Matteo.

**Cosa fa:**
- le correzioni scelte da Matteo sulla revisione di fine tappa;
- `README.md` e la landing (`apps/site`): «In arrivo» tolto da calendario, piano editoriale e programmazione in blocco in `apps/site/app/features.ts`, testi e schermate;
- la PR di rilascio 0.15.0 (release-please) e le note «Cosa provare»;
- la guida della prova in `/mnt/project-files/handoff/tappa-9/GUIDA-prova-0.15.0.md`: un mese pianificato per il cliente di prova, due contenuti preparati dall'editor e uno annullato che torna «Da preparare» (piano generale), il calendario nelle tre viste e i filtri, il trascinamento, 20 file in blocco con le fasce, un CSV e un `.xlsx` veri, «Duplica», la griglia su Instagram vera, la notifica «da preparare» e la sezione del riepilogo il giorno dopo; le prove rimaste di D-82.

**Fine:** criteri del piano generale §7; il piano della tappa 10 scritto sul codice reale.

## Fuori da questa tappa

- La stampa e il PDF del piano editoriale e del calendario cliente, e i contenuti pianificati nel link cliente: tappa 10.
- Le attività della 1.5, che useranno lo stesso registro delle voci del calendario.
- Accendere o spegnere i moduli dal pannello (oggi solo dalla CLI, P2).
- Riordinare i pubblicati nella griglia (Instagram non lo permette) e le storie nella griglia.
