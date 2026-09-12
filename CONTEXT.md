# AgentBaton

AgentBaton 是面向本地 AI Agent 的统一管理域。它汇总 Agent 及其 Skill，并管理可跨设备同步和部署的 Skill 集合。

## Language

**Skill 控制面（Skill Control Plane）**:
AgentBaton V1 的产品边界：统一表达多个 Agent 的 Skill 期望状态，并负责发现、纳管、分组、同步、部署和验证。它不负责 Agent 之间的任务分发、消息传递或工作流编排。
_Avoid_: Agent 编排平台、Agent 启动器

**发现的 Skill（Discovered Skill）**:
AgentBaton 从 Agent 安装位置扫描到、但尚未取得管理权的 Skill。它可以被查看和选择，但不会被自动复制或上传。
_Avoid_: 未管理 Skill、外部 Skill

**托管的 Skill（Managed Skill）**:
用户明确纳入 AgentBaton 管理的 Skill。AgentBaton 可以保存其内容和独立元数据，并通过用户配置的 Git 仓库进行同步。
_Avoid_: 已安装 Skill、已上传 Skill

**托管库（Managed Library）**:
保存托管 Skill 规范副本的本地逻辑集合，是更新、同步和部署的主数据来源。Agent 安装目录不是托管 Skill 的主数据来源。
_Avoid_: Skill 安装目录、同步仓库

**本地来源 Skill（Local Skill）**:
由用户在本地创建或维护、没有可用于更新的上游地址的 Skill。
_Avoid_: 用户自己的 Skill、自建 Skill

**上游来源 Skill（Upstream Skill）**:
从 Git 上游获取并保留上游引用的 Skill。上游引用用于检查和获取后续更新。
_Avoid_: 下载的 Skill、GitHub Skill、第三方 Skill

**上游引用（Upstream Reference）**:
定位上游来源 Skill 的仓库地址、仓库内相对目录和最后同步 Commit。它是检查上游更新和识别本地分叉的比较基准。
_Avoid_: 原有链接、下载地址

**已分叉 Skill（Diverged Skill）**:
内容相对最后同步版本发生了本地修改的上游来源 Skill。已分叉 Skill 不允许被上游更新静默覆盖。
_Avoid_: 冲突 Skill、修改过的 Skill

**Skill Group**:
用户全局定义的 Skill 命名集合，用于组织和批量选择 Skill；同一个 Skill 可以同时属于多个 Skill Group，同一个 Skill Group 可以被多个 Agent 独立启用。Skill Group 不对应物理目录，也不复制 Skill 内容。
_Avoid_: Skill 文件夹、Skill 分类

**Tag**:
用户附加给 Skill 的自由标签，用于搜索、筛选和展示。Tag 不参与同步授权判断。
_Avoid_: 同步标签、权限标签

**同步策略（Sync Policy）**:
决定托管的 Skill 是否可以离开当前设备的固定安全属性。新纳管的 Skill 默认为 `Local Only`；只有 `Sync Allowed` 才可写入同步仓库。
_Avoid_: 私密 Tag、上传 Tag

**Local Only**:
禁止写入同步仓库的同步策略。它的优先级高于 Skill Group 的上传选择。
_Avoid_: 私密、不同步 Tag

**Sync Allowed**:
允许 Skill 被写入用户所选同步仓库的同步策略；它不代表 Skill 内容可以公开发布。
_Avoid_: 公开、Public

**发现范围（Discovery Scope）**:
AgentBaton 承诺检查的 Skill 位置集合，由受支持 Agent 的已知用户级位置，以及用户明确添加的项目或自定义位置组成。它不包含整盘扫描和 Agent 内置的只读系统 Skill。
_Avoid_: 全盘扫描、电脑上的所有 Skill

**用户级作用域（User Scope）**:
面向当前操作系统用户、可供某个 Agent 的所有项目使用的 Skill 作用域。V1 的应用计划只修改用户级作用域，项目级 Skill Installation 仅发现和纳管。
_Avoid_: 全局目录、系统级 Skill

**Skill**:
AgentBaton 识别和管理的一项逻辑能力，独立于它被部署到哪些 Agent 和路径。名称相同不代表是同一个 Skill。
_Avoid_: Skill 文件夹、Skill 安装

**Skill Installation**:
一个 Skill 在特定 Agent、作用域和文件系统路径中的实际部署。同一个 Skill 可以拥有多个 Skill Installation。
_Avoid_: Skill 副本、Skill

**安装漂移（Installation Drift）**:
托管 Skill 的某个 Skill Installation 与托管库中的规范副本不再一致的状态。安装漂移必须由用户选择采纳或重新部署，不能自动反向覆盖规范副本。
_Avoid_: 上游分叉、同步冲突

**自适应部署（Adaptive Deployment）**:
Agent Adapter 根据目标 Agent 的原生能力、操作系统和文件系统，为 Skill Installation 自动选择安全的部署方式：优先使用 Agent 原生启停机制，其次使用符号链接或 Windows Junction，必要时降级为受控复制。部署方式和内容哈希属于 Installation 的本机状态；受控副本发生变化时按安装漂移处理。V1 不要求普通用户手动选择部署方式。
_Avoid_: 统一符号链接、统一复制、手动安装模式

**从 Agent 卸载（Uninstall from Agent）**:
删除某个 Agent 的 Skill Installation，而不删除托管库中的 Skill。若该 Agent 的期望状态仍要求启用该 Skill，卸载操作必须同时调整期望状态，不能留下自相矛盾的配置。
_Avoid_: 删除 Skill、移出分组

**删除托管 Skill（Delete Managed Skill）**:
将一个托管 Skill 从所有分组、Agent 期望状态和同步快照中移除的全局操作。执行前必须展示影响范围并二次确认；删除项先进入 AgentBaton 回收站，默认保留 30 天。发现但未托管的原始 Skill 不属于该操作的删除范围。
_Avoid_: 卸载 Skill、停止启用

**删除墓碑（Deletion Tombstone）**:
用于把托管 Skill 的删除意图传播到其他设备的同步记录。墓碑防止另一台设备因仍保留旧副本而在下次同步时把已删除 Skill 重新创建。
_Avoid_: 空 Skill、删除提交

**上游更新检查（Upstream Update Check）**:
针对上游来源 Skill 读取远端版本状态的无副作用操作。AgentBaton 可以在启动时、距上次检查超过 24 小时后或用户手动触发时执行检查，但检查本身不修改托管库或 Skill Installation。
_Avoid_: 自动更新、Git 同步

**上游更新暂存（Staged Upstream Update）**:
用户请求更新后下载到隔离暂存区、等待预览和确认的候选 Skill 内容。用户确认后它才能替换托管库的规范副本，并生成新的应用计划；它不能自动写入各 Agent。上游不可用时保留当前规范副本，已分叉 Skill 不允许直接更新。
_Avoid_: 待同步、已更新 Skill

**未审查 Skill（Unreviewed Skill）**:
尚未经过可信签名或人工审核体系证明其安全性的 Skill。V1 中第三方 Skill 默认处于未审查状态；静态风险提示不构成安全认证，界面不得使用“安全”或“已验证”等标签暗示保证。
_Avoid_: 不安全 Skill、已扫描 Skill

**风险内容（Risk-bearing Content）**:
Skill 中可能扩大执行能力或文件系统边界的内容，包括脚本、可执行文件、二进制文件和符号链接。扫描、纳管、同步和更新过程不得执行这些内容；首次纳管或更新包含风险内容的 Skill 时必须提示来源并由用户显式确认。
_Avoid_: 恶意文件、病毒

**Agent 兼容状态（Agent Compatibility Status）**:
某个 Agent Adapter 对规范 Skill 能否被目标 Agent 正确使用的独立判断，取值为兼容、兼容但有警告、不兼容或未知。同一个 Skill 在不同 Agent 上可以具有不同状态；不兼容时阻止应用，未知时允许用户确认后尝试并验证。
_Avoid_: Skill 有效性、跨平台兼容性

**规范 Skill 内容（Canonical Skill Content）**:
托管库保存且不因部署目标不同而被自动改写语义的 Skill 内容。Agent Adapter 可以生成部署所需的外围配置，但不能静默修改指令正文；V1 不支持同一 Skill 的多 Agent 内容变体。
_Avoid_: 通用 Skill、基础版本

**Agent Adapter**:
封装特定 Agent 的检测、扫描、兼容性验证、应用计划生成、部署和结果验证的内部扩展模块。V1 的五种 Agent Adapter 随 AgentBaton 内置发布；接口保持可测试和可版本化，但 V1 不加载任意第三方插件。
_Avoid_: Agent 插件、Skill Adapter

**本地状态库（Local State Store）**:
保存设备配置、扫描结果、观测状态、缓存和操作记录的带迁移版本 SQLite 数据库。它属于单台设备，不进入 Git 同步仓库，也不是规范 Skill 内容的存储位置。
_Avoid_: 同步数据库、Skill 数据库

**可移植声明（Portable Declaration）**:
同步仓库中描述 Skill 元数据、分组、成员关系和 Agent 期望状态的版本化 JSON 数据。声明按实体拆分、使用稳定 UUID、确定性序列化并包含 `schemaVersion`；设备路径、凭据、缓存和扫描记录不属于可移植声明。
_Avoid_: 数据库备份、设备配置

**本地优先（Local-first）**:
Skill 内容、描述、路径、Agent 列表、分组和日志默认只在当前设备处理。V1 不要求 AgentBaton 账号，也不包含默认开启的遥测；只有用户授权的 GitHub 同步和对已记录上游的更新检查可以发送必要数据。
_Avoid_: 离线模式、隐私模式

**诊断包（Diagnostic Bundle）**:
用户主动生成、用于问题排查的本地导出物。生成前必须展示文件清单，默认排除 Skill 正文、凭据和绝对路径，并对日志中的敏感值脱敏；AgentBaton 不自动上传诊断包。
_Avoid_: 遥测数据、错误上报

**Agent 应用事务（Agent Apply Transaction）**:
针对单个 Agent 执行一份不可变应用计划的原子操作。写入前重新校验目标文件，修改前创建本机备份；失败时回滚该 Agent 的本次修改。多 Agent 批量应用由多个独立事务组成，可以部分成功，并允许只重试失败项。
_Avoid_: 全局事务、批量安装

**应用记录（Apply Record）**:
保存在本地状态库中的一次应用结果，包含计划摘要、各 Agent 的成功或失败状态、备份引用和可撤销性。只要备份仍有效，用户可以撤销最近一次对应应用。
_Avoid_: Git 历史、同步日志

**疑似重复 Skill（Potential Duplicate）**:
名称或内容相似、但无法证明具有同一身份的多个 Skill。它们保持独立，直到用户明确合并纳管。
_Avoid_: 重复 Skill

**已启用 Skill Group（Active Skill Group）**:
用户针对某个 Agent 选择启用的 Skill Group。同一个 Agent 可以同时拥有多个已启用 Skill Group。
_Avoid_: 当前分组、Agent 分组

**有效 Skill 集合（Effective Skill Set）**:
某个 Agent 根据全部已启用 Skill Group 的并集和单 Skill 覆盖计算出的最终 Skill 集合。计算顺序是分组并集加上强制启用，再排除强制禁用。
_Avoid_: 已安装 Skill、当前组

**单 Skill 覆盖（Skill Override）**:
用户针对特定 Agent 和 Skill 设置的启用意图，取值为跟随分组、强制启用或强制禁用。它不改变 Skill Group 本身的成员关系。
_Avoid_: Skill 开关、分组例外

**参与同步 Skill Group（Sync-enabled Skill Group）**:
被用户持久设置为参与 Git 同步的 Skill Group。只有组内同步策略为 `Sync Allowed` 的 Skill 才能进入同步仓库。
_Avoid_: 上传分组、已上传分组

**同步仓库（Sync Repository）**:
由 AgentBaton 专用并作为跨设备同步边界的 Git 仓库，保存允许同步的 Skill 内容和管理元数据。V1 同一时间只连接一个同步仓库。
_Avoid_: Skill 上游、业务代码仓库、备份目录

**GitHub 授权（GitHub Authorization）**:
用户通过 AgentBaton GitHub App 授予访问所选同步仓库的权限。授权凭据属于当前设备并保存在操作系统安全存储中，不属于同步数据。
_Avoid_: GitHub 密码、同步 Token、仓库配置

**手动同步（Manual Sync）**:
由用户在查看变更摘要后明确确认的跨设备状态协调操作。AgentBaton 可以自动检查同步状态，但 V1 不在后台自动提交或推送。
_Avoid_: 自动备份、实时同步

**同步冲突（Sync Conflict）**:
本地与远端基于同一同步版本对同一字段或 Skill 内容做出了无法安全自动合并的不同修改。冲突解决前不得推送。
_Avoid_: Git 错误、上游更新

**期望 Agent 状态（Desired Agent State）**:
用户针对一种 Agent 所表达的可移植配置意图，包括已启用 Skill Group 和单 Skill 覆盖。它不包含具体机器路径或实际安装结果。
_Avoid_: Agent 配置文件、已安装状态

**观测 Agent 状态（Observed Agent State）**:
AgentBaton 在当前设备发现的 Agent、Skill Installation 和实际启用情况。观测状态不跨设备同步。
_Avoid_: 已保存配置、期望状态

**应用计划（Apply Plan）**:
使当前设备的观测 Agent 状态趋近期望 Agent 状态所需的可预览变更集合。用户确认应用计划后，AgentBaton 才能修改 Agent 的本机配置或 Skill Installation。
_Avoid_: 同步计划、安装脚本

**待重启（Restart Required）**:
应用计划已经写入当前设备，但目标 Agent 必须重新启动才能读取新状态。待重启不等同于应用失败。
_Avoid_: 同步中、安装失败

**原始描述（Original Description）**:
从 Skill 自身的 `SKILL.md` 读取、用于表达作者意图的描述。AgentBaton 不通过备注功能修改它。
_Avoid_: 默认描述、系统描述

**用户描述（User Description）**:
用户在 AgentBaton 中为 Skill 添加的独立备注，不写入 Skill，也不改变 Agent 对 Skill 的匹配和触发。有值时界面优先展示，但原始描述仍可查看。
_Avoid_: 自定义 Skill 描述、覆盖描述

**当前启用数（Current Enabled Count）**:
当前设备的观测 Agent 状态中可用的逻辑 Skill 数量，按 Skill 身份去重，不按 Skill Installation 数量累计。
_Avoid_: 安装数量、Skill 数量

**期望启用数（Desired Enabled Count）**:
某个 Agent 的有效 Skill 集合所包含的逻辑 Skill 数量。当它与当前启用数不同时，界面同时展示变更前后的数量。
_Avoid_: 分组成员数、待安装数量
