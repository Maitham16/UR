import figures from 'figures';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import type { KeyboardEvent } from '../../../ink/events/keyboard-event.js';
import { Box, Text } from '../../../ink.js';
import { useKeybinding, useKeybindings } from '../../../keybindings/useKeybinding.js';
import { useAppState } from '../../../state/AppState.js';
import type { Question } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { getExternalEditor } from '../../../utils/editor.js';
import { toIDEDisplayName } from '../../../utils/ide.js';
import { editPromptInEditor } from '../../../utils/promptEditor.js';
import { Divider } from '../../design-system/Divider.js';
import TextInput from '../../TextInput.js';
import { PreviewBox } from './PreviewBox.js';
import { getOwnRecordValue } from './prototypeSafeRecord.js';
import { QuestionNavigationBar } from './QuestionNavigationBar.js';
import type { QuestionState } from './use-multiple-choice-state.js';

const PREVIEW_OTHER_VALUE = '__other__';
type Props = {
  question: Question;
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  questionStates: Record<string, QuestionState>;
  hideSubmitTab?: boolean;
  minContentHeight?: number;
  minContentWidth?: number;
  onUpdateQuestionState: (questionText: string, updates: Partial<QuestionState>, isMultiSelect: boolean) => void;
  onAnswer: (questionText: string, label: string | string[], textInput?: string, shouldAdvance?: boolean) => void;
  onTextInputFocus: (isInInput: boolean) => void;
  onCancel: () => void;
  onTabPrev?: () => void;
  onTabNext?: () => void;
  onRespondToUR: () => void;
  onFinishPlanInterview: () => void;
};

/**
 * A side-by-side question view for questions with preview content.
 * Displays a vertical option list on the left with a preview panel on the right.
 */
export function PreviewQuestionView({
  question,
  questions,
  currentQuestionIndex,
  answers,
  questionStates,
  hideSubmitTab = false,
  minContentHeight,
  minContentWidth,
  onUpdateQuestionState,
  onAnswer,
  onTextInputFocus,
  onCancel,
  onTabPrev,
  onTabNext,
  onRespondToUR,
  onFinishPlanInterview
}: Props): React.ReactNode {
  const isInPlanMode = useAppState(s => s.toolPermissionContext.mode) === 'plan';
  const [isFooterFocused, setIsFooterFocused] = useState(false);
  const [footerIndex, setFooterIndex] = useState(0);
  const [isInNotesInput, setIsInNotesInput] = useState(false);
  const [cursorOffset, setCursorOffset] = useState(0);
  const editor = getExternalEditor();
  const editorName = editor ? toIDEDisplayName(editor) : null;
  const questionText = question.question;
  const questionState = getOwnRecordValue(questionStates, questionText);

  const allOptions = question.options;
  const otherIndex = allOptions.length;
  const optionRowCount = allOptions.length + 1;

  // Track which option is focused (for preview display)
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Reset focusedIndex when navigating to a different question
  const prevQuestionText = useRef(questionText);
  if (prevQuestionText.current !== questionText) {
    prevQuestionText.current = questionText;
    const selected = questionState?.selectedValue as string | undefined;
    const idx = selected === PREVIEW_OTHER_VALUE
      ? otherIndex
      : selected
        ? allOptions.findIndex(opt => opt.label === selected)
        : -1;
    setFocusedIndex(idx >= 0 ? idx : 0);
  }
  const focusedOption = allOptions[focusedIndex];
  const isOtherFocused = focusedIndex === otherIndex;
  const selectedValue = questionState?.selectedValue as string | undefined;
  const notesValue = questionState?.textInputValue || '';
  const otherInputValue = questionState?.otherInputValue || '';
  const handleSelectOption = useCallback((index: number) => {
    if (index === otherIndex) {
      setFocusedIndex(index);
      onUpdateQuestionState(questionText, {
        selectedValue: PREVIEW_OTHER_VALUE
      }, false);
      // Clear any previously selected answer until a genuine custom value is
      // submitted from the input.
      onAnswer(questionText, PREVIEW_OTHER_VALUE, '', false);
      setIsInNotesInput(true);
      onTextInputFocus(true);
      return;
    }
    const option = allOptions[index];
    if (!option) return;
    setFocusedIndex(index);
    onUpdateQuestionState(questionText, {
      selectedValue: option.label
    }, false);
    onAnswer(questionText, option.label);
  }, [allOptions, otherIndex, questionText, onUpdateQuestionState, onAnswer, onTextInputFocus]);
  const handleNavigate = useCallback((direction: 'up' | 'down' | number) => {
    if (isInNotesInput) return;
    let newIndex: number;
    if (typeof direction === 'number') {
      newIndex = direction;
    } else if (direction === 'up') {
      newIndex = focusedIndex > 0 ? focusedIndex - 1 : focusedIndex;
    } else {
      newIndex = focusedIndex < optionRowCount - 1 ? focusedIndex + 1 : focusedIndex;
    }
    if (newIndex >= 0 && newIndex < optionRowCount) {
      setFocusedIndex(newIndex);
    }
  }, [focusedIndex, optionRowCount, isInNotesInput]);

  // Handle ctrl+g to open external editor for notes
  useKeybinding('chat:externalEditor', async () => {
    const currentValue = isOtherFocused ? otherInputValue : notesValue;
    const result = await editPromptInEditor(currentValue);
    if (result.content !== null && result.content !== currentValue) {
      onUpdateQuestionState(questionText, {
        ...(isOtherFocused
          ? { otherInputValue: result.content }
          : { textInputValue: result.content })
      }, false);
    }
  }, {
    context: 'Chat',
    isActive: isInNotesInput && !!editor
  });

  // Handle left/right arrow and tab for question navigation.
  // This must be in the child component (not just the parent) because child useInput
  // handlers register first on the event emitter and fire before parent handlers.
  // Without this, the parent's useKeybindings may not fire reliably depending on
  // listener ordering in the event emitter.
  useKeybindings({
    'tabs:previous': () => onTabPrev?.(),
    'tabs:next': () => onTabNext?.()
  }, {
    context: 'Tabs',
    isActive: !isInNotesInput && !isFooterFocused
  });

  // Re-submit a real option after editing its notes. For Other, the typed
  // value is the answer itself and must be non-empty before advancing.
  const handleNotesExit = useCallback(() => {
    setIsInNotesInput(false);
    onTextInputFocus(false);
    if (isOtherFocused) {
      const customAnswer = otherInputValue.trim();
      if (customAnswer) {
        onAnswer(questionText, PREVIEW_OTHER_VALUE, customAnswer);
      }
      return;
    }
    if (selectedValue && selectedValue !== PREVIEW_OTHER_VALUE) {
      onAnswer(questionText, selectedValue);
    }
  }, [isOtherFocused, otherInputValue, selectedValue, questionText, onAnswer, onTextInputFocus]);
  const handleDownFromPreview = useCallback(() => {
    setIsFooterFocused(true);
  }, []);
  const handleUpFromFooter = useCallback(() => {
    setIsFooterFocused(false);
  }, []);

  // Handle keyboard input for option/footer/notes navigation.
  // Always active — the handler routes internally based on isFooterFocused/isInNotesInput.
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isFooterFocused) {
      if (e.key === 'up' || e.ctrl && e.key === 'p') {
        e.preventDefault();
        if (footerIndex === 0) {
          handleUpFromFooter();
        } else {
          setFooterIndex(0);
        }
        return;
      }
      if (e.key === 'down' || e.ctrl && e.key === 'n') {
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
      return;
    }
    if (isInNotesInput) {
      // In notes input mode, handle escape to exit back to option navigation
      if (e.key === 'escape') {
        e.preventDefault();
        handleNotesExit();
      }
      return;
    }

    // Handle option navigation (vertical)
    if (e.key === 'up' || e.ctrl && e.key === 'p') {
      e.preventDefault();
      if (focusedIndex > 0) {
        handleNavigate('up');
      }
    } else if (e.key === 'down' || e.ctrl && e.key === 'n') {
      e.preventDefault();
      if (focusedIndex === optionRowCount - 1) {
        // At bottom of options, go to footer
        handleDownFromPreview();
      } else {
        handleNavigate('down');
      }
    } else if (e.key === 'return') {
      e.preventDefault();
      handleSelectOption(focusedIndex);
    } else if (e.key === 'n' && !e.ctrl && !e.meta) {
      // Press 'n' to focus notes or the custom Other answer.
      e.preventDefault();
      if (isOtherFocused && selectedValue !== PREVIEW_OTHER_VALUE) {
        onUpdateQuestionState(questionText, {
          selectedValue: PREVIEW_OTHER_VALUE
        }, false);
      }
      setIsInNotesInput(true);
      onTextInputFocus(true);
    } else if (e.key === 'escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key.length === 1 && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx_0 = parseInt(e.key, 10) - 1;
      if (idx_0 < optionRowCount) {
        handleNavigate(idx_0);
      }
    }
  }, [isFooterFocused, footerIndex, isInPlanMode, isInNotesInput, focusedIndex, optionRowCount, isOtherFocused, selectedValue, questionText, handleUpFromFooter, handleDownFromPreview, handleNavigate, handleSelectOption, handleNotesExit, onRespondToUR, onFinishPlanInterview, onCancel, onTextInputFocus, onUpdateQuestionState]);
  const previewContent = isOtherFocused
    ? 'Enter a custom answer below.'
    : focusedOption?.preview || null;
  const currentInputValue = isOtherFocused ? otherInputValue : notesValue;

  // The right panel's available width is terminal minus the left panel and gap.
  const LEFT_PANEL_WIDTH = 30;
  const GAP = 4;
  const {
    columns
  } = useTerminalSize();
  const previewMaxWidth = columns - LEFT_PANEL_WIDTH - GAP;

  // Lines used within the content area that aren't preview content:
  // 1: marginTop on side-by-side box
  // 2: PreviewBox borders (top + bottom)
  // 2: notes section (marginTop=1 + text)
  // 2: footer section (marginTop=1 + divider)
  // 1: "Chat about this" line
  // 1: plan mode line (may or may not show)
  // 2: help text (marginTop=1 + text)
  const PREVIEW_OVERHEAD = 11;

  // Compute the max lines available for preview content from the parent's
  // height budget to prevent terminal overflow. We do NOT pad shorter options
  // to match the tallest — the outer box's minHeight handles cross-question
  // layout consistency, and within-question shifts are acceptable.
  const previewMaxLines = useMemo(() => {
    return minContentHeight ? Math.max(1, minContentHeight - PREVIEW_OVERHEAD) : undefined;
  }, [minContentHeight]);
  return <Box flexDirection="column" marginTop={1} tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Box flexDirection="column" paddingTop={0}>
        <QuestionNavigationBar questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} hideSubmitTab={hideSubmitTab} />

        <Box flexDirection="column" minHeight={minContentHeight}>
          {/* Side-by-side layout: options on left, preview on right */}
          <Box marginTop={1} flexDirection="row" gap={4}>
            {/* Left panel: vertical option list */}
            <Box flexDirection="column" width={30}>
              {allOptions.map((option_0, index_0) => {
              const isFocused = focusedIndex === index_0;
              const isSelected = selectedValue === option_0.label;
              return <Box key={option_0.label} flexDirection="row">
                    {isFocused ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
                    <Text dimColor> {index_0 + 1}.</Text>
                    <Text color={isSelected ? 'success' : isFocused ? 'suggestion' : undefined} bold={isFocused}>
                      {' '}
                      {option_0.label}
                    </Text>
                    {isSelected && <Text color="success"> {figures.tick}</Text>}
                  </Box>;
            })}
              <Box key={PREVIEW_OTHER_VALUE} flexDirection="row">
                {isOtherFocused ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
                <Text dimColor> {otherIndex + 1}.</Text>
                <Text
                  color={selectedValue === PREVIEW_OTHER_VALUE ? 'success' : isOtherFocused ? 'suggestion' : undefined}
                  bold={isOtherFocused}
                >
                  {' '}Other
                </Text>
                {selectedValue === PREVIEW_OTHER_VALUE && <Text color="success"> {figures.tick}</Text>}
              </Box>
            </Box>

            {/* Right panel: preview plus notes or a custom Other answer */}
            <Box flexDirection="column" flexGrow={1}>
              <PreviewBox content={previewContent || 'No preview available'} maxLines={previewMaxLines} minWidth={minContentWidth} maxWidth={previewMaxWidth} />
              <Box marginTop={1} flexDirection="row" gap={1}>
                <Text color="suggestion">{isOtherFocused ? 'Answer:' : 'Notes:'}</Text>
                {isInNotesInput ? <TextInput value={currentInputValue} placeholder={isOtherFocused ? 'Type a custom answer…' : 'Add notes on this design…'} onChange={value => {
                onUpdateQuestionState(questionText, {
                  ...(isOtherFocused
                    ? { otherInputValue: value }
                    : { textInputValue: value })
                }, false);
              }} onSubmit={handleNotesExit} onExit={handleNotesExit} focus={true} showCursor={true} columns={60} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} /> : <Text dimColor italic>
                    {currentInputValue || (isOtherFocused ? 'press Enter to type a custom answer' : 'press n to add notes')}
                  </Text>}
              </Box>
            </Box>
          </Box>

          {/* Footer section */}
          <Box flexDirection="column" marginTop={1}>
            <Divider color="inactive" />
            <Box flexDirection="row" gap={1}>
              {isFooterFocused && footerIndex === 0 ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
              <Text color={isFooterFocused && footerIndex === 0 ? 'suggestion' : undefined}>
                Chat about this
              </Text>
            </Box>
            {isInPlanMode && <Box flexDirection="row" gap={1}>
                {isFooterFocused && footerIndex === 1 ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
                <Text color={isFooterFocused && footerIndex === 1 ? 'suggestion' : undefined}>
                  Skip interview and plan immediately
                </Text>
              </Box>}
          </Box>
          <Box marginTop={1}>
            <Text color="inactive" dimColor>
              Enter to select · {figures.arrowUp}/{figures.arrowDown} to
              navigate · n to edit {isOtherFocused ? 'answer' : 'notes'}
              {questions.length > 1 && <> · Tab to switch questions</>}
              {isInNotesInput && editorName && <> · ctrl+g to edit in {editorName}</>}{' '}
              · Esc to cancel
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>;
}
