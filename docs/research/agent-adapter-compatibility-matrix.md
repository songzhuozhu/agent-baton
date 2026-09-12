# Agent Adapter 兼容性矩阵（官方资料）

> 状态：技术调研，尚未等同于已验证实现
>
> 访问日期：2026-08-09
> 范围：Codex、Claude Code、Cursor、TRAE、OpenCode 的本地 Skill 发现与控制能力。只使用产品官方文档或官方变更日志；没有官方依据的项目明确标为“待验证”。

## 结论摘要

1. **不能用一个文件部署策略覆盖五个 Agent。** Codex 明确支持符号链接和原生逐 Skill 禁用；Claude Code 有原生 `skillOverrides` 与会话内文件监听；OpenCode 有按名称/模式的 `allow`、`ask`、`deny` 权限。Cursor 公开文档没有独立的“完全禁用已发现 Skill”配置；TRAE 的公开官方资料未公布路径或配置格式。
2. **TRAE 的 Linux 集成不能宣称已支持。** TRAE 官方变更日志仅列出 macOS 12+ 与 Windows 10/11 的系统要求，没有 Linux 客户端或 Linux Skill 路径的官方证据。[S7]
3. **Codex 官方文档对 `skills.config.path` 的粒度存在冲突。** Skills 页面示例写入 `SKILL.md` 路径，而 Config Reference 写“包含 `SKILL.md` 的 Skill 文件夹”。Adapter 必须在目标 Codex 版本的 fixture/真实环境上验证后才写入该字段，不能猜测。[S1][S2]
4. **AgentBaton V1 的“用户级写入”边界可实现，但有功能降级。** 对于没有官方原生单 Skill 禁用的 Agent（Cursor，TRAE 尚未验证），仅能安全管理 AgentBaton 自己创建的 Installation；不得为了禁用“发现但未托管”的外部 Skill 而删除、移动或改写其原文件。这是 FR-01、FR-07、FR-08、ADR-0007、ADR-0009、ADR-0010 与 ADR-0013 的直接约束。

## 术语与判定规则

- **用户级发现路径**：官方资料明确声明、位于用户主目录或用户配置目录的路径。`~` 在不同操作系统解析为当前用户主目录；除官方另有说明外，不能由此推导特殊的 Windows/macOS/Linux 路径。
- **项目级路径**：只用于发现和展示。根据 FR-01，V1 不向项目级路径写入。
- **原生启停**：不改写第三方 `SKILL.md`，通过 Agent 已公开的配置或设置控制 Skill 可见性/访问性。
- **安全部署**：仅部署已经显式纳管的规范副本；所有文件和配置写入仍须经过 Apply Plan、确认、备份、写前哈希校验与验证。这里的“建议”是对 ADR 的工程推导，不是官方产品保证。
- **待验证**：官方资料没有覆盖，或官方资料存在冲突。V1 Adapter 应报告 `未知` / `兼容但有警告`，不能当作已支持能力写入。

## 兼容性总表

| Agent | 用户级 Skill 发现路径（官方） | 项目级 Skill 发现路径（官方） | 原生启用 / 禁用 | 生效与重启 | 可安全部署方式与限制 | V1 Adapter 初始判定 |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | `$HOME/.agents/skills`。[S1] | 从 CWD 到仓库根目录沿途的 `.agents/skills`。[S1] | `~/.codex/config.toml` 的 `[[skills.config]]` 可用 `enabled = false` 禁用指定 Skill。[S1][S2] | 内容变更自动检测；未出现时重启。改 `config.toml` 后**必须重启 Codex**。[S1] | 官方明确支持被扫描位置中的符号链接；优先原生配置禁用，托管 Skill 可链接到用户级目录。`path` 指向 Skill 目录还是 `SKILL.md` 存在官方文档冲突，写配置前必须验证。[S1][S2] | 可实现；配置字段先做版本 fixture 验证。 |
| Claude Code | `~/.claude/skills/<name>/SKILL.md`；Windows 上 `~/.claude` 解析为 `%USERPROFILE%\\.claude`；`CLAUDE_CONFIG_DIR` 可改变根目录。[S3][S4] | `.claude/skills/<name>/SKILL.md`；从启动目录向上到仓库根目录，并按需发现嵌套目录。[S3] | `skillOverrides` 的 `on` / `name-only` / `user-invocable-only` / `off` 控制可见性；`/skills` 写入 `.claude/settings.local.json`。用户级 `~/.claude/settings.json` 作用于所有项目。[S3][S11] | 已存在的用户/项目/`--add-dir` Skill 根目录会被监听，增删改当前会话内生效；会话开始后才创建顶层 Skill 根目录则要重启；设置文件通常也会热重载。[S3][S11] | v2.1.203+ 官方支持 Skill 目录符号链接；优先在 `~/.claude/skills` 链接或受控复制，并只改用户级 `settings.json`。高优先级项目/本地/受管设置可能覆盖用户期望，须显示漂移。[S3][S11] | 可实现；按名称 override 的歧义需阻止自动应用。 |
| Cursor | `~/.agents/skills/`、`~/.cursor/skills/`；兼容读取 `~/.claude/skills/`、`~/.codex/skills/`。[S5] | `.agents/skills/`、`.cursor/skills/`；兼容读取 `.claude/skills/`、`.codex/skills/`，并递归发现嵌套项目目录。[S5] | `disable-model-invocation: true` 只禁止模型自动调用，Skill 仍可被 `/` 显式调用；公开文档未给出独立的、完全隐藏已发现单 Skill 的外部配置。[S5] | 文档只说“Cursor 启动时自动发现”；没有公开热重载或重启保证，视为待验证。[S5] | 仅向 AgentBaton 自己管理的用户级根目录写入链接/受控副本；不要改写第三方 frontmatter 来模拟禁用。对于外部已发现 Skill，不能安全承诺“完全禁用”。[S5] | 发现与部署可做；单 Skill 原生禁用受限。 |
| TRAE | 官方资料确认“支持全局 Skill”，但没有公布实际用户级目录或设置文件路径。[S7] | 官方资料确认“支持项目级 Skill”；另有官方日志称可从 `.agents/skills` 加载，但未说明全局/优先级细节。[S7] | 官方资料确认 Skill 可启用/禁用；未公布文件/API/UI 自动化方式。[S7] | 官方资料未说明热重载或重启要求。[S7] | 在官方路径和配置格式得到 fixture/真实应用验证前，一律只读；不能猜测并写入 `.agents/skills` 或内部配置。仅在 macOS/Windows 进行真实集成验证。 | 待验证；Linux 不得声称集成可用。 |
| OpenCode | `~/.config/opencode/skills/<name>/SKILL.md`，兼容读取 `~/.claude/skills/`、`~/.agents/skills/`。[S8] | `.opencode/skills/<name>/SKILL.md`，兼容 `.claude/skills/`、`.agents/skills/`；从 CWD 向上到 Git worktree。[S8] | `opencode.json` 的 `permission.skill` 支持 `allow` / `ask` / `deny` 和模式；可对特定内置/自定义 Agent 覆盖。[S8] | 官方资料未声明 Skill 配置热重载或重启要求，待验证；新的会话/进程后必须重新观测。[S8][S9] | 优先在 `~/.config/opencode/skills` 使用受控副本；链接策略须经过平台 fixture 验证。修改全局配置前先解析并保留 JSON/JSONC，且检测当前版本配置格式；官方还在演进 V2 `permissions` 格式，不能假定旧字段长期稳定。[S8][S9][S10] | 可实现；配置格式、加载时机做版本化能力探测。 |

## 各 Adapter 的实现约束

### Codex

- 扫描只包含 `$HOME/.agents/skills`，同时把 `/etc/codex/skills` 和 OpenAI bundled system Skills 视为只读系统能力，不纳管写入。[S1]
- 对已纳管 Skill，原生禁用应使用 `skills.config`，而不是删除原文件或改写 `SKILL.md`。[S1][S2]
- `config.toml` 修改计划必须带 `restartRequired = true`；Skill 文件部署计划的验证可先观测自动检测，失败时显示“请重启后验证”。[S1]
- Codex 会跟随被扫描路径中的符号链接，但遵守 ADR-0012：AgentBaton 先解析目标、禁止越出托管库范围的链接，再部署。[S1]

### Claude Code

- 发现层需识别 `CLAUDE_CONFIG_DIR`，否则默认根是 `~/.claude`；Windows 必须解析为 `%USERPROFILE%\\.claude`。[S4]
- `skillOverrides.off` 是最接近“禁用”的官方原生语义；`user-invocable-only` 不是禁用，只是对模型隐藏，仍会保留在 `/` 菜单中。[S3]
- 新建顶层 `~/.claude/skills` 前若当前 session 不存在它，Apply Plan 必须显示“待重启”；既有目录内的文件更新可标记“会话内可检测”。设置文件通常热重载，但为符合 ADR-0007，应用后仍应重新验证，而不是假定已生效。[S3][S11]
- `skillOverrides` 用 Skill 名称而不是文件路径作键；对同名候选或插件 Skill，Adapter 必须阻止自动应用并说明歧义。插件 Skill 不受 `skillOverrides` 控制。[S3]
- Claude Code v2.1.203+ 支持个人、项目、企业 Skill 目录符号链接。低版本或链接失败时才降级为受控复制，并用哈希识别 Installation Drift。[S3]
- `allowed-tools` 与 `!` shell 代码可能使 Skill 具备副作用；这不会改变 AgentBaton “扫描/同步过程不执行 Skill”的安全边界。[S3]

### Cursor

- 不要将 `disable-model-invocation` 当作“禁用”：官方定义是只禁止自动调用，用户仍可用 `/skill-name` 调用。[S5]
- 由于 Cursor 会同时读兼容目录，AgentBaton 即使只写 `~/.cursor/skills`，也要在 Observed State 中纳入来自 `~/.agents`、`.claude`、`.codex` 的实际可见性。[S5]
- 项目写入是 V1 非目标；嵌套目录自动作用域仅作为扫描与兼容性信息展示。[S5]
- 对非 AgentBaton 管理的外部 Installation，Apply Plan 应明确显示“无官方安全禁用方式”，不能通过删除、移动、覆盖或修改第三方前言字段解决。

### TRAE

- 官方更新记录在 2026-01-23 仅确认三项产品能力：全局 Skill、项目级 Skill、Skill 可启用/禁用，并确认 macOS 12+/Windows 10/11 系统要求。[S7]
- 官方更新记录在 2026-04-03 仅确认可从 `.agents/skills` 加载 Skill plugin；它不足以证明用户级目录、优先级、配置格式、链接兼容性或生效时机。[S7]
- 因此 TRAE Adapter 的 V1 交付门槛是：为 macOS 和 Windows 各提供一组基于真实 Trae 版本的 adapter fixture/手动集成证据；Linux 仅显示“未检测到官方支持 / 只读”，不能作为通过的功能集成。

### OpenCode

- 原生 `deny` 会使 Skill 对 Agent 隐藏并拒绝访问；`ask` 仍会显示但加载时要求批准。这可直接映射 AgentBaton 的“强制禁用”和“兼容但有警告”提示，不能把 `ask` 误报为禁用。[S8]
- 全局配置位置是 `~/.config/opencode/opencode.json`，项目配置为项目根的 `opencode.json`；二者合并且项目覆盖全局。V1 只能改用户级配置。[S9]
- 当前公开文档的主路径使用 `permission.skill` 对象格式，而 V2 文档使用有序的 `permissions` 数组；Adapter 必须检测版本/现有 schema，无法确定时只读并提示，而不是以错误格式覆盖用户 JSONC。[S8][S10]

## 对 V1 需求与 ADR 的影响

| 约束 | 影响 |
| --- | --- |
| FR-01 / FR-08 只向用户级写入 | 所有项目路径只实现扫描、展示、显式纳管；Apply Plan 必须拒绝项目目标。 |
| FR-07 / ADR-0013 兼容性 | Cursor 的“禁用外部 Skill”、TRAE 的确切路径/部署、OpenCode 的配置版本均应返回 `未知` 或 `兼容但有警告`，不能伪装为兼容。 |
| ADR-0007 / ADR-0009 原生优先与自适应部署 | Codex、Claude、OpenCode 先走原生控制；Cursor 再走受控 Installation 投影；TRAE 在验证前不写。链接只是有官方/fixture 证据时的优化，不是跨 Agent 前提。 |
| ADR-0010 不删除外部发现内容 | 缺少原生禁用的 Agent 中，外部 Skill 的禁用只能作为“不可安全执行”的计划项；不得为满足期望状态而触碰外部源文件。 |
| 跨平台承诺 | 共同核心逻辑可三平台构建；但 Agent 集成测试矩阵要按 Agent 官方实际平台拆分。TRAE Linux 不属于可验证的功能集成，除非出现新的官方支持和真实证据。 |

## 验证清单（实现前必须完成）

1. Codex：分别尝试 `skills.config.path = <skill-directory>` 与 `... = <skill-directory>/SKILL.md`，以目标版本的 `codex` 实际发现/禁用结果消除官方文档冲突。
2. Claude Code：在用户设置、项目 `settings.local.json`、同名候选、已有 Skill 根目录和新建根目录五种情况下验证 `skillOverrides` 优先级、生效时机与歧义处理。
3. Cursor：在 macOS、Windows、Linux 的真实 Cursor 版本上验证用户级目录的扫描、链接行为以及文件变更后何时生效；不得用改变 `SKILL.md` 前言来替代缺失的禁用 API。
4. TRAE：取得官方文档或真实应用实测后记录全局路径、项目路径、设置格式、启停动作与重启行为；macOS/Windows 单独记录版本。Linux 在官方客户端出现前保持不支持。
5. OpenCode：按已安装版本验证 `permission.skill` 或 V2 `permissions`，并验证配置刷新需要新会话还是重启；fixture 必须覆盖 JSON 与 JSONC 的无损更新。

## 官方来源

| 编号 | 来源 | 访问日期 | 用途 |
| --- | --- | --- | --- |
| S1 | [OpenAI：Build skills](https://learn.chatgpt.com/docs/build-skills) | 2026-08-09 | Codex Skill 目录、符号链接、自动检测、`skills.config` 示例、重启要求。 |
| S2 | [OpenAI：Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference) | 2026-08-09 | Codex `skills.config`、`enabled` 和 `path` 字段定义。 |
| S3 | [Anthropic：Extend Claude with skills](https://code.claude.com/docs/en/skills) | 2026-08-09 | Claude Code 路径、目录监听、`skillOverrides`、权限与 Skill 执行语义。 |
| S4 | [Anthropic：Explore the .claude directory](https://code.claude.com/docs/en/claude-directory) | 2026-08-09 | Claude Code Windows 路径解析与 `CLAUDE_CONFIG_DIR`。 |
| S11 | [Anthropic：Claude Code settings](https://code.claude.com/docs/en/settings) | 2026-08-09 | 用户/项目/本地设置位置、优先级与设置文件热重载。 |
| S5 | [Cursor：Agent Skills](https://cursor.com/docs/skills) | 2026-08-09 | Cursor 全局/项目/兼容路径、嵌套发现、`disable-model-invocation` 语义。 |
| S6 | [TRAE Docs：Skills](https://docs.trae.ai/ide/skills) | 2026-08-09 | 官方文档 URL；当前抓取没有可引用正文，不能据此推导路径或配置。 |
| S7 | [TRAE：Changelog](https://www.trae.ai/changelog) | 2026-08-09 | 2026-01-23 的 global/project/enable-disable 与 macOS/Windows 要求；2026-04-03 的 `.agents/skills` 加载说明。 |
| S8 | [OpenCode：Agent Skills](https://opencode.ai/docs/skills/) | 2026-08-09 | Skill 目录、发现范围、`permission.skill`、Agent 覆盖、`deny` / `ask` / `allow`。 |
| S9 | [OpenCode：Config](https://opencode.ai/docs/config/) | 2026-08-09 | OpenCode 全局/项目配置位置、合并与优先级、JSON/JSONC。 |
| S10 | [OpenCode V2：Skills](https://opencode.ai/v2/docs/skills) | 2026-08-09 | V2 `permissions` 规则格式，作为版本演进风险依据。 |

> 资料边界：本文件不将项目自身的 fixture、社区讨论、反编译结果或经验性路径当作官方事实。实现阶段产生的真实运行证据应另存为测试报告，并与本文件的“官方资料”分开维护。
