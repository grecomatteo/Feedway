# ADR 009 · Più organizzazioni in un solo database

| | |
|---|---|
| **Stato** | Proposta, da approvare con la specifica v9 |
| **Data** | 2026-10-15 |
| **Specifica** | v9 |

## Contesto
La piattaforma deve poter ospitare molte agenzie (2.0) senza moltiplicare i costi fissi.

## Decisione
Un solo database e un solo schema; `organization_id` su ogni riga con dati di un'organizzazione; RLS (ADR 004); chiavi dei file con prefisso `org/<id>/`.

## Alternative scartate
- **Un database o uno schema per agenzia**: migrazioni e backup moltiplicati, costi fissi alti. Resta possibile per una singola agenzia molto grande (stessa immagine, installazione dedicata).

## Conseguenze
- Indici che iniziano con `organization_id`.
- Esportazione e cancellazione di un'agenzia semplici, perché tutto porta il suo ID.
- Partizionamento o distribuzione per `organization_id` possibili in futuro (specifica §6.4).
