# Tappa 10 · Condivisione e brand: il mese del cliente in un link, il marchio dell'agenzia ovunque

> **Per chi esegue:** usa superpowers:executing-plans. Le regole di `AGENTS.md` prevalgono: un solo agente per task e un revisore separato per ogni PR. Il formato è leggero (piano generale §1): per ogni task trovi obiettivo, file, firme, test e criteri di fine; il codice si scrive nella PR. **I task sono raggruppati in thread** (vedi «Come si divide il lavoro»): ogni thread finisce con un handoff in `/mnt/project-files/handoff/tappa-10/` e chiede al coordinatore il thread successivo. Come esempi si prendono l'ingresso pubblico dei media (`apps/web/server/public-host/listener.ts`, `application/src/media/public-file.ts`), il logo dell'agenzia della tappa 4 (`application/src/organizations/logo.ts`) e le letture del calendario della tappa 9 (`application/src/calendar/read.ts`, il registro `calendarEntries`). Se specifica, piano e codice non sono d'accordo, fermati e segnala.

**Obiettivo:** l'agenzia manda al cliente un link e il cliente vede il suo mese, e quelli dopo, come un calendario da appendere: le miniature, gli orari, i post già usciti e i contenuti in preparazione, con i loghi del cliente e dell'agenzia. Non vede mai bozze, note, autori o problemi. Dallo stesso link, e dal calendario del cliente nel pannello, si stampa o si salva un PDF di un mese per pagina, e così anche il piano editoriale. L'agenzia mette il suo logo e il suo colore nel link, nelle email e nella stampa. Il pannello si installa sul telefono come un'app, e su Android si condivide una foto dalla galleria direttamente a Feedway. Insieme entrano:
- gli aggiornamenti delle dipendenze rimandati dopo la tappa 9 (D-133);
- ciò che resta del sito pubblico anticipato (D-122) e che non dipende da Matteo.

Requisiti: RF-46 (parte del cliente), RF-63, RF-71, RF-72, RF-73 (ciò che resta), CS6.

**Specifica:**
- §11.10 link di sola visione e «Stampa o salva PDF», §11.12 contenuti in preparazione nel link e stampa del piano, §11.11 PWA e «Condividi verso Feedway»;
- §14.3 tema e brand, §14.4 «Calendario condiviso», §14.5 sito pubblico;
- §10.2 «Creare e revocare link cliente» (`share_link.manage`, già nel codice) e «Integrazioni, brand» (`organization.settings.manage`);
- §13 `share_links` e `branding`; §15.3–15.4 richieste e file; §16.1 host pubblico (`/m/*` e `/share/*`);
- brief `design/brief-feedway/03-BRIEF-APP.md` (link cliente) e `04-BRIEF-LANDING.md` (sito); `DESIGN.md`, «Regole del ridisegno per ogni pagina» e «Calendario e pianificazione».

**ADR:** 005 (host pubblico separato), 013 (sito statico), 017 (email), 019 (moduli). Una ADR nuova, **024 · La pagina del cliente sull'ingresso pubblico** (P1), nel Task 5.

**Stato di partenza** (codice di `main` al 2026-11-27, `b0341d6`, con la tappa 9 chiusa e la 0.15.0 in rilascio):
- già fatto:
  - **Ingresso pubblico:** un listener Node a parte sulla porta pubblica, senza niente del pannello montato (niente Nuxt, sessione, cookie). Risponde solo a `GET`/`HEAD` di `/m/{token}.{jpg|mp4}` e `/robots.txt`; il resto, `/share/*` compreso, dà 404 in testo semplice (405 con `allow: GET, HEAD` per gli altri metodi: il `POST` della password del Task 5 cambia questa regola per `/share/*`). Ogni risposta ha `x-robots-tag: noindex`, `content-security-policy: default-src 'none'; sandbox`, `referrer-policy: no-referrer`; al massimo 3 letture insieme (`MAX_LOOKUPS`). Tailscale Funnel monta già `/share/` verso `web:3001` (`docker/tailscale-public/serve.json`). Il middleware `01.public-paths` del pannello dà 404 a `/m/*` e `/share/*`;
  - **File pubblici:** `readPublicMediaFile` trova la copia per token con `runAsSystem` (`media/public-file.ts`, in `RUN_AS_SYSTEM_ALLOWED`); le copie con token sono solo quelle da pubblicare. Anteprime e miniature dei post non hanno token pubblici;
  - **Brand:** tabella `branding` con la sola `logo_key` (`org/<id>/logo/<hash>`, file `.webp` da 256 e 64 px), caricata dall'Owner con la riconferma (`organizations/logo.ts`, rotte `…/logo`), mostrata nel menu. Le email hanno il logo di Feedway allegato (`infrastructure/src/mail/email-logo.ts`, PNG) e nessun dato dell'agenzia. `workspaces.logo_key` esiste nella tabella ma non la usa nessuno: la foto del cliente nel pannello è quella del profilo (`social_accounts.avatar_key`). Il colore lo sceglie ogni persona tra i temi di D-22 (Feedway, Blu, Verde, Viola, Grafite);
  - **Permessi:** `share_link.manage` c'è già in `domain/src/authz/permissions.ts` e nei ruoli (Owner, Admin, Manager); nessuna rotta lo usa;
  - **Calendario e piano (tappa 9):** `getCalendar` legge fino a 42 giorni di post e voci dei moduli accesi; `listPostsInRange` (funzione pubblica di `posts`) con il predicato `notTrashed`; il modulo `plan` registra `calendarEntries` e `markedPostIds`; i campi della voce del piano sono dichiarati uno per uno e la nota non esce dal Piano editoriale. Nessun `@media print` nel pannello;
  - **PWA:** `apps/web/public/brand/site.webmanifest` (nome, `display: standalone`, icone 192, 512 e maskable) collegato da `nuxt.config.ts`; nessun service worker, nessun `share_target`. `@vite-pwa/nuxt` è la scelta di `docs/stack.md` ma non è installato;
  - **Sito pubblico:** `apps/site` con landing, `/privacy`, `/cancellazione-dati`, `/termini`, il modulo della demo e `features.ts` con i segni «In arrivo», pubblicato su `https://feedway.pages.dev` (D-122). Il thread della 0.15.0 lo sta aggiornando: questo piano non lo tocca fino al Task 10;
  - **Dipendenze:** Renovate tiene aperte le PR 72 (minor e patch, `lint-types` rosso), 71 (Better Auth 1.7.27, integrazione rossa) e 136 (`release-please-action` v5) (D-133).
- non c'è ancora: la tabella `share_links`, ogni rotta e pagina del link, il colore e il piè delle email dell'agenzia, la stampa, il service worker, «Condividi verso Feedway».

**Dipendenze nuove:** `@vite-pwa/nuxt` (prevista da `docs/stack.md` e dalla specifica §7.4, quindi senza ADR), solo nel Task 8. Nessun'altra: la pagina del cliente e la stampa sono HTML e CSS nostri, il PDF lo fa il browser.

## Aggiornamenti rispetto alla specifica

Da riportare nella specifica nella PR del task che li introduce.

| # | Specifica | Piano | Motivo |
|---|---|---|---|
| P1 | §11.10 e §16.1: la pagina del link sta su `PUBLIC_HOST`, senza dire come si disegna | La pagina `/share/<token>` è **HTML scritto dal server** sull'ingresso pubblico che c'è (il listener Node), con un modulo di resa senza framework come quello delle email (`renderEmail`), il CSS dei token di `packages/ui` in linea con il suo hash nella CSP, e **un solo script** (il pulsante «Stampa», con l'hash). Tutto funziona anche senza JavaScript: l'anteprima di un post è una pagina sua (`/share/<token>/post/<id>`). ADR 024 | Montare Nuxt sull'ingresso pubblico romperebbe la separazione dell'ADR 005 (niente del pannello su quella porta); un'app a parte sarebbe un secondo build da tenere. Il listener ha già intestazioni, limiti e log |
| P2 | §11.10: «miniature dedicate con token propri» | Miniature, video di anteprima e loghi passano **sotto il token del link**: `/share/<token>/f/<fileId>.jpg` (o `.mp4`), `/share/<token>/logo/{agenzia,cliente}.webp`. A ogni richiesta il server ricontrolla che il link sia attivo e che il file sia di un post che quel link mostra, con «Anteprime» accese. Nessuna tabella di token per file | La revoca chiude subito anche le immagini; nessun token che sopravvive al link; nessun indirizzo del pannello |
| P3 | §11.10: «password facoltativa» | La password si chiede con un modulo `POST /share/<token>`; quella giusta dà un cookie **solo di quel link** (`fw_share`, `Path=/share/<token>`, `HttpOnly`, `Secure`, `SameSite=Lax`, 12 ore), firmato con una chiave del server e legato alla versione della password, così cambiarla chiude le sessioni aperte. Tentativi limitati per link e per IP con il `RateLimiter` | L'host pubblico resta senza cookie del pannello (§11.10); un cookie per percorso non vale per gli altri link |
| P4 | §13 `share_links`: `token_hash` | Token di 32 caratteri base62 (circa 190 bit) e `token_hash` = SHA-256: con tanta casualità un hash lento non serve e la ricerca è per indice. La password, scelta da una persona, va con argon2id (`PasswordHasher`). La tabella guadagna `organization_id` (RLS, chiavi composte come le altre), `password_version` e `created_at` | Ricerca veloce senza indebolire niente; l'isolamento vuole `organization_id` |
| P5 | §11.10: «Stesso pulsante anche nel calendario del pannello» | **Un solo modulo di resa** per la vista del cliente, usato dall'ingresso pubblico e da una rotta del pannello (`GET /stampa/[org]/[slug]`, con la sessione e `share_link.manage`), che cambia solo gli indirizzi delle immagini. La stampa del Piano editoriale usa lo stesso modulo con le schede piene | Il pannello non può disegnare la vista del cliente con i suoi componenti senza che un campo interno scappi; con un modulo solo la lista dei campi dichiarati vale per entrambi |
| P6 | §11.10: «solo da programmato in poi (programmati, in pubblicazione, pubblicati)» | Il cliente vede tre stati: **«Programmato»** (ora futura), **«Pubblicato»** (con i link dei post usciti, se l'opzione è accesa) e **«In uscita»** per un post la cui ora è passata e che non è ancora uscito del tutto (in pubblicazione, in verifica, non riuscito su una destinazione). Mai l'errore. In pausa, bozze, annullati ed eliminati non ci sono | Un post non riuscito che sparisce lascerebbe un buco; un errore tecnico al cliente non serve (scelta 4) |
| P7 | §14.3: «Logo e colore principale per organizzazione: pannello, email, bot, link cliente» | Il **colore** dell'agenzia va nel link, nella stampa e nelle email (striscia in testa e pulsante); **nel pannello no**: lì resta il tema che ogni persona sceglie (D-22). Nel pannello c'è il logo, come oggi. Nel **bot** il logo non si può mettere per messaggio: i messaggi dell'agenzia portano il suo nome, e la foto del bot dell'agenzia si mette da BotFather (guida) | Il colore di un'agenzia sopra i temi delle persone rompe i contrasti verificati e la regola «un solo arancio»; Telegram non ha immagini per messaggio senza mandarle come foto (scelta 7) |
| P8 | §13 `branding`: «il branding della piattaforma arriva con la tappa 10» | Il brand della **piattaforma** (pagina di accesso, email di sicurezza, intestazione del link) resta quello del repository: `PRODUCT_NAME` e i file di `apps/web/public/brand/`. Niente caricamento dal pannello per la piattaforma nella 1.0 | Oggi la piattaforma è solo Feedway; un caricamento in più è una pagina e una tabella senza chi le usa (scelta 8) |
| P9 | §11.11: «Condividi verso Feedway dalla galleria su Android» | Il service worker riceve la condivisione (`share_target` con `POST` e `multipart/form-data`), tiene i file nel browser e apre `/condividi`, che chiede il cliente e li carica nella libreria con il caricamento che c'è, poi offre «Usa in un post». Il server non riceve mai una condivisione diretta | Il `POST` dal sistema non porta il token CSRF e forse nemmeno il cookie; passando dal service worker resta tutto sulle rotte di oggi |
| P10 | §11.1 punto 7: la copia `preview` «servita solo dal pannello, mai dall'host pubblico»; il link usa la variante `share` | Il link serve sotto il suo token (P2) le copie che ci sono: `thumbnail` (JPEG) per le miniature e la copertina, `preview` (MP4 H.264 720p) per vedere un video nell'anteprima del post. La variante `share` resta nel dominio senza che il worker la produca | Il divieto di §11.1 nasce dal fatto che `preview` non ha un token pubblico; sotto il token del link, ricontrollato a ogni richiesta, la protezione è la stessa. Una copia `share` per ogni video sarebbe lavoro del worker e spazio in più per un file uguale (scelta 15) |
| P11 | §14.3: «Logo del singolo cliente facoltativo, caricato dallo spazio» (`workspaces.logo_key`) | Il logo del cliente nel link e nella stampa è la **foto del primo profilo del cliente** (il primo con Instagram, altrimenti il primo), già copiata nello storage (`social_accounts.avatar_key`); senza foto, il nome. Il caricamento dalla pagina del cliente resta per dopo, e `workspaces.logo_key` resta inusata | È la foto che il pannello mostra già per il cliente; un caricamento in più è una pagina senza chi la chieda (scelta 16) |
| P12 | §11.11: «Senza rete la PWA mostra cosa è in coda e riprende quando la rete torna» | Senza rete la PWA mostra solo la pagina «Sei senza rete». La coda dei caricamenti senza rete si valuta dopo la prova | Il caricamento di oggi vive nella pagina aperta; tenerlo nel service worker è un lavoro a sé, da fare se la prova lo chiede (scelta 11) |
| P13 | §13 `share_links` e `branding` | `share_links` guadagna anche `updated_at`; `branding` guadagna `primary_color`, `on_primary` (`light`/`dark`, calcolato dal server) ed `email_footer` (Task 2) | La specifica §13 si aggiorna con le colonne vere |

## Regole della tappa

- **Moduli:**
  - `sharing` (nuovo): link, vista del cliente e stampa. `domain/src/sharing/`, `application/src/sharing/`, `infrastructure/src/db/sharing/`, `contracts/src/api/sharing.ts`, rotte in `apps/web/server/api/v1/orgs/[org]/workspaces/[id]/share-links/`, ingresso pubblico in `apps/web/server/public-host/share/`. Legge i post con una funzione pubblica nuova di `posts`, `listClientPosts(tx, { organizationId, workspaceId, from, to, timeZone })`, che non vuole una persona (il link non ne ha: `listPostsInRange` prende un `OrgActor` e filtra sui clienti visibili) e dà solo i post da «programmato» in poi con i campi che servono alla vista; le voci del piano con una funzione pubblica nuova di `plan` (`clientPlanEntries`, solo tipo, titolo, giorno e ora). Dipende da `posts` e `plan`, mai il contrario: una regola di dependency-cruiser lo verifica.
  - `organizations` (esistente) guadagna colore e piè delle email in `branding`.
  - La PWA è del guscio del pannello (`apps/web`), non un modulo.
- **Campi dichiarati:** la vista del cliente è un tipo chiuso (`ClientViewPost`, `ClientViewPlanItem`, `ClientViewMonth`) costruito copiando i campi uno per uno, mai con lo spread di un DTO del pannello. Un test elenca le chiavi ammesse e fallisce se ne compare un'altra; un altro cerca nella pagina resa la nota, il nome dell'autore, le etichette e il testo di un errore di un post di prova, e non deve trovarli.
- **Isolamento:** `share_links` ha `organization_id`, chiave composta verso `workspaces`, RLS forzata con `org_isolation` e indice `(organization_id, workspace_id)`; `token_hash` unico. Trovare un link dal token è l'unica lettura senza ambito: `application/src/sharing/resolve.ts` usa `runAsSystem` solo per avere `organizationId`, `workspaceId` e lo stato del link, poi tutto il resto in `uow.run({ organizationId, userId: null })`; il file va in `RUN_AS_SYSTEM_ALLOWED`. Le rotte nuove entrano in `cross-organization.int.test.ts` e `access-matrix.int.test.ts`; l'ingresso pubblico ha una batteria sua (link di un'altra agenzia, file di un altro cliente, link revocato, scaduto, cliente archiviato, agenzia sospesa, modulo `plan` spento).
- **Risposta uguale per ciò che non c'è:** token sconosciuto, revocato o scaduto, cliente archiviato e agenzia sospesa danno la stessa pagina «Questo link non è più attivo», con lo stesso stato (404) e un tempo simile (la ricerca dell'hash si fa sempre). Un file non mostrato dal link dà 404 in testo semplice, come `/m/*`.
- **Date e fusi:** i mesi e «da oggi in poi» si contano nel fuso dell'agenzia (D-58), con le funzioni di `domain/src/time/` e i casi dell'ora legale della tappa 9.
- **Permessi:** creare, cambiare e revocare un link `share_link.manage` sul cliente; vedere l'elenco dei link lo stesso permesso (ha il token in chiaro solo alla creazione: dopo si mostra «Copia» solo per chi lo ha appena creato, scelta 2). Il brand: cambiare `organization.settings.manage` con la riconferma recente, leggere chi è membro. Stampa dal pannello: `share_link.manage` sul cliente; stampa del piano: `plan.view`.
- **Registro attività:** creazione, modifica, cambio della password e revoca di un link; cambio del colore e del piè delle email. Le aperture del link no (sono contatori nel link).
- **Code:** nessuna coda nuova. La pulizia dei link scaduti da più di 12 mesi è della tappa 11 (conservazione).
- **Meta:** nessuna chiamata. La pagina del cliente mostra i link dei post usciti già salvati (`permalink` delle destinazioni).
- **Interfaccia:** ogni pagina nuova o toccata segue lo stile del ridisegno (`DESIGN.md`), con stati vuoto, caricamento, errore e successo, 390 px con la tastiera, axe verde, tema chiaro e scuro. Le schermate nuove si progettano **in codice** con i componenti della tela nuova, come nella tappa 9 (D-123.25), e Matteo vede le schermate prima della fusione (scelta 1). La pagina del cliente segue il tema del sistema del cliente (chiaro o scuro) e stampa sempre chiara.
- **Commit e PR** con l'ambito `sharing` (link, vista, stampa), `organizations` (brand), `web` (PWA), `site` (sito), `infra` o `config` (dipendenze, come le PR di Renovate).
- **Test:** `docs/convenzioni.md` §Test; E2E solo dei file toccati durante il lavoro, `pnpm verify:ci` una volta prima del push.

## Scelte di questa tappa

Hanno la loro voce in `docs/decisioni-aperte.md`: **D-136**, nuova con il piano, provvisoria. Matteo può cambiare ogni punto prima del task che lo usa. D-133 si chiude con il Task 1; D-122 si aggiorna con il Task 10.

1. **Design in codice, schermate prima della fusione:** come nella tappa 9 (D-123.25), niente tavole su Pencil. Le schermate nuove sono la pagina del cliente (computer e telefono, con e senza password, link non attivo, anteprima di un post), la stampa di un mese, il pannello dei link, la sezione «Brand» e la pagina `/condividi`. Alternativa: le tavole prima, sul computer di Matteo con Pencil.
2. **Dove si gestiscono i link:** un pulsante **«Condividi»** nella testata della scheda «Calendario» del cliente, accanto a «Stampa o salva PDF», che apre un pannello laterale: l'elenco dei link (nome, opzioni in breve, «Aperto 3 volte, l'ultima ieri alle 18:04», scadenza, stato) e «Nuovo link». Il token si vede e si copia **solo alla creazione**, come una chiave: nel database c'è solo l'hash. Chi l'ha perso crea un link nuovo e revoca il vecchio. Alternativa: una scheda «Condivisione» nella pagina del cliente.
3. **Opzioni del link** (§11.10), con i predefiniti: testo del post sì, anteprime sì, post già pubblicati sì, contenuti in preparazione sì, «solo i prossimi N giorni» spento (con 30, 60 o 90). Password facoltativa (almeno 8 caratteri), scadenza facoltativa (una data; predefinita nessuna), nome del link obbligatorio («Per Marco», «Stampa di dicembre»). Al massimo **20 link attivi** per cliente.
4. **Stati per il cliente** (P6): «Programmato», «In uscita», «Pubblicato». I contenuti in preparazione restano «In preparazione» finché il post non è programmato, mai «In ritardo» (§11.10).
5. **Fino a quando si vede:** il mese corrente intero (anche i giorni passati, con i post usciti) e i mesi dopo finché ci sono contenuti, al massimo **6 mesi**, o fino al limite dei «prossimi N giorni». La stampa parte da oggi (§11.10).
6. **Telefono:** ogni mese diventa un elenco per giorno con le miniature grandi (§11.10); i giorni senza niente non si mostrano.
7. **Colore dell'agenzia** (P7): un colore solo, scelto da una tavolozza di 12 colori già controllati o con un esadecimale; il server calcola il colore del testo sopra (bianco o carbone) con il calcolo del contrasto di `packages/ui/src/contrast.ts`, portato nel dominio (Task 2) e rifiuta un colore che non arriva a 4,5:1 con nessuno dei due. Senza colore si usa l'arancio di Feedway.
8. **Brand della piattaforma** (P8): resta nei file del repository; nessun caricamento.
9. **Email con il brand dell'agenzia:** le email legate a un'agenzia (notifiche, riepilogo, invito in un'agenzia) portano in testa il logo e il colore dell'agenzia, in fondo il piè scelto dall'Owner (fino a 300 caratteri, testo semplice) e «Inviato con Feedway». Le email di sicurezza dell'account (reset, cambio email, nuovo accesso) restano con il solo brand di Feedway, perché una persona può stare in più agenzie. Il logo nelle email è un PNG (molti programmi di posta non leggono WebP): il caricamento del logo ne crea una copia `.png` da 256 px, e i loghi già caricati la ricevono al primo invio.
10. **Stampa del Piano editoriale:** il mese mostrato e i successivi con contenuti, fino a 6, un mese per pagina, schede piene con tipo, titolo e ora; mai la nota. Si stampa da «Piano editoriale» per chi ha `plan.view`.
11. **PWA** (§11.11, P9): `@vite-pwa/nuxt` con un service worker nostro (`injectManifest`), che tiene in cache solo i file del pannello con il nome che cambia a ogni versione (`/_nuxt/*`), i caratteri e una pagina «Sei senza rete», mai le API, `/m/*` o le pagine con dati. Un aggiornamento si prende al prossimo avvio, con l'avviso «C'è una versione nuova · Ricarica». Nel menu «Tu» del telefono la voce «Installa l'app» quando il browser lo permette, e una pagina d'aiuto per iPhone («Condividi → Aggiungi alla schermata Home»).
12. **Condividi verso Feedway:** solo foto e video (fino a 20 file, come il caricamento); `/condividi` chiede il cliente (solo quelli in cui la persona può caricare), carica nella cartella principale della libreria del cliente e mostra «Usa in un post». Senza accesso porta prima all'accesso e poi torna lì, con i file ancora nel browser per 30 minuti.
13. **Sito pubblico, ciò che resta** (D-122): nel Task 10 solo ciò che non aspetta Matteo: tema automatico chiaro e scuro, testi in `apps/site/i18n/`, dati strutturati, anteprima dei link in PNG 1200×630, pagine legali e modulo della demo nello stile del ridisegno, anteprima su un indirizzo provvisorio per ogni PR, `site` tra i controlli obbligatori. Restano a Matteo: dominio ed Email Routing, partita IVA e note legali, Web Analytics (sì o no), «Accedi» (oggi nascosto: il pannello è dentro Tailscale).
14. **Rilascio:** la tappa esce come **0.16.0**.
15. **File nel link** (P10): miniature e copertine dalla copia `thumbnail`, video dalla copia `preview`, sempre sotto il token del link.
16. **Logo del cliente** (P11): la foto del primo profilo (il primo con Instagram, altrimenti il primo); il caricamento di un logo del cliente dopo.

## Come si divide il lavoro

Undici task, ognuno una PR (o più dove il task lo dice), in otto thread più la revisione di fine tappa.

| Thread | Task | Dipende da | Perché insieme |
|---|---|---|---|
| A · Dipendenze | Task 1 · Aggiornamenti rimandati (D-133) | — | Tocca solo lockfile e strumenti; va prima perché ogni altro thread ne eredita il lockfile |
| B · Brand | Task 2 · Colore e piè dell'agenzia, server; Task 3 · Brand nel pannello e nelle email | il 3 il 2 | Dati e pagina dello stesso brand |
| C · Link, server | Task 4 · Tabella, dominio e casi d'uso dei link; Task 5 · Vista del cliente e pagina pubblica | il 5 il 4; per il colore il Task 2 (senza, l'arancio di Feedway) | Il link e ciò che mostra, tutto lato server |
| D · Link, pannello | Task 6 · I link nel pannello | il Task 4 | Le pagine del pannello, parti diverse dal thread C |
| E · Stampa | Task 7 · Stampa o salva PDF, del link, del cliente e del piano | il Task 5 | Un foglio di stampa e il PDF provato con Playwright |
| F · PWA | Task 8 · App installabile e service worker; Task 9 · Condividi verso Feedway | il 9 l'8; l'8 il Task 1 | Il service worker serve a entrambi |
| G · Sito | Task 10 · Il sito pubblico, ciò che resta | la 0.15.0 rilasciata (il thread del rilascio tocca `apps/site`) | Solo `apps/site` |
| — | Revisione di fine tappa (thread separato, istruzioni del progetto) | A–G | |
| H · Rilascio | Task 11 · Correzioni della revisione, rilascio 0.16.0 e guida della prova | revisione | |

- **Prima il Task 1:** finché la PR delle dipendenze non è fusa, gli altri thread non aggiungono pacchetti (il Task 8 aggiunge `@vite-pwa/nuxt`). B, C e G possono partire insieme al Task 1 se non toccano il lockfile; D e E partono dopo il Task 4 e il Task 5.
- **Migrazioni:** il Task 2 (`branding`) e il Task 4 (`share_links`) chiedono il numero al coordinatore prima di crearle.
- **Dentro un thread** i task vanno in ordine, una PR alla volta: si fonde la prima, poi si parte dalla `main` aggiornata. `pnpm verify:ci` una volta prima di ogni push.
- **Se il contesto non basta**, il thread fa il suo primo task, scrive l'handoff e chiede al coordinatore un thread nuovo per il secondo.
- **A fine thread** l'handoff in `/mnt/project-files/handoff/tappa-10/HANDOFF-thread-<lettera>.md` (fatto, PR, scelte prese, cosa resta, non verificato, cosa serve al thread dopo), poi la richiesta al coordinatore del thread successivo.
- **Rilascio:** nessun task tocca versioni, changelog o PR di release-please prima del Task 11.

## Review Focus

Oltre al piano generale §8:
1. **Niente esce dal link che non deve:** nota del piano, note dei post, autori, etichette, account per id, stati interni, errori di Meta, bozze, post in pausa, annullati o negli «Eliminati», post di un altro cliente della stessa agenzia; la stessa lista per la stampa dal pannello (Task 5, 7).
2. **Revoca e scadenza subito:** dopo «Revoca» la pagina, le miniature, i video e i loghi danno «non più attivo» o 404 alla richiesta dopo, anche con un cookie della password ancora valido; cambiare la password chiude le sessioni aperte (Task 4, 5).
3. **Isolamento:** un token di un'altra agenzia, un `fileId` di un post di un altro cliente sotto un token valido, un link di un cliente archiviato o di un'agenzia sospesa, la rotta di stampa di un cliente che la persona non vede (Task 4, 5, 7).
4. **Forza bruta ed enumerazione:** stessa risposta e tempo simile per token sconosciuto, revocato e scaduto; tentativi di password limitati per link e per IP; nessun token nei log (`pathForLog` taglia già dopo `/share/`) (Task 5).
5. **Ora legale e «da oggi»:** un post alle 02:30 del 25/10/2026 e del 28/03/2027 nel giorno giusto della pagina e della stampa; «da oggi» alle 23:59 e alle 00:00 di Roma (Task 5, 7).
6. **Moduli spenti:** con `plan` spento niente «In preparazione» nel link, nella stampa e nella stampa del piano (404) (Task 5, 7).
7. **Service worker:** nessuna risposta delle API, di `/m/*` o di una pagina con dati in cache; dopo «Esci» nessun dato della persona leggibile offline; una versione nuova non resta bloccata dalla cache (Task 8, 9).
8. **Colore e contrasti:** un colore troppo chiaro o troppo scuro rifiutato dal server, non solo dal pannello; email e link leggibili con ogni colore ammesso (Task 2, 3, 5).

---

## Task 1 · Aggiornamenti delle dipendenze rimandati (D-133)

**Obiettivo:** gli aggiornamenti tenuti fermi per la prova della tappa 9 entrano prima del lavoro nuovo, con la CI verde.

**Cosa fa:**
- PR 72 di Renovate (minor e patch, tra cui `@nuxt/ui` 4.13, `nuxt-security` 2.7, pnpm 12.21, vitest 5.1, Prettier 3.10): `lint-types` di nuovo verde, correggendo il codice e mai abbassando le regole; se un pacchetto non si sistema in poco, esce dal gruppo con una regola di Renovate e una riga in D-133;
- PR 71, Better Auth 1.7.27: solo con `pnpm test:auth-contract` verde (ADR 012); se un test di contratto cambia, il thread si ferma e lo dice;
- PR 136, `release-please-action` v5: provata su un ramo con una PR di rilascio di prova, senza fonderla; se cambia il formato del changelog o dei tag, si ferma e propone;
- `pnpm audit` pulito; le schermate E2E di tutte le pagine nei quattro progetti, perché `@nuxt/ui` cambia componenti (Matteo vede le differenze visibili prima e dopo, se ci sono).

**Test:** la CI intera; `test:auth-contract`; nessun test nuovo salvo quelli che servono a un cambiamento.

**Fine:** PR 71 e 72 fuse (o gli esclusi scritti in D-133 con il motivo), la 136 provata con l'esito scritto; D-133 chiusa o ridotta a ciò che resta.

## Task 2 · Colore e piè dell'agenzia, server

**Obiettivo:** l'agenzia ha un colore e un piè delle email salvati e controllati, e un logo che le email sanno mostrare.

**Cosa fa:**
- **Migrazione** (numero dal coordinatore): `branding.primary_color` (`#rrggbb` o null, `CHECK`), `branding.on_primary` (`light`/`dark`, calcolato), `branding.email_footer` (fino a 300 caratteri o null);
- **Dominio** `domain/src/organizations/branding.ts`: `parseBrandColor`, `onColorFor(hex)` (bianco o carbone; il calcolo del contrasto WCAG passa da `packages/ui/src/contrast.ts` al dominio, che `packages/ui` poi importa, perché il dominio non può importare `packages/ui` (`.dependency-cruiser.cjs`, `domain-no-outside`); errore `BRAND_COLOR_LOW_CONTRAST` sotto 4,5:1 per entrambi), `BRAND_PALETTE` (12 colori controllati da un test), `normalizeEmailFooter` (testo semplice, righe vuote compresse);
- **Casi d'uso** `getBranding(tx, organizationId)` (funzione pubblica, usata da email, link e stampa) e `updateBranding(deps, actor, session, input)`: Owner, riconferma recente, agenzia attiva, registro attività (come `logo.ts`);
- **Logo per le email:** il caricamento del logo crea anche `<key>.png` (256 px, sfondo trasparente); `emailLogoFor(organizationId)` crea la copia che manca per un logo vecchio e la tiene;
- **Rotte:** `GET /api/v1/orgs/[org]/branding` (ogni membro), `PATCH …/branding` (Owner), in OpenAPI.

**Test:**
- unit: contrasto della tavolozza, un giallo chiaro rifiutato, un blu scuro con il testo bianco; il piè con HTML che resta testo;
- integrazione: Owner con e senza riconferma, Admin 403, agenzia sospesa, la copia PNG di un logo vecchio, voce del registro; rotte nella batteria d'isolamento e nella matrice.

**Fine:** `pnpm verify` verde.

## Task 3 · Brand nel pannello e nelle email

**Obiettivo:** l'Owner sceglie il colore e il piè, li vede come li vedrà il cliente, e le email dell'agenzia li portano.

**Cosa fa:**
- **Impostazioni → Agenzia:** la sezione «Brand» (dove c'è già il logo) con la tavolozza, il campo esadecimale, l'anteprima di una testata del link e di un'email accanto, il piè delle email; Admin in sola lettura;
- **Email** (scelta 9): `renderEmail` riceve un brand facoltativo (logo PNG allegato come quello di Feedway, colore della striscia e del pulsante, piè); i mittenti delle notifiche, del riepilogo e dell'invito in un'agenzia lo passano; le email di sicurezza no;
- **Telegram:** i messaggi di un'agenzia iniziano con il suo nome se la persona sta in più agenzie (oggi da controllare in `telegram-format.ts`); la guida dice come mettere la foto del bot dell'agenzia da BotFather.

**Test:** unit di `renderEmail` con e senza brand (nessun colore fuori dal controllo, piè come testo, «Inviato con Feedway»); integrazione dell'email di una notifica con il logo dell'agenzia allegato; E2E della sezione «Brand» a 390 e 1440, chiaro e scuro, axe.

**Fine:** `pnpm verify` verde; Matteo ha visto le schermate e un'email vera nella sua casella.

## Task 4 · Tabella, dominio e casi d'uso dei link

**Obiettivo:** un link si crea, si cambia, si revoca e si trova dal token, dentro l'agenzia giusta.

**Cosa fa:**
- **Migrazione** (numero dal coordinatore): `share_links` (`id`, `organization_id`, `workspace_id`, `token_hash` unico, `label`, `created_by`, `options` jsonb, `password_hash`, `password_version`, `expires_at`, `revoked_at`, `last_viewed_at`, `view_count`, `created_at`, `updated_at`), chiave composta verso `workspaces`, RLS forzata, indice `(organization_id, workspace_id)`;
- **Dominio** `domain/src/sharing/`: `ShareLinkOptions` (Zod, predefiniti della scelta 3), `shareLinkState(link, now)` → `active | revoked | expired`, `newShareToken()` (32 caratteri base62 dalla porta di casualità), `SHARE_LINKS_PER_WORKSPACE = 20`;
- **Casi d'uso** `application/src/sharing/links.ts`: `createShareLink` (dà il token in chiaro una volta sola), `listShareLinks`, `updateShareLink` (nome, opzioni, scadenza, password messa o tolta, che alza `password_version`), `revokeShareLink`; tutti con `share_link.manage` sul cliente, il cliente non archiviato e il registro attività;
- **Risoluzione** `application/src/sharing/resolve.ts`: `resolveShareToken(deps, token)` con `runAsSystem` (aggiunto a `RUN_AS_SYSTEM_ALLOWED`) che dà solo `{ organizationId, workspaceId, linkId, state }`, poi `recordShareView` in `uow.run({ organizationId, userId: null })` (al massimo una volta al minuto per link, per non scrivere a ogni immagine);
- **Contratti e rotte:** `GET/POST /api/v1/orgs/[org]/workspaces/[id]/share-links`, `PATCH/DELETE …/share-links/[linkId]` (`DELETE` = revoca), in OpenAPI; regola di dependency-cruiser: `posts` e `plan` non importano `sharing`.

**Test:**
- unit: stati del link a cavallo della scadenza; opzioni con valori sconosciuti; il token di 32 caratteri e il suo hash;
- integrazione: il ventunesimo link rifiutato; un Editor 403; cliente archiviato 409; token di un'altra agenzia che non si trova con l'ambito sbagliato; `password_version` che sale; righe del registro; rotte nella batteria d'isolamento e nella matrice.

**Fine:** `pnpm verify` verde.

## Task 5 · Vista del cliente e pagina pubblica

**Obiettivo:** chi apre il link vede il calendario del suo cliente, con i loghi, e niente altro.

**Due PR:** (1) lettura della vista e campi dichiarati; (2) pagina pubblica, password, file e ADR 024.

**Cosa fa:**
- **Lettura** `getClientView(deps, link, { now })` in `application/src/sharing/view.ts`: i mesi della scelta 5, con `listClientPosts` di `posts` (senza persona, solo programmati e oltre, non eliminati, P6) e `clientPlanEntries` del modulo `plan` (solo se acceso e con l'opzione accesa, solo tipo, titolo, giorno e ora, «In preparazione» finché il post non è programmato, regola di §11.10); al massimo 42 giorni per lettura, più letture per i mesi; tipi chiusi `ClientViewPost` (giorno, ora, tipo, piattaforme, testo se l'opzione, miniature se l'opzione, link dei post usciti se l'opzione, stato del cliente) e `ClientViewPlanItem`; brand con `getBranding` e la foto del primo profilo del cliente come logo del cliente (P11);
- **Funzione pubblica di `posts`** `listClientPosts` (Regole della tappa, «Moduli»), con il predicato `notTrashed`, la miniatura `thumbnail` e la copia `preview` dei video (P10);
- **Funzione pubblica di `plan`** `clientPlanEntries(tx, { organizationId, workspaceId, from, to })`, che non dà mai la nota;
- **Ingresso pubblico** `apps/web/server/public-host/share/`: le rotte `GET /share/<token>`, `POST /share/<token>` (password), `GET /share/<token>/post/<id>`, `GET /share/<token>/f/<fileId>.{jpg|mp4}` (con i range, come `/m/*`), `GET /share/<token>/logo/{agenzia,cliente}.webp`, `GET /share/_/feedway.svg`; resa in `render.ts` (HTML, CSS dei token in linea, tema del sistema, un solo script per «Stampa»), CSP con gli hash (`default-src 'none'; img-src 'self'; media-src 'self'; style-src 'sha256-…'; script-src 'sha256-…'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`), pagina «Questo link non è più attivo», cookie della password (P3) con la chiave derivata da `APP_ENCRYPTION_KEY` (HKDF, come il gettone della griglia), limiti con il `RateLimiter`;
- **ADR 024** (P1) e la specifica §11.10, §16.1 e §13 aggiornate (P2–P6).

**Test:**
- unit: stati del cliente (P6); mesi mostrati (scelta 5) con il limite dei giorni; chiavi ammesse dei tipi della vista; resa senza dati interni (nota, autore, etichetta, errore di un post di prova);
- integrazione: la batteria dell'ingresso pubblico del Review Focus 2–4 e 6; un post alle 02:30 dei due cambi d'ora; password sbagliata 10 volte e il limite; cookie dopo il cambio della password; `view_count` una volta al minuto;
- E2E sull'ingresso pubblico: il mese al computer e l'elenco a 390 px, l'anteprima di un post, la password, il link revocato, chiaro e scuro, axe.

**Fine:** `pnpm verify` verde; Matteo ha visto le schermate della pagina; ADR 024 proposta.

## Task 6 · I link nel pannello

**Obiettivo:** chi gestisce il cliente crea un link in pochi secondi, lo manda e vede se il cliente l'ha aperto.

**Cosa fa:**
- nella scheda «Calendario» del cliente il pulsante «Condividi» (solo con `share_link.manage`) e il pannello della scelta 2: elenco, «Nuovo link» con nome, opzioni, password e scadenza, il link da copiare subito dopo la creazione («Copia il link», «Apri come il cliente»), modifica, «Revoca» con conferma;
- senza `PUBLIC_URL` il pulsante dice che l'indirizzo pubblico non è configurato e rimanda alla guida;
- telefono: il pannello diventa un foglio dal basso.

**Test:** componenti del modulo (password, scadenza nel passato rifiutata); E2E `share-links.spec.ts`: crea, copia, apre la pagina pubblica, revoca e la pagina dice «non più attivo»; un Editor non vede il pulsante; 390 e 1440, chiaro e scuro, axe.

**Fine:** `pnpm verify` verde; Matteo ha visto le schermate.

## Task 7 · Stampa o salva PDF

**Obiettivo:** il calendario del cliente e il piano si stampano su A4 orizzontale, un mese per pagina, come si mostrano al cliente.

**Cosa fa:**
- **Foglio di stampa** nel modulo di resa del Task 5: `@page { size: A4 landscape }`, un mese per pagina, testata con i loghi, solo da oggi in poi (§11.10), sempre chiaro, miniature piccole con ora e tipo, niente pulsanti;
- **Dal link:** «Stampa o salva PDF» apre la stampa del browser;
- **Dal pannello** (P5): nella scheda «Calendario» del cliente, per chi ha `share_link.manage`, «Stampa o salva PDF» con le opzioni di un link (testo, anteprime, pubblicati, in preparazione) apre `GET /stampa/[org]/[slug]?…` in una scheda nuova, resa con lo stesso modulo e le immagini dalle rotte del pannello; la rotta sta dietro la sessione e il CSRF come le pagine;
- **Piano editoriale** (scelta 10): «Stampa o salva PDF» in `pages/[org]/piano.vue`, `GET /stampa/[org]/[slug]/piano?da=2026-12`, schede piene, mai la nota.

**Test:**
- unit: «da oggi» e i mesi della stampa del piano;
- E2E: Playwright genera il PDF (`page.pdf()` con il foglio di stampa) del link, del cliente e del piano; si controllano il numero di pagine (uno per mese), la misura A4 orizzontale e che il testo del PDF non contenga la nota né «In ritardo»; un Editor che apre `/stampa/…` riceve 404.

**Fine:** `pnpm verify` verde; Matteo ha visto un PDF di ognuno dei tre.

## Task 8 · App installabile e service worker

**Obiettivo:** il pannello si aggiunge alla schermata Home e si apre a schermo intero, senza mai mostrare dati vecchi o di un'altra persona.

**Cosa fa:**
- `@vite-pwa/nuxt` in modo `injectManifest` con `apps/web/app/sw.ts` nostro (scelta 11): cache dei soli file statici con il nome a impronta, dei caratteri e della pagina «Sei senza rete»; tutto il resto passa dalla rete senza cache; il manifest di oggi diventa quello generato (stessi nomi e icone, `id` e `scope` invariati);
- la nuova versione: «C'è una versione nuova · Ricarica»; il service worker vecchio si toglie;
- «Esci» svuota le cache del service worker; la CSP del pannello ammette `worker-src 'self'`;
- «Installa l'app» nel menu «Tu» quando c'è `beforeinstallprompt`, e la pagina d'aiuto per iPhone;
- nella guida: l'app su iPhone e su Android con il pannello dietro Tailscale (`*.ts.net` con HTTPS).

**Test:** unit delle regole di cache (quali indirizzi sì e quali no); E2E con Playwright: il service worker si registra, `/api/*` e `/m/*` non finiscono in cache, la pagina «Sei senza rete» con la rete spenta, «Esci» svuota le cache, l'avviso della versione nuova; Lighthouse «installabile» se gira nel cloud, altrimenti scritto come non verificato.

**Fine:** `pnpm verify` verde; Matteo ha visto l'avviso e il menu.

**Non verificato fino alla prova:** se Chrome su Android crea la WebAPK (l'app vera, quella che riceve le condivisioni) per un indirizzo che i server di Google non raggiungono, come il pannello dentro Tailscale. Se non la crea, l'app si aggiunge come scorciatoia e il Task 9 non funziona sul telefono finché il pannello non ha un indirizzo pubblico (§16.1, «Con dominio»). Da dire a Matteo prima del Task 9.

## Task 9 · Condividi verso Feedway

**Obiettivo:** da Android si sceglie una foto nella galleria, «Condividi», «Feedway», e la foto finisce nella libreria del cliente.

**Cosa fa:**
- `share_target` nel manifest (`action: '/condividi'`, `POST`, `multipart/form-data`, `files` con `image/*` e `video/*`);
- il service worker riceve il `POST`, mette i file in IndexedDB (al massimo 20, al massimo 30 minuti) e apre `/condividi` (P9);
- `pages/condividi.vue`: chiede l'agenzia (se più di una) e il cliente (scelta 12), carica con il caricamento che c'è (a pezzi, con ripresa) nella cartella principale della libreria, poi «Usa in un post» apre l'editor con quei file; senza accesso passa dall'accesso e torna;
- l'iPhone non ha la condivisione: la pagina d'aiuto lo dice.

**Test:** unit del passaggio dei file (scadenza, limite); E2E che simula il `POST` al service worker con due file e arriva alla libreria; un Viewer non vede clienti in cui caricare; 390 px, chiaro e scuro, axe.

**Fine:** `pnpm verify` verde; Matteo ha visto le schermate; la prova vera su Android nella guida.

## Task 10 · Il sito pubblico, ciò che resta

**Obiettivo:** il sito fa ciò che chiede la specifica §14.5, tranne ciò che aspetta Matteo.

**Parte dopo** che il thread della 0.15.0 ha fuso la sua PR su `apps/site`.

**Cosa fa** (scelta 13, D-122):
- tema automatico chiaro e scuro con i token di `packages/ui`, senza salvare preferenze;
- testi in `apps/site/i18n/locales/it.json` (struttura pronta per `/en/`, senza tradurre);
- dati strutturati `Organization` e `SoftwareApplication`; anteprima dei link in PNG 1200×630 (`og:image`);
- pagine legali e modulo della demo nello stile del ridisegno;
- anteprima su un indirizzo provvisorio non indicizzato per ogni PR (`wrangler pages deploy --branch`), con il link nella PR;
- `site` tra i controlli obbligatori del ruleset con `scripts/github/`;
- D-122 aggiornata: fatto, e ciò che resta a Matteo (dominio, Email Routing, partita IVA, Web Analytics, «Accedi»).

**Test:** il controllo `site` (build, axe in chiaro e scuro, collegamenti, nessun cookie, CSP); E2E del modulo della demo.

**Fine:** controllo `site` verde; Matteo ha visto le schermate in chiaro e scuro.

## Task 11 · Correzioni della revisione, rilascio 0.16.0 e guida della prova

**Obiettivo:** la 0.16.0 installata sulla VPS e provata da Matteo.

**Cosa fa:**
- le correzioni scelte da Matteo sulla revisione di fine tappa;
- `README.md` e la landing (`apps/site`): «In arrivo» tolto dal link del cliente, dalla stampa, dall'app sul telefono e dal brand in `apps/site/app/features.ts`, testi e schermate;
- la PR di rilascio 0.16.0 (release-please) e le note «Cosa provare»;
- la guida della prova in `/mnt/project-files/handoff/tappa-10/GUIDA-prova-0.16.0.md`, con i passi sulla VPS (aggiornamento, `PUBLIC_URL`, Funnel con `/share/`, controlli) e quelli della prova: logo e colore dell'agenzia, un'email di notifica con il brand, un link con password aperto da un telefono **fuori da Tailscale** (rete cellulare), un post che esce mentre il link è aperto, «Revoca» e la pagina che si chiude, il PDF del link, del cliente e del piano, l'app installata su iPhone e su Android, una foto condivisa dalla galleria di Android, il piano con un contenuto in preparazione che compare nel link; le prove rimaste di D-82.

**Fine:** criteri del piano generale §7; il piano della tappa 11 scritto sul codice reale.

## Fuori da questa tappa

- L'approvazione del cliente dal link (§18.7, versione 1.1) e i commenti.
- Le notifiche push della PWA (§12.1, dopo la 1.0) e la coda dei caricamenti senza rete (P12): da valutare con la prova.
- Il logo del cliente caricato dalla sua pagina (P11).
- Il brand della piattaforma caricato dal pannello (P8).
- Il dominio proprio, Cloudflare Tunnel e Access per il pannello (§16.1, «Con dominio»): quando Matteo compra il dominio.
- Feedway dalle chat con MCP (D-132): la collocazione è ancora da decidere; l'opzione (a) la mette tra questa tappa e la 11.
- Le richieste di D-131 non fatte (caricamento a 2–3 pezzi in parallelo, titolo del post nel «Da sistemare» di «Oggi»).
- La pulizia dei link scaduti e delle righe di `bulk_imports` (conservazione, tappa 11).
