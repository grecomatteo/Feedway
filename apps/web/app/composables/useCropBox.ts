import {
  centerBox,
  dragCorner,
  fromFractions,
  maxWidth,
  minWidth,
  placeBox,
  toFractions,
  type Box,
  type Corner,
  type CropSpec,
} from '../utils/crop-box'

/**
 * A crop box with fixed proportions on a photo shown at `scale` screen pixels per pixel of the
 * original (D-61): moved by dragging it, resized by its corners, both with the keyboard too
 * (arrows, Maiusc+arrows, + and −). The profile photo and the post's crops share it.
 */
export function useCropBox(
  spec: Ref<CropSpec | null>,
  opts: {
    scale: Ref<number>
    /** how far an arrow moves the box, in pixels of the original; `big` with Maiusc */
    step: (box: Box, spec: CropSpec, big: boolean) => { x: number; y: number }
    /** how much + and − change the width, in pixels of the original */
    zoomStep: (spec: CropSpec) => number
  },
) {
  const box = ref<Box>({ x: 0, y: 0, width: 0, height: 0 })

  function reset() {
    if (spec.value) box.value = centerBox(spec.value)
  }
  function setFractions(crop: { x: number; y: number; width: number; height: number }) {
    if (spec.value) box.value = fromFractions(crop, spec.value)
  }
  function place(x: number, y: number, width: number) {
    if (spec.value) box.value = placeBox(box.value, x, y, width, spec.value)
  }
  function move(dx: number, dy: number, big = false) {
    const s = spec.value
    if (!s) return
    const step = opts.step(box.value, s, big)
    place(box.value.x + dx * step.x, box.value.y + dy * step.y, box.value.width)
  }
  /** 1: a smaller box (closer), −1: a larger one */
  function zoom(direction: 1 | -1) {
    const s = spec.value
    if (!s) return
    place(box.value.x, box.value.y, box.value.width - direction * opts.zoomStep(s))
  }
  const canZoomIn = computed(() => !!spec.value && box.value.width > minWidth(spec.value) + 1e-6)
  const canZoomOut = computed(() => !!spec.value && box.value.width < maxWidth(spec.value) - 1e-6)
  const fractions = computed(() => (spec.value ? toFractions(box.value, spec.value) : null))

  function onKey(event: KeyboardEvent) {
    const big = event.shiftKey
    const keys: Record<string, () => void> = {
      ArrowLeft: () => {
        move(-1, 0, big)
      },
      ArrowRight: () => {
        move(1, 0, big)
      },
      ArrowUp: () => {
        move(0, -1, big)
      },
      ArrowDown: () => {
        move(0, 1, big)
      },
      '+': () => {
        zoom(1)
      },
      '=': () => {
        zoom(1)
      },
      '-': () => {
        zoom(-1)
      },
    }
    const action = keys[event.key]
    if (!action) return
    event.preventDefault()
    action()
  }

  let drag: {
    pointer: number
    corner: Corner | null
    startX: number
    startY: number
    from: Box
    left: number
    top: number
  } | null = null
  /** On the box (`corner` null: move it) or on one of its corners (resize). */
  function onPointerDown(event: PointerEvent, corner: Corner | null = null) {
    event.stopPropagation()
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    const frame = target.closest<HTMLElement>('[data-crop-frame]')?.getBoundingClientRect()
    drag = {
      pointer: event.pointerId,
      corner,
      startX: event.clientX,
      startY: event.clientY,
      from: { ...box.value },
      left: frame?.left ?? 0,
      top: frame?.top ?? 0,
    }
  }
  function onPointerMove(event: PointerEvent) {
    const s = spec.value
    if (!drag || drag.pointer !== event.pointerId || !s) return
    const k = opts.scale.value
    if (drag.corner)
      box.value = dragCorner(
        drag.from,
        drag.corner,
        (event.clientX - drag.left) / k,
        (event.clientY - drag.top) / k,
        s,
      )
    else
      box.value = placeBox(
        drag.from,
        drag.from.x + (event.clientX - drag.startX) / k,
        drag.from.y + (event.clientY - drag.startY) / k,
        drag.from.width,
        s,
      )
  }
  function onPointerUp() {
    drag = null
  }

  return {
    box,
    reset,
    setFractions,
    place,
    move,
    zoom,
    canZoomIn,
    canZoomOut,
    fractions,
    onKey,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
