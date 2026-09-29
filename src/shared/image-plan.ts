import { buildStyledImagePrompt } from "./image-styles.js";
import { extractPublishableMarkdown } from "./publishable.js";

export const IMAGE_PLAN_START = "<!-- IMAGE_PLAN_START -->";
export const IMAGE_PLAN_END = "<!-- IMAGE_PLAN_END -->";

export type ImageBrief = { role: "cover" | "content"; scene: string; composition: string; anchor?: string };
export type PlannedImage = { role: ImageBrief["role"]; sequence: number; prompt: string };

function tooSimilar(first: string, second: string): boolean {
  const pairs = (value: string) => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2)));
  const left = pairs(first);
  const right = pairs(second);
  const shared = [...left].filter(pair => right.has(pair)).length;
  return shared / (left.size + right.size - shared) > .76;
}

export function parseImagePlan(draft: string, coverCount: number, contentCount: number): ImageBrief[] | null {
  if (coverCount + contentCount === 0) return [];
  const start = draft.indexOf(IMAGE_PLAN_START);
  const end = draft.indexOf(IMAGE_PLAN_END);
  if (start < 0 || end <= start || draft.indexOf(IMAGE_PLAN_START, start + 1) !== -1 ||
    draft.indexOf(IMAGE_PLAN_END, end + 1) !== -1) return null;
  const markdown = extractPublishableMarkdown(draft);
  if (!markdown) return null;
  let entries: unknown;
  try { entries = JSON.parse(draft.slice(start + IMAGE_PLAN_START.length, end).trim()); }
  catch { return null; }
  if (!Array.isArray(entries) || entries.length !== coverCount + contentCount) return null;
  const plan: ImageBrief[] = [];
  const scenes = new Set<string>();
  const compositions = new Set<string>();
  const anchors = new Set<string>();
  for (const item of entries) {
    if (!item || typeof item !== "object") return null;
    const entry = item as Record<string, unknown>;
    if (entry.role !== "cover" && entry.role !== "content") return null;
    if (typeof entry.scene !== "string" || entry.scene.trim().length < 12 || entry.scene.length > 1200 ||
      typeof entry.composition !== "string" || entry.composition.trim().length < 6 || entry.composition.length > 600) return null;
    const scene = entry.scene.trim();
    const composition = entry.composition.trim();
    const key = scene.replace(/\s+/g, "").toLowerCase();
    const compositionKey = composition.replace(/\s+/g, "").toLowerCase();
    if ([...scenes].some(previous => previous === key || tooSimilar(previous, key)) || compositions.has(compositionKey)) return null;
    scenes.add(key);
    compositions.add(compositionKey);
    if (entry.role === "content") {
      if (typeof entry.anchor !== "string" || entry.anchor.trim().length < 6 || entry.anchor.length > 120 ||
        !markdown.includes(entry.anchor.trim()) || anchors.has(entry.anchor.trim())) return null;
      anchors.add(entry.anchor.trim());
    }
    plan.push({ role: entry.role, scene, composition,
      ...(entry.role === "content" ? { anchor: (entry.anchor as string).trim() } : {}) });
  }
  if (plan.filter(item => item.role === "cover").length !== coverCount ||
    plan.filter(item => item.role === "content").length !== contentCount) return null;
  return plan;
}

export function plannedImagePrompts(draft: string, coverCount: number, contentCount: number,
  coverStyle: string | null, contentStyle: string | null): PlannedImage[] {
  const plan = parseImagePlan(draft, coverCount, contentCount);
  if (!plan) throw new Error("草稿缺少可核对的逐张图片方案；请重新运行写作任务");
  let coverSequence = 0;
  let contentSequence = 0;
  return plan.map(item => {
    const sequence = item.role === "cover" ? ++coverSequence : ++contentSequence;
    const style = item.role === "cover" ? coverStyle : contentStyle;
    if (!style) throw new Error("图片风格未配置");
    const subject = `${item.role === "cover" ? "封面" : "内容配图"}画面：${item.scene}\n独立构图：${item.composition}${item.anchor ? `\n对应正文片段：${item.anchor}` : ""}`;
    return { role: item.role, sequence, prompt: buildStyledImagePrompt(subject, style) };
  });
}
