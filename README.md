# Feedway

Pannello self-hosted per programmare e pubblicare su **Instagram** e **Pagine Facebook** tramite le API ufficiali di Meta, pensato per agenzie che gestiscono molti clienti.

- Foto, caroselli, reel e storie, con lo stesso contenuto su più account e controlli prima della pubblicazione.
- Calendario per cliente, programmazione in blocco, anteprima come su Meta, uso comodo da telefono (PWA).
- Verifica dopo la pubblicazione e avvisi nel pannello, su Telegram e via email.
- Più utenti con ruoli, più clienti, predisposto per più agenzie isolate tra loro.
- Tutto si configura dal pannello: dopo l'installazione nessuno tocca codice o file.

## Stato

In progettazione. La versione 1.0 si sviluppa in 12 tappe, ognuna installabile e provabile.

| Documento | Contenuto |
|---|---|
| [Specifica](docs/superpowers/specs/2026-10-15-feedway-design.md) | Cosa fa la piattaforma e come è fatta |
| [Piano generale](docs/superpowers/plans/2026-10-15-00-piano-generale.md) | Le 12 tappe, le interfacce tra tappe, le regole comuni |
| [Indice della documentazione](docs/README.md) | Tutti gli altri documenti |

## Stack

Node 24 LTS · TypeScript 6.0 · Nuxt 4 + Nuxt UI 4 · PostgreSQL 17 · Drizzle · pg-boss · Zod · Vitest · Playwright · pnpm + Turborepo · Docker Compose.

## Sviluppo locale

Requisiti: Node 24, pnpm (versione in `package.json`), Docker.

```bash
pnpm install
docker compose -f docker/compose.dev.yml up -d   # Postgres (poi finto Graph API e Mailpit)
pnpm dev                                         # pannello e worker
pnpm verify                                      # formato, lint, tipi, confini, test unitari
```

Lo sviluppo non usa mai account Meta reali: c'è un finto Graph API in `tools/meta-mock`.

Prima di contribuire leggi [CONTRIBUTING.md](CONTRIBUTING.md) e il [flusso Git](docs/flusso-git.md).

## Installazione sulla VPS

```bash
curl -fsSL <url dello script nella release> -o install.sh && bash install.sh
```

Lo script chiede email, nome dell'agenzia e indirizzi, genera chiavi e password, avvia i container e stampa il link per creare il primo account. Gli aggiornamenti si fanno con `./scripts/update.sh`. Guida completa in `docs/runbooks/installazione.md` (scritta nella tappa 1).

## Struttura

```
apps/        web (Nuxt), worker, mcp (futuro)
packages/    domain, application, infrastructure, config, contracts, ui
tools/       meta-mock, fixture per i confini
docker/      immagine, compose, init del database
scripts/     installazione, aggiornamento, verifica dei backup
docs/        specifica, piani, ADR, runbook, guide
```

## Sicurezza

Per segnalare una vulnerabilità segui [SECURITY.md](SECURITY.md). Non aprire una issue pubblica.

## Licenza

Software proprietario, tutti i diritti riservati. Vedi [LICENSE](LICENSE).
