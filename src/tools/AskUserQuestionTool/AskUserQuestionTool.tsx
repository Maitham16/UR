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
import type { Tool, ToolInputJSONSchema } from '../../Tool.js';
import { buildTool, type ToolDef } from '../../Tool.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js';
import { headerFromQuestion, normalizeQuestionHeader } from './normalization.js';
import { ASK_USER_QUESTION_TOOL_CHIP_WIDTH, ASK_USER_QUESTION_TOOL_NAME, ASK_USER_QUESTION_TOOL_PROMPT, DESCRIPTION, PREVIEW_FEATURE_PROMPT } from './prompt.js';
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 8;
const MAX_QUESTION_CHARS = 500;
const MAX_LABEL_CHARS = 80;
const MAX_DESCRIPTION_CHARS = 500;
const MAX_PREVIEW_CHARS = 16 * 1024;
const MAX_PREVIEW_LINES = 200;
const MAX_ANSWER_CHARS = 2_000;
const MAX_TOTAL_INPUT_CHARS = 64 * 1024;
const RESERVED_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']);
const QUESTION_TEXT_ALIASES = ['question', 'questionText', 'question_text', 'prompt', 'text'] as const;
const CONTROL_OR_ANSI_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|\u001B\[/;
function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function stringField(input: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = input[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
function normalizeQuestionOptionInput(value: unknown): unknown {
  if (typeof value === 'string') {
    const label = value.trim();
    return label ? {
      label
    } : value;
  }
  const option = objectValue(value);
  if (!option) return value;
  // Preserve unknown keys so the strict schema can reject them. Compatibility
  // normalization must never turn an ambiguous object into a valid choice by
  // inventing a label from a machine value or from descriptive prose.
  const normalized = { ...option };
  if (typeof option.label === 'string') normalized.label = option.label.trim();
  if (typeof option.description === 'string') normalized.description = option.description.trim();
  if (typeof option.preview === 'string') normalized.preview = normalizePreviewInput(option.preview);
  return normalized;
}
function normalizePreviewInput(preview: string): string {
  if (getQuestionPreviewFormat() !== 'html') return preview;
  const alreadySafe = preview.match(/^<pre data-ur-preview="text">([\s\S]*)<\/pre>$/);
  if (alreadySafe && !alreadySafe[1]?.includes('<')) return preview;
  const escaped = preview.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  return `<pre data-ur-preview="text">${escaped}</pre>`;
}
function normalizeQuestionInput(value: unknown, index: number): unknown {
  const question = objectValue(value);
  if (!question) return value;
  const normalized = { ...question };
  const questionText = stringField(question, [...QUESTION_TEXT_ALIASES]);
  if (questionText) normalized.question = questionText;
  for (const alias of QUESTION_TEXT_ALIASES) {
    if (alias !== 'question') delete normalized[alias];
  }
  let options = question.options;
  if (options === undefined && question.choices !== undefined) {
    options = question.choices;
    delete normalized.choices;
  }
  if (typeof options === 'string') {
    const parsed = parseToolInputJsonLenient(options);
    if (Array.isArray(parsed)) options = parsed;
  }
  if (Array.isArray(options)) {
    normalized.options = options.map(normalizeQuestionOptionInput);
  }
  if (typeof question.header === 'string' && question.header.trim()) {
    normalized.header = normalizeQuestionHeader(question.header, questionText, index);
  } else if (questionText) {
    normalized.header = headerFromQuestion(questionText, index);
  }
  return normalized;
}
function normalizeAskUserQuestionInput(value: unknown): unknown {
  const input = objectValue(value);
  if (!input) return value;
  const normalized = { ...input };
  let questions = input.questions;
  if (typeof questions === 'string') {
    const parsed = parseToolInputJsonLenient(questions);
    if (Array.isArray(parsed)) questions = parsed;
  }
  if (Array.isArray(questions)) {
    normalized.questions = questions.map(normalizeQuestionInput);
    return normalized;
  }
  let options = input.options;
  if (typeof options === 'string') {
    const parsed = parseToolInputJsonLenient(options);
    if (Array.isArray(parsed)) options = parsed;
  }
  if (stringField(input, [...QUESTION_TEXT_ALIASES]) && Array.isArray(options)) {
    const singleQuestion = normalizeQuestionInput({
      question: stringField(input, [...QUESTION_TEXT_ALIASES]),
      ...(input.header !== undefined ? {
        header: input.header
      } : {}),
      options,
      ...(input.multiSelect !== undefined ? {
        multiSelect: input.multiSelect
      } : {})
    }, 0);
    for (const key of [...QUESTION_TEXT_ALIASES, 'header', 'options', 'choices', 'multiSelect']) {
      delete normalized[key];
    }
    return {
      ...normalized,
      questions: [singleQuestion]
    };
  }
  return normalized;
}
function boundedText(max: number, field: string) {
  return z.string().trim().min(1, `${field} cannot be empty`).max(max, `${field} must be at most ${max} characters`).refine(value => !CONTROL_OR_ANSI_RE.test(value), `${field} must not contain control or ANSI escape characters`);
}
const UNIQUENESS_REFINE = {
  check: (data: {
    questions: {
      question: string;
      options: {
        label: string;
      }[];
    }[];
  }) => {
    const questions = data.questions.map(q => q.question.toLocaleLowerCase());
    if (questions.length !== new Set(questions).size) {
      return false;
    }
    for (const question of data.questions) {
      const labels = question.options.map(opt => opt.label.toLocaleLowerCase());
      if (labels.length !== new Set(labels).size) {
        return false;
      }
    }
    return true;
  },
  message: 'Question texts must be unique, and option labels must be unique within each question (ignoring case)'
} as const;
const questionOptionSchema = lazySchema(() => z.strictObject({
  label: boundedText(MAX_LABEL_CHARS, 'Option label').refine(label => {
    const normalized = label.trim().toLocaleLowerCase();
    return normalized !== 'other' && normalized !== '__other__';
  }, 'Do not provide an Other option; the UI supplies it automatically.').describe('The concise name of this choice, usually 1-5 words. It must be distinct from every other label in this question.'),
  description: boundedText(MAX_DESCRIPTION_CHARS, 'Option description').optional().describe('Optional consequence, trade-off, or limitation that adds information beyond the label. Omit it when there is nothing useful to add; never duplicate the label merely to fill this field.'),
  preview: z.string().max(MAX_PREVIEW_CHARS, `Option preview must be at most ${MAX_PREVIEW_CHARS} characters`).refine(value => value.split(/\r?\n/).length <= MAX_PREVIEW_LINES, `Option preview must be at most ${MAX_PREVIEW_LINES} lines`).optional().describe('Optional bounded preview content rendered when this option is focused.')
}));
const questionSchema = lazySchema(() => z.strictObject({
  question: boundedText(MAX_QUESTION_CHARS, 'Question').refine(question => !RESERVED_RECORD_KEYS.has(question), 'Question text uses a reserved record key; rephrase it.').describe('The complete, specific decision question shown to the user. Ask one decision per object.'),
  header: boundedText(ASK_USER_QUESTION_TOOL_CHIP_WIDTH, 'Question header').describe(`A short category chip naming the decision dimension, not a shortened question (max ${ASK_USER_QUESTION_TOOL_CHIP_WIDTH} characters; for “Which database?” use “Database”).`),
  options: z.array(questionOptionSchema()).min(2).max(MAX_OPTIONS).describe(`REQUIRED: 2-${MAX_OPTIONS} concrete choices nested inside this question object. Do not put option rows directly in the top-level questions array.`),
  multiSelect: z.boolean().optional().describe('Set to true only when choices are not mutually exclusive. Omit it for ordinary single-select questions.')
}).refine(question => !(question.multiSelect && question.options.some(option => option.preview !== undefined)), {
  message: 'Preview choices are single-select only; remove previews or set multiSelect to false.'
}));
const annotationsSchema = lazySchema(() => {
  const annotationSchema = z.strictObject({
    preview: z.string().max(MAX_PREVIEW_CHARS).optional(),
    notes: z.string().trim().max(MAX_ANSWER_CHARS).optional()
  });
  return z.record(z.string(), annotationSchema).optional();
});
const responseFields = lazySchema(() => ({
  answers: z.record(z.string(), z.string().trim().min(1).max(MAX_ANSWER_CHARS)).optional(),
  annotations: annotationsSchema()
}));
const metadataSchema = lazySchema(() => z.strictObject({
  source: z.string().trim().min(1).max(100).optional()
}).optional());
const requestObjectSchema = lazySchema(() => z.strictObject({
  questions: z.array(questionSchema()).min(1).max(MAX_QUESTIONS).describe(`Questions to ask the user (1-${MAX_QUESTIONS}). Ask only decisions that materially affect the result and cannot be inferred.`),
  metadata: metadataSchema()
}).refine(UNIQUENESS_REFINE.check, {
  message: UNIQUENESS_REFINE.message
}).refine(input => JSON.stringify(input).length <= MAX_TOTAL_INPUT_CHARS, {
  message: `AskUserQuestion input must be at most ${MAX_TOTAL_INPUT_CHARS} characters`
}));
const inputSchema = lazySchema(() => z.preprocess(normalizeAskUserQuestionInput, z.strictObject({
  questions: z.array(questionSchema()).min(1).max(MAX_QUESTIONS),
  metadata: metadataSchema(),
  ...responseFields()
}).refine(UNIQUENESS_REFINE.check, {
  message: UNIQUENESS_REFINE.message
}).refine(input => JSON.stringify(input).length <= MAX_TOTAL_INPUT_CHARS, {
  message: `AskUserQuestion input must be at most ${MAX_TOTAL_INPUT_CHARS} characters`
})));
const modelInputJSONSchema = zodToJsonSchema(requestObjectSchema()) as ToolInputJSONSchema;
type InputSchema = ReturnType<typeof inputSchema>;
const outputSchema = lazySchema(() => z.strictObject({
  questions: z.array(questionSchema()).describe('The questions that were asked'),
  answers: z.record(z.string(), z.string().trim().min(1).max(MAX_ANSWER_CHARS)).describe('The answers provided by the user (question text -> answer string; multi-select answers are comma-separated)'),
  annotations: annotationsSchema()
}));
type OutputSchema = ReturnType<typeof outputSchema>;

// SDK callers request questions. Answers and annotations are trusted response
// fields injected only after the permission UI has collected user input.
export const _sdkInputSchema = requestObjectSchema;
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
  inputJSONSchema: modelInputJSONSchema,
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
    return true;
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
  async validateInput(input, context) {
    const {
      questions
    } = input;
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
    if (context.validationPhase !== 'post-permission') {
      if (Object.prototype.hasOwnProperty.call(input, 'answers') || Object.prototype.hasOwnProperty.call(input, 'annotations')) {
        return {
          result: false,
          message: 'answers and annotations are response fields supplied only after trusted user interaction; omit them from the tool request',
          errorCode: 1
        };
      }
      return {
        result: true
      };
    }
    if (!Object.prototype.hasOwnProperty.call(input, 'answers') || !input.answers) {
      return {
        result: false,
        message: 'No verified user answers were collected. AskUserQuestion cannot complete from an unchanged permission approval.',
        errorCode: 1
      };
    }
    const expectedQuestions = new Set(questions.map(question => question.question));
    const answerKeys = Object.keys(input.answers);
    const missingAnswers = questions.filter(question => !Object.prototype.hasOwnProperty.call(input.answers, question.question)).map(question => question.question);
    const unexpectedAnswers = answerKeys.filter(key => !expectedQuestions.has(key));
    if (missingAnswers.length > 0 || unexpectedAnswers.length > 0) {
      const details = [...(missingAnswers.length > 0 ? [`missing: ${missingAnswers.join(', ')}`] : []), ...(unexpectedAnswers.length > 0 ? [`unexpected: ${unexpectedAnswers.join(', ')}`] : [])].join('; ');
      return {
        result: false,
        message: `Verified answers must contain exactly one entry for every question (${details}).`,
        errorCode: 1
      };
    }
    const unexpectedAnnotations = Object.keys(input.annotations ?? {}).filter(key => !expectedQuestions.has(key));
    if (unexpectedAnnotations.length > 0) {
      return {
        result: false,
        message: `User annotations contain unknown question keys: ${unexpectedAnnotations.join(', ')}`,
        errorCode: 1
      };
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
    answers,
    annotations
  }, _context) {
    if (!answers) {
      throw new Error('AskUserQuestion reached execution without verified user answers');
    }
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
  if (getQuestionPreviewFormat() !== 'html') return null;
  const safeTextWrapper = preview.match(/^<pre data-ur-preview="text">([\s\S]*)<\/pre>$/);
  if (!safeTextWrapper || safeTextWrapper[1]?.includes('<')) {
    return 'HTML previews must use UR’s escaped text wrapper; raw model-provided HTML is not rendered';
  }
  return null;
}
