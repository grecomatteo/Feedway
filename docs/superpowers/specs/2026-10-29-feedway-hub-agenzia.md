# Feedway come hub per l'agenzia

Data: 2026-10-29 · Stato: **direzione di prodotto decisa da Matteo; versioni fissate nei piani, su delega di Matteo**

Questo documento raccoglie le decisioni prese da Matteo tra il 26 e il 29 ottobre 2026 sul futuro di Feedway dopo la 1.0. È il riferimento per i piani delle versioni successive. Non cambia la 1.0, salvo la caption per piattaforma (§11.2 della specifica) e il sito pubblico della tappa 10: motto, struttura della landing e modulo "Richiedi una demo" (§14.5, ADR 016). La specifica principale è [2026-10-15-feedway-design.md](2026-10-15-feedway-design.md) e rimanda qui da §18.8.

Regole di lettura:

- **Decisa**: Matteo l'ha scelta. Va pianificata in una versione.
- **Proposta**: idea valida e non ancora scelta. Serve una decisione prima di pianificarla.
- **Rimandata**: si riprende più avanti, nel momento indicato.
- **Scartata**: non si fa. Non va riproposta senza un motivo nuovo.

La versione in cui entra ogni funzione si fissa quando serve, cioè quando si scrive il piano di quella versione, partendo dall'ordine di riferimento del §9 (delega di Matteo, 2026-10-29).

## Indice

1. [La direzione](#1-la-direzione)
2. [Come si organizza l'app](#2-come-si-organizza-lapp)
3. [Clienti, portale e CRM](#3-clienti-portale-e-crm)
4. [Shooting](#4-shooting)
5. [Team, comunicazione e notifiche](#5-team-comunicazione-e-notifiche)
6. [Cruscotti e report](#6-cruscotti-e-report)
7. [Strumenti, community e pubblicità](#7-strumenti-community-e-pubblicità)
8. [Proposte, rimandate e scartate](#8-proposte-rimandate-e-scartate)
9. [Ordine proposto (non deciso)](#9-ordine-proposto-non-deciso)
10. [Landing e comunicazione](#10-landing-e-comunicazione)
11. [Permessi e dati: cosa cambia](#11-permessi-e-dati-cosa-cambia)
12. [Da verificare](#12-da-verificare)
13. [Fonti](#13-fonti)

## 1. La direzione

**Motto:** "Tutta la tua agenzia, in un solo posto." Deciso da Matteo il 2026-10-26. Vale per la landing, gli annunci e i video.

Feedway non è solo un programmatore di post. È il posto dove l'agenzia lavora ogni giorno: clienti, team, contenuti, shooting, pubblicazione e numeri. La pubblicazione verificata resta il pezzo fatto meglio di tutti.

Il confronto con i concorrenti mostra uno spazio libero:

- Gli strumenti social (Planable, Later, Metricool, Vista Social, SocialPilot) pubblicano bene. Non gestiscono ore, contratti, shooting o soldi.
- I gestionali per agenzie (Productive e simili) gestiscono ore e contratti. Non pubblicano.
- Feedway sta in mezzo.

Principi che restano:

- Solo API ufficiali. Ogni funzione che chiede permessi Meta in più segue la revisione dell'app.
- Isolamento tra agenzie (RLS) e permessi su ogni azione, come nella 1.0.
- Ogni area nuova è un **modulo** (§7.3 della specifica) che l'agenzia può accendere o spegnere. Una piccola agenzia non si trova un'app piena di sezioni vuote.

## 2. Come si organizza l'app

Tre regole:

1. **Tutto parte dal cliente.** Si sceglie il cliente in alto (il selettore del contesto esiste già) e ogni sezione si restringe a lui.
2. **Ognuno vede solo il suo.** Le voci si accendono in base al ruolo. Il copywriter non vede i conti e l'amministrazione non vede i post.
3. **L'agenzia accende solo ciò che usa.** Ogni area è un modulo.

Aree del menu (proposta di struttura):

| Area | Per chi | Contenuto |
|---|---|---|
| Oggi | Tutti | Cosa esce, problemi, ritardi, scadenze, approvazioni in attesa, shooting, richieste, annunci |
| Calendario | Team | Post e piano insieme, griglia Instagram, shooting, scadenze delle attività |
| Piano e idee | Team | Piano editoriale con stati di produzione, banca idee, rubriche, ricorrenze |
| Contenuti | Team | Nuovo post, libreria, brand kit dei clienti, archivio dei pubblicati |
| Clienti | Account | Pagina cliente (§3.1), materiali, approvazioni, richieste, discussione, documenti |
| Lavoro | Tutti | Le mie attività, revisione, carico del team, shooting, ore |
| Report | Account, titolare | Statistiche, report per il cliente, "lavoro svolto" |
| Agenzia | Owner, Admin | Team e ruoli, CRM, guide interne, impostazioni |

Sul telefono restano le cinque voci in basso già previste (Oggi, Calendario, + Nuovo, Notifiche, Menu).

## 3. Clienti, portale e CRM

### 3.1 Pagina del cliente (decisa)

Una pagina per ogni cliente che raccoglie tutto in blocchi. È il centro dell'hub e allarga la scheda cliente prevista nella 1.5 (§18.4 della specifica, `client_profiles`), che diventa la sua scheda operativa. Ha **due schede** (deciso il 2026-10-29):

- **Scheda operativa**, per tutti quelli che lavorano sul cliente, editor compresi: brief, tono di voce, colori, cose da evitare, guide (§5.4).
- **Scheda commerciale**, solo per chi ha accesso al CRM (§3.4): contratto, prezzo, scadenze, pagamenti, note riservate. Chi non ha il CRM non vede la scheda e non sa che esiste.

Blocchi della pagina:

| Blocco | Contenuto |
|---|---|
| Intestazione | Nome, stato, referente, responsabile interno, pacchetto, rinnovo |
| Cosa esce | Prossimi post, in ritardo, da approvare |
| Piano del mese | Contenuti pianificati e stato di produzione |
| Shooting | Ultimo, prossimo, fino a quando il cliente è coperto (§4.3) |
| Pacchetto | Contatore fatti / previsti / mancanti (§3.2) |
| Cliente | Approvazioni e richieste in attesa |
| Attività | Attività aperte e chi le ha |
| Guide e materiali | Brand kit, guide di editing |
| Discussione | La discussione del cliente (proposta, §8) |
| Solo CRM | Incassi, rinnovo, note riservate; dalla 1.3 numeri e post migliori |

All'inizio i blocchi sono fissi, con ordine e visibilità decisi dal ruolo. Più avanti si valuta se ognuno può riordinarli.

### 3.2 Contratto e pacchetto del mese (decisa)

Servizi inclusi nel contratto (per esempio 12 post e 8 storie al mese), durata, rinnovo con promemoria. Il contatore mostra cosa è stato fatto, cosa è previsto e cosa manca nel mese. È la base per la copertura degli shooting (§4.3) e per il cruscotto dell'agenzia (§6.2).

### 3.3 Portale del cliente (deciso il 2026-10-29)

È un'area con il marchio dell'agenzia dove il cliente trova solo ciò che l'agenzia decide di mostrargli, cliente per cliente. Allarga il link cliente della 1.0 (§11.10 della specifica).

- **Accesso con invito via email.** Il cliente riceve un invito, crea il suo accesso (password o passkey) ed entra col suo nome. Si può togliere l'accesso a una sola persona e si sa chi ha approvato cosa. Il link di sola visione della 1.0 resta disponibile.
- **Di default il cliente vede solo il calendario editoriale.** Ogni altra sezione la accende l'agenzia, cliente per cliente, con un interruttore.
- Sezioni possibili: Home (cosa esce e cosa aspetta lui), Calendario, Approvazioni (§18.7 della specifica), Materiali (§3.5), Report (§6.3), Richieste, Documenti.
- Dentro una sezione, ogni elemento ha "visibile al cliente" sì o no.
- **Mai visibili al cliente:** note interne, commenti del team, ore, costi, CRM, incassi.
- Indirizzo: un **sottodominio** di Feedway per agenzia (deciso il 2026-10-27). Serve solo quando Feedway si apre ad altre agenzie (2.0).

Si costruisce a blocchi: ogni sezione compare quando esiste la sua funzione.

**Da fissare nel piano:** con il portale, chi approva un post è la persona che ha fatto l'accesso. Il piano della 1.1 decide se l'approvazione dal link della 1.0 (§18.7) resta con il nome dichiarato o passa al portale.

### 3.4 CRM (deciso)

Il CRM è la parte commerciale dei clienti. Lo vedono **Owner e Admin**. Owner e Admin possono dare l'accesso anche ad altre persone scelte da loro, una per una, non a un ruolo intero (deciso il 2026-10-29).

- **C1 · Scheda commerciale.** Referente e contatti, pacchetto e prezzo, stato (potenziale, attivo, in pausa, chiuso), date di inizio e rinnovo, note riservate. Le note riservate non finiscono mai nel portale né nel link cliente.
- **C2 · Tabella di tutti i clienti.** Il cruscotto del titolare: una riga per cliente con stato, ultimo e prossimo shooting o "da pianificare", copertura, incassato e da incassare, rinnovo. Filtri per stato, responsabile e scadenze. Ordinamento per ritardo, rinnovo e incassi. Un clic apre la pagina del cliente.
- **C4 · Storico per cliente.** Una cronologia unica: shooting, post pubblicati, email inviate, incassi, note, cambi di stato, con chi ha fatto cosa e quando. Parte dal registro attività già previsto.

### 3.5 Altre funzioni decise sui clienti

- **Portale materiali.** Il cliente carica foto e video da un link e i file finiscono nella libreria del suo spazio, con gli stessi controlli di ogni upload (§9.2 della specifica).
- **Approvazione dei post.** Già scritta nella specifica (§18.7, versione 1.1), attivabile per cliente.
- **Offboarding del cliente.** A fine contratto: archivia lo spazio, scollega gli account e esporta materiali e storico per il cliente.
- **Cassaforte credenziali dei clienti.** Modulo a parte con cifratura dedicata, accesso per ruolo e registro di chi ha visto cosa. Nessuna password in chiaro, come già detto in §18.4 della specifica.

## 4. Shooting

Il planner degli shooting è un'idea di Matteo. È diviso in A1–A4 ed è collegato al CRM.

### 4.1 A1 · Calendario degli shooting (decisa)

Una vista unica con tutti gli shooting dell'agenzia: data, ora, luogo, cliente, persone assegnate (fotografo, videomaker, modelle o modelli, assistente), attrezzatura e stato. Gli stati sono proposto, confermato, svolto e annullato. Ognuno vede il suo, con i filtri. Gli shooting compaiono anche nel calendario generale.

### 4.2 A2 · Richiesta di shooting con accettazione (decisa)

1. Chi pianifica sceglie cliente, data e persona.
2. La persona riceve "Richiesta di shooting" nelle sue notifiche.
3. Accetta o rifiuta, con un motivo facoltativo.
4. Se accetta, lo shooting diventa **confermato** ed è visibile nel calendario. Chi ha proposto riceve un avviso.
5. Se rifiuta, lo shooting torna "da assegnare". Chi ha proposto riceve un avviso e sceglie un'altra persona.
6. Se nessuno risponde entro un tempo deciso (per esempio 24 ore), arriva un promemoria a chi ha proposto.

Lo stesso schema vale per tutte le richieste tra colleghi (§5.1).

### 4.3 A3 · Copertura dei clienti (decisa)

Per ogni cliente: fino a quando è coperto dagli shooting confermati e dal piano editoriale, confrontato con il pacchetto del mese. Esempio: "12 post al mese, coperti fino al 14 novembre, da pianificare dal 15". Sotto una soglia arriva un avviso. **Da fissare nel piano:** si conta in contenuti o in giorni.

### 4.4 A4 · Avvisi e email dallo shooting (decisa il 2026-10-29)

- Dal dettaglio dello shooting partono l'**invito** ("sei convocato il 12 alle 10, confermi?") e i **promemoria** ("domani alle 10 c'è lo shooting"). I testi nascono da modelli già compilati con data, luogo e nomi. Si possono vedere in anteprima e modificare.
- Partono **in automatico**. Prima del primo invio chi organizza sceglie, separatamente per l'invito e per il promemoria, se mandare **solo la notifica push** o **anche l'email**.
- **Scelta predefinita: solo push**, più l'avviso nel centro notifiche.
- La push arriva solo a chi ha un accesso a Feedway. Per un fotografo o una modella esterni serve l'email.
- Ogni invio resta nel registro e nello storico del cliente (C4).

## 5. Team, comunicazione e notifiche

### 5.1 Richieste tra colleghi e "il mio giorno" (decise)

- **T1 · Richieste di lavoro tra colleghi.** "Mi serve un grafico giovedì per il cliente X" diventa una richiesta che il collega accetta o rifiuta, con scadenza e stato. Usa lo schema di A2. Sostituisce i messaggi sparsi su WhatsApp.
- **T2 · Il mio giorno.** La pagina Oggi di ciascuno mostra anche i suoi shooting di oggi e di domani, le richieste da accettare e le scadenze.

### 5.2 Notifiche: canali (deciso il 2026-10-29)

- **Canali:** pannello (centro notifiche), **push sul telefono** (PWA), email, Telegram. Slack, Discord e WhatsApp **non si fanno per ora**.
- La push è un nuovo canale sull'interfaccia `NotificationChannel` già prevista (§12.1 della specifica). Su iPhone funziona solo con Feedway aggiunta alla schermata Home: da verificare sul dispositivo.
- **Al primo accesso** ognuno sceglie dove ricevere gli avvisi, anche solo push. Poi li cambia quando vuole da "Il mio account".

### 5.3 Bacheca annunci (decisa)

- Chi scrive un annuncio sceglie **a chi arriva** (tutti, un ruolo, persone scelte) e **come**: solo nell'app, oppure anche per email o push.
- L'annuncio compare nel centro notifiche di ognuno e nella pagina Oggi. Serve il "segna come letto".
- Un annuncio **urgente** arriva anche durante le ore di silenzio (deciso il 2026-10-29). Gli altri le rispettano.

### 5.4 Guide interne e linee di editing (decise)

Pagine di istruzioni per chi lavora, su due livelli:

- **Generali dell'agenzia**: come si monta un reel, formati, sottotitoli, font, durate, musiche, nomi dei file.
- **Per cliente**: stile, esempi approvati e da evitare, parole da non usare, ritmo di montaggio.

Una guida ha testo, immagini, video di esempio e checklist. Si collega a un cliente, a un tipo di contenuto o a un ruolo. Quando si assegna un'attività o un contenuto, compare la guida da seguire. Ogni guida ha versioni e data di revisione, e chi l'aveva letta riceve un avviso quando cambia. **Da fissare nel piano:** chi può modificarle e se serve la conferma "ho letto".

### 5.5 Calendario esportabile e collegabile (deciso il 2026-10-29)

Due modi, **entrambi**, sempre con gli stessi filtri: cliente, persona, tipo (post, shooting, attività, ferie), periodo.

- **Esporta:** scarica un file `.ics` da aprire in Google Calendar, Apple Calendar o Outlook. È una copia di quel momento.
- **Collega:** un indirizzo privato e revocabile da incollare una volta in Google o Apple Calendar. Gli eventi restano aggiornati da soli (Google aggiorna di solito dopo alcune ore). È solo in lettura.

La modifica a due vie (cambi in Google e cambia anche Feedway) non è prevista.

## 6. Cruscotti e report

### 6.1 "La mia giornata" (decisa)

La prima pagina quando si apre Feedway. Mostra solo ciò che riguarda la persona: post che escono oggi, problemi, ritardi, scadenze di oggi e domani, i suoi shooting e le richieste da accettare, le approvazioni che la riguardano, gli annunci. Per l'account manager mostra anche i clienti sotto il pacchetto del mese. Esempio: "Hai 2 shooting questa settimana, 1 richiesta da accettare, 3 contenuti in ritardo per Forno Luce."

### 6.2 Cruscotto dell'agenzia (deciso)

Per Owner e Admin. È una vista dall'alto: puntualità (contenuti usciti in orario nell'ultimo mese), consegne sul contratto per cliente, clienti a rischio (in ritardo sul pacchetto, rinnovo vicino, incassi in ritardo), carico del team, shooting in arrivo.

### 6.3 Report "lavoro svolto" (deciso)

Per il cliente, ogni mese. Racconta cosa è stato fatto, accanto ai numeri: contenuti pubblicati con il link, shooting svolti, richieste evase, materiali ricevuti, approvazioni. Dalla 1.3 si aggiungono i numeri dei profili. Si compila da solo e l'agenzia lo modifica prima di inviarlo. Usa i modelli di report di §18.5 della specifica. Esempio: "A ottobre abbiamo pubblicato 12 contenuti su 12 previsti e fatto 1 shooting."

## 7. Strumenti, community e pubblicità

### 7.1 Strumenti (decisi)

- **S1 · Estrattore di fotogrammi.** Funziona **solo nel browser**: il video non viene caricato sul server. Si sceglie ogni quanto estrarre un'immagine, si vede una griglia di fotogrammi e quelli scelti vanno nella libreria del cliente o diventano la copertina del reel. Estende la copertina con fotogramma (RF-37). Da verificare: quali formati legge il browser (l'HEVC dell'iPhone potrebbe non funzionare).
- **S4 · Compressore video.** Crea una versione leggera di un video da mandare al cliente. Funziona **nel browser**, come S1 (deciso il 2026-10-29). È da provare: va verificato cosa regge il browser.
- **S5 · QR e link brevi.** Un QR per un link (calendario cliente, link in bio, locandina). Si fanno se possibile.

### 7.2 Testi sulle immagini (confermato il 2026-10-29)

La regola di §18.5 della specifica resta: Feedway non aggiunge testi, filtri o grafica alle immagini. Le copertine con titolo, anche quelle dei reel, si preparano fuori (per esempio in Canva) e si caricano già pronte.

### 7.3 Community e pubblicità (decise, da ragionare)

Matteo le vuole. Il "come" va approfondito prima di pianificarle.

- **Registro delle sponsorizzate.** Solo un registro manuale: budget approvato, speso, periodo, link all'annuncio. Non si leggono le API Ads.
- **Gestione influencer.** Creator con contatti, campagne, compensi, consegne attese e post da controllare. Da chiarire se servono anche contratti e pagamenti.
- **Recensioni e scheda Google Business.** Servono le API di Google Business Profile, con un accesso da richiedere (da verificare). Da chiarire se basta leggere con avviso o se serve rispondere dal pannello.
- **Avvisi su commenti negativi.** Leggere i commenti richiede permessi Meta in più e segue la revisione dell'app. Da chiarire se si usano parole chiave per cliente o un'analisi automatica.

## 8. Proposte, rimandate e scartate

### 8.1 Proposte ancora da scegliere

Priorità consigliate: P1 prima, P3 ultime.

| Area | Proposta | Priorità |
|---|---|---|
| Contenuti | Banca idee e rubriche ricorrenti | P1 |
| Produzione | Stati di produzione con un responsabile per passo (idea, testo, grafica, revisione, pronto) | P1 |
| Produzione | Coda di revisione interna | P1 |
| Comunicazione | Discussione per cliente (sostituisce il gruppo WhatsApp del team) | P1 |
| Comunicazione | Conversazioni col cliente separate da quelle interne | P1 |
| Agenzia | Ricerca globale (Ctrl+K) | P1 |
| Contenuti | Brand kit del cliente; calendario di ricorrenze e festività | P2 |
| Produzione | Carico di lavoro del team; modelli di progetto | P2 |
| Clienti | Richieste del cliente; checklist di onboarding; documenti condivisi | P2 |
| Agenzia | Ore lavorate per cliente; redditività per cliente | P2 |
| Persone | Ferie e assenze; collaboratori esterni con accesso limitato; passaggio di consegne | P2 |
| Produzione creativa | Revisione grafica con note sull'immagine; archivio dei pubblicati cercabile | P2 |
| Automazioni | Regole "se succede questo, fai quello" | P2 |
| Shooting | A5 · Checklist e brief per chi va sul campo | P2 |
| Contenuti | Diritti e scadenze delle immagini | P3 |
| Comunicazione | Disponibilità del team | P3 |
| AI | Bozza di piano dal brief | P3 |
| Agenzia | Preventivi e listino; collegamento alla fatturazione elettronica; scadenziario degli incassi; spese per cliente; firma dei contratti | P3 |
| Cliente | Soddisfazione del cliente; raccolta di contenuti dai clienti finali (UGC) | P3 |
| Persone | Inserimento dei nuovi arrivati | P3 |
| Produzione creativa | Moodboard per cliente; inventario dell'attrezzatura | P3 |
| Automazioni | Integrazioni pronte (Zapier, Make, n8n) | P3 |
| Shooting | A7 · Cernita dei file dello shooting | P3 |
| CRM | C3 · Incassi e solleciti (non scelta per ora) | P3 |

### 8.2 Rimandate

- **Casella unica di commenti e messaggi.** Si fa insieme alla revisione dell'app Meta per i permessi in più.
- **Tutta l'area Vendite** (pipeline dei potenziali clienti, proposta commerciale da modello, da "firmato" a cliente attivo, audit gratuito del profilo, portfolio e casi studio). Si riprende quando il prodotto è pronto.

### 8.3 Scartate

- **Slack, Discord e WhatsApp come canali di notifica**: per ora bastano push, email e Telegram (2026-10-29).
- **Liberatorie e consensi (A6)**: non servono e non compaiono da nessuna parte (2026-10-29).
- **Filigrana sulle anteprime (S2)** (2026-10-27).
- **Galleria di selezione delle foto per il cliente (S3)** (2026-10-27).

## 9. Ordine di riferimento

Il 2026-10-29 Matteo ha delegato la scelta delle versioni: si fissano quando è adatto e necessario, cioè quando si scrive il piano di una versione, partendo da questo ordine. Chi scrive il piano aggiorna la tabella §18.2 della specifica e spiega nella PR ogni spostamento. Le voci *Da scegliere (§8.1)* della tabella sono proposte: entrano in un piano solo dopo essere state scelte da Matteo. Le scelte che cambiano il prodotto (aggiungere o togliere una funzione) restano sue.

| Versione | Oggi nella specifica | Ordine di riferimento |
|---|---|---|
| 1.0 | Pubblicazione, piano editoriale, link cliente, notifiche | Uguale. Già decisi: caption per piattaforma e nuova landing (§10) |
| 1.1 | Ricorrenti, webhook, link in bio, Google, commenti del team, editor immagini, preset | In più: pagina Oggi, approvazione del cliente, calendario esportabile. *Da scegliere (§8.1):* revisione interna, ricerca globale |
| 1.2 | Primo commento, Drive e Canva | Anticipa la 1.5: attività, pagina cliente con contratto, portale materiali. Drive e Canva slittano. *Da scegliere (§8.1):* stati di produzione, discussione del cliente, banca idee |
| 1.3 | Statistiche, report, orario migliore, concorrenti | In più: report "lavoro svolto". *Da scegliere (§8.1):* ore e redditività, carico del team |
| 1.4 | AI per caption, server MCP | *Da scegliere (§8.1):* bozza di piano dal brief |
| 1.5 e oltre | Strumenti di agenzia, altri social | Shooting e CRM se non anticipati, cassaforte credenziali, altri social |

Su shooting e CRM l'ordine di riferimento è: prima S1, poi A1 e A2 (servono anche a T1), poi C1 e C2.

## 10. Landing e comunicazione

Decisioni:

- Titolo della landing e chiusura: il motto "Tutta la tua agenzia, in un solo posto."
- Azione principale: **"Richiedi una demo"** (Matteo, 2026-10-27). "Accedi" resta l'azione di servizio.
- Le funzioni non ancora pronte si mostrano con l'etichetta "In arrivo". Non si promette ciò che non c'è.

- "Richiedi una demo" apre un **modulo**: chi è interessato inserisce i suoi dati e a Matteo arriva un'email per parlarne (Matteo, 2026-10-29). Il sito non salva le richieste e resta senza cookie. Soluzione tecnica in ADR 016, accettata.

Prezzi e prova gratuita restano aperti, come nella specifica.

Struttura della landing, **decisa da Matteo il 2026-10-29** (il dettaglio per sezione è nel brief `design/brief-feedway/04-BRIEF-LANDING.md`):

1. **Apertura.** "Tutta la tua agenzia, in un solo posto." Clienti, team, contenuti e pubblicazioni in un'app sola. Visual: la pagina Oggi.
2. **Il problema.** Sei app aperte (WhatsApp, Drive, Excel, Meta), nessuna che sappia cosa fanno le altre.
3. **Un posto per ogni cosa.** Sei schede: Pianifica, Produci, Fai approvare, Pubblica e verifica, Misura, Gestisci l'agenzia.
4. **Per chi lavora con te.** Ogni ruolo vede solo quello che gli serve.
5. **Il tuo cliente.** Il suo spazio con il marchio dell'agenzia: calendario, approvazioni, materiali, report.
6. **Pubblica senza dubbi.** Verifica dopo l'uscita e caption per piattaforma.
7. **I numeri dell'agenzia** ("In arrivo"). Ore, contratti, margine per cliente.
8. **Come si comincia.** Tre passi.
9. **Fiducia.** API ufficiali, passkey, registro delle azioni, agenzie isolate.
10. **Domande frequenti.**
11. **Chiusura.** Il motto e "Richiedi una demo".

Idee per annunci e video, ancora da sviluppare: un video di 30 secondi "Una giornata" (dalle sei app a Feedway), e ganci come "Quante app apri prima delle 9? Noi una." oppure "Il cliente approva dal telefono. Tu smetti di rincorrerlo."

## 11. Permessi e dati: cosa cambia

Indicazioni per i piani. I nomi sono provvisori. Ogni tabella nuova ha `organization_id` e RLS, e ogni area è un modulo (§7.3 della specifica).

- **Permessi nuovi:** `crm.view`, `crm.edit` (Owner e Admin più le persone aggiunte una per una), permessi per shooting, richieste, guide, annunci e portale.
- **Accesso del cliente al portale:** è un tipo di utente esterno legato a uno spazio, distinto dai ruoli dell'agenzia, con le sole sezioni accese. Va progettato con una ADR prima del piano.
- **Da fissare nelle ADR** (osservazioni dalla tappa 2, 2026-10-29):
  - *Permessi per persona.* Oggi `can()` decide solo dalla matrice ruolo×permesso e la batteria di isolamento nasce da quella. Servono una tabella di concessioni (con `organization_id` e RLS), un `can()` che la legga e la batteria estesa. Proposta: una concessione cade quando la persona cambia ruolo o viene disattivata. Concessioni e revoche vanno nel registro attività.
  - *Utenti esterni.* Un'email corrisponde a un solo account per tutte le agenzie, quindi un referente del cliente può essere anche membro di un'agenzia. Proposta: un tipo di appartenenza separato, legato allo spazio, che `can()` non tratta mai come ruolo dell'agenzia. Da decidere per gli esterni: chi riceve l'avviso del blocco "Non sono stato io" e se la 2FA è obbligatoria.
  - *Push.* Le email di sicurezza restano sempre email e non si possono disattivare.
- **Notifiche:** un nuovo canale push. Preferenze scelte al primo accesso. Un livello "urgente" per gli annunci che supera le ore di silenzio. La scelta del canale (push o email) per invito e promemoria dello shooting.
- **Moduli probabili:** `clients` (pagina cliente, contratto, CRM), `shooting`, `requests` (A2 e T1), `guides`, `announcements`, `portal`. I confini si decidono nelle ADR dei piani.

## 12. Da verificare

Ciò che segue non è stato provato.

- Notifiche push della PWA su iPhone (servono l'aggiunta alla schermata Home e una versione recente di iOS).
- Formati video che il browser legge per S1 e S4, in particolare l'HEVC dell'iPhone, e i limiti di memoria con video lunghi.
- Accesso alle API di Google Business Profile.
- Permessi Meta per leggere i commenti, legati alla revisione dell'app.
- Ogni stima di sforzo nella pagina di lavoro è fatta a occhio.

## 13. Fonti

- Pagina di lavoro con le proposte e le decisioni, condivisa con Matteo tra il 26 e il 29 ottobre 2026.
- Specifica principale, §2.4, §4, §10–12, §18.
- Concorrenti consultati: Planable, Later, Metricool, Vista Social, SocialPilot, Cloud Campaign, ZoomSphere, Productive.
