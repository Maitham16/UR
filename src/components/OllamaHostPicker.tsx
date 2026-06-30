import * as React from 'react'
import { Box, Text } from '../ink.js'
import type { DiscoveredHost } from '../utils/model/ollamaDiscovery.js'
import { Select } from './CustomSelect/index.js'
import { Pane } from './design-system/Pane.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'

export type Props = {
  discovered: DiscoveredHost[]
  currentHost?: string
  onSelect: (host: string | null) => void
}

export function OllamaHostPicker({
  discovered,
  currentHost,
  onSelect,
}: Props): React.ReactNode {
  const options = [
    {
      value: 'http://localhost:11434',
      label: 'This computer',
      description: 'ollama serve on localhost',
    },
    ...discovered.map(host => ({
      value: host.host,
      label: host.host,
      description:
        host.modelNames.length > 0
          ? `${host.modelNames.length} model(s) available`
          : 'Ollama server found',
    })),
  ]

  const defaultValue =
    options.find(o => o.value === currentHost)?.value ?? options[0]!.value
  const defaultFocusValue = defaultValue

  const handleSelect = (value: string) => {
    if (value === 'http://localhost:11434') {
      onSelect(null)
      return
    }
    onSelect(value)
  }

  return (
    <Pane color="permission">
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>
            Choose Ollama server
          </Text>
          <Text dimColor>
            Multiple Ollama servers were found on your network. Pick which one
            to use for this session.
          </Text>
          {currentHost && currentHost !== 'http://localhost:11434' && (
            <Text dimColor>
              Currently using {currentHost} (from settings or previous choice).
            </Text>
          )}
        </Box>
        <Box flexDirection="column" marginBottom={1}>
          <Select
            defaultValue={defaultValue}
            defaultFocusValue={defaultFocusValue}
            options={options}
            onChange={handleSelect}
            visibleOptionCount={Math.min(8, options.length)}
          />
        </Box>
        <Text dimColor italic>
          <Byline>
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <ConfigurableShortcutHint
              action="select:cancel"
              context="Select"
              fallback="Esc"
              description="use localhost"
            />
          </Byline>
        </Text>
      </Box>
    </Pane>
  )
}
