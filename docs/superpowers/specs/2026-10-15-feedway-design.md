# Feedway · Documento di progetto

| | |
|---|---|
| **Stato** | v9 · multi-agenzia, moduli, account personale con Better Auth, sito pubblico, strumenti di agenzia in 1.5 · **approvata da Matteo il 2026-10-15** |
| **Data** | 2026-10-15 |
| **Autore** | Claude, per Matteo |
| **Prossimo passo** | Progetto grafico in Pencil e sviluppo a tappe (piani in `docs/superpowers/plans/`) |

---

## Indice

1. [Sintesi](#1-sintesi)
2. [Obiettivi, vincoli e criteri di successo](#2-obiettivi-vincoli-e-criteri-di-successo)
3. [Glossario](#3-glossario)
4. [Requisiti funzionali](#4-requisiti-funzionali)
5. [Requisiti non funzionali](#5-requisiti-non-funzionali)
6. [Architettura](#6-architettura)
7. [Struttura del codice e stack](#7-struttura-del-codice-e-stack)
8. [Integrazione con Meta](#8-integrazione-con-meta)
9. [Contenuti, controlli e pubblicazione](#9-contenuti-controlli-e-pubblicazione)
10. [Utenti, ruoli e permessi](#10-utenti-ruoli-e-permessi)
11. [Funzionalità del pannello](#11-funzionalità-del-pannello)
12. [Notifiche](#12-notifiche)
13. [Modello dati](#13-modello-dati)
14. [UI/UX](#14-uiux)
15. [Sicurezza e privacy](#15-sicurezza-e-privacy)
16. [Infrastruttura e operazioni](#16-infrastruttura-e-operazioni)
17. [Qualità e test](#17-qualità-e-test)
18. [Roadmap e ordine di sviluppo](#18-roadmap-e-ordine-di-sviluppo)
19. [Decisioni prese](#19-decisioni-prese)
20. [Rischi e punti da verificare](#20-rischi-e-punti-da-verificare)
21. [Cosa servirà da te](#21-cosa-servirà-da-te)
22. [Fonti](#22-fonti)

---

## 1. Sintesi

**Feedway** è un pannello web self-hosted per pianificare e pubblicare contenuti su **Instagram** e **Pagine Facebook** tramite le **API ufficiali Meta**, senza aprire Meta.

- Carichi foto, caroselli, reel e storie, scrivi la caption, scegli gli account, vedi l'anteprima e programmi.
- Il sistema pubblica all'orario, **verifica** qualche minuto dopo che il post sia davvero online e ti avvisa nel pannello, su Telegram e via email.
- È **multi-cliente e multi-utente**: ogni cliente è uno spazio di lavoro, ogni utente ha ruoli e permessi per spazio.
- È **predisposto per più agenzie**: ogni agenzia è un'organizzazione con dati, account Meta, integrazioni e brand propri, isolata dalle altre anche a livello di database (§6.5). Nella 1.0 c'è la tua; aprire la piattaforma ad altre agenzie è la versione 2.0.
- I clienti ricevono un **link di sola visione** del proprio calendario.
- Un **sito pubblico** presenta Feedway e porta all'accesso; è separato dal pannello, che resta privato (§14.5).
- Tutto si configura **dal pannello** con procedure guidate: nessuno tocca codice o file.
- Gira in **Docker** sulla tua VPS (2 core, 12 GB) accanto agli altri servizi, esposto con **Tailscale** e/o **Cloudflare Tunnel**.

Scelte tecniche chiave: TypeScript, Nuxt (pannello + API), worker Node separato, PostgreSQL con coda di lavori integrata (pg-boss), architettura a livelli, API-first (pronta per un futuro server MCP).

---

## 2. Obiettivi, vincoli e criteri di successo

### 2.1 Obiettivi

1. Pubblicare e programmare su IG e FB tutti i formati (foto, carosello, reel, storia) da un'unica schermata, con lo **stesso contenuto identico** su tutte le destinazioni scelte.
2. Scoprire **prima** di programmare ogni problema prevedibile e proporre una soluzione.
3. Sapere **sempre** se un post è uscito davvero, con notifiche ovunque.
4. Lavorare in team con permessi chiari, e condividere il calendario con i clienti.
5. Massima semplicità d'uso, anche da telefono, e massima affidabilità e sicurezza.

### 2.2 Vincoli

| Vincolo | Conseguenza |
|---|---|
| Solo API ufficiali Meta | Niente funzioni non offerte dalle API (musica della libreria IG, filtri, profili personali FB) |
| Account Meta (con o senza Pagina) | Accesso tramite **collegamento** per account: login Facebook, login Instagram oppure **utente di sistema** con token che non scade (§8.0, ADR 015) |
| Meta scarica i file da un URL pubblico | Serve un **host pubblico** separato dal pannello privato |
| Instagram non ha programmazione nativa via API | La programmazione la gestisce Feedway |
| VPS condivisa, 2 core e 12 GB | Limiti di CPU e memoria per ogni container; conversioni video una alla volta |
| Esposizione tramite Tailscale / Cloudflare Tunnel | Nessuna porta aperta sulla VPS |
| Backup della VPS con rclone su Google Drive | Il database va salvato con un dump coerente in una cartella inclusa in rclone |

### 2.3 Criteri di successo

| # | Criterio |
|---|---|
| CS1 | Un reel programmato alle 18:00 su 3 account IG e 2 Pagine FB è online ovunque alle 18:00 (±1 minuto). |
| CS2 | Ogni problema prevedibile (formato, durata, proporzioni, limiti) è segnalato prima di programmare. |
| CS3 | Entro pochi minuti dall'orario ogni destinazione è **Confermata** o **Con problema**, e lo sai nel pannello, su Telegram e via email. |
| CS4 | Un "Riprova" non crea mai doppioni; un riavvio di qualsiasi container non causa post persi né doppi. |
| CS5 | Ogni utente vede e fa solo ciò che il suo ruolo consente; il controllo avviene sul server. |
| CS6 | Un cliente dal suo link vede solo il proprio calendario e non può modificare nulla. |
| CS7 | Dopo l'installazione, aggiungere account, utenti e integrazioni non richiede di toccare codice o file. |
| CS8 | Il token Meta non esce mai dal server e non compare nei log. |
| CS9 | Il database si ripristina da backup con una procedura documentata e provata. |
| CS10 | Caricare e programmare un post da telefono è comodo quanto da computer. |
| CS11 | Un utente di un'agenzia non vede né modifica mai dati di un'altra, nemmeno con un ID indovinato o per un errore in una query. |

### 2.4 Fuori dalla prima versione

Previsti nelle versioni successive (§18.2): primo commento automatico, post ricorrenti, webhook in uscita, commenti del team sui post, editor immagini di base, preset di pubblicazione, importazione da Google Drive e Canva, analisi dei concorrenti, modelli di report, altri social come moduli (§18.6), pagina link in bio, statistiche e report, orario migliore per pubblicare, assistente AI per caption, server MCP, strumenti di agenzia (attività, to-do, schede cliente, §18.4).

Esclusi: approvazione o commenti dei clienti (scelta tua: solo visione), modifica della caption dopo la pubblicazione (Instagram via API non lo consente), caption diverse per piattaforma, tag di persone/luoghi/prodotti, ruoli personalizzati dall'interfaccia. Registrazione libera di nuove agenzie, abbonamenti e login con Facebook sono nella versione 2.0 (§18.2).

---

## 3. Glossario

| Termine | Significato |
|---|---|
| **Organizzazione** (nel pannello: **Agenzia**) | Il livello più alto: un'agenzia con i propri utenti, clienti, account Meta, integrazioni e brand. Nessun dato è condiviso tra organizzazioni. |
| **Amministratore della piattaforma** | Chi gestisce l'installazione (tu): crea e sospende organizzazioni e ne vede l'uso, ma non i contenuti, se non è membro. |
| **Spazio di lavoro** | Gruppo di account social di un'organizzazione, di norma un cliente. Un account può stare in più spazi della stessa organizzazione. |
| **Profilo** | Nel pannello, un account Instagram insieme alla Pagina Facebook che Meta stessa gli collega (stesso `page_id`, §8.4 e §13), mai abbinati per nome. È solo un raggruppamento dell'interfaccia: nei dati restano due account e due destinazioni. Si forma **sempre dentro uno spazio** e solo con gli account assegnati a quello spazio: se l'altro account del collegamento non è nello spazio, o è inattivo, il profilo ha un solo account e dell'altro non si mostra né il nome né l'esistenza. |
| **Contesto attivo** | Ciò che stai guardando nell'agenzia corrente: "Tutti i clienti", un cliente (spazio) o un singolo profilo. Restringe pannello e calendario a quella scelta (§14.6). |
| **Contenuto pianificato** | Segnaposto sul calendario per un contenuto che non esiste ancora (giorno, tipo, titolo), creato nel **Piano editoriale** (§11.12). Diventa un post quando qualcuno lo prepara. |
| **Destinazione** | Un post su un singolo account. Un post con 5 account ha 5 destinazioni, ognuna con il proprio stato. |
| **Utente di sistema** | Utente tecnico creato in Business Manager; il suo token permette a Feedway di pubblicare senza login ripetuti. È uno dei tre tipi di collegamento (§8.0). |
| **Collegamento** | Il modo in cui Feedway ottiene l'accesso a un account social: login Facebook, login Instagram o utente di sistema (§8.0). Ogni account ne ha uno. |
| **Container** | Su Instagram, il contenuto preparato da Meta prima della pubblicazione. Scade dopo 24 ore. |
| **Host pubblico** | Indirizzo raggiungibile da internet che serve solo i file per Meta (`/m/*`) e i link cliente (`/share/*`). |
| **Pannello** | L'interfaccia per il team, privata (Tailscale o Cloudflare Access). |
| **Sito pubblico** | Le pagine di presentazione di Feedway (landing e pagine legali), statiche e separate dal pannello, con il pulsante "Accedi" che porta al pannello (§14.5). |
| **Worker** | Processo in background che esegue i lavori: conversioni, pubblicazione, verifica, notifiche. |
| **Fascia oraria** | Orario abituale di pubblicazione di un cliente, usato per la coda e la programmazione in blocco. |

---

## 4. Requisiti funzionali

Ogni requisito ha un codice usato nel piano di sviluppo e nei test.

### Configurazione e onboarding
| Codice | Requisito |
|---|---|
| RF-01 | Installazione con un solo script che genera chiavi e password interne. |
| RF-02 | Collegamento degli account Meta con login Facebook, login Instagram o utente di sistema (5 passi: app Meta, utente di sistema, assegnazione asset, token, importazione account). Ogni passo ha un controllo automatico. |
| RF-03 | Procedura guidata "Aggiungi account" per account già nel Business o di clienti con Business proprio. |
| RF-04 | Procedura guidata "Invita utente". |
| RF-05 | Integrazioni Meta, Telegram ed email configurabili dal pannello, con pulsante "Prova". |

### Utenti e accesso
| Codice | Requisito |
|---|---|
| RF-10 | Ruoli nell'organizzazione (Owner, Admin, Member) e ruoli per spazio (Manager, Publisher, Editor, Viewer). |
| RF-11 | Inviti con link monouso, accesso con passkey o password, 2FA obbligatoria per l'amministratore della piattaforma, Owner e Admin, sessioni revocabili. |
| RF-15 | Account personale: nome, soprannome, foto profilo, cambio email verificato, dispositivi collegati, email di sicurezza, "Scarica i miei dati" ed "Elimina il mio account" (§10.5, §15.7). |
| RF-12 | Registro attività di tutte le azioni rilevanti. |
| RF-13 | Organizzazioni isolate: un utente può appartenere a più organizzazioni e passa dall'una all'altra; ogni organizzazione ha integrazioni, brand, impostazioni e limiti propri. |
| RF-14 | Amministrazione della piattaforma: creare un'organizzazione con il suo Owner, sospenderla, impostarne i limiti (nella 1.0 da comando; pannello dedicato nella 2.0). |

### Account social
| Codice | Requisito |
|---|---|
| RF-20 | Sincronizzazione degli account dal token e assegnazione agli spazi. |
| RF-21 | Stato di salute di ogni account (token, permessi, quota) e promemoria Meta. |

### Media e post
| Codice | Requisito |
|---|---|
| RF-30 | Upload a pezzi con ripresa, anche da telefono. |
| RF-31 | Analisi automatica dei file e correzioni (conversione HEIC/PNG, sRGB, EXIF, ricompressione, faststart). |
| RF-32 | Tipi: foto, carosello (2–10), reel, storia, su IG e FB. Contenuto identico su tutte le destinazioni. |
| RF-33 | Controlli a tre livelli (blocco, avviso con scelta, correzione) con riepilogo per destinazione. |
| RF-34 | Anteprima per piattaforma in stile Meta, con ritaglio reale e zone coperte dall'interfaccia. |
| RF-35 | Bozze con salvataggio automatico; modifica e annullamento dei post programmati. |
| RF-36 | Reel anche nel feed di default, disattivabile per post. |
| RF-37 | Copertina dei reel: fotogramma scelto con un cursore o immagine caricata (anche trascinandola), con anteprima. |
| RF-38 | Anteprima riproducibile di ogni video caricato (MP4 o MOV, anche HEVC dell'iPhone) nell'editor e nel dettaglio. |

### Pianificazione
| Codice | Requisito |
|---|---|
| RF-40 | Calendario mese (predefinita da computer)/settimana (dettagliata)/elenco (predefinita da telefono), con libreria apribile da un pulsante e filtri per cliente, account, piattaforma, tipo, stato, autore, etichetta; spostamento trascinando. |
| RF-41 | Anteprima della griglia Instagram con post programmati e pubblicati, riordinabile. |
| RF-42 | Fasce orarie per cliente e "prossima fascia libera". |
| RF-43 | Programmazione in blocco: da più file, da CSV/Excel, duplicando post. |
| RF-44 | Etichette colorate, note interne, modelli di caption/firme/hashtag, gruppi di account salvati. |
| RF-45 | Libreria media per cliente con cartelle e tag. |
| RF-46 | Piano editoriale: contenuti pianificati (giorno, tipo, titolo) visibili sul calendario come "Da preparare" e trasformabili in post con un clic (§11.12). |

### Pubblicazione e verifica
| Codice | Requisito |
|---|---|
| RF-50 | Pubblicazione puntuale con preparazione anticipata. |
| RF-51 | Tentativi automatici, gestione dell'esito incerto, "Riprova" senza doppioni. |
| RF-52 | Verifica dopo la pubblicazione: stato **Confermato** o **Con problema**. |

### Notifiche e condivisione
| Codice | Requisito |
|---|---|
| RF-60 | Centro notifiche nel pannello con storico e stato di consegna. |
| RF-61 | Notifiche Telegram (solo team) ed email, con preferenze per utente e raggruppamento. |
| RF-62 | Riepilogo giornaliero. |
| RF-63 | Link di sola visione del calendario di un cliente, con password, scadenza e revoca. |

### Aspetto
| Codice | Requisito |
|---|---|
| RF-70 | Tema chiaro, scuro e automatico. |
| RF-71 | Logo e colore del brand nel pannello, nelle email, nel bot e nel link cliente. |
| RF-72 | Pannello installabile come app sul telefono (PWA). |
| RF-73 | Sito pubblico di presentazione con pulsante "Accedi" verso il pannello, pagine legali, indicizzato dai motori di ricerca, senza cookie (§14.5). |

---

## 5. Requisiti non funzionali

| Codice | Area | Requisito |
|---|---|---|
| RNF-01 | Affidabilità | Nessun post perso o doppio dopo riavvii, errori di rete o lavori interrotti. |
| RNF-02 | Puntualità | Pubblicazione entro 1 minuto dall'orario. |
| RNF-03 | Sicurezza | Autorizzazione sul server, segreti cifrati, container isolati, superficie pubblica minima (§15). |
| RNF-04 | Privacy | Solo i dati necessari, EXIF rimossi, media cancellati dopo la pubblicazione (§15.7). |
| RNF-05 | Prestazioni | Pannello caricato in meno di 2,5 s su un telefono di fascia media. |
| RNF-06 | Risorse | Al massimo 1 core e circa 4 GB di RAM per tutto Feedway (§16.6). |
| RNF-07 | Accessibilità | WCAG 2.2 AA su tutte le schermate. |
| RNF-08 | Manutenibilità | Architettura a livelli verificata in CI, TypeScript strict, test automatici, ADR. |
| RNF-09 | Operatività | Configurazione solo dal pannello, aggiornamenti con un comando, backup e ripristino provati. |
| RNF-10 | Osservabilità | Log strutturati, controlli di salute, sorveglianza esterna. |
| RNF-11 | Estendibilità | API versionata e documentata, pronta per MCP e nuovi canali di notifica. |
| RNF-12 | Lingua | Interfaccia in italiano. Fuso di riferimento Europe/Rome; date salvate in UTC. |
| RNF-13 | Scalabilità | Nessuno stato nei processi: web e worker si moltiplicano senza modifiche al codice; crescita gestita come in §6.4. |
| RNF-14 | Isolamento | Nessun dato di un'organizzazione è leggibile o modificabile da un'altra, nemmeno per un errore nel codice: doppia barriera applicazione + database (§6.5). |

---

## 6. Architettura

### 6.1 Componenti

```
                          Internet
            ┌────────────────┴────────────────┐
            │ host pubblico                   │ pannello (privato)
            │ /m/*  media per Meta            │
            │ /share/*  link clienti          │
     ┌──────▼───────┐                  ┌──────▼───────┐
     │ cloudflared  │                  │  tailscale   │
     └──────┬───────┘                  └──────┬───────┘
            └──────────────┬───────────────────┘
                 rete "edge"│ http://web:3000
                   ┌────────▼─────────┐
                   │ web (Nuxt)       │
                   │ pannello + API   │
                   └────────┬─────────┘
                 rete "internal" (nessun accesso a internet)
         ┌──────────────────┼────────────────────┐
 ┌───────▼───────┐  ┌───────▼────────┐  ┌────────▼──────┐
 │ worker (Node) │  │ postgres 18    │  │ backup        │
 │ pg-boss,      │  │ dati + coda    │  │ pg_dump       │
 │ ffmpeg        │  └────────────────┘  └───────────────┘
 └───────┬───────┘
         │ rete "egress": Meta, Telegram, SMTP, sorveglianza esterna
   volume media condiviso tra web e worker
```

| Componente | Compito |
|---|---|
| **web** | Pannello, API `/api/v1`, upload a pezzi. Sull'host pubblico serve solo `/m/*` e `/share/*`. Unico container raggiungibile dall'esterno. |
| **worker** | Lavori in coda: elaborazione media, preparazione, pubblicazione, verifica, notifiche, sincronizzazione, pulizia, riepiloghi. Nessuna porta esposta. |
| **postgres** | Dati e coda lavori. Solo rete interna. |
| **migrate** | Applica le migrazioni e termina; web e worker partono solo dopo. |
| **backup** | Dump notturno del database nella cartella inclusa in rclone. |
| **cloudflared / tailscale** | Esposizione verso internet (§16.1). |
| **sito** | Sito pubblico statico su Cloudflare Pages: **non gira sulla VPS** e non ha accesso a dati, API o database (§14.5, ADR 013). |

### 6.2 Coda di lavori su Postgres

**pg-boss** gestisce i lavori dentro Postgres: niente Redis, tentativi con attesa crescente, lavori ritardati e chiavi di unicità. Si basa su `SELECT … FOR UPDATE SKIP LOCKED`, quindi due worker non prendono mai lo stesso lavoro.

La **fonte di verità è il database dei post**, non la coda: i lavori contengono solo ID e ogni gestore rilegge lo stato prima di agire. Un **riconciliatore** ogni minuto ricrea i lavori mancanti per le destinazioni in scadenza: un lavoro perso non fa mai saltare una pubblicazione.

### 6.3 Decisioni architetturali (ADR)

Ogni decisione ha una scheda in `docs/adr/` con contesto, decisione e alternative scartate.

| ADR | Decisione | Alternativa scartata e motivo |
|---|---|---|
| 001 | Monolite modulare: web + worker | Microservizi: troppe parti per un carico basso e un team piccolo |
| 002 | Coda su Postgres (pg-boss) | Redis/BullMQ: un servizio in più da gestire senza benefici a questo carico |
| 003 | Programmazione gestita da Feedway anche per FB | Programmazione nativa FB: due logiche diverse, e IG non la offre. Conseguenza: i post programmati non compaiono in "Post programmati" di Business Suite finché non escono |
| 004 | Autorizzazione nell'applicazione, in un unico modulo testato, **più** Row Level Security di Postgres per l'isolamento tra organizzazioni | Solo applicazione: con più agenzie un filtro dimenticato esporrebbe dati di un'altra agenzia |
| 005 | Host pubblico separato dal pannello | Pannello pubblico: superficie d'attacco inutile |
| 006 | API-first: ogni funzione è un caso d'uso esposto da `/api/v1` con OpenAPI | Logica nelle pagine: impedirebbe MCP e altri client |
| 007 | Segreti delle integrazioni cifrati nel database, gestiti dal pannello | Variabili d'ambiente: richiederebbero di toccare file sulla VPS |
| 008 | Upload a pezzi da 20 MB | Upload singolo: Cloudflare gratuito rifiuta richieste oltre 100 MB |
| 009 | Più organizzazioni in un solo database, `organization_id` su ogni riga, RLS | Un database o uno schema per agenzia: migrazioni e backup moltiplicati, costi fissi alti; resta possibile per una singola agenzia molto grande (stessa immagine, installazione dedicata) |
| 010 | Versioni di base: Node 24 LTS, Nuxt 4 + Nuxt UI 4, TypeScript 6.0 fissato (§7.4) | Node 22 e Nuxt 3: escono dal supporto durante la vita della 1.0; TypeScript 7: non ancora garantito con `vue-tsc` |
| 011 | Identificativi tecnici neutri (`@app/*`, ruoli `app_migrator`/`app_runtime`, database `app`), nome visibile in una sola costante `PRODUCT_NAME` | Nome del prodotto negli identificativi: cambiarlo richiederebbe migrazioni e rinomine ovunque |
| 012 | Accesso e account con **Better Auth** (libreria open source, sul nostro Postgres); organizzazioni, ruoli, spazi, inviti e RLS restano nostri (§15.1) | Login scritto nel progetto: più codice da mantenere. Clerk/WorkOS: dati del team negli Stati Uniti e login dipendente da un servizio esterno |
| 013 | **Sito pubblico statico separato** dal pannello (`apps/site`, Nuxt in generazione statica, Cloudflare Pages) | Landing dentro il pannello: renderebbe pubblico l'host del pannello e legherebbe il sito ai rilasci e ai guasti della VPS |

---

### 6.4 Scalabilità

La 1.0 gira su una VPS, ma il codice è scritto per crescere senza riscritture: ogni parte che oggi è "piccola" sta dietro un'interfaccia o una configurazione che permette di sostituirla.

| Parte | Oggi | Quando i clienti diventano molti | Cosa lo rende possibile già ora |
|---|---|---|---|
| Dati delle agenzie e dei clienti | Tabelle condivise, ogni riga con `organization_id` (e `workspace_id` dove serve), filtro obbligatorio nel repository e RLS (§6.5) | Migliaia di agenzie e spazi sullo stesso Postgres; se servisse, distribuzione su più database per `organization_id` | Indici che iniziano con `organization_id` o `workspace_id`; nessuna query senza filtro |
| web | Un container | Più copie dietro un bilanciatore | Sessioni, limiti di frequenza e cache dei permessi nel database, mai in memoria del processo |
| worker | Un container, tutte le code | Più copie; worker dedicati per tipo (conversioni video su una macchina, pubblicazione su un'altra) | `SKIP LOCKED` e chiavi di unicità; variabile `WORKER_QUEUES` per scegliere le code di ogni worker |
| Processi unici (bot Telegram, battito, riconciliatore) | Un worker | Un solo esecutore attivo anche con molti worker | Lock consultivo di Postgres: se l'esecutore cade, un altro subentra |
| File | Disco della VPS dietro l'interfaccia `Storage` | Storage a oggetti S3-compatibile (Cloudflare R2, Garage), servito dal CDN | Nessun codice accede al disco direttamente; la stessa batteria di test vale per entrambe le implementazioni |
| Database | Un Postgres, indici e conservazione dei dati | PgBouncer, partizionamento mensile delle tabelle che crescono sempre (`audit_log`, `target_attempts`, `notifications`, `outbox_events`), repliche di lettura | Migrazioni solo in avanti; tabelle a sola aggiunta già separate |
| Meta | Una app e un utente di sistema per organizzazione, limiti letti per account | I limiti di Meta sono per account e per app: crescono con gli account | Concorrenza e rallentamento per account (§8.6) |
| Installazione | Docker Compose | Stessa immagine su più server o Kubernetes | Un'immagine, configurazione solo da ambiente e database, nessun file locale oltre a `Storage` |

**Prova di carico** (tappa 11): con il finto Graph API, 500 spazi in 50 organizzazioni (così si misura anche il costo della RLS), 2.000 account e 20.000 post al mese. Obiettivi: pubblicazione entro 1 minuto dall'orario anche con 200 post nello stesso minuto, calendario di un mese in meno di 500 ms lato server, pannello entro i tempi di RNF-05.

### 6.5 Più agenzie (organizzazioni)

La struttura è multi-agenzia dal primo giorno, anche se nella 1.0 ne userai una sola. Aggiungere questo livello più avanti vorrebbe dire rimettere mano a quasi tutte le tabelle, ai permessi e ai file: farlo ora costa molto meno.

```
Piattaforma (installazione, amministratore della piattaforma)
└─ Organizzazione = agenzia        utenti con ruolo Owner / Admin / Member
   ├─ integrazioni (Meta, email, Telegram), brand, impostazioni, limiti
   └─ Spazio di lavoro = cliente   ruoli Manager / Publisher / Editor / Viewer
      └─ account social, post, media, etichette, link cliente…
```

**Isolamento a doppia barriera**
1. **Applicazione**: ogni richiesta e ogni lavoro portano l'organizzazione; `can()` e i repository filtrano sempre su di essa.
2. **Database**: ogni tabella con dati di un'organizzazione ha la colonna `organization_id` e una regola Row Level Security; la transazione imposta l'organizzazione corrente e Postgres nasconde tutto il resto. Se un giorno una query dimentica il filtro, restituisce zero righe invece dei dati di un'altra agenzia.
3. Le chiavi esterne includono `organization_id`, così un post non può puntare a un account di un'altra organizzazione.
4. Le poche operazioni che attraversano le organizzazioni (accesso e sessioni, primo avvio, riconciliatore, pulizia, lavori di sistema come battito e bot, amministrazione della piattaforma) passano da un'unica funzione esplicita, `runAsSystem`, registrata e limitata per regola di lint a quei moduli.
5. Una batteria di test dedicata crea due organizzazioni e verifica che ogni rotta e ogni lavoro non vedano mai i dati dell'altra.

**Utenti**: identità unica per email. Un utente può essere membro di più organizzazioni con ruoli diversi (per esempio un freelance che lavora per due agenzie) e passa dall'una all'altra dal selettore in alto. L'organizzazione è nell'indirizzo del pannello (`/<agenzia>/calendario`), così due schede possono stare su agenzie diverse e i link nelle notifiche aprono quella giusta.

**Cosa ha ogni organizzazione**
| Cosa | Comportamento |
|---|---|
| Meta | App Meta propria dell'agenzia; collegamento per account con login Facebook, login Instagram o utente di sistema (§8.0). Nella 2.0 l'app comune passa la revisione Meta (§18.2) |
| Email e Telegram | Valori predefiniti della piattaforma, sostituibili per organizzazione (mittente e bot propri) |
| Brand | Logo, colore e piè di pagina email propri: pannello, email, link cliente |
| Impostazioni | 2FA obbligatoria (mai meno restrittiva della piattaforma), conservazione file, fuso predefinito |
| Limiti | Numero di spazi, account, utenti, spazio su disco, post al giorno; vuoti = illimitati. Controllati nei casi d'uso. Il limite di utenti conta tutti i membri dell'agenzia, anche disattivati, più gli inviti ancora aperti; un valore illeggibile vale 0 |
| Cifratura | Una chiave dati propria, cifrata con la chiave della piattaforma: si può ruotare per agenzia, e cancellarla rende illeggibili i segreti di un'organizzazione eliminata |
| File | Chiavi di archiviazione con prefisso `org/<id>/`: spazio occupato, esportazione e cancellazione per agenzia |
| Registro attività | Per organizzazione; le azioni dell'amministratore della piattaforma con `organization_id` nullo, mai visibili alle organizzazioni |

**Equità tra agenzie**: i lavori pesanti (conversioni video, programmazione in blocco) hanno un limite di esecuzioni contemporanee per organizzazione, così un'agenzia che carica 200 video non rallenta le altre. La pubblicazione all'orario non ha code condivise: ogni destinazione ha il proprio lavoro.

**Nella 1.0**: livello organizzazione completo, isolamento, selettore, integrazioni, brand, impostazioni, limiti e cifratura per organizzazione; creazione di una nuova agenzia da comando (`cli create-organization`), che stampa il link di attivazione per il suo Owner.

**Nella 2.0** (piattaforma aperta ad altre agenzie): pannello dell'amministratore della piattaforma, registrazione autonoma, abbonamenti e pagamenti, revisione dell'app Meta comune, dominio personalizzato per agenzia, esportazione e cancellazione completa di un'organizzazione, accesso di supporto con consenso e registro.

## 7. Struttura del codice e stack

### 7.1 Repository

```
feedway/
├─ apps/
│  ├─ web/                Nuxt: pagine, componenti, server/api (adattatori sottili)
│  ├─ worker/             gestori dei lavori pg-boss (adattatori sottili)
│  ├─ site/               sito pubblico statico: landing e pagine legali (§14.5)
│  └─ mcp/                (futuro) server MCP, §18.3
├─ packages/
│  ├─ domain/             logica pura, senza dipendenze esterne, una cartella per modulo
│  │  ├─ authz/           ruoli, permessi, funzione can() (§10)
│  │  ├─ identity/        regole su account, profilo, riconferma, privacy (§10.5, §15)
│  │  ├─ organizations/   limiti, impostazioni, moduli attivi
│  │  ├─ rules/           compatibilità contenuti e controlli (§9.1, §9.2)
│  │  ├─ publishing/      macchina a stati delle destinazioni (§9.3)
│  │  ├─ tasks/           (1.5) attività, §18.4
│  │  └─ errors/          errori di dominio tipizzati
│  ├─ application/        casi d'uso, una cartella per modulo (identity, workspaces,
│  │                      accounts, media, posts, publishing, notifications,
│  │                      scheduling, sharing, organizations, audit, platform,
│  │                      tasks…)
│  ├─ infrastructure/
│  │  ├─ db/              schema Drizzle, migrazioni, repository
│  │  ├─ meta/            client Graph API (IG + FB)
│  │  ├─ media/           ffprobe, ffmpeg, sharp
│  │  ├─ storage/         interfaccia Storage + implementazione su disco
│  │  ├─ queue/           pg-boss
│  │  ├─ crypto/          cifratura dei segreti
│  │  └─ notify/          canali: pannello, Telegram, email
│  ├─ config/             validazione dell'ambiente con Zod
│  ├─ contracts/          schemi Zod e DTO condivisi tra pannello e API
│  └─ ui/                 design system: token, componenti, temi
├─ tools/
│  └─ meta-mock/          finto Graph API per sviluppo e test
├─ docker/                Dockerfile, compose, cloudflared, tailscale
├─ scripts/               install.sh, update.sh, restore-check.sh
├─ docs/
│  ├─ adr/                decisioni architetturali
│  ├─ runbooks/           ripristino, rotazione token, incidenti
│  └─ superpowers/specs/  questo documento
└─ .github/workflows/     CI
```

### 7.2 Regole di dipendenza

```
apps/web, apps/worker, apps/mcp  →  application  →  domain
infrastructure  →  implementa le interfacce di application
```
- `domain` non importa nulla di esterno: testabile senza database né rete.
- `application` dipende solo da interfacce (`PostRepository`, `MetaPublisher`, `Storage`, `Notifier`, `Clock`).
- Rotte API e gestori dei lavori sono sottili: validano l'input, chiamano un caso d'uso, traducono l'output.
- `apps/site` importa solo `packages/ui` (token) e `PRODUCT_NAME` da `packages/config`: niente casi d'uso, contratti, infrastruttura o database.
- I confini sono verificati in CI con dependency-cruiser.

### 7.3 Moduli e aggiunta di nuove funzioni

Ogni area funzionale (identità, account, media, post, pubblicazione, notifiche, pianificazione, piano editoriale, condivisione, attività…) è un **modulo** con la stessa forma: regole in `domain/<modulo>`, casi d'uso in `application/<modulo>`, tabelle e repository in `infrastructure/db/<modulo>`, contratti in `contracts/<modulo>`, rotte in `apps/web/server/api/v1/orgs/[org]/<modulo>`, pagine in `apps/web/app/pages/[org]/…` (percorsi in italiano, per esempio `/[org]/calendario`).

- Un modulo legge e scrive **solo le proprie tabelle**; per usare dati di un altro modulo chiama le sue funzioni pubbliche (`application/<modulo>/index.ts`) o reagisce ai suoi eventi. dependency-cruiser lo verifica.
- I moduli si parlano con **eventi** scritti nell'outbox (§12.1): per esempio "post pubblicato" può far nascere un'attività o una notifica senza che il modulo dei post sappia nulla delle attività.
- Ogni modulo registra i propri permessi (§10.3), i propri tipi di evento e di notifica (§12), le proprie voci di menu, le proprie voci del calendario (per esempio le scadenze delle attività) e i propri strumenti MCP in `module.ts`; l'unico punto centrale è una riga nell'elenco dei moduli.
- **Moduli attivabili per organizzazione** (`organizations.settings.modules`): una funzione nuova si può accendere prima per la tua agenzia e poi per le altre, e nella 2.0 diventa la base dei piani di abbonamento.
- Aggiungere un modulo segue una ricetta documentata in `docs/moduli.md`: tabelle con `organization_id` e RLS, permessi, eventi, rotte registrate (entrano da sole nei test di isolamento), schermate con tutti gli stati, test.

### 7.4 Stack

| Parte | Scelta | Motivo |
|---|---|---|
| Linguaggio | TypeScript 6.0 `strict` + `noUncheckedIndexedAccess` (passaggio a TypeScript 7 quando gli strumenti di Nuxt lo supportano) | Errori trovati in compilazione |
| Runtime | Node 24 LTS (supportato fino ad aprile 2028); Node 26 appena diventa LTS (fine ottobre 2026, supporto fino ad aprile 2029) | Versione con supporto più lungo |
| Pannello + API | Nuxt 4 (Vue 3) | Un solo progetto per UI e API; Nuxt 3 non riceve più aggiornamenti |
| UI | Nuxt UI 4 (Tailwind) + `packages/ui` | Componenti accessibili, temi con token |
| Database | PostgreSQL 18 | Affidabile, transazioni, JSONB, RLS, `uuidv7()` nativo; supportato fino al 2030 |
| ORM | Drizzle + drizzle-kit (1.0 se stabile all'inizio della tappa 1, altrimenti 0.45 con passaggio pianificato) | Query tipizzate, migrazioni SQL leggibili |
| Coda | pg-boss | §6.2 |
| Validazione | Zod | Stessi schemi per pannello, API e configurazione |
| API | OpenAPI generata dagli schemi | Documentazione sempre allineata |
| Accesso | Better Auth (versione fissata) con plugin `twoFactor` e `@better-auth/passkey`; password argon2id (`@node-rs/argon2`) | Login, sessioni, 2FA e passkey già pronti e sul nostro database (ADR 012) |
| Sicurezza HTTP | nuxt-security | CSP, header, limiti |
| Media | ffmpeg/ffprobe, sharp, libheif-js (HEIC) | Analisi e conversione |
| Log | pino (JSON) | Strutturati, segreti oscurati |
| Date | Luxon | Fusi orari e ora legale |
| PWA | @vite-pwa/nuxt | App installabile |
| Test | Vitest, Testcontainers, Playwright | §17 |
| Monorepo | pnpm workspaces + Turborepo | Build e test incrementali |

Le alternative valutate per ogni componente, con lo stato delle versioni al 2026-10-15, sono in [`docs/stack.md`](../../stack.md).

---

## 8. Integrazione con Meta

### 8.0 Modi di collegamento

Ogni account ha un collegamento di un tipo (ADR 015). L'elenco «Account collegati» è unico; il tipo cambia solo come si accede e come si rinnova il token.

| Tipo | Per chi | Come si collega | Note |
|---|---|---|---|
| **Login Facebook** | Pagine Facebook e Instagram collegato alla Pagina | «Collega con Facebook», poi scegli Pagine e profili | Il token della persona scade (circa 60 giorni): rinnovo e avviso in «Salute» |
| **Login Instagram** | Profili Instagram professionali senza Pagina | «Collega solo Instagram» | Il profilo deve essere Business o Creator; con l'app in modalità sviluppo va aggiunto come tester Instagram (da verificare) |
| **Utente di sistema** | Account nel Business Manager dell'agenzia | Procedura in 5 passi (§8.1) | Token che non scade; opzione per chi preferisce la stabilità |

- Con l'app Meta in modalità sviluppo possono collegare solo le persone con un ruolo nell'app; chi collega vede solo gli account a cui ha già accesso. Nessuna revisione necessaria per l'uso interno; serve per aprire ad altre agenzie (§18.2).
- Altre piattaforme (per esempio TikTok) si aggiungono come nuovo tipo di collegamento, con login, rinnovo e salute propri. Nella 1.0 si costruiscono solo i tipi Meta.
- Non verificato su Meta vera: login in modalità sviluppo, rinnovo dei token e inviti dei tester Instagram (verifica in tappa 3 con gli account di prova).

### 8.1 Installazione e prima configurazione (collegamento con utente di sistema)

**Installazione** (unico momento con il terminale, insieme ai comandi con cui l'amministratore della piattaforma crea, sospende e limita altre agenzie fino alla 2.0, §6.5): `install.sh` genera chiavi e password interne, chiede la tua email, il nome della tua agenzia e gli indirizzi del pannello e dell'host pubblico, avvia i container e stampa il link monouso con cui crei il tuo account: amministratore della piattaforma e Owner della prima organizzazione. Gli aggiornamenti si fanno con `update.sh`.

**Prima configurazione guidata** (al primo accesso dell'Owner di ogni organizzazione, interrompibile e riprendibile):

| Passo | Cosa vedi | Controllo automatico |
|---|---|---|
| 1. Crea l'app Meta | Guida illustrata: developers.facebook.com → Crea app → tipo Business → collega al Business. Campi **App ID** e **App Secret** | App esistente e secret corretto |
| 2. Crea l'utente di sistema | Business Settings → Utenti di sistema → Aggiungi → ruolo Admin → aggiungi l'app | |
| 3. Assegna Pagine e Instagram | "Assegna asset" all'utente di sistema con controllo completo | |
| 4. Genera e incolla il token | Elenco esatto dei permessi da spuntare; campo per il **token** | Ogni permesso mostrato in verde o rosso, con la correzione |
| 5. Importa gli account | Pagine e IG trovati; scegli quali attivare e in quale spazio | Stato di salute di ogni account |

**Permessi richiesti**: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`. Da verificare al primo collegamento se servono anche `ads_management`/`ads_read`; in quel caso il controllo del passo 4 lo segnala. Le versioni successive aggiungeranno permessi per commenti e statistiche (§18.2), con la stessa procedura.

### 8.2 Aggiungere un account

Procedura "Aggiungi account", che parte da *l'account è già nel tuo Business Manager?*
- **Sì**: assegna Pagina e Instagram all'utente di sistema, poi "Cerca nuovi account"; lo attivi e scegli lo spazio.
- **No, è di un cliente con Business proprio**: guida per la richiesta di accesso come partner; il pannello prepara il messaggio con le istruzioni per il cliente.
- **Instagram senza Pagina**: «Collega solo Instagram» (login Instagram, §8.0); l'account deve essere professionale.
- **Instagram personale**: guida per convertirlo in professionale (gratuito, dall'app) e poi collegarlo.

Alla fine il pannello verifica che l'account sia pubblicabile (permessi, collegamento IG↔Pagina, quota) e indica il passo da rifare se qualcosa manca. Per un profilo solo Instagram il controllo del collegamento IG↔Pagina non si applica.

### 8.3 Integrazioni e segreti

**Impostazioni → Integrazioni** dell'organizzazione (solo Owner), ognuna con guida e pulsante "Prova". Email e Telegram possono usare i valori predefiniti della piattaforma, che l'amministratore della piattaforma imposta in **Piattaforma → Integrazioni** (§14.4) insieme alla sorveglianza esterna:
- **Meta**: App ID, App Secret, token. "Sostituisci token" verifica il nuovo prima di salvarlo; il vecchio resta attivo finché il nuovo non risulta valido.
- **Telegram**: guida @BotFather, token del bot, messaggio di prova.
- **Email**: modelli per Gmail, Brevo e SMTP generico, email di prova.
- **Sorveglianza esterna** (solo amministratore della piattaforma, sezione Piattaforma): URL del servizio (es. healthchecks.io), segnale di prova.

I segreti sono cifrati nel database (AES-256-GCM) con la chiave dati dell'organizzazione, a sua volta cifrata con la chiave generata dall'installazione (§6.5), **non si rileggono mai** (si vedono le ultime 4 cifre e la data), si possono solo sostituire, ogni modifica richiede riconferma e finisce nel registro attività.

### 8.4 Sincronizzazione e salute degli account

- **Sincronizzazione** (a richiesta e ogni giorno): `GET /me/accounts`, poi per ogni Pagina `GET /{page-id}?fields=name,picture,instagram_business_account{id,username,profile_picture_url}`. Gli account spariti diventano inattivi (mai cancellati); i nuovi restano fuori dagli spazi finché un Admin non li assegna.
- **Salute** (ogni giorno e prima di ogni pubblicazione): token valido (`/debug_token`), permessi, asset ancora assegnati, quota IG (`GET /{ig-id}/content_publishing_limit`). Gli account con problemi sono rossi e non selezionabili.
- **Promemoria Meta**: versione della Graph API vicina al ritiro (avviso 90 giorni prima), Data Use Checkup annuale in scadenza, permessi revocati.
- I token delle Pagine non si salvano con l'utente di sistema: il worker li ricava dal token di sistema e li tiene in memoria al massimo un'ora. Per i login Facebook e Instagram si salva il token di lunga durata della persona (cifrato, ADR 007), con rinnovo automatico e avviso prima della scadenza; se non si può rinnovare l'account diventa rosso.

### 8.5 Flussi di pubblicazione

**Instagram**
| Tipo | Passi |
|---|---|
| Foto | `POST /{ig}/media` (image_url, caption) → `POST /{ig}/media_publish` |
| Carosello | per ogni elemento `POST /{ig}/media` con `is_carousel_item=true` → attesa video `FINISHED` → `POST /{ig}/media` `CAROUSEL` con `children` → `media_publish` |
| Reel | `POST /{ig}/media` `REELS` (video_url, caption, cover_url/thumb_offset, share_to_feed) → `status_code` ogni minuto fino a `FINISHED` → `media_publish` |
| Storia | `POST /{ig}/media` `STORIES` → (attesa se video) → `media_publish` |

**Facebook** (token della Pagina ricavato dal token di sistema)
| Tipo | Passi |
|---|---|
| Foto | `POST /{page}/photos` (url, message) |
| Multi-foto | ogni foto `POST /{page}/photos` con `published=false` → `POST /{page}/feed` con `attached_media` e `message` |
| Reel | `POST /{page}/video_reels` `upload_phase=start` → upload con `file_url` → `upload_phase=finish`, `video_state=PUBLISHED`; copertina: **da verificare** (§11.2) |
| Video | `POST /{page}/videos` con `file_url` e `description` |
| Storia foto | foto non pubblicata → `POST /{page}/photo_stories` |
| Storia video | flusso a sessione su `/{page}/video_stories` |

Ogni passo salva gli ID ricevuti prima del successivo, così si riprende dal punto esatto.

### 8.6 Client Meta

- Funzioni tipizzate per ogni chiamata, versione API fissata in configurazione e aggiornata con una PR e test.
- Timeout su ogni richiesta; tentativi con attesa crescente e casuale solo per errori temporanei.
- Lettura di `X-App-Usage` e `X-Business-Use-Case-Usage`: sopra l'80% il worker rallenta da solo, per account e per organizzazione.
- Classificazione di ogni errore: **temporaneo**, **definitivo** o **incerto**.
- `appsecret_proof` su ogni chiamata; token mai nei log.
- Modalità `live`, `mock` (finto Graph API) e `dry-run` per sviluppo e prove.

### 8.7 Limiti Meta da rispettare

| Limite | Valore | Come lo gestiamo |
|---|---|---|
| Post IG via API | 50 o 100 ogni 24 h (la documentazione riporta entrambi) | Lettura della quota reale dall'API |
| Reel FB per Pagina | 30 ogni 24 h | Conteggio nel nostro database |
| Container IG | Scadono dopo 24 h; 400 creazioni ogni 24 h | Preparazione 15 minuti prima; ricreazione se scaduti |
| Controllo stato container | Al massimo una volta al minuto | Rispettato dal worker |
| File | Devono essere su URL pubblico senza login | Host pubblico §16.1 |

---

## 9. Contenuti, controlli e pubblicazione

### 9.1 Tipi di contenuto e corrispondenza IG ↔ FB

| Cosa carichi | Instagram | Pagina Facebook |
|---|---|---|
| **Foto singola** | Post feed | Post foto |
| **Carosello solo foto** (2–10) | `CAROUSEL` | Post multi-foto |
| **Carosello con video** | `CAROUSEL` misto | FB non supporta foto+video insieme → **avviso**: solo le foto / salta FB |
| **Reel 3–90 s** | `REELS` | Reel |
| **Reel 90 s–15 min** | `REELS` | **avviso**: su FB come video normale / salta FB |
| **Storia foto** | `STORIES` | Storia foto |
| **Storia video 3–60 s** | `STORIES` | Storia video |

- Caption identica ovunque. Le storie non hanno caption: se ne scrivi una, un avviso dice che verrà ignorata.
- **Reel nel feed**: di default il reel compare nella scheda Reels, nella griglia del profilo e nel feed dei follower (`share_to_feed=true`, come dall'app); disattivabile per post.

### 9.2 Controlli

Tre livelli: **Blocco** (non si programma), **Avviso con scelta** (si prosegue scegliendo; la scelta si salva), **Correzione automatica** (la facciamo noi e lo diciamo).

Le regole stanno in `packages/domain/rules` e valgono ovunque: il pannello le usa per avvisare, l'API le riapplica al salvataggio, il worker prima di pubblicare.

**File**
| Controllo | Livello | Azione |
|---|---|---|
| Tipo non supportato (verificato dai byte) | Blocco | |
| Immagine oltre 50 megapixel o file oltre i limiti di upload | Blocco | Protezione da file malevoli |
| Foto HEIC, PNG, WEBP | Correzione | Convertita in JPEG |
| Profilo colore non sRGB | Correzione | Convertita in sRGB |
| Metadati EXIF (GPS, dispositivo) | Correzione | Rimossi, orientamento mantenuto |
| Foto oltre 8 MB (IG) o 4 MB (FB) | Correzione | Ricompressa |
| Foto larga più di 1440 px | Correzione | Ridimensionata |
| Video oltre 300 MB | Blocco | |
| Codec video non H.264/HEVC o audio non AAC | Avviso | Conversione automatica proposta |
| fps fuori da 23–60 | Avviso | Conversione a 30 fps proposta |
| moov atom non all'inizio | Correzione | Rimuxato con `faststart`, senza perdita |

**Proporzioni e durata**
| Controllo | Livello | Azione |
|---|---|---|
| Foto feed IG fuori da 4:5 – 1.91:1 | Avviso | Ritaglio al centro / bande / annulla, con anteprima |
| Carosello con proporzioni diverse | Avviso | IG ritaglia sulla prima foto; anteprima del risultato |
| Reel non 9:16 | Avviso | Pubblica così / adatta con bande / ritaglia |
| Reel sotto 3 s o sopra 15 min | Blocco | |
| Reel 90 s–15 min con FB scelto | Avviso | FB come video normale / salta FB |
| Storia video sopra 60 s | Avviso | Taglia ai primi 60 s / annulla |
| Storia video oltre 100 MB | Correzione | Ricompressa |
| Video sotto 540×960 per reel FB | Avviso | Qualità bassa, FB potrebbe rifiutarlo |
| Copertina del reel non 9:16 | Avviso | Ritaglio al centro, con anteprima / usa così |
| Copertina del reel non JPEG, non sRGB o oltre 8 MB | Correzione | Convertita in JPEG sRGB e ricompressa |
| Copertina scelta con FB nelle destinazioni | Avviso | Su Facebook la copertina potrebbe non essere applicata (finché non è verificato) |

**Post**
| Controllo | Livello |
|---|---|
| Caption oltre 2.200 caratteri, più di 30 hashtag o più di 20 menzioni | Blocco |
| Carosello con meno di 2 o più di 10 elementi | Blocco |
| Carosello misto con FB scelto | Avviso (§9.1) |
| Post multi-foto FB oltre il limite di foto (da verificare) | Avviso |
| Nessun account, o account fuori dallo spazio | Blocco |
| Account non sano | Blocco |
| Data nel passato | Blocco ("Pubblica ora") |
| Ora inesistente o doppia per il cambio dell'ora legale | Avviso con l'ora risultante |
| Quota IG: meno di 5 post rimasti nelle 24 h a quell'ora | Avviso |
| Quota IG esaurita / più di 30 reel FB nelle 24 h | Blocco |
| Stessi media e caption pubblicati sullo stesso account negli ultimi 7 giorni | Avviso (FB rifiuta i duplicati) |

**Nel worker, prima di pubblicare**
- Il file è raggiungibile dall'URL pubblico; altrimenti "Meta non riesce a scaricare il file: controlla tunnel e dominio".
- Token, permessi e quota ancora validi.
- Chi ha programmato il post ha ancora il permesso di pubblicare nello spazio; altrimenti la destinazione va **in pausa** e i Manager vengono avvisati.
- L'organizzazione è attiva; se è sospesa la destinazione va **in pausa** e nessuna notifica esce verso i suoi canali. Alla riattivazione le destinazioni in pausa restano tali finché qualcuno non le riprogramma.

### 9.3 Macchina a stati della destinazione

```
draft → scheduled → preparing → ready → publishing → published → verifying → confirmed
            │           │          │         │                            └─→ problem
            │           └──────────┴─────────┴─→ retrying → (passo fallito)
            │                                 └─→ unknown → published | failed
            └─→ cancelled                        failed → (Riprova) → scheduled
                                                 paused → (Manager) → scheduled | cancelled
```

- Transizioni ammesse definite e testate in `packages/domain/publishing`; tutte le altre rifiutate.
- Ogni transizione in transazione con `SELECT … FOR UPDATE`.
- Lo stato del post deriva dalle destinazioni (tutte confermate → Confermato; alcune fallite o con problema → Parziale).
- Etichette e colori nel pannello: Bozza (grigio chiaro), Programmato (grigio), In pubblicazione (blu), In verifica (azzurro), Confermato (verde), Con problema / Fallito (rosso), In pausa (giallo).

### 9.4 Lavori in coda

| Lavoro | Quando | Note |
|---|---|---|
| `media.process` | Dopo l'upload | Analisi, conversioni, miniature; uno alla volta |
| `target.prepare` | 15 minuti prima (subito se "Pubblica ora" o mancano meno di 15 minuti) | Container IG, upload video FB senza pubblicare |
| `target.publish` | All'orario | |
| `target.reconcile` | Su esito incerto | §9.5 |
| `target.verify` | 3 minuti dopo, poi 10 e 30 se serve | §9.6 |
| `scheduler.reconcile` | Ogni minuto | Ricrea i lavori mancanti |
| `bulk.import` | Su richiesta | §11.6 |
| `plan.due_soon` | Al momento della notifica di §11.12 | Uno per contenuto pianificato (chiave: id del contenuto), con `organizationId`; creato o sostituito nella stessa transazione di ogni modifica del contenuto o del fuso dell'organizzazione, tolto quando il contenuto è tolto o preparato; il gestore rilegge contenuto e post e non fa nulla se non serve più |
| `notify.dispatch` / `notify.deliver` | Per ogni evento / destinatario e canale | §12 |
| `telegram.poll` | Continuo | Comandi del bot |
| `report.daily` | Ogni mattina | §12.4 |
| `accounts.sync` / `accounts.health` | Ogni giorno e a richiesta | §8.4 |
| `heartbeat.external` | Ogni minuto | §16.7 |
| `maintenance.cleanup` | Ogni notte | §11.9 |

Ogni lavoro ha una chiave di unicità (destinazione + passo). Modificare o annullare un post aggiorna dati e lavori nella stessa transazione; il riconciliatore copre i casi interrotti a metà.

### 9.5 Errori e tentativi

- **Temporanei** (rete, 5xx, limiti di frequenza, video in elaborazione): nuovi tentativi dopo 1, 5 e 15 minuti dal passo fallito.
- **Definitivi** (permessi, file rifiutato, duplicato, token non valido): `failed` con messaggio tradotto, nessun tentativo automatico.
- **Incerti** (timeout sulla chiamata che pubblica): `unknown`; il worker cerca il post tra gli ultimi dell'account per caption e orario e lo segna `published` o `failed`. Così "Riprova" non crea doppioni.
- **Container IG scaduti**: ricreati da capo.
- Ogni tentativo è registrato in `target_attempts` (passo, esito, codice Meta, durata), senza dati sensibili.

| Codice Meta | Messaggio nel pannello |
|---|---|
| 190 | Il token Meta non è più valido: sostituiscilo da Impostazioni → Integrazioni → Meta |
| 200 / 10 | Permesso mancante per questo account: controlla gli asset assegnati all'utente di sistema |
| 9007 | Instagram sta ancora elaborando il video (ritento in automatico) |
| 9004 / 2207026 | Meta non riesce a scaricare il file o il formato non è valido |
| 506 | Facebook ha rifiutato il post perché duplicato |
| 4 / 17 / 32 / 613 | Troppe richieste: ritento più tardi |

L'elenco completo si costruisce durante sviluppo e test reali.

### 9.6 Verifica dopo la pubblicazione

Una risposta positiva di Meta non basta: un reel può fallire durante l'elaborazione. Ogni destinazione pubblicata passa in `verifying`.

| Piattaforma | Controllo |
|---|---|
| Instagram | `GET /{media-id}?fields=id,permalink,media_type,media_product_type,timestamp`: esiste, tipo corretto, permalink presente |
| FB foto e multi-foto | `GET /{post-id}?fields=is_published,permalink_url` |
| FB reel e video | `GET /{video-id}?fields=status,permalink_url`: elaborazione e pubblicazione completate |
| Storie | Esistenza tramite ID (verifica immediata: scadono dopo 24 h) |

Primo controllo dopo **3 minuti**, poi a 10 e 30 se Meta sta ancora elaborando.
- **Confermato**: salvato il link definitivo.
- **Con problema**: non esiste, è in errore o ancora in elaborazione dopo 30 minuti. Il pannello propone "Riprova" o "Segna come verificato a mano".

I campi esatti da leggere saranno confermati nei primi test reali.

---

## 10. Utenti, ruoli e permessi

### 10.1 Ruoli

| Ruolo | Livello | Per chi |
|---|---|---|
| **Amministratore della piattaforma** | installazione | Tu. Crea e sospende organizzazioni e ne imposta i limiti; non vede i contenuti di un'organizzazione se non ne è membro |
| **Owner** | organizzazione | Il titolare dell'agenzia (nella tua, tu). Uno per organizzazione; nessuno dell'organizzazione può declassarlo o disattivarlo |
| **Admin** | organizzazione | Persone di fiducia che gestiscono utenti, spazi, account dell'organizzazione |
| **Member** | organizzazione | Tutti gli altri; vedono solo gli spazi in cui hanno un ruolo. Un Member **senza ruolo in nessuno spazio** ("member semplice": per esempio amministrazione o un grafico che non pubblica) è un caso valido: nella 1.0 vede dashboard, centro notifiche e il proprio account; dalla 1.5 usa attività, to-do e note personali o condivise (§18.4). Non vede contenuti dei clienti |
| **Manager** | spazio | Responsabile di un cliente: pubblica e gestisce i membri dello spazio |
| **Publisher** | spazio | Crea e pubblica direttamente |
| **Editor** | spazio | Prepara bozze, che qualcuno con permesso programma |
| **Viewer** | spazio | Vede calendario e storico |

Un utente può avere ruoli diversi in spazi diversi e in organizzazioni diverse. La matrice seguente vale dentro una singola organizzazione.

### 10.2 Matrice dei permessi

| Permesso | Owner | Admin | Manager | Publisher | Editor | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Vedere post e calendario dello spazio | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Caricare media, usare la libreria | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Creare e modificare le proprie bozze, note | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Programmare e pubblicare, anche in blocco | ✓ | ✓ | ✓ | ✓ | | |
| Pianificare contenuti nel piano editoriale: creare, spostare, togliere (`plan.edit`, §11.12) | ✓ | ✓ | ✓ | ✓ | | |
| Preparare un post da un contenuto pianificato (`plan.prepare`) | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Modificare/annullare post di altri | ✓ | ✓ | ✓ | | | |
| Riprovare pubblicazioni fallite | ✓ | ✓ | ✓ | solo propri | | |
| Gestire etichette, modelli, fasce orarie, gruppi di account | ✓ | ✓ | ✓ | | | |
| Gestire i membri dello spazio | ✓ | ✓ | ✓ ¹ | | | |
| Creare e revocare link cliente | ✓ | ✓ | ✓ | | | |
| Registro attività dello spazio | ✓ | ✓ | ✓ | | | |
| Creare spazi e assegnarvi account | ✓ | ✓ | | | | |
| Aggiungere e sincronizzare account Meta | ✓ | ✓ | | | | |
| Invitare utenti nei propri spazi | ✓ | ✓ | ✓ ¹ | | | |
| Disattivare utenti dell'organizzazione | ✓ | ✓ ² | | | | |
| Registro attività completo | ✓ | ✓ | | | | |
| Integrazioni, brand, impostazioni dell'organizzazione | ✓ | sola lettura | | | | |

Le due righe del piano editoriale (`plan.edit`, `plan.prepare`) e `plan.view`, che hanno tutti i ruoli che vedono il calendario, sono registrate dal modulo `plan` nella tappa 9 (§7.3), non dal nucleo della tappa 2. Un Member senza spazi si crea solo da Owner e Admin: un Manager che invita deve indicare almeno uno spazio. Un Member senza ruolo nello spazio non ha nessuna colonna: non vede lo spazio.

¹ Solo ruoli inferiori al proprio (Publisher, Editor, Viewer). ² Un Admin non può modificare l'Owner né altri Admin; solo l'Owner nomina gli Admin.

Un post appartiene a **uno** spazio e ha come destinazioni solo account di quello spazio.

### 10.3 Applicazione dei permessi

- Permessi come stringhe nel codice (`post.publish`, `workspace.members.manage`…); i ruoli sono insiemi di permessi. Ruoli di sistema non modificabili; lo schema consente ruoli personalizzati in futuro.
- Un'unica funzione `can(attore, permesso, risorsa)` in `packages/domain/authz`, chiamata da ogni caso d'uso. L'attore porta l'organizzazione corrente; una risorsa di un'altra organizzazione è sempre negata.
- Elenchi **sempre** filtrati dall'organizzazione e dagli spazi visibili nel repository, con la RLS del database come seconda barriera (§6.5): un ID indovinato restituisce 404.
- Test su ogni combinazione ruolo × permesso × situazione (proprio/altrui, stesso/altro spazio) e test API sugli accessi vietati.
- Un cambio di ruolo invalida la cache dei permessi e ruota la sessione dell'utente.

### 10.4 Ciclo di vita degli utenti

- **Primo avvio**: link monouso (1 ora) per creare il tuo account (amministratore della piattaforma e Owner della prima organizzazione); nessuna password di default.
- **Nuova organizzazione**: l'amministratore della piattaforma la crea con nome ed email del suo Owner e riceve il link di attivazione (1 ora per un utente nuovo; un utente esistente la trova nel selettore).
- **Invito**: Owner, Admin o Manager scelgono spazi e ruoli (con spiegazione dei ruoli); link monouso valido 72 ore, copiabile o inviato via email.
- **Attivazione** (è la registrazione: nella 1.0 non esiste una pagina "registrati" aperta a tutti): nome, soprannome e foto facoltativi, passkey o password (minimo 12 caratteri, controllo di robustezza), 2FA se richiesta, collegamento Telegram facoltativo.
- **Reset password**: link monouso via email (Better Auth), oppure generato da Owner/Admin e copiato dal pannello, solo per utenti che appartengono unicamente alla loro organizzazione (l'identità è unica tra le agenzie); chiude tutte le sessioni.
- **Disattivazione** (dall'organizzazione: l'utente perde l'accesso solo a quella; dalla piattaforma: a tutte): immediata, chiude le sessioni; i post programmati restano e passano in pausa al momento della pubblicazione se l'autore non ha più permessi (§9.2).
- **Passaggio di proprietà**: l'Owner può cedere il ruolo a un Admin attivo della stessa agenzia con il secondo fattore configurato, con riconferma; diventa Admin. Così può anche lasciare l'agenzia o eliminare il proprio account.
- **Nessuna cancellazione fisica**: lo storico resta attribuibile; "Elimina il mio account" o una richiesta all'amministratore anonimizzano i dati personali (§15.7).

### 10.5 Account personale

Ogni persona ha un solo account per tutte le agenzie in cui lavora.

| Campo | Regole |
|---|---|
| **Nome e cognome** | Obbligatorio; visibile al team delle stesse agenzie |
| **Soprannome** | Facoltativo, fino a 30 caratteri; se c'è, il pannello lo mostra al posto del nome (assegnazioni, commenti, registro), con il nome completo al passaggio del mouse |
| **Foto profilo** | JPEG, PNG, HEIC o WebP fino a 5 MB, scelta o trascinata; ritaglio quadrato nel pannello; il server rimuove EXIF e GPS e salva due formati WebP (256 e 64 px) in `Storage` con chiave `users/<id>/avatar/<hash>.webp`; senza foto, iniziali su un colore. Servita solo dal pannello con controllo di sessione, **mai** dall'host pubblico né nei link cliente |
| **Email** | Cambio con conferma sul nuovo indirizzo, avviso al vecchio e riconferma |
| **Accesso** | Passkey (proposta dopo il primo accesso), password, 2FA con app e codici di recupero; elenco "dispositivi collegati" con revoca ed "esci da tutti i dispositivi" |
| **Preferenze** | Lingua, tema, fuso, Telegram, notifiche (§12.3) |
| **Privacy** | "Scarica i miei dati" ed "Elimina il mio account" (§15.7) |

Una passkey è legata all'indirizzo del pannello: passando da `*.ts.net` a un dominio proprio, ognuno la ricrea dopo un accesso con la password. Il pannello lo avvisa prima del cambio.

---

## 11. Funzionalità del pannello

### 11.1 Upload e media

1. **Due modi equivalenti per aggiungere file**, ovunque il pannello accetta media:
   - il pulsante **"Scegli file"**, che apre l'esplora risorse del computer (o galleria e fotocamera sul telefono), con selezione multipla;
   - il **trascinamento** (drag and drop) di uno o più file, anche presi direttamente dalla cartella o dal desktop; da computer si può anche **incollare** un'immagine copiata (Ctrl/Cmd+V).
2. **Dove si possono trascinare i file**: area di caricamento, sezione Media dell'editor del post e **direttamente sull'anteprima come su Meta** (§11.2, §11.3), libreria media (§11.8), programmazione in blocco (§11.6), copertina del reel (§11.2), foto profilo (§10.5). Mentre trascini, la zona che accetta il file si evidenzia con la scritta "Rilascia qui"; un file di tipo o dimensione non ammessi viene rifiutato subito, con il motivo e i limiti accettati, senza fermare gli altri.
3. Upload a pezzi da 20 MB con ripresa automatica se la connessione cade, con **barra di avanzamento** per ogni file e complessiva (§14.2 "Avanzamento visibile"); i file restano utilizzabili nella bozza mentre gli altri finiscono di caricarsi.
4. Verifica di dimensione e hash, analisi (ffprobe/sharp), risultati dei controlli.
5. Correzioni e conversioni nel worker subito dopo l'upload, con barra di avanzamento e anteprima del file finale.
6. Limiti configurabili: dimensione massima per file, spazio totale per spazio di lavoro.
7. **Anteprima dei video**: ogni video caricato (MP4 o MOV, i formati di telefoni e fotocamere) si può riprodurre nell'editor, nell'anteprima come su Meta e nel dettaglio del post, con play, pausa, avanzamento e audio. Appena scelto, se il browser sa riprodurre il file lo mostra subito dal computer, senza aspettare l'upload; altrimenti (tipicamente l'HEVC dell'iPhone, che Chrome e Firefox non riproducono) mostra la prima immagine e "Anteprima in preparazione". Il worker crea sempre una **copia di anteprima** in MP4 H.264 a 720p, leggera e con `faststart`, che si vede in ogni browser; il file pubblicato resta l'originale (o la sua correzione, §9.2), non la copia. La copia è servita solo dal pannello, mai dall'host pubblico (non ha `public_token`), conta nello spazio occupato e si cancella insieme al file originale (§11.9). Nel link cliente i video si mostrano con la variante `share` (copertina e una propria copia H.264). La riproduzione dal computer usa un indirizzo `blob:`, ammesso nella CSP solo per `media-src` (§15.3).

### 11.2 Creazione del post

Una sola pagina, su una colonna da telefono e su due da computer:
1. **Spazio**: quello del contesto attivo; se il contesto è "Tutti i clienti", va scelto prima di tutto il resto (si pubblica solo dentro un cliente), tra gli spazi in cui l'utente è almeno Editor.
2. **Tipo**, proposto in base ai file.
3. **Media**: "Scegli file", trascinamento o "dalla libreria" (§11.1); un file trascinato sull'anteprima entra nel post e l'anteprima si aggiorna subito, con la barra di caricamento sulla miniatura. Ordine dei caroselli **trascinando le miniature**, anche nell'anteprima, con l'alternativa dei pulsanti "sposta prima/dopo" per tastiera e tocco. Anche il video del reel si può trascinare sull'area Media o sull'anteprima.
   - **Copertina del reel**, in due modi: **"Scegli un fotogramma"** con un cursore sul video (con le frecce della tastiera per spostarsi di un fotogramma), oppure **"Carica copertina"**, con "Scegli file" o trascinando un'immagine sull'area della copertina. L'anteprima mostra subito la copertina in 9:16 e nel ritaglio della griglia del profilo IG (§11.5); "Ripristina" torna al fotogramma predefinito. L'immagine caricata passa dai controlli di §9.2 (convertita in JPEG sRGB, proporzioni consigliate 9:16, 1080×1920). Su Instagram si usa `thumb_offset` per il fotogramma o `cover_url` per l'immagine (§8.5); per i reel Facebook il supporto della copertina tramite API è **da verificare** al primo contatto reale: finché non è verificato il riepilogo avvisa che su Facebook la copertina potrebbe non essere applicata.
4. **Caption** con contatori, inserimento rapido di **modelli, firme e set di hashtag**.
5. **Dove pubblicare**: elenco dei **profili** dello spazio (§3), formati solo con gli account di quello spazio, ognuno con una casella e, sotto, i suoi account IG e FB, ognuno con la propria casella. Spuntare il profilo spunta entrambi gli account; si può poi togliere uno dei due (es. solo Instagram). Ricerca per nome o @username, "seleziona tutti" e **gruppi salvati**. Un account da ricollegare o non pubblicabile (§8.4) compare disattivato con il motivo e non si può spuntare. Se il contesto attivo è un profilo, l'elenco parte con quel profilo già spuntato; se è un cliente, nulla è spuntato.
6. **Quando**: "Pubblica ora", data e ora, oppure "Prossima fascia libera". L'ora parte già compilata con l'**orario predefinito del cliente** (impostato nello spazio, per esempio 18:00), se c'è; si cambia liberamente.
7. **Etichette** e **note interne**.
8. **Riepilogo destinazioni**: cosa verrà pubblicato su ogni account e come. "Programma" si attiva solo senza blocchi e con una scelta per ogni avviso.

Le bozze si salvano da sole. L'Editor può solo salvare bozze.

### 11.3 Anteprima come su Meta

Accanto al modulo, aggiornata mentre scrivi:
- schede per destinazione: IG feed, IG reel, IG storia, FB post, FB reel, FB storia (solo quelle pertinenti);
- cornice da telefono con avatar e nome dell'account, caption, pulsanti finti, interfaccia sovrapposta per reel e storie;
- ritaglio reale, compresi caroselli e scelte sugli avvisi;
- caption troncata come sulle piattaforme ("…altro"), hashtag e menzioni evidenziati;
- caroselli scorrevoli, video riproducibili con la copertina;
- **zone sicure** per reel e storie, per vedere se una scritta finisce sotto l'interfaccia.

La stessa anteprima compare nel dettaglio del post e nel calendario; in versione semplificata nel link cliente. È un'approssimazione fedele, non pixel per pixel: Meta cambia spesso interfaccia. La grafica finale segue le tue ispirazioni.

### 11.4 Calendario

- **Viste**: **mese** (predefinita da computer: colpo d'occhio sulla distribuzione), **settimana** (la vista dettagliata, con miniature grandi per rivedere i contenuti) ed elenco per giorno (predefinita da telefono). Si passa da una all'altra con la barra delle viste; l'ultima scelta resta nell'indirizzo della pagina.
- **Libreria a richiesta**: un pulsante "Libreria" apre la libreria media in un pannello laterale, da cui si trascina un file su un giorno per iniziare un post (con l'alternativa del pulsante "Usa in un post"). Chiusa per impostazione predefinita, così il calendario resta largo. Il pulsante compare solo dentro un cliente o un profilo (la libreria è dello spazio, §11.8) e solo a chi può usare la libreria (da Editor, §10.2); il post parte in quello spazio.
- **Filtri**: account; piattaforma; tipo; stato; autore; etichetta. Il filtro per cliente (uno, alcuni o tutti) c'è solo nel contesto "Tutti i clienti": dentro un cliente o un profilo la scelta del cliente è il contesto stesso.
- **Filtri rapidi**: Da pubblicare, Pubblicati, Con problema, Da preparare (§11.12), Oggi, Questa settimana; selettore "Mostra: Post · Piano · Entrambi".
- Ogni voce: miniatura, orario, icone degli account, colore dello stato ed etichette; clic per il dettaglio con anteprima.
- **Trascinamento** per spostare un post, con gli stessi controlli e "Annulla".
- **"+" su ogni giorno** (visibile al passaggio del mouse e al focus da tastiera, sempre visibile sul telefono), per chi può creare bozze: apre Nuovo post con quel giorno e l'orario predefinito del cliente già compilati. Da "Tutti i clienti" chiede prima il cliente. Non compare sui giorni passati.
- Filtri salvati nell'indirizzo della pagina.
- Il calendario segue il contesto attivo (§14.6): tutti i clienti, un cliente o un profilo; i filtri restringono ancora dentro quel contesto.
- Ognuno vede solo gli spazi a cui ha accesso nell'organizzazione corrente; Owner e Admin li vedono tutti.

### 11.5 Griglia Instagram

Per ogni account IG, la griglia del profilo (con le proporzioni attuali delle miniature: rettangolari 3:4 da inizio 2025, **da verificare** prima della tappa 6, perché la usa già l'anteprima della copertina) con i post già pubblicati (letti dall'API con i permessi esistenti) e quelli programmati inseriti al loro posto. Puoi **riordinare trascinando**: gli orari si scambiano di conseguenza, con conferma e "Annulla".

### 11.6 Programmazione in blocco e fasce orarie

**Fasce orarie** per spazio (es. lun–ven 12:30 e 18:00). Usate da "Prossima fascia libera" e dalla programmazione in blocco.

**In blocco**, in tre modi:
1. **Da file**: trascini molti file (o li scegli con "Scegli file"), con avanzamento per file e complessivo; nasce una bozza per file (o un carosello per gruppo) in una **tabella modificabile** (miniatura, tipo, caption, account, data). "Distribuisci sulle fasce libere" riempie le date.
2. **Da CSV/Excel**: colonne data, ora, caption, account, nome file; abbinamento automatico ai file caricati, errori per riga.
3. **Duplica**: copia un post su altre date o altri spazi.

I controlli girano su ogni riga: le righe con blocchi restano bozze, le altre vengono programmate. Riepilogo unico ("18 programmati, 2 da sistemare") e "Annulla" per qualche secondo.

### 11.7 Etichette, modelli, gruppi di account, note

- **Etichette colorate** per spazio (campagna, rubrica, promo), visibili e filtrabili nel calendario.
- **Modelli** per spazio: caption, firme, set di hashtag; inseribili con un clic.
- **Gruppi di account** salvati (es. "solo IG del cliente X").
- **Note interne** sul post, mai visibili ai clienti.

### 11.8 Libreria media

Per spazio, con cartelle e tag. Si caricano file con "Scegli file" o trascinandoli su una cartella. I file **salvati in libreria** restano disponibili per il riuso; tutti gli altri vengono cancellati dopo la pubblicazione (§11.9). Lo spazio occupato è visibile per spazio.

### 11.9 Modifica, annullamento e pulizia

- Un post programmato si modifica o annulla finché nessuna destinazione è in `preparing`; poi si annullano solo le destinazioni non ancora pubblicate.
- Un post pubblicato non si modifica dal pannello; resta il link al post.
- **Modifiche concorrenti**: se due persone modificano lo stesso post, il secondo salvataggio riceve "modificato da un altro utente, ricarica".
- File non in libreria cancellati `MEDIA_RETENTION_DAYS` (default 7) dopo che tutte le destinazioni sono concluse; resta una miniatura. Bozze abbandonate: 30 giorni.
- Le anteprime dei post programmati restano fino alla pubblicazione, per calendario e link cliente.

### 11.10 Link di sola visione per i clienti

Un Manager o Admin crea dallo spazio un **link di condivisione**:
- `PUBLIC_URL/share/<token>`, token casuale da 32 caratteri (nel database solo l'hash);
- opzioni: caption (sì), anteprime (sì), post già pubblicati (sì), contenuti in preparazione (sì), solo i prossimi N giorni;
- password facoltativa, scadenza, revoca immediata;
- ultima apertura e numero di visualizzazioni.

Il cliente **vede soltanto**: il calendario del solo suo spazio, anteprime, orari e link ai post pubblicati. Nessun commento, nessuna approvazione, nessun dato di altri clienti o del team, nessuna nota interna. Sola lettura.

**Come si presenta**:
- **Intestazione**: da un lato il logo della piattaforma (il brand della piattaforma, oggi Feedway, nome da `PRODUCT_NAME`), dall'altro il logo del cliente e "gestito da" con il logo dell'agenzia (§14.3); senza logo, il nome. Il colore è quello dell'agenzia. I loghi arrivano sull'host pubblico con gli stessi token dedicati delle miniature del link, mai con indirizzi del pannello.
- **Calendario a mesi completi** in scorrimento verticale: il mese corrente come griglia intera (lunedì–domenica), poi i mesi successivi sotto, finché ci sono contenuti o fino al limite "solo i prossimi N giorni". È la vista "da lontano": in ogni giorno miniature piccole con ora e tipo; un clic apre l'anteprima del post. Sul telefono ogni mese diventa un elenco per giorno, perché sette colonne a 390 px non si leggono.
- **Post mostrati**: solo da "programmato" in poi (programmati, in pubblicazione, pubblicati); mai bozze, annullati o in pausa.
- **Contenuti in preparazione** (§11.12): compaiono come "In preparazione" con tipo, titolo e ora, se l'opzione del link "Mostra i contenuti in preparazione" è attiva (predefinita: sì) e il modulo del piano è attivo. Un contenuto resta "In preparazione" finché il suo post non è programmato (anche se esiste già la bozza o se il post è stato annullato), così non sparisce dalla vista del cliente. Mai la scritta "In ritardo": per il cliente è sempre "In preparazione".

**"Stampa o salva PDF"**: un pulsante prepara la stampa della pagina con il foglio di stile di stampa del browser, da cui si stampa o si salva in PDF (nessun generatore di PDF sul server, nessuna dipendenza in più). Formato **A4 orizzontale, un mese per pagina**, con la stessa intestazione; contiene **solo le pubblicazioni da oggi in poi** (data del fuso dell'agenzia al momento della richiesta) e i contenuti in preparazione se mostrati; mai note interne. Stesso pulsante anche nel calendario del pannello, nel contesto di un cliente, per chi può creare link cliente: stampa **la vista del cliente** con gli stessi campi dichiarati del link, mai la vista del pannello (autori, etichette, bozze, stati interni).

Sicurezza: host pubblico senza cookie del pannello, miniature dedicate con token propri, limitazione delle richieste, `noindex`, ogni creazione e revoca nel registro attività.

### 11.11 Uso da telefono

- **Barra di navigazione in basso** con cinque voci: Dashboard, Calendario, **+ Nuovo post al centro** (più grande, sempre raggiungibile col pollice), Notifiche, Menu (le altre sezioni e il contesto attivo). Chi non può creare post (Viewer, §10.2) non vede il +: la barra ha quattro voci. Sostituisce la navigazione laterale sotto i 768 px; quando si apre la tastiera la barra si nasconde. Le voci sono una proposta da confermare nel progetto in Pencil (§14.1).
- **PWA**: "Aggiungi alla schermata Home" su iPhone e Android, apertura a schermo intero.
- Upload da galleria e fotocamera; HEIC convertite in automatico.
- Upload a pezzi con ripresa: se il telefono perde rete o blocca lo schermo, riprende al ritorno sul pannello (iPhone sospende le schede in background).
- Avviso prima di caricare video grandi su rete cellulare.
- **Condividi verso Feedway** dalla galleria su Android (Web Share Target); su iPhone i browser non lo supportano e si usa il selettore file.
- Finché il pannello è solo su Tailscale, sul telefono serve l'app Tailscale attiva.
- Senza rete la PWA mostra cosa è in coda e riprende quando la rete torna; non pubblica offline.

### 11.12 Piano editoriale

Chi decide il piano del mese ("il 20 esce VIDEO 1, il 22 il carosello del menu") lo scrive in Feedway, e chi carica vede già nel calendario cosa preparare e per quando. Deve essere semplice come scrivere su un'agenda. Pianificare (decidere cosa uscirà) e programmare (fissare un post vero) restano due azioni distinte, in due posti distinti.

**Una sezione a sé**
- Voce **"Piano editoriale"** nel menu a sinistra, separata dal Calendario.
- Il cliente è quello del contesto attivo (§14.6). Se il contesto è "Tutti i clienti", prima di mostrare il calendario una finestra chiede **"Per quale cliente fai il piano?"** (solo i clienti in cui l'utente può pianificare); la scelta diventa il contesto.
- La pagina è un **calendario del mese da riempire**, vuoto all'inizio, con frecce per i mesi successivi. Si clicca un giorno (o Invio sul giorno, da tastiera) e si apre un modulo breve: **giorno, tipo** (reel, carosello, foto, storia) e **titolo** obbligatori; **ora** (già compilata con l'orario predefinito del cliente, se c'è; si può svuotare) e **nota per chi prepara** facoltative. Invio = salvato, il modulo resta aperto per il successivo, così un mese si pianifica di seguito.
- Avviso sotto il titolo: "Il titolo può comparire nel calendario del cliente; la nota no."
- Si sposta trascinando su un altro giorno (con "Annulla" e l'alternativa "Sposta" nel menu), si modifica e si toglie dal suo menu.
- I contenuti già preparati restano visibili qui con "Preparato" e il collegamento al post, così il piano del mese si legge per intero.
- **"Stampa o salva PDF"** anche da qui, con lo stesso foglio di stile del calendario cliente (§11.10): A4 orizzontale, un mese per pagina, loghi, schede **piene** (non tratteggiate) con tipo, titolo e ora, per mostrarlo bene al cliente; mai le note.
- Sul telefono il mese diventa un elenco di giorni, ognuno con "+".

**Come si vede nel calendario principale**
- Scheda **tratteggiata e semitrasparente** con tipo, titolo, ora se c'è ed etichetta **"Da preparare"**: non si può confondere con un post vero. Diventa gialla con "Mancano meno di 36 ore" e rossa con "In ritardo" secondo l'istante di riferimento della regola 2.
- Selettore **"Mostra: Post · Piano · Entrambi"** (predefinito: Entrambi), salvato nell'indirizzo come gli altri filtri. Nel calendario principale non si pianifica: dalla scheda si apre il contenuto nel Piano editoriale o si prepara il post.
- Notifica **"Contenuto da preparare entro domani"** a chi può prepararlo in quello spazio (§12.2): 24 ore prima dell'istante di riferimento se il contenuto ha un'ora, alle 9:00 del giorno prima se non ce l'ha (mai di notte; valgono comunque le ore di silenzio). Una riga anche nel riepilogo delle 8:00 (§12.4).

**Da segnaposto a post**
- **"Prepara questo contenuto"** apre Nuovo post con cliente, giorno, ora (quella pianificata; se manca, l'orario predefinito del cliente; altrimenti la prossima fascia libera di quel giorno, §11.6) e tipo già compilati e la nota in evidenza. Se il file scelto non corrisponde al tipo pianificato, l'editor lo dice senza bloccare.
- Appena il post esiste (anche solo come bozza) la scheda tratteggiata **sparisce** e resta il post, con un piccolo segno "dal piano".

**Regole di dominio** (fissate qui perché nessuna tappa debba rifarle)
1. Un contenuto pianificato appartiene a **un solo spazio** e porta al massimo **un post**; un post viene al massimo da un contenuto pianificato.
2. Giorno e ora sono una **data locale più ora facoltativa** nel fuso predefinito dell'organizzazione (§6.5), non un istante: "il 20" senza orario è valido e il cambio dell'ora legale non lo sposta. Per avvisi e notifiche si usa un **istante di riferimento** calcolato da una sola funzione del dominio: data e ora, oppure la fine della giornata (23:59) se l'ora manca, convertiti con la regola dell'ora inesistente o doppia di §9.2. "In ritardo" scatta dopo l'istante di riferimento, "meno di 36 ore" 36 ore prima; si calcolano con `Clock`. Il post nato dal piano diventa un istante con la stessa regola.
3. Il post può uscire in un giorno diverso da quello pianificato: nel dettaglio del post compare "Previsto dal piano il 20", senza bloccare.
4. Se si toglie un contenuto pianificato, il post già creato resta com'è.
5. Se il post viene annullato o cancellato, il contenuto torna "Da preparare".
6. Il cliente vede tipo, titolo, giorno e ora; **mai la nota**. I campi esposti al link cliente sono dichiarati uno per uno.

**Regole tecniche**
- Modulo `plan` (§7.3), attivabile per organizzazione, con i permessi `plan.view`, `plan.edit` e `plan.prepare` (§10.2). Con il modulo spento i contenuti pianificati non compaiono da nessuna parte, link cliente compreso. È il primo modulo che aggiunge voci al calendario tramite il registro dei moduli, lo stesso che useranno le attività della 1.5.
- Il piano dipende dai post, mai il contrario. "Prepara" è un caso d'uso del modulo `plan` che chiama la funzione pubblica di creazione della bozza del modulo dei post e salva il collegamento **nella stessa transazione**: la scheda sparisce subito, senza aspettare un evento. Lo stato "preparato / annullato" si legge dal post tramite la funzione pubblica di lettura dei post, quindi non può andare fuori sincrono. Gli eventi servono solo alle notifiche.
- Nessun contatto con Meta; un solo lavoro leggero in coda, `plan.due_soon` (§9.4), uno per contenuto, con `organizationId` nei dati.
- Il collegamento al post è l'unico riferimento tra moduli ammesso nel database: `plan_items.post_id` con chiave esterna composta e `ON DELETE SET NULL (post_id)` (Postgres 15+), così una bozza abbandonata cancellata dopo 30 giorni (§11.9) libera il contenuto pianificato senza toccare `organization_id`. Preparare di nuovo un contenuto il cui post è stato annullato sostituisce il collegamento; il post annullato perde il segno "dal piano".

---

## 12. Notifiche

### 12.1 Architettura

1. Ogni fatto rilevante genera un **evento** scritto nella stessa transazione del cambio di stato (pattern *outbox*): se lo stato è salvato, la notifica non può perdersi.
2. Il dispatcher decide **chi** riceve (autore, Manager dello spazio, Admin, Owner) e su **quali canali**, secondo le preferenze.
3. Un lavoro `notify.deliver` per ogni destinatario e canale, con tentativi automatici; ogni invio è registrato (canale, esito, errore).
4. I canali implementano un'unica interfaccia `NotificationChannel`: aggiungerne uno (Slack, Discord, WhatsApp, notifiche push della PWA) non tocca il resto.
5. I tipi di evento sono registrati da ogni modulo (§7.3) con livello, destinatari e testi: le attività della versione 1.5 useranno lo stesso centro notifiche, le stesse email e lo stesso bot.

### 12.2 Eventi

| Evento | Livello | Canali predefiniti |
|---|---|---|
| Destinazione confermata | Info | Pannello; Telegram/email se attivati |
| Post confermato su tutti gli account | Successo | Pannello + Telegram |
| Pubblicazione fallita o con problema | Errore | Tutti |
| Destinazione in pausa | Avviso | Pannello + Telegram, ai Manager |
| Programmazione in blocco completata | Info | Pannello |
| Contenuto pianificato da preparare entro domani (§11.12) | Avviso | Pannello + Telegram, a chi può prepararlo nello spazio |
| Token non valido, account non sano, promemoria Meta | Critico / Avviso | Tutti, a Owner e Admin |
| Quota IG quasi esaurita | Avviso | Pannello |
| Worker fermo da più di 2 minuti | Critico | Telegram + email all'amministratore della piattaforma (inviato dal web) |
| Backup fallito | Critico | Tutti, all'amministratore della piattaforma |
| Riepilogo giornaliero | Info | Email + Telegram alle 8:00 |
| Nuovo accesso da un dispositivo sconosciuto; password, email, 2FA o passkey cambiate | Sicurezza | Email alla persona interessata (sempre, ignora le ore di silenzio), con il link "Non sono stato io" che blocca l'account e chiude le sessioni |

### 12.3 Canali e preferenze

- **Pannello**: campanella con contatore e **centro notifiche** con storico, filtri (livello, spazio, tipo) e stato di consegna per canale.
- **Telegram** (solo team): bot creato con @BotFather. Ogni utente collega il proprio Telegram da "Il mio account" con un link monouso (`t.me/<bot>?start=<codice>`), una volta per ogni agenzia che usa un bot proprio; con il bot della piattaforma basta un collegamento. Il worker riceve i comandi in long polling, senza esporre indirizzi. Comandi: `/oggi`, `/problemi`, `/stop`. Messaggi brevi con stato, account, inizio della caption e link.
- **Email**: SMTP configurato dal pannello, modelli HTML con versione testo, logo del brand. Errori, critici e riepilogo; successi solo se attivati. Canale disattivato finché non si configura un SMTP.
- **Preferenze per utente**: canali e livello minimo per ogni tipo di evento; "tutto ovunque" per i test.
- **Ore di silenzio**: disattivate di default; impostabili per utente; errori e critici passano sempre.
- **Raggruppamento**: più eventi simili nello stesso minuto diventano un solo messaggio con l'elenco.

### 12.4 Riepilogo giornaliero

Alle 8:00, tutti i giorni (orario e giorni modificabili per utente): post confermati ieri, problemi aperti, cosa esce oggi, contenuti pianificati da preparare entro domani, stato di token e account. Ogni modulo può aggiungere la propria sezione al riepilogo, come per le voci del calendario (§7.3); il lavoro di sistema avvia solo i riepiloghi, e ogni sezione si calcola dentro `uow.run({ organizationId, userId })` del destinatario.

---

## 13. Modello dati

ID UUID v7. Tutte le tabelle hanno `created_at` e `updated_at` (`timestamptz`). **Ogni tabella con dati di un'organizzazione ha `organization_id`** (anche se ricavabile dallo spazio): serve alla RLS, agli indici e, se un giorno servisse, alla distribuzione su più database. Nell'elenco la colonna è sottintesa in tutte le tabelle con dati di un'organizzazione, comprese le tabelle figlie (`post_targets`, `post_media`, `target_attempts`, `media_variants`, `library_items`, `post_labels`, `post_notes`, `notification_deliveries`…), che la usano anche nelle chiavi esterne composte.

```
-- Piattaforma e organizzazioni
organizations       id, name, slug (unico), status (active|suspended), limits (jsonb),
                    settings (jsonb), suspended_at
organization_members organization_id, user_id, role (owner|admin|member),
                    status (active|disabled)
organization_keys   organization_id, version, key_enc, created_at, retired_at

-- Identità e accesso (tabelle di Better Auth, nomi al plurale, ID UUID v7; §15.1)
users               id, name, email (citext, unica), email_verified, image,
                    two_factor_enabled, created_at, updated_at
                    + campi nostri: nickname (max 30), avatar_key, platform_role (admin|null),
                    status (active|disabled), theme (light|dark|system), locale, timezone,
                    last_organization_id, last_login_at, disabled_at, reactivated_at,
                    anonymized_at
sessions            id, user_id, token, expires_at, ip_address, user_agent,
                    created_at, updated_at + reauthenticated_at, auth_method (nostri)
accounts            id, user_id, provider_id (credential|google), account_id,
                    password (hash argon2id), …
verifications       id, identifier, value, expires_at   (reset password, cambio email)
two_factors         id, user_id, secret, backup_codes, verified,
                    failed_verification_count, locked_until
passkeys            id, user_id, name, public_key, credential_id, counter, device_type,
                    backed_up, transports, aaguid, created_at
rate_limits         tabella di Better Auth (i suoi limiti per IP)
rate_limit_counters limiti e fallimenti nostri, condivisi tra i processi (Better Auth ripulisce la sua tabella)
known_devices       user_id, device_hash, first_seen_at, last_seen_at
data_exports        id, user_id, status, storage_key, expires_at   (file cancellato dopo 24 ore)
invites             id, organization_id, purpose (bootstrap|invite|organization_owner), email,
                    existing_user_id (utente già esistente: accetta dopo l'accesso),
                    reserved_user_id (ID riservato alla persona nuova), token_hash,
                    invited_by, org_role, memberships (jsonb), expires_at, used_at
api_tokens          id, organization_id, user_id, name, token_hash, scopes, expires_at,
                    revoked_at   (predisposto, §18.3)

-- Spazi e account
workspaces          id, organization_id, name, slug (unico nell'organizzazione), logo_key,
                    default_post_time (facoltativa, ora locale), archived_at
workspace_members   workspace_id, user_id, role (manager|publisher|editor|viewer)
social_accounts     id, organization_id, platform (instagram|facebook), external_id, name, username,
                    avatar_url, page_id (vuoto per Instagram solo), connection_id, active,
                    health (ok|warning|error),
                    health_message, last_synced_at
                    -- page_id: per Facebook l'id della Pagina stessa (= external_id),
                    -- per Instagram l'id della Pagina a cui Meta lo collega; serve al profilo (§3)
account_connections id, organization_id, kind (facebook_login|instagram_login|meta_system_user),
                    connected_by (user_id), token_secret_id, expires_at, status, last_refreshed_at
workspace_accounts  workspace_id, account_id
account_groups      id, workspace_id, name, account_ids
time_slots          id, workspace_id, weekday, local_time

-- Media
media               id, workspace_id, uploaded_by, kind (image|video),
                    status (uploading|processing|ready|failed|deleted),
                    original_name, mime, size_bytes, sha256, width, height,
                    duration_ms, fps, video_codec, audio_codec, analysis (jsonb),
                    storage_key, deleted_at
media_variants      id, media_id, purpose (ig_feed|fb_photo|reel|story|thumbnail|share|preview|cover),
                    storage_key, public_token (unico, null per preview: mai servita da /m/*),
                    mime, size_bytes, width, height
library_folders     id, workspace_id, name, parent_id
library_items       media_id, folder_id, tags

-- Post e pubblicazione
posts               id, workspace_id, type (photo|carousel|reel|story), caption,
                    scheduled_at, timezone, status (derivato), options (jsonb),
                    created_by, scheduled_by, updated_by, version
post_media          post_id, media_id, position,
                    cover_media_id, cover_offset_ms   -- solo reel: immagine caricata o fotogramma
post_targets        id, post_id, account_id, variant, status, step, meta_ids (jsonb),
                    external_post_id, permalink, attempts, next_attempt_at,
                    last_error_code, last_error_message, published_at,
                    verified_at, verification (jsonb)
target_attempts     id, target_id, step, outcome, meta_error_code, duration_ms, created_at
labels              id, workspace_id, name, color
post_labels         post_id, label_id
post_notes          id, post_id, author_id, body
caption_templates   id, workspace_id, kind (caption|signature|hashtags), name, body
bulk_imports        id, workspace_id, created_by, source (files|csv|duplicate),
                    rows (jsonb), status, summary (jsonb)

-- Piano editoriale (modulo plan, §11.12)
plan_items          id, workspace_id, local_date, local_time (facoltativa),
                    type (photo|carousel|reel|story), title (1–80), note,
                    post_id (facoltativo, unico), created_by, updated_by

-- Notifiche e condivisione
outbox_events       id, organization_id (null = piattaforma), type, payload (jsonb),
                    created_at, dispatched_at
notifications       id, user_id, event_id, kind, level, workspace_id, payload (jsonb), read_at
notification_deliveries id, notification_id, channel (panel|telegram|email),
                    status (pending|sent|failed), attempts, error, sent_at
notification_prefs  user_id, event_kind, channels, min_level, quiet_hours (jsonb)
telegram_links      organization_id (null = bot della piattaforma), user_id, chat_id,
                    linked_at, link_code_hash, link_code_expires_at
share_links         id, workspace_id, token_hash, label, created_by, options (jsonb),
                    password_hash, expires_at, revoked_at, last_viewed_at, view_count

-- Sistema
integrations        organization_id (null = predefinita della piattaforma),
                    kind (meta|telegram|smtp|heartbeat), config (jsonb),
                    secret_enc, key_version, secret_hint, updated_by, verified_at
branding            organization_id (null = piattaforma), logo_key, primary_color,
                    email_footer
settings            key, value (jsonb), updated_by   (solo piattaforma)
system_heartbeats   process, instance, last_beat_at, details (jsonb)   (solo piattaforma)
audit_log           id, organization_id (null = piattaforma), actor_id,
                    source (panel|api|mcp|system), action, entity,
                    entity_id, workspace_id, ip, data (jsonb), created_at
```

- Vincoli nel database: chiavi esterne composte con `organization_id`, `UNIQUE (organization_id, platform, external_id)` (lo stesso account può passare da un'agenzia a un'altra), `UNIQUE (post_id, account_id)`, `CHECK` sugli enum, indice parziale sulle destinazioni in scadenza.
- `audit_log` a sola aggiunta (§15.6).
- RLS attiva su tutte le tabelle con `organization_id` (§6.5); indici che iniziano con `organization_id` o `workspace_id`.
- **Migrazioni** generate da drizzle-kit, rilette e versionate; solo in avanti; modifiche distruttive in due rilasci (aggiungi → migra → rimuovi).

---

## 14. UI/UX

### 14.1 Metodo

1. **Ispirazioni** e **branding** tuoi → **progetto grafico in Pencil** del pannello e del sito pubblico, prima del codice → **prototipo cliccabile** delle schermate principali (Nuovo post, Calendario, Griglia, Programmazione in blocco, Anteprima, Link cliente) da provare su telefono e computer → correzioni → sviluppo. I file di Pencil si salvano nel repository (`design/`), così chi sviluppa parte dallo stesso progetto; formato e collegamento con gli agenti si verificano con i primi file.

   **Come arriva il materiale**: Matteo allega file o uno ZIP nella chat del progetto (oppure collega una cartella del suo computer); l'agente li sistema e li porta nel repository con una PR, che fonde da solo:
   - `design/` — file di Pencil e guida al progetto grafico;
   - `design/brand/` — logo in SVG (più varianti chiara, scura e icona), colori, caratteri con la loro licenza, regole d'uso;
   - `design/ispirazioni/` — riferimenti e schermate, solo se servono a chi sviluppa.

   Dal branding nascono i token di `packages/ui` (§14.3), così colori e caratteri non si scrivono mai a mano nelle schermate.
2. **Design system** in `packages/ui`: colori, tipografia, spaziature, raggi, ombre come token; nessun valore scritto a mano nelle schermate.
3. Per ogni schermata tutti gli stati: vuoto (con il primo passo da fare), caricamento (scheletri), errore (cosa è successo e cosa fare), successo.

### 14.2 Regole

- **Un'azione principale per schermata**, evidente.
- **Mai perdere lavoro**: salvataggio automatico delle bozze; avviso se esci con modifiche.
- **"Annulla" invece di "Sei sicuro?"** per le azioni reversibili; conferma esplicita solo per ciò che non si annulla (Pubblica ora).
- **Errori accanto al campo**, in italiano semplice, con la soluzione.
- **Orari chiari**: fuso indicato, "tra 2 ore" accanto alla data, avviso nei giorni del cambio d'ora.
- **Ricerca e scorciatoie**: Cmd/Ctrl+K per cercare post, clienti e azioni; N per nuovo post.
- **Feedback immediato**: le azioni si vedono subito e si allineano col server in background.
- **Accessibilità WCAG 2.2 AA**: contrasto, tastiera, etichette, aree di tocco di almeno 44 px, "riduci movimento".
- **Avanzamento visibile**: ogni operazione che dura più di un attimo mostra a che punto è, mai una schermata ferma.
  - Upload: barra per ogni file con percentuale, MB caricati sul totale e tempo stimato; barra complessiva quando i file sono più di uno; pausa, ripresa e annulla; stato chiaro a fine caricamento (completato, errore con "Riprova").
  - Lavori sul server (analisi, conversioni, programmazione in blocco, esportazione dei dati, verifica dopo la pubblicazione): barra o passi ("Analisi → Conversione → Pronto") aggiornati in tempo reale; si può lasciare la pagina e ritrovare l'avanzamento al ritorno.
  - Indicatore indeterminato solo quando la durata non si può stimare; scheletri di caricamento per le pagine.
  - Accessibile: `role="progressbar"` con valore corrente, annunci ai lettori di schermo all'inizio e alla fine, nessuna animazione con "riduci movimento".
- **Trascinamento mai obbligatorio**: ogni azione che si fa trascinando (file, ordine del carosello, post nel calendario, griglia Instagram) ha un'alternativa con pulsanti, da tastiera e da tocco (WCAG 2.2, criterio 2.5.7).
- **Prestazioni**: meno di 2,5 s su telefono di fascia media, miniature ottimizzate.

### 14.3 Tema e brand

- Tema **chiaro, scuro e automatico**, scelto per utente; entrambi con contrasti AA.
- **Logo e colore principale** per organizzazione, caricati da Impostazioni: pannello, email, bot, link cliente. Logo del singolo cliente facoltativo, caricato dallo spazio. Nel link cliente compaiono il logo della piattaforma, quello del cliente e "gestito da" con quello dell'agenzia (§11.10). La pagina di login, che viene prima della scelta dell'agenzia, usa il brand della piattaforma.
- **Selettore dell'agenzia** in alto, visibile solo a chi appartiene a più organizzazioni; accanto, il selettore del contesto (§14.6).

### 14.4 Schermate

| Schermata | Chi | Contenuto |
|---|---|---|
| Accesso (passkey o password), 2FA, attivazione invito, reset, conferma email | tutti | Nessuna pagina "registrati" nella 1.0 |
| Prima configurazione | Owner | §8.1 |
| Dashboard | tutti | Prossime pubblicazioni, in verifica, problemi aperti, stato account e worker, spazio disco |
| Centro notifiche | tutti | §12.3 |
| Nuovo post | da Editor | §11.2–11.3 |
| Calendario | tutti | §11.4, con i contenuti pianificati (§11.12) |
| Piano editoriale | tutti in sola lettura; da Publisher per pianificare | §11.12 |
| Griglia Instagram | tutti | §11.5 |
| Programmazione in blocco | da Publisher | §11.6 |
| Post | tutti | Elenco filtrabile, dettaglio per destinazione con tentativi, verifica e link |
| Libreria | da Editor | §11.8 |
| Spazi di lavoro | Admin; Manager per il proprio | Account, membri, orario predefinito, fasce, etichette, modelli, gruppi, link cliente |
| Account social | Admin | Stato, quota, "Aggiungi account", assegnazione agli spazi |
| Utenti | Admin; Manager per inviti nei propri spazi | Inviti, ruoli, disattivazione nell'agenzia, reset (solo utenti della sola agenzia) |
| Registro attività | Admin; Manager per il proprio spazio | Filtri per utente, azione, data, origine |
| Impostazioni | Owner; Admin in sola lettura | Integrazioni, brand, 2FA obbligatoria, conservazione file dell'organizzazione |
| Piattaforma | Amministratore della piattaforma | Nella 1.0: sezione **Integrazioni** nel pannello (valori predefiniti di email e Telegram, sorveglianza esterna), visibile solo a lui; organizzazioni e limiti da comando. Nella 2.0: anche organizzazioni, limiti, uso e sospensione dal pannello |
| Il mio account | tutti | Nome, soprannome, foto, email, passkey, password, 2FA, dispositivi collegati, Telegram, notifiche, tema, "Scarica i miei dati", "Elimina il mio account" (§10.5) |
| Privacy | tutti, anche senza accesso | Informativa dell'agenzia (§15.7) |
| Calendario condiviso | clienti, senza login | §11.10, con "Stampa o salva PDF" |

### 14.5 Sito pubblico

Il sito presenta Feedway e porta all'accesso. È **separato dal pannello** (ADR 013): pagine statiche su Cloudflare Pages, senza server, database, login né dati delle agenzie. Se la VPS è ferma o in aggiornamento il sito resta online.

**Indirizzi**: sito su `tuodominio.it` (`www` rimanda lì), pannello su `app.tuodominio.it`, file per Meta e link cliente su `pub.tuodominio.it` (§16.1). Il pulsante **"Accedi"** porta alla pagina di accesso del pannello. Il modulo di accesso non sta mai dentro il sito: passkey e cookie restano legati all'indirizzo del pannello (§15.1, §15.2) e un sito compromesso non può leggere password.

**Pagine nella 1.0**

| Pagina | Contenuto |
|---|---|
| Home | Cosa fa Feedway in una frase; vantaggi principali (IG e FB da un solo posto, anteprima come su Meta, verifica dopo la pubblicazione, più clienti e più utenti, uso da telefono); come funziona in tre passi; immagini del prodotto vero; domande frequenti; "Accedi" e "Contattaci" |
| Privacy | Informativa del sito, con te come titolare; diversa dall'informativa delle agenzie, che sta nel pannello (§15.7) |
| Cookie | Dichiara che il sito non usa cookie di profilazione né di terze parti |
| Note legali | Titolare, sede e contatti. Se c'è la partita IVA va indicata nella home (art. 35 DPR 633/1972): la mettiamo nel piè di pagina di ogni pagina |
| 404 | Collegamenti alla home e ad "Accedi" |

Nella 2.0 si aggiungono prezzi, registrazione, termini di servizio, accordo sul trattamento dei dati e stato del servizio (§18.2).

**Contatti**: nella 1.0 un indirizzo email, senza modulo, così il sito non raccoglie dati personali. Un modulo o una lista d'attesa arriva con la 2.0, con consenso esplicito e conferma via email.

**Privacy**: nessun cookie del sito, quindi nessun banner: tema solo automatico (segue il telefono o il computer, senza salvare preferenze) e protezioni anti-bot di Cloudflare spente sull'host del sito (mettono cookie). Statistiche di visita con Cloudflare Web Analytics, senza cookie né impronte del browser. Cloudflare tratta comunque gli indirizzi IP come fornitore, e l'informativa lo dice. Font serviti dal sito stesso; nessun contenuto incorporato da terzi (i video stanno sul sito o partono solo al clic).

**Motori di ricerca**: titolo e descrizione per pagina, URL canonici, anteprima per i social (Open Graph), dati strutturati (`Organization`, `SoftwareApplication`), `sitemap.xml` e `robots.txt`. Pannello e host pubblico, al contrario, non devono comparire nelle ricerche (§16.1).

**Lingue**: italiano all'uscita; struttura pronta per l'inglese (`/en/` con `hreflang`) e testi nei file di traduzione del sito (`apps/site/i18n/locales/`), come nel pannello.

**Qualità**: stessi token di colore e tema chiaro/scuro del pannello (`packages/ui`) e stesso nome (`PRODUCT_NAME`); logo e immagini del sito sono file nel repository, non il brand caricato dal pannello; WCAG 2.2 AA verificato con axe; caricamento sotto 2,5 s su telefono (LCP); collegamenti verificati in CI; intestazioni di sicurezza nel file `_headers` di Cloudflare Pages: CSP con gli hash degli script inline che Nuxt genera e il solo `static.cloudflareinsights.com` ammesso (da verificare alla prima build), HSTS, `frame-ancestors 'none'`.

**Alternativa sulla VPS**: la stessa build statica si può servire da un piccolo container (Caddy) sulla VPS, dietro Cloudflare Tunnel sul dominio principale, senza cambiare codice e senza toccare il pannello. Costa poche risorse, ma il sito va offline insieme alla VPS: per questo la scelta predefinita resta Cloudflare Pages.

**Grafica**: il branding del sito arriva da te e si progetta in Pencil prima del codice, come il pannello (§14.1).

**Modifiche**: i testi si cambiano con una PR come il resto del codice; ogni PR ha un'anteprima su un indirizzo provvisorio non indicizzato e la CI pubblica il sito al merge. Nessun CMS nella 1.0: per pochi testi sarebbe un servizio in più da proteggere.


### 14.6 Navigazione e contesto

- **Selettore del contesto**, come su Meta Business Suite: "Tutti i clienti" per la visione d'insieme, poi un cliente (spazio) e, dentro il cliente, un singolo profilo. Mostra solo gli spazi a cui hai accesso. Dashboard, calendario, post, griglia e libreria si restringono alla scelta, che resta nell'indirizzo della pagina (così un link porta nello stesso contesto). Il contesto non è un permesso: i controlli restano quelli di §10.
- **Nuovo post** parte dal contesto: dentro un profilo, con quel profilo già spuntato; dentro un cliente, con il cliente scelto; da "Tutti i clienti", chiede prima il cliente, perché si pubblica solo dentro uno spazio.
- **Nell'indirizzo**: `?spazio=<slug>` per un cliente, `?spazio=<slug>&profilo=<id dell'account IG, o della Pagina se il profilo non ha IG>` per un profilo. Uno slug o un id sconosciuto, di uno spazio che non vedi o di un account fuori da quello spazio portano tutti allo stesso modo a "Tutti i clienti", con la stessa risposta e lo stesso tempo, senza rivelare se esiste.

---

## 15. Sicurezza e privacy

### 15.1 Autenticazione
- **Better Auth** (ADR 012) gestisce account, sessioni, 2FA, passkey, reset, cambio email e limitazione dei tentativi; montato sulla rotta `server/api/auth/[...all].ts` con `better-auth/vue` (non il modulo Nuxt della comunità, ancora in alpha). Organizzazioni, ruoli, spazi, inviti, riconferma, registro e privacy restano nostri. Plugin attivi solo `twoFactor` e `@better-auth/passkey`; mai `organization`, `admin`, `oidcProvider`, `mcp`.
- Versione fissata esatta; Renovate apre subito una PR per ogni avviso di sicurezza; la batteria di test dei flussi di accesso (unità, integrazione, E2E) deve passare a ogni aggiornamento.
- Registrazione pubblica spenta (`disabledPaths: ['/sign-up/email']`): gli account nascono solo dall'attivazione di un invito, lato server, in modo ripetibile se si interrompe a metà.
- **Passkey** con verifica dell'utente obbligatoria (impronta, volto o PIN), `rpID` = host del pannello: vale come due fattori.
- **Password** argon2id (`@node-rs/argon2`), minimo 12 caratteri, elenco delle password più comuni incluso nell'applicazione.
- **2FA** con app di autenticazione e 10 codici di recupero (nessun codice via email), obbligatoria per l'amministratore della piattaforma, Owner e Admin (per tutti con `REQUIRE_2FA=all` o se l'organizzazione lo richiede); la regola è nostra e vale anche per i metodi senza password futuri (Google).
- Limitazione dei tentativi salvata nel database, con regole più strette su accesso, 2FA e reset; IP letto dall'intestazione del nostro proxy; messaggi che non rivelano se l'email esiste.
- Ganci di Better Auth scrivono nel registro attività accessi, fallimenti e ogni cambio di password, email, 2FA o passkey, e fanno partire le email di sicurezza (§12.2).
- **Verificato nella tappa 2 (Better Auth 1.7.10, ADR 012)**: segreto TOTP e codici di recupero sono cifrati dalla libreria; `disableSignUp` blocca anche la creazione lato server, quindi l'attivazione usa l'adattatore interno; i tentativi falliti si leggono dal gancio `after`; il token di sessione è salvato in chiaro (accettato, rischio in §20).

### 15.2 Sessioni
- Sessioni di Better Auth nel database, cookie `HttpOnly`, `Secure`, `SameSite=Lax` solo sull'host del pannello, senza attributo `Domain`, così il sito pubblico sul dominio principale non li riceve; con il prefisso `__Host-` (nome personalizzato in Better Auth con `useSecureCookies: false` e attributo `Secure` esplicito, verificato nella tappa 2; vale per sessione, 2FA e passkey) il dominio principale non può nemmeno sovrascriverli; `cookieCache` spento, così una revoca vale subito.
- Scadenza per inattività 12 ore, assoluta 30 giorni (controllo nostro su `created_at`); nuovo token a ogni login e cambio di privilegi.
- "Sessioni attive" con revoca; disattivazione e reset chiudono tutte le sessioni.
- **Riconferma** (password o 2FA) per azioni delicate: ruoli, nomina Admin, integrazioni, brand, impostazioni.

### 15.3 Richieste
- Input validato con Zod sul server; risposte con DTO espliciti.
- CSRF: `SameSite`, controllo di `Origin`/`Sec-Fetch-Site`, header personalizzato obbligatorio sulle API.
- nuxt-security: CSP con nonce (`media-src 'self' blob:` per l'anteprima locale dei video), HSTS, `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`.
- Limiti di dimensione e frequenza; errori generici verso il browser con ID richiesta, dettaglio solo nei log.

### 15.4 File
- Tipo verificato dai byte, nomi generati dal server, nessun percorso costruito dall'input.
- Limiti su pixel, durata e dimensione prima di decodificare.
- ffmpeg con timeout e priorità bassa nel worker con limiti di risorse.
- Host pubblico: niente cookie, `nosniff`, su `/m/*` solo JPEG e MP4; token da 32 caratteri non elencabili, cancellati con la pulizia.

### 15.5 Segreti
- Integrazioni cifrate nel database con chiavi per organizzazione (§6.5, §8.3); infrastruttura in segreti Docker letti con `*_FILE`.
- Token mai inviati al browser, oscurati nei log; `appsecret_proof` su ogni chiamata Meta.
- Nel repository solo `.env.example`; gitleaks in CI.

### 15.6 Database e tracciabilità
- Postgres solo in rete interna.
- Due utenti: `app_migrator` (migrazioni) e `app_runtime` (permessi limitati, **senza UPDATE né DELETE su `audit_log`**, soggetto alla RLS; l'ambito di sistema si apre solo tramite `runAsSystem`, consentito per regola di lint nei moduli elencati in §6.5).
- Isolamento tra organizzazioni con RLS (§6.5).
- Registro: login e fallimenti, inviti, ruoli, post (creazione, modifica, annullamento, pubblicazione), blocco, link cliente, integrazioni, impostazioni, con origine (pannello, API, MCP, sistema).

### 15.7 Privacy (GDPR)
- Solo i dati necessari: niente dati dei follower né statistiche personali.
- EXIF e GPS rimossi; media cancellati dopo la pubblicazione salvo libreria.
- Nella 1.0 l'agenzia è titolare dei dati del team; nella 2.0 la piattaforma sarà responsabile del trattamento per le altre agenzie (con contratto).
- Solo cookie tecnici (sessione, cookie temporanei di Better Auth per 2FA e passkey, tema, identificativo casuale del dispositivo `__Host-device` per riconoscere un accesso da un dispositivo nuovo, senza dati personali; la protezione CSRF usa un'intestazione, non un cookie): nessun banner; informativa compilabile per agenzia nella pagina Privacy e nella pagina di accesso.
- **Accesso e portabilità**: "Scarica i miei dati" nel profilo, ZIP con JSON leggibile e foto, link valido 24 ore.
- **Cancellazione**: "Elimina il mio account" con riconferma, oppure su richiesta all'amministratore della piattaforma (l'identità è unica tra le agenzie). Foto, passkey, 2FA, sessioni, dispositivi e collegamenti Telegram si cancellano subito; nome, email e soprannome diventano "Utente rimosso". Un Owner deve prima passare la proprietà a un Admin (§10.4).
- **Conservazione automatica**: sessioni scadute 30 giorni; dispositivi noti 12 mesi dall'ultimo uso; IP nel registro abbreviati dopo 90 giorni; account disattivati da più di 24 mesi anonimizzati, con avviso all'Owner 30 giorni prima.
- Registro dei trattamenti (`docs/privacy/registro-trattamenti.md`) e procedura per le violazioni entro 72 ore (`docs/runbooks/violazione-dati.md`).
- Esportazione e cancellazione di un'intera organizzazione nella 2.0 (resa semplice da `organization_id` ovunque e dai file con prefisso per organizzazione).
- Registro attività conservato 24 mesi, poi riassunto.
- I link cliente non mostrano nomi o dati del team.
- Il sito pubblico non usa cookie e non ha moduli nella 1.0; Cloudflare, che lo ospita, tratta gli indirizzi IP come fornitore. Ha la propria informativa, con te come titolare (§14.5).

### 15.8 Dipendenze
- Lockfile versionato, `--frozen-lockfile`, Renovate con CI obbligatoria.
- `pnpm audit`, CodeQL, gitleaks, Trivy; immagini base con versione fissata.

---

## 16. Infrastruttura e operazioni

### 16.1 Esposizione su internet

Il pannello deve essere privato; i media devono essere pubblici perché li scarica Meta; il sito pubblico deve essere trovato dai motori di ricerca. Il server distingue gli host: su `PUBLIC_HOST` risponde solo a `/m/*` e `/share/*`; sull'host del pannello a tutto il resto, e a quei percorsi no. Il sito non passa dalla VPS.

| Fase | Sito pubblico | Pannello | Host pubblico | Dominio |
|---|---|---|---|---|
| **Inizio (consigliato)** | Nessuno | Solo **Tailscale** (`*.ts.net`) | **Tailscale Funnel** su un secondo nodo dedicato (nome `*.ts.net` diverso dal pannello), solo `/m/` e `/share/` | Non serve |
| **Con dominio** | **Cloudflare Pages** su `tuodominio.it` | `app.tuodominio.it` con Cloudflare Tunnel + **Cloudflare Access**, oppure resta su Tailscale (`*.ts.net`) | **Cloudflare Tunnel** su `pub.tuodominio.it` | Su Cloudflare |

- I quick tunnel `*.trycloudflare.com` cambiano indirizzo a ogni riavvio: non adatti.
- Il passaggio di fase cambia solo `PUBLIC_URL`, `PUBLIC_HOST` e `PANEL_URL`; gli URL dei media si costruiscono al momento della pubblicazione.
- Con Cloudflare: regola che escluda `/m/*` e `/share/*` da Bot Fight Mode e sfide anti-bot; `facebookexternalhit` non bloccato.
- I collaboratori, con il pannello solo su Tailscale, vanno invitati nel tailnet; se diventano tanti conviene Cloudflare Access.
- "Accedi" sul sito porta a `PANEL_URL`: con il pannello su Tailscale o dietro Cloudflare Access si apre solo per chi ha accesso, ed è voluto. Nella 2.0, con la registrazione libera, il pannello diventa raggiungibile da internet e il suo accesso resta protetto da Better Auth e limitazione dei tentativi.
- Pannello e host pubblico non si fanno indicizzare: `robots.txt` che blocca tutto e intestazione `X-Robots-Tag: noindex`. L'indirizzo tecnico del sito (`<progetto>.pages.dev`) rimanda a `tuodominio.it`.

### 16.2 Configurazione dell'infrastruttura

Solo queste variabili, **scritte da `install.sh`**; validate all'avvio con Zod (il container non parte se mancano o sono errate). I segreti si passano come file (`*_FILE`).

| Variabile | Esempio | Segreto | Note |
|---|---|---|---|
| `DATABASE_URL` | `postgres://app_runtime:…@postgres/app` | sì | |
| `DATABASE_MIGRATOR_URL` | `postgres://app_migrator:…@postgres/app` | sì | Solo migrate |
| `DATABASE_RUNTIME_ROLE` | `app_runtime` | | Ruolo a cui il migratore concede i permessi |
| `APP_ENCRYPTION_KEY` | 32 byte base64 | sì | Chiave della piattaforma: cifra integrazioni predefinite, le chiavi dati delle organizzazioni ed eventuali segreti 2FA (§15.1) |
| `BETTER_AUTH_SECRET` | 32 byte base64 | sì | Firma di cookie e token di Better Auth; rotazione con `BETTER_AUTH_SECRETS` |
| `BACKUP_AGE_RECIPIENT` | `age1…` | | Chiave pubblica con cui si cifrano i backup; la privata resta fuori dalla VPS |
| `PANEL_URL` | `https://feedway.tuo-tailnet.ts.net` | | |
| `PUBLIC_URL` / `PUBLIC_HOST` | `https://pub.tuodominio.it` | | Host pubblico |
| `SITE_URL` | `https://tuodominio.it` | | Facoltativa: collegamento al sito dalla pagina di accesso |
| `META_GRAPH_VERSION` | es. `v24.0` | | Aggiornata con PR e test |
| `META_MODE` | `live` | | `live`, `mock`, `dry-run` |
| `TZ_DEFAULT` | `Europe/Rome` | | |
| `MEDIA_RETENTION_DAYS` | `7` | | |
| `REQUIRE_2FA` | `admins` | | `admins` o `all` |
| `BACKUP_DIR` | `/srv/backups/feedway` | | Inclusa in rclone |
| `BOOTSTRAP_OWNER_EMAIL` | | | Solo al primo avvio |
| `BOOTSTRAP_ORGANIZATION_NAME` | `Agenzia Rossi` | | Solo al primo avvio: nome della prima organizzazione |
| `WORKER_QUEUES` | `*` | | Code servite da questo worker (§6.4) |
| `LOG_LEVEL` | `info` | | |
| `SENTRY_DSN` | | | Facoltativo (anche GlitchTip) |

### 16.3 Docker Compose

```yaml
# schema indicativo
services:
  postgres: { image: postgres:18-alpine, networks: [internal], volumes: [pgdata:/var/lib/postgresql] }  # dalla 18 i dati stanno in /var/lib/postgresql/18/docker
  migrate:  { image: ghcr.io/grecomatteo/feedway:<versione>, command: migrate, networks: [internal],
              depends_on: { postgres: { condition: service_healthy } } }
  web:      { image: ghcr.io/grecomatteo/feedway:<versione>, command: web, networks: [internal, edge],
              volumes: [media:/data/media],
              depends_on: { migrate: { condition: service_completed_successfully } } }
  worker:   { image: ghcr.io/grecomatteo/feedway:<versione>, command: worker, networks: [internal, egress],
              volumes: [media:/data/media],
              depends_on: { migrate: { condition: service_completed_successfully } } }
  backup:   { networks: [internal], volumes: ["${BACKUP_DIR}:/backups"] }
  cloudflared / tailscale: { networks: [edge] }
networks:
  internal: { internal: true }
  edge: {}
  egress: {}
```

Per ogni container applicativo: utente non root, file system in sola lettura con `/tmp` in memoria, `cap_drop: [ALL]`, `no-new-privileges`, limiti di CPU e memoria, healthcheck, `restart: unless-stopped`, nessuna porta sull'host. Un'immagine (Node 24 + ffmpeg) con quattro comandi: `web`, `worker`, `migrate`, `cli`; build in più fasi; versione fissata, mai `latest`.

### 16.4 Backup e ripristino

Copiare i file di Postgres a database acceso non dà un backup affidabile. Quindi:
1. Il container `backup` fa ogni notte un `pg_dump` coerente in `BACKUP_DIR`, con rotazione 7 giornalieri, 4 settimanali, 3 mensili, e scrive `last_success`.
2. Il tuo rclone include `BACKUP_DIR` e lo porta su Google Drive.
3. Da escludere da rclone il volume `pgdata`.
4. Un dump fallito genera una notifica critica.
5. Dump e copia della libreria **sempre cifrati** con `age` (contengono dati personali e finiscono su Google Drive). `install.sh` genera la coppia di chiavi, scrive la pubblica in `BACKUP_AGE_RECIPIENT` e mostra la privata una sola volta, da conservare fuori dalla VPS (gestore di password).

Ripristino: runbook in `docs/runbooks/` e `restore-check.sh`, che ripristina l'ultimo dump in un database temporaneo e ne verifica la leggibilità; da lanciare una volta al mese. I media temporanei non vanno nel backup. I file della **libreria** sì: il container `backup` li copia ogni notte in `BACKUP_DIR/library` (copia incrementale), così finiscono su Google Drive con il resto.

### 16.5 Rilascio

1. Le PR dei task si fondono su `main` a CI verde; a fine tappa Matteo fonde la PR di rilascio di release-please, che crea il tag `vX.Y.Z`; la CI costruisce l'immagine, la analizza con Trivy e la pubblica su GitHub Container Registry.
2. Sulla VPS: `./update.sh` (scarica la versione, esegue migrate, riavvia web e worker).
3. Rollback alla versione precedente: le migrazioni restano compatibili per almeno un rilascio.

### 16.6 Risorse (2 core, 12 GB)

Il vincolo vero sono i 2 core condivisi: Feedway non deve mai occuparli entrambi.

| Container | Memoria max | CPU max |
|---|---|---|
| postgres (`shared_buffers` 256 MB) | 1 GB | 0,5 |
| web | 768 MB | 0,5 |
| worker (con ffmpeg) | 2 GB | 1,0 |
| backup | 256 MB | 0,25 |
| **Totale** | **circa 4 GB** (a riposo 600–800 MB) | |

Conversioni video: una alla volta, `nice`, ffmpeg su un thread; prima la strada senza ricodifica (`faststart`, cambio contenitore), ricodifica solo se serve, con preset veloce; sempre subito dopo l'upload, mai all'orario di pubblicazione. Stima da verificare: qualche minuto per un reel di 60 s in 1080p.

### 16.7 Monitoraggio

- `/api/health` (vivo) e `/api/ready` (database e coda raggiungibili).
- Il worker scrive il proprio battito nella tabella `system_heartbeats`; la dashboard lo mostra e, se manca da più di 2 minuti, il web avvisa l'amministratore della piattaforma.
- **Sorveglianza esterna**: il worker invia ogni minuto un segnale a un servizio esterno (healthchecks.io o Uptime Kuma su un altro server), che avvisa su Telegram o email se si ferma tutta la VPS.
- Log JSON con ID richiesta e ID lavoro; metriche Prometheus facoltative in rete interna; Sentry/GlitchTip facoltativo.

---

## 17. Qualità e test

### 17.1 Processo

- TypeScript strict; nessun `any` senza giustificazione.
- ESLint (anche regole di sicurezza), Prettier, dependency-cruiser.
- Husky + lint-staged; Conventional Commits con commitlint; changelog e versioni con release-please.
- Flusso Git in `docs/flusso-git.md`: rami corti, una PR piccola per task, squash merge, `main` protetto da un ruleset versionato (nessun push diretto, CI verde obbligatoria, storia lineare), una versione per tappa.
- Documenti del repository: `README.md`, `CONTRIBUTING.md`, `AGENTS.md` (istruzioni per gli agenti, importato da `CLAUDE.md`), `SECURITY.md`, `docs/convenzioni.md`, `docs/moduli.md`, ADR in `docs/adr/`.
- Errori di dominio tipizzati (`POST_NOT_EDITABLE`, `FORBIDDEN`…), tradotti in risposte HTTP in un solo punto.
- ADR per ogni decisione importante; runbook per ripristino, rotazione token e incidenti.
- Sviluppo locale con `compose.dev.yml`: Postgres, finto Graph API, Mailpit, dati di esempio. Mai contro account reali.
- In locale gli indirizzi sono separati come in produzione: `app.feedway.localhost` (pannello), `pub.feedway.localhost` (host pubblico), `feedway.localhost` (sito). I nomi `*.localhost` puntano al proprio computer senza configurare nulla e i browser li trattano come sicuri, così separazione degli host e cookie si provano come in produzione. Le passkey su `*.localhost` si verificano all'inizio della tappa 2.
- Per ogni funzione: test prima del codice (TDD) per dominio e casi d'uso.
- Testi dell'interfaccia nei file di traduzione (`@nuxtjs/i18n`, solo italiano nella 1.0).

### 17.2 CI (GitHub Actions)

| Passo | Contenuto |
|---|---|
| Lint e tipi | ESLint, Prettier, `tsc`, dependency-cruiser, commitlint sul titolo della PR |
| Unit | Dominio e regole |
| Integrazione | Repository, coda, casi d'uso su Postgres reale (Testcontainers) |
| End-to-end | Playwright con finto Graph API, su telefono e computer, tema chiaro e scuro |
| Accessibilità | axe-core sulle schermate principali |
| Sicurezza | CodeQL, gitleaks, `pnpm audit` |
| Immagine | Build, Trivy, pubblicazione su GHCR (solo `main`) |
| Sito | Dalla tappa 10: build statica, axe e collegamenti a ogni PR (controllo obbligatorio `site`); anteprima per la PR e pubblicazione su Cloudflare Pages da `main` in un workflow a parte, solo quando cambiano `apps/site` o `packages/ui` |

### 17.3 Piano di test

| Livello | Cosa | Come |
|---|---|---|
| Dominio | Regole §9.1–9.2, macchina a stati §9.3, matrice permessi §10.2, fasce orarie e distribuzione in blocco | Vitest, tabelle di casi; copertura ≥ 90% |
| Media | Analisi e conversioni | File generati con ffmpeg (9:16, 1:1, 4K, 120 s, HEVC, senza audio, EXIF con GPS, HEIC) |
| Client Meta | Flussi, classificazione errori, ripresa, esito incerto, verifica | Finto Graph API con risposte registrate dai primi test reali |
| Integrazione | Nessun doppione con due worker e riavvii a metà; outbox senza perdite | Testcontainers |
| Sicurezza | Isolamento tra organizzazioni su ogni rotta e lavoro (§6.5), RLS anche con una query senza filtro, accessi vietati per ruolo e spazio, ID indovinati, CSRF, sessioni revocate, rate limit, link cliente revocati o scaduti, segreti mai restituiti | Test API |
| Notifiche | Destinatari, preferenze, raggruppamento, ore di silenzio, consegne fallite | Finto Telegram, Mailpit |
| Blocco | CSV con errori per riga, abbinamento file, annullamento | Integrazione + E2E |
| End-to-end | Installazione → prima configurazione (mock) → invito → 2FA → upload da telefono → post → pubblicazione simulata → verifica → notifica | Playwright |
| Reale | Prima pubblicazione su un account IG e una Pagina di prova per ogni tipo | Manuale, insieme |

---

## 18. Roadmap e ordine di sviluppo

### 18.1 Versione 1.0: sviluppo a tappe

Tutte le funzioni concordate sono nella 1.0. La si costruisce in tappe, ognuna installabile e provabile sulla VPS.

| Tappa | Contenuto | Requisiti |
|---|---|---|
| 1. Fondamenta | Monorepo, CI, Docker, Postgres, migrazioni, configurazione, log, design system con tema chiaro/scuro, `install.sh`/`update.sh`. In parallelo: **prototipo cliccabile** da approvare | RNF-08, RNF-09, RF-01, RF-70 |
| 2. Identità e organizzazioni | Organizzazioni con isolamento (RLS), amministratore della piattaforma, Owner, Better Auth (accesso con passkey o password, sessioni, 2FA), inviti, account personale (soprannome, foto, cambio email, dispositivi), privacy (esportazione, cancellazione, conservazione), ruoli, spazi, permessi, selettore dell'agenzia e del contesto, barra in basso del telefono, registro attività | RF-04, RF-10–15, RNF-14 |
| 3. Meta | Prima configurazione guidata, integrazioni cifrate, aggiungi account, sincronizzazione, salute, promemoria, profili (IG + Pagina FB) (primo contatto reale con Meta) | RF-02, RF-03, RF-05, RF-20, RF-21 |
| 4. Media | Upload a pezzi, analisi, conversioni, copia di anteprima dei video, host pubblico, libreria | RF-30, RF-31, RF-45 |
| 5. Regole | Controlli e corrispondenza IG↔FB con i test | RF-32, RF-33 |
| 6. Post | Creazione, anteprima Meta con video riproducibili, copertina dei reel, bozze, modelli, etichette, note, gruppi di account | RF-34–38, RF-44 |
| 7. Pubblicazione | Coda, macchina a stati, IG, FB, errori, esito incerto, riconciliatore, verifica | RF-50–52 |
| 8. Notifiche | Centro notifiche, Telegram, email, riepilogo, sorveglianza esterna | RF-60–62 |
| 9. Pianificazione | Calendario completo (mese predefinito, settimana dettagliata, libreria a richiesta), **piano editoriale** (§11.12), griglia IG, fasce orarie, programmazione in blocco | RF-40–43, RF-46 |
| 10. Condivisione e brand | Link cliente con mesi completi e "Stampa o salva PDF", contenuti in preparazione, stampa del Piano editoriale, logo e colori, PWA, sito pubblico con "Accedi" e pagine legali | RF-46 (parte cliente), RF-63, RF-71–73 |
| 11. Operazioni | Pulizia, backup, runbook, dashboard, prova di carico (§6.4), revisione sicurezza e accessibilità | RNF-01–13 |
| 12. Messa in produzione | Test reale insieme, poi uso quotidiano | Tutti i criteri §2.3 |

Il dettaglio di ogni tappa va nel piano di sviluppo.

### 18.2 Versioni successive

| Versione | Contenuto | Note |
|---|---|---|
| 1.1 | Post ricorrenti, webhook in uscita, pagina link in bio, "Accedi con Google" (un'impostazione di Better Auth, con procedura guidata), commenti del team sui post, editor immagini di base, preset di pubblicazione (§18.5) | Nessun permesso Meta in più |
| 1.2 | Primo commento automatico, importazione da Google Drive e Canva (§18.5) | Permessi Meta per i commenti; Canva richiede l'approvazione della nostra integrazione |
| 1.3 | Statistiche e report per cliente con modelli personalizzabili, orario migliore per pubblicare, analisi dei concorrenti (§18.5) | Permessi Meta per gli insight |
| 1.4 | Assistente AI per caption e hashtag, server MCP | §18.3 |
| 1.5 | Strumenti di agenzia: attività e to-do, note e schede cliente | §18.4; nessun permesso Meta in più |
| Dopo la 1.5 | Altri social come moduli: LinkedIn, TikTok, YouTube, Pinterest, X e altri, uno alla volta | §18.6; ordine da decidere, ogni piattaforma ha la sua revisione dell'app |
| 2.0 | Piattaforma aperta ad altre agenzie: pannello della piattaforma, prezzi, registrazione e termini di servizio sul sito, registrazione libera con verifica dell'email, abbonamenti e pagamenti, collegamento di tutti i clienti con i login (richiede la revisione dell'app), dominio per agenzia, esportazione e cancellazione di un'organizzazione, accesso di supporto | Richiede revisione dell'app Meta e verifica della tua azienda (§20); l'app Meta comune vuole sul sito gli indirizzi di informativa e di cancellazione dei dati (da verificare) |

### 18.3 Predisposizione per MCP

Obiettivo: usare la piattaforma da Claude o altre chat ("programma questo reel giovedì alle 18 sui due account di X", "cosa esce questa settimana?").

Già nella 1.0: casi d'uso con permessi, API `/api/v1` con OpenAPI, tabella `api_tokens` con ambiti (`lettura`, `bozze`, `pubblicazione`) legati all'utente e a una organizzazione, origine delle azioni nel registro.

Nella 1.4: `apps/mcp` con strumenti come `elenca_programmati`, `stato_pubblicazioni`, `crea_bozza`, `programma_post`, `sposta_post`, `annulla_post`, `problemi_aperti`, `calendario_cliente`. Collegamento locale (Claude Desktop o Claude Code via Tailscale) o remoto come connettore Claude.ai (indirizzo pubblico dedicato, separato da `PUBLIC_HOST`, con OAuth via Cloudflare Tunnel). Bozze di default, conferma esplicita per pubblicare o annullare, stessi controlli dei media.

---

### 18.4 Strumenti di agenzia (versione 1.5)

Obiettivo: usare la piattaforma come strumento di lavoro quotidiano dell'agenzia, non solo per pubblicare.

**Attività**
- **To-do personale** (visibile solo a te), **attività dell'agenzia** e **attività di un cliente** (visibili a chi lavora in quello spazio).
- Titolo, descrizione, scadenza, priorità, stato (da fare, in corso, fatta), sotto-attività a spunta, commenti, allegati dalla libreria, collegamento facoltativo a un post o a un account.
- **Assegnazione** a una o più persone. Chi può assegnare è un'impostazione dell'agenzia: tutti, a chi lavora negli stessi spazi (predefinito), oppure solo da Manager in su. Owner e Admin assegnano sempre a chiunque.
- Viste: **Le mie attività** (oggi, in scadenza, in ritardo), per cliente, per persona, a lista e a colonne; scadenze visibili anche nel calendario.
- **Notifiche** con i canali esistenti (pannello, email, Telegram): attività assegnata, commento, scadenza domani, in ritardo, completata (a chi l'ha creata). Riepilogo delle attività nel riepilogo delle 8:00.
- Attività ricorrenti (es. "report mensile al cliente") e attività create da eventi (es. "post con problema" → attività per chi l'ha programmato), attivabili per agenzia.
- Strumenti MCP: "cosa devo fare oggi?", "assegna a Luca la revisione delle caption di X entro venerdì".

**Note e schede cliente**
- **Note** personali (solo tue) o condivise con l'agenzia o con chi lavora su un cliente, con la stessa scelta di visibilità delle attività; utili anche al Member senza spazi (§10.1).
- Per ogni cliente una scheda con brief, contatti, tono di voce, linee guida del brand, hashtag e orari preferiti; note interne con cronologia.
- Nessuna password dei clienti salvata in chiaro: se servirà, sarà un modulo a parte con cifratura dedicata.

**Dati** (modulo `tasks`, tabelle con `organization_id` e RLS): `tasks` (organization_id, workspace_id facoltativo, visibility personal|workspace|organization, title, description, status, priority, due_at, completed_at, created_by, post_id facoltativo, recurrence jsonb), `task_assignees`, `task_checklist_items`, `task_comments`, `client_profiles`, `notes` (visibility personal|workspace|organization, workspace_id facoltativo). Permessi nuovi: `task.create`, `task.assign`, `task.manage_others`, `client_profile.edit`.

Nulla di questo richiede cambiamenti alla 1.0: si aggiunge come modulo (§7.3), che registra da sé permessi, notifiche, voci di menu e del calendario e strumenti MCP.

### 18.5 Funzioni dal confronto con la concorrenza (versioni 1.1–1.3)

Aggiunte il 2026-10-23 dopo il confronto con le funzioni di Postiz e Metricool, AI esclusa. Nessuna richiede cambiamenti alla 1.0: si aggiungono ai moduli esistenti (§7.3). Commenti del team, editor immagini e preset sono nella 1.1; Drive e Canva nella 1.2; analisi dei concorrenti e modelli di report nella 1.3. Drive, Canva e analisi dei concorrenti si fanno solo se la prova sulle API reali va a buon fine.

**Commenti del team sui post**
- Una discussione dentro ogni post, per chi lavora nell'agenzia: scrivere, rispondere, **@menzionare** una persona. Chi è menzionato riceve una notifica con i canali esistenti (pannello, Telegram, email); chi ha scritto il post riceve le risposte.
- Commenta chi può vedere il post nello spazio. Ognuno modifica ed elimina i propri commenti; il Manager può eliminare quelli degli altri. Una discussione si può segnare come **risolta**.
- I commenti **non compaiono mai** nel link cliente (§11.10) e non sono i commenti di Instagram o Facebook. Le note interne (§11.7) restano: la nota è un testo fisso sul post, il commento è una conversazione.
- Dati: `post_comments` (organization_id, post_id, author_id, parent_id facoltativo, body, mentions, resolved_at, edited_at, deleted_at), con RLS. Permessi nuovi: `post.comment`, `post.comment.moderate`. Eventi nuovi in §12.2: "Sei stato menzionato", "Risposta a un tuo commento".

**Editor immagini di base**
- Dall'editor del post e dalla libreria (§11.8): **ritaglio** con i formati delle piattaforme (1:1, 4:5, 1,91:1, 9:16) o libero, con la guida del ritaglio della griglia del profilo (§11.5); **rotazione** di 90°, **raddrizzamento** e **capovolgimento**.
- Nei caroselli, "Applica a tutte" porta tutte le foto allo stesso formato.
- Non distruttivo: l'originale resta e "Ripristina originale" lo riporta. La versione modificata la crea il worker con sharp (già nello stack) e passa dai controlli di §9.2 come ogni altro file.
- Fuori di proposito: testi, filtri, adesivi, ritocchi e modifica dei video.

**Preset di pubblicazione**
- Allargano i gruppi di account salvati (§11.7): oltre agli account, un preset può contenere un modello di caption o una firma, delle etichette e un orario predefinito o una fascia oraria (§11.6). Un gruppo di oggi diventa un preset con i soli account.
- In Nuovo post (§11.2) scegliere un preset compila questi campi; si possono poi cambiare liberamente. Gli account non più pubblicabili (§8.4) si saltano con un avviso.
- Per spazio, gestiti da chi gestisce i modelli. Dati: la tabella `account_groups` diventa `post_presets` (organization_id, workspace_id, name, account_ids, template_id, label_ids, default_time, time_slot_id), con migrazione dei gruppi esistenti.

**Importazione da Google Drive e Canva**
- Ovunque si aggiungono file (§11.1) compaiono anche "Da Google Drive" e "Da Canva". Si sceglie il file nella finestra del servizio e il worker lo scarica nello spazio, come un upload normale, con gli stessi controlli (§9.2).
- Il collegamento è personale: ogni persona collega il proprio Google o Canva dal suo account (§10.5), con un token cifrato come gli altri segreti (ADR 007). Si legge solo il file scelto, mai la cartella intera.
- Da Canva si importa il design esportato come immagine o video; se il design ha più pagine, diventa un carosello.
- **Da verificare**: Canva chiede di approvare l'integrazione prima di aprirla ad altri utenti; Google chiede la verifica dell'app per alcuni ambiti di Drive. Finché non è provato, resta "non verificato".

**Analisi dei concorrenti**
- Per ogni cliente, un elenco di profili Instagram di concorrenti (account business o creator pubblici). Per ognuno: follower, numero di post, frequenza di pubblicazione, like e commenti medi e i post migliori del periodo, a confronto con il cliente.
- I dati si leggono dall'API Instagram (Business Discovery) e si salvano una volta al giorno, così lo storico cresce anche dove Meta mostra solo gli ultimi dati.
- **Da verificare**: Business Discovery funziona con i collegamenti Facebook (login o utente di sistema), forse non con il solo login Instagram (ADR 015); i profili personali non si possono analizzare. Limite di concorrenti per cliente configurabile, per stare dentro i limiti d'uso di Meta (§8.7).

**Modelli di report**
- I report per cliente della 1.3 si costruiscono da un **modello**: blocchi da scegliere e ordinare (numeri principali, andamento dei follower, post migliori, confronto con i concorrenti, prossimi post, testo libero), con logo e colori dell'agenzia e del cliente (§14.3).
- Modelli per agenzia, riusabili su tutti i clienti. Report in **PDF** e come pagina condivisibile con lo stesso link di sola visione (§11.10).
- Invio automatico facoltativo per email al cliente, ogni mese o settimana.

### 18.6 Altri social come moduli

Obiettivo: aggiungere in futuro LinkedIn, TikTok, YouTube, Pinterest, X e altri social, uno alla volta, senza riscrivere il resto. Nella 1.0 si costruisce solo Meta, ma il codice si prepara così:
- **Una piattaforma è un modulo** (§7.3) con quattro parti: il **collegamento** (login, rinnovo del token, salute dell'account, già così in ADR 015), i **tipi di contenuto e le regole** (formati, durate, lunghezze della caption, i controlli di §9.2), la **pubblicazione** (creazione, attesa dell'elaborazione, verifica, classificazione degli errori, §9.3–9.6) e l'**anteprima** (§11.3).
- Il resto non sa quale piattaforma c'è dietro: spazi, profili, post, destinazioni, calendario, coda, notifiche, link cliente e permessi lavorano solo con un account e la sua piattaforma.
- Nel database `social_accounts.platform` e i tipi di destinazione si allargano con una migrazione per ogni nuova piattaforma.
- Con piattaforme così diverse servirà poter **adattare la caption per piattaforma** (oggi esclusa, §2.4): la 1.0 tiene il contenuto identico, ma la destinazione può già avere un testo proprio, vuoto di default.
- Prima di costruire ogni piattaforma serve una ADR con API, permessi, revisione dell'app richiesta e limiti. Prima della tappa 3 una ADR fissa i confini del modulo piattaforma e i piani delle tappe 3–5 si adeguano.

## 19. Decisioni prese

| Tema | Decisione | Da chi |
|---|---|---|
| Linguaggio e stack | TypeScript, Nuxt + worker Node | Matteo |
| Database | PostgreSQL da subito | Matteo |
| Utenti | Multi-utente con ruoli e permessi per spazio da subito | Matteo |
| Pubblicazione dei collaboratori | Diretta, senza approvazione (ruolo Publisher) | Matteo |
| Contenuto | Identico su tutte le destinazioni, con controlli e avvisi | Matteo |
| Storie | Nella 1.0 | Matteo |
| Reel nel feed | Attivo di default, disattivabile | Matteo |
| Notifiche | Pannello, Telegram (solo team), email; verifica dopo la pubblicazione | Matteo |
| Link cliente | Solo visione | Matteo |
| Telefono | Responsive e installabile | Matteo |
| Esposizione | Tailscale all'inizio, Cloudflare Tunnel con dominio | Matteo |
| Backup | pg_dump nella cartella inclusa nel rclone su Google Drive | Matteo |
| Configurazione | Solo dal pannello, con procedure guidate | Matteo |
| Funzioni dalla concorrenza | Tutte le proposte; quelle che richiedono permessi Meta in più nelle versioni 1.1–1.4 | Matteo + Claude |
| Tema scuro, logo, programmazione in blocco | Nella 1.0 | Matteo |
| MCP | Predisposto ora, sviluppato in 1.4 | Matteo |
| Più agenzie | Struttura multi-organizzazione con isolamento da subito; piattaforma aperta nella 2.0 | Matteo |
| Nome dell'organizzazione nel pannello | "Agenzia" | Claude, modificabile |
| Attività, to-do e schede cliente | Versione 1.5, come modulo; ordine delle versioni modificabile | Matteo + Claude |
| Commenti del team, editor immagini di base, preset di pubblicazione | Versione 1.1 (§18.5); esclusi RSS, ritardi tra post e azioni automatiche su like e commenti | Matteo + Claude |
| Google Drive e Canva, analisi dei concorrenti, modelli di report | Versioni 1.2–1.3 (§18.5), se la prova sulle API reali va bene; esclusi dashboard delle campagne a pagamento e connettore per Data Studio | Matteo + Claude |
| Altri social | Nella 1.0 solo Meta, ma il codice è diviso per piattaforma; le altre si aggiungono come moduli dopo la 1.5 (§18.6) | Matteo |
| Struttura del codice | Moduli con confini verificati e attivabili per agenzia (§7.3) | Claude |
| Caption nel link cliente | Visibile di default | Claude, modificabile |
| Riepilogo giornaliero | 8:00 tutti i giorni | Claude, modificabile |
| Ore di silenzio | Disattivate di default | Claude, modificabile |
| Email | Pronta, attiva quando configuri un SMTP | Claude |
| Modifica caption dopo la pubblicazione | Esclusa (Instagram via API non lo consente) | Claude |
| Programmazione FB | Gestita da Feedway, non nativa (ADR 003) | Claude |
| Nome | **Feedway** (scelto il 2026-10-15; repository `grecomatteo/Feedway`). Il nome visibile sta in una sola costante e nessun identificativo tecnico lo contiene (database `app`, pacchetti `@app/*`) | Matteo |
| Versioni | Nuxt 4, Node 24 LTS (poi 26), TypeScript 6.0, PostgreSQL 18; alternative valutate in `docs/stack.md` | Claude, approvata da Matteo |
| Accesso e account | Better Auth, con organizzazioni e ruoli nostri (ADR 012) | Matteo |
| Registrazione | Solo da invito nella 1.0; libera nella 2.0 | Claude, modificabile |
| Account personale | Soprannome, foto profilo, passkey, email di sicurezza, esportazione e cancellazione self-service | Matteo + Claude |
| Cifratura dei backup | Sempre, con `age` | Claude |
| Flusso Git | PR piccole per task, squash merge, una versione per tappa (`docs/flusso-git.md`) | Matteo |
| Licenza | Proprietaria, tutti i diritti riservati | Claude, modificabile |
| Sito pubblico | Sito statico separato dal pannello, su Cloudflare Pages, nella tappa 10; contatti via email senza modulo; nessun cookie (ADR 013) | Matteo (idea), Claude (forma) |
| Navigazione | Contesto attivo come su Meta ("Tutti i clienti", un cliente, un profilo); si pubblica solo dentro un cliente | Matteo |
| Scelta degli account | Elenco di profili (IG + Pagina FB collegata da Meta) con caselle, ogni account deselezionabile; solo interfaccia, il dominio non cambia | Matteo (idea), Claude (forma) |
| Calendario e telefono | Mese come vista predefinita, settimana come vista dettagliata, libreria a richiesta; sul telefono barra in basso a cinque voci con il + al centro | Matteo |
| Copertina dei reel e anteprima video | Fotogramma o immagine propria, anche trascinata; ogni video riproducibile nell'editor grazie a una copia MP4 di anteprima | Matteo (idea), Claude (forma) |
| Calendario cliente | Mesi completi in scorrimento, loghi di Feedway, cliente e agenzia, "Stampa o salva PDF" con le sole pubblicazioni future | Matteo |
| Member senza spazi | Ruolo valido nell'agenzia; dalla 1.5 attività, to-do e note | Matteo |
| Piano editoriale | Nella 1.0, tappa 9 con la parte cliente nella tappa 10 (§11.12) | Matteo (confermato il 2026-10-15, su raccomandazione di Claude) |

---

## 20. Rischi e punti da verificare

| Rischio / incognita | Impatto | Mitigazione |
|---|---|---|
| Permessi esatti del token (`ads_management` sì o no) | Medio | Controllo automatico nel passo 4; guida aggiornabile |
| Limite giornaliero IG (50 o 100) | Basso | Quota letta dall'API |
| Numero massimo di foto in un post multi-foto FB | Basso | Avviso; verifica nei test reali |
| Durata massima reel FB via API | Basso | 90 s finché non verificato |
| Verifica del Business richiesta da Meta | Medio | Guida nel passo 1 se necessaria |
| Banda di Tailscale Funnel con file grandi | Medio | Test con reel da 300 MB; passaggio a Cloudflare Tunnel |
| Cambi delle API Meta | Medio | Versione fissata, promemoria di ritiro, test con finto Graph API |
| Limitazioni degli account per l'uso delle API | Basso | Le API ufficiali sono il canale previsto da Meta e non penalizzano gli account; i rischi vengono da comportamenti da spam (stesso contenuto ripetuto, troppi post ravvicinati). Controlli dedicati: avviso duplicati, quota letta dall'API, rallentamento automatico (§8.6, §9.2) |
| VPS unica (punto singolo di guasto) | Alto se si spegne | Sorveglianza esterna, backup, ripristino provato |
| CPU limitata per video lunghi | Basso | Conversioni subito dopo l'upload, una alla volta; un core in più se serve. La copia di anteprima a 720p si crea per prima, così si vede presto |
| Copertina dei reel Facebook via API | Basso | Da verificare al primo contatto reale; finché non è verificata, avviso nel riepilogo |
| Proporzioni della griglia del profilo IG (3:4 dal 2025) | Basso | Da verificare prima della tappa 6; l'anteprima usa una costante sola |
| Ampiezza della 1.0 | Medio | Sviluppo a tappe installabili; priorità chiara (§18.1) |
| Vulnerabilità in Better Auth (diversi avvisi nel 2026, uno critico ad agosto in plugin che non usiamo) | Medio | Versione fissata, aggiornamenti di sicurezza immediati, solo i plugin necessari, test dei flussi di accesso a ogni aggiornamento; token di sessione nel database da proteggere come le password (database in rete interna, backup cifrati) |
| Token di sessione di Better Auth salvato in chiaro nel database (verificato, ADR 012) | Basso | Rete interna, backup cifrati, tabella `sessions` letta solo dal modulo identity, revoca immediata (`cookieCache` spento) |
| Dati di un'agenzia visibili a un'altra | Alto | Doppia barriera applicazione + RLS, test di isolamento su ogni rotta e lavoro (§6.5) |
| Un'iniezione SQL può impostare da sola `app.scope = 'system'` o un altro `app.organization_id` (il ruolo dell'app può scrivere queste variabili) | Alto | Solo query con parametri (Drizzle, mai SQL composto con testo dell'utente), `runAsSystem` limitato ai moduli ammessi dalla regola ESLint; rischio accettato nella tappa 2 |
| Piattaforma aperta (2.0): revisione dell'app Meta e verifica dell'azienda | Alto per la 2.0 | Nella 1.x ogni agenzia usa la propria app e il proprio utente di sistema, che non richiedono revisione |
| Limiti Meta condivisi da un'unica app (2.0) | Medio | Rallentamento per account e per organizzazione già nel client Meta (§8.6) |

---

## 21. Cosa servirà da te

| Cosa | Quando |
|---|---|
| Link del repository GitHub | Ora |
| Ispirazioni grafiche e funzionalità desiderate | Prima del prototipo (tappa 1) |
| Branding (logo, colori, caratteri) e progetti in Pencil del pannello e del sito | Pannello prima della tappa 6, sito prima della tappa 10 |
| Approvazione del prototipo | Fine tappa 1 |
| Chiave di autenticazione Tailscale | Tappa 1 |
| Tailscale con Funnel sulla VPS; più avanti eventuale dominio su Cloudflare | Tappa 4 |
| App Meta e login Facebook/Instagram dal pannello; utente di sistema e token solo se scegli quel collegamento (il token lo incolli tu nel pannello, mai in chat) | Tappa 3 |
| Un account IG professionale con Pagina FB e uno solo IG, di prova | Tappa 3 e test reale |
| Dominio (consigliato su Cloudflare, ~10–15 €/anno), quando scegli il nome | Prima di invitare il team: sito, pannello, host pubblico, mittente email e passkey usano lo stesso nome |
| Token API di Cloudflare per pubblicare il sito, inserito da te nei segreti del repository GitHub (mai in chat) | Tappa 10 |
| Dati per le pagine legali (titolare, email di contatto, eventuale partita IVA) e approvazione di testi e immagini del sito | Tappa 10 |
| Servizio email: Brevo (gratuito fino a 300 email al giorno, dati in Europa) o Scaleway TEM | Tappa 3 |
| Chiave privata dei backup, da conservare nel tuo gestore di password | Tappa 1 |
| Bot Telegram (@BotFather) | Tappa 8 |
| Account di sorveglianza esterna (es. healthchecks.io) | Tappa 8 |
| Cartella di backup inclusa nel tuo rclone | Tappa 11 |

---

## 22. Fonti

- [Instagram – Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Instagram – IG User Media (specifiche)](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)
- [Facebook – Reels Publishing](https://developers.facebook.com/documentation/video-api/guides/reels-publishing.md)
- [Facebook – Page Stories API](https://developers.facebook.com/docs/page-stories-api)
- [Facebook – Page Photos](https://developers.facebook.com/docs/graph-api/reference/page/photos)
- [Meta – Token utente di sistema](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authentication)
- [Guida pubblicazione su Pagine FB (bundle.social)](https://bundle.social/blog/facebook-posting-api)
- [Confronto Later / Metricool / Buffer](https://resources.rework.com/tools/social-media/later-vs-metricool-vs-buffer)
- [Alternative a Planoly](https://socialbu.com/blog/planoly-alternatives)
- [Novità Postiz](https://scribe.disroot.org/post/1945251)
- [Rischi delle API non ufficiali (instagrapi)](https://www.postzen.dev/blog/instagrapi-vs-instagram-graph-api)
- [Pubblicazione via scheduler e copertura dei post](https://www.poster.ly/blog/does-scheduling-hurt-reach-research)
