# ADR 007 · Segreti delle integrazioni cifrati nel database

| | |
|---|---|
| **Stato** | Proposta, da approvare con la specifica v9 |
| **Data** | 2026-10-15 |
| **Specifica** | v9 |

## Contesto
Requisito: dopo l'installazione nessuno tocca file sulla VPS. Token Meta, SMTP e bot Telegram si configurano dal pannello.

## Decisione
Segreti cifrati con AES-256-GCM e una chiave dati per organizzazione, a sua volta cifrata con `APP_ENCRYPTION_KEY`. Mai rileggibili dal pannello (solo ultime 4 cifre e data), sostituibili con riconferma, registrati nel registro attività.

## Alternative scartate
- **Variabili d'ambiente**: richiederebbero di modificare file sulla VPS a ogni cambio.

## Conseguenze
- `APP_ENCRYPTION_KEY` è vitale: va salvata fuori dalla VPS (runbook).
- Rotazione della chiave dati per singola agenzia; cancellarla rende illeggibili i segreti di un'organizzazione eliminata.
