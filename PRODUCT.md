# Feedway — contesto di prodotto

Fonte: `design/brief-feedway/` (brief app 03, landing 04, decisioni 08) e il documento funzionale originale `design/brief-feedway/progetto/PROGETTO-OPENMETA-v9-ORIGINALE.md`. L'intervista con Matteo è già stata svolta per il brief: qui sono raccolti i fatti confermati; le voci marcate *aperta* non sono decise.

## Direzione

- Motto: **"Tutta la tua agenzia, in un solo posto."** (Matteo, 26 ottobre 2026).
- Feedway diventa l'hub dell'agenzia: clienti e CRM, portale del cliente, shooting, team, cruscotti, pubblicazione verificata. La 1.0 resta la base. Decisioni in `docs/superpowers/specs/2026-10-29-feedway-hub-agenzia.md`.

## Utenti e lavoro

- Professionisti e piccoli team di agenzia che preparano, programmano e controllano contenuti Instagram e Facebook per più clienti.
- Lavoro soprattutto da computer; il telefono è occasionale ma i compiti essenziali devono funzionare (confermato da Matteo, 15 ottobre 2026).
- Nella 1.0 il cliente finale vede solo un calendario condiviso in sola lettura. Dopo: portale con accesso via email, di default solo il calendario editoriale, altre sezioni accese dall'agenzia per cliente.

## Cosa rende possibile

- Calendario visuale dei post di più clienti, editor con anteprima e controlli, programmazione con fuso esplicito.
- Esito leggibile per ogni destinazione (account IG o Pagina FB): confermato, in verifica, da accertare, con problema; recupero mirato senza ripubblicare ciò che è già uscito.

## Vincoli durevoli

- Tre livelli distinti: agenzia → cliente/spazio di lavoro → account social. Un post appartiene a un solo spazio e usa solo i suoi account.
- Stessi media su IG e FB, con caption comune e testo diverso facoltativo per piattaforma (deciso il 26 ottobre 2026); ruoli e permessi del v9 (Editor salva bozze, Viewer consulta).
- Fuori dalla v1: analytics, inbox, AI copy. Approvazione dei post da parte del cliente nella 1.1, attivabile per cliente (deciso il 26 ottobre 2026).
- Stack: Nuxt/Vue/TypeScript (vedi `docs/stack.md`).
- Nome pubblico Feedway; OpenMeta resta il nome storico del documento originale. Nessuna rinomina tecnica di massa.

## Marchio (vincolante)

Brand kit approvato in `design/brief-feedway/brand/Feedway-Brand-Kit-v1.0/`: arancio `#FF762E`, carbone `#242321`, bianco e carta come fondi di servizio; titoli Sora 650, corpo `system-ui`; logo solo dai file originali.

## Piattaforma

`web` (desktop prima, responsive e PWA come da v9). Accessibilità: WCAG 2.2 AA; aree di tocco 44 px come scelta del brief.

## Decisioni aperte

- Landing decisa (29 ottobre 2026): titolo con il motto, CTA "Richiedi una demo", struttura in 11 sezioni (brief 04). *Aperta*: a chi arriva la richiesta di demo e cosa succede dopo; prezzi e prova gratuita.
- *Aperta*: documenti legali del sito, da redigere prima del lancio.
- *Aperta*: attività assegnabili, to-do e note personali nella 1.5 (come da specifica, consigliato) o anticipate nella 1.0. Dettagli in .
- *Aperta*: Piano editoriale nella 1.0 (consigliato) o nella 1.1. Proposta in `design/proposta-piano-editoriale.md`.
