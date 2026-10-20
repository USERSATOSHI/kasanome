import { existsSync } from 'node:fs'

// Git installs build from source. Package archives already contain the browser bundle.
if (!existsSync(new URL('../dist/dashboard.js', import.meta.url))) await import('./build.mjs')
