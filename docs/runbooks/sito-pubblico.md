# Sito pubblico: pubblicarlo su Cloudflare e darlo a Meta

Il sito pubblico (`apps/site`, ADR 013 e 016) ha la landing, l'informativa privacy (`/privacy`), le istruzioni per la cancellazione dei dati (`/cancellazione-dati`), i termini di servizio (`/termini`) e il modulo «Richiedi una demo». Questa guida dice cosa fare, una volta sola, per metterlo online e per dare a Meta gli indirizzi che chiede per il passaggio dell'app a Live (D-119).

I passi segnati **(non verificato)** sono scritti dalla documentazione di Cloudflare e non sono ancora stati provati: se un menu ha un altro nome, cerca la voce più simile e scrivilo in D-122.

## Prima di tutto: i dati del titolare

1. Apri `apps/site/app/legal.ts` e scrivi:
   - `controllerName`: il tuo nome e cognome, o la ragione sociale della ditta;
   - `controllerDetails` (facoltativo): partita IVA o sede, se vuoi mostrarle;
   - `privacyEmail`: l'indirizzo che riceve le richieste sulla privacy e sulla cancellazione;
   - `hostingProvider`: chi ospita il server del pannello e dove (per esempio «Hetzner Online GmbH, Germania»);
   - `backupProvider`: dove vanno le copie di sicurezza (per esempio «Google Drive, copie cifrate»);
   - `emailProvider`: chi manda le email del pannello (il servizio SMTP);
   - `court`: la città del foro per i termini;
   - `updatedOn`: la data di oggi.
2. Fai rileggere `/privacy` e `/termini` a chi ti segue sulla privacy (D-122 punto 12).
3. Fai una PR con la modifica (o chiedi al thread del sito di farla). Finché c'è «DA COMPLETARE», il workflow di pubblicazione si ferma con un errore: è voluto.

## 1. Cloudflare Pages

1. Entra in [dash.cloudflare.com](https://dash.cloudflare.com) (crea l'account se non c'è: il piano gratuito basta).
2. **Workers e Pages → Crea → Pages → Carica le risorse** (non «Collega a Git»: pubblica il workflow di GitHub). Nome del progetto: `feedway`. Se il nome è già preso da qualcun altro, scegline un altro (per esempio `feedway-app`) e ricordalo per il passo 3. **(non verificato: il nome del menu)**
3. Al primo caricamento Cloudflare chiede dei file: puoi caricare una cartella qualsiasi con un `index.html`, verrà sostituita al primo giro del workflow.
4. Il sito sarà su `https://<nome-del-progetto>.pages.dev`.

## 2. Token e account nei segreti di GitHub

1. Su Cloudflare: icona del profilo → **Profilo → Token API → Crea token → Modello personalizzato**. Permessi: **Account → Cloudflare Pages → Modifica**. Risorse dell'account: solo il tuo account. Crea e copia il token (si vede una volta sola). **Non incollarlo in chat.**
2. L'ID dell'account è nella colonna di destra della pagina iniziale del dominio, o in **Workers e Pages → Panoramica**.
3. Su GitHub, nel repository: **Settings → Secrets and variables → Actions**:
   - scheda **Secrets**: `CLOUDFLARE_API_TOKEN` (il token) e `CLOUDFLARE_ACCOUNT_ID` (l'ID);
   - scheda **Variables**: `SITE_URL` con l'indirizzo del sito (per esempio `https://feedway.pages.dev`, senza `/` in fondo) e, solo se il progetto non si chiama `feedway`, `SITE_PROJECT` con il suo nome.
4. **Actions → Sito pubblico → Run workflow** su `main`. Alla fine, apri `https://<progetto>.pages.dev/privacy` e controlla che ci siano il titolare e l'email.

## 3. Il modulo «Richiedi una demo» (email)

Il modulo manda un'email a te con Cloudflare Email Routing, e Email Routing funziona solo su un **dominio tuo gestito da Cloudflare**. Senza dominio il sito va lo stesso, ma l'invio del modulo risponde «Non siamo riusciti a inviare la richiesta». Se il dominio arriva dopo, fai questo passo dopo.

1. **Dominio su Cloudflare:** **Aggiungi un dominio**, poi cambia i nameserver presso chi te l'ha venduto con quelli che Cloudflare indica. Aspetta che risulti «Attivo».
2. **Email Routing:** nel dominio, **Email → Email Routing → Inizia**. Aggiungi il tuo indirizzo come **indirizzo di destinazione** e confermalo dal link che ti arriva.
3. **Binding nella funzione:** **Workers e Pages → feedway → Impostazioni → Associazioni (Bindings) → Aggiungi → Invia email** **(non verificato: che le funzioni di Pages abbiano questo binding, ADR 016)**:
   - nome della variabile: `DEMO_MAIL`;
   - indirizzo di destinazione: il tuo indirizzo verificato.
   Se il binding «Invia email» non c'è tra quelli di Pages, fermati e scrivilo in D-122: la soluzione è un piccolo Worker che la funzione chiama, da fare in una PR.
4. **Variabili della funzione:** **Impostazioni → Variabili e segreti**, per l'ambiente di produzione:
   - `DEMO_FROM` (testo): il mittente sul tuo dominio, per esempio `demo@tuodominio.it`;
   - `DEMO_TO` (segreto): il tuo indirizzo verificato.
5. **Limite di invii:** **Sicurezza → WAF → Regole di limitazione della frequenza → Crea**: se l'URI è `/api/richiesta-demo` e il metodo è `POST`, al massimo 5 richieste ogni 10 minuti per IP, azione «Blocca». Lascia spente le protezioni anti-bot che mettono cookie (Bot Fight Mode, la «sfida» del browser): il sito promette di non usare cookie. **(non verificato: i nomi dei menu)**
6. **Prova:** compila il modulo dal telefono con i tuoi dati veri. Deve arrivarti un'email «Richiesta di demo: …», e «Rispondi» deve andare all'indirizzo che hai scritto nel modulo.

## 4. Il dominio per il sito (facoltativo)

Con il dominio su Cloudflare: **Workers e Pages → feedway → Domini personalizzati → Configura un dominio** con `tuodominio.it` (e `www.tuodominio.it`, se vuoi). Poi cambia la variabile `SITE_URL` su GitHub e rilancia il workflow, così sitemap e `robots.txt` hanno l'indirizzo giusto. L'indirizzo `pages.dev` resta valido ma dice ai motori di ricerca di non indicizzarlo.

## 5. Gli indirizzi per Meta

Nella [dashboard dell'app Meta](https://developers.facebook.com/apps) → la tua app → **Impostazioni dell'app → Di base**:

- **URL dell'informativa sulla privacy:** `https://<sito>/privacy`
- **URL delle istruzioni per l'eliminazione dei dati** (scegli «Istruzioni per l'eliminazione dei dati», non «URL di callback»): `https://<sito>/cancellazione-dati`
- **URL dei termini di servizio:** `https://<sito>/termini` (obbligatorio per passare a Live)
- **Domini dell'app:** il dominio del sito (per esempio `feedway.pages.dev` o `tuodominio.it`)
- **Categoria:** «Business e pagine» o la più simile; **email di contatto:** una che leggi davvero
- **Icona dell'app** 1024 × 1024: `design/brief-feedway/brand/Feedway-Brand-Kit-v1.0/` (cartella `04-Web` o `05-Social`).

Salva, poi controlla che Meta legga le pagine: apri il [Debugger di condivisione](https://developers.facebook.com/tools/debug/), incolla `https://<sito>/privacy` e premi «Debug». Deve rispondere 200; ripeti per `/cancellazione-dati` e `/termini`. Se risponde 403, c'è una protezione di Cloudflare che blocca i bot (passo 3.5): toglila da quelle pagine.

Il resto del passaggio a Live è nella guida della tappa 8 (`docs/runbooks/meta-app-live.md`, quando c'è).

**Prima di dare l'indirizzo a Meta**: l'informativa promette la cancellazione entro 30 giorni. Oggi la cancellazione si fa a mano (D-122 punto 9): tieni a portata di mano la procedura prima di passare a Live.

## Controlli

- `https://<sito>/` si apre da telefono e computer, senza banner dei cookie.
- `https://<sito>/privacy`, `/cancellazione-dati` e `/termini` mostrano titolare ed email, senza «DA COMPLETARE».
- Strumenti per sviluppatori del browser → Applicazione → Cookie: nessun cookie per il sito.
- `https://<sito>/robots.txt` e `/sitemap.xml` rispondono.
- Il modulo della demo manda l'email (solo con il passo 3 fatto).
