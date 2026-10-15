# ADR 003 · Programmazione gestita dalla piattaforma anche per Facebook

| | |
|---|---|
| **Stato** | Accettata (Matteo, 2026-10-15) |
| **Data** | 2026-10-15 |
| **Specifica** | v9 |

## Contesto
Facebook permette la programmazione nativa, Instagram no. Una sola logica di pubblicazione rende verifiche, tentativi e notifiche uguali per tutti.

## Decisione
Ogni destinazione viene pubblicata dal worker all'orario, per Instagram e per Facebook.

## Alternative scartate
- **Programmazione nativa di Facebook**: due logiche diverse, con stati e errori diversi da riconciliare.

## Conseguenze
- I post programmati non compaiono in "Post programmati" di Meta Business Suite finché non escono: va detto agli utenti.
- La puntualità dipende dal worker: riconciliatore ogni minuto e sorveglianza esterna (specifica §9, §16.7).
