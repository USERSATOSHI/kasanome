import { build } from 'esbuild'
await build({
  entryPoints: ['src/dashboard/client/main.js'],
  outfile: 'dist/dashboard.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  charset: 'utf8',
})
