# V1 仅发布内置 Agent Adapter

Codex、Claude Code、Cursor、Trae 和 OpenCode 的 Agent Adapter 随 AgentBaton 内置发布，并通过清晰、可测试、可版本化的内部接口与 Skill、分组和同步核心解耦。V1 不加载任意第三方 Adapter 插件；待接口经过真实使用稳定后，再设计带版本约束、权限声明和安全隔离的外部插件机制。这样保留新增 Agent 的结构自由度，同时避免过早固化公共 API 和扩大本机文件写入的攻击面。
