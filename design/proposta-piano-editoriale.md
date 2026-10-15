# Proposta: Piano editoriale

Richiesta di Matteo del 16 ottobre 2026 («Programmare il calendario»). Non è ancora nella specifica approvata: questo documento descrive la proposta e come è stata provata nel prototipo.

## Il problema

Oggi il calendario mostra solo i post che esistono già. Chi decide il piano del mese («il 20 esce VIDEO 1, il 21 il carosello del menu») lo scrive altrove e lo gira a chi carica. Le informazioni si perdono e nessuno vede in Feedway cosa manca.

## La proposta

Un **contenuto pianificato** è un segnaposto sul calendario, creato prima che il contenuto esista.

- **Tre campi obbligatori**: giorno, tipo (reel, carosello, foto), titolo (per esempio «VIDEO 1 · porte aperte»). Facoltativi: ora e nota per chi prepara.
- **Dove si crea**: pulsante «Pianifica» nel calendario, oppure «Piano» sotto un giorno nella vista Settimana.
- **Come si vede**: scheda tratteggiata e trasparente, «Da preparare», mai confondibile con un post vero. In giallo quando mancano meno di 36 ore.
- **Interruttore** «Mostra i contenuti da preparare» nel calendario.
- **Da segnaposto a post**: «Prepara questo contenuto» apre l'editor con cliente, giorno, ora e tipo già compilati e la nota visibile. Quando il post esiste (bozza o programmato), la scheda tratteggiata sparisce e resta il post. Se il file scelto non corrisponde al tipo pianificato, l'editor lo segnala.
- **Calendario cliente e stampa**: i contenuti pianificati compaiono come «In preparazione» con tipo, titolo e ora, senza note interne. Il PDF li include.

## Permessi proposti

| Azione | Owner | Admin | Manager | Publisher | Editor | Viewer | Member |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Vedere il piano del cliente | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Pianificare, modificare, togliere | ✓ | ✓ | ✓ | ✓ | | | |
| Preparare un contenuto dal piano | ✓ | ✓ | ✓ | ✓ | ✓ | | |

Permesso nuovo proposto: `plan.edit`.

## Impatto tecnico (stima)

- Una tabella `plan_items` (`organization_id`, `workspace_id`, `date`, `time` facoltativa, `type`, `title`, `note`, `post_id` facoltativo, `created_by`) con RLS come le altre.
- Nessun contatto con Meta e nessun lavoro in coda: è un modulo leggero accanto a `posts`.
- Un evento facoltativo «contenuto pianificato non preparato» può alimentare notifiche e, nella 1.5, le attività.

## Decisione aperta

Inserirlo nella **1.0** (consigliato: piccolo, dà valore subito e distingue il prodotto) oppure nella **1.1**.
