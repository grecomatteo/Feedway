# Installazione e aggiornamento

Come mettere Feedway su una VPS, aggiornarlo e tornare alla versione precedente.

## Prerequisiti

- Una VPS Linux con **Docker 24 o successivo** e **Docker Compose v2** (il comando `docker compose`).
- `openssl` e `age` (su Debian e Ubuntu: `apt install openssl age`).
- **L'utente `root`**, oppure un utente nel gruppo `docker` con `sudo` senza password: lo script dà i file dei segreti agli utenti dei container con `chown`. Se Docker richiede `sudo`, lancia con `sudo` anche `install.sh` e `update.sh`.
- Un account Tailscale con **HTTPS attivo** nella rete (impostazioni DNS di Tailscale) e una chiave di autenticazione. Una chiave **monouso** basta per l'installazione; se in futuro il volume `tailscale-state` va perso, ne serve una nuova.
- Finché il repository è privato: un modo per leggerlo dalla VPS e un accesso all'immagine (vedi sotto).

## Installazione

Finché il repository e l'immagine sono privati servono due accessi, entrambi in sola lettura:

- **Codice**: una *deploy key* di sola lettura sul repository (Impostazioni → Deploy keys) usata con un alias SSH, oppure un token. Poi `git clone git@<alias>:grecomatteo/Feedway.git /opt/feedway`. Con il repository pubblico basta `git clone https://github.com/grecomatteo/Feedway /opt/feedway`.
- **Immagine**: `docker login ghcr.io -u <utente>` con un token *classic* che ha solo `read:packages`, incollato nel terminale della VPS (mai in chat). Il token resta salvato in `~/.docker/config.json` e serve a ogni aggiornamento: revocalo quando non serve più e creane uno nuovo per il prossimo aggiornamento.

```bash
cd /opt/feedway
git checkout v0.1.1   # o la versione che vuoi installare
./scripts/install.sh
```

Le domande sono tre: il nome host Tailscale (di solito `pannello`), la chiave di autenticazione Tailscale (non viene mostrata) e l'email dell'Owner. Alla fine lo script stampa l'indirizzo del pannello, del tipo `https://pannello.<rete>.ts.net`, raggiungibile solo dai dispositivi della tua rete Tailscale.

Lo script mostra **una sola volta** la chiave privata dei backup. Salvala subito nel gestore di password: senza di lei i backup non si possono aprire. Non viene scritta da nessuna parte sul server.

Si può rilanciare senza rischi: i segreti e le chiavi che esistono già non vengono mai riscritti.

## Dove sono i segreti

- `secrets/` (permessi `700`, file `600`): password di Postgres, URL del database, chiave di cifratura dei dati, chiave di Tailscale. **Non vanno persi né pubblicati.** Se perdi `app_encryption_key`, i dati cifrati nel database (per esempio i token) non si possono più leggere.
- `.env`: solo impostazioni senza segreti (immagine, versione, indirizzo del pannello, email dell'Owner, chiave pubblica dei backup).
- Fai una copia di `secrets/` in un posto sicuro fuori dalla VPS (per esempio nei backup cifrati). È l'unica copia della chiave dei dati: senza di lei non si leggono più. Tieni la chiave privata dei backup separata dal backup stesso.

## Email di sistema e filtro in uscita

Dopo l'installazione imposta l'SMTP della piattaforma: senza, nessuna email parte. Nello stesso momento blocca i collegamenti dai container verso l'IP pubblico della VPS. Entrambe le cose sono in [Configurare l'email di sistema](email-di-sistema.md).

## Aggiornamento

```bash
cd /opt/feedway
./scripts/update.sh            # ultima release
./scripts/update.sh v0.2.0     # una versione precisa
```

Lo script passa alla versione indicata, scarica l'immagine, **esegue prima la migrazione del database** e solo se riesce riavvia web e worker. Se la migrazione fallisce, il pannello in esecuzione non viene toccato. Il repository deve essere pulito (nessuna modifica non salvata).

## Tornare alla versione precedente

```bash
./scripts/update.sh --rollback
```

Torna alla versione registrata prima dell'ultimo aggiornamento (file `.state/previous_tag`). Se l'aggiornamento è fallito, lo script stampa questo comando insieme alle ultime righe dei log.

Subito dopo una installazione nuova non c'è nessuna versione precedente: il comando risponde «Non c'è una versione precedente registrata» ed è corretto. Lo stesso vale se "aggiorni" alla versione già installata. Il ritorno indietro funziona dal primo aggiornamento a una versione diversa. Il ritorno verso una versione senza immagine per l'architettura della VPS (per esempio la `v0.1.0`, pubblicata solo per x64, su una VPS ARM) non può funzionare.

Attenzione: il ritorno indietro cambia il programma, non il database. Le migrazioni di una release sono scritte per restare compatibili con la versione precedente.

## Se qualcosa non va

- `docker compose --project-directory . -f docker/compose.yml ps` mostra lo stato dei servizi.
- `docker compose --project-directory . -f docker/compose.yml logs --tail 100 web worker migrate` mostra i log.
- "Tailscale non ha un nome DNS": controlla che la chiave sia valida e che HTTPS sia attivo nella rete Tailscale.
