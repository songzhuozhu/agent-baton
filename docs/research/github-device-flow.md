# GitHub App Device Flow 实现依据

访问日期：2026-08-09\
适用范围：AgentBaton V1 的 GitHub 授权边界

## 已验证结论

1. GitHub App 可以启用 OAuth Device Flow；官方明确将桌面应用列为该流程的适用对象。
2. Device Flow 的设备码请求使用 GitHub App 的 `client_id`，不是 App ID；该 `client_id` 是公开标识，Device Flow 不需要嵌入 `client_secret`。
3. 用户在 `https://github.com/login/device` 输入用户码；客户端只能按响应中的最小 `interval` 轮询。收到 `slow_down` 后，间隔需增加 5 秒。
4. 授权得到的是用户访问令牌。AgentBaton 只可将其保存到操作系统安全存储；Electron 在 Linux 回退到 `basic_text` 时必须拒绝连接，而非以明文降级。
5. 尚未注册并发布 AgentBaton GitHub App 前，开发构建不得伪装可完成授权。当前实现会明确提示“未配置 GitHub App Client ID”。

## 官方来源

- [Generating a user access token for a GitHub App](https://docs.github.com/en/enterprise-cloud@latest/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [Authorizing OAuth apps — Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

## 发布前条件

- 注册名为 AgentBaton 的 GitHub App，开启 Device Flow，并以最小化仓库权限完成权限设计。
- 将公开 `client_id` 注入正式构建；绝不将私钥、client secret 或个人 PAT 写入仓库、日志、SQLite 或 UI。
- 在 macOS Keychain、Windows Credential Manager、Linux Secret Service 三种真实环境执行授权、重启后读取与撤销验证。
