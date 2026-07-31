import figures from 'figures';
import React, { useCallback, useMemo, useState } from 'react';
import type { KeyboardEvent } from '../../../ink/events/keyboard-event.js';
import { Box, Text } from '../../../ink.js';
import { useAppState } from '../../../state/AppState.js';
import type { Question } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import type { PastedContent } from '../../../utils/config.js';
import { getExternalEditor } from '../../../utils/editor.js';
import { toIDEDisplayName } from '../../../utils/ide.js';
import { editPromptInEditor } from '../../../utils/promptEditor.js';
import { type OptionWithDescription, Select, SelectMulti } from '../../CustomSelect/index.js';
import { Divider } from '../../design-system/Divider.js';
import { FilePathLink } from '../../FilePathLink.js';
import { QuestionNavigationBar } from './QuestionNavigationBar.js';
import { PreviewQuestionView } from './PreviewQuestionView.js';
import type { QuestionState } from './use-multiple-choice-state.js';

type Props = {
  question: Question;
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  questionStates: Record<string, QuestionState>;
  hideSubmitTab?: boolean;
  planFilePath?: string;
  pastedContents?: Record<number, PastedContent>;
  minContentHeight?: number;
  minContentWidth?: number;
  onUpdateQuestionState: (questionText: string, updates: Partial<QuestionState>, isMultiSelect: boolean) => void;
  onAnswer: (questionText: string, label: string | string[], textInput?: string, shouldAdvance?: boolean) => void;
  onTextInputFocus: (isInInput: boolean) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onTabPrev?: () => void;
  onTabNext?: () => void;
  onRespondToUR: () => void;
  onFinishPlanInterview: () => void;
  onImagePaste?: (base64Image: string, mediaType?: string, filename?: string, dimensions?: unknown, sourcePath?: string) => void;
  onRemoveImage?: (id: number) => void;
};

export function QuestionView({
  question,
  questions,
  currentQuestionIndex,
  answers,
  questionStates,
  hideSubmitTab = false,
  planFilePath,
  pastedContents,
  minContentHeight,
  minContentWidth,
  onUpdateQuestionState,
  onAnswer,
  onTextInputFocus,
  onCancel,
  onSubmit,
  onTabPrev,
  onTabNext,
  onRespondToUR,
  onFinishPlanInterview,
  onImagePaste,
  onRemoveImage
}: Props): React.ReactNode {
  const isInPlanMode = useAppState(s => s.toolPermissionContext.mode) === 'plan';
  const [isFooterFocused, setIsFooterFocused] = useState(false);
  const [footerIndex, setFooterIndex] = useState(0);
  const [isOtherFocused, setIsOtherFocused] = useState(false);
  const editorName = useMemo(() => {
    const editor = getExternalEditor();
    return editor ? toIDEDisplayName(editor) : null;
  }, []);

  const handleFocus = useCallback((value: string) => {
    const isOther = value === '__other__';
    setIsOtherFocused(isOther);
    onTextInputFocus(isOther);
  }, [onTextInputFocus]);

  const handleDownFromLastItem = useCallback(() => {
    setIsFooterFocused(true);
  }, []);

  const handleUpFromFooter = useCallback(() => {
    setIsFooterFocused(false);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isFooterFocused) return;

    if (e.key === 'up' || (e.ctrl && e.key === 'p')) {
      e.preventDefault();
      if (footerIndex === 0) {
        handleUpFromFooter();
      } else {
        setFooterIndex(0);
      }
      return;
    }

    if (e.key === 'down' || (e.ctrl && e.key === 'n')) {
      e.preventDefault();
      if (isInPlanMode && footerIndex === 0) {
        setFooterIndex(1);
      }
      return;
    }

    if (e.key === 'return') {
      e.preventDefault();
      if (footerIndex === 0) {
        onRespondToUR();
      } else {
        onFinishPlanInterview();
      }
      return;
    }

    if (e.key === 'escape') {
      e.preventDefault();
      onCancel();
    }
  }, [isFooterFocused, footerIndex, isInPlanMode, handleUpFromFooter, onRespondToUR, onFinishPlanInterview, onCancel]);

  const options = useMemo<OptionWithDescription[]>(() => {
    const textOptions = question.options.map(opt => ({
      type: 'text' as const,
      value: opt.label,
      label: opt.label,
      description: opt.description
    }));

    const handleOpenEditor = async (currentValue: string, setValue: (value: string) => void) => {
      const result = await editPromptInEditor(currentValue);
      if (result.content !== null && result.content !== currentValue) {
        setValue(result.content);
        onUpdateQuestionState(question.question, { textInputValue: result.content }, question.multiSelect ?? false);
      }
    };

    const placeholder = question.multiSelect ? 'Type something' : 'Type something.';
    const textInputValue = questionStates[question.question]?.textInputValue ?? '';

    return [
      ...textOptions,
      {
        type: 'input' as const,
        value: '__other__',
        label: 'Other',
        placeholder,
        initialValue: textInputValue,
        onChange: (value: string) => {
          onUpdateQuestionState(question.question, { textInputValue: value }, question.multiSelect ?? false);
        },
        onOpenEditor: handleOpenEditor
      }
    ];
  }, [question, questionStates, onUpdateQuestionState]);

  const hasAnyPreview = !question.multiSelect && question.options.some(opt => opt.preview);
  if (hasAnyPreview) {
    return (
      <PreviewQuestionView
        question={question}
        questions={questions}
        currentQuestionIndex={currentQuestionIndex}
        answers={answers}
        questionStates={questionStates}
        hideSubmitTab={hideSubmitTab}
        minContentHeight={minContentHeight}
        minContentWidth={minContentWidth}
        onUpdateQuestionState={onUpdateQuestionState}
        onAnswer={onAnswer}
        onTextInputFocus={onTextInputFocus}
        onCancel={onCancel}
        onTabPrev={onTabPrev}
        onTabNext={onTabNext}
        onRespondToUR={onRespondToUR}
        onFinishPlanInterview={onFinishPlanInterview}
      />
    );
  }

  const planInfo = isInPlanMode && planFilePath && (
    <Box flexDirection="column" gap={0}>
      <Divider color="inactive" />
      <Text color="inactive">
        Planning: <FilePathLink filePath={planFilePath} />
      </Text>
    </Box>
  );

  const footerIndexStart = options.length + 1;

  return (
    <Box flexDirection="column" marginTop={0} tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      {planInfo}
      <QuestionNavigationBar
        questions={questions}
        currentQuestionIndex={currentQuestionIndex}
        answers={answers}
        hideSubmitTab={hideSubmitTab}
      />
      <Box flexDirection="column" minHeight={minContentHeight}>
        <Box marginTop={1}>
          {question.multiSelect ? (
            <SelectMulti
              key={question.question}
              options={options}
              defaultValue={questionStates[question.question]?.selectedValue as string[] | undefined}
              onChange={values => {
                onUpdateQuestionState(question.question, { selectedValue: values }, true);
                const textInput = values.includes('__other__')
                  ? questionStates[question.question]?.textInputValue
                  : undefined;
                const finalValues = values.filter(v => v !== '__other__').concat(textInput ? [textInput] : []);
                onAnswer(question.question, finalValues, undefined, false);
              }}
              onFocus={handleFocus}
              onCancel={onCancel}
              submitButtonText={currentQuestionIndex === questions.length - 1 ? 'Submit' : 'Next'}
              onSubmit={onSubmit}
              onDownFromLastItem={handleDownFromLastItem}
              isDisabled={isFooterFocused}
              onImagePaste={onImagePaste}
              pastedContents={pastedContents}
              onRemoveImage={onRemoveImage}
            />
          ) : (
            <Select
              key={question.question}
              options={options}
              defaultValue={questionStates[question.question]?.selectedValue as string | undefined}
              onChange={value => {
                onUpdateQuestionState(question.question, { selectedValue: value }, false);
                const textInput = value === '__other__' ? questionStates[question.question]?.textInputValue : undefined;
                onAnswer(question.question, value, textInput);
              }}
              onFocus={handleFocus}
              onCancel={onCancel}
              onDownFromLastItem={handleDownFromLastItem}
              isDisabled={isFooterFocused}
              layout="compact-vertical"
              onImagePaste={onImagePaste}
              pastedContents={pastedContents}
              onRemoveImage={onRemoveImage}
            />
          )}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Divider color="inactive" />
          <Box flexDirection="row" gap={1}>
            {isFooterFocused && footerIndex === 0 ? (
              <Text color="suggestion">{figures.pointer}</Text>
            ) : (
              <Text> </Text>
            )}
            <Text color={isFooterFocused && footerIndex === 0 ? 'suggestion' : undefined}>
              {footerIndexStart}. Chat about this
            </Text>
          </Box>
          {isInPlanMode && (
            <Box flexDirection="row" gap={1}>
              {isFooterFocused && footerIndex === 1 ? (
                <Text color="suggestion">{figures.pointer}</Text>
              ) : (
                <Text> </Text>
              )}
              <Text color={isFooterFocused && footerIndex === 1 ? 'suggestion' : undefined}>
                {options.length + 2}. Skip interview and plan immediately
              </Text>
            </Box>
          )}
        </Box>

        <Box marginTop={1}>
          <Text color="inactive" dimColor>
            Enter to select · {questions.length === 1 ? (
              <>{figures.arrowUp}/{figures.arrowDown} to navigate</>
            ) : (
              'Tab/Arrow keys to navigate'
            )}
            {isOtherFocused && editorName && <> · ctrl+g to edit in {editorName}</>}{' '}
            · Esc to cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
