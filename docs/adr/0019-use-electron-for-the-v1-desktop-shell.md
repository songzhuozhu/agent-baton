# 使用 Electron 作为 V1 桌面壳

AgentBaton V1 使用 Electron、React、TypeScript 和 SQLite。Electron 主进程承载受控的文件、Git、SQLite 和系统凭据职责，渲染进程启用 context isolation、sandbox 并关闭 Node integration，只经窄且经过 schema 验证的 IPC 调用用例。选择 Electron 是因为首版的核心风险在五个 Agent 的本地文件适配和安全写入，而非极小安装包；当前 Node 工具链可立即交付跨平台开发和测试。Electron safeStorage 可在 macOS、Windows 和具备 Secret Service 的 Linux 上使用系统安全存储；Linux 退回 `basic_text` 时必须拒绝保存凭据。Tauri 保留为未来基于实际包体、性能和维护数据重新评估的候选，而不是 V1 前置条件。
