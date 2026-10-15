# Prototipo Feedway

Prototipo navigabile di app e landing con **dati fittizi**. È materiale da buttare: non è il codice dell'app, che nasce dalla tappa 1 del piano. Nulla viene pubblicato e non c'è backend: lo stato della demo vive in memoria e in `localStorage` di questo browser, e si ripristina dalla barra in alto.

Stack: Nuxt 4.6, Nuxt UI 4.12, Tailwind 4, Luxon (stesse scelte di `docs/stack.md`). Si avvia con npm perché il prototipo è fuori dal monorepo.

```sh
cd design/prototipo
npm install
npm run dev   # http://localhost:3100
```

## Percorsi

| Route | Cosa mostra |
|---|---|
| `/` | Landing L01–L08: hero affiancato, tab delle viste, tre passaggi, esiti, più clienti, FAQ, chiusura; menu mobile |
| `/accedi` | Accesso non attivo nel prototipo, rimanda alla demo |
| `/demo/calendario` | Settimana visuale (scelta A), mese, elenco; filtri con stato «nessun risultato»; giornata con 12 post il 22 ottobre |
| `/demo/post/nuovo` | Cliente → destinazioni → upload (con connessione persa e ripresa) → caption → data/fuso (con l'ora ambigua del 25 ottobre) → controlli → riepilogo → programmato |
| `/demo/post/:id` | Esito per destinazione; `post-partial` 4 confermate + 1 con problema, `post-uncertain` 4 confermate + 1 da accertare; «Simula l'orario di uscita» sui post programmati |
| `/demo/import` | 20 righe, 18 pronte e 2 bloccate, «Programma 18 post» |
| `/demo/condivisione` | Link cliente; `/cliente/:token` vista pubblica in sola lettura (attivo, protetto, scaduto, revocato, vuoto) |

Ruoli (Manager, Editor, Viewer) e tema scuro si cambiano dalla barra della demo.

## Differenze dai dati del pacchetto

- `fl-facebook-lab` è «da ricollegare» per mostrare un account non selezionabile; in `scenari.json` è attivo.
- Le foto sono immagini stock Unsplash caricate da remoto, segnaposto dichiarati dei clienti fittizi.
- La password del link protetto di prova è `forma2026`.
