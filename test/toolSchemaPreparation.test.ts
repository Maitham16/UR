import { describe, expect, test } from 'bun:test'
import { z, toJSONSchema } from 'zod/v4'
import {
  prepareAndValidateToolSchema,
  prepareToolSchema,
  validateToolSchema,
} from '../src/services/api/toolSchema.js'

describe('meta and vendor keys never reach a provider', () => {
  test('$schema emitted by zod is stripped', () => {
    const emitted = toJSONSchema(z.object({ a: z.string() })) as Record<string, unknown>
    expect(emitted.$schema).toBeDefined()
    expect(prepareToolSchema(emitted).$schema).toBeUndefined()
  })

  test('vendor keys are stripped at every depth, not just the root', () => {
    const prepared = prepareToolSchema({
      type: 'object',
      cache_control: { type: 'ephemeral' },
      properties: {
        nested: { type: 'string', cache_control: { type: 'ephemeral' } },
        deeper: {
          type: 'object',
          properties: { leaf: { type: 'string', defer_loading: true } },
        },
      },
    })
    expect(JSON.stringify(prepared)).not.toContain('cache_control')
    expect(JSON.stringify(prepared)).not.toContain('defer_loading')
    expect((prepared.properties as Record<string, unknown>).nested).toEqual({ type: 'string' })
  })
})

describe('local references are preserved and validated', () => {
  test('a recursive zod schema keeps its reference without expanding forever', () => {
    type N = { name: string; children?: N[] }
    const node: z.ZodType<N> = z.lazy(() =>
      z.object({ name: z.string(), children: z.array(node).optional() }),
    )
    const emitted = toJSONSchema(node) as Record<string, unknown>
    expect(JSON.stringify(emitted)).toContain('$ref')

    const prepared = prepareToolSchema(emitted)
    expect(JSON.stringify(prepared)).toContain('$ref')
    expect(validateToolSchema(prepared)).toEqual([])
  })

  test('a $defs pointer and its definition are preserved', () => {
    const prepared = prepareToolSchema({
      type: 'object',
      $defs: { Inner: { type: 'object', properties: { a: { type: 'string' } } } },
      properties: { one: { $ref: '#/$defs/Inner' } },
    })
    expect(prepared.$defs).toBeDefined()
    expect((prepared.properties as any).one).toEqual({
      $ref: '#/$defs/Inner',
    })
  })

  test('siblings of a $ref survive the inlining', () => {
    const prepared = prepareToolSchema({
      type: 'object',
      $defs: { Inner: { type: 'string' } },
      properties: { one: { $ref: '#/$defs/Inner', description: 'kept' } },
    })
    expect((prepared.properties as any).one).toEqual({
      $ref: '#/$defs/Inner',
      description: 'kept',
    })
  })

  test('an unresolvable reference is preserved and reported clearly', () => {
    const prepared = prepareToolSchema({
      type: 'object',
      properties: { one: { $ref: 'https://example.com/schema.json' } },
    })
    expect(JSON.stringify(prepared)).toContain('$ref')
    expect(validateToolSchema(prepared).some(issue => issue.message.includes('unresolved'))).toBe(true)
  })

  test('a reference cycle terminates instead of hanging', () => {
    const prepared = prepareToolSchema({
      type: 'object',
      properties: { self: { $ref: '#' } },
    })
    expect(JSON.stringify(prepared)).toContain('$ref')
    expect(validateToolSchema(prepared)).toEqual([])
  })
})

describe('field kinds survive preparation', () => {
  const schema = toJSONSchema(
    z.object({
      required_str: z.string(),
      optional_num: z.number().optional(),
      an_enum: z.enum(['a', 'b']),
      an_array: z.array(z.string()),
      a_union: z.union([z.string(), z.number()]),
      nullable: z.string().nullable(),
      nested: z.object({ inner: z.boolean() }),
    }),
  )

  test('required and optional are distinguished correctly', () => {
    const prepared = prepareToolSchema(schema)
    expect(prepared.required).toContain('required_str')
    expect(prepared.required).not.toContain('optional_num')
  })

  test('enum, array, union, nullable and nested objects are preserved', () => {
    const props = prepareToolSchema(schema).properties as Record<string, any>
    expect(props.an_enum.enum).toEqual(['a', 'b'])
    expect(props.an_array).toMatchObject({ type: 'array', items: { type: 'string' } })
    expect(props.a_union.anyOf).toHaveLength(2)
    expect(JSON.stringify(props.nullable)).toContain('null')
    expect(props.nested.properties.inner.type).toBe('boolean')
  })
})

describe('gemini dialect', () => {
  const source = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', default: 'x' },
      maybe: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      choice: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      nested: {
        type: 'object',
        additionalProperties: false,
        properties: { deep: { type: 'string' } },
      },
    },
    required: ['name'],
  }

  test('only genuinely unsupported keywords are removed at every depth', () => {
    const prepared = prepareToolSchema(source, 'gemini')
    const json = JSON.stringify(prepared)
    expect(json).toContain('additionalProperties')
    expect(json).not.toContain('$schema')
    expect(json).not.toContain('default')
    expect(json).toContain('oneOf')
  })

  test('anyOf with null remains standard JSON Schema', () => {
    const props = prepareToolSchema(source, 'gemini').properties as Record<string, any>
    expect(props.maybe).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] })
  })

  test('supported structure is untouched', () => {
    const prepared = prepareToolSchema(source, 'gemini')
    expect(prepared.required).toEqual(['name'])
    expect((prepared.properties as any).nested.properties.deep.type).toBe('string')
  })

  test('the gemini output validates under the gemini dialect', () => {
    expect(validateToolSchema(prepareToolSchema(source, 'gemini'), 'gemini')).toEqual([])
  })

  test('json-schema dialect keeps what gemini cannot take', () => {
    const prepared = prepareToolSchema(source, 'json-schema')
    expect(prepared.additionalProperties).toBe(false)
    expect((prepared.properties as any).name.default).toBe('x')
  })

  test('Gemini preserves modern refs and definitions', () => {
    const prepared = prepareToolSchema({
      type: 'object',
      $defs: { Choice: { oneOf: [{ type: 'string' }, { type: 'null' }] } },
      properties: { choice: { $ref: '#/$defs/Choice' } },
    }, 'gemini')
    expect((prepared.properties as any).choice.$ref).toBe('#/$defs/Choice')
    expect(prepared.$defs).toBeDefined()
    expect(validateToolSchema(prepared, 'gemini')).toEqual([])
  })
})

describe('pre-send validation catches malformed output', () => {
  test('an unresolved reference is reported', () => {
    const issues = validateToolSchema({ type: 'object', properties: { a: { $ref: '#/x' } } })
    expect(issues.some(i => i.message.includes('unresolved reference'))).toBe(true)
  })

  test('a required name with no matching property is reported', () => {
    const issues = validateToolSchema({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a', 'ghost'],
    })
    expect(issues.some(i => i.message.includes('"ghost"'))).toBe(true)
  })

  test('an array without items is reported', () => {
    const issues = validateToolSchema({
      type: 'object',
      properties: { list: { type: 'array' } },
    })
    expect(issues.some(i => i.message.includes('missing "items"'))).toBe(true)
  })

  test('an empty enum is reported', () => {
    const issues = validateToolSchema({
      type: 'object',
      properties: { e: { type: 'string', enum: [] } },
    })
    expect(issues.some(i => i.message.includes('"enum" must not be empty'))).toBe(true)
  })

  test('a non-object schema is reported rather than thrown', () => {
    expect(validateToolSchema('nope')[0]!.message).toContain('must be an object')
  })

  test('a non-object top-level parameter schema is rejected', () => {
    const issues = validateToolSchema({ type: 'string' })
    expect(issues.some(issue => issue.message.includes('top-level type'))).toBe(true)
  })

  test('a clean schema reports nothing', () => {
    expect(
      validateToolSchema({
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
      }),
    ).toEqual([])
  })

  test('schemas with reserved property names in properties maps are valid', () => {
    expect(
      validateToolSchema({
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'File type filter for ripgrep.',
          },
          '-n': {
            type: 'boolean',
            description: 'Show line numbers.',
          },
        },
      }),
    ).toEqual([])
  })
})

describe('failing clearly instead of retrying blindly', () => {
  test('the error names the tool and every issue', () => {
    expect(() =>
      prepareAndValidateToolSchema(
        { type: 'object', properties: { list: { type: 'array' } }, required: ['ghost'] },
        'MyTool',
      ),
    ).toThrow(/MyTool[\s\S]*missing "items"[\s\S]*ghost|MyTool[\s\S]*ghost[\s\S]*missing "items"/)
  })

  test('OpenAI strict schemas require closed objects and every property required', () => {
    expect(() =>
      prepareAndValidateToolSchema(
        { type: 'object', properties: { optional: { type: 'string' } } },
        'StrictTool',
        'json-schema',
        { openAIStrict: true },
      ),
    ).toThrow(/additionalProperties[\s\S]*missing from required/)
  })

  test('OpenAI strict validation preserves valid local definitions and refs', () => {
    const prepared = prepareAndValidateToolSchema({
      type: 'object',
      additionalProperties: false,
      properties: { node: { $ref: '#/$defs/Node' } },
      required: ['node'],
      $defs: {
        Node: {
          type: 'object',
          additionalProperties: false,
          properties: { value: { type: 'string' } },
          required: ['value'],
        },
      },
    }, 'RecursiveStrict', 'json-schema', { openAIStrict: true })
    expect((prepared.properties as any).node.$ref).toBe('#/$defs/Node')
    expect(prepared.$defs).toBeDefined()
  })

  test('a valid schema passes through unchanged in shape', () => {
    const prepared = prepareAndValidateToolSchema(
      toJSONSchema(z.object({ a: z.string() })),
      'MyTool',
    )
    expect(prepared).toMatchObject({ type: 'object', required: ['a'] })
  })
})

describe('degenerate input', () => {
  test('missing or non-object schemas become an empty parameter list', () => {
    for (const input of [undefined, null, 'x', 42, []]) {
      expect(prepareToolSchema(input)).toEqual({ type: 'object', properties: {} })
    }
  })

  test('an object schema without type or properties is completed', () => {
    expect(prepareToolSchema({ description: 'no type' })).toMatchObject({
      type: 'object',
      properties: {},
      description: 'no type',
    })
  })
})
