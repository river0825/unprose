// SVG → PNG for canvas_snapshot (docs/canvas.md "Seeing the board"). Unprose ships no rasterizer: if the optional
// package `@resvg/resvg-js` is installed next to the canvas it is used, otherwise the snapshot stays SVG and says so.
// Loaded lazily by name, so the canvas starts and works without it.

export interface Raster {
  png?: Buffer
  /** why there is no PNG */
  why?: string
}

type ResvgModule = { Resvg: new (svg: string, opts?: Record<string, unknown>) => { render(): { asPng(): Uint8Array } } }

let loaded: Promise<ResvgModule | undefined> | undefined
const RESVG = '@resvg/resvg-js'

function loadResvg(): Promise<ResvgModule | undefined> {
  // a variable specifier: TypeScript does not resolve it, and a missing package is a normal answer, not an error
  loaded ??= (import(RESVG) as Promise<ResvgModule>).then((m) => (m && typeof m.Resvg === 'function' ? m : (m as unknown as { default?: ResvgModule }).default)).catch(() => undefined)
  return loaded
}

/** Rasterize a self-contained SVG; `{ why }` when no rasterizer is available or it fails. */
export async function svgToPng(svg: string): Promise<Raster> {
  if (process.env.UNPROSE_SNAPSHOT_PNG === '0') return { why: 'PNG output is turned off on this canvas (UNPROSE_SNAPSHOT_PNG=0)' }
  const m = await loadResvg()
  if (!m) return { why: `this canvas has no PNG rasterizer (the optional package ${RESVG} is not installed), so the snapshot is SVG` }
  try {
    const png = new m.Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' }, background: 'rgba(0,0,0,0)' }).render().asPng()
    return { png: Buffer.from(png) }
  } catch (e) {
    return { why: `rasterizing failed (${(e as Error).message}); here is the SVG` }
  }
}
