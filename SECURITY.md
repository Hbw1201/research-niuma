# Privacy and source publication / 隐私与源码发布

## 中文

本仓库只发布应用源码、合成测试、构建配置和通用文档。不要提交 API key、CLI 登录配置、研究数据、个人课题、提示词记录、终端历史、会话日志或包含这些内容的截图。

`.gitignore` 排除了 `.relay-lab/`、`.claude/`、`.codex/`、`.tools/`、工作区、构建目录、环境变量文件和常见凭据文件。忽略规则不能阻止 `git add -f`，也不能清理已经进入历史的内容。提交前检查实际暂存清单和差异，并运行：

```sh
git diff --cached --stat
git diff --cached
node scripts/check-public-source.mjs
```

检查脚本按允许目录和文件类型审查 Git 中的文件，并检查常见密钥格式、私钥、个人绝对路径和凭据 URL。它不能保证识别所有秘密或研究材料，人工检查仍然必要。自动化测试使用隔离的合成数据，不需要真实认证。

应用将任务和运行记录写到本地，但调用 Claude Code / Codex 时，相关提示词、规则、Skills 和被读取的文件可能发送至配置的服务商。不要把“本地工作台”理解为“所有推理均离线”。请独立审阅 CLI 的登录、工具、钩子和沙箱设置。

默认服务仅监听回环地址，使用 Host、Origin 和写操作 token 校验；不设计为公开网络服务或多人隔离平台。不要将认证配置放进课题目录。报告问题时请使用脱敏的合成复现；不要在公开 Issue 中贴出凭据或未公开研究材料。

## English

This repository publishes application source, synthetic tests, build configuration, and general documentation. Do not commit API keys, CLI authentication, private research, project artifacts, prompts, terminal history, session logs, or screenshots containing them.

The ignore rules exclude local state, authentication directories, workspaces, environment files, build outputs, and common credential files. They cannot stop a forced add or erase content already committed. Review the staged file list and diff, then run `node scripts/check-public-source.mjs` before pushing.

The check inspects Git files against an allowed source layout and common secret/private-path patterns. It is a guardrail, not a guarantee that all secrets or unpublished research can be detected. Tests use isolated fixtures and require no real authentication.

Local persistence is separate from inference privacy: configured Claude Code/Codex providers may receive task inputs, selected rules/Skills, and files accessed by the agents. Review each CLI's configuration and grant access only to suitable materials.

The server is intended for loopback access by a local operator, with Host/Origin and write-token checks. It is not a public multi-user hosting service. Use redacted synthetic reproductions when reporting issues; do not publish credentials or private research in issues.
