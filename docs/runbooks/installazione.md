# Installazione e aggiornamento

Come mettere Feedway su una VPS, aggiornarlo e tornare alla versione precedente.

## Prerequisiti

- Una VPS Linux con **Docker 24 o successivo** e **Docker Compose v2** (il comando `docker compose`).
- `openssl` e `age` (su Debian e Ubuntu: `apt install openssl age`).
- Un utente che può usare Docker (gruppo `docker`) o `root`. Per dare i file dei segreti agli utenti dei container serve anche `sudo`, se non sei `root`.
- Un account Tailscale con **HTTPS attivo** nella rete (impostazioni DNS di Tailscale) e una chiave di autenticazione riutilizzabile.

## Installazione

```bash
git clone https://github.com/grecomatteo/Feedway /opt/feedway
cd /opt/feedway
./scripts/install.sh
```

Le domande sono tre: il nome host Tailscale (di solito `pannello`), la chiave di autenticazione Tailscale (non viene mostrata) e l'email dell'Owner. Alla fine lo script stampa l'indirizzo del pannello, del tipo `https://pannello.<rete>.ts.net`, raggiungibile solo dai dispositivi della tua rete Tailscale.

Lo script mostra **una sola volta** la chiave privata dei backup. Salvala subito nel gestore di password: senza di lei i backup non si possono aprire. Non viene scritta da nessuna parte sul server.

Si può rilanciare senza rischi: i segreti e le chiavi che esistono già non vengono mai riscritti.

## Dove sono i segreti

- `secrets/` (permessi `700`, file `600`): password di Postgres, URL del database, chiave di cifratura dei dati, chiave di Tailscale. **Non vanno persi né pubblicati.** Se perdi `app_encryption_key`, i dati cifrati nel database (per esempio i token) non si possono più leggere.
- `.env`: solo impostazioni senza segreti (immagine, versione, indirizzo del pannello, email dell'Owner, chiave pubblica dei backup).
- Fai una copia di `secrets/` in un posto sicuro fuori dalla VPS.

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

Attenzione: il ritorno indietro cambia il programma, non il database. Le migrazioni di una release sono scritte per restare compatibili con la versione precedente.

## Se qualcosa non va

- `docker compose --project-directory . -f docker/compose.yml ps` mostra lo stato dei servizi.
- `docker compose --project-directory . -f docker/compose.yml logs --tail 100 web worker migrate` mostra i log.
- "Tailscale non ha un nome DNS": controlla che la chiave sia valida e che HTTPS sia attivo nella rete Tailscale.
