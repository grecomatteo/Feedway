# Primo accesso e nuova agenzia

Come si crea il primo account dopo l'installazione e come si aggiunge un'altra agenzia. I comandi si lanciano sulla VPS da `/opt/feedway`. Per brevità:

```bash
alias fw=/opt/feedway/scripts/fw.sh
```

`scripts/fw.sh` usa i file compose scritti in `.env` (`COMPOSE_FILE`), anche quelli aggiunti a mano sulla VPS. Da uno script parte senza terminale; dentro un ciclo `while read` aggiungi `< /dev/null`, altrimenti il comando può leggersi le righe del ciclo:

```bash
while read -r slug; do fw suspend-organization "$slug" < /dev/null; done < agenzie.txt
```

## Primo account (amministratore della piattaforma e Owner della prima agenzia)

1. Alla fine di `install.sh` (o di `update.sh`, finché nessuno ha creato il primo account) lo script stampa un link del tipo `https://feedway.<rete>.ts.net/attiva/…`. **Vale un'ora** e si usa una volta sola.
2. Aprilo da un dispositivo della rete Tailscale. Scrivi nome e soprannome, poi scegli password o passkey. Il nome della prima agenzia è quello chiesto da `install.sh` (variabile `BOOTSTRAP_ORGANIZATION_NAME` in `.env`); si cambia poi dalle Impostazioni dell'agenzia.
3. Il pannello chiede subito il secondo passaggio (app di autenticazione o passkey): per Owner e Admin è obbligatorio. Conserva i codici di riserva nel gestore di password.
4. Da «Il mio account» → «Sicurezza» aggiungi una passkey anche dal telefono.
5. In **Impostazioni** dell'agenzia compila **Informativa privacy** (titolare e contatto): la pagina Privacy, anche quella pubblica collegata dall'accesso, li mostra.

Link scaduto o perso:

```bash
fw bootstrap-link
```

Se l'account esiste già, il comando risponde che è già stato creato e non stampa nulla.

## Email di sistema

Senza email configurata il pannello funziona, ma gli avvisi di sicurezza, il reset della password e il cambio d'indirizzo non partono: chi gestisce gli utenti copia i link dal pannello. Per configurarla segui [email di sistema](email-di-sistema.md).

## Nuova agenzia

Solo l'amministratore della piattaforma, da comando:

```bash
fw create-organization --name "Agenzia Rossi" --owner-email titolare@rossi.it
```

- Stampa lo slug dell'agenzia e un **link di attivazione per l'Owner** (vale un'ora): mandalo alla persona per un canale che conosci già.
- Se l'Owner ha già un account, il link non serve: trova la nuova agenzia nel selettore delle agenzie.
- Per **provare che due agenzie non si vedono**, dai alla seconda un Owner con un'**altra email**. Con la stessa email la persona è in tutte e due le agenzie e le vede entrambe: è giusto così, ma non prova l'isolamento.
- I limiti (spazi, account social, utenti, spazio su disco, post al giorno) partono dai valori predefiniti. Per cambiarli: `fw set-limits <slug> --users 10` (o `--unlimited`). Per vederle tutte: `fw list-organizations`.
- I dati delle agenzie non si mescolano mai: lo garantisce il database (RLS) per ogni tabella.

## Sospendere e riattivare

```bash
fw suspend-organization <slug>
fw reactivate-organization <slug>
```

Un'agenzia sospesa resta nel selettore con il motivo, ma non si apre; i dati restano.

## Persone

- Gli inviti si mandano dal pannello (Utenti → Invita). Il link vale 72 ore e si usa una volta sola.
- Account compromesso: `fw disable-user <email>` chiude subito tutte le sessioni. Per riattivarlo, dopo aver verificato l'identità per un canale sicuro: `fw enable-user <email> --verified-by telefono`.
- Una persona non ha più modi per entrare (ha perso l'unica passkey, o un'attivazione è rimasta senza passkey né password): verifica prima l'identità su un canale indipendente (telefonata a un numero già noto, di persona, videochiamata), poi `fw recover-user <email> --verified-by telefono`. Il comando toglie password, passkey, app di autenticazione e sessioni e manda all'indirizzo dell'account un link di 30 minuti per scegliere una nuova password; senza email configurata lo stampa, e va consegnato solo sul canale della verifica. Se il link non arriva o scade, rilancia il comando dopo una nuova verifica: il link precedente smette di valere.
- Richiesta di cancellazione per una persona che non può più accedere: `fw anonymize-user <email>`. Un Owner va prima sostituito (passaggio di proprietà dalla pagina Utenti).
