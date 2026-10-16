> Specifica richiamata dal prompt principale `01-PROMPT-INIZIA-QUI.md`. Tutti i percorsi partono dalla radice del pacchetto.

# Specifica della consegna app sulla tela

Il pacchetto di design è nella cartella `design/brief-feedway/`. Se lo trovi altrove, individua `00-LEGGIMI.md` e usa quella cartella come base. Il repository è quello della mia applicazione; rispetta eventuali istruzioni già presenti.

Voglio progettare Feedway con Pen.dev collegato a Claude Code. Preferisco un'interfaccia più visiva e creativa, con miniature grandi e colori del brand. Lavorerò soprattutto da computer; il telefono è occasionale ma deve funzionare bene.

Leggi prima `00-LEGGIMI.md`, `03-BRIEF-APP.md`, `ricerca/VALUTAZIONE-60-RIFERIMENTI.md`, `05-REVISIONE-E-ACCETTAZIONE.md`, `08-DECISIONI-E-FONTI.md` e il documento originale `progetto/PROGETTO-OPENMETA-v9-ORIGINALE.md`. Per i dati usa `dati/scenari.json`. Guarda i 12 riferimenti in `riferimenti/app/PRIMARI/` e usa l'indice per gli approfondimenti; non caricare tutte le 60 immagini nella stessa richiesta al modello.

Agisci come product designer e design engineer: collega ogni scelta a un'attività dell'utente. Mantieni un solo sistema visivo. Prendi la gerarchia da Buffer, il calendario visuale da Planable, la libreria da Pallyy e il comportamento della griglia da Later; adatta questi principi alla nostra applicazione. Non riprodurre il marchio o il tema dei concorrenti.

Verifica gli strumenti realmente esposti dal collegamento MCP di Pen.dev e lo stato dell'editor. Chiama `read_skill()` e leggi i riferimenti necessari prima di operare; gestisci i documenti `.pen` soltanto tramite Pen e i suoi strumenti. Usa quegli strumenti per creare elementi nativi modificabili, variabili semantiche e componenti riusabili. Salva il progetto in `design/feedway-ui.pen`, con gli asset necessari accanto. Se esiste già un file importante, aprilo e conserva il lavoro prima di modificarlo; non sovrascrivere una tela estranea.

Vincoli: italiano; Nuxt/Vue/TypeScript; più agenzie e clienti; un post appartiene a un solo cliente/spazio; solo destinazioni di quel cliente; medesimo contenuto su IG/FB; ruoli del documento; cliente in sola visione. Le API reali, l'AI copy, le approvazioni cliente, le statistiche e le attività future non vanno inventate. Il brand è approvato nel kit Feedway: arancio/carbone, titoli Sora 650, corpo system-ui. Usa i file originali del logo e variabili coerenti, con etichette carbone sui pulsanti arancioni.

Procedi con questo primo risultato concreto:

1. Breve riepilogo dei vincoli e degli eventuali conflitti reali, senza ripetere l'intervista già svolta.
2. Mappa delle sezioni e dei flussi, con i passaggi fra agenzia, cliente e account social.
3. Sulla tela due alternative strutturali, usando gli stessi dati: A settimana visuale a colonne e B mese con libreria richiamabile. In entrambe mostra Calendario, Nuovo post e Dettaglio con 4 destinazioni confermate e 1 con problema. Aggiungi un piccolo campione di componenti condivisi e l’applicazione del brand approvato; niente esplorazione illimitata di stili.
4. Dimensione principale 1440×900; controlla anche l'ingombro a 1280×800. Mostra una prova dei flussi essenziali a 390×844.
5. Controlla nomi lunghi, molti post, errori, permessi, fuso e leggibilità. Ispeziona le tavole con gli strumenti disponibili e correggi i problemi in un'unica revisione raggruppata. Le anteprime dei concorrenti non sostituiscono questa verifica.

Riporta le tavole, l'alternativa consigliata e i compromessi nella consegna visiva congiunta app/landing prevista dal prompt principale. Raccogli insieme le scelte ancora necessarie, senza ripetere quelle già approvate. In questa fase prepara il design sulla tela; il prototipo Nuxt segue la scelta effettiva. Non dichiarare interazioni cliccabili o sincronizzazione automatica che non hai verificato.

Se la tua installazione richiede un'informazione indispensabile che manca, chiedila in modo specifico; altrimenti risolvi le scelte ordinarie usando il brief e annota le ipotesi.
