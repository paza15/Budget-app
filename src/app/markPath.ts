/**
 * Geometry of the app mark (docs/design/mark.svg, DESIGN.md §15): the On switch, a 64×40 pill
 * whose knob is a coin with the double rule cut out, set off from the pill's rim by a clear ring.
 * Shared by the React <Mark> and the plain-DOM privacy cover, which is built before React renders.
 */

export const MARK_VIEWBOX = '0 0 64 64'

/** One even-odd path, drawn with fill: currentColor. */
export const MARK_PATH =
  'M20 12H44A20 20 0 0 1 44 52H20A20 20 0 0 1 20 12ZM28 32a16 16 0 1 0 32 0a16 16 0 1 0 -32 0Z' +
  'M32 32a12 12 0 1 0 24 0a12 12 0 1 0 -24 0ZM38 24h12v4h-12ZM38 36h12v4h-12Z'
