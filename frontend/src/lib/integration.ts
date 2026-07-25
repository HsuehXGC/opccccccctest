// 「系统集成 agent」——跑在隐藏算力（mini）上的 claude，专做系统集成/运维类活。
// 这里放预设任务 + 提示词封装。真正执行走 runExecutorStream 直连该机器的 claude 执行器。

export type IntegrationPreset = {
  key: string
  label: string
  desc: string
  instruction: string
  /** 该预设是否天然需要「可变更」权限（否则只读诊断即可） */
  needsWrite?: boolean
}

export const INTEGRATION_PRESETS: IntegrationPreset[] = [
  {
    key: 'inspect',
    label: '系统巡检',
    desc: '体检本机：OS/CPU/内存/磁盘、node/claude/git 版本、opc-agent 是否常驻',
    instruction:
      '对这台机器做一次系统巡检：报告 OS 版本、CPU/内存/磁盘占用；node、claude、git 的版本与路径；opc-agent 常驻服务（launchd com.opc.agent* / systemd opc-agent*）是否在跑、日志尾部有无报错。给出健康结论与需要关注的项。',
  },
  {
    key: 'agent-health',
    label: 'agent 自检',
    desc: '检查 opc-agent 常驻服务是否健康、能否稳定重连云端',
    instruction:
      '检查本机 opc-agent 的运行情况：常驻服务是否已安装并处于运行态、最近是否有断线/重连、~/.opc/agent*.log 尾部有无异常。判断它能否稳定保持与云端的长连接，给出结论与建议。',
  },
  {
    key: 'fixdeps',
    label: '依赖修复',
    desc: '检查工具链缺失/过期，给出（或执行）修复',
    needsWrite: true,
    instruction:
      '检查这台机器作为 OPC 执行器所需的工具链：node ≥ 20、claude CLI（并已登录）、git、curl。列出缺失或过期的项。若已授权变更，则按最小改动修复（优先装到 ~/.opc、免 sudo），修完复测；否则只给出建议的修复命令。',
  },
  {
    key: 'diagnose',
    label: '环境诊断',
    desc: '排查某一步为什么失败（把日志/报错贴到下方）',
    instruction:
      '诊断下面这个问题（我会把现象/日志/相关路径贴在后面）。请定位根因、给出确切的修复步骤；能本机验证的先验证。\n\n现象与日志：\n',
  },
]

// 把用户指令封装成「系统集成 agent」的提示词。allowWrite 决定它是只诊断还是可动手改。
export function integrationPrompt(instruction: string, allowWrite: boolean): string {
  return [
    '你是 OPC 的「系统集成 agent」，运行在运营者本人的一台机器上（隐藏算力，不接普通产品任务，专做系统集成 / 运维 / 部署诊断类工作）。',
    '你可以在本机跑 shell、读写文件、调用 git、查看服务状态（launchctl / systemctl）。',
    '',
    '# 任务',
    instruction.trim() || '（无具体指令）',
    '',
    '# 规则',
    allowWrite
      ? '- 已授权你执行「变更/修复」：动手前先用一两句说清你打算做什么，再执行，最后汇报实际结果。保持最小改动、可回滚。'
      : '- 本次为「只读诊断」：只勘察、下结论、给出**建议的命令**，不要真的改动系统 / 安装 / 删除 / 重启服务。',
    '- 一律不碰：密码、密钥、付费/转账、删除用户数据、修改安全设置——遇到就停下来交回运营者。',
    '- 不确定影响面的破坏性操作，先问清再做。',
    '',
    '# 输出（中文，结构化）',
    '【结论】一句话总体判断；',
    '【发现】关键事实与证据（命令输出可摘录关键行）；',
    allowWrite ? '【已执行】做了哪些改动 + 复测结果。' : '【建议】按优先级给出可直接执行的命令或步骤。',
  ].join('\n')
}
