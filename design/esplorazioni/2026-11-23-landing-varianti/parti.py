"""Builds a.html, b.html and c.html from shared parts.

Run: python3 parti.py  (from this folder). The variants differ in the hero,
in the product section and in the motion; header, copy and footer are shared.
"""

from pathlib import Path

HERE = Path(__file__).parent

HEAD = """<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feedway · variante {letter}: {name}</title>
<script>document.documentElement.classList.add('js')</script>
<link rel="icon" href="img/favicon.svg">
<link rel="preload" href="img/Sora-Variable.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="comune.css">
<link rel="stylesheet" href="{css}">
</head>
<body class="v-{letter}">
<header class="site-header">
  <div class="wrap bar">
    <a class="logo" href="#" aria-label="Feedway, pagina iniziale"><img src="img/feedway-horizontal-carbone.svg" alt="" width="124" height="36"></a>
    <nav aria-label="Sezioni">
      <a href="#prodotto">Prodotto</a>
      <a href="#pubblicazione">Pubblicazione</a>
      <a href="#cliente">Clienti</a>
      <a href="#domande">Domande</a>
    </nav>
    <div class="actions"><a class="btn btn-primary" href="#demo">Richiedi una demo</a></div>
  </div>
</header>
<main>
"""

FOOT = """
<section class="section closing" id="demo" aria-labelledby="closing-title">
  <div class="wrap">
    <div class="section-head reveal">
      <h2 id="closing-title">Vediamo Feedway con i tuoi clienti.</h2>
      <p class="lead">Mezz'ora in videochiamata: ci racconti come lavorate oggi e ti mostriamo il pannello con i tuoi profili.</p>
      <a class="btn btn-primary btn-lg" href="#demo">Richiedi una demo <i data-icon="arrow-right" class="icon-arrow"></i></a>
    </div>
  </div>
</section>
</main>
<footer class="site-footer">
  <div class="wrap">
    <span>© 2026 Feedway</span>
    <span><a href="#">Privacy</a><a href="#">Cancellazione dei dati</a><a href="#">Termini</a></span>
  </div>
</footer>
<nav class="variant-switch" aria-label="Varianti">
  <a href="a.html"{cur_a}>A · 3D</a><a href="b.html"{cur_b}>B · Prospettiva</a><a href="c.html"{cur_c}>C · Editoriale</a>
</nav>
<script src="icone.js"></script>
<script src="vendor/gsap.min.js"></script>
<script src="vendor/ScrollTrigger.min.js"></script>
<script src="vendor/SplitText.min.js"></script>
<script src="comune.js"></script>
{script}
</body>
</html>
"""

HERO_COPY = """
      <p class="eyebrow">Per le agenzie di comunicazione</p>
      <h1 id="hero-title">Tutta la tua agenzia, in un solo posto.</h1>
      <p class="lead">Clienti, team, contenuti e pubblicazioni. Prepari i post di tutti i clienti, li programmi su Instagram e Facebook e sai se sono usciti davvero.</p>
      <div class="cta">
        <a class="btn btn-primary btn-lg" href="#demo">Richiedi una demo <i data-icon="arrow-right" class="icon-arrow"></i></a>
        <a class="btn btn-outline btn-lg" href="#prodotto">Guarda il prodotto</a>
      </div>
"""

FEATURES = """
<section class="section" id="prodotto" aria-labelledby="product-title">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">Il prodotto</p>
      <h2 id="product-title">Ogni cosa al suo posto. Ogni persona sa cosa fare.</h2>
    </div>
    <div class="bento">
      <article class="tile tile-wide reveal tilt">
        <div class="tile-text">
          <h3><i data-icon="notebook-pen"></i>Piano editoriale <span class="soon">In arrivo</span></h3>
          <p>Il mese scritto come su un'agenda: il 10 il reel, il 12 il carosello del menu. Con un clic il contenuto diventa un post già compilato.</p>
        </div>
        <div class="window"><img src="img/piano.webp" alt="Il piano editoriale di dicembre per Forno Luce." loading="lazy" width="2000" height="1250"></div>
      </article>
      <article class="tile reveal tilt">
        <div class="tile-text">
          <h3><i data-icon="send"></i>Un post, più profili</h3>
          <p>Scrivi il testo una volta e cambialo per Instagram o Facebook solo se serve. L'anteprima è quella che vedrà chi segue.</p>
        </div>
        <div class="window"><img src="img/editor.webp" alt="L'editor con un carosello di Forno Luce e l'anteprima del feed." loading="lazy" width="2000" height="1250"></div>
      </article>
      <article class="tile reveal tilt">
        <div class="tile-text">
          <h3><i data-icon="images"></i>Libreria per cliente</h3>
          <p>Foto e video in cartelle. Carichi anche uno zip: Feedway prepara le copie giuste e toglie la posizione dalle foto.</p>
        </div>
        <div class="window"><img src="img/libreria.webp" alt="La libreria con le foto dei clienti divise per cartelle." loading="lazy" width="2000" height="1250"></div>
      </article>
      <article class="tile tile-wide reveal tilt">
        <div class="tile-text">
          <h3><i data-icon="calendar-days"></i>Tutti i clienti in un calendario <span class="soon">In arrivo</span></h3>
          <p>Mese, settimana o elenco. Ogni post ha il suo stato, e i contenuti ancora da preparare diventano gialli quando mancano meno di 36 ore.</p>
        </div>
        <div class="window"><img src="img/calendario.webp" alt="Il calendario di novembre con i post di cinque clienti." loading="lazy" width="2000" height="1250"></div>
      </article>
    </div>
    <ul class="mini reveal-list">
      <li><i data-icon="bell"></i><div><strong>Avvisi a chi deve sistemare</strong> <span class="soon">In arrivo</span><p>Nel pannello, per email o su Telegram, con le ore di silenzio.</p></div></li>
      <li><i data-icon="list-checks"></i><div><strong>Attività accanto ai post</strong> <span class="soon">In arrivo</span><p>Shooting, testi, report: con scadenza e persone assegnate.</p></div></li>
      <li><i data-icon="users"></i><div><strong>Ruoli per ogni persona</strong><p>Ognuno vede solo i clienti che segue.</p></div></li>
      <li><i data-icon="lock"></i><div><strong>Dati sotto il tuo controllo</strong><p>Il pannello gira sul tuo server, dietro Tailscale.</p></div></li>
    </ul>
  </div>
</section>
"""

PUBLISH = """
<section class="section carbon" id="pubblicazione" aria-labelledby="publish-title">
  <div class="wrap publish">
    <div class="section-head reveal">
      <p class="eyebrow">Pubblicazione</p>
      <h2 id="publish-title">Lo sai quando un post è uscito. Davvero.</h2>
      <p class="lead">Dopo l'ora programmata Feedway chiede a Meta se il post c'è. Se manca, lo scrive con il motivo e ti dice cosa fare.</p>
    </div>
    <ol class="timeline" aria-label="Il percorso di un post">
      <li><span class="t num">11:58</span><div><strong>Programmato</strong><p>Copie pronte per @fornoluce e la Pagina Forno Luce.</p></div></li>
      <li><span class="t num">12:00</span><div><strong>In pubblicazione</strong><p>Feedway manda il post a Instagram e a Facebook.</p></div></li>
      <li><span class="t num">12:01</span><div><strong>Verifica</strong><p>Chiede a Meta se il post è davvero sul profilo.</p></div></li>
      <li class="done"><span class="t num">12:01</span><div><strong><i data-icon="circle-check"></i>Pubblicato su 2 profili</strong><p>Con il link al post su Instagram e su Facebook.</p></div></li>
    </ol>
  </div>
</section>
"""

CLIENT = """
<section class="section client" id="cliente" aria-labelledby="client-title">
  <div class="wrap client-grid">
    <div class="section-head reveal">
      <p class="eyebrow">Per i tuoi clienti</p>
      <h2 id="client-title">Il cliente vede il suo calendario. E approva dal telefono.</h2>
      <p class="lead">Un link per cliente, senza account e senza password. Vede cosa esce e quando, e lascia un commento o un ok.</p>
      <p><span class="soon">In arrivo</span></p>
    </div>
    <div class="phone-stage">
      <div class="phone"><img src="img/tel-condiviso.webp" alt="Il calendario condiviso con il cliente, aperto sul telefono." loading="lazy" width="780" height="1688"></div>
    </div>
  </div>
</section>
"""

FAQ = """
<section class="section faq" id="domande" aria-labelledby="faq-title">
  <div class="wrap narrow">
    <h2 id="faq-title" class="reveal">Domande frequenti</h2>
    <details class="reveal"><summary>Funziona con TikTok e LinkedIn? <i data-icon="chevron-down"></i></summary><p>Oggi Instagram e Facebook. TikTok e LinkedIn sono previsti dopo.</p></details>
    <details class="reveal"><summary>Il cliente deve registrarsi? <i data-icon="chevron-down"></i></summary><p>No. Riceve un link suo e vede solo il suo calendario.</p></details>
    <details class="reveal"><summary>Dove stanno i dati? <i data-icon="chevron-down"></i></summary><p>Sul server dell'agenzia. Il pannello si apre solo da chi è nella vostra rete Tailscale.</p></details>
  </div>
</section>
"""


def page(letter, name, hero, product, script, extra_css):
    cur = {k: (' aria-current="page"' if k == letter else '') for k in 'abc'}
    html = HEAD.format(letter=letter, name=name, css=extra_css)
    html += hero + product + PUBLISH + CLIENT + FAQ
    html += FOOT.format(script=script, cur_a=cur['a'], cur_b=cur['b'], cur_c=cur['c'])
    (HERE / f'{letter}.html').write_text(html)


HERO_A = f"""
<section class="hero hero-a" aria-labelledby="hero-title">
  <div class="wrap hero-grid">
    <div class="hero-copy">
{HERO_COPY}
      <ol class="steps" aria-label="Come esce un post">
        <li data-i="0"><span class="num">1</span><div><strong>Scrivi il post una volta</strong><p>File, testo e profili, con l'anteprima vera.</p></div></li>
        <li data-i="1"><span class="num">2</span><div><strong>Feedway lo prepara per ogni profilo</strong><p>Misure e formato giusti per feed e storie.</p></div></li>
        <li data-i="2"><span class="num">3</span><div><strong>Controlla che sia uscito</strong><p>Se Meta non lo pubblica, sai subito perché.</p></div></li>
      </ol>
    </div>
    <div class="stage" aria-hidden="true">
      <canvas id="scene"></canvas>
      <img class="stage-fallback" src="img/oggi.webp" alt="">
    </div>
  </div>
</section>
"""

HERO_B = f"""
<section class="hero hero-b" aria-labelledby="hero-title">
  <div class="wrap hero-copy centered">
{HERO_COPY}
  </div>
  <div class="persp wrap" aria-hidden="true">
    <div class="tilt-scene">
      <div class="window main-window"><div class="chrome"><i></i><i></i><i></i></div><img src="img/oggi.webp" alt="" width="1680" height="992"></div>
      <div class="chip float f1"><span class="dot" style="background:var(--ok)"></span><span>Pubblicato su 2 profili<small>Forno Luce · 12:01</small></span></div>
      <div class="chip float f2"><i data-icon="circle-x" class="bad"></i><span>Reel non uscito su Facebook<small>il video supera i 90 secondi</small></span></div>
      <div class="chip float f3"><i data-icon="calendar-days"></i><span>Dicembre, 18 contenuti<small>Piano editoriale · Forno Luce</small></span></div>
    </div>
  </div>
</section>
"""

PRODUCT_B = """
<section class="section sticky-tour" id="prodotto" aria-labelledby="product-title">
  <div class="wrap tour">
    <div class="tour-text">
      <div class="section-head">
        <p class="eyebrow">Il prodotto</p>
        <h2 id="product-title">Ogni cosa al suo posto. Ogni persona sa cosa fare.</h2>
      </div>
      <article class="tour-step" data-shot="0"><h3><i data-icon="notebook-pen"></i>Pianifica <span class="soon">In arrivo</span></h3><p>Il piano del mese scritto come su un'agenda. Chi carica i file vede subito cosa manca e per quando.</p></article>
      <article class="tour-step" data-shot="1"><h3><i data-icon="send"></i>Prepara</h3><p>Un post per più profili, con l'anteprima vera e i controlli che dicono cosa manca prima di programmare.</p></article>
      <article class="tour-step" data-shot="2"><h3><i data-icon="images"></i>Libreria</h3><p>Le foto e i video di ogni cliente in cartelle. Uno zip dal computer diventa una cartella.</p></article>
      <article class="tour-step" data-shot="3"><h3><i data-icon="calendar-days"></i>Calendario <span class="soon">In arrivo</span></h3><p>Tutti i clienti in un calendario, con lo stato di ogni post.</p></article>
      <article class="tour-step" data-shot="4"><h3><i data-icon="bell"></i>Avvisi <span class="soon">In arrivo</span></h3><p>Un post non uscito arriva a chi deve sistemarlo, nel pannello, per email o su Telegram.</p></article>
    </div>
    <div class="tour-shots" aria-hidden="true">
      <div class="tour-frame window">
        <div class="chrome"><i></i><i></i><i></i></div>
        <div class="shots">
          <img src="img/piano.webp" alt="" width="2000" height="1250">
          <img src="img/editor.webp" alt="" width="2000" height="1250">
          <img src="img/libreria.webp" alt="" width="2000" height="1250">
          <img src="img/calendario.webp" alt="" width="2000" height="1250">
          <img src="img/notifiche.webp" alt="" width="2000" height="1250">
        </div>
      </div>
    </div>
  </div>
</section>
"""

HERO_C = f"""
<section class="hero hero-c" aria-labelledby="hero-title">
  <div class="wrap">
    <p class="eyebrow">Per le agenzie di comunicazione</p>
    <h1 id="hero-title" class="split">Tutta la tua agenzia,<br>in un solo posto.</h1>
    <div class="hero-foot">
      <p class="lead">Clienti, team, contenuti e pubblicazioni. Prepari i post di tutti i clienti, li programmi su Instagram e Facebook e sai se sono usciti davvero.</p>
      <div class="cta">
        <a class="btn btn-primary btn-lg" href="#demo">Richiedi una demo <i data-icon="arrow-right" class="icon-arrow"></i></a>
        <a class="btn btn-outline btn-lg" href="#prodotto">Guarda il prodotto</a>
      </div>
    </div>
  </div>
  <div class="cards3d" aria-hidden="true">
    <figure class="card3d" style="--i:0"><img src="img/editor.webp" alt=""></figure>
    <figure class="card3d" style="--i:1"><img src="img/oggi.webp" alt=""></figure>
    <figure class="card3d" style="--i:2"><img src="img/calendario.webp" alt=""></figure>
  </div>
</section>
"""

PRODUCT_C = """
<section class="hscroll" id="prodotto" aria-labelledby="product-title">
  <div class="hs-pin">
    <div class="wrap hs-head">
      <p class="eyebrow">Il prodotto</p>
      <h2 id="product-title">Dal piano al report, in cinque passi.</h2>
      <div class="hs-progress" aria-hidden="true"><span></span></div>
    </div>
    <div class="hs-track">
      <article class="hs-card"><span class="hs-n num">01</span><h3>Pianifica <span class="soon">In arrivo</span></h3><p>Il mese scritto come su un'agenda. Il contenuto diventa un post con un clic.</p><div class="window"><img src="img/piano.webp" alt="Il piano editoriale di dicembre." loading="lazy"></div></article>
      <article class="hs-card"><span class="hs-n num">02</span><h3>Prepara</h3><p>Un post per più profili, con l'anteprima vera e i controlli prima di programmare.</p><div class="window"><img src="img/editor.webp" alt="L'editor con l'anteprima del feed." loading="lazy"></div></article>
      <article class="hs-card"><span class="hs-n num">03</span><h3>Pubblica</h3><p>All'ora giusta su Instagram e Facebook, feed e storie, dal tuo server.</p><div class="window"><img src="img/oggi.webp" alt="La pagina Oggi con i post in uscita." loading="lazy"></div></article>
      <article class="hs-card"><span class="hs-n num">04</span><h3>Verifica</h3><p>Feedway controlla che il post sia uscito. Se no, ti dice perché.</p><div class="window"><img src="img/notifiche.webp" alt="Le notifiche: un reel non uscito." loading="lazy"></div></article>
      <article class="hs-card"><span class="hs-n num">05</span><h3>Racconta <span class="soon">In arrivo</span></h3><p>Le statistiche del mese per ogni cliente, pronte da mandare.</p><div class="window"><img src="img/statistiche.webp" alt="Le statistiche del mese di un cliente." loading="lazy"></div></article>
    </div>
  </div>
</section>
"""

page('a', '3D', HERO_A, FEATURES, '<script type="module" src="a.js"></script>', 'a.css')
page('b', 'Prospettiva', HERO_B, PRODUCT_B, '<script src="b.js"></script>', 'b.css')
page('c', 'Editoriale', HERO_C, PRODUCT_C, '<script src="c.js"></script>', 'c.css')
print('ok')
