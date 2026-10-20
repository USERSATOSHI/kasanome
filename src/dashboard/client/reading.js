import { state } from './model.js'
import { h, fileLink, inl } from './html.js'
export const readKey = (scope, path) => scope + '|' + path
export function unitProgress(scope, items) {
  if (!items || !items.length) return 0
  return items.filter((r) => state.read[readKey(scope, r.path)]).length / items.length
}
export function readingSteps(scope, items) {
  if (!items || !items.length) return '<p class="muted">No reading order.</p>'
  return (
    '<ol class="steps">' +
    items
      .map((r, i) => {
        const k = readKey(scope, r.path),
          done = state.read[k]
        return (
          '<li class="step' +
          (done ? ' done' : '') +
          '"><label class="step-check" title="Mark as read"><input type="checkbox" data-read="' +
          h(k) +
          '"' +
          (done ? ' checked' : '') +
          '><span class="step-n">' +
          (i + 1) +
          '</span></label>' +
          '<div class="step-body">' +
          fileLink(r.path) +
          '<div class="step-why">' +
          inl(r.why) +
          '</div></div></li>'
        )
      })
      .join('') +
    '</ol>'
  )
}
