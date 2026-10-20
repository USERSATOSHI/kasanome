import { readFileSync } from 'node:fs'
import { parseArgs } from './options.mjs'

export async function runCli(argv = process.argv.slice(2), { defaultAgent } = {}) {
  try {
    if (argv[0] === 'install') {
      const { install } = await import('./install.mjs')
      install(argv.slice(1))
    } else if (['--version', '-v'].includes(argv[0])) {
      console.log(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).version)
    } else {
      const options = parseArgs(argv)
      if (!options.agent && defaultAgent) options.agent = defaultAgent
      const { runReview } = await import('../review/pipeline.mjs')
      await runReview(options)
    }
  } catch (error) {
    console.error(`kasanome: ${error.message}`)
    process.exitCode = 1
  }
}
