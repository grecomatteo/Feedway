# ADR 010 · Versioni di base: Node 24, Nuxt 4, TypeScript 6.0

| | |
|---|---|
| **Stato** | Proposta, da approvare con la specifica v9 |
| **Data** | 2026-10-15 |
| **Specifica** | v9 |

## Contesto
La 1.0 vivrà almeno fino al 2028. Le versioni di base devono essere supportate per tutto quel periodo.

## Decisione
**Node 24 LTS** (supportato fino ad aprile 2028), **Nuxt 4** con **Nuxt UI 4**, **TypeScript 6.0** fissato (`~6.0.3`).

## Alternative scartate
- **Node 22**: esce dal supporto ad aprile 2027.
- **Nuxt 3**: non riceve più aggiornamenti di sicurezza.
- **TypeScript 7** (nuovo compilatore): non ancora garantito con `vue-tsc`.

## Conseguenze
- Renovate proporrà il passaggio a TypeScript 7 quando sarà compatibile.
- Aggiornamenti major sempre in PR separate con tutti i test.
