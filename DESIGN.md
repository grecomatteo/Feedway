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
