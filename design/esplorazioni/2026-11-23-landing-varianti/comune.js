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
