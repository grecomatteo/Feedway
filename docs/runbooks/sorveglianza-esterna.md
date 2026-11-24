# Sorveglianza esterna con healthchecks.io

Feedway si controlla da solo in due modi (specifica §16.7):

1. **Il worker batte** ogni 30 secondi nella tabella `system_heartbeats`. Se nessun worker batte per 2 minuti, il **web** manda all'amministratore della piattaforma «Il worker è fermo» per email e con il bot Telegram della piattaforma, e «Il worker è ripartito» quando torna. Non serve configurare niente: bastano l'email di sistema ([email-di-sistema.md](email-di-sistema.md)) e, per Telegram, il bot della piattaforma (guida in `docs/runbooks/telegram.md`).
2. **La sorveglianza esterna** copre il caso che il primo non vede: se si ferma tutta la VPS (corrente, rete, Docker), nessuno manda niente. Per questo un worker chiama ogni minuto un indirizzo di [healthchecks.io](https://healthchecks.io) (o di Uptime Kuma su un altro server): quando le chiamate smettono, è healthchecks.io ad avvisarti.

Questa guida è per il secondo. Il piano gratuito di healthchecks.io basta (20 controlli).

## 1. Creare il controllo su healthchecks.io

1. Registrati su healthchecks.io e apri il tuo progetto.
2. **Add Check**. Nome: `Feedway VPS`.
3. **Schedule**: scegli **Simple**, **Period** `1 minute`, **Grace Time** `3 minutes`. Feedway chiama ogni minuto; con 3 minuti di tolleranza un riavvio del worker (aggiornamento) non fa scattare l'allarme.
4. Salva. Copia l'indirizzo **Ping URL**, del tipo `https://hc-ping.com/1b2c3d4e-…`.

L'indirizzo è un **segreto**: chi lo conosce può dire a healthchecks.io che la VPS è viva. Non incollarlo in chat, in un ticket o in un file del repository; incollalo solo nel pannello.

## 2. Scegliere dove ricevere l'avviso

Su healthchecks.io, **Integrations**:

- **Email**: c'è già quella dell'account. Basta che sia attiva sul controllo.
- **Telegram**: **Add Integration** → Telegram, poi segui il link al bot `@HealthchecksBot` e premi **Start**. Questo è il bot di healthchecks.io, non quello di Feedway: funziona anche quando la VPS è spenta.

Apri il controllo e, in **Notification Methods**, accendi quelli che vuoi.

## 3. Incollare l'indirizzo in Feedway

1. Entra nel pannello come amministratore della piattaforma e apri **Piattaforma → Integrazioni**.
2. Nella sezione **Sorveglianza esterna** incolla il Ping URL nel campo **Indirizzo** e premi **Salva** (il pannello chiede la password se l'ultima conferma ha più di 10 minuti).
3. Premi **Prova**. La riga sotto dice l'esito: «Riuscita» con l'ora, o il motivo («Tempo scaduto», «Rete non raggiungibile», «Il servizio ha risposto 404»).
4. Su healthchecks.io il controllo diventa verde (**up**) entro un minuto.

L'indirizzo deve iniziare con `https://` e non può contenere nome utente e password. Dopo il salvataggio il pannello non lo mostra più: dice solo che è impostato. Per cambiarlo, incolla quello nuovo e salva.

## 4. Provare l'allarme

Da fare una volta, dopo il primo collegamento (è anche nella guida della prova della 0.14.0):

```bash
cd /opt/feedway
# ferma web e worker, come se la VPS fosse spenta
docker compose stop web worker
```

Dopo il periodo più la tolleranza (circa 4 minuti) healthchecks.io manda «Feedway VPS is DOWN» per email e su Telegram. Poi:

```bash
docker compose start web worker
```

Entro un minuto arriva «Feedway VPS is UP».

Per provare il **primo** controllo (quello del web), ferma solo il worker:

```bash
docker compose stop worker
# dopo 2-3 minuti: email e Telegram «Il worker è fermo»
docker compose start worker
# entro un minuto: «Il worker è ripartito»
```

Con solo il worker fermo anche healthchecks.io avvisa, dopo circa 4 minuti, perché è il worker a chiamarlo.

## Se qualcosa non va

| Cosa vedi | Cosa controllare |
|---|---|
| «Tempo scaduto» o «Rete non raggiungibile» | La VPS esce su internet? `docker compose exec worker node -e "fetch('https://hc-ping.com').then(r=>console.log(r.status))"` deve stampare un numero. |
| «Il servizio ha risposto 404» | L'indirizzo è sbagliato o il controllo è stato cancellato: copialo di nuovo da healthchecks.io. |
| healthchecks.io resta **new** o **down** con la prova riuscita | Sono due controlli diversi: confronta l'indirizzo del controllo con quello incollato. |
| Nessuna email «Il worker è fermo» | L'email di sistema è impostata e la prova riesce? Il web esce su internet (rete `egress` in `docker/compose.yml`)? Nel log del web cerca `worker watch`. |

Il log di Feedway non contiene mai l'indirizzo: solo l'esito (`external watch failed` con il motivo).
