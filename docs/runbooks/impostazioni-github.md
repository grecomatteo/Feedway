# Impostazioni GitHub da fare una volta

Cose che solo il proprietario del repository può attivare. Il codice del repository le presume.

## 1. Protezione di `main`

Con la GitHub CLI (`gh auth login` con un account amministratore):

```bash
./scripts/github/apply-rulesets.sh grecomatteo/Feedway
```

In alternativa: Settings → Rules → Rulesets → New ruleset → Import a ruleset, e scegliere `.github/rulesets/main.json`. Si può rilanciare: se il ruleset esiste lo aggiorna.

I nove controlli obbligatori sono i nomi dei job: `lint-types`, `architecture`, `unit`, `integration`, `e2e`, `security`, `image`, `install-smoke`, `commitlint`. Un controllo compare tra quelli selezionabili solo dopo essere girato almeno una volta.

## 2. Unione delle PR

Settings → General → Pull Requests: lasciare **solo "Allow squash merging"** e attivare **"Automatically delete head branches"**.

## 3. Sicurezza

Settings → Code security:

- attivare **Private vulnerability reporting**;
- Secret scanning, Push protection e Code scanning richiedono un repository pubblico o GitHub Advanced Security: finché il repository è privato li copre gitleaks in CI;
- se il repository diventa pubblico, reintrodurre il workflow CodeQL.

## 4. Pubblicazione dell'immagine (GHCR)

Settings → Actions → General → Workflow permissions: **Read and write permissions**, oppure lasciare "Read" (i job che pubblicano chiedono i permessi che servono). Dopo la prima release, in Packages → `feedway` → Package settings, collegare il pacchetto al repository e, se serve, renderlo privato o pubblico.

## 5. Rilasci

Settings → Actions → General → **Allow GitHub Actions to create and approve pull requests**: serve a release-please per aprire la PR di rilascio.

## 6. Aggiornamento delle dipendenze

Installare l'app **Renovate** (github.com/apps/renovate) sul repository. La configurazione è in `renovate.json`: una PR a settimana per patch e minor, una PR per ogni major, mai merge automatico.
