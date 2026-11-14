# Feedway — sistema visivo

Riferimento visivo: la tela Pencil `design/feedway-ui.pen` (tavole esportate in `design/tavole/`). Il brand kit prevale su qualsiasi preferenza generica delle skill. Questo file registra le scelte adottate; le alternative ancora da decidere sono in fondo.

## Direzione

Studio editoriale visivo: fotografie e copertine dei clienti protagoniste, struttura e controlli regolari. Una sola grammatica per app e landing; la landing ha più libertà compositiva (campiture arancio e carbone), l'app resta su fondi chiari.

## Token (variabili Pencil, da riportare in CSS)

| Token | Chiaro | Scuro | Uso |
|---|---|---|---|
| `bg` | `#FAF9F6` carta | `#191817` | Fondo pagina |
| `surface` | `#FFFFFF` | `#242321` | Schede, pannelli |
| `surface-sunken` | `#F3F1EC` | `#1F1E1C` | Selettori, righe secondarie |
| `nav-bg` | `#F3F1EC` | `#141312` | Barra laterale |
| `nav-hover` | `#E9E6DF` | `#22211F` | Riga della barra al passaggio del mouse o con il menu aperto |
| `paper` | `#F6F3EE` carta Hallmark | `#191817` | Fondo delle pagine in stile unione |
| `card` | `#FFFDF9` cartoncino | `#242321` | Superficie di un elenco o di una tabella (stile unione) |
| `groove` | `#EFEBE4` scanalatura | `#1F1E1C` | Fondo del filtro a scanalatura, blocchi degli scheletri |
| `text` | `#242321` | `#F4F2EE` | Testo |
| `text-muted` | `#5F5B55` | `#B9B4AC` | Metadati |
| `border` / `border-strong` | `#E3DFD7` / `#CFCAC0` | `#3A3835` / `#55524D` | Bordi |
| `brand` | `#FF762E` | uguale | Azioni principali, selezioni |
| `on-brand` | `#242321` | uguale | Etichette sui pulsanti arancioni |
| `brand-soft` | `#FFE8DA` | `#3D2A1F` | Voce di navigazione attiva, scelta selezionata |
| `focus` | `#242321` | `#FF762E` | Anello di focus 2 px |
| `success` / `-soft` | `#17693F` / `#E3F3EA` | `#6FD39C` / `#173326` | Confermato |
| `warning` / `-soft` | `#8A5200` / `#FFF1D2` | `#F2B860` / `#3A2C12` | Avviso, da accertare |
| `danger` / `-soft` | `#B3261E` / `#FCE9E7` | `#FF8A80` / `#3D1C1A` | Con problema, blocco |
| `info` / `-soft` | `#1F5AA6` / `#E7EFFA` | `#8CB8F2` / `#18273B` | Programmato, in verifica |

I colori di stato hanno significato indipendente dal marchio e sono sempre accompagnati da icona e testo. Raggi: 8 per i controlli, 12 per le schede. Spaziatura 4/8/12/16/24/32.

## Tipografia

- Titoli: Sora 650 (sulla tela Pencil si vede 600, perché Pencil non rende il peso 650 del font variabile).
- Corpo: `system-ui` nel codice; sulla tela Inter come sostituto provvisorio dichiarato (Pencil non offre `system-ui`).
- Testo operativo 13–16 px, titoli di pagina 24–28 px, hero landing 56 px.

## Componenti condivisi (tela, pagina «00 · Sistema condiviso»)

Logo orizzontale e simbolo (tracciati degli SVG originali), pulsante primario (arancio, etichetta e bordo carbone), secondario, focus visibile, disabilitato, etichette di stato (bozza, programmato, in preparazione, in verifica, da accertare, con problema, in pausa, confermato), scheda post, riga account (attivo / da ricollegare), barra laterale app.

## Regole

- Scheda post sempre nello stesso ordine: ora e tipo, miniatura con cliente, caption (2 righe), destinazioni, esito.
- Pulsanti arancioni con testo carbone; testo arancio mai come etichetta o link ordinario.
- Esiti multi-destinazione scritti per esteso: «4 confermate · 1 con problema», «4 confermate · 1 da accertare».
- Ombre solo sulle superfici sovrapposte (finestra prodotto nella landing).

## Scelte adottate (15 ottobre 2026, Matteo)

- Hero della landing: testo e calendario affiancati.
- Calendario: Mese è la vista predefinita (panoramica); Settimana è lo zoom di dettaglio con miniature grandi; Elenco per giornate dense e telefono. La libreria si apre con un pulsante.
- Navigazione stile Meta: selettore con «Tutti i clienti» (visione d'insieme), un cliente o un singolo profilo, con ricerca. Il contesto restringe l'app e preseleziona le destinazioni di Nuovo post.
- Destinazioni: elenco a spunta con ricerca, un profilo per riga. Spuntare il profilo seleziona l'account Instagram e la Pagina Facebook collegata; IG e FB si possono togliere singolarmente.
- Telefono: barra a cinque voci con il pulsante + al centro; barra azioni dell'editor su una riga, con l'etichetta che dice cosa manca.
- Copertina del reel (16 ottobre): fotogramma scelto con un cursore oppure immagine propria, con anteprima 9:16, griglia e quadrato. La copertina personalizzata dei reel Facebook va verificata con un account di prova.
- Anteprima video: il video si rivede nell'editor; i .mov HEVC non riproducibili dal browser mostrano un messaggio, e nel prodotto l'anteprima usa l'MP4 convertito dal server.
- Calendario cliente: mese completo «da lontano», mesi che continuano scorrendo, logo Feedway a sinistra, logo del cliente e «gestito da» con il logo dell'agenzia a destra, anteprima al clic; data dell'ultimo aggiornamento.
- Note sui post con visibilità «solo per me» o «per il team» (proposta, vedi design/ruoli-e-permessi.md).
- Copertina e video si caricano anche trascinando il file sull'area tratteggiata (16 ottobre).
- Calendario cliente: «Stampa o salva PDF», A4 orizzontale, un mese per pagina, solo pubblicazioni da oggi in poi; i contenuti pianificati compaiono come «In preparazione».
- Piano editoriale (proposta): sezione separata nel menu con mese da riempire e scelta del cliente; nel calendario principale schede tratteggiate «Da preparare» e selettore Tutto · Solo post · Solo piano; stampa del piano con schede piene e loghi. Dettagli in design/proposta-piano-editoriale.md.

## Menu dell'utente (13 novembre 2026, Matteo)

- In fondo alla barra laterale una riga sola: foto, nome e sotto, in piccolo, «Ruolo · Agenzia». Nessuna freccia: al passaggio del mouse la riga si scurisce appena (`nav-hover`).
- Al clic un menu verso l'alto, largo quanto la barra: foto, nome ed email in testa; «Impostazioni»; le pagine dell'agenzia che si aprono di rado, «Registro attività» e «Privacy», tolte dalla barra; «Cambia agenzia» solo con più agenzie; separatore; in fondo, sulla stessa riga, «Esci» neutro con icona e a destra un solo pulsante con il sole o la luna che passa al tema chiaro o scuro.
- Niente selettore a tre segmenti per il tema (Matteo, 13/11: «non mi piace proprio»). «Automatico» si sceglie in «Impostazioni» → Profilo e preferenze.
- Sul telefono lo stesso menu si apre dal basso, a tutta larghezza, dalla voce «Tu» della barra in basso (14/11, vedi «Navigazione su telefono»); la foto in alto a destra sparisce.
- «Impostazioni» resta dentro la barra dell'agenzia.

## Impostazioni (13 novembre 2026, Matteo; tappa 4, Task 2)

- Una sola voce «Impostazioni» nel menu dell'utente, al posto di «Il mio account» e delle impostazioni dell'agenzia. Apre sempre «Profilo e preferenze», anche per chi non ha agenzie.
- Un guscio comune (`SettingsShell`): titolo «Impostazioni», sotto il nome e l'email (o «Solo l'Owner può cambiarle.» nelle schede dell'agenzia), poi due gruppi di schede:
  - «Il tuo account»: Profilo e preferenze, Sicurezza, Dispositivi, Privacy;
  - «Agenzia · <nome>»: Generali, Integrazioni, solo per Owner e Admin (`organization.settings.view`) dell'agenzia attiva o ricordata.
- Computer (da 1024 px): i gruppi sono una colonna a sinistra da 12rem, la scheda attiva su `brand-soft`. Sotto i 1024 px i gruppi stanno sopra il contenuto, in riquadri `surface-sunken`; sul telefono le schede sono in due colonne, così nessuna va a capo da sola.
- Gli indirizzi non cambiano (`/account/*`, `/<agenzia>/impostazioni/*`): i link delle email continuano a funzionare.
- Sul telefono «Impostazioni» si apre dal menu «Tu» della barra in basso (14/11). Fino al Task 6b della tappa 4 il quinto posto della barra resta «Impostazioni» (ingranaggio).
- La tela in `design/feedway-ui.pen` non è aggiornata: in questo ambiente non c'è Pencil. Schermate di riferimento nella cartella del progetto, `schermate/tappa-4-impostazioni/`.

## Logo dell'agenzia (13 novembre 2026; tappa 4, Task 3)

- In «Impostazioni → Agenzia → Generali», sopra il modulo, un riquadro «Logo dell'agenzia», solo per l'Owner. Lo stesso componente della foto profilo (`AvatarUploader`, forma `square`): scegli o trascina, poi una finestra «Controlla il logo» con le due misure, senza ritaglio.
- Il logo non si ritaglia mai: si adatta intero dentro il quadrato, la trasparenza resta (`object-contain`, bordo `border` su `surface`, angoli `rounded-md` a 32 px e `rounded-xl` a 96 px).
- Nella barra (`OrgSwitcher`) il logo prende il posto del quadratino scuro con le iniziali (`AgencyLogo`). Senza logo, o se non si carica, restano le iniziali. Sul telefono con una sola agenzia la barra in alto non mostra l'agenzia, come prima.
- Schermate nella cartella del progetto, `schermate/tappa-4-logo/`. La tela in `design/feedway-ui.pen` non è aggiornata.

## Stile unione (14 novembre 2026, Matteo)

Dopo la prova della 0.9.0 (critica e confronto in `design/reviews/2026-11-13-*.md`) Matteo ha scelto una direzione sola, presa da tre. Il brand kit non cambia. Riferimento visivo: `design/esplorazioni/2026-11-13-revisione/clienti-profili.html` (`?p=clienti|cliente|nuovo`).

- **Guscio Hallmark:** barra laterale com'è oggi, fondo carta, cartoncino per la superficie dell'elenco, filtro a scanalatura e ricerca sopra gli elenchi.
- **Grammatica «Officina»:** una superficie per elenco, righe separate da filetti, nessuna scatola dentro una scatola; lo stato è un pallino più una parola; il colore va solo dove c'è da agire; una frase di riepilogo con link al posto dei conteggi.
- **Regola di riga:** 56 px su computer e 64 su telefono; foto o iniziali da 32 px; il nome è il collegamento principale; al massimo un'azione visibile, solo se serve davvero; il resto in «⋯».

### Elenchi e tabelle

I valori di carta, cartoncino e scanalatura vengono dal riferimento visivo approvato (`clienti-profili.html`); nel tema scuro restano i fondi di oggi. I componenti sono in `apps/web/app/components/` (tappa 4, Task 5a) e si provano sulla pagina `/__test/componenti`, che esiste solo nei test.

| Elemento | Regola |
|---|---|
| Testata (`PageHeader`) | Titolo, sotto la frase di riepilogo (per esempio «5 clienti. Pizzeria Da Gino ha un profilo da ricollegare.», con il nome che porta al problema), a destra l'azione principale. Niente numeri grandi o riquadri di conteggio |
| Strumenti | Sopra l'elenco, su una riga: filtro a scanalatura (`SegmentedFilter`, per esempio «Attivi 5 · Archiviati 1») e ricerca (`SearchField`). Su telefono la ricerca va sotto il filtro, a tutta larghezza |
| Superficie | Un solo cartoncino (`card`, bordo `border`, raggio 12) per elenco. Righe separate da un filetto `border`; intestazione delle colonne in `text-muted` 13 px con una linea `border-strong` sotto |
| Riga (`DataRow`) | 56 px su computer, 64 su telefono, tutte alte uguali. A sinistra foto o iniziali da 32 px (`RowAvatar`), poi il nome in 15 px, che è il collegamento; i dettagli in `text-muted`. Area di tocco di almeno 44 px |
| Colonne (`DataTable`) | Solo dati che cambiano da riga a riga: una colonna uguale per tutti si toglie. Sotto i 768 px la tabella diventa righe a due livelli: nome sopra, dettagli sotto, stato solo se c'è da agire |
| Stato (`StatusDot`) | Pallino da 8 px più una parola (con un alone tenue quando c'è da agire). Neutro (`text-muted`) quando va tutto bene, e spesso non si scrive nemmeno; colore di stato (tabella dei token) solo dove serve agire, sempre con la parola. Verde e blu, per un esito o un programmato da mostrare, colorano solo il pallino: la parola resta del colore del testo |
| Azioni (`RowActions`) | «⋯» in fondo alla riga, raggiungibile da tastiera, con etichetta «Azioni per <nome>». Un pulsante visibile solo per l'azione che risolve un problema (per esempio «Ricollega») |
| Caricamento | Scheletri con la forma esatta della riga di quella pagina (`ListSkeleton`, `TableSkeleton`), mai una scritta |
| Vuoto ed errore | Vuoto: una frase e il primo passo. Errore: cosa è successo, cosa fare e «Riprova», dentro la stessa superficie |

### Clienti e profili (proposta P)

Pagina Clienti (tappa 4, Task 5b): tabella Cliente · Profili · Collegamento · «⋯» su computer, righe a due livelli su telefono; «Da ricollegare» in ambra, «Con problema» in rosso, «Attenzione» in ambra; schermate in `schermate/tappa-4-clienti/` nella cartella del progetto.

Specifica §14.7. Il cliente contiene i suoi profili: non c'è più la voce «Account social».

- **Clienti:** ogni riga ha foto o iniziali, nome, i profili (icona della piattaforma più nome, «@uno +1» oltre il primo) e lo stato del collegamento solo se c'è da agire; il pulsante «Ricollega» solo per chi gestisce i collegamenti. In cima, quando serve, l'avviso «N profili trovati non sono in un cliente · Sistemali», su `brand-soft` come le cose che «aspettano te».
- **Abbina ai clienti:** dopo il collegamento, «Abbiamo trovato N profili»: una riga per cliente proposto (spunta, foto, nome modificabile, profili, «Perché insieme» in `text-muted`, in ambra se è un account da solo), «⋯» con Rinomina, «Unisci con…» e «Aggiungi a un cliente esistente»; i profili già nei clienti in un gruppo a parte su `surface-sunken`. In fondo una barra fissa con «Decido dopo» e «Crea N clienti». Su telefono righe da elenco (spunta, foto 32, nome, icone e handle sotto) e la barra dei pulsanti su una riga sopra la barra in basso. Matteo: approvato il 14/11, con la versione compatta su telefono.
- **Nuovo cliente:** una finestra che elenca i profili non ancora in un cliente, uno per riga con icona della piattaforma e nome; il nome del cliente si propone dal profilo. In fondo «Senza profilo, per ora».
- **Pagina del cliente:** testata con foto, nome, i nomi dei profili e «Nuovo post»; schede Panoramica, Calendario, Libreria, Persone, con «Presto» su quelle non ancora costruite. Nella Panoramica i profili come righe dell'elenco, con «⋯» (Ricollega, Sostituisci profilo, Togli dal cliente) solo per Owner e Admin, e chi ci lavora.
- **Collegamenti:** in Impostazioni → Agenzia → Integrazioni, una voce per piattaforma (oggi Meta).
- **Nomi neutri:** «Profili», «Collegamento». Nessun testo dice «Instagram e Facebook» o «Meta» dove potrebbero stare altre piattaforme.

### Navigazione su telefono

- Barra in basso: Home, Calendario, + (Nuovo post, al centro), Clienti, Tu. Calendario e + si vedono disattivati con «Presto» finché non esistono; un Viewer non vede il +.
- «Tu» mostra la foto della persona e apre dal basso il menu dell'utente: Utenti (per chi li gestisce), Impostazioni, Registro attività (per chi lo vede), Privacy, «Cambia agenzia», tema, «Esci». In alto non c'è più la foto.

Le schermate di ogni pagina, chiare e scure, da computer e da telefono, vanno nella cartella del progetto prima della fusione. La tela in `design/feedway-ui.pen` non è aggiornata: in questo ambiente non c'è Pencil.

## Email transazionali (26 ottobre 2026)

Tela: pagine «E0 · Email transazionali · componenti» e «E1–E5 · Email transazionali» in `design/feedway-ui.pen`; tavole in `design/tavole/email/`. Componenti Pencil: `Email · Intestazione`, `Email · Pulsante` (con la variante sicurezza), `Email · Riquadro`, `Email · Piè di pagina`, `Email · Modello`. Per ogni email la tela riporta oggetto, anteprima, quando parte, variabili, versione 600 px, versione 320 px e versione solo testo: i testi esatti sono lì.

| Email | Oggetto | Pulsante |
|---|---|---|
| E1 Invito, persona nuova | «[Nome] ti ha invitato in [Agenzia] su Feedway» | Crea il tuo account (arancio) |
| E2 Invito, account esistente | come E1 | Accedi per accettare (arancio) |
| E3 Nuovo accesso o dispositivo | «Nuovo accesso al tuo account Feedway» | Non sono stato io (rosso, blocca l'account) |
| E4 Reset della password | «Scegli una nuova password per Feedway» | Scegli una nuova password (arancio) |
| E5 Conferma cambio email (nuovo indirizzo) | «Conferma il nuovo indirizzo del tuo account Feedway» | Conferma il nuovo indirizzo (arancio) |
| E5b Avviso cambio email (vecchio indirizzo) | «È stato chiesto di cambiare l'email del tuo account Feedway» | Non sono stato io (rosso) |

E5b è l'«avviso inviato anche al vecchio indirizzo»: parte insieme a E5, al momento della richiesta, e non ha un link di conferma, solo il blocco («Non sono stato io» annulla il cambio e blocca l'account).

### Struttura

- Fondo esterno `#FAF9F6`, una colonna centrata larga al massimo **600 px** (tabella con `width="100%"` e `max-width:600px`), fluida sotto i 600.
- Scheda: fondo `#FFFFFF`, bordo 1 px `#E3DFD7`, raggio 12 (Outlook lo ignora: va bene squadrato).
- Margini esterni: 32 sopra, 40 sotto (telefono 16 / 24, laterali 12).
- Margini interni (`email-pad`): **40 px** a 600, **20 px** sotto i 480 (media query; senza media query resta 40 anche a 320 e si legge).
- Intestazione: padding 32 / 8 (telefono 24 / 8). Logo PNG `design/feedway-ui-assets/feedway-logo-email@2x.png` (352×102, fondo bianco pieno) mostrato a **176×51**, `alt="Feedway"`, allineato a sinistra, nessun link.
- Contenuto: padding 24 sopra, 40 sotto (telefono 32); spazio verticale fra i blocchi **20 px**.
- Piè di pagina fuori dalla scheda, padding 24 sopra, spazio 6 fra le righe: «Feedway» (13/600), il motivo specifico dell'email, «È un messaggio di servizio: lo inviamo solo quando serve al tuo account.». Nessun link, nessun pixel o parametro di tracciamento, nessuna disiscrizione (sono email di servizio).

### Testo

- Pila: titoli `Sora, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif` (Sora solo se il client ce l'ha; nessun font scaricato); corpo `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`. Versione solo testo senza font.
- Titolo: **24/31 px**, peso 650 (in pratica 600–700 col ripiego), `#242321`; al telefono **22/29**.
- Paragrafo: **16/24**, `#242321`. Attacco in grassetto («Sei stato tu?», «Non l'hai chiesto tu?») su una riga sua, 16/24 peso 600.
- Nota e link in chiaro: **14/20**, `#5F5B55`; l'indirizzo del link in `#242321` sottolineato, con `word-break: break-all`.
- Piè di pagina: **13/20**, `#5F5B55`.

### Pulsante

- Link a blocco «bulletproof» (tabella con cella colorata più `<a>` con padding; VML per Outlook se serve), altezza **48 px**, padding orizzontale 28, raggio 8, testo **16 px peso 600**.
- Principale: fondo `#FF762E`, bordo 2 px `#242321`, testo `#242321` (5,89:1).
- Sicurezza («Non sono stato io»): fondo `#B3261E`, bordo uguale, testo `#FFFFFF` (6,54:1).
- A 600 px largo quanto il testo, a sinistra; sotto i 480 px a tutta larghezza.
- Sotto ogni pulsante, a 16 px: «Se il pulsante non funziona, copia questo indirizzo nel browser:» e l'URL completo in chiaro.

### Riquadri

- Scadenza e dettagli: fondo `#F3F1EC`, bordo 1 px `#E3DFD7`, raggio 8, padding 16 / 20, spazio 6. Titolo 15/21 peso 600, testo 15/22.
- Dettagli di accesso (E3): etichetta 13 px peso 600 `#5F5B55`, valore 16/23, coppie distanziate di 12.
- Avviso informativo (E5): fondo `#E7EFFA`, bordo 1 px `#1F5AA6`; il significato è nel titolo del riquadro, non nel colore.

### Contrasto e tema scuro dei client

Tutte le coppie superano AA: testo 15,7:1 su bianco, testo secondario 6,74:1 su bianco e 5,97:1 sui riquadri. Per reggere lo scurimento automatico: `<meta name="color-scheme" content="light">` e `supported-color-schemes`, colori sempre dichiarati sia per testo sia per fondo, logo con fondo bianco pieno (non trasparente), pulsante arancio con bordo carbone così resta leggibile anche se il client inverte il fondo. Nessuna informazione solo nelle immagini o nei fondi.

### Contenuto e dati

- Tempi: invito 72 h, reset 60 minuti (dal piano della tappa 2). Cambio email: **60 minuti**, fissato nel Task 25 (la tela diceva 24 h).
- Date scritte per esteso («giovedì 29 ottobre alle 19:20»). Inviti (E1, E2) nel fuso predefinito dell'installazione, finché le agenzie non avranno un fuso proprio; email di sicurezza (E3, E4, E5, E5b) nel fuso dell'utente, con ripiego su `Europe/Rome` come nel piano della tappa 2.
- E3: luogo approssimativo con la dicitura «stimato dalla rete: può essere impreciso»; se manca, la riga si omette. **Non è nel piano**: oggi ci sono solo IP abbreviato e `deviceLabel`. Una fonte GeoIP richiede una ADR; finché non c'è, la riga non compare.
- Ogni email è `multipart/alternative` con la versione solo testo della tela (titolo, paragrafi, «Etichetta del pulsante:» + URL, «--», piè di pagina).
- Anteprima (preheader) nascosta in testa al corpo HTML, testi nella scheda tecnica di ogni email.
- Domini, percorsi e nomi sulla tela (feedway.studioriva.it, `/sicurezza/blocca/…`, Studio Riva, Giulia Ferri) sono fittizi: valgono l'URL dell'installazione e i percorsi del piano (per esempio `PANEL_URL/sicurezza/non-sono-stato-io?t=<token>`).
- **Avviso al vecchio indirizzo (scelta di Matteo, 26 ottobre 2026):** E5b parte subito, insieme a E5, quando il cambio viene chiesto, così si può bloccarlo prima che avvenga. Il piano della tappa 2 (Task 25, `email_changed` inviato a cambio avvenuto) va aggiornato di conseguenza.

## Direzione Hallmark per l'hub (29 ottobre 2026)

Matteo: «mi piace, seguire le linee guida di Hallmark con più gerarchia di colore; non tutto arancione». Tavole in `design/feedway-ui-hallmark.pen` (giro 3) ed esportazioni in `design/feedway-ui-hallmark-assets/app/` (app) e `hub/` (landing). Ancora da riportare nella tela principale e nel codice.

**Tema.** Hallmark Coral adattato al marchio: carta e scrivania calde, cartoncino con una luce da sinistra e ombra a destra, scelte in una scanalatura, orari e numeri in colonna in Geist Mono. Restano Sora per i titoli e il corpo di sistema.

**Regole del colore**

| Colore | Dove va | Dove non va |
|---|---|---|
| Arancio pieno | Logo (una volta per schermata), azione principale, voce o giorno selezionato (segno sottile), conteggi delle cose nuove per te (barra laterale, campanella) | Sfondi di riquadri, filetti decorativi, icone delle liste, barre di avanzamento, testo sotto i 24 px su fondo chiaro |
| Pesca (`brand-soft`) | Voce attiva, riepilogo del giorno, avvisi «aspetta te» (approvazioni, richieste, shooting da accettare), fondo caldo di alcune sezioni della landing | Al posto dell'arancio sulle azioni |
| Rosso | Problema: pieno solo nel conteggio del riquadro, tenue nella riga e nell'etichetta | Errori di forma da poco |
| Ambra | In ritardo, da accertare, in scadenza, sotto il pacchetto | Avvisi generici |
| Blu | Programmato | Link o azioni |
| Verde | Fatto: confermato, approvato | Successi ovvi (nessun avviso di festa) |
| Carbone | Testo, icone, numeri grandi, barre di avanzamento in regola, pulsante ripetuto in testata della landing | |

Gli stati usano sempre colore, icona e testo, con fondo tenue. Per schermata: un solo grande blocco arancio (sulla landing è la scritta del footer; la sezione del portale passa a pesca). Logo arancio in testata, barra laterale e footer: scelta di Matteo, la guida del marchio preferirebbe il carbone sul chiaro.
