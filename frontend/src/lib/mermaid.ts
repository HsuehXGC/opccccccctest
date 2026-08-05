// 把容器里的 ```mermaid 代码块渲染成 SVG 图，并统一「自动布局」(autoLayout)：
// 自动字体 / 主题 / 颜色 / 圆角（渲染前配置）+ 自动宽高 / 缩放 / margin / 居中（渲染后处理 SVG）。
// mermaid 库较大，按需动态 import（独立 chunk，不进主包）；仅当文档里真有 mermaid 块才加载。

let inited = false

// 渲染前的统一外观：字体跟随页面、柔和品牌色、内置内边距（margin）
const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict' as const, // 禁图表内嵌 HTML/脚本（内容可能来自会议/AI）
  theme: 'base' as const, // base 才能让 themeVariables 生效
  fontFamily: 'inherit', // 自动字体：用页面字体
  themeVariables: {
    // 自动颜色：跟随品牌 indigo，浅底深字、线条中性灰
    fontSize: '14px',
    primaryColor: '#eef2ff',
    primaryBorderColor: '#c7d2fe',
    primaryTextColor: '#1e293b',
    lineColor: '#94a3b8',
    secondaryColor: '#f1f5f9',
    secondaryBorderColor: '#e2e8f0',
    tertiaryColor: '#f8fafc',
    tertiaryBorderColor: '#e2e8f0',
    noteBkgColor: '#fef9c3',
    noteBorderColor: '#fde047',
  },
  // 自动 margin/间距
  flowchart: { htmlLabels: false, curve: 'basis' as const, padding: 14, nodeSpacing: 42, rankSpacing: 48, useMaxWidth: true },
  sequence: { useMaxWidth: true, wrap: true },
  gantt: { useMaxWidth: true },
}

// 渲染后对 SVG 做自动布局：按自然尺寸展示，最多撑满容器，绝不放大；圆角；高度自适应。
// 解决「图和页面同宽、被撑得太大」——小图保持原大小，宽图才缩到容器宽。
export function autoLayout(svg: SVGElement): void {
  const vb = svg.getAttribute('viewBox')
  let natW = 0
  if (vb) { const p = vb.split(/[\s,]+/).map(Number); natW = p[2] || 0 }
  // 清掉 mermaid 注入的 width="100%" / max-width:Npx（那会把小图拉大）
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  svg.style.height = 'auto' // 自动高度
  svg.style.maxWidth = '100%' // 自动缩放：宽图收到容器宽
  if (natW > 0) svg.style.width = `${Math.round(natW)}px` // 自动宽度：小图保持自然大小，不撑满
  // 自动圆角：给节点/簇加 rx/ry
  const NS = 'http://www.w3.org/2000/svg'
  if (!svg.querySelector('style[data-auto-layout]')) {
    const st = svg.ownerDocument.createElementNS(NS, 'style')
    st.setAttribute('data-auto-layout', '1')
    st.textContent = '.node rect,.node circle,.node polygon,.cluster rect{rx:7px;ry:7px}'
    svg.prepend(st)
  }
}

export async function renderMermaidIn(container: HTMLElement): Promise<void> {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>('pre > code.language-mermaid'))
  if (blocks.length === 0) return

  const mermaid = (await import('mermaid')).default
  if (!inited) { mermaid.initialize(MERMAID_CONFIG); inited = true }

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
      wrap.style.margin = '1rem 0' // 自动 margin
      wrap.style.textAlign = 'center' // 居中
      wrap.style.overflowX = 'auto'
      wrap.innerHTML = svg
      const el = wrap.querySelector('svg')
      if (el) autoLayout(el)
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
