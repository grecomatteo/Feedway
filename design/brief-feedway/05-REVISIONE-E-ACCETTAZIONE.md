# Come valutare il risultato

Questi sono criteri di accettazione proposti per il prototipo. Non sono risultati già ottenuti. Il documento originale v9 rimane la fonte dei requisiti di prodotto. Un mock dimostra il comportamento progettato; non certifica le API Meta, i permessi server, l'assenza di duplicati, l'accessibilità completa o la puntualità del worker.

## Priorità

- Bloccante: cliente/account sbagliato, azione non consentita, perdita di contenuto, messaggio di successo falso, pubblicazione avviata involontariamente, dati interni nel link cliente.
- Alta: persona che non completa il compito, stato incomprensibile, data/fuso poco chiari, controlli o menu irraggiungibili.
- Media: leggibilità, densità, gerarchie, pannelli troppo stretti, informazioni secondarie rumorose.
- Rifinitura: piccoli allineamenti, raccordi visivi e movimento. Non precedono le correzioni sopra.

## Verifiche per flusso

| Flusso | Prova osservabile |
|---|---|
| Contesto | In ogni schermata la persona identifica agenzia e cliente. La vista Tutti i clienti richiede di scegliere un cliente prima della creazione. |
| Permessi | Editor salva una bozza ma non programma; Viewer non trova controlli di modifica utilizzabili. Gestione altrui rispetta §10.2. |
| Calendario | Le stesse destinazioni non generano cinque schede indistinguibili dello stesso post. Ora, tipo, cliente e stato restano leggibili. |
| Densità | Con 1, 5 e 12 post nello stesso giorno è possibile trovare il contenuto senza sovrapposizioni. La vista mese segnala i contenuti nascosti e permette di aprirli. |
| Filtri | Mostra filtri attivi, azzeramento e stato senza risultati distinto da calendario vuoto. |
| Editor | La caption rimane unica sulle destinazioni. Le schede di anteprima non creano campi indipendenti per piattaforma. |
| Account | Nome e piattaforma sono leggibili senza hover. L'account non sano indica il motivo e non si seleziona. |
| Upload | Le fasi caricamento, analisi, conversione e pronto sono distinte. Un file fallito non cancella gli altri né la caption. |
| Bozza | Stato Salvando/Salvato/Salvataggio non riuscito veritiero. Cambiare cliente o uscire non perde il lavoro. |
| Controlli | Blocco, avviso da confermare e correzione hanno conseguenze e azioni diverse. L'errore è vicino al contenuto o al campo. |
| Programmazione | Prima della conferma sono presenti cliente, account, data, ora e fuso. Nessuna scelta automatica su un'ora ambigua. |
| Esito | 4 confermate + 1 da accertare non diventa Tutto confermato né un invito a ripubblicare tutte le destinazioni. |
| Recupero | Riprova è disponibile solo se consentito e riguarda la destinazione corretta. Il prototipo dichiara che l'azione è simulata. |
| Griglia | Pubblicati e programmati sono distinguibili. Il riordino mostra gli orari modificati e offre alternativa al drag. |
| In blocco | 20 righe con 2 blocchi producono un riepilogo esplicito di 18 programmabili e 2 bozze; errori e file non abbinati sono individuabili per riga. |
| Link cliente | Nessuna nota interna, membro o altro cliente. Modifica, approvazione e commento non sono disponibili. Scadenza e revoca hanno stati dedicati. |
| Configurazione | Non si può saltare una verifica fallita fingendo completamento. Il percorso di recupero conserva il lavoro. |
| Gestione | Profilo, impostazioni agenzia e piattaforma sono riconoscibili come ambiti diversi. |

## Copertura minima degli stati

Per ogni schermata della prima tranche: normale, vuota, caricamento, errore recuperabile, successo, accesso insufficiente, dati lunghi e molti elementi. Ove applicabile: rete assente, upload interrotto, account non sano, conflitto di modifica, processo non più annullabile e link scaduto. Non moltiplicare cento tavole identiche: usare un componente o un pannello di stati con esempi rappresentativi e mappa esplicita.

## Estetica e coerenza

1. Le miniature sono riconoscibili alla dimensione reale, senza aprire lo zoom dell'immagine.
2. Le schede di tre clienti con foto diverse sembrano parti dello stesso prodotto.
3. Controlli e metadati non competono tutti con la miniatura. La CTA principale è evidente anche con un media molto colorato.
4. Font, spazi, bordi, raggi, icone e stati provengono dagli stessi componenti e token.
5. Il tema scuro conserva la gerarchia e la leggibilità, anche con immagini scure.
6. Il cambio del colore brand non modifica il significato di errore/successo/avviso.
7. Non giudicare il contrasto del concorrente dal velo grigio o dalle frecce aggiunte nei tutorial: verificare i colori dell'interfaccia che si sta costruendo.

## Accessibilità e adattamento

Obiettivo del prodotto: WCAG 2.2 AA come nel v9. Il progetto richiede aree di tocco di almeno 44 px: è una scelta del brief più generosa della soglia minima WCAG 2.2 AA di 24×24 CSS px, che prevede eccezioni e spaziature. Non confondere il valore del brief con il minimo della norma.

- Contrasto del testo normale almeno 4,5:1 e del testo grande almeno 3:1; verificare anche bordi e stati non testuali richiesti. Non dichiarare conformità con il solo controllo automatico.
- Tastiera: ordine logico, focus visibile, apertura/chiusura menu e ritorno al controllo iniziale, nessun intrappolamento.
- Ogni drag ha alternativa tramite singolo puntatore senza trascinare, oltre alla tastiera: cambiare orario da menu o scegliere una posizione.
- Etichette per icone e campi; nessuna informazione essenziale solo su colore o hover; annunci comprensibili per aggiornamenti di stato senza ripetizioni continue.
- Zoom 200%, riduzione movimento, testi lunghi italiani, tastiera aperta sul telefono e controlli non coperti.
- A 390 px niente calendario di sette colonne imposto. La tabella in blocco può avere una vista ridotta o una consultazione per riga; la modifica in massa resta ottimizzata per desktop.

Fonti: [W3C — novità WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) e [W3C — contrasto minimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

## Prova con persone

Usare la stessa versione del prototipo e dati equivalenti. Dare il compito, non la sequenza di clic. Osservare senza spiegare dove si trovano le funzioni. Se la persona si blocca, annotare il punto prima di aiutarla. Alla fine chiedere come ha capito il risultato.

| Compito | Esito atteso |
|---|---|
| Programma un reel del cliente Forno Luce per domani alle 18 su tutti i suoi account previsti. | Cliente e destinazioni corretti, avvisi risolti consapevolmente, orario e fuso corretti. |
| Un post ha quattro destinazioni confermate e una con problema: scopri quale e cosa puoi fare. | Individua l'account, comprende il problema e non ripubblica le quattro riuscite. |
| Sei Editor: prepara una bozza con una foto senza pubblicare. | Non confonde salvataggio e programmazione. |
| Importa venti righe: due hanno errori. Sistema quelle possibili e programma il resto. | Comprende il numero di post effettivo e ritrova le due bozze. |
| Mostra al cliente il calendario della prossima settimana. | Apre il link corretto di sola visione e comprende cosa è pubblico. |
| Dal telefono carica una foto e ritrova una bozza. | Completa il lavoro senza cercare funzioni desktop fuori schermo. |

Annotare per compito: completato senza aiuto / con aiuto / non completato, errori di contesto, esitazioni, stato finale compreso e tempo osservato. Il primo giro crea il riferimento, poi si confrontano le revisioni. Non fissare un tempo “scientifico” senza dati. Criterio iniziale: nessun errore critico irrisolto nel campione e compiti principali completati senza istruzioni. Il campione piccolo non dimostra l'assenza di problemi per tutti.

## Quando passare allo sviluppo

Matteo ha scelto una direzione visibile; il percorso principale è navigabile; gli stati ad alto rischio sono provati; non restano errori critici noti; componenti e token sono riusabili; ogni verifica ancora mancante è dichiarata. La sicurezza e l'affidabilità effettive si dimostrano nei test di sviluppo previsti dal v9, non nel prototipo.

## Brand Feedway

- File del logo corretto per sfondo e dimensione, margini e proporzioni del kit preservati; nessuna ricostruzione tipografica.
- Arancio/carbone e titoli Sora 650; corpo system-ui come base. Il testo bianco/arancio e arancio/bianco non viene usato per testo ordinario.
- Controlli, bordi, focus e stati non testuali verificati; testo/icone completano il colore. Il dark e il white-label mantengono leggibilità.
- Font, icone, favicon e manifest raggiungibili ai percorsi di deployment effettivi. Nessun asset concorrente dentro il prodotto.

## Landing e passaggio alla demo

| Compito / controllo | Esito atteso |
|---|---|
| Capire il prodotto dal primo schermo | La persona sa descrivere Feedway come il posto dove l'agenzia gestisce clienti, team, contenuti e pubblicazione IG-FB, senza confonderlo con analytics o influencer marketing. |
| Usare Richiedi una demo | Apre il contatto previsto (per ora via email, ADR 013), senza moduli, cookie o raccolta di dati non dichiarata. |
| Usare Accedi | Percorso distinto dalla demo; nessun dato reale esposto nella presentazione pubblica. |
| Cambiare vista, aprire FAQ e menu | Contenuto corrispondente, stato annunciato, tastiera e ritorno del focus corretti dove applicabile. |
| Leggere su telefono | Titolo, CTA e prodotto comprensibili; nessun overflow involontario, ancore non coperte dal menu fisso. |
| Controllare le promesse | Nessun prezzo, trial, loghi clienti, testimonianza, affiliazione Meta o risultato numerico privo di una fonte autorizzata. |
| Controllare immagini e carico | Dimensioni riservate, asset adeguati, media secondari differiti; misure solo se realmente raccolte. |
| Tornare dalla demo | Ritorno chiaro alla landing senza perdita o accesso a dati non pertinenti. |

La pagina deve essere provata senza autenticazione. Una demo locale può usare memoria o persistenza locale dichiarata nel contesto della prova; non simula una pubblicazione reale. Prima di un lancio servono destinazioni effettive delle CTA, contenuti legali approvati e allineamento del copy alle funzioni disponibili.
