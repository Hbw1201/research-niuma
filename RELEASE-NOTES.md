# 科研牛马局 / Research Niuma Lab 0.7.0

## 本次更新 / What's new

- **项目与对话：** 独立对话和项目对话分开组织；项目绑定本地目录，根目录和子文件夹对话与实验区共享文件、规则、技能和模型。增加文件浏览、文本预览及新建子文件夹，修复桌面收起侧栏和移动端汉堡菜单。
- **提案评委会：** 主 CC 起草提案，三位额外 CC 使用独立会话评审并交叉互评，主 CC 回应意见并修订；研究者确认后再生成决策问卷并交给 CX 执行。
- **持续科研反馈：** 实验结果和论文初稿同样送交三位 CC 评委。主 CC 将问题关联到 CX 修改任务，修改完成后再次送审；实验结果评审通过后才进入写作，需要补实验时重新经过结果评审。
- **可追踪的 Pipeline：** 展示每轮材料、评审、互评、主导师决策、CX 修改和复审连接；保留 Markdown、会话日志、报告快照与 Token 用量。暂停、失败或达到复核上限后可继续未完成步骤。

- **Projects and conversations:** Separate independent and project chats. Project-root and subfolder chats share local files, rules, skills, and models with Experiments. Adds file browsing, text previews, folder creation, and working desktop/mobile hamburger navigation.
- **Proposal committee:** The lead CC drafts a proposal; three additional CC reviewers work in independent sessions and cross-review each other. The lead responds and revises before the researcher confirms the proposal and decision questionnaire for CX execution.
- **Continuous research feedback:** Experiment results and manuscript drafts go through the same three-reviewer committee. The lead maps issues to CX correction tasks and resubmits completed revisions. Results must pass review before writing; requests for more experiments trigger another results review.
- **Traceable Pipeline:** Shows source material, reviews, cross-reviews, lead decisions, CX corrections, and resubmission rounds. Markdown, logs, report snapshots, and token usage are retained; interrupted or budget-limited reviews can resume.

## 下载 / Downloads

| 系统 / Platform | 文件 / File |
|---|---|
| Windows x64 | `Relay-Lab-Setup-0.7.0-x64.exe` |
| macOS Apple Silicon (M series) | `Relay-Lab-0.7.0-macos-arm64.dmg` |
| macOS Intel | `Relay-Lab-0.7.0-macos-x64.dmg` |
| Ubuntu / Debian x64 | `Relay-Lab-0.7.0-linux-x64.deb` |
| Linux x64 portable | `Relay-Lab-0.7.0-linux-x64.AppImage` |
| Cross-platform CLI (Node.js 22+) | `relay-lab-0.7.0.tgz` |

Windows：运行 EXE，按安装向导完成。macOS：打开对应芯片的 DMG，将 Relay Lab 拖到 Applications。Ubuntu：下载 DEB 后运行 `sudo apt install ./Relay-Lab-0.7.0-linux-x64.deb`。AppImage：赋予执行权限后运行；部分系统需要 FUSE 2 兼容库。

Windows: run the EXE installer. macOS: open the DMG for your chip and drag Relay Lab into Applications. Ubuntu: install the DEB with `sudo apt install ./Relay-Lab-0.7.0-linux-x64.deb`. For AppImage, make the file executable and run it; some distributions require FUSE 2 compatibility libraries.

桌面包自带运行时，无需另装 Node.js；Claude Code 和 Codex 仍需用户自行安装并登录。界面主要为中文，AI 输出语言可以设置。

Desktop packages include their runtime; a separate Node.js installation is not required. Install and authenticate Claude Code and Codex yourself. The UI is primarily Chinese; AI output language is configurable.

## 验证与隐私 / Verification and privacy

构建来自公开仓库的干净 GitHub 托管环境。每个平台均执行自动化测试、包内源码比对、内置 CLI 检查，以及空工作区的本地服务启动检查。`BUILD-INFO.json` 记录源码提交、包内文件哈希与检查结果；`SHA256SUMS.txt` 提供安装包校验值。

Built from the public repository on clean GitHub-hosted runners. Every platform runs automated tests, packaged-source comparison, a bundled-CLI check, and a fresh-workspace local-service check. `BUILD-INFO.json` records the source commit, packaged-file hashes and checks; `SHA256SUMS.txt` provides download checksums.

这些检查不等于在各系统上完整人工验证安装向导与桌面交互。安装包不包含开发者的密钥、CLI 登录信息、课题数据、会话日志或本地历史。模型推理由你配置的服务商处理。

These checks do not replace full manual installer and desktop interaction testing on every OS. Packages contain no developer credentials, CLI login, research data, session logs, or local history. Inference uses the provider you configure.

## 签名状态 / Signing status

Windows 包没有发布者代码签名。macOS 包使用 ad-hoc 签名以支持运行，不带 Apple Developer ID，也未经过 Apple 公证；系统可能提示未识别开发者或阻止首次打开。

Windows packages have no publisher code-signing certificate. macOS packages use ad-hoc signing, without an Apple Developer ID or notarization; the OS may warn about an unidentified developer or block first launch.
