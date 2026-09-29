import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const baseSkills = ["commit-evidence", "developer-note-draft", "publish-proof-gate", "humanizer-zh", "cover-brief", "xiaohongshu-title"];
const routes: [RegExp, string][] = [
  [/选题|系列|内容规划|连续运营/, "xiaohongshu-topic-planner"],
  [/栏目|杂志感|刊魂/, "xiaohongshu-magazine"],
  [/主页|简介|定位|置顶/, "xiaohongshu-profile"],
  [/评论|回复|私信/, "xiaohongshu-comment-reply"],
  [/转化|成交|购买路径/, "xiaohongshu-conversion-path"],
];

export function selectSkillInstructions(skillsDir: string, request: string): string {
  const installed = new Set(readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  const selected = new Set(baseSkills);
  for (const [pattern, name] of routes) if (pattern.test(request)) selected.add(name);
  for (const name of installed) if (request.includes(name) && name !== "xiaohongshu-suite") selected.add(name);
  return [...selected].filter((name) => installed.has(name)).map((name) => {
    try { return `--- ${name} ---\n${readFileSync(join(skillsDir, name, "SKILL.md"), "utf8").slice(0, 10_000)}`; }
    catch { return ""; }
  }).filter(Boolean).join("\n\n").slice(0, 40_000);
}
