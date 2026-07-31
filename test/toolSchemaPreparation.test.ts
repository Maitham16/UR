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

describe('local references are inlined', () => {
  test('a recursive zod schema emits $ref and is inlined away', () => {
    type N = { name: string; children?: N[] }
    const node: z.ZodType<N> = z.lazy(() =>
      z.object({ name: z.string(), children: z.array(node).optional() }),
    )
    const emitted = toJSONSchema(node) as Record<string, unknown>
    expect(JSON.stringify(emitted)).toContain('$ref')

    const prepared = prepareToolSchema(emitted)
    expect(JSON.stringify(prepared)).not.toContain('$ref')
    expect(validateToolSchema(prepared)).toEqual([])
  })

  test('a $defs pointer is resolved and the $defs block removed', () => {
    const prepared = prepareToolSchema({
      type: 'object',
      $defs: { Inner: { type: 'object', properties: { a: { type: 'string' } } } },
      properties: { one: { $ref: '#/$defs/Inner' } },
    })
    expect(prepared.$defs).toBeUndefined()
    expect((prepared.properties as any).one).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
    })
  })

  test('siblings of a $ref survive the inlining', () => {
    const prepared = prepareToolSchema({
      type: 'object',
      $defs: { Inner: { type: 'string' } },
      properties: { one: { $ref: '#/$defs/Inner', description: 'kept' } },
    })
    expect((prepared.properties as any).one).toEqual({ type: 'string', description: 'kept' })
  })

  test('an unresolvable reference is dropped, not forwarded', () => {
    const prepared = prepareToolSchema({
      type: 'object',
      properties: { one: { $ref: 'https://example.com/schema.json' } },
    })
    expect(JSON.stringify(prepared)).not.toContain('$ref')
    expect(validateToolSchema(prepared)).toEqual([])
  })

  test('a reference cycle terminates instead of hanging', () => {
    const prepared = prepareToolSchema({
      type: 'object',
      properties: { self: { $ref: '#' } },
    })
    expect(JSON.stringify(prepared)).not.toContain('$ref')
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

  test('unsupported keywords are removed at every depth', () => {
    const prepared = prepareToolSchema(source, 'gemini')
    const json = JSON.stringify(prepared)
    expect(json).not.toContain('additionalProperties')
    expect(json).not.toContain('$schema')
    expect(json).not.toContain('default')
    expect(json).not.toContain('oneOf')
  })

  test('anyOf with null folds into nullable', () => {
    const props = prepareToolSchema(source, 'gemini').properties as Record<string, any>
    expect(props.maybe).toEqual({ type: 'string', nullable: true })
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

  test('a clean schema reports nothing', () => {
    expect(
      validateToolSchema({
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
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
