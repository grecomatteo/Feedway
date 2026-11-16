# Revisione UI — tappa 4 (Libreria, caricamenti, temi colore, pagina d'errore)

## Sessione

- Data: 16 novembre 2026. Revisione secondo `design/brief-feedway/06-PROMPT-REVISIONE.md`, chiesta dal punto P8 della revisione finale della tappa 4 (manca la revisione dei Task 6 e 12).
- Schermate: Libreria (computer e telefono), cartelle, dettaglio del file, sposta, caricamenti e caricamenti rimasti a metà, Impostazioni → Colori, pagina d'errore (404 e 500).
- Prove nel browser: build di produzione con `tools/meta-mock`, Playwright Chromium, 1280×720 e Pixel 7 (412 px), chiaro e scuro, temi Feedway e Blu, nome di cliente lungo («Panificio Forno Luce di Via Garibaldi e Figli»), nome di file e tag lunghi, file non riuscito, zoom 200 % simulato con la finestra a metà larghezza. Rivisti anche gli screenshot dei Task 12, 13 e 13b in `schermate/tappa-4-*`.
- **Pencil non era disponibile** in questa sessione: nessuna osservazione sulla tela e nessun aggiornamento a `design/feedway-ui.pen` (D-27).

## Prove nel browser

| ID | Dove | Osservazione | Esito |
|---|---|---|---|
| R1 | Pagina d'errore | Con un tema diverso da Feedway (es. Blu) la pagina d'errore torna arancio: sia aprendo un indirizzo inesistente dal pannello, sia caricandolo direttamente, sia sul 500. `error.vue` sostituisce `app.vue`, che era l'unico punto a mettere `data-palette` su `<html>` | **Corretto**: `useHtmlPalette()` in `app.vue` e `error.vue`; caricata direttamente, la pagina d'errore legge la sessione. Test E2E in `palette.spec.ts` |
| R2 | Pagina d'errore a 390 px, chiaro e scuro | Nessuno scorrimento laterale; il codice per l'assistenza va a capo dentro il riquadro; «Torna alla home» ≥ 44 px; axe senza violazioni | Va bene |
| R3 | Pagina d'errore con sessione | Ora che legge la sessione, la barra in alto mostra Agenzia, Impostazioni ed Esci come nelle altre pagine pubbliche; a 390 px va su due righe | Va bene |
| R4 | Libreria, filtri | La tendina «Tutti i tag» e quella delle cartelle (telefono) avevano testo e icona più grandi del campo «Cerca per nome» accanto | **Corretto**: stesso corpo (14 px) e icona (18 px) del campo di ricerca, altezza 44 px invariata |
| R5 | Libreria, nomi lunghi | Nomi di file lunghi troncati con i puntini nella scheda; il nome intero è nel dettaglio. Nome del cliente lungo va a capo nell'intestazione e si tronca nella barra | Va bene |
| R6 | Libreria, 1280 e 412 px, tutti i temi | Nessuno scorrimento laterale; «Non riuscito» ha pallino, parola e colore; durata del video con icona | Va bene |
| R7 | Dettaglio di un file non riuscito | Riquadro «Perché non è riuscito» con il motivo in parole, poi i dati del file | Va bene |
| R8 | Zoom 200 % sul telefono (finestra di 206 px) | Il titolo col nome lungo spezza le parole e la pagina scorre di lato | Sotto i 320 px richiesti da WCAG 1.4.10: non è un difetto. A 1280 px con zoom 200 % (640 px) nessuno scorrimento |
| R9 | Barra in basso (telefono) | L'etichetta «Presto» di Calendario esce dalla voce e il pulsante centrale dice «Presto» invece di «Nuovo post» | Già nota (R8 della revisione del 12 novembre): resta finché calendario ed editor non arrivano (tappe 5 e 6) |
| R10 | Dettaglio video | Nelle catture il lettore copre solo parte dell'anteprima | Non è un difetto: la clip di prova degli E2E non ha le proporzioni scritte nel database |

## Controlli del codice

- `app/error.vue` e `app/app.vue` usano la stessa funzione per il tema colore: non può più succedere che una delle due se ne dimentichi.
- Sul server la pagina d'errore legge la sessione con `useSession().current()`; se la lettura fallisce resta in Feedway, senza rompere la pagina.
- axe (WCAG 2.2 AA) senza violazioni sulla pagina d'errore con il tema Blu, in chiaro e scuro, computer e telefono.

## Verifiche non eseguite

- Tela Pencil (strumento non disponibile): D-27.
- Safari e iPhone veri: nella prova della 0.10.0.
- Zoom vero del browser (simulato con la larghezza della finestra).

## Prossime azioni

- Riallineare la tela all'inizio della tappa 6 (D-27).
- Barra in basso: rivederla quando calendario ed editor sostituiscono le voci «Presto».
