# Finto Graph API (`@app/meta-mock`)

Server HTTP locale che risponde come la Graph API di Meta (piano della tappa 3, Task 2). Lo usano i test d'integrazione, gli E2E e `META_MODE=mock` in sviluppo. Nessun test o script parla con Meta vera (`AGENTS.md`).

```ts
import { META_MOCK, startMetaMock } from '@app/meta-mock'

const mock = await startMetaMock() // porta libera; { port } per fissarla
mock.scenario('token_expired', { token: META_MOCK.tokens.systemUser })
mock.calls() // richieste ricevute
mock.scenario('default') // torna ai dati iniziali
await mock.stop()
```

In sviluppo: `pnpm --filter @app/meta-mock start` (porta `META_MOCK_PORT`, 4010 di default). Il pannello lo usa con `META_MODE=mock`, all'indirizzo `META_MOCK_URL` (predefinito `http://127.0.0.1:4010`). Con l'app finta (`META_MOCK.app`) Impostazioni → Integrazioni → Meta si salva e si prova.

## Cosa risponde

- Graph API su `<url>/<versione>/…`: nodi (`/me`, `/{id}`), elenchi paginati con `limit`, `after` e `summary=total_count`, `me/permissions`, `content_publishing_limit`, intestazioni `X-App-Usage` e `X-Business-Use-Case-Usage`.
- Token in `Authorization: Bearer` o in `access_token`. `appsecret_proof` è obbligatorio, come con **Require App Secret** attivo; non serve nello scambio del codice né in `debug_token`, che usa il token dell'app (`docs/platforms/meta.md`).
- Dialogo dell'accesso unificato su `<url>/<versione>/dialog/oauth`: controlla `client_id` e `config_id` e rimanda subito a `redirect_uri` con `code` e `state`. Il codice vale una volta sola e solo con lo stesso `redirect_uri`.
- `GET /oauth/access_token` (scambio del codice) e `GET /debug_token`.

## Dati iniziali

Gli id sono in `META_MOCK` (`src/index.ts`).

| Cosa | Visto da |
|---|---|
| Business dell'agenzia con due Pagine: «Forno Luce» con Instagram collegato, «Bottega Verde» senza | utente di sistema (`me/accounts`, `owned_pages`, `client_pages`) |
| Gli Instagram assegnati all'utente di sistema, con e senza Pagina | utente di sistema (`me/assigned_instagram_accounts`, la chiamata che Feedway usa) |
| Profilo solo Instagram nel business dell'agenzia (`studio.rossi`) | utente di sistema (`me/assigned_instagram_accounts`; anche `instagram_business_accounts`, che su Meta vera risponde 100/33) |
| Portfolio di un cliente con un profilo solo Instagram (`palestra.nord`) | accesso unificato |
| Profilo Instagram condiviso (`caffe.centrale`), per la Scelta 2 del piano | entrambi |
| Portfolio con solo un profilo Instagram personale: nessun account | accesso unificato con lo scenario `personal_ig_profile` |

## Scenari

`token_expired`, `permission_missing`, `asset_removed`, `quota_exhausted`, `rate_limited`, `transient_error`, `error` (qualsiasi codice della tabella degli errori), `timeout`, `malformed`, `html_5xx`, `access_denied`, `personal_ig_profile`, `page_without_token`. Le opzioni sono descritte in `src/scenarios.ts`. Gli errori dell'infrastruttura accettano `path` (senza versione, per esempio `/me/accounts`) e `times`.

## Fixture

Le risposte stanno in `fixtures/`: `objects.json` (i nodi come li restituisce Meta), `edges.json` (gli elenchi), `tokens.json` (a chi appartiene ogni token, cosa vede e i dati di `debug_token`), `app.json` e `logins.json`.

**Sono scritte a mano** dalla documentazione di Meta e in gran parte **non verificate** (la prova a mano del 2026-11-11 è in `docs/platforms/meta.md`): in particolare `type` e `expires_at` di `debug_token`, le chiamate che elencano gli account dell'accesso unificato e i testi e i sottocodici degli errori dello scambio del codice (`docs/platforms/meta.md`, «Da provare su Meta vera»). Nel Task 13 le risposte registrate e oscurate (`META_RECORD_DIR`) prendono il loro posto negli stessi file, senza cambiare il codice.
