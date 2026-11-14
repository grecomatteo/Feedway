# Tre direzioni a confronto: Clienti, Utenti, barra in basso, caricamento (13 novembre 2026)

Richiesta di Matteo: «vediamo tutte le opzioni, non darmene una per presa»; una direzione con Impeccable, una con Hallmark, una con la skill Web Designer che ha allegato; pro e contro, poi si decide come realizzare il tutto. Obiettivo dichiarato: più armonia e professionalità, oggi «sembra un giocattolo» (altezze e larghezze diverse, gerarchie sbagliate).

Le tre direzioni sono pagine HTML statiche con gli stessi dati (5 clienti, 4 persone, 1 invito), in `design/esplorazioni/2026-11-13-revisione/index.html` (`?v=a|b|c&p=clienti|utenti&s=loading`). Schermate a 1440 e 390 nella cartella del progetto, `schermate/tappa-4-revisione/` (`confronto-a.png`, `confronto-b.png`, `confronto-c.png`, `confronto-utenti-telefono.png`, `confronto-caricamento.png`). Vincoli uguali per tutte: marchio (arancio `#FF762E` con testo carbone, Sora per i titoli, testo di sistema), dati che esistono oggi o a breve (nessun dato inventato tipo pacchetti o incassi).

## A · «Elenco» (Impeccable, rifinitura dell'esistente)

Barra laterale di oggi; un solo riquadro bianco con righe da 64 px separate da filetti; in ogni riga iniziali, nome, una riga di dettaglio («2 account · funziona · 3 persone»), un pulsante «Account social» e «⋯». «Nuovo cliente» in testata. Archiviati in una sezione richiudibile. Barra in basso: Home, Clienti, + («Presto»), Calendario, Impostazioni.

- **Pro:** risolve i problemi del report con il cambiamento più piccolo; già fatto nel codice (ramo `feat/tappa-4-revisione-clienti`, non fuso). Righe tutte alte uguali.
- **Contro:** è ancora una pila di scatole: lo stesso pulsante «Account social» ripetuto cinque volte è rumore. Le informazioni stanno in una frase, non in colonne: non si confrontano i clienti a colpo d'occhio, e quando arriveranno altri dati (post, prossima uscita, foto) la riga non regge. Su telefono la riga di dettaglio si tronca. È la più «da app», la meno da strumento professionale.

## B · «Tabella su cartoncino» (Hallmark, la direzione del 29 ottobre)

Fondo carta caldo, tabella su cartoncino con una luce leggera; selettore a scanalatura «Attivi 5 · Archiviati 1» e ricerca; colonne Cliente, Account social (numero e stato con icona e fondo tenue), Persone, Il tuo ruolo, «⋯». In testata un riassunto: «5 clienti · 1 account da ricollegare». Su telefono righe a due livelli; lo stato compare solo se c'è qualcosa da fare. Barra in basso: Oggi, Calendario, + (Nuovo post), Clienti, Menu.

- **Pro:** è la direzione che hai già approvato («mi piace»), quindi Clienti e Team si allineano alle tavole Hallmark; la tabella regge colonne future (prossimo post, responsabile); ricerca e filtro servono davvero con 20+ clienti. Barra in basso coerente con la tavola «Oggi» al telefono.
- **Contro:** tre livelli di superficie (carta, cartoncino, intestazione) più pastiglie colorate in ogni riga: la skill Web Designer lo chiama il «cruscotto a pastiglie» (troppi colori che fanno lavori diversi). La colonna «Il tuo ruolo» è uguale su ogni riga per Owner e Admin: spreca larghezza. I numeri in carattere mono sono un costume se non c'è Geist Mono (qui non c'è: va scaricato e servito da noi).

## C · «Officina» (skill Web Designer)

Una sola superficie bianca, niente riquadri; tabella con filetti e una linea carbone sotto l'intestazione; lo stato è un punto e una parola, e solo «Da ricollegare» ha colore (arancio, l'unico accento). Al posto dei numeri una frase: «5 clienti. Pizzeria Da Gino ha un account da ricollegare.» con il link. Barra in alto al posto di quella laterale, con ricerca «Ctrl K». Telefono: righe a due livelli senza scatole; barra in basso Home, Calendario, + (Nuovo post), Clienti, Tu (la foto apre il menu dell'utente, quindi niente foto anche in alto).

- **Pro:** la più armoniosa e professionale: una griglia, un'altezza di riga, un accento con un solo significato. L'occhio va dritto al problema. Mostra gli handle dei profili, cioè il contenuto vero del cliente. Su telefono è la più pulita.
- **Contro:** la barra in alto non regge l'hub: Calendario, Piano, Libreria, Report, Shooting, Lavoro non ci stanno, e il selettore di cliente e profilo appena rifatto (D-4, D-14) vive nella barra laterale. Senza iniziali né foto, quando arriveranno le foto dei clienti (Task 4) perde la sua fonte di ricchezza. È anche la più fredda rispetto al marchio caldo.

## Il mio giudizio (da senior designer)

Nessuna delle tre va presa intera.

- A è un buon cerotto, non un sistema.
- B è la direzione giusta per il **guscio e i materiali**, ma ha troppa decorazione per riga.
- C ha la **grammatica** più professionale, ma ha il guscio sbagliato per un hub che crescerà.

**Proposta: una direzione unica che prende da tutte e tre.**

1. **Guscio di B (Hallmark):** barra laterale com'è oggi, fondo carta, logo vero (in arrivo con 0.9.1), selettore a scanalatura e ricerca sopra gli elenchi.
2. **Grammatica di C (Web Designer):** una superficie per elenco, righe con filetti, nessuna scatola dentro scatola; stato come punto più parola, colore solo dove serve agire; una frase di riepilogo con link al posto dei conteggi.
3. **Regola di riga di A (Impeccable):** ogni riga è alta 64 px su telefono e 56 su computer, iniziali o foto da 32 px, il nome è il collegamento principale, una sola azione visibile solo se serve davvero, il resto in «⋯».
4. **Telefono:** Home, Calendario, + (Nuovo post), Clienti, Tu. (Con la proposta P «Account social» non c'è più: vedi `2026-11-13-clienti-e-profili.md`.) Utenti, Account social, Impostazioni, Registro e Privacy vanno nel menu «Tu», che sostituisce la foto in alto. Finché Calendario e Nuovo post non esistono, le due voci si vedono disattivate con «Presto».
5. **Caricamento:** scheletri con la forma esatta della riga di quella pagina (componenti `ListSkeleton` e `TableSkeleton`), mai una scritta.

## Come realizzarlo (proposta)

Prima il sistema, poi le pagine, ognuna approvata con schermate prima del rilascio:

1. **PR 1, fondamenta:**
   - in `DESIGN.md` la sezione «Elenchi e tabelle» (altezze, colonne, stati, azioni);
   - token Hallmark in CSS (carta, cartoncino, scanalatura);
   - componenti `PageHeader`, `DataList`/`DataRow`, `RowActions` («⋯»), `StatusDot`, `SegmentedFilter`, `SearchField`, `ListSkeleton`/`TableSkeleton`;
   - nessuna pagina cambia ancora.
2. **PR 2, Clienti** con i nuovi componenti (riprende il ramo già fatto).
3. **PR 3, Utenti:** tabella su computer, righe su telefono, inviti nella stessa lista.
4. **PR 4, barra in basso e menu «Tu»**, insieme al Task 6 della tappa 4 (navigazione e home del cliente).
5. **PR 5, le altre pagine:**
   - Account social, Home, Registro, Impostazioni;
   - scheletri ovunque.
6. Ogni PR porta schermate chiare e scure, da computer e da telefono, nella cartella del progetto, ed è fusa solo dopo il tuo sì. La versione per la VPS arriva solo alla fine.
