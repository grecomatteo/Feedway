# Decisioni architetturali (ADR)

Ogni decisione importante ha una scheda: contesto, decisione, alternative scartate, conseguenze. Una decisione non si modifica: se cambia, una nuova ADR la sostituisce e la vecchia passa a "Sostituita da ADR NNN". Se cambiano solo alcuni punti, la vecchia resta valida e passa a "In parte modificata da ADR NNN", e la nuova elenca i punti modificati. Modello: [000-modello.md](000-modello.md).

| ADR | Decisione | Stato |
|---|---|---|
| [001](001-monolite-modulare.md) | Monolite modulare: web + worker | Accettata (Matteo, 2026-10-15) |
| [002](002-coda-su-postgres.md) | Coda di lavori su Postgres (pg-boss) | Accettata (Matteo, 2026-10-15) |
| [003](003-programmazione-gestita-dalla-piattaforma.md) | Programmazione gestita dalla piattaforma anche per Facebook | Accettata (Matteo, 2026-10-15) |
| [004](004-autorizzazione-e-rls.md) | Autorizzazione nell'applicazione più Row Level Security | Accettata (Matteo, 2026-10-15) |
| [005](005-host-pubblico-separato.md) | Host pubblico separato dal pannello | Accettata (Matteo, 2026-10-15) |
| [006](006-api-first.md) | API-first: ogni funzione è un caso d'uso esposto da /api/v1 | Accettata (Matteo, 2026-10-15) |
| [007](007-segreti-cifrati-nel-database.md) | Segreti delle integrazioni cifrati nel database | Accettata (Matteo, 2026-10-15) |
| [008](008-upload-a-pezzi.md) | Upload a pezzi da 20 MB | Accettata (Matteo, 2026-10-15) |
| [009](009-organizzazioni-in-un-solo-database.md) | Più organizzazioni in un solo database | Accettata (Matteo, 2026-10-15) |
| [010](010-versioni-runtime.md) | Versioni di base: Node 24, Nuxt 4, TypeScript 6.0 | Accettata (Matteo, 2026-10-15) |
| [011](011-identificativi-neutri.md) | Identificativi tecnici neutri | Accettata (Matteo, 2026-10-15) |
| [012](012-better-auth.md) | Accesso e account con Better Auth | Accettata (Matteo, 2026-10-15) |
| [013](013-sito-pubblico-statico.md) | Sito pubblico statico separato dal pannello | Accettata (Matteo, 2026-10-15); in parte modificata da ADR 016 |
| [014](014-worker-impacchettato-con-esbuild.md) | Worker e migrazione impacchettati con esbuild | Accettata (Matteo, 2026-10-17) |
| [015](015-collegamenti-account-multipli.md) | Collegamenti account multipli (login Facebook, login Instagram, utente di sistema) | Accettata (Matteo, 2026-10-16) |
| [016](016-modulo-richiesta-demo.md) | Modulo "Richiedi una demo" sul sito pubblico (modifica due punti di ADR 013) | Accettata (Matteo, 2026-10-29) |
| [017](017-invio-email-via-smtp.md) | Invio email via SMTP della piattaforma (anticipato dalla tappa 3; modifica un punto di ADR 007) | Proposta |
