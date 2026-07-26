import { z } from 'zod'

const selector = z.string().trim().min(1).max(2_048)
const actionTimeout = z.number().int().min(100).max(120_000).optional()

const clickStep = z
  .object({
    action: z.literal('click'),
    selector,
    timeoutMs: actionTimeout,
  })
  .strict()

const fillStep = z
  .object({
    action: z.literal('fill'),
    selector,
    value: z.string().max(64 * 1_024),
    timeoutMs: actionTimeout,
  })
  .strict()

const pressStep = z
  .object({
    action: z.literal('press'),
    selector: selector.optional(),
    key: z.string().trim().min(1).max(100),
    timeoutMs: actionTimeout,
  })
  .strict()

const selectStep = z
  .object({
    action: z.literal('select'),
    selector,
    value: z.string().max(4_096),
    timeoutMs: actionTimeout,
  })
  .strict()

const checkStep = z
  .object({
    action: z.literal('check'),
    selector,
    checked: z.boolean().default(true),
    timeoutMs: actionTimeout,
  })
  .strict()

const waitForStep = z
  .object({
    action: z.literal('waitFor'),
    selector,
    state: z
      .enum(['attached', 'detached', 'visible', 'hidden'])
      .default('visible'),
    timeoutMs: actionTimeout,
  })
  .strict()

const waitStep = z
  .object({
    action: z.literal('wait'),
    durationMs: z.number().int().min(0).max(30_000),
  })
  .strict()

const assertTextStep = z
  .object({
    action: z.literal('assertText'),
    selector,
    text: z.string().max(64 * 1_024),
    exact: z.boolean().default(false),
    timeoutMs: actionTimeout,
  })
  .strict()

const assertVisibleStep = z
  .object({
    action: z.literal('assertVisible'),
    selector,
    visible: z.boolean().default(true),
    timeoutMs: actionTimeout,
  })
  .strict()

const screenshotStep = z
  .object({
    action: z.literal('screenshot'),
    name: z.string().trim().min(1).max(100).optional(),
    fullPage: z.boolean().default(false),
    timeoutMs: actionTimeout,
  })
  .strict()

export const desktopQaStepSchema = z.discriminatedUnion('action', [
  clickStep,
  fillStep,
  pressStep,
  selectStep,
  checkStep,
  waitForStep,
  waitStep,
  assertTextStep,
  assertVisibleStep,
  screenshotStep,
])

export function desktopQaRecordingPrivacyError(recording: {
  video?: boolean
  trace?: boolean
  redactSelectors?: string[]
}): string | null {
  if ((recording.redactSelectors?.length ?? 0) === 0) return null
  const raw = [
    ...(recording.video ? ['video'] : []),
    ...(recording.trace ? ['trace'] : []),
  ]
  return raw.length
    ? `redactSelectors cannot be combined with raw ${raw.join(
        ' and ',
      )} recording; disable raw recording and retain masked screenshots`
    : null
}

export const desktopQaFixtureSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(120),
    driver: z.literal('electron').default('electron'),
    launch: z
      .object({
        executablePath: z.string().trim().min(1).max(4_096).optional(),
        args: z.array(z.string().max(8_192)).max(100).default([]),
        cwd: z.string().trim().min(1).max(4_096).optional(),
        env: z.record(z.string().max(64 * 1_024)).optional(),
        timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
      })
      .strict(),
    ready: z
      .object({
        selector,
        timeoutMs: actionTimeout,
      })
      .strict()
      .optional(),
    steps: z.array(desktopQaStepSchema).min(1).max(200),
    recording: z
      .object({
        video: z.boolean().default(false),
        trace: z.boolean().default(true),
        screenshots: z.boolean().default(true),
        screenshotOnFailure: z.boolean().default(true),
        redactSelectors: z.array(selector).max(50).default([]),
      })
      .strict()
      .superRefine((recording, context) => {
        const error = desktopQaRecordingPrivacyError(recording)
        if (error) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: error,
            path: ['redactSelectors'],
          })
        }
      })
      .default({}),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(15 * 60_000)
      .default(2 * 60_000),
  })
  .strict()

export type DesktopQaFixture = z.infer<typeof desktopQaFixtureSchema>
export type DesktopQaStep = z.infer<typeof desktopQaStepSchema>

export function parseDesktopQaFixture(input: unknown): DesktopQaFixture {
  return desktopQaFixtureSchema.parse(input)
}

export function desktopQaFixtureJsonSchema(): Record<string, unknown> {
  const selectorProperty = {
    type: 'string',
    minLength: 1,
    maxLength: 2_048,
  }
  const timeoutProperty = {
    type: 'integer',
    minimum: 100,
    maximum: 120_000,
  }
  const step = (
    required: string[],
    properties: Record<string, unknown>,
  ): Record<string, unknown> => ({
    type: 'object',
    additionalProperties: false,
    required: ['action', ...required],
    properties,
  })
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://ur.dev/schemas/desktop-qa-fixture-v1.json',
    title: 'UR desktop QA fixture',
    type: 'object',
    additionalProperties: false,
    required: ['version', 'name', 'launch', 'steps'],
    properties: {
      version: { const: 1 },
      name: { type: 'string', minLength: 1, maxLength: 120 },
      driver: { const: 'electron', default: 'electron' },
      launch: {
        type: 'object',
        additionalProperties: false,
        properties: {
          executablePath: { type: 'string' },
          args: {
            type: 'array',
            maxItems: 100,
            items: { type: 'string' },
          },
          cwd: { type: 'string' },
          env: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
          timeoutMs: {
            type: 'integer',
            minimum: 1_000,
            maximum: 120_000,
          },
        },
      },
      ready: {
        type: 'object',
        additionalProperties: false,
        required: ['selector'],
        properties: {
          selector: selectorProperty,
          timeoutMs: timeoutProperty,
        },
      },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 200,
        items: {
          oneOf: [
            step(['selector'], {
              action: { const: 'click' },
              selector: selectorProperty,
              timeoutMs: timeoutProperty,
            }),
            step(['selector', 'value'], {
              action: { const: 'fill' },
              selector: selectorProperty,
              value: { type: 'string', maxLength: 65_536 },
              timeoutMs: timeoutProperty,
            }),
            step(['key'], {
              action: { const: 'press' },
              selector: selectorProperty,
              key: { type: 'string', minLength: 1, maxLength: 100 },
              timeoutMs: timeoutProperty,
            }),
            step(['selector', 'value'], {
              action: { const: 'select' },
              selector: selectorProperty,
              value: { type: 'string', maxLength: 4_096 },
              timeoutMs: timeoutProperty,
            }),
            step(['selector'], {
              action: { const: 'check' },
              selector: selectorProperty,
              checked: { type: 'boolean', default: true },
              timeoutMs: timeoutProperty,
            }),
            step(['selector'], {
              action: { const: 'waitFor' },
              selector: selectorProperty,
              state: {
                enum: ['attached', 'detached', 'visible', 'hidden'],
                default: 'visible',
              },
              timeoutMs: timeoutProperty,
            }),
            step(['durationMs'], {
              action: { const: 'wait' },
              durationMs: {
                type: 'integer',
                minimum: 0,
                maximum: 30_000,
              },
            }),
            step(['selector', 'text'], {
              action: { const: 'assertText' },
              selector: selectorProperty,
              text: { type: 'string', maxLength: 65_536 },
              exact: { type: 'boolean', default: false },
              timeoutMs: timeoutProperty,
            }),
            step(['selector'], {
              action: { const: 'assertVisible' },
              selector: selectorProperty,
              visible: { type: 'boolean', default: true },
              timeoutMs: timeoutProperty,
            }),
            step([], {
              action: { const: 'screenshot' },
              name: { type: 'string', minLength: 1, maxLength: 100 },
              fullPage: { type: 'boolean', default: false },
              timeoutMs: timeoutProperty,
            }),
          ],
        },
      },
      recording: {
        type: 'object',
        additionalProperties: false,
        properties: {
          video: { type: 'boolean', default: false },
          trace: { type: 'boolean', default: true },
          screenshots: { type: 'boolean', default: true },
          screenshotOnFailure: { type: 'boolean', default: true },
          redactSelectors: {
            type: 'array',
            maxItems: 50,
            items: selectorProperty,
            default: [],
          },
        },
        allOf: [
          {
            if: {
              required: ['redactSelectors'],
              properties: {
                redactSelectors: { minItems: 1 },
              },
            },
            then: {
              required: ['trace'],
              properties: {
                video: { const: false },
                trace: { const: false },
              },
            },
          },
        ],
      },
      timeoutMs: { type: 'integer', minimum: 1_000, maximum: 900_000 },
    },
  }
}
