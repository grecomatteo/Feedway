# Decisioni architetturali (ADR)

Ogni decisione importante ha una scheda: contesto, decisione, alternative scartate, conseguenze. Una decisione non si modifica: se cambia, una nuova ADR la sostituisce e la vecchia passa a "Sostituita da ADR NNN". Modello: [000-modello.md](000-modello.md).

| ADR | Decisione | Stato |
|---|---|---|
| [001](001-monolite-modulare.md) | Monolite modulare: web + worker | Proposta, da approvare con la specifica v9 |
| [002](002-coda-su-postgres.md) | Coda di lavori su Postgres (pg-boss) | Proposta, da approvare con la specifica v9 |
| [003](003-programmazione-gestita-dalla-piattaforma.md) | Programmazione gestita dalla piattaforma anche per Facebook | Proposta, da approvare con la specifica v9 |
| [004](004-autorizzazione-e-rls.md) | Autorizzazione nell'applicazione più Row Level Security | Proposta, da approvare con la specifica v9 |
| [005](005-host-pubblico-separato.md) | Host pubblico separato dal pannello | Proposta, da approvare con la specifica v9 |
| [006](006-api-first.md) | API-first: ogni funzione è un caso d'uso esposto da /api/v1 | Proposta, da approvare con la specifica v9 |
| [007](007-segreti-cifrati-nel-database.md) | Segreti delle integrazioni cifrati nel database | Proposta, da approvare con la specifica v9 |
| [008](008-upload-a-pezzi.md) | Upload a pezzi da 20 MB | Proposta, da approvare con la specifica v9 |
| [009](009-organizzazioni-in-un-solo-database.md) | Più organizzazioni in un solo database | Proposta, da approvare con la specifica v9 |
| [010](010-versioni-runtime.md) | Versioni di base: Node 24, Nuxt 4, TypeScript 6.0 | Proposta, da approvare con la specifica v9 |
| [011](011-identificativi-neutri.md) | Identificativi tecnici neutri | Proposta, da approvare con la specifica v9 |
| [012](012-better-auth.md) | Accesso e account con Better Auth | Accettata (Matteo, 2026-10-15) |
