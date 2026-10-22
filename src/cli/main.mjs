import { readFileSync } from 'node:fs'
import { parseArgs, printHelp } from './options.mjs'

export async function runCli(argv = process.argv.slice(2), { defaultAgent } = {}) {
  try {
    if (!argv.length) {
      printHelp()
      return
    }
    if (argv[0] === 'install') {
      const { install } = await import('./install.mjs')
      install(argv.slice(1))
    } else if (['--version', '-v', '-V'].includes(argv[0])) {
      console.log(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).version)
    } else {
      const command = ['review', 'status'].includes(argv[0]) ? argv.shift() : 'review'
      if (command === 'status' && argv.some((a) => ['--help', '-h'].includes(a))) {
        console.log(
          'Usage: kasanome status [--repo <dir>] [--out <dir>] [--json]\nShow the latest saved review without making model calls.'
        )
        return
      }
      let options = parseArgs(argv)
      if (options.help) return
      if (command === 'status') {
        const { showStatus } = await import('./status.mjs')
        showStatus(options)
        return
      }
      if (options.pr) {
        const { resolvePr } = await import('./pr.mjs')
        options = resolvePr(options)
      }
      if (!options.agent && defaultAgent) options.agent = defaultAgent
      const { runReview } = await import('../review/pipeline.mjs')
      await runReview(options)
    }
  } catch (error) {
    console.error(`kasanome: ${error.message}`)
    process.exitCode = 1
  }
}
