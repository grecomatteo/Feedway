# ADR 002 · Coda di lavori su Postgres (pg-boss)

| | |
|---|---|
| **Stato** | Proposta, da approvare con la specifica v9 |
| **Data** | 2026-10-15 |
| **Specifica** | v9 |

## Contesto
Servono lavori programmati, tentativi con attesa crescente, unicità (nessun doppione) e sopravvivenza ai riavvii. Postgres c'è già.

## Decisione
Coda **pg-boss 12** sullo stesso Postgres, schema `pgboss`. Chiavi di unicità per destinazione e passo; `SKIP LOCKED`; lavori riletti dal database a ogni esecuzione. `app_runtime` ha solo i permessi DML sullo schema `pgboss` (DDL solo se pg-boss lo richiede a runtime, e solo lì).

## Alternative scartate
- **Redis + BullMQ**: un servizio in più da gestire, salvare e proteggere, senza benefici a questo carico; e i lavori non sarebbero nella stessa transazione dei dati.

## Conseguenze
- Un lavoro può nascere nella stessa transazione che modifica i dati (niente lavori orfani).
- Il backup del database include anche la coda.
- Con carichi molto più alti si valuterà una coda dedicata; l'interfaccia `JobQueue` lo permette.
