# ADR 006 · API-first: ogni funzione è un caso d'uso esposto da /api/v1

| | |
|---|---|
| **Stato** | Proposta, da approvare con la specifica v9 |
| **Data** | 2026-10-15 |
| **Specifica** | v9 |

## Contesto
In futuro la piattaforma si userà anche da MCP e da altri client. La logica nelle pagine lo impedirebbe.

## Decisione
Ogni funzione è un caso d'uso in `packages/application`, esposto da `/api/v1/orgs/:org/...` con contratti Zod e documento OpenAPI. Il pannello usa le stesse API.

## Alternative scartate
- **Logica nelle pagine o nelle rotte**: duplicazioni e permessi controllati in punti diversi.

## Conseguenze
- Un client nuovo (MCP, app) non richiede logica nuova.
- I contratti sono la frontiera stabile: un cambiamento incompatibile richiede una nuova versione.
