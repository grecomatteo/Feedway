import { encode } from 'uqr'

/** Modules of light margin around the code, as the QR standard asks. */
const QUIET_ZONE = 4

/**
 * A QR code as one SVG path, drawn in the template without v-html: `size` is the side of the
 * viewBox in modules, `d` has one square per dark module.
 */
export function qrPath(text: string): { size: number; d: string } {
  const modules = encode(text, { ecc: 'M', border: 0 }).data
  let d = ''
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`
    })
  })
  return { size: modules.length + 2 * QUIET_ZONE, d }
}
