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
 *  2. Vendor keys nested below the root. `cache_control` and friends were only
 *     deleted at depth 0, so any that appeared inside `properties` survived.
 *
 * Local `$ref`/`$defs` are deliberately preserved. OpenAI supports recursive
 * schemas and Gemini's current `parametersJsonSchema` accepts JSON Schema
 * references; inlining recursive references changes their meaning.
 *
 * Sources:
 *  - https://ai.google.dev/gemini-api/docs/function-calling
 *  - https://platform.openai.com/docs/guides/function-calling
 */

export type JsonSchemaObject = Record<string, unknown>

export type SchemaDialect = 'json-schema' | 'gemini'

import { type ZodTypeAny } from 'zod/v4'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'

/** Provider-private keys that must never be forwarded, at any depth. */
const VENDOR_KEYS = [
  'cache_control',
  'strict',
  'defer_loading',
  'eager_input_streaming',
] as const

/** Document-only keywords not accepted inside provider parameter payloads. */
const META_KEYS = ['$schema', '$comment'] as const

	function asJsonSchemaCandidate(schema: unknown): unknown {
	  if (
	    typeof schema === 'object' &&
	    schema !== null &&
	    ('def' in schema || '_def' in schema) &&
	    typeof (schema as { parse?: unknown }).parse === 'function'
	  ) {
	    return zodToJsonSchema(schema as ZodTypeAny)
	  }
  return schema
}

/**
 * Keywords outside Gemini's documented `parametersJsonSchema` subset. Modern
 * Gemini does support refs, oneOf, additionalProperties, and null types.
 */
const GEMINI_UNSUPPORTED_KEYS = [
  'default',
  'not',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'patternProperties',
  'propertyNames',
  'const',
  'examples',
  'unevaluatedProperties',
] as const

function isObject(value: unknown): value is JsonSchemaObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Resolve a local JSON pointer (`#`, `#/$defs/Name`) against the document
 * root. Local anchors are supported as well. Undefined means the provider
 * payload would contain an unresolvable or remote reference and is rejected.
 */
function resolvePointer(root: JsonSchemaObject, ref: string): unknown {
  if (ref === '#') return root
  if (ref.startsWith('#') && !ref.startsWith('#/')) {
    const anchor = ref.slice(1)
    const pending: unknown[] = [root]
    const seen = new Set<unknown>()
    while (pending.length > 0) {
      const current = pending.pop()
      if (!current || typeof current !== 'object' || seen.has(current)) continue
      seen.add(current)
      if (
        isObject(current) &&
        (current.$anchor === anchor || current.$id === ref)
      ) {
        return current
      }
      pending.push(...(Array.isArray(current) ? current : Object.values(current)))
    }
    return undefined
  }
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
 * Recursively rewrite a schema: strip meta/vendor keys and apply only the
 * provider-specific removals documented for the selected dialect.
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
    if (dialect === 'gemini' && (GEMINI_UNSUPPORTED_KEYS as readonly string[]).includes(key)) {
      continue
    }
    out[key] = rewrite(value, root, dialect, depth)
  }
  return out
}

/**
 * Produce the schema object actually sent to a provider.
 *
 * Preparation is deliberately separate from validation for callers that need
 * diagnostics. Production adapters use `prepareAndValidateToolSchema`.
 */
export function prepareToolSchema(
  schema: unknown,
  dialect: SchemaDialect = 'json-schema',
): JsonSchemaObject {
  const candidate = asJsonSchemaCandidate(schema)
  if (!isObject(candidate)) {
    return { type: 'object', properties: {} }
  }
  const root = candidate
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
  const root = isObject(schema) ? schema : undefined
  const allowedTypes = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

  function walk(
    node: unknown,
    path: string,
    depth: number,
    inPropertiesObject = false,
  ): void {
    if (depth > 64) {
      issues.push({ path, message: 'schema nests deeper than 64 levels' })
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1))
      return
    }
    if (!isObject(node)) return

    if (node.$ref !== undefined) {
      if (typeof node.$ref !== 'string' || !root || resolvePointer(root, node.$ref) === undefined) {
        issues.push({ path, message: `unresolved reference "${String(node.$ref)}"` })
      }
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
    }

    if (!inPropertiesObject && node.type !== undefined) {
      const types = Array.isArray(node.type) ? node.type : [node.type]
      if (
        types.length === 0 ||
        types.some(type => typeof type !== 'string' || !allowedTypes.has(type))
      ) {
        issues.push({ path, message: '"type" contains an unsupported JSON Schema type' })
      }
    }

    if (node.type === 'object' && node.properties !== undefined && !isObject(node.properties)) {
      issues.push({ path, message: '"properties" must be an object' })
    }
    if (isObject(node.properties)) {
      for (const [name, propertySchema] of Object.entries(node.properties)) {
        if (!isObject(propertySchema)) {
          issues.push({
            path: path ? `${path}.properties.${name}` : `properties.${name}`,
            message: 'property schema must be an object',
          })
        }
      }
    }
    if (node.required !== undefined) {
      if (!Array.isArray(node.required)) {
        issues.push({ path, message: '"required" must be an array' })
      } else {
        const names = new Set<string>()
        for (const name of node.required) {
          if (typeof name !== 'string' || name.length === 0) {
            issues.push({ path, message: 'every "required" entry must be a non-empty string' })
            continue
          }
          if (names.has(name)) {
            issues.push({ path, message: `required property "${name}" is duplicated` })
          }
          names.add(name)
          if (!isObject(node.properties) || !(name in node.properties)) {
            issues.push({
              path,
              message: `required property "${name}" is not defined in properties`,
            })
          }
        }
      }
    }
    if (node.type === 'array' && node.items === undefined && node.prefixItems === undefined) {
      issues.push({ path, message: 'array schema is missing "items"' })
    }
    if (node.items !== undefined && !isObject(node.items)) {
      issues.push({ path, message: '"items" must be a schema object' })
    }
    if (Array.isArray(node.enum) && node.enum.length === 0) {
      issues.push({ path, message: '"enum" must not be empty' })
    }
    for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
      if (node[keyword] !== undefined && (!Array.isArray(node[keyword]) || node[keyword].length === 0)) {
        issues.push({ path, message: `"${keyword}" must be a non-empty array` })
      } else if (
        Array.isArray(node[keyword]) &&
        node[keyword].some(branch => !isObject(branch))
      ) {
        issues.push({ path, message: `every "${keyword}" branch must be a schema object` })
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'enum' || key === 'required') continue
      walk(value, path ? `${path}.${key}` : key, depth + 1, key === 'properties')
    }
  }

  if (!isObject(schema)) {
    return [{ path: '', message: 'tool schema must be an object' }]
  }
  if (schema.type !== 'object') {
    issues.push({ path: '', message: 'tool parameter schema must have top-level type "object"' })
  }
  walk(schema, '', 0, false)
  return issues
}

export class ToolSchemaValidationError extends Error {
  override readonly name = 'ToolSchemaValidationError'
}

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u

export function assertValidToolName(name: unknown, providerLabel: string): asserts name is string {
  if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) {
    throw new ToolSchemaValidationError(
      `${providerLabel} tool name "${String(name)}" must match ${TOOL_NAME_PATTERN.source}.`,
    )
  }
}

export function assertUniqueToolNames(names: string[], providerLabel: string): void {
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) {
      throw new ToolSchemaValidationError(`${providerLabel} tool list contains duplicate name "${name}".`)
    }
    seen.add(name)
  }
}

export function validateOpenAIStrictToolSchema(schema: JsonSchemaObject): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = []

  function walk(node: unknown, path: string): void {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    if (!isObject(node)) return
    if (node.type === 'object' || node.properties !== undefined) {
      if (node.additionalProperties !== false) {
        issues.push({ path, message: 'OpenAI strict objects require additionalProperties: false' })
      }
      if (isObject(node.properties)) {
        const propertyNames = Object.keys(node.properties)
        const required = Array.isArray(node.required)
          ? node.required.filter((name): name is string => typeof name === 'string')
          : []
        const missing = propertyNames.filter(name => !required.includes(name))
        if (missing.length > 0) {
          issues.push({
            path,
            message: `OpenAI strict requires every property; missing from required: ${missing.join(', ')}`,
          })
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'enum' || key === 'required') continue
      walk(value, path ? `${path}.${key}` : key)
    }
  }

  walk(schema, '')
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
  options: { openAIStrict?: boolean } = {},
): JsonSchemaObject {
  if (!isObject(schema)) {
    throw new ToolSchemaValidationError(
      `Tool "${toolName}" produced a schema that the provider cannot accept:\n  - <root>: tool schema must be an object`,
    )
  }
  const prepared = prepareToolSchema(schema, dialect)
  const issues = [
    ...validateToolSchema(prepared, dialect),
    ...(options.openAIStrict ? validateOpenAIStrictToolSchema(prepared) : []),
  ]
  if (issues.length > 0) {
    const detail = issues
      .map(issue => `  - ${issue.path || '<root>'}: ${issue.message}`)
      .join('\n')
    throw new ToolSchemaValidationError(
      `Tool "${toolName}" produced a schema that ${dialect === 'gemini' ? 'Gemini' : 'the provider'} cannot accept:\n${detail}`,
    )
  }
  return prepared
}
