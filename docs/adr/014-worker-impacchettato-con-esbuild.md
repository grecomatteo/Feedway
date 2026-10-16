# ADR 014 · Worker e comando di migrazione impacchettati con esbuild

| | |
|---|---|
| **Stato** | Proposta (da confermare da Matteo) |
| **Data** | 2026-10-16 |
| **Specifica** | v9 |

## Contesto
I pacchetti del workspace sono sorgenti TypeScript (`exports` punta a `src/index.ts`). Node 24 esegue TypeScript togliendo i tipi, ma non dentro `node_modules`, dove `pnpm deploy` copia i pacchetti del workspace. L'immagine ha quindi bisogno di JavaScript già pronto per il worker (`apps/worker/dist/main.js`), per il controllo di salute e per il comando `migrate`.

## Decisione
`apps/worker/build.mjs` usa **esbuild** (già presente nel lockfile come dipendenza di Nuxt e Vite, ora dichiarato in `apps/worker` alla stessa versione) per creare tre file in `dist/`. I pacchetti `@app/*` sono inclusi nel file; ogni altra dipendenza resta esterna e viene da `node_modules` di produzione (`pnpm deploy --prod`). Le migrazioni SQL sono copiate in `dist/migrations`.

## Alternative scartate
- **Copiare i sorgenti e lanciare con `--experimental-strip-types`**: non funziona per i pacchetti dentro `node_modules`.
- **`tsc` con `outDir`**: richiederebbe di pubblicare ogni pacchetto del workspace già compilato e di cambiare gli `exports`.

## Conseguenze
- Nessuna dipendenza nuova in `pnpm-lock.yaml`: cambia solo dove esbuild è dichiarato.
- Il comando `cli` (tappa 2) potrà usare lo stesso meccanismo.
