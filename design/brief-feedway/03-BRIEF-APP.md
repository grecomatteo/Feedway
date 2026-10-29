# Direzione proposta per Feedway

## 1. Scopo e priorità

L'utente deve preparare, programmare e controllare contenuti Instagram e Facebook per più clienti. Il prodotto deve rendere evidente il contesto, prevenire gli errori prevedibili e spiegare se ogni destinazione è davvero confermata.

Preferenze confermate il 15 ottobre 2026: esperienza visiva e creativa, miniature grandi, colori del brand; uso soprattutto da computer e occasionale da telefono. Restano validi i requisiti responsive, di accessibilità e PWA del documento v9.

Direzione dopo la 1.0 (Matteo, 26–29 ottobre 2026): Feedway diventa l'hub dell'agenzia, con il motto "Tutta la tua agenzia, in un solo posto." L'app si organizza su tre regole: tutto parte dal cliente, ognuno vede solo il suo, l'agenzia accende solo i moduli che usa. Le schermate nuove (Oggi, pagina del cliente, portale, shooting, CRM, cruscotti) seguono `docs/superpowers/specs/2026-10-29-feedway-hub-agenzia.md`; questo brief resta valido per la grammatica visiva.

Direzione proposta: uno studio editoriale visivo. Le fotografie e le copertine danno personalità; struttura e controlli restano regolari. Il colore dell'agenzia guida azioni e selezioni. Il colore degli stati conserva un significato indipendente dal brand.

## 2. Una sola grammatica visiva

Riferimento strutturale principale: leggibilità di Buffer. Riferimento per calendario visuale: schede di Planable. Libreria: Pallyy. Griglia: Later. Questi sono prestiti di comportamento, non quattro temi da mescolare.

### Composizione

- Navigazione laterale discreta e costante; contenuti più luminosi e protagonisti.
- Titolo della sezione, contesto cliente e azione principale occupano posizioni stabili.
- Barra delle viste separata dalla navigazione fra sezioni, come principio illustrato da Linear.
- Una scheda post ha sempre lo stesso ordine: orario, miniatura, inizio caption, destinazioni e stato.
- Foto e copertine grandi nelle viste visuali; controlli compatti ma leggibili. Nessuna area dell'app viene ingrandita solo per riempire lo schermo.
- Ombre riservate alle superfici sovrapposte. Bordi e fondi distinguono i pannelli senza incorniciare ogni elemento.

### Brand adottato e regole di applicazione

Il materiale fornito da Matteo è ora l'autorità visiva: `brand/Feedway-Brand-Kit-v1.0/`. Le precedenti ipotesi Manrope/cobalto/corallo sono superate. Nome pubblico Feedway; la grafia del logo resta quella dei file approvati. Il documento funzionale v9 conserva il nome storico nel file originale.

Usare il logo orizzontale carbone su chiaro, arancio su carbone e le varianti previste dal kit. Conservare proporzioni e margini; il lettering non va ricostruito digitando il nome. Favicon piccola, icona PWA e monogramma hanno file specifici. Titoli Sora 650; corpo `system-ui`, come base indicata dal kit. Non riaprire font e palette senza una richiesta di Matteo.

Firma: arancio `#FF762E`, carbone `#242321`, bianco `#FFFFFF`, carta `#FAF9F6`. Nell'app prevalgono fondi chiari e contenuti dei clienti; l'arancio evidenzia azioni, selezioni e pochi dettagli. La landing può usare campiture più grandi nello stesso sistema.

Il contrasto carbone/arancio è circa 5,89:1; bianco/arancio circa 2,66:1. Pulsanti arancioni con testo carbone e bordo carbone, focus distinto e visibile. Il testo arancio su bianco non è una soluzione per etichette o link ordinari; usare carbone con sottolineatura o un altro segnale accessibile. Verificare gli stati non testuali: l'arancio sul bianco da solo non raggiunge 3:1. Non scurire arbitrariamente la tinta del logo per risolvere l'interfaccia.

Definire token semantici per sfondo, superficie, testo, testo secondario, bordo, focus, brand e stati. Errori, successo, avviso e informazione hanno significato indipendente dalla firma arancio, accompagnato da testo/icone. Il dark è progettato separatamente. Il white-label previsto dal v9 resta valido: Feedway è il tema iniziale; un brand d'agenzia sostitutivo conserva controlli di leggibilità e stato.

Scala proposta 4/8/12/16/24/32; raggi 8 per controlli e 12 per schede, da confermare con la composizione. Testo operativo 14–16 px; metadati leggibili, titoli di pagina 24–28 px. Sono scelte UI proposte, non nuovi vincoli del brand. Le cifre degli orari possono essere tabulari; provare resa e zoom 200%.

I CSS del kit sono una base da integrare. Aggiornare percorsi font, manifest e icone per il deployment effettivo: il manifest del kit parte dalla radice, mentre una demo sotto `/demo/` può richiedere scope e avvio diversi. Non estendere il service worker pubblico a schermate autenticate senza una decisione esplicita di architettura.

## 3. Architettura delle informazioni

Tre livelli, sempre distinti:

1. **Agenzia**: utenti, integrazioni, brand e isolamento dei dati.
2. **Cliente / spazio di lavoro**: contenuti, libreria, membri, fasce, modelli e link cliente.
3. **Account social / destinazioni**: account Instagram e Pagine Facebook sui quali esce il post.

Un post appartiene a uno spazio e può usare soltanto account di quello spazio. «Tutti i clienti» è una vista di lettura e pianificazione aggregata, non un permesso per creare un post trasversale ai clienti. L'account può comparire in più spazi come previsto dal v9; il selettore non deve implicare una proprietà esclusiva.

### Navigazione proposta

- **Calendario**, ingresso principale proposto per l'uso quotidiano.
- **Post**, con viste Bozze, Programmati, In verifica, Con problema, Confermati.
- **Libreria**, visibile ai ruoli ammessi dal v9.
- **Clienti**, per gli spazi accessibili e la loro gestione secondo permesso.
- Area gestione: **Account social**, **Team**, **Impostazioni** secondo ruolo.
- **Panoramica**, con prossime uscite e problemi operativi, senza grafici di vanity metrics.
- Campanella e pagina Notifiche; menu Profilo; Registro attività nelle aree di gestione.

Il selettore dell'agenzia è visibile solo se ne hai più di una. Il cliente corrente è sempre riconoscibile; cambiare cliente non cambia agenzia. L'etichetta «Cliente» può essere affiancata da «Spazio di lavoro» nelle aree amministrative per allinearsi al dominio.

La griglia Instagram è una vista contestuale del calendario per un singolo account IG, non un secondo sistema di pianificazione. Fasce, etichette, modelli e link sono nelle impostazioni del cliente. Non aggiungere analytics, inbox, approvazioni clienti, AI copy o attività 1.5 alla prima versione.

## 4. Flussi e scelte

### F01 — Calendario visuale, proposta principale

Desktop: settimana in colonne giornaliere, lunedì–domenica, con schede ordinate per ora all'interno del giorno. L'altezza della scheda dipende dalla rappresentazione del contenuto e non dalla durata del post. Questa vista non è un'agenda di appuntamenti. Una griglia oraria può essere esplorata come alternativa, ma non è necessaria per capire le ore di uscita.

Le schede mostrano miniatura, tipo, ora, cliente nella vista aggregata, massimo due righe di caption, account e riepilogo dell'esito. Esempio: «18:00 · Reel · 5 destinazioni» oppure «4 confermate · 1 con problema». La forma abbreviata deve avere un equivalente testuale completo accessibile.

Barra superiore: cliente, periodo e navigazione date, viste Settimana/Mese/Elenco, filtri essenziali e Nuovo post. I filtri avanzati si aprono in un pannello, con riepilogo dei filtri attivi. La libreria laterale è richiamabile. A 1440 px non mantenere sempre aperti libreria, calendario e dettaglio: il calendario diventerebbe troppo stretto. Su schermi grandi si può affiancare una libreria compatta; il dettaglio sostituisce quel pannello oppure usa un overlay controllato.

Nel mese le schede sono più compatte: non promettere miniature grandi e leggibili per dieci post in ogni cella. Mostrare una parte dei contenuti e «Altri 4» con accesso al giorno. L'elenco è l'alternativa per giornate dense. Date e ore restano leggibili anche con molti clienti.

Clic su post: dettaglio; azione Modifica: editor completo. Clic sul giorno o Nuovo post: editor con data precompilata. Il solo clic o drag non programma contenuti senza un riepilogo chiaro. Lo spostamento di un post già programmato esegue i controlli del dominio, mostra feedback e offre Annulla quando il ripristino è ancora consentito. Non simulare un successo definitivo se il server rifiuta il cambio.

### F02 — Nuovo post

Pagina dedicata, non una finestra stretta per un flusso lungo. A sinistra il lavoro; a destra l'anteprima e il riepilogo controlli. Su un desktop 1440 px, partire indicativamente da editor 600–720 px e anteprima 320–380 px, poi verificare il bilancio con sidebar e margini reali. Sono ipotesi da misurare, non larghezze da imporre se non entrano.

Ordine consigliato: cliente → account selezionati → tipo suggerito dai media → media e copertina → caption comune, con testo diverso facoltativo per Instagram e Facebook (specifica §11.2) → quando → dettagli facoltativi. L'anteprima accompagna il lavoro. Etichette e note interne restano raggiungibili senza dominare la pagina. Gruppi di account, modelli e hashtag seguono il v9.

Gli account si selezionano tramite righe con nome, handle, icona piattaforma e stato, raggruppate per Pagina collegata. La riga di avatar è solo un riepilogo; nomi e stato non possono esistere soltanto al passaggio del mouse. Nessun account di un altro cliente. «Seleziona tutti» è limitato al cliente corrente e agli account selezionabili.

Una bozza mantiene il cliente d'origine quando cambi contesto. Se il salvataggio non è riuscito, dirlo prima di uscire; non mostrare «Salvato» basandosi soltanto su un aggiornamento locale. Per Editor l'azione finale è Salva bozza, senza un falso pulsante Programma utilizzabile.

### F03 — Caricamento e libreria

Libreria con griglia visuale, cartelle, ricerca, tipo, tag e selezione multipla. Le immagini non cambiano dimensione quando arriva il caricamento. Per ogni video: copertina, durata, tipo e stato d'elaborazione; i dettagli pesanti si aprono a richiesta.

Distinguere caricamento del file, analisi, conversione e pronto. Il 100% dell'upload non significa media utilizzabile. Mostrare errori sul singolo file, possibilità di ripresa e un messaggio utile se la connessione cade. Su telefono non promettere caricamenti infiniti in background: al rientro il pannello deve spiegare cosa riprende.

Distinguere file salvati nella libreria da media temporanei del post, con conservazione prevista dal v9. Il riferimento Pallyy mostra molte importazioni esterne: nella 1.0 Feedway non le eredita automaticamente.

### F04 — Anteprima e controlli

Schede di anteprima soltanto per le destinazioni pertinenti. Un selettore mostra account e piattaforma; l'anteprima usa il testo di quella piattaforma, se c'è, altrimenti quello comune. Media, caption e formato sono quelli finali dopo le correzioni. Le miniature del calendario possono essere ritagliate per orientare; l'anteprima di pubblicazione deve rappresentare il ritaglio effettivo e dichiarare l'approssimazione.

Blocco: spiega perché non puoi programmare e come risolvere. Avviso: descrive la conseguenza e richiede una scelta secondo il v9. Correzione automatica: indica cosa cambia, con anteprima del risultato. Mai una schermata tutta verde se esiste una destinazione bloccata.

Reel e storie hanno un controllo per le zone coperte dall'interfaccia. I rapporti della griglia e i dettagli dell'interfaccia Meta non devono essere copiati come costanti dagli screenshot del 2025. Sono parametri da confrontare con l'interfaccia corrente e con gli account di prova. Questa ricerca non certifica la fedeltà pixel per pixel o tutti i limiti delle API.

### F05 — Programmazione

Tre scelte: Pubblica ora, Data e ora, Prossima fascia libera. Data assoluta e relativa convivono: «Venerdì 16 ottobre, 18:00 · Europe/Rome · fra…». Il valore relativo si calcola al momento della prova, non si scrive nei mock come dato permanente.

Prima dell'azione: cliente, tipo, account, data, fuso e problemi risolti. CTA esplicita: «Programma su 5 account». La conferma di Pubblica ora spiega che l'azione avvia una pubblicazione reale; nella fase di prototipo tutto è simulato. I giorni del cambio d'ora richiedono disambiguazione. Il 25 ottobre 2026 alle 02:30 Europe/Rome può indicare due istanti: il prototipo deve mostrarlo e impedire una scelta inconsapevole.

### F06 — Esito e recupero

Il dettaglio espone il risultato aggregato e una riga per destinazione: account, stato, ultimo aggiornamento, prossimo controllo, errore risolvibile e azione consentita. La cronologia tecnica è espandibile; il messaggio principale parla italiano semplice.

Proposta di mappatura UI che conserva i significati del v9:

| Dati / situazione | Etichetta e comportamento |
|---|---|
| draft | Bozza; non pubblicherà da sola |
| scheduled | Programmato; data e fuso visibili |
| preparing / ready | In preparazione; indica quando le modifiche non sono più consentite |
| publishing | In pubblicazione; nessun falso completamento |
| published / verifying | In verifica; pubblicazione ricevuta, conferma finale ancora attesa |
| confirmed | Confermato; link al contenuto se disponibile |
| retrying | Nuovo tentativo previsto; mostra la prossima azione automatica |
| unknown | Esito da accertare; blocca un nuovo invio immediato mentre si riconcilia |
| failed / problem | Con problema; distinguere errore d'invio da verifica non conclusa |
| paused | In pausa; ragione e ruolo che può intervenire |
| cancelled | Annullato; nessuna falsa promessa su destinazioni già pubblicate |

Queste sono proposte di etichette e raggruppamenti; non aggiungono stati al dominio. «Parziale» non va usato per un post ancora in progresso solo perché una destinazione si è conclusa prima delle altre. Se quattro sono confermate e una ha un timeout, scrivere «4 confermate · 1 da accertare», non «Fallito». Riprova agisce solo sulle destinazioni idonee e sui permessi previsti, non ripubblica tutto il post.

### F07 — Griglia Instagram

Un solo account IG alla volta, con nome visibile e separazione fra pubblicato e programmato. Anteprima e orari affiancati. Il riordino riguarda i contenuti programmabili; i pubblicati non vengono fatti sembrare liberamente spostabili. Prima di applicare uno scambio, mostrare quali date cambiano. Offrire una modalità Sposta prima/dopo o scelta posizione come alternativa al trascinamento.

### F08 — Programmazione in blocco

Ingresso da File, CSV/Excel o Duplicazione. Procedura in tre passaggi: importa e abbina file → rivedi/correggi → conferma il riepilogo. Il centro è una tabella con miniatura, caption, tipo, account, data e controllo della riga; dettagli in pannello espandibile.

Selezione chiara con conteggio. Le azioni riguardano righe selezionate, non tutta la pagina implicitamente. Filtri Tutti / Da sistemare / Pronti. Esempio: 20 righe, 18 pronte, 2 bloccate; CTA «Programma 18 post», messaggio che le altre due restano bozze. La convalida si ripete prima dell'esecuzione, e il risultato effettivo può differire se lo stato cambia.

L'analisi dei concorrenti non offre una tabella già perfetta per questa combinazione di requisiti. Adottare i principi Carbon per selezione e azioni in blocco, implementandoli nello stesso design system Nuxt/Vue; non introdurre una seconda libreria React.

### F09 — Calendario cliente

Pagina di sola visione, con logo dell'agenzia ed eventuale logo cliente. Mese/settimana, anteprima, orari e link consentiti dal v9. Nessuna sidebar operativa, account personali, note interne, membri, altri clienti o azioni di modifica. «Condividi» e gestione scadenza/password/revoca appartengono al pannello del Manager/Admin. Progettare anche link scaduto, revocato, password errata e calendario vuoto.

### F10 — Configurazione e salute account

Guida a cinque passi come nel documento originale: app Meta, utente di sistema, asset, token, importazione account. Ogni passo ha verifica e recupero locale. Non sostituire questo modello con il login OAuth mostrato dai concorrenti: richiederebbe una decisione di prodotto diversa.

Salute account: nomi leggibili, ultimo controllo, quota, problemi e chi può risolverli. Nessun token leggibile dopo il salvataggio. Un Publisher vede un messaggio e l'indicazione del responsabile; non un pulsante di configurazione che non può usare.

### F11 — Team, profilo e gestione

Inviti e ruoli nell'agenzia sono distinti dai ruoli per cliente. Spiegare in poche parole cosa consente il ruolo; riutilizzare la matrice §10.2, senza crearne una nuova nei mock. Profilo personale con tema, sicurezza, sessioni e preferenze. Impostazioni organizzazione, piattaforma e profilo sono tre ambiti diversi.

### F12 — Panoramica e notifiche

Panoramica di lavoro: cosa esce oggi, elementi in verifica, problemi aperti e salute rilevante per il ruolo. I dettagli del worker e del backup non diventano il contenuto principale per ogni collaboratore. Notifiche raggruppate per post/evento, con collegamento al dettaglio e storico di consegna quando previsto. Nessuna notifica interna del team appare nel calendario cliente.

## 5. Desktop, tablet e telefono

Verificare 1440×900 e 1920×1080 come desktop principali; 1280×800 come caso stretto; 390×844 per telefono. Le misure sono cornici di prova, non breakpoint automaticamente corretti.

Su desktop mantenere la vista visuale ariosa. Ingrandire le miniature richiede togliere pannelli simultanei e metadati secondari, non rimpicciolire il testo. A 1280 px chiudere pannelli laterali accessori; editor e anteprima possono alternarsi. Sul telefono calendario iniziale a elenco, editor a una colonna, anteprima raggiungibile e azione finale mai coperta dalla tastiera. Non forzare sette colonne sul telefono.

## 6. Cosa costruire prima sulla tela

Prima tranche completa: layout e componenti; calendario settimana e mese; editor e selettore account; avviso e blocco; riepilogo programmazione; dettaglio con esito parziale; libreria e upload; griglia; import in blocco; vista cliente; versioni mobile dei percorsi essenziali. Il resto è mappato e si completa prima della relativa tappa di sviluppo, non resta implicitamente escluso dalla 1.0.

La variante B da confrontare è mese con libreria richiamabile e maggiore orientamento alla distribuzione mensile. La A è settimana visuale centrata sulla revisione dei contenuti. Stessi dati, numero di post, componenti e clientela; altrimenti il confronto estetico non è utile.
