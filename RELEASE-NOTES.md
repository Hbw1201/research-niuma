# 科研牛马局 / Research Niuma Lab 0.8.0

界面精简为对话主页与项目实验区，项目内统一为概览、研究流程、团队、文件四个入口。概览突出当前步骤、下一步操作和导师判断；通信、评测细节与日志按需展开。团队改为成员列表，九步流程图将组会和审核状态合并进步骤卡片，保留详情跳转与修改循环。统一字体、间距与配色，适配窄屏。

The interface now centers on conversations and project workspaces with four tabs: Overview, Research flow, Team, and Files. Overview prioritizes the current step, next action, and mentor judgment; supporting records expand on demand. A compact team roster and nine-node flow canvas retain session access, review states, and revision loops. Typography, spacing, and colors are consistent across desktop and narrow screens.

每一步增加主 CC 导师组会：文献、评测协议、执行设计生成后单独审视方向；CX 每次回报均核查证据、方向与下一步验收。导师退回则修改再报，后续阶段等待前序认可。同阶段保持并行；历史材料、修改与判断保存，Pipeline 显示简短状态并可进入详情。停止、复核预算耗尽、要求或材料变化均不会自动通过。

Every step now ends in a lead-CC mentor check: literature, benchmark protocols, and execution designs receive a separate review; each CX report is assessed for evidence, direction, and next-step criteria. Revisions loop back for review before later stages can run, while independent work within a stage remains parallel. Pipeline links compact checkpoint states to report history. Cancellation, exhausted review budgets, and changed inputs never imply approval.

新增提案、实验结果、论文三处评审循环与用户出环审核：提案修订稿由三位委员再次核验，未全票通过则自动修订并复审；结果与论文全票通过后暂停等待用户，用户通过才进入下一阶段。退回意见生成修改任务并重新送审。审核绑定材料版本，旧审核不能批准新材料；停止、重启后保留当前循环和待审核状态。

Proposal, results, and manuscript stages now have explicit revision loops and human exit gates. All three reviewers verify the revised proposal. Unanimous results/manuscript reviews pause for human approval before progression; rejection creates concrete revision tasks and resubmission. Approvals bind to the reviewed version and survive restart without silently releasing work.

Pipeline 改为可拖动、缩放的单一阶段画布，标出当前步骤与并行执行阶段；点击阶段进入独立详情页查看文献、评测、任务或评审。返回画布保留位置与缩放，详情页保留历史反馈和返回关系。

Pipeline is now a pan-and-zoom stage canvas with current and parallel steps highlighted. Each block opens its own detail page for evidence, evaluation, tasks, and reviews. Returning preserves the camera; detailed feedback and retry links remain available.

确认研究方向后，主 CC 说明做什么、理由与验证方式，随后组织 CX 执行。不再生成问卷或等待逐项批阅；旧问卷保留为只读历史。协作台和 Pipeline 展示执行说明，停止或需求变化时不会派发旧计划。

After direction confirmation, the lead CC explains the work, rationale, and verification, then dispatches CX. No questionnaire or item-by-item approval is required. Legacy decisions remain read-only history; the explanation appears in Collaboration and Pipeline. Cancellation and changed requirements prevent stale dispatch.

执行前新增两个真实 CC 步骤：阅读原文并整理经典/近期方法及论文中的 baseline；据此形成评测协议，明确主/辅助指标、独立样本划分、防泄漏、预算、重复与成功/失败标准。两步均保存来源、Markdown、日志和用量，并显示于 Pipeline。资料不足时暂停；需求变化后建立新版本，保留旧报告，检查可比性与是否重跑。

Two CC calls now precede implementation: primary-paper method mapping and a literature-backed benchmark protocol. They capture classical/recent methods, paper baselines, metrics, independent data splits, leakage controls, budgets, repetitions, and success/failure criteria. Pipeline exposes documents, logs, and usage. Missing evidence pauses dispatch; changed requirements produce a new protocol while preserving prior reports for comparability review.

## 下载 / Downloads

| 系统 / Platform | 文件 / File |
|---|---|
| Windows x64 | `Relay-Lab-Setup-0.8.0-x64.exe` |
| macOS Apple Silicon (M series) | `Relay-Lab-0.8.0-macos-arm64.dmg` |
| macOS Intel | `Relay-Lab-0.8.0-macos-x64.dmg` |
| Ubuntu / Debian x64 | `Relay-Lab-0.8.0-linux-x64.deb` |
| Linux x64 portable | `Relay-Lab-0.8.0-linux-x64.AppImage` |
| Cross-platform CLI (Node.js 22+) | `relay-lab-0.8.0.tgz` |

Windows：运行 EXE，按安装向导完成。macOS：打开对应芯片的 DMG，将 Relay Lab 拖到 Applications。Ubuntu：下载 DEB 后运行 `sudo apt install ./Relay-Lab-0.8.0-linux-x64.deb`。AppImage：赋予执行权限后运行；部分系统需要 FUSE 2 兼容库。

Windows: run the EXE installer. macOS: open the DMG for your chip and drag Relay Lab into Applications. Ubuntu: install the DEB with `sudo apt install ./Relay-Lab-0.8.0-linux-x64.deb`. For AppImage, make the file executable and run it; some distributions require FUSE 2 compatibility libraries.

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
