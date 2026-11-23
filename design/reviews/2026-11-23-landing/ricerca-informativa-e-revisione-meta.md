# Landing, informativa e revisione Meta: cosa serve

Ricerca del 23 novembre 2026, per il thread che rifà la landing e pubblica il sito (`apps/site`, D-119). Fonti lette lo stesso giorno, elencate in fondo. Ciò che non ho potuto leggere è segnato **non verificato**.

## In breve

1. Per passare l'app Meta a **Live** servono sul sito pubblico tre indirizzi: **informativa privacy**, **termini di servizio** e **istruzioni per la cancellazione dei dati**. Le istruzioni possono essere una sezione dell'informativa. I termini sono una pagina in più rispetto a quanto previsto oggi: la specifica li mette nella 2.0 (§20).
2. L'informativa non può essere generica: deve dire **quali dati arrivano da Meta**, a cosa servono, quanto restano e **come si chiede la cancellazione**. Chi revisiona controlla che la descrizione, l'informativa e i video della richiesta dicano la stessa cosa.
3. La landing può mostrare tutte le funzioni previste, ma quelle che mancano devono avere il segno **«In arrivo»**. La Developer Policy di Meta vieta di confondere o ingannare (1.4), e il brief della landing lo aveva già deciso. Nessun concorrente letto mette segni del genere: tutti mostrano solo ciò che esiste. Per noi però il segno è il modo di avere una landing ricca già adesso senza mentire.
4. Senza cookie non serve il banner. Cloudflare Web Analytics non usa cookie né localStorage; va comunque dichiarato nell'informativa, con Cloudflare come responsabile.

## 1. Cosa chiede Meta

### Impostazioni di base dell'app, necessarie per il Live

| Campo | Cosa mettere |
|---|---|
| Nome visualizzato | «Feedway» (vietati «Facebook», «FB» e simili) |
| Email di contatto | un indirizzo che leggi davvero |
| URL dell'informativa | `https://<dominio>/privacy` |
| URL dei termini | `https://<dominio>/termini`, **pagina da creare** |
| Cancellazione dei dati | URL delle istruzioni (`/privacy#cancellazione` oppure `/cancellazione-dati`) oppure un callback |
| Icona | 1024×1024, senza loghi Meta |
| Categoria | quella che descrive davvero l'app (Business/Produttività) |
| Scopo dell'app | «Per te o per la tua azienda» finché la usano solo persone con un ruolo; «Clienti» quando la aprirai ad altre agenzie |
| Domini dell'app | il dominio del sito e quello del pannello |

La **verifica dell'azienda** non serve per il Live. Senza di essa però non si accede ai dati che non sono tuoi, cioè le Pagine e gli Instagram dei clienti. Il «Data Use Checkup» citato in D-119 non compare nelle pagine lette: **non verificato**.

### Platform Terms, §3 e §4 (aggiornati al 3 febbraio 2026)

- L'informativa deve stare a un indirizzo **pubblico, non bloccato per paese e raggiungibile dal crawler di Meta**, e deve essere lo stesso indirizzo inserito nel pannello dell'app (4.a). Per noi vuol dire niente Tailscale, nessuna protezione anti-bot che blocchi il crawler, HTTPS e caricamento veloce.
- Deve spiegare «in modo preciso e chiaro» quali dati si trattano, come, per quali scopi e come chiederne la cancellazione (4.b).
- I dati di Meta si usano solo come dice l'informativa (4.c) e non per scopi diversi da quelli della documentazione (3.a.viii).
- Deve esserci un modo **facile da trovare e ben segnalato** per chiedere modifiche o cancellazioni, e la cancellazione va fatta in tempi ragionevoli (3.d.i).
- Se cambiano le funzioni di base o crescono i dati raccolti, si torna in App Review (3.a.vii).

### Cancellazione: istruzioni o callback

- Basta uno dei due. Il callback è un indirizzo HTTPS che riceve un `signed_request` quando una persona toglie l'app da Facebook. Deve rispondere con `{ url, confirmation_code }` e una pagina che mostra lo stato della richiesta.
- **Raccomandazione:** per il Live basta l'URL delle istruzioni. Feedway usa un utente di sistema del Business e non il Login con Facebook delle persone, quindi un callback riceverebbe poco o niente. Se in futuro arriva il collegamento dei clienti con il login (specifica 2.0), il callback va aggiunto: va in `/api` del pannello, non sul sito statico.

### App Review per l'accesso avanzato (prima del primo cliente vero)

- Un video per ogni permesso: almeno 1080p, senza audio, interfaccia in inglese se possibile, con le didascalie. Deve mostrare la concessione del permesso e il suo uso su una **Pagina di prova del Business**, non su un profilo personale. Un permesso senza video non viene approvato.
- Per ogni permesso serve una descrizione scritta apposta, non copiata, e almeno una chiamata API riuscita negli ultimi 30 giorni.
- Chi revisiona deve poter entrare nell'app o avere le istruzioni per farlo, senza le tue credenziali personali di Facebook. Se non riesce, rifiuta tutta la richiesta. Per un pannello dentro Tailscale questo punto è ancora aperto (D-119).
- Non chiedere permessi che servono solo «in futuro»: è tra gli errori comuni elencati da Meta.

## 2. Cosa chiede la legge italiana ed europea (art. 13 GDPR, Garante)

- Il modulo «Richiedi una demo» raccoglie dati dalla persona, quindi l'informativa va data **nel momento in cui la persona li inserisce**: il collegamento sotto il pulsante c'è già nell'ADR 016.
- **Indice consigliato**, sul modello dell'informativa del Garante:
  1. Chi è il titolare e come contattarlo.
  2. Dati di navigazione: indirizzo IP e log di Cloudflare.
  3. Dati del modulo demo: finalità (rispondere), base giuridica (misure precontrattuali, art. 6.1.b) e conservazione (nella casella email per X mesi, da decidere).
  4. Statistiche: Cloudflare Web Analytics, senza cookie e solo in forma aggregata.
  5. Cookie: nessuno.
  6. **L'app Feedway e i dati di Meta** (sezione 3 sotto).
  7. Destinatari: Cloudflare (hosting, email, statistiche) e il fornitore della VPS.
  8. Trasferimenti fuori dall'UE: Cloudflare aderisce al Data Privacy Framework; se la certificazione decade valgono le clausole contrattuali tipo (DPA 6.2 e 6.4).
  9. Diritti, con il reclamo al Garante.
  10. **Cancellazione dei dati**, con un'ancora a sé.
  11. Data dell'ultimo aggiornamento.
- **Cookie:** le Linee guida del 10 giugno 2021 dicono che chi usa solo strumenti tecnici deve dare soltanto l'informativa, senza banner. Il Garante tratta le statistiche come tecniche solo se sono aggregate, riguardano un solo sito, mascherano l'IP e non incrociano i dati. Cloudflare Web Analytics dichiara niente cookie, niente localStorage e niente impronte del browser, e non registra le query string. Che rispetti tutte le condizioni del Garante è una mia valutazione, non una conferma ufficiale: **da far vedere a chi ti segue sulla privacy**.
- Il Garante tiene i dati di navigazione al massimo 7 giorni. Cloudflare Web Analytics tiene i dati non campionati per 7 giorni, poi li aggrega. Conviene scrivere la stessa durata.
- **Partita IVA o dati dell'azienda nel piè di pagina:** per un'attività con partita IVA è d'uso indicarli sul sito. Va confermato con chi ti segue la contabilità, ed è legato a D-122.1.

## 3. La sezione sui dati di Meta (la parte che chi revisiona legge)

Modello: Planable, che ha la sezione più chiara tra i concorrenti letti. Da adattare a Feedway con i dati veri del registro dei trattamenti (§4 bis e §4 ter):

- **Ruoli.** Per i dati che l'agenzia gestisce nel pannello, l'agenzia è titolare e Feedway è responsabile (art. 28), come fanno Metricool §12 e Later. Per il sito, il titolare sei tu.
- **Dati ricevuti da Meta:** identificativi e nomi delle Pagine e degli account Instagram, foto profilo pubbliche (copiate in WebP senza metadati), elenco dei permessi concessi e token dell'utente di sistema (cifrati, mai mostrati). Poi gli identificativi e i link dei post pubblicati e l'esito della pubblicazione. In futuro anche le statistiche, ma **solo quando la funzione esisterà**.
- **Scopi:** pubblicare i contenuti che l'agenzia programma, controllare che siano usciti e mostrare nel pannello quali profili sono collegati. Nessun uso per pubblicità, nessuna vendita e nessun addestramento di modelli di intelligenza artificiale (come scrive Planable).
- **Conservazione:** finché l'account resta collegato all'agenzia. Le foto profilo si sostituiscono a ogni sincronizzazione. I file pubblicati restano 7 giorni dopo la pubblicazione se non sono in libreria (`MEDIA_RETENTION_DAYS`).
- **Come si cancellano, in due strade, come Planable:**
  1. Nel pannello: Integrazioni → Meta → scollega l'account. Token e dati dell'account si cancellano subito o entro N giorni: **da allineare al codice**.
  2. Su Facebook: Impostazioni e privacy → Impostazioni → Integrazioni aziendali (oppure «App e siti web») → rimuovi Feedway. Il nome esatto del menu cambia nel tempo: **da verificare** il giorno in cui scrivi la pagina.
  3. In alternativa: un'email al titolare, con risposta entro 30 giorni come prevede il GDPR.
- Scrivere che cancellare la copia di Feedway **non** cancella i post già pubblicati su Instagram o Facebook (Metricool lo scrive per YouTube).

## 4. La landing: tutte le funzioni, senza promettere il falso

- **Struttura:** quella decisa nel brief (L01–L12) resta. Ogni sezione mostra la funzione completa, con la sua anteprima disegnata sulla tela.
- **Segno «In arrivo»:** un'etichetta piccola accanto al titolo della sezione o della scheda, gestita da un solo elenco nel codice del sito (per esempio `features.ts` con `released: true/false`). Così a ogni fine tappa basta cambiare un valore, insieme all'aggiornamento di README e landing.
- **Cosa conta per Meta:**
  - La sezione L07 «Pubblica senza dubbi» e la descrizione dell'app devono raccontare la stessa cosa dei video della revisione: programmare e pubblicare su Instagram e Facebook i post dei clienti dell'agenzia.
  - Le funzioni future che useranno altri dati di Meta, come le statistiche (L08) o i commenti, vanno segnate «In arrivo» e **non** messe nell'informativa come trattamenti attuali. Quando arriveranno, si aggiornano l'informativa e l'App Review.
  - Niente loghi di Facebook o Instagram usati come decorazione: i nomi vanno scritti nel testo. Se servono le icone, vanno usate seguendo le linee guida dei marchi Meta (**da leggere** prima di usarle).
  - Non far sembrare Feedway un prodotto Meta (Developer Policy 2.5).
- **Piè di pagina:** una riga legale come Planable e Metricool, con Privacy, Cancellazione dei dati, Termini, Contatti e dati del titolare. La frase sui cookie («Questo sito non usa cookie») può stare nella stessa riga.
- **Pagine del sito:**
  - `/`
  - `/privacy`
  - `/cancellazione-dati` (oppure un'ancora dentro `/privacy`)
  - `/termini`
  - la conferma del modulo demo, che funziona anche senza JavaScript (ADR 016)

## 5. Decisioni aperte (D-122 in `docs/decisioni-aperte.md`)

1. **Chi è il titolare** sul sito e nell'app Meta: tu come persona o un'azienda. La verifica dell'azienda su Meta chiede i documenti di un'azienda.
2. **Pagina dei termini:** Meta la chiede per il Live. Proposta: termini brevi per l'uso del sito e del servizio su invito, senza prezzi.
3. **Istruzioni o callback** per la cancellazione: proposta, istruzioni ora e callback con il login dei clienti nella 2.0.
4. **Forma del segno «In arrivo»** e conferma che tutte le funzioni previste si mostrano già.
5. **Quanto conservare le richieste di demo** nella casella email.

## Fonti

Meta:
- [Platform Terms](https://developers.facebook.com/terms/)
- [Impostazioni di base](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/basic-settings/)
- [Callback di cancellazione](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/)
- [App Review](https://developers.facebook.com/docs/app-review/)
- [Guida all'invio](https://developers.facebook.com/docs/app-review/submission-guide/)
- [Errori comuni](https://developers.facebook.com/docs/app-review/submission-guide/common-mistakes)
- [Modalità dell'app](https://developers.facebook.com/documentation/development/build-and-test/app-modes)
- [Developer Policy](https://developers.facebook.com/devpolicy/)

Le pagine sul passaggio a Live e sui motivi di rifiuto rispondono 404: i fatti su questi temi vengono dalle pagine sopra.

Privacy:
- [Informativa del Garante](https://www.garanteprivacy.it/informativa-protezione-dati)
- [Linee guida cookie del 10/6/2021](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9677876)
- [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) e la sua [FAQ](https://developers.cloudflare.com/web-analytics/faq/)
- [Cloudflare GDPR](https://www.cloudflare.com/trust-hub/gdpr/)
- [DPA di Cloudflare](https://www.cloudflare.com/cloudflare-customer-dpa/)

Concorrenti:
- Informative: [Planable](https://planable.io/privacy/), [Metricool](https://metricool.com/privacy-policy/), [Later](https://later.com/privacy/), [Buffer](https://buffer.com/privacy) (letta in parte), [Pallyy](https://pallyy.com/privacy)
- Landing: [Planable](https://planable.io/), [Pallyy](https://pallyy.com/), [Later](https://later.com/social-media-scheduler/)
- Nessuno dei cinque ha una pagina di cancellazione separata.
