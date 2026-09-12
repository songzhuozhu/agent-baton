# AgentBaton 同步仓库格式 V1

> 状态：已采用\
> 格式版本：`1`

## 1. 目标

同步仓库只保存可移植的期望状态与允许同步的 Skill 内容；它不是 SQLite 备份、Agent 安装目录镜像或凭据容器。格式必须便于 Git 审查、字段级合并和将来迁移。

## 2. 目录布局

```text
agent-baton/
  format.json
  skills/
    <skill-id>/
      metadata.json
      content/              # 原始 Skill 文件树，包含 SKILL.md
  groups/
    <group-id>.json
  agent-states/
    codex.json
    claude-code.json
    cursor.json
    trae.json
    opencode.json
  tombstones/
    <skill-id>.json
```

所有 JSON 使用 UTF-8、两个空格缩进、LF 换行、键名排序和末尾换行。序列化器输出必须确定性一致。

## 3. 根格式文件

```json
{
  "format": "agent-baton-sync",
  "schemaVersion": 1
}
```

不认识的高版本 `schemaVersion` 只能只读检查，不能写回或降级覆盖。

## 4. 实体形状

### 4.1 Skill metadata

```json
{
  "id": "uuid",
  "schemaVersion": 1,
  "name": "frontend-design",
  "userDescription": "个人项目的界面设计流程",
  "tags": ["design", "personal"],
  "syncPolicy": "sync-allowed",
  "source": {
    "kind": "upstream",
    "repositoryUrl": "https://github.com/example/skills.git",
    "relativePath": "skills/frontend-design",
    "baselineCommit": "abc123",
    "contentHash": "sha256:..."
  }
}
```

原始描述不写入 metadata；它来自 `content/SKILL.md`。`Local Only` Skill 绝不产生该目录。

### 4.2 Group

```json
{
  "id": "uuid",
  "schemaVersion": 1,
  "name": "个人全栈",
  "participatesInSync": true,
  "skillIds": ["uuid-a", "uuid-b"]
}
```

技能成员按 UUID 排序；只有仍存在的 Skill ID 才可写入。

### 4.3 Desired Agent State

```json
{
  "agent": "codex",
  "schemaVersion": 1,
  "activeGroupIds": ["uuid"],
  "overrides": {
    "uuid": "force-enable",
    "uuid-other": "force-disable"
  }
}
```

`follow-groups` 不序列化；缺少覆盖项即为跟随分组。设备路径、检测结果和 Installation 不属于这个文件。

### 4.4 Tombstone

```json
{
  "entity": "skill",
  "id": "uuid",
  "schemaVersion": 1,
  "deletedAt": "2026-08-09T12:00:00.000Z"
}
```

墓碑优先于旧版本的 Skill 内容；恢复 Skill 会删除其墓碑并写入新的 metadata 和内容。

## 5. 同步选择算法

一个 Skill 仅在以下两个条件都满足时进入快照：

1. `syncPolicy === "sync-allowed"`；
2. 至少属于一个 `participatesInSync === true` 的 Group。

Group、Desired Agent State 会同步，但写出时必须剔除指向未同步 Skill 的成员和覆盖。该规则保证 `Local Only` 永远不能因为间接引用泄漏。

## 6. 合并原则

- 以实体 UUID 定位，不用名称定位。
- 不同字段的并发编辑可自动合并并在预览中展示。
- 同一 metadata 字段并发修改产生用户冲突。
- 同一 Skill 的 `content/` 双方变化产生内容冲突；不做文本自动合并。
- 墓碑与旧内容同时出现时暂停并由用户决定恢复或删除；不能静默复活。
- 冲突没有全部解决前禁止创建或推送同步提交。

## 7. 禁止出现的数据

- GitHub 令牌、OAuth 数据、SSH 密钥、系统凭据
- 绝对路径、Agent Installation、扫描根、缓存、日志、备份
- `Local Only` Skill 的任何内容或用户元数据
- SQLite 数据库文件
