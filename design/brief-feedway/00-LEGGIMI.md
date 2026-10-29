# Feedway — pacchetto da passare a Claude Code

15 ottobre 2026 · v1 · app + landing · branding approvato.

## Una sola cartella da usare

Estrai tutto e copia questa cartella nel repository come `design/brief-feedway/`. Mantieni le sottocartelle. Apri Claude Code dalla radice del repository e tieni aperto Pen.dev. Incolla il contenuto di **`01-PROMPT-INIZIA-QUI.md`**: è l'unico messaggio iniziale necessario.

Il pacchetto sostituisce le istruzioni dei precedenti pacchetti OpenMeta per nome, branding e processo di design. Conserva integralmente il documento funzionale originale in `progetto/PROGETTO-OPENMETA-v9-ORIGINALE.md`: Feedway è il nome pubblico adottato, non una riscrittura automatica del backend.

Se hai già usato una versione precedente, integra questa cartella senza sovrascrivere il tuo file Pen o modifiche al codice. Claude deve riconoscere il lavoro esistente e aggiornare la direzione, non ricominciare alla cieca.

## Cosa contiene

| Materiale | Percorso |
|---|---|
| Messaggio iniziale | `01-PROMPT-INIZIA-QUI.md` |
| Installazione e procedura | `02-GUIDA-CLAUDE-PEN-IMPECCABLE.md` |
| Specifica dell'app | `03-BRIEF-APP.md` |
| Landing: struttura, copy proposto e workflow | `04-BRIEF-LANDING.md` |
| Verifiche di app, landing e brand | `05-REVISIONE-E-ACCETTAZIONE.md` |
| Messaggio per revisioni successive | `06-PROMPT-REVISIONE.md` |
| Breve sezione da integrare in CLAUDE.md | `07-CLAUDE-DA-INTEGRARE.md` |
| Decisioni, fonti e limiti | `08-DECISIONI-E-FONTI.md` |
| Copertura dei flussi e ordine di lavoro | `09-MAPPA-FLUSSI.md` |
| Modello per registrare le prove | `10-REGISTRO-REVISIONE.md` |
| Intero brand kit originale, 86 file | `brand/Feedway-Brand-Kit-v1.0/` |
| 60 riferimenti app, inclusi 8 Metricool e 12 primari | `riferimenti/app/index.html` |
| Confronto landing di 5 concorrenti e 4 asset ufficiali Later | `riferimenti/landing/index.html` |
| Valutazioni e recensioni già raccolte | `ricerca/` |
| Dati fittizi e contrasti della palette | `dati/` |
| Specifiche operative richiamate dal messaggio iniziale | `prompts/` |

Non serve allegare una per una le immagini: Claude Code può consultare i file nel repository. Il PDF del brand è incluso come originale; per il lavoro quotidiano sono sufficienti guida Markdown, palette, SVG, font e icone del kit.

## La combinazione consigliata

**Claude Code + Pen.dev + Impeccable è adatta a questo progetto.** Claude coordina e implementa; Pen contiene la tela modificabile; Impeccable fornisce un metodo per progettare e rivedere. Serve anche un browser controllabile per verificare il prototipo. Web Design Guidelines e la skill ufficiale Nuxt UI sono supporti facoltativi, descritti nella guida.

## Preferenze e vincoli già confermati

- Nome pubblico Feedway; logo e firma arancio/carbone approvati nel kit fornito da Matteo.
- Interfaccia creativa e visiva, miniature grandi, priorità al computer; telefono occasionale ma utilizzabile.
- App e landing pubblica entrambe nel lavoro richiesto, con un unico sistema visivo.
- Stack Nuxt/Vue/TypeScript e vincoli funzionali del v9.

La landing è decisa (29 ottobre 2026): Feedway come hub dell'agenzia, titolo "Tutta la tua agenzia, in un solo posto.", CTA **Richiedi una demo** che apre un modulo, più l'accesso all'app (documento 04). Non si inventano abbonamenti, prova gratuita o testimonianze.

## Stato della consegna

Questo è un pacchetto di ricerca, specifiche e istruzioni. Non contiene ancora una nuova app Nuxt o un documento Pen costruito in questa chat. Le pagine concorrenti sono riferimenti, non prove di conversione. Installazione delle skill nel tuo repository, tavole, codice e test d'uso saranno eseguiti da Claude con il percorso qui definito.
