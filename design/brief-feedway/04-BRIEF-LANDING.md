# Feedway — landing pubblica

## Scopo, pubblico e decisione ancora aperta

Richiesta esplicita di Matteo: includere landing, ricerca dei concorrenti e workflow completo. Pubblico di lavoro proposto: professionisti e piccoli team che preparano contenuti Instagram/Facebook per più clienti. Il documento originale prevede un prodotto self-hosted e multiagenzia; un modello commerciale SaaS non è stato approvato.

Per proseguire senza inventare un'offerta, il prototipo presenta il prodotto e offre **Esplora la demo** come azione primaria, **Accedi** come azione di servizio. La demo è una vera area locale con dati fittizi, non un pulsante che apre una finestra vuota. In futuro la CTA può diventare richiesta di demo o prova soltanto quando destinatario, offerta e percorso saranno definiti.

Il copy seguente è una proposta originale da verificare, non un testo commerciale già approvato. Le funzionalità illustrate sono obiettivi del progetto v9: prima della pubblicazione vanno allineate a quelle effettivamente disponibili.

## Direzione raccomandata

Hero con testo a sinistra e calendario Feedway a destra, su fondo carta. Titolo Sora 650, testo carbone, pulsante arancio con etichetta e bordo carbone. Il prodotto deve essere visibile presto: non chiedere al visitatore di attraversare un lungo manifesto per capire cosa fa Feedway.

La vista del calendario è ampia, leggibile e realizzata dal nostro design. Le immagini dei tre clienti dimostrativi danno colore; il marchio organizza la pagina. Una campitura arancio può segnare un passaggio importante; un blocco carbone può valorizzare la griglia e la CTA conclusiva. Evitare di trasformare tutta la landing in una sequenza di riquadri identici.

Alternativa da mostrare solo per il confronto iniziale: titolo centrato e calendario largo sotto. Più spazio alla visione complessiva, ma il prodotto scende nel primo schermo. Raccomandazione: composizione affiancata, più vicina a un prodotto editoriale concreto.

Il segno FW può suggerire un orientamento grafico nei tagli delle immagini o nei piccoli connettori; non smontare o deformare il logo. Il monogramma non diventa una mascotte o un pattern che compete con i contenuti.

## Ricerca e selezione

Sono state consultate le pagine pubbliche di cinque prodotti e una pagina di catalogo Saaspo, presente nell'elenco di fonti allegato dall'utente. Le osservazioni visive riguardano i primi schermi caricati e i flussi/sezioni descritti nel DOM; non sono un audit completo delle loro prestazioni o conversioni.

| Fonte | Scelta per Feedway | Limite |
|---|---|---|
| [Planable](https://planable.io/) | Testo e calendario affiancati; mostrare più viste come dimostrazione del prodotto. Riferimento principale della composizione. | Approvazioni, commenti e piattaforme del concorrente non appartengono automaticamente al nostro scope. |
| [Later — scheduler](https://later.com/social-media-scheduler/) | Sequenza visual planner → pubblicazione → media; moduli narrativi con immagini concrete. Riferimento principale della spiegazione. | Best Time to Post, integrazioni esterne e altre reti non sono promesse di Feedway. |
| [Pallyy](https://pallyy.com/) | Chiarezza del pubblico e centralità del lavoro con più clienti; FAQ su dubbi reali. | Prezzi per cliente, trial e approvazioni sono del concorrente. |
| [Metricool](https://metricool.com/) | Benefici ordinati e percorso di scoperta delle funzionalità. | L'insieme di analytics, ads, inbox e automazioni è molto più ampio della v1 Feedway. |
| [Buffer](https://buffer.com/) | Gerarchia del messaggio e accesso evidente all'azione primaria, dalle osservazioni già acquisite. | L'hero con numerose integrazioni e raccolta email non è il modello proposto qui. Nuovi download non acquisiti. |
| [Saaspo — Buffer](https://saaspo.com/pages/buffer-landing-page) | Catalogo pubblico per confronto della pagina e delle versioni. | Uno screenshot di catalogo può essere precedente al sito attuale; non è una prova della UI corrente. |

La homepage attuale di Later privilegia l'influencer marketing: per Feedway è più pertinente la sua pagina dedicata allo scheduler, verificata separatamente. Nicelydone è utile soprattutto per riferimenti dell'app; le schermate complete incontrate richiedono accesso. Non sono stati superati limiti di accesso.

In `riferimenti/landing/` sono inclusi quattro asset promozionali ufficiali della pagina Later e la provenienza. Non sono screenshot dell'intera landing. Per Buffer e Metricool il browser ha negato nuovi salvataggi: non sono stati aggirati i blocchi. Rimangono le fonti e i riferimenti app già acquisiti.

## Architettura proposta della pagina

### L01 — Testata

Logo originale orizzontale carbone. Navigazione: Prodotto, Come funziona, Per chi è, Domande. Accedi come azione di servizio; Esplora la demo come CTA. Su mobile menu apribile con tastiera, stato e focus corretti. Il menu fisso non deve coprire titoli e destinazioni delle ancore.

### L02 — Hero

**Titolo proposto:** Il tuo piano social, una direzione chiara.

**Descrizione proposta:** Organizza i contenuti Instagram e Facebook dei tuoi clienti, prepara i post e segui ogni pubblicazione da un unico spazio di lavoro.

**CTA:** Esplora la demo. **Azione secondaria:** Guarda come funziona, verso la sezione successiva.

La schermata hero mostra cliente, settimana, miniature e stato comprensibile. Non mostra metriche di crescita, notifiche inventate, dati personali o dati di clienti reali. Il ritaglio conserva la comprensibilità; una didascalia alternativa descrive cosa si vede.

### L03 — Dimostrazione delle viste

Titolo proposto: Il piano completo. Il dettaglio quando serve.

Tre schede o tab accessibili: Settimana, Griglia Instagram, Elenco. Stessa settimana e stessi contenuti fittizi. Cambiare tab cambia immagine e spiegazione, non naviga a contenuti vuoti. Un equivalente statico rimane disponibile se script o movimento sono disabilitati. Una sola vista principale mantiene il peso iniziale contenuto.

### L04 — Come funziona

Tre passaggi collegati visivamente, con un'immagine di prodotto per ognuno:

1. **Scegli il cliente.** Spazio, contenuti e destinazioni riconoscibili.
2. **Prepara il contenuto.** Media, caption e controlli vicini all'anteprima.
3. **Programma e segui l'esito.** Data, orario e risultato delle singole destinazioni.

Su desktop si può usare una composizione alternata anziché tre piccole card uguali. Su telefono la sequenza resta nel normale flusso di lettura. Evitare uno scroll bloccato con pannelli obbligatori.

### L05 — Il punto distintivo: esiti comprensibili

Titolo proposto: Sai cosa è uscito. E cosa richiede attenzione.

Mostrare un estratto del dettaglio: quattro destinazioni confermate e una con problema. Un secondo stato opzionale distingue un esito ancora da accertare. Spiegazione breve: Feedway rende leggibile lo stato per destinazione e indirizza il recupero. Non promettere zero errori, pubblicazione garantita o affidabilità già misurata.

### L06 — Lavoro con più clienti

Titolo proposto: Ogni cliente ha il suo spazio.

Dimostrare tre contesti fittizi, lo stesso sistema UI e una vista condivisa di sola lettura. Il link cliente mostra il piano; non permette commenti o approvazioni nella v1. Si può accennare ai ruoli previsti, senza trasformare la sezione in una matrice tecnica.

### L07 — FAQ

Domande con risposte brevi ricavate dal progetto, riviste prima del lancio:

- **Per quali social è pensato?** Instagram e Facebook nella prima versione prevista.
- **Posso organizzare più clienti?** Il modello prevede spazi di lavoro distinti per contenuti e account ammessi.
- **Il cliente può vedere il calendario?** È prevista una vista condivisa di sola lettura.
- **Posso preparare più post insieme?** È previsto un percorso di importazione e revisione in blocco, con errori per riga.
- **Posso usarlo dal telefono?** L'esperienza dà priorità al computer; i compiti essenziali sono progettati anche per telefono.

Non usare FAQ su prezzo, carta di credito o condizioni di vendita prima di aver definito l'offerta. Evitare dettagli su worker, database, token di sistema nella normale narrazione pubblica; l'eventuale documentazione di configurazione avrà un percorso dedicato.

### L08 — Chiusura e footer

Titolo proposto: Dai una direzione al prossimo contenuto.

CTA Esplora la demo, stesso comportamento dell'hero. Logo nella variante corretta, Accedi, navigazione essenziale e informazioni legali realmente disponibili. Nel prototipo, se un documento legale non esiste, segnalarlo nel registro come requisito di lancio: niente pagine normative inventate o collegamenti che fingono contenuti approvati.

## Workflow della landing

1. Confermare l'assunzione di CTA e il pubblico durante la revisione del brief, senza bloccare la ricerca e il design del prodotto.
2. Selezionare messaggio, sequenza delle sezioni e immagini Feedway necessarie. Definire la relazione CTA → demo → app.
3. Costruire il sistema dell'app e le viste che alimentano la landing. Preparare hero e sezione funzionale sulla tela Pen con asset modificabili.
4. Mostrare composizione raccomandata e una sola alternativa, con identico copy e identici dati. Registrare la scelta visibile.
5. Completare pagina desktop 1440 px e telefono 390 px, menu, tab, FAQ, focus e movimento ridotto.
6. Implementare in Nuxt nello stesso sistema. Percorso proposto: `/` landing, `/demo/calendario` demo ripristinabile, `/accedi` accesso. Adattare alle route esistenti senza sostituire pagine di produzione.
7. Verificare comprensione del messaggio, comportamento delle CTA, responsive, accessibilità, immagini e prestazioni. Correggere le criticità, poi rifinire.
8. Prima della pubblicazione allineare promesse a funzionalità effettive, destinazioni finali delle CTA, documenti legali e dati reali autorizzati. La preparazione locale non pubblica il sito.

## Criteri per giudicarla

Il visitatore deve capire che è uno strumento di pianificazione/pubblicazione IG-FB per lavoro con clienti, riconoscere il prodotto e trovare l'azione successiva. Nella prova qualitativa chiedere alla persona di spiegare che cosa fa e che cosa succede cliccando la CTA. Non attribuire un tasso di conversione al mockup; una prova A/B valida richiede traffico, evento definito e condizioni comparabili.

Le immagini devono essere reali esportazioni del design Feedway o componenti della demo, con dati fittizi chiari. L'hero non carica video pesanti per impostazione predefinita; copertina iniziale e caricamento differito dei media secondari, dimensioni riservate per evitare salti. Eventuale movimento con pausa o equivalente statico quando necessario.
