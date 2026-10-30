# ADR 017 · Invio email via SMTP

| | |
|---|---|
| **Stato** | Proposta |
| **Data** | 2026-10-30 |
| **Specifica** | v9, §8.3 e schema `integrations`; piano generale, tappa 3 e tabella delle porte; ADR 007 |
| **Anticipo** | L'adattatore SMTP e `IntegrationStore` erano nella tappa 3. Matteo ha deciso il 30/10 di anticiparli nella tappa 2, perché inviti, reset e recupero partano davvero. Meta, Telegram e la sorveglianza esterna restano nella tappa 3 |

## Contesto
Fino a oggi in produzione `createMailer` restituiva un mailer "non configurato": inviti, email di sicurezza, reset, recupero e avvisi del blocco venivano scartati. Le impostazioni si devono poter cambiare dal pannello, senza toccare file sulla VPS (ADR 007), per ogni agenzia e con un valore predefinito della piattaforma. Un Owner sceglie l'host del server SMTP: il server della piattaforma si collega dove dice lui, quindi va difeso dall'SSRF.

## Decisione
**Invio con SMTP tramite `nodemailer`, con le impostazioni nella tabella `integrations`, lette a ogni invio.**

- **Dipendenze** (versioni esatte, in `packages/infrastructure`):
  - `nodemailer` **10.2.1** (runtime). È il client SMTP di riferimento per Node, senza dipendenze, con i tipi inclusi. Fa STARTTLS, AUTH PLAIN/LOGIN, la codifica MIME e l'intestazione; dal 10.x protegge da sé l'iniezione dopo STARTTLS. Scelta la 10.2.1 e non la 10.3.x uscita il 29/10, per avere almeno una settimana di vita alle spalle.
  - `smtp-server` **3.21.1** (solo devDependency), dello stesso autore, per il server finto dei test. Dipende da `nodemailer` 10.2.1: una sola copia nel lockfile.
- **Tabella `integrations`**: `organization_id` (null = predefinita della piattaforma), `kind` (per ora `smtp`, `CHECK` da allargare con le prossime integrazioni), `config` jsonb senza segreti (host, porta, sicurezza, utente, mittente), `secret_enc`, `key_version`, `secret_hint` (ultimi 4 caratteri), `updated_by`, `verified_at`, timestamp. Unicità su `(organization_id, kind)` con `NULLS NOT DISTINCT`: una sola riga per agenzia e una sola predefinita per tipo.
- **RLS**: la riga di un'agenzia si vede e si scrive solo nel suo ambito; la riga della piattaforma solo nell'ambito di sistema (la stessa politica `org_isolation` delle altre tabelle: `null` non è mai uguale all'agenzia corrente).
- **Segreti**: cifrati con la chiave dati dell'agenzia (`KeyRing.forOrganization`). Quella della piattaforma con `KeyRing.platform()`, già presente e pensata proprio per i segreti della piattaforma. L'AAD è `integrations:<agenzia|platform>:<tipo>`: un valore copiato su un'altra riga non si apre. Il segreto non torna mai al pannello. `IntegrationStore.get` restituisce config, ultimi 4 caratteri e date. Solo la porta interna `IntegrationCredentialSource`, usata da chi invia, restituisce il segreto in chiaro.
- **Ricaduta**: gli inviti usano le impostazioni dell'agenzia, altrimenti quelle della piattaforma. Email di sicurezza, reset, recupero e avvisi del blocco usano sempre la piattaforma: un'agenzia non vede né devia le email di sicurezza dei propri membri. `isConfigured(agenzia)` è vero se esiste l'una o l'altra.

### Scelte di sicurezza dell'adattatore
- **Solo TLS**: porta 465 con TLS implicito, oppure 587 o 2525 con STARTTLS obbligatorio (`requireTLS`). `ignoreTLS` e `opportunisticTLS` sono spenti, `rejectUnauthorized` è sempre vero e la versione minima è TLS 1.2. Nessuna sessione in chiaro. Le porte ammesse sono solo 465, 587 e 2525.
- **Contro l'SSRF**:
  - l'host deve essere un nome DNS: niente indirizzi IP scritti a mano, niente porta nel nome;
  - il nome si risolve una volta, con timeout di 5 secondi;
  - si rifiuta se anche uno solo degli indirizzi non è pubblico: loopback, reti private, CGNAT (comprese le reti Tailscale), link-local (metadati del cloud), multicast, riservati e documentazione. In IPv6 sono ammessi solo gli indirizzi globali (`2000::/3`), meno 6to4, Teredo, NAT64, documentazione e benchmark;
  - ci si collega all'indirizzo verificato, con `servername` uguale al nome per SNI e certificato: un secondo DNS non può cambiare la destinazione.
- **Timeout** brevi: 10 s per la connessione, 10 s per il saluto, 30 s di silenzio. Una connessione per invio, chiusa subito: nessun pool.
- **Intestazioni**: mittente e destinatario devono essere un singolo indirizzo semplice (niente nome visualizzato, virgole o a capo); l'oggetto è già su una riga e un a capo viene rifiutato. Busta SMTP esplicita. Accesso a file e URL di `nodemailer` disattivato.
- **Errori**: classificati (`invalid_config`, `blocked_destination`, `dns`, `timeout`, `tls`, `auth`, `connection`, `rejected`). Contengono al massimo la risposta del server su una riga, tagliata a 200 caratteri, con utente e password tolti. I log di `nodemailer` sono spenti, perché conterrebbero lo scambio AUTH.
- **Test**: l'unica eccezione ai controlli è un'opzione `testing.fakeServer` (porta del server finto su 127.0.0.1 e CA autofirmata). Solo i test la passano a `createSmtpSender`. Non si legge da variabili d'ambiente né dalla configurazione: `createRuntime` non la conosce.

## Alternative scartate
- **SMTP scritto a mano** (`node:tls` più i comandi): poche centinaia di righe, ma STARTTLS, AUTH, codifica MIME, linee lunghe e risposte su più righe sono il punto dove nascono i difetti di sicurezza. `nodemailer` li ha già risolti e verificati.
- **API HTTP di un singolo fornitore** (Brevo, Resend, Postmark…): lega ogni agenzia a quel fornitore, mentre la specifica chiede Gmail, Brevo e SMTP generico. Brevo e Gmail parlano comunque SMTP. Un'API si può aggiungere più avanti come altro `kind`.
- **`smtp-server` come dipendenza di runtime**: serve solo ai test, quindi resta fra le devDependency e non entra nell'immagine.
- **Nessun server finto, solo un trasporto simulato**: non proverebbe TLS, STARTTLS, certificato, timeout e autenticazione, cioè proprio le difese.

## Conseguenze
- In produzione nessuna email parte finché la piattaforma o l'agenzia non hanno impostazioni SMTP. La parte 2 porta le rotte del pannello (Owner), il comando `cli` per il valore predefinito della piattaforma e l'email di prova, che imposta `verified_at`.
- Il mailer legge le impostazioni a ogni invio: un cambio nel pannello vale dall'email successiva, senza riavvio. Il costo è una o due letture e una decifratura per email.
- `IntegrationStore` apre da sé le sue transazioni. Così il registro attività di una modifica (ADR 007) non sta nella stessa transazione del cambio: lo scrive il caso d'uso della parte 2, subito dopo.
- Gli ultimi 4 caratteri di una password corta ne rivelano una parte importante (ADR 007 li prevede): da riconsiderare nella parte 2, insieme all'interfaccia.
- Da tenere d'occhio: gli avvisi di sicurezza di `nodemailer`; un fornitore che chieda la porta 25 o TLS senza verifica (non è supportato, per scelta); un server SMTP raggiungibile solo in rete privata (rifiutato, per scelta).
- Si riapre se serve OAuth2 (Gmail senza password per app) o un fornitore solo via API.
