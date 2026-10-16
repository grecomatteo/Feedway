# Feedway - Brand Kit 1.0

Direzione approvata: **arancio #FF762E + carbone #242321**. Versione 1.0, 15 ottobre 2026.

## Parti da qui

Apri `APRI-QUI.html` per vedere e scegliere i file, oppure `08-PDF/Feedway-Guida-del-marchio.pdf` per la guida compatta. `00-Panoramica.png` mostra le versioni principali.

| Ti serve... | Usa... |
|---|---|
| Il logo sul sito, con fondo bianco | `01-SVG/feedway-horizontal-carbone.svg` |
| Il logo su fondo carbone | `01-SVG/feedway-horizontal-arancio.svg` |
| Il logo bianco su foto o fondo scuro | `01-SVG/feedway-horizontal-bianco.svg`, con un fondo uniforme e leggibile |
| Un logo in verticale | `01-SVG/feedway-stacked-carbone.svg`, o la tinta adatta al fondo |
| Un'immagine trasparente da inserire in un documento | La versione corrispondente in `02-PNG/` |
| L'icona quadrata con fondo pieno | `03-Icone/feedway-app-icon-1024.png` |
| Una simulazione dell'icona arrotondata | `03-Icone/feedway-app-icon-preview-512.png` |
| Un avatar | L'icona quadrata o `03-Icone/feedway-avatar-circolare-1024.png` |
| Favicon e icone del sito/PWA | Tutta la cartella `04-Web/` |
| Cover, post o storia | SVG e PNG in `05-Social/` |
| Colori e font nel progetto | `06-Implementazione/` e `07-Font/` |
| Un file vettoriale da passare a un grafico | SVG in `01-SVG/` o `08-PDF/Feedway-Master-vettoriali-RGB.pdf` |

Le versioni bianche hanno fondo trasparente: su una pagina bianca sembrano vuote. Sceglile solo per fondi scuri. La coppia principale rimane unica; bianco e carta sono fondi di servizio.

## Regole essenziali

1. Usa i file del logo, senza ricostruire il nome digitando Sora: spaziatura e y fanno parte del lettering.
2. Mantieni le proporzioni. Nessuna rotazione, contorno, ombra o sfumatura.
3. Lascia intorno al marchio almeno lo spessore dello stelo della F. I file orizzontali contengono già un margine uniforme; il simbolo compatto richiede spazio aggiuntivo quando è isolato. Icona e avatar usano contenitori dedicati.
4. Dimensioni consigliate: logo orizzontale da 160 px, verticale da 180 px, simbolo da 32 px. A 16-24 px usa favicon/taglio piccolo: prevale la sagoma, non la lettura separata di F e W.
5. Su arancio, usa testo carbone. Il bianco su questo arancio ha contrasto 2,66:1: evita scritte ordinarie bianche sui pulsanti arancioni. Carbone/arancio raggiunge 5,89:1.
6. Nell'app lascia prevalere fondi chiari e testo carbone; usa arancio per firma, azioni principali e selezioni. Nella comunicazione puoi usare campiture più ampie.

## Cartelle

- `01-SVG`: master vettoriali, lettering in tracciati, senza font esterni.
- `02-PNG`: loghi trasparenti a più dimensioni. Non sono immagini con fondo bianco.
- `03-Icone`: icona piena, anteprima arrotondata, invertita, maskable e avatar.
- `04-Web`: favicon SVG/ICO e PNG, Apple touch icon, icone PWA, manifest e frammento HTML.
- `05-Social`: modelli 1200x630, 1080x1080, 1080x1920 e 1600x400. Le frasi sono proposte opzionali, non parti del logo.
- `06-Implementazione`: palette JSON, variabili CSS, stile dimostrativo del pulsante e sprite SVG.
- `07-Font`: Sora variabile originale e licenza SIL OFL. Il font supporta pesi 100-800; il marchio usa 650.
- `08-PDF`: guida e raccolta di master vettoriali RGB.
- `09-Verifiche`: resoconto della revisione e controlli sulle esportazioni.

## Inserimento nel programma

Per il progetto Nuxt, si possono copiare i file di `04-Web` in `public/brand/` e adattare il frammento `head-snippet.html`. I nomi delle icone nel manifest sono relativi al manifest stesso. `start_url`, `scope` e `id` sono impostati alla radice: aggiornarli se l'app vive in una sottocartella. Configurare separatamente il service worker e gli altri requisiti dell'app installabile.

Il CSS è un punto di partenza per colori e tipografia: il percorso del font è relativo alla struttura del kit e va aggiornato se si spostano i file. Non è una modifica applicata al progetto. Lo sprite offre `feedway-symbol`, `feedway-logo`, `feedway-wordmark`; per il logo usare il viewBox del relativo master.

## Stampa e pubblicazione

I PDF dei master sono vettoriali **RGB**; consentono il passaggio a un grafico o a una tipografia. Non sono PDF/X o prove CMYK certificate. Per una stampa reale vanno scelti il profilo della tipografia e una prova colore; il campione Pantone non è stato definito. Non sono state inventate equivalenze CMYK/Pantone.

Le icone sono esportazioni generiche. Prima dell'invio a un app store verificare le richieste specifiche della piattaforma scelta. La maskable mantiene il segno in una zona più prudente per i ritagli PWA.

La revisione grafica e tecnica non certifica l'esclusiva del nome o del segno: prima di un lancio pubblico resta necessaria una verifica di marchio, tenendo conto anche dell'uso omonimo Feedway già emerso nella ricerca. Il kit non è stato pubblicato né inserito nel programma.
