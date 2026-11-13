# Critica del design dopo la prova di v0.9.0 (13 novembre 2026)

⚠️ Metodo ridotto: un solo contesto (regola di AGENTS.md, «un solo agente per task»). La revisione del design e il rilevatore automatico (`impeccable detect`) sono stati fatti dallo stesso agente, prima la revisione e poi il rilevatore.

Fonte: report di Matteo sulla VPS (sezione D), schermate in locale con dati di prova (5 clienti, 1 archiviato, 4 persone) in `schermate/tappa-4-revisione/prima/` nella cartella del progetto. Superfici: Clienti (`/<agenzia>/spazi`), Utenti (`/<agenzia>/utenti`), Home dell'agenzia, barra laterale e barra in basso. Modo: **Operate** (l'utente sta lavorando, non va convinto).

## Punteggio (euristiche di Nielsen, 0–4)

| # | Euristica | Voto | Problema principale |
|---|---|---|---|
| 1 | Stato del sistema | 2 | Caricamento solo con la scritta «Caricamento…»; nessuna forma di ciò che arriva (D-3) |
| 2 | Linguaggio dell'utente | 3 | Testi italiani chiari; «Account» da solo è ambiguo (account social o account personale?) |
| 3 | Controllo e libertà | 3 | Archiviazione con conferma; nessun modo di riaprire un archiviato dall'elenco |
| 4 | Coerenza | 2 | Utenti ha il pulsante principale in testata, Clienti un modulo largo quanto la pagina; righe di altezza diversa fra pagine |
| 5 | Prevenzione degli errori | 3 | «Archivia» ha lo stesso peso di «Account» ed è accanto: facile da premere |
| 6 | Riconoscere, non ricordare | 2 | Le righe dei clienti non dicono niente del cliente (account collegati, persone) |
| 7 | Efficienza | 2 | Nessuna ricerca nell'elenco clienti; su telefono 3 schermate di scorrimento per 5 clienti |
| 8 | Estetica e minimalismo | 1 | Cinque comandi dello stesso peso per riga; un campo vuoto enorme in cima alla pagina |
| 9 | Recupero dagli errori | 3 | Errori di riga vicino alla riga; testo di riprova presente |
| 10 | Aiuto | 2 | Spiegazione in testata generica; la Home ripete il menu invece di aiutare |
| **Totale** | | **23/40** | **Accettabile, con problemi di gerarchia evidenti** |

## Specificità del design

**Revisione.** La struttura è quella di un pannello generico: titolo, modulo, elenco di riquadri tutti uguali con una fila di pulsanti. Niente dice «agenzia che gestisce i profili social dei clienti»: nessuna immagine del cliente, nessun conteggio di account o persone, nessun segno dello stato di Meta. La direzione di `DESIGN.md` («fotografie e copertine dei clienti protagoniste, struttura e controlli regolari») non arriva in queste pagine. Anche la direzione Hallmark del 29 ottobre (cartoncino, scanalatura, numeri in Geist Mono) non è ancora nel codice.

**Rilevatore.** `impeccable detect` su Clienti, Utenti, Home, `agency.vue` e `MobileNav.vue`: **nessun risultato** (nessun anti-pattern meccanico: niente testo sfumato, bordi colorati, ombre dure). I problemi sono di gerarchia e di composizione, che il rilevatore non vede.

## Cosa funziona

- **La barra laterale** è calma e leggibile: voce attiva su `brand-soft`, riga dell'utente in fondo, agenzia e contesto in testa. È la parte più matura.
- **Le aree di tocco** rispettano i 44 px ovunque (`min-h-11`), e i nomi accessibili dei pulsanti dicono il cliente («Account di Forno Luce»).
- **La tabella Utenti su computer** ha le colonne giuste (persona, ruolo, ruoli per cliente, stato, ultimo accesso) e il pulsante principale al posto giusto, in alto a destra.

## Problemi prioritari

**[P1] Clienti: cinque comandi dello stesso peso in ogni riga.**
Perché conta: l'occhio non sa dove andare; su telefono i comandi vanno a capo (Archivia da solo sulla riga sotto) e ogni cliente occupa mezza schermata. «Archivia», che è un'azione rara e pesante, sta accanto a quella di tutti i giorni.
Rimedio: riga a altezza fissa con foto o iniziali, nome e una riga di dettaglio («Owner · tuo ruolo»); un solo pulsante visibile, «Account social»; tutto il resto in un menu «⋯» (Persone, Rinomina, separatore, Archivia in rosso). Il nome è il collegamento principale. → `/impeccable distill`, `/impeccable layout`.

**[P1] Clienti: il modulo di creazione domina la pagina.**
Perché conta: la cosa più grande della pagina è un campo vuoto che serve una volta al mese; il pulsante arancio «Crea» è l'unico colore e tira l'attenzione lontano dall'elenco.
Rimedio: pulsante «Nuovo cliente» in testata, a destra del titolo, come «Invita» in Utenti; al clic il campo compare in cima all'elenco, nella forma di una riga. → `/impeccable distill`.

**[P1] Utenti su telefono: una tabella a sei colonne in 390 px.**
Perché conta: si vedono solo Persona e Ruolo; stato, ruoli per cliente e azioni sono fuori schermo a destra, raggiungibili solo scorrendo di lato. L'email va a capo a metà.
Rimedio: sotto i 768 px ogni persona diventa una riga a due livelli (foto, nome, «Admin · Attivo» sotto; email troncata), con un menu «⋯» per ruolo, link di reset, disattiva. La tabella resta da 768 px in su, con le azioni anch'esse nel menu «⋯». → `/impeccable adapt`.

**[P2] Barra in basso: «Utenti» occupa un posto da tutti i giorni, il centro è vuoto.**
Perché conta: la barra in basso è per ciò che si fa ogni giorno dal telefono (vedere il calendario, creare un post). Gestire le persone è raro. Lo spazio vuoto al centro sembra un difetto.
Rimedio (D-2): Home, Clienti, **+** (Nuovo post), **Calendario**, Impostazioni. Utenti va nel menu dell'utente, accanto a Registro attività e Privacy. Finché Calendario e Nuovo post non esistono (tappe 5 e 6), il centro mostra il **+** disattivato con l'etichetta «Presto», non un buco. → `/impeccable layout`, coordinato con il Task 6 della tappa 4.

**[P2] Caricamento con una scritta al posto della forma (D-3).**
Perché conta: 16 pagine mostrano «Caricamento…» in alto a sinistra; quando i dati arrivano tutto salta giù. Lo scheletro tiene il posto e fa capire cosa sta arrivando.
Rimedio: un componente `ListSkeleton` (righe con cerchio, due barre di testo, pulsante) e `TableSkeleton`, con `aria-busy` e un testo solo per i lettori di schermo; animazione leggera, spenta con `prefers-reduced-motion`. Prima Clienti, poi le altre pagine. → `/impeccable harden`.

## Segnali per persona

**Giulia, Admin in agenzia, dal telefono tra un cliente e l'altro:** apre Clienti per trovare Pizzeria Da Gino: deve scorrere tre schermate perché ogni riga è alta 230 px; non c'è ricerca. Per vedere chi lavora su un cliente apre «Persone», ma il pulsante è a metà di una fila che va a capo.

**Matteo, Owner, dal computer:** in Clienti vede cinque righe identiche, senza nessuna informazione che le distingua (quanti account, se Meta funziona). Per togliere un cliente il pulsante «Archivia» è a un clic sbagliato da «Rinomina».

**Sam, con lettore di schermo:** i nomi accessibili sono buoni; però il caricamento non è annunciato come stato occupato (`aria-busy`) e la tabella Utenti su telefono obbliga a scorrere di lato, cosa che con lo zoom al 200% diventa faticosa.

## Osservazioni minori

- D-5, proporzioni: righe di Clienti alte 77 px, righe di Utenti fra 77 e 109 px, schede della Home 56 px, invito 60 px. Proposta: **una riga di elenco è alta 64 px** (foto 32, due righe di testo, pulsanti 44), ovunque.
- La spiegazione di Clienti («Ogni cliente è uno spazio di lavoro…») parla del modello dati, non del lavoro: meglio «I clienti che l'agenzia segue, con i loro account social e le persone che ci lavorano.».
- «Archiviati» è un elenco di nomi senza contenitore (D-5: «nessun testo senza contenitore»): diventa una sezione a scomparsa, «Archiviati (1)», con righe come le altre ma attenuate.
- Home dell'agenzia: le schede ripetono il menu laterale. È il Task 6 della tappa 4 (home del cliente) a dover decidere cosa ci va.
- Logo in alto a sinistra: solo la scritta. È nel thread delle correzioni 0.9.1 (C-3/D-4), qui non si tocca.

## Domande

- Clienti, azione principale: «Account social» (dove si lavora oggi) o «Apri» la futura home del cliente (Task 6)? Proposta: oggi «Account social», poi il nome porterà alla home.
- Barra in basso: il **+** disattivato con «Presto» va bene finché non c'è Nuovo post, o preferisci tenere il centro vuoto?
- La direzione Hallmark (cartoncino, Geist Mono per i numeri) va portata nel codice ora, insieme a questa revisione, o dopo, in un passaggio solo visivo?
