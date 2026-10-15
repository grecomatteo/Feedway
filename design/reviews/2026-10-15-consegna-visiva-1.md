# Registro — prima consegna visiva app + landing

## Sessione

- Data: 15 ottobre 2026. Documento: tela Pencil (da salvare come `design/feedway-ui.pen`); esportazioni in `design/tavole/`.
- Superficie: app (calendario, nuovo post, esito) e landing pubblica. Ruolo mostrato: Manager di agenzia (Studio Aurora).
- Scenari: `design/brief-feedway/dati/scenari.json` (orologio 15 ottobre 2026 12:00 Europe/Rome; `publish-reel`, `partial-failure`, `uncertain-result`, `upload-interrupted`).
- Strumenti: Pencil via MCP (`read_skill`, `execute`), Impeccable `context` (nessun PRODUCT/DESIGN preesistente: scritti da brief).

## Tavole

| Tavola | Contenuto |
|---|---|
| 00 · Sistema condiviso | Logo e simbolo dai tracciati originali, pulsanti (primario, secondario, focus, disabilitato), 8 stati, scheda post, riga account attiva / da ricollegare, barra laterale |
| A1 | Calendario settimana visuale, tutti i clienti, 12–18 ottobre, giornata «oggi», esiti misti |
| B1 | Calendario mese con libreria richiamabile, stessi dati; giorno 22 con 12 post e «Altri 9» |
| A2 | Nuovo post Forno Luce: 5 destinazioni del gruppo salvato, reel 9:16 pronto, caption unica, data con fuso, avviso ritaglio, CTA «Programma su 5 account» |
| A3 | Esito: 4 confermate + 1 con problema (riprova solo sulla destinazione fallita) e variante 4 + 1 da accertare con nuovo invio bloccato |
| M1–M3 | Telefono 390×844: calendario a elenco, nuovo post con caricamento ripreso (programmazione disattivata finché la conversione non termina), esito |
| A1 1280 | Ingombro a 1280×800: sette colonne leggibili |
| Landing | L01–L08 a 1440, alternativa hero centrato, telefono 390, menu aperto con focus |

## Verifiche eseguite sulla tela

- Ritagli e sovrapposizioni controllati con i limiti dei nodi: corretti la sezione «Quando» dell'editor (tagliata) e la sovrapposizione fra cornici.
- Contrasti dei token calcolati (rapporto WCAG): testo secondario 6,4:1 su carta; coppie di stato 5,6–5,9:1 in chiaro e 6,7–8,6:1 in scuro; carbone su arancio 5,89:1.
- Icone mancanti nella libreria lucide sostituite (`clock` → `clock-3`, `circle-help` → `circle-question-mark`).

## Limiti dichiarati

- Sora 650 non è disponibile in Pencil: la tela usa 600. Il corpo usa Inter al posto di `system-ui`.
- Le foto sono immagini stock Unsplash usate come segnaposto per clienti fittizi.
- Il tema scuro è definito nei token ma non è ancora stato disegnato come tavola.
- Nessuna prova nel browser, tastiera o con persone: arriva con il prototipo Nuxt.
- Non disegnati in questa consegna: libreria completa e upload, griglia con riordino, import in blocco, link cliente, setup Meta, team e impostazioni (tranche 2 e 3 del documento 09).

## Continuità

- Decisioni richieste a Matteo: struttura calendario (A o B) e hero landing (affiancato o centrato).
- Prossima azione: dopo la scelta, prototipo Nuxt in `design/prototipo/` con il percorso Calendario → Nuovo post → Controlli → Programmazione → Esito, poi landing e demo.

## Prototipo Nuxt (`design/prototipo/`) — prove nel browser

Eseguite con Playwright (Chromium) sul server locale, 15 ottobre 2026. Direzione usata in attesa della scelta: calendario A e hero affiancato.

| Prova | Esito |
|---|---|
| Percorso completo: Calendario → Nuovo post (Forno Luce, gruppo da 5) → upload con connessione persa e ripresa → avviso ritaglio confermato → ora ambigua 25/10 02:30 risolta → riepilogo → programmato → uscita simulata | Riuscito; dettaglio «4 confermate · 1 con problema», riprova solo sulla destinazione fallita dopo il ricollegamento |
| Pulsante Programma bloccato finché media non pronto, avviso non confermato o ora ambigua non scelta | Verificato |
| 4 confermate + 1 da accertare | Etichetta corretta, nessun pulsante Riprova, nuovo invio dichiarato bloccato |
| Editor / Viewer | Editor vede solo «Salva bozza»; Viewer riceve «Non puoi creare post» |
| Filtro senza risultati | Stato dedicato, distinto dal calendario vuoto, con «Azzera filtri» |
| Import in blocco | «Programma 18 post», 2 righe bloccate con motivo per riga |
| Link cliente | Scaduto, revocato, protetto (password errata con messaggio), attivo, vuoto |
| Landing | Tab con frecce della tastiera, FAQ, menu mobile chiuso con Esc e focus restituito al pulsante |
| Dimensioni | 1440×900, 1280×800, 390×844 senza scorrimento orizzontale; tema scuro leggibile |

### Difetti trovati e corretti

| ID | Priorità | Dove | Effetto | Correzione |
|---|---|---|---|---|
| R1 | P2 | Icone di navigazione | Icone con nome dinamico non disegnate | Nuxt Icon in modalità SVG |
| R2 | P2 | Landing e calendario | Le classi `.fw-btn` battevano `lg:hidden`: menu mobile visibile su desktop | Classi dei componenti spostate in `@layer components` |
| R3 | P2 | Riga account non sano | Testo spezzato su più righe | Motivo spostato nella seconda riga |
| R4 | P2 | Barra demo su telefono | Occupava un quarto dello schermo | Testi brevi sotto 768 px |
| R5 | P2 | Navigazione | «Post» risultava attivo nell'editor | Regola dell'elemento attivo corretta |

### Non verificato

Lettore di schermo reale, zoom 200%, prestazioni misurate, prove con persone. Le voci di menu Post, Libreria, Clienti, Account social e Team non hanno schermate nel prototipo. La demo non dimostra isolamento server, worker o pubblicazione reale.

### Revisione del codice (agente revisore separato) e correzioni

| ID | Priorità | Dove | Effetto | Correzione |
|---|---|---|---|---|
| R6 | P0 | Editor, stato del salvataggio | Diceva «Bozza salvata» senza salvare | Il salvataggio automatico scrive davvero la bozza; senza cliente, data e ora dice «Non ancora salvata» |
| R7 | P1 | Editor, data vuota | La bozza con data vuota rompeva il calendario | Bozza rifiutata con avviso; blocco «Data o ora mancante» |
| R8 | P2 | Ora ambigua | Testo fisso «02:30» per qualsiasi ora tra 02:00 e 02:59 | Data, ora e scostamento presi dai due istanti calcolati |
| R9 | P2 | Calendario | «Il calendario non è vuoto» anche in un periodo vuoto | Stato vuoto distinto da filtro senza risultati |
| R10 | P2 | Cronologia tecnica | Nomi di stato in inglese | Etichette italiane |
| R11 | P2 | Barra demo, anteprima | Ruoli ARIA incoerenti (pulsante tema, finte schede) | Pulsanti semplici o con `aria-pressed` |

Riverificati nel browser: R6, R7, R8, R9. `nuxt typecheck` senza errori.
