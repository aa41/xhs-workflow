# 独立开发者 · 小红书持续运营工作台

本目录是 Electron + TypeScript 桌面应用的首版实现。参考项目克隆在 [`reference/xiaohongshu-ai-workbench`](reference/xiaohongshu-ai-workbench)，保留其原始 Git 历史和 MIT 许可证。

- [调研与 Skill 路线](docs/RESEARCH.md)
- [架构与交互方案](docs/ARCHITECTURE.md)
- [验收与测试清单](docs/TESTING.md)
- [待确认的技术决策](.workflow-orchestrator/sessions/2026-09-29-xhs-agent/human-review-matrix.md)

首版从多个产品仓库的 Git 提交中提取**可公开、可追溯**的产品事实，使用 Pi 生成小红书草稿，并由独立开发者审阅、配图并手动发布。代码及指定提交是产品事实的唯一基线；运营策略不能替代证据。不会自动发布或授予 Agent 写仓库权限。

## 本地运行

要求 Node.js ≥22.19、Git，macOS 或 Windows。首次运行：

```bash
npm install
npm run build
npm start
```

在应用内点击**一键部署后端**，会在用户数据目录创建 SQLite 数据库并启动随应用打包的本地 Node 任务进程；**重启后端**会中止当前任务并重新启动进程。部署后再次打开应用会自动启动后端。服务不开放网络端口，定时任务只在应用运行期间执行。

添加一个本地 Git 仓库；在设置中录入内置 Provider API Key（如 `anthropic`、`openai`、`openrouter`），或新增 OpenAI 兼容中转商的 ID、Base URL、协议、密钥和模型 ID。中转商可显式读取 `/models`，也可手工配置；内置可用模型来自 Pi 的本地模型目录和凭据状态，**并非每次实时读取服务商列表**。某些中转商的 `/models` 接口不兼容时请手工填写。密钥写入应用用户数据目录下权限为 `0600` 的 Pi `auth.json`；自定义服务商元数据与密钥分开保存，不应放入代码仓库。写作与审校 Agent 可分别选择模型和 Provider，并各自作为有独立 Pi 会话、状态和输出的子任务持久记录；当前执行链固定为写作 → 事实审校，不提供任意动态委派或并行子 Agent。项目策略及反馈记忆会在后续任务中复用，但不替代 Git 证据。选中草稿后可发起关联上一轮内容的纠偏任务。草稿始终需要人工审阅和手动发布。

参考 `.skill` 安装包或含 `SKILL.md` 的目录可在 Skill 页面导入。内嵌 Skill 包含提交取证、独立开发者写作、事实核验、中文润色、封面 brief，以及 `responses-imagegen`。文案 Agent 只选基础 Skill、与任务意图匹配的已安装 Skill 或任务中点名的 Skill，避免把所有指令拼接后截断。对第三方 Skill 请先检查内容；Pi 文案任务无命令和文件工具，**不会自动执行导入的脚本、动态调用子 Skill 或读取其附属资源**。

参考仓库 `reference/xiaohongshu-ai-workbench` 的 7 个 `.skill` 包可逐个导入；已验证标题包可安装。它们覆盖标题、主页、选题、杂志栏目、评论、转化路径与路由，但不是 Git 证据取证、自动审校循环、图片生成、定时调度或自动发布的完整实现。`xiaohongshu-suite` 提到的子 Skill 切换在本应用的无工具文案 Agent 中不会自动发生；请直接安装所需子 Skill，并用任务说明明确目的。不能把“可导入”理解为全功能兼容。

审校 Agent 返回 `REJECTED` 时，工作台将反馈连同上一稿交还写作 Agent，再独立审校；最多三轮。第三轮仍未通过则停止自动修订，保留最后草稿、反馈、各轮子 Agent 和事件供人工纠偏；不会生成已审稿产物或推进 Git 基线。审校通过后才保存文案草稿。Git SHA 仅用于原始取证与提交依据，不应进入可发布正文；正式 Markdown 会清理旧稿中方括号、书名号及独立完整 SHA 引用。内容产物可切换正式预览、手机模拟、纯净 Markdown 与原始取证稿，并复制正文。手机模拟只用于检查阅读节奏，不代表真实客户端的最终裁切。旧稿无法可靠分段时不提供正式预览或批准，应人工核对并重新运行。

## 生图与环境变量

「任务审计」用于发起写作、选择写作/审校模型及随文图片方案、追踪子 Agent、事件和失败纠偏；「内容产物」只收录审校通过的文案，供正式预览、手机模拟、核对代码依据、查看封面与正文配图及人工批准/记录发布。「独立生图」与文案任务及 Git 仓库解耦，可不选择项目，图片保存在应用数据目录的 `images/_standalone`；也可选择已有项目关联保存。队列、预览、失败重试及“定位文件”均支持独立图片。已完成图片仍须人工上传，不会自动发布到小红书。

在「设置 → Skill 环境变量」至少保存 `OPS_IMAGE_API_KEY`。可选 `OPS_IMAGE_BASE_URL`（默认 OpenAI `/v1`）、`OPS_IMAGE_MODEL`（Responses 主模型）、`OPS_IMAGE_TOOL_MODEL`（图像工具模型）、`OPS_IMAGE_SIZE`、`OPS_IMAGE_QUALITY`、`OPS_IMAGE_FORMAT`、`OPS_IMAGE_BACKGROUND`。仅支持 `OPS_` 前缀；值存放在本机权限 `0600` 的 `environment.json`，界面只显示变量名。生图脚本只接收 `OPS_IMAGE_` 变量，不继承其他配置。通过独立导航「独立生图」选择 Responses 引擎，无需发起文案任务；可无参考图生成，或选择本机 PNG/JPEG/WebP 参考图编辑；首张 PNG 可涂抹遮罩（透明区域修改），通过 Responses `image_generation.input_image_mask` 发送。每行一条提示词，每条重复 1–4 张，单批最多 12 张、全局最多 40 个待处理任务；SQLite 队列串行执行，支持取消与失败重试，重启后排队项继续运行、运行中项标为失败。原 OpenRouter 单张生图入口保留。中转商需要实现 Responses `image_generation` 工具及遮罩参数，而不只是 `/chat/completions`；兼容性须按具体 Provider 验证。终端独立运行脚本时需自行导出环境变量，工作台不会注入到用户 Shell。API 调用可能产生费用，即使中途取消也可能计费。保存的本地图片仍须人工检查；不支持自动发布，不能声称与 Codex 内建 imagegen 的所有服务端能力完全等价。

生图工作台内置十种可选视觉方向：编辑式封面、产品概念拆解、信息图谱、温暖插画、棚拍物件，以及纸艺拼贴、开发桌面纪实、双色孔版刊物、三幕过程分镜、克制技术蓝图。它们参考 `freestylefly/awesome-gpt-image-2` 的创作方向重新编写，非原仓库全量案例或逐字复制；均约束不伪造界面、用户、指标或上线状态。独立生图可选择“不套用风格”。随文图片可分别选择 1–10 张封面和 1–10 张正文配图及各自的风格；写作 Agent 必须给每张图独立场景与构图，正文配图还须锚定不同正文片段，重复方案会退回修订。审校通过后最多 20 张一起入队，队列满时不会部分入队；任务审计可查看状态、取消和失败重试。图片失败不影响已审校文案；每张请求可能计费。模型输出的视觉差异与真实中转商兼容性仍需实测，不能保证完全一致或完全不重复。

```bash
npm test
npm run typecheck
npm run package:mac
npm run package:win
```

当前限制：Pi 真实生成需要自备 Provider 凭据；仓库的敏感内容检测不能替代人工隐私审核；macOS/Windows 安装包签名与 Windows 实机验收仍需目标平台环境。`node:sqlite` 在所用 Node/Electron 版本中仍会显示实验性 API 警告。
