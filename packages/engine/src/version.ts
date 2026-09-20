// The engine's own version, baked in so a plugin manifest's `engine` range can be
// checked at runtime without reading package.json (which the IIFE never sees).
// `pnpm version:set engine x.y.z` rewrites this constant along with package.json;
// version.test.ts pins the two equal.
export const ENGINE_VERSION = '0.16.1'
