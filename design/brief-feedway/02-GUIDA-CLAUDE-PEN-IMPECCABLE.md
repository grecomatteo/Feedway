# Guida: Claude Code + Pen.dev + Impeccable

## La scelta per Feedway

La combinazione è adatta: Claude legge il progetto e implementa, Pen rende il design modificabile, Impeccable guida decisioni e revisioni. Il controllo del prodotto richiede anche un browser. La skill non sostituisce gli strumenti che le permettono di vedere la tela o di eseguire un compito.

| Elemento | Priorità | Compito |
|---|---|---|
| Impeccable | Principale | Metodo di progettazione e revisione del frontend |
| Istruzioni native Pen tramite MCP | Necessarie sulla tela | Lettura, operazioni corrette e verifica visiva del documento |
| Browser già disponibile o Playwright MCP | Necessario per verificare il prototipo | Clic, campi, focus, stati e dimensioni |
| Web Design Guidelines, Vercel Labs | Facoltativo | Controllo mirato dei file UI |
| Skill ufficiale Nuxt UI | Condizionale | Uso dei componenti se il progetto adotta @nuxt/ui v4 |

Impeccable basta come guida principale. `frontend-design` di Anthropic è un'alternativa più essenziale; non serve sovrapporre entrambe come guide estetiche permanenti. Altri pacchetti generali non sono prerequisiti di questo lavoro.

## Installazione nel progetto

Apri il terminale dalla radice del repository. Prima verifica le installazioni già presenti per evitare doppioni.

**Impeccable**, metodo ufficiale scelto per questa guida:

```powershell
npx impeccable install --providers=claude --scope=project
```

Se la versione dell'installer richiede una selezione, scegli Claude Code e il progetto. Ricarica Claude dopo l'installazione. Il metodo alternativo è il marketplace del produttore; una distribuzione plugin può mostrare un comando completo diverso. Usa il nome effettivo nel menu anziché installare una seconda copia. Gli eventuali controlli automatici dell'installer riguardano le modifiche al codice, non le tavole Pen.

**Web Design Guidelines**, soltanto se vuoi il controllo aggiuntivo:

```powershell
npx skills add vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code
```

**Nuxt UI**, dopo aver verificato che la libreria e la versione siano pertinenti:

```powershell
npx skills add nuxt/ui --skill nuxt-ui --agent claude-code
```

La skill attuale riguarda v4. Non migrare la libreria dell'app per coincidere con una skill. Per consultare direttamente l'API dei componenti, il progetto Nuxt UI fornisce anche:

```powershell
claude mcp add --transport http --scope project nuxt-ui https://ui.nuxt.com/mcp
```

**Browser**: riusa un collegamento che già permette di aprire l'app, interagire e controllare il risultato. In alternativa, il server ufficiale Microsoft:

```powershell
claude mcp add --scope project playwright -- npx @playwright/mcp@latest
```

Il comando risolve la versione corrente: registra quella effettivamente usata e segui gli eventuali passaggi browser richiesti. Non sono comandi eseguiti o collaudati nel tuo repository durante la preparazione del pacchetto.

Le fonti di installazione sono nel documento 08. Conserva le impostazioni esistenti; verifica le modifiche dell'installer. Nessun passaggio richiede di disattivare le protezioni di Claude.

## Verifica prima di iniziare

In Claude Code controlla il menu delle skill e `/mcp`; nella versione attuale anche `/skills` mostra le skill disponibili. Per Pen tieni il documento aperto, verifica il collegamento Claude Code in Settings → MCP e chiedi a Claude di leggere le istruzioni native con `read_skill()`. Le skill aggiunte al menu interno di Pen non equivalgono alle skill installate in Claude Code: sono contesti diversi.

Il controllo è riuscito quando Claude legge lo stato del documento, identifica il file corretto e può ispezionarlo. Se il desktop non risponde, correggi quel collegamento; la presenza del server nell'elenco non dimostra che sia connesso.

Per il browser apri una pagina locale del prototipo e prova un'interazione. Non attribuire capacità di browser a una skill di sola analisi testuale.

## Procedura: due superfici, un sistema

### 1. Contesto

Usa il prompt iniziale. Impeccable può acquisire il contesto tramite `/impeccable init`, leggendo i documenti prima di fare domande. Conserva fatti di prodotto in PRODUCT.md, scelte visive in DESIGN.md e brief specifici per app e landing. Se i file esistono, integra le decisioni adottate. Il kit Feedway è la fonte delle regole del marchio.

### 2. Design Pen

La prima consegna comprende il percorso principale dell'app e la landing, con componenti condivisi. L'app serve a completare compiti; la landing a capire il prodotto e scegliere l'azione successiva. Stessa palette e tipografia, diversa densità.

Usa componenti e variabili modificabili. Verifica che Sora e il peso 650 siano realmente disponibili nella tela: il font è incluso nel kit, ma la sua presenza su disco non prova che Pen lo stia usando. Risolvi il caricamento con gli strumenti supportati e dichiara eventuali sostituzioni provvisorie; non dichiarare una corrispondenza tipografica non verificata. Una verifica visiva della tela può individuare gerarchia, ingombri, incoerenze e testo lungo. Non dimostra accessibilità del DOM, tastiera o prestazioni. Gestisci i file Pen con il MCP; non tentare di riscrivere direttamente il formato del file.

### 3. Scelta

Confronta solo le alternative necessarie, usando gli stessi dati. Registra una scelta di struttura e applicazione del brand, senza riproporre colori e logo già approvati. Dopo la scelta Claude completa gli stati e procede sui dettagli ordinari. Il primo risultato deve essere riconoscibile e giudicabile, non un elenco di intenzioni.

### 4. Prototipo

Realizza prima Calendario → Nuovo post → Controlli → Programmazione → Esito, poi la landing collegata a una demo dello stesso prodotto. Mantieni route e dati demo separati dall'area reale. La pagina pubblica deve aprire con una sessione senza autenticazione e non esporre dati privati.

### 5. Revisione

Avvia una revisione sul percorso concretamente implementato. La versione installata di Impeccable definisce strumenti e procedura. `critique` valuta il design; `audit` controlla l'implementazione. Web Design Guidelines è utile sui file modificati: riunisci risultati e falsi positivi in un solo elenco.

| Problema verificato | Intervento Impeccable pertinente |
|---|---|
| Etichette, messaggi o conseguenze poco chiare | `clarify` |
| Errori, stati vuoti, testo lungo e recupero | `harden` |
| Schermate che non reggono alle dimensioni richieste | `adapt` |
| Eccesso di controlli visibili | `distill` |
| Gerarchia, ritmo, spazi e caratteri | `layout` / `typeset` |
| Lentezza osservata | `optimize`, con misure prima e dopo |
| Coerenza finale | `polish` |

Non è una sequenza da eseguire integralmente su ogni pagina. Scegli l'intervento dal problema osservato. Il brand e il dominio prevalgono sui divieti estetici generici della skill: system-ui nel corpo e il logo approvato sono scelte intenzionali.

### 6. Conferma e prova con persone

Ispeziona desktop e telefono nello stesso giro, correggi i difetti in un gruppo di interventi e conferma il risultato. Ulteriori giri richiedono errori ancora aperti, nuove modifiche o feedback concreto. Misurazioni e screenshot vanno raccolti sulle parti interessate: evitare revisioni infinite dell'intero sito.

Usa i compiti del documento 05 con Matteo e una persona rappresentativa del lavoro reale, aumentando il campione se disponibile. Le valutazioni euristiche non sostituiscono una prova d'uso.

## Continuità

Integra il documento 07 nel CLAUDE.md esistente e conserva le prove in `design/reviews/`. Alla prossima sessione Claude legge decisioni e registro, quindi riparte dal problema aperto. Le modifiche di struttura richiedono riallineamento esplicito della tela: nessuna sincronizzazione automatica Pen↔Nuxt viene presunta.

Per altri progetti puoi riusare il metodo e le skill. Brief, brand, contenuti e criteri devono appartenere al progetto specifico; i vincoli social di Feedway non diventano regole generiche per ogni sito.
