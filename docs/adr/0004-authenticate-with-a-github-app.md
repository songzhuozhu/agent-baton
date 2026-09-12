# 使用 GitHub App 和设备授权

V1 使用 AgentBaton GitHub App 的 Device Flow 完成交互式登录，只请求专用同步仓库所需的细粒度权限，并将设备凭据保存到 macOS Keychain、Windows Credential Manager 或 Linux Secret Service。应用配置和同步仓库不保存明文令牌，V1 不提供经典 PAT 输入框；这一选择增加了 GitHub App 的维护责任，但避免宽权限 PAT 和跨平台凭据泄漏风险，SSH 与系统 Git 凭据可作为后续高级能力。
