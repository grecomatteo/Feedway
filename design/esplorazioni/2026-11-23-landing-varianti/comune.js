/* Motion shared by the three variants. Transforms and opacity only;
   with prefers-reduced-motion everything is shown in its final state. */
gsap.registerPlugin(ScrollTrigger, SplitText);

const header = document.querySelector('.site-header');
ScrollTrigger.create({
  start: 8,
  onToggle: (self) => header.classList.toggle('scrolled', self.isActive),
});

// Header: mark the section in view.
document.querySelectorAll('.site-header nav a[href^="#"]').forEach((a) => {
  const target = document.querySelector(a.getAttribute('href'));
  if (!target) return;
  ScrollTrigger.create({
    trigger: target,
    start: 'top 50%',
    end: 'bottom 50%',
    onToggle: (self) => a.setAttribute('aria-current', self.isActive ? 'true' : 'false'),
  });
});

const mm = gsap.matchMedia();
window.motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

mm.add('(prefers-reduced-motion: no-preference)', () => {
  // Problem: the loose tools are pulled into the one panel while scrolling.
  const hub = document.querySelector('.converge .hub');
  if (hub) {
    const pull = gsap.timeline({
      scrollTrigger: { trigger: '.converge', start: 'top 65%', end: 'center 35%', scrub: 0.8 },
    });
    pull.from(hub, { scale: 0.94, duration: 0.4, ease: 'power2.out' }, 0);
    gsap.utils.toArray('.converge .tool').forEach((t, i) => {
      pull.to(t, { '--x': '0%', '--y': '0%', '--r': '0deg', opacity: 0, duration: 0.6, ease: 'power2.in' }, 0.25 + i * 0.05);
    });
    pull.from('.hub li', { opacity: 0, x: -8, stagger: 0.08, duration: 0.2 }, 0.75);
  }

  // Client: the approval notice arrives once the phone is in view.
  if (document.querySelector('.notice')) {
    gsap.from('.notice', {
      y: 16, opacity: 0, duration: 0.6, ease: 'power3.out',
      scrollTrigger: { trigger: '.client .phone-stage', start: 'top 55%', once: true },
    });
  }

  // Publication timeline: the orange line follows the scroll, steps light up.
  const tl = document.querySelector('.timeline');
  if (tl) {
    const bar = document.createElement('span');
    bar.className = 'progress';
    tl.prepend(bar);
    const items = [...tl.querySelectorAll('li')];
    gsap.to(bar, {
      scaleY: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: tl,
        start: 'top 70%',
        end: 'bottom 55%',
        scrub: 0.6,
        onUpdate: (self) =>
          items.forEach((li, i) =>
            li.classList.toggle('on', self.progress >= i / (items.length - 1) - 0.02),
          ),
      },
    });
  }

  // Client phone: slow rise and straighten.
  const phone = document.querySelector('.client .phone');
  if (phone) {
    gsap.fromTo(
      phone,
      { y: 80, rotateX: 14, rotateY: -12 },
      {
        y: -20,
        rotateX: 0,
        rotateY: 0,
        ease: 'none',
        scrollTrigger: { trigger: '.client', start: 'top bottom', end: 'center center', scrub: 0.8 },
      },
    );
  }

  // Tiles tilt a little towards the pointer (fine pointers only).
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.querySelectorAll('.tilt').forEach((el) => {
      const rx = gsap.quickTo(el, 'rotationX', { duration: 0.5, ease: 'power3' });
      const ry = gsap.quickTo(el, 'rotationY', { duration: 0.5, ease: 'power3' });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * 6);
        rx(-((e.clientY - r.top) / r.height - 0.5) * 6);
      });
      el.addEventListener('pointerleave', () => {
        rx(0);
        ry(0);
      });
    });
  }
});

mm.add('(prefers-reduced-motion: reduce)', () => {
  document.querySelectorAll('.timeline li').forEach((li) => li.classList.add('on'));
});

// Tabs: click or arrow keys.
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  });
  if (focus) tab.focus();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    selectTab(tabs[(i + step + tabs.length) % tabs.length], true);
  });
});

mm.add('(prefers-reduced-motion: no-preference) and (min-width: 861px)', () => {
  // Outcome cards rise as one pair; roles follow the scroll one row at a time.
  if (document.querySelector('.outcomes')) {
    gsap.from('.outcome', {
      y: 40, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.12,
      scrollTrigger: { trigger: '.outcomes', start: 'top 82%', once: true },
    });
  }
});
