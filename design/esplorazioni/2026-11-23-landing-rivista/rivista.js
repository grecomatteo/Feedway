/* Landing rivista: areas with a sticky preview, tools converging into Feedway,
   nav highlight. Transforms and opacity only; reduced motion shows final states. */
(() => {
  const areas = [...document.querySelectorAll('.area')];
  const shots = [...document.querySelectorAll('.shot')];

  // Phones and narrow screens: each area carries its own preview under the text.
  areas.forEach((area) => {
    const fig = shots[Number(area.dataset.shot)];
    if (!fig) return;
    const copy = fig.cloneNode(true);
    copy.className = 'inline-shot ' + (fig.classList.contains('shot-phone') ? 'inline-phone' : '');
    area.append(copy);
  });

  function show(i) {
    areas.forEach((a, k) => a.classList.toggle('on', k === i));
    shots.forEach((s, k) => s.classList.toggle('on', k === i));
  }
  show(0);

  areas.forEach((area, i) => {
    ScrollTrigger.create({
      trigger: area,
      start: 'top 60%',
      end: 'bottom 60%',
      onToggle: (self) => self.isActive && show(i),
    });
  });

  // Header: highlight the section in view.
  const links = [...document.querySelectorAll('.site-header nav a')];
  links.forEach((a) => {
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
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    // The six scattered tools slide into the Feedway card as the section scrolls by.
    const tools = gsap.utils.toArray('.converge .tool');
    const hub = document.querySelector('.converge .hub');
    const tl = gsap.timeline({
      scrollTrigger: { trigger: '.converge', start: 'top 65%', end: 'center 35%', scrub: 0.8 },
    });
    tl.from(hub, { scale: 0.94, duration: 0.4, ease: 'power2.out' }, 0);
    tools.forEach((t, i) => {
      tl.to(
        t,
        { '--x': '0%', '--y': '0%', '--r': '0deg', opacity: 0, filter: 'blur(4px)', duration: 0.6, ease: 'power2.in' },
        0.25 + i * 0.05,
      );
    });
    tl.from('.hub li', { opacity: 0, x: -8, stagger: 0.08, duration: 0.2 }, 0.75);

    // Start steps draw their top rule from the left.
    gsap.utils.toArray('.start-steps li').forEach((li) => {
      gsap.fromTo(
        li,
        { borderTopColor: 'rgba(36,35,33,0)' },
        { borderTopColor: 'rgba(36,35,33,1)', duration: 0.8, scrollTrigger: { trigger: li, start: 'top 85%', once: true } },
      );
    });

    // Giant wordmark rises into place at the very end.
    gsap.from('.wordmark img', {
      yPercent: 40,
      ease: 'none',
      scrollTrigger: { trigger: '.site-footer.big', start: 'top bottom', end: 'bottom bottom', scrub: 0.6 },
    });
  });
})();
