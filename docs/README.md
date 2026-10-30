# Documentazione

| Documento | A cosa serve | Quando si aggiorna |
|---|---|---|
| [Specifica](superpowers/specs/2026-10-15-feedway-design.md) | Cosa fa la piattaforma e come è fatta: la fonte di verità | A ogni decisione che cambia comportamento o architettura |
| [Hub per l'agenzia](superpowers/specs/2026-10-29-feedway-hub-agenzia.md) | Direzione dopo la 1.0: funzioni decise, proposte, rimandate e scartate, landing | A ogni decisione sull'hub; le versioni si fissano quando si scrive il piano |
| [Motivazioni account personale](superpowers/specs/2026-10-15-account-personale-proposta.md) | Perché Better Auth, confronto opzioni e costi, scelte GDPR | Non si aggiorna: integrata nella specifica v9 |
| [Piano generale](superpowers/plans/2026-10-15-00-piano-generale.md) | Le 12 tappe, interfacce tra tappe, regole comuni | A ogni tappa |
| Piani delle tappe (`superpowers/plans/2026-10-15-NN-*.md`) | Task eseguibili, file, firme, test | Scritti all'inizio di ogni tappa, sul codice reale |
| `design/` (alla radice) | Progetto grafico in Pencil, branding (`design/brand/`) e guida al design | Quando Matteo manda nuovo materiale (specifica §14.1) |
| [Stack](stack.md) | Ogni componente con le alternative valutate e lo stato delle versioni | A ogni cambio di componente e a ogni revisione periodica |
| [ADR](adr/README.md) | Decisioni architetturali con le alternative scartate | Una nuova scheda per ogni decisione importante |
| [Flusso Git](flusso-git.md) | Rami, commit, PR, protezione di `main`, rilasci | Quando cambia il modo di lavorare |
| [Convenzioni](convenzioni.md) | Lingua, TypeScript, nomi, errori, tempo, database, interfaccia | Quando nasce una regola nuova |
| [Moduli](moduli.md) | Ricetta per aggiungere un modulo | Quando cambia la forma di un modulo |
| [CONTRIBUTING](../CONTRIBUTING.md) · [AGENTS](../AGENTS.md) · [SECURITY](../SECURITY.md) | Come si contribuisce, istruzioni per gli agenti, segnalazioni di sicurezza | Raramente |

## Documenti che nascono durante lo sviluppo

Si scrivono insieme al codice che descrivono, così non restano mai indietro:

| Documento | Tappa |
|---|---|
| `runbooks/installazione.md` | 1 |
| `runbooks/aggiornamento-e-rollback.md` | 1 |
| `runbooks/primo-accesso-e-nuova-agenzia.md` | 2 |
| [`runbooks/email-di-sistema.md`](runbooks/email-di-sistema.md) | 2 |
| `privacy/informativa.md`, `privacy/registro-trattamenti.md` | 2 |
| `runbooks/rotazione-token-meta.md` | 3 |
| `runbooks/meta-collegamento-account.md` | 3 |
| `runbooks/ripristino-backup.md`, `runbooks/violazione-dati.md`, `runbooks/incidenti.md` | 11 |
| `CHANGELOG.md` (alla radice) | Generato da release-please a ogni rilascio |
