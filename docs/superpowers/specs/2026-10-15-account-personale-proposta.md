# Account personale, accesso e privacy · Proposta

| | |
|---|---|
| **Stato** | Approvata da Matteo il 2026-10-15 e integrata nella specifica v9 (§6.3, §7.4, §10.5, §12.2, §13, §14.4, §15, §16.2, §16.4). Resta come documento di motivazione; in caso di differenze vale la specifica |
| **Data** | 2026-10-15 |
| **Richiesta di Matteo** | Ogni persona ha il proprio account: registrazione, login "fatto da senior", foto profilo, soprannome; tutto conforme al GDPR, nel database e nel pannello. Opzioni migliori anche per rapporto qualità-prezzo |

---

## 1. Cosa c'è già nel progetto e cosa manca

**Già previsto (specifica v8, tappa 2):** identità unica per email, password argon2id, 2FA con app e codici di recupero, sessioni nel database revocabili, limitazione dei tentativi, inviti con link monouso, riconferma per le azioni delicate, registro attività, esportazione e anonimizzazione dei dati.

**Manca:**
- accesso con **passkey** (impronta, Face ID, chiave di sicurezza);
- **foto profilo** e **soprannome**;
- **cambio email** con verifica;
- **email di sicurezza** (nuovo accesso, password o 2FA cambiate);
- una **sezione privacy** completa: cosa si conserva, per quanto, chi lo vede, come si cancella;
- **backup cifrati** (oggi sono facoltativi, ma su Google Drive finiscono dati personali).

## 2. Scelta: Better Auth

**Deciso da Matteo il 15 ottobre 2026**, fra tre opzioni: login scritto nel progetto, Better Auth, servizio esterno (Clerk o WorkOS). Better Auth è una libreria open source in TypeScript: gira dentro il pannello, sul tuo Postgres, a costo zero. Fornisce già pronti login, sessioni, 2FA, passkey, limitazione dei tentativi e cambio email, e domani "Accedi con Google".

### 2.1 Divisione dei compiti

| Better Auth gestisce | Il nostro codice gestisce |
|---|---|
| Account (email, password), sessioni e cookie | Organizzazioni, membri, ruoli Owner/Admin/Member, spazi e ruoli per spazio, `can()` |
| 2FA con app e codici di recupero, passkey | Regola "2FA obbligatoria" per ruolo e per agenzia (§15.1) |
| Reset della password, cambio email con verifica | Inviti, che portano agenzia, ruolo e spazi; attivazione dell'account dall'invito |
| Limitazione dei tentativi (salvata nel database) | Amministratore della piattaforma, sospensioni, limiti, comandi `cli` |
| Elenco e revoca delle sessioni | Riconferma per le azioni delicate, registro attività, RLS, privacy (esportazione, anonimizzazione) |

**Non usiamo** il plugin "organization" di Better Auth: ha un modello di organizzazioni e ruoli suo, senza spazi di lavoro né RLS. Duplicherebbe il nostro e lo indebolirebbe. Non usiamo nemmeno i plugin `admin` (impersonificazione di utenti), `oidcProvider` e `mcp`: proprio questi ultimi avevano la vulnerabilità critica di agosto 2026. Il server MCP della 1.4 valuterà a suo tempo `@better-auth/oauth-provider`.

Le tabelle di Better Auth contengono solo dati personali globali, non dati di un'agenzia: stanno fuori dalla RLS per organizzazione, come già `users` e `sessions` nella specifica v8. L'isolamento tra agenzie resta intatto.

### 2.2 Configurazione

| Punto | Scelta | Perché |
|---|---|---|
| Collegamento a Nuxt | Rotta `server/api/auth/[...all].ts` con `better-auth/vue`, come da documentazione ufficiale | Il modulo Nuxt della comunità è ancora in alpha |
| Database | Adattatore Drizzle; schema generato con la CLI di Better Auth e migrato con le nostre migrazioni; tabelle al plurale (`users`, `sessions`, `accounts`, `verifications`, `two_factors`, `passkeys`) | Una sola storia di migrazioni |
| ID | `generateId` → UUID v7 dalla nostra porta `IdGenerator` | Uguale al resto del database |
| Password | Hash argon2id con `@node-rs/argon2` (opzione `password.hash/verify`), minimo 12 caratteri, elenco delle password comuni | Come già in §15.1 |
| Registrazione pubblica | Percorso `/sign-up/email` disattivato (`disabledPaths`); gli account nascono solo dall'attivazione di un invito, lato server | Nessuna pagina "registrati" nella 1.0 |
| Sessioni | Nel database; `cookieCache` **spento**, così una revoca vale subito; scadenza per inattività 12 ore e assoluta 30 giorni (controllo nostro su `createdAt`) | Come §15.2 |
| Cookie | `Secure`, `HttpOnly`, `SameSite=Lax`, solo sull'host del pannello, mai sull'host pubblico | Come §15.2 e §16.1 |
| Limitazione dei tentativi | `storage: "database"` con regole più strette su accesso, 2FA e reset; IP letto dall'intestazione impostata dal nostro proxy (`trustedProxies`) | Funziona con più copie del web (§6.4) |
| Segreto | `BETTER_AUTH_SECRET` generato da `install.sh` come file segreto; rotazione con `BETTER_AUTH_SECRETS` | Nessun valore di default |
| Passkey | `@better-auth/passkey` con verifica dell'utente obbligatoria (impronta o PIN); `rpID` = host del pannello | Una passkey così vale già come due fattori |
| 2FA | Plugin `twoFactor`: app di autenticazione e codici di recupero; nessun OTP via email (più debole) | |
| Registro attività | Ganci di Better Auth (`hooks`, `databaseHooks`) scrivono nel nostro `audit_log` accessi, fallimenti, cambi di password, email, 2FA e passkey | Tutto tracciato come prima |

### 2.3 Rischi e come li gestiamo

| Rischio | Come lo gestiamo |
|---|---|
| Libreria giovane, con diverse vulnerabilità pubbliche nel 2026 | Versione fissata esatta; Renovate apre subito una PR per ogni avviso di sicurezza; attivi solo i plugin elencati sopra; la batteria di test dei nostri flussi di accesso (unità, integrazione, E2E) deve passare a ogni aggiornamento |
| Cambi di comportamento tra versioni (per esempio il significato di `freshAge` cambiato nella 1.6) | Riconferma e scadenze sono regole nostre, con test propri, non impostazioni della libreria |
| La libreria scrive sul database con la propria connessione, fuori dalle nostre transazioni | L'attivazione da invito è ripetibile: se si interrompe a metà, lo stesso link la completa. Un test lo simula |
| La 2FA non viene chiesta di default dopo l'accesso con passkey | Voluto: la passkey con verifica dell'utente è già a due fattori. Per gli altri metodi passwordless futuri (Google) il nostro controllo chiede la 2FA quando il ruolo la richiede |

### 2.4 Da verificare nel primo task della tappa 2

Sono punti che la documentazione non chiarisce. Si verificano con un test sulla versione fissata prima di scrivere il resto:
1. Se il segreto TOTP e i codici di recupero sono cifrati nel database. Se non lo sono, li cifriamo noi con la chiave della piattaforma prima di salvarli.
2. Se `disabledPaths` blocca anche la creazione di account lato server. Se la blocca, l'attivazione da invito usa l'adattatore interno.
3. Come registrare i tentativi falliti dai ganci (per il registro e per le email di sicurezza).
4. Se il token di sessione è salvato in chiaro (la v8 prevedeva solo l'hash). Se lo è, lo accettiamo come scelta della libreria, ma lo scriviamo nel registro dei rischi: il database e i backup, già cifrati, diventano ancora più delicati.

## 3. Come funzionerà l'accesso

**Registrazione**
- **Nella 1.0 solo su invito**: chi riceve l'invito crea da sé il proprio account (nome, soprannome, password o passkey, foto facoltativa). Il link dell'invito dimostra già che l'email è sua.
- Il pannello non ha una pagina "registrati" aperta a chiunque: per un'agenzia sarebbe solo un bersaglio in più. La **registrazione libera** con verifica dell'email arriva nella 2.0, quando la piattaforma si apre ad altre agenzie. Il flusso di verifica viene scritto ora, perché serve anche al cambio email.

**Metodi di accesso**
1. **Passkey** (consigliata, proposta dopo il primo accesso): niente password da ricordare, immune al phishing. Vale anche come secondo fattore.
2. **Email e password**: argon2id; minimo 12 caratteri; rifiutate le password più comuni con un elenco incluso nell'applicazione, senza servizi esterni.
3. **Secondo fattore**: passkey o app di autenticazione, più 10 codici di recupero. Resta obbligatorio per amministratore della piattaforma, Owner e Admin.
4. **Accedi con Google** (facoltativo, gratuito, attivabile dal pannello con procedura guidata): con Better Auth è un'impostazione, quindi arriva in una versione 1.x senza lavoro sul login.

**Attenzione:** una passkey è legata all'indirizzo del pannello. Se passi da `*.ts.net` a un tuo dominio, ognuno la ricrea in un clic dopo l'accesso con la password. Il pannello lo avvisa prima del cambio.

**Protezioni**
- Limitazione dei tentativi per IP e per account con attesa crescente; messaggi che non rivelano se l'email esiste.
- Sessioni in cookie sicuri. Elenco "dispositivi collegati" con revoca; "esci da tutti i dispositivi".
- Email di sicurezza a ogni nuovo accesso da un dispositivo sconosciuto, cambio di password, email, 2FA o passkey, con il link "Non sono stato io" che blocca l'account e chiude le sessioni.
- Riconferma (password, passkey o 2FA) per le azioni delicate. Per un cambio email serve anche la conferma dal nuovo indirizzo.

## 4. Profilo

| Campo | Regole |
|---|---|
| **Nome e cognome** | Obbligatorio; visibile al team delle stesse agenzie |
| **Soprannome** | Facoltativo, fino a 30 caratteri; se c'è, il pannello lo mostra al posto del nome (assegnazioni, commenti, registro), con il nome completo al passaggio del mouse |
| **Foto profilo** | JPEG, PNG, HEIC o WebP, fino a 5 MB; ritaglio quadrato nel pannello; il server rimuove dati EXIF e GPS e salva due formati WebP (256 e 64 px); senza foto, iniziali su un colore. Visibile solo agli utenti del pannello, **mai** sull'host pubblico né nei link cliente |
| **Email** | Cambio con conferma sul nuovo indirizzo e avviso al vecchio |
| **Lingua, tema, fuso** | Già previsti |
| **Telegram, notifiche, sessioni, passkey, 2FA** | Già previsti |

Il profilo è **unico tra le agenzie**: chi lavora per due agenzie ha un solo nome, una sola foto e un solo soprannome.

## 5. GDPR

| Tema | Scelta |
|---|---|
| **Ruoli** | Nella 1.0 la tua agenzia è titolare dei dati del team. Nella 2.0 la piattaforma diventa responsabile del trattamento per le altre agenzie (servirà un contratto, previsto nel piano 2.0) |
| **Minimizzazione** | Solo i campi della tabella sopra; nessun telefono, data di nascita o indirizzo |
| **Cookie** | Solo cookie tecnici (sessione, protezione CSRF, preferenza del tema): **nessun banner**, basta l'informativa |
| **Informativa** | Pagina "Privacy" nel pannello e nella pagina di accesso, con modello compilabile per agenzia (nome del titolare, contatto) |
| **Accesso e portabilità** | "Scarica i miei dati" nel profilo: file ZIP con JSON leggibile e foto, pronto in pochi secondi |
| **Rettifica** | Profilo modificabile in ogni momento |
| **Cancellazione** | "Elimina il mio account" con riconferma, oppure su richiesta all'amministratore. Foto, passkey, 2FA, sessioni e collegamenti Telegram vengono cancellati subito; nome, email e soprannome sono sostituiti da "Utente rimosso". Lo storico resta attribuibile in forma anonima, perché il registro attività serve a tutela dell'agenzia. Non è possibile se la persona è l'unico Owner di un'agenzia |
| **Conservazione** | Sessioni scadute: 30 giorni. Dispositivi noti: 12 mesi dall'ultimo uso. Indirizzi IP nel registro: abbreviati dopo 90 giorni. Registro attività: 24 mesi, poi riassunto. Account disattivati da più di 24 mesi: anonimizzati automaticamente, con avviso all'Owner 30 giorni prima |
| **Sicurezza** | Segreti 2FA cifrati, password solo come hash, foto senza metadati. **Backup cifrati con `age`, da facoltativi a obbligatori**: la chiave si genera all'installazione e va conservata fuori dalla VPS |
| **Registro dei trattamenti** | Modello già compilato in `docs/privacy/registro-trattamenti.md`, da completare con i dati della tua agenzia |
| **Violazioni** | Procedura in `docs/runbooks/violazione-dati.md`: cosa fare entro 72 ore, con i dati da raccogliere dal registro attività |

## 6. Nel database (aggiunte alla specifica §13)

Tabelle di Better Auth (nomi al plurale, ID UUID v7), che sostituiscono quelle di identità della v8:
```
users              id, name, email (unica), email_verified, image, created_at, updated_at
                   + campi nostri: nickname (max 30), avatar_key, platform_role,
                   status, locale, timezone, theme, last_organization_id, anonymized_at
                   + two_factor_enabled (dal plugin)
sessions           id, user_id, token (unico), expires_at, ip_address, user_agent,
                   created_at, updated_at + reauthenticated_at (nostro)
accounts           id, user_id, provider_id (credential|google), account_id,
                   password (hash argon2id), …
verifications      id, identifier, value, expires_at   (reset, cambio email)
two_factors        id, user_id, secret, backup_codes, verified, failed_verification_count,
                   locked_until
passkeys           id, user_id, name, public_key, credential_id, counter, device_type,
                   backed_up, transports, aaguid, created_at
rate_limits        tabella di Better Auth al posto della nostra
```
Scompaiono dalla v8 `user_recovery_codes`, `login_attempts` e i campi TOTP e di blocco su `users`, perché li gestisce Better Auth. Restano nostre `invites`, `organization_members`, `api_tokens` e il resto.

Tabelle nostre in più:
```
known_devices      user_id, device_hash, first_seen_at, last_seen_at   (per l'email "nuovo accesso")
data_exports       id, user_id, status, storage_key, expires_at        (file cancellato dopo 24 ore)
```
Sono tutti dati personali globali, non di un'organizzazione: niente RLS per agenzia, accessibili solo tramite i casi d'uso dell'utente stesso. Le foto stanno in `Storage` con chiave `users/<id>/avatar/<hash>.webp` e sono servite solo dal pannello, con controllo di sessione.

## 7. In quale tappa

| Cosa | Tappa |
|---|---|
| Better Auth con password, sessioni, 2FA e passkey; soprannome, foto profilo, cambio email, "dispositivi collegati", esportazione e cancellazione del proprio account, informativa e conservazione automatica | **2** (identità). Il piano della tappa 2 va riscritto nei task su schema, chiavi e password, accesso e 2FA. La porta `Storage` con l'implementazione su disco anticipa dalla tappa 4 alla 2, perché serve alla foto |
| Email di sicurezza | **3**, appena esiste la configurazione email del pannello; prima, i link si copiano dal pannello come già previsto |
| Backup cifrati obbligatori | **1** (lo script di installazione genera la chiave) e **11** (prova di ripristino) |
| Accedi con Google | 1.x, se lo vuoi |
| Registrazione libera di nuove agenzie | 2.0 |

## 8. Cosa serve da te, e quando

**Ora: niente da registrare.** Tutto ciò che sopra è gratuito e gira sulla tua VPS.

| Cosa | Quando | Costo | Consiglio |
|---|---|---|---|
| **Dominio** | Quando scegli il nome | ~10–15 €/anno | Comprarlo su Cloudflare (prezzo di costo, già pronto per Cloudflare Tunnel). Serve anche per email affidabili |
| **Servizio email** | Tappa 3 | 0 € all'inizio | **Brevo** (francese, gratuito fino a 300 email al giorno, più che sufficienti per un team) oppure **Scaleway TEM** (francese, 0,25 € ogni 1.000 email). Entrambi tengono i dati in Europa. Gmail con password per app funziona subito ma invia dal tuo indirizzo Gmail: va bene solo per le prove |
| **Google Cloud** (solo se vorrai "Accedi con Google") | Versione 1.x | 0 € | Procedura guidata nel pannello |

Con il dominio, lo stesso nome serve per pannello, host pubblico, mittente delle email e passkey: conviene sceglierlo prima di invitare il team.

## 9. Fonti (consultate il 15 ottobre 2026)

- Better Auth, documentazione: integrazione Nuxt, email e password, sessioni, limitazione dei tentativi, database, 2FA, passkey, opzioni (https://www.better-auth.com/docs)
- Prezzi Clerk: https://clerk.com/articles/clerk-pricing-explained
- Prezzi WorkOS: https://workos.com/pricing
- Better Auth 1.6: https://better-auth.com/blog/1-6
- Vulnerabilità critica Better Auth (CVE-2026-67336): https://cvefeed.io/vuln/detail/CVE-2026-67336
- Modulo Nuxt per Better Auth (alpha): https://skillselion.com/skills/onmax/nuxt-skills/nuxt-better-auth
- Brevo, piano gratuito: https://automationatlas.io/answers/brevo-pricing-explained-2026/
- Scaleway TEM: https://www.scaleway.com/it/transactional-email-tem/
