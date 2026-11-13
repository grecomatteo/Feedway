# Proposta: il cliente contiene i suoi profili social (13 novembre 2026)

Richiesta di Matteo: clienti e account social oggi sono due pagine separate, e questo non gli piace. Quasi tutti i suoi clienti hanno **un solo Instagram e una sola Pagina Facebook**. Quando apre un cliente vuole vedere subito i suoi profili, e collegarli o ricollegarli da lì.

Tavole: `schermate/tappa-4-revisione/proposta-clienti-e-profili.png` nella cartella del progetto. La pagina HTML è `design/esplorazioni/2026-11-13-revisione/clienti-profili.html` (`?p=clienti|cliente|nuovo`). Lo stile è quello dell'unione consigliata in `2026-11-13-tre-direzioni.md`.

## Come cambia il lavoro

| Oggi | Proposta |
|---|---|
| «Account social» è una voce del menu: si importano i profili da Meta, poi da «Clienti → Account» si assegnano ai clienti | La voce sparisce. **Clienti** è l'unico posto: ogni riga mostra la foto, `@instagram` e la Pagina, e lo stato Meta |
| Un cliente nuovo nasce vuoto, i profili si aggiungono dopo | **Nuovo cliente = scegli il suo profilo.** La finestra elenca i profili trovati su Meta e non ancora usati: Instagram e la Pagina collegata arrivano insieme e il nome si propone da solo. Si può anche creare «Senza profilo, per ora» |
| Per ricollegare si va in «Account social» | Lo stato «Da ricollegare» è nella riga del cliente; la pagina del cliente ha «⋯ → Ricollega» sul profilo |
| I profili importati senza cliente si perdono in un elenco a parte | In cima a Clienti un avviso: «2 profili trovati su Meta non sono ancora in un cliente · Sistemali». Apre l'elenco con «Crea il cliente» (azione principale) o «Aggiungi a un cliente esistente» |
| Il collegamento a Meta (App ID, token, sincronizza) sta nella stessa pagina degli account | Va in **Impostazioni → Agenzia → Integrazioni → Meta**: si tocca una volta, non ogni giorno |

**Pagina del cliente** (è la «home del cliente» del Task 6):
- in testa la foto, il nome, gli handle e «Nuovo post»;
- poi le schede Panoramica, Calendario e Libreria (presto), Persone;
- nella Panoramica i profili social (stato, ultima sincronizzazione, «⋯» con Ricollega, Sostituisci, Togli dal cliente) e chi ci lavora.

**Casi meno comuni, che restano possibili:**
- un cliente senza profilo (per esempio un cliente CRM dell'hub);
- un cliente con due Instagram: nella riga «@uno +1», nella pagina tutte e due le righe.

## Cosa tocca nel codice e nei piani

- **Dati:** nessuna migrazione. Il legame cliente ↔ account esiste già (assegnazione degli account agli spazi). Cambiano rotte di lettura (la riga del cliente porta i suoi profili e lo stato) e schermate.
- **Piano della tappa 4:**
  - il **Task 5** («Un cliente = un profilo», oggi pensato dentro l'importazione) si estende alla finestra «Nuovo cliente» e all'elenco «Sistemali»;
  - il **Task 6** (navigazione e home del cliente) diventa la pagina del cliente qui sopra, e toglie «Account social» dal menu.
- **Specifica:** la pagina «Account social» e i suoi percorsi (§ account social, navigazione) vanno aggiornati. Secondo `AGENTS.md`, quando specifica e piano cambiano serve il tuo sì prima di scrivere codice.
- **Ordine proposto:**
  1. componenti condivisi della nuova direzione;
  2. Clienti con i profili nella riga;
  3. «Nuovo cliente» con la scelta del profilo e «Sistemali» (Task 5);
  4. pagina del cliente e menu (Task 6);
  5. spostamento del collegamento Meta in Impostazioni.
- Ogni passo con schermate prima della fusione.

## Domande aperte

- Il collegamento a Meta in Impostazioni ti va bene, o preferisci tenerlo come scheda dentro Clienti («Clienti · Collegamento Meta»)?
- Quando colleghi Meta la prima volta, creo **in automatico** un cliente per ogni profilo trovato (lo controlli e lo correggi dopo), o te li propongo uno per uno nell'elenco «Sistemali»? Consiglio la proposta: crea in automatico solo se lo confermi con un clic.
