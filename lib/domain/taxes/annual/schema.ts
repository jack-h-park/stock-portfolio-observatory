/** Internal evaluator for the finite JSON Schema keywords used by these two contracts.
 * Unknown keywords fail closed. This is not a general-purpose JSON Schema engine.
 */
export function assertAnnualSchema(value: unknown, schema: Record<string, any>, path = '$'): void {
  const allowed = new Set(['$schema', '$id', 'title', '$comment', 'type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'anyOf'])
  for (const key of Object.keys(schema)) if (!allowed.has(key)) throw new Error(`Unsupported schema keyword: ${key}`)
  const fail = () => { throw new Error(`Invalid annual contract at ${path}`) }
  if (schema.anyOf) {
    if (!schema.anyOf.some((branch: Record<string, any>) => {
      try { assertAnnualSchema(value, branch, path); return true } catch { return false }
    })) fail()
  }
  if ('const' in schema && value !== schema.const) fail()
  if (schema.enum && !schema.enum.includes(value)) fail()
  if (schema.type === 'null' && value !== null) fail()
  if (schema.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value))) fail()
  if (schema.type === 'integer' && ((value as number) < schema.minimum || (value as number) > schema.maximum)) fail()
  if (schema.type === 'string') {
    if (typeof value !== 'string') fail()
    const text = value as string
    if (text.length < (schema.minLength ?? 0) || text.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(text))) fail()
    if (!text.trim()) fail()
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail()
    const items = value as unknown[]
    if (items.length < schema.minItems || items.length > schema.maxItems) fail()
    if (schema.uniqueItems && new Set(items.map(item => JSON.stringify(item))).size !== items.length) fail()
    for (let index = 0; index < items.length; index++) {
      if (!Object.hasOwn(items, index)) fail()
      assertAnnualSchema(items[index], schema.items, `${path}[${index}]`)
    }
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail()
    const object = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!Object.hasOwn(object, key)) fail()
    for (const key of Object.keys(object)) {
      if (!Object.hasOwn(schema.properties, key)) fail()
      assertAnnualSchema(object[key], schema.properties[key], `${path}.${key}`)
    }
  }
}
