# Revisione UI/UX con Hallmark — landing e schermate interne

## Sessione

- Data: 26 ottobre 2026. Richiesta di Matteo: usare la skill Hallmark (github.com/nutlope/hallmark, v2.0.0) accanto a Impeccable per un audit e una proposta di riprogettazione di landing e app.
- Superfici provate nel browser: prototipo Nuxt `design/prototipo/` (porta 3100), Playwright Chromium, 1440×900 e 390×844 (alcune prove a 320).
- Rotte: `/`, `/demo/calendario`, `/demo/post/nuovo`, `/demo/post/post-partial`, `/demo/piano`, `/demo/clienti`, `/demo/team`, `/demo/condivisione`, `/demo/import`, `/accedi`.
- Proposte disegnate in `design/feedway-ui-hallmark.pen` (file separato da `feedway-ui.pen`), con la schermata attuale («Prima») accanto alla proposta («Dopo»). Le schermate «Prima» sono in `design/feedway-ui-hallmark-assets/prima/`.

## Come è stata usata Hallmark

Hallmark è una skill per pagine nuove; su un progetto esistente lavora solo con i verbi `audit` e `redesign`. Qui è stata usata come **audit** (i suoi gate, tabella in `references/gates.md`) e come guida per una **riprogettazione completa sulla tela**, senza toccare il codice dell'app.

Cosa resta fuori dalla skill, per scelta:

- **Il marchio vince.** Arancio `#FF762E`, carbone `#242321`, carta, Sora 650 per i titoli, logo dai file originali. Hallmark lo prevede (`redesign.md`: «The brand stays at every depth»).
- **Tema Coral, adattato** (richiesta di Matteo delle 18:49). Scelta manuale (`deal: manual`, gli script non girano) fra tre candidati: Coral, Studio, Wayfind. Coral è nato per strumenti di lavoro con clienti (carta calda, un solo accento, il prodotto come cancelleria su una scrivania). Dal tema: scrivania calda nell'hero, schede di cartoncino con una luce da sinistra e ombra a destra, una sola fascia carbone, scelte in una scanalatura, orari in Geist Mono, etichette in maiuscola solo iniziale. Dal marchio: Sora 600 al posto di General Sans, arancio al posto del corallo sui pulsanti principali con testo carbone, colori di stato di DESIGN.md. La fascia arancio della landing sparisce perché il tema la vieta e il brief la permette soltanto.
- **Le regole adottate in DESIGN.md restano.** Esempio: l'esito scritto «4 confermate · 1 con problema» usa il punto centrale che Hallmark considera un tic (gate 63); qui è un'etichetta di stato con un significato, quindi resta.
- **Le pagine interne sono «app screen»** per Hallmark (`flow.md` § App screens): niente hero, niente budget di parole, densità e stati prima di tutto.
- **Gli script della skill non sono stati eseguiti** (`sloplint`, `theme.mjs`, `capture.mjs`): l'installazione nel repo è stata bloccata dal controllo dei permessi perché porta codice esterno. I gate meccanici sono stati controllati a mano e con misure nel browser.

## Lettura in quattro righe (landing)

1. **A cosa serve:** far capire a chi gestisce IG e FB per più clienti che Feedway pianifica, pubblica e dice com'è andata per ogni account; un'azione: Esplora la demo.
2. **Cosa funziona e resta:** il marchio, il tono asciutto dei testi, la sezione carbone sugli esiti (la cosa più forte della pagina), la tabella dell'esito, la FAQ breve, la chiusura onesta sui documenti legali.
3. **Cosa sembra generato:** la sequenza hero → tab → tre passaggi numerati in cerchi arancio → blocco colorato con tre schede → FAQ → banda finale (gate 8 e 85, la sagoma da modello); l'hero mostra quattro schede quasi identiche dello stesso cliente con la stessa caption (la promessa «più clienti» non si vede); l'occhiello sopra il titolo (gate 54).
4. **Cosa è rotto:** il pannello della tab «Settimana» è per due terzi vuoto (gate 77); a 390 le tab vanno a capo su due righe; titolo che chiude con una parola sola («Il piano completo. Il / dettaglio…», F26).

## Risultati — landing

| ID | Livello | Dove | Cosa | Proposta |
|---|---|---|---|---|
| L1 | Struttura | Pagina intera | Sequenza da modello: hero, tab, tre passaggi, blocco funzione, schede, FAQ, chiusura (gate 8, 85) | Portare subito dopo l'hero la sezione **esiti** (il punto distintivo) e unire «Viste» e «Come funziona» in una sola sezione costruita attorno al prodotto |
| L2 | Struttura | Hero, `pages/index.vue` | Il visual mostra 4 giorni dello stesso cliente con la stessa caption ripetuta e 3 «Programmato» uguali: il prodotto sembra vuoto e monocliente | Settimana con **tre clienti** e contenuti diversi, e un post già uscito con l'esito «4 confermate · 1 con problema» aperto: è la firma della pagina (Hallmark: *signature*) |
| L3 | Regola fissa | Hero | Occhiello «Per chi gestisce Instagram e Facebook di più clienti» sopra il titolo (gate 54) | Il fatto non si perde: entra nella frase sotto il titolo |
| L4 | Riflesso | Viste | Pannello largo 1280 con due schede e il resto vuoto (gate 77) | Pannello pieno: la settimana completa a 7 colonne, testo della vista a lato in una riga |
| L5 | Riflesso | Come funziona | Tre cerchi numerati arancio (F5), zig-zag con riquadri piccoli; il passo 3 mostra solo una data | Una sola cornice del prodotto (l'editor) con i tre passaggi come didascalie numerate a fianco; niente cerchi colorati |
| L6 | Rifinitura | Viste, titolo | «Il / dettaglio quando serve.»: ultima riga che inizia con un articolo isolato (F26) | Andare a capo dopo il punto: due righe, una frase per riga |
| L7 | Rifinitura | Più clienti | Etichetta «Calendario cliente in sola lettura · con scadenza…» disegnata come un pulsante ma non cliccabile | Testo semplice con icona, oppure un vero link alla vista cliente della demo |
| L8 | Rifinitura | Telefono 390 | Le tre tab vanno su due righe («Elenco» da sola) (gate 49b) | Tab a scorrimento orizzontale o etichette più corte |
| L9 | Nota | Superfici | Ogni sezione cambia fondo (carta, bianco, carta, carbone, arancio, carta, carbone): ritmo da modello (gate 9) | Ridurre i cambi: carta per il prodotto, carbone per l'esito, arancio una volta sola per «più clienti» |

Restano come sono: titolo, frase, CTA e azione secondaria dell'hero (il brief li ha approvati), la FAQ, i testi legali.

## Risultati — schermate interne

| ID | Livello | Dove | Cosa | Proposta |
|---|---|---|---|---|
| A1 | Regola fissa | Barra laterale, `AppSidebar.vue` | Etichette «AGENZIA» e «GESTIONE» in maiuscolo spaziato (gate 67); intestazioni di giorno «MARTEDÌ 13 OTTOBRE» nell'elenco | Stesso carattere, un passo più piccolo, maiuscola solo iniziale |
| A2 | Struttura | Calendario, testata | Tre gruppi di selettori (Mese/Settimana/Elenco, Tutto/Solo post/Solo piano, Filtri) più Libreria e Nuovo post, sopra due righe di spiegazione | Una riga: periodo a sinistra; vista e Filtri (che include Tutto/Solo post/Solo piano) a destra; Nuovo post unico pulsante pieno; Libreria come pulsante secondario. Via la riga di istruzioni |
| A3 | Accessibilità | Calendario mese | Nelle celle il cliente si riconosce solo dal colore del pallino e lo stato solo dall'icona (DESIGN.md: stato sempre con icona e testo) | Ogni riga: ora, sigla del cliente scritta (FL, SF, OV), stato con icona e nome accessibile; tooltip con caption |
| A4 | Struttura | Calendario mese | Le due settimane passate e vuote prendono metà dello schermo; la settimana di oggi parte a metà pagina | Settimane senza post ridotte in altezza; oggi sempre nel primo schermo |
| A5 | Struttura | Nuovo post | I controlli partono in rosso («Blocco · Scegli il cliente») prima che la persona abbia fatto qualcosa; il pulsante principale disabilitato è arancio sbiadito con testo poco leggibile; la stessa richiesta compare tre volte (piè di pagina, controlli, pulsante) | Elenco «Da completare» neutro con spunte che diventano verdi; il rosso solo per problemi veri; il pulsante dice cosa manca, una volta, con contrasto pieno |
| A6 | Struttura | Piano editoriale | Si apre con una finestra modale che copre una pagina vuota (Hallmark: la modale è l'ultima risposta) | La scelta del cliente è la pagina stessa: tre righe con i contenuti nel piano, nessuna finestra |
| A7 | Densità | Link cliente | Cinque schede con lo stesso contenuto; date in formato ISO (2026-10-31) | Tabella: cliente, stato, scadenza scritta in italiano, indirizzo, azione |
| A8 | Struttura | Team e ruoli | Sette schede di spiegazione dei ruoli prima delle persone | Persone prima, in tabella; la spiegazione dei ruoli in un pannello richiudibile a lato |
| A9 | Densità | Clienti | Tre schede con un solo campo ciascuna e una nota ripetuta tre volte | Tabella con una riga per cliente; la nota una volta sotto il titolo |
| A10 | Rifinitura | Selettore di contesto | «Visione d'insieme · 3 cli…» troncato a 232 px | Seconda riga più corta: «3 clienti» |
| A11 | Rifinitura | Telefono, Nuovo post | La barra in basso ripete il «+» mentre si è già nell'editor; l'etichetta del pulsante disabilitato era troncata | Nascondere la barra nell'editor o disattivare il «+» corrente |

Bene così: la tabella dell'esito per destinazione (`/demo/post/post-partial`), l'importazione in blocco (passi, filtri, riga bloccata con motivo), il riepilogo in basso con l'azione principale.

## Difetti corretti nel prototipo

| ID | Dove | Effetto | Correzione | Verifica |
|---|---|---|---|---|
| R12 | `pages/demo/calendario.vue` | Su telefono il calendario si apriva vuoto: la vista predefinita Mese diventava Elenco, ma l'elenco escludeva proprio il caso Mese | Tolto il caso escluso dal calcolo dei giorni dell'elenco | A 390 l'elenco mostra lunedì 12 – domenica 18 ottobre con i post |
| R13 | `pages/demo/post/nuovo.vue` | A 390 l'editor scorreva di 2 px in orizzontale: il pulsante «Scegli un video dal computer» non ci stava | Etichetta «Scegli dal computer» (il contesto «Trascina qui il video, oppure:» resta sopra) | Larghezza di scorrimento uguale alla larghezza visibile a 390 e a 320 |

## Non verificato

- Gli script di Hallmark (`sloplint --render`, revisione in contesto separato) non sono stati eseguiti: la skill non è installata nel repo.
- Le proposte esistono solo sulla tela: nessuna è stata provata nel browser, con tastiera o con persone.
- Il tema scuro non è stato rivisto.

## Prossime azioni

1. Matteo sceglie quali proposte adottare (landing L1–L2 e calendario A2–A4 sono le più incisive).
2. Le scelte adottate vanno in `DESIGN.md`; poi il prototipo si allinea e si riprova nel browser.

## Giro 2 — 29 ottobre 2026: rebranding sulla landing «hub per agenzie»

Base: PR #84 (brief 04 aggiornato, specifica `2026-10-29-feedway-hub-agenzia.md`). Stesso tema Coral adattato al marchio. Tavole nella stessa tela, riga y 11000 (landing, modulo, telefono, footer B) e riga y 19000 (app); esportazioni in `design/feedway-ui-hallmark-assets/hub/`. La landing del giro 1 è segnata «Superata».

| Brief 04 | Stato sulla tela |
|---|---|
| L01 testata: Prodotto, Per chi è, Clienti, Domande; Accedi; Richiedi una demo | Fatto, anche menu da telefono aperto con focus su Chiudi |
| L02 apertura con il motto e la pagina Oggi (tre clienti, post approvato, attività in scadenza, post Confermato) | Fatto |
| L03 problema, icone generiche senza loghi di terzi | Fatto |
| L04 sei schede con «In arrivo» | Fatto: attiva «Fai approvare»; Produci, Fai approvare, Misura e Gestisci l'agenzia segnate «In arrivo» |
| L05 ruoli, chiusura sui permessi | Fatto |
| L06 portale del cliente sul telefono con marchio di un'agenzia di esempio | Fatto |
| L07 pubblica senza dubbi, quattro confermate e una con problema | Fatto, con il fermo immagine dell'oggetto 3D |
| L08 numeri «In arrivo» | Fatto, tabella con dati fittizi dichiarati |
| L09–L11 tre passi, fiducia, domande | Fatto; tolta la frase «a livello di database» (il brief chiede di non parlarne) |
| L12 chiusura e footer | Fatto, logo grande in due versioni |
| Modulo demo con errori, invio, conferma | Fatto; nessuna promessa sui tempi di risposta |
| Telefono 390 | Solo apertura e menu; le altre sezioni a 390 non sono disegnate |

Deroghe: due fasce carbone invece di una (tema Coral); il logo grande in bianco tenue non è un colore approvato, la versione B usa l'arancio approvato. L'oggetto 3D è un fermo immagine: va provato con TresJS nel prototipo, e nell'app richiede una ADR.

Non verificato: sloplint e revisione di Hallmark in contesto separato (skill non installata nel repo); nessuna prova nel browser delle nuove tavole.

## Giri 3 e 4 — 29 e 30 ottobre 2026: colore e schermate complete

- **Giro 3 (colore):** Matteo chiede più colore e una gerarchia negli avvisi. Logo arancio, conteggi arancio, poi (giro 4) regole d'uso ragionate: arancio solo per azione principale, selezione e «nuovo per te»; pesca per ciò che aspetta te; rosso, ambra, blu e verde con fondo tenue per gli stati; carbone per testo, numeri e barre in regola. Tabella delle regole in DESIGN.md. Sulla landing la sola grande macchia arancio è la scritta del footer; il pulsante ripetuto in testata è carbone.
- **Giro 4 (schermate):** 25 schermate dell'app, confermate da Matteo il 30 ottobre: Oggi (computer e telefono), notifiche, il mio account, calendario mese e settimana, dettaglio del post con esito, piano editoriale, nuovo post, libreria, programmazione in blocco, tabella dei clienti, pagina del cliente (operativa e commerciale), link cliente, Lavoro, shooting, report «lavoro svolto», cruscotto dell'agenzia, team e ruoli, account social, collegamento a Meta, guide interne, accesso, portale del cliente.
- **Esportazioni:** `design/feedway-ui-hallmark-assets/app/` (una immagine per schermata e quattro tavole riassuntive), `hub/` (landing finale, modulo demo, telefono, footer B), `prima/` (prototipo prima della revisione).
- **Non disegnate:** banca idee e rubriche, statistiche dei profili (1.3), cassaforte credenziali, chiusura del cliente, impostazioni dell'agenzia, stati vuoti e di errore per pagina.
- **Da fare:** riportare il sistema nella tela principale `feedway-ui.pen` e nei token del codice; provarlo nel browser; il logo arancio sul chiaro è una scelta di Matteo diversa dalla preferenza della guida del marchio.
