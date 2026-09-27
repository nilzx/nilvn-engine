#!/usr/bin/env node
// `nilvn` — the engine's command line:
//
//   nilvn pack [config | folder] [options]      a work → a script package (./cli/pack.ts)
//   nilvn playtest [target] [options]           play a work headless in Chrome (./cli/playtest.ts)

import { ENGINE_VERSION } from './version.js'
import { UsageError } from './cli/common.js'
import { PACK_USAGE, pack, parsePackArgs } from './cli/pack.js'
import { PLAYTEST_USAGE, playtest, parsePlaytestArgs } from './cli/playtest.js'

const USAGE = `nilvn ${ENGINE_VERSION}

Commands:
  nilvn pack [config | folder]    pack a work into a script package
  nilvn playtest [target]         play a work in a headless Chrome and report
  nilvn <command> --help          a command's options
`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    console.log(USAGE)
    return command ? 0 : 1
  }
  if (command === '-v' || command === '--version') {
    console.log(ENGINE_VERSION)
    return 0
  }
  const help = rest.includes('-h') || rest.includes('--help')
  if (command === 'pack') {
    if (help) return void console.log(PACK_USAGE), 0
    return pack(parsePackArgs(rest))
  }
  if (command === 'playtest') {
    if (help) return void console.log(PLAYTEST_USAGE), 0
    return playtest(parsePlaytestArgs(rest))
  }
  throw new UsageError(`unknown command "${command}"`)
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    if (err instanceof UsageError) {
      console.error(`nilvn: ${err.message}\n\n${USAGE}`)
      process.exit(2)
    }
    console.error(err)
    process.exit(1)
  },
)
