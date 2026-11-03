# Feedway

**Tutta la tua agenzia, in un solo posto.**

Pannello self-hosted per programmare e pubblicare su **Instagram** e **Pagine Facebook** tramite le API ufficiali di Meta, pensato per agenzie che gestiscono molti clienti.

- Foto, caroselli, reel e storie, con gli stessi media su più account, caption adattabile per piattaforma e controlli prima della pubblicazione.
- Calendario per cliente, programmazione in blocco, anteprima come su Meta, uso comodo da telefono (PWA).
- Verifica dopo la pubblicazione e avvisi nel pannello, su Telegram e via email.
- Più utenti con ruoli, più clienti, predisposto per più agenzie isolate tra loro.
- Tutto si configura dal pannello: dopo l'installazione nessuno tocca codice o file.

Dopo la 1.0 Feedway diventa l'hub dell'agenzia: clienti e CRM, portale del cliente, shooting, team, cruscotti e report ([direzione decisa](docs/superpowers/specs/2026-10-29-feedway-hub-agenzia.md)).

## Stato

In sviluppo. La versione 1.0 si costruisce in 12 tappe, ognuna installabile e provabile.

| Tappa | Contenuto | Stato |
|---|---|---|
| 1 · Fondamenta | Monorepo, database con isolamento tra agenzie, coda, immagine Docker, installazione su VPS con Tailscale | Fatta |
| 2 · Identità | Accesso con password, passkey e secondo passaggio; agenzie, clienti (spazi), ruoli e inviti; registro attività; profilo e foto; email di sistema; privacy (scarica i miei dati, elimina l'account, conservazione automatica, informativa) | Fatta (resta la prova di Matteo sulla VPS) |
| 3 · Meta | Collegamento di Pagine Facebook e profili Instagram: utente di sistema e accesso unificato di Meta | Piano pronto, da avviare |
| 4–12 | Contenuti, pubblicazione, calendario, notifiche, backup e il resto della 1.0 | Vedi il piano generale |

| Documento | Contenuto |
|---|---|
| [Specifica](docs/superpowers/specs/2026-10-15-feedway-design.md) | Cosa fa la piattaforma e come è fatta |
| [Hub per l'agenzia](docs/superpowers/specs/2026-10-29-feedway-hub-agenzia.md) | Le funzioni decise dopo la 1.0 e l'ordine di riferimento delle versioni |
| [Piano generale](docs/superpowers/plans/2026-10-15-00-piano-generale.md) | Le 12 tappe, le interfacce tra tappe, le regole comuni |
| [Indice della documentazione](docs/README.md) | Tutti gli altri documenti |

## Stack

Node 24 LTS · TypeScript 6.0 · Nuxt 4 + Nuxt UI 4 · PostgreSQL 18 · Drizzle · pg-boss · Zod · Vitest · Playwright · pnpm + Turborepo · Docker Compose. Alternative valutate e motivi: [docs/stack.md](docs/stack.md).

## Sviluppo locale

Requisiti: Node 24, pnpm (versione in `package.json`), Docker.

```bash
pnpm install
docker compose -f docker/compose.dev.yml up -d   # Postgres
pnpm dev                                         # pannello su app.feedway.localhost, worker
pnpm verify                                      # formato, lint, tipi, confini, test unitari
pnpm test:int                                    # test con il database (serve Docker)
pnpm build && pnpm test:e2e                      # schermate con Playwright e axe
```

Lo sviluppo non usa mai account Meta reali: dalla tappa 3 c'è un finto Graph API in `tools/meta-mock`. Le email di sistema si provano senza un server vero (vedi [email di sistema](docs/runbooks/email-di-sistema.md)).

Prima di contribuire leggi [CONTRIBUTING.md](CONTRIBUTING.md) e il [flusso Git](docs/flusso-git.md).

## Installazione sulla VPS

```bash
git clone <repository> /opt/feedway && cd /opt/feedway
git checkout <versione>
./scripts/install.sh
```

Lo script chiede il nome host Tailscale, la chiave di Tailscale e l'email dell'Owner, genera chiavi e password, avvia i container e stampa il link per creare il primo account. Il pannello risponde su `https://<nome>.<rete>.ts.net`, solo dai dispositivi della rete Tailscale. Gli aggiornamenti si fanno con `./scripts/update.sh`, che sa anche tornare alla versione precedente.

Guide: [installazione e aggiornamento](docs/runbooks/installazione.md), [email di sistema](docs/runbooks/email-di-sistema.md), [violazione dei dati](docs/runbooks/violazione-dati.md). Il [registro dei trattamenti](docs/privacy/registro-trattamenti.md) ha alcuni campi da completare a cura dell'agenzia.

## Struttura

```
apps/        web (pannello Nuxt e API), worker (lavori in coda e comandi `cli`)
             in arrivo: site (sito pubblico), mcp
packages/    domain, application, infrastructure, config, contracts, ui
tools/       regole di lint e fixture per i confini (dalla tappa 3: meta-mock)
docker/      immagine, compose (produzione, sviluppo, CI), Postgres, Tailscale
scripts/     installazione, aggiornamento, controlli della CI
docs/        specifica, piani, ADR, runbook, privacy, convenzioni
design/      brief, marchio, prototipo grafico
```

## Sicurezza

Per segnalare una vulnerabilità segui [SECURITY.md](SECURITY.md). Non aprire una issue pubblica.

## Licenza

Software proprietario, tutti i diritti riservati. Vedi [LICENSE](LICENSE).
