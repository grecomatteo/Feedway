# Cambiare i segreti dell'installazione

Questo runbook dice cosa fare con ogni segreto di `secrets/` quando è stato esposto (un log incollato in chat, una copia della VPS finita in mano sbagliata, una persona che lo conosceva e se ne va). I token e l'App Secret di Meta hanno il loro runbook: [rotazione dei token Meta](rotazione-token-meta.md). Se sospetti una violazione di dati personali, parti da [violazione dei dati](violazione-dati.md) e torna qui per il punto «Cambia i segreti esposti».

I comandi vanno lanciati da una shell di root (`sudo -i`), da `/opt/feedway`: i file di `secrets/` appartengono agli utenti dei container e un semplice `sudo` davanti al comando non basta per le redirezioni `>`. Il segreto nuovo nasce sulla VPS e finisce solo nel suo file: **mai in chat, in un ticket o in un messaggio**, nemmeno per pochi minuti.

## In breve

| Segreto | Cosa protegge | Si può cambiare oggi? | Cosa succede |
|---|---|---|---|
| `db_runtime_password`, `database_url` | La connessione di web e worker al database | Sì | Riavvio di web e worker (pochi secondi) |
| `db_migrator_password`, `database_migrator_url` | Le migrazioni | Sì | Niente: si usa al prossimo aggiornamento |
| `postgres_password` | L'amministratore del database | Sì | Niente |
| `better_auth_secret` | La firma dei cookie e la cifratura della 2FA | Solo in emergenza | Tutti escono; chi usa l'app di autenticazione e non ha una passkey va recuperato con `fw recover-user` (D-35) |
| `app_encryption_key` | Token Meta, App Secret delle agenzie, password SMTP; firma dei link «Non sono stato io»; impronte di dispositivi e indirizzi | **No**, senza perdere quei dati | Vanno ricollegati gli account Meta e rifatte le impostazioni email; i link «Non sono stato io» già inviati smettono di valere; al prossimo accesso tutti ricevono l'email «nuovo dispositivo» (D-35) |
| `ts_authkey`, `ts_public_authkey` | L'ingresso dei nodi nella rete Tailscale | Sì, dalla console di Tailscale | Niente: servono solo alla prima registrazione |

## Password del database

Le tre password si cambiano allo stesso modo: prima nel file, poi nel database. Esempio per `app_runtime`, la connessione di web e worker:

```bash
sudo -i
cd /opt/feedway
umask 077
new="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
printf '%s' "$new" >secrets/db_runtime_password
printf '%s' "postgres://app_runtime:$new@postgres:5432/app" >secrets/database_url
# la password entra dallo standard input, mai sulla riga di comando dove `ps` la mostrerebbe
{ printf '\\set pw %s\n' "$new"; printf '%s\n' "ALTER ROLE app_runtime PASSWORD :'pw';"; } |
  ./scripts/compose.sh exec -T postgres psql -U postgres -d app -q -v ON_ERROR_STOP=1
unset new
./scripts/compose.sh up -d --force-recreate --wait web worker
```

Provato su Postgres 18 il 17/11/2026: il ruolo entra con la password nuova.

- **Migrazioni:** stesso schema con `app_migrator`, `secrets/db_migrator_password` e `secrets/database_migrator_url` (`postgres://app_migrator:…@postgres:5432/app`). Non serve riavviare nulla.
- **Amministratore:** `ALTER ROLE postgres PASSWORD :'pw'` e il file `secrets/postgres_password`. Postgres lo legge solo alla prima installazione, quindi non serve riavviare nulla.

`>` riscrive il file esistente e ne tiene proprietario e permessi: controlla con `ls -l secrets/` che siano ancora quelli di prima (`600`; utente `70` per le password, `10001` per gli URL). Se web non riparte, `./scripts/compose.sh logs --tail 50 web` dice se la password non corrisponde: rifai l'`ALTER ROLE` leggendo il valore dal file (`new="$(cat secrets/db_runtime_password)"`).

Postgres riceve la password in chiaro nell'`ALTER ROLE`: finisce nel suo log solo se il comando fallisce o se `log_statement` è `ddl` o `all` (non lo è, salvo modifiche tue).

## Segreto di Better Auth (`better_auth_secret`)

Firma i cookie di sessione e cifra il segreto della 2FA e i codici di recupero. Da solo non basta per entrare: le sessioni sono anche nel database.

- **Se è uscito solo il file**, senza una copia del database: il rischio è basso. Chiudi tutte le sessioni e i link in sospeso, così i cookie firmati prima non servono più:

  ```bash
  printf 'delete from sessions;\ndelete from verifications;\n' |
    ./scripts/compose.sh exec -T postgres psql -U postgres -d app
  ```

  `verifications` tiene i link di reimpostazione della password e le verifiche 2FA in corso: con una copia del database basterebbero per cambiare una password, quindi vanno cancellati anche quando è uscito solo il database.

  Tutti devono rifare l'accesso. Il segreto vero e proprio si cambia quando l'installazione saprà passarlo insieme a quello vecchio (D-35).
- **Se sono usciti il file e il database insieme:** con i due insieme si legge la 2FA. Cambia il segreto come per `app_encryption_key` qui sotto (nuovo valore con `openssl rand -base64 32 | tr -d '\n'`, poi riavvio di web), chiudi sessioni e link come sopra. Il segreto della 2FA e i codici di recupero erano cifrati con il segreto vecchio: chi usa l'app di autenticazione e non ha una passkey non riesce più a entrare da solo. Va recuperato con `fw recover-user` dopo aver verificato chi è ([primo accesso e nuova agenzia](primo-accesso-e-nuova-agenzia.md)); chi ha una passkey entra con quella e poi rifà la 2FA. **Non verificato:** che messaggio dà Better Auth a chi prova un codice con il segreto cambiato.
- Finché il segreto resta lo stesso, chi ottiene in futuro una copia del database insieme al file legge la 2FA: tieni il file fuori dai backup del database, o cifrati con una chiave diversa.

## Chiave di cifratura dei dati (`app_encryption_key`)

Cifra le chiavi delle agenzie, e con quelle i token Meta, gli App Secret e la password SMTP delle email di sistema. Da lei derivano anche la firma dei link «Non sono stato io» delle email di sicurezza e le impronte di dispositivi e indirizzi. Oggi l'installazione conosce **una sola** chiave: se la cambi, quei dati non si leggono più, i link «Non sono stato io» già inviati smettono di valere e al prossimo accesso tutti ricevono l'email «nuovo dispositivo».

Se la chiave è uscita **insieme a una copia del database**, chi le ha può leggere i token. In quel caso:

1. Revoca subito i token e gli App Secret su Meta ([rotazione dei token Meta](rotazione-token-meta.md), «Se il token è stato esposto»), e cambia la password SMTP dal tuo fornitore di email. Così i valori rubati non servono più, anche senza cambiare la chiave.
2. Se vuoi cambiare anche la chiave: nuovo valore in `secrets/app_encryption_key` (`openssl rand -base64 32 | tr -d '\n'`), `./scripts/compose.sh up -d --force-recreate --wait web worker`, poi ricollega gli account Meta e rifai le [email di sistema](email-di-sistema.md). Le agenzie create prima restano, ma i loro collegamenti vanno rifatti.

Se è uscita solo la chiave, senza il database, i dati cifrati restano chiusi, ma chi la ha può:

- firmare un link «Non sono stato io» per una persona di cui conosce l'id e **bloccarle l'account** (si sblocca con `fw enable-user`);
- risalire, provando, agli indirizzi IP e alle email dietro le impronte dei limiti di frequenza e dei dispositivi.

Controlla nel registro le voci `auth.security_lock` che nessuno ha chiesto ([violazione dei dati](violazione-dati.md)). Cambiare la chiave chiude questi rischi ma costa i collegamenti Meta: decidi in base a quanto è probabile che venga usata.

Cambiarla senza perdere i dati richiede che l'installazione ne conosca due insieme: è la decisione aperta D-35, prevista nella tappa 11.

## Chiavi di Tailscale

`ts_authkey` e `ts_public_authkey` servono solo quando un nodo entra nella rete per la prima volta: dopo, il nodo usa la sua identità salvata nei volumi `tailscale-state` e `tailscale-public-state`. Se una è uscita, revocala in [login.tailscale.com](https://login.tailscale.com/admin/settings/keys) (Settings → Keys) e metti nel file una chiave nuova solo se dovrai registrare di nuovo il nodo.

Se è uscita la VPS intera, togli i nodi dalla rete (Machines → … → Remove) e registrali di nuovo con chiavi nuove: vedi [violazione dei dati](violazione-dati.md).

## Dopo

- Annota quale segreto hai cambiato e quando, nel registro delle violazioni se c'era una violazione.
- Se avevi una copia di `secrets/` fuori dalla VPS, aggiornala.
