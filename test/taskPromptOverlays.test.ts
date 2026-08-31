import { describe, expect, test } from 'bun:test'
import {
  renderTaskPromptOverlay,
  resolveTaskPromptOverlays,
} from '../src/constants/taskPromptOverlays.js'
import { getTaskPromptOverlayAttachment } from '../src/utils/attachments.js'

function kinds(input: string): string[] {
  return resolveTaskPromptOverlays(input, { currentYear: '2026' }).map(
    overlay => overlay.kind,
  )
}

describe('task prompt overlays', () => {
  test('research semantics include evidence quality without blanket recency', () => {
    const overlays = resolveTaskPromptOverlays(
      'Research the history of the actor model and cite sources.',
      { currentYear: '2026' },
    )
    const rendered = renderTaskPromptOverlay(overlays)

    expect(overlays.map(overlay => overlay.kind)).toEqual(['research'])
    expect(rendered).toContain('claim-adjacent links')
    expect(rendered).toContain('Clearly label inference')
    expect(rendered).toContain('Reconcile conflicting sources')
    expect(rendered).toContain('non-discovery is not proof of absence')
    expect(rendered).toContain('Stop once primary evidence')
    expect(rendered).not.toContain('2026')
  })

  test('recency-sensitive research receives the current year', () => {
    const rendered = renderTaskPromptOverlay(
      resolveTaskPromptOverlays(
        'Search the internet for the latest TypeScript release notes.',
        { currentYear: '2026' },
      ),
    )
    expect(rendered).toContain('recency-sensitive')
    expect(rendered).toContain('2026')
    expect(rendered).toContain('verify dates or versions')
  })

  test('research does not trigger for local code search or stable answers', () => {
    expect(kinds('Find the parseConfig function in this repository.')).toEqual(
      [],
    )
    expect(kinds('Explain how Dijkstra’s algorithm works from memory.')).toEqual(
      [],
    )
  })

  test('editing guidance targets prose rewrites, not generic code edits', () => {
    expect(kinds('Rewrite this email to be concise and professional.')).toEqual([
      'editing',
    ])
    expect(kinds('Edit src/config.ts to add a timeout.')).toEqual([])
  })

  test('frontend guidance requires both an interface and a change task', () => {
    expect(kinds('Build a responsive landing page in React.')).toEqual([
      'frontend',
    ])
    expect(kinds('Explain how React reconciliation works.')).toEqual([])
    expect(kinds('Fix pagination in the backend API.')).toEqual([])
  })

  test('vision guidance follows actual images and explicit visual inspection', () => {
    expect(kinds('What is wrong with [Image #1]?')).toEqual(['vision'])
    expect(kinds('Inspect this screenshot for small alignment defects.')).toEqual([
      'vision',
    ])
    expect(kinds('Improve our company vision statement.')).toEqual([])
  })

  test('independent relevant overlays compose in deterministic order', () => {
    const input =
      'Research current accessibility guidance, then redesign this UI to match [Image #2].'
    expect(kinds(input)).toEqual(['research', 'frontend', 'vision'])
    const attachment = getTaskPromptOverlayAttachment(input)
    expect(attachment).toHaveLength(1)
    expect(attachment[0]?.type).toBe('task_prompt_overlay')
    if (attachment[0]?.type === 'task_prompt_overlay') {
      expect(attachment[0].content).toContain('Research contract')
      expect(attachment[0].content).toContain('Frontend contract')
      expect(attachment[0].content).toContain('Vision contract')
    }
  })

  test('unrelated tasks add no attachment', () => {
    expect(getTaskPromptOverlayAttachment('Run the existing unit tests.')).toEqual(
      [],
    )
  })
})
