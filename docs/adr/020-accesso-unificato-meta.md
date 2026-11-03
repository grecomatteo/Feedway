# ADR 020 · Accesso unificato di Meta al posto dei login Facebook e Instagram

| | |
|---|---|
| **Stato** | Proposta |
| **Data** | 2026-11-03 |
| **Specifica** | v9, §8.0, §8.2, §8.3, §13; ADR 015, ADR 019 |

## Contesto
ADR 015 prevede tre tipi di collegamento: `facebook_login`, `instagram_login` e `meta_system_user`. Il piano della tappa 3 costruisce l'utente di sistema e il login Instagram (Task 7) e rimanda il login Facebook (Task 8).

Prova del 2026-11-03 con Matteo sull'app Meta "Feedway", creata il giorno stesso e collegata al portfolio "Trendy - SMM Agency":
- la dashboard dice che la configurazione "API con accesso tramite Instagram" non è disponibile per le app nuove: l'app usa la **configurazione con accesso unificato** (*Unified login*). Lo stesso succede ad altri progetti con app nuove ([Postiz #2350](https://github.com/gitroomhq/postiz-app/issues/2350), [OpenPost #495](https://github.com/getopenpost/openpost/issues/495)): `instagram.com/oauth/authorize` risponde "Invalid platform app", e il dialogo Facebook con `scope` risponde "Invalid Scopes";
- l'accesso unificato è Facebook Login for Business con una **configurazione** (`config_id`). L'indirizzo è `facebook.com/dialog/oauth?client_id=…&config_id=…&response_type=code&override_default_response_type=true&redirect_uri=…`. La configurazione proposta da Meta usa un token d'accesso dell'utente di sistema, con scadenza "Mai";
- la prima schermata offre **«Continua con Facebook»** e **«Continua con Instagram»**. Entrando con un profilo solo Instagram (tester Instagram dell'app), Meta chiede il **portfolio business** del cliente (con la possibilità di crearne uno), poi gli account Instagram e, facoltativo, l'account pubblicitario. Alla fine riporta al nostro indirizzo `https://feedway.<rete>.ts.net/connessioni/…/ritorno?code=…`;
- Meta accetta come indirizzo di ritorno un indirizzo `*.ts.net`.

Secondo la panoramica di Meta ([overview](https://developers.facebook.com/documentation/instagram-platform/overview), [Unified login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login)), il token restituito è un *Business Integration System User Access Token*. Appartiene al portfolio del cliente e non alla persona che ha fatto l'accesso, continua a funzionare se quella persona lascia l'azienda e si usa su `graph.facebook.com`. Lo scambio del codice, la scadenza letta con `debug_token` e gli account visibili **non sono ancora verificati**: la prova si è fermata al ritorno con il codice.

## Decisione
**Per le app create da ora in poi, Feedway ha due tipi di collegamento Meta: `meta_system_user` (resta, invariato) e `meta_business_login` (nuovo), che sostituisce `facebook_login` e `instagram_login`.**

- `meta_business_login`: accesso unificato con `config_id`. Il cliente, o un membro dell'agenzia con il profilo del cliente, sceglie Facebook o Instagram, poi il portfolio e gli account. Copre le Pagine con il loro Instagram e i profili Instagram senza Pagina, purché in un portfolio business.
- Le credenziali dell'app nell'integrazione `meta` (ADR 019) diventano App ID e `configId` in `config`, e `{ appSecret }` come segreto sigillato. Spariscono App ID e secret di Instagram, che le app nuove non hanno.
- Il token di `meta_business_login` non è legato a una persona dell'agenzia. La Scelta 1 del piano della tappa 3 ("chi collega se ne va") non si applica: il collegamento resta quando chi l'ha fatto lascia l'agenzia, come per l'utente di sistema. Diventa rosso solo se il cliente toglie l'accesso o il token smette di valere.
- La porta `PlatformConnector` di ADR 019 non cambia: `startLogin` e `completeLogin` servono a `meta_business_login`. Se il token non scade, `refresh` risponde "non rinnovabile".
- `facebook_login` e `instagram_login` non entrano negli elenchi chiusi della 1.0. Le tabelle non esistono ancora, quindi non serve una migrazione. Se un giorno servissero per un'app vecchia, si aggiungono con una migrazione (§18.6).
- Endpoint esatti, permessi della configurazione di Feedway, scadenza reale del token e modo di trovare gli account (Pagine e profili solo Instagram del portfolio) si fissano nel Task 1 della tappa 3, con fonte e data, e si provano nel Task 13.

## Alternative scartate
- **Tenere il login Instagram (`instagram.com/oauth`)**: con un'app nuova Meta lo rifiuta. Funzionerebbe solo con un'app creata prima del cambio, che Matteo non ha.
- **Solo utente di sistema**: copre i clienti che danno accesso come partner al portfolio di Trendy. Non copre però il cliente con solo Instagram che non vuole o non sa farlo, che era il motivo del login Instagram in ADR 015.
- **Login Facebook classico con `scope`**: anche questo viene rifiutato dalle app nuove ("Invalid Scopes").

## Conseguenze
- Il Task 7 della tappa 3 diventa "Accesso unificato" e assorbe il Task 8 (login Facebook), che non serve più come lavoro a parte.
- Niente rinnovo dei token ogni 60 giorni per i collegamenti fatti con l'accesso: la salute controlla comunque `debug_token` ogni giorno. Se il Task 1 scopre che il token scade, `refresh` e il promemoria del Task 11 si applicano come già previsto dal piano.
- Il cliente deve avere un portfolio business. Chi non ce l'ha lo crea durante l'accesso: visto nella prova, ma con un profilo di prova e non con un cliente vero.
- ADR 015 resta valida per l'idea (più tipi di collegamento, un solo elenco). Cambia l'elenco dei tipi e la conseguenza sui token che scadono a 60 giorni.
- La specifica (§2.2, §3, §8.0, §8.2, §8.3, §13) si aggiorna nella PR del Task 7, come per le altre modifiche della tappa.
- Si riapre se il Task 1 o il Task 13 mostrano che l'accesso unificato non restituisce un token utilizzabile per pubblicare, o non trova i profili solo Instagram.
