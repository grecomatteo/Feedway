# Nuova direzione del pannello · revisione critica (19 novembre 2026)

Richiesta di Matteo dopo la prova della 0.12.0: il pannello sembra «ancora un po' troppo artigianale e giocoso», i sottotitoli sono inutili, la barra in alto e alcuni clic sono scomodi. Vuole una direzione più professionale che tenga lo stile di Feedway, con schermate fatte come verrebbero davvero.

**Stato: adottata da Matteo il 19 novembre 2026** (D-80 in `docs/decisioni-aperte.md`), con l'accesso corretto (logo grande al centro). Il codice e `DESIGN.md` cambiano con il piano del ridisegno, non con questa PR.

## Dove guardare

- Schermate: `design/esplorazioni/2026-11-19-nuova-direzione/schermate/computer/` (1440 px) e `…/schermate/telefono/` (390 px), tema chiaro, con lo stesso numero per la stessa schermata.
- Pagine vive: `design/esplorazioni/2026-11-19-nuova-direzione/index.html?p=oggi`. Sono HTML e CSS veri, con gli stessi punti di rottura del pannello: restringendo la finestra si vede il telefono. Valori di `p`: `sistema`, `accedi`, `oggi`, `oggi-tranquillo`, `selettore`, `notifiche`, `tu`, `calendario`, `editor`, `editor-reel`, `editor-anteprima`, `conferma`, `cliente&stato=programmato`, `post`, `clienti`, `nuovo-cliente`, `panoramica`, `cliente`, `contenuti`, `libreria`, `file`, `utenti`, `invita`, `impostazioni`, `sicurezza`, `integrazioni`, `registro`.
- Non è sulla tela Pencil: in questo ambiente Pencil non era raggiungibile. Se la direzione passa, le tavole si rifanno sulla tela con i componenti.

## Fonti

Schermate della 0.12.0 (`schermate/tappa-6/` nella cartella del progetto), `ESITI-prova-0.12.0.md` §3, `DESIGN.md`, brief 03, guida del marchio. Dati di esempio fittizi (Studio Riva, Forno Luce).

## Cosa non funziona oggi

Osservazioni sulle schermate della 0.12.0, in ordine di peso.

1. **L'arancio è ovunque, quindi non indica niente.** Pulsante principale, spunte, voce attiva del menu (pesca), tipo scelto (pesca), sottolineatura delle schede, cerchi dei clienti (pesca). In una schermata dell'editor ci sono sette cose arancio o pesca. È la prima causa dell'effetto «giocoso».
2. **Tutto è grande e pesante uguale.** Titolo di pagina Sora 30, titoli di sezione Sora 18 in grassetto, pulsanti del tipo alti 48 con bordo da 2, casella del testo con doppio bordo scuro. Manca una scala: l'occhio non sa da dove partire.
3. **Frasi che spiegano l'ovvio.** «Foto vuole un file solo. Reel vuole un video solo. Storia vuole un file solo.», «2 file · trascina per cambiare l'ordine», «Esce mercoledì 18 novembre alle 18:00 · ora di Roma» sotto due campi che dicono la stessa cosa, «Feedway sistema da solo 4 cose, senza chiederti niente». Ognuna da sola è innocua; insieme fanno una pagina che parla troppo.
4. **L'editor sul telefono spreca lo schermo.** In alto due righe (cliente e campanella, poi «← Forno Luce» e «Bozza»). In basso la barra occupa tre righe: stato, poi due pulsanti di cui uno va a capo («Programma su 2 / account»). Tra le due restano circa 500 px per lavorare. Il tipo è una griglia 2×2 alta 110 px per scegliere una voce su quattro.
5. **Controlli che non servono al caso reale.** Ricerca e «Togli tutti» sopra due account. «Seleziona tutti» e i gruppi hanno senso da sei account in su.
6. **Date e ore del browser.** `11/18/2026` e `06:00 PM` in un prodotto italiano: è il dettaglio che più di tutti fa sembrare il pannello non finito.
7. **Anteprima vuota con una cornice da telefono spessa.** Occupa un terzo dello schermo per dire «arriva a breve». (Nella 0.12.0 l'anteprima vera c'è; la cornice resta più pesante del contenuto.)
8. **Il riepilogo delle destinazioni è in fondo.** Per sapere se il post è pronto bisogna scorrere tutta la pagina, oppure fidarsi della barra.
9. **La Home ripete il menu.** Cinque riquadri uguali che portano alle stesse pagine della barra laterale (già segnalato nella prova).
10. **Schermo largo.** Il pulsante principale della pagina finisce a 1.000 px dal titolo; le colonne si allargano senza motivo; «Collegamento» è una colonna quasi sempre vuota.
11. **I cerchi color pastello.** Clienti e persone hanno lo stesso cerchio pesca o giallo con le iniziali: non si distinguono tra loro e danno un tono da app per consumatori.
12. **Dopo «Programma» non succede niente di visibile.** Si resta nel post (già segnalato nella prova).

## La proposta

Il marchio non cambia: arancio `#FF762E`, carbone `#242321`, Sora, fondi caldi, logo dai file originali. Cambia come si usano.

### Regole

| Regola | Oggi | Proposta |
|---|---|---|
| Arancio | Azioni, selezioni, voce attiva, spunte, schede | Una sola azione per schermata: «Nuovo post» nel pannello, «Programma» nell'editor. Più il conteggio delle cose da sistemare e la sottolineatura della scheda attiva |
| Selezioni | Arancio e pesca | Carbone: spunte, interruttori, voce attiva del menu (fondo grigio caldo) |
| Titoli | Sora 26–30 per la pagina, Sora 18 per le sezioni | Sora 22 solo per il titolo di pagina; sezioni in carattere di sistema 14, semigrassetto |
| Testo | 15–16 px | 14 px al computer, 15 al telefono; dettagli a 13 |
| Controlli | 44–48 px ovunque | 36 px al computer, 44 px al telefono |
| Righe | 56 / 64 px | 52 / 60 px |
| Fondi | Carta `#F6F3EE`, cartoncino `#FFFDF9` | Pagina `#FBFAF8`, superfici bianche: più contrasto tra fondo e contenuto, meno beige |
| Raggi | 8 e 12 | 8 e 10; miniature 6 |
| Clienti e persone | Cerchi pastello uguali | Clienti quadrati, persone tonde, grigio caldo con le iniziali o la foto vera |
| Sottotitoli | Ridotti con D-63, ne restano | Nessuno sotto i titoli. Una frase solo accanto al punto in cui serve («Con 2 file si può fare solo un carosello.») |
| Date e ore | Formato del browser | «venerdì 20 novembre», «ven 20 nov, 18:00», sempre 24 ore |
| Larghezza | Piena | Piena fino a 1200 px di contenuto, poi si ferma |

La tavola `computer/00-sistema.png` le mostra tutte.

### Guscio

- **Barra laterale (240 px):** logo e campanella; selettore del cliente; **«Nuovo post» sempre lì**, raggiungibile da ogni pagina con un clic; poi Oggi, Calendario, Clienti, Libreria; sotto il nome dell'agenzia, Utenti e Impostazioni. «Registro attività» entra nelle Impostazioni dell'agenzia.
- **Telefono:** una sola riga in alto con il selettore del cliente e la campanella (richiesta della prova). La riga dell'agenzia sparisce. La barra in basso resta a cinque voci, con «Oggi» al posto di «Home».
- Le azioni di pagina («Nuovo cliente», «Carica», «Invita») sono pulsanti con contorno nella riga degli strumenti, accanto a filtro e ricerca, non più nell'angolo opposto al titolo.

### Oggi (`02`–`06`)

Tre domande, in quest'ordine: cosa devo sistemare, cosa esce, cosa ho lasciato a metà.

- **Da sistemare:** una riga per problema, con chi riguarda e il pulsante che lo risolve («Apri il post», «Ricollega», «Riprova»). Se non c'è niente, la sezione non compare.
- **In uscita:** la settimana in una striscia (un trattino per post, colorato per stato) e sotto l'elenco di oggi e domani con ora, miniatura, testo, cliente, piattaforme e stato.
- **A destra:** bozze da finire, con cosa manca, e clienti recenti.

Quello che mostra oltre la 0.12.0: gli esiti «Pubblicato» e «non uscito» (tappa 7) e il calendario (tappa 9). Prima di allora «In uscita» mostra solo i programmati.

### Editor del post (`08`–`13`)

- **Pagina senza barra laterale.** In alto una riga: indietro, cliente, «Nuovo post», stato del salvataggio, e a destra «Salva ed esci» e «Programma su 2 account». Più spazio per modulo e anteprima, e un solo arancio.
- **Etichetta a sinistra, contenuto a destra.** Tipo, File, Testo, Dove, Quando, Etichette, Note: sette righe separate da un filetto. A 1440 px l'intero post sta in una schermata e mezza invece di due e mezza.
- **Tipo:** un filtro a quattro voci su una riga. Il motivo delle voci spente è una frase sola, scritta per il caso («Con 2 file si può fare solo un carosello.»).
- **File:** miniature più piccole (96×120), «Aggiungi» come ultima casella, «Carica» e «Dalla libreria» sotto.
- **Testo:** bordo normale; in fondo «Inserisci» e i contatori con l'icona della piattaforma («85 / 2.200», «# 0 / 30»).
- **Dove:** solo l'elenco degli account. Ricerca, gruppi e «Seleziona tutti» compaiono da sei account in su.
- **Quando:** giorno e ora scritti all'italiana. La frase «Esce…» sparisce; resta «Orario abituale di Forno Luce» quando l'ora è quella predefinita.
- **A destra:** anteprima senza cornice da telefono e, subito sotto, i **controlli** per destinazione. Si vede sempre se il post è pronto, senza scorrere.
- **Telefono:** una riga in alto (indietro, titolo, «Anteprima»). In basso una riga: a sinistra «Bozza salvata alle 11:53», a destra «Programma su 2 account». «Salva bozza» sparisce dal telefono, perché la bozza si salva da sola; per uscire c'è la freccia.
- **Dopo «Programma»** (`12`): si torna ai post del cliente con la conferma «Programmato per ven 20 nov alle 8:00 · Apri».

### Elenchi (`14`–`22`)

- **Clienti:** al posto della colonna vuota, «Prossimo post» e «In programma». «Collegamento» si riempie solo quando c'è da agire. I profili non abbinati sono una riga sotto l'elenco.
- **Post del cliente:** nome del cliente e profili su una riga; filtro con «Pubblicati»; la riga dice tipo e numero di file.
- **Libreria:** file raggruppati per giorno; sotto il nome, in blu, dove è usato («Nel post di oggi, 18:00», «In una bozza»); filtri per cliente e per uso accanto alla ricerca.
- **Utenti:** colonna «Clienti» (su quali lavora) e «Ultimo accesso»; lo stato compare solo se c'è un problema («Senza secondo fattore»).

### Impostazioni (`23`–`26`)

Righe «etichetta a sinistra, valore a destra» dentro una superficie per gruppo. Niente nome ed email sotto il titolo. Sul telefono il menu delle schede diventa una tendina.

### Secondo giro (19/11, richiesta di Matteo: «dammene tante altre», computer e telefono separati)

| N. | Schermata | Cosa mostra |
|---|---|---|
| 01 | Accedi | Passkey per prima, poi email e password |
| 03 | Oggi senza problemi | «Da sistemare» sparisce e resta una riga: «Niente da sistemare.» |
| 04 | Selettore del cliente | Ricerca, «Tutti i clienti», pallino sui clienti con un problema. Sul telefono è un foglio dal basso |
| 05 | Notifiche | Le nuove hanno il punto arancio; ogni riga dice il cliente |
| 06 | Menu della persona | Sul telefono contiene anche Libreria e Utenti, che non stanno nella barra in basso |
| 07 | Calendario | Mese al computer, elenco per giorni sul telefono. Bozze con il bordo tratteggiato, problemi in rosso tenue |
| 09 | Editor · Reel | Copertina dal fotogramma e una scelta da fare: finché manca, «Programma» è spento e accanto c'è scritto perché |
| 10 | Anteprima (telefono) | A tutta pagina, con «← Modifica» |
| 11 | «Pubblica subito» | Conferma con le destinazioni e la frase sull'impossibilità di annullare |
| 13 | Post uscito | Esito per profilo. Dove non è uscito: motivo, cosa fare, «Modifica per Facebook» e «Riprova», senza ripubblicare dove è già uscito |
| 15, 22 | Nuovo cliente, Invita | Finestre al computer, fogli dal basso sul telefono |
| 16, 18 | Cliente · Panoramica e Contenuti | Prossimi post, profili, ultimi file, chi ci lavora; orario, etichette, modelli, gruppi |
| 20 | Dettaglio di un file | Pannello a destra: dove è usato e perché non si può eliminare, detto prima di provarci |
| 24–26 | Sicurezza, Meta, Registro attività | Righe con l'azione a destra; il registro entra nelle Impostazioni |

Funzioni che queste schermate mostrano e che oggi non esistono, o non così: calendario (tappa 9), esiti e «Riprova» (tappa 7), notifiche (tappa 8), «Duplica», filtro della libreria per uso, colonna «Clienti» degli utenti. Sono disegnate per far vedere dove andrebbero, non sono decise.

## Cosa cambia rispetto a scelte già prese

Queste erano decisioni di Matteo: la proposta le riapre e servono una risposta.

| Scelta di prima | Proposta | Perché |
|---|---|---|
| Riepilogo delle destinazioni in fondo al modulo (18/11) | Sotto l'anteprima al computer; in fondo sul telefono | Sempre visibile dove c'è spazio |
| Barra delle azioni in fondo anche al computer | In alto al computer, in basso sul telefono | Al computer le azioni di una pagina stanno in testata; sul telefono vicino al pollice |
| «Salva bozza» e «Programma» sul telefono | Solo «Programma», con lo stato del salvataggio | Una riga invece di tre |
| Voce attiva e spunte in arancio e pesca (regole Hallmark, 29/10) | Carbone | Un solo arancio per schermata |
| Larghezza piena (D-63) | Piena fino a 1200 px | Richiesta della prova 0.12.0 |
| Pagina dell'editor dentro il guscio | Senza barra laterale | Spazio e concentrazione |
| Stile unione: carta e cartoncino | Fondo quasi bianco e superfici bianche | Meno «artigianale» |

## Non verificato

- Contrasto calcolato sui colori, non misurato nel browser: testo secondario `#625E58` 6,2:1 sulla pagina e 5,4:1 sulla voce attiva del menu; bordo dei campi `#8A857D` 3,7:1 su bianco; etichetta carbone sull'arancio 5,9:1.
- Nessuna prova con axe, tastiera o zoom al 200%: sono pagine statiche.
- Tema scuro e le altre quattro palette: i token ci sono, le schermate no (richiesta di Matteo: solo chiaro in questo giro).
- Gli stati (vuoto, caricamento, errore) non sono disegnati in questa direzione.
- Le foto di esempio sono le tre già nel repo, ripetute.

## Skill

Lette e scelte il 19/11 dalla lista di Matteo. Nel repo, in `.claude/skills/`: `make-interfaces-feel-better`, `emil-design-eng`, `humanizer`, oltre a `impeccable`. Tutte con licenza MIT.

Non installate: `no-ai-slop` (doppione di humanizer, costruita sull'inglese), `better-icons` (il pannello usa già Lucide), `three-js` e `gsap` (non servono a un pannello), `taste-skill` (per siti: da riprendere con la landing).

Regole di queste skill già applicate nella proposta: cifre allineate, contorno da 1 px sulle immagini, raggi concentrici, ombre solo per ciò che sta sopra, aree di tocco da 44 px sul telefono, un solo spessore di icona, nessuna animazione sulle azioni ripetute.

## Prossimi passi, se la direzione passa

1. Matteo sceglie: tutta, in parte, o no (D-80).
2. Si aggiornano `DESIGN.md`, i token in `packages/ui/src/tokens.ts` e la tela.
3. Si disegnano gli stati mancanti e il tema scuro.
4. Il lavoro sul codice entra in un piano suo, a pagine: guscio e token, poi Oggi, poi l'editor.
5. La landing si rivede dopo, sulla stessa grammatica.
