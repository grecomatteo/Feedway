# Landing: revisione del giro 3 con le skill (23 novembre 2026)

La landing del giro 3 (`design/feedway-ui.pen`, frame `ALXwZ`, esportata in `design/tavole/2026-11-18-tela-unica/40-landing-giro-3.png`) è stata riletta con il brief 04, `DESIGN.md` (stile del ridisegno) e con le skill di design indicate da Matteo: impeccable, taste-skill (design-taste-frontend), frontend-design, make-interfaces-feel-better, emil-design-eng, humanizer e, dal plugin design, design-critique, accessibility-review e ux-copy. Dove una skill e il brief non sono d'accordo vince il brief, come dicono le skill stesse.

## Cosa resta

- Il motto come titolo («Tutta la tua agenzia, in un solo posto.»), deciso da Matteo il 26/10.
- «Richiedi una demo» come sola azione: nessuna iscrizione, nessun acquisto, nessuno spazio da creare (Matteo, 23/11). Ogni pulsante porta al modulo (ADR 016).
- L'idea di aprire con il prodotto vero, e la sezione carbone «Lo sai quando un post è uscito. Davvero.», che è il punto in cui Feedway è più forte.
- Le domande frequenti oneste («Funziona con TikTok e LinkedIn? In arrivo, uno alla volta»).

## Problemi

### 1. Promette cose che Feedway non fa (il più grave)

Il brief chiede di allineare ogni funzione mostrata a ciò che esiste davvero prima di pubblicare. Il giro 3 è stato disegnato per la direzione «hub» del 29/10 e mostra più cose future che presenti.

- **Mostrato come se ci fosse, ma non c'è:** l'approvazione dal telefono del cliente («Fai approvare»), il portale del cliente, la «Bacheca», le attività in scadenza, il cruscotto del titolare, «Le mie attività», il brand kit, le ore e i rinnovi, «importa il piano del mese da un foglio di calcolo», il calendario condiviso con un link (tappa 10), i ruoli Copywriter e Grafico (i ruoli veri sono Owner, Admin, Manager, Publisher, Editor e Viewer).
- **Le etichette «In arrivo» sono troppe:** su 11 sezioni, 4 parlano di funzioni future. Chi legge capisce un prodotto a metà.
- **Quello che c'è davvero si vede poco:** Oggi, il calendario, l'editor con i controlli prima di programmare, l'anteprima, la libreria con le cartelle, la pubblicazione verificata con l'esito per ogni destinazione, gli utenti con i ruoli per cliente, il collegamento ufficiale con Meta.

### 2. È nello stile di prima

`DESIGN.md` chiede che ogni pagina segua il ridisegno del 19/11. Il giro 3 ha:

- fondi pesca e salmone a ogni sezione, dove il ridisegno usa la carta (`bg`) e le superfici bianche con il filo (`surface`, `border`);
- un'ombra grigia sotto ogni card (il «kit di card SaaS» che frontend-design indica come segno del generato); il ridisegno usa il filo, non l'ombra;
- il pulsante arancio con il bordo carbone e l'icona, mentre ora il pulsante principale è pieno e senza bordo; due arancioni nella stessa schermata (in testata e nell'apertura);
- le schermate del pannello vecchio (Oggi con le etichette colorate, i pallini in riquadri): il pannello non è più così;
- il carattere a larghezza fissa nelle tabelle, che il pannello non usa.

### 3. Ritmo e movimento (taste-skill, frontend-design)

- **Una sezione per schermata:** «Il tuo cliente» e «I numeri» si spezzano a metà schermata, e alcune sezioni sono quasi vuote (Pronto in un pomeriggio).
- **Troppi momenti:** i foglietti inclinati delle sei app, l'oggetto 3D (TresJS) e la scritta gigante in fondo. Le skill chiedono un momento forte per pagina, due se la pagina è lunga, e il resto calmo.
- **L'oggetto 3D** non serve: per un prodotto che si vede, il momento giusto è il prodotto che lavora (l'esito che diventa «Confermato» destinazione per destinazione).
- **Didascalie e note sotto i visual** («Oggetto 3D… si muove solo quando…», «Esempio con dati fittizi», «Le schede con il punto grigio…»): taste-skill le vieta; i dati d'esempio si dicono una volta sola, in fondo.

### 4. Testi (humanizer, ux-copy)

- Alcuni titoli sono slogan senza un sostantivo che dica di cosa parlano («Pronto in un pomeriggio.», «Smetti di cercare. Inizia a lavorare.»). La prima schermata non dice in chiaro che Feedway pubblica su Instagram e Facebook.
- Frasi a tre colpi da pubblicità («Il cliente approva dal telefono. Tu lo sai subito. Basta rincorrere i messaggi.»), su una funzione che non c'è.

### 5. Accessibilità e telefono

- Le schede di «Ogni cosa al suo posto» sono sei, e su 390 non stanno in una riga.
- Il testo grigio piccolo sulle campiture pesca è al limite del contrasto.
- «Accedi» porta al pannello, che è dentro Tailscale: chi non è del team trova una pagina che non si apre.

## Proposta

Una pagina più corta (9 sezioni invece di 12) che mostra solo quello che Feedway fa oggi, nello stile del pannello nuovo, con il prodotto vero come immagine e un solo momento forte.

| # | Sezione | Contenuto | Visual |
|---|---|---|---|
| 1 | Testata | Logo, Prodotto, Come funziona, Domande; «Richiedi una demo». Niente «Accedi» finché il pannello è privato | — |
| 2 | Apertura | Il motto; sotto: «Il pannello dove l'agenzia prepara, programma e pubblica i post di tutti i clienti su Instagram e Facebook, e sa se sono usciti davvero.» «Richiedi una demo» e «Ti rispondiamo noi, per email» | La pagina **Oggi** del pannello nuovo, in HTML vero, dentro una cornice d'app |
| 3 | Il problema | «Sei app aperte, nessuna che sappia cosa fanno le altre.» in poche righe | Le app sparse che diventano una riga di Oggi (statico) |
| 4 | Dal piano all'uscita | Quattro passi veri: Calendario, Editor con i controlli, Programma, Esito | Una schermata per passo, scelta con le schede (non a tempo) |
| 5 | **Il momento:** Pubblica senza dubbi | «Lo sai quando un post è uscito. Davvero.» Controlli prima, verifica dopo, avviso se qualcosa va storto | Fascia carbone: un post su 5 destinazioni che diventano «Confermato» una alla volta, una «Da ricollegare». Una volta sola; fermo con il movimento ridotto |
| 6 | Il team e i clienti | Ogni cliente con i suoi profili e la sua libreria; ruoli per cliente (Manager, Publisher, Editor, Viewer); registro di chi ha fatto cosa | La libreria del cliente e la riga dei ruoli |
| 7 | Fiducia | «I dati dei tuoi clienti restano tuoi.» API ufficiali di Meta, passkey e secondo fattore, agenzie separate, codici di accesso cifrati, nessun cookie sul sito. Link all'informativa | Elenco con le icone del pannello |
| 8 | In arrivo | Una sola sezione corta: notifiche, piano editoriale, calendario condiviso con il cliente, approvazione del cliente, numeri dell'agenzia | Elenco, senza schermate |
| 9 | Domande e chiusura | Domande oneste; chiusura carbone con il motto e «Richiedi una demo»; piè di pagina con privacy e cancellazione dei dati | — |

Stile: fondo carta, superfici bianche con il filo, un solo arancio per schermata, Sora 650 nei titoli e il carattere di sistema nel testo, raggi 8 e 10, nessuna ombra sulle card. La fascia carbone e una campitura arancio sono le sole due libertà, come dice il brief. I clienti d'esempio (Forno Luce, Osteria Bruna, Gelateria Polo, Ottica Venti) sono quelli del ridisegno; «dati d'esempio» si dice una volta, nel piè di pagina.

## Da decidere con Matteo

- Togliere le funzioni che non ci sono e raccoglierle nella sezione «In arrivo» (consigliato), oppure tenerle con l'etichetta come nel giro 3.
