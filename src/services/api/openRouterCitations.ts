export type OpenRouterUrlCitation = {
  url: string
  title: string
}

export function collectOpenRouterUrlCitations(
  annotations: unknown,
): OpenRouterUrlCitation[] {
  if (!Array.isArray(annotations)) return []
  const citations = new Map<string, OpenRouterUrlCitation>()
  for (const annotation of annotations) {
    if (!annotation || typeof annotation !== 'object') continue
    const record = annotation as Record<string, unknown>
    if (record.type !== 'url_citation') continue
    const citation = record.url_citation
    if (!citation || typeof citation !== 'object') continue
    const value = citation as Record<string, unknown>
    if (typeof value.url !== 'string' || !/^https?:\/\//i.test(value.url)) {
      continue
    }
    const rawTitle =
      typeof value.title === 'string' && value.title.trim()
        ? value.title.trim()
        : new URL(value.url).hostname
    const title = rawTitle.replace(/[\r\n]+/g, ' ').replace(/[\[\]]/g, '').trim()
    if (!citations.has(value.url)) {
      citations.set(value.url, { url: value.url, title })
    }
  }
  return [...citations.values()]
}

export function formatOpenRouterCitations(
  citations: Iterable<OpenRouterUrlCitation>,
): string {
  const unique = new Map<string, OpenRouterUrlCitation>()
  for (const citation of citations) unique.set(citation.url, citation)
  if (unique.size === 0) return ''
  return `\n\nSources:\n${[...unique.values()]
    .map(citation => `- [${citation.title}](${citation.url})`)
    .join('\n')}`
}
