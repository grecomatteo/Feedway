// Scroll motion of the landing sections (ADR 023). Transforms and opacity only; with «reduce
// motion» nothing moves and every section is shown in its final state.
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

export { gsap, ScrollTrigger }

/** Starts the section animations inside `root`; the returned function undoes them. */
export function startSectionMotion(root: HTMLElement): () => void {
  gsap.registerPlugin(ScrollTrigger)
  const q = (s: string) => root.querySelector<HTMLElement>(s)
  const qa = (s: string) => [...root.querySelectorAll<HTMLElement>(s)]
  const mm = gsap.matchMedia()

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    // Publication: the orange line follows the scroll and the steps light up.
    const timeline = q('.timeline')
    if (timeline) {
      const bar = document.createElement('span')
      bar.className = 'progress'
      timeline.prepend(bar)
      const items = qa('.timeline li')
      gsap.to(bar, {
        scaleY: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: timeline,
          start: 'top 70%',
          end: 'bottom 55%',
          scrub: 0.6,
          onUpdate: (self) => {
            items.forEach((li, i) => {
              li.classList.toggle('on', self.progress >= i / (items.length - 1) - 0.02)
            })
          },
        },
      })
      return () => {
        bar.remove()
      }
    }
    return undefined
  })

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    // Problem: the loose tools are pulled into the one panel while scrolling.
    const hub = q('.converge .hub')
    if (hub) {
      const pull = gsap.timeline({
        scrollTrigger: { trigger: q('.converge'), start: 'top 65%', end: 'center 35%', scrub: 0.8 },
      })
      pull.from(hub, { scale: 0.94, duration: 0.4, ease: 'power2.out' }, 0)
      qa('.converge .tool').forEach((t, i) => {
        pull.to(
          t,
          { '--x': '0%', '--y': '0%', '--r': '0deg', opacity: 0, duration: 0.6, ease: 'power2.in' },
          0.25 + i * 0.05,
        )
      })
      pull.from(qa('.hub li'), { opacity: 0, x: -8, stagger: 0.08, duration: 0.2 }, 0.75)
    }

    // Client: the phone rises and straightens, then the approval notice arrives.
    const phone = q('.client .phone')
    if (phone) {
      gsap.fromTo(
        phone,
        { y: 80, rotateX: 14, rotateY: -12 },
        {
          y: -20,
          rotateX: 0,
          rotateY: 0,
          ease: 'none',
          scrollTrigger: {
            trigger: q('.client'),
            start: 'top bottom',
            end: 'center center',
            scrub: 0.8,
          },
        },
      )
    }
    const notice = q('.notice')
    if (notice) {
      gsap.from(notice, {
        y: 16,
        opacity: 0,
        duration: 0.6,
        ease: 'power3.out',
        scrollTrigger: { trigger: q('.client .phone-stage'), start: 'top 55%', once: true },
      })
    }

    // First steps: the top rule fades in as each step arrives.
    qa('.start-steps li').forEach((li) => {
      gsap.fromTo(
        li,
        { borderTopColor: 'rgba(36,35,33,0)' },
        {
          borderTopColor: 'rgba(36,35,33,1)',
          duration: 0.8,
          scrollTrigger: { trigger: li, start: 'top 85%', once: true },
        },
      )
    })
  })

  mm.add('(prefers-reduced-motion: no-preference) and (min-width: 861px)', () => {
    // The two publication outcomes rise as one pair.
    if (q('.outcomes')) {
      gsap.from(qa('.outcome'), {
        y: 40,
        opacity: 0,
        duration: 0.8,
        ease: 'power3.out',
        stagger: 0.12,
        scrollTrigger: { trigger: q('.outcomes'), start: 'top 82%', once: true },
      })
    }
  })

  mm.add('(prefers-reduced-motion: reduce)', () => {
    qa('.timeline li').forEach((li) => {
      li.classList.add('on')
    })
  })

  return () => {
    mm.revert()
  }
}
