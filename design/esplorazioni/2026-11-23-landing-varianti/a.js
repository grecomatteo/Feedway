/* Variant A: one post fans out into its four destinations (three.js),
   driven by the scroll (GSAP ScrollTrigger), then each copy gets its outcome. */
import * as THREE from './vendor/three.module.js';

const canvas = document.getElementById('scene');
const stage = canvas.parentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

function webglOK() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const loadImage = (src) =>
  new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });

const UI = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const S = 2; // texture supersampling

function ctx2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w * S;
  c.height = h * S;
  const g = c.getContext('2d');
  g.scale(S, S);
  return [c, g];
}

function cover(g, img, x, y, w, h) {
  const r = Math.max(w / img.width, h / img.height);
  const sw = w / r;
  const sh = h / r;
  g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function avatar(g, img, x, y, r, ring) {
  g.save();
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.clip();
  cover(g, img, x - r, y - r, r * 2, r * 2);
  g.restore();
  if (ring) {
    g.beginPath();
    g.arc(x, y, r + 3, 0, Math.PI * 2);
    g.strokeStyle = ring;
    g.lineWidth = 3;
    g.stroke();
  }
}

function wrapText(g, text, x, y, maxW, lh, maxLines) {
  const words = text.split(' ');
  let line = '';
  let n = 0;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) {
      g.fillText(n === maxLines - 1 ? line + '…' : line, x, y + n * lh);
      if (++n >= maxLines) return;
      line = w;
    } else line = t;
  }
  g.fillText(line, x, y + n * lh);
}

const CAPTION = 'Il pane del lunedì è appena uscito dal forno. Vi aspettiamo in via Roma 12, dalle 7.';

function feedCard(photo, kind) {
  const W = 520;
  const H = kind === 'fb' ? 720 : 700;
  const [c, g] = ctx2d(W, H);
  g.beginPath();
  g.roundRect(0, 0, W, H, 26);
  g.fillStyle = '#fff';
  g.fill();
  g.clip();
  avatar(g, photo, 44, 42, 20);
  g.fillStyle = '#242321';
  g.font = `600 22px ${UI}`;
  g.fillText(kind === 'fb' ? 'Forno Luce' : 'fornoluce', 76, 50);
  g.fillStyle = '#625e58';
  g.font = `500 18px ${UI}`;
  g.textAlign = 'right';
  g.fillText(kind === 'fb' ? 'Pagina Facebook' : 'Instagram · feed', W - 24, 49);
  g.textAlign = 'left';
  if (kind === 'fb') {
    g.fillStyle = '#242321';
    g.font = `400 19px ${UI}`;
    wrapText(g, CAPTION, 24, 108, W - 48, 27, 2);
    cover(g, photo, 0, 158, W, 562);
  } else {
    cover(g, photo, 0, 84, W, 520);
    g.fillStyle = '#242321';
    g.font = `400 19px ${UI}`;
    wrapText(g, CAPTION, 24, 640, W - 48, 27, 2);
  }
  return { canvas: c, w: W, h: H };
}

function storyCard(photo, kind) {
  const W = 520;
  const H = 900;
  const [c, g] = ctx2d(W, H);
  g.beginPath();
  g.roundRect(0, 0, W, H, 30);
  g.clip();
  cover(g, photo, 0, 0, W, H);
  const shade = g.createLinearGradient(0, 0, 0, 200);
  shade.addColorStop(0, 'rgba(0,0,0,.45)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, 200);
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.fillRect(20, 20, W - 40, 4);
  avatar(g, photo, 48, 66, 20, 'rgba(255,255,255,.9)');
  g.fillStyle = '#fff';
  g.font = `600 21px ${UI}`;
  g.fillText(kind === 'fb' ? 'Forno Luce' : 'fornoluce', 80, 73);
  g.font = `500 17px ${UI}`;
  g.globalAlpha = 0.85;
  g.fillText(kind === 'fb' ? 'Storia di Facebook' : 'Storia di Instagram', 80 + (kind === 'fb' ? 116 : 104), 73);
  g.globalAlpha = 1;
  return { canvas: c, w: W, h: H };
}

function badge(ok) {
  const text = ok ? 'Pubblicato · 12:01' : 'Non uscita · Pagina da ricollegare';
  const W = ok ? 300 : 470;
  const H = 64;
  const [c, g] = ctx2d(W, H);
  g.beginPath();
  g.roundRect(2, 2, W - 4, H - 4, 30);
  g.fillStyle = ok ? '#e3f3ea' : '#fce8ec';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = ok ? 'rgba(23,105,63,.25)' : 'rgba(181,23,75,.25)';
  g.stroke();
  g.beginPath();
  g.arc(30, H / 2, 7, 0, Math.PI * 2);
  g.fillStyle = ok ? '#17693f' : '#b5174b';
  g.fill();
  g.font = `600 22px ${UI}`;
  g.fillText(text, 48, H / 2 + 8);
  return { canvas: c, w: W, h: H };
}

function shadowTexture() {
  const [c, g] = ctx2d(256, 256);
  const grad = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  grad.addColorStop(0, 'rgba(36,35,33,.30)');
  grad.addColorStop(1, 'rgba(36,35,33,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return c;
}

const UNIT = 1 / 400; // texture px to world units

function plane(tex, renderer) {
  const t = new THREE.CanvasTexture(tex.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // transparent planes: three sorts them back to front, so the fan and the
  // stack overlap correctly and the rounded corners stay smooth
  const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(tex.w * UNIT, tex.h * UNIT), m);
}

async function start() {
  if (!webglOK()) {
    document.documentElement.classList.add('no-webgl');
    return;
  }
  const [photo] = await Promise.all([loadImage('img/pane-grande.webp'), document.fonts.ready]);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 9.2);

  const world = new THREE.Group();
  scene.add(world);

  const shadowMap = new THREE.CanvasTexture(shadowTexture());
  const specs = [
    { tex: feedCard(photo, 'ig'), ok: true },
    { tex: storyCard(photo, 'ig'), ok: true },
    { tex: feedCard(photo, 'fb'), ok: true },
    { tex: storyCard(photo, 'fb'), ok: false },
  ];

  // final arc and initial stack, one entry per card
  const END = [
    { x: -2.15, y: 0.18, z: -0.9, ry: 0.34 },
    { x: -0.74, y: 0.02, z: -0.1, ry: 0.11 },
    { x: 0.74, y: 0.1, z: 0, ry: -0.11 },
    { x: 2.15, y: -0.02, z: -0.9, ry: -0.34 },
  ];

  const cards = specs.map((s, i) => {
    const holder = new THREE.Group();
    const card = plane(s.tex, renderer);
    card.renderOrder = 1;
    const sh = new THREE.Mesh(
      new THREE.PlaneGeometry(s.tex.w * UNIT * 1.5, s.tex.h * UNIT * 1.35),
      new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false }),
    );
    sh.position.set(0.06, -0.14, -0.08);
    sh.renderOrder = 0;
    const b = plane(badge(s.ok), renderer);
    b.position.set(0, -(s.tex.h * UNIT) / 2 - 0.2, 0.1);
    b.scale.setScalar(0.001);
    b.renderOrder = 1;
    holder.add(sh, card, b);
    holder.scale.setScalar(1.12);
    world.add(holder);
    return { holder, badge: b, i };
  });

  const ease = gsap.parseEase('power3.inOut');
  const back = gsap.parseEase('back.out(2)');
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const state = { p: reduce ? 1 : 0, px: 0, py: 0 };
  const pointer = { x: 0, y: 0 };
  const steps = [...document.querySelectorAll('.steps li')];

  function layout(time) {
    const p1 = ease(clamp(state.p / 0.55));
    const p2 = clamp((state.p - 0.62) / 0.3);
    cards.forEach(({ holder, badge: b, i }) => {
      const e = END[i];
      const s = { x: i * 0.05, y: -i * 0.05, z: -i * 0.12, ry: 0 };
      const bob = reduce ? 0 : Math.sin(time * 0.0009 + i * 1.3) * 0.03;
      holder.position.set(
        s.x + (e.x - s.x) * p1,
        s.y + (e.y - s.y) * p1 + bob,
        s.z + (e.z - s.z) * p1,
      );
      holder.rotation.set(0, s.ry + (e.ry - s.ry) * p1, (1 - p1) * (i - 1.5) * 0.04);
      // badges pop one after another
      const local = clamp((p2 - i * 0.16) / 0.36);
      b.scale.setScalar(Math.max(0.001, back(local) * 1.45));
    });
    state.px += (pointer.x - state.px) * 0.06;
    state.py += (pointer.y - state.py) * 0.06;
    world.rotation.y = -0.2 * (1 - ease(clamp(state.p / 0.55))) + state.px * 0.12;
    world.rotation.x = state.py * 0.06;
    const active = state.p < 0.2 ? 0 : state.p < 0.62 ? 1 : 2;
    steps.forEach((li, k) => li.classList.toggle('on', reduce || k <= active));
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    // keep the whole arc in view on narrow screens
    camera.position.z = 9.2 * Math.max(1, 1.2 / camera.aspect);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(stage);

  function frame(t) {
    if (visible) {
      layout(t);
      renderer.render(scene, camera);
    }
    if (!reduce) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (!reduce) {
    // entrance: the stack rises into place while the copy is read
    world.position.y = -0.5;
    gsap.to(world.position, { y: 0, duration: 1.4, ease: 'power3.out' });
    cards.forEach(({ holder }, i) =>
      holder.children.forEach((m) => {
        const to = m.material.opacity;
        m.material.opacity = 0;
        gsap.to(m.material, { opacity: to, duration: 0.9, delay: 0.1 + i * 0.06, ease: 'power2.out' });
      }),
    );
    if (matchMedia('(pointer: fine)').matches) {
      addEventListener('pointermove', (e) => {
        pointer.x = e.clientX / innerWidth - 0.5;
        pointer.y = e.clientY / innerHeight - 0.5;
      });
    }
    gsap.matchMedia().add(
      { desk: '(min-width: 861px)', phone: '(max-width: 860px)' },
      (c) => {
        if (c.conditions.desk) {
          // computer: the scroll drives the scene while the hero is pinned
          gsap.to(state, {
            p: 1,
            ease: 'none',
            scrollTrigger: { trigger: '.hero-a', start: 'top 68px', end: '+=170%', pin: true, scrub: 0.8, refreshPriority: 1 },
          });
        } else {
          // phone: no pinning, the scene plays once when it comes into view
          gsap.to(state, {
            p: 1,
            duration: 3.6,
            ease: 'power1.inOut',
            scrollTrigger: { trigger: stage, start: 'top 75%' },
          });
        }
      },
    );
  }
  // triggers created before the pin need their positions recomputed
  if (!reduce) {
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  }
  window.__heroState = state; // used by the screenshot script
}

start();
