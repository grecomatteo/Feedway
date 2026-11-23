# Richiesta di cancellazione dei dati

Cosa fare quando arriva all'indirizzo della privacy una richiesta di cancellazione dei dati di una Pagina Facebook o di un account Instagram. L'informativa (`/privacy`) e la pagina `/cancellazione-dati` promettono: **conferma entro 7 giorni, cancellazione entro 30, email quando è fatta**, e una nota che dimostra di averla eseguita.

Il pannello non ha ancora un comando per cancellare un account collegato (D-122 punto 9): finché non c'è, si fa a mano con i passi qui sotto. **Le istruzioni SQL non sono ancora state provate sulla VPS:** la prima volta provale con `ROLLBACK` al posto di `COMMIT` (passo 4) e guarda i numeri.

## 1. Rispondi entro 7 giorni

1. Scrivi a chi ha chiesto che hai ricevuto la richiesta e che la cancellazione avverrà entro 30 giorni.
2. Se non è chiaro che la Pagina o l'account sia suo, chiedi una prova semplice: per esempio un messaggio dalla Pagina o dall'account Instagram, o la richiesta mandata dall'email che compare sulla Pagina. Non chiedere mai password o codici.
3. Annota in un file tuo, fuori dal pannello: data della richiesta, nome della Pagina o dell'account, chi l'ha chiesta. Non scrivere altri dati.

Se la richiesta riguarda **i dati di una persona dell'agenzia** (account del pannello) e non una Pagina o un account Instagram, l'agenzia può togliere la persona da Utenti; la persona può scaricare i suoi dati dal proprio account (esportazione dei dati personali). Per il resto si segue l'art. 12 del GDPR: risposta entro un mese.

## 2. Avvisa l'agenzia

Il collegamento lo ha fatto un'agenzia. Scrivi all'Owner dell'agenzia che la Pagina o l'account verrà scollegato e cancellato da Feedway, così sa che i post programmati lì non usciranno. Le foto e i video caricati in libreria sono dell'agenzia: se chi ha chiesto vuole cancellati anche quelli, glielo inoltri e decide l'agenzia (per quei dati il titolare è lei).

## 3. Trova l'account

Sulla VPS, dalla cartella di Feedway:

```sh
./scripts/compose.sh exec -T postgres psql -U postgres -d app -At -F ' · ' -c "
  select s.id, s.organization_id, s.platform, s.name, coalesce(s.username, ''), s.connection_id,
         (select count(*) from post_targets t where t.account_id = s.id) as destinazioni
  from social_accounts s
  where s.name ilike '%<nome>%' or s.username ilike '%<nome>%' or s.external_id = '<id Meta>';"
```

Controlla che la riga sia quella giusta (nome, piattaforma, agenzia). Una Pagina Facebook e il suo Instagram sono due righe: cancella solo quelle per cui è arrivata la richiesta. Copia `id` e `connection_id`.

## 4. Cancella

Sostituisci `<account>` e `<collegamento>` con i valori del passo 3. La prima volta finisci con `ROLLBACK`, guarda i numeri, poi ripeti con `COMMIT`.

```sh
./scripts/compose.sh exec -T postgres psql -U postgres -d app -v ON_ERROR_STOP=1 <<'SQL'
begin;
-- the post targets on this account, with their attempts (cascade): ids and links of the posts
delete from post_targets where account_id = '<account>';
-- saved groups of accounts have no foreign key
update account_groups set account_ids = array_remove(account_ids, '<account>')
  where '<account>' = any(account_ids);
-- the account, and its place in the clients (workspace_accounts, cascade)
delete from social_accounts where id = '<account>';
-- the access token, only if no other account uses this connection
delete from account_connections c
  where c.id = '<collegamento>'
    and not exists (select 1 from social_accounts s where s.connection_id = c.id);
select count(*) as rimasti from social_accounts where id = '<account>';
rollback; -- poi: commit;
SQL
```

Note:

- I post che avevano solo quella destinazione restano nell'elenco dell'agenzia senza destinazioni: l'agenzia li può eliminare.
- Se il collegamento serve ancora ad altri account dell'agenzia, il codice di accesso resta. Se la persona ha tolto Feedway dalle app di Facebook, quel codice non funziona già più e l'agenzia vedrà il collegamento da rifare.
- Le copie dei file preparate per Meta si cancellano da sole dopo `MEDIA_RETENTION_DAYS` (7 giorni).
- La foto del profilo salvata va tolta a mano, **dopo** il `COMMIT`: con i file sul disco (`STORAGE_DRIVER=disk`, il default) è `./scripts/compose.sh exec worker rm -rf /media/org/<agenzia>/accounts/<account>`, con `<agenzia>` uguale a `organization_id` del passo 3. Con S3 si cancellano gli oggetti con lo stesso prefisso dal bucket ([media.md](media.md)).

## 5. Conferma e annota

1. Scrivi a chi ha chiesto che la cancellazione è fatta, con la data. Ricorda che i post già pubblicati restano su Facebook e Instagram e si gestiscono da lì.
2. Aggiungi la data della cancellazione alla nota del passo 1.
3. Le copie di sicurezza cifrate si sovrascrivono a rotazione (7 giornaliere, 4 settimanali, 3 mensili): in 3 mesi il dato sparisce anche da lì. **Se ripristini un backup prima di allora, ripeti il passo 4** per le richieste annotate nel frattempo.
