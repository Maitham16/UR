/**
 * Tool JSON Schema preparation and validation, shared by every provider path.
 *
 * Zod v4's toJSONSchema emits 2020-12 JSON Schema. Three things in that output
 * are not universally accepted, and each was previously forwarded verbatim:
 *
 *  1. `$schema`. Only the top-level vendor keys were stripped, so the dialect
 *     URI reached every provider. OpenAI rejects unknown keys under
 *     `strict: true`, and Gemini's Schema type (OpenAPI 3.0.3 derived) has no
 *     such field at all.
 *  2. `$ref` / `$defs`. A recursive tool schema emits `{"$ref": "#"}`. Gemini
 *     cannot express a reference, and OpenAI-compatible servers that are not
 *     OpenAI itself (Ollama, vLLM, llama.cpp) frequently fail to resolve one.
 *     References are inlined to a bounded depth instead.
 *  3. Vendor keys nested below the root. `cache_control` and friends were only
 *     deleted at depth 0, so any that appeared inside `properties` survived.
 *
 * Gemini additionally rejects keywords that the other providers accept, so it
 * gets a narrowed dialect. Everything else receives standard JSON Schema.
 *
 * Sources:
 *  - https://ai.google.dev/gemini-api/docs/function-calling
 *  - https://platform.openai.com/docs/guides/function-calling
 */

export type JsonSchemaObject = Record<string, unknown>

export type SchemaDialect = 'json-schema' | 'gemini'

/** Provider-private keys that must never be forwarded, at any depth. */
const VENDOR_KEYS = [
  'cache_control',
  'strict',
  'defer_loading',
  'eager_input_streaming',
] as const

/** Meta keywords that describe the document, not the value. */
const META_KEYS = ['$schema', '$id', '$anchor', '$comment'] as const

/**
 * Keywords Gemini's Schema type does not accept. `default` and `oneOf` are
 * documented as unsupported; `additionalProperties` and the exclusive bounds
 * are not part of its OpenAPI-derived subset.
 */
const GEMINI_UNSUPPORTED_KEYS = [
  'additionalProperties',
  'default',
  'oneOf',
  'not',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'patternProperties',
  'propertyNames',
  'const',
  'examples',
  'unevaluatedProperties',
] as const

/** Guard against a reference cycle that inlining cannot terminate. */
const MAX_INLINE_DEPTH = 8

function isObject(value: unknown): value is JsonSchemaObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Resolve a local JSON pointer (`#`, `#/$defs/Name`) against the document
 * root. Returns undefined for anything non-local, which is then dropped rather
 * than forwarded as an unresolvable reference.
 */
function resolvePointer(root: JsonSchemaObject, ref: string): unknown {
  if (ref === '#') return root
  if (!ref.startsWith('#/')) return undefined
  let current: unknown = root
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isObject(current)) return undefined
    current = current[segment]
  }
  return current
}

/**
 * Recursively rewrite a schema: strip meta and vendor keys, inline local
 * references, and apply dialect-specific removals.
 */
function rewrite(
  node: unknown,
  root: JsonSchemaObject,
  dialect: SchemaDialect,
  depth: number,
): unknown {
  if (Array.isArray(node)) {
    return node.map(item => rewrite(item, root, dialect, depth))
  }
  if (!isObject(node)) {
    return node
  }

  // A reference is replaced by its target so no provider has to resolve it.
  const ref = node.$ref
  if (typeof ref === 'string') {
    if (depth >= MAX_INLINE_DEPTH) {
      // Cycle guard. An unconstrained object is honest here: it says "some
      // object" rather than pointing at something the provider cannot follow.
      return { type: 'object' }
    }
    const target = resolvePointer(root, ref)
    if (isObject(target)) {
      const { $ref: _dropped, ...siblings } = node
      const inlined = rewrite(target, root, dialect, depth + 1)
      return isObject(inlined) ? { ...inlined, ...rewriteEntries(siblings, root, dialect, depth) } : inlined
    }
    // Unresolvable (remote or malformed) — drop the reference rather than send
    // a pointer the provider will reject.
    const { $ref: _unused, ...rest } = node
    return rewriteEntries(rest, root, dialect, depth)
  }

  return rewriteEntries(node, root, dialect, depth)
}

function rewriteEntries(
  node: JsonSchemaObject,
  root: JsonSchemaObject,
  dialect: SchemaDialect,
  depth: number,
): JsonSchemaObject {
  const out: JsonSchemaObject = {}
  for (const [key, value] of Object.entries(node)) {
    if ((VENDOR_KEYS as readonly string[]).includes(key)) continue
    if ((META_KEYS as readonly string[]).includes(key)) continue
    // $defs exist only to be pointed at; every pointer is now inlined.
    if (key === '$defs' || key === 'definitions') continue
    if (dialect === 'gemini' && (GEMINI_UNSUPPORTED_KEYS as readonly string[]).includes(key)) {
      continue
    }
    out[key] = rewrite(value, root, dialect, depth)
  }
  if (dialect === 'gemini') {
    return applyGeminiNullability(out)
  }
  return out
}

/**
 * Zod expresses `T | null` as `anyOf: [T, {type: 'null'}]`. Gemini has no
 * `null` type but does have `nullable`, so the pair is folded into the
 * equivalent it understands instead of being sent as an unusable union.
 */
function applyGeminiNullability(node: JsonSchemaObject): JsonSchemaObject {
  const anyOf = node.anyOf
  if (!Array.isArray(anyOf)) return node
  const nullBranches = anyOf.filter(b => isObject(b) && b.type === 'null')
  if (nullBranches.length === 0) return node
  const rest = anyOf.filter(b => !(isObject(b) && b.type === 'null'))
  if (rest.length === 1 && isObject(rest[0])) {
    const { anyOf: _dropped, ...siblings } = node
    return { ...rest[0], ...siblings, nullable: true }
  }
  return { ...node, anyOf: rest, nullable: true }
}

/**
 * Produce the schema object actually sent to a provider.
 *
 * Always returns a usable object schema; a missing or non-object input becomes
 * an empty parameter list rather than throwing, matching the prior contract.
 */
export function prepareToolSchema(
  schema: unknown,
  dialect: SchemaDialect = 'json-schema',
): JsonSchemaObject {
  if (!isObject(schema)) {
    return { type: 'object', properties: {} }
  }
  const root = schema
  const rewritten = rewrite(root, root, dialect, 0)
  const result = isObject(rewritten) ? rewritten : { type: 'object', properties: {} }
  // A function parameter list is an object by definition; some tools omit the
  // keyword and providers differ on whether they infer it.
  if (result.type === undefined) {
    result.type = 'object'
  }
  if (result.type === 'object' && result.properties === undefined) {
    result.properties = {}
  }
  return result
}

export type SchemaValidationIssue = {
  path: string
  message: string
}

/**
 * Check a prepared schema for the defects that make a provider reject a whole
 * request. Returns the issues found so the caller can fail with a specific
 * message instead of retrying an unchanged, still-malformed payload.
 */
export function validateToolSchema(
  schema: unknown,
  dialect: SchemaDialect = 'json-schema',
): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = []

  function walk(node: unknown, path: string, depth: number): void {
    if (depth > 64) {
      issues.push({ path, message: 'schema nests deeper than 64 levels' })
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1))
      return
    }
    if (!isObject(node)) return

    if (typeof node.$ref === 'string') {
      issues.push({ path, message: `unresolved reference "${node.$ref}"` })
    }
    for (const key of META_KEYS) {
      if (key in node) {
        issues.push({ path, message: `meta keyword "${key}" must not be sent` })
      }
    }
    for (const key of VENDOR_KEYS) {
      if (key in node) {
        issues.push({ path, message: `vendor key "${key}" must not be sent` })
      }
    }
    if (dialect === 'gemini') {
      for (const key of GEMINI_UNSUPPORTED_KEYS) {
        if (key in node) {
          issues.push({ path, message: `"${key}" is not supported by Gemini` })
        }
      }
      if (node.type === 'null') {
        issues.push({ path, message: 'Gemini has no null type; use nullable' })
      }
    }

    if (node.type === 'object' && node.properties !== undefined && !isObject(node.properties)) {
      issues.push({ path, message: '"properties" must be an object' })
    }
    if (node.required !== undefined) {
      if (!Array.isArray(node.required)) {
        issues.push({ path, message: '"required" must be an array' })
      } else if (isObject(node.properties)) {
        for (const name of node.required) {
          if (typeof name === 'string' && !(name in node.properties)) {
            issues.push({
              path,
              message: `required property "${name}" is not defined in properties`,
            })
          }
        }
      }
    }
    if (node.type === 'array' && node.items === undefined) {
      issues.push({ path, message: 'array schema is missing "items"' })
    }
    if (Array.isArray(node.enum) && node.enum.length === 0) {
      issues.push({ path, message: '"enum" must not be empty' })
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'enum' || key === 'required') continue
      walk(value, path ? `${path}.${key}` : key, depth + 1)
    }
  }

  if (!isObject(schema)) {
    return [{ path: '', message: 'tool schema must be an object' }]
  }
  walk(schema, '', 0)
  return issues
}

/**
 * Prepare and check in one step. Throws with every issue listed rather than
 * letting a provider reject the request with an opaque error that invites a
 * blind retry of the same payload.
 */
export function prepareAndValidateToolSchema(
  schema: unknown,
  toolName: string,
  dialect: SchemaDialect = 'json-schema',
): JsonSchemaObject {
  const prepared = prepareToolSchema(schema, dialect)
  const issues = validateToolSchema(prepared, dialect)
  if (issues.length > 0) {
    const detail = issues
      .map(issue => `  - ${issue.path || '<root>'}: ${issue.message}`)
      .join('\n')
    throw new Error(
      `Tool "${toolName}" produced a schema that ${dialect === 'gemini' ? 'Gemini' : 'the provider'} cannot accept:\n${detail}`,
    )
  }
  return prepared
}
