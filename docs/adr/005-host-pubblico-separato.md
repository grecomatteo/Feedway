# ADR 005 · Host pubblico separato dal pannello

| | |
|---|---|
| **Stato** | Accettata (Matteo, 2026-10-15) |
| **Data** | 2026-10-15 |
| **Specifica** | v9 |

## Contesto
Meta deve scaricare i media da un indirizzo pubblico; i clienti aprono il link di sola visione. Il pannello invece deve restare privato.

## Decisione
Due host. Su `PUBLIC_HOST` il server risponde solo a `/m/*` (media con token non elencabili) e `/share/*`; tutto il resto solo sull'host del pannello, raggiungibile via Tailscale o dietro Cloudflare Access.

## Alternative scartate
- **Pannello pubblico**: superficie d'attacco inutile.

## Conseguenze
- Due nomi da configurare (`PANEL_URL`, `PUBLIC_URL`) e due nodi Tailscale nella fase iniziale.
- I cookie del pannello non arrivano mai sull'host pubblico.
