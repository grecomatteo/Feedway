/* Motion shared by the three variants. Transforms and opacity only;
   with prefers-reduced-motion everything is shown in its final state. */
gsap.registerPlugin(ScrollTrigger, SplitText);

const header = document.querySelector('.site-header');
ScrollTrigger.create({
  start: 8,
  onToggle: (self) => header.classList.toggle('scrolled', self.isActive),
});

const mm = gsap.matchMedia();
window.motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

mm.add('(prefers-reduced-motion: no-preference)', () => {
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
  // Problem: the six apps drift in and lean towards the one panel.
  if (document.querySelector('.funnel')) {
    const tl = gsap.timeline({ scrollTrigger: { trigger: '.funnel', start: 'top 75%', once: true } });
    tl.from('.apps li', { x: -40, opacity: 0, duration: 0.6, ease: 'power3.out', stagger: 0.07 })
      .from('.funnel-arrow', { x: -12, opacity: 0, duration: 0.4, ease: 'power3.out' }, '-=0.2')
      .from('.one', { scale: 0.94, opacity: 0, duration: 0.6, ease: 'power3.out' }, '-=0.25')
      .from('.one li', { x: -8, opacity: 0, duration: 0.35, ease: 'power3.out', stagger: 0.08 }, '-=0.3');
  }
  // Outcome cards rise as one pair; roles follow the scroll one row at a time.
  if (document.querySelector('.outcomes')) {
    gsap.from('.outcome', {
      y: 40, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.12,
      scrollTrigger: { trigger: '.outcomes', start: 'top 82%', once: true },
    });
  }
  if (document.querySelector('.giant')) {
    gsap.from('.giant', {
      yPercent: 45, ease: 'none',
      scrollTrigger: { trigger: '.site-footer', start: 'top bottom', end: 'bottom bottom', scrub: 0.6 },
    });
  }
});
