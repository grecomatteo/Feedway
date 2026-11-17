# Media

I limiti dei file, dove stanno, come si accende l'host pubblico dei media, come si legge l'indirizzo pubblico di un file, cosa fare con un file fermo in elaborazione e cosa manca ancora (le copie di sicurezza dei file).

## Limiti

Si cambiano in `.env` (poi `./scripts/compose.sh up -d web worker`); vuoti valgono i valori di `packages/config` (ADR 021).

| Cosa | Valore | Variabile |
|---|---|---|
| Tipi ammessi | foto JPEG, PNG, WebP, HEIC/HEIF; video MP4 e MOV. Decidono i byte, non il nome | — |
| Peso di una foto | 50 MB | `MEDIA_MAX_IMAGE_BYTES` |
| Pixel di una foto | 50 milioni | `MEDIA_MAX_IMAGE_PIXELS` |
| Peso di un video | 300 MB | `MEDIA_MAX_VIDEO_BYTES` |
| Durata di un video | 15 minuti | `MEDIA_MAX_VIDEO_SECONDS` |
| Pixel di un fotogramma | 4096 × 4096 | `MEDIA_MAX_VIDEO_PIXELS` |
| Spazio di un cliente | nessun limite | `MEDIA_WORKSPACE_MAX_BYTES` (byte) |
| Conversioni alla volta per agenzia | 1 | `MEDIA_CONVERSIONS_PER_ORG` |
| Pezzi del caricamento | 20 MiB; il server del pannello dà 300 s a ogni richiesta | — |
| Caricamento non finito | si cancella dopo 24 ore | — |
| Tempo di una conversione video | 2 minuti più 4 volte la durata, al massimo 60 minuti (un reel di 60 s: 6 minuti) | — |
| Tentativi di una conversione | 3; un riavvio pulito del worker non ne consuma | — |
| Letture alla volta sull'host pubblico | 3 per processo, poi 503 con `Retry-After: 5` | — |
| Memoria dei contenitori | worker 2 GB, web 1536 MB | `docker/compose.yml` |

La copia master di una foto è al massimo 4096 px sul lato lungo, senza EXIF né GPS; l'originale di una foto si cancella appena le copie sono pronte. L'originale di un video resta, perché le copie si rifanno da lì.

## Dove stanno i file

Con `STORAGE_DRIVER=disk` (il default) tutto sta nel volume Docker `media`, montato in `/media` (`MEDIA_ROOT`) in web e worker:

- `org/<agenzia>/media/<file>/<copia>.<ext>`: originale e copie di ogni file della libreria (per esempio `ig_feed`, `master`, `thumbnail`, `preview`, `reel`);
- `org/<agenzia>/logo/<impronta>.webp` e `-64.webp`: il logo dell'agenzia;
- `org/<agenzia>/accounts/<account>/avatar/<impronta>.webp`: le foto dei profili dei clienti;
- `users/<persona>/…`: le foto profilo delle persone;
- `uploads/` (`MEDIA_UPLOAD_DIR`): i pezzi dei caricamenti in corso, fuori dalle chiavi qui sopra.

Con il disco, ogni file comincia con una riga JSON (`{"contentType":"image/jpeg"}` e un a capo) prima dei byte veri: per aprirlo con altri strumenti, `tail -n +2 <file> > copia`.

Lo spazio occupato: `./scripts/compose.sh exec worker du -sh /media/org /media/uploads`. Con S3 (`docker/compose.s3.yml`) le stesse chiavi sono oggetti del bucket; i pezzi dei caricamenti restano sul disco del web.

Il nome di agenzia e file nelle cartelle è un id: per sapere a quale file corrisponde una cartella, `select original_name, status from media where id = '<file>'` con la `psql` di sotto.

## Cos'è

Meta scarica foto e video da un indirizzo pubblico, senza accesso. Per questo Feedway ha un secondo indirizzo, diverso da quello del pannello (§16.1, ADR 005):

- su `PUBLIC_URL` rispondono solo `/m/<token>.jpg` e `/m/<token>.mp4` (le copie da pubblicare) e `/robots.txt`;
- il pannello resta raggiungibile solo dalla rete Tailscale e non risponde a `/m/`;
- i token sono di 32 caratteri casuali: non si indovinano e non si ricavano dal file;
- un file cancellato sparisce subito da `/m/`. Una CDN davanti può tenerlo al più un'ora.

Nella fase iniziale l'host pubblico è un **secondo nodo Tailscale** (`tailscale-public`, di solito `feedway-media`), aperto a internet con **Tailscale Funnel**. Il nodo inoltra solo `/m/`, `/share/` e `/robots.txt` alla porta 3001 del web, che serve solo l'host pubblico.

## Accenderlo

Prima, nella console di Tailscale:

1. **Un tag per il nodo**, così Funnel vale solo per lui e la sua chiave non scade. Nella policy del tailnet (Access controls):

   ```json
   "tagOwners": { "tag:feedway-media": ["autogroup:admin"] },
   "nodeAttrs": [{ "target": ["tag:feedway-media"], "attr": ["funnel"] }]
   ```

   Non dare `funnel` a `autogroup:member`: lo avrebbe ogni dispositivo della rete. HTTPS deve essere attivo nella rete, come per il pannello.
2. **Chiave di autenticazione** per il secondo nodo: Settings → Keys → Generate auth key, con il tag `tag:feedway-media`. Basta una chiave monouso. Un nodo con tag non scade; senza tag la chiave del nodo scade dopo 180 giorni e `/m/` smette di rispondere senza avvisi: in quel caso, nella pagina Machines, scegli «Disable key expiry» per il nodo.

Poi, sulla VPS, rilancia l'installazione: non riscrive i segreti che esistono già.

```bash
cd /opt/feedway
./scripts/install.sh
```

Alla domanda «Attivare l'host pubblico dei media con Tailscale Funnel?» rispondi `s`, poi indica il nome del nodo (`feedway-media`) e incolla la chiave del punto 1 (non viene mostrata). Lo script avvia il nodo, scrive `PUBLIC_URL` in `.env` (del tipo `https://feedway-media.<rete>.ts.net`) e riavvia il web.

Per spegnerlo, rilancia lo script e rispondi `n`: il nodo si ferma e `PUBLIC_URL` si svuota.

**Installazioni fatte prima della 0.10.0:** il compose nuovo nomina il segreto `ts_public_authkey`, e lo `update.sh` delle versioni precedenti rifiuta l'aggiornamento se manca. Prima del primo aggiornamento alla 0.10.0, dalla cartella dell'installazione: `(umask 077 && printf non-usata > secrets/ts_public_authkey)`. Dalla 0.10.0 lo fa `update.sh` da solo.

## Controllare che funzioni

Da un dispositivo **fuori** dalla rete Tailscale (per esempio il telefono con il Wi-Fi spento e Tailscale scollegato):

- `PUBLIC_URL/robots.txt` mostra `Disallow: /`;
- `PUBLIC_URL/` e `PUBLIC_URL/accedi` danno «Not Found»;
- l'indirizzo di un file (sotto) si apre;
- `PANEL_URL` non si apre.

## L'indirizzo pubblico di un file

Il pannello non lo mostra prima della tappa 7. Per la prova, dalla cartella dell'installazione:

```bash
base="$(sed -n 's/^PUBLIC_URL=//p' .env)"
./scripts/compose.sh exec -T postgres psql -U postgres -d app -At -F ' · ' -c "
  select m.created_at::date, m.original_name,
         '/m/' || v.public_token || case v.mime when 'video/mp4' then '.mp4' else '.jpg' end
    from media_variants v
    join media m on m.organization_id = v.organization_id and m.id = v.media_id
   where v.public_token is not null and m.status = 'ready'
   order by m.created_at desc
   limit 10" | sed "s|/m/|$base/m/|"
```

Stampa gli ultimi 10 file pronti, di tutte le agenzie, con data, nome e indirizzo. L'indirizzo è come una chiave: non incollarlo in chat o in un ticket pubblico.

## Se non funziona

- `./scripts/compose.sh logs --tail 100 tailscale-public` dice se il nodo è entrato nella rete e se Funnel è stato rifiutato dalla policy.
- `./scripts/compose.sh exec tailscale-public tailscale funnel status` mostra cosa è aperto a internet: devono comparire solo `/m/`, `/share/` e `/robots.txt`.
- Nel log del web le richieste dell'host pubblico hanno `"entry":"public"` e il percorso `/m/…`, senza token.
- **503 con `Retry-After: 5`** su un indirizzo `/m/` ben formato: l'host pubblico ha già 3 letture in corso (una raffica di richieste, o un database lento che le tiene occupate) e chiede di riprovare; Meta riprova da sola. Un errore del database o del file dà invece **500**, con una riga `public request failed` nel log del web: in quel caso guarda `./scripts/compose.sh ps` e il log di `postgres`. Un indirizzo malformato o un file cancellato danno 404, subito.

## Un file fermo in «In preparazione»

Le copie le fa il worker, una conversione alla volta per agenzia (`MEDIA_CONVERSIONS_PER_ORG`). Un video lungo può impiegare qualche minuto: non è un guasto.

Cosa succede da solo:

- **Riavvio del worker** (`./scripts/compose.sh restart worker`, un aggiornamento, un guasto): il worker interrompe la conversione in corso, si ferma entro 45 secondi e, quando riparte, riprende i file rimasti in elaborazione. La copia si rifà da capo.
- **Lavoro perso dalla coda**: ogni 10 minuti la pulizia rimette in coda i file in elaborazione senza cambiamenti da più di 15 minuti.

Quindi un file fermo da meno di mezz'ora di solito si sblocca da sé. Se resta fermo:

1. Guarda il log del worker: `./scripts/compose.sh logs --tail 200 worker | grep -i media`. Una riga `media.process` con un errore dice perché.
2. Elenca i file fermi, di tutte le agenzie:

   ```bash
   ./scripts/compose.sh exec -T postgres psql -U postgres -d app -At -F ' · ' -c "
     select organization_id, id, updated_at, mime
       from media
      where status = 'processing' and updated_at < now() - interval '30 minutes'
      order by updated_at"
   ```

3. Riavvia il worker: `./scripts/compose.sh restart worker`. Al riavvio riprende ogni file della lista.
4. Se il file finisce in «Non riuscito»:
   - con «La preparazione non è riuscita dopo vari tentativi», o con un tempo scaduto, il problema può essere della macchina (spazio su disco finito, ffmpeg interrotto, server lento): l'originale resta salvato, ma il pannello non sa ancora rifare la preparazione. Correggi la causa e ricarica il file;
   - con un motivo definitivo (formato non valido, troppo lungo, troppo grande) l'originale è già cancellato: va esportato in un formato accettato e ricaricato;
   - con lo spazio pieno anche l'originale è cancellato: libera spazio nel cliente (o alza `MEDIA_WORKSPACE_MAX_BYTES`) e ricarica il file.

Non cambiare `status` a mano nel database: copie, originale e spazio contato non tornerebbero più d'accordo.

## Copie di sicurezza dei file: non ci sono ancora

Il backup cifrato di oggi copia **solo il database**. Foto e video della libreria (la cartella `MEDIA_ROOT`, o il bucket S3) non hanno copie di sicurezza fino alla tappa 11 (specifica §16.4).

Fino ad allora:

- non usare Feedway come unico posto dove sta il materiale di un cliente: l'originale deve restare anche altrove (il telefono, il disco dell'agenzia, il cloud del cliente);
- se il disco della VPS si guasta, i file della libreria vanno ricaricati: il database ripristinato li elenca ancora, ma i loro byte non ci sono più;
- con S3 vale ciò che garantisce il fornitore del bucket, non Feedway.
