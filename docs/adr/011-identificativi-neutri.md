# ADR 011 · Identificativi tecnici neutri

| | |
|---|---|
| **Stato** | Proposta, da approvare con la specifica v9 |
| **Data** | 2026-10-15 |
| **Specifica** | v9 |

## Contesto
Il nome della piattaforma non è ancora deciso e potrebbe cambiare anche dopo.

## Decisione
Nessun identificativo tecnico contiene il nome: pacchetti `@app/*`, ruoli `app_migrator`/`app_runtime`, database `app`, cookie e container `app-*`. Il nome visibile sta in una sola costante `PRODUCT_NAME` (`packages/config/src/product.ts`), il logo si carica dal pannello.

## Alternative scartate
- **Nome negli identificativi**: cambiarlo richiederebbe migrazioni, rinomine e reinstallazioni.

## Conseguenze
- Cambiare nome = cambiare una costante, caricare il logo, rinominare il repository.
