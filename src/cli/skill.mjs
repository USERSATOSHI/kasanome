export async function launch(agent) {
  if (agent && !process.argv.slice(2).includes('--agent')) process.argv.push('--agent', agent)
  await import('../../bin/kasanome.mjs')
}
