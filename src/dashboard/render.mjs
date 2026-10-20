import { readFileSync } from 'node:fs'
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const client = readFileSync(new URL('../../dist/dashboard.js', import.meta.url), 'utf8').replace(
  /<\/script/gi,
  '<\\/script'
)
// Renders the review data into a single self-contained, navigable HTML dashboard.
// No external assets: data is embedded, client code is inline. Review progress persists in localStorage.

export function renderDashboard(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kasanome: ${escapeHtml(data.range || '')}</title>
<style>${css}</style>
</head>
<body>
<aside id="nav"></aside>
<main id="main"><h1>Kasanome</h1><p>This dashboard needs JavaScript. Open index.html in a web browser (Chrome, Safari, Firefox), not an editor preview.</p></main>
<script type="application/json" id="data">${json}</script>
<script>${client}</script>
</body>
</html>
`
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )
}
