/* Esplorazione «nuova direzione»: una pagina per schermata, scelta con ?p=.
   Dati fittizi (Studio Riva, Forno Luce…), come sulla tela. */
const q = new URLSearchParams(location.search)
const P = q.get('p') || 'oggi'
if (q.get('tema') === 'scuro') document.documentElement.dataset.tema = 'scuro'

const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`
const A = '../../feedway-ui-assets/'
const IMG = { pane: A + 'adbaa4719c5d6833.jpg', banco: A + '85eaab7ce7e4bb91.jpg', impasto: A + '47a5e2c5a89af42c.jpg' }
const img = (k, pos = 'center') => `<img src="${IMG[k]}" alt="" style="object-position:${pos}">`
const av = (t, c = '') => `<span class="av ${c}">${t}</span>`
const ig = (t) => `<span class="plat">${ic('instagram')}${t ?? ''}</span>`
const fb = (t) => `<span class="plat">${ic('facebook')}${t ?? ''}</span>`

const NAV = [
  ['oggi', 'Oggi', 'sun', '<span class="count">3</span>'],
  ['calendario', 'Calendario', 'calendar-days', '<span class="soon">Presto</span>'],
  ['clienti', 'Clienti', 'briefcase-business', ''],
  ['libreria', 'Libreria', 'images', ''],
]
const NAV2 = [['utenti', 'Utenti', 'users'], ['impostazioni', 'Impostazioni', 'settings']]
const section = { cliente: 'clienti', panoramica: 'clienti', contenuti: 'clienti', post: 'clienti', 'nuovo-cliente': 'clienti', selettore: 'oggi', 'oggi-tranquillo': 'oggi', notifiche: 'oggi', tu: 'oggi', invita: 'utenti', file: 'libreria', integrazioni: 'impostazioni', sicurezza: 'impostazioni', registro: 'impostazioni' }[P] || P

const shell = (body, { ctx = 'Tutti i clienti', ctxAv = av('SR', 'dark sm'), toast = '' } = {}) => `
<div class="app">
  <aside class="side">
    <div class="side-top">
      <img class="logo-light" src="../../assets/feedway-horizontal-carbone.svg" alt="Feedway">
      <img class="logo-dark" src="../../assets/feedway-horizontal-bianco.svg" alt="Feedway">
      <button class="btn ghost icon sm" aria-label="Notifiche">${ic('bell')}</button>
    </div>
    <button class="switcher">${ctxAv}<span class="lbl">${ctx}</span>${ic('chevrons-up-down')}</button>
    <button class="btn primary block">${ic('plus')}Nuovo post</button>
    <nav class="nav">
      ${NAV.map(([k, l, i, x]) => `<a href="?p=${k}" ${section === k ? 'aria-current="page"' : ''}>${ic(i)}${l}${section === 'calendario' && k === 'calendario' ? '' : x}</a>`).join('')}
      <div class="nav-h">Studio Riva</div>
      ${NAV2.map(([k, l, i]) => `<a href="?p=${k}" ${section === k ? 'aria-current="page"' : ''}>${ic(i)}${l}</a>`).join('')}
    </nav>
    <div class="side-user">${av('GF', 'person')}<div class="who"><b>Giulia Ferri</b><span>Owner</span></div></div>
  </aside>
  <div class="main">
    <div class="m-top">
      <button class="ctx">${ctxAv}<span class="trunc">${ctx}</span>${ic('chevron-down')}</button>
      <span class="sp"></span>
      <button class="bell" aria-label="Notifiche, 3 nuove">${ic('bell')}<i></i></button>
    </div>
    <main class="page">${body}</main>
  </div>
  <nav class="m-nav">
    <a href="?p=oggi" ${section === 'oggi' ? 'aria-current="page"' : ''}>${ic('sun')}Oggi</a>
    <a href="?p=calendario">${ic('calendar-days')}Calendario</a>
    <a class="plus" href="?p=editor" aria-label="Nuovo post"><span>${ic('plus')}</span></a>
    <a href="?p=clienti" ${section === 'clienti' ? 'aria-current="page"' : ''}>${ic('briefcase-business')}Clienti</a>
    <a href="?p=impostazioni" ${['utenti', 'impostazioni', 'libreria'].includes(section) ? 'aria-current="page"' : ''}>${av('GF', 'person sm')}Tu</a>
  </nav>
  ${toast}
</div>`

/* ------------------------------------------------------------------ Oggi */
const post = (time, th, text, client, plats, status) => `
  <div class="tr">
    <span class="time">${time}</span>
    <span class="thumb">${th}</span>
    <span class="two"><a class="trunc" href="?p=editor" style="font-weight:500">${text}</a><span class="sub-sm muted small"><span class="subline"><span class="trunc">${client}</span>${status}</span></span></span>
    <span class="muted trunc hide-sm">${client}</span>
    <span class="plat hide-sm">${plats}</span>
    <span class="hide-sm">${status}</span>
  </div>`
const I = ic('instagram'), F = ic('facebook')

const oggi = () => shell(`
  <header class="page-h"><h1>Oggi</h1><span class="aside">giovedì 19 novembre</span></header>

  <section>
    <div class="sec-h"><h2>Da sistemare <span class="n">3</span></h2></div>
    <div class="card tbl todo">
      <div class="tr">${ic('circle-x', 'lead bad-i')}
        <span class="two"><b style="font-weight:500">Reel delle 9:30 non uscito su Facebook</b><span class="muted small">Osteria Bruna · il video supera i 90 secondi</span></span>
        <a class="btn sm" href="#">Apri il post</a></div>
      <div class="tr">${ic('unplug', 'lead warn-i')}
        <span class="two"><b style="font-weight:500">Forno Luce Bistrot da ricollegare</b><span class="muted small">Forno Luce · 2 post in programma su questa Pagina Facebook</span></span>
        <a class="btn sm" href="#">Ricollega</a></div>
      <div class="tr">${ic('alert-triangle', 'lead warn-i')}
        <span class="two"><b style="font-weight:500">IMG_0233.mov non caricato</b><span class="muted small">Gelateria Polo · ieri alle 18:42</span></span>
        <a class="btn sm" href="#">Riprova</a></div>
    </div>
  </section>

  <div class="oggi-grid">
    <section>
      <div class="sec-h"><h2>In uscita</h2><span class="sp"></span><a class="link small" href="#">Apri il calendario</a></div>
      <div class="card">
        <div class="week">
          <div class="past"><div class="d">lun</div><div class="num">16 <span>4 post</span></div><div class="bars"><i class="done"></i><i class="done"></i><i class="done"></i><i class="done"></i></div></div>
          <div class="past"><div class="d">mar</div><div class="num">17 <span>2 post</span></div><div class="bars"><i class="done"></i><i class="done"></i></div></div>
          <div class="past"><div class="d">mer</div><div class="num">18 <span>3 post</span></div><div class="bars"><i class="done"></i><i class="done"></i><i class="done"></i></div></div>
          <div class="today"><div class="d">oggi</div><div class="num">19 <span>4 post</span></div><div class="bars"><i class="bad"></i><i class="done"></i><i></i><i></i></div></div>
          <div><div class="d">ven</div><div class="num">20 <span>3 post</span></div><div class="bars"><i></i><i></i><i></i></div></div>
          <div><div class="d">sab</div><div class="num">21 <span>1 post</span></div><div class="bars"><i></i></div></div>
          <div><div class="d">dom</div><div class="num">22 <span class="muted">libero</span></div><div class="bars"></div></div>
        </div>
        <div class="tbl sched">
          <div class="day-h">Oggi</div>
          ${post('9:30', img('banco', '50% 70%'), 'Il pranzo del giovedì: tagliatelle al ragù bianco', 'Osteria Bruna', I + F, '<span class="dot bad">1 non uscito</span>')}
          ${post('12:00', img('pane'), 'Il pane del lunedì è appena uscito dal forno', 'Forno Luce', I + F, '<span class="dot ok">Pubblicato</span>')}
          ${post('18:00', img('impasto'), 'Dietro il banco: come nasce la sfoglia', 'Forno Luce', I, '<span class="dot info">Programmato</span>')}
          ${post('19:30', img('banco', '50% 20%'), 'Nuovi gusti d’autunno: castagna e cachi', 'Gelateria Polo', I + F, '<span class="dot info">Programmato</span>')}
          <div class="day-h">Domani, venerdì 20</div>
          ${post('8:00', img('pane', '50% 30%'), 'Le brioche di Natale si prenotano da oggi', 'Forno Luce', I + F, '<span class="dot info">Programmato</span>')}
          ${post('13:00', img('banco', '30% 60%'), 'Menu del fine settimana', 'Osteria Bruna', F, '<span class="dot info">Programmato</span>')}
          ${post('18:00', ic('clapperboard'), 'Apertura straordinaria dell’8 dicembre', 'Ottica Venti', I, '<span class="dot info">Programmato</span>')}
        </div>
      </div>
    </section>

    <div class="side-col">
      <section>
        <div class="sec-h"><h2>Bozze da finire <span class="n">4</span></h2><span class="sp"></span><a class="link small" href="#">Tutte</a></div>
        <div class="card tbl side-list">
          <div class="tr"><span class="name"><span class="thumb">${img('impasto', '80% 50%')}</span><span class="two"><a class="trunc" style="font-weight:500" href="#">Focaccia: la ricetta della nonna</a><span class="muted small trunc">Forno Luce · manca il testo</span></span></span><span class="muted small">ieri</span></div>
          <div class="tr"><span class="name"><span class="thumb">${ic('image')}</span><span class="two"><a class="trunc" style="font-weight:500" href="#">Saldi di gennaio</a><span class="muted small trunc">Ottica Venti · mancano i file</span></span></span><span class="muted small">lun</span></div>
          <div class="tr"><span class="name"><span class="thumb">${img('banco', '60% 80%')}</span><span class="two"><a class="trunc" style="font-weight:500" href="#">Serata jazz del 28</a><span class="muted small trunc">Osteria Bruna · pronta da programmare</span></span></span><span class="muted small">12 nov</span></div>
        </div>
      </section>
      <section>
        <div class="sec-h"><h2>Clienti recenti</h2><span class="sp"></span><a class="link small" href="?p=clienti">Tutti</a></div>
        <div class="card tbl side-list">
          <div class="tr"><span class="name">${av('FL')}<a href="?p=cliente" style="font-weight:500">Forno Luce</a></span><span class="muted small">3 in programma</span></div>
          <div class="tr"><span class="name">${av('OB')}<a href="#" style="font-weight:500">Osteria Bruna</a></span><span class="muted small">2 in programma</span></div>
          <div class="tr"><span class="name">${av('GP')}<a href="#" style="font-weight:500">Gelateria Polo</a></span><span class="muted small">1 in programma</span></div>
          <div class="tr"><span class="name">${av('OV')}<a href="#" style="font-weight:500">Ottica Venti</a></span><span class="muted small">1 in programma</span></div>
        </div>
      </section>
    </div>
  </div>`)

/* --------------------------------------------------------------- Clienti */
const cl = (i, n, profs, next, n2, st) => `
  <div class="tr">
    <span class="name">${av(i)}<span class="two"><a href="?p=cliente"><b>${n}</b></a><span class="sub-sm muted small trunc">${next === '—' ? 'Nessun post in programma' : 'Prossimo: ' + next}</span></span></span>
    <span class="hide-sm row-gap" style="gap:14px">${profs}</span>
    <span class="hide-sm ${next === '—' ? 'muted' : ''}">${next}</span>
    <span class="hide-sm muted">${n2}</span>
    <span>${st}</span>
    <a class="more hide-sm" href="#" aria-label="Azioni per ${n}">${ic('ellipsis')}</a>
  </div>`

const clienti = () => shell(`
  <header class="page-h"><h1>Clienti</h1><span class="sp"></span><button class="btn only-sm">${ic('plus')}Nuovo cliente</button></header>
  <div class="tools">
    <div class="seg"><button aria-pressed="true">Attivi <span class="n">5</span></button><button>Archiviati <span class="n">1</span></button></div>
    <div class="field search">${ic('search')}<span class="ph">Cerca un cliente o un profilo</span></div>
    <span class="sp hide-sm"></span>
    <button class="btn hide-sm">${ic('plus')}Nuovo cliente</button>
  </div>
  <div class="card tbl" style="--cols: minmax(220px, 1.4fr) minmax(240px, 1.6fr) 150px 110px 150px 30px">
    <div class="tr th hide-sm"><span>Cliente</span><span>Profili</span><span>Prossimo post</span><span>In programma</span><span>Collegamento</span><span></span></div>
    ${cl('FL', 'Forno Luce', ig('@fornoluce') + fb('Forno Luce') + '<span class="muted">+1</span>', 'oggi, 18:00', '3 post', '<span class="dot warn">Da ricollegare</span>')}
    ${cl('OB', 'Osteria Bruna', ig('@osteriabruna') + fb('Osteria Bruna'), 'domani, 13:00', '2 post', '<span class="dot bad">1 post non uscito</span>')}
    ${cl('GP', 'Gelateria Polo', ig('@gelateriapolo') + fb('Gelateria Polo'), 'oggi, 19:30', '1 post', '')}
    ${cl('OV', 'Ottica Venti', ig('@otticaventi'), 'domani, 18:00', '1 post', '')}
    ${cl('PA', 'Palestra Arco', ig('@palestra.arco') + fb('Palestra Arco'), '—', '—', '')}
  </div>
  <p class="muted small" style="margin-top:12px">2 profili trovati su Meta non sono ancora in un cliente. <a class="link" href="#">Sistemali</a></p>`)

/* ------------------------------------------------------- Cliente · Post */
const clientHead = (tab) => `
  <header class="client-h">
    ${av('FL', 'lg')}
    <div><h1>Forno Luce</h1></div>
    <div class="handles hide-sm">${ig('@fornoluce')}${fb('Forno Luce')}${fb('Forno Luce Bistrot')}</div>
  </header>
  <nav class="tabs">${['Panoramica', 'Post', 'Libreria', 'Persone', 'Contenuti'].map((t) => `<a href="#" ${t === tab ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`

const pr = (th, text, type, when, plats, st, who) => `
  <div class="tr">
    <span class="name"><span class="thumb">${th}</span><span class="two"><a class="trunc" href="?p=editor" style="font-weight:500">${text}</a><span class="muted small trunc"><span class="hide-sm">${type}</span><span class="only-sm">${when}</span></span></span></span>
    <span class="hide-sm">${when}</span>
    <span class="plat hide-sm">${plats}</span>
    <span>${st}</span>
    <span class="muted hide-sm">${who}</span>
    <a class="more hide-sm" href="#" aria-label="Azioni">${ic('ellipsis')}</a>
  </div>`

const cliente = () => shell(`
  ${clientHead('Post')}
  <div class="tools">
    <div class="seg"><button aria-pressed="true">Tutti <span class="n">9</span></button><button>Bozze <span class="n">2</span></button><button>Programmati <span class="n">3</span></button><button>Pubblicati <span class="n">4</span></button></div>
    <div class="field search">${ic('search')}<span class="ph">Cerca nel testo</span></div>
  </div>
  <div class="card tbl" style="--cols: minmax(0, 1fr) 150px 60px 140px 110px 30px">
    <div class="tr th hide-sm"><span>Post</span><span>Quando</span><span>Profili</span><span>Stato</span><span>Autore</span><span></span></div>
    ${pr(img('pane', '50% 30%'), 'Le brioche di Natale si prenotano da oggi', 'Carosello · 3 file', 'ven 20 nov, 8:00', I + F, '<span class="dot info">Programmato</span>', 'Tu')}
    ${pr(img('impasto'), 'Dietro il banco: come nasce la sfoglia', 'Reel · 0:42', 'oggi, 18:00', I, '<span class="dot info">Programmato</span>', 'Marco B.')}
    ${pr(img('banco', '50% 80%'), 'Sabato siamo aperti fino alle 20', 'Foto', 'sab 21 nov, 9:00', I + F, '<span class="dot info">Programmato</span>', 'Tu')}
    ${pr(img('impasto', '80% 50%'), 'Focaccia: la ricetta della nonna', 'Carosello · 2 file', 'Senza data', I + F, '<span class="dot draft">Bozza</span>', 'Tu')}
    ${pr(ic('image'), 'Auguri di buone feste', 'Senza file', 'Senza data', I, '<span class="dot draft">Bozza</span>', 'Sara L.')}
    ${pr(img('pane'), 'Il pane del lunedì è appena uscito dal forno', 'Carosello · 2 file', 'oggi, 12:00', I + F, '<span class="dot ok">Pubblicato</span>', 'Tu')}
    ${pr(img('banco', '40% 30%'), 'Grazie per i 5.000 follower', 'Foto', 'mer 18 nov, 18:00', I + F, '<span class="dot ok">Pubblicato</span>', 'Marco B.')}
    ${pr(img('pane', '50% 70%'), 'Pane di segale, solo il mercoledì', 'Foto', 'mar 17 nov, 7:30', I, '<span class="dot ok">Pubblicato</span>', 'Tu')}
  </div>`, {
  ctx: 'Forno Luce', ctxAv: av('FL', 'sm'),
  toast: `<div class="toast ${q.get('stato') === 'programmato' ? 'show' : ''}" role="status"><span class="t">${ic('circle-check')}Programmato per ven 20 nov alle 8:00</span><a href="?p=editor">Apri</a></div>`,
})

/* -------------------------------------------------------------- Libreria */
const tile = (th, name, meta, use, extra = '') => `
  <figure class="tile"><div class="ph">${th}${extra}</div>
    <figcaption><b class="trunc">${name}</b><span class="muted xs trunc">${meta}</span>${use ? `<span class="xs use trunc">${use}</span>` : ''}</figcaption></figure>`
const dur = (t) => `<span class="dur">${ic('clapperboard')}${t}</span>`

const libreria = () => shell(`
  <header class="page-h"><h1>Libreria</h1><span class="sp"></span><button class="btn only-sm">${ic('upload')}Carica</button></header>
  <div class="tools">
    <div class="seg"><button aria-pressed="true">Tutti <span class="n">48</span></button><button>Foto <span class="n">39</span></button><button>Video <span class="n">9</span></button></div>
    <button class="btn hide-sm">Tutti i clienti ${ic('chevron-down')}</button>
    <button class="btn hide-sm">Nei post: tutti ${ic('chevron-down')}</button>
    <div class="field search">${ic('search')}<span class="ph">Cerca per nome o tag</span></div>
    <span class="sp hide-sm"></span>
    <div class="seg hide-sm"><button aria-pressed="true" aria-label="Griglia">${ic('layout-grid')}</button><button aria-label="Elenco">${ic('layout-list')}</button></div>
    <button class="btn hide-sm">${ic('upload')}Carica</button>
  </div>
  <div class="lib-day muted xs">Oggi</div>
  <div class="grid">
    ${tile(img('pane'), 'pane-lunedi-01.jpg', 'Forno Luce · 2,4 MB', 'Nel post di oggi, 12:00')}
    ${tile(img('pane', '50% 20%'), 'pane-lunedi-02.jpg', 'Forno Luce · 2,1 MB', 'Nel post di oggi, 12:00')}
    ${tile(img('impasto'), 'sfoglia-dietro-il-banco.mov', 'Forno Luce · 38,8 MB', 'Nel post di oggi, 18:00', dur('0:42'))}
    ${tile(img('banco', '50% 20%'), 'gusti-autunno.heic', 'Gelateria Polo · 1,2 MB', 'Nel post di oggi, 19:30')}
    ${tile(img('banco', '50% 75%'), 'banco-brioche.jpg', 'Gelateria Polo · 3,0 MB', '')}
    ${tile(img('impasto', '85% 50%'), 'impasto-mani.jpg', 'Forno Luce · 1,8 MB', 'In una bozza')}
  </div>
  <div class="lib-day muted xs">Questa settimana</div>
  <div class="grid">
    ${tile(img('banco', '30% 55%'), 'sala-venerdi.jpg', 'Osteria Bruna · 2,7 MB', 'Nel post del 20/11')}
    ${tile(img('pane', '50% 75%'), 'segale-mercoledi.jpg', 'Forno Luce · 2,2 MB', 'Pubblicato il 17/11')}
    ${tile(img('impasto', '20% 40%'), 'cucina-preparazione.mov', 'Osteria Bruna · 61,4 MB', '', dur('1:48'))}
    ${tile(img('banco', '70% 35%'), 'insegna-gelato.jpg', 'Gelateria Polo · 1,1 MB', '')}
    ${tile(img('pane', '30% 50%'), 'pagnotta-tagliata.jpg', 'Forno Luce · 2,0 MB', '')}
    ${tile(img('banco', '50% 95%'), 'bancone-dettaglio.jpg', 'Osteria Bruna · 1,6 MB', 'In una bozza')}
  </div>`)

/* ---------------------------------------------------------------- Utenti */
const us = (i, n, e, role, cli, last, st = '') => `
  <div class="tr">
    <span class="name">${av(i, 'person')}<span class="two"><b>${n}</b><span class="muted small trunc">${e}</span></span></span>
    <span><span class="hide-sm">${role}</span><span class="sub-sm muted small">${role}</span></span>
    <span class="hide-sm ${cli.startsWith('Tutti') ? 'muted' : ''}">${cli}</span>
    <span class="hide-sm muted">${last}</span>
    <span class="hide-sm">${st}</span>
    <a class="more hide-sm" href="#" aria-label="Azioni per ${n}">${ic('ellipsis')}</a>
  </div>`

const utenti = () => shell(`
  <header class="page-h"><h1>Utenti</h1><span class="sp"></span><button class="btn only-sm">${ic('user-plus')}Invita</button></header>
  <div class="tools">
    <div class="seg"><button aria-pressed="true">Attivi <span class="n">5</span></button><button>Inviti <span class="n">1</span></button><button>Sospesi <span class="n">0</span></button></div>
    <div class="field search">${ic('search')}<span class="ph">Cerca per nome o email</span></div>
    <span class="sp hide-sm"></span>
    <button class="btn hide-sm">${ic('user-plus')}Invita</button>
  </div>
  <div class="card tbl" style="--cols: minmax(240px, 1.6fr) 120px minmax(160px, 1fr) 140px 150px 30px">
    <div class="tr th hide-sm"><span>Persona</span><span>Ruolo</span><span>Clienti</span><span>Ultimo accesso</span><span></span><span></span></div>
    ${us('GF', 'Giulia Ferri', 'giulia@studioriva.example', 'Owner', 'Tutti', 'adesso', '<span class="muted">Sei tu</span>')}
    ${us('MB', 'Marco Bassi', 'marco@studioriva.example', 'Admin', 'Tutti', 'oggi, 9:12')}
    ${us('SL', 'Sara Leoni', 'sara@studioriva.example', 'Editor', 'Forno Luce, Gelateria Polo', 'ieri, 17:40')}
    ${us('DC', 'Davide Conti', 'davide@studioriva.example', 'Editor', 'Osteria Bruna', 'lun 16 nov')}
    ${us('EN', 'Elena Neri', 'elena@otticaventi.example', 'Viewer', 'Ottica Venti', '3 nov', '<span class="dot warn">Senza secondo fattore</span>')}
  </div>`)

/* ---------------------------------------------------------- Impostazioni */
const impostazioni = () => shell(`
  <header class="page-h"><h1>Impostazioni</h1></header>
  <div class="set">
    <nav class="set-nav">
      <div class="nav-h">Il tuo account</div>
      <a href="#" aria-current="page">${ic('user')}Profilo e preferenze</a>
      <a href="#">${ic('shield')}Sicurezza</a>
      <a href="#">${ic('monitor-smartphone')}Dispositivi</a>
      <a href="#">${ic('lock')}Privacy</a>
      <div class="nav-h">Studio Riva</div>
      <a href="#">${ic('building')}Generali</a>
      <a href="#">${ic('plug')}Integrazioni</a>
      <a href="#">${ic('scroll-text')}Registro attività</a>
    </nav>
    <div>
      <div class="field only-sm" style="margin-bottom:20px">${ic('user')}Profilo e preferenze<span class="sp"></span>${ic('chevron-down')}</div>
      <section class="set-sec">
        <h2>Profilo</h2>
        <div class="card">
          <div class="set-row inline"><span class="k">Foto</span><span class="v">${av('GF', 'person lg')}<button class="btn sm">Cambia</button></span></div>
          <div class="set-row"><span class="k">Nome</span><span class="v"><span class="field">Giulia Ferri</span></span></div>
          <div class="set-row"><span class="k">Soprannome</span><span class="v"><span class="field">Giulia</span></span></div>
          <div class="set-row"><span class="k">Email</span><span class="v"><span class="field">giulia@studioriva.example</span><button class="btn sm ghost">Cambia email</button></span></div>
        </div>
      </section>
      <section class="set-sec">
        <h2>Preferenze</h2>
        <div class="card">
          <div class="set-row"><span class="k">Tema</span><span class="v"><div class="seg"><button aria-pressed="true">${ic('sun-medium')}Chiaro</button><button>${ic('moon')}Scuro</button><button>Automatico</button></div></span></div>
          <div class="set-row"><span class="k">Colori</span><span class="v"><div class="pal">
            ${[['Feedway', '#FF762E', true], ['Blu', '#7FB2F5'], ['Verde', '#7FCFA0'], ['Viola', '#B9A2F2'], ['Grafite', '#242321']].map(([n, c, on]) => `<button aria-pressed="${!!on}"><i class="a" style="background:${c}"></i><i class="b"></i><span>${n}</span></button>`).join('')}
          </div></span></div>
          <div class="set-row"><span class="k">Fuso orario</span><span class="v"><span class="field">Europe/Rome<span class="sp"></span>${ic('chevron-down')}</span></span></div>
          <div class="set-row inline"><span class="k">Email quando un post non esce</span><span class="v"><span class="switch on"></span></span></div>
        </div>
      </section>
    </div>
  </div>`)

/* ---------------------------------------------------------------- Editor */
const editor = () => `
<div class="ed-bar">
  <a class="btn ghost icon" href="?p=cliente" aria-label="Torna ai post di Forno Luce">${ic('arrow-left')}</a>
  <span class="row-gap hide-sm">${av('FL', 'sm')}<span class="muted">Forno Luce</span></span>
  <span class="sep hide-sm"></span>
  <span class="title">Nuovo post</span>
  <span class="saved hide-sm" style="margin-left:8px">${ic('cloud-check')}Bozza salvata alle 11:53</span>
  <span class="sp"></span>
  <button class="btn ghost only-sm">${ic('eye')}Anteprima</button>
  <button class="btn hide-sm">Salva ed esci</button>
  <button class="btn primary hide-sm">${ic('calendar-check')}Programma su 2 account</button>
</div>
<div class="ed">
  <div>
    <div class="fs"><div class="l">Tipo</div><div>
      <div class="seg wide">
        <button disabled>${ic('image')}Foto</button>
        <button aria-pressed="true">${ic('gallery-horizontal-end')}Carosello</button>
        <button disabled>${ic('clapperboard')}Reel</button>
        <button disabled>${ic('circle-dashed')}Storia</button>
      </div>
      <div class="hint">${ic('info')}Con 2 file si può fare solo un carosello.</div>
    </div></div>

    <div class="fs"><div class="l">File <small>2 di 10</small></div><div>
      <div class="files">
        <div class="file"><div class="ph">${img('pane')}<span class="num">1</span><span class="grip">${ic('grip-vertical')}</span></div><div class="nm trunc">pane-lunedi-01.jpg</div></div>
        <div class="file"><div class="ph">${img('pane', '50% 20%')}<span class="num">2</span><span class="grip">${ic('grip-vertical')}</span></div><div class="nm trunc">pane-lunedi-02.jpg</div></div>
        <div class="file add"><div class="ph">${ic('plus')}Aggiungi</div></div>
      </div>
      <div class="row-gap hide-sm" style="margin-top:10px"><button class="btn sm">${ic('upload')}Carica</button><button class="btn sm">${ic('images')}Dalla libreria</button><span class="muted small">oppure trascina qui</span></div>
    </div></div>

    <div class="fs"><div class="l">Testo</div><div>
      <div class="txt">
        <div class="body">Il pane del lunedì è appena uscito dal forno.<br>Vi aspettiamo in via Roma 12, dalle 7.</div>
        <div class="foot">
          <button class="btn ghost sm">${ic('text-cursor-input')}Inserisci</button>
          <span class="sp"></span>
          <span class="cnt">${ic('instagram')}85 / 2.200</span><span class="cnt hide-sm">${ic('hash')}0 / 30</span><span class="cnt">${ic('facebook')}85</span>
        </div>
      </div>
      <label class="row-gap" style="margin-top:12px"><span class="switch"></span>Testo diverso per Instagram e Facebook</label>
    </div></div>

    <div class="fs"><div class="l">Dove <small>2 di 3</small></div><div>
      <div class="acc">
        <div class="r"><span class="check on">${ic('check')}</span>${ic('instagram', 'pl')}<b style="font-weight:500">@fornoluce</b><span class="sp"></span><span class="muted small">Instagram</span></div>
        <div class="r"><span class="check on">${ic('check')}</span>${ic('facebook', 'pl')}<b style="font-weight:500">Forno Luce</b><span class="sp"></span><span class="muted small">Pagina Facebook</span></div>
        <div class="r off"><span class="check"></span>${ic('facebook', 'pl')}<span>Forno Luce Bistrot</span><span class="sp"></span><span class="dot warn">Da ricollegare</span></div>
      </div>
    </div></div>

    <div class="fs"><div class="l">Quando</div><div class="stack">
      <div><div class="seg"><button aria-pressed="true">${ic('calendar-days')}Programma</button><button>${ic('send')}Pubblica subito</button></div></div>
      <div class="when">
        <span class="field" style="width:220px">${ic('calendar')}venerdì 20 novembre<span class="sp"></span>${ic('chevron-down')}</span>
        <span class="field" style="width:112px">${ic('clock')}18:00<span class="sp"></span>${ic('chevron-down')}</span>
        <span class="muted small hide-sm">Orario abituale di Forno Luce</span>
      </div>
    </div></div>

    <div class="fs"><div class="l">Etichette</div><div class="row-gap">
      <span class="chip"><i style="background:#d98a00"></i>Prodotto</span><span class="chip"><i style="background:#1f5aa6"></i>Natale</span>
      <button class="btn ghost sm">${ic('plus')}Etichetta</button>
    </div></div>

    <div class="fs"><div class="l">Note interne</div><div>
      <span class="field" style="max-width:none"><span class="ph">Scrivi una nota per il team</span></span>
    </div></div>

    <div class="fs sub-sm"><div class="l">Controlli</div><div>
      <div class="card tbl checks">
        <div class="tr">${ic('instagram')}<span class="two"><b style="font-weight:500">@fornoluce</b><span class="muted small">Carosello, 2 foto</span></span><span class="dot ok">Pronto</span></div>
        <div class="tr">${ic('facebook')}<span class="two"><b style="font-weight:500">Forno Luce</b><span class="muted small">Post con 2 foto</span></span><span class="dot ok">Pronto</span></div>
      </div>
    </div></div>
  </div>

  <aside class="pv">
    <div class="pv-tools"><h2>Anteprima</h2><span class="sp"></span>
      <div class="seg"><button aria-pressed="true">${ic('instagram')}Feed</button><button>${ic('layout-grid')}Griglia</button><button>${ic('facebook')}Facebook</button></div></div>
    <div class="ig">
      <div class="ig-h"><span class="a">${img('pane', '50% 40%')}</span>fornoluce${ic('ellipsis')}</div>
      <div class="ig-m">${img('pane')}<span class="pg">1/2</span></div>
      <div class="ig-a">${ic('heart')}${ic('message-circle')}${ic('send')}<span class="dots"><i></i><i></i></span>${ic('bookmark')}</div>
      <div class="ig-c"><b>fornoluce</b> Il pane del lunedì è appena uscito dal forno. Vi aspettiamo in via Roma 12, dalle 7.</div>
    </div>
    <div class="checks">
      <div class="sec-h"><h2>Controlli</h2><span class="sp"></span><span class="dot ok small">Tutto pronto</span></div>
      <div class="card tbl">
        <div class="tr">${ic('instagram')}<span class="two"><b style="font-weight:500">@fornoluce</b><span class="muted small">Carosello, 2 foto</span></span><span class="dot ok">Pronto</span></div>
        <div class="tr">${ic('facebook')}<span class="two"><b style="font-weight:500">Forno Luce</b><span class="muted small">Post con 2 foto</span></span><span class="dot ok">Pronto</span></div>
      </div>
      <p class="muted small" style="margin-top:10px">4 correzioni fatte da Feedway. <a class="link" href="#">Dettagli</a></p>
    </div>
  </aside>
</div>
<div class="m-act">
  <span class="saved">${ic('cloud-check')}<span>Bozza salvata<small>alle 11:53</small></span></span>
  <button class="btn primary">${ic('calendar-check')}Programma su 2 account</button>
</div>`

/* --------------------------------------------------------------- Sistema */
const sw = (v, n, d) => `<div><i style="background:var(--${v})"></i><b>${n}</b><span>${d}</span></div>`
const sistema = () => `<main class="page" style="max-width:1440px;padding:40px 48px 64px">
  <header class="page-h" style="margin-bottom:32px"><img src="../../assets/feedway-horizontal-carbone.svg" alt="Feedway" style="height:30px"><span class="sp"></span><span class="muted">Sistema del pannello · proposta del 19 novembre 2026</span></header>
  <div class="sys">
    <section><h2>Colore: fondi e testo</h2><div class="sw">
      ${sw('bg', 'Pagina', '#FBFAF8')}${sw('surface', 'Superficie', '#FFFFFF')}${sw('sunken', 'Incasso', '#F4F2EE')}${sw('nav', 'Barra', '#F6F4F0')}${sw('border-strong', 'Bordo', '#D5D0C7')}${sw('muted', 'Testo secondario', '#625E58')}${sw('text', 'Carbone', '#242321')}
    </div></section>
    <section><h2>Colore: marchio e stati</h2><div class="sw">
      ${sw('brand', 'Arancio', 'Una sola azione per schermata')}${sw('info', 'Programmato', '#1F5AA6')}${sw('success', 'Pubblicato', '#17693F')}${sw('warning-dot', 'Da sistemare', '#D98A00')}${sw('danger', 'Non uscito', '#B5174B')}${sw('neutral-dot', 'Bozza', '#A39E95')}
    </div></section>

    <section><h2>Caratteri</h2><div class="ty">
      <span>Titolo di pagina<br>Sora 600 · 22/28</span><div style="font:600 22px/28px var(--display);letter-spacing:-0.015em">Clienti</div>
      <span>Titolo di sezione<br>Sistema 600 · 14/20</span><div style="font-weight:600">Da sistemare</div>
      <span>Testo<br>Sistema 400 · 14/20</span><div>Il pane del lunedì è appena uscito dal forno.</div>
      <span>Dettaglio<br>Sistema 400 · 13/18</span><div class="muted small">Forno Luce · 2 post in programma su questa Pagina Facebook</div>
      <span>Intestazione di colonna<br>Sistema 500 · 12/16</span><div class="muted xs" style="font-weight:500">Prossimo post</div>
      <span>Numeri e orari<br>cifre allineate</span><div>9:30 &nbsp; 12:00 &nbsp; 18:00 &nbsp; 85 / 2.200</div>
    </div></section>
    <section><h2>Pulsanti e campi · 36 px al computer, 44 px al telefono</h2>
      <div class="demo" style="margin-bottom:14px"><button class="btn primary">${ic('calendar-check')}Programma su 2 account</button><button class="btn">${ic('plus')}Nuovo cliente</button><button class="btn ghost">Annulla</button><button class="btn ghost danger-text">Annulla programmazione</button><button class="btn icon" aria-label="Altro">${ic('ellipsis')}</button></div>
      <div class="demo" style="margin-bottom:14px"><div class="field search">${ic('search')}<span class="ph">Cerca un cliente o un profilo</span></div><span class="field" style="width:200px">${ic('calendar')}venerdì 20 novembre</span><span class="field" style="width:104px">${ic('clock')}18:00</span></div>
      <div class="demo"><div class="seg"><button aria-pressed="true">Tutti <span class="n">9</span></button><button>Bozze <span class="n">2</span></button><button>Programmati <span class="n">3</span></button></div><span class="check on">${ic('check')}</span><span class="check"></span><span class="switch on"></span><span class="switch"></span><span class="chip"><i style="background:#d98a00"></i>Prodotto</span></div>
    </section>

    <section><h2>Stati: un pallino e una parola</h2>
      <div class="demo" style="gap:24px"><span class="dot draft">Bozza</span><span class="dot info">Programmato</span><span class="dot ok">Pubblicato</span><span class="dot warn">Da ricollegare</span><span class="dot bad">1 non uscito</span></div>
      <p class="muted small" style="margin-top:12px;max-width:60ch">Il colore pieno va solo dove c’è da agire. Quando è tutto a posto la colonna resta vuota.</p>
    </section>
    <section><h2>Identità: i clienti sono quadrati, le persone sono tonde</h2>
      <div class="demo" style="gap:20px"><span class="row-gap">${av('FL')}<b style="font-weight:600">Forno Luce</b></span><span class="row-gap">${av('GF', 'person')}<b style="font-weight:600">Giulia Ferri</b></span><span class="row-gap">${av('SR', 'dark')}<b style="font-weight:600">Studio Riva</b></span>${ig('@fornoluce')}${fb('Forno Luce')}</div>
      <p class="muted small" style="margin-top:12px;max-width:60ch">Niente più cerchi color pastello: grigio caldo con le iniziali, oppure il logo vero del cliente.</p>
    </section>

    <section class="full"><h2>Riga di elenco · 52 px al computer, 60 px al telefono</h2>
      <div class="card tbl" style="--cols: minmax(0, 1fr) 150px 60px 140px 110px 30px">
        <div class="tr th"><span>Post</span><span>Quando</span><span>Profili</span><span>Stato</span><span>Autore</span><span></span></div>
        ${pr(img('pane', '50% 30%'), 'Le brioche di Natale si prenotano da oggi', 'Carosello · 3 file', 'ven 20 nov, 8:00', I + F, '<span class="dot info">Programmato</span>', 'Tu')}
        ${pr(img('impasto', '80% 50%'), 'Focaccia: la ricetta della nonna', 'Carosello · 2 file', 'Senza data', I + F, '<span class="dot draft">Bozza</span>', 'Tu')}
      </div>
    </section>

    <section class="full"><h2>Regole</h2><div class="rule">
      <p><b>Un solo arancio per schermata.</b> È l’azione che fa avanzare il lavoro: «Nuovo post» nel pannello, «Programma» nell’editor.</p>
      <p><b>Nessun sottotitolo sotto i titoli.</b> Una frase compare solo quando dice cosa fare, accanto al punto in cui serve.</p>
      <p><b>Sora solo nei titoli di pagina.</b> Tutto il resto è il carattere di sistema, a 14 px.</p>
      <p><b>Una superficie per elenco.</b> Righe con un filetto, nessuna scatola dentro una scatola, ombre solo su ciò che sta sopra.</p>
      <p><b>Spunte, interruttori e voce attiva in carbone.</b> L’arancio non segna più le selezioni.</p>
      <p><b>Date e ore all’italiana.</b> «ven 20 nov, 18:00», mai 11/20/2026 o 06:00 PM.</p>
      <p><b>Raggi 8 e 10.</b> Controlli a 8, superfici a 10, miniature a 6.</p>
      <p><b>Spazi 4 · 8 · 12 · 16 · 20 · 28 · 32.</b> Margine di pagina 32 al computer e 16 al telefono; larghezza massima 1200.</p>
    </div></section>
  </div></main>`

const PAGES = { oggi, clienti, cliente, libreria, utenti, impostazioni, editor, sistema }
