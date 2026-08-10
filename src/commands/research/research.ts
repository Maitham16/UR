import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { addResearch, listResearch } from '../../ur/notes.js'
import {
  addResearchFinding,
  addResearchQuestion,
  addResearchSource,
  auditResearchProject,
  createResearchProject,
  listResearchProjects,
  loadResearchProject,
  renderResearchReport,
  researchProjectDigest,
  writeResearchReport,
} from '../../services/research/researchWorkspace.js'

const ACTIONS = new Set(['init', 'list', 'source', 'finding', 'question', 'show', 'verify', 'report', 'help'])
const OPTIONS_WITH_VALUES = new Set([
  '--question',
  '--url',
  '--title',
  '--publisher',
  '--published',
  '--notes',
  '--text',
  '--cite',
  '--confidence',
  '--status',
  '--out',
])

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const values: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (OPTIONS_WITH_VALUES.has(token)) {
      index++
      continue
    }
    if (!token.startsWith('--')) values.push(token)
  }
  return values
}

function usage(): string {
  return [
    'Evidence-backed research workspaces:',
    '  ur research init <id> --question "..."',
    '  ur research source <id> --url <https-url> --title "..." [--publisher "..."] [--published <date>]',
    '  ur research finding <id> --text "..." --cite S1,S2 [--confidence low|medium|high] [--status supported|contested|open]',
    '  ur research question <id> --text "..."',
    '  ur research list|show|verify|report <id> [--out <workspace-path>] [--json]',
    '',
    'Backward compatible: any unrecognized text is appended to the legacy research notes.',
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const text = (args ?? '').trim()
  if (!text) {
    const projects = listResearchProjects(getCwd())
    const notes = listResearch(getCwd(), 'notes')
    if (projects.length > 0) {
      return {
        type: 'text',
        value: projects
          .map(project => `${project.id}: ${project.question} (${project.sources.length} sources, ${project.findings.length} findings)`)
          .join('\n'),
      }
    }
    return { type: 'text', value: notes.length ? notes.map((i) => `- ${i.text}`).join('\n') : usage() }
  }
  const tokens = parseArguments(text)
  const values = positionals(tokens)
  const action = values[0]
  const json = tokens.includes('--json')
  const root = getCwd()
  if (!action || !ACTIONS.has(action)) {
    addResearch(root, 'notes', text)
    return { type: 'text', value: `added to notes: ${text}` }
  }

  try {
    if (action === 'help') return { type: 'text', value: usage() }
    if (action === 'list') {
      const projects = listResearchProjects(root)
      return {
        type: 'text',
        value: json
          ? JSON.stringify({ projects }, null, 2)
          : projects.length
            ? projects.map(project => `${project.id}: ${project.question} (${project.sources.length} sources, ${project.findings.length} findings)`).join('\n')
            : 'No research workspaces. Create one with `ur research init <id> --question "..."`.',
      }
    }

    const id = values[1]
    if (!id) return { type: 'text', value: usage() }
    if (action === 'init') {
      const question = option(tokens, '--question')
      if (!question) return { type: 'text', value: 'init requires --question "..."' }
      const project = createResearchProject(root, id, question)
      return { type: 'text', value: json ? JSON.stringify(project, null, 2) : `Created research workspace ${project.id}.` }
    }
    if (action === 'source') {
      const url = option(tokens, '--url')
      const title = option(tokens, '--title')
      if (!url || !title) return { type: 'text', value: 'source requires --url <https-url> and --title "..."' }
      const source = addResearchSource(root, id, {
        url,
        title,
        publisher: option(tokens, '--publisher'),
        publishedAt: option(tokens, '--published'),
        notes: option(tokens, '--notes'),
      })
      return { type: 'text', value: json ? JSON.stringify(source, null, 2) : `Added ${source.id}: ${source.title}` }
    }
    if (action === 'finding') {
      const findingText = option(tokens, '--text')
      if (!findingText) return { type: 'text', value: 'finding requires --text "..."' }
      const finding = addResearchFinding(root, id, {
        text: findingText,
        sourceIds: option(tokens, '--cite')?.split(','),
        confidence: option(tokens, '--confidence') as 'low' | 'medium' | 'high' | undefined,
        status: option(tokens, '--status') as 'supported' | 'contested' | 'open' | undefined,
      })
      return { type: 'text', value: json ? JSON.stringify(finding, null, 2) : `Added ${finding.id} (${finding.status}, ${finding.confidence}).` }
    }
    if (action === 'question') {
      const questionText = option(tokens, '--text')
      if (!questionText) return { type: 'text', value: 'question requires --text "..."' }
      const question = addResearchQuestion(root, id, questionText)
      return { type: 'text', value: json ? JSON.stringify(question, null, 2) : `Added open question ${question.id}.` }
    }

    const project = loadResearchProject(root, id)
    if (action === 'show') {
      return {
        type: 'text',
        value: json
          ? JSON.stringify({ project, digest: researchProjectDigest(project) }, null, 2)
          : renderResearchReport(project),
      }
    }
    if (action === 'verify') {
      const audit = auditResearchProject(project)
      const human = [
        `Research verification: ${audit.ready ? 'PASS' : audit.valid ? 'WARN' : 'FAIL'}`,
        `Sources: ${audit.sourceCount}; findings: ${audit.findingCount}; open questions: ${audit.openQuestionCount}`,
        ...audit.issues.map(issue => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`),
      ].join('\n')
      return { type: 'text', value: json ? JSON.stringify(audit, null, 2) : human }
    }
    if (action === 'report') {
      const report = renderResearchReport(project)
      const out = option(tokens, '--out')
      if (out) {
        const path = writeResearchReport(root, out, report)
        return { type: 'text', value: json ? JSON.stringify({ path, audit: auditResearchProject(project) }, null, 2) : `Wrote research report to ${path}` }
      }
      return { type: 'text', value: report }
    }
  } catch (error) {
    return { type: 'text', value: `research failed: ${error instanceof Error ? error.message : String(error)}` }
  }

  return { type: 'text', value: usage() }
}
