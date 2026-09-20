// Asset preloading (batch I inc 3): what a script references, found by walking
// its nodes, so `[preload] auto = true` can warm the opening scene before play
// and `[preload …]` can warm ahead of a heavy one. Only the built-in commands'
// asset parameters are known here; a plugin command's assets go in the explicit
// `[preload] assets` list.
import type { ActorDef, ScriptNode } from './types.js'

/** Which positional / named parameters of the built-in commands name an asset. */
const ASSET_PARAMS: Record<string, (number | string)[]> = {
  bg: [0],
  sprite: [1],
  bgm: [0],
  se: [0],
  voice: [0],
  window: ['skin'],
}

const isRef = (v: string | undefined): v is string => !!v && !v.startsWith('#') && v !== 'none'

/** An actor's sprite for a face, from its template. */
function faceSprite(actor: ActorDef | undefined, face: string | undefined): string | undefined {
  const tmpl = actor?.sprites
  if (!tmpl) return undefined
  const f = face ?? actor?.defaultFace
  return tmpl.includes('{face}') ? (f ? tmpl.replaceAll('{face}', f) : undefined) : tmpl
}

/** A layered actor's images for a command's values (defaults for the rest). */
function layerSprites(actor: ActorDef, values: Record<string, string | undefined>): string[] {
  const out: string[] = []
  for (const [name, def] of Object.entries(actor.layers ?? {})) {
    const value = values[name] ?? def.default ?? (name === 'face' ? actor.defaultFace : undefined)
    if (value && value !== 'none') out.push(def.src.replaceAll(`{${name}}`, value))
  }
  return out
}

/** Every asset ref the nodes reference (built-in commands, `speaker(face):`
 *  faces through the actor templates), deduplicated, in first-use order. */
export function scanAssetRefs(nodes: readonly ScriptNode[], actors: Record<string, ActorDef>): string[] {
  const out = new Set<string>()
  for (const node of nodes) {
    if (node.type === 'dialogue') {
      const actor = node.speaker ? actors[node.speaker] : undefined
      if (actor?.layers && node.face) for (const s of layerSprites(actor, { face: node.face })) out.add(s)
      else if (node.speaker && node.face) {
        const s = faceSprite(actor, node.face)
        if (s) out.add(s)
      }
      continue
    }
    if (node.type !== 'command') continue
    if (node.name === 'char') {
      const src = node.params.src
      const actor = actors[node.args[0] ?? '']
      if (isRef(src)) out.add(src)
      else if (actor?.layers) for (const s of layerSprites(actor, { ...node.params, face: node.args[1] })) out.add(s)
      else {
        const s = faceSprite(actor, node.args[1])
        if (s) out.add(s)
      }
      continue
    }
    if (node.name === 'bg' && node.params.color !== undefined) continue
    for (const key of ASSET_PARAMS[node.name] ?? []) {
      const v = typeof key === 'number' ? node.args[key] : node.params[key]
      if (isRef(v)) out.add(v)
    }
  }
  return [...out]
}

/** Whether a URL is an image the browser can decode ahead of time. */
export function isImageUrl(url: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i.test(url) || url.startsWith('data:image/')
}
