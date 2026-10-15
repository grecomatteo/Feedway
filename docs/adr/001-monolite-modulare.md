# ADR 001 · Monolite modulare: web + worker

| | |
|---|---|
| **Stato** | Accettata (Matteo, 2026-10-15) |
| **Data** | 2026-10-15 |
| **Specifica** | v9 |

## Contesto
Una piattaforma per un'agenzia, una VPS da 2 core, un team piccolo. Il carico è basso e prevedibile; la complessità sta nelle regole di pubblicazione, non nella scala.

## Decisione
Un solo repository e una sola immagine con due processi: **web** (pannello Nuxt e API) e **worker** (lavori in coda). Il codice è diviso in livelli (`domain → application → infrastructure/apps`) e in moduli (specifica §7.3), con confini verificati in CI.

## Alternative scartate
- **Microservizi**: troppe parti da distribuire, osservare e versionare per questo carico e questo team.
- **Un solo processo**: conversioni video e pubblicazioni rallenterebbero il pannello.

## Conseguenze
- Una sola versione da rilasciare e ripristinare.
- I moduli restano separabili: se un giorno servisse, uno di essi può diventare un servizio a sé senza riscrivere le regole.
- I confini vanno difesi in CI (dependency-cruiser), altrimenti il monolite si aggroviglia.
