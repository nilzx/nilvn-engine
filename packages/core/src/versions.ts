// The compatibility table:
// every independently-versioned on-disk / on-wire shape in one place, so a
// reader can see at a glance which numbers exist and which code gates them.
// Each is bumped ONLY when its own shape changes incompatibly; none is tied to
// a package's SemVer.

import { CURRENT_SCHEMA_VERSION } from './ir.js'
import { CHUNK_MANIFEST_FORMAT } from './chunk.js'
import { PACKAGE_FORMAT } from './package.js'
import { PLUGIN_API_VERSION } from './plugin-manifest.js'

export const FORMAT_VERSIONS = Object.freeze({
  /** Project / IR document (`ProjectMeta.schemaVersion`) — `migrateProject` brings
   *  older projects forward, one table step per bump. */
  irSchema: CURRENT_SCHEMA_VERSION,
  /** Chunked-streaming manifest (`ChunkManifest.format`) — the loaders gate on it. */
  chunkManifest: CHUNK_MANIFEST_FORMAT,
  /** Script package (`nilvn.json` `format`) — `checkPackageManifest` gates on it. */
  package: PACKAGE_FORMAT,
  /** Engine `SaveState.v` — `restoreState` returns false for any other value. */
  saveState: 2,
  /** The engine's save-slot wrapper (`SlotPayload.v` — the menu and autosave). */
  saveSlot: 1,
  /** The plugin manifest / runtime contract (`PluginManifest.apiVersion`) —
   *  `validatePluginManifest` rejects a newer one. */
  pluginApi: PLUGIN_API_VERSION,
})

export type FormatVersions = typeof FORMAT_VERSIONS
