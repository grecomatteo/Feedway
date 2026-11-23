# Aggiungere un modulo

Ogni area funzionale (identità, account, media, post, pubblicazione, notifiche, pianificazione, condivisione, attività…) è un **modulo** con la stessa forma (specifica §7.3). Questa ricetta vale per i moduli nuovi e per estendere quelli esistenti. Dalla tappa 2 in poi, i moduli `organizations` e `workspaces` sono l'esempio di riferimento.

## 1. Forma

| Parte | Percorso | Contiene |
|---|---|---|
| Regole | `packages/domain/src/<modulo>/` | Tipi, regole pure, permessi del modulo |
| Casi d'uso | `packages/application/src/<modulo>/` | Un file per caso d'uso; `index.ts` è l'**unica** porta d'ingresso per gli altri moduli |
| Dati | `packages/infrastructure/src/db/<modulo>/` | Tabelle Drizzle, SQL di RLS, repository |
| Contratti | `packages/contracts/src/api/<modulo>.ts` | Schemi Zod e DTO per API e pannello |
| Rotte | `apps/web/server/api/v1/orgs/[org]/<modulo>/` | Adattatori sottili: validano, chiamano il caso d'uso, traducono |
| Lavori | `apps/worker/src/handlers/<modulo>-<lavoro>.ts` | Gestori sottili dei lavori in coda |
| Pagine | `apps/web/app/pages/[org]/…` | Percorsi in italiano (`/[org]/calendario`) |
| Registrazione | `packages/application/src/<modulo>/module.ts` | Un `ModuleDefinition`: nome, permessi, code, tipi di notifica (`notificationKinds`), sezioni del riepilogo (`digestSections`), reazione all'anonimizzazione di un utente (`onUserAnonymized(event, { uow })`, ripetibile). Menu, voci del calendario e strumenti MCP entrano nel tipo con i moduli che li usano |

## 2. Regole

- **Piattaforme social** ([ADR 019](adr/019-modulo-piattaforma.md)): il modulo `accounts` è generico e non conosce nessuna piattaforma. Il codice di Meta sta in `platforms/meta/` di `domain`, `application` e `infrastructure`. I connettori si trovano con una mappa `connection kind → PlatformConnector` in `packages/infrastructure/src/runtime.ts`, separata dal registro dei moduli. La CI (dependency-cruiser) controlla che solo `platforms/meta/` e `runtime.ts` importino `packages/infrastructure/src/platforms/meta/`, che l'index di `infrastructure` non riesporti le piattaforme e che `accounts` non importi `platforms/`.
- **Regole delle piattaforme** (piano della tappa 5): come i connettori, le `PlatformRules` si trovano con una mappa `piattaforma → regole` costruita in `runtime.ts` (`PLATFORM_RULES`). Il modulo `rules` non ha tabelle: il suo caso d'uso `checkPost` legge file e account con le funzioni pubbliche di `media` (`getMediaForRules`) e di `accounts` (`getAccountsForRules`), e i post già usciti o programmati con la porta `PublishingHistory`. È l'unica porta d'ingresso per chi deve controllare un post (il pannello, il modulo `posts` della tappa 6, il worker della tappa 7).
- **Post** (piano della tappa 6): il modulo `posts` ha le tabelle dei post (`packages/infrastructure/src/db/posts/`), i casi d'uso in `packages/application/src/posts/` e le rotte sotto `…/workspaces/[id]/posts/`. Legge file e account solo con le funzioni pubbliche di `media` (`getMediaForPosts`) e di `accounts` (`getAccountsForRules`), e controlla un post solo con `checkPostInTx` di `rules`, nella transazione che lo salva. Ha i permessi `post.draft`, `post.publish` e `post.manage_others`. Per la tappa 9 offre `createDraft(tx, actor, input)` e `getStatuses(tx, organizationId, postIds)`, che lavorano dentro la transazione di chi chiama. La libreria (`media`) legge i post che usano un file con la porta `tx.posts.usingMedia`, senza importare il modulo, così i due moduli non si importano a vicenda. Per «Oggi» (ridisegno, Task R3) ha le letture di tutta l'agenzia sotto `/api/v1/orgs/{org}/agenda` (post del periodo, bozze da finire, «Da sistemare», attività dei clienti): leggono solo i clienti che la persona vede e non archiviati, e per «Da sistemare» usano `getClientProfiles` di `accounts` e `getFailedMedia` di `media`, dentro la stessa transazione.
- Un modulo legge e scrive **solo le proprie tabelle** **(CI: dependency-cruiser)**.
- Per i dati di un altro modulo usa le funzioni del suo `index.ts`, oppure reagisce ai suoi **eventi** dall'outbox.
- Il modulo si registra da sé in `module.ts`; l'unico punto centrale è una riga nell'elenco `MODULES` (`packages/application/src/modules.ts`). Il tipo è in `packages/application/src/module-definition.ts`; esempi: `identity/module.ts`, `workspaces/module.ts`.
- `modules.test.ts` controlla che ogni permesso e ogni coda appartengano a **un solo** modulo: un permesso nuovo senza modulo fa fallire il test. I permessi delle tappe future sono nell'elenco `FUTURE_PERMISSIONS` del test, da togliere quando il loro modulo arriva.
- Un modulo si può **attivare per organizzazione** (`organizations.settings.modules`). Rotte, menu e lavori di un modulo spento non rispondono per quell'organizzazione. *Non ancora realizzato*: arriva con il primo modulo facoltativo.

## 3. Passi

1. **ADR**, se il modulo introduce una dipendenza o una decisione nuova.
2. **Permessi** nel dominio (`risorsa.azione`), aggiunti ai ruoli di sistema e al `module.ts` del modulo, con i test della matrice (ruolo × permesso × situazione).
3. **Tabelle** con `organization_id`, chiavi esterne composte con `organization_id`, indici che iniziano con `organization_id` o `workspace_id`, **RLS** con la policy `org_isolation`, permessi per `app_runtime`. Migrazione generata e riletta.
4. **Casi d'uso** in TDD: `can()` per primo, `uow.run` con ambito, `tx.audit.record` per ogni azione rilevante, eventi nell'outbox per gli effetti verso altri moduli.
5. **Contratti** Zod e **rotte** registrate nel registro OpenAPI: entrano da sole nella batteria di **isolamento tra agenzie**.
6. **Lavori in coda**: i dati portano `organizationId` e il gestore apre `uow.run({ organizationId, userId: null })`: il lavoro non agisce per una persona. Ogni coda con ambito `organization` entra nella batteria dei lavori (`apps/worker/src/handlers/isolation.int.test.ts`), che fallisce se ne manca il caso. Un lavoro di sistema va dichiarato tale nel registro delle code e usa `runAsSystem` (consentito solo se il modulo è in `RUN_AS_SYSTEM_ALLOWED` di `eslint.config.mjs`).
7. **Notifiche** (tappa 8): il tipo dell'evento entra nell'elenco del modulo in `packages/domain/src/<modulo>/events.ts` (`as const`), che `OUTBOX_EVENT_TYPES` unisce (`domain/src/notifications/events.ts`) e il vincolo `check` di `outbox_events` usa, quindi serve una migrazione; poi il `module.ts` del modulo registra un `NotificationKind` in `notificationKinds`, con livello, destinatari (`scheduler`, `workspace_managers`, `org_admins`, `platform_admins`), canali predefiniti di §12.2 e, se serve, `alwaysEmail`. `modules.test.ts` fallisce se un tipo non ha esattamente un `NotificationKind`, e `notification-kinds.test.ts` tiene la tabella dei destinatari e dei canali. Il `payload` ha solo id e codici. Il `NotificationKind` ha anche `message(ctx, events)`, che costruisce un messaggio per un gruppo di eventi dello stesso tipo leggendo i dati di adesso con `ctx.tx`, nell'ambito del destinatario (piano 08, P3): ogni modulo lo scrive nel suo `notification-messages.ts` con gli aiuti di `notifications` (`groupedMessage`, `placeOf`, `panelLink`), e i testi sono in `apps/web/i18n/locales/it.json` sotto `notify.kinds.<tipo con _ al posto del punto>` (`one`, `many` e le righe). Un nuovo canale implementa `NotificationChannel` (`application/src/ports/notification-channel.ts`) e si aggiunge alla lista dei canali di `notifyDeps` nel worker. Un evento che non va scritto due volte porta una `dedupeKey`. Le sezioni del riepilogo si registrano in `digestSections`.
8. **Schermate** con tutti gli stati, da telefono e computer, axe verde; voci di menu e del calendario registrate in `module.ts`.
9. **Strumenti MCP** (dalla 1.4), registrati in `module.ts` con gli stessi casi d'uso e permessi.
10. **Documentazione**: sezione della specifica aggiornata, voce in questo file se la ricetta cambia.

## 4. Controllo finale

- [ ] `pnpm arch:check` verde: nessun accesso alle tabelle di altri moduli
- [ ] Test di isolamento verdi con le rotte e i lavori nuovi
- [ ] Matrice dei permessi aggiornata e testata
- [ ] Il modulo spento per un'organizzazione non risponde per quell'organizzazione
