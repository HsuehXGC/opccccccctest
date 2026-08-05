// 把容器里的 ```mermaid 代码块渲染成 SVG 图。
// mermaid 库较大，按需动态 import（独立 chunk，不进主包）；仅当文档里真有 mermaid 块才加载。

let inited = false

export async function renderMermaidIn(container: HTMLElement): Promise<void> {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>('pre > code.language-mermaid'))
  if (blocks.length === 0) return

  const mermaid = (await import('mermaid')).default
  if (!inited) {
    // strict：禁止图表内嵌 HTML/脚本（内容可能来自会议/AI 生成，防注入）
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', fontFamily: 'inherit' })
    inited = true
  }

  // 用容器所在文档创建元素——这样对主文档和打印用的 iframe 都成立
  const doc = container.ownerDocument || document
  for (let i = 0; i < blocks.length; i++) {
    const code = blocks[i]
    const pre = code.parentElement
    if (!pre) continue
    const src = (code.textContent ?? '').trim()
    if (!src) continue
    const id = `mmd-${Math.random().toString(36).slice(2)}-${i}`
    try {
      const { svg } = await mermaid.render(id, src)
      const wrap = doc.createElement('div')
      wrap.className = 'mermaid-figure'
      wrap.style.margin = '1rem 0'
      wrap.style.textAlign = 'center'
      wrap.style.overflowX = 'auto'
      wrap.innerHTML = svg
      const el = wrap.querySelector('svg')
      if (el) { el.style.maxWidth = '100%'; el.style.height = 'auto' }
      pre.replaceWith(wrap)
    } catch (err) {
      // 渲染失败（多为语法错误）：保留原代码块，下面加一行提示便于定位
      document.getElementById(id)?.remove() // mermaid 的临时节点挂在主文档
      doc.getElementById(id)?.remove()
      const note = doc.createElement('div')
      note.style.cssText = 'margin:.25rem 0 1rem;color:#e11d48;font-size:12px'
      note.textContent = 'mermaid 渲染失败：' + (err instanceof Error ? err.message : String(err))
      pre.after(note)
    }
  }
}
