# Tre varianti della landing (23/11)

Richiesta di Matteo del 23/11: più dettagli 3D, animazioni fatte bene, menu in alto centrato, font e gerarchie rivisti.

- **A · 3D** (`a.html`): una scena three.js nella prima schermata. Un post si apre a ventaglio nelle quattro destinazioni (feed e storia di Instagram e di Facebook), poi ogni copia riceve il suo esito. Si guida con lo scroll.
- **B · Prospettiva** (`b.html`): la finestra del pannello inclinata in 3D con CSS, che si raddrizza allo scroll, con gli avvisi che fluttuano a profondità diverse; poi un giro del prodotto con l'immagine ferma e i testi che scorrono.
- **C · Editoriale** (`c.html`): titolo molto grande che entra riga per riga, tre schermate a ventaglio in 3D, poi i cinque passi in orizzontale su fondo carbone.

Testata, testi delle sezioni, piè di pagina e tipografia sono gli stessi nelle tre varianti (`parti.py` genera le pagine, `comune.css` e `comune.js` sono condivisi).

## Come aprirle

Le librerie non sono nel repository: si scaricano in `vendor/` (ignorata da Git).

```sh
cd design/esplorazioni/2026-11-23-landing-varianti
mkdir -p vendor && cd vendor
npm pack three@0.187.0 gsap@3.15.1
tar xzf three-0.187.0.tgz && cp package/build/three.module.js package/build/three.core.js . && rm -rf package
tar xzf gsap-3.15.1.tgz && cp package/dist/gsap.min.js package/dist/ScrollTrigger.min.js package/dist/SplitText.min.js . && rm -rf package *.tgz
cd .. && python3 -m http.server 3102
```

Poi apri `http://127.0.0.1:3102/a.html`. In basso a destra si passa da una variante all'altra.

## Tipografia rivista

- Sora solo per i titoli (h1 640, h2 620, h3 600), con interlinea stretta e spaziatura negativa che cresce con la misura.
- Testo in carattere di sistema: corpo 17 px, sottotitolo 18–21 px, piccolo 15 px, occhiello 13 px maiuscolo con un quadratino arancio.
- Numeri tabellari dove ci sono orari e passi.

## Movimento

- Solo trasformazioni e opacità; con «riduci movimento» tutto è fermo nello stato finale.
- GSAP con ScrollTrigger per lo scroll, SplitText per le righe del titolo (variante C), three.js solo nella variante A.
- Icone Lucide (`icone.js`), le stesse del pannello.
