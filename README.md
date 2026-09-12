# AgentBaton

> One baton. Every agent.

AgentBaton 是一款本地优先的跨平台桌面应用，用于汇总、分组、同步和安全部署多个 AI Agent 的 Skill。它的目标是让用户按工作开发、个人全栈、AI 剪辑等场景，只为每个 Agent 启用真正需要的 Skill。

V1 是 **多 Agent 的 Skill 控制面**，不是 Agent 编排或工作流平台。

## 支持范围

- 桌面应用：macOS、Windows、Linux
- Agent：Codex、Claude Code、Cursor、TRAE、OpenCode

五种 Agent 的集成能力并不假定在三种系统上完全一致。AgentBaton 按[官方适配矩阵](./docs/research/agent-adapter-compatibility-matrix.md)降级；例如 TRAE 在 Linux 上不提供集成写入。

## 核心原则

- 默认只发现，用户显式纳管后才创建规范副本。
- 新纳管 Skill 默认 `Local Only`，不会自动上传。
- Skill Group 是多对多的逻辑集合，可被多个 Agent 独立启用。
- 所有写入先生成 Apply Plan、校验目标、创建备份，再由用户确认。
- 不执行 Skill 内容，不静默覆盖上游、同步冲突或安装漂移。
- 不自动重启 Agent；需要重启时明确显示状态。

完整需求见 [V1 需求文档](./docs/requirements-v1.md)，术语见 [领域模型](./CONTEXT.md)，架构见 [技术架构](./docs/architecture-v1.md)。

## 本地开发

```bash
npm ci
npm run check
npm run dev
```

本机分发目录构建：

- npm run package -- --mac dir
- npm run package -- --win dir
- npm run package -- --linux dir

Electron 预览需要下载对应平台的 Electron 运行时。仓库已配置三系统 CI 工作流用于测试、类型检查和构建，但本项目尚未取得远端 CI 执行证据；真实 Agent 行为仍须分别通过 Adapter fixture 与目标环境验证。

`npm run check` 与 CI 使用同一验证入口，依次执行类型检查、测试和构建。开发约定及代码目录见 [贡献指南](./CONTRIBUTING.md)。

## 当前状态

项目处于 V1 开发中。当前已经实现并测试了：显式纳管、分组和三态覆盖、安全 Apply Plan/回滚、上游隔离更新、Local Only 同步过滤、回收站/墓碑、手动 Git 工作树同步、新设备只恢复期望状态、诊断包和多 Agent Adapter 发现。

尚未达到可发布的 V1：GitHub App 正式 Device Flow、同步冲突决议界面、真实 Windows/Linux 运行证据及真实 Agent 验证仍在进行中。详细且可审计的状态见 [V1 中期验收审计](./docs/verification/v1-gap-audit.md)。
