---
name: responses-imagegen
description: 通过 OpenAI Responses image_generation 工具生成或编辑小红书图片，支持参考图、局部遮罩与多轮迭代。
---

# Responses 生图与修图

适用于封面、插画、信息图、已有图片的定向修改。先明确用途、构图、主体、风格和需要保持不变的元素；文字要求请逐字标注。不要把生成的图像说成真实产品截图或真实用户反馈。

在工作台「设置 → 环境变量」配置 `OPS_IMAGE_API_KEY`、`OPS_IMAGE_BASE_URL`（默认 `https://api.openai.com/v1`）、`OPS_IMAGE_MODEL`（支持 image_generation 工具的主模型）、`OPS_IMAGE_TOOL_MODEL`（图像模型）。可选 `OPS_IMAGE_SIZE`、`OPS_IMAGE_QUALITY`、`OPS_IMAGE_FORMAT`、`OPS_IMAGE_BACKGROUND`。密钥不得写进提示词、仓库或任务日志。中转商必须兼容 Responses API 的 image_generation 工具；遮罩还须支持 `input_image_mask`，不能仅支持 Chat Completions。

工作台「内容产物 → 生图工作台」可生成、选择参考图进行编辑。首张参考图为 PNG 时可涂抹透明遮罩，透明区域供模型修改；遮罩须与首图同尺寸、含 Alpha、且小于 4 MB。每行一条提示词，每条可重复 1–4 张；单批最多 12 个任务，所有项目合计最多 40 个待处理任务。本地 SQLite 队列串行执行，可取消、失败后重试；重启时未完成的运行项记为失败，尚未开始的任务继续执行。任务提交后即可能产生费用，取消不能保证撤销已计费的请求。

也可以在受信任终端自行导出环境变量后调用 `node scripts/image.mjs --prompt '...' --out /path/to/output.png`，编辑时追加 `--input /path/to/source.png`；多图参考可重复 `--input`，遮罩可追加 `--mask /path/to/mask.png`。工作台保存的变量不会导出到终端。脚本也支持 `--previous-response-id` 继续远端会话。输出 JSON 含文件路径、响应 ID 和修订提示词，不包含图片 Base64 或密钥。生成文件由用户确认后才用于发布。本 Skill 不提供自动发布，也不保证与内建 imagegen 的所有服务端能力完全等价。
