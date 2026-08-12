import { describe, expect, test } from 'bun:test'
import type { LogOption } from '../src/types/logs.js'
import type { ArchivedSession } from '../src/utils/sessionArchive.js'
import { selectCliSessionStatus } from '../src/cli/handlers/session.js'

function log(
  sessionId: string,
  projectPath: string,
  modified: string,
): LogOption {
  return {
    sessionId,
    projectPath,
    fullPath: `/sessions/${sessionId}.jsonl`,
    customTitle: `Work ${sessionId}`,
    firstPrompt: '',
    summary: undefined,
    created: new Date('2026-08-01T00:00:00.000Z'),
    modified: new Date(modified),
    date: modified,
    messages: [],
    value: 0,
    messageCount: 1,
    isSidechain: false,
  }
}

describe('ur session status', () => {
  const active = [
    log('latest-here', '/workspace/project', '2026-08-12T00:00:00.000Z'),
    log('another-project', '/workspace/other', '2026-08-11T00:00:00.000Z'),
  ]
  const archived: ArchivedSession[] = [
    {
      sessionId: 'archived-one',
      archivedAt: '2026-08-10T00:00:00.000Z',
      projectDir: '/archive/project',
      transcriptPath: '/archive/project/archived-one.jsonl',
    },
  ]

  test('defaults to the latest resumable session in the current project', () => {
    expect(
      selectCliSessionStatus(active, archived, undefined, '/workspace/project'),
    ).toMatchObject({ sessionId: 'latest-here', status: 'resumable' })
  })

  test('looks up explicit active and archived session IDs', () => {
    expect(
      selectCliSessionStatus(active, archived, 'another-project', '/unused'),
    ).toMatchObject({ sessionId: 'another-project', status: 'resumable' })
    expect(
      selectCliSessionStatus(active, archived, 'archived-one', '/unused'),
    ).toMatchObject({ sessionId: 'archived-one', status: 'archived' })
    expect(
      selectCliSessionStatus(active, archived, 'missing', '/unused'),
    ).toBeUndefined()
  })
})
