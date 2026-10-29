# Decisioni, fonti e limiti

## Ordine di lettura e autorità

Le istruzioni dirette di Matteo prevalgono sulle proposte del pacchetto. Il brand kit fornito stabilisce identità e uso degli asset; il v9 originale stabilisce i vincoli funzionali, con il proprio stato ancora da approvare. Questo pacchetto propone applicazione UI e landing. In caso di conflitto reale, Claude lo espone con il punto preciso; non inventa una decisione implicita.

## Confermato

- Nome pubblico Feedway; logo e palette arancio/carbone dal kit fornito.
- Titoli Sora 650, corpo system-ui come base del kit; logo in tracciati.
- Esperienza visiva con miniature grandi, prevalenza d'uso da computer, mobile occasionale.
- App operativa e landing incluse; sviluppo con Claude Code, Pen già collegato secondo Matteo, interesse per Impeccable.
- Preservare v9, ruoli, caption comune con testo per piattaforma facoltativo (deciso il 26 ottobre 2026), destinazioni del cliente e calendario condiviso in sola lettura nella 1.0 (approvazione del cliente dalla 1.1).

## Deciso il 26–29 ottobre 2026

- Feedway come hub dell'agenzia, motto "Tutta la tua agenzia, in un solo posto." (`docs/superpowers/specs/2026-10-29-feedway-hub-agenzia.md`).
- Landing: titolo con il motto, CTA **Richiedi una demo**, Accedi separato, struttura in 11 sezioni del documento 04, funzioni non pronte marcate "In arrivo". La CTA apre un modulo e la richiesta arriva via email a Matteo (29 ottobre, ADR 016); modello commerciale non definito.

## Proposto, ancora modificabile

- Calendario settimana a colonne come ingresso, mese/elenco disponibili; confronto solo se non già scelto.
- Hero affiancato e sequenza sezioni del documento 04; copy originale proposto.
- Route `/`, `/accedi` da adattare al repository; una demo interattiva con dati fittizi resta facoltativa.
- Misure UI e componenti proposti nel brief, mantenendo il brand.

## Compatibilità e fonti ufficiali delle skill

Verifica del 15 ottobre 2026. La versione installata nel repository futuro può essere diversa; usare gli strumenti e i comandi realmente disponibili.

| Fonte | Uso |
|---|---|
| [Impeccable — installazione](https://impeccable.style/tutorials/getting-started/) e [repository](https://github.com/pbakaus/impeccable) | Metodo di installazione e struttura dei comandi |
| [Impeccable — critique](https://impeccable.style/docs/critique/) | Revisione del design e priorità |
| [Impeccable — audit](https://impeccable.style/docs/audit/) | Verifiche di implementazione |
| [Impeccable — sistema di design](https://impeccable.style/docs/design-system/) | Decisioni condivise e coerenza fra superfici |
| [Pen — agenti e skill](https://docs.pen.dev/core-concepts/ai-agents) | Distinzione fra skill interne e istruzioni MCP `read_skill()` |
| [Pen — installazione](https://docs.pen.dev/getting-started/installation) | Collegamento al desktop/IDE e Claude Code |
| [Pen — design e codice](https://docs.pen.dev/design-and-code/design-to-code) | Passaggi espliciti fra tela e implementazione |
| [Claude Code — skill](https://code.claude.com/docs/en/skills) | Scope del repository e comandi delle skill |
| [Claude Code — MCP](https://code.claude.com/docs/en/mcp) | Configurazione e verifica dei collegamenti |
| [Vercel — Web Design Guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | Revisione mirata del codice UI |
| [Vercel — installatore skills](https://github.com/vercel-labs/skills) | Selezione skill e agente destinatario |
| [Nuxt UI — skill ufficiale](https://github.com/nuxt/ui/tree/v4/skills/nuxt-ui) | Componenti e temi per v4, se pertinente |
| [Playwright MCP — Microsoft](https://github.com/microsoft/playwright-mcp) | Browser per verifiche del prototipo |
| [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Alternativa più essenziale a Impeccable |

## Fonti dei riferimenti app

Le 60 immagini/GIF, le guide ufficiali di origine e le valutazioni sono conservate in `riferimenti/app/riferimenti.json`, `fonti.csv` e `ricerca/VALUTAZIONE-60-RIFERIMENTI.md`. La selezione primaria resta di 12 file. Le 8 Metricool (#07–#14) sono supporti per calendario, filtri, densità, programmazione e anteprima.

Sono fonti visuali e flussi documentati, non un test completo delle app autenticate. Le recensioni Reddit sono raccolte separatamente, con limiti e autopromozione indicati. Su X non sono emersi risultati accessibili abbastanza solidi da citare come consenso.

## Fonti landing

[Planable](https://planable.io/), [Later scheduler](https://later.com/social-media-scheduler/), [Pallyy](https://pallyy.com/), [Metricool](https://metricool.com/), [Buffer](https://buffer.com/), [Saaspo Buffer](https://saaspo.com/pages/buffer-landing-page). Saaspo, Nicelydone e altri cataloghi figuravano nel materiale Designeer allegato. Il confronto motivato è nel brief 04.

I quattro nuovi file locali sono asset promozionali ufficiali della pagina Later; la provenienza è nel CSV e nel JSON della raccolta landing. Non sono immagini originali Feedway o screenshot completi dei siti. Il browser ha negato nuovi salvataggi Buffer e Metricool: i limiti non sono stati aggirati; i loro materiali app già acquisiti restano nella ricerca.

## Verifiche e limiti della consegna

Il brand kit è copiato integralmente e confrontato per hash con gli 86 file forniti. Il documento v9 è conservato byte per byte. La palette è stata ricalcolata: carbone/arancio circa 5,894:1, bianco/arancio circa 2,664:1; i valori esatti sono in `dati/contrasti-brand.json`. Questo non prova la conformità della futura UI.

Il pacchetto è stato revisionato per nomi, percorsi, riferimenti, coerenza del brand e confini funzionali. Non sono state installate skill nel repository di sviluppo né create le tavole Pen o l'app finale. Non si dichiarano test utente, conversioni, performance o garanzie backend che non sono stati eseguiti.

Le note di verifica del marchio e del nome presenti nel kit originale sono conservate come limiti dichiarati dall'autore del kit; questo lavoro non esegue una nuova verifica legale o di disponibilità del nome.
