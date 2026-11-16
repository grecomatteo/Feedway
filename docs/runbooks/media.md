# Media: host pubblico

Come si accende l'host pubblico dei media e come si legge l'indirizzo pubblico di un file. Il resto del runbook dei media (limiti, dove stanno i file, video fermi in elaborazione) arriva con il Task 14 della tappa 4.

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
