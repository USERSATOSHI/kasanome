import { h } from './html.js'
export function syntax(text) {
  const tokens =
    /(\/\/.*$|#[^!].*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60[^\x60]*\x60|\b(?:async|await|break|case|catch|class|const|continue|def|else|export|extends|false|finally|for|from|function|if|import|in|interface|let|new|null|private|public|raise|return|static|super|switch|throw|true|try|type|undefined|var|void|while|yield)\b|\b\d+(?:\.\d+)?\b)/g
  let out = '',
    last = 0
  for (const match of text.matchAll(tokens)) {
    out += h(text.slice(last, match.index))
    const t = match[0],
      cls = /^(\/\/|#)/.test(t)
        ? 'comment'
        : /^["\x27\x60]/.test(t)
          ? 'string'
          : /^\d/.test(t)
            ? 'number'
            : 'keyword'
    out += '<span class="tok-' + cls + '">' + h(t) + '</span>'
    last = match.index + t.length
  }
  return out + h(text.slice(last))
}
