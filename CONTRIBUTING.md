# 开发指南

## 开始开发

建议使用 Node.js 24（与 CI 一致）和 npm；使用 nvm 时先执行 `nvm use`，再用 `npm ci` 按锁文件安装依赖。

仓库通过 `package.json` 的 `allowScripts` 为必要的原生构建依赖记录精确版本许可。支持该机制的 npm 会阻止未列出的依赖脚本；升级这些依赖后，请审阅新版本的安装脚本，再更新对应许可。

提交前执行 `npm run check`，它包含 TypeScript 类型检查、Vitest 测试和 Electron Vite 构建。

运行桌面应用使用 `npm run dev`；构建 macOS 本机目录包使用 `npm run package -- --mac dir`。
构建目录包不会验证目标 Agent 是否真实加载了 Skill，平台声明须以实际证据为准。

## 代码结构

- `src/domain/`：不依赖桌面环境的领域规则。
- `src/shared/`：领域类型与 IPC 数据契约。
- `src/main/`：用例、SQLite、文件事务、Git 和内置 Agent Adapter。
- `src/preload/`：向隔离渲染进程暴露受限 IPC 接口。
- `src/renderer/main.tsx`：React 挂载入口。
- `src/renderer/App.tsx`：页面状态和用例交互；`components/` 放置独立 UI，`hooks/` 放置可复用的 React 逻辑。
- `src/sync/`：同步仓库格式与三方合并规则。
- `src/e2e/`：使用隔离 fixture 的用例链路测试，不等同于真实桌面或 Agent 验证。

测试与实现就近放置，使用 `*.test.ts` 或 `*.test.tsx`。界面行为测试通过文件顶部的
`// @vitest-environment jsdom` 选择 DOM 环境；默认 Node 环境用于领域和文件系统测试。

## 变更边界

以 `docs/requirements-v1.md`、`CONTEXT.md` 和 `docs/adr/` 为产品与架构依据。
保留显式纳管、Local Only 默认不同步、预览确认、漂移阻断和事务回滚边界。
测试不得执行 Skill 中的脚本，也不得操作开发者真实 Agent 安装目录。

Electron 渲染进程保持 sandbox、context isolation 且禁止 Node integration。
预加载脚本必须构建为 CommonJS，保持输出 `out/preload/index.cjs` 与主进程加载路径一致。

新增或变化的能力应在 `docs/verification/v1-gap-audit.md` 记录实际证据与剩余缺口。
不提交依赖、构建产物、数据库、日志或本地凭据。仓库当前仍处于 V1 开发阶段。

## 从哪里贡献

优先问题与本轮实际证据见[开发路线](docs/roadmap.md)。问题反馈和体验建议可使用 GitHub Issue 表单；请写清环境、复现步骤与预期结果。

界面测试使用隔离的 IPC fixture。`jsdom` 不具备原生 dialog 的顶层与完整焦点行为，涉及弹窗的改动还需在 Chromium/Electron 中检查 Escape、焦点返回、深浅主题和 980 × 680 最小桌面窗口。不要用 mock 通过替代实机声明。

修改同步格式时，同时验证非法路径、文件名与实体 ID 不一致、Local Only 排除，以及失败后原工作树/暂存区保持完整。手工构造的 JSON 文件也应遵循同步格式，不能依赖未经验证的类型断言。

## 预览发布

`main` 的 macOS、Windows、Linux 三项源码检查全部通过后，CI 会为新的 `X.Y.Z-preview.N` 版本创建仅源码 GitHub 预发布。Ubuntu 检查还会执行 `npm audit --audit-level=moderate`，已知中危及以上依赖告警会阻止发布。需同时更新 `package.json`、锁文件版本和 `CHANGELOG.md` 中对应章节。已有同名 Release 保持不变；普通分支、PR 和非预览版本不会触发发布。发布任务只使用该任务的 `contents: write` 权限，不需要仓库自定义令牌。

源码预发布不等于签名桌面安装包；正式发布和真实 Agent 验收按开发路线单独推进。
