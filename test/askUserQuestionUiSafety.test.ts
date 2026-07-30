import { describe, expect, test } from 'bun:test'
import { resolveQuestionAnswer } from '../src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx'
import {
  clonePrototypeSafeRecord,
  createPrototypeSafeRecord,
  getOwnRecordValue,
  hasOwnRecordKey,
  setPrototypeSafeRecordValue,
} from '../src/components/permissions/AskUserQuestionPermissionRequest/prototypeSafeRecord.ts'
import {
  createInitialMultipleChoiceState,
  multipleChoiceReducer,
} from '../src/components/permissions/AskUserQuestionPermissionRequest/use-multiple-choice-state.ts'

describe('AskUserQuestion prototype-safe UI state', () => {
  test('Other is incomplete until the user supplies a real answer', () => {
    expect(resolveQuestionAnswer('__other__', undefined, false)).toBe('')
    expect(resolveQuestionAnswer('__other__', 'Custom choice', false)).toBe(
      'Custom choice',
    )
    expect(resolveQuestionAnswer('__other__', undefined, true)).toBe(
      '(Image attached)',
    )
  })

  test('inherited Object keys never count as record values', () => {
    const ordinaryRecord = {} as Record<string, string>

    for (const key of ['toString', 'constructor', '__proto__']) {
      expect(getOwnRecordValue(ordinaryRecord, key)).toBeUndefined()
      expect(hasOwnRecordKey(ordinaryRecord, key)).toBe(false)
    }
  })

  test('hostile question keys remain own values on null-prototype records', () => {
    let answers = createPrototypeSafeRecord<string>()

    for (const key of ['toString', 'constructor', '__proto__']) {
      answers = setPrototypeSafeRecordValue(answers, key, `answer:${key}`)
    }

    expect(Object.getPrototypeOf(answers)).toBeNull()
    expect(Object.keys(answers)).toEqual([
      'toString',
      'constructor',
      '__proto__',
    ])
    expect(getOwnRecordValue(answers, '__proto__')).toBe('answer:__proto__')
  })

  test('cloning pasted-content maps cannot mutate their prototype', () => {
    const contents = createPrototypeSafeRecord<{ id: number }>()
    contents.__proto__ = { id: 1 }

    const cloned = clonePrototypeSafeRecord(contents)

    expect(Object.getPrototypeOf(cloned)).toBeNull()
    expect(hasOwnRecordKey(cloned, '__proto__')).toBe(true)
    expect(cloned.__proto__).toEqual({ id: 1 })
  })

  test('the reducer preserves hostile answers and question state safely', () => {
    let state = createInitialMultipleChoiceState()

    expect(Object.getPrototypeOf(state.answers)).toBeNull()
    expect(Object.getPrototypeOf(state.questionStates)).toBeNull()
    expect(getOwnRecordValue(state.answers, 'toString')).toBeUndefined()

    state = multipleChoiceReducer(state, {
      type: 'set-answer',
      questionText: 'toString',
      answer: 'A real answer',
      shouldAdvance: false,
    })
    state = multipleChoiceReducer(state, {
      type: 'update-question-state',
      questionText: '__proto__',
      updates: {
        selectedValue: '__other__',
        textInputValue: 'Design notes',
        otherInputValue: 'A custom answer',
      },
      isMultiSelect: false,
    })

    expect(Object.getPrototypeOf(state.answers)).toBeNull()
    expect(Object.getPrototypeOf(state.questionStates)).toBeNull()
    expect(getOwnRecordValue(state.answers, 'toString')).toBe('A real answer')
    expect(getOwnRecordValue(state.questionStates, '__proto__')).toEqual({
      selectedValue: '__other__',
      textInputValue: 'Design notes',
      otherInputValue: 'A custom answer',
    })
  })
})
