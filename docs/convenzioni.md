# Convenzioni di codice

Regole che la CI non può controllare tutte da sola. Quelle controllate sono marcate **(CI)**.

## Lingua

| Cosa | Lingua |
|---|---|
| Testi dell'interfaccia, email, messaggi Telegram | Italiano, dai file di traduzione (`apps/web/i18n/locales/it.json`, `@nuxtjs/i18n`), mai scritti nei componenti; per il sito pubblico `apps/site/i18n/locales/` |
| Documentazione, commit, PR, issue | Italiano |
| Codice, nomi di file, identificativi, nomi dei test, commenti | Inglese |
| Codici di errore | Inglese, `SCREAMING_SNAKE_CASE` (`POST_NOT_EDITABLE`) |

## TypeScript

- `strict` con `noUncheckedIndexedAccess` ed `exactOptionalPropertyTypes` **(CI)**.
- Nessun `any`; se è inevitabile, `// eslint-disable-next-line` con il motivo **(CI)**.
- Input esterni (richieste, dati dei lavori, risposte di Meta, variabili d'ambiente) validati con **Zod** al confine; dentro il sistema si usano tipi già validati.
- Funzioni pure nel dominio; effetti solo tramite porte.

## Nomi

| Cosa | Forma | Esempio |
|---|---|---|
| File | `kebab-case.ts` | `create-organization.ts` |
| Test | accanto al file, `*.test.ts` / `*.int.test.ts` | `can.test.ts` |
| Casi d'uso | verbo + oggetto, una funzione esportata per file principale | `schedulePost(deps, actor, input)` |
| Porte | sostantivo | `Clock`, `Storage`, `MetaPublisher` |
| Tabelle e colonne | `snake_case`, tabelle al plurale | `post_targets.scheduled_at` |
| Permessi | `risorsa.azione` | `post.publish` |
| Eventi | `modulo.evento_al_passato` | `publishing.target_published` |
| Lavori in coda | `modulo.azione` | `media.process` |

## Casi d'uso

- Firma: `useCase(deps, actor, input): Promise<Output>`. `deps` contiene solo porte.
- Primo passo: `can()`. Una risorsa non visibile è `NOT_FOUND`, non `FORBIDDEN`.
- Dati di un'organizzazione solo dentro `uow.run({ organizationId, userId }, tx => …)`.
- Ogni azione rilevante scrive nel registro dentro la stessa transazione (`tx.audit.record`).
- Effetti verso altri moduli tramite eventi nell'outbox, non chiamate dirette alle loro tabelle.

## Errori

- Errori di dominio tipizzati: `DomainError` con `code` stabile e dettagli strutturati.
- Tradotti in risposte HTTP e messaggi per l'utente **in un solo punto** (`apps/web/server/utils/http-errors.ts`).
- Mai mostrare all'utente messaggi tecnici o stack; sempre cosa è successo e cosa fare.
- Nei log: ID richiesta o ID lavoro, `code`, contesto senza segreti (oscuramento automatico dei campi sensibili).

## Tempo e ID

- Date salvate in UTC (`timestamptz`); conversioni al fuso solo ai bordi (interfaccia, regole sugli orari).
- Mai `new Date()` o `Date.now()` in `domain` e `application`: porta `Clock` **(CI: regola ESLint)**.
- ID UUID v7 dalla porta `IdGenerator`.

## Database

- Schema in Drizzle; ogni migrazione generata viene riletta prima del commit.
- Solo in avanti. Un cambiamento distruttivo si fa in due rilasci: aggiungi → migra i dati → rimuovi.
- Indici che iniziano con `organization_id` o `workspace_id`.
- Nessuna query senza filtro di organizzazione; la RLS è la seconda barriera, non la prima.

## Interfaccia

- Componenti del design system (`packages/ui`, Nuxt UI) prima di crearne di nuovi.
- Ogni schermata: stato vuoto, caricamento, errore, successo.
- Prima il telefono: aree di tocco ≥ 44 px, nessuno scorrimento orizzontale.
- WCAG 2.2 AA, verificato con axe **(CI)**; tema chiaro e scuro.
- Errori dei moduli accanto al campo, con la correzione suggerita.

## Commenti

Scrivi il **perché**, non il cosa. Un commento che ripete il codice si toglie. Una scelta non ovvia rimanda alla sezione della specifica o all'ADR (`// see spec §9.5`).
