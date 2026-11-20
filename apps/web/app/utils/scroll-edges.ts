import type { Directive } from 'vue'

/**
 * A row that scrolls sideways (the client's tabs, a filter on a phone) fades out at the edge where
 * more of it is hidden, so it reads as something that scrolls (D-102.8). The element gets
 * `data-more-start` and `data-more-end`; `main.css` draws the fade.
 */
interface Watched extends HTMLElement {
  _scrollEdges?: { update: () => void; observer: ResizeObserver }
}

function update(el: HTMLElement) {
  // only a box that scrolls: one that just overflows could never lose its fade
  const scrolls = /auto|scroll/.test(getComputedStyle(el).overflowX)
  const max = scrolls ? el.scrollWidth - el.clientWidth : 0
  // RTL scrolls to negative positions: the distance from the start is the absolute value
  const at = Math.abs(el.scrollLeft)
  el.toggleAttribute('data-more-start', max > 1 && at > 1)
  el.toggleAttribute('data-more-end', max > 1 && at < max - 1)
}

export const vScrollEdges: Directive<Watched> = {
  mounted(el) {
    const run = () => {
      update(el)
    }
    const observer = new ResizeObserver(run)
    observer.observe(el)
    // the content can grow without the box changing (a count that arrives later)
    for (const child of el.children) observer.observe(child)
    el.addEventListener('scroll', run, { passive: true })
    el._scrollEdges = { update: run, observer }
    run()
  },
  updated(el) {
    el._scrollEdges?.update()
  },
  beforeUnmount(el) {
    if (!el._scrollEdges) return
    el.removeEventListener('scroll', el._scrollEdges.update)
    el._scrollEdges.observer.disconnect()
    delete el._scrollEdges
  },
}
