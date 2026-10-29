# Feedway — landing pubblica

## Scopo, pubblico e decisioni

Richiesta esplicita di Matteo: includere landing, ricerca dei concorrenti e workflow completo. Pubblico di lavoro proposto: professionisti e piccoli team che preparano contenuti Instagram/Facebook per più clienti. Il documento originale prevede un prodotto self-hosted e multiagenzia; un modello commerciale SaaS non è stato approvato.

**Decisioni di Matteo (26–29 ottobre 2026):**

- Feedway si presenta come **l'hub dell'agenzia**, non come un altro programmatore di post. Motto e titolo: **"Tutta la tua agenzia, in un solo posto."** Direzione completa in `docs/superpowers/specs/2026-10-29-feedway-hub-agenzia.md`.
- Azione principale: **Richiedi una demo**. **Accedi** resta l'azione di servizio.
- Struttura in 11 sezioni (L02–L12 sotto), decisa il 29 ottobre.
- Le funzioni non ancora disponibili si mostrano con l'etichetta **"In arrivo"**: la landing non promette ciò che non c'è.

**Richiedi una demo** apre un modulo: nome, agenzia, email (obbligatori); telefono, numero di clienti e messaggio (facoltativi). A Matteo arriva un'email per parlarne; il sito non salva le richieste e non usa cookie (deciso il 2026-10-29, ADR 016). Dopo l'invio: "Richiesta inviata, ti scriviamo noi". Il modulo va disegnato con stati di errore, invio in corso e conferma, anche da telefono. Prezzi, prova gratuita e testimonianze restano esclusi.

I testi qui sotto sono la base decisa. Le formulazioni si possono rifinire, ma senza cambiare il messaggio. Prima della pubblicazione ogni funzione mostrata va allineata a ciò che esiste davvero.

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

## Architettura della pagina (decisa il 29 ottobre 2026)

L'idea: non aprire con il calendario dei post, che fa sembrare Feedway "un altro programmatore di post". Si apre con l'agenzia intera e si arriva alla pubblicazione come uno dei pezzi, quello fatto meglio di tutti.

### L01 — Testata

Logo originale orizzontale carbone. Navigazione: Prodotto, Per chi è, Clienti, Domande. **Accedi** come azione di servizio, **Richiedi una demo** come CTA. Su mobile il menu si apre con la tastiera, con stato e focus corretti. Il menu fisso non deve coprire titoli e destinazioni delle ancore.

### L02 — Apertura

**Titolo:** Tutta la tua agenzia, in un solo posto.

**Descrizione:** Clienti, team, contenuti e pubblicazioni: Feedway mette in ordine il lavoro di ogni giorno, dentro e fuori l'agenzia.

**CTA:** Richiedi una demo. **Azione secondaria:** Accedi.

**Visual:** la pagina "Oggi" con tre clienti fittizi, un post approvato, un'attività in scadenza e un post "Confermato". Non un calendario vuoto, niente metriche di crescita inventate o dati reali.

### L03 — Il problema

**Titolo:** Sei app aperte, nessuna che sappia cosa fanno le altre.

WhatsApp per i clienti, Drive per i file, Excel per le ore, Meta per pubblicare. Il cliente scrive alle 23, il file giusto è in una chat di tre settimane fa e nessuno sa se il post di ieri è uscito davvero. Visual: icone generiche di chat, cartelle e foglio di calcolo che confluiscono in un solo riquadro Feedway, senza loghi di terzi.

### L04 — Un posto per ogni cosa

**Titolo:** Ogni cosa al suo posto. Ogni persona sa cosa fare.

Sei schede accessibili, ognuna con una frase e una schermata: **Pianifica**, **Produci**, **Fai approvare**, **Pubblica e verifica**, **Misura**, **Gestisci l'agenzia**. Esempio, "Fai approvare": "Il cliente approva dal telefono. Tu lo sai subito. Basta rincorrere i messaggi." Le schede di funzioni non ancora disponibili portano "In arrivo". Un equivalente statico resta disponibile se script o movimento sono disattivati.

### L05 — Per chi lavora con te

**Titolo:** Ognuno vede quello che gli serve. Niente di più.

Una riga per ruolo con la sua prima schermata: titolare, account, social media manager, copywriter, grafico, collaboratore esterno. Chiude con "Ruoli e permessi controllati su ogni azione". Non trasformarla in una matrice tecnica.

### L06 — Il tuo cliente

**Titolo:** Il tuo cliente ha il suo spazio. Con il tuo marchio.

Vede il calendario, approva, carica le foto, legge il report del mese. Non vede mai le vostre conversazioni interne. Visual: il portale sul telefono con il logo di un'agenzia di esempio. Ciò che non è ancora disponibile porta "In arrivo".

### L07 — Pubblica senza dubbi

**Titolo:** Lo sai quando un post è uscito. Davvero.

Controlli prima di programmare, pubblicazione puntuale su Instagram e Facebook, verifica dopo l'uscita, avviso immediato se qualcosa va storto, caption diversa per ogni piattaforma. Estratto del dettaglio: quattro destinazioni confermate e una con problema. Non promettere zero errori, pubblicazione garantita o affidabilità già misurata.

### L08 — I numeri dell'agenzia ("In arrivo")

**Titolo:** Sai quanto ti costa ogni cliente.

Ore lavorate, contratti, rinnovi, margine per cliente; report per i clienti con il tuo logo. Etichetta "In arrivo" finché non c'è.

### L09 — Come si comincia

**Titolo:** Pronto in un pomeriggio.

Tre passi veri: crea l'agenzia e invita il team; collega i profili dei clienti; importa il piano del mese o parti da un modello.

### L10 — Fiducia

**Titolo:** I dati dei tuoi clienti restano tuoi.

API ufficiali Meta, accesso con passkey, ogni azione registrata, agenzie isolate tra loro, nessuna password dei clienti in chiaro.

### L11 — Domande

Risposte brevi ricavate dal progetto, riviste prima del lancio:

- **Serve una Pagina Facebook?**
- **Posso usarlo dal telefono?** L'esperienza dà priorità al computer; i compiti essenziali funzionano anche da telefono.
- **Il cliente deve registrarsi?** Nella prima versione vede il calendario da un link; il portale con accesso arriva dopo.
- **Quanti utenti posso invitare?**
- **Che succede se un post non esce?**
- **Funziona con TikTok e LinkedIn?** Risposta onesta: in arrivo, uno alla volta.

Niente FAQ su prezzo, carta di credito o condizioni di vendita finché l'offerta non è definita. Niente dettagli su worker, database o token nella narrazione pubblica.

### L12 — Chiusura e footer

**Titolo:** Smetti di cercare. Inizia a lavorare. Sotto, il motto: Tutta la tua agenzia, in un solo posto.

CTA **Richiedi una demo**, stesso comportamento dell'apertura. Logo nella variante corretta, Accedi, navigazione essenziale e informazioni legali realmente disponibili. Se un documento legale non esiste, va segnalato nel registro come requisito di lancio: niente pagine normative inventate.

## Annunci e video (da sviluppare)

- **Video di 30 secondi "Una giornata":** telefono che vibra (WhatsApp, email, Drive, Excel) e testo "Lunedì, 8:47"; lo schermo si svuota e si apre Feedway su "Oggi" ("E se fosse tutto qui?"); tre tagli: il cliente approva, il grafico riceve la nota, il post diventa "Confermato"; il titolare guarda il margine ("Clienti, team, contenuti, conti."); logo e motto.
- **Ganci:** "Quante app apri prima delle 9? Noi una." · "Il cliente approva dal telefono. Tu smetti di rincorrerlo." · "Il post delle 18 è uscito? Feedway lo controlla per te." · "Sai quanto ti costa davvero ogni cliente?"
- **Formati:** reel 9:16, caroselli "prima / dopo" (sei app contro una), serie "Un ruolo, un minuto".

## Workflow della landing

1. Messaggio, CTA, modulo di richiesta e sequenza delle sezioni sono decisi (sopra).
2. Selezionare le immagini Feedway necessarie per ogni sezione, con dati fittizi.
3. Costruire il sistema dell'app e le viste che alimentano la landing. Preparare hero e sezione funzionale sulla tela Pen con asset modificabili.
4. Mostrare composizione raccomandata e una sola alternativa, con identico copy e identici dati. Registrare la scelta visibile.
5. Completare pagina desktop 1440 px e telefono 390 px, menu, tab, FAQ, focus e movimento ridotto.
6. Implementare in Nuxt nello stesso sistema. Percorso proposto: `/` landing, `/accedi` accesso; la demo interattiva con dati fittizi resta facoltativa. Adattare alle route esistenti senza sostituire pagine di produzione.
7. Verificare comprensione del messaggio, comportamento delle CTA, responsive, accessibilità, immagini e prestazioni. Correggere le criticità, poi rifinire.
8. Prima della pubblicazione allineare promesse a funzionalità effettive, destinazioni finali delle CTA, documenti legali e dati reali autorizzati. La preparazione locale non pubblica il sito.

## Criteri per giudicarla

Il visitatore deve capire che Feedway è il posto dove l'agenzia lavora ogni giorno (clienti, team, contenuti, pubblicazione), riconoscere il prodotto e trovare l'azione successiva. Nella prova qualitativa chiedere alla persona di spiegare che cosa fa e che cosa succede cliccando la CTA. Non attribuire un tasso di conversione al mockup; una prova A/B valida richiede traffico, evento definito e condizioni comparabili.

Le immagini devono essere reali esportazioni del design Feedway o componenti della demo, con dati fittizi chiari. L'hero non carica video pesanti per impostazione predefinita; copertina iniziale e caricamento differito dei media secondari, dimensioni riservate per evitare salti. Eventuale movimento con pausa o equivalente statico quando necessario.
