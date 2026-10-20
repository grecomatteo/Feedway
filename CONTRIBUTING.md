# Come si contribuisce

Questa guida vale per persone e agenti. Gli agenti leggono anche [AGENTS.md](AGENTS.md).

## 1. Prima di scrivere codice

1. Leggi la parte della [specifica](docs/superpowers/specs/2026-10-15-feedway-design.md) che riguarda il lavoro e il task nel piano della tappa (`docs/superpowers/plans/`).
2. Ogni lavoro parte da un task del piano o da una issue. Se non c'è, si apre prima la issue.
3. Una scelta che cambia l'architettura, una dipendenza importante o un'interfaccia tra moduli richiede una **ADR** (`docs/adr/`, modello in `000-modello.md`) approvata prima del codice.

## 2. Flusso di lavoro

Rami, commit, PR, revisione, merge e rilasci: [docs/flusso-git.md](docs/flusso-git.md). In breve: ramo corto da `main`, commit in Conventional Commits, PR piccola per task, CI verde, revisione, squash merge.

## 3. Test prima del codice

Per dominio e casi d'uso si lavora in **TDD**:
1. scrivi il test e guardalo fallire per il motivo giusto;
2. scrivi il codice minimo che lo fa passare;
3. migliora il codice con i test verdi;
4. commit.

| Livello | File | Comando | Cosa |
|---|---|---|---|
| Unit | `*.test.ts` | `pnpm test:unit` | Dominio, regole, funzioni pure. Copertura ≥ 90% su `packages/domain` |
| Integrazione | `*.int.test.ts` | `pnpm test:int` | Casi d'uso, repository, coda, RLS su Postgres reale (Testcontainers) |
| End-to-end | `apps/web/e2e/*.spec.ts` | `pnpm test:e2e` | Flussi nel browser, telefono e computer, tema chiaro e scuro, accessibilità con axe |

Regole sui test:
- Un test descrive un comportamento, non l'implementazione.
- Nessun test contro account Meta reali: si usa `tools/meta-mock`.
- Mai saltare, disattivare o rendere "flaky" un test per far passare la CI. Un test instabile è un difetto da correggere.
- Ogni nuova rotta o lavoro di un'organizzazione entra nella batteria di **isolamento tra agenzie**.

## 4. Architettura in breve

- Livelli: `domain → application → infrastructure / apps`. `domain` non importa nulla di esterno; `application` dipende solo da interfacce (porte); rotte e gestori dei lavori sono sottili. **dependency-cruiser** blocca la CI se un confine è violato.
- Moduli: ogni area funzionale ha la stessa forma ed è indipendente dalle altre. La ricetta per aggiungerne uno è in [docs/moduli.md](docs/moduli.md).
- Convenzioni di codice, nomi, errori, date e testi: [docs/convenzioni.md](docs/convenzioni.md).

## 5. Pronto per la revisione quando

- [ ] Il comportamento richiesto dal task funziona ed è coperto da test scritti prima.
- [ ] `pnpm verify` è verde in locale e la CI è verde.
- [ ] Nessun confine violato, nessun `any` senza commento che lo giustifica, nessun `TODO` senza issue.
- [ ] Ogni schermata nuova ha stato vuoto, caricamento, errore e successo; funziona da telefono; supera axe.
- [ ] Nessun dato di un'agenzia raggiungibile da un'altra (test di isolamento aggiornati).
- [ ] Migrazioni rilette, solo in avanti, compatibili con la versione precedente.
- [ ] Documentazione aggiornata se cambia un comportamento visibile, una configurazione o una decisione (specifica, ADR, runbook).
- [ ] Descrizione della PR completa secondo il modello.

## 6. Comandi utili

| Comando | Cosa fa |
|---|---|
| `pnpm dev` | Pannello e worker in sviluppo |
| `pnpm verify` | Formato, lint, tipi, confini, test unitari: il controllo veloce durante il lavoro |
| `pnpm verify:ci` | Tutti i controlli obbligatori della CI in locale (serve Docker): da lanciare prima di ogni push su una PR |
| `pnpm test:int` / `pnpm test:e2e` | Test di integrazione / end-to-end |
| `pnpm db:generate` | Genera la migrazione dallo schema Drizzle (da rileggere sempre) |
| `pnpm arch:check` | Verifica i confini tra livelli e moduli |
