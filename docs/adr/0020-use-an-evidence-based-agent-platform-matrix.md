# 使用基于证据的 Agent 平台能力矩阵

AgentBaton 的桌面应用在 macOS、Windows 和 Linux 上构建运行，但五个 Agent 的集成能力不假定对称。每个 Adapter 仅在官方资料和真实验证共同支持的操作系统、路径与控制方式上提供写入；缺少其中任一证据时返回只读、警告或不兼容。V1 尤其不得宣称 TRAE 的 Linux 集成，因为其官方公开资料仅支持 macOS 与 Windows；也不得把 Cursor 的 `disable-model-invocation` 当作外部 Skill 的完全禁用。这一决定将产品的跨平台承诺与第三方 Agent 的真实可用性分开，避免以破坏用户文件的方式伪造统一体验。
