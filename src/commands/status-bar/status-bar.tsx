import * as React from 'react'
import { useState } from 'react'
import { SelectMulti } from '../../components/CustomSelect/index.js'
import { Byline } from '../../components/design-system/Byline.js'
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js'
import { Pane } from '../../components/design-system/Pane.js'
import { Box, Text } from '../../ink.js'
import { TerminalSizeContext } from '../../ink/components/TerminalSizeContext.js'
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js'
import {
  STATUS_BAR_FIELDS,
  type StatusBarFieldId,
} from '../../utils/statusBarFields.js'
import {
  describeStatusBarSelection,
  readStatusBarFieldVisibility,
  writeStatusBarFieldVisibility,
} from './statusBarSettings.js'

function StatusBarFieldPicker({
  onDone,
}: {
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const visibility = readStatusBarFieldVisibility()
  const [selected, setSelected] = useState<StatusBarFieldId[]>(
    STATUS_BAR_FIELDS.filter(field => visibility[field.id]).map(field => field.id),
  )
  const [error, setError] = useState<string | null>(null)
  const terminalSize = React.useContext(TerminalSizeContext)

  const options = STATUS_BAR_FIELDS.map(field => ({
    value: field.id,
    label: field.label,
    description: field.description,
  }))

  // Show the whole list when the terminal allows, so the fields do not split
  // into a scrolled group the user has to hunt through.
  const visibleCount = Math.max(
    3,
    Math.min(options.length, Math.max(3, (terminalSize?.rows ?? 24) - 10)),
  )

  function handleSubmit(): void {
    const result = writeStatusBarFieldVisibility(selected)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onDone(describeStatusBarSelection(selected), { display: 'system' })
  }

  return (
    <Pane color="permission">
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>
            Status bar fields
          </Text>
          <Text dimColor>
            Space toggles a field, Enter saves. A field with nothing to report is
            hidden automatically even when enabled.
          </Text>
        </Box>
        <SelectMulti
          options={options}
          defaultValue={selected}
          onChange={values => setSelected(values as StatusBarFieldId[])}
          onSubmit={handleSubmit}
          onCancel={() => onDone('Status bar unchanged.', { display: 'system' })}
          submitButtonText="Save"
          visibleOptionCount={visibleCount}
        />
        {error && (
          <Box marginTop={1}>
            <Text color="error">{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Byline>
            <KeyboardShortcutHint shortcut="Space" action="toggle" />
            <KeyboardShortcutHint shortcut="Enter" action="save" />
            <KeyboardShortcutHint shortcut="Esc" action="cancel" />
          </Byline>
        </Box>
      </Box>
    </Pane>
  )
}

export const call: LocalJSXCommandCall = async onDone => {
  return <StatusBarFieldPicker onDone={onDone} />
}
