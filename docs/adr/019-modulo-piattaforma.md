# ADR 019 · Confini del modulo piattaforma

| | |
|---|---|
| **Stato** | Proposta |
| **Data** | 2026-11-02 |
| **Specifica** | v9, §7.3, §8, §18.6; piano generale §8.8; ADR 015 |

## Contesto
La specifica (§18.6) e il piano generale (§8.8) chiedono che dalla tappa 3 il codice dei social sia diviso per piattaforma, con Meta come prima piattaforma, e che una ADR ne fissi i confini prima del piano della tappa 3. Il resto del prodotto (spazi, profili, post, destinazioni, calendario, coda, notifiche, link cliente, permessi) non deve sapere quale piattaforma c'è dietro un account.

Una piattaforma ha quattro parti (§18.6): **collegamento** (login, rinnovo del token, salute), **regole** (tipi di contenuto, limiti, controlli di §9.2), **pubblicazione** (§9.3–9.6) e **anteprima** (§11.3). La tappa 3 costruisce solo il collegamento. Regole, pubblicazione e anteprima arrivano nelle tappe 5, 7 e 6.

Fatti dal codice della tappa 2:
- il registro dei moduli descritto in `docs/moduli.md` (`module.ts`, `modules.ts`, `ModulePermissions`) non esiste ancora. I permessi sugli account (`accounts.manage`, `workspace.accounts.assign`) sono già nel nucleo;
- `integrations` e `IntegrationStore` esistono, ma solo per le righe della piattaforma (ADR 017);
- `META_GRAPH_VERSION` e `META_MODE` sono già nella configurazione.

## Decisione
**Due moduli: `accounts`, che non conosce nessuna piattaforma, e `platforms/meta`, che implementa per Meta la porta `PlatformConnector`.** Nessun altro modulo importa codice di Meta.

- **Modulo `accounts`** (generico), nelle cartelle `accounts/` di `domain`, `application`, `infrastructure/db`, `contracts`, rotte e lavori:
  - tabelle `social_accounts`, `account_connections`, `workspace_accounts`;
  - casi d'uso: elenco degli account, assegnazione agli spazi, profili dentro uno spazio, avvio e chiusura di un collegamento, sincronizzazione e salute;
  - conosce `platform` (`instagram`, `facebook`) e `connection kind` (`facebook_login`, `instagram_login`, `meta_system_user`) solo come stringhe di elenchi chiusi. Una piattaforma nuova li allarga con una migrazione (§18.6).
- **Porta `PlatformConnector`** in `packages/application/src/ports/platform-connector.ts`. Ce n'è una per tipo di collegamento, con funzioni che parlano solo di account, token e salute, mai di Pagine o container. Le credenziali dell'app arrivano opache:
  - `verifyApp(appCredentials)`: prova le credenziali dell'app prima di salvarle;
  - `loadAppCredentials(tx, organizationId)`: il connettore legge le credenziali della propria app (per Meta dall'integrazione `meta`) e le restituisce come valore opaco, che `accounts` passa alle altre funzioni senza guardarci dentro;
  - `startLogin(input)`: indirizzo a cui mandare il browser e `state` da conservare;
  - `completeLogin(input)`: dal codice di ritorno a un token sigillabile, scadenza e account trovati;
  - `connectWithToken(input)`: solo per il token incollato (utente di sistema);
  - `listAccounts(credentials)`: account che il collegamento vede, con `external_id`, nome, username, avatar e chiave del profilo;
  - `refresh(credentials)`: nuovo token e nuova scadenza, oppure "non rinnovabile";
  - `checkHealth(credentials, account)`: token, permessi, asset e quota, con l'esito `ok`, `warning` o `error` e un messaggio.
- **Modulo `platforms/meta`**:
  - `packages/infrastructure/src/platforms/meta/`: il client della Graph API, i tre connettori e la classificazione degli errori;
  - `packages/application/src/platforms/meta/`: i casi d'uso propri di Meta, come l'integrazione dell'agenzia;
  - `packages/domain/src/platforms/meta/`: le regole pure di Meta, se servono (permessi richiesti, scadenze, soglie di uso).

  Il client Meta resta nell'infrastruttura e non è una porta di `application`: i casi d'uso parlano solo con `PlatformConnector`. Il piano generale §6 si aggiorna di conseguenza, e la porta di pubblicazione della tappa 7 sarà generica (`PlatformPublisher`), implementata da Meta. Le tappe 5–7 aggiungono qui regole, pubblicazione e anteprima.
- **Registro delle piattaforme**: una mappa costante `connection kind → PlatformConnector` costruita nella radice di composizione (`packages/infrastructure/src/runtime.ts`). Non si introduce il registro generale dei moduli finché non serve a un secondo consumatore: `docs/moduli.md` lo segnala come non ancora costruito.
- **Il "profilo" resta generico**: `social_accounts.page_id` (nome della specifica §13) è la chiave che lega due account in un profilo. Per Meta è l'id della Pagina; per una piattaforma senza abbinamenti è vuota.
- **Credenziali**:
  - dell'app Meta dell'agenzia: integrazione `meta` per organizzazione in `integrations`. App ID e App ID di Instagram stanno in `config`; i due secret, come JSON, sono sigillati con `KeyRing.forOrganization` e AAD `integrations:org:<organizationId>:meta`;
  - di ogni collegamento: il token sta sigillato sulla riga di `account_connections` (`token_enc`, `key_version`), con la stessa chiave e AAD `account_connections:<organizationId>:<connectionId>`.

  La specifica (§13 al posto di `token_secret_id`, e §8.3) si aggiorna nella PR del Task 5 della tappa 3.
- **Confini controllati dalla CI** (`dependency-cruiser`). Le regole esistenti vietano già a `domain` e `application` di importare l'infrastruttura e a un modulo di leggere le tabelle di un altro. Si aggiungono:
  - solo `infrastructure/src/platforms/meta/**` e la radice di composizione importano il client Meta, e `infrastructure/src/index.ts` non lo riesporta;
  - `domain/src/accounts/**` e `application/src/accounts/**` non importano `domain/src/platforms/**` né `application/src/platforms/**`.

## Alternative scartate
- **Un solo modulo `meta` con le tabelle degli account dentro**: alla seconda piattaforma bisognerebbe spostare tabelle e casi d'uso usati da post, calendario e profili.
- **Registro generale dei moduli subito** (`module.ts`, `ModulePermissions`): oggi non ha consumatori, perché i permessi sugli account sono già nel nucleo. Costruirlo prima vorrebbe dire indovinarne la forma.
- **Token dei collegamenti in `integrations`**: `integrations` ha una riga per agenzia e tipo, mentre i collegamenti sono molti per agenzia e hanno scadenza e stato propri.

## Conseguenze
- Aggiungere una piattaforma vuol dire: una ADR con API, permessi e limiti, una cartella `platforms/<nome>`, i suoi connettori nella mappa e una migrazione che allarga gli elenchi. Spazi, post e calendario non cambiano.
- La porta `PlatformConnector` va tenuta stretta: un parametro che ha senso solo per Meta (Pagina, container) è il segnale che serve un tipo nella cartella di Meta, non un campo in più nella porta.
- Si riapre se la seconda piattaforma (per esempio TikTok) non entra nelle sei funzioni della porta.
