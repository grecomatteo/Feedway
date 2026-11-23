/* Variant C: SplitText line reveal, 3D fan of panels, pinned horizontal walk. */
const cards = gsap.utils.toArray('.card3d');
// resting fan: left, centre, right
const FAN = [
  { xPercent: -95, rotationY: 28, rotationZ: -3, z: -160 },
  { xPercent: -50, rotationY: 0, rotationZ: 0, z: 0 },
  { xPercent: -5, rotationY: -28, rotationZ: 3, z: -160 },
];
cards.forEach((c, i) => gsap.set(c, { ...FAN[i], rotationX: 8, zIndex: i === 1 ? 2 : 1 }));

mm.add('(prefers-reduced-motion: no-preference)', () => {
  const split = SplitText.create('.hero-c h1', { type: 'lines', mask: 'lines', linesClass: 'line' });
  gsap.from(split.lines, { yPercent: 105, duration: 1.1, ease: 'power4.out', stagger: 0.1 });
  gsap.from('.hero-foot > *', { y: 20, opacity: 0, duration: 0.9, ease: 'power3.out', delay: 0.45, stagger: 0.08 });
  gsap.from(cards, {
    y: 220,
    rotationX: 40,
    opacity: 0,
    duration: 1.3,
    ease: 'power3.out',
    delay: 0.5,
    stagger: 0.1,
  });

  // Scroll: the fan opens wider and tips back as the page moves on.
  gsap.to(cards, {
    rotationX: 0,
    xPercent: (i) => [-118, -50, 18][i],
    y: (i) => (i === 1 ? -40 : 30),
    ease: 'none',
    scrollTrigger: { trigger: '.cards3d', start: 'top 80%', end: 'bottom top', scrub: 0.8 },
  });

  // Horizontal walk, desktop only.
  const media = gsap.matchMedia();
  media.add('(min-width: 861px)', () => {
    const track = document.querySelector('.hs-track');
    const items = gsap.utils.toArray('.hs-card');
    const distance = () => track.scrollWidth - innerWidth;
    const tween = gsap.to(track, {
      x: () => -distance(),
      ease: 'none',
      scrollTrigger: {
        trigger: '.hscroll',
        start: 'top top',
        end: () => '+=' + distance(),
        pin: '.hs-pin',
        scrub: 0.8,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          gsap.set('.hs-progress span', { scaleX: self.progress });
          // cards turn towards the reader as they reach the centre
          const mid = innerWidth / 2;
          items.forEach((el) => {
            const r = el.getBoundingClientRect();
            const off = gsap.utils.clamp(-1, 1, (r.left + r.width / 2 - mid) / mid);
            gsap.set(el, { rotationY: off * -16, z: -Math.abs(off) * 120, opacity: 1 - Math.abs(off) * 0.35 });
          });
        },
      },
    });
    return () => tween.kill();
  });
});

mm.add('(prefers-reduced-motion: reduce)', () => {
  cards.forEach((c, i) => gsap.set(c, { rotationX: 0, xPercent: [-118, -50, 18][i] }));
});
