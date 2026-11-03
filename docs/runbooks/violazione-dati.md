# Violazione dei dati personali

Cosa fare se sospetti che qualcuno abbia letto, cambiato o cancellato dati personali senza permesso (account rubato, VPS compromessa, backup finito in mano sbagliata, email inviata alla persona sbagliata).

Il GDPR (art. 33) chiede di **avvisare il Garante entro 72 ore** da quando te ne accorgi, salvo che la violazione non presenti rischi per le persone. Se il rischio è alto, vanno avvisate anche le persone coinvolte (art. 34). Le 72 ore contano anche di notte e nel weekend: parti subito.

## Ora 0: contieni

1. **Chiudi l'accesso.**
   - Account rubato: dal pannello della piattaforma, oppure, da `/opt/feedway`, `docker compose --project-directory . -f docker/compose.yml run --rm worker cli disable-user <email>` (chiude tutte le sessioni). La persona stessa può usare «Non sono stato io» dall'email di sicurezza.
   - VPS compromessa: togli il nodo dalla rete Tailscale dalla console di Tailscale; non spegnere la VPS se puoi evitarlo (servono i log).
2. **Cambia i segreti esposti**: password di Postgres, chiave di Tailscale, token Meta (dalla tappa 3). Mai incollarli in chat o in un ticket.
3. **Annota l'ora** in cui te ne sei accorto: da lì partono le 72 ore.

## Prime ore: capisci chi, cosa e quando

Apri una sessione sul database:

```bash
cd /opt/feedway
docker compose --project-directory . -f docker/compose.yml exec postgres psql -U postgres -d app
```

Le query leggono il registro attività (`audit_log`). Sostituisci i valori tra `<>`.

**Cosa ha fatto un account in un periodo**

```sql
select created_at, organization_id, action, entity, entity_id, ip, data
from audit_log
where actor_id = (select id from users where email = '<email>')
  and created_at between '<da>' and '<a>'
order by created_at;
```

**Accessi riusciti e falliti per account o indirizzo IP**

```sql
select created_at, actor_id, action, ip, data
from audit_log
where action in ('auth.login', 'auth.login_failed', 'auth.second_factor_failed', 'auth.new_device')
  and created_at > now() - interval '7 days'
  and (ip = '<ip>' or actor_id = (select id from users where email = '<email>'))
order by created_at;
```

**Chi ha cambiato credenziali o ruoli**

```sql
select created_at, organization_id, actor_id, action, entity_id, data
from audit_log
where (action like 'auth.%' and action not in ('auth.login', 'auth.logout'))
   or action in ('user.role_changed', 'organization.ownership_transferred', 'user.disabled', 'user.enabled')
order by created_at desc
limit 200;
```

**Quali agenzie e quanti account sono coinvolti** (le voci `auth.*` sono personali, senza agenzia: qui contano le azioni fatte dentro un'agenzia)

```sql
select organization_id, count(distinct actor_id) as persone, count(*) as azioni
from audit_log
where created_at between '<da>' and '<a>' and ip = '<ip>' and organization_id is not null
group by organization_id;
```

Gli IP più vecchi di 90 giorni sono abbreviati (ultimo blocco a zero): per periodi più lontani conta solo la rete.

Salva il risultato delle query in un file fuori dalla VPS: è la base della notifica.

## Entro 72 ore: avvisa

1. **Il titolare** (l'agenzia, nella 1.0) decide se notificare. Se il rischio per le persone è improbabile, scrivi nel registro delle violazioni perché non hai notificato.
2. **Notifica al Garante** con la procedura online sul sito del Garante: natura della violazione, categorie e numero approssimativo di persone e dati, conseguenze probabili, misure prese. Se non hai ancora tutto, notifica comunque e completa dopo.
3. **Avvisa le persone** se il rischio è alto: cosa è successo, cosa hai fatto, cosa devono fare loro (per esempio cambiare password, controllare le passkey).

## Dopo

- Annota tutto nel registro delle violazioni dell'agenzia (anche quelle non notificate): data, fatti, effetti, rimedi.
- Correggi la causa e aggiungi un test che la copra.
- Rivedi questo runbook se qualcosa non ha funzionato.
