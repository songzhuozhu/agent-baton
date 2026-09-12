# AgentBaton V1 开发与测试计划

## 里程碑 0：工程与架构

- 建立 Electron、React、TypeScript、Vitest、SQLite 工程。
- 实现安全 Electron 窗口和窄类型化 IPC。
- 落地 [技术架构](./architecture-v1.md)、[同步格式](./sync-format-v1.md)、Adapter 兼容矩阵。
- 建立 macOS、Windows、Linux 的 CI 构建与测试矩阵。

**退出条件：** 三个平台均能执行类型检查和单元测试；渲染进程没有 Node 访问能力；Agent 集成能力按官方矩阵准确降级，不能假定五个 Agent 在三平台完全对称。

## 里程碑 1：纯领域核心

- 建模 Skill、Installation、Group、Desired/Observed State、Apply Plan。
- 实现有效 Skill 集合、同步选择、风险分类、删除影响分析和冲突分类。
- SQLite 迁移和 Repository 实现。

**退出条件：** 领域不变量具备确定性单元测试，特别覆盖多组去重、强制禁用优先级和 `Local Only` 不泄漏。

## 里程碑 2：Codex 纵向切片

- 检测、用户级发现、自定义只读发现、显式纳管、Managed Library。
- Codex 原生禁用配置、受控部署、Apply Plan、哈希预检、备份和回滚。
- Agent-first 首页和 Codex 详情页。

**退出条件：** 在 macOS 真机完成发现→纳管→分组→预览→应用→重启提示→验证链路；测试不执行任何 Skill 内容。

## 里程碑 3：五个 Agent Adapter

- 依次实现 Claude Code、Cursor、Trae、OpenCode Adapter。
- 为每个 Adapter 提供文件系统 fixture、契约测试和不安全/歧义时的只读降级。
- 完善多 Agent 批量应用和部分失败报告。

**退出条件：** 五个 Adapter 的契约测试通过；已知受限能力准确显示为警告或不兼容。

## 里程碑 4：同步与上游生命周期

- 完成 GitHub Device Flow、系统安全存储和专用同步仓库。
- 实现确定性快照、手动同步预览、字段冲突与内容冲突。
- 实现上游检查、暂存、分叉阻止、回收站、墓碑与恢复。

**退出条件：** 两个临时仓库克隆可复现同步/冲突/恢复链路；没有令牌或 `Local Only` 数据进入同步目录。

## 里程碑 5：产品完成度与交付

- 完成 Skill 库、分组、同步、设置和诊断界面。
- 补齐键盘操作、主题、空状态、错误状态和文档。
- 构建安装包，执行跨平台 CI 与验收审计。

**退出条件：** [需求文档第 9 节](./requirements-v1.md) 的 12 条主链路均有测试或真实环境证据。

## 测试分层

| 层级 | 工具 | 覆盖重点 |
|---|---|---|
| 纯领域 | Vitest | 集合计算、同步选择、冲突、删除和不变量 |
| 基础设施 | Vitest + 临时目录/SQLite | 迁移、文件事务、托管库、格式读写 |
| Adapter 契约 | Vitest + fixture | 发现、计划、只读降级、部署策略 |
| 主进程集成 | Electron 测试运行时 | IPC schema、凭据存储状态、用例编排 |
| 端到端 | Playwright 驱动 Electron | 首页、预览、确认、状态反馈 |
| 平台 CI | GitHub Actions Matrix | macOS、Windows、Linux 的构建、类型检查、测试 |

任何测试都不得执行 fixture Skill 中的脚本；fixture 使用无害文本文件证明扫描与风险分类行为。
