# Meta: cosa dice la documentazione ufficiale

Verifiche del Task 1 della tappa 3: ciò che i task successivi danno per buono sulla Graph API. Ogni riga ha la fonte e la data in cui è stata letta. Quello che la documentazione non dice è scritto **non verificato**: si prova alla fine del Task 7 sull'app di Matteo e di nuovo nel Task 13, mai da test o script (`AGENTS.md`).

Tutte le pagine sono state lette il **2026-11-09**. Gli indirizzi senza dominio stanno su `https://developers.facebook.com`. Le fonti non di Meta sono segnate come tali e da sole non bastano.

## Versione della Graph API

| Versione | Uscita | Ritiro | Fonte |
|---|---|---|---|
| v26.0 | 2026-07-29 | non ancora pubblicato ("TBD") | [Versions](https://developers.facebook.com/docs/graph-api/changelog/versions) |
| **v25.0** | 2026-02-18 | **2028-07-29** | stessa pagina |
| v24.0 | 2025-10-08 | 2028-02-18 | stessa pagina |
| v23.0 | 2025-05-29 | 2027-10-08 | stessa pagina |

- **Scelta: v25.0.** È la più recente con una data di ritiro pubblicata, e mancano più di 12 mesi (piano, Task 1). La v26.0 è più nuova ma senza data di ritiro, e `META_GRAPH_VERSION_SUNSET` deve averne una.
- **Cosa cambia da v24.0 a v25.0 per Feedway: niente.** Il changelog della v25.0 ritira metriche delle statistiche delle Pagine e dei post (impression e visualizzazioni video; il ritiro vale per tutte le versioni), toglie i metadati dei campi da `metadata=1` (su tutte le versioni dal 2026-05-19) e porta cambi alla pubblicità e ai webhook. Nessun cambio per Instagram, login, `debug_token`, utenti di sistema, `owned_pages` o `client_pages`. Fonte: [Version 25.0](https://developers.facebook.com/docs/graph-api/changelog/version25.0). Le statistiche arrivano dopo la 1.0 (§18.2): quando si fanno, si usano le metriche nuove (`page_media_view`, `post_total_media_view_unique` e simili).
- **Non verificato: la v27.0.** Gli esempi delle pagine di riferimento di Meta usano già `v27.0` (per esempio [content_publishing_limit](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit)), e un articolo non di Meta la dà uscita il 2026-11-04 ([relevantaudience.com](https://www.relevantaudience.com/meta/meta-marketing-api-v27-product-showcase-device-expansion-defaults/)). La pagina Versions, letta lo stesso giorno, non la elenca ancora. Il changelog delle versioni 26.0 e 27.0 non si apre da qui. Quando Meta pubblica la data di ritiro della v26.0 si rivaluta il passaggio, con una PR.
- **Non verificato: i cambi del 2026-10-27 su tutte le versioni.** Secondo un articolo non di Meta ([fixmation.dev](https://fixmation.dev/blog/meta-graph-api-27-october-all-versions)), da quel giorno su ogni versione falliscono le richieste con `date_format` e quelle con più oggetti insieme (`GET /?ids=…`), e i parametri `pretty` e `debug` vengono ignorati. Il client del Task 3 non usa nessuno dei due: una richiesta per oggetto, date lette come arrivano.
- In configurazione: `META_GRAPH_VERSION=v25.0` e `META_GRAPH_VERSION_SUNSET`. Per v24.0 e v25.0 Feedway conosce la data; per un'altra versione la variabile è obbligatoria. Il promemoria del Task 11 avvisa 90 giorni prima (§8.4).

## Accesso unificato (`meta_business_login`, ADR 020)

| Cosa | Cosa dice Meta | Fonte |
|---|---|---|
| Che cos'è | Facebook Login for Business con una configurazione (`config_id`). È "the recommended setup for new integrations" e il cliente entra con Instagram o con Facebook | [Instagram API with Unified Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login), [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) |
| Pagina Facebook | Non serve ("Your clients don't need a Facebook Page"); serve un portfolio business | stesse pagine |
| Host | `graph.facebook.com` (il vecchio login Instagram usa `graph.instagram.com`) | [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) |
| Dialogo | `https://www.facebook.com/<versione>/dialog/oauth` con `client_id`, `redirect_uri`, `state` (obbligatori), più `config_id`, `response_type=code` e `override_default_response_type=true` per un token dell'utente di sistema. Con `config_id` non si passa `scope` ("config_id has replaced scope") | [Manual flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow), [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/); indirizzo provato con Matteo il 2026-11-03 (ADR 020) |
| Annullamento | Il ritorno porta `error=access_denied`, `error_reason=user_denied` e `error_description` | [Manual flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow) |
| Scambio del codice | `GET https://graph.facebook.com/<versione>/oauth/access_token` con `client_id`, `client_secret`, `code` e lo stesso `redirect_uri` del dialogo, solo dal server. L'esempio di Login for Business non mostra `redirect_uri`: il client lo manda sempre, come chiede il manual flow | stesse pagine |
| `appsecret_proof` nello scambio | Non previsto: l'esempio non lo usa, e lo scambio ha già `client_secret` | [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/) |
| Tipo di token | *Business Integration System User access token*: del portfolio del cliente, non della persona; "keeps working if that person leaves the business" | [Unified Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login), [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/) |
| Scadenza | "Defaults to never expire". Con l'API di gestione dei token si può chiedere un token a 60 giorni (`set_token_expires_in_60_days`): Feedway non lo fa | [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/) |
| Durata e uso del codice | La documentazione non lo dice. **Non verificato**: il client lo scambia subito e una volta sola | — |
| Portfolio del cliente | `GET /me?fields=client_business_id` con il token restituisce l'id del portfolio del cliente | [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/), [User](https://developers.facebook.com/docs/graph-api/reference/user/) |
| Account visibili | "Your app can only access the assets that were designated by your business client". La documentazione **non dice con quale chiamata si elencano** | [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/) |

**Come si trovano gli account dopo l'accesso: non verificato.** Le chiamate candidate, da provare alla fine del Task 7 in quest'ordine:
1. `GET /{client_business_id}/owned_pages` e `GET /{client_business_id}/client_pages`, poi per ogni Pagina il campo `instagram_business_account` (le due chiamate: [owned_pages](https://developers.facebook.com/docs/graph-api/reference/business/owned_pages/), [client_pages](https://developers.facebook.com/docs/graph-api/reference/business/client_pages/));
2. `GET /{client_business_id}/instagram_business_accounts`, che restituisce nodi IG User: dovrebbe coprire i profili Instagram senza Pagina ([instagram_business_accounts](https://developers.facebook.com/docs/graph-api/reference/business/instagram_business_accounts/)). Attenzione: la pagina [IG User](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/) descrive `id` come "Available for Page-backed Instagram accounts";
3. `GET /me/accounts`, come per l'utente di sistema.

Se nessuna delle tre restituisce un profilo solo Instagram con cui si legge `content_publishing_limit`, ci si ferma e si decide con Matteo prima del Task 12 (piano, Task 1).

**Stesso utente, stesso collegamento (Scelta 4 del piano).** `debug_token` restituisce `user_id` (sotto). La documentazione non dice se lo stesso cliente che rifà l'accesso riceve lo stesso id: **non verificato**, si prova alla fine del Task 7 facendo l'accesso due volte.

## Permessi

Descrizioni e dipendenze dal [Permissions Reference](https://developers.facebook.com/docs/permissions) (2026-11-09):

| Permesso | A cosa serve | Dipende da |
|---|---|---|
| `pages_show_list` | Elenco delle Pagine che la persona gestisce | — |
| `pages_read_engagement` | Leggere contenuti e dati della Pagina | `pages_show_list` |
| `pages_manage_posts` | Creare, modificare, eliminare i post della Pagina | `pages_read_engagement`, `pages_show_list` |
| `instagram_basic` | Leggere profilo e contenuti dell'account Instagram | `pages_read_engagement`, `pages_show_list` |
| `instagram_content_publish` | Pubblicare foto e video nel feed | — |
| `business_management` | Leggere e scrivere con la Business Manager API | — |
| `ads_management`, `ads_read` | Pubblicità | — |

### Per tipo di collegamento

| Tipo | Permessi | Fonte e stato |
|---|---|---|
| `meta_system_user` | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management` | Elenco della specifica §8.1, coerente con le dipendenze sopra e con i permessi di [content_publishing_limit](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) |
| `meta_business_login` (configurazione di Feedway) | Gli stessi sei | `instagram_basic` e `instagram_content_publish` sono quelli che Meta indica per l'accesso unificato ([content_publishing_limit](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit)); i `pages_*` servono alla strada Facebook; `business_management` serve a leggere i portfolio. La lista dei permessi dell'accesso unificato **non è pubblicata** ([Overview](https://developers.facebook.com/documentation/instagram-platform/overview) rimanda a una pagina che non li elenca): non verificato |

- **Non chiedere** pubblicità (`ads_*`), messaggi (`instagram_manage_messages`, `pages_messaging`), commenti e statistiche: la 1.0 non li usa (§8.1, §18.2). La configurazione proposta da Meta chiede anche pubblicità e messaggi: vanno tolti nella dashboard.
- **Non verificato: servono `ads_management` o `ads_read`?** Meta li chiede "if the app user was granted a Page role through Business Manager" ([Content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing), [IG User](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/)). È il caso delle Pagine nel Business Manager di Trendy, e può esserlo anche per le Pagine che il cliente concede con l'accesso unificato, che passano dal suo portfolio. Se servono, vanno aggiunti anche alla configurazione dell'accesso unificato, altrimenti la pubblicazione fallirebbe senza un errore chiaro. Se servono, il controllo dei permessi lo segnala (§8.1, passo 4).
- **Tutti i permessi sono necessari**: con Login for Business, se la persona non li concede tutti, l'app non ne riceve nessuno ([Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/)).
- **I permessi concessi si leggono sempre da `debug_token`** (`scopes` e `granular_scopes`, che per ogni permesso dà gli id degli oggetti). Con `config_id` l'indirizzo di ritorno non li contiene.

## Utente di sistema (`meta_system_user`)

| Cosa | Cosa dice Meta | Fonte |
|---|---|---|
| Scadenza | I token degli utenti di sistema del Business Manager "won't expire solely based on time", ma possono essere invalidati per altri motivi | [Access tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens) |
| Pagine assegnate | `GET /me/accounts`: "The Facebook Pages that a person owns or is able to perform tasks on", con `tasks` per ogni Pagina. Per gli account Instagram si chiede il campo `instagram_business_account` | [User accounts](https://developers.facebook.com/docs/graph-api/reference/user/accounts/), [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram) |
| Pagine del portfolio | `GET /{business-id}/owned_pages` (Pagine del portfolio) e `GET /{business-id}/client_pages` (Pagine dei clienti a cui il portfolio ha accesso, con `permitted_tasks`). Paginate, con `summary=total_count`. La documentazione non nomina il permesso: **non verificato**, probabilmente `business_management` | [owned_pages](https://developers.facebook.com/docs/graph-api/reference/business/owned_pages/), [client_pages](https://developers.facebook.com/docs/graph-api/reference/business/client_pages/) |
| Token delle Pagine | Si leggono da `me/accounts`; un token di Pagina di lunga durata "do not have an expiration date" | [User accounts](https://developers.facebook.com/docs/graph-api/reference/user/accounts/), [Long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived) |
| Id del business | `GET /{user-id}/businesses` esiste, ma la pagina non dice se risponde a un utente di sistema: **non verificato**. `client_business_id` vale solo per il token dell'accesso unificato | [User businesses](https://developers.facebook.com/docs/graph-api/reference/user/businesses/), [User](https://developers.facebook.com/docs/graph-api/reference/user/) |

**Conseguenza per il Task 4.** La documentazione non dà un modo sicuro di leggere l'id del business con il token dell'utente di sistema. Come prevede il piano, il Task 4 aggiunge `businessId` al `config` dell'integrazione Meta (l'Owner lo copia da Impostazioni del business), con il suo test. `me/businesses` si prova lo stesso alla fine del Task 7: se risponde, si può precompilare il campo.

## Salute

| Controllo | Cosa dice Meta | Fonte |
|---|---|---|
| `debug_token` | `GET /debug_token?input_token=…` con un token dell'app (`{app-id}\|{app-secret}`, o quello da `grant_type=client_credentials`) o di uno sviluppatore dell'app. Campi: `app_id`, `type`, `application`, `expires_at`, `data_access_expires_at`, `is_valid`, `issued_at`, `scopes`, `granular_scopes`, `user_id`, `profile_id`, `error` (`code`, `subcode`, `message`) | [debug_token](https://developers.facebook.com/docs/graph-api/reference/v7.0/debug_token), [Debugging](https://developers.facebook.com/docs/facebook-login/guides/%20access-tokens/debugging), [Access tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens) |
| `expires_at = 0` | La documentazione non dice cosa significa. **Non verificato**: dalla prova di fine Task 7. Proposta per il Task 3: fino ad allora `0` vale "non scade" solo per i token che secondo Meta non scadono: quello dell'accesso unificato (*Business Integration System User*) e quello dell'utente di sistema del Business Manager | — |
| Token invalidati | Meta non avvisa: lo si scopre quando una chiamata fallisce ("access tokens may be invalidated before the expected expiration time"). Per questo il controllo è giornaliero | [Debugging](https://developers.facebook.com/docs/facebook-login/guides/%20access-tokens/debugging) |
| Quota Instagram | `GET /{ig-user-id}/content_publishing_limit?fields=quota_usage,config`, `since` facoltativo (al massimo 24 ore fa). Risposta: `quota_usage` e `config.quota_total` (oggi 50) con `config.quota_duration` (86400 secondi). La guida alla pubblicazione dice invece 100 post: si usa sempre il valore letto | [content_publishing_limit](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit), [Content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing) |
| Data Use Checkup | Annuale; non serve in modalità sviluppo, ma va fatto prima di passare l'app in Live. La documentazione **non indica un'API** per leggere la scadenza | [Data Use Checkup](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/data-use-checkup.md) |

**Conseguenza per il Task 4.** Senza un'API, la scadenza del Data Use Checkup la inserisce l'Owner nell'integrazione Meta, come prevede il piano. Il promemoria del Task 11 la usa. Finché l'app resta in sviluppo il campo può restare vuoto.

## `appsecret_proof`

- Si calcola come HMAC-SHA256 del token con il secret dell'app come chiave (`hash_hmac('sha256', $access_token, $app_secret)` nell'esempio di Meta, quindi in esadecimale) e si passa come parametro `appsecret_proof` a ogni chiamata. Fonte: [Securing requests](https://developers.facebook.com/docs/graph-api/securing-requests).
- Con **Require App Secret** attivo nella dashboard (Impostazioni dell'app → Avanzate) le chiamate senza il parametro falliscono. Va attivato nell'app Feedway (lo fa Matteo): Feedway chiama Meta solo dal server e lo manda sempre (§8.6).
- È obbligatorio per l'API di gestione dei token degli utenti di sistema (`/{client_business_id}/system_user_access_tokens`). Fonte: [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/).
- Non si usa nello scambio del codice né in `debug_token` con il token dell'app, che contiene già il secret. Questo è una deduzione dagli esempi di Meta: **non verificato**.

## Intestazioni d'uso

Fonte: [Rate Limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/) (2026-11-09).

| Intestazione | Quando arriva | Contenuto |
|---|---|---|
| `X-App-Usage` | Chiamate con token dell'app o di una persona (limiti "di piattaforma") | JSON con `call_count`, `total_cputime`, `total_time`: percentuali su un'ora mobile. A 100 di `total_cputime` o `total_time` le chiamate possono essere limitate |
| `X-Business-Use-Case-Usage` | Pagine con token di Pagina o di utente di sistema, e Instagram (tranne i messaggi): limiti "per caso d'uso" (BUC). Se valgono entrambi, vale il BUC | JSON con chiave l'id del business e una lista di oggetti con `type` (`pages`, `instagram`, …), `call_count`, `total_cputime`, `total_time`, `estimated_time_to_regain_access` (minuti) |

- Il client del Task 3 legge le due intestazioni e, sopra l'80%, il worker rallenta (§8.6). `estimated_time_to_regain_access` dà l'attesa quando un limite è superato.
- Limite di Instagram: 4800 × impression in 24 ore mobili, per app e utente. Dipende dalle impression, non dal numero di account: la regola dell'80% lo copre.

## Errori

Formato di un errore ([Handling Errors](https://developers.facebook.com/docs/graph-api/guides/error-handling)): `{ "error": { "message", "type", "code", "error_subcode", "error_user_title", "error_user_msg", "fbtrace_id" } }`. La pagina non nomina `is_transient`: il client non lo usa. Si classifica per `code` e `error_subcode`, mai per il testo (ricerca su Postiz e OpenPost, 2026-11-03). Dell'errore si conservano solo stato HTTP, `code`, `error_subcode`, `fbtrace_id` e `Retry-After`.

| Codice / sottocodice | Significato secondo Meta | Classe | Effetto in Feedway | Fonte |
|---|---|---|---|---|
| 190 (senza sottocodice), 190/463, 190/467 | Token scaduto, revocato o non valido | `permanent` | collegamento `expired` | [Handling Errors](https://developers.facebook.com/docs/graph-api/guides/error-handling), [Debugging](https://developers.facebook.com/docs/facebook-login/guides/%20access-tokens/debugging) |
| 190/458 | L'utente ha tolto l'autorizzazione all'app | `permanent` | collegamento `revoked` | stesse pagine |
| 190/460 | Password cambiata o uscita dall'app | `permanent` | collegamento `expired`, rifare l'accesso | stesse pagine |
| 190/459, 190/464 | Account bloccato da un controllo o non confermato: "needs to log in at https://www.facebook.com" | `permanent` | collegamento `expired`; il messaggio dice di accedere a facebook.com e poi ricollegare | [Handling Errors](https://developers.facebook.com/docs/graph-api/guides/error-handling) |
| 190/492 | "User associated with the Page access token does not have an appropriate role on the Page" | `permanent` | l'account diventa rosso: serve un ruolo sulla Pagina | stessa pagina |
| 10, 200–299 | Permesso non concesso o tolto | `permanent` | account rosso, con il permesso da concedere | stessa pagina |
| 3 | L'app non ha la capacità o il permesso per questa chiamata | `permanent` | account rosso | stessa pagina |
| 100/33 | "Unsupported get request": oggetto inesistente, non accessibile per permessi o operazione non supportata. **Non è nella tabella di Meta**: classe dalla ricerca su Postiz e OpenPost | `uncertain` | da solo non rende inattivo un account: un account è inattivo solo se sparisce dall'elenco del collegamento proprietario | non verificato |
| 4 | Limite di chiamate dell'app | `transient` | attesa con le intestazioni d'uso | [Handling Errors](https://developers.facebook.com/docs/graph-api/guides/error-handling), [Rate Limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/) |
| 17 | Limite di chiamate dell'utente | `transient` | come sopra | stesse pagine |
| 32 | Limite delle Pagine (token di una persona) | `transient` | come sopra | [Rate Limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/) |
| 613 | Limite personalizzato di una singola API (613/1996: volume di richieste incoerente) | `transient` | come sopra | stessa pagina |
| 80001 | Limite BUC delle Pagine (token di Pagina o di utente di sistema) | `transient` | attesa di `estimated_time_to_regain_access` | stessa pagina |
| 80002 | Limite BUC di Instagram | `transient` | come sopra | stessa pagina |
| 341 | Limite dell'applicazione raggiunto | `transient` | attesa | [Handling Errors](https://developers.facebook.com/docs/graph-api/guides/error-handling) |
| 368 | Bloccato temporaneamente per violazioni: "Wait and retry the operation" | `transient` | attesa lunga, senza tentativi ravvicinati | stessa pagina |
| 368/1390008 | Il sottocodice **non è documentato** da Meta: viene dalla ricerca | `transient` | come il 368 | non verificato |
| 1 | "Possibly a temporary problem": "Wait and retry"; se si ripete, controllare che l'API esista | `transient` | pochi tentativi, poi errore | [Handling Errors](https://developers.facebook.com/docs/graph-api/guides/error-handling) |
| 2 | Servizio non disponibile per un momento | `transient` | tentativi con attesa crescente | stessa pagina |
| 506 | Post duplicato | `permanent` | serve alla pubblicazione (tappa 7) | stessa pagina |
| Risposta non JSON con 429 o 5xx | Guasto di Meta (pagina HTML) | `transient` | tentativi con attesa crescente | ricerca su Postiz e OpenPost (non di Meta) |

**Differenza dalla ricerca.** La ricerca del 2026-11-03 classificava il codice 1 come `permanent`. Meta dice di riprovare: qui diventa `transient`, con pochi tentativi.

**Proposta per il Task 3.** La tabella dice `expired` o `revoked` per il collegamento, ma la scelta dello stato è del caso d'uso (Task 10): il client restituisce solo la classe e un motivo (`token_invalid`, `token_revoked`, `checkpoint`, `page_role_missing`, `permission_missing`, `rate_limited`, `blocked`, `not_found_or_forbidden`, `meta_unavailable`).

Gli errori della pubblicazione Instagram (sottocodici 2207xxx) servono alla tappa 7: sono in [Instagram Error Codes](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes) e qui non si trascrivono.

## Da provare su Meta vera (fine del Task 7, poi Task 13)

1. Scambio del codice dell'accesso unificato, con `redirect_uri`.
2. `debug_token` del token ottenuto: `type`, `expires_at` (0?), `data_access_expires_at`, `scopes`, `granular_scopes`, `user_id`.
3. Lo stesso `user_id` dopo un secondo accesso dello stesso cliente.
4. Quale delle tre chiamate elenca gli account, compreso un profilo solo Instagram, e se con quell'id si legge `content_publishing_limit`.
5. La strada «Continua con Facebook».
6. Con l'utente di sistema di Trendy: `me/businesses`, e se servono `ads_management` o `ads_read`.
7. Con l'accesso unificato: se la pubblicazione su una Pagina del cliente chiede `ads_management` o `ads_read`.
8. Con **Require App Secret** attivo: scambio del codice e `debug_token` senza `appsecret_proof`.
