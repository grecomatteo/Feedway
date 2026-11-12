# Collegare Meta e gli account dei clienti

Questo runbook serve all'Owner dell'agenzia: preparare l'app Meta, collegarla a Feedway e portare in Feedway le Pagine Facebook e i profili Instagram dei clienti. Le voci del pannello valgono dalla versione 0.8.0.

In Feedway gli account arrivano da un **collegamento**. Nella 1.0 i collegamenti sono di due tipi ([ADR 020](../adr/020-accesso-unificato-meta.md)):

| Tipo | Chi lo fa | Stato |
|---|---|---|
| **Utente di sistema** del Business Manager dell'agenzia | l'Owner, una volta sola | disponibile |
| **Accesso unificato** («Continua con Facebook / Instagram») | il cliente, da un link | **rinviato**: arriva con il Task 7 del piano 03, vedi [sotto](#accesso-unificato-rinviato) |

Oggi tutto passa dall'utente di sistema. Copre anche il caso più comune, quello del cliente che dà all'agenzia l'accesso come partner al suo Business Manager.

Quello che non è ancora stato provato su Meta vera è scritto **non verificato**, con il riferimento in [`docs/platforms/meta.md`](../platforms/meta.md).

## Cosa serve prima

- Un **Business Manager** dell'agenzia (business.facebook.com), con te come amministratore.
- Il ruolo **Owner** in Feedway. L'Admin vede l'integrazione in sola lettura e può aggiungere account quando l'app è pronta.
- Le persone che dovranno fare l'accesso unificato, quando arriverà, hanno un **ruolo nell'app** finché l'app è in modalità sviluppo ([Ruoli e tester](#ruoli-e-tester)).

## 1. L'app Meta

1. Su [developers.facebook.com](https://developers.facebook.com/apps) premi «Crea app», scegli il tipo **Business** e collegala al Business Manager dell'agenzia.
2. In Impostazioni dell'app → **Avanzate** → Sicurezza accendi **«Richiedi la chiave segreta»** (*Require App Secret*). Feedway firma con `appsecret_proof` ogni chiamata fatta con un token, quindi con l'opzione accesa un token rubato non basta: serve anche il secret.
3. In Impostazioni → **Di base** copia **App ID** e **App Secret**.
4. In Impostazioni → Avanzate, «Aggiorna la versione dell'API» propone la versione attuale. Feedway usa quella di `META_GRAPH_VERSION` (oggi v25.0, ritiro il 2028-07-29): non serve cambiare nulla qui.

Non serve aggiungere a mano i permessi delle Pagine: Meta li aggiunge da solo quando generi il token dell'utente di sistema (passo 3).

**Modalità sviluppo o Live.** Con l'utente di sistema, l'app in modalità sviluppo basta per elencare gli account e pubblicare (verificato il 2026-11-11). **Non verificato:** se i post pubblicati da un'app in sviluppo si vedono da chi non ha un ruolo nell'app. Va controllato prima di usare Feedway con un cliente vero; se non si vedono, l'app va portata in Live con la revisione delle autorizzazioni.

## 2. L'app in Feedway

Pannello → **Impostazioni** → **Integrazioni** → Meta. Chi apre il pannello per la prima volta trova lo stesso percorso nella home, alla scheda «Riprendi la prima configurazione»: sono cinque passi e si può riprendere quando si vuole.

1. Scrivi **App ID** e **App Secret**.
2. Facoltativi:
   - **ID del Business Manager**: lo trovi in Impostazioni del business → Informazioni sul business. Con questo i link delle guide aprono direttamente il tuo Business Manager, e il messaggio per i clienti contiene già l'ID.
   - **Scadenza del Data Use Checkup**: la data che Meta mostra nella dashboard dell'app. Feedway ti avvisa 30 giorni prima.
3. Premi **Salva e verifica** e conferma la password se te la chiede. Feedway prova l'app con Meta e salva solo se Meta la accetta.

Il secret non si rilegge mai: dopo il salvataggio vedi solo «impostato». Per cambiarlo vedi [rotazione-token-meta.md](rotazione-token-meta.md).

Il pulsante **Prova** rifà la stessa verifica senza cambiare niente.

| Risposta | Cosa fare |
|---|---|
| «Funziona» | niente |
| «Meta non accetta questo App ID con questo App Secret» | ricopiali da Impostazioni → Di base; controlla di non aver copiato spazi |
| «Meta non risponde» | riprova tra qualche minuto |

## 3. L'utente di sistema e il suo token

Nel Business Manager dell'agenzia, **Impostazioni del business → Utenti → Utenti di sistema**:

1. Premi «Aggiungi», dagli un nome (per esempio *Feedway*) e il ruolo **Admin**.
2. Apri l'utente di sistema, premi **«Assegna risorse»** e scegli l'app Meta del passo 1, con il controllo completo.
3. Sempre da «Assegna risorse», assegnagli le **Pagine** e gli **account Instagram** che Feedway deve gestire (passo 4).
4. Premi **«Genera token»**, scegli l'app, la scadenza **«Mai»** e spunta questi sei permessi:
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`.
   Se Meta avvisa che alcune autorizzazioni «non sono aggiunte alla tua app», premi **Continua**: le aggiunge lui.
5. Copia il token e **incollalo solo nel pannello**: Account social → Aggiungi account → «Collega l'utente di sistema», oppure il passo 4 della prima configurazione. Mai in una chat, un'email o un file.

Feedway controlla il token con Meta prima di salvarlo. Se mancano dei permessi li mostra in rosso e **non salva niente**: rigenera il token spuntandoli.

I permessi della pubblicità (`ads_management`, `ads_read`) **non servono** all'utente di sistema, né per Instagram né per le Pagine (verificato il 2026-11-11).

Il token dell'utente di sistema **non scade** (verificato il 2026-11-11: scadenza «Mai»). Smette di valere solo se lo revochi, se elimini l'utente di sistema o se gli togli l'app.

## 4. Gli account

Pannello → **Account social** → **Aggiungi account**. La pagina chiede dove sta l'account e mostra i passi giusti.

### L'account è nel Business Manager dell'agenzia
Assegnalo all'utente di sistema (Utenti di sistema → l'utente → «Assegna risorse»), con il controllo completo. Vale anche per un profilo Instagram **senza Pagina** (verificato il 2026-11-11).

### L'account è di un cliente con un Business Manager suo
È il caso più comune.

1. In Feedway scegli «No, è di un cliente con un Business Manager suo» e copia il messaggio per il cliente. Dentro ci sono i passi e l'ID del tuo Business Manager.
2. Il cliente apre il suo Business Manager, va in **Utenti → Partner**, aggiunge il tuo Business Manager come partner e gli dà la Pagina e il profilo Instagram con il controllo completo.
3. Le risorse compaiono nel tuo Business Manager tra quelle condivise dai partner. Assegnale all'utente di sistema come sopra.

**Non verificato:** le voci di menu «Utenti → Partner» e «Dai a un partner l'accesso alle tue risorse» nel Business Manager del cliente; un profilo Instagram condiviso come partner **senza** Pagina ([meta.md](../platforms/meta.md), punto 6 di «Da provare»).

### È un profilo Instagram personale
Prima va trasformato in un profilo professionale, dall'app Instagram: Impostazioni e privacy → Tipo di account e strumenti → Passa a un account professionale. Poi si torna a uno dei due casi sopra.

### Importare
Premi **«Cerca nuovi account»**. Feedway mostra quello che l'utente di sistema vede su Meta: solo le risorse **assegnate** a lui, non tutte quelle del Business Manager.

| Stato nell'elenco | Significato |
|---|---|
| (nessuno) | si può importare |
| «Già importato» | è già in Feedway |
| «Arriva già da un altro collegamento» | un altro collegamento lo porta già: resta lì |
| «Manca il controllo completo» | per la Pagina Meta non dà a Feedway un token: assegnala di nuovo all'utente di sistema con il controllo completo |

Un accesso parziale alla Pagina che comprende «Contenuti» basta per pubblicare (verificato il 2026-11-11), ma il controllo completo evita sorprese: è quello che chiedono le guide del pannello.

Scegli gli account e premi «Importa». Poi assegnali ai clienti dalla pagina di ogni cliente (Clienti → il cliente → Account).

Un account assegnato all'utente di sistema **dopo** la generazione del token compare senza rigenerarlo (verificato il 2026-11-11): basta «Cerca nuovi account».

## Accesso unificato (rinviato)

L'accesso unificato è il pulsante «Continua con Facebook» o «Continua con Instagram» che il cliente userebbe per dare l'accesso da solo, senza Business Manager. **Non è ancora nel pannello**: arriva con il Task 7 del piano 03, rinviato. Quello che serve allora è già noto dalla prova del 2026-11-11 ([meta.md](../platforms/meta.md#accesso-unificato-verificato-in-parte)):

- **Configurazione.** Nell'app Meta: Facebook Login for Business → Configurazioni → «API Instagram (accesso unificato)». Token dell'utente di sistema, scadenza «Mai». Il suo id (`config_id`) va in Impostazioni → Integrazioni → Meta quando il campo arriverà.
- **Indirizzo di ritorno.** Va registrato tra gli URI di reindirizzamento OAuth validi dell'app, esattamente come lo scrive Feedway. Oggi nell'app c'è quello della prova (`…/connessioni/instagram_login/ritorno`). Con il Task 7 diventa `https://<indirizzo del pannello>/connessioni/meta_business_login/ritorno`: quel thread ti darà l'indirizzo esatto da sostituire.
- **Modalità sviluppo.** Entra solo chi ha un ruolo nell'app: un profilo senza ruolo vede «App non attiva». **I clienti veri potranno usarlo solo con l'app in Live**, cioè dopo la revisione delle autorizzazioni di Meta.
- **Aperto:** con la configurazione proposta da Meta il token funziona sugli account scelti, ma Feedway non ha ancora un modo provato per **elencarli**. Va risolto nel Task 7.

### Ruoli e tester
Finché l'app è in sviluppo, ogni persona che fa l'accesso, anche un cliente, deve avere un ruolo nell'app: nella dashboard dell'app, **Ruoli dell'app** → «Aggiungi persone», ruolo **Tester**, e la persona deve accettare l'invito. **Non verificato:** i nomi esatti delle voci di menu e l'invito di un tester che entra con un profilo Instagram invece che con Facebook.

L'utente di sistema non ha bisogno di tester: i passi 1–4 funzionano anche in sviluppo.

## Se un account è rosso

Pannello → **Account social**. Ogni account ha uno stato, e i problemi hanno un testo che dice cosa fare. Feedway controlla ogni collegamento una volta al giorno, alle 4 di notte (ora italiana); **Sincronizza** sul collegamento rifà il controllo subito (al massimo una volta ogni 5 minuti).

| Stato | Messaggio | Cosa fare |
|---|---|---|
| **Attivo** | — | niente |
| **Da controllare** | — | è appena stato importato: il primo controllo arriva in pochi minuti. Se resta così, premi Sincronizza |
| **Attenzione** | «Quota di pubblicazione di Instagram esaurita» | Instagram concede 100 post nelle ultime 24 ore: aspetta |
| **Con problema** | «L'utente di sistema non ha un ruolo sulla Pagina» | nel Business Manager riassegna la Pagina all'utente di sistema con il controllo completo, poi Sincronizza |
| **Con problema** | «Manca un permesso Meta» | genera un nuovo token con i sei permessi e sostituiscilo ([rotazione-token-meta.md](rotazione-token-meta.md)) |
| **Con problema** | «L'account non è più assegnato a questo collegamento su Meta» | riassegnalo all'utente di sistema; se il cliente ha tolto l'accesso come partner, chiediglielo di nuovo |
| **Da ricollegare** | «Il token del collegamento non vale più» | il token è stato revocato o l'utente di sistema non c'è più: genera un token nuovo e premi **Ricollega** sul collegamento |
| **Da ricollegare** | «Il cliente ha tolto l'accesso a Meta» | chiedi al cliente di ridare l'accesso, poi Ricollega |
| **Inattivo** | — | l'account non compare più tra quelli dell'utente di sistema. Non si cancella, ma non torna attivo da solo e intanto non si può assegnare a un cliente. Riassegnalo all'utente di sistema su Meta, poi Aggiungi account → «Cerca nuovi account»: lo trovi tra quelli da importare e l'importazione lo riattiva |

In cima ad Account social, il riquadro **«Da sistemare su Meta»** ricorda anche il Data Use Checkup in scadenza, la versione della Graph API vicina al ritiro e i collegamenti che hanno smesso di funzionare.

**Non verificato:** il sottocodice che Meta dà a un token revocato. Feedway lo tratta come «Il token del collegamento non vale più».

## Vedi anche
- [rotazione-token-meta.md](rotazione-token-meta.md): sostituire il token dell'utente di sistema e il secret dell'app.
- [`docs/platforms/meta.md`](../platforms/meta.md): cosa è stato verificato su Meta vera e quando.
