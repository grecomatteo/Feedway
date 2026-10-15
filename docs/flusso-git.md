# Flusso Git

Come si lavora con Git e GitHub in questo progetto. Vale per tutti: persone e agenti. Le regole marcate **(CI)** o **(GitHub)** sono applicate da strumenti e non si possono aggirare.

## 1. Principi

- **`main` è sempre rilasciabile.** Ogni commit su `main` ha passato tutta la CI e si potrebbe installare.
- **Rami corti, PR piccole.** Un ramo vive al massimo pochi giorni e una PR resta leggibile in una seduta (indicativamente sotto le 400 righe di codice, test esclusi).
- **La storia racconta il progetto.** Su `main` c'è un commit per PR, con un messaggio che spiega cosa cambia e perché.
- **Niente scorciatoie.** Nessun push diretto su `main`, nessun test saltato o disattivato per far passare la CI, nessun segreto nel repository.

## 2. Rami

| Ramo | Uso | Vita |
|---|---|---|
| `main` | Codice integrato e verificato | Permanente, protetto |
| `<tipo>/<tappa>-<argomento>` | Lavoro su un task, per esempio `feat/02-login`, `fix/07-verifica-reel`, `docs/flusso-git` | Fino al merge della PR, poi cancellato in automatico |
| `release-please--…` | Creato dal bot dei rilasci | Gestito dal bot |

- `<tipo>` è lo stesso dei commit (§3). `<tappa>` è il numero a due cifre della tappa, oppure si omette fuori dalle tappe.
- Nomi in minuscolo con trattini, senza accenti.
- Si parte sempre dall'ultimo `main`: `git switch main && git pull --ff-only && git switch -c feat/02-login`.
- Per riallinearsi a `main` si usa **rebase**, mai merge: `git fetch origin && git rebase origin/main`. Dopo un rebase si pubblica con `git push --force-with-lease`, mai `--force`, e solo sul proprio ramo.
- Non esistono rami `develop` né rami di tappa: le tappe sono **milestone** e **rilasci**, non rami.

## 3. Commit

**Formato: [Conventional Commits](https://www.conventionalcommits.org/it/v1.0.0/)** **(CI: commitlint)**

```
<tipo>(<ambito>): <descrizione all'imperativo, in italiano, minuscola, senza punto finale>

<corpo facoltativo: il perché, non il come; righe da 72 caratteri>

<piè di pagina facoltativo: Closes #12, BREAKING CHANGE: …, Co-Authored-By: …>
```

| Tipo | Quando | Effetto sulla versione |
|---|---|---|
| `feat` | Nuova funzione visibile | minor |
| `fix` | Correzione di un difetto | patch |
| `perf` | Prestazioni, senza cambiare il comportamento | patch |
| `refactor` | Ristrutturazione senza cambiare il comportamento | nessuno |
| `test` | Solo test | nessuno |
| `docs` | Solo documentazione | nessuno |
| `build` | Dipendenze, Docker, pnpm | nessuno |
| `ci` | Workflow GitHub Actions | nessuno |
| `chore` | Manutenzione che non rientra negli altri tipi | nessuno |
| `revert` | Annulla un commit precedente | dipende |

- **Ambito** = il modulo (§7.3 della specifica): `identity`, `organizations`, `workspaces`, `accounts`, `media`, `posts`, `publishing`, `notifications`, `scheduling`, `sharing`, `platform`, `audit`, `ui`, `infra`, `worker`, `web`. Più ambiti: si omette.
- Un cambiamento incompatibile (API, configurazione, migrazione che richiede un passo manuale) ha `!` dopo il tipo e un piè di pagina `BREAKING CHANGE:` che spiega cosa fare.
- **Commit atomici**: ciascuno fa una cosa e lascia il codice compilabile. Durante il lavoro sul ramo si possono fare commit intermedi; prima di chiedere la revisione si riordinano con `git rebase -i` se aiutano chi legge.
- Esempio:
  ```
  feat(identity): accesso con passkey

  La passkey con verifica dell'utente vale come due fattori, quindi
  dopo l'accesso non viene chiesta la 2FA (proposta account personale §2.2).

  Closes #34
  ```

## 4. Pull request

**Una PR = un task del piano**, o un gruppo di task piccoli e legati. Il titolo è un Conventional Commit, perché diventa il messaggio del commit su `main` **(CI: commitlint sul titolo)**.

**Prima di aprirla**
1. `pnpm verify` in locale (formato, lint, tipi, confini, unit) è verde.
2. Ramo riallineato a `main` con rebase.
3. Il diff contiene solo ciò che serve al task: niente modifiche di passaggio ad altro codice.

**Descrizione** (modello in `.github/pull_request_template.md`): Prima / Dopo / Come / Come provarlo / Note per chi rivede, con il collegamento al task del piano e all'issue (`Closes #n`).

**Bozza o pronta**: si apre in **bozza** appena c'è qualcosa da mostrare, così la CI gira subito; si segna **pronta** quando la CI è verde e la descrizione è completa.

**Revisione**
- Ogni PR ha una revisione di codice prima del merge, fatta da un agente revisore separato da chi ha scritto il codice. Matteo guarda le PR che vuole, quando vuole: non è un passaggio obbligatorio.
- I commenti si risolvono con un commit o con una risposta che spiega perché no. Nessuna conversazione resta aperta al merge **(GitHub)**.
- Chi rivede controlla: corrispondenza con specifica e piano, test scritti prima e significativi, confini tra livelli e moduli, isolamento tra agenzie, sicurezza, accessibilità, chiarezza.

**Merge**
- **Chi fonde**: l'agente che ha aperto la PR la fonde da solo, appena la CI è verde, la revisione è fatta e le conversazioni sono risolte (decisione di Matteo, 2026-10-15). Matteo non deve fare nessun passaggio; se vuole fermare una PR lo scrive nella chat o nella PR.
- Solo **squash merge** **(GitHub)**: un commit per PR su `main`, con titolo e corpo presi dalla PR.
- Richiesti: tutti i controlli della CI verdi, ramo aggiornato con `main`, conversazioni risolte **(GitHub)**.
- Dopo il merge il ramo viene cancellato **(GitHub)**.

## 5. Protezione di `main` (ruleset GitHub)

Configurata come **ruleset** versionato in `.github/rulesets/main.json` e applicato con `scripts/github/apply-rulesets.sh`, così è riproducibile e rivedibile come il codice.

| Regola | Impostazione |
|---|---|
| Push diretti | Vietati, per tutti, amministratori compresi |
| Force push e cancellazione | Vietati |
| PR obbligatoria | Sì, con conversazioni risolte |
| Controlli obbligatori | `lint-types`, `architecture`, `unit`, `integration`, `e2e`, `security`, `image`, `install-smoke`, `commitlint`; dalla tappa 10 anche `site` |
| Ramo aggiornato prima del merge | Sì |
| Storia lineare | Sì (solo squash) |
| Approvazioni | Nessuna approvazione obbligatoria su GitHub: le PR degli agenti risultano aperte a nome di Matteo, che non può approvare le proprie (verificato con la PR #1). La revisione dell'agente revisore è obbligatoria nella checklist della PR; `CODEOWNERS` segnala a Matteo le PR che toccano `.github/`, `scripts/`, `docker/`, migrazioni o sicurezza, senza bloccarle |

## 6. Versioni e rilasci

- **Versionamento semantico** (`MAJOR.MINOR.PATCH`). Fino alla 1.0 ogni tappa produce una minor: tappa 1 → `0.1.0`, tappa 2 → `0.2.0` … La tappa 12 produce `1.0.0`.
- **release-please** legge i commit su `main` e tiene aperta una **PR di rilascio** con il `CHANGELOG.md` e la versione successiva. L'agente la fonde a fine tappa, quando tutti i criteri di fine tappa sono verificati; Matteo installa la nuova versione con `update.sh` e la prova.
- Il merge della PR di rilascio crea il **tag** `vX.Y.Z` e la **GitHub Release** con le note "Cosa provare", poi la CI pubblica l'immagine su GHCR con tag di versione e digest.
- Sulla VPS si installa sempre una versione con tag, mai `main`: `./scripts/update.sh vX.Y.Z`.
- **Milestone GitHub** = tappa. Ogni issue e PR della tappa appartiene alla sua milestone.

## 7. Correzioni urgenti e ritorni indietro

- **Correzione urgente su una versione installata**: ramo `fix/<argomento>` da `main`, PR con test che riproduce il difetto, merge, rilascio patch (`vX.Y.Z+1`) con la PR di rilascio, `update.sh` sulla VPS.
- **Ritorno indietro sulla VPS**: `./scripts/update.sh --rollback` (le migrazioni restano compatibili per un rilascio, §16.5 della specifica).
- **Annullare un cambiamento su `main`**: `git revert <commit>` in un ramo `revert/…` e PR. La storia di `main` non si riscrive mai.

## 8. Issue

- Ogni difetto o richiesta diventa una **issue** con il modello in `.github/ISSUE_TEMPLATE/`.
- Etichette: `tipo:bug`, `tipo:funzione`, `tipo:debito`, `priorità:alta|media|bassa`, `modulo:<nome>`, `sicurezza`.
- Una vulnerabilità **non** si apre come issue pubblica: si segue `SECURITY.md`.

## 9. Ganci locali (Husky)

| Gancio | Cosa fa |
|---|---|
| `pre-commit` | lint-staged: Prettier ed ESLint sui file in commit; gitleaks sui file in commit |
| `commit-msg` | commitlint |
| `pre-push` | `pnpm typecheck` e `pnpm test:unit` |

I ganci aiutano, ma la verità è la CI: un gancio saltato con `--no-verify` viene comunque fermato lì.

## 10. Segreti e file da non versionare

- Mai nel repository: `.env`, token, chiavi, password, dump del database, file dei clienti, risposte registrate di Meta che contengono token.
- **gitleaks** in locale e in CI, più la **protezione dai push con segreti** di GitHub attiva.
- Se un segreto finisce in un commit, anche solo su un ramo: **si considera compromesso**. Si revoca e si sostituisce subito, poi si pulisce la storia del ramo. Cancellare il commit da solo non basta.
- `.gitignore` e `.gitattributes` (fine riga LF, file binari marcati) sono alla radice e si cambiano solo con una PR.

## 11. Firma dei commit

Matteo firma i propri commit con una chiave SSH registrata su GitHub (badge "Verified"). I commit degli agenti portano il piè di pagina `Co-Authored-By` del proprio strumento. La firma non è obbligatoria nel ruleset finché gli agenti non possono firmare; quando potranno, diventa obbligatoria.

## 12. Riepilogo per una giornata tipo

```bash
git switch main && git pull --ff-only
git switch -c feat/02-login
# test che fallisce → codice → test verde → commit, più volte
git fetch origin && git rebase origin/main
pnpm verify
git push -u origin feat/02-login
gh pr create --draft --fill        # poi: descrizione, CI verde, "pronta"
# revisione → correzioni → squash merge → ramo cancellato
```
