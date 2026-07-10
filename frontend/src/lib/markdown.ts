import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: false })

const WIKILINK = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g

/** 抽取正文里引用的所有 [[slug]] */
export function extractLinks(content: string): string[] {
  const out = new Set<string>()
  for (const m of content.matchAll(WIKILINK)) out.add(m[1].trim())
  return [...out]
}

/**
 * 渲染 Markdown，并把 [[slug]] / [[slug|标签]] 转成可点击的 wiki 链接。
 * 未知 slug 渲染为「断链」样式。点击由 WikiContent 通过事件委托处理。
 */
export function renderMarkdown(content: string, titleBySlug: Map<string, string>): string {
  const withLinks = content.replace(WIKILINK, (_all, slugRaw: string, label?: string) => {
    const slug = slugRaw.trim()
    const known = titleBySlug.has(slug)
    const text = (label ?? titleBySlug.get(slug) ?? slug).trim()
    const cls = known ? 'wikilink' : 'wikilink wikilink-broken'
    const tail = known ? '' : ' ⚠'
    return `<a data-slug="${slug}" class="${cls}">${text}${tail}</a>`
  })
  return marked.parse(withLinks) as string
}
