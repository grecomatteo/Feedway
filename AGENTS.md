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

- Conventional Commits in italiano (`feat(identity): accesso con passkey`), senza piè di pagina `Co-Authored-By` o simili.
- **Il nome dello strumento o del modello non compare mai** (regola di Matteo): né nei commit (autore, messaggio, piè di pagina), né nelle PR (titolo, descrizione, commenti, link a sessioni), né nel codice, nei file o nei rami. Se uno strumento aggiunge da solo attribuzioni o link, toglile prima del commit o della PR.
- Descrizione della PR secondo `.github/pull_request_template.md`.
- **Fondi da solo la tua PR** (squash) appena la CI è verde, la revisione dell'agente revisore è fatta e le conversazioni sono risolte. Non aspettare Matteo: lo ha chiesto lui ([flusso Git](docs/flusso-git.md) §4).

## Lingua

- Documentazione, testi dell'interfaccia, messaggi di commit e PR: **italiano**.
- Codice, nomi di file, identificativi, nomi dei test: **inglese**.
- Commenti nel codice: in inglese, solo dove il perché non è evidente.

## Design Feedway

- Per nuovo lavoro UI o cambiamenti ai flussi, leggi `design/brief-feedway/03-BRIEF-APP.md` oppure `04-BRIEF-LANDING.md` secondo la superficie. Controlla il v9 originale quando cambiano dominio o permessi.
- Per logo, colori e tipografia usa `design/brief-feedway/brand/Feedway-Brand-Kit-v1.0/GUIDA-DEL-MARCHIO.md`. Gli asset approvati e il brief prevalgono sulle preferenze generiche delle skill.
- Usa Pencil tramite MCP e le istruzioni ottenute da `read_skill()`. Gestisci il file `design/feedway-ui.pen` con gli strumenti Pencil. Mantieni modificabili componenti e variabili.
- Per revisioni UI, errori, responsive e prestazioni usa `design/brief-feedway/06-PROMPT-REVISIONE.md` e i criteri del documento 05. Separa osservazioni sulla tela, prove nel browser e controlli del codice.
- Conserva contesto durevole in `PRODUCT.md`, scelte adottate in `DESIGN.md` e prove/prossime azioni in `design/reviews/`. Leggi la decisione corrente prima di proporre nuove varianti.
- Il prototipo in `design/prototipo/` è materiale da buttare: non è il codice dell'app, che nasce dalla tappa 1 del piano.
- Feedway è il nome pubblico; il nome storico OpenMeta resta nel documento originale. Mantieni i nomi tecnici esistenti salvo un'attività esplicita di migrazione.
