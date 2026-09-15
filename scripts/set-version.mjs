#!/usr/bin/env node
// Set the engine-axis version. Usage: pnpm version:set engine <x.y.z>
//
// The three public packages (@nilvn/core, @nilvn/engine, @nilvn/plugin-sdk) are
// released together under one version; the engine also bakes it into
// src/version.ts (a plugin manifest's `engine` range is checked at runtime
// without package.json — the IIFE never sees one; contract-core.test.ts pins the
// two equal). Workspace deps are `workspace:^`, so no lockfile change is needed.
// Does NOT tag — it prints the suggested commit + tag command.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FILES = ['packages/engine/package.json', 'packages/core/package.json', 'packages/plugin-sdk/package.json']
const TAG_PREFIX = 'engine-v'

const [component, version] = process.argv.slice(2)
if (component !== 'engine') {
  console.error('Usage: pnpm version:set engine <x.y.z>   (e.g. pnpm version:set engine 0.14.0)')
  process.exit(1)
}
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Version must be SemVer x.y.z (e.g. 0.14.0).')
  process.exit(1)
}

const at = (rel) => fileURLToPath(new URL('../' + rel, import.meta.url))
for (const rel of FILES) {
  const src = readFileSync(at(rel), 'utf8')
  const next = src.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`)
  if (next === src) {
    console.error(`  ${rel}: version line not found`)
    process.exit(1)
  }
  writeFileSync(at(rel), next)
  console.log(`  ${rel} → ${version}`)
}
{
  const rel = 'packages/engine/src/version.ts'
  const src = readFileSync(at(rel), 'utf8')
  const next = src.replace(/(export const ENGINE_VERSION = ')[^']*(')/, `$1${version}$2`)
  if (next === src) {
    console.error(`  ${rel}: ENGINE_VERSION not found`)
    process.exit(1)
  }
  writeFileSync(at(rel), next)
  console.log(`  ${rel} → ${version}`)
}
console.log(`
Next:
  git add -A && git commit -m "release: engine v${version}"
  git tag -a ${TAG_PREFIX}${version} -m "engine v${version}"
  git push && git push --tags      # the engine-v* tag triggers .github/workflows/publish.yml`)
