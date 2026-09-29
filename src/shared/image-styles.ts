export const imageStyles = [
  {
    id: "editorial-poster", name: "编辑式封面", sourceTemplate: "poster-layout-system",
    description: "留白、强层级和克制配色，适合开发日志与观点笔记。",
    direction: "以独立杂志封面构图呈现主题：一个清晰主视觉、适度留白、明确的标题安全区；使用两到三种协调色，纸张与柔和光影形成质感。不要自动生成大段文字。",
  },
  {
    id: "product-concept", name: "产品概念拆解", sourceTemplate: "concept-product-breakdown",
    description: "用模块与层次解释功能取舍，不伪造真实界面。",
    direction: "把产品变化表达为精致的概念拆解图：核心主体居中，周围最多三个有逻辑的模块，以细线、留白和材质差异建立层级。只做概念视觉，不冒充真实产品截图。",
  },
  {
    id: "system-map", name: "信息图谱", sourceTemplate: "infographic-engine",
    description: "结构化展示流程、关联和前后变化。",
    direction: "将主题组织为三到五个可读模块，使用一致的网格、方向清晰的连接线和分层色彩；重点是信息流和关系，不虚构指标、用户数据或尚未证实的结果。",
  },
  {
    id: "warm-illustration", name: "温暖插画", sourceTemplate: "illustration-art-style",
    description: "手绘材质与温和叙事，适合个人创作故事。",
    direction: "以细腻手绘插画叙述独立开发者的具体情境：有焦点的主体、少量环境细节、温暖自然光和柔和颗粒纹理。避免通用机器人形象与陈词滥调的科技霓虹。",
  },
  {
    id: "studio-object", name: "棚拍物件", sourceTemplate: "realistic-photography",
    description: "真实材质与受控光线，呈现物件隐喻。",
    direction: "使用商业摄影的布光和材质控制，选一个与主题有关的真实物件作为隐喻；自然阴影、简洁背景、近景层次和充足留白。不要伪造人物、产品包装或实际使用场景。",
  },
  {
    id: "paper-collage", name: "纸艺拼贴", sourceTemplate: "collage-inspired",
    description: "剪纸层次与手写感线条，适合功能取舍和创作过程。",
    direction: "用真实纸张边缘、胶带痕迹和错层阴影组织三到四块视觉元素；主体与次要线索大小分明，配色以奶油白、墨绿及一点朱红形成手机缩略图焦点。留出标题区，避免碎片过密、微小文字和虚构截图。",
  },
  {
    id: "desk-documentary", name: "开发桌面纪实", sourceTemplate: "photography-inspired",
    description: "克制的桌面摄影，讲述独立开发者的真实工作情境。",
    direction: "以自然侧光拍摄无品牌的纸笔、键盘、便签和工作材料，俯拍或四分之三视角；真实材质、浅景深与轻微生活痕迹形成可信氛围。屏幕内容保持抽象或模糊，不冒充产品实拍、用户截图或真实人物肖像。",
  },
  {
    id: "risograph-zine", name: "双色孔版刊物", sourceTemplate: "print-poster-inspired",
    description: "有颗粒感的独立刊物视觉，适合观点与版本故事。",
    direction: "采用两色套印、细腻网点和轻微错位的孔版印刷质感；以一个大胆的主题物件配少量几何元素构成强对比封面，保留大面积呼吸空间。不要把长段正文直接画进图片，不生成虚假数据或媒体背书。",
  },
  {
    id: "process-storyboard", name: "三幕过程分镜", sourceTemplate: "storyboard-inspired",
    description: "用连续画面说明开发中的问题、行动与下一步。",
    direction: "画面分为三块清楚的连贯分镜，分别表现已核实的起点、实际代码动作和仍待验证的下一步；用一致的线条、角色物件和色温串联，绝不把计划阶段绘成已交付的结果。每块最多一个视觉焦点，不依赖小字说明。",
  },
  {
    id: "technical-blueprint", name: "克制技术蓝图", sourceTemplate: "diagram-inspired",
    description: "用清晰结构呈现模块关系与工程思考。",
    direction: "深色蓝灰底配柔和暖白线条，将已证实的代码模块抽象为大尺度的节点、边界和连接；只保留少量重点路径，像设计手稿而非真实系统截图。不要绘制未经证实的性能曲线、统计数字或正式上线徽章。",
  },
] as const;

export type ImageStyleId = typeof imageStyles[number]["id"];

export function imageStyle(id: string) { return imageStyles.find((style) => style.id === id); }

export function validatedCoverCount(value: unknown, enabled: boolean): number {
  if (!enabled && value !== undefined) throw new Error("请先启用随文封面");
  const count = value === undefined ? 1 : value;
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 10) throw new Error("封面数量须为 1–10 张");
  return count as number;
}

export function buildStyledImagePrompt(subject: string, styleId: string): string {
  const style = imageStyle(styleId);
  if (!style) throw new Error("图片风格不存在");
  const brief = subject.trim();
  if (!brief || brief.length > 4000) throw new Error("图片描述须为 1–4000 字");
  return `画面主题：${brief}\n视觉方向（${style.name}）：${style.direction}\n交付要求：小红书竖版 3:4 构图，主视觉在手机缩略图中仍清晰；边缘留安全区，色彩、光线、材质和空间层次统一。没有明确指定的文字不要凭空生成；若指定文字须逐字准确、易读。图片仅为概念视觉，不得伪造真实产品界面、用户反馈、数据或已上线状态。`;
}
