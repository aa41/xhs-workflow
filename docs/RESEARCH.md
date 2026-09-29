# 调研结论（2026-09-29）

## 结论

参考项目 `reference/xiaohongshu-ai-workbench` 的提交为 `7c1705d28a95bfc7c3b60f39b14b8041345541db`。它提供七个运营 Skills、打包文件、示例与校验脚本，不包含桌面 UI、持久任务系统或 Git→笔记的工作流。`python3 reference/xiaohongshu-ai-workbench/scripts/validate_all.py` 已通过。

2026-09-29 查询 npm `latest`：`@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-agent-core` 均为 **0.87.1**（2026-09-22 发布）；旧 `@mariozechner/pi-coding-agent` 已标记迁移。实现时固定版本并用锁文件，升级需回归 SDK 测试。Pi 官方仓库的 `packages/coding-agent/docs/sdk.md` 与 `examples/sdk/` 说明 `createAgentSession`、`SessionManager`、`ModelRuntime`、`DefaultResourceLoader` 和事件订阅接口。不要将旧包名或更早示例直接复制到新项目。

## Skill 排序

| 优先级 | Skill / 能力 | 用途 |
| --- | --- | --- |
| P0 | 新建 `commit-evidence` | 指定仓库与 SHA 范围，抽取用户可见变化、证据位置、发布状态与不可公开内容；允许“不发” |
| P0 | 参考 `xiaohongshu-topic-planner` | 将多个变化规划为教程、幕后、避坑、更新等选题，而非一个提交一篇笔记 |
| P0 | 新建 `developer-note-draft` | 以独立开发者口吻写痛点、场景、真实变化、限制与素材需求 |
| P0 | 参考 `xiaohongshu-title` + 新建 `publish-proof-gate` | 标题候选；逐项核对事实、隐私、密钥、截图授权和效果承诺 |
| P1 | 参考 `xiaohongshu-profile`、`xiaohongshu-magazine`、`xiaohongshu-conversion-path` | 账号定位、长期栏目与体验/反馈承接路径 |
| P1 | 中文润色 `humanizer-zh` | 去模板腔，保留事实、确定程度与个人声音；不以“通过 AI 检测”为目标 |
| P1 | 生图 `cover-brief` / `imagegen` | 从核实后的内容生成封面 brief、图像及来源记录，人工确认后使用 |
| P1 | 参考 `xiaohongshu-comment-reply` | 基于真实评论拟回复，经本人确认发送，将问题回写运营反馈 |
| P2 | `release-to-series`、`demo-script`、`weekly-retrospective` | 版本系列化、录屏脚本、基于手动录入指标的复盘 |
| P2 | 参考 `xiaohongshu-suite` | 模糊需求路由；固定 Git 工作流不必每次经过母 Skill |

参考项目的 Skills 为 MIT 许可；如复制或改编其文件，保留原许可证和归属。`.skill` 是其分发包，Pi 的可移植安装形式是带 `SKILL.md` 的目录；导入前需要解包校验、展示内容和明确启用范围。

## 关键风险

1. Git diff 能证明实现发生变化，**不能证明已发布、用户可用、性能提升或用户反馈**。每项确定性主张都要关联 commit、文件位置和发布状态；缺证据时写为待核实或不发布。
2. 提交、日志、截图可能包含 API 密钥、客户数据、未公开计划及第三方素材。进入模型前先过滤，发布前再人工复核。
3. 定时生成草稿不等于定时发布。首版不依赖平台代发接口，不绕过平台规则，不承诺涨粉、成交或爆款。
4. 第三方 Skill 及其脚本相当于可执行输入，需检查来源、摘要、权限；不能仅靠提示词防止越权。

## 证据与复查

- 参考仓库：`reference/xiaohongshu-ai-workbench/README.md`、`xiaohongshu-suite/SKILL.md`、`scripts/validate_all.py`。
- Pi 官方：`https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent/docs`（本次只读检出 `cb7969d`）；重点是 `sdk.md`、`skills.md`、`providers.md`、`cli-integration.md`。
- npm 查询：`npm view @earendil-works/pi-coding-agent version dist-tags engines --json`、`npm view @earendil-works/pi-agent-core version dist-tags --json`。
- 参考校验：`python3 reference/xiaohongshu-ai-workbench/scripts/validate_all.py`。
