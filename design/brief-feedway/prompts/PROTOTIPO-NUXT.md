> Specifica richiamata dal prompt principale `01-PROMPT-INIZIA-QUI.md`. Tutti i percorsi partono dalla radice del pacchetto.

# Messaggio da usare dopo la scelta del design

Usa la direzione scelta da Matteo e registrata nel progetto, con la versione approvata del file `design/feedway-ui.pen` come riferimento visivo. Aggiorna il brief con la scelta effettiva. Se una scelta necessaria manca, raccoglila nella revisione visiva prevista dal prompt principale; non dare per approvata una proposta diversa.

Completa prima componenti riusabili, variabili chiaro/scuro e gli stati della prima tranche definiti nel pacchetto `design/brief-feedway/`. Copri Calendario, Nuovo post, selettore account, controlli, programmazione, esito per destinazione, Libreria/upload, Griglia, In blocco e Link cliente. Le schermate amministrative restanti devono avere una mappa di flusso e i componenti necessari; si completano prima di sviluppare la relativa tappa.

Poi realizza un prototipo navigabile nel nostro stack Nuxt/Vue/TypeScript con dati simulati. Se esiste già il progetto, riusa struttura, convenzioni e libreria UI. Se manca, proponi una base minima Nuxt UI coerente con lo stack del documento; consulta la documentazione della versione effettivamente installata, tramite il suo MCP se disponibile. Non introdurre React, un secondo design system o un backend reale per far funzionare il prototipo.

Mantieni il prototipo isolato e riconoscibile, per esempio in un'app o area demo, senza sostituire schermate di produzione. Usa lo stato simulato per rendere navigabili i passaggi, consentire il reset della demo e riprodurre gli errori. Distingui dati in memoria da bozze persistite localmente: non chiamare una cosa “salvata sul server” se non lo è.

Percorso obbligatorio: Calendario → Nuovo post → upload e controllo → avviso risolvibile → selezione data/fuso → riepilogo → programmato → dettaglio con risultato parziale. Aggiungi i casi 4 confermate + 1 esito da accertare, Editor che può solo salvare una bozza, filtro senza risultati, upload interrotto, import con 18 righe pronte e 2 bloccate e link cliente scaduto.

Usa i dati del pacchetto come modello di scenario, non come contratto definitivo delle API. Tutti i dati sono fittizi. Gli screenshot dei concorrenti restano riferimenti, non diventano immagini delle campagne dei nostri clienti. Per le prime prove usa asset locali disponibili e con provenienza dichiarata, oppure segnaposto espliciti. Prima della valutazione estetica finale servono immagini realistiche e rappresentative dei formati.

Design e codice si aggiornano con richieste esplicite: registra cosa è cambiato e riallinea la tela dopo le modifiche di struttura. Non presumere sincronizzazione automatica Pen↔Nuxt. Mantieni token e componenti in un unico sistema coerente con `packages/ui` quando presente.

Verifica 1440×900, 1920×1080, 1280×800 e 390×844; prova tastiera, zoom, nomi lunghi, densità, chiaro/scuro e menu. Esegui i controlli tecnici appropriati del repository e i compiti del documento `05-REVISIONE-E-ACCETTAZIONE.md`. Riporta separatamente ciò che hai ispezionato sulla tela, ciò che hai provato nel browser e ciò che deve ancora essere testato da persone reali. Una demo non prova l'affidabilità del worker o l'isolamento server.

Consegna il percorso del prototipo, il file `.pen`, gli asset, le decisioni, le prove eseguite e le questioni aperte. Completa il percorso principale prima di aggiungere nuove schermate o altri stili.

## Landing collegata e applicazione del brand

Applica il kit Feedway e il brief landing 04. Dopo il percorso principale dell'app, realizza la landing scelta, con CTA demo e accesso distinti. Mantieni il prototipo separato dalla produzione, adatta le route proposte al repository e verifica la pagina pubblica senza login. Usa schermate Feedway e gli stessi dati fittizi della demo, mai le schermate concorrenti come prodotto. Implementa tab, FAQ, menu e ancore realmente funzionanti.

Conserva il font Sora incluso con la sua licenza; sistema i percorsi dopo la copia. Usa varianti SVG originali e icone appropriate. Adatta manifest e scope alla posizione effettiva dell'app, tenendo distinto l'accesso pubblico e autenticato. La configurazione PWA non autorizza a memorizzare dati privati indiscriminatamente.

Esegui la revisione del documento 06 e i criteri del documento 05 per entrambe le superfici, con un unico registro di difetti. Non pubblicare o collegare servizi commerciali reali come parte della sola demo.
