# Configurare l'email di sistema

Feedway manda inviti, avvisi di sicurezza e link di recupero con **un solo SMTP, quello della piattaforma** ([ADR 017](../adr/017-invio-email-via-smtp.md)). Lo imposta solo l'amministratore della piattaforma. Le agenzie non configurano nulla. Finché non è impostato, in produzione **nessuna email parte**.

Serve un fornitore SMTP con TLS: porta 465 (TLS dal primo byte), 587 o 2525 (STARTTLS obbligatorio). La porta 25 e i server senza un certificato valido sono rifiutati.

## Dalla riga di comando

Dalla cartella dell'installazione (`/opt/feedway`):

```bash
# impostare o cambiare; la password si scrive al prompt, senza eco
docker compose run --rm worker cli mail-settings set \
  --host smtp.fornitore.example --port 587 \
  --username utente@fornitore.example --from avvisi@tuodominio.example

# vedere le impostazioni (la password compare solo come "impostata")
docker compose run --rm worker cli mail-settings show

# mandare un'email di prova
docker compose run --rm worker cli mail-settings test tua-email@esempio.it
```

- **La password si legge solo da stdin**, mai da un'opzione o da una variabile d'ambiente: finirebbe nella cronologia della shell e in `ps`. Un'opzione come `--password` viene rifiutata.
- Per cambiare host, porta, utente o mittente senza toccare la password, premi Invio al prompt: resta quella salvata.
- `--security tls|starttls` serve solo con la porta 2525. Senza: TLS sulla 465, STARTTLS sulla 587 e sulla 2525.
- Da uno script, con la password in un file leggibile solo da te: `docker compose run --rm -T worker cli mail-settings set … < file-password`. Cancella il file subito dopo.

Ogni modifica azzera la verifica: rimanda la prova.

## Dal pannello

Le rotte `GET` e `PUT /api/v1/platform/mail-settings` e `POST /api/v1/platform/mail-settings/test` esistono solo per l'amministratore della piattaforma. Salvare e mandare la prova chiedono di confermare la password se l’ultima conferma ha più di 10 minuti. Le prove sono al massimo 5 ogni 10 minuti per amministratore. La pagina «Email di sistema» arriva con le schermate del pannello.

## Se la prova non riesce

La prova risponde con un motivo e, quando il server ha risposto, con la sua risposta ripulita da credenziali e indirizzi.

| Motivo | Cosa controllare |
|---|---|
| non impostata | Manca la configurazione: `mail-settings set`. |
| impostazioni non utilizzabili | Host, mittente o destinatario scritti male. |
| indirizzo interno o riservato | L'host porta a un indirizzo privato o della macchina: non ci colleghiamo, per scelta. |
| nome non risolto | Il nome dell'host è sbagliato, oppure il DNS della VPS non risponde. |
| nessuna risposta in tempo | Porta sbagliata, oppure il fornitore o un firewall blocca la connessione in uscita. |
| TLS o certificato | Il server non offre TLS sulla porta scelta, o il certificato non corrisponde all'host. Prova l'altra porta. |
| utente o password rifiutati | Credenziali sbagliate o scadute: rimettile con `mail-settings set`. |
| messaggio rifiutato | Il fornitore non accetta quel mittente: di solito va verificato il dominio presso il fornitore (SPF, DKIM). |

Il registro attività conserva ogni modifica (solo i nomi dei campi cambiati) e ogni prova (riuscita o no, e il motivo). Mai la password.

## Filtro dei collegamenti in uscita (da fare al deploy)

Il controllo degli indirizzi rifiuta reti private, loopback e indirizzi riservati, ma **non può riconoscere l'IP pubblico della VPS stessa** (rischio residuo di ADR 017). Se la VPS espone qualcosa sulle porte 465, 587 o 2525, un host che punta a quell'IP raggiungerebbe quel servizio.

Sulla VPS, i container devono poter uscire solo verso internet, mai verso l'IP pubblico della VPS né verso la rete Docker. Per esempio, con `iptables` sulla catena `DOCKER-USER`:

```bash
# sostituisci 203.0.113.10 con l'IP pubblico della VPS
iptables -I DOCKER-USER -d 203.0.113.10 -p tcp -m multiport --dports 465,587,2525 -j REJECT
```

Rendi la regola permanente con il sistema della tua distribuzione (`iptables-persistent`, `nftables`). Non verificato su una VPS vera: provalo con la prima installazione.
