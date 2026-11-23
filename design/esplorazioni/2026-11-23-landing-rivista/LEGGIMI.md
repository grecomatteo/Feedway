# Landing rivista (23/11)

Revisione della variante A col 3D, chiesta da Matteo il 23/11 sera. Riprende le sezioni della landing del giro 3 che mancavano e organizza tutto attorno a «Tutta la tua agenzia, in un solo posto».

## Sezioni

1. Apertura con la scena three.js: il post che si apre nelle quattro destinazioni, guidata dallo scroll.
2. Il problema: sei strumenti che allo scroll confluiscono nella scheda di Feedway.
3. Tutta l'agenzia in sei aree: Pianifica, Prepara e pubblica, Produci, Fai approvare, Coordina il team, Gestisci l'agenzia. A sinistra l'elenco, a destra l'anteprima che resta ferma e cambia con l'area. Ogni funzione non ancora fatta porta «In arrivo».
4. Pubblicazione su fondo carbone, con il percorso del post.
5. Ruoli veri del pannello (Owner e Admin, Manager, Publisher, Editor, Viewer).
6. Il cliente ha il suo spazio.
7. Il report del mese («In arrivo»).
8. Pronto in un pomeriggio, tre passi.
9. I dati restano tuoi.
10. Domande frequenti.
11. Chiusura su campitura arancio e piè di pagina con la scritta gigante.

## Scelte

- Niente sopratitoli sopra i titoli (DESIGN.md e Matteo).
- Testata: logo a sinistra, voci centrate sulla pagina, «Richiedi una demo» a destra; la voce della sezione visibile si accende.
- Le anteprime stanno in un riquadro con lo stesso margine su tutti i lati: niente immagini spostate da un lato.
- Testi presi dalla landing di `apps/site` dove c'erano già, gli altri dalla specifica dell'hub.
- Icone Lucide (`icone.js`), le stesse del pannello.

## Come aprirla

Le librerie stanno in `vendor/` (ignorata da Git); per scaricarle vedi `design/esplorazioni/2026-11-23-landing-varianti/LEGGIMI.md`, poi `python -m http.server 3103` in questa cartella e apri `http://127.0.0.1:3103/index.html`.

Immagini della revisione: `design/reviews/2026-11-23-landing/rivista/`.
