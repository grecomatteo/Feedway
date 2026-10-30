# ADR 017 · Invio email via SMTP della piattaforma

| | |
|---|---|
| **Stato** | Proposta |
| **Data** | 2026-10-30 |
| **Specifica** | v9, §8.3, §12.3, §20 e schema `integrations`; piano generale, tappa 3 e tabella delle porte; ADR 007 |
| **Anticipo** | L'adattatore SMTP e `IntegrationStore` erano nella tappa 3. Matteo ha deciso il 30/10 di anticiparli nella tappa 2, perché inviti, reset e recupero partano davvero. Meta, Telegram e la sorveglianza esterna restano nella tappa 3 |
| **Modifica** | ADR 007 su un punto: dei segreti non si mostrano più le ultime 4 cifre (vedi sotto). Il resto di ADR 007 resta valido |

## Contesto
Fino a oggi in produzione `createMailer` restituiva un mailer "non configurato": inviti, email di sicurezza, reset, recupero e avvisi del blocco venivano scartati. Le impostazioni si devono poter cambiare senza toccare file sulla VPS (ADR 007).

La specifica prevedeva un SMTP per agenzia con ricaduta su quello della piattaforma. La revisione di sicurezza del 30/10 ha mostrato il problema: un Owner che punta l'SMTP dell'agenzia a un server suo riceve il token di ogni invito, può creare un account verificato per un indirizzo che non controlla e capisce dal testo se quell'account esiste già. In più l'host scelto da un Owner rende il server della piattaforma un mezzo per l'SSRF.

## Decisione
**Un solo SMTP, quello della piattaforma, configurato solo dall'amministratore della piattaforma (Matteo).** Decisione di Matteo del 30/10: Feedway è pronto all'uso, le agenzie non configurano nulla e tutte le email partono a nome di Feedway. L'invio usa `nodemailer`, e le impostazioni stanno nella tabella `integrations`, lette a ogni invio.

- **Dipendenze** (versioni esatte, in `packages/infrastructure`):
  - `nodemailer` **10.2.1** (runtime). È il client SMTP di riferimento per Node, senza dipendenze, con i tipi inclusi. Fa STARTTLS, AUTH PLAIN/LOGIN, la codifica MIME e le intestazioni; dal 10.x protegge da sé l'iniezione dopo STARTTLS. Scelta la 10.2.1 e non la 10.3.x, uscita il 29/10, per avere almeno una settimana di vita alle spalle.
  - `smtp-server` **3.21.1** (solo devDependency), dello stesso autore, per il server finto dei test. Dipende da `nodemailer` 10.2.1: una sola copia nel lockfile.
- **Tabella `integrations`**. Resta generale, perché Meta e Telegram per agenzia ne avranno bisogno nella tappa 3.
  - Colonne: `organization_id` (null = piattaforma), `kind` (per ora `smtp`, con un `CHECK` da allargare), `config` jsonb senza segreti (host, porta, sicurezza, utente, mittente), `secret_enc`, `key_version`, `updated_by`, `verified_at`, timestamp.
  - Vincoli: unicità su `(organization_id, kind)` con `NULLS NOT DISTINCT`. Il `CHECK integrations_smtp_platform_only` impone `kind <> 'smtp' OR organization_id IS NULL`: nessuna agenzia ha un SMTP, nemmeno scritto a mano nell'ambito di sistema.
- **RLS**: la riga di un'agenzia si vede e si scrive solo nel suo ambito; quella della piattaforma solo nell'ambito di sistema (politica `org_isolation`).
- **Porte**. Il repository `tx.integrations` lavora dentro la transazione (`findPlatform`, `upsertPlatform`), così il registro attività della parte 2 sta nella stessa transazione. `IntegrationStore` (`getPlatform`, `replacePlatform`, `platformCredentials`) cifra con `KeyRing.platform()`, già pensata per i segreti della piattaforma. Il repository per le righe delle agenzie arriverà con le integrazioni della tappa 3.
- **Ambito di sistema solo da `runAsSystem`**. Il mailer legge le impostazioni con `createMailSettings` (`packages/application/src/platform/`, fra i moduli che la regola ESLint ammette). Una nuova regola ESLint vieta di scrivere `app.scope` fuori da `unit-of-work.ts` e dagli strumenti di test.
- **Il segreto non torna mai al pannello**. La vista dice solo che è impostato (`secretSet`) e da quando (`updatedAt`). Solo `platformCredentials`, usata da chi invia, restituisce il segreto in chiaro.
- **Le ultime 4 cifre non si mostrano più: modifica di ADR 007**. ADR 007 prevedeva di mostrarle e la colonna `secret_hint` le conservava in chiaro. Con una password SMTP corta, quattro caratteri in chiaro in un dump del database sono una parte importante del segreto. Il pannello mostra "impostato" e la data.
- **Mittente**: sempre `Feedway <indirizzo della piattaforma>`, passato a `nodemailer` come oggetto `{ name, address }` e mai concatenato. Gli inviti mettono in `Reply-To` l'email di chi invita, validata come indirizzo semplice (niente nome, virgole o a capo).

### Scelte di sicurezza dell'adattatore
Restano tutte anche se l'host lo sceglie solo l'amministratore: sono una difesa in profondità contro un errore di configurazione o un DNS compromesso.

- **Solo TLS**: porta 465 con TLS implicito, oppure 587 o 2525 con STARTTLS obbligatorio (`requireTLS`). `ignoreTLS` e `opportunisticTLS` sono spenti, `rejectUnauthorized` è sempre vero e la versione minima è TLS 1.2. Porte ammesse solo 465, 587 e 2525.
- **Contro l'SSRF**:
  - l'host è un nome DNS, senza indirizzi IP scritti a mano e senza porta;
  - il nome si risolve una volta, con timeout di 5 secondi. Si rifiuta se anche un solo indirizzo non è pubblico: loopback, reti private, CGNAT (comprese le reti Tailscale), link-local (metadati del cloud), multicast, riservati e documentazione. In IPv6 sono ammessi solo gli indirizzi globali `2000::/3`, tolti 6to4, Teredo, NAT64, documentazione e benchmark;
  - ci si collega all'indirizzo verificato, con `servername` uguale al nome per SNI e certificato: un secondo DNS non può cambiare la destinazione.
- **Tempi**: 10 s per la connessione, 10 s per il saluto, 30 s di silenzio e **60 s in tutto per ogni invio**. Il limite totale ferma anche un server che risponde un byte alla volta, che altrimenti non farebbe mai scattare il timeout del socket. Allo scadere la connessione si chiude e l'errore è `timeout`. Una connessione per invio, chiusa subito: nessun pool.
- **EHLO** con il nome dell'host del pannello, oppure `feedway.invalid`. Mai `os.hostname()`, che rivelerebbe il nome della macchina.
- **Intestazioni**: destinatario e `Reply-To` sono un singolo indirizzo semplice, l'oggetto sta su una riga (un a capo viene rifiutato) e la busta SMTP è esplicita. L'accesso a file e URL di `nodemailer` è disattivato.
- **Errori**: classificati (`invalid_config`, `blocked_destination`, `dns`, `timeout`, `tls`, `auth`, `connection`, `rejected`). Contengono al massimo la risposta del server, che viene ripulita prima di finire nell'avviso, nel messaggio dell'errore e quindi nel lavoro della coda:
  - su una riga, tagliata a 200 caratteri;
  - senza utente e password, né in chiaro né in base64, né nella forma AUTH PLAIN;
  - senza indirizzi email.

  I log di `nodemailer` sono spenti, perché conterrebbero lo scambio AUTH.
- **Test**: l'unica eccezione ai controlli è l'opzione `testing.fakeServer` (porta del server finto su 127.0.0.1 e CA autofirmata). Solo i test la passano a `createSmtpSender`; non arriva da variabili d'ambiente né dalla configurazione.

## Alternative scartate
- **SMTP per agenzia con ricaduta sulla piattaforma** (specifica v9): un Owner malintenzionato riceverebbe i token degli inviti e potrebbe sfruttare l'SSRF. A Matteo non serve: Feedway è pronto all'uso.
- **SMTP dell'agenzia solo per notifiche senza link**: resta il rischio SSRF, e ogni agenzia avrebbe un'impostazione in più da gestire. Si potrà riaprire se le agenzie lo chiederanno.
- **SMTP scritto a mano** (`node:tls` più i comandi): STARTTLS, AUTH, codifica MIME, linee lunghe e risposte su più righe sono proprio il punto dove nascono i difetti di sicurezza. `nodemailer` li ha già risolti e verificati.
- **API HTTP di un singolo fornitore** (Brevo, Resend, Postmark…): Brevo e gli altri parlano comunque SMTP, e un'API si potrà aggiungere più avanti come altro `kind`.
- **Mostrare le ultime 4 cifre del segreto** (ADR 007): vedi sopra.

## Conseguenze
- **Scompare la minaccia di un Owner malintenzionato**: nessuna agenzia sceglie server, mittente o host. Restano le difese SSRF e TLS, come difesa in profondità.
- In produzione nessuna email parte finché l'amministratore non imposta l'SMTP della piattaforma. La parte 2 porta il comando `cli`, una pagina del pannello riservata agli amministratori della piattaforma e l'email di prova, che imposta `verified_at`.
- Il mailer legge le impostazioni a ogni invio: un cambio vale dall'email successiva, senza riavvio. Il costo è una transazione di sistema e una decifratura per email.
- **Rischio residuo**: l'indirizzo pubblico della VPS stessa supera il controllo degli indirizzi. Se la VPS espone servizi sulle porte 465, 587 o 2525, l'adattatore potrebbe collegarsi lì. La correzione non sta nel codice ma in un filtro dei collegamenti in uscita, da annotare nella guida di installazione: il container può uscire solo verso internet e mai verso l'IP pubblico della VPS né verso la rete Docker.
- Da tenere d'occhio:
  - gli avvisi di sicurezza di `nodemailer`;
  - un fornitore che chieda la porta 25 o TLS senza verifica: non è supportato, per scelta;
  - un server SMTP raggiungibile solo in rete privata: rifiutato, per scelta.
- Si riapre se servono OAuth2 (Gmail senza password per app), un fornitore raggiungibile solo via API, oppure notifiche email con il server dell'agenzia.
