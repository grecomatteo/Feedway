# Feedway — contesto di prodotto

Fonte: `design/brief-feedway/` (brief app 03, landing 04, decisioni 08) e il documento funzionale originale `design/brief-feedway/progetto/PROGETTO-OPENMETA-v9-ORIGINALE.md`. L'intervista con Matteo è già stata svolta per il brief: qui sono raccolti i fatti confermati; le voci marcate *aperta* non sono decise.

## Utenti e lavoro

- Professionisti e piccoli team di agenzia che preparano, programmano e controllano contenuti Instagram e Facebook per più clienti.
- Lavoro soprattutto da computer; il telefono è occasionale ma i compiti essenziali devono funzionare (confermato da Matteo, 15 ottobre 2026).
- Il cliente finale vede solo un calendario condiviso in sola lettura.

## Cosa rende possibile

- Calendario visuale dei post di più clienti, editor con anteprima e controlli, programmazione con fuso esplicito.
- Esito leggibile per ogni destinazione (account IG o Pagina FB): confermato, in verifica, da accertare, con problema; recupero mirato senza ripubblicare ciò che è già uscito.

## Vincoli durevoli

- Tre livelli distinti: agenzia → cliente/spazio di lavoro → account social. Un post appartiene a un solo spazio e usa solo i suoi account.
- Stessa caption e stesso contenuto su IG e FB; ruoli e permessi del v9 (Editor salva bozze, Viewer consulta).
- Fuori dalla v1: analytics, inbox, approvazioni cliente, AI copy.
- Stack: Nuxt/Vue/TypeScript (vedi `docs/stack.md`).
- Nome pubblico Feedway; OpenMeta resta il nome storico del documento originale. Nessuna rinomina tecnica di massa.

## Marchio (vincolante)

Brand kit approvato in `design/brief-feedway/brand/Feedway-Brand-Kit-v1.0/`: arancio `#FF762E`, carbone `#242321`, bianco e carta come fondi di servizio; titoli Sora 650, corpo `system-ui`; logo solo dai file originali.

## Piattaforma

`web` (desktop prima, responsive e PWA come da v9). Accessibilità: WCAG 2.2 AA; aree di tocco 44 px come scelta del brief.

## Decisioni aperte

- *Aperta*: finalità commerciale della landing. Assunzione di lavoro: presentazione + demo interattiva + accesso; niente prezzi, trial, testimonianze o raccolta contatti.
- *Aperta*: documenti legali del sito, da redigere prima del lancio.
- *Aperta*: attività assegnabili, to-do e note personali nella 1.5 (come da specifica, consigliato) o anticipate nella 1.0. Dettagli in .
