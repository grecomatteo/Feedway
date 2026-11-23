# Portare l'app Meta in Live

Questo runbook serve all'Owner dell'agenzia. Con l'app Meta in **Sviluppo** i post che Feedway pubblica sulle Pagine Facebook li vede solo chi ha un ruolo nell'app ([D-119](../decisioni-aperte.md), [ADR 022](../adr/022-app-meta-in-live.md)). Su Instagram i post sono pubblici anche in Sviluppo. Qui si porta l'app in **Live con accesso standard**, che basta per le Pagine e gli Instagram del Business Manager dell'agenzia. L'**accesso avanzato** (verifica dell'azienda e App Review), che serve per i clienti fuori dal tuo Business, è in fondo e si fa più avanti.

Le voci della dashboard di Meta cambiano spesso nome: qui sono scritte come le mostra Meta in italiano, con l'inglese tra parentesi. Quello che non è ancora stato provato su Meta vera è scritto **non verificato**.

## Cosa serve prima

- L'app Meta dell'agenzia già collegata a Feedway ([Collegare Meta](meta-collegamento-account.md)) e il ruolo di **amministratore** dell'app su developers.facebook.com.
- Il ruolo **Owner** in Feedway, per l'interruttore «L'app è in Live».
- Gli indirizzi pubblici del sito di Feedway, pubblicato dal thread del sito (D-119 decisa (b)):
  - informativa privacy: `https://feedway.pages.dev/privacy`;
  - istruzioni per la cancellazione dei dati: `https://feedway.pages.dev/cancellazione-dati`;
  - termini di servizio: `https://feedway.pages.dev/termini` (Meta li chiede per il Live).

  Sono ancora **provvisori**: se usi un dominio tuo cambia solo la parte prima di `/privacy`. Apri tutti e tre in una finestra anonima prima di darli a Meta: devono aprirsi senza accesso e senza Tailscale.
- Un'icona quadrata **1024×1024** in PNG o JPG: il simbolo di Feedway del kit del marchio (`design/brief-feedway/brand/Feedway-Brand-Kit-v1.0/`), su fondo pieno.

## 1. Togli i post di prova

Con il Live **i post già pubblicati dall'app diventano visibili a tutti**. Prima di tutto:

1. Apri le Pagine Facebook su cui hai fatto le prove e cancella i post di prova (foto, più foto, reel, video, storie).
2. Fai lo stesso su Instagram se vuoi: lì erano già pubblici.

## 2. Compila le impostazioni di base

Su [developers.facebook.com/apps](https://developers.facebook.com/apps) apri l'app, poi **Impostazioni dell'app → Di base** (*App settings → Basic*):

1. **URL dell'informativa sulla privacy** (*Privacy Policy URL*): l'indirizzo dell'informativa.
2. **Eliminazione dei dati dell'utente** (*User data deletion*): scegli **URL delle istruzioni per l'eliminazione dei dati** (*Data deletion instructions URL*) e incolla l'indirizzo delle istruzioni. Feedway non ha una callback di cancellazione: le istruzioni dicono come chiederla.
3. **URL dei termini di servizio** (*Terms of Service URL*): l'indirizzo dei termini.
4. **Icona dell'app** (*App icon*): carica l'icona 1024×1024.
5. **Categoria** (*Category*): **Business e pagine** (*Business and pages*), o la più vicina che Meta propone.
6. **Email di contatto** (*Contact email*): un indirizzo che leggi.
7. Premi **Salva modifiche**.

## 3. Uso aziendale e Data Use Checkup

1. Se Meta chiede l'**uso aziendale** (*Business use*), scegli che l'app serve al **tuo business** (*Support my own business*): l'app pubblica per l'agenzia, non è venduta ad altri. **Non verificato**: Meta può chiederlo in un'altra pagina o non chiederlo.
2. Se nella dashboard compare il **Data Use Checkup** (*Verifica dell'utilizzo dei dati*), completalo: conferma che i permessi usati servono e che rispetti le regole della piattaforma. Meta lo richiede ogni anno.
3. Quando Meta mostra la scadenza del prossimo Data Use Checkup, scrivila in Feedway: **Impostazioni → Integrazioni → Meta → Sostituisci → Scadenza del Data Use Checkup**. Feedway ti avvisa 30 giorni prima.

## 4. Passa in Live

1. Nella dashboard dell'app apri **Pubblica** (*Publish*), oppure usa l'interruttore **Modalità app: Sviluppo / Live** (*App Mode*) in alto, secondo la versione della dashboard.
2. Meta controlla che i punti 2 e 3 siano a posto: se manca qualcosa lo dice e non passa. Correggi e riprova.
3. Conferma il passaggio. L'app ora è **Live**, con l'accesso **standard** a tutti i permessi.

## 5. Dillo a Feedway

Feedway non sa leggere la modalità dell'app: Meta non ha un campo documentato per farlo ([ADR 022](../adr/022-app-meta-in-live.md)).

1. Pannello → **Impostazioni → Integrazioni → Meta**.
2. Nel gruppo **App Meta** accendi **«L'app è in Live»**. Feedway chiede la password o la passkey, prova l'app con Meta e salva.
3. «In Sviluppo» in ambra accanto al titolo del gruppo sparisce, e la riga dice «I post su Facebook sono pubblici».

Se un giorno l'app torna in Sviluppo su Meta (per esempio dopo un Data Use Checkup scaduto), spegni l'interruttore: l'avviso torna.

## 6. Cosa controllare dopo

1. **Un post nuovo su Facebook si vede da fuori.** Pubblica da Feedway un post con il testo su una Pagina dell'agenzia. Aprilo da un profilo Facebook che **non** ha ruoli nell'app, o da una finestra anonima: deve vedersi nel diario della Pagina. Poi cancellalo se era una prova.
2. **Instagram resta pubblico.** Un post su Instagram si vede da un profilo esterno come prima.
3. **Il token dell'utente di sistema funziona come prima.** In Impostazioni → Integrazioni → Meta premi **Sincronizza** sul collegamento: deve restare verde, con gli stessi account e gli stessi permessi verdi. Se un permesso diventa rosso, genera di nuovo il token dell'utente di sistema ([Collegare Meta, passo 3](meta-collegamento-account.md#3-lutente-di-sistema-e-il-suo-token)).
4. **Facoltativo, per una tappa futura:** nel [Graph API Explorer](https://developers.facebook.com/tools/explorer/) scegli l'app, come token «Ottieni token dell'app» (*Get App Token*), e chiedi `GET /{app-id}?fields=app_ad_debug_info`. Se nella risposta c'è `is_app_in_dev_mode: false`, scrivilo nelle note della prova: Feedway potrà leggere la modalità da solo. Il campo non è nella documentazione di Meta (**non verificato**).

Gli esiti di questi controlli vanno nelle note della prova, con «verificato il …» o «non verificato».

## Accesso avanzato e App Review (più avanti)

Serve prima del **primo cliente vero** con Pagine o Instagram fuori dal Business Manager dell'agenzia (tappa 12, o prima se lo decidi). Secondo la documentazione di Meta, con l'accesso standard l'app lavora solo con gli account di chi ha un ruolo nell'app o nel suo Business; **non verificato**, perché il 12/11 la Pagina di un cliente partner si è collegata anche in Sviluppo.

Cosa serve, a grandi linee:

1. **Verifica dell'azienda** (*Business verification*) nel Business Manager: documenti dell'azienda, dominio o telefono.
2. **App Review** per ogni permesso con accesso avanzato: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `instagram_basic`, `instagram_content_publish`, `business_management`; più `pages_manage_engagement` e `pages_read_user_content` se si fa la copertina vera dei reel su Facebook (D-120.9).
3. Per ogni permesso un **video** che mostra come Feedway lo usa, e il testo che lo spiega.
4. Un modo per far vedere a Meta il pannello, che è chiuso in Tailscale: un account di prova raggiungibile da fuori o i soli video. È da decidere (D-119).

## Vedi anche

- [Collegare Meta e gli account dei clienti](meta-collegamento-account.md)
- [Rotazione del token Meta](rotazione-token-meta.md)
- [Prove su Meta vera](../platforms/meta.md)
