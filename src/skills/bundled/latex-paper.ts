import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { registerBundledSkill } from '../bundledSkills.js'

const LATEX_PAPER_PROMPT = `# LaTeX Paper Skill

Generate or compile a LaTeX paper/report in an isolated worktree. Keep the source clean, add a build script, and open a PR.

## Setup

1. Use the ${AGENT_TOOL_NAME} tool with "isolation: worktree" to create a fresh git worktree and branch named "ur/latex-<timestamp>-<slug>".
2. Determine the paper topic and target venue or format. If the user provided an outline, follow it; otherwise propose one.

## Files to create

1. **paper.tex** — main LaTeX document with title, author, abstract, sections, figures/tables as needed, and bibliography.
2. **refs.bib** — BibTeX references (or inline bibliography if simpler).
3. **Makefile** or **build.sh** — command to compile to PDF using pdflatex/xelatex/lualatex + bibtex/biber.
4. **.gitignore** for LaTeX build artifacts (*.aux, *.log, *.out, *.pdf, etc.) if a dedicated paper directory is used.

## Writing guidelines

- Be precise; avoid filler.
- Cite sources for claims.
- Use standard packages and macros; keep custom preamble minimal.
- Include a reproducible build command.

## Verification

1. Run the build command and ensure a PDF is produced.
2. Commit the source, build script, and any generated assets that should be tracked (do not commit build artifacts that are gitignored).
3. If compilation errors occur, fix them and rerun.

## PR Output

1. Push the branch.
2. Open a PR with:
   - Title: "docs(scope): add LaTeX paper/report on X"
   - Body: topic, build command, and location of source/PDF.

Return a concise summary: branch name, commits, PR URL, and build result.
`

export function registerLatexPaperSkill(): void {
  registerBundledSkill({
    name: 'latex-paper',
    aliases: ['latex', 'paper'],
    description:
      'Generate or compile a LaTeX paper/report in an isolated worktree with a build script and open a PR.',
    allowedTools: [AGENT_TOOL_NAME, 'Read', 'Grep', 'Glob', 'Edit', 'Bash'],
    argumentHint: '[paper topic or outline]',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = LATEX_PAPER_PROMPT
      if (args) {
        prompt += `\n\n## Paper topic\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
