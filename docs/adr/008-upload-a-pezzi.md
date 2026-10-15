# ADR 008 · Upload a pezzi da 20 MB

| | |
|---|---|
| **Stato** | Proposta, da approvare con la specifica v9 |
| **Data** | 2026-10-15 |
| **Specifica** | v9 |

## Contesto
Video lunghi caricati spesso da telefono, su reti instabili. Cloudflare gratuito rifiuta richieste oltre 100 MB.

## Decisione
Upload a pezzi da 20 MB con ripresa, verifica dell'impronta alla fine.

## Alternative scartate
- **Upload singolo**: fallisce oltre 100 MB dietro Cloudflare e ricomincia da zero a ogni interruzione.

## Conseguenze
- Più richieste da gestire e pezzi incompleti da pulire (pulizia notturna).
