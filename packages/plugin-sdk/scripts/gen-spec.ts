// (Re)generate the artifacts derived from src/spec.ts, or verify them:
//   pnpm spec:gen     write plugin-spec.json + template/plugin.json + template/engine.js
//   pnpm spec:check   byte-compare, exit 1 on drift (CI + prepack)
// Runs through tsx so the TypeScript sources (and their extensionless imports)
// resolve the same way the tests see them.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPluginSpec } from '../src/spec'

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..')
const spec = buildPluginSpec()
const artifacts: [string, string][] = [
  [join(pkg, 'plugin-spec.json'), JSON.stringify(spec, null, 2) + '\n'],
  [join(pkg, 'template', 'plugin.json'), JSON.stringify(spec.example.manifest, null, 2) + '\n'],
  [join(pkg, 'template', 'engine.js'), spec.example.engineModule],
]

const check = process.argv.includes('--check')
let stale = 0
for (const [path, want] of artifacts) {
  const rel = relative(pkg, path)
  if (check) {
    let have = ''
    try {
      have = readFileSync(path, 'utf8')
    } catch {
      console.error(`✗ ${rel} is missing — run: pnpm --filter @nilvn/plugin-sdk spec:gen`)
      stale++
      continue
    }
    if (have !== want) {
      console.error(`✗ ${rel} is STALE — run: pnpm --filter @nilvn/plugin-sdk spec:gen`)
      stale++
    } else console.log(`✓ ${rel} is up to date`)
  } else {
    writeFileSync(path, want)
    console.log(`✓ wrote ${rel}`)
  }
}
process.exit(stale ? 1 : 0)
