import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import * as React from 'react';
import { getAllowedChannels, getQuestionPreviewFormat } from 'src/bootstrap/state.js';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { BLACK_CIRCLE } from 'src/constants/figures.js';
import { getModeColor } from 'src/utils/permissions/PermissionMode.js';
import { parseToolInputJsonLenient } from 'src/utils/json.js';
import { z } from 'zod/v4';
import { Box, Text } from '../../ink.js';
import type { Tool } from '../../Tool.js';
import { buildTool, type ToolDef } from '../../Tool.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { ASK_USER_QUESTION_TOOL_CHIP_WIDTH, ASK_USER_QUESTION_TOOL_NAME, ASK_USER_QUESTION_TOOL_PROMPT, DESCRIPTION, PREVIEW_FEATURE_PROMPT } from './prompt.js';
import { repairSingleOptionQuestions } from './normalizeQuestions.js';
function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const out = String(value).trim()
    return out
  }
  const nested = objectValue(value);
  if (!nested) return '';
  const candidates = [
    'text',
    'label',
    'name',
    'title',
    'description',
    'value',
    'question',
    'prompt',
    'query',
    'body',
    'goal',
    'header',
  ] as const
  for (const key of candidates) {
    const candidate = nested[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  const values = Object.values(nested);
  if (values.length === 1) return stringFromUnknown(values[0]);
  return '';
}

function valueByAliases(input: Record<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    const exact = input[alias];
    if (exact !== undefined) return exact;
  }
  for (const alias of aliases) {
    const target = alias.toLowerCase();
    for (const [key, value] of Object.entries(input)) {
      if (key.toLowerCase() === target) return value;
    }
  }
  return undefined;
}

const RESERVED_QUESTION_OPTION_KEYS = new Set([
  'options',
  'option',
  'choices',
  'values',
  'items',
  'alternatives',
  'candidates',
  'selections',
  'answers',
])

const RESERVED_QUESTION_KEYS = new Set([
  'question',
  'questionText',
  'question_text',
  'q',
  'query',
  'prompt',
  'text',
  'title',
  'message',
  'body',
  'goal',
  'name',
  'header',
  'multiSelect',
  'metadata',
])

function parseOptionListText(value: string): string[] | null {
  const raw = value.trim()
  if (!raw) return null
  const hasDelimiter = /[,\n;|]/.test(raw)
  if (!hasDelimiter) return null
  const lines = raw
    .split(/\n/)
    .flatMap(line => line.split(/[,;|]/))
    .map(item => item.trim())
    .map(item => item.replace(/^[\s"'`*[\]{}()<>_–—-]+/, '').replace(/[\s"'`*[\]{}()<>.,;:!?]+$/g, ''))
    .filter(item => item.length > 0 && item.length <= 80)
  if (lines.length < 2) return null
  const unique: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(line)
    if (unique.length > 8) return null
  }
  return unique
}

function headerFromQuestion(question: string, index: number): string {
  const stopWords = new Set(['a', 'about', 'also', 'an', 'are', 'be', 'do', 'does', 'for', 'is', 'or', 'should', 'support', 'that', 'the', 'this', 'to', 'want', 'what', 'which', 'with', 'without', 'you']);
  const word = question.replace(/[^A-Za-z0-9]+/g, ' ').split(/\s+/).find(part => part && !stopWords.has(part.toLowerCase())) ?? `Question ${index + 1}`;
  return word.slice(0, ASK_USER_QUESTION_TOOL_CHIP_WIDTH);
}

function inferQuestionFromSingleKeyQuestion(question: Record<string, unknown>): {
  questionText: string
  options: unknown
} | null {
  const entries = Object.entries(question).filter(([key]) => !RESERVED_QUESTION_KEYS.has(key))
  if (entries.length !== 1) return null
  const [key, value] = entries[0]!
  if (RESERVED_QUESTION_OPTION_KEYS.has(key.toLowerCase()) || !key.trim()) return null
  if (!value) return null
  return { questionText: key.trim(), options: value }
}

function stringField(input: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = valueByAliases(input, [name]);
    const candidate = stringFromUnknown(value);
    if (candidate.length > 0) return candidate;
  }
  return '';
}
function objectOptionValues(value: unknown): unknown[] | null {
  if (!objectValue(value)) return null
  const values = Object.values(value)
  if (!Array.isArray(values) || values.length === 0) return null
  return values
}

function normalizeQuestionOptionInput(value: unknown): unknown {
  if (typeof value === 'string') {
    const label = value.trim();
    return label ? {
      label,
      description: label
    } : value;
  }
  const option = objectValue(value)
  if (!option) return value
  const label =
    (typeof option.label === 'string' && option.label.trim()) ||
    (typeof option.value === 'string' && option.value.trim()) ||
    (typeof option.name === 'string' && option.name.trim()) ||
    (typeof option.text === 'string' && option.text.trim()) ||
    (typeof option.title === 'string' && option.title.trim()) ||
    // `header` is this tool's word for a question's category chip, which is
    // exactly why models reach for it when naming a choice.
    (typeof option.header === 'string' && option.header.trim()) ||
    (typeof option.id === 'string' && option.id.trim()) ||
    (typeof option.description === 'string' && option.description.trim()) ||
    ''
  if (!label) return value
  const description =
    (typeof option.description === 'string' && option.description.trim()) || label
  if (!label || !description) return value;
  return {
    label,
    description,
    ...(typeof option.preview === 'string' ? {
      preview: option.preview
    } : {})
  };
}
// The question text accepted eight aliases while the options array accepted
// exactly one key, so a model that said `choices` failed with *both* fields
// reported missing — the text was never looked up because the options check
// bailed first. Per-question options also arrive as a JSON string from small
// models, which only the top-level single-question form parsed.
function optionsField(question: Record<string, unknown>): unknown[] | null {
  for (const name of RESERVED_QUESTION_OPTION_KEYS) {
    const value = valueByAliases(question, [name]);
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const parsed = parseToolInputJsonLenient(value);
      if (Array.isArray(parsed)) return parsed;
      const objectParsedOptions = objectOptionValues(parsed)
      if (objectParsedOptions) return objectParsedOptions;
      const delimited = parseOptionListText(value)
      if (delimited) return delimited
    }
    const objectOptions = objectOptionValues(value)
    if (objectOptions) return objectOptions
    if (typeof value === 'string') {
      const delimited = parseOptionListText(value)
      if (delimited) return delimited
    }
  }
  return null;
}

function coerceQuestionValueToOptions(question: Record<string, unknown>): unknown[] | null {
  for (const [key, value] of Object.entries(question)) {
    if (RESERVED_QUESTION_KEYS.has(key)) continue
    if (RESERVED_QUESTION_OPTION_KEYS.has(key.toLowerCase())) continue
    const options = optionsField({ [key]: value, ...question })
    if (options) return options
    if (Array.isArray(value)) return value
    if (typeof value === 'string') {
      const parsed = parseToolInputJsonLenient(value)
      if (Array.isArray(parsed)) return parsed
      const delimited = parseOptionListText(value)
      if (delimited) return delimited
    }
    const objectOptions = objectOptionValues(value)
    if (objectOptions) return objectOptions
  }
  return null
}

/**
 * True when an entry carries a choice rather than a question: it has option
 * shape (a label, or a description with no question text) and none of the keys
 * a question is recognized by.
 */
function looksLikeOptionEntry(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  const entry = objectValue(value)
  if (!entry) return false
  for (const key of Object.keys(entry)) {
    // `header` is the one question key that is equally an option key: it is
    // this tool's word for a short label, so a model naming a choice reaches
    // for it. An entry carrying a header and nothing else question-shaped is a
    // choice, not a question — a question would have brought its options.
    if (key === 'header') continue
    if (RESERVED_QUESTION_KEYS.has(key)) return false
    if (RESERVED_QUESTION_OPTION_KEYS.has(key.toLowerCase())) return false
  }
  return (
    typeof entry.label === 'string' ||
    typeof entry.value === 'string' ||
    typeof entry.header === 'string' ||
    typeof entry.description === 'string'
  )
}

/**
 * Recovers the common shape where a model flattens one question's choices
 * straight into `questions`, so options arrive as question objects that each
 * carry a label and a description and no question text at all.
 *
 * Everything needed is present — it is nested one level wrong — so the array
 * is folded back into the options of a single question. Prefer question text
 * the payload already carries at the top level. If the model omitted it, use a
 * neutral prompt instead of throwing field errors and discarding valid
 * choices; this does not infer any domain-specific intent.
 */
function recoverFlattenedOptions(
  input: Record<string, unknown>,
  entries: unknown[],
): unknown | null {
  if (entries.length < 1 || !entries.every(looksLikeOptionEntry)) return null
  const questionText =
    stringField(input, [
      'question',
      'questionText',
      'question_text',
      'q',
      'query',
      'prompt',
      'text',
      'title',
      'message',
      'body',
      'goal',
      'header',
    ]) || 'Which option should I choose?'
  return normalizeQuestionInput({ ...input, question: questionText, options: entries }, 0)
}

function normalizeQuestionInput(value: unknown, index: number): unknown {
  const question = objectValue(value);
  if (!question) return null;
  const options = optionsField(question);
  const fallbackQuestion = inferQuestionFromSingleKeyQuestion(question);
  const usedFallback = fallbackQuestion !== null
  const normalizedQuestionText = usedFallback ? fallbackQuestion!.questionText : undefined
  const fallbackOptions = usedFallback ? fallbackQuestion!.options : null
  const effectiveOptions =
    options ??
    (fallbackOptions ? coerceQuestionValueToOptions({ ...question, options: fallbackOptions }) : null)
  if (!effectiveOptions) return null;
  const questionText = normalizedQuestionText || stringField(question, [
    'question',
    'questionText',
    'question_text',
    'q',
    'query',
    'prompt',
    'text',
    'title',
    'message',
    'body',
    'goal',
    'name',
    'header',
  ]);
  if (!questionText) return null;
  return {
    question: questionText,
    header:
      typeof question.header === 'string' && question.header.trim()
        ? question.header.trim().slice(0, ASK_USER_QUESTION_TOOL_CHIP_WIDTH)
        : headerFromQuestion(questionText, index),
    options: effectiveOptions.map(normalizeQuestionOptionInput),
    ...(typeof question.multiSelect === 'boolean' ? {
      multiSelect: question.multiSelect
    } : {})
  };
}
export function normalizeAskUserQuestionInput(value: unknown): unknown {
  const input = objectValue(value);
  if (!input) return value;
  const commonFields = {
    ...(objectValue(input.answers) ? {
      answers: input.answers
    } : {}),
    ...(objectValue(input.annotations) ? {
      annotations: input.annotations
    } : {}),
    ...(objectValue(input.metadata) ? {
      metadata: input.metadata
    } : {})
  };
  // Models (especially small local ones) sometimes send `questions` or
  // `options` as a JSON string instead of an actual array. Parse it before
  // the array checks so zod sees the real structure.
  if (typeof input.questions === 'string') {
    const parsed = parseToolInputJsonLenient(input.questions);
    if (Array.isArray(parsed) || objectValue(parsed)) input.questions = parsed as unknown;
  }
  if (typeof input.options === 'string') {
    const parsed = parseToolInputJsonLenient(input.options);
    if (Array.isArray(parsed)) input.options = parsed;
    if (objectOptionValues(parsed)) input.options = parsed;
  }
  if (objectValue(input.questions)) {
    const map = input.questions
    const questions = Object.entries(map).map(([questionText, raw], index) => {
      const entry =
        typeof raw === 'string' || Array.isArray(raw) || objectValue(raw)
          ? normalizeQuestionInput({ question: questionText, options: raw }, index)
          : null
      return entry
    })
    const normalized = repairSingleOptionQuestions(questions.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object'))
    if (normalized.length > 0) {
      return {
        questions: normalized.slice(0, 4),
        ...commonFields
      }
    }
    return input;
  }
  if (Array.isArray(input.questions)) {
    const normalized = input.questions
      .map((entry, index) => normalizeQuestionInput(entry, index))
      .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object')
    if (normalized.length > 0) {
      return {
        // Duplicates are repaired here rather than rejected by the uniqueness
        // refinement, which would fail the call and force a retry round trip.
        questions: repairSingleOptionQuestions(normalized),
        ...commonFields
      };
    }
    // Nothing normalized as a question. Before giving up, check whether the
    // array is actually one question's option list that the model flattened
    // a level too high — the shape that produced paired "question must be a
    // non-empty string / options must be an array" errors for every entry.
    const recovered = recoverFlattenedOptions(input, input.questions)
    if (recovered && typeof recovered === 'object') {
      return {
        questions: repairSingleOptionQuestions([recovered]),
        ...commonFields
      };
    }
    return input;
  }
  if (optionsField(input) !== null) {
    const singleQuestion = normalizeQuestionInput(input, 0);
    if (singleQuestion && singleQuestion !== input) {
      // Duplicates are repaired here rather than rejected by the uniqueness
      // refinement, which would fail the call and force a retry round trip.
      return {
        questions: repairSingleOptionQuestions([singleQuestion]),
        ...commonFields
      };
    }
  }
  // Repair failed. Hand back what the model actually sent rather than null:
  // null erases the payload, so validation and the error message that reaches
  // the model both describe the erasure ("Input must be an object with a
  // `questions` array") instead of the real defect, and the model has nothing
  // to correct. Returning the input keeps the diagnosis specific.
  return input;
}
const questionOptionSchema = lazySchema(() => z.object({
  label: z.string().describe('The choice itself, 1-5 words. Name the option, do not restate the question: for "Which database?" use "PostgreSQL", not "Use PostgreSQL for the database".'),
  description: z.string().describe('What actually happens if this is chosen, and the cost of choosing it — the information the user needs that the label does not already give them. Must NOT restate the label in a full sentence. Bad: label "PostgreSQL" / description "Use PostgreSQL." Good: label "PostgreSQL" / description "Relational, strong consistency; needs a running server and a migration step." Include the trade-off, limitation, or consequence that makes this choice different from the others.'),
  preview: z.string().optional().describe('Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options. See the tool description for the expected content format.')
}));
const questionSchema = lazySchema(() => z.object({
  question: z.string().describe('The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"'),
  header: z.string().describe(`The category being decided, as a chip/tag (max ${ASK_USER_QUESTION_TOOL_CHIP_WIDTH} chars). Name the dimension, not the question: for "Which database should we use?" the header is "Database", not "Which DB". Examples: "Auth method", "Library", "Approach".`),
  options: z.array(questionOptionSchema()).min(2).describe(`REQUIRED: at least 2 concrete choices. Prefer 2-8 when that is enough for a focused decision, but preserve every meaningful choice when the decision genuinely has more. A question with no options is not askable here — if you cannot name at least two specific answers, the question is open-ended, so ask it in plain assistant text instead of calling this tool. Do not call this tool with a prose question and omit options. Keep options concise and distinct; there should be no 'Other' option, that will be provided automatically.`),
  multiSelect: z.boolean().default(false).describe('Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.')
}));
const annotationsSchema = lazySchema(() => {
  const annotationSchema = z.object({
    preview: z.string().optional().describe('The preview content of the selected option, if the question used previews.'),
    notes: z.string().optional().describe('Free-text notes the user added to their selection.')
  });
  return z.record(z.string(), annotationSchema).optional().describe('Optional per-question annotations from the user (e.g., notes on preview selections). Keyed by question text.');
});
const UNIQUENESS_REFINE = {
  check: (data: {
    questions: {
      question: string;
      options: {
        label: string;
      }[];
    }[];
  }) => {
    const questions = data.questions.map(q => q.question);
    if (questions.length !== new Set(questions).size) {
      return false;
    }
    for (const question of data.questions) {
      const labels = question.options.map(opt => opt.label);
      if (labels.length !== new Set(labels).size) {
        return false;
      }
    }
    return true;
  },
  message: 'Question texts must be unique, option labels must be unique within each question'
} as const;
const commonFields = lazySchema(() => ({
  answers: z.record(z.string(), z.string()).optional().describe('User answers collected by the permission component'),
  annotations: annotationsSchema(),
  metadata: z.object({
    source: z.string().optional().describe('Optional identifier for the source of this question (e.g., "remember" for /remember command). Used for analytics tracking.')
  }).optional().describe('Optional metadata for tracking and analytics purposes. Not displayed to user.')
}));
const inputSchema = lazySchema(() => z.preprocess(normalizeAskUserQuestionInput, z.strictObject({
  questions: z.array(questionSchema()).min(1).max(4).describe('Questions to ask the user (1-4 questions)'),
  ...commonFields()
}).refine(UNIQUENESS_REFINE.check, {
  message: UNIQUENESS_REFINE.message
})));
type InputSchema = ReturnType<typeof inputSchema>;
const outputSchema = lazySchema(() => z.object({
  questions: z.array(questionSchema()).describe('The questions that were asked'),
  answers: z.record(z.string(), z.string()).describe('The answers provided by the user (question text -> answer string; multi-select answers are comma-separated)'),
  annotations: annotationsSchema()
}));
type OutputSchema = ReturnType<typeof outputSchema>;

// SDK schemas are identical to internal schemas now that `preview` and
// `annotations` are public (configurable via `toolConfig.askUserQuestion`).
export const _sdkInputSchema = inputSchema;
export const _sdkOutputSchema = outputSchema;
export type Question = z.infer<ReturnType<typeof questionSchema>>;
export type QuestionOption = z.infer<ReturnType<typeof questionOptionSchema>>;
export type Output = z.infer<OutputSchema>;
function AskUserQuestionResultMessage(t0) {
  const $ = _c(3);
  const {
    answers
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Box flexDirection="row"><Text color={getModeColor("default")}>{BLACK_CIRCLE} </Text><Text>User answered UR's questions:</Text></Box>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== answers) {
    t2 = <Box flexDirection="column" marginTop={1}>{t1}<MessageResponse><Box flexDirection="column">{Object.entries(answers).map(_temp)}</Box></MessageResponse></Box>;
    $[1] = answers;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  return t2;
}
function _temp(t0) {
  const [questionText, answer] = t0;
  return <Text key={questionText} color="inactive">· {questionText} → {answer}</Text>;
}
export const AskUserQuestionTool: Tool<InputSchema, Output> = buildTool({
  name: ASK_USER_QUESTION_TOOL_NAME,
  permissionRequestKind: 'ask-user-question',
  searchHint: 'prompt the user with a multiple-choice question',
  maxResultSizeChars: 100_000,
  shouldDefer: false,
  async description() {
    return DESCRIPTION;
  },
  async prompt() {
    const format = getQuestionPreviewFormat();
    if (format === undefined) {
      // SDK consumer that hasn't opted into a preview format — omit preview
      // guidance (they may not render the field at all).
      return ASK_USER_QUESTION_TOOL_PROMPT;
    }
    return ASK_USER_QUESTION_TOOL_PROMPT + PREVIEW_FEATURE_PROMPT[format];
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName() {
    return '';
  },
  isEnabled() {
    // When --channels is active the user is likely on Telegram/Discord, not
    // watching the TUI. The multiple-choice dialog would hang with nobody at
    // the keyboard. Channel permission relay already skips
    // requiresUserInteraction() tools (interactiveHandler.ts) so there's
    // no alternate approval path.
    if ((feature('KAIROS') || feature('KAIROS_CHANNELS')) && getAllowedChannels().length > 0) {
      return false;
    }
    return true;
  },
  isConcurrencySafe() {
    // Each call owns an interactive focus surface. Serializing prevents two
    // otherwise-independent model calls from rendering duplicate/overlapping
    // question dialogs and racing their answers.
    return false;
  },
  isReadOnly() {
    return true;
  },
  toAutoClassifierInput(input) {
    return input.questions.map(q => q.question).join(' | ');
  },
  requiresUserInteraction() {
    return true;
  },
  async validateInput({
    questions
  }) {
    if (getQuestionPreviewFormat() !== 'html') {
      return {
        result: true
      };
    }
    for (const q of questions) {
      for (const opt of q.options) {
        const err = validateHtmlPreview(opt.preview);
        if (err) {
          return {
            result: false,
            message: `Option "${opt.label}" in question "${q.question}": ${err}`,
            errorCode: 1
          };
        }
      }
    }
    return {
      result: true
    };
  },
  async checkPermissions(input) {
    return {
      behavior: 'ask' as const,
      message: 'Answer questions?',
      updatedInput: input
    };
  },
  renderToolUseMessage() {
    return null;
  },
  renderToolUseProgressMessage() {
    return null;
  },
  renderToolResultMessage({
    answers
  }, _toolUseID) {
    return <AskUserQuestionResultMessage answers={answers} />;
  },
  renderToolUseRejectedMessage() {
    return <Box flexDirection="row" marginTop={1}>
        <Text color={getModeColor('default')}>{BLACK_CIRCLE}&nbsp;</Text>
        <Text>User declined to answer questions</Text>
      </Box>;
  },
  renderToolUseErrorMessage() {
    return null;
  },
  async call({
    questions,
    answers = {},
    annotations
  }, _context) {
    return {
      data: {
        questions,
        answers,
        ...(annotations && {
          annotations
        })
      }
    };
  },
  mapToolResultToToolResultBlockParam({
    answers,
    annotations
  }, toolUseID) {
    const answersText = Object.entries(answers).map(([questionText, answer]) => {
      const annotation = annotations?.[questionText];
      const parts = [`"${questionText}"="${answer}"`];
      if (annotation?.preview) {
        parts.push(`selected preview:\n${annotation.preview}`);
      }
      if (annotation?.notes) {
        parts.push(`user notes: ${annotation.notes}`);
      }
      return parts.join(' ');
    }).join(', ');
    return {
      type: 'tool_result',
      content: `User has answered your questions: ${answersText}. You can now continue with the user's answers in mind.`,
      tool_use_id: toolUseID
    };
  }
} satisfies ToolDef<InputSchema, Output>);

// Lightweight HTML fragment check. Not a parser — HTML5 parsers are
// error-recovering by spec and accept anything. We're checking model intent
// (did it emit HTML?) and catching the specific things we told it not to do.
function validateHtmlPreview(preview: string | undefined): string | null {
  if (preview === undefined) return null;
  if (/<\s*(html|body|!doctype)\b/i.test(preview)) {
    return 'preview must be an HTML fragment, not a full document (no <html>, <body>, or <!DOCTYPE>)';
  }
  // SDK consumers typically set this via innerHTML — disallow executable/style
  // tags so a preview can't run code or restyle the host page. Inline event
  // handlers (onclick etc.) are still possible; consumers should sanitize.
  if (/<\s*(script|style)\b/i.test(preview)) {
    return 'preview must not contain <script> or <style> tags. Use inline styles via the style attribute if needed.';
  }
  if (!/<[a-z][^>]*>/i.test(preview)) {
    return 'preview must contain HTML (previewFormat is set to "html"). Wrap content in a tag like <div> or <pre>.';
  }
  return null;
}
