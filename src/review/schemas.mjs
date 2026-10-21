const S = (type, extra = {}) => ({ type, ...extra })
const str = S('string'),
  num = S('number'),
  bool = S('boolean'),
  strs = S('array', { items: str })
const obj = (props, required = Object.keys(props)) => ({
  type: 'object',
  properties: props,
  required,
})

export const MAP_SCHEMA = obj({
  overview: S('string', { description: '1-2 paragraphs: what the system does and how data flows' }),
  layers: S('array', {
    description: 'ordered bottom (foundational) to top (entry points)',
    items: obj({
      id: S('string', { description: 'short kebab-case id' }),
      name: str,
      purpose: str,
      paths: strs,
      approxLines: num,
      contracts: S('array', {
        items: str,
        description: 'public types/functions other layers rely on, with file paths',
      }),
      dependsOn: S('array', { items: str, description: 'layer ids' }),
      backEdges: S('array', { items: str, description: 'upward imports, file -> file' }),
    }),
  }),
  seams: S('array', {
    description: 'riskiest boundaries, most risky first',
    items: obj({ from: str, to: str, why: str, files: strs }),
  }),
  tests: str,
})

const FINDING = obj({
  title: str,
  severity: S('string', { enum: ['high', 'medium', 'low'] }),
  category: S('string', {
    description:
      'correctness, abstraction, coupling, duplication, dead-code, spec-drift, error-handling, test-gap, naming',
  }),
  file: str,
  line: num,
  detail: S('string', { description: 'what is wrong and the concrete consequence' }),
  evidence: S('string', { description: 'code excerpt or references that prove it' }),
  sourceExcerpt: S('string', {
    description:
      'Copy 1-3 contiguous lines verbatim from the cited file at head, centered on the issue. No ellipses, paraphrasing, or added commentary. This exact text anchors the inline comment.',
  }),
})

export const REVIEW_SCHEMA = obj({
  summary: str,
  readingOrder: S('array', { items: obj({ path: str, why: str }) }),
  strengths: strs,
  findings: S('array', { items: FINDING }),
})

export const VERDICT_SCHEMA = obj({
  verdicts: S('array', {
    items: obj(
      {
        index: num,
        real: bool,
        severity: S('string', { enum: ['high', 'medium', 'low'] }),
        reason: str,
        resolution: S('string', { enum: ['present', 'resolved', 'unknown'] }),
      },
      ['index', 'real', 'severity', 'reason']
    ),
  }),
})

export const ATTRIB_SCHEMA = obj({
  attributions: S('array', {
    items: obj({
      id: str,
      introducedIn: S('number', { description: 'PR number, 0 if unknown' }),
      status: S('string', { enum: ['present-at-head', 'fixed-later', 'unknown'] }),
      fixedIn: S('number', { description: 'PR that fixed it, 0 if none' }),
    }),
  }),
})
