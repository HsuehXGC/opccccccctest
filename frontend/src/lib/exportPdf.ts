import { renderMarkdown } from './markdown'

// 文档「导出 PDF」：渲染成一份干净的打印版 HTML，塞进隐藏 iframe 调 print()，
// 用浏览器「另存为 PDF」。矢量输出、中文字体不糊、文字可选，零新依赖。

const PRINT_CSS = `
@page { margin: 18mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font: 14px/1.7 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Segoe UI", sans-serif; color: #1e293b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.doc-head { border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 22px; }
.doc-head h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; letter-spacing: -.01em; }
.doc-meta { font-size: 12px; color: #64748b; }
.prose h1 { font-size: 22px; font-weight: 800; margin: 24px 0 10px; }
.prose h2 { font-size: 18px; font-weight: 700; margin: 20px 0 8px; border-bottom: 1px solid #eef2f6; padding-bottom: 4px; }
.prose h3 { font-size: 15px; font-weight: 700; margin: 16px 0 6px; }
.prose p { margin: 8px 0; }
.prose ul, .prose ol { margin: 8px 0; padding-left: 22px; }
.prose li { margin: 3px 0; }
.prose code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12.5px; }
.prose pre { background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 8px; overflow: auto; font-size: 12.5px; line-height: 1.5; }
.prose pre code { background: none; color: inherit; padding: 0; }
.prose blockquote { margin: 10px 0; padding: 4px 14px; border-left: 3px solid #cbd5e1; color: #475569; }
.prose table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
.prose th, .prose td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; vertical-align: top; }
.prose th { background: #f8fafc; font-weight: 700; }
.prose a, .prose .wikilink { color: #4f46e5; text-decoration: none; }
.prose .wikilink-broken { color: #94a3b8; }
.prose img { max-width: 100%; }
.prose hr { border: none; border-top: 1px solid #e2e8f0; margin: 16px 0; }
.prose h1, .prose h2, .prose h3 { page-break-after: avoid; }
.prose pre, .prose blockquote, .prose table, .prose img { page-break-inside: avoid; }
`

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

export function exportDocToPdf(opts: { title: string; meta: string; content: string; titleBySlug: Map<string, string> }): void {
  const body = renderMarkdown(opts.content, opts.titleBySlug)
  // <title> 决定打印对话框里 PDF 的默认文件名
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>${PRINT_CSS}</style></head><body><header class="doc-head"><h1>${esc(opts.title)}</h1><div class="doc-meta">${esc(opts.meta)}</div></header><main class="prose">${body}</main></body></html>`

  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0' })
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  if (!win) { iframe.remove(); return }
  win.document.open()
  win.document.write(html)
  win.document.close()
  // 等布局与字体就绪再打印，打印后移除 iframe
  window.setTimeout(() => {
    try {
      win.focus()
      win.print()
    } finally {
      window.setTimeout(() => iframe.remove(), 1500)
    }
  }, 400)
}
