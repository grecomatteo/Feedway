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

E5b è l'«avviso inviato anche al vecchio indirizzo»: parte insieme a E5 e non ha un link di conferma, solo il blocco.

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

- Tempi: invito 72 h, reset 60 minuti (dal piano della tappa 2). Cambio email: 24 h sulla tela, **da fissare nel Task 1** con il valore reale di Better Auth.
- Date scritte per esteso («giovedì 29 ottobre alle 19:20»). Inviti (E1, E2) nel fuso dell'organizzazione; email di sicurezza (E3, E4, E5, E5b) nel fuso dell'utente, con ripiego su `Europe/Rome` come nel piano della tappa 2.
- E3: luogo approssimativo con la dicitura «stimato dalla rete: può essere impreciso»; se manca, la riga si omette. **Non è nel piano**: oggi ci sono solo IP abbreviato e `deviceLabel`. Una fonte GeoIP richiede una ADR; finché non c'è, la riga non compare.
- Ogni email è `multipart/alternative` con la versione solo testo della tela (titolo, paragrafi, «Etichetta del pulsante:» + URL, «--», piè di pagina).
- Anteprima (preheader) nascosta in testa al corpo HTML, testi nella scheda tecnica di ogni email.
- Domini, percorsi e nomi sulla tela (feedway.studioriva.it, `/sicurezza/blocca/…`, Studio Riva, Giulia Ferri) sono fittizi: valgono l'URL dell'installazione e i percorsi del piano (per esempio `PANEL_URL/sicurezza/non-sono-stato-io?t=<token>`).
- **Da decidere (differenza col piano):** la richiesta di design vuole l'avviso al vecchio indirizzo insieme alla conferma (E5b, «È stato chiesto di cambiare…»). Il piano della tappa 2 (Task 25, `email_changed`) lo invia invece al vecchio indirizzo *a cambio avvenuto*. Prima di scrivere il codice va scelto uno dei due momenti; se vale il piano, E5b diventa «L'email del tuo account è stata cambiata» con lo stesso pulsante «Non sono stato io».
