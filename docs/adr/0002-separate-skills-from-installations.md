# 分离 Skill 身份与安装实例

AgentBaton 将逻辑能力建模为 Skill，将它在具体 Agent、作用域和路径中的部署建模为 Skill Installation；多个指向同一真实目录的链接可以归于同一 Skill，但名称或当前内容相同的独立副本不会被自动合并，只提示为疑似重复并交由用户决定。该边界避免错误合并不同上游或未来独立演化的同名 Skill，同时允许一个托管 Skill 安装到多个 Agent。
