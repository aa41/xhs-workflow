import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { selectSkillInstructions } from "../src/service/skills.js";

const directory = mkdtempSync(join(tmpdir(), "indieops-skills-"));
after(() => rmSync(directory, { recursive: true, force: true }));
for (const name of ["developer-note-draft", "xiaohongshu-title", "xiaohongshu-topic-planner", "xiaohongshu-comment-reply", "unrelated-skill"]) {
  mkdirSync(join(directory, name));
  writeFileSync(join(directory, name, "SKILL.md"), `# ${name}\n${name} 的独立说明`);
}

test("仅选基础和匹配意图的已安装 Skill，不盲目拼接全部内容", () => {
  const selected = selectSkillInstructions(directory, "规划一个连续选题系列");
  assert.match(selected, /xiaohongshu-title/);
  assert.match(selected, /xiaohongshu-topic-planner/);
  assert.doesNotMatch(selected, /xiaohongshu-comment-reply/);
  assert.doesNotMatch(selected, /unrelated-skill/);
  assert.match(selectSkillInstructions(directory, "使用 unrelated-skill"), /unrelated-skill/);
});
