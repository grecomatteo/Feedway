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

## Test

Ogni test deve poter fallire per un motivo che a Feedway importa. Più test sulla stessa cosa rallentano la CI e ogni modifica, senza proteggere di più.

- **Una regola, un test.** Ogni regola si prova una volta sola, al livello più basso che riesce a mostrarla. Ai livelli sopra si prova solo che la regola viene usata (un caso, non tutte le varianti). Esempio: la robustezza della password si prova nei test di `password-policy`; reset e cambio password verificano solo che una password debole venga rifiutata.
I livelli sono quattro:

| Livello | Cosa prova | Esempio |
|---|---|---|
| Unit (`*.test.ts`) | Logica pura: dominio, regole, `can()`, validazioni, funzioni dei casi d'uso con porte finte | `can.test.ts`, le regole di pubblicazione (specifica §9) |
| Integrazione (`*.int.test.ts`) | Solo ciò che ha bisogno del database vero o di Better Auth: query, RLS, transazioni, concorrenza, sessioni, contratto con le librerie | due inviti contemporanei per l'ultimo posto |
| API (`apps/web/tests/api`) | Il livello HTTP: codici, intestazioni, CSRF, mappatura degli errori, batteria di isolamento | `http-layer.int.test.ts` |
| E2E (Playwright) | Un percorso principale per schermata, con axe; non le varianti di errore già provate sotto | accesso con passkey |

- **Niente doppioni tra livelli.** Una variante d'errore già provata nel caso d'uso non si riprova nella rotta né nell'E2E.
- **Eccezione: isolamento e permessi.** La batteria di isolamento (`cross-organization.int.test.ts`) e la matrice dei permessi via HTTP (`access-matrix.int.test.ts`) ripetono apposta su ogni rotta i rifiuti già provati nei casi d'uso. Ogni rotta o lavoro nuovo ci entra sempre e non si sfoltiscono.
- **Raggruppa per comportamento**, non per origine: nessun blocco tipo `describe('review follow-ups')`. Un test nato da una revisione va nel gruppo del comportamento che prova.
- **File piccoli.** Sopra le 600 righe un file di test si divide per argomento (`members-invites.int.test.ts`, `members-roles.int.test.ts`…). L'avvio di Better Auth, dell'unit of work e dei dati di prova sta nei moduli di `packages/infrastructure/src/testing/`, non ripetuto in ogni file.
- **Riordino quando si tocca.** Un task adegua solo i test che modifica o aggiunge (per esempio li sposta nel file d'argomento giusto). Dividere un file grande che il task deve toccare è ammesso in una PR preparatoria di sola divisione, subito prima del task; altre PR di solo riordino no.
- **Mai** saltare, disattivare o indebolire un test per far passare la CI (vedi `AGENTS.md`).

## Commenti

Scrivi il **perché**, non il cosa. Un commento che ripete il codice si toglie. Una scelta non ovvia rimanda alla sezione della specifica o all'ADR (`// see spec §9.5`).
