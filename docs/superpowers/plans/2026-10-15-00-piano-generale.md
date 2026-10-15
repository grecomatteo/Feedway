# Piano generale di sviluppo (versione 1.0)

> **For agentic workers:** questo è il piano quadro. Ogni tappa ha il proprio piano eseguibile (`2026-10-15-NN-*.md`); per eseguirne uno usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans. I passi usano le caselle (`- [ ]`).

**Obiettivo:** portare la piattaforma dalla specifica v9 alla versione 1.0 in uso quotidiano, in 12 tappe installabili e provabili sulla VPS.

**Architettura:** monolite modulare TypeScript (pannello Nuxt + worker Node) su PostgreSQL con coda pg-boss, a livelli `domain → application → infrastructure/apps` verificati in CI. Ogni tappa aggiunge casi d'uso, tabelle e schermate sopra le interfacce delle tappe precedenti.

**Stack:** Node 24 LTS, TypeScript 6.0, Nuxt 4 + Nuxt UI 4, PostgreSQL 17, Drizzle, pg-boss 12, Zod 4, Vitest, Testcontainers, Playwright, pnpm + Turborepo, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-15-feedway-design.md` (v9, con la predisposizione multi-agenzia di §6.5 e l'account personale con Better Auth di §10.5 e §15.1). Il piano argomenta dalla specifica: chi esegue legge entrambe.

---

## 1. Come sono organizzati i piani

| File | Contenuto | Stato |
|---|---|---|
| `00-piano-generale.md` | Questo documento: ordine, confini e interfacce tra tappe, regole comuni | Pronto |
| `01-fondamenta.md` | Tappa 1, eseguibile | Pronto |
| `02-identita.md` | Tappa 2, eseguibile | Pronto |
| `03-meta.md` … `12-produzione.md` | Tappe 3–12 | Si scrivono all'inizio di ogni tappa |

**Perché le tappe 3–12 non sono già dettagliate.** Un piano eseguibile fissa nomi di file, firme e test. Dalla tappa 3 queste scelte dipendono da cose che ancora non esistono: il codice reale delle tappe 1–2, le risposte vere di Meta (registrate nel primo contatto, tappa 3) e il prototipo grafico approvato. Scriverle oggi vorrebbe dire riscriverle. Questo documento fissa invece **ciò che non cambierà**: contenuto, confini, interfacce e criteri di fine di ogni tappa.

## 2. Aggiornamenti rispetto alla specifica

Scelte prese preparando il piano, già riportate nella specifica v9 (§6.3 ADR 010–011, §7.4, §13, §15.6, §16.2, §16.7, §19) e da approvare con essa.

| # | Specifica v7 | Piano | Motivo |
|---|---|---|---|
| A1 | Nuxt 3 | **Nuxt 4** (4.6) e Nuxt UI 4 | Nuxt 3 non riceve più aggiornamenti di sicurezza. Stesso framework, struttura `app/` |
| A2 | Node 22 | **Node 24 LTS** | Node 22 esce dal supporto ad aprile 2027, Node 24 è supportato fino ad aprile 2028 |
| A3 | TypeScript strict | **TypeScript 6.0** fissato | TypeScript 7 (nuovo compilatore) non è ancora garantito con `vue-tsc`; Renovate proporrà il passaggio quando lo sarà |
| A4 | Ruoli DB `openmeta_owner` / `openmeta_app` | `app_migrator` / `app_runtime`, database `app`, pacchetti `@app/*` | Il nome non era ancora scelto (poi Feedway): gli identificativi tecnici restano neutri, il nome visibile sta in una sola costante (§3) |
| A5 | Battito del worker "in dashboard" | Tabella `system_heartbeats` (tappa 8) | Serve un posto dove il worker scrive e il web legge; `settings` è per la configurazione |

La predisposizione multi-agenzia (organizzazioni, isolamento con RLS, chiavi per organizzazione) è già nella specifica e non è un aggiornamento da approvare a parte.

## 3. Nome

La piattaforma si chiama **Feedway** (scelto da Matteo il 2026-10-15), repository `github.com/grecomatteo/Feedway`.
- Il nome visibile (titolo, email, bot, link cliente) viene da **una sola costante** `PRODUCT_NAME` in `packages/config/src/product.ts`, `"Feedway"`;
- nessun identificativo tecnico contiene il nome (pacchetti `@app/*`, ruoli DB, cookie, nomi dei container `app-*`), come deciso nell'ADR 011;
- l'immagine Docker è `ghcr.io/grecomatteo/feedway` (GHCR vuole nomi in minuscolo).

Se un giorno il nome cambiasse: si modifica `PRODUCT_NAME`, si carica il logo dal pannello (tappa 10), si rinomina il repository. Nessuna migrazione.

## 4. Regole comuni a tutte le tappe

Ogni piano di tappa le include implicitamente.

- **Flusso di lavoro** (`docs/flusso-git.md`, scelto da Matteo il 2026-10-15): un ramo corto e una **PR piccola per task** (`<tipo>/<tappa>-<argomento>`), titolo in Conventional Commits, CI verde e revisione automatica, squash merge su `main`; a fine tappa Matteo prova e fonde la PR di rilascio di release-please (tappa N → `0.N.0`, tappa 12 → `1.0.0`); sulla VPS `./scripts/update.sh vX.Y.Z`. Ogni tappa è una milestone GitHub.
- **TDD:** per dominio e casi d'uso il test si scrive prima del codice e si vede fallire.
- **Livelli:** `domain` non importa nulla di esterno; `application` dipende solo da interfacce (porte); rotte API e gestori dei lavori sono sottili (validano, chiamano un caso d'uso, traducono). dependency-cruiser blocca la CI se un confine è violato.
- **Moduli (§7.3):** ogni area funzionale è un modulo con la stessa forma in `domain`, `application`, `infrastructure/db`, `contracts`, rotte e pagine; un modulo usa solo le proprie tabelle e parla con gli altri tramite le loro funzioni pubbliche (`application/<modulo>/index.ts`) o gli eventi; permessi, tipi di notifica, voci di menu e strumenti MCP si registrano dal modulo stesso. La ricetta sta in `docs/moduli.md` (scritta nella tappa 2).
- **Autorizzazione:** ogni caso d'uso chiama `can()` prima di agire; ogni elenco è filtrato sugli spazi visibili nel repository; una risorsa non visibile restituisce 404, non 403.
- **Errori:** errori di dominio tipizzati (`DomainError` con `code`), tradotti in HTTP in un solo punto.
- **Tempo:** date salvate in UTC (`timestamptz`); fuso di riferimento `Europe/Rome`; nessun `new Date()` nei casi d'uso: si usa la porta `Clock`.
- **ID:** UUID v7 generati dall'applicazione tramite la porta `IdGenerator`.
- **Segreti:** mai nei log, mai al browser, mai nel repository. Token Meta reali mai in chat né nei test.
- **Meta:** nessun test automatico contro account reali; si usa il finto Graph API (`tools/meta-mock`). Il primo contatto reale è manuale, con Matteo, sugli account di prova.
- **Interfaccia:** testi in italiano nei file di traduzione (`@nuxtjs/i18n`), mai scritti nei componenti; ogni schermata ha stato vuoto, caricamento, errore e successo; WCAG 2.2 AA verificato con axe in Playwright; viste telefono e computer, tema chiaro e scuro.
- **Versioni:** dipendenze fissate nel lockfile, `--frozen-lockfile` in CI, immagini Docker fissate per digest, Renovate per gli aggiornamenti.
- **Isolamento tra agenzie (§6.5):** ogni tabella con dati di un'organizzazione ha `organization_id` e RLS; ogni caso d'uso lavora dentro `uow.run({ organizationId, userId })`; ogni lavoro su dati di un'organizzazione porta `organizationId` nei dati e il gestore apre la transazione con quell'ambito; i lavori di sistema (riconciliatore, pulizia, battito, bot Telegram, avvio dei riepiloghi e delle sincronizzazioni) sono dichiarati tali nel registro delle code e usano `runAsSystem`; `runAsSystem` solo nei moduli autorizzati dalla regola ESLint; ogni nuova rotta di organizzazione entra automaticamente nella batteria di test di isolamento; chiavi di archiviazione dei file con prefisso `org/<id>/`.
- **Scalabilità (§6.4):** nessuno stato condiviso nella memoria dei processi (sessioni, limiti, cache vanno nel database); ogni query su dati di un'organizzazione filtra per `organization_id` e, dove serve, `workspace_id`, con un indice che inizia con uno dei due; i processi che devono girare una volta sola usano un lock consultivo di Postgres; i file passano solo da `Storage`.

## 5. Le tappe

Per ogni tappa: cosa costruisce, cosa introduce che le tappe successive useranno, cosa prova Matteo alla fine, cosa serve da lui.

### Tappa 1 · Fondamenta (piano `01-fondamenta.md`)
- **Costruisce:** monorepo, confini verificati, configurazione validata, log con oscuramento, database con ruoli separati e migrazioni, coda, worker e web avviabili, salute `/api/health` e `/api/ready`, design system con tema chiaro/scuro/automatico, immagine Docker irrobustita, `install.sh` e `update.sh` (con la coppia di chiavi `age` per i backup cifrati), CI completa.
- **Introduce:** porte `Clock`, `IdGenerator`, `Logger`, `JobQueue`; `loadConfig()`; `createDb()`; `runMigrations()`; helper di test `startTestDatabase()`; token del design system.
- **Matteo prova:** installa sulla VPS con un comando, apre il pannello via Tailscale, cambia tema, lancia `update.sh` e `update.sh --rollback`.
- **Serve da Matteo:** link del repository, chiave di autenticazione Tailscale, ispirazioni grafiche per il prototipo.
- **In parallelo:** prototipo cliccabile delle schermate principali (§14.1) appena arrivano le ispirazioni. Non blocca le tappe 1–5; va approvato prima della tappa 6.

### Tappa 2 · Identità, organizzazioni e permessi (piano `02-identita.md`)
- **Costruisce:** organizzazioni con isolamento a doppia barriera (RLS), amministratore della piattaforma con comandi `cli`, primo account con la prima agenzia, Better Auth (accesso con passkey o password, sessioni, 2FA con codici di recupero, reset, cambio email), account personale (soprannome, foto profilo, dispositivi collegati), privacy ("Scarica i miei dati", "Elimina il mio account", conservazione automatica, informativa), inviti, disattivazione, ruoli nell'agenzia e negli spazi, limiti per agenzia, spazi di lavoro e membri, riconferma per azioni delicate, registro attività, selettore dell'agenzia, schermate relative. RF-04, RF-10–RF-15, RNF-14, CS5, CS11.
- **Introduce:** `can()`/`canPlatform()` e i permessi, `OrgActor`, `UnitOfWork` con ambito e `runAsSystem`, `KeyRing` (chiavi per organizzazione), `Auth` (adattatore di Better Auth), `PasswordHasher` (argon2id, usato da Better Auth), `Storage` su disco (per le foto profilo; la tappa 4 aggiunge i media e la prova su MinIO), `AuditLog`, repository, middleware di sessione, CSRF e contesto dell'agenzia, mappatura errori → HTTP, OpenAPI `/api/v1`, batteria di test di isolamento tra agenzie.
- **Matteo prova:** crea il suo account con la sua agenzia, attiva la 2FA, invita un collaboratore come Publisher in uno spazio e verifica che non veda gli altri spazi; crea da comando una seconda agenzia di prova e verifica che i dati non si mescolino.

### Tappa 3 · Meta
- **Costruisce:** prima configurazione guidata in 5 passi, integrazioni cifrate dell'agenzia (Meta; Telegram ed email come schede pronte) e sezione **Piattaforma → Integrazioni** visibile solo all'amministratore della piattaforma (valori predefiniti di email e Telegram, sorveglianza esterna), "Aggiungi account", sincronizzazione, salute e quota, promemoria, assegnazione account agli spazi. RF-02, RF-03, RF-05, RF-20, RF-21.
- **Introduce:** `IntegrationStore` (per organizzazione, con valori predefiniti della piattaforma per email e Telegram, segreti cifrati con `KeyRing.forOrganization`), `MetaGraphClient` (live/mock/dry-run, `appsecret_proof`, classificazione errori, lettura dei limiti d'uso e rallentamento per account e per organizzazione), `tools/meta-mock`, tabelle `integrations`, `social_accounts` (unico per organizzazione), `workspace_accounts`; limite `social_accounts`.
- **Matteo prova:** con la procedura guidata crea app e utente di sistema, incolla il token **nel pannello**, importa l'account IG e la Pagina di prova. Le risposte reali di Meta vengono registrate (senza token) e diventano le risposte del finto Graph API.
- **Serve da Matteo:** app Meta, utente di sistema, un account IG e una Pagina FB di prova.

### Tappa 4 · Media
- **Scalabilità:** la batteria di test di `Storage` gira anche contro MinIO, così il passaggio a uno storage a oggetti (R2) sarà un cambio di configurazione.
- **Costruisce:** caricamento con "Scegli file", trascinamento e incolla (specifica §11.1), upload a pezzi da 20 MB con ripresa e barre di avanzamento per file e complessive (§14.2), analisi (ffprobe/sharp), correzioni automatiche, varianti per piattaforma, host pubblico separato (`/m/*`, solo JPEG e MP4, token non elencabili), libreria con cartelle e tag. RF-30, RF-31, RF-45.
- **Introduce:** `Storage`, `MediaProbe`, `MediaTransformer`, separazione degli host nel web, lavoro `media.process`, tabelle `media`, `media_variants`, `library_*`; limite `storage_bytes` e limite di conversioni contemporanee per organizzazione (§6.5, equità tra agenzie).
- **Matteo prova:** carica da telefono un HEIC e un video lungo su rete instabile; il file da `PUBLIC_URL/m/...` si apre da internet, il pannello no.
- **Serve da Matteo:** Tailscale Funnel attivo sulla VPS.

### Tappa 5 · Regole
- **Costruisce:** tutti i controlli di §9.1–9.2 come funzioni pure, con livelli blocco/avviso/correzione e riepilogo per destinazione. RF-32, RF-33, CS2.
- **Introduce:** `evaluatePost(draft, context): RuleReport`, usata identica da pannello, API e worker.
- **Matteo prova:** legge la tabella dei casi di test (generata dai test) e conferma che i messaggi sono chiari.

### Tappa 6 · Post
- **Costruisce:** pagina Nuovo post, anteprima stile Meta con zone sicure su cui si possono trascinare i file, ordine del carosello trascinando (con alternativa a pulsanti), bozze con salvataggio automatico, modifica e annullamento con blocco ottimistico, modelli, etichette, note, gruppi di account, reel nel feed. RF-34, RF-35, RF-36, RF-44.
- **Introduce:** `PostRepository`, tabelle `posts`, `post_media`, `post_targets` (solo stati `draft`/`scheduled`/`cancelled`), `labels`, `post_notes`, `caption_templates`, `account_groups`; limite `posts_per_day`; fuso predefinito dell'organizzazione per i nuovi post.
- **Prerequisito:** prototipo approvato.

### Tappa 7 · Pubblicazione
- **Costruisce:** macchina a stati completa, preparazione 15 minuti prima, pubblicazione IG e FB per tutti i tipi, tentativi, esito incerto e ricerca del post, riconciliatore ogni minuto, verifica a 3/10/30 minuti, "Riprova" senza doppioni, pausa se l'autore ha perso i permessi o se l'organizzazione è sospesa (in quel caso nessuna notifica verso i suoi canali). RF-50, RF-51, RF-52, CS1, CS3, CS4.
- **Introduce:** `MetaPublisher`, lavori `target.*` (con `organizationId` nei dati) e `scheduler.reconcile` (uno dei moduli di sistema, l'unico che legge le destinazioni di tutte le agenzie), limite di lavori pesanti contemporanei per organizzazione, tabelle `target_attempts` e `outbox_events` (gli eventi si scrivono da qui, le notifiche li leggeranno nella tappa 8).
- **Matteo prova:** con il finto Graph API, riavvia il worker a metà pubblicazione e controlla che non nascano doppioni; poi la prima pubblicazione reale, insieme, su ogni tipo.

### Tappa 8 · Notifiche
- **Scalabilità:** bot Telegram, battito e riconciliatore girano con lock consultivo: con più worker uno solo è attivo.
- **Costruisce:** dispatcher dall'outbox, centro notifiche, Telegram (collegamento per utente, comandi `/oggi`, `/problemi`, `/stop`), email con modelli, preferenze, ore di silenzio, raggruppamento, riepilogo delle 8:00, battito del worker con avviso dal web, sorveglianza esterna. RF-60, RF-61, RF-62.
- **Introduce:** `NotificationChannel`, tabelle `notifications`, `notification_deliveries`, `notification_prefs`, `telegram_links`, `system_heartbeats`.
- **Serve da Matteo:** bot Telegram, SMTP, account healthchecks.io.

### Tappa 9 · Pianificazione
- **Costruisce:** calendario mese/settimana/elenco con filtri nell'indirizzo e trascinamento, griglia Instagram riordinabile, fasce orarie e "prossima fascia libera", programmazione in blocco da file, CSV/Excel e duplicazione. RF-40, RF-41, RF-42, RF-43.
- **Introduce:** tabelle `time_slots`, `bulk_imports`, lavoro `bulk.import`.

### Tappa 10 · Condivisione e brand
- **Costruisce:** link cliente di sola visione (password, scadenza, revoca, conteggio), logo e colore nel pannello, email, bot e link cliente, PWA con Web Share Target su Android, sito pubblico statico (`apps/site`, specifica §14.5, ADR 013) con "Accedi", pagine legali, SEO e pubblicazione su Cloudflare Pages. RF-63, RF-71–73, CS6.
- **Introduce:** tabelle `share_links`, `branding` (per organizzazione, più quello della piattaforma per la pagina di login); `apps/site` con regola di dependency-cruiser (importa solo `packages/ui`) e workflow `site.yml`.

### Tappa 11 · Operazioni
- **Prova di carico** di §6.4 con i suoi obiettivi, nella CI settimanale.
- **Costruisce:** pulizia notturna dei media, backup notturno con rotazione e copia della libreria, `restore-check.sh` e runbook, dashboard completa (spazio disco compreso), esportazione e anonimizzazione dati utente, conservazione dei file per organizzazione, revisione di sicurezza e accessibilità su tutto. RNF-01…RNF-13, CS9.
- **Serve da Matteo:** cartella di backup inclusa nel suo rclone.

### Tappa 12 · Messa in produzione
- **Costruisce:** nessuna funzione nuova. Prova reale completa insieme (tutti i tipi, tutti i criteri §2.3), correzioni, collegamento degli account veri.
- **Fine della 1.0:** tutti i criteri CS1–CS11 verificati e annotati nella PR finale.

## 6. Interfacce tra le tappe

Le porte vivono in `packages/application/src/ports/`. Una tappa può aggiungerne, mai cambiarne la firma senza aggiornare chi la usa nella stessa PR.

| Porta | Tappa | Firma essenziale |
|---|---|---|
| `Clock` | 1 | `now(): Date` |
| `IdGenerator` | 1 | `newId(): string` (UUID v7) |
| `Logger` | 1 | `debug/info/warn/error(obj, msg?)`, `child(bindings): Logger` |
| `JobQueue` | 1 | `send(name, data, opts?)`, `work(name, handler, opts?)`, `stop()` |
| `UnitOfWork` | 2 | `run<T>(scope: { organizationId, userId } \| { userId }, fn)`, `runAsSystem<T>(reason, fn)` |
| `AuditLog` | 2 | dentro la transazione: `tx.audit.record(entry: AuditEntry): Promise<void>` |
| `PasswordHasher` | 2 | `hash(plain)`, `verify(hash, plain)` |
| `KeyRing` / `SecretBox` | 2 | `platform()`, `forOrganization(tx, orgId)`; `seal(plain, aad)`, `open(sealed, aad)` |
| `RateLimiter` | 2 | `hit(key, limit, windowMs)` |
| `Auth` | 2 | adattatore di Better Auth: sessione della richiesta, account da invito, revoca delle sessioni, link di reset, verifica della riconferma; nessun altro modulo importa Better Auth |
| `IntegrationStore` | 3 | `get(organizationId, kind)` (con ricaduta sulla piattaforma), `replace(organizationId, kind, config, secret)` |
| `MetaGraphClient` | 3 | funzioni tipizzate per chiamata, errori classificati `transient`/`permanent`/`uncertain` |
| `Storage` | 2 (disco), 4 (media, MinIO) | `put`, `get`, `delete`, `publicUrl(variant)`; chiavi `org/<id>/…` e `users/<id>/…` |
| `MediaProbe` / `MediaTransformer` | 4 | analisi e conversioni |
| `MetaPublisher` | 7 | passi `prepare`/`publish`/`verify` per piattaforma e tipo |
| `NotificationChannel` | 8 | `deliver(notification, recipient)` |

Le tabelle seguono la tappa che le introduce (§5); nessuna tappa crea tabelle "per dopo", tranne `api_tokens` (tappa 2), predisposta dalla specifica per MCP.

## 7. Criteri di fine di ogni tappa

1. Tutti i task del piano completati, con test scritti prima del codice.
2. CI verde: tipi, lint, confini, unit, integrazione, E2E, accessibilità, sicurezza, immagine, prova di installazione.
3. Ogni PR rivista prima del merge; revisione complessiva della tappa prima della PR di rilascio.
4. Note di rilascio con "cosa provare" per Matteo.
5. Installata sulla VPS con `update.sh` e provata da Matteo.
6. Il piano della tappa successiva è scritto sul codice reale e approvato.

## 8. Punti d'attenzione trasversali

I casi che la specifica implica e che è più facile trascurare. Ogni piano di tappa li riprende nella propria sezione Review Focus.

1. **Riavvii a metà** (container, VPS, rete): nessun post perso o doppio; ogni lavoro rilegge lo stato dal database.
2. **Ora legale**: un post alle 02:30 del giorno del cambio d'ora, una fascia oraria ripetuta, la verifica che attraversa il cambio.
3. **Permessi che cambiano nel tempo**: un utente declassato o disattivato con post programmati, una sessione aperta durante il cambio di ruolo.
4. **Telefono**: rete che cade durante l'upload, scheda sospesa da iPhone, schermo stretto, HEIC.
5. **Reinstallazione e aggiornamento**: rilanciare `install.sh` su un'installazione esistente non deve rigenerare chiavi né password; un aggiornamento con migrazione fallita lascia attiva la versione precedente.
6. **Isolamento tra agenzie in ogni nuova funzione**: ogni tappa aggiunge le sue rotte e i suoi lavori alla batteria di test di isolamento; un lavoro su dati di un'organizzazione senza `organizationId` è un errore di tipo, e un lavoro di sistema non dichiarato nel registro delle code non può usare `runAsSystem`.
