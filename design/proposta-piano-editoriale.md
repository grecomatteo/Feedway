# Proposta: Piano editoriale

Richiesta di Matteo del 16 ottobre 2026 («Programmare il calendario»). Non è ancora nella specifica approvata: questo documento descrive la proposta e come è stata provata nel prototipo.

## Il problema

Oggi il calendario mostra solo i post che esistono già. Chi decide il piano del mese («il 20 esce VIDEO 1, il 21 il carosello del menu») lo scrive altrove e lo gira a chi carica. Le informazioni si perdono e nessuno vede in Feedway cosa manca.

## La proposta

Un **contenuto pianificato** è un segnaposto sul calendario, creato prima che il contenuto esista.

- **Tre campi obbligatori**: giorno, tipo (reel, carosello, foto), titolo (per esempio «VIDEO 1 · porte aperte»). Facoltativi: ora e nota per chi prepara.
- **Dove si crea**: in una sezione separata, **Piano editoriale**, nel menu sotto Calendario (scelta di Matteo, 16 ottobre). Mostra un mese vuoto da riempire: si clicca un giorno futuro e si compilano i campi. Pianificare e programmare restano due lavori distinti in due posti distinti.
- **Cliente**: il piano prende il cliente selezionato in alto; se il contesto è «Tutti i clienti», una finestra chiede per chi è il piano prima di mostrare il calendario. Si cambia con un clic.
- **Nel calendario principale**: le voci del piano sono schede tratteggiate e trasparenti, «Da preparare», mai confondibili con un post. Un selettore **Tutto · Solo post · Solo piano** decide cosa vedere. In giallo quando mancano meno di 36 ore.
- **Da segnaposto a post**: «Prepara questo contenuto» apre l'editor con cliente, giorno, ora e tipo già compilati e la nota visibile. Quando il post esiste (bozza o programmato), la scheda tratteggiata sparisce e resta il post. Se il file scelto non corrisponde al tipo pianificato, l'editor lo segnala.
- **Stampa del piano**: dalla sezione Piano editoriale, «Stampa o salva PDF» produce il mese in A4 orizzontale con schede **piene** (colore del cliente, tipo, titolo, ora) e i loghi di Feedway, cliente e agenzia, da girare al cliente.
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
- Nessun contatto con Meta; un solo lavoro leggero in coda, per la notifica di scadenza. È un modulo accanto a `posts`.
- Un evento facoltativo «contenuto pianificato non preparato» può alimentare notifiche e, nella 1.5, le attività.

## Decisione

Raccomandato nella **1.0**, tappe 9 e 10 (vedi sotto). Da confermare da Matteo e riportare nella specifica e nel piano generale.

## Collocazione nel piano di sviluppo (raccomandazione)

**Nella 1.0, dentro la tappa 9 (Pianificazione), con la parte cliente nella tappa 10.** Prima non si può fare bene: un contenuto pianificato vive nel calendario (tappa 9) e diventa un post (tappa 6). Rimandarlo alla 1.1 non riduce i rischi, perché non tocca Meta né la pubblicazione: rimanda solo il valore.

| Tappa | Cosa si aggiunge | Perché lì |
|---|---|---|
| 2 (già prevista) | Nessun lavoro: i permessi nuovi li registra il modulo stesso (§7.3) | Il meccanismo dei permessi esiste già |
| 6 | Nessun lavoro sul modulo dei post | I post non devono conoscere il piano: è il piano a dipendere dai post, non il contrario |
| 8 | Nessun lavoro: si usa l'infrastruttura delle notifiche | La notifica «in scadenza e non preparato» si registra nella tappa 9 |
| **9** | Modulo `plan` completo, calendario, collegamento all'editor, notifica | Il calendario e i filtri nell'indirizzo nascono qui |
| **10** | Contenuti pianificati nel link cliente, stampa e PDF | Il link cliente nasce qui |

### Task proposti (una PR piccola ciascuno)

Tappa 9:
1. **Dominio** `plan`: entità, regole (titolo 1–80 caratteri, tipo, giorno, ora facoltativa), stato calcolato (da preparare, in scadenza, preparato) con la porta `Clock`; test prima del codice, compreso il 25 ottobre alle 02:30.
2. **Dati**: tabella `plan_items` con `organization_id`, `workspace_id`, RLS, indici `(organization_id, workspace_id, date)`, repository; voce nella batteria di isolamento.
3. **Casi d'uso e API**: crea, modifica, togli, elenca per periodo; permessi `plan.view` e `plan.edit`; rotte `/api/v1/orgs/[org]/plan` con OpenAPI.
4. **Collegamento ai post tramite eventi**: post creato dal piano → collegato; post annullato → il contenuto torna «da preparare». Gestori idempotenti.
5. **Sezione Piano editoriale e calendario**: pagina del piano con mese da riempire e scelta del cliente; nel calendario schede tratteggiate e selettore Tutto/Solo post/Solo piano salvato nei filtri dell'indirizzo; telefono, tastiera, axe.
6. **Editor**: «Prepara questo contenuto» precompila cliente, giorno, ora e tipo; avviso se il file non corrisponde al tipo.
7. **Notifica** «contenuto in scadenza e non ancora preparato» (24 ore prima), lavoro con `organizationId` nei dati.

Tappa 10:
8. **Link cliente**: contenuti pianificati come «In preparazione». L'elenco dei campi esposti è esplicito (tipo, titolo, giorno, ora) e un test verifica che la nota interna non esca mai.
9. **Stampa e PDF** del calendario cliente (solo pubblicazioni future) e del piano editoriale (schede piene); prova automatica sui PDF generati.

### Decisioni di dominio da fissare nella specifica prima della tappa 6

Così nessuna tappa successiva deve rifare il lavoro.

- Un contenuto pianificato appartiene a **un solo cliente** e porta al massimo **un post**.
- Giorno e ora si salvano come **data locale più ora facoltativa** nel fuso del cliente, non come istante: «il 20» senza orario è un'informazione valida. Diventano un istante solo quando nasce il post, con la stessa regola dell'ora ambigua.
- Il post può uscire in un giorno diverso da quello pianificato: il piano mostra «spostato al …», senza bloccare.
- Se si toglie un contenuto pianificato, il post già creato resta com'è.
- Se il post viene annullato, il contenuto torna «da preparare».
- Il cliente vede tipo, titolo, giorno e ora; mai la nota.

### Rischi principali e come si evitano

| Rischio | Contromisura |
|---|---|
| Il piano viene scambiato per un post vero | Aspetto tratteggiato e testo «Da preparare» sempre visibile; test di accessibilità sull'etichetta |
| Dati di un'altra agenzia visibili | RLS, `organization_id` in ogni query, batteria di isolamento |
| Nota interna nel link cliente | Campi esposti dichiarati uno per uno e test dedicato |
| Errori di giorno e ora | Data locale con fuso del cliente, test sul cambio d'ora |
| Moduli che si intrecciano | Il piano dipende dai post solo tramite eventi; regola di dependency-cruiser |

Stima: 7 PR nella tappa 9 e 2 nella tappa 10, senza nuove dipendenze e senza nuove richieste a Meta.
