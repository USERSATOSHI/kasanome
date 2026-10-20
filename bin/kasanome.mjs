#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseArgs } from '../src/cli/options.mjs'

try {
  if (process.argv[2] === 'install') {
    const { install } = await import('../src/cli/install.mjs')
    install(process.argv.slice(3))
  } else if (['--version', '-v'].includes(process.argv[2])) {
    console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version)
  } else {
    const options = parseArgs(process.argv.slice(2))
    const { runReview } = await import('../src/review/pipeline.mjs')
    await runReview(options)
  }
} catch (error) {
  console.error(`kasanome: ${error.message}`)
  process.exitCode = 1
}
