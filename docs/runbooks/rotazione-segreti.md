# Cambiare i segreti dell'installazione

Questo runbook dice cosa fare con ogni segreto di `secrets/` quando è stato esposto (un log incollato in chat, una copia della VPS finita in mano sbagliata, una persona che lo conosceva e se ne va). I token e l'App Secret di Meta hanno il loro runbook: [rotazione dei token Meta](rotazione-token-meta.md). Se sospetti una violazione di dati personali, parti da [violazione dei dati](violazione-dati.md) e torna qui per il punto «Cambia i segreti esposti».

I comandi vanno lanciati come `root` (o con `sudo`) da `/opt/feedway`. Il segreto nuovo nasce sulla VPS e finisce solo nel suo file: **mai in chat, in un ticket o in un messaggio**, nemmeno per pochi minuti.

## In breve

| Segreto | Cosa protegge | Si può cambiare oggi? | Cosa succede |
|---|---|---|---|
| `db_runtime_password`, `database_url` | La connessione di web e worker al database | Sì | Riavvio di web e worker (pochi secondi) |
| `db_migrator_password`, `database_migrator_url` | Le migrazioni | Sì | Niente: si usa al prossimo aggiornamento |
| `postgres_password` | L'amministratore del database | Sì | Niente |
| `better_auth_secret` | La firma dei cookie e la cifratura della 2FA | Solo in emergenza | Tutti escono, e chi ha l'app di autenticazione deve rifare la 2FA (D-35) |
| `app_encryption_key` | Token Meta, App Secret delle agenzie, password SMTP | **No**, senza perdere quei dati | Vanno ricollegati gli account Meta e rifatte le impostazioni email (D-35) |
| `ts_authkey`, `ts_public_authkey` | L'ingresso dei nodi nella rete Tailscale | Sì, dalla console di Tailscale | Niente: servono solo alla prima registrazione |

## Password del database

Le tre password si cambiano allo stesso modo: prima nel database, poi nel file. Esempio per `app_runtime`, la connessione di web e worker:

```bash
cd /opt/feedway
new="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
printf "ALTER ROLE app_runtime PASSWORD :'pw';\n" |
  ./scripts/compose.sh exec -T postgres psql -U postgres -d app -v ON_ERROR_STOP=1 -v pw="$new"
printf '%s' "$new" >secrets/db_runtime_password
printf '%s' "postgres://app_runtime:$new@postgres:5432/app" >secrets/database_url
unset new
./scripts/compose.sh up -d --force-recreate --wait web worker
```

- **Migrazioni:** stesso schema con `app_migrator`, `secrets/db_migrator_password` e `secrets/database_migrator_url` (`postgres://app_migrator:…@postgres:5432/app`). Non serve riavviare nulla.
- **Amministratore:** `ALTER ROLE postgres PASSWORD :'pw'` e il file `secrets/postgres_password`. Postgres lo legge solo alla prima installazione, quindi non serve riavviare nulla.

`>` riscrive il file esistente e ne tiene proprietario e permessi: controlla con `ls -l secrets/` che siano ancora quelli di prima (`600`; utente `70` per le password, `10001` per gli URL). Se web non riparte, `./scripts/compose.sh logs --tail 50 web` dice se la password non corrisponde: ripeti i due passi con lo stesso valore.

## Segreto di Better Auth (`better_auth_secret`)

Firma i cookie di sessione e cifra il segreto della 2FA e i codici di recupero. Da solo non basta per entrare: le sessioni sono anche nel database.

- **Se è uscito solo il file**, senza una copia del database: il rischio è basso. Chiudi tutte le sessioni, così i cookie firmati prima non servono più:

  ```bash
  printf 'delete from sessions;\n' | ./scripts/compose.sh exec -T postgres psql -U postgres -d app
  ```

  Tutti devono rifare l'accesso. Il segreto vero e proprio si cambia quando l'installazione saprà passarlo insieme a quello vecchio (D-35).
- **Se sono usciti il file e il database insieme:** con i due insieme si legge la 2FA. Cambia il segreto come per `app_encryption_key` qui sotto (nuovo valore con `openssl rand -base64 32 | tr -d '\n'`, poi riavvio di web), chiudi le sessioni come sopra e chiedi a chi usa l'app di autenticazione di rifare la 2FA. Chi ha una passkey entra con quella; chi non può più entrare si recupera con `fw recover-user` dopo aver verificato chi è ([primo accesso e nuova agenzia](primo-accesso-e-nuova-agenzia.md)).

## Chiave di cifratura dei dati (`app_encryption_key`)

Cifra le chiavi delle agenzie, e con quelle i token Meta, gli App Secret e la password SMTP delle email di sistema. Oggi l'installazione conosce **una sola** chiave: se la cambi, quei dati non si leggono più.

Se la chiave è uscita **insieme a una copia del database**, chi le ha può leggere i token. In quel caso:

1. Revoca subito i token e gli App Secret su Meta ([rotazione dei token Meta](rotazione-token-meta.md), «Se il token è stato esposto»), e cambia la password SMTP dal tuo fornitore di email. Così i valori rubati non servono più, anche senza cambiare la chiave.
2. Se vuoi cambiare anche la chiave: nuovo valore in `secrets/app_encryption_key` (`openssl rand -base64 32 | tr -d '\n'`), `./scripts/compose.sh up -d --force-recreate --wait web worker`, poi ricollega gli account Meta e rifai le [email di sistema](email-di-sistema.md). Le agenzie create prima restano, ma i loro collegamenti vanno rifatti.

Se è uscita solo la chiave, senza il database, non serve cambiarla: da sola non apre nulla.

Cambiarla senza perdere i dati richiede che l'installazione ne conosca due insieme: è la decisione aperta D-35, prevista nella tappa 11.

## Chiavi di Tailscale

`ts_authkey` e `ts_public_authkey` servono solo quando un nodo entra nella rete per la prima volta: dopo, il nodo usa la sua identità salvata nei volumi `tailscale-state`. Se una è uscita, revocala in [login.tailscale.com](https://login.tailscale.com/admin/settings/keys) (Settings → Keys) e metti nel file una chiave nuova solo se dovrai registrare di nuovo il nodo.

Se è uscita la VPS intera, togli i nodi dalla rete (Machines → … → Remove) e registrali di nuovo con chiavi nuove: vedi [violazione dei dati](violazione-dati.md).

## Dopo

- Annota quale segreto hai cambiato e quando, nel registro delle violazioni se c'era una violazione.
- Se avevi una copia di `secrets/` fuori dalla VPS, aggiornala.
