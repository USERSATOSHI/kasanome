function validateObject(schema, value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return `${path}: expected object`
  for (const key of schema.required || []) {
    if (!(key in value)) return `${path}.${key}: missing`
  }
  for (const [key, property] of Object.entries(schema.properties || {})) {
    if (!(key in value)) continue
    const error = validate(property, value[key], `${path}.${key}`)
    if (error) return error
  }
  return null
}

function validateArray(schema, value, path) {
  if (!Array.isArray(value)) return `${path}: expected array`
  if (schema.maxItems !== undefined && value.length > schema.maxItems)
    return `${path}: exceeds ${schema.maxItems} items`
  if (!schema.items) return null
  for (let i = 0; i < value.length; i++) {
    const error = validate(schema.items, value[i], `${path}[${i}]`)
    if (error) return error
  }
  return null
}

export function validate(schema, value, path = '$') {
  if (schema.enum && !schema.enum.includes(value))
    return `${path}: must be one of ${schema.enum.join('|')}`
  if (schema.type === 'object') return validateObject(schema, value, path)
  if (schema.type === 'array') return validateArray(schema, value, path)
  if (['number', 'string', 'boolean'].includes(schema.type) && typeof value !== schema.type)
    return `${path}: expected ${schema.type}`
  return null
}

export function extractJson(text) {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1])
  for (const candidate of [...fences.reverse(), text]) {
    const start = candidate.indexOf('{'),
      end = candidate.lastIndexOf('}')
    if (start === -1 || end <= start) continue
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {}
  }
  throw new Error('no parseable JSON object in output')
}

// Codex requires strict schemas with every property required and no extra properties.
export function strictSchema(schema) {
  if (schema.type === 'object') {
    const properties = Object.fromEntries(
      Object.entries(schema.properties || {}).map(([key, value]) => [key, strictSchema(value)])
    )
    return {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    }
  }
  if (schema.type === 'array') return { ...schema, items: strictSchema(schema.items) }
  const result = { ...schema }
  delete result.description
  return result
}
