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
