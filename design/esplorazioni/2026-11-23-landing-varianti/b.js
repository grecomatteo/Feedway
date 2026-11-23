/* Variant B: perspective hero and sticky tour (GSAP + ScrollTrigger, no WebGL). */
const shots = [...document.querySelectorAll('.shots img')];
const steps = [...document.querySelectorAll('.tour-step')];

function show(i) {
  steps.forEach((s, k) => s.classList.toggle('on', k === i));
  // the new shot wipes in over the old one; older shots stay underneath
  shots.forEach((img, k) => {
    img.classList.toggle('on', k <= i);
    img.style.zIndex = String(k);
  });
}
show(0);

mm.add('(prefers-reduced-motion: no-preference)', () => {
  // Entrance: copy rises, the window lands.
  gsap.from('.hero-copy > *', { y: 24, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07 });
  gsap.from('.tilt-scene', { y: 80, opacity: 0, duration: 1.2, ease: 'power3.out', delay: 0.2 });
  gsap.from('.float', { opacity: 0, scale: 0.92, duration: 0.8, ease: 'back.out(1.6)', stagger: 0.12, delay: 0.7 });

  // Scroll: the window flattens; chips drift at their own depth.
  const tl = gsap.timeline({
    scrollTrigger: { trigger: '.hero-b', start: 'top top', end: 'bottom 30%', scrub: 0.8 },
  });
  tl.to('.tilt-scene', { rotationX: 0, scale: 1, ease: 'none' }, 0)
    .to('.f1', { y: -120, x: -20, ease: 'none' }, 0)
    .to('.f2', { y: -70, ease: 'none' }, 0)
    .to('.f3', { y: -40, ease: 'none' }, 0);

  // Pointer: the scene leans a little towards the cursor.
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const scene = document.querySelector('.tilt-scene');
    const ry = gsap.quickTo(scene, 'rotationY', { duration: 0.8, ease: 'power3' });
    addEventListener('pointermove', (e) => ry((e.clientX / innerWidth - 0.5) * 4));
  }

  steps.forEach((s, i) =>
    ScrollTrigger.create({
      trigger: s,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => self.isActive && show(i),
    }),
  );
});
