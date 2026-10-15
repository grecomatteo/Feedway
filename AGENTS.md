# Istruzioni per gli agenti

Questo file vale per ogni agente di programmazione (Claude Code, Codex e altri). `CLAUDE.md` lo importa. Le regole di [CONTRIBUTING.md](CONTRIBUTING.md) e del [flusso Git](docs/flusso-git.md) valgono anche per te: questo file aggiunge ciò che serve a un agente.

## Da leggere prima di ogni task

1. Il task nel piano della tappa (`docs/superpowers/plans/2026-10-15-NN-*.md`) e le sezioni della specifica che cita.
2. Le "Regole comuni" del [piano generale](docs/superpowers/plans/2026-10-15-00-piano-generale.md) §4 e i punti d'attenzione §8.
3. [docs/convenzioni.md](docs/convenzioni.md) e, se tocchi un modulo, [docs/moduli.md](docs/moduli.md).

Se specifica, piano e codice non sono d'accordo, fermati e segnala la differenza: non scegliere da solo.

## Come lavori

- **Un task alla volta**, su un ramo `<tipo>/<tappa>-<argomento>`, con una PR piccola. Non allargare il lavoro oltre il task.
- **TDD**: test che fallisce → codice minimo → test verde → commit. Mostra l'esito dei comandi, non riassumerlo a memoria.
- **Prima di dire "fatto"**: `pnpm verify` verde, test pertinenti verdi, diff riletto. Se qualcosa non è verificato, dillo.
- **Mai**: disattivare o saltare test, usare `--no-verify`, fare push su `main`, riscrivere la storia di rami altrui, aggiungere dipendenze non previste dal piano senza una ADR.

## Segreti e Meta

- Non chiedere mai token, password o chiavi reali e non scriverli in file, log, test, commit o messaggi. Matteo incolla il token Meta **nel pannello**, mai in chat.
- Nessuna chiamata ad account Meta reali da test o script: usa `tools/meta-mock`. Ciò che non è stato provato su Meta vera va scritto come "non verificato".

## Isolamento tra agenzie

- Ogni tabella con dati di un'organizzazione ha `organization_id` e RLS.
- Ogni caso d'uso lavora dentro `uow.run({ organizationId, userId })`.
- `runAsSystem` solo nei moduli consentiti dalla regola ESLint.
- Ogni rotta o lavoro nuovo entra nella batteria di isolamento.

## Commit e PR

- Conventional Commits in italiano (`feat(identity): accesso con passkey`), con il piè di pagina `Co-Authored-By` del tuo strumento.
- Nessun identificativo di modello nei commit, nelle PR o nel codice.
- Descrizione della PR secondo `.github/pull_request_template.md`.

## Lingua

- Documentazione, testi dell'interfaccia, messaggi di commit e PR: **italiano**.
- Codice, nomi di file, identificativi, nomi dei test: **inglese**.
- Commenti nel codice: in inglese, solo dove il perché non è evidente.
