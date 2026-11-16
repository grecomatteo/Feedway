function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m?.[1]) throw new Error(`not a #rrggbb colour: ${hex}`)
  const n = parseInt(m[1], 16)
  return [channel((n >> 16) & 255), channel((n >> 8) & 255), channel(n & 255)]
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.x contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function oklab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex)
  const l = Math.cbrt(0.4122214708 * r + 0.5363371558 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/**
 * Euclidean distance in OKLab (0 the same colour, 1 black and white; about 0.02 is the smallest
 * difference people notice). Tells whether two colours could be taken for each other.
 */
export function perceptualDistance(a: string, b: string): number {
  const [x, y] = [oklab(a), oklab(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
