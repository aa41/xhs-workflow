import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanPublishableMarkdown, extractPublishableMarkdown, hasPublishableTags, PUBLISHABLE_END, PUBLISHABLE_START } from "../src/shared/publishable.js";
import { validatedCoverCount } from "../src/shared/image-styles.js";
import { phoneCopyFromMarkdown } from "../src/renderer/PhonePreview.js";

test("仅从明确的正文标记提取 Markdown，不带入审校或画面提示", () => {
  const draft = `标题候选：其他\n${PUBLISHABLE_START}\n# 正式标题\n\n这次只提交了代码。\n${PUBLISHABLE_END}\n封面生图提示词：留白海报\n事实对照：abc123`;
  assert.equal(extractPublishableMarkdown(draft), "# 正式标题\n\n这次只提交了代码。");
  assert.equal(extractPublishableMarkdown("# 旧稿\n审校说明：无法核对"), null);
  assert.equal(extractPublishableMarkdown(`${PUBLISHABLE_START}\n${PUBLISHABLE_END}`), null);
  assert.equal(extractPublishableMarkdown(`${draft}\n${PUBLISHABLE_START}重复`), null);
  assert.equal(cleanPublishableMarkdown("这次提交【f8345672d095d3e6596ba7ba13b9751a64c44892】新增了队列 [f8345672]。"), "这次提交新增了队列 。");
});

test("随文封面仅接受 1–10 张，独立生图无需此约束", () => {
  assert.equal(validatedCoverCount(undefined, false), 1);
  assert.equal(validatedCoverCount(10, true), 10);
  for (const value of [0, 11, 1.5, "2", null]) assert.throws(() => validatedCoverCount(value, true));
  assert.throws(() => validatedCoverCount(2, false));
});

test("正式正文以独立、去重的话题标签行结尾，历史稿不自动补标签", () => {
  const tagged = `# 本周开发记录\n\n只提交了代码，尚未上线。\n\n#独立开发者 #产品迭代 #开发日志`;
  assert.equal(hasPublishableTags(tagged), true);
  assert.equal(extractPublishableMarkdown(`${PUBLISHABLE_START}\n${tagged}\n${PUBLISHABLE_END}`), tagged);
  for (const invalid of [
    "# 标题\n\n只有正文。",
    "# 标题\n\n#独立开发者",
    "# 标题\n\n#独立开发者 #独立开发者",
    "# 标题\n\n#独立开发者 #产品迭代 正文尾注",
    "# 标题\n\n# 独立开发者 # 产品迭代",
    "# 标题\n\n#独立开发者 #产品迭代 #开发日志 #设计 #编程 #工具",
  ]) assert.equal(hasPublishableTags(invalid), false, invalid);
});

test("手机预览保留长正文末尾的完整话题标签", () => {
  const { title, body } = phoneCopyFromMarkdown(`# 开发记录\n\n${"迭代过程。".repeat(400)}\n\n#独立开发者 #产品迭代`);
  assert.equal(title, "开发记录");
  assert.match(body, /#独立开发者 #产品迭代$/);
});
