import { h, inl } from './html.js'

const fence = /^\x60\x60\x60/
const listItem = /^\s*([-*]|\d+\.)\s+/
const tableRow = /^\s*\|/
const blockStart = /^(#|\x60\x60\x60|\s*\||\s*([-*]|\d+\.)\s)/

function takeWhile(cursor, predicate) {
  const lines = []
  while (cursor.index < cursor.lines.length && predicate(cursor.lines[cursor.index]))
    lines.push(cursor.lines[cursor.index++])
  return lines
}

function codeBlock(cursor) {
  cursor.index++
  const text = takeWhile(cursor, (line) => !fence.test(line)).join('\n')
  if (cursor.index < cursor.lines.length) cursor.index++
  return `<pre>${h(text)}\n</pre>`
}

function table(cursor) {
  const rows = takeWhile(cursor, (line) => tableRow.test(line)).filter(
    (line) => !/^\s*\|[\s:|-]+\|\s*$/.test(line)
  )
  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())
  return (
    '<table>' +
    rows
      .map((row, index) => {
        const tag = index ? 'td' : 'th'
        return (
          '<tr>' +
          cells(row)
            .map((cell) => `<${tag}>${inl(cell)}</${tag}>`)
            .join('') +
          '</tr>'
        )
      })
      .join('') +
    '</table>'
  )
}

function list(cursor) {
  const tag = /^\s*\d+\./.test(cursor.lines[cursor.index]) ? 'ol' : 'ul'
  const items = takeWhile(cursor, (line) => listItem.test(line))
  return (
    `<${tag}>` +
    items.map((line) => '<li>' + inl(line.replace(listItem, '')) + '</li>').join('') +
    `</${tag}>`
  )
}

function block(cursor) {
  const line = cursor.lines[cursor.index]
  if (!line.trim()) {
    cursor.index++
    return ''
  }
  if (fence.test(line)) return codeBlock(cursor)
  const heading = line.match(/^(#{1,4})\s+(.*)/)
  if (heading) {
    cursor.index++
    const level = Math.min(heading[1].length + 1, 4)
    return `<h${level}>${inl(heading[2])}</h${level}>`
  }
  if (tableRow.test(line)) return table(cursor)
  if (listItem.test(line)) return list(cursor)
  cursor.index++
  const rest = takeWhile(cursor, (item) => !!item.trim() && !blockStart.test(item))
  return '<p>' + inl([line, ...rest].join(' ')) + '</p>'
}

export function md(source) {
  const cursor = { lines: String(source || '').split('\n'), index: 0 }
  let output = ''
  while (cursor.index < cursor.lines.length) output += block(cursor)
  return '<div class="md">' + output + '</div>'
}
