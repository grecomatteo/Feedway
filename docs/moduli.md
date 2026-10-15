# Aggiungere un modulo

Ogni area funzionale (identità, account, media, post, pubblicazione, notifiche, pianificazione, condivisione, attività…) è un **modulo** con la stessa forma (specifica §7.3). Questa ricetta vale per i moduli nuovi e per estendere quelli esistenti. Dalla tappa 2 in poi, i moduli `organizations` e `workspaces` sono l'esempio di riferimento.

## 1. Forma

| Parte | Percorso | Contiene |
|---|---|---|
| Regole | `packages/domain/src/<modulo>/` | Tipi, regole pure, permessi del modulo |
| Casi d'uso | `packages/application/src/<modulo>/` | Un file per caso d'uso; `index.ts` è l'**unica** porta d'ingresso per gli altri moduli |
| Dati | `packages/infrastructure/src/db/<modulo>/` | Tabelle Drizzle, SQL di RLS, repository |
| Contratti | `packages/contracts/src/<modulo>/` | Schemi Zod e DTO per API e pannello |
| Rotte | `apps/web/server/api/v1/orgs/[org]/<modulo>/` | Adattatori sottili: validano, chiamano il caso d'uso, traducono |
| Lavori | `apps/worker/src/jobs/<modulo>/` | Gestori sottili dei lavori in coda |
| Pagine | `apps/web/app/pages/[org]/…` | Percorsi in italiano (`/[org]/calendario`) |
| Registrazione | `packages/application/src/<modulo>/module.ts` | Permessi, eventi, notifiche, menu, voci del calendario, strumenti MCP, code |

## 2. Regole

- Un modulo legge e scrive **solo le proprie tabelle** **(CI: dependency-cruiser)**.
- Per i dati di un altro modulo usa le funzioni del suo `index.ts`, oppure reagisce ai suoi **eventi** dall'outbox.
- Il modulo si registra da sé in `module.ts`; l'unico punto centrale è una riga nell'elenco dei moduli (`packages/application/src/modules.ts`), che l'applicazione legge all'avvio.
- Un modulo si può **attivare per organizzazione** (`organizations.settings.modules`). Rotte, menu e lavori di un modulo spento non rispondono per quell'organizzazione.

## 3. Passi

1. **ADR**, se il modulo introduce una dipendenza o una decisione nuova.
2. **Permessi** nel dominio (`risorsa.azione`), aggiunti ai ruoli di sistema, con i test della matrice (ruolo × permesso × situazione).
3. **Tabelle** con `organization_id`, chiavi esterne composte con `organization_id`, indici che iniziano con `organization_id` o `workspace_id`, **RLS** con la policy `org_isolation`, permessi per `app_runtime`. Migrazione generata e riletta.
4. **Casi d'uso** in TDD: `can()` per primo, `uow.run` con ambito, `tx.audit.record` per ogni azione rilevante, eventi nell'outbox per gli effetti verso altri moduli.
5. **Contratti** Zod e **rotte** registrate nel registro OpenAPI: entrano da sole nella batteria di **isolamento tra agenzie**.
6. **Lavori in coda**: i dati portano `organizationId`; un lavoro di sistema va dichiarato tale nel registro delle code e usa `runAsSystem` (consentito solo se il modulo è nella lista della regola ESLint).
7. **Notifiche**: tipi di evento con livello e destinatari, testi in `apps/web/i18n/locales/it.json`.
8. **Schermate** con tutti gli stati, da telefono e computer, axe verde; voci di menu e del calendario registrate in `module.ts`.
9. **Strumenti MCP** (dalla 1.4), registrati in `module.ts` con gli stessi casi d'uso e permessi.
10. **Documentazione**: sezione della specifica aggiornata, voce in questo file se la ricetta cambia.

## 4. Controllo finale

- [ ] `pnpm arch:check` verde: nessun accesso alle tabelle di altri moduli
- [ ] Test di isolamento verdi con le rotte e i lavori nuovi
- [ ] Matrice dei permessi aggiornata e testata
- [ ] Il modulo spento per un'organizzazione non risponde per quell'organizzazione
