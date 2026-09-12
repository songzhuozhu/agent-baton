# 使用 Agent 专属适配器实现统一语义

AgentBaton 在核心域中统一表达分组、单 Skill 覆盖、期望状态和应用计划，但由 Codex、Claude Code、Cursor、Trae、OpenCode 各自的 Agent Adapter 负责检测、扫描、规划、应用和验证。适配器优先使用 Agent 官方原生配置，只在缺少安全原生开关时为托管 Skill 管理链接或副本，不修改第三方 `SKILL.md` 模拟禁用；无法安全写入时降级为只读。配置允许在 Agent 重启后生效，核心状态应能明确表示“待重启”，而不是将其误报为失败。V1 不主动结束或重启正在运行的 Agent，避免中断任务和丢失未保存状态；它只提示用户重启并在之后重新验证。
