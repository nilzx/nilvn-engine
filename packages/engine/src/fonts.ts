// `[fonts]` (since 0.20.0): font files the work ships, by the family name the
// theme's `font` tokens use — `"Zcool KuaiLe" = "fonts/zcool.woff2"`. Each is
// registered with the document as a FontFace (`font-display: swap`), so text
// draws in the fallback until the file lands, then switches.
//
// The document's font set is shared by every engine on the page (an editor runs
// several), so a family + file pair is registered once and counted: an engine
// releases what it no longer declares and everything on destroy.

interface Shared {
  face: FontFace
  refs: number
  loaded: Promise<void>
  settled?: boolean
}

const shared = new Map<string, Shared>()

const usable = (): boolean => typeof FontFace === 'function' && typeof document !== 'undefined' && !!document.fonts

export class FontSet {
  /** family → resolved url, as this engine declared them. */
  private held = new Map<string, string>()

  constructor(private readonly report: (message: string) => void) {}

  /** Declare the work's fonts: new ones load, ones no longer listed are released. */
  define(table: Record<string, unknown>, resolve: (path: string) => string): void {
    const want = new Map<string, string>()
    for (const [family, src] of Object.entries(table)) {
      if (!family.trim() || typeof src !== 'string' || !src) {
        this.report(`[fonts] "${family}" needs a font file path`)
        continue
      }
      want.set(family, resolve(src))
    }
    for (const [family, url] of this.held) if (want.get(family) !== url) this.release(family, url)
    for (const [family, url] of want) if (this.held.get(family) !== url) this.acquire(family, url)
  }

  /** The declared fonts loaded (or failed), waiting `maxMs` at most; null when
   *  there is nothing to wait for (the caller then goes on in the same tick). */
  ready(maxMs: number): Promise<void> | null {
    const pending = [...this.held].map(([f, u]) => shared.get(key(f, u))).filter((x): x is Shared => !!x && !x.settled).map((x) => x.loaded)
    if (!pending.length) return null
    let timer: ReturnType<typeof setTimeout> | undefined
    return Promise.race([Promise.all(pending), new Promise<void>((r) => (timer = setTimeout(r, maxMs)))]).then(() => clearTimeout(timer))
  }

  /** The families this engine declared. */
  families(): string[] {
    return [...this.held.keys()]
  }

  destroy(): void {
    for (const [family, url] of this.held) this.release(family, url)
  }

  private acquire(family: string, url: string): void {
    this.held.set(family, url)
    if (!usable()) return
    const k = key(family, url)
    const have = shared.get(k)
    if (have) {
      have.refs++
      return
    }
    const face = new FontFace(family, `url(${JSON.stringify(url)})`, { display: 'swap' })
    document.fonts.add(face)
    const entry: Shared = { face, refs: 1, loaded: Promise.resolve() }
    entry.loaded = face
      .load()
      .then(
        () => {},
        (err: unknown) => this.report(`[fonts] "${family}" could not load (${url}): ${err instanceof Error ? err.message : String(err)} — the fallback fonts show instead`),
      )
      .finally(() => (entry.settled = true))
    shared.set(k, entry)
  }

  private release(family: string, url: string): void {
    this.held.delete(family)
    const k = key(family, url), have = shared.get(k)
    if (!have || --have.refs > 0) return
    shared.delete(k)
    if (usable()) document.fonts.delete(have.face)
  }
}

const key = (family: string, url: string): string => `${family}\n${url}`
